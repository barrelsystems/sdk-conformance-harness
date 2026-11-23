import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { startMockBackend } from "./mockBackend.js";

it("retains raw check-in fields that schema decoding would otherwise strip", () =>
  Effect.gen(function* () {
    const backend = yield* startMockBackend();
    yield* backend.setNextResponse({
      protocolVersion: 1,
      updateEligibility: "{}",
      signature: "test",
    });
    const request = {
      protocolVersion: 1,
      installationId: "00000000-0000-4000-8000-000000000001",
      eventId: "00000000-0000-4000-8000-000000000002",
      checkedInAt: new Date().toISOString(),
      sdkVersion: "test",
      observedVersion: "test",
      channel: "stable",
      platform: "test",
      arch: "test",
      osVersion: "test",
      attributes: {},
      lifecycleState: { type: "idle" },
      bufferedFacts: [
        {
          kind: "updateError",
          firstObservedAt: "test",
          lastObservedAt: "test",
          occurrenceCount: 1,
          phase: "download",
          failureMode: "unknown",
          platformCode: "test",
          title: "must remain visible to the assertion",
        },
      ],
    };
    const response = yield* Effect.promise(() =>
      fetch(`${backend.baseUrl}/check-in`, {
        method: "POST",
        headers: { authorization: "Bearer test", "content-type": "application/json" },
        body: JSON.stringify(request),
      }),
    );
    expect(response.status).toBe(200);
    expect(yield* backend.receivedRawCheckIns()).toEqual([request]);
    expect((yield* backend.receivedCheckIns())[0]?.bufferedFacts?.[0]).not.toHaveProperty("title");
  }).pipe(Effect.scoped, Effect.runPromise));
