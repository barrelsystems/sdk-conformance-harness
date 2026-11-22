import { strictEqual, ok } from "node:assert/strict";
import { withPolicyAdapter } from "./policy.js";
import * as Effect from "effect/Effect";
import type { Scenario } from "../harness/scenario.js";
import { stateMappingScenario } from "./adapterConformance.js";

/** The one check-in state every resilience scenario expects to land on --
 * none of them ever advance past `idle`, so a mismatch here means the
 * adapter surfaced the injected fault instead of failing open. */
function statesHaveSameType(
  a: { readonly type?: unknown },
  b: { readonly type?: unknown },
): boolean {
  return a.type === b.type;
}

export const boundedCheckInTimeoutFailsOpen: Scenario = {
  name: "a hung production check-in times out around ten seconds and the next attempt can proceed",
  tier: 1,
  run: (context) =>
    Effect.gen(function* () {
      const signed = yield* context.keypair.sign({
        type: "held",
        issuedAt: new Date().toISOString(),
        environment: "test",
      });
      yield* context.backend.setNextResponse({ protocolVersion: 1, ...signed });
      yield* withPolicyAdapter(context, (command) =>
        Effect.gen(function* () {
          yield* command({ command: "checkNow" });
          const before = (yield* context.backend.receivedCheckIns()).length;
          yield* context.backend.setNextCheckInDelay("20 seconds");
          const start = Date.now();
          yield* command({ command: "checkNow" }).pipe(Effect.timeout("13 seconds"));
          const elapsed = Date.now() - start;
          ok(elapsed >= 8_500 && elapsed <= 12_500, `timeout was ${elapsed}ms`);
          strictEqual((yield* context.backend.receivedCheckIns()).length, before + 1);
          yield* context.backend.setNextCheckInDelay(null);
          yield* command({ command: "checkNow" }).pipe(Effect.timeout("3 seconds"));
          strictEqual((yield* context.backend.receivedCheckIns()).length, before + 2);
        }),
      );
    }),
};

/** A check-in that fails outright (an ingestion-side 500, not a hang)
 * must be just as fail-open as a timeout -- a separate code path in most
 * implementations, so it gets its own scenario rather than reusing the
 * timeout one above. */
export const checkInFailureFailsOpen: Scenario = stateMappingScenario({
  name: "a check-in call that fails outright still leaves the adapter idle (fail-open)",
  createAdapter: ({ backend, keypair, testService }) =>
    Effect.gen(function* () {
      yield* backend.setNextCheckInFailure({ shouldFail: true });

      return yield* testService.testService.createAdapter({
        payload: { checkInBaseUrl: backend.baseUrl, publicKeyPem: keypair.publicKeyPem },
      });
    }),
  act: ({ testService }, adapter) =>
    testService.testService.runCommand({
      params: { id: adapter.id },
      payload: { command: "checkNow" },
    }),
  areEquivalent: statesHaveSameType,
  expectedState: { type: "idle" },
});

export const noOverlappingCheckInAttempts: Scenario = {
  name: "an in-flight attempt skips a second tick and releases the guard for a later check-in",
  tier: 1,
  run: (context) =>
    Effect.gen(function* () {
      const signed = yield* context.keypair.sign({
        type: "held",
        issuedAt: new Date().toISOString(),
        environment: "test",
      });
      yield* context.backend.setNextResponse({ protocolVersion: 1, ...signed });
      yield* withPolicyAdapter(context, (command) =>
        Effect.gen(function* () {
          yield* command({ command: "checkNow" });
          const before = (yield* context.backend.receivedCheckIns()).length;
          yield* context.backend.setNextCheckInDelay("400 millis");
          yield* Effect.all(
            [
              command({ command: "checkNow" }),
              Effect.gen(function* () {
                let observed = false;
                for (let attempt = 0; attempt < 100; attempt++) {
                  if ((yield* context.backend.receivedCheckIns()).length > before) {
                    observed = true;
                    break;
                  }
                  yield* Effect.sleep("10 millis");
                }
                ok(observed, "first request must reach the backend before the competing tick");
                yield* command({ command: "checkNow" });
              }),
            ],
            { concurrency: "unbounded" },
          ).pipe(Effect.timeout("5 seconds"));
          strictEqual((yield* context.backend.receivedCheckIns()).length, before + 1);
          strictEqual(yield* context.backend.peakConcurrentCheckIns(), 1);
          yield* context.backend.setNextCheckInDelay(null);
          yield* command({ command: "checkNow" });
          strictEqual((yield* context.backend.receivedCheckIns()).length, before + 2);
        }),
      );
    }),
};

export const resilienceScenarios: ReadonlyArray<Scenario> = [
  boundedCheckInTimeoutFailsOpen,
  checkInFailureFailsOpen,
  noOverlappingCheckInAttempts,
];
