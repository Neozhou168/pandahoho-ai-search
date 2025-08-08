import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// Qdrant Client
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY
});

// OpenAI Client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 带超时的 Promise 封装
function withTimeout(promise, ms, name = '操作') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${name} 超时 (${ms}ms)`)), ms)
    )
  ]);
}

// /search 接口
app.post('/search', async (req, res) => {
  const overallStart = Date.now();
  let embedTime = 0, searchTime = 0;

  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    console.log(`[Search] 收到查询: ${query}`);

    // Embedding 阶段
    console.log(`[Step] 开始生成 embedding`);
    const embedStart = Date.now();
    const embedding = await withTimeout(
      openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: query
      }),
      5000,
      'OpenAI Embedding'
    );
    embedTime = Date.now() - embedStart;
    console.log(`[Timing] Embedding 生成耗时: ${embedTime}ms`);

    // Qdrant 阶段
    console.log(`[Step] 开始 Qdrant 搜索`);
    const searchStart = Date.now();
    const searchResult = await withTimeout(
      qdrant.search(process.env.QDRANT_COLLECTION, {
        vector: embedding.data[0].embedding,
        limit: 5,
        with_payload: true
      }),
      5000,
      'Qdrant Search'
    );
    searchTime = Date.now() - searchStart;
    console.log(`[Timing] Qdrant 搜索耗时: ${searchTime}ms`);

    // 总耗时
    const totalTime = Date.now() - overallStart;
    console.log(`[Timing] 总耗时: ${totalTime}ms`);

    res.json({
      query,
      timing: { embeddingMs: embedTime, qdrantSearchMs: searchTime, totalMs: totalTime },
      results: searchResult.map(item => ({
        id: item.id,
        score: item.score,
        payload: item.payload
      }))
    });

  } catch (err) {
    const totalTime = Date.now() - overallStart;
    console.error(`[Error] ${err.message}`);
    console.log(`[Timing] Embedding: ${embedTime}ms, Qdrant: ${searchTime}ms, 总耗时: ${totalTime}ms`);
    res.status(500).json({ error: err.message });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`AI Search API 运行在 http://localhost:${PORT}`);
});
