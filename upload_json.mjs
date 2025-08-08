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

// 读取并合并 JSON 中的所有数组字段
function readAllArraysFromJson() {
    if (!fs.existsSync(DATA_FILE)) {
        console.error(`❌ 找不到文件: ${DATA_FILE}`);
        process.exit(1);
    }
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const jsonData = JSON.parse(raw);

    let combinedData = [];

    if (Array.isArray(jsonData)) {
        combinedData = jsonData.map(item => ({ ...item, type: "default" }));
    } else {
        Object.keys(jsonData).forEach(key => {
            if (Array.isArray(jsonData[key])) {
                console.log(`📂 检测到数组字段: ${key}（${jsonData[key].length} 条）`);
                combinedData = combinedData.concat(
                    jsonData[key].map(item => ({ ...item, type: key }))
                );
            }
        });
    }

    if (combinedData.length === 0) {
        console.error("❌ JSON 中未找到任何数组数据");
        process.exit(1);
    }

    return combinedData;
}

// 调用 OpenAI Embedding API
async function generateEmbedding(text) {
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
        }
    );
    return res.data.data[0].embedding;
}

// 删除已存在的 collection
async function deleteCollection() {
    try {
        await axios.delete(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}`, {
            headers: { "api-key": QDRANT_API_KEY },
        });
        console.log(`🗑️ 已删除 Collection "${QDRANT_COLLECTION}"`);
    } catch (err) {
        console.error("⚠️ 删除 Collection 失败:", err.response?.data || err.message);
    }
}

// 创建新的 collection
async function createCollection() {
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
}

// 上传数据到 Qdrant
async function uploadData(points) {
    console.log(`⬆️ 正在上传 ${points.length} 条数据到 Qdrant...`);
    await axios.put(
        `${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points?wait=true`,
        { points },
        { headers: { "api-key": QDRANT_API_KEY } }
    );
    console.log("🎉 数据上传完成");
}

// 主流程
(async () => {
    await deleteCollection();
    await createCollection();

    const data = readAllArraysFromJson();
    const points = [];

    console.log(`📦 总共 ${data.length} 条记录，开始生成向量...`);

    for (const [i, item] of data.entries()) {
        const textForEmbedding = `${item.title || ""} ${item.description || ""}`.trim();
        console.log(`📝 (${i + 1}/${data.length}) 生成向量中...`);
        const vector = await generateEmbedding(textForEmbedding || JSON.stringify(item));

        points.push({
            id: stringToUUID(item.id ? String(item.id) : `${i + 1}-${item.type}`),
            vector,
            payload: item,
        });
    }

    await uploadData(points);
})();
