// test_search.mjs
import fetch from "node-fetch";

const API_URL = "https://pandahoho-ai-search-production.up.railway.app/search";

async function testSearch() {
  const query = "北京有什么好吃的";

  try {
    const start = Date.now();
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });

    const data = await res.json();
    const elapsed = Date.now() - start;

    console.log("✅ API 返回结果：", JSON.stringify(data, null, 2));
    console.log(`⏱ 耗时: ${elapsed}ms`);
  } catch (err) {
    console.error("❌ 请求失败：", err.message);
  }
}

testSearch();
