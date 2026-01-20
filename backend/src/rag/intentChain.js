import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { config } from "../config/env.js";
import {
  RAG_KEYWORDS,
  STRUCTURED_KEYWORDS,
  SQL_ACTION_KEYWORDS
} from "./semanticSchema.js";

const intentPrompt = ChatPromptTemplate.fromTemplate(
  `You are an intent classifier for Convier Solutions.

Classify the user's question into EXACTLY one of these labels:
- DATABASE_QUERY: for questions that clearly need structured, row-level data from the HR/product/operations databases (employees, attendance, salaries, leave balances, allowances, roles/permissions, transactional records).
- RAG_QUERY: for questions that should be answered from documents, policies, product/service info, or knowledge-base style content.
- GENERAL_CHAT: for casual greetings, small talk, or generic conversation not seeking company knowledge or database facts.

Hints:
- "Who is <person>?" or "Tell me about <employee>" should be DATABASE_QUERY if the name likely refers to staff/HR records.
- If unsure between DATABASE_QUERY and RAG_QUERY, prefer DATABASE_QUERY for person-specific lookups.

Return ONLY one word: DATABASE_QUERY, RAG_QUERY, or GENERAL_CHAT.

Conversation history (most recent first):
{history}

User question:
{question}`
);

function buildIntentChain() {
  const llm = new ChatOpenAI({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    temperature: 0,
    streaming: false,
  });

  return intentPrompt.pipe(llm).pipe(new StringOutputParser());
}

function ruleBasedIntent(question) {
  if (!question) return null;
  const q = question.toLowerCase();

  const hasAction = SQL_ACTION_KEYWORDS.some((kw) => q.includes(kw));
  const hasStructured = STRUCTURED_KEYWORDS.some((kw) => q.includes(kw));
  const hasRag = RAG_KEYWORDS.some((kw) => q.includes(kw));

  // Action-first: if the user asks to do something and references structured
  // entities, route to the database. If they ask to do something and only
  // reference document topics, route to RAG.
  if (hasAction && hasStructured) return "DATABASE_QUERY";
  if (hasAction && hasRag && !hasStructured) return "RAG_QUERY";

  // No action verb: fall back to keyword-only signals (minimal rules).
  if (hasStructured && !hasRag) return "DATABASE_QUERY";
  if (hasRag && !hasStructured) return "RAG_QUERY";

  return null;
}

export async function classifyQuestionIntent(question, history = []) {
  const rb = ruleBasedIntent(question || "");
  if (rb) {
    return rb;
  }

  const historyText = buildHistoryText(history);
  const chain = buildIntentChain();
  const raw = await chain.invoke({
    question: question || "",
    history: historyText || "(none)"
  });
  const normalized = (raw || "").trim().toUpperCase();

  if (normalized === "DATABASE_QUERY") return "DATABASE_QUERY";
  if (normalized === "RAG_QUERY") return "RAG_QUERY";
  if (normalized === "GENERAL_CHAT") return "GENERAL_CHAT";
  
  // If the LLM returns something unexpected, fall back conservatively
  // but still enforce that structured questions must go to SQL.
  const q = (question || "").toLowerCase();
  if (STRUCTURED_KEYWORDS.some((kw) => q.includes(kw))) {
    return "DATABASE_QUERY";
  }

  // Conservative fallback keeps chat safe and avoids accidental
  // database access when we are unsure.
  return "RAG_QUERY";
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
