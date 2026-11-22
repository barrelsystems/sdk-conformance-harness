import * as Effect from "effect/Effect";
import type { Scenario } from "../harness/scenario.js";

/** The simplest conformance check: a `current` policy must leave the
 * adapter reporting `idle` -- the tracer-bullet case every check-in loop
 * must get right first, with default and verbatim configured channel keys. */
export const happyPathCheckIn: Scenario = {
  name: "a current policy leaves the adapter idle",
  tier: 1,
  run: ({ backend, keypair, testService }) =>
    Effect.gen(function* () {
      for (const channel of [undefined, "Beta / Custom", ""]) {
        const signed = yield* keypair.sign({
          type: "current",
          issuedAt: new Date().toISOString(),
          environment: "conformance-harness",
        });
        yield* backend.setNextResponse({
          protocolVersion: 1,
          policy: signed.policy,
          signature: signed.signature,
        });

        const adapter = yield* testService.testService.createAdapter({
          payload: {
            checkInBaseUrl: backend.baseUrl,
            publicKeyPem: keypair.publicKeyPem,
            ...(channel === undefined ? {} : { channel }),
          },
        });

        yield* testService.testService.runCommand({
          params: { id: adapter.id },
          payload: { command: "checkNow" },
        });
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

        const state = yield* testService.testService.runCommand({
          params: { id: adapter.id },
          payload: { command: "getAdapterState" },
        });

        if (
          typeof state.result !== "object" ||
          state.result === null ||
          (state.result as { type?: unknown }).type !== "idle"
        ) {
          return yield* Effect.die(
            new Error(
              `expected adapter state "idle" after a current policy, got ${JSON.stringify(state.result)}`,
            ),
          );
        }

        yield* testService.testService.destroyAdapter({ params: { id: adapter.id } });
      }
    }),
};
