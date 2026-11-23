import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ScenarioContext } from "../runner/scenario.js";
import type { AdapterCommands as Command } from "./adapterFixture.js";

const CadenceState = Schema.Struct({
  intervalMs: Schema.NullOr(Schema.Number),
  inFlight: Schema.Boolean,
  logs: Schema.Array(Schema.String),
  lifecycleEvents: Schema.Array(Schema.Literals(["foreground", "resume"])),
});

export function waitForCheckIns(context: ScenarioContext, count: number) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      const received = yield* context.backend.receivedCheckIns();
      if (received.length >= count) return received;

      yield* Effect.sleep("20 millis");
    }

    return yield* Effect.die(new Error(`expected ${count} production check-ins`));
  });
}

export function readState(command: Command) {
  return command({ command: "getCadenceState" }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(CadenceState)),
  );
}

export function waitForIdle(command: Command) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (!(yield* readState(command)).inFlight) return;
      yield* Effect.sleep("20 millis");
    }
    return yield* Effect.die(new Error("cadence did not become idle"));
  });
}
