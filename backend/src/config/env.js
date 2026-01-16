import dotenv from "dotenv";

dotenv.config();

const numberFromEnv = (key, defaultValue) => {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const n = Number(raw);
  return Number.isNaN(n) ? defaultValue : n;
};

export const config = {
  port: numberFromEnv("PORT", 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  openaiTemperature: Number(process.env.OPENAI_TEMPERATURE || "0.1"),
  ragTopK: numberFromEnv("RAG_TOP_K", 4),
  ragMaxContextChars: numberFromEnv("RAG_MAX_CONTEXT_CHARS", 8000),

  // MySQL configuration
  dbHost: process.env.DB_HOST || "localhost",
  dbPort: numberFromEnv("DB_PORT", 3306),
  dbUser: process.env.DB_USER || "root",
  dbPassword: process.env.DB_PASSWORD || "",
  dbName: process.env.DB_NAME || "cs_management",
  dbTableName: process.env.DB_TABLE_NAME || "knowledge_base"
};

if (!config.openaiApiKey) {
  // Fail fast in production; warn in dev
  const msg = "OPENAI_API_KEY is not set in environment variables.";
  if (config.nodeEnv === "production") {
    throw new Error(msg);
  } else {
    console.warn(msg);
  }
}

