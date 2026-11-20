import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { preActionCheckRoundTrip } from "../scenarios/preActionCheck.js";
import {
  checkInFailureFailsOpen,
  noOverlappingCheckInAttempts,
  resilienceScenarios,
} from "../scenarios/resilience.js";
import { startStubTestService } from "../testing/stubTestService.js";
import { runAllScenarios } from "./runAll.js";

describe("resilience and pre-action-check scenarios against the real stub test service", () => {
  it("passes the deterministic resilience scenarios (excludes the slow bounded-timeout one)", () =>
    Effect.gen(function* () {
      const testServiceBaseUrl = yield* startStubTestService();
      const deterministic = resilienceScenarios.filter((scenario) => scenario.tier === 1);
      const results = yield* runAllScenarios(testServiceBaseUrl, deterministic);

      expect(results).toEqual([
        { name: checkInFailureFailsOpen.name, tier: 1, passed: true },
        { name: noOverlappingCheckInAttempts.name, tier: 1, passed: true },
      ]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it("passes the pre-action-check round trip", () =>
    Effect.gen(function* () {
      const testServiceBaseUrl = yield* startStubTestService();
      const results = yield* runAllScenarios(testServiceBaseUrl, [preActionCheckRoundTrip]);

      expect(results).toEqual([{ name: preActionCheckRoundTrip.name, tier: 2, passed: true }]);
    }).pipe(Effect.scoped, Effect.runPromise));
});
