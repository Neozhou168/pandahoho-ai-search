import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import { embedTexts } from './embed.mjs';

// 全局异常捕获
process.on('uncaughtException', (err) => {
  console.error("💥 Uncaught Exception:", err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error("💥 Unhandled Rejection:", reason);
});

dotenv.config();

console.log("🚀 Server starting, loading modules...");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// 初始化 Qdrant
console.log("🔌 Connecting to Qdrant:", process.env.QDRANT_URL);
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY
});

// 初始化 OpenAI
console.log("🤖 Connecting to OpenAI...");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 超时工具
function withTimeout(promise, ms, name = '操作') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`⏱ ${name} 超时 ${ms}ms`)), ms))
  ]);
}

// 搜索 API
app.post('/search', async (req, res) => {
  const startTime = Date.now();
  console.log("📩 Received /search request:", req.body);

  try {
    const { query } = req.body;
    console.log("🔍 Query received:", query);

    // 生成 embedding
    console.log("🧠 Generating embedding...");
    const queryEmbedding = await withTimeout(embedTexts([query]), 15000, "生成 embedding");
    console.log("✅ Embedding generated");

    // 在 Qdrant 搜索
    console.log("📡 Searching Qdrant...");
    const searchResult = await withTimeout(
      qdrant.search("pandahoho_collection", {
        vector: queryEmbedding[0],
        limit: 5
      }),
      15000,
      "Qdrant 搜索"
    );
    console.log("✅ Qdrant search completed:", searchResult.length, "results");

    const elapsed = Date.now() - startTime;
    console.log(`🎯 Search completed in ${elapsed}ms`);
    res.json({ status: 'ok', elapsed_ms: elapsed, data: searchResult });

  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ Error in /search after ${elapsed}ms:`, err);
    res.status(500).json({
      status: 'error',
      code: 500,
      message: err.message,
      elapsed_ms: elapsed
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 AI Search API running at http://localhost:${PORT}`);
});
