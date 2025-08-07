import express from 'express';
import fetchBase44Data from './fetchData.mjs';
import { embedTexts, getEmbedding } from './embed.mjs';
import { upsertToQdrant } from './qdrant.mjs';
import searchAnswer from './search.mjs';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

const run = async () => {
  console.log('⚙️ Starting Pandahoho AI Search sync...');

  // 1. 读取数据
  const allData = await fetchBase44Data();
  console.log(`📦 加载数据条数: ${allData.length}`);

  // 2. 准备用于 embedding 的文本 (title + description)
  const texts = allData.map(item =>
    [item.title, item.description].filter(Boolean).join(' ')
  );

  // 3. 获取 embedding 向量
  const vectors = await embedTexts(texts);

  // 4. 构建 Qdrant 数据点
  const qdrantPoints = allData.map((item, i) => ({
    id: randomUUID(), // 使用 UUID 作为向量 ID
    vector: vectors[i],
    payload: {
      ...item,
      original_id: item.id // 保留原始 ID
    }
  })).filter(p => p.vector && p.vector.length > 0); // 排除无效向量

  // 5. 上传到 Qdrant
  await upsertToQdrant(qdrantPoints);
  console.log('✅ 成功同步到 Qdrant!');
};

// === 新增：监听 POST 请求 ===
app.post('/', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Missing query in request body' });
  }

  try {
    console.log('📨 Received query from Discord:', query);
    const result = await searchAnswer(query);
    return res.json({ response: result });
  } catch (error) {
    console.error('❌ Error in / route:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 启动服务并执行初始化任务
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  await run(); // 启动后立即执行同步
});
