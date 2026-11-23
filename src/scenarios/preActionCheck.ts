import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import * as Effect from "effect/Effect";
import type { Scenario, ScenarioContext } from "../runner/scenario.js";
import { updaterActivity, withAdapter, type AdapterCommands } from "../fixtures/adapterFixture.js";
import { waitForIdle } from "../fixtures/runtimeAssertions.js";
import { invalidUpdateEligibilityResponses, updateEligibilityCases } from "./updateEligibility.js";

const stages = ["pre-download", "pre-apply"] as const;
type Stage = (typeof stages)[number];

function assertAction(command: AdapterCommands, options: { stage: Stage; proceeds: boolean }) {
  return Effect.gen(function* () {
    yield* command({ command: "prepareAction", stage: options.stage });
    const before = yield* updaterActivity(command);

    yield* command({ command: "runAction", stage: options.stage }).pipe(
      Effect.timeout("15 seconds"),
    );
    const after = yield* updaterActivity(command);
    const field = options.stage === "pre-download" ? "downloads" : "applies";

    deepStrictEqual(after, { ...before, [field]: before[field] + (options.proceeds ? 1 : 0) });
  });
}

function assertRequest(context: ScenarioContext, stage: Stage, before: number) {
  return Effect.gen(function* () {
    const requests = yield* context.backend.receivedPreActionChecks();
    strictEqual(requests.length, before + 1);
    strictEqual(requests.at(-1)?.stage, stage);
    const checkIns = yield* context.backend.receivedCheckIns();
    strictEqual(requests.at(-1)?.installationId, checkIns.at(-1)?.installationId);
  });
}

const preActionCheckRoundTrip: Scenario = {
  name: "production download and apply each check once; held blocks and other eligibility verdicts allow the action",
  tier: 1,
  run: (context) =>
    withAdapter(context, (command) =>
      Effect.gen(function* () {
        const cached = {
          type: "unrestricted" as const,
          issuedAt: "2026-01-01T00:00:00.000Z",
          environment: "cached",
        };
        const signedCache = yield* context.keypair.sign(cached);

        yield* context.backend.setNextResponse({ protocolVersion: 1, ...signedCache });
        yield* command({ command: "checkNow" });

        for (const stage of stages) {
          for (const updateEligibility of updateEligibilityCases) {
            const signed = yield* context.keypair.sign(updateEligibility);
            yield* context.backend.setNextPreActionCheckResponse({ protocolVersion: 1, ...signed });
            yield* context.backend.setNextResponse({ protocolVersion: 1, ...signed });
            const before = (yield* context.backend.receivedPreActionChecks()).length;

            yield* assertAction(command, { stage, proceeds: updateEligibility.type !== "held" });
            yield* assertRequest(context, stage, before);
            deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), updateEligibility);
          }
        }
      }),
    ),
};

const preActionCheckFailureFailsOpen: Scenario = {
  name: "production download and apply proceed on invalid signatures, malformed eligibility verdicts and HTTP failure",
  tier: 1,
  run: (context) =>
    withAdapter(context, (command) =>
      Effect.gen(function* () {
        const invalid = yield* invalidUpdateEligibilityResponses(context.keypair);
        const cached = {
          type: "held" as const,
          issuedAt: "2026-01-01T00:00:00.000Z",
          environment: "cached",
        };
        const signed = yield* context.keypair.sign(cached);
        yield* context.backend.setNextResponse({ protocolVersion: 1, ...signed });
        yield* command({ command: "checkNow" });

        for (const stage of stages) {
          for (const response of invalid) {
            yield* context.backend.setNextPreActionCheckResponse(response);
            const before = (yield* context.backend.receivedPreActionChecks()).length;
            yield* assertAction(command, { stage, proceeds: true });
            yield* assertRequest(context, stage, before);
            deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), cached);
          }

          yield* context.backend.setNextPreActionCheckFailure({ shouldFail: true });
          const before = (yield* context.backend.receivedPreActionChecks()).length;
          yield* assertAction(command, { stage, proceeds: true });
          yield* assertRequest(context, stage, before);
          deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), cached);
          yield* context.backend.setNextPreActionCheckFailure({ shouldFail: false });
        }
      }),
    ),
};

const preActionCheckTransportFailureFailsOpen: Scenario = {
  name: "production download and apply proceed when the backend cannot be reached",
  tier: 1,
  run: (context) =>
    withAdapter(
      { ...context, backend: { ...context.backend, baseUrl: "http://127.0.0.1:0" } },
      (command) =>
        Effect.gen(function* () {
          for (const stage of stages) {
            yield* assertAction(command, { stage, proceeds: true });
            deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), null);
          }
        }),
    ),
};

const preActionCheckWaitsForResponse: Scenario = {
  name: "neither download nor apply starts before its pre-action response",
  tier: 1,
  run: (context) =>
    withAdapter(context, (command) =>
      Effect.gen(function* () {
        const signed = yield* context.keypair.sign({
          type: "unrestricted",
          issuedAt: "2026-01-01T00:00:00.000Z",
          environment: "test",
        });
        yield* context.backend.setNextPreActionCheckResponse({ protocolVersion: 1, ...signed });
        yield* context.backend.setNextPreActionCheckDelay("300 millis");

        for (const stage of stages) {
          yield* command({ command: "prepareAction", stage });
          const before = yield* updaterActivity(command);
          yield* Effect.all(
            [
              command({ command: "runAction", stage }),
              Effect.gen(function* () {
                yield* Effect.sleep("100 millis");
                deepStrictEqual(yield* updaterActivity(command), before);
              }),
            ],
            { concurrency: "unbounded" },
          );
          const after = yield* updaterActivity(command);
          const field = stage === "pre-download" ? "downloads" : "applies";
          deepStrictEqual(after, { ...before, [field]: before[field] + 1 });
        }
      }),
    ),
};

const boundedPreActionCheckTimeoutFailsOpen: Scenario = {
  name: "production download and apply proceed within a bounded timeout",
  tier: 2,
  run: (context) =>
    withAdapter(context, (command) =>
      Effect.gen(function* () {
        yield* context.backend.setNextPreActionCheckDelay("20 seconds");
        for (const stage of stages) yield* assertAction(command, { stage, proceeds: true });
      }),
    ),
};

export const preActionCheckScenarios = [
  preActionCheckRoundTrip,
  preActionCheckFailureFailsOpen,
  preActionCheckTransportFailureFailsOpen,
  preActionCheckWaitsForResponse,
  boundedPreActionCheckTimeoutFailsOpen,
];

export const applyingStateSync: Scenario = {
  name: "native apply awaits its applying check-in during a state-sync burst and an active heartbeat",
  tier: 1,
  run: (context) =>
    withAdapter(
      context,
      (command) =>
        Effect.gen(function* () {
          const signed = yield* context.keypair.sign({
            type: "held",
            issuedAt: new Date().toISOString(),
            environment: "test",
          });
          yield* context.backend.setNextResponse({ protocolVersion: 1, ...signed });
          const allowed = yield* context.keypair.sign({
            type: "unrestricted",
            issuedAt: new Date().toISOString(),
            environment: "test",
          });
          yield* context.backend.setNextPreActionCheckResponse({ protocolVersion: 1, ...allowed });
          yield* command({ command: "checkNow" });
          yield* command({ command: "prepareAction", stage: "pre-apply" });
          yield* waitForIdle(command);

          yield* context.backend.setNextCheckInDelay("800 millis");
          const count = (yield* context.backend.receivedCheckIns()).length;
          yield* command({ command: "triggerLifecycle", event: "foreground" });
          for (let attempt = 0; attempt < 200; attempt++) {
            if ((yield* context.backend.receivedCheckIns()).length > count) break;
            yield* Effect.sleep("20 millis");
          }
          strictEqual((yield* context.backend.receivedCheckIns()).length, count + 1);
          const before = yield* updaterActivity(command);

          yield* Effect.all(
            [
              command({ command: "runAction", stage: "pre-apply" }),
              Effect.gen(function* () {
                yield* Effect.sleep("300 millis");
                deepStrictEqual(yield* updaterActivity(command), before);
              }),
            ],
            { concurrency: "unbounded" },
          );

          strictEqual((yield* updaterActivity(command)).applies, before.applies + 1);
          ok(
            (yield* context.backend.receivedCheckIns()).some(
              (request) => request.lifecycleState.type === "applying",
            ),
          );
        }),
      { lifecycle: true },
    ),
};
