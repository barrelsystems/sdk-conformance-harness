import { deepStrictEqual } from "node:assert/strict";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Scenario, ScenarioContext } from "../harness/scenario.js";
import { generateTestKeypair, type TestKeypair } from "../protocol/signing.js";
import { UpdaterActivity, type AdapterCommand } from "../protocol/testServiceApi.js";
import type { Policy } from "../protocol/wireContract.js";

const base = { issuedAt: "2026-01-01T00:00:00.000Z", environment: "test" };

export const policyCases: ReadonlyArray<Policy> = [
  { ...base, type: "current" },
  { ...base, type: "held" },
  { ...base, type: "held", reason: "maintenance", until: "2099-01-01T00:00:00.000Z" },
  { ...base, type: "updateEligible" },
  { ...base, type: "updateEligible", priority: "normal" },
  { ...base, type: "updateEligible", priority: "high" },
];

export function invalidPolicyResponses(keypair: TestKeypair) {
  return Effect.gen(function* () {
    const valid = yield* keypair.sign({ ...base, type: "updateEligible", priority: "high" });
    const otherKey = yield* generateTestKeypair();
    const wrongKey = yield* otherKey.sign({ ...base, type: "current" });
    const malformed = yield* keypair.signRaw("not json");
    const unknown = yield* keypair.signRaw(JSON.stringify({ ...base, type: "unknown" }));
    const missingFields = yield* keypair.signRaw('{"type":"held"}');

    return [
      { ...valid, policy: valid.policy.replace('"high"', '"normal"') },
      { ...valid, signature: "not-base64!" },
      wrongKey,
      malformed,
      unknown,
      missingFields,
    ].map((response) => ({ protocolVersion: 1 as const, ...response }));
  });
}

export function withPolicyAdapter(
  context: ScenarioContext,
  run: (
    command: (payload: AdapterCommand) => Effect.Effect<unknown, unknown>,
  ) => Effect.Effect<void, unknown>,
) {
  const api = context.testService.testService;

  return Effect.acquireUseRelease(
    api.createAdapter({
      payload: {
        checkInBaseUrl: context.backend.baseUrl,
        publicKeyPem: context.keypair.publicKeyPem,
      },
    }),
    ({ id }) =>
      run((payload) =>
        api.runCommand({ params: { id }, payload }).pipe(Effect.map((response) => response.result)),
      ),
    ({ id }) => api.destroyAdapter({ params: { id } }).pipe(Effect.orDie),
  );
}

export const policyRoundTrip: Scenario = {
  name: "the public getPolicy caches every signed Policy variant",
  tier: 1,
  run: (context) =>
    withPolicyAdapter(context, (command) =>
      Effect.gen(function* () {
        deepStrictEqual(yield* command({ command: "getPolicy" }), null);
        const initialState = yield* command({ command: "getAdapterState" });

        for (const policy of policyCases) {
          const signed = yield* context.keypair.sign(policy);

          yield* context.backend.setNextResponse({ protocolVersion: 1, ...signed });
          yield* command({ command: "checkNow" });
          deepStrictEqual(yield* command({ command: "getPolicy" }), policy);
          deepStrictEqual(yield* command({ command: "getAdapterState" }), initialState);
        }
      }),
    ),
};

export const policyFailurePreservesCache: Scenario = {
  name: "invalid signatures, invalid Policies and failed check-ins preserve the last verified Policy",
  tier: 1,
  run: (context) =>
    withPolicyAdapter(context, (command) =>
      Effect.gen(function* () {
        const invalid = yield* invalidPolicyResponses(context.keypair);
        const cached: Policy = { ...base, type: "held", reason: "cached decision" };
        const signed = yield* context.keypair.sign(cached);

        for (const expected of [null, cached]) {
          if (expected) {
            yield* context.backend.setNextResponse({ protocolVersion: 1, ...signed });
            yield* command({ command: "checkNow" });
          }

          for (const response of invalid) {
            yield* context.backend.setNextResponse(response);
            yield* command({ command: "checkNow" });
            deepStrictEqual(yield* command({ command: "getPolicy" }), expected);
          }

          yield* context.backend.setNextCheckInFailure({ shouldFail: true });
          yield* command({ command: "checkNow" });
          deepStrictEqual(yield* command({ command: "getPolicy" }), expected);
          yield* context.backend.setNextCheckInFailure({ shouldFail: false });
        }
      }),
    ),
};

export type AdapterCommands = (payload: AdapterCommand) => Effect.Effect<unknown, unknown>;

export function updaterActivity(command: AdapterCommands) {
  return command({ command: "getUpdaterActivity" }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(UpdaterActivity)),
  );
}

export const priorityDoesNotForceActions: Scenario = {
  name: "absent, normal and high priority never force a download or apply",
  tier: 1,
  run: (context) =>
    withPolicyAdapter(context, (command) =>
      Effect.gen(function* () {
        for (const priority of [undefined, "normal", "high"] as const) {
          const policy: Policy = {
            ...base,
            type: "updateEligible",
            ...(priority ? { priority } : {}),
          };
          const signed = yield* context.keypair.sign(policy);

          yield* context.backend.setNextResponse({ protocolVersion: 1, ...signed });
          yield* command({ command: "prepareAction", stage: "pre-download" });
          const before = yield* updaterActivity(command);

          yield* command({ command: "checkNow" });
          deepStrictEqual(yield* command({ command: "getPolicy" }), policy);
          const after = yield* updaterActivity(command);

          deepStrictEqual(after, {
            checks: before.checks + 1,
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

export const policyScenarios = [
  policyRoundTrip,
  policyFailurePreservesCache,
  priorityDoesNotForceActions,
];
