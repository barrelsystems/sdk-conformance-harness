import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Scenario, ScenarioContext } from "../harness/scenario.js";
import type { AdapterCommand, CreateAdapterRequest } from "../protocol/testServiceApi.js";
import { withPolicyAdapter } from "./policy.js";
import { referenceJitterFraction } from "../protocol/jitter.js";

const CadenceState = Schema.Struct({
  intervalMs: Schema.NullOr(Schema.Number),
  inFlight: Schema.Boolean,
  logs: Schema.Array(Schema.String),
  lifecycleEvents: Schema.Array(Schema.Literals(["foreground", "resume"])),
});
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
    yield* withPolicyAdapter(context, run, config);
  });
}

function waitForCheckIns(context: ScenarioContext, count: number) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      const received = yield* context.backend.receivedCheckIns();
      if (received.length >= count) return received;

      yield* Effect.sleep("20 millis");
    }

    return yield* Effect.die(new Error(`expected ${count} production check-ins`));
  });
}

function readState(command: Command) {
  return command({ command: "getCadenceState" }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(CadenceState)),
  );
}

function waitForIdle(command: Command) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (!(yield* readState(command)).inFlight) return;
      yield* Effect.sleep("20 millis");
    }
    return yield* Effect.die(new Error("cadence did not become idle"));
  });
}

export const boundedAttributes: Scenario = {
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

export const installationPersistenceRecovery: Scenario = {
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

export const cadenceIntervalAndDebug: Scenario = {
  name: "native scheduling clamps the interval floor and debug output is opt-in",
  tier: 1,
  run: (context) =>
    Effect.gen(function* () {
      for (const config of [
        { checkInIntervalMs: 1 },
        { checkInIntervalMs: 1, debug: false },
        { checkInIntervalMs: 1, debug: true },
        { checkInIntervalMs: 3_600_000, debug: true },
      ]) {
        const count = (yield* context.backend.receivedCheckIns()).length;
        yield* withAdapter(context, { ...config, lifecycle: true }, (command) =>
          Effect.gen(function* () {
            const requests = yield* waitForCheckIns(context, count + 1);
            const id = requests.at(-1)?.installationId;
            ok(id);
            const state = yield* readState(command);
            ok(state.intervalMs !== null);
            const expected =
              Math.max(900_000, config.checkInIntervalMs) * (1 + referenceJitterFraction(id));
            ok(Math.abs(state.intervalMs - expected) <= 1);
            if (!config.debug) deepStrictEqual(state.logs, []);
            else if (config.checkInIntervalMs < 900_000)
              ok(state.logs.some((line) => line.includes("clamped")));
          }),
        );
      }
    }),
};

export const lifecycleCheckIns: Scenario = {
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

export const cadenceResilienceScenarios = [
  boundedAttributes,
  installationPersistenceRecovery,
  cadenceIntervalAndDebug,
  lifecycleCheckIns,
];
