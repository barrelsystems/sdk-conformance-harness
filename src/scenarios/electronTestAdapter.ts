import * as Effect from "effect/Effect";
import type { Scenario, TestServiceClient } from "../harness/scenario.js";
import {
  electronAdapterStatesAreEquivalent,
  type ElectronAdapterState,
} from "./electronAdapterState.js";

/** Narrower than the wire protocol's own `variant` field (a generic
 * string, interpreted per-platform) -- this is electron's own closed set. */
export type ElectronAdapterVariant = "electron-updater" | "builtin";

/** Every electron scenario creates an adapter against this same unused
 * check-in config -- only `injectEvent`-driven conformance is exercised. */
export function createElectronTestAdapter(
  testService: TestServiceClient,
  variant: ElectronAdapterVariant,
) {
  return testService.testService.createAdapter({
    payload: { checkInBaseUrl: "http://unused", publicKeyPem: "unused", variant },
  });
}

/** One row: inject this event against a fresh adapter, then assert the
 * exact resulting `AdapterState`. An independent copy of the expected
 * mapping, so importing the adapter's own code couldn't mask drift. */
export interface LifecycleCase {
  readonly description: string;
  readonly eventName: string;
  readonly payload: ReadonlyArray<unknown>;
  readonly expectedState: ElectronAdapterState;
}

export function lifecycleScenario(
  namePrefix: string,
  variant: ElectronAdapterVariant,
  testCase: LifecycleCase,
): Scenario {
  return {
    name: `${namePrefix}: ${testCase.description}`,
    tier: 1,
    run: ({ testService }) =>
      Effect.gen(function* () {
        const adapter = yield* createElectronTestAdapter(testService, variant);

        yield* testService.testService.runCommand({
          params: { id: adapter.id },
          payload: {
            command: "injectEvent",
            eventName: testCase.eventName,
            payload: testCase.payload,
          },
        });
        const state = yield* testService.testService.runCommand({
          params: { id: adapter.id },
          payload: { command: "getAdapterState" },
        });

        if (
          !electronAdapterStatesAreEquivalent(
            state.result as ElectronAdapterState,
            testCase.expectedState,
          )
        ) {
          return yield* Effect.die(
            new Error(
              `expected ${JSON.stringify(testCase.expectedState)}, got ${JSON.stringify(state.result)}`,
            ),
          );
        }

        yield* testService.testService.destroyAdapter({ params: { id: adapter.id } });
      }),
  };
}
