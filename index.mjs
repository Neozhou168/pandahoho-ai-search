import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import { embedTexts } from './embed.mjs';

dotenv.config();

// 全局错误捕获
process.on('uncaughtException', (err) => {
  console.error('🔥 未捕获的异常:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 未处理的 Promise 拒绝:', reason);
});

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

app.post('/search', async (req, res) => {
  const startTime = Date.now();
  console.log('📥 收到 /search 请求');

  try {
    console.log('📝 请求 body:', req.body);
    const query = req.body.query;
    if (!query) {
      console.warn('⚠️ 缺少 query 参数');
      return res.status(400).json({ error: 'Missing query' });
    }

    console.log('🔍 Step 1: 生成 query embedding...');
    const queryEmbedding = await embedTexts([query]);
    console.log('✅ Step 1 完成:', queryEmbedding.length, '个向量');

    console.log('🔍 Step 2: 调用 Qdrant 搜索...');
    const searchResult = await qdrant.search(process.env.QDRANT_COLLECTION, {
      vector: queryEmbedding[0],
      limit: 5
    });
    console.log('✅ Step 2 完成: 找到', searchResult.length, '条结果');

    const elapsed = Date.now() - startTime;
    console.log(`⏱ 总耗时: ${elapsed}ms`);

    return res.json({
      status: 'ok',
      elapsed_ms: elapsed,
      results: searchResult
    });

  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ 处理失败 (${elapsed}ms):`, err);
    return res.status(500).json({
      status: 'error',
      message: err.message,
      elapsed_ms: elapsed
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 AI Search API 运行在 http://localhost:${PORT}`);
});
