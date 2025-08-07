// fetchData.mjs
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function fetchBase44Data() {
  const dataDir = path.join(__dirname, 'data');

  // 1. 找到最新的 JSON 文件
  const files = await fs.readdir(dataDir);
  const jsonFiles = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      name: f,
      time: fs.stat(path.join(dataDir, f)).then(stat => stat.mtime)
    }));

  const resolvedFiles = await Promise.all(jsonFiles.map(async (f) => ({
    ...f,
    time: await f.time
  })));

  resolvedFiles.sort((a, b) => b.time - a.time);
  const latestFile = resolvedFiles[0];

  if (!latestFile) throw new Error('❌ 没有找到 JSON 文件');

  const filePath = path.join(dataDir, latestFile.name);
  console.log(`📂 正在使用最新数据文件: ${latestFile.name}`);

  const raw = await fs.readFile(filePath, 'utf-8');
  const json = JSON.parse(raw);

  // 2. 添加 type 和 id
  const withType = (items, type) => (items || []).map((item, i) => ({
    ...item,
    type,
    id: item.id || `${type}_${i}`
  }));

  const routes = withType(json.routes, 'route');
  const venues = withType(json.venues, 'venue');
  const curations = withType(json.curations, 'curation');
  const groupUps = withType(json.groupUps, 'group-up');

  return [...routes, ...venues, ...curations, ...groupUps];
}
