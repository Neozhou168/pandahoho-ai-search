// upload_json.mjs
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

// 清理文本中的问题字符
function cleanText(text) {
    if (typeof text !== 'string') {
        text = String(text);
    }
    
    // 移除有问题的转义字符和控制字符
    return text
        .replace(/\\x[0-9a-fA-F]{0,2}/g, '')  // 移除十六进制转义
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')  // 移除控制字符
        .replace(/\\/g, '\\\\')  // 确保反斜杠正确转义
        .replace(/"/g, '\\"')    // 确保引号正确转义
        .trim();
}

// 生成用于向量化的文本内容
function generateTextForEmbedding(item, type) {
    let text = "";
    
    // 根据不同类型构建文本
    switch (type) {
        case "routes":
            text = [
                cleanText(item.title || ""),
                cleanText(item.description || ""),
                cleanText(item.city || ""),
                cleanText(item.country || ""),
                // 添加其他相关字段
                cleanText(item.travel_mode || ""),
                cleanText(item.duration || "")
            ].filter(Boolean).join(" ");
            break;
            
        case "venues":
            text = [
                cleanText(item.title || ""),
                cleanText(item.description || ""),
                cleanText(item.city || ""),
                cleanText(item.country || ""),
                cleanText(item.type || ""),
                // 处理 audience 数组
                Array.isArray(item.audience) ? item.audience.map(cleanText).join(" ") : "",
                // 处理 highlights 数组
                Array.isArray(item.highlights) ? item.highlights.map(cleanText).join(" ") : ""
            ].filter(Boolean).join(" ");
            break;
            
        case "curations":
            text = [
                cleanText(item.title || ""),
                cleanText(item.description || ""),
                cleanText(item.city || ""),
                cleanText(item.country || ""),
                cleanText(item.travel_type || ""),
                cleanText(item.best_season || "")
            ].filter(Boolean).join(" ");
            break;
            
        case "group_ups":
            text = [
                cleanText(item.title || ""),
                cleanText(item.description || ""),
                cleanText(item.note || ""),
                cleanText(item.creator_full_name || "")
            ].filter(Boolean).join(" ");
            break;
            
        default:
            // 通用处理：使用 title 和 description
            text = `${cleanText(item.title || "")} ${cleanText(item.description || "")}`.trim();
    }
    
    // 最终清理
    text = cleanText(text);
    
    // 如果没有有效文本，使用清理后的基本信息
    if (!text) {
        text = cleanText(`${item.id || "unknown"} ${item.type || ""}`);
    }
    
    return text;
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
        // 如果 JSON 根是数组
        combinedData = jsonData.map(item => ({ ...item, type: "default" }));
    } else {
        // 检查预期的字段
        expectedFields.forEach(fieldName => {
            if (jsonData[fieldName] && Array.isArray(jsonData[fieldName])) {
                console.log(`📂 检测到数组字段: ${fieldName}（${jsonData[fieldName].length} 条）`);
                combinedData = combinedData.concat(
                    jsonData[fieldName].map(item => ({ ...item, type: fieldName }))
                );
            }
        });
        
        // 检查其他可能的数组字段
        Object.keys(jsonData).forEach(key => {
            if (!expectedFields.includes(key) && Array.isArray(jsonData[key])) {
                console.log(`📂 发现额外数组字段: ${key}（${jsonData[key].length} 条）`);
                combinedData = combinedData.concat(
                    jsonData[key].map(item => ({ ...item, type: key }))
                );
            }
        });
    }

    if (combinedData.length === 0) {
        console.error("❌ JSON 中未找到任何数组数据");
        console.log("🔍 文件内容预览:", JSON.stringify(jsonData, null, 2).substring(0, 500));
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

// 调用 OpenAI Embedding API（增加重试机制）
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
                    timeout: 30000, // 30秒超时
                }
            );
            return res.data.data[0].embedding;
        } catch (error) {
            console.warn(`⚠️ 向量生成失败 (尝试 ${i + 1}/${retries}):`, error.message);
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // 指数退避
        }
    }
}

// 删除已存在的 collection
async function deleteCollection() {
    try {
        await axios.delete(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}`, {
            headers: { "api-key": QDRANT_API_KEY },
        });
        console.log(`🗑️ 已删除 Collection "${QDRANT_COLLECTION}"`);
    } catch (err) {
        if (err.response?.status === 404) {
            console.log(`ℹ️ Collection "${QDRANT_COLLECTION}" 不存在，跳过删除`);
        } else {
            console.error("⚠️ 删除 Collection 失败:", err.response?.data || err.message);
        }
    }
}

// 创建新的 collection
async function createCollection() {
    try {
        await axios.put(
            `${QDRANT_URL}/collections/${QDRANT_COLLECTION}`,
            {
                vectors: { size: 1536, distance: "Cosine" },
            },
            {
                headers: { "api-key": QDRANT_API_KEY },
            }
        );
        console.log(`✅ 已创建 Collection "${QDRANT_COLLECTION}"`);
    } catch (err) {
        console.error("❌ 创建 Collection 失败:", err.response?.data || err.message);
        throw err;
    }
}

// 批量上传数据到 Qdrant
async function uploadData(points) {
    const batchSize = 100; // 批量大小
    const totalBatches = Math.ceil(points.length / batchSize);
    
    console.log(`⬆️ 开始批量上传 ${points.length} 条数据（${totalBatches} 批次）...`);
    
    for (let i = 0; i < totalBatches; i++) {
        const start = i * batchSize;
        const end = Math.min(start + batchSize, points.length);
        const batch = points.slice(start, end);
        
        try {
            await axios.put(
                `${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points?wait=true`,
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
    
    console.log("🎉 所有数据上传完成");
}

// 主流程
(async () => {
    try {
        console.log("🚀 开始数据上传流程...");
        
        // 验证环境变量
        const requiredEnvs = ["QDRANT_URL", "QDRANT_API_KEY", "QDRANT_COLLECTION", "OPENAI_API_KEY"];
        const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
        if (missingEnvs.length > 0) {
            console.error("❌ 缺少必要的环境变量:", missingEnvs.join(", "));
            process.exit(1);
        }
        
        await deleteCollection();
        await createCollection();

        const data = readAllArraysFromJson();
        const points = [];

        console.log(`📦 总共 ${data.length} 条记录，开始生成向量...`);

        for (const [i, item] of data.entries()) {
            const textForEmbedding = generateTextForEmbedding(item, item.type);
            
            console.log(`📝 (${i + 1}/${data.length}) [${item.type}] 生成向量中...`);
            
            // 验证文本内容
            if (!textForEmbedding || textForEmbedding.length < 10) {
                console.warn(`⚠️ 第 ${i + 1} 条记录文本过短，跳过`);
                continue;
            }
            
            try {
                const vector = await generateEmbedding(textForEmbedding);

                // 确保 ID 唯一性
                const uniqueId = item.id ? 
                    stringToUUID(`${item.type}-${item.id}`) : 
                    stringToUUID(`${item.type}-${i}-${Date.now()}`);

                // 清理 payload 中的所有字符串字段
                const cleanPayload = {};
                for (const [key, value] of Object.entries(item)) {
                    if (typeof value === 'string') {
                        cleanPayload[key] = cleanText(value);
                    } else if (Array.isArray(value)) {
                        cleanPayload[key] = value.map(v => typeof v === 'string' ? cleanText(v) : v);
                    } else {
                        cleanPayload[key] = value;
                    }
                }

                points.push({
                    id: uniqueId,
                    vector,
                    payload: {
                        ...cleanPayload,
                        // 添加一些元数据
                        _text_for_embedding: textForEmbedding.substring(0, 500), // 保存用于调试
                        _created_at: new Date().toISOString()
                    },
                });
            } catch (error) {
                console.error(`❌ 处理第 ${i + 1} 条记录时出错:`, error.message);
                // 不要因为单条记录失败就停止整个过程
                continue;
            }
        }

        await uploadData(points);
        console.log("🎊 全部完成！");
        
    } catch (error) {
        console.error("💥 程序执行失败:", error.message);
        process.exit(1);
    }
})();