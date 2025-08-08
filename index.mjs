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
  console.log('---- 新请求 ----');
  console.log('收到请求 body:', req.body);

  try {
    const query = req.body?.query;
    if (!query) {
      console.warn('缺少 query 参数');
      return res.status(400).json({ error: '缺少 query 参数' });
    }

    // 1. Embedding
    console.log('[1] 开始生成向量...');
    const embedStart = Date.now();
    const queryVector = await embedText(query);
    const embedTime = Date.now() - embedStart;
    console.log(`[1] 向量生成完成: ${embedTime}ms`);

    // 2. Qdrant 搜索
    console.log('[2] 开始 Qdrant 搜索...');
    const searchStart = Date.now();
    const searchResult = await qdrant.search(process.env.QDRANT_COLLECTION, {
      vector: queryVector,
      limit: 5,
      with_payload: true
    });
    const searchTime = Date.now() - searchStart;
    console.log(`[2] Qdrant 搜索完成: ${searchTime}ms`);

    // 3. 返回
    const totalTime = Date.now() - overallStart;
    console.log(`[完成] 总耗时: ${totalTime}ms`);

    res.json({
      query,
      timing: { embedTime, searchTime, totalTime },
      results: searchResult.map(item => ({
        id: item.id,
        score: item.score,
        payload: item.payload
      }))
    });

  } catch (err) {
    const totalTime = Date.now() - overallStart;
    console.error(`[Error] 异常: ${err.message}, 总耗时: ${totalTime}ms`);
    res.status(500).json({ error: err.message });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`AI Search API 运行在 http://localhost:${PORT}`);
});
