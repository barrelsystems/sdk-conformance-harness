import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Scenario } from "../harness/scenario.js";

/** `getAdapterState()`'s own public return type -- richer than
 * `wireContract.ts`'s `AdapterState` (the wire shape, no `releaseNotes`).
 * An independent re-declaration, same reasoning as `wireContract.ts`. */
const ElectronAdapterState = Schema.Union([
  Schema.Struct({ type: Schema.Literal("idle") }),
  Schema.Struct({ type: Schema.Literal("checking") }),
  Schema.Struct({
    type: Schema.Literal("available"),
    releaseNotes: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("downloading"),
    progress: Schema.optionalKey(Schema.Number),
    releaseNotes: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("downloaded"),
    releaseNotes: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("update-cancelled") }),
  Schema.Struct({
    type: Schema.Literal("failed"),
    category: Schema.Literals(["check", "download", "updater"]),
    code: Schema.String,
    platformCode: Schema.String,
  }),
]);

/** Derived once from that schema -- key-order-independent by construction,
 * unlike a `JSON.stringify` comparison. */
const adapterStatesAreEquivalent = Schema.toEquivalence(ElectronAdapterState);

/** One row: inject this event against a fresh adapter, then assert the
 * exact resulting `AdapterState`. An independent copy of the expected
 * mapping, so importing the adapter's own code couldn't mask drift. */
interface LifecycleCase {
  readonly description: string;
  readonly eventName: string;
  readonly payload: unknown;
  readonly expectedState: typeof ElectronAdapterState.Type;
}

const lifecycleCases: ReadonlyArray<LifecycleCase> = [
  {
    description: "checking-for-update maps to checking",
    eventName: "checking-for-update",
    payload: null,
    expectedState: { type: "checking" },
  },
  {
    description: "update-not-available collapses to idle",
    eventName: "update-not-available",
    payload: null,
    expectedState: { type: "idle" },
  },
  {
    description: "update-available maps to available",
    eventName: "update-available",
    payload: { releaseNotes: "fixed a thing" },
    expectedState: { type: "available", releaseNotes: "fixed a thing" },
  },
  // electron-updater's own `ProgressInfo` always carries a required `percent`
  // (confirmed from its own source) -- there is no real "downloading without
  // progress" case for this adapter. That gap belongs to the built-in
  // autoUpdater adapter, which has no download-progress event at all, and is
  // covered when that adapter's own scenarios are added.
  {
    description: "download-progress carries a rounded percent",
    eventName: "download-progress",
    payload: { percent: 42.7 },
    expectedState: { type: "downloading", progress: 43 },
  },
  {
    description: "update-downloaded maps to downloaded",
    eventName: "update-downloaded",
    payload: null,
    expectedState: { type: "downloaded" },
  },
  {
    description: "update-cancelled maps to its own state, never idle or failed",
    eventName: "update-cancelled",
    payload: null,
    expectedState: { type: "update-cancelled" },
  },
];

/** One row per raw error identifier. `precedingEvent`, when set, is
 * injected first so `currentPhase` matches what the real adapter would
 * track -- needed because `HTTP_ERROR_404` maps differently by phase. */
interface ErrorCase {
  readonly code: string;
  readonly precedingEvent?: string;
  readonly expectedFailureMode: string;
  readonly expectedPhase: string;
  readonly expectedTitle: string;
}

const errorCases: ReadonlyArray<ErrorCase> = [
  {
    code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
    expectedFailureMode: "manifest-unreachable",
    expectedPhase: "check",
    expectedTitle: "Could not reach the update manifest.",
  },
  {
    code: "ERR_UPDATER_INVALID_VERSION",
    expectedFailureMode: "version-invalid",
    expectedPhase: "check",
    expectedTitle: "The update manifest's version is invalid.",
  },
  {
    code: "ERR_UPDATER_MANIFEST_NOT_SIGNED",
    expectedFailureMode: "signature-missing",
    expectedPhase: "verify",
    expectedTitle: "The update manifest has no signature.",
  },
  {
    code: "ERR_UPDATER_MANIFEST_SIGNATURE_INVALID",
    expectedFailureMode: "signature-invalid",
    expectedPhase: "verify",
    expectedTitle: "The update manifest's signature is invalid.",
  },
  {
    code: "ERR_UPDATER_INVALID_UPDATE_FILE",
    expectedFailureMode: "download-file-invalid",
    expectedPhase: "download",
    expectedTitle: "The downloaded update file is invalid.",
  },
  {
    code: "ERR_CHECKSUM_MISMATCH",
    expectedFailureMode: "checksum-mismatch",
    expectedPhase: "verify",
    expectedTitle: "The downloaded update failed its checksum check.",
  },
  {
    code: "ERR_UPDATER_DOWNLOAD_SIZE_EXCEEDED",
    expectedFailureMode: "download-size-exceeded",
    expectedPhase: "download",
    expectedTitle: "The update download exceeded its expected size.",
  },
  {
    code: "ERR_HTTP_RESPONSE_TOO_LARGE",
    expectedFailureMode: "download-size-exceeded",
    expectedPhase: "download",
    expectedTitle: "The update download exceeded its expected size.",
  },
  {
    code: "ERR_STREAM_NOT_FINISHED",
    expectedFailureMode: "download-stream-incomplete",
    expectedPhase: "download",
    expectedTitle: "The update download stream ended early.",
  },
  {
    code: "ERR_UPDATER_BLOCKMAP_FORMAT_CHANGED",
    expectedFailureMode: "diff-patch-incompatible",
    expectedPhase: "download",
    expectedTitle: "The differential update patch is incompatible.",
  },
  {
    code: "ERR_UPDATER_OLD_FILE_NOT_FOUND",
    expectedFailureMode: "install-missing-update",
    expectedPhase: "install",
    expectedTitle: "The downloaded update file is missing at install time.",
  },
  {
    code: "ERR_UPDATER_CROSS_ORIGIN_HEADERS_NOT_CONFIGURED",
    expectedFailureMode: "cors-misconfigured",
    expectedPhase: "config",
    expectedTitle: "The update server's CORS headers are misconfigured.",
  },
  {
    code: "ERR_UPDATER_INVALID_CROSS_ORIGIN_HEADERS",
    expectedFailureMode: "cors-misconfigured",
    expectedPhase: "config",
    expectedTitle: "The update server's CORS headers are misconfigured.",
  },
  // Node's own network errno codes, a distinct namespace from the ERR_* table above.
  {
    code: "ECONNREFUSED",
    expectedFailureMode: "download-transport-failed",
    expectedPhase: "download",
    expectedTitle: "The update download failed at the network layer.",
  },
  {
    code: "ETIMEDOUT",
    expectedFailureMode: "download-transport-failed",
    expectedPhase: "download",
    expectedTitle: "The update download failed at the network layer.",
  },
  {
    code: "ENOTFOUND",
    expectedFailureMode: "download-transport-failed",
    expectedPhase: "download",
    expectedTitle: "The update download failed at the network layer.",
  },
  // HTTP_ERROR_* codes are built dynamically from the HTTP status -- 404
  // specifically means "no update published" only while a check is in
  // flight (hence the preceding event); every other HTTP_ERROR_* in any
  // other phase is a generic transport failure.
  {
    code: "HTTP_ERROR_404",
    precedingEvent: "checking-for-update",
    expectedFailureMode: "manifest-unreachable",
    expectedPhase: "check",
    expectedTitle: "Could not reach the update manifest.",
  },
  {
    code: "HTTP_ERROR_500",
    expectedFailureMode: "download-transport-failed",
    expectedPhase: "download",
    expectedTitle: "The update download failed at the network layer.",
  },
];

function lifecycleScenario(testCase: LifecycleCase): Scenario {
  return {
    name: `electron-updater: ${testCase.description}`,
    tier: 1,
    run: ({ testService }) =>
      Effect.gen(function* () {
        const adapter = yield* testService.testService.createAdapter({
          payload: { checkInBaseUrl: "http://unused", publicKeyPem: "unused" },
        });

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
          !adapterStatesAreEquivalent(
            state.result as typeof ElectronAdapterState.Type,
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

function errorScenario(testCase: ErrorCase): Scenario {
  return {
    name: `electron-updater: error code ${testCase.code} maps to failureMode "${testCase.expectedFailureMode}" phase "${testCase.expectedPhase}"`,
    tier: 1,
    run: ({ testService }) =>
      Effect.gen(function* () {
        const adapter = yield* testService.testService.createAdapter({
          payload: { checkInBaseUrl: "http://unused", publicKeyPem: "unused" },
        });

        if (testCase.precedingEvent) {
          yield* testService.testService.runCommand({
            params: { id: adapter.id },
            payload: { command: "injectEvent", eventName: testCase.precedingEvent, payload: null },
          });
        }

        yield* testService.testService.runCommand({
          params: { id: adapter.id },
          // The real adapter's own mapping logic only ever reads `error.code`
          // (never `.message`) -- a plain `{ code }` object survives the
          // JSON round-trip identically to a real `Error` for this purpose.
          payload: { command: "injectEvent", eventName: "error", payload: { code: testCase.code } },
        });
        const state = yield* testService.testService.runCommand({
          params: { id: adapter.id },
          payload: { command: "getAdapterState" },
        });
        const result = state.result as { type?: string; category?: string; code?: string } | null;

        if (result?.type !== "failed" || result.code !== testCase.expectedFailureMode) {
          return yield* Effect.die(
            new Error(
              `expected failed/${testCase.expectedFailureMode}, got ${JSON.stringify(result)} for code ${testCase.code}`,
            ),
          );
        }

        const lastError = yield* testService.testService.runCommand({
          params: { id: adapter.id },
          payload: { command: "getLastUpdateError" },
        });
        const failure = lastError.result as { phase?: string; title?: string } | null;

        if (failure?.phase !== testCase.expectedPhase) {
          return yield* Effect.die(
            new Error(
              `expected phase "${testCase.expectedPhase}", got ${JSON.stringify(failure)} for code ${testCase.code}`,
            ),
          );
        }

        if (failure.title !== testCase.expectedTitle) {
          return yield* Effect.die(
            new Error(
              `expected title "${testCase.expectedTitle}", got ${JSON.stringify(failure.title)} for code ${testCase.code}`,
            ),
          );
        }

        yield* testService.testService.destroyAdapter({ params: { id: adapter.id } });
      }),
  };
}

/** `getLastUpdateError()`'s `undefined`-until-something-fails contract --
 * not a mapping-table row, so it gets its own scenario. */
const getLastUpdateErrorIsUndefinedUntilSomethingFails: Scenario = {
  name: "electron-updater: getLastUpdateError returns nothing before any failure this session",
  tier: 1,
  run: ({ testService }) =>
    Effect.gen(function* () {
      const adapter = yield* testService.testService.createAdapter({
        payload: { checkInBaseUrl: "http://unused", publicKeyPem: "unused" },
      });
      const lastError = yield* testService.testService.runCommand({
        params: { id: adapter.id },
        payload: { command: "getLastUpdateError" },
      });

      if (lastError.result !== null) {
        return yield* Effect.die(
          new Error(`expected no update error yet, got ${JSON.stringify(lastError.result)}`),
        );
      }

      yield* testService.testService.destroyAdapter({ params: { id: adapter.id } });
    }),
};

export const electronUpdaterEventMappingScenarios: ReadonlyArray<Scenario> = [
  ...lifecycleCases.map(lifecycleScenario),
  ...errorCases.map(errorScenario),
  getLastUpdateErrorIsUndefinedUntilSomethingFails,
];
