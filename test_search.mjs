const API_URL = "https://pandahoho-ai-search-production.up.railway.app/search";

// 超时封装
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 15000 } = options; // 默认 15 秒
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}

async function testSearch() {
  const query = { query: "北京有什么好吃的" };
  const start = Date.now();

  try {
    const res = await fetchWithTimeout(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
      timeout: 15000 // 15 秒
    });

    const data = await res.json();
    const elapsed = Date.now() - start;

    console.log("✅ API 返回结果: ", JSON.stringify(data, null, 2));
    console.log(`⏱ 耗时: ${elapsed}ms`);
  } catch (err) {
    console.error("❌ 请求失败: ", err.message);
  }
}

testSearch();
