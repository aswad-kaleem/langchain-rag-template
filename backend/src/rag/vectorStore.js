import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { loadFileDocuments } from "./loaders/fileLoader.js";
import { config } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..", "..");

const VECTOR_INDEX_DIR = resolve(__dirname, "data", "vector_index_faiss");

export async function initializeVectorStore() {
  const embeddings = new OpenAIEmbeddings({
    apiKey: config.openaiApiKey
  });

  // 1) Try to load an existing FAISS index from disk
  if (existsSync(VECTOR_INDEX_DIR)) {
    try {
      console.log(
        `Loading existing FAISS vector index from ${VECTOR_INDEX_DIR}...`
      );
      const vectorStore = await FaissStore.load(VECTOR_INDEX_DIR, embeddings);
      console.log("FAISS vector index loaded successfully.");
      return vectorStore;
    } catch (err) {
      console.warn(
        "Failed to load existing FAISS index, rebuilding from documents...",
        err.message || err
      );
    }
  }

  // 2) Fallback: build documents, chunks, and a new FAISS store, then persist it
  const fileDocs = await loadFileDocuments();
  const allDocs = [...fileDocs];

  console.log(`Loaded ${fileDocs.length} unstructured documents for RAG.`);

  if (!allDocs.length) {
    console.warn(
      "No documents loaded for RAG. Answers will rely on the LLM only."
    );
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200
  });

  const splitDocs = await splitter.splitDocuments(allDocs);
  console.log(`Split into ${splitDocs.length} chunks for embedding.`);

  const vectorStore = await FaissStore.fromDocuments(splitDocs, embeddings);

  try {
    if (!existsSync(VECTOR_INDEX_DIR)) {
      mkdirSync(VECTOR_INDEX_DIR, { recursive: true });
    }
    console.log(`Saving FAISS vector index to ${VECTOR_INDEX_DIR}...`);
    await vectorStore.save(VECTOR_INDEX_DIR);
    console.log("FAISS vector index saved successfully.");
  } catch (err) {
    console.warn(
      "Failed to persist FAISS index to disk. It will be rebuilt on next startup.",
      err.message || err
    );
  }

  return vectorStore;
}

