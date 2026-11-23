import { ok, strictEqual } from "node:assert/strict";
import * as Effect from "effect/Effect";
import type { Scenario } from "../runner/scenario.js";
import { withAdapter } from "../fixtures/adapterFixture.js";

export const wireIdentity: Scenario = {
  name: "check-ins generate fresh event identities and valid timestamps while preserving installation identity",
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
          for (let tick = 0; tick < 3; tick++) yield* command({ command: "checkNow" });
          const requests = yield* context.backend.receivedCheckIns();
          ok(requests.length >= 3);
          strictEqual(new Set(requests.map(({ eventId }) => eventId)).size, requests.length);
          strictEqual(new Set(requests.map(({ installationId }) => installationId)).size, 1);
          ok(requests.every(({ checkedInAt }) => Number.isFinite(Date.parse(checkedInAt))));
          const headers = yield* context.backend.receivedCheckInAuthorization();
          strictEqual(headers.length, requests.length);
          ok(headers.every((value) => value === "Bearer test-service"));
        }),
      );
    }),
};
