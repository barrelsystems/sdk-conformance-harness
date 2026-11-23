import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { startCheckInFaultProxy } from "./checkInFaultProxy.js";
import { startMockBackend } from "./mockBackend.js";

const payload = {
  protocolVersion: 1,
  installationId: "00000000-0000-4000-8000-000000000001",
  eventId: "00000000-0000-4000-8000-000000000002",
  checkedInAt: "2026-01-01T00:00:00.000Z",
  sdkVersion: "test",
  observedVersion: "1",
  channel: "stable",
  platform: "test",
  arch: "test",
  osVersion: "test",
  attributes: {},
  lifecycleState: { type: "idle" },
};

it.each(["disconnect", "http-error", "unreachable"] as const)(
  "injects %s at the real transport boundary and restores the same URL",
  (fault) =>
    Effect.gen(function* () {
      const backend = yield* startMockBackend();
      const body = {
        protocolVersion: 1 as const,
        updateEligibility: "signed update-eligibility bytes",
        signature: "signature",
      };
      yield* backend.setNextResponse(body);
      const proxy = yield* startCheckInFaultProxy(backend.baseUrl);
      function post() {
        return fetch(`${proxy.baseUrl}/check-in`, {
          method: "POST",
          headers: { authorization: "Bearer test", "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      yield* proxy.setFault(fault);
      if (fault === "http-error") {
        const response = yield* Effect.promise(post);
        expect(response.status).toBe(503);
        expect(yield* Effect.promise(() => response.json())).toEqual(body);
      } else {
        yield* Effect.promise(() => expect(post()).rejects.toThrow());
      }

      const attempts = yield* proxy.attempts();
      yield* proxy.setFault("none");
      const response = yield* Effect.promise(post);
      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toEqual(body);
      expect(yield* proxy.attempts()).toBe(attempts + 1);
    }).pipe(Effect.scoped, Effect.runPromise),
);
