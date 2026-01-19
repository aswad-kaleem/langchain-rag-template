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

  // Vector Store → Retriever (for RAG Chain)
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

function buildRagTemplates() {
  const ragSystemTemplateWithContext =
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

  const ragSystemTemplateNoContext =
    `You are a helpful and friendly AI assistant for Convier Solutions. 

The user asked: {question}

Since I couldn't find specific information about this in our knowledge base, please provide a friendly, helpful response. You can:
- Acknowledge that the specific information isn't in the knowledge base
- Offer to help with related topics that might be in the knowledge base
- Be conversational and helpful
- If it's a greeting or casual question, respond naturally

Be warm, professional, and helpful.`.trim();

  return { ragSystemTemplateWithContext, ragSystemTemplateNoContext };
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

  const baseLlm = new ChatOpenAI({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    temperature: 0,
    streaming: false,
  });

  const finalLlm = new ChatOpenAI({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    temperature: config.openaiTemperature,
    streaming: true,
  });

  const { ragSystemTemplateWithContext, ragSystemTemplateNoContext } =
    buildRagTemplates();

  const finalAnswerPrompt = ChatPromptTemplate.fromTemplate(
    `You are the Final Answer Formatter for Convier Solutions.

You receive:
- The user's original question.
- A draft answer that was produced by a RAG Chain (using a vector store over company documents).

Your job:
- Keep all factual content from the draft answer.
- Improve clarity, structure, and tone (friendly, professional, concise).
- Clearly mention whether the answer is based primarily on company documents/knowledge-base content or on general reasoning without specific internal data.
- If something is uncertain in the draft, phrase it carefully and avoid hallucinating extra details.

User question:
{question}

Source chain type:
{source}

Draft answer:
{draftAnswer}

Now rewrite this into the best possible final answer for the user.`
  );

  const finalAnswerChain = finalAnswerPrompt
    .pipe(finalLlm)
    .pipe(new StringOutputParser());

  const ragOnlyChain = RunnableSequence.from([
    async (input) => {
      const messages = input.messages || [];
      const lastMessage = messages[messages.length - 1];
      const question = lastMessage?.content || "";

      const draftAnswer = await runRagChain(baseLlm, messages, {
        ragSystemTemplateWithContext,
        ragSystemTemplateNoContext,
      });

      return {
        question,
        draftAnswer,
        source: "rag",
      };
    },
    finalAnswerChain,
  ]);

  const chatWithHistory = new RunnableWithMessageHistory({
    runnable: ragOnlyChain,
    getMessageHistory: (sessionId) => getMessageHistoryForSession(sessionId),
    inputMessagesKey: "messages",
    historyMessagesKey: "history",
  });

  return chatWithHistory;
}

async function runRagChain(llm, messages, templates) {
  const { ragSystemTemplateWithContext, ragSystemTemplateNoContext } = templates;

  const lastMessage = messages[messages.length - 1];
  const question = lastMessage?.content || "";

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

  let systemContent;
  if (hasContext && context) {
    systemContent = ragSystemTemplateWithContext.replace("{context}", context);
  } else {
    systemContent = ragSystemTemplateNoContext.replace("{question}", question);
  }

  const systemMsg = new SystemMessage(systemContent);
  const conversationMsgs = messages.map((msg) => {
    if (msg.role === "user") {
      return new HumanMessage(msg.content);
    }
    return msg;
  });

  const ragMessages = [systemMsg, ...conversationMsgs];

  const chain = RunnableSequence.from([
    async () => ragMessages,
    llm,
    new StringOutputParser(),
  ]);

  return chain.invoke({});
}

export async function runRag(question) {
  if (!globalRetriever) {
    throw new Error("RAG not initialized. Call initializeRag() first.");
  }

  const baseLlm = new ChatOpenAI({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    temperature: 0,
    streaming: false,
  });

  const { ragSystemTemplateWithContext, ragSystemTemplateNoContext } =
    buildRagTemplates();

  const draftAnswer = await runRagChain(
    baseLlm,
    [{ role: "user", content: question || "" }],
    {
      ragSystemTemplateWithContext,
      ragSystemTemplateNoContext,
    }
  );

  return { answer: draftAnswer, source: "rag" };
}
