import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import { generateTestKeypair } from "../protocol/signing.js";
import { startMockBackend } from "../fixtures/mockBackend.js";
import type { Scenario } from "./scenario.js";
import { connectToTestService } from "../fixtures/testServiceClient.js";

export interface ScenarioResult {
  readonly name: string;
  readonly tier: 1 | 2;
  readonly passed: boolean;
  readonly error?: unknown;
}

/** Runs every scenario against one already-listening test service, each
 * against its own fresh mock backend and keypair so scenarios can never
 * leak state into one another. */
export function runAllScenarios(testServiceBaseUrl: string, scenarios: ReadonlyArray<Scenario>) {
  return Effect.forEach(scenarios, (scenario) =>
    Effect.gen(function* () {
      const backend = yield* startMockBackend();
      const keypair = yield* generateTestKeypair();
      const testService = yield* connectToTestService(testServiceBaseUrl);

      // `Effect.exit` catches a defect (`Effect.die`) the same as a typed
      // failure -- a scenario's "fail" path uses `die`, since an unmet
      // assertion isn't a recoverable error any caller should branch on.
      const exit = yield* scenario.run({ backend, keypair, testService }).pipe(Effect.exit);

      const result: ScenarioResult =
        exit._tag === "Success"
          ? { name: scenario.name, tier: scenario.tier, passed: true }
          : { name: scenario.name, tier: scenario.tier, passed: false, error: exit.cause };

      return result;
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
}
