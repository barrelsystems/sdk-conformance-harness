import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { happyPathCheckIn } from "../scenarios/happyPathCheckIn.js";
import { startStubTestService } from "../testing/stubTestService.js";
import { runAllScenarios } from "./runAll.js";

describe("runAllScenarios", () => {
  it("passes the happy-path scenario against a real stub test service", () =>
    Effect.gen(function* () {
      const testServiceBaseUrl = yield* startStubTestService();
      const results = yield* runAllScenarios(testServiceBaseUrl, [happyPathCheckIn]);

      expect(results).toEqual([{ name: happyPathCheckIn.name, tier: 1, passed: true }]);
    }).pipe(Effect.scoped, Effect.runPromise));
});
