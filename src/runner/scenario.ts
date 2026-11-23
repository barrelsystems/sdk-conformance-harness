import type * as Effect from "effect/Effect";
import type { HttpApiClient } from "effect/http-api";
import type { TestServiceHttpApi } from "../protocol/testServiceApi.js";
import type { TestKeypair } from "../protocol/signing.js";
import type { MockBackendHandle } from "../fixtures/mockBackend.js";

type TestServiceClient = HttpApiClient.ForApi<typeof TestServiceHttpApi>;

/** What every scenario's `run` is handed -- pulled out as its own type so
 * a scenario-building helper can name it
 * directly instead of re-deriving or re-inlining this shape. */
export interface ScenarioContext {
  readonly backend: MockBackendHandle;
  readonly keypair: TestKeypair;
  readonly testService: TestServiceClient;
}

/** One conformance check: drive the SDK's real adapter through a sequence
 * of commands and assert on the outcome. Throwing fails the scenario;
 * returning normally passes it. */
export interface Scenario {
  readonly name: string;
  /** Tier 1 must pass at 100%; tier 2 may regress to an 80% pass rate
   * before the run fails. A tier-1 scenario auto-relegates to tier 2
   * after failing its last N runs straight (`relegationHistory.ts`). */
  readonly tier: 1 | 2;
  readonly run: (context: ScenarioContext) => Effect.Effect<void, unknown, never>;
}
