import { deepStrictEqual, strictEqual, ok } from "node:assert/strict";
import { withAdapter } from "../fixtures/adapterFixture.js";

import * as Effect from "effect/Effect";
import type { Scenario } from "../runner/scenario.js";

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
      yield* withAdapter(context, (command) =>
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

export const checkInFailureFailsOpen: Scenario = {
  name: "a check-in call that fails outright still leaves the adapter idle (fail-open)",
  tier: 1,
  run: (context) =>
    Effect.gen(function* () {
      yield* context.backend.setNextCheckInFailure({ shouldFail: true });
      yield* withAdapter(context, (command) =>
        Effect.gen(function* () {
          const before = (yield* context.backend.receivedCheckIns()).length;
          yield* command({ command: "checkNow" });
          strictEqual((yield* context.backend.receivedCheckIns()).length, before + 1);
          deepStrictEqual(yield* command({ command: "getUpdateState" }), { type: "idle" });
          strictEqual(yield* command({ command: "getUpdateEligibility" }), null);
        }),
      );
    }),
};

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
      yield* withAdapter(context, (command) =>
        Effect.gen(function* () {
          yield* command({ command: "checkNow" });
          const before = (yield* context.backend.receivedCheckIns()).length;
          yield* Effect.acquireUseRelease(
            context.backend.blockCheckInResponses(),
            (release) =>
              Effect.gen(function* () {
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
                      ok(
                        observed,
                        "first request must reach the backend before the competing tick",
                      );
                      yield* command({ command: "checkNow" });
                      yield* release;
                    }),
                  ],
                  { concurrency: "unbounded" },
                ).pipe(Effect.timeout("5 seconds"));
              }),
            (release) => release,
          );
          strictEqual((yield* context.backend.receivedCheckIns()).length, before + 1);
          strictEqual(yield* context.backend.peakConcurrentCheckIns(), 1);
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
