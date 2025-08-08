import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import { embedTexts } from './embed.mjs'; // 修正 import

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

// 带超时的 Promise
function withTimeout(promise, ms, name = '操作') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${name} 超时 (${ms} ms)`)), ms)
    )
  ]);
}

// 搜索接口
app.post('/search', async (req, res) => {
  const startTime = Date.now();
  const { query } = req.body;

  console.log(`📥 收到搜索请求: ${query}`);

  try {
    // 生成 embedding
    const [vector] = await withTimeout(embedTexts([query]), 10000, '生成向量');

    // Qdrant 搜索
    const searchResult = await withTimeout(
      qdrant.search(process.env.QDRANT_COLLECTION, {
        vector,
        limit: 5
      }),
      10000,
      'Qdrant 搜索'
    );

    const elapsed = Date.now() - startTime;
    console.log(`✅ 搜索完成，耗时 ${elapsed} ms`);

    res.json({
      status: 'ok',
      query,
      results: searchResult,
      elapsed_ms: elapsed
    });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ 搜索失败 (${elapsed} ms):`, err.message);
    res.status(500).json({
      status: 'error',
      code: 500,
      message: err.message,
      elapsed_ms: elapsed
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 AI Search API 运行在 http://localhost:${PORT}`);
});