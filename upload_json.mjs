// auto_update_with_railway.mjs - 全自动化零停机更新（包含Railway切换）
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

// Railway API 配置（可选）
const RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN;
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID;
const RAILWAY_SERVICE_ID = process.env.RAILWAY_SERVICE_ID;

const DATA_FILE = path.join(process.cwd(), "data", "pandahoho-export.json");

// 定义两个固定的集合名称
const COLLECTION_A = "pandahoho_knowledge";
const COLLECTION_B = "pandahoho_knowledge_temp_1755596302600";

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

function cleanText(text) {
    if (typeof text !== 'string') text = String(text);
    return text.replace(/[^\x20-\x7E\u4e00-\u9fff]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanUrl(url) {
    if (typeof url !== 'string') return '';
    return url.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

// 修改：添加 survival_guides 支持
function generateTextForEmbedding(item, type) {
    let parts = [];
    switch (type) {
        case "routes":
            parts = [item.title, item.description, item.city, item.country, item.travel_mode, item.duration];
            break;
        case "venues":
            parts = [item.title, item.description, item.city, item.country, item.type];
            if (Array.isArray(item.audience)) parts.push(item.audience.join(' '));
            if (Array.isArray(item.highlights)) parts.push(item.highlights.join(' '));
            break;
        case "curations":
            parts = [item.title, item.description, item.city, item.country, item.travel_type, item.best_season];
            break;
        case "group_ups":
            parts = [item.title, item.description, item.note, item.creator_full_name];
            break;
        case "survival_guides": // 新增 survival_guides 支持
            parts = [item.title, item.description, item.country];
            // survival guides 通常包含实用信息，所以描述权重更高
            if (item.description) {
                parts.push(item.description); // 重复添加描述以增加权重
            }
            break;
        default:
            parts = [item.title, item.description];
    }
    const cleanParts = parts.filter(part => part && typeof part === 'string').map(part => cleanText(part)).filter(part => part.length > 0);
    const result = cleanParts.join(' ').trim();
    return result || cleanText(item.id || 'unknown') + ' ' + cleanText(item.type || '');
}

function readAllArraysFromJson() {
    if (!fs.existsSync(DATA_FILE)) {
        console.error(`❌ 找不到文件: ${DATA_FILE}`);
        process.exit(1);
    }
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const jsonData = JSON.parse(raw);
    let combinedData = [];
    // 修改：添加 survival_guides 到预期字段列表
    const expectedFields = ["routes", "venues", "curations", "group_ups", "survival_guides"];
    if (Array.isArray(jsonData)) {
        combinedData = jsonData.map(item => ({ ...item, type: "default" }));
    } else {
        expectedFields.forEach(fieldName => {
            if (jsonData[fieldName] && Array.isArray(jsonData[fieldName])) {
                console.log(`📂 检测到数组字段: ${fieldName}（${jsonData[fieldName].length} 条）`);
                combinedData = combinedData.concat(jsonData[fieldName].map(item => ({ ...item, type: fieldName })));
            }
        });
    }
    if (combinedData.length === 0) {
        console.error("❌ JSON 中未找到任何数组数据");
        process.exit(1);
    }
    return combinedData;
}

async function generateEmbedding(text, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.post("https://api.openai.com/v1/embeddings", {
                model: "text-embedding-3-small",
                input: text,
            }, {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                },
                timeout: 30000,
            });
            return res.data.data[0].embedding;
        } catch (error) {
            console.warn(`⚠️ 向量生成失败 (尝试 ${i + 1}/${retries}):`, error.message);
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}

// Railway API 功能
async function updateRailwayEnvironmentVariable(newCollection) {
    if (!RAILWAY_API_TOKEN || !RAILWAY_PROJECT_ID || !RAILWAY_SERVICE_ID) {
        console.log("⚠️ Railway API 配置不完整，需要手动切换环境变量");
        console.log(`🔧 请将 Railway 环境变量 QDRANT_COLLECTION 改为: ${newCollection}`);
        return false;
    }

    try {
        console.log("🚀 正在自动更新 Railway 环境变量...");
        
        // Railway GraphQL API 调用
        const mutation = `
            mutation variableUpsert($input: VariableUpsertInput!) {
                variableUpsert(input: $input) {
                    id
                    name
                    value
                }
            }
        `;

        const variables = {
            input: {
                projectId: RAILWAY_PROJECT_ID,
                serviceId: RAILWAY_SERVICE_ID,
                name: "QDRANT_COLLECTION",
                value: newCollection
            }
        };

        const response = await axios.post('https://backboard.railway.app/graphql/v2', {
            query: mutation,
            variables: variables
        }, {
            headers: {
                'Authorization': `Bearer ${RAILWAY_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        if (response.data.errors) {
            console.error("❌ Railway API 错误:", response.data.errors);
            return false;
        }

        console.log("✅ Railway 环境变量已更新");
        
        // 触发重新部署
        console.log("🔄 正在触发服务重新部署...");
        
        const deployMutation = `
            mutation serviceRedeploy($serviceId: String!) {
                serviceRedeploy(serviceId: $serviceId)
            }
        `;

        const deployResponse = await axios.post('https://backboard.railway.app/graphql/v2', {
            query: deployMutation,
            variables: { serviceId: RAILWAY_SERVICE_ID }
        }, {
            headers: {
                'Authorization': `Bearer ${RAILWAY_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        if (deployResponse.data.errors) {
            console.error("❌ 重新部署失败:", deployResponse.data.errors);
            console.log("💡 请手动在 Railway 控制台触发重新部署");
            return false;
        }

        console.log("✅ 服务重新部署已触发");
        return true;

    } catch (error) {
        console.error("❌ Railway API 调用失败:", error.message);
        console.log(`🔧 请手动将 Railway 环境变量 QDRANT_COLLECTION 改为: ${newCollection}`);
        return false;
    }
}

// 等待服务重启并验证
async function waitForServiceRestart(targetCollection, maxWaitTime = 300000) { // 5分钟
    const startTime = Date.now();
    const serviceUrl = "https://pandahoho-ai-search-production.up.railway.app";
    
    console.log("⏳ 等待服务重启并验证...");
    
    while (Date.now() - startTime < maxWaitTime) {
        try {
            const response = await axios.get(`${serviceUrl}/collection-status`, {
                timeout: 10000
            });
            
            if (response.data.collection_name === targetCollection && 
                response.data.collection_status?.available) {
                console.log("✅ 服务已成功切换到新集合");
                
                // 测试搜索功能
                try {
                    const searchResponse = await axios.post(`${serviceUrl}/search`, {
                        query: "test"
                    }, { timeout: 10000 });
                    
                    if (searchResponse.data.status === 'ok') {
                        console.log("✅ 搜索功能验证成功");
                        return true;
                    }
                } catch (searchError) {
                    console.warn("⚠️ 搜索测试失败，但服务可能正在启动中");
                }
            }
            
        } catch (error) {
            // 服务可能还在重启中，继续等待
        }
        
        console.log("⏳ 服务还在重启中，继续等待...");
        await new Promise(resolve => setTimeout(resolve, 10000)); // 等待10秒
    }
    
    console.log("⚠️ 服务重启等待超时，请手动验证");
    return false;
}

// 检查集合状态的函数
async function checkCollectionStatus() {
    try {
        console.log("🔍 检查现有集合状态...");
        
        const collectionsResponse = await axios.get(`${QDRANT_URL}/collections`, {
            headers: { "api-key": QDRANT_API_KEY }
        });
        
        const collections = collectionsResponse.data.result.collections;
        const collectionA = collections.find(col => col.name === COLLECTION_A);
        const collectionB = collections.find(col => col.name === COLLECTION_B);
        
        console.log(`📋 集合状态:`);
        console.log(`  - ${COLLECTION_A}: ${collectionA ? '存在' : '不存在'}`);
        console.log(`  - ${COLLECTION_B}: ${collectionB ? '存在' : '不存在'}`);
        console.log(`  - 当前生产集合: ${QDRANT_COLLECTION}`);
        
        let targetCollection, currentCollection;
        
        if (QDRANT_COLLECTION === COLLECTION_A) {
            currentCollection = COLLECTION_A;
            targetCollection = COLLECTION_B;
        } else if (QDRANT_COLLECTION === COLLECTION_B) {
            currentCollection = COLLECTION_B;
            targetCollection = COLLECTION_A;
        } else {
            currentCollection = COLLECTION_A;
            targetCollection = COLLECTION_B;
        }
        
        console.log(`🎯 更新策略:`);
        console.log(`  - 当前生产集合: ${currentCollection} (保持运行)`);
        console.log(`  - 更新目标集合: ${targetCollection} (将被重建)`);
        
        return { currentCollection, targetCollection, bothExist: !!collectionA && !!collectionB };
        
    } catch (error) {
        console.error("❌ 检查集合状态失败:", error.response?.data || error.message);
        throw error;
    }
}

// 准备目标集合的函数
async function prepareTargetCollection(targetCollection) {
    try {
        console.log(`🔧 准备目标集合: ${targetCollection}`);
        
        try {
            await axios.delete(`${QDRANT_URL}/collections/${targetCollection}`, {
                headers: { "api-key": QDRANT_API_KEY },
            });
            console.log(`🗑️ 已删除现有集合: ${targetCollection}`);
        } catch (err) {
            if (err.response?.status !== 404) {
                console.warn("⚠️ 删除集合时出现问题:", err.response?.data || err.message);
            }
        }
        
        await axios.put(`${QDRANT_URL}/collections/${targetCollection}`, {
            vectors: { size: 1536, distance: "Cosine" },
        }, {
            headers: { "api-key": QDRANT_API_KEY },
        });
        
        console.log(`✅ 已创建新集合: ${targetCollection}`);
        return targetCollection;
        
    } catch (err) {
        console.error("❌ 准备目标集合失败:", err.response?.data || err.message);
        throw err;
    }
}

// 上传数据函数
async function uploadDataToCollection(points, collectionName) {
    const batchSize = 50;
    const totalBatches = Math.ceil(points.length / batchSize);
    
    console.log(`⬆️ 开始批量上传 ${points.length} 条数据到 ${collectionName}（${totalBatches} 批次）...`);
    
    for (let i = 0; i < totalBatches; i++) {
        const start = i * batchSize;
        const end = Math.min(start + batchSize, points.length);
        const batch = points.slice(start, end);
        
        try {
            await axios.put(`${QDRANT_URL}/collections/${collectionName}/points?wait=true`, 
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
        console.log("🚀 开始全自动化零停机更新...");
        
        // 验证基本环境变量
        const requiredEnvs = ["QDRANT_URL", "QDRANT_API_KEY", "QDRANT_COLLECTION", "OPENAI_API_KEY"];
        const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
        if (missingEnvs.length > 0) {
            console.error("❌ 缺少必要的环境变量:", missingEnvs.join(", "));
            process.exit(1);
        }
        
        // 检查 Railway API 配置
        const hasRailwayApi = RAILWAY_API_TOKEN && RAILWAY_PROJECT_ID && RAILWAY_SERVICE_ID;
        if (hasRailwayApi) {
            console.log("✅ Railway API 配置完整，将自动切换环境变量");
        } else {
            console.log("⚠️ Railway API 配置不完整，需要手动切换");
            console.log("💡 如需全自动化，请设置: RAILWAY_API_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID");
        }
        
        // 1. 检查集合状态
        const { currentCollection, targetCollection } = await checkCollectionStatus();
        
        // 2. 准备目标集合
        await prepareTargetCollection(targetCollection);

        // 3. 准备和处理数据
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

                const cleanPayload = {
                    id: cleanText(item.id || ''),
                    title: cleanText(item.title || ''),
                    description: cleanText(item.description || ''),
                    city: cleanText(item.city || ''),
                    country: cleanText(item.country || ''),
                    type: item.type
                };

                // 根据类型添加特定字段（修改：添加 survival_guides 处理）
                switch (item.type) {
                    case 'routes':
                        if (item.travel_mode) cleanPayload.travel_mode = cleanText(item.travel_mode);
                        if (item.duration) cleanPayload.duration = cleanText(item.duration);
                        if (item.url) cleanPayload.url = cleanUrl(item.url);
                        if (item.google_maps_direct_url) cleanPayload.google_maps_direct_url = cleanUrl(item.google_maps_direct_url);
                        break;
                    case 'venues':
                        if (item.audience) cleanPayload.audience = Array.isArray(item.audience) ? item.audience.map(cleanText) : [];
                        if (item.highlights) cleanPayload.highlights = Array.isArray(item.highlights) ? item.highlights.map(cleanText) : [];
                        if (item.url) cleanPayload.url = cleanUrl(item.url);
                        if (item.google_maps_direct_url) cleanPayload.google_maps_direct_url = cleanUrl(item.google_maps_direct_url);
                        break;
                    case 'curations':
                        if (item.travel_type) cleanPayload.travel_type = cleanText(item.travel_type);
                        if (item.best_season) cleanPayload.best_season = cleanText(item.best_season);
                        if (item.url) cleanPayload.url = cleanUrl(item.url);
                        if (item.cover_image_url) cleanPayload.cover_image_url = cleanUrl(item.cover_image_url);
                        if (item.google_maps_direct_url) cleanPayload.google_maps_direct_url = cleanUrl(item.google_maps_direct_url);
                        break;
                    case 'group_ups':
                        if (item.note) cleanPayload.note = cleanText(item.note);
                        if (item.creator_full_name) cleanPayload.creator_full_name = cleanText(item.creator_full_name);
                        if (item.start_time) cleanPayload.start_time = item.start_time;
                        if (item.meeting_point) cleanPayload.meeting_point = cleanText(item.meeting_point);
                        if (item.url) cleanPayload.url = cleanUrl(item.url);
                        if (item.google_maps_direct_url) cleanPayload.google_maps_direct_url = cleanUrl(item.google_maps_direct_url);
                        break;
                    case 'survival_guides': // 新增 survival_guides 处理
                        if (item.cover_image_url) cleanPayload.cover_image_url = cleanUrl(item.cover_image_url);
                        if (item.related_video_url) cleanPayload.related_video_url = cleanUrl(item.related_video_url);
                        if (item.url) cleanPayload.url = cleanUrl(item.url);
                        if (item.google_maps_direct_url) cleanPayload.google_maps_direct_url = cleanUrl(item.google_maps_direct_url);
                        break;
                }

                // 通用 URL 字段处理（修改：添加 related_video_url）
                ['url', 'cover_image_url', 'video_url', 'related_video_url', 'google_maps_direct_url'].forEach(urlField => {
                    if (item[urlField] && !cleanPayload[urlField]) {
                        cleanPayload[urlField] = cleanUrl(item[urlField]);
                    }
                });

                points.push({ id: uniqueId, vector, payload: cleanPayload });
            } catch (error) {
                console.error(`❌ 处理第 ${i + 1} 条记录时出错:`, error.message);
                continue;
            }
        }

        if (points.length === 0) {
            console.error("❌ 没有有效的数据点可以上传");
            process.exit(1);
        }

        // 4. 上传数据
        await uploadDataToCollection(points, targetCollection);
        
        // 5. 自动切换环境变量（如果配置了 Railway API）
        if (hasRailwayApi) {
            const switchSuccess = await updateRailwayEnvironmentVariable(targetCollection);
            
            if (switchSuccess) {
                // 6. 等待服务重启并验证
                const verifySuccess = await waitForServiceRestart(targetCollection);
                
                if (verifySuccess) {
                    console.log("\n🎉 全自动化零停机更新完成！");
                    console.log("✅ 数据已更新，服务已切换，搜索功能正常");
                } else {
                    console.log("\n⚠️ 更新完成但验证超时");
                    console.log("💡 请手动检查服务状态");
                }
            }
        } else {
            console.log("\n🎉 数据更新完成！");
            console.log(`🔧 请手动将 Railway 环境变量 QDRANT_COLLECTION 改为: ${targetCollection}`);
            console.log("🔄 然后重启服务");
        }
        
        // 显示摘要
        console.log("\n📊 更新摘要:");
        console.log(`  - 处理记录: ${data.length}`);
        console.log(`  - 成功上传: ${points.length}`);
        console.log(`  - 当前生产集合: ${currentCollection} (${hasRailwayApi && '已自动切换' || '等待手动切换'})`);
        console.log(`  - 新数据集合: ${targetCollection}`);
        console.log(`  - 自动化程度: ${hasRailwayApi ? '全自动' : '半自动'}`);
        
    } catch (error) {
        console.error("💥 程序执行失败:", error.message);
        console.error("堆栈信息:", error.stack);
        process.exit(1);
    }
})();