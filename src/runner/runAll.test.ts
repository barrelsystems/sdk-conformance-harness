import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { happyPathCheckIn } from "../scenarios/happyPathCheckIn.js";
import { startStubTestService } from "../testing/stubTestService.js";
import { runAllScenarios } from "./runAll.js";
import type { Scenario } from "./scenario.js";
import { wireIdentity } from "../scenarios/wireIdentity.js";
import { withAdapter, type AdapterCommands } from "../fixtures/adapterFixture.js";

describe("runAllScenarios", () => {
  it("records assertion failures and defects, runs finalizers, and continues", () =>
    Effect.gen(function* () {
      const url = yield* startStubTestService();
      const finalized: string[] = [];
      const backends = new Set<unknown>();
      const keys = new Set<string>();
      const scenarios: Scenario[] = [
        { name: "assertion", tier: 1, run: () => Effect.fail("assertion failed") },
        { name: "defect", tier: 2, run: () => Effect.die(new Error("unexpected defect")) },
        { name: "subsequent pass", tier: 1, run: () => Effect.void },
      ];
      const results = yield* runAllScenarios(
        url,
        scenarios.map((scenario) => ({
          ...scenario,
          run: (context) =>
            Effect.gen(function* () {
              expect(finalized).toHaveLength(backends.size);
              backends.add(context.backend);
              keys.add(context.keypair.publicKeyPem);
              yield* scenario.run(context).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    finalized.push(scenario.name);
                  }),
                ),
              );
            }),
        })),
      );

      expect(results.map(({ name, tier, passed }) => ({ name, tier, passed }))).toEqual([
        { name: "assertion", tier: 1, passed: false },
        { name: "defect", tier: 2, passed: false },
        { name: "subsequent pass", tier: 1, passed: true },
      ]);
      expect(finalized).toEqual(scenarios.map(({ name }) => name));
      expect(backends.size).toBe(3);
      expect(keys.size).toBe(3);
    }).pipe(Effect.scoped, Effect.runPromise));

  it("destroys an adapter even when its scenario assertion fails", () =>
    Effect.gen(function* () {
      const url = yield* startStubTestService();
      const scenario: Scenario = {
        name: "adapter cleanup",
        tier: 1,
        run: (context) =>
          Effect.gen(function* () {
            let command: AdapterCommands | undefined;
            const failed = yield* Effect.exit(
              withAdapter(context, (createdCommand) => {
                command = createdCommand;
                return Effect.die("assertion failed");
              }),
            );

            expect(failed._tag).toBe("Failure");
            if (!command) return yield* Effect.die("adapter was not created");

            const afterCleanup = yield* Effect.exit(command({ command: "getUpdateState" }));
            expect(afterCleanup._tag).toBe("Failure");
          }),
      };
      const results = yield* runAllScenarios(url, [scenario]);
      expect(results[0]?.passed).toBe(true);
    }).pipe(Effect.scoped, Effect.runPromise));

  it.each([
    { credential: "test-service", passed: true },
    { credential: "incorrect", passed: false },
  ])("checks wire credentials: $credential", ({ credential, passed }) =>
    Effect.gen(function* () {
      const url = yield* startStubTestService({ credential });
      const results = yield* runAllScenarios(url, [wireIdentity]);

      expect(results[0]?.passed).toBe(passed);
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it("passes the happy-path scenario against a real stub test service", () =>
    Effect.gen(function* () {
      const testServiceBaseUrl = yield* startStubTestService();
      const results = yield* runAllScenarios(testServiceBaseUrl, [happyPathCheckIn]);

      expect(results).toEqual([{ name: happyPathCheckIn.name, tier: 1, passed: true }]);
    }).pipe(Effect.scoped, Effect.runPromise));
});
