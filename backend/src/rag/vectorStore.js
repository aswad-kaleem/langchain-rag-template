import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { loadFileDocuments } from "./loaders/fileLoader.js";
import { loadStructuredDocuments } from "./loaders/structuredLoader.js";
import { config } from "../config/env.js";

/**
 * Build documents, chunks, and FAISS vector store.
 * In a production system you would persist the index to disk or an
 * external vector DB like Pinecone instead of rebuilding on every boot.
 */
export async function initializeVectorStore() {
  const [fileDocs, structuredDocs] = await Promise.all([
    loadFileDocuments(),
    loadStructuredDocuments()
  ]);

  const allDocs = [...fileDocs, ...structuredDocs];

  console.log(
    `Loaded ${fileDocs.length} unstructured file documents and ${structuredDocs.length} structured documents for RAG.`
  );

  if (!allDocs.length) {
    console.warn("No documents loaded for RAG. Answers will rely on the LLM only.");
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200
  });

  const splitDocs = await splitter.splitDocuments(allDocs);
  console.log(`Split into ${splitDocs.length} chunks for embedding.`);

  const embeddings = new OpenAIEmbeddings({
    apiKey: config.openaiApiKey
  });

  const vectorStore = await FaissStore.fromDocuments(splitDocs, embeddings);

  return vectorStore;
}

