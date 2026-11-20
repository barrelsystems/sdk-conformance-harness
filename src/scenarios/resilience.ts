import * as Effect from "effect/Effect";
import type { Scenario } from "../harness/scenario.js";
import type { TestKeypair } from "../protocol/signing.js";
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

function signedCurrentPolicy(keypair: TestKeypair) {
  return keypair.sign({
    type: "current",
    issuedAt: new Date().toISOString(),
    environment: "conformance-harness",
  });
}

/** A hung backend must never hang the adapter past its own bounded
 * timeout (reference: 10s) -- this gives it up to 15s of slack before
 * concluding the timeout itself was never enforced. */
export const boundedCheckInTimeoutFailsOpen: Scenario = stateMappingScenario({
  name: "a check-in that never returns still lets the adapter proceed within a bounded time (fail-open)",
  tier: 2,
  createAdapter: ({ backend, keypair, testService }) =>
    Effect.gen(function* () {
      yield* backend.setNextCheckInDelay("20 seconds");

      return yield* testService.testService.createAdapter({
        payload: { checkInBaseUrl: backend.baseUrl, publicKeyPem: keypair.publicKeyPem },
      });
    }),
  act: ({ testService }, adapter) =>
    testService.testService
      .runCommand({ params: { id: adapter.id }, payload: { command: "checkNow" } })
      .pipe(Effect.timeout("15 seconds")),
  areEquivalent: statesHaveSameType,
  expectedState: { type: "idle" },
});

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

/** Fires two `checkNow` calls against the same adapter while the backend
 * is briefly slow, then asserts the backend never had more than one of
 * them in flight at once -- whatever triggered the attempt, a second one
 * must never run concurrently with the first. */
export const noOverlappingCheckInAttempts: Scenario = {
  name: "an in-flight check-in is never joined by a second, concurrent attempt",
  tier: 1,
  run: ({ backend, keypair, testService }) =>
    Effect.gen(function* () {
      const signed = yield* signedCurrentPolicy(keypair);

      yield* backend.setNextResponse({
        protocolVersion: 1,
        policy: signed.policy,
        signature: signed.signature,
      });
      yield* backend.setNextCheckInDelay("300 millis");

      const adapter = yield* testService.testService.createAdapter({
        payload: { checkInBaseUrl: backend.baseUrl, publicKeyPem: keypair.publicKeyPem },
      });
      const checkNow = testService.testService.runCommand({
        params: { id: adapter.id },
        payload: { command: "checkNow" },
      });

      yield* Effect.all([checkNow, checkNow], { concurrency: "unbounded" });

      const peak = yield* backend.peakConcurrentCheckIns();

      if (peak > 1) {
        return yield* Effect.die(
          new Error(
            `expected at most 1 check-in in flight at a time, observed ${peak} overlapping`,
          ),
        );
      }

      yield* testService.testService.destroyAdapter({ params: { id: adapter.id } });
    }),
};

export const resilienceScenarios: ReadonlyArray<Scenario> = [
  boundedCheckInTimeoutFailsOpen,
  checkInFailureFailsOpen,
  noOverlappingCheckInAttempts,
];
