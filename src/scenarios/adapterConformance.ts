import * as Effect from "effect/Effect";
import type { Scenario, ScenarioContext } from "../harness/scenario.js";

export interface AdapterHandle {
  readonly id: string;
}

type AdapterEffect<A> = Effect.Effect<A, unknown, never>;

/** Shared shape for a conformance check that creates an adapter, drives
 * it, and asserts the exact resulting `AdapterState` before cleanup. */
export function stateMappingScenario<State>(options: {
  readonly name: string;
  readonly tier?: 1 | 2;
  readonly createAdapter: (context: ScenarioContext) => AdapterEffect<AdapterHandle>;
  readonly act: (context: ScenarioContext, adapter: AdapterHandle) => AdapterEffect<void>;
  readonly areEquivalent: (a: State, b: State) => boolean;
  readonly expectedState: State;
}): Scenario {
  return {
    name: options.name,
    tier: options.tier ?? 1,
    run: (context) =>
      Effect.gen(function* () {
        const adapter = yield* options.createAdapter(context);
        yield* options.act(context, adapter);

        const state = yield* context.testService.testService.runCommand({
          params: { id: adapter.id },
          payload: { command: "getAdapterState" },
        });

        if (!options.areEquivalent(state.result as State, options.expectedState)) {
          return yield* Effect.die(
            new Error(
              `expected ${JSON.stringify(options.expectedState)}, got ${JSON.stringify(state.result)}`,
            ),
          );
        }

        yield* context.testService.testService.destroyAdapter({ params: { id: adapter.id } });
      }),
  };
}
