// index.mjs
import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// Qdrant client
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

// OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// 生成向量
async function embedText(text) {
    const embedding = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text
    });
    return embedding.data[0].embedding;
}

// /search API
app.post('/search', async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;
    if (!query) {
      return res.status(400).json({ error: '缺少 query 参数' });
    }

    // 1. 生成向量
    const queryVector = await embedText(query);

    // 2. Qdrant 搜索
    const searchResult = await qdrant.search(process.env.QDRANT_COLLECTION, {
      vector: queryVector,
      limit,                 // ✅ 限制返回条数
      with_payload: true,
      with_vector: false
    });

    // 3. 返回精简后的结果
    const results = searchResult
      .slice(0, limit)        // ✅ 再次截取，确保数量正确
      .map(item => ({
        id: item.id,
        score: item.score,
        title: item.payload.title || '',
        description: item.payload.description || '',
        url: item.payload.url || '',
        type: item.payload.type || '',
      }));

    res.json({
      query,
      count: results.length,
      results
    });

  } catch (err) {
    console.error('搜索出错:', err);
    res.status(500).json({ error: err.message });
  }
});

// 启动服务
app.listen(PORT, () => {
    console.log(`AI Search API 运行在 http://localhost:${PORT}`);
});
