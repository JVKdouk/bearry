import type {
  FastifyRequest,
  onRequestHookHandler,
  onResponseHookHandler,
} from "fastify";

// Load-shedding contract. When too many requests are in flight the server is
// past its safe capacity; rather than let latency cascade, it answers 503 with a
// Retry-After header. Clients that speak the contract (the offline manager) keep
// the write durably queued and retry after the requested window, so nothing is
// lost — the backend just gets breathing room. Tunable via env for the deploy.
const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT) || 400;
const RETRY_AFTER_SECONDS = Number(process.env.OVERLOAD_RETRY_AFTER) || 3;

let inFlight = 0;
const counted = new WeakSet<FastifyRequest>();

export const overloadGuard: onRequestHookHandler = async (request, reply) => {
  if (inFlight >= MAX_INFLIGHT) {
    reply
      .header("Retry-After", String(RETRY_AFTER_SECONDS))
      .code(503)
      .send({ message: "Server busy, retry shortly" });
    return reply;
  }
  inFlight++;
  counted.add(request);
};

export const overloadRelease: onResponseHookHandler = (request, _reply, done) => {
  if (counted.has(request)) {
    counted.delete(request);
    inFlight = Math.max(0, inFlight - 1);
  }
  done();
};
