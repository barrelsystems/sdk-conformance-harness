import { inspect } from "node:util";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { referenceJitterFraction } from "../protocol/jitter.js";
import { jitterFractionEquivalence } from "../scenarios/jitterFractionEquivalence.js";
import { startStubTestService } from "../testing/stubTestService.js";
import { runEquivalenceCheck } from "./equivalence.js";

describe("jitterFractionEquivalence", () => {
  it("passes when every SDK's jitter implementation agrees", () =>
    Effect.gen(function* () {
      const electronUrl = yield* startStubTestService({ sdkName: "electron" });
      const tauriUrl = yield* startStubTestService({ sdkName: "tauri" });
      const result = yield* runEquivalenceCheck(
        new Map([
          ["electron", electronUrl],
          ["tauri", tauriUrl],
        ]),
        jitterFractionEquivalence,
      );

      expect(result.passed).toBe(true);
    }).pipe(Effect.scoped, Effect.runPromise));

  // The decisive test: proves this mechanism actually catches drift, not
  // just that it passes when everything already agrees.
  it("fails when one SDK's jitter implementation silently drifts from the reference", () =>
    Effect.gen(function* () {
      const brokenJitterFraction = (installationId: string) =>
        referenceJitterFraction(installationId) + 0.01;
      const electronUrl = yield* startStubTestService({ sdkName: "electron" });
      const tauriUrl = yield* startStubTestService({
        sdkName: "tauri",
        computeJitterFraction: brokenJitterFraction,
      });
      const result = yield* runEquivalenceCheck(
        new Map([
          ["electron", electronUrl],
          ["tauri", tauriUrl],
        ]),
        jitterFractionEquivalence,
      );

      expect(result.passed).toBe(false);
    }).pipe(Effect.scoped, Effect.runPromise));
  it.each([
    new Map([["only", "http://localhost:1"]]),
    new Map([
      ["one", "http://localhost:1"],
      ["alias", "http://localhost:1"],
    ]),
  ])("rejects self-equivalence", async (services) => {
    const result = await Effect.runPromise(
      runEquivalenceCheck(services, jitterFractionEquivalence),
    );
    expect(result.passed).toBe(false);
  });

  it("rejects two endpoints serving the same SDK implementation", () =>
    Effect.gen(function* () {
      const first = yield* startStubTestService();
      const second = yield* startStubTestService();
      const result = yield* runEquivalenceCheck(
        new Map([
          ["first", first],
          ["second", second],
        ]),
        jitterFractionEquivalence,
      );
      expect(result.passed).toBe(false);
      expect(inspect(result.error)).toContain("repeats SDK implementation");
    }).pipe(Effect.scoped, Effect.runPromise));
});
