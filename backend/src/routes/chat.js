import { routeQuestion } from "../rag/routerChain.js";

/**
 * POST /chat
 * Body: { "question": string, "sessionId"?: string }
 */
export async function registerChatRoutes(fastify) {
  fastify.post("/chat", async (request, reply) => {
    const { question, sessionId } = request.body || {};

    if (!question || typeof question !== "string") {
      reply.code(400);
      return {
        error: "Invalid payload: 'question' is required and must be a string."
      };
    }

    try {
      const result = await routeQuestion(question, sessionId);
      return {
        answer: result?.answer,
        intent: result?.intent,
        source: result?.source
      };
    } catch (err) {
      request.log.error({ err }, "Error during chat invocation");
      reply.code(500);
      return {
        error: "Internal error while generating answer."
      };
    }
  });
}
