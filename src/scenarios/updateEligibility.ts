import { withAdapter, updaterActivity } from "../fixtures/adapterFixture.js";
import { deepStrictEqual } from "node:assert/strict";
import * as Effect from "effect/Effect";
import type { Scenario } from "../runner/scenario.js";
import { generateTestKeypair, type TestKeypair } from "../protocol/signing.js";

import type { UpdateEligibility } from "../protocol/wireContract.js";

const base = { issuedAt: "2026-01-01T00:00:00.000Z", environment: "test" };

export const updateEligibilityCases: ReadonlyArray<UpdateEligibility> = [
  { ...base, type: "unrestricted" },
  { ...base, type: "held" },
  { ...base, type: "held", reason: "maintenance", until: "2099-01-01T00:00:00.000Z" },
  { ...base, type: "eligible" },
  { ...base, type: "eligible", priority: "normal" },
  { ...base, type: "eligible", priority: "high" },
];

export function invalidUpdateEligibilityResponses(keypair: TestKeypair) {
  return Effect.gen(function* () {
    const valid = yield* keypair.sign({ ...base, type: "eligible", priority: "high" });
    const otherKey = yield* generateTestKeypair();
    const wrongKey = yield* otherKey.sign({ ...base, type: "unrestricted" });
    const malformed = yield* keypair.signRaw("not json");
    const unknown = yield* keypair.signRaw(JSON.stringify({ ...base, type: "unknown" }));
    const missingFields = yield* keypair.signRaw('{"type":"held"}');

    return [
      {
        ...valid,
        updateEligibility: valid.updateEligibility.replace('"high"', '"normal"'),
      },
      { ...valid, signature: "not-base64!" },
      wrongKey,
      malformed,
      unknown,
      missingFields,
    ].map((response) => ({ protocolVersion: 1 as const, ...response }));
  });
}

const updateEligibilityRoundTrip: Scenario = {
  name: "every signed UpdateEligibility variant is cached and observable",
  tier: 1,
  run: (context) =>
    withAdapter(context, (command) =>
      Effect.gen(function* () {
        deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), null);
        const initialState = yield* command({ command: "getUpdateState" });

        for (const updateEligibility of updateEligibilityCases) {
          const signed = yield* context.keypair.sign(updateEligibility);

          yield* context.backend.setNextResponse({ protocolVersion: 1, ...signed });
          yield* command({ command: "checkNow" });
          deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), updateEligibility);
          deepStrictEqual(yield* command({ command: "getUpdateState" }), initialState);
        }
      }),
    ),
};

const updateEligibilityFailurePreservesCache: Scenario = {
  name: "invalid signatures, invalid update eligibilities and failed check-ins preserve the last verified update eligibility",
  tier: 1,
  run: (context) =>
    withAdapter(context, (command) =>
      Effect.gen(function* () {
        const invalid = yield* invalidUpdateEligibilityResponses(context.keypair);
        const cached: UpdateEligibility = { ...base, type: "held", reason: "cached decision" };
        const signed = yield* context.keypair.sign(cached);

        for (const expected of [null, cached]) {
          if (expected) {
            yield* context.backend.setNextResponse({ protocolVersion: 1, ...signed });
            yield* command({ command: "checkNow" });
          }

          for (const response of invalid) {
            yield* context.backend.setNextResponse(response);
            yield* command({ command: "checkNow" });
            deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), expected);
          }

          yield* context.backend.setNextCheckInFailure({ shouldFail: true });
          yield* command({ command: "checkNow" });
          deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), expected);
          yield* context.backend.setNextCheckInFailure({ shouldFail: false });
        }
      }),
    ),
};

const priorityDoesNotForceActions: Scenario = {
  name: "absent, normal and high priority never force a download or apply",
  tier: 1,
  run: (context) =>
    withAdapter(context, (command) =>
      Effect.gen(function* () {
        for (const priority of [undefined, "normal", "high"] as const) {
          const updateEligibility: UpdateEligibility = {
            ...base,
            type: "eligible",
            ...(priority ? { priority } : {}),
          };
          const signed = yield* context.keypair.sign(updateEligibility);

          yield* context.backend.setNextResponse({ protocolVersion: 1, ...signed });
          yield* command({ command: "prepareAction", stage: "pre-download" });
          const before = yield* updaterActivity(command);

          yield* command({ command: "checkNow" });
          deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), updateEligibility);
          const after = yield* updaterActivity(command);

          deepStrictEqual(after, {
            checks: before.checks,
            downloads: before.downloads,
            applies: before.applies,
          });
          yield* command({ command: "prepareAction", stage: "pre-download" });
          const offered = yield* updaterActivity(command);
          deepStrictEqual([offered.downloads, offered.applies], [after.downloads, after.applies]);
          yield* command({ command: "prepareAction", stage: "pre-apply" });
          const downloaded = yield* updaterActivity(command);
          deepStrictEqual(downloaded.applies, offered.applies);
          const requests = yield* context.backend.receivedPreActionChecks();
          deepStrictEqual(requests, []);
        }
      }),
    ),
};

export const updateEligibilityScenarios = [
  updateEligibilityRoundTrip,
  updateEligibilityFailurePreservesCache,
  priorityDoesNotForceActions,
];
