// index.mjs
import express from 'express';
import { fetchBase44Data } from './fetchData.mjs';
import { embedTexts, getEmbedding } from './embed.mjs';
import { upsertToQdrant } from './qdrant.mjs';
import { searchAnswer } from './search.mjs';
import { randomUUID } from 'crypto'; // 生成合法 UUID

const app = express();
app.use(express.json());

const run = async () => {
  console.log('🚀 Starting Pandahoho AI Search sync...');

  // 1. 读取数据
  const allData = await fetchBase44Data();
  console.log(`📦 加载数据条数: ${allData.length}`);

  // 2. 准备用于 embedding 的文本（title + description）
  const texts = allData.map(item =>
    [item.title, item.description].filter(Boolean).join(' ')
  );

  // 3. 获取 embedding 向量
  const vectors = await embedTexts(texts);

  // 4. 构建 Qdrant 数据点
  const qdrantPoints = allData.map((item, i) => ({
    id: randomUUID(), // 使用 UUID 作为合法 ID
    vector: vectors[i],
    payload: {
      ...item,
      original_id: item.id // 保留原始 ID
    },
  })).filter(p => p.vector && p.vector.length > 0); // 排除无效向量

  // 5. 上传到 Qdrant
  await upsertToQdrant(qdrantPoints);
  console.log('✅ 成功同步到 Qdrant!');
};

// 启动服务并执行初始化同步
run().catch(err => {
  console.error('❌ 程序出错：', err.message);
});

// 6. AI Search 接口
app.post('/search', async (req, res) => {
  const { question } = req.body;

  try {
    const result = await searchAnswer(question);
    res.json(result);
  } catch (err) {
    console.error('❌ 搜索失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log('🌐 Server running on http://localhost:3000');
});
