import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { config } from "../config/env.js";
import { STRUCTURED_KEYWORDS } from "./semanticSchema.js";

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

  // Obvious RAG/document queries: policies, products, services, generic company info
  const ragKeywords = [
    "policy",
    "policies",
    "refund",
    "onboarding",
    "procedure",
    "process",
    "product",
    "products",
    "service",
    "services",
    "company info",
    "convier solutions",
  ];
  const isRagDocQuestion = ragKeywords.some((kw) => q.includes(kw));

  // Detect questions that clearly target structured HR/operations data,
  // regardless of how the LLM might classify them.
  const looksStructured = STRUCTURED_KEYWORDS.some((kw) => q.includes(kw));

  // Clear general chat: greetings, thanks, small talk
  const generalPatterns = [
    /^(hi|hello|hey|salam|asa|good\s+(morning|evening|afternoon))/i,
    /(how are you|thank you|thanks|what's up|whats up|bye)/i,
  ];
  if (generalPatterns.some((re) => re.test(question))) {
    return "GENERAL_CHAT";
  }

  // Company-level info (founder, CEO, address, overview, about the
  // organization itself) should come from documents like basic_info,
  // not from the transactional database.
  const companyInfoPatterns = [
    /convier solutions/i,
    /company\s+info/i,
    /about\s+company/i,
    /company\s+name/i,
    /founder/i,
    /\bceo\b/i,
    /address\s*\/?\s*location/i,
  ];
  if (companyInfoPatterns.some((re) => re.test(question))) {
    return "RAG_QUERY";
  }

  // Strong RAG/document signals win over generic structured hints so that
  // things like "leave policy" go to documents instead of SQL.
  if (isRagDocQuestion && !/remaining\s+leaves?/i.test(question)) {
    return "RAG_QUERY";
  }

  // If it clearly targets structured HR/data concepts, force DATABASE_QUERY
  // so that only the SQL chain, not RAG, handles factual data.
  if (looksStructured) {
    return "DATABASE_QUERY";
  }

  // Strong SQL signals: list/show/count + core HR/data words
  const sqlKeywords = [
    "employee",
    "employees",
    "attendance",
    "attendances",
    "check in",
    "check-out",
    "check out",
    "salary",
    "salaries",
    "leave",
    "leaves",
    "remaining leaves",
    "allowance",
    "allowances",
    "role",
    "roles",
    "permission",
    "permissions",
    "public holiday",
    "department",
    "departments",
    "activity log",
  ];

  const sqlActionPatterns = [
    /(list|show|give|get|fetch|display)\s+all/i,
    /(how many|count of|total number of)/i,
    /(remaining|balance)\s+leaves?/i,
    /who is\s+.+/i,
  ];

  const hasSqlKeyword = sqlKeywords.some((kw) => q.includes(kw));
  const hasSqlAction = sqlActionPatterns.some((re) => re.test(question));

  if (hasSqlKeyword && hasSqlAction) {
    return "DATABASE_QUERY";
  }

  // Person/employee lookups: "who is <name>", "tell me about <name>"
  if (/who is\s+.+/i.test(question) || /tell me about\s+.+/i.test(question)) {
    // If this is clearly about the company itself (founder, CEO,
    // "who is Convier Solutions" style questions), treat it as a
    // document / RAG query instead of a database lookup.
    if (companyInfoPatterns.some((re) => re.test(question))) {
      return "RAG_QUERY";
    }
    return "DATABASE_QUERY";
  }

  // No clear rule-based hit – let the LLM decide.
  return null;
}

export async function classifyQuestionIntent(question) {
  const rb = ruleBasedIntent(question || "");
  if (rb) {
    return rb;
  }

  const chain = buildIntentChain();
  const raw = await chain.invoke({ question: question || "" });
  const normalized = (raw || "").trim().toUpperCase();

  if (normalized === "DATABASE_QUERY") return "DATABASE_QUERY";
  if (normalized === "RAG_QUERY") return "RAG_QUERY";
  if (normalized === "GENERAL_CHAT") return "GENERAL_CHAT";
  
  // If the LLM returns something unexpected, fall back conservatively
  // but still enforce that structured questions must go to SQL.
  const q = (question || "").toLowerCase();
  const structuredKeywords = [
    "employee",
    "employees",
    "attendance",
    "attendances",
    "check in",
    "check-out",
    "check out",
    "salary",
    "salaries",
    "leave",
    "leaves",
    "remaining leaves",
    "allowance",
    "allowances",
    "role",
    "roles",
    "permission",
    "permissions",
    "public holiday",
    "department",
    "departments",
    "activity log",
    "office email",
    "joining date",
    "employee id",
    "attendance device id",
  ];

  if (structuredKeywords.some((kw) => q.includes(kw))) {
    return "DATABASE_QUERY";
  }

  // Conservative fallback keeps chat safe and avoids accidental
  // database access when we are unsure.
  return "RAG_QUERY";
}

export function getIntentChain() {
  return buildIntentChain();
}
