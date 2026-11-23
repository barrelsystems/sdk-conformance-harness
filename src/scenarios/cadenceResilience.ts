import { waitForCheckIns, waitForIdle, readState } from "../fixtures/runtimeAssertions.js";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import * as Effect from "effect/Effect";
import type { Scenario, ScenarioContext } from "../runner/scenario.js";
import type { AdapterCommand, CreateAdapterRequest } from "../protocol/testServiceApi.js";
import { updaterActivity, withAdapter as withRuntimeAdapter } from "../fixtures/adapterFixture.js";

import { applyingStateSync } from "./preActionCheck.js";
import { referenceJitterFraction } from "../protocol/jitter.js";

type Command = (payload: AdapterCommand) => Effect.Effect<unknown, unknown>;

function withAdapter(
  context: ScenarioContext,
  config: Partial<CreateAdapterRequest>,
  run: (command: Command) => Effect.Effect<void, unknown>,
) {
  return Effect.gen(function* () {
    const signed = yield* context.keypair.sign({
      type: "held",
      issuedAt: new Date().toISOString(),
      environment: "test",
    });
    yield* context.backend.setNextResponse({ protocolVersion: 1, ...signed });
    yield* withRuntimeAdapter(context, run, config);
  });
}

const boundedAttributes: Scenario = {
  name: "production check-ins bound attribute keys and UTF-8 value bytes without corrupting text",
  tier: 1,
  run: (context) =>
    Effect.gen(function* () {
      const oversized = Object.fromEntries(
        Array.from({ length: 25 }, (_, i) => [`key-${i}`, "x" + "😀".repeat(80)]),
      );
      const cases: Record<string, string>[] = [
        { small: "café 😀", exact: "x".repeat(256) },
        oversized,
      ];
      for (const attributes of cases) {
        yield* withAdapter(context, { attributes }, (command) =>
          Effect.gen(function* () {
            const before = (yield* context.backend.receivedCheckIns()).length;
            yield* command({ command: "checkNow" });
            const requests = yield* waitForCheckIns(context, before + 1);
            const saved = requests.at(-1)?.attributes;
            ok(saved);
            strictEqual(Object.keys(saved).length, Math.min(20, Object.keys(attributes).length));

            for (const [key, value] of Object.entries(saved)) {
              ok(Buffer.byteLength(value, "utf8") <= 256);
              ok(!value.includes("\uFFFD"));
              ok(attributes[key]?.startsWith(value));
              if (Buffer.byteLength(attributes[key] ?? "", "utf8") <= 256)
                strictEqual(value, attributes[key]);
            }
          }),
        );
      }
    }),
};

const installationPersistenceRecovery: Scenario = {
  name: "failed installation-ID persistence retries the same runtime ID once storage recovers",
  tier: 1,
  run: (context) =>
    withAdapter(context, { installationPersistence: "failed", lifecycle: true }, (command) =>
      Effect.gen(function* () {
        const first = (yield* waitForCheckIns(context, 1))[0];
        yield* waitForIdle(command);
        ok(first);
        ok(/^[0-9a-f-]{36}$/i.test(first.installationId));
        strictEqual(yield* command({ command: "getPersistedInstallationId" }), null);
        yield* command({ command: "restoreInstallationPersistence" });
        strictEqual(
          yield* command({ command: "getPersistedInstallationId" }),
          null,
          "restoring storage must not supply the persistence retry",
        );

        const count = (yield* context.backend.receivedCheckIns()).length;
        yield* command({ command: "triggerLifecycle", event: "foreground" });
        const requests = yield* waitForCheckIns(context, count + 1);
        yield* waitForIdle(command);
        strictEqual(
          yield* command({ command: "getPersistedInstallationId" }),
          first.installationId,
        );
        ok(requests.every((request) => request.installationId === first.installationId));
      }),
    ),
};

const cadenceIntervalAndDebug: Scenario = {
  name: "native scheduling clamps cadence bounds and reports the nominal interval independently of jitter",
  tier: 1,
  run: (context) =>
    Effect.gen(function* () {
      for (const config of [
        { checkInIntervalMs: 1 },
        { checkInIntervalMs: 1, debug: false },
        { checkInIntervalMs: 1, debug: true },
        { checkInIntervalMs: 3_600_000, debug: true },
        { checkInIntervalMs: 7_200_000, debug: true },
        { checkInIntervalMs: 21_600_000, debug: true },
      ]) {
        const count = (yield* context.backend.receivedCheckIns()).length;
        yield* withAdapter(context, { ...config, lifecycle: true }, (command) =>
          Effect.gen(function* () {
            const requests = yield* waitForCheckIns(context, count + 1);
            const id = requests.at(-1)?.installationId;
            ok(id);
            const state = yield* readState(command);
            ok(state.intervalMs !== null);
            const nominal = Math.min(7_200_000, Math.max(900_000, config.checkInIntervalMs));
            strictEqual(requests.at(-1)?.checkInIntervalMs, nominal);
            const expected = nominal * (1 + referenceJitterFraction(id));
            ok(Math.abs(state.intervalMs - expected) <= 1);
            if (!config.debug) deepStrictEqual(state.logs, []);
            else if (config.checkInIntervalMs !== nominal)
              ok(state.logs.some((line) => line.includes("clamped")));
          }),
        );
      }
    }),
};

const stateSyncDebounce: Scenario = {
  name: "reportable native transitions sync immediately and debounce until five quiet seconds",
  tier: 1,
  run: (context) =>
    withAdapter(context, { lifecycle: true }, (command) =>
      Effect.gen(function* () {
        yield* waitForCheckIns(context, 1);
        yield* waitForIdle(command);
        yield* Effect.sleep("5500 millis");
        const before = (yield* context.backend.receivedCheckIns()).length;

        yield* command({ command: "prepareAction", stage: "pre-download" });
        const leading = yield* waitForCheckIns(context, before + 1);
        strictEqual(leading.at(-1)?.lifecycleState.type, "available");
        yield* Effect.sleep("3 seconds");
        yield* command({ command: "prepareAction", stage: "pre-download" });
        const afterPreparation = yield* updaterActivity(command);
        yield* Effect.sleep("2500 millis");
        strictEqual((yield* context.backend.receivedCheckIns()).length, before + 1);

        yield* Effect.sleep("3 seconds");
        const requests = yield* waitForCheckIns(context, before + 2);
        strictEqual(requests.length, before + 2);
        strictEqual(requests.at(-1)?.lifecycleState.type, "available");
        strictEqual(requests.at(-1)?.checkInIntervalMs, 1_800_000);
        deepStrictEqual(yield* updaterActivity(command), afterPreparation);
      }),
    ),
};

const lifecycleCheckIns: Scenario = {
  name: "native foreground and supported resume triggers check in without overlapping or queuing attempts",
  tier: 1,
  run: (context) =>
    withAdapter(context, { lifecycle: true }, (command) =>
      Effect.gen(function* () {
        yield* waitForCheckIns(context, 1);
        yield* waitForIdle(command);
        const state = yield* readState(command);
        ok(state.lifecycleEvents.includes("foreground"));
        const capabilities = yield* context.testService.testService.capabilities();
        if (capabilities.sdkName !== "tauri") ok(state.lifecycleEvents.includes("resume"));

        for (const event of state.lifecycleEvents) {
          const before = (yield* context.backend.receivedCheckIns()).length;
          yield* context.backend.setNextCheckInDelay("400 millis");
          yield* command({ command: "triggerLifecycle", event });
          yield* waitForCheckIns(context, before + 1);
          yield* command({ command: "triggerLifecycle", event });
          yield* waitForIdle(command);
          yield* Effect.sleep("100 millis");
          strictEqual(
            (yield* context.backend.receivedCheckIns()).length,
            before + 1,
            "in-flight lifecycle trigger must be skipped, not queued",
          );
          strictEqual(yield* context.backend.peakConcurrentCheckIns(), 1);
          yield* context.backend.setNextCheckInDelay(null);
          yield* command({ command: "triggerLifecycle", event });
          yield* waitForCheckIns(context, before + 2);
          yield* waitForIdle(command);
        }
      }),
    ),
};

const busyStateSync: Scenario = {
  name: "a reportable transition during an in-flight heartbeat is sent after that request finishes",
  tier: 1,
  run: (context) =>
    withAdapter(context, { lifecycle: true }, (command) =>
      Effect.gen(function* () {
        yield* waitForCheckIns(context, 1);
        yield* waitForIdle(command);
        yield* Effect.sleep("5500 millis");
        const before = (yield* context.backend.receivedCheckIns()).length;
        yield* context.backend.setNextCheckInDelay("600 millis");
        yield* command({ command: "triggerLifecycle", event: "foreground" });
        yield* waitForCheckIns(context, before + 1);
        yield* command({ command: "prepareAction", stage: "pre-download" });
        const requests = yield* waitForCheckIns(context, before + 2);
        strictEqual(requests.at(-1)?.lifecycleState.type, "available");
      }),
    ),
};

export const cadenceResilienceScenarios = [
  boundedAttributes,
  installationPersistenceRecovery,
  cadenceIntervalAndDebug,
  lifecycleCheckIns,
  stateSyncDebounce,
  applyingStateSync,
  busyStateSync,
];
