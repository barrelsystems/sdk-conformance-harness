import type * as Effect from "effect/Effect";
import type { HttpApiClient } from "effect/http-api";
import type { TestServiceHttpApi } from "../protocol/testServiceApi.js";
import type { TestKeypair } from "../protocol/signing.js";
import type { MockBackendHandle } from "./mockBackend.js";

export type TestServiceClient = HttpApiClient.ForApi<typeof TestServiceHttpApi>;

/** One conformance check: drive the SDK's real adapter through a sequence
 * of commands and assert on the outcome. Throwing fails the scenario;
 * returning normally passes it. */
export interface Scenario {
  readonly name: string;
  /** Tier 1 must pass at 100%; Tier 2 may regress to 80% before
   * automatic relegation. */
  readonly tier: 1 | 2;
  readonly run: (context: {
    readonly backend: MockBackendHandle;
    readonly keypair: TestKeypair;
    readonly testService: TestServiceClient;
  }) => Effect.Effect<void, unknown, never>;
}
