import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * 将一段文字 embedding
 */
export async function getEmbedding(text) {
  const response = await axios.post(
    "https://api.openai.com/v1/embeddings",
    {
      input: text,
      model: "text-embedding-3-small",
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  return response.data.data[0].embedding;
}

/**
 * 将多个文本 embedding（用于初始化）
 */
export async function embedTexts(texts) {
  const response = await axios.post(
    "https://api.openai.com/v1/embeddings",
    {
      input: texts,
      model: "text-embedding-3-small",
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  return response.data.data.map((item) => item.embedding);
}
