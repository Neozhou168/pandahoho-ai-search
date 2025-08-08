import express from 'express';
import { fetchBase44Data } from './fetchData.mjs';
import { embedTexts } from './embed.mjs';
import { upsertToQdrant, searchAnswer } from './qdrant.mjs';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

// ====== 1. 启动时同步数据到 Qdrant ======
const run = async () => {
  console.log('🚀 Starting Pandahoho AI Search sync...');

  // 1. 获取数据
  const allData = await fetchBase44Data();
  console.log(`📦 加载数据条数: ${allData.length}`);

  // 2. 准备 embedding 的文本（title + description）
  const texts = allData.map(item =>
    [item.title, item.description].filter(Boolean).join(' ')
  );

  // 3. 获取 embedding 向量
  const vectors = await embedTexts(texts);

  // 4. 构建 Qdrant points 并上传
  const qdrantPoints = allData.map((item, i) => ({
    id: randomUUID(),
    vector: vectors[i],
    payload: {
      ...item
    }
  }));

  await upsertToQdrant(qdrantPoints);
  console.log('✅ 数据已同步到 Qdrant');
};

// ====== 2. 提供 Web API 搜索端点 ======
app.post('/search', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Missing query' });
    }

    console.log(`🔍 Received search query: "${query}"`);
    const results = await searchAnswer(query);

    res.json({
      query,
      results
    });
  } catch (error) {
    console.error('❌ Search error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ====== 3. 启动服务器 ======
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  console.log(`🌐 Server running on port ${PORT}`);
  await run();
});