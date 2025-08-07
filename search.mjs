// search.mjs
import { getEmbedding } from './embed.mjs';
import { searchQdrant } from './qdrant.mjs';

export async function searchAnswer(question) {
  if (!question || question.trim() === '') {
    throw new Error('问题不能为空');
  }

  // 1. 获取向量
  const vector = await getEmbedding(question);

  // 2. 向 Qdrant 搜索
  const results = await searchQdrant(vector, 5); // top 5 结果

  // 3. 整理格式返回
  return results.map((res) => ({
    score: res.score.toFixed(3),
    title: res.payload.title,
    type: res.payload.type,
    description: res.payload.description,
    url: res.payload.url || '', // 可选字段
  }));
}
