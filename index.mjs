// index.mjs
import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';

dotenv.config();

const app = express();
app.use(bodyParser.json());

// 防止 Railway 502，延长超时
app.use((req, res, next) => {
  res.setTimeout(30000);
  next();
});

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

// 生成 embedding
async function embedText(text) {
  const start = Date.now();
  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  const end = Date.now();
  return {
    vector: embedding.data[0].embedding,
    timeMs: end - start
  };
}

// /search API
app.post('/search', async (req, res) => {
  const overallStart = Date.now();
  let embedTime = 0;
  let searchTime = 0;

  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Missing query' });
    }

    console.log(`[Search] 收到查询: ${query}`);

    // 1. 生成 embedding
    const embedStart = Date.now();
    const { vector, timeMs } = await embedText(query);
    embedTime = timeMs || (Date.now() - embedStart);
    console.log(`[Timing] Embedding 生成耗时: ${embedTime}ms`);

    // 2. Qdrant 搜索
    const searchStart = Date.now();
    const searchResult = await qdrant.search(process.env.QDRANT_COLLECTION, {
      vector,
      limit: 5,
      with_payload: true
    });
    searchTime = Date.now() - searchStart;
    console.log(`[Timing] Qdrant 搜索耗时: ${searchTime}ms`);

    // 总耗时
    const totalTime = Date.now() - overallStart;
    console.log(`[Timing] 总耗时: ${totalTime}ms`);

    // 3. 返回结果
    res.json({
      query,
      timing: {
        embeddingMs: embedTime,
        qdrantSearchMs: searchTime,
        totalMs: totalTime
      },
      results: searchResult.map(item => ({
        id: item.id,
        score: item.score,
        payload: item.payload
      }))
    });

  } catch (err) {
    const totalTime = Date.now() - overallStart;
    console.error('[Error] 搜索出错:', err.message);
    console.log(`[Timing] Embedding: ${embedTime}ms, Qdrant: ${searchTime}ms, 总耗时: ${totalTime}ms`);
    res.status(500).json({ error: err.message });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`AI Search API 运行在 http://localhost:${PORT}`);
});
