import { ChatOpenAI } from "@langchain/openai";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { config } from "../config/env.js";
import { initializeVectorStore } from "./vectorStore.js";

let retriever;

export async function initializeRag() {
  const vectorStore = await initializeVectorStore();
  retriever = vectorStore.asRetriever({ k: config.ragTopK });
}

function buildRagTemplates() {
  const ragSystemTemplateWithContext =
    `You are a helpful and friendly AI assistant for Convier Solutions. Your role is to answer questions based on the provided context from company documents and knowledge base.

Guidelines:
- Use the context provided below to answer questions accurately and helpfully
- If the context contains relevant information, provide a clear, user-friendly answer
- If the context doesn't fully answer the question, provide what you can from the context and politely mention if additional information might be needed
- Be conversational, warm, and professional
- Format your answers in a clear, easy-to-read manner

Context from knowledge base:
{context}

Conversation history (most recent first):
{history}
`.trim();

  const ragSystemTemplateNoContext =
    `You are a helpful and friendly AI assistant for Convier Solutions.

The user asked: {question}

Conversation history (most recent first):
{history}

Since I couldn't find specific information about this in our knowledge base, provide a friendly, helpful response. You can:
- Acknowledge that the specific information isn't in the knowledge base
- Offer to help with related topics that might be in the knowledge base
- Be conversational and helpful

Be warm, professional, and helpful.`.trim();

  return { ragSystemTemplateWithContext, ragSystemTemplateNoContext };
}

async function retrieveDocs(question) {
  if (!question) return [];
  try {
    return await retriever.invoke(question);
  } catch (err) {
    console.warn("[RAG] Retrieval error:", err?.message || err);
    return [];
  }
}

function buildContext(docs) {
  if (!docs || docs.length === 0) return "";

  const serialized = docs
    .map((doc, idx) => `[Source ${idx + 1}]\n${doc.pageContent}`)
    .join("\n\n---\n\n");

  if (serialized.length > config.ragMaxContextChars) {
    return `${serialized.slice(0, config.ragMaxContextChars)}...`;
  }

  return serialized;
}

function buildSystemPrompt({ question, context, history, templates }) {
  const historyBlock = history ? history : "(none)";
  if (context) {
    return templates.ragSystemTemplateWithContext
      .replace("{context}", context)
      .replace("{history}", historyBlock);
  }
  return templates.ragSystemTemplateNoContext
    .replace("{question}", question)
    .replace("{history}", historyBlock);
}

function buildHistoryText(history) {
  if (!Array.isArray(history) || history.length === 0) return "";
  return history
    .slice(-10)
    .reverse()
    .map((msg) => {
      const role = msg.role === "assistant" ? "Assistant" : "User";
      const content = (msg.content || "").trim();
      if (!content) return null;
      return `${role}: ${content}`;
    })
    .filter(Boolean)
    .join("\n");
}

async function invokeLlm(messages) {
  const llm = new ChatOpenAI({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    temperature: config.openaiTemperature,
    streaming: false
  });

  const chain = RunnableSequence.from([
    async () => messages,
    llm,
    new StringOutputParser()
  ]);

  return chain.invoke({});
}

export async function runRag(question, history = []) {
  if (!retriever) {
    throw new Error("RAG not initialized. Call initializeRag() first.");
  }

  const normalizedQuestion = (question || "").trim();
  const docs = await retrieveDocs(normalizedQuestion);
  const context = buildContext(docs);
  const templates = buildRagTemplates();
  const historyText = buildHistoryText(history);
  const systemPrompt = buildSystemPrompt({
    question: normalizedQuestion,
    context,
    history: historyText,
    templates
  });

  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(normalizedQuestion || "")
  ];

  const answer = await invokeLlm(messages);
  return { answer, source: "rag" };
}
