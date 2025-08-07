import { getEmbedding } from './embed.mjs';
import { searchQdrant } from './qdrant.mjs';

export async function searchAnswer(question) {
  if (!question || question.trim() === '') {
    throw new Error('问题不能为空');
  }

  // 1. 获取向量
  const vector = await getEmbedding(question);

  // 2. Qdrant 搜索 top 5
  const results = await searchQdrant(vector, 5);

  // 3. 空结果处理
  if (!results || results.length === 0) {
    return [{
      score: 0,
      title: '未找到相关内容',
      type: '',
      description: '请尝试换个问题或关键词。',
      url: ''
    }];
  }

  // 4. 格式化输出
  return results.map(res => ({
    score: res.score.toFixed(3),
    title: res.payload.title,
    type: res.payload.type,
    description: res.payload.description,
    url: res.payload.url || '',
  }));
}