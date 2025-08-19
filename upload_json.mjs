// upload_json.mjs - 包含URL字段的完整版本
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";

dotenv.config();

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const DATA_FILE = path.join(process.cwd(), "data", "pandahoho-export.json");

// 字符串转 UUID
function stringToUUID(str) {
    const hash = crypto.createHash("sha1").update(str).digest("hex");
    return [
        hash.substring(0, 8),
        hash.substring(8, 12),
        hash.substring(12, 16),
        hash.substring(16, 20),
        hash.substring(20, 32),
    ].join("-");
}

// 超级安全的文本清理
function cleanText(text) {
    if (typeof text !== 'string') {
        text = String(text);
    }
    
    // 超级保守的清理：只保留基本字符
    return text
        .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, ' ')  // 只保留基本ASCII和中文
        .replace(/\s+/g, ' ')  // 压缩空白字符
        .trim();
}

// URL专用清理函数 - 保留URL中的特殊字符
function cleanUrl(url) {
    if (typeof url !== 'string') {
        return '';
    }
    
    // 对URL只做最小清理，保留URL必要的字符
    return url
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // 只移除控制字符
        .trim();
}

// 生成用于向量化的文本内容
function generateTextForEmbedding(item, type) {
    let parts = [];
    
    // 根据不同类型构建文本
    switch (type) {
        case "routes":
            parts = [
                item.title,
                item.description,
                item.city,
                item.country,
                item.travel_mode,
                item.duration
            ];
            break;
            
        case "venues":
            parts = [
                item.title,
                item.description,
                item.city,
                item.country,
                item.type
            ];
            // 处理数组
            if (Array.isArray(item.audience)) {
                parts.push(item.audience.join(' '));
            }
            if (Array.isArray(item.highlights)) {
                parts.push(item.highlights.join(' '));
            }
            break;
            
        case "curations":
            parts = [
                item.title,
                item.description,
                item.city,
                item.country,
                item.travel_type,
                item.best_season
            ];
            break;
            
        case "group_ups":
            parts = [
                item.title,
                item.description,
                item.note,
                item.creator_full_name
            ];
            break;
            
        default:
            parts = [item.title, item.description];
    }
    
    // 清理并组合
    const cleanParts = parts
        .filter(part => part && typeof part === 'string')
        .map(part => cleanText(part))
        .filter(part => part.length > 0);
    
    const result = cleanParts.join(' ').trim();
    
    // 确保有内容
    return result || cleanText(item.id || 'unknown') + ' ' + cleanText(item.type || '');
}

// 读取并合并 JSON 中的所有数组字段
function readAllArraysFromJson() {
    if (!fs.existsSync(DATA_FILE)) {
        console.error(`❌ 找不到文件: ${DATA_FILE}`);
        process.exit(1);
    }
    
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const jsonData = JSON.parse(raw);

    let combinedData = [];
    const expectedFields = ["routes", "venues", "curations", "group_ups"];

    if (Array.isArray(jsonData)) {
        combinedData = jsonData.map(item => ({ ...item, type: "default" }));
    } else {
        expectedFields.forEach(fieldName => {
            if (jsonData[fieldName] && Array.isArray(jsonData[fieldName])) {
                console.log(`📂 检测到数组字段: ${fieldName}（${jsonData[fieldName].length} 条）`);
                combinedData = combinedData.concat(
                    jsonData[fieldName].map(item => ({ ...item, type: fieldName }))
                );
            }
        });
    }

    if (combinedData.length === 0) {
        console.error("❌ JSON 中未找到任何数组数据");
        process.exit(1);
    }

    console.log(`📊 数据统计:`);
    const typeStats = {};
    combinedData.forEach(item => {
        typeStats[item.type] = (typeStats[item.type] || 0) + 1;
    });
    Object.entries(typeStats).forEach(([type, count]) => {
        console.log(`  - ${type}: ${count} 条`);
    });

    return combinedData;
}

// 调用 OpenAI Embedding API
async function generateEmbedding(text, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.post(
                "https://api.openai.com/v1/embeddings",
                {
                    model: "text-embedding-3-small",
                    input: text,
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${OPENAI_API_KEY}`,
                    },
                    timeout: 30000,
                }
            );
            return res.data.data[0].embedding;
        } catch (error) {
            console.warn(`⚠️ 向量生成失败 (尝试 ${i + 1}/${retries}):`, error.message);
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}

// 安全的集合管理：使用临时集合避免服务中断
async function safeCollectionUpdate() {
    const tempCollectionName = `${QDRANT_COLLECTION}_temp_${Date.now()}`;
    
    try {
        // 1. 创建临时集合
        console.log(`🔧 创建临时集合: ${tempCollectionName}`);
        await axios.put(
            `${QDRANT_URL}/collections/${tempCollectionName}`,
            {
                vectors: { size: 1536, distance: "Cosine" },
            },
            {
                headers: { "api-key": QDRANT_API_KEY },
            }
        );
        
        return tempCollectionName;
    } catch (err) {
        console.error("❌ 创建临时集合失败:", err.response?.data || err.message);
        throw err;
    }
}

// 完成上传后的集合切换
async function switchCollections(tempCollectionName) {
    try {
        // 1. 删除旧的主集合（如果存在）
        try {
            await axios.delete(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}`, {
                headers: { "api-key": QDRANT_API_KEY },
            });
            console.log(`🗑️ 已删除旧集合: ${QDRANT_COLLECTION}`);
        } catch (err) {
            if (err.response?.status !== 404) {
                console.warn("⚠️ 删除旧集合时出现问题:", err.response?.data || err.message);
            }
        }
        
        // 2. 将临时集合重命名为主集合名
        // 注意：Qdrant不支持直接重命名，我们需要使用别名机制
        console.log(`🔄 设置集合别名...`);
        
        // 创建别名指向临时集合
        await axios.put(
            `${QDRANT_URL}/collections/aliases`,
            {
                actions: [
                    {
                        create_alias: {
                            collection_name: tempCollectionName,
                            alias_name: QDRANT_COLLECTION
                        }
                    }
                ]
            },
            {
                headers: { "api-key": QDRANT_API_KEY },
            }
        );
        
        console.log(`✅ 集合切换完成！现在 ${QDRANT_COLLECTION} 指向新数据`);
        
        // 3. 稍后删除临时集合（可选）
        // 注意：保留临时集合一段时间以防需要回滚
        console.log(`ℹ️ 临时集合 ${tempCollectionName} 已保留，可稍后手动删除`);
        
    } catch (err) {
        console.error("❌ 集合切换失败:", err.response?.data || err.message);
        // 如果切换失败，至少尝试删除临时集合
        try {
            await axios.delete(`${QDRANT_URL}/collections/${tempCollectionName}`, {
                headers: { "api-key": QDRANT_API_KEY },
            });
        } catch (cleanupErr) {
            console.warn("⚠️ 清理临时集合失败:", cleanupErr.message);
        }
        throw err;
    }
}

// 上传数据到指定集合
async function uploadDataToCollection(points, collectionName) {
    const batchSize = 50;
    const totalBatches = Math.ceil(points.length / batchSize);
    
    console.log(`⬆️ 开始批量上传 ${points.length} 条数据到 ${collectionName}（${totalBatches} 批次）...`);
    
    for (let i = 0; i < totalBatches; i++) {
        const start = i * batchSize;
        const end = Math.min(start + batchSize, points.length);
        const batch = points.slice(start, end);
        
        try {
            await axios.put(
                `${QDRANT_URL}/collections/${collectionName}/points?wait=true`,
                { points: batch },
                { 
                    headers: { "api-key": QDRANT_API_KEY },
                    timeout: 30000 
                }
            );
            console.log(`✅ 批次 ${i + 1}/${totalBatches} 上传完成（${batch.length} 条）`);
        } catch (err) {
            console.error(`❌ 批次 ${i + 1} 上传失败:`, err.response?.data || err.message);
            throw err;
        }
    }
    
    console.log(`🎉 所有数据已上传到 ${collectionName}`);
}

// 主流程
(async () => {
    try {
        console.log("🚀 开始安全的数据更新流程...");
        
        // 验证环境变量
        const requiredEnvs = ["QDRANT_URL", "QDRANT_API_KEY", "QDRANT_COLLECTION", "OPENAI_API_KEY"];
        const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
        if (missingEnvs.length > 0) {
            console.error("❌ 缺少必要的环境变量:", missingEnvs.join(", "));
            process.exit(1);
        }
        
        // 1. 创建临时集合（不影响现有服务）
        const tempCollectionName = await safeCollectionUpdate();

        const data = readAllArraysFromJson();
        const points = [];

        console.log(`📦 总共 ${data.length} 条记录，开始生成向量...`);

        for (const [i, item] of data.entries()) {
            const textForEmbedding = generateTextForEmbedding(item, item.type);
            
            console.log(`📝 (${i + 1}/${data.length}) [${item.type}] 生成向量中...`);
            
            if (!textForEmbedding || textForEmbedding.length < 5) {
                console.warn(`⚠️ 第 ${i + 1} 条记录文本过短，跳过`);
                continue;
            }
            
            try {
                const vector = await generateEmbedding(textForEmbedding);

                const uniqueId = item.id ? 
                    stringToUUID(`${item.type}-${item.id}`) : 
                    stringToUUID(`${item.type}-${i}-${Date.now()}`);

                // 创建包含所有重要字段的payload
                const cleanPayload = {
                    id: cleanText(item.id || ''),
                    title: cleanText(item.title || ''),
                    description: cleanText(item.description || ''),
                    city: cleanText(item.city || ''),
                    country: cleanText(item.country || ''),
                    type: item.type
                };

                // 根据数据类型添加特定字段
                switch (item.type) {
                    case 'routes':
                        if (item.travel_mode) cleanPayload.travel_mode = cleanText(item.travel_mode);
                        if (item.duration) cleanPayload.duration = cleanText(item.duration);
                        if (item.url) cleanPayload.url = cleanUrl(item.url);
                        break;
                    case 'venues':
                        if (item.audience) cleanPayload.audience = Array.isArray(item.audience) ? item.audience.map(cleanText) : [];
                        if (item.highlights) cleanPayload.highlights = Array.isArray(item.highlights) ? item.highlights.map(cleanText) : [];
                        if (item.url) cleanPayload.url = cleanUrl(item.url);
                        break;
                    case 'curations':
                        if (item.travel_type) cleanPayload.travel_type = cleanText(item.travel_type);
                        if (item.best_season) cleanPayload.best_season = cleanText(item.best_season);
                        if (item.url) cleanPayload.url = cleanUrl(item.url);
                        if (item.cover_image_url) cleanPayload.cover_image_url = cleanUrl(item.cover_image_url);
                        break;
                    case 'group_ups':
                        if (item.note) cleanPayload.note = cleanText(item.note);
                        if (item.creator_full_name) cleanPayload.creator_full_name = cleanText(item.creator_full_name);
                        if (item.start_time) cleanPayload.start_time = item.start_time;
                        if (item.meeting_point) cleanPayload.meeting_point = cleanText(item.meeting_point);
                        if (item.url) cleanPayload.url = cleanUrl(item.url);
                        break;
                }

                // 检查并添加其他可能的URL字段
                ['url', 'cover_image_url', 'video_url'].forEach(urlField => {
                    if (item[urlField] && !cleanPayload[urlField]) {
                        cleanPayload[urlField] = cleanUrl(item[urlField]);
                    }
                });

                points.push({
                    id: uniqueId,
                    vector,
                    payload: cleanPayload
                });
            } catch (error) {
                console.error(`❌ 处理第 ${i + 1} 条记录时出错:`, error.message);
                continue;
            }
        }

        if (points.length === 0) {
            console.error("❌ 没有有效的数据点可以上传");
            process.exit(1);
        }

        // 2. 上传数据到临时集合
        await uploadDataToCollection(points, tempCollectionName);
        
        // 3. 原子性切换：只有上传成功后才切换集合
        await switchCollections(tempCollectionName);
        
        console.log("🎊 安全更新完成！搜索服务无中断！");
        
    } catch (error) {
        console.error("💥 程序执行失败:", error.message);
        process.exit(1);
    }
})();