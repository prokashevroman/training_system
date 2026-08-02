import type { WorkerConfig, WorkerEnv } from "../env.js";
import { createCloudflareProviders } from "./cloudflare/index.js";
import { createMockProviders } from "./mock/index.js";
import type { WorkerProviders } from "./types.js";

export type { WorkerProviders } from "./types.js";

/**
 * Provider selection (AI_PROVIDER).
 *
 * `mock` is the default: an unconfigured or misconfigured deployment must not
 * quietly start spending model calls, and the whole test suite runs offline
 * because of it. Cloudflare is opt-in through configuration only.
 */
export function selectProviders(
  env: WorkerEnv,
  config: WorkerConfig,
  requestId: string,
): WorkerProviders {
  if (config.provider === "cloudflare") {
    return createCloudflareProviders(env, config, requestId);
  }
  return createMockProviders(requestId);
}
