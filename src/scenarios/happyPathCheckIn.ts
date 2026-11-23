import * as Effect from "effect/Effect";
import { withAdapter } from "../fixtures/adapterFixture.js";
import type { Scenario } from "../runner/scenario.js";

/** An unrestricted decision preserves idle state and reports both default and verbatim channel keys. */
export const happyPathCheckIn: Scenario = {
  name: "an unrestricted eligibility leaves the adapter idle",
  tier: 1,
  run: (context) =>
    Effect.gen(function* () {
      const { backend, keypair } = context;

      for (const channel of [undefined, "Beta / Custom", ""]) {
        const signed = yield* keypair.sign({
          type: "unrestricted",
          issuedAt: new Date().toISOString(),
          environment: "conformance-harness",
        });
        yield* backend.setNextResponse({
          protocolVersion: 1,
          updateEligibility: signed.updateEligibility,
          signature: signed.signature,
        });

        yield* withAdapter(
          context,
          (command) =>
            Effect.gen(function* () {
              yield* command({ command: "checkNow" });
              const checkIns = yield* backend.receivedCheckIns();
              const latest = checkIns[checkIns.length - 1];

              const expectedChannel = channel ?? "stable";

              if (latest?.channel !== expectedChannel) {
                return yield* Effect.die(
                  new Error(
                    `expected channel ${JSON.stringify(expectedChannel)}, got ${JSON.stringify(latest?.channel)}`,
                  ),
                );
              }

              const state = { result: yield* command({ command: "getUpdateState" }) };

              if (
                typeof state.result !== "object" ||
                state.result === null ||
                (state.result as { type?: unknown }).type !== "idle"
              ) {
                return yield* Effect.die(
                  new Error(
                    `expected adapter state "idle" after an unrestricted update eligibility, got ${JSON.stringify(state.result)}`,
                  ),
                );
              }
            }),
          channel === undefined ? {} : { channel },
        );
      }
    }),
};
