import { classifyQuestionIntent as detectIntent } from "./intentChain.js";
import { runRag } from "./ragChain.js";
import { runSqlChain as runSqlAgent, runSqlPage } from "./sqlChain.js";

function buildGeneralChatAnswer(question) {
  const trimmed = (question || "").trim();
  const greeting = "Hi there! How can I help you today?";
  if (!trimmed) return greeting;
  return `${greeting} (You said: ${trimmed})`;
}
const sessionState = new Map();

function getSessionBucket(sessionId) {
  if (!sessionId) return null;
  let bucket = sessionState.get(sessionId);
  if (!bucket) {
    bucket = { lastDatabaseQuery: null };
    sessionState.set(sessionId, bucket);
  }
  return bucket;
}

function detectPaginationDirection(question) {
  const q = (question || "").trim().toLowerCase();
  if (!q) return null;

  const nextPatterns = [
    /^(next|next page)\b/,
    /^show more\b/,
    /^more\b/,
    /\bmore results\b/,
    /\bnext set\b/,
  ];

  const prevPatterns = [
    /^(previous|previous page|prev)\b/,
    /\bgo back\b/,
    /\bback\b/,
  ];

  if (nextPatterns.some((re) => re.test(q))) return "next";
  if (prevPatterns.some((re) => re.test(q))) return "previous";
  return null;
}

export async function routeQuestion(question, sessionId) {
  const trimmedQuestion = (question || "").trim();
  const direction = detectPaginationDirection(trimmedQuestion);
  const bucket = getSessionBucket(sessionId);
  

  if (direction) {
    if (bucket && bucket.lastDatabaseQuery) {
      const { sql, originalQuestion, offset = 0, limit = 50 } =
        bucket.lastDatabaseQuery;

      const pageSize = Number.isFinite(limit) && limit > 0 ? limit : 50;
      const newOffset =
        direction === "next"
          ? offset + pageSize
          : Math.max(0, offset - pageSize);

      const pageResult = await runSqlPage(
        sql,
        originalQuestion,
        newOffset,
        pageSize
      );

      if (pageResult?.sql) {
        bucket.lastDatabaseQuery = {
          sql: pageResult.sql,
          originalQuestion,
          offset: newOffset,
          limit: pageSize,
        };
      }

      const explanation =
        "This answer is based on live HR database records (paginated results).";
      const combinedAnswer = pageResult?.answer
        ? `${explanation}\n\n${pageResult.answer}`
        : explanation;

      return {
        intent: "DATABASE_QUERY",
        source: "database",
        ...pageResult,
        answer: combinedAnswer,
      };
    }

    const answer =
      "I don't have any earlier database results to navigate. Please ask a data question first.";
    return { intent: "GENERAL_CHAT", source: "general", answer };
  }

  const intent = await detectIntent(trimmedQuestion);
    console.log("intent____________________________", intent)
  switch (intent) {
    case "DATABASE_QUERY": {
      const result = await runSqlAgent(trimmedQuestion);

      if (bucket && result?.sql) {
        const match = result.sql.match(/\blimit\s+(\d+)/i);
        const limit = match ? parseInt(match[1], 10) : 50;
        bucket.lastDatabaseQuery = {
          sql: result.sql,
          originalQuestion: trimmedQuestion,
          offset: 0,
          limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
        };
      }

      const explanation =
        "This answer is based on live HR database records.";
      const combinedAnswer = result?.answer
        ? `${explanation}\n\n${result.answer}`
        : explanation;

      return { intent, source: "database", ...result, answer: combinedAnswer };
    }
    case "RAG_QUERY": {
      const result = await runRag(trimmedQuestion);
      const explanation =
        "This answer is based on company documents and knowledge-base content.";
      const combinedAnswer = result?.answer
        ? `${explanation}\n\n${result.answer}`
        : explanation;

      return { intent, source: "rag", ...result, answer: combinedAnswer };
    }
    case "GENERAL_CHAT":
    default: {
      const base = buildGeneralChatAnswer(trimmedQuestion);
      const explanation =
        "This is a general conversational response and does not use internal company data.";
      const answer = `${explanation}\n\n${base}`;
      return { intent: "GENERAL_CHAT", source: "general", answer };
    }
  }
}
