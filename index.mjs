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
app.post("/search", async (req, res) => {
  const overallStart = Date.now();
  const TIMEOUT_MS = 5000; // 总超时时间 5 秒

  // 超时 Promise
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Search request timed out")), TIMEOUT_MS)
  );

  try {
    const searchPromise = (async () => {
      const { query } = req.body;
      if (!query) {
        return res.status(400).json({ error: "Missing 'query' field" });
      }

      // Step 1: 生成 embedding
      const embedStart = Date.now();
      const embedding = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: query,
      });
      const embedTime = Date.now() - embedStart;

      // Step 2: Qdrant 搜索
      const searchStart = Date.now();
      const searchResult = await qdrant.search(process.env.QDRANT_COLLECTION, {
        vector: embedding.data[0].embedding,
        limit: 5,
        with_payload: true,
        with_vector: false,
      });
      const searchTime = Date.now() - searchStart;

      const totalTime = Date.now() - overallStart;

      // Railway 日志
      console.log(`[Timing] Embedding: ${embedTime}ms, Qdrant: ${searchTime}ms, 总耗时: ${totalTime}ms`);

      return res.json({
        query,
        timing: {
          embeddingMS: embedTime,
          qdrantSearchMS: searchTime,
          totalMS: totalTime,
        },
        results: searchResult.map((item) => ({
          id: item.id,
          score: item.score,
          payload: item.payload,
        })),
      });
    })();

    // 等待 searchPromise 或 timeoutPromise 中先完成的
    await Promise.race([searchPromise, timeoutPromise]);

  } catch (err) {
    const totalTime = Date.now() - overallStart;
    console.error(`[Error] 搜索失败: ${err.message}, 总耗时: ${totalTime}ms`);
    res.status(500).json({ error: err.message, totalMS: totalTime });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`AI Search API 运行在 http://localhost:${PORT}`);
});
