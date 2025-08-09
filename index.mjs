import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import { embedTexts, getEmbedding } from './embed.mjs';

// 全局异常捕获
process.on('uncaughtException', (err) => {
  console.error("💥 Uncaught Exception:", err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error("💥 Unhandled Rejection:", reason);
});

dotenv.config();

console.log("🚀 Server starting, loading modules...");

// 初始化 express 应用
const app = express();
app.use(express.json());

// Add this middleware before your CORS middleware
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url} from origin: ${req.get('origin')}`);
  next();
});

// ==== CORS 配置：允许 pandahoho.com 和 base44.com 的所有子域名 ====
const allowedOrigins = [
  /https?:\/\/.*\.pandahoho\.com$/,
  /https?:\/\/.*\.base44\.com$/,
  /https?:\/\/pandahoho\.com$/,
  /https?:\/\/base44\.com$/
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Check if origin ends with allowed domains
    const allowedDomains = ['pandahoho.com', 'base44.com', 'base44.app'];
    const isAllowed = allowedDomains.some(domain => 
      origin.endsWith(domain) || origin.endsWith(`.${domain}`)
    );
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.log(`CORS blocked origin: ${origin}`);
      callback(new Error(`CORS policy violation: ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 健康检查路由
app.get('/', (req, res) => {
  res.send({ status: 'ok', message: 'Pandahoho AI Search API running' });
});

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
  console.log("🚀 [1] 收到 /search 请求, body =", req.body);

  try {
    const { query } = req.body;
    if (!query) {
      console.error("❌ [2] 缺少 query 参数");
      return res.status(400).json({ error: 'Missing query' });
    }
    console.log(`✅ [2] query 参数 = ${query}`);

    // Step 1: Embed query
    console.log("🛠 [3] 开始生成 query embedding...");
    const queryEmbedding = await getEmbedding(query);
    console.log(`✅ [3] query embedding 完成, 向量长度 = ${queryEmbedding.length}`);

    // Step 2: Qdrant 搜索
    console.log("🌐 [4] 正在连接 Qdrant 并发送搜索请求...");
    console.log("🔑 Qdrant URL:", process.env.QDRANT_URL);
    console.log("📦 Collection:", process.env.QDRANT_COLLECTION);

    const searchResult = await qdrant.search(
      process.env.QDRANT_COLLECTION,
      {
        vector: queryEmbedding,
        limit: 5,
      }
    );

    console.log(`✅ [4] Qdrant 返回结果数量 = ${searchResult.length}`);

    // Step 3: 返回结果
    const elapsed = Date.now() - startTime;
    console.log(`⏱ [5] 搜索完成，总耗时 ${elapsed}ms`);
    res.json({
      status: 'ok',
      elapsed_ms: elapsed,
      results: searchResult,
    });

  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error("❌ [Error] /search 出错:");
    console.error("错误信息:", err.message);
    console.error("错误堆栈:", err.stack);
    res.status(500).json({
      status: 'error',
      elapsed_ms: elapsed,
      message: err.message,
      stack: err.stack,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 AI Search API running at http://localhost:${PORT}`);
});
