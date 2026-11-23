import { waitForIdle } from "../fixtures/runtimeAssertions.js";
import { deepStrictEqual, strictEqual, ok } from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import * as Effect from "effect/Effect";
import { startCheckInFaultProxy, type CheckInFault } from "../fixtures/checkInFaultProxy.js";
import type { Scenario } from "../runner/scenario.js";
import { updaterActivity, withAdapter } from "../fixtures/adapterFixture.js";

function failOpenScenario(options: {
  name: string;
  fault: CheckInFault;
  badSignature?: boolean;
}): Scenario {
  return {
    name: options.name,
    tier: 1,
    run: (context) =>
      Effect.gen(function* () {
        const proxy = yield* startCheckInFaultProxy(context.backend.baseUrl);
        const cached = {
          type: "held" as const,
          issuedAt: new Date().toISOString(),
          environment: "cached",
        };
        const recovered = { ...cached, environment: "recovered" };
        const signedCache = yield* context.keypair.sign(cached);
        const signedRecovery = yield* context.keypair.sign(recovered);
        yield* context.backend.setNextResponse({ protocolVersion: 1, ...signedCache });

        yield* withAdapter(
          context,
          (command) =>
            Effect.gen(function* () {
              yield* command({ command: "checkNow" });
              yield* waitForIdle(command);
              deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), cached);
              yield* command({ command: "prepareUpdaterFailure" });
              yield* command({ command: "prepareAction", stage: "pre-download" });
              yield* waitForIdle(command);
              const state = yield* command({ command: "getUpdateState" });
              const lastError = yield* command({ command: "getLastUpdateError" });
              ok(lastError, "fixture must establish a classified updater error");
              const activity = yield* updaterActivity(command);
              const before = yield* proxy.attempts();

              yield* context.backend.setNextResponse({
                protocolVersion: 1,
                ...signedRecovery,
                ...(options.badSignature
                  ? {
                      updateEligibility: signedRecovery.updateEligibility.replace(
                        "recovered",
                        "tampered",
                      ),
                    }
                  : {}),
              });
              yield* proxy.setFault(options.fault);
              yield* command({ command: "checkNow" }).pipe(Effect.timeout("13 seconds"));
              yield* waitForIdle(command);
              deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), cached);
              deepStrictEqual(yield* command({ command: "getUpdateState" }), state);
              deepStrictEqual(yield* command({ command: "getLastUpdateError" }), lastError);
              deepStrictEqual(yield* updaterActivity(command), activity);
              const attempts = yield* proxy.attempts();
              strictEqual(attempts, before + (options.fault === "unreachable" ? 0 : 1));

              yield* Effect.sleep("300 millis");
              strictEqual(
                yield* proxy.attempts(),
                attempts,
                "failure must not start its own retry loop",
              );
              deepStrictEqual(yield* updaterActivity(command), activity);

              yield* proxy.setFault("none");
              yield* context.backend.setNextResponse({ protocolVersion: 1, ...signedRecovery });
              yield* command({ command: "triggerLifecycle", event: "foreground" });
              for (let attempt = 0; attempt < 200; attempt++) {
                const updateEligibility = yield* command({ command: "getUpdateEligibility" });
                if (isDeepStrictEqual(updateEligibility, recovered)) break;

                yield* Effect.sleep("20 millis");
              }
              yield* waitForIdle(command);
              deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), recovered);
              strictEqual(yield* proxy.attempts(), attempts + 1);
              deepStrictEqual(yield* command({ command: "getUpdateState" }), state);
              deepStrictEqual(yield* command({ command: "getLastUpdateError" }), lastError);
              const allowed = yield* context.keypair.sign({ ...recovered, type: "unrestricted" });
              yield* context.backend.setNextPreActionCheckResponse({
                protocolVersion: 1,
                ...allowed,
              });
              for (const stage of ["pre-download", "pre-apply"] as const) {
                yield* command({ command: "prepareAction", stage });
                const beforeAction = yield* updaterActivity(command);
                yield* command({ command: "runAction", stage });
                const field = stage === "pre-download" ? "downloads" : "applies";
                const afterAction = yield* updaterActivity(command);
                strictEqual(afterAction[field], beforeAction[field] + 1);
              }
            }),
          { checkInBaseUrl: proxy.baseUrl, lifecycle: true },
        );
      }).pipe(Effect.scoped),
  };
}

export const failOpenScenarios = [
  failOpenScenario({
    name: "a connection reset preserves SDK state and the next lifecycle tick recovers",
    fault: "disconnect",
  }),
  failOpenScenario({
    name: "a non-2xx signed response preserves SDK state and the next lifecycle tick recovers",
    fault: "http-error",
  }),
  failOpenScenario({
    name: "an unreachable backend preserves SDK state and the next lifecycle tick recovers",
    fault: "unreachable",
  }),
  failOpenScenario({
    name: "a bad update-eligibility signature preserves SDK state and the next lifecycle tick recovers",
    fault: "none",
    badSignature: true,
  }),
];
