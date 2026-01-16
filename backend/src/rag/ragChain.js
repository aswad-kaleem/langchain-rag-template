import { ChatOpenAI } from "@langchain/openai";
import { config } from "../config/env.js";
import { initializeVectorStore } from "./vectorStore.js";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

let globalRetriever;

// Simple in-memory session store; plug in Redis or DB for production.
const sessionStore = new Map();

export async function initializeRag() {
  const vectorStore = await initializeVectorStore();

  // Use similarity search with modest k to balance latency vs. recall.
  globalRetriever = vectorStore.asRetriever({
    k: config.ragTopK,
  });
}

function getMessageHistoryForSession(sessionId) {
  if (!sessionId) {
    // Stateless fallback: new history each time
    return new InMemoryChatMessageHistory();
  }
  if (!sessionStore.has(sessionId)) {
    sessionStore.set(sessionId, new InMemoryChatMessageHistory());
  }
  return sessionStore.get(sessionId);
}

/**
 * Build the RAG chain using LCEL.
 *
 * Flow:
 * 1) Extract question from input messages
 * 2) Retrieve top-k docs based on question
 * 3) Build a safe context string (truncated to avoid context overflow)
 * 4) Inject into a user-friendly system prompt
 * 5) Stream answer with conversational memory
 */
export function getChatChain() {
  if (!globalRetriever) {
    throw new Error("RAG not initialized. Call initializeRag() first.");
  }

  const llm = new ChatOpenAI({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    temperature: config.openaiTemperature,
    streaming: true,
  });

  // User-friendly system prompt that encourages helpful responses
  const systemTemplateWithContext =
    `You are a helpful and friendly AI assistant for Convier Solutions. Your role is to answer questions based on the provided context from company documents and knowledge base.

Guidelines:
- Use the context provided below to answer questions accurately and helpfully
- If the context contains relevant information, provide a clear, user-friendly answer
- If the context doesn't fully answer the question, provide what you can from the context and politely mention if additional information might be needed
- Be conversational, warm, and professional
- Format your answers in a clear, easy-to-read manner
- If asked about general topics (greetings, casual conversation), respond naturally and helpfully

Context from knowledge base:
{context}
`.trim();

  // Friendly fallback for when no context is found
  const systemTemplateNoContext =
    `You are a helpful and friendly AI assistant for Convier Solutions. 

The user asked: {question}

Since I couldn't find specific information about this in our knowledge base, please provide a friendly, helpful response. You can:
- Acknowledge that the specific information isn't in the knowledge base
- Offer to help with related topics that might be in the knowledge base
- Be conversational and helpful
- If it's a greeting or casual question, respond naturally

Be warm, professional, and helpful.`.trim();

  const ragChainCore = RunnableSequence.from([
    // Step 1: Extract the question from input messages and retrieve docs
    async (input) => {
      // RunnableWithMessageHistory passes { messages: [...] } with history already included
      // Extract the last user message (the current question)
      const messages = input.messages || [];
      const lastMessage = messages[messages.length - 1];
      const question = lastMessage?.content || "";

      // Retrieve documents based on the current question
      let docs = [];
      let hasContext = false;

      if (question && question.trim().length > 0) {
        try {
          docs = await globalRetriever.invoke(question);
          hasContext = docs && docs.length > 0;
          console.log(
            `[RAG] Question: "${question.substring(0, 50)}..." | Retrieved ${
              docs.length
            } documents`
          );
        } catch (err) {
          console.warn("Retrieval error:", err);
        }
      } else {
        console.warn("[RAG] Empty question received");
      }

      // Build context string from retrieved documents
      let context = "";
      if (hasContext && docs.length > 0) {
        const serialized = docs
          .map((d, idx) => `[Source ${idx + 1}]\n${d.pageContent}`)
          .join("\n\n---\n\n");

        context =
          serialized.length > config.ragMaxContextChars
            ? serialized.slice(0, config.ragMaxContextChars) + "..."
            : serialized;
      }

      // Build system message with or without context
      let systemContent;
      if (hasContext && context) {
        systemContent = systemTemplateWithContext.replace("{context}", context);
      } else {
        systemContent = systemTemplateNoContext.replace("{question}", question);
      }

      // Return messages array with system message prepended
      // The input.messages already contains conversation history + current question
      // Convert to proper LangChain message format
      const systemMsg = new SystemMessage(systemContent);
      const conversationMsgs = messages.map((msg) => {
        if (msg.role === "user") {
          return new HumanMessage(msg.content);
        }
        // For assistant messages from history, keep as is (they're already in correct format)
        return msg;
      });

      return [systemMsg, ...conversationMsgs];
    },
    // Step 2: Invoke LLM with the complete messages array
    llm,
    // Step 3: Parse the output to string
    new StringOutputParser(),
  ]);

  const chatWithHistory = new RunnableWithMessageHistory({
    runnable: ragChainCore,
    getMessageHistory: (sessionId) => getMessageHistoryForSession(sessionId),
    inputMessagesKey: "messages",
    historyMessagesKey: "history",
  });

  return chatWithHistory;
}
