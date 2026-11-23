import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Scenario, ScenarioContext } from "../runner/scenario.js";
import type { FactObservation } from "../protocol/testServiceApi.js";
import { UpdateState } from "../protocol/wireContract.js";
import { withAdapter, type AdapterCommands } from "../fixtures/adapterFixture.js";

const StoredFact = Schema.Struct({
  kind: Schema.Literals(["lifecycleState", "updateError"]),
  state: Schema.optionalKey(UpdateState),
  failure: Schema.optionalKey(Schema.Struct({ platformCode: Schema.String })),
  firstObservedAt: Schema.String,
  lastObservedAt: Schema.String,
  occurrenceCount: Schema.Number,
});
type StoredFact = typeof StoredFact.Type;

function readFacts(command: AdapterCommands) {
  return command({ command: "getBufferedFacts" }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredFact))),
  );
}

function record(
  command: AdapterCommands,
  facts: readonly FactObservation[],
  options: { concurrent?: boolean } = {},
) {
  return command({ command: "recordFacts", facts, concurrent: options.concurrent ?? false });
}

function state(type: "idle" | "downloaded" | "update-cancelled"): FactObservation {
  return { kind: "lifecycleState", state: { type } };
}

function progress(value: number): FactObservation {
  return { kind: "lifecycleState", state: { type: "downloading", progress: value } };
}

function failure(code: string): FactObservation {
  return { kind: "updateError", platformCode: code };
}

function withBuffer(
  context: ScenarioContext,
  run: (command: AdapterCommands) => Effect.Effect<void, unknown>,
) {
  return Effect.gen(function* () {
    const signed = yield* context.keypair.sign({
      type: "held",
      issuedAt: new Date().toISOString(),
      environment: "test",
    });
    yield* context.backend.setNextResponse({ protocolVersion: 1, ...signed });
    yield* withAdapter(context, (command) =>
      Effect.gen(function* () {
        yield* command({ command: "checkNow" });
        yield* command({ command: "clearBuffer" });
        yield* run(command);
      }),
    );
  });
}

function assertPersisted(command: AdapterCommands) {
  return Effect.gen(function* () {
    const memory = yield* command({ command: "getBufferedFacts" });
    const disk = yield* command({ command: "getPersistedBuffer" }).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.Struct({ facts: Schema.Array(Schema.Unknown) })),
      ),
    );
    deepStrictEqual(disk.facts, memory);
    ok(!JSON.stringify(disk).includes('"title"'));
  });
}

const bufferMerge: Scenario = {
  name: "only adjacent identical facts merge; progress and intervening observations remain distinct",
  tier: 1,
  run: (context) =>
    withBuffer(context, (command) =>
      Effect.gen(function* () {
        yield* record(command, [state("downloaded")]);
        const first = (yield* readFacts(command))[0];
        ok(first);

        // Cross the coarsest SDK timestamp resolution: one second.
        yield* Effect.sleep("1100 millis");
        yield* record(command, [
          state("downloaded"),
          progress(10),
          progress(20),
          state("downloaded"),
          failure("repeat"),
          failure("repeat"),
        ]);
        const firstError = (yield* readFacts(command))[4];
        ok(firstError);

        yield* Effect.sleep("1100 millis");
        yield* record(command, [failure("repeat")]);
        const facts = yield* readFacts(command);
        strictEqual(facts.length, 5);
        const merged = facts[0];
        ok(merged);
        strictEqual(merged.occurrenceCount, 2);
        strictEqual(merged.firstObservedAt, first.firstObservedAt);
        ok(Date.parse(merged.lastObservedAt) > Date.parse(first.lastObservedAt));
        deepStrictEqual(
          facts.map((fact) => fact.state?.type ?? fact.failure?.platformCode),
          ["downloaded", "downloading", "downloading", "downloaded", "repeat"],
        );
        const mergedError = facts[4];
        ok(mergedError);
        strictEqual(mergedError.occurrenceCount, 3);
        strictEqual(mergedError.firstObservedAt, firstError.firstObservedAt);
        ok(Date.parse(mergedError.lastObservedAt) > Date.parse(firstError.lastObservedAt));
        yield* record(command, [
          { kind: "lifecycleState", state: { type: "available", releaseNotes: "first notes" } },
          { kind: "lifecycleState", state: { type: "available", releaseNotes: "second notes" } },
        ]);
        strictEqual((yield* readFacts(command)).length, 7);
        yield* assertPersisted(command);
        yield* command({ command: "clearBuffer" });
        yield* command({ command: "prepareAction", stage: "pre-download" });
        let observed = false;

        for (let attempt = 0; attempt < 50; attempt++) {
          if ((yield* readFacts(command)).some((fact) => fact.state?.type === "available")) {
            observed = true;
            break;
          }

          yield* Effect.sleep("20 millis");
        }

        ok(observed, "the production adapter must record its available transition in this buffer");
      }),
    ),
};

const bufferEviction: Scenario = {
  name: "the 32-fact bound preserves terminal facts and evicts the oldest equal-priority observation",
  tier: 1,
  run: (context) =>
    withBuffer(context, (command) =>
      Effect.gen(function* () {
        yield* record(
          command,
          Array.from({ length: 32 }, (_, i) => progress(i)),
        );
        yield* record(command, [failure("terminal"), progress(32)]);
        let facts = yield* readFacts(command);
        strictEqual(facts.length, 32);
        ok(facts.some((fact) => fact.failure?.platformCode === "terminal"));
        deepStrictEqual(
          facts
            .filter((fact) => fact.state?.type === "downloading")
            .map((fact) => (fact.state?.type === "downloading" ? fact.state.progress : null)),
          Array.from({ length: 31 }, (_, i) => i + 2),
        );
        yield* command({ command: "clearBuffer" });
        yield* record(
          command,
          Array.from({ length: 32 }, (_, i) => failure(`terminal-${i}`)),
        );
        yield* record(command, [progress(90)]);
        facts = yield* readFacts(command);
        strictEqual(facts.length, 32);
        ok(facts.every((fact) => fact.kind === "updateError"));
        yield* record(command, [failure("terminal-32")]);
        facts = yield* readFacts(command);
        deepStrictEqual(
          facts.map((fact) => fact.failure?.platformCode),
          Array.from({ length: 32 }, (_, i) => `terminal-${i + 1}`),
        );
        yield* command({ command: "clearBuffer" });
        yield* record(command, [
          state("downloaded"),
          state("update-cancelled"),
          {
            kind: "lifecycleState",
            state: {
              type: "failed",
              category: "download",
              code: "unknown",
              platformCode: "failed",
            },
          },
          ...Array.from({ length: 29 }, (_, i) => progress(i)),
        ]);
        yield* record(command, [progress(90)]);
        facts = yield* readFacts(command);
        deepStrictEqual(
          facts.slice(0, 3).map((fact) => fact.state?.type),
          ["downloaded", "update-cancelled", "failed"],
        );
        strictEqual(facts.length, 32);
        yield* assertPersisted(command);
      }),
    ),
};

const bufferAcknowledgment: Scenario = {
  name: "failed and delayed check-ins preserve facts; acknowledgment clears only the sent snapshot",
  tier: 1,
  run: (context) =>
    withBuffer(context, (command) =>
      Effect.gen(function* () {
        yield* record(command, [failure("snapshot")]);
        yield* context.backend.setNextCheckInFailure({ shouldFail: true });
        yield* command({ command: "checkNow" });
        strictEqual((yield* readFacts(command)).length, 1);
        yield* context.backend.setNextCheckInFailure({ shouldFail: false });
        yield* context.backend.setNextCheckInDelay("400 millis");
        yield* Effect.all(
          [
            command({ command: "checkNow" }),
            Effect.gen(function* () {
              yield* Effect.sleep("100 millis");
              strictEqual((yield* readFacts(command)).length, 1);
              yield* record(command, [
                failure("snapshot"),
                state("downloaded"),
                failure("snapshot"),
              ]);
            }),
          ],
          { concurrency: "unbounded" },
        );
        const remaining = yield* readFacts(command);
        strictEqual(remaining.length, 3);
        strictEqual(remaining[0]?.occurrenceCount, 2);
        strictEqual(remaining[2]?.occurrenceCount, 1);
        strictEqual(remaining[2]?.failure?.platformCode, "snapshot");
        const raw = yield* context.backend.receivedRawCheckIns();
        ok(!JSON.stringify(raw).includes('"title"'));
        const requests = yield* context.backend.receivedCheckIns();
        const sent = requests.at(-1)?.bufferedFacts;
        strictEqual(sent?.length, 1);
        strictEqual(sent?.[0]?.occurrenceCount, 1);
        yield* assertPersisted(command);
        yield* context.backend.setNextCheckInDelay(null);
        yield* command({ command: "checkNow" });
        deepStrictEqual(yield* readFacts(command), []);
        yield* assertPersisted(command);
      }),
    ),
};

const bufferConcurrentWrites: Scenario = {
  name: "concurrent observations persist the complete buffer without derived titles",
  tier: 1,
  run: (context) =>
    withBuffer(context, (command) =>
      Effect.gen(function* () {
        yield* record(
          command,
          Array.from({ length: 64 }, () => failure("concurrent")),
          { concurrent: true },
        );
        const facts = yield* readFacts(command);
        strictEqual(facts.length, 1);
        strictEqual(facts[0]?.occurrenceCount, 64);
        yield* assertPersisted(command);
      }),
    ),
};

const bufferProcessExit: Scenario = {
  name: "a real process exit restores the latest buffer through the production synchronous exit hook",
  tier: 1,
  run: (context) =>
    withBuffer(context, (command) =>
      Effect.gen(function* () {
        const result = yield* command({
          command: "probeBufferExit",
          mode: "settled",
          facts: [state("downloaded"), failure("exit-probe")],
        }).pipe(Effect.timeout("20 seconds"));
        ok(!JSON.stringify(result).includes('"title"'));
        const { facts, recoveredFacts } = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            facts: Schema.Array(StoredFact),
            recoveredFacts: Schema.Array(StoredFact),
          }),
        )(result);
        deepStrictEqual(recoveredFacts, facts);
        strictEqual(facts.length, 2);
        strictEqual(facts[0]?.state?.type, "downloaded");
        strictEqual(facts[1]?.failure?.platformCode, "exit-probe");
      }),
    ),
};

const bufferBlockedWrites: Scenario = {
  name: "blocked disk writes leave observations responsive and persist the latest complete snapshot",
  tier: 1,
  run: (context) =>
    withBuffer(context, (command) =>
      Effect.gen(function* () {
        yield* command({ command: "setBufferPersistence", mode: "blocked" });
        yield* record(command, [state("idle")]).pipe(Effect.timeout("2 seconds"));
        let blocked = false;

        for (let attempt = 0; attempt < 100; attempt++) {
          const status = yield* command({ command: "getBufferPersistenceState" }).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.Struct({ blockedWrite: Schema.Boolean })),
            ),
          );
          if (status.blockedWrite) {
            blocked = true;
            break;
          }

          yield* Effect.sleep("20 millis");
        }

        ok(blocked, "the native disk writer must actually be waiting");
        yield* record(command, [state("downloaded"), failure("latest")]).pipe(
          Effect.timeout("2 seconds"),
        );
        strictEqual((yield* readFacts(command).pipe(Effect.timeout("2 seconds"))).length, 3);
        yield* command({ command: "setBufferPersistence", mode: "normal" });
        yield* assertPersisted(command);
      }).pipe(
        Effect.ensuring(
          command({ command: "setBufferPersistence", mode: "normal" }).pipe(Effect.orDie),
        ),
      ),
    ),
};

const bufferFailedWrites: Scenario = {
  name: "failed native writes preserve memory and the next observation retries the complete snapshot",
  tier: 1,
  run: (context) =>
    withBuffer(context, (command) =>
      Effect.gen(function* () {
        yield* command({ command: "setBufferPersistence", mode: "failed" });
        yield* record(command, [failure("disk-failed")]).pipe(Effect.timeout("2 seconds"));
        strictEqual((yield* readFacts(command)).length, 1);
        yield* command({ command: "setBufferPersistence", mode: "normal" });
        yield* record(command, [state("downloaded")]);
        strictEqual((yield* readFacts(command)).length, 2);
        yield* assertPersisted(command);
      }).pipe(
        Effect.ensuring(
          command({ command: "setBufferPersistence", mode: "normal" }).pipe(Effect.orDie),
        ),
      ),
    ),
};

const bufferPendingExit: Scenario = {
  name: "orderly exit with a blocked pending write recovers the latest complete buffer in a fresh process",
  tier: 1,
  run: (context) =>
    withBuffer(context, (command) =>
      Effect.gen(function* () {
        const result = yield* command({
          command: "probeBufferExit",
          mode: "pending",
          facts: [state("idle"), state("downloaded"), failure("pending-exit")],
        }).pipe(Effect.timeout("20 seconds"));
        ok(!JSON.stringify(result).includes('"title"'));
        const saved = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            facts: Schema.Array(StoredFact),
            recoveredFacts: Schema.Array(StoredFact),
            pendingWriteObserved: Schema.Boolean,
          }),
        )(result);
        ok(saved.pendingWriteObserved);
        strictEqual(saved.facts.length, 3);
        strictEqual(saved.facts[2]?.failure?.platformCode, "pending-exit");
        deepStrictEqual(saved.recoveredFacts, saved.facts);
      }),
    ),
};

export const bufferedFactsScenarios = [
  bufferMerge,
  bufferEviction,
  bufferAcknowledgment,
  bufferConcurrentWrites,
  bufferProcessExit,
  bufferBlockedWrites,
  bufferFailedWrites,
  bufferPendingExit,
];
