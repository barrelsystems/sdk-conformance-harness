import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { preActionCheckScenarios } from "../scenarios/preActionCheck.js";
import { policyScenarios } from "../scenarios/policy.js";
import {
  boundedCheckInTimeoutFailsOpen,
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
      const deterministic = resilienceScenarios.filter(
        (scenario) => scenario !== boundedCheckInTimeoutFailsOpen,
      );
      const results = yield* runAllScenarios(testServiceBaseUrl, deterministic);

      expect(results).toEqual([
        { name: checkInFailureFailsOpen.name, tier: 1, passed: true },
        { name: noOverlappingCheckInAttempts.name, tier: 1, passed: true },
      ]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it(
    "passes Policy and pre-action-check coverage",
    () =>
      Effect.gen(function* () {
        const testServiceBaseUrl = yield* startStubTestService();
        const scenarios = [...policyScenarios, ...preActionCheckScenarios];
        const results = yield* runAllScenarios(testServiceBaseUrl, scenarios);

        expect(results).toEqual(scenarios.map(({ name, tier }) => ({ name, tier, passed: true })));
      }).pipe(Effect.scoped, Effect.runPromise),
    35_000,
  );
});
