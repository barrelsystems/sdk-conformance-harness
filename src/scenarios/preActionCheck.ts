import * as Effect from "effect/Effect";
import type { Scenario } from "../harness/scenario.js";

/** `pre-action-check` conformance coverage. Tier 2: this is a brand-new
 * wire endpoint and `triggerPreActionCheck` a brand-new test-service
 * command -- no real SDK's test service implements it yet, so this is
 * expected to fail there until each one adds support. */
export const preActionCheckRoundTrip: Scenario = {
  name: "pre-action-check sends a well-formed request and the adapter honors the signed policy it gets back",
  tier: 2,
  run: ({ backend, keypair, testService }) =>
    Effect.gen(function* () {
      const signed = yield* keypair.sign({
        type: "held",
        issuedAt: new Date().toISOString(),
        environment: "conformance-harness",
        reason: "maintenance window",
      });

      yield* backend.setNextPreActionCheckResponse({
        protocolVersion: 1,
        policy: signed.policy,
        signature: signed.signature,
      });

      const adapter = yield* testService.testService.createAdapter({
        payload: { checkInBaseUrl: backend.baseUrl, publicKeyPem: keypair.publicKeyPem },
      });
      const result = yield* testService.testService.runCommand({
        params: { id: adapter.id },
        payload: { command: "triggerPreActionCheck", stage: "pre-download" },
      });

      const received = yield* backend.receivedPreActionChecks();
      const lastRequest = received.at(-1);

      if (lastRequest?.stage !== "pre-download") {
        return yield* Effect.die(
          new Error(
            `expected the request to carry stage "pre-download", got ${JSON.stringify(lastRequest)}`,
          ),
        );
      }
      if (result.result !== "held") {
        return yield* Effect.die(
          new Error(
            `expected the adapter to resolve a "held" policy from pre-action-check, got ${JSON.stringify(result.result)}`,
          ),
        );
      }

      yield* testService.testService.destroyAdapter({ params: { id: adapter.id } });
    }),
};
