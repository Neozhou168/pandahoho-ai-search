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

// 改进的集合检查函数 - 支持别名和直接集合
async function checkCollectionAvailability(collectionName) {
  try {
    console.log(`🔍 检查集合可用性: ${collectionName}`);
    
    // 1. 尝试直接访问集合
    try {
      const collectionInfo = await qdrant.getCollection(collectionName);
      console.log(`✅ 直接集合访问成功: ${collectionName}`);
      return {
        available: true,
        type: 'direct',
        name: collectionName,
        info: collectionInfo
      };
    } catch (directError) {
      if (!directError.message.includes('404') && !directError.message.includes('Not found')) {
        throw directError; // 非404错误，重新抛出
      }
      console.log(`ℹ️ 直接集合不存在，检查别名...`);
    }
    
    // 2. 检查是否存在作为别名，通过搜索测试
    try {
      await qdrant.search(collectionName, {
        vector: new Array(1536).fill(0), // 创建零向量进行测试
        limit: 1,
        with_payload: false,
        with_vector: false
      });
      
      console.log(`✅ 别名访问成功: ${collectionName}`);
      return {
        available: true,
        type: 'alias',
        name: collectionName,
        info: null
      };
    } catch (aliasError) {
      console.log(`❌ 别名访问也失败: ${aliasError.message}`);
    }
    
    // 3. 列出可用的集合供调试
    try {
      const collections = await qdrant.getCollections();
      console.log("🔍 可用的集合:");
      collections.collections.forEach(col => {
        console.log(`  - ${col.name} (状态: ${col.status})`);
      });
      
      // 检查是否有相似名称的集合
      const similarCollections = collections.collections.filter(col => 
        col.name.includes(collectionName.split('_')[0]) || 
        col.name.includes('pandahoho')
      );
      
      if (similarCollections.length > 0) {
        console.log("🔍 可能相关的集合:");
        similarCollections.forEach(col => {
          console.log(`  - ${col.name}`);
        });
      }
    } catch (listError) {
      console.warn("⚠️ 无法列出集合:", listError.message);
    }
    
    return {
      available: false,
      type: 'none',
      name: collectionName,
      info: null
    };
    
  } catch (error) {
    console.error("❌ 检查集合时出错:", error.message);
    return {
      available: false,
      type: 'error',
      name: collectionName,
      error: error.message
    };
  }
}

// 测试Qdrant连接的改进版本
async function testQdrantConnection() {
  try {
    console.log("🧪 Testing Qdrant connection...");
    
    // 测试基本连接
    const collections = await qdrant.getCollections();
    console.log("✅ Qdrant connection successful");
    
    // 检查目标集合/别名的可用性
    const targetCollection = process.env.QDRANT_COLLECTION;
    const collectionStatus = await checkCollectionAvailability(targetCollection);
    
    if (collectionStatus.available) {
      console.log(`✅ Collection '${targetCollection}' 可用 (类型: ${collectionStatus.type})`);
      
      if (collectionStatus.type === 'direct' && collectionStatus.info) {
        console.log(`📊 Collection info:`, {
          name: collectionStatus.info.name,
          status: collectionStatus.info.status,
          points_count: collectionStatus.info.points_count || 'unknown',
          vectors_count: collectionStatus.info.vectors_count || 'unknown'
        });
      } else if (collectionStatus.type === 'alias') {
        console.log(`🏷️ 使用别名模式，支持零停机更新`);
      }
      
      return true;
    } else {
      console.error(`❌ Collection '${targetCollection}' 不可用 (类型: ${collectionStatus.type})`);
      if (collectionStatus.error) {
        console.error("错误详情:", collectionStatus.error);
      }
      
      console.log("💡 建议操作:");
      console.log("1. 运行 zero_downtime_setup.mjs 设置别名机制");
      console.log("2. 或运行 improved_upload_json.mjs 重新创建集合");
      console.log("3. 检查环境变量 QDRANT_COLLECTION 的值");
      
      return false;
    }
  } catch (error) {
    console.error("❌ Qdrant connection test failed:", error.message);
    console.error("Error details:", error);
    return false;
  }
}

// 健康检查路由 - 增加更多诊断信息
app.get('/', async (req, res) => {
  const startTime = Date.now();
  
  // 检查集合状态
  let collectionStatus = null;
  try {
    collectionStatus = await checkCollectionAvailability(process.env.QDRANT_COLLECTION);
  } catch (err) {
    console.error("健康检查时集合检查失败:", err.message);
  }
  
  const healthStatus = {
    status: collectionStatus?.available ? 'ok' : 'warning',
    message: 'Pandahoho AI Search API running',
    timestamp: new Date().toISOString(),
    elapsed_ms: Date.now() - startTime,
    environment: {
      hasQdrantUrl: !!process.env.QDRANT_URL,
      hasQdrantApiKey: !!process.env.QDRANT_API_KEY,
      hasQdrantCollection: !!process.env.QDRANT_COLLECTION,
      hasOpenaiApiKey: !!process.env.OPENAI_API_KEY,
      collection: process.env.QDRANT_COLLECTION
    },
    collection_status: collectionStatus
  };
  
  console.log("🩺 Health check requested");
  
  // 根据集合状态设置响应码
  const statusCode = collectionStatus?.available ? 200 : 503;
  res.status(statusCode).json(healthStatus);
});

// 搜索 API - 增加更好的错误处理
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

    // Step 2: Qdrant 搜索 - 增加更详细的错误处理
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
      
      // 提供更具体的错误信息
      let errorMessage = `Qdrant search failed: ${qdrantError.message}`;
      if (qdrantError.message.includes('404') || qdrantError.message.includes('Not found')) {
        errorMessage += `. Collection '${process.env.QDRANT_COLLECTION}' may not exist or be accessible.`;
      }
      
      return res.status(500).json({
        status: 'error',
        message: errorMessage,
        elapsed_ms: Date.now() - startTime,
        suggestion: "Try running zero_downtime_setup.mjs or check your collection configuration"
      });
    }

    // Step 3: 过滤推广信息 - 增加更多过滤规则
    const filteredResults = searchResult.filter(result => {
      const payload = result.payload || {};
      const description = payload.description || '';
      const title = payload.title || '';
      
      // 过滤掉包含推广文案的结果
      const promotionKeywords = [
        'Your guide to the great outdoors',
        'advertisement',
        'sponsored',
        'promotional'
      ];
      
      const isPromotion = promotionKeywords.some(keyword => 
        description.toLowerCase().includes(keyword.toLowerCase()) ||
        title.toLowerCase().includes(keyword.toLowerCase())
      );
      
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
      query: query,
      total_found: searchResult.length,
      filtered_count: filteredResults.length
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

// 新增：集合状态检查端点
app.get('/collection-status', async (req, res) => {
  try {
    const collectionStatus = await checkCollectionAvailability(process.env.QDRANT_COLLECTION);
    res.json({
      status: 'ok',
      collection_name: process.env.QDRANT_COLLECTION,
      collection_status: collectionStatus,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
      collection_name: process.env.QDRANT_COLLECTION,
      timestamp: new Date().toISOString()
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
    console.log("🔧 Run 'node zero_downtime_setup.mjs' to set up zero-downtime updates");
  }
  
  console.log("🔗 Health check available at: /");
  console.log("🔍 Search endpoint available at: POST /search");
  console.log("📊 Collection status available at: GET /collection-status");
});