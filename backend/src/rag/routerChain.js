import { classifyQuestionIntent } from "./intentChain.js";
import { runRag } from "./ragChain.js";
import { runSqlChain, runSqlPage } from "./sqlChain.js";

const sessionState = new Map();
const MAX_HISTORY_MESSAGES = 12;

function getSessionState(sessionId) {
  if (!sessionId) return null;
  if (!sessionState.has(sessionId)) {
    sessionState.set(sessionId, { lastDatabaseQuery: null, history: [] });
  }
  return sessionState.get(sessionId);
}

function appendHistory(session, role, content) {
  if (!session || !content) return;
  if (!session.history) session.history = [];
  session.history.push({ role, content });
  if (session.history.length > MAX_HISTORY_MESSAGES) {
    session.history = session.history.slice(-MAX_HISTORY_MESSAGES);
  }
}

function buildGeneralChatAnswer(question) {
  const trimmed = (question || "").trim();
  const greeting = "Hi there! How can I help you today?";
  if (!trimmed) return greeting;
  return `${greeting} (You said: ${trimmed})`;
}

function detectPaginationDirection(question) {
  const q = (question || "").trim().toLowerCase();
  if (!q) return null;

  const nextPatterns = [
    /^(next|next page)\b/,
    /^show more\b/,
    /^more\b/,
    /\bmore results\b/,
    /\bnext set\b/
  ];

  const prevPatterns = [
    /^(previous|previous page|prev)\b/,
    /\bgo back\b/,
    /\bback\b/
  ];

  if (nextPatterns.some((re) => re.test(q))) return "next";
  if (prevPatterns.some((re) => re.test(q))) return "previous";
  return null;
}

function buildDatabaseAnswer(result, paginated = false) {
  const explanation = paginated
    ? "This answer is based on live HR database records (paginated results)."
    : "This answer is based on live HR database records.";
  const combinedAnswer = result?.answer
    ? `${explanation}\n\n${result.answer}`
    : explanation;

  return { ...result, answer: combinedAnswer };
}

export async function routeQuestion(question, sessionId) {
  const trimmedQuestion = (question || "").trim();
  const session = getSessionState(sessionId);
  const direction = detectPaginationDirection(trimmedQuestion);

  if (trimmedQuestion) {
    appendHistory(session, "user", trimmedQuestion);
  }

  if (direction) {
    if (!session?.lastDatabaseQuery) {
      return {
        intent: "GENERAL_CHAT",
        source: "general",
        answer:
          "I don't have any earlier database results to navigate. Please ask a data question first."
      };
    }

    const { sql, originalQuestion, offset = 0, limit = 50 } =
      session.lastDatabaseQuery;
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
      session.lastDatabaseQuery = {
        sql: pageResult.sql,
        originalQuestion,
        offset: newOffset,
        limit: pageSize
      };
    }

    const payload = {
      intent: "DATABASE_QUERY",
      source: "database",
      ...buildDatabaseAnswer(pageResult, true)
    };

    appendHistory(session, "assistant", payload.answer);
    return payload;
  }

  const intent = await classifyQuestionIntent(
    trimmedQuestion,
    session?.history || []
  );

  if (intent === "DATABASE_QUERY") {
    const result = await runSqlChain(trimmedQuestion, session?.history || []);
    if (session && result?.sql) {
      const match = result.sql.match(/\blimit\s+(\d+)/i);
      const limit = match ? parseInt(match[1], 10) : 50;
      session.lastDatabaseQuery = {
        sql: result.sql,
        originalQuestion: trimmedQuestion,
        offset: 0,
        limit: Number.isFinite(limit) && limit > 0 ? limit : 50
      };
    }

    const payload = {
      intent,
      source: "database",
      ...buildDatabaseAnswer(result)
    };

    appendHistory(session, "assistant", payload.answer);
    return payload;
  }

  if (intent === "RAG_QUERY") {
    const result = await runRag(trimmedQuestion, session?.history || []);
    const explanation =
      "This answer is based on company documents and knowledge-base content.";
    const combinedAnswer = result?.answer
      ? `${explanation}\n\n${result.answer}`
      : explanation;

    const payload = { intent, source: "rag", ...result, answer: combinedAnswer };
    appendHistory(session, "assistant", payload.answer);
    return payload;
  }

  const base = buildGeneralChatAnswer(trimmedQuestion);
  const explanation =
    "This is a general conversational response and does not use internal company data.";
  const payload = {
    intent: "GENERAL_CHAT",
    source: "general",
    answer: `${explanation}\n\n${base}`
  };

  appendHistory(session, "assistant", payload.answer);
  return payload;
}
