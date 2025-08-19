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

// 请求日志中间件
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url} from origin: ${req.get('origin')}`);
  next();
});

// ==== CORS 配置 ====
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Check if origin ends with allowed domains
    const allowedDomains = [
      'pandahoho.com', 
      'base44.com', 
      'base44.app',
      'panda-hoho-production.up.railway.app'
    ];
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

const PORT = process.env.PORT || 3000;

// 验证必要的环境变量
console.log("🔍 Checking environment variables...");
const requiredEnvVars = ['QDRANT_URL', 'QDRANT_API_KEY', 'QDRANT_COLLECTION', 'OPENAI_API_KEY'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error("❌ Missing required environment variables:", missingEnvVars);
  process.exit(1);
}

console.log("✅ All required environment variables found");

// 初始化 Qdrant
console.log("🔌 Connecting to Qdrant:", process.env.QDRANT_URL);
console.log("📦 Collection:", process.env.QDRANT_COLLECTION);

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY
});

// 初始化 OpenAI
console.log("🤖 Connecting to OpenAI...");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 测试Qdrant连接
async function testQdrantConnection() {
  try {
    console.log("🧪 Testing Qdrant connection...");
    
    // 测试基本连接
    const collections = await qdrant.getCollections();
    console.log("✅ Qdrant connection successful");
    
    // 检查目标集合是否存在
    const targetCollection = process.env.QDRANT_COLLECTION;
    const collectionExists = collections.collections.some(
      col => col.name === targetCollection
    );
    
    if (collectionExists) {
      console.log(`✅ Collection '${targetCollection}' exists`);
      
      // 获取集合详细信息
      try {
        const collectionInfo = await qdrant.getCollection(targetCollection);
        console.log(`📊 Collection info:`, {
          name: collectionInfo.name,
          status: collectionInfo.status,
          points_count: collectionInfo.points_count || 'unknown',
          vectors_count: collectionInfo.vectors_count || 'unknown'
        });
        return true;
      } catch (infoError) {
        console.warn("⚠️ Could not get collection details:", infoError.message);
        return true; // 集合存在但无法获取详情，仍然可以继续
      }
    } else {
      console.error(`❌ Collection '${targetCollection}' not found`);
      console.log("Available collections:", collections.collections.map(c => c.name));
      return false;
    }
  } catch (error) {
    console.error("❌ Qdrant connection test failed:", error.message);
    console.error("Error details:", error);
    return false;
  }
}

// 健康检查路由
app.get('/', async (req, res) => {
  const healthStatus = {
    status: 'ok',
    message: 'Pandahoho AI Search API running',
    timestamp: new Date().toISOString(),
    environment: {
      hasQdrantUrl: !!process.env.QDRANT_URL,
      hasQdrantApiKey: !!process.env.QDRANT_API_KEY,
      hasQdrantCollection: !!process.env.QDRANT_COLLECTION,
      hasOpenaiApiKey: !!process.env.OPENAI_API_KEY,
      collection: process.env.QDRANT_COLLECTION
    }
  };
  
  console.log("🩺 Health check requested");
  res.json(healthStatus);
});

// 搜索 API
app.post('/search', async (req, res) => {
  const startTime = Date.now();
  console.log("🚀 [1] 收到 /search 请求, body =", req.body);

  try {
    const { query } = req.body;
    if (!query) {
      console.error("❌ [2] 缺少 query 参数");
      return res.status(400).json({ 
        status: 'error',
        message: 'Missing query parameter',
        elapsed_ms: Date.now() - startTime
      });
    }
    console.log(`✅ [2] query 参数 = ${query}`);

    // Step 1: 生成 query embedding
    console.log("🛠 [3] 开始生成 query embedding...");
    let queryEmbedding;
    try {
      queryEmbedding = await getEmbedding(query);
      console.log(`✅ [3] query embedding 完成, 向量长度 = ${queryEmbedding.length}`);
    } catch (embeddingError) {
      console.error("❌ [3] Embedding生成失败:", embeddingError.message);
      return res.status(500).json({
        status: 'error',
        message: `Embedding generation failed: ${embeddingError.message}`,
        elapsed_ms: Date.now() - startTime
      });
    }

    // Step 2: Qdrant 搜索
    console.log("🌐 [4] 正在连接 Qdrant 并发送搜索请求...");
    
    let searchResult;
    try {
      searchResult = await qdrant.search(
        process.env.QDRANT_COLLECTION,
        {
          vector: queryEmbedding,
          limit: 10,
          with_payload: true,
          with_vector: false
        }
      );
      console.log(`✅ [4] Qdrant 返回原始结果数量 = ${searchResult.length}`);
    } catch (qdrantError) {
      console.error("❌ [4] Qdrant搜索失败:", qdrantError.message);
      return res.status(500).json({
        status: 'error',
        message: `Qdrant search failed: ${qdrantError.message}`,
        elapsed_ms: Date.now() - startTime
      });
    }

    // Step 3: 过滤推广信息
    const filteredResults = searchResult.filter(result => {
      const payload = result.payload || {};
      const description = payload.description || '';
      
      // 过滤掉包含推广文案的结果
      const isPromotion = description.includes('Your guide to the great outdoors');
      
      if (isPromotion) {
        console.log(`🚫 过滤掉推广信息: ${payload.title}`);
      }
      
      return !isPromotion;
    }).slice(0, 5); // 过滤后取前5个结果

    console.log(`✅ [4.5] 过滤后结果数量 = ${filteredResults.length}`);

    // Step 4: 返回结果
    const elapsed = Date.now() - startTime;
    console.log(`⏱ [5] 搜索完成，总耗时 ${elapsed}ms`);
    
    res.json({
      status: 'ok',
      elapsed_ms: elapsed,
      results: filteredResults,
      query: query
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
      error_type: err.name || 'UnknownError'
    });
  }
});

// 启动服务器
app.listen(PORT, async () => {
  console.log(`🚀 AI Search API running at http://localhost:${PORT}`);
  
  // 启动时测试Qdrant连接
  const qdrantReady = await testQdrantConnection();
  
  if (qdrantReady) {
    console.log("✅ All systems ready! Search service is operational.");
  } else {
    console.log("⚠️ Qdrant connection issues detected - searches may fail");
    console.log("💡 Please check your QDRANT_URL, QDRANT_API_KEY, and QDRANT_COLLECTION environment variables");
  }
  
  console.log("🔗 Health check available at: /");
  console.log("🔍 Search endpoint available at: POST /search");
});