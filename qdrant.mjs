// qdrant.mjs
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION;

if (!QDRANT_URL || !QDRANT_API_KEY || !QDRANT_COLLECTION) {
  throw new Error('❌ Missing Qdrant environment variables');
}

/**
 * 将向量数据上传到 Qdrant
 * @param {Array} points - 每个点应包含 id, vector, payload
 */
export async function upsertToQdrant(points) {
  const url = `${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points?wait=true`;

  const payload = {
    points: points.map((p) => ({
      id: p.id,
      vector: p.vector,
      payload: {
        ...p.payload,
        ...(p.original_id ? { original_id: p.original_id } : {}), // 添加原始ID以供追踪
      },
    })),
  };

  const headers = {
    'Content-Type': 'application/json',
    'api-key': QDRANT_API_KEY,
  };

  try {
    const response = await axios.put(url, payload, { headers });
    console.log('✅ Qdrant response:', response.data);
  } catch (err) {
    console.error('❌ Qdrant upload failed:', err.response?.data || err.message);
  }
}

/**
 * 搜索最相近的向量数据
 * @param {Array<number>} vector - 查询用的向量
 * @param {number} topK - 返回前 K 个结果
 * @returns {Promise<Array>} - 匹配结果数组
 */
export async function searchQdrant(vector, topK = 5) {
  const url = `${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points/search`;

  const body = {
    vector,
    top: topK,
    with_payload: true,
  };

  const headers = {
    'Content-Type': 'application/json',
    'api-key': QDRANT_API_KEY,
  };

  try {
    const response = await axios.post(url, body, { headers });
    return response.data.result || [];
  } catch (err) {
    console.error('❌ Qdrant search failed:', err.response?.data || err.message);
    return [];
  }
}