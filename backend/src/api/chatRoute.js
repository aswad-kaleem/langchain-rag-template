import { routeQuestion } from "../rag/routerChain.js";

/**
 * Register /chat routes.
 *
 * POST /chat
 * Body: { "question": string, "sessionId": string }
 *
 * Query: ?stream=true to enable server-sent streaming.
 */
export async function registerChatRoute(fastify) {
  fastify.post("/chat", async (request, reply) => {
    const { question, sessionId } = request.body || {};
    const { stream } = request.query || {};

    if (!question || typeof question !== "string") {
      reply.code(400);
      return {
        error: "Invalid payload: 'question' is required and must be a string."
      };
    }

    const session = typeof sessionId === "string" ? sessionId : undefined;
    const wantsStream = false; // streaming disabled for now

    // Non-streaming JSON response
    if (!wantsStream) {
      try {
        const result = await routeQuestion(question, session);
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
    }

    // Streaming via SSE
    // Ensure CORS headers are present even when hijacking the response,
    // since some frameworks may not apply plugin hooks after hijack.
    reply.raw.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
    reply.raw.setHeader("Access-Control-Allow-Credentials", "true");
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");

    // Fastify requires hijacking the raw response for manual streaming
    reply.hijack();

    const writeEvent = (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      writeEvent({ event: "start" });

      // RunnableWithMessageHistory expects { messages: [...] } format
      const streamIterator = await chain.stream(
        { messages: [{ role: "user", content: question }] },
        {
          configurable: {
            sessionId: session
          }
        }
      );

      for await (const chunk of streamIterator) {
        writeEvent({ event: "token", data: chunk });
      }

      writeEvent({ event: "end" });
      reply.raw.end();
    } catch (err) {
      request.log.error({ err }, "Streaming error during chat invocation");
      try {
        writeEvent({
          event: "error",
          error: "Internal error while streaming answer."
        });
      } finally {
        reply.raw.end();
      }
    }
  });
}

