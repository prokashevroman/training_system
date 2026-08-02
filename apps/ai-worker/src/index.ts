import { handleRequest } from "./app.js";
import type { WorkerEnv } from "./env.js";

/**
 * Worker entry point.
 *
 * Deliberately empty of logic: everything testable lives in `app.ts`, which the
 * test suite calls directly with a fake env — no workerd, no wrangler, no network.
 */
export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
