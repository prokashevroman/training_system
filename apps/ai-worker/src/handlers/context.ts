import type { AuthenticatedUser } from "../auth.js";
import type { WorkerConfig, WorkerEnv } from "../env.js";
import type { Logger } from "../log.js";
import type { WorkerProviders } from "../providers/index.js";

/**
 * What a handler is given.
 *
 * `user` is present only because the token verified, and its `userId` came from
 * the token's `sub` claim — handlers have no way to read a user id from the body
 * even by accident, because the request schemas do not have that field.
 */
export interface RequestContext {
  readonly request: Request;
  readonly env: WorkerEnv;
  readonly config: WorkerConfig;
  readonly requestId: string;
  readonly logger: Logger;
  readonly user: AuthenticatedUser;
  readonly providers: WorkerProviders;
}
