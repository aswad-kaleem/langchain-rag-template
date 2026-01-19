import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config/env.js";
import { initializeRag } from "./rag/ragChain.js";
import { registerChatRoutes } from "./routes/chat.js";

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug"
    }
  });

  await fastify.register(cors, {
    origin: ["http://localhost:5173"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  });

  await registerChatRoutes(fastify);

  return fastify;
}

async function main() {
  try {
    console.log("Initializing RAG components...");
    await initializeRag();
    console.log("RAG initialization complete.");

    const fastify = await buildServer();
    await fastify.listen({ port: config.port, host: "0.0.0.0" });
    console.log(`Server listening on port ${config.port}`);
  } catch (err) {
    console.error("Fatal error during startup:", err);
    process.exit(1);
  }
}

// Top-level await is supported in Node.js ES modules (LTS).
main();

