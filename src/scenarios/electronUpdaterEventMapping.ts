import * as Effect from "effect/Effect";
import type { Scenario } from "../harness/scenario.js";
import {
  createElectronTestAdapter,
  lifecycleScenario,
  type LifecycleCase,
} from "./electronTestAdapter.js";

const lifecycleCases: ReadonlyArray<LifecycleCase> = [
  {
    description: "checking-for-update maps to checking",
    eventName: "checking-for-update",
    payload: [],
    expectedState: { type: "checking" },
  },
  {
    description: "update-not-available collapses to idle",
    eventName: "update-not-available",
    payload: [],
    expectedState: { type: "idle" },
  },
  {
    description: "update-available maps to available",
    eventName: "update-available",
    payload: [{ releaseNotes: "fixed a thing" }],
    expectedState: { type: "available", releaseNotes: "fixed a thing" },
  },
  // electron-updater's own `ProgressInfo` always carries a required `percent`
  // -- there is no real "downloading without progress" case for this
  // adapter (the built-in autoUpdater adapter has no progress event at all).
  {
    description: "download-progress carries a rounded percent",
    eventName: "download-progress",
    payload: [{ percent: 42.7 }],
    expectedState: { type: "downloading", progress: 43 },
  },
  {
    description: "update-downloaded maps to downloaded",
    eventName: "update-downloaded",
    payload: [],
    expectedState: { type: "downloaded" },
  },
  {
    description: "update-cancelled maps to its own state, never idle or failed",
    eventName: "update-cancelled",
    payload: [],
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

function errorScenario(testCase: ErrorCase): Scenario {
  return {
    name: `electron-updater: error code ${testCase.code} maps to failureMode "${testCase.expectedFailureMode}" phase "${testCase.expectedPhase}"`,
    tier: 1,
    run: ({ testService }) =>
      Effect.gen(function* () {
        const adapter = yield* createElectronTestAdapter(testService, "electron-updater");

        if (testCase.precedingEvent) {
          yield* testService.testService.runCommand({
            params: { id: adapter.id },
            payload: { command: "injectEvent", eventName: testCase.precedingEvent, payload: [] },
          });
        }

        yield* testService.testService.runCommand({
          params: { id: adapter.id },
          // The real adapter's own mapping logic only ever reads `error.code`
          // (never `.message`) -- a plain `{ code }` object survives the
          // JSON round-trip identically to a real `Error` for this purpose.
          payload: {
            command: "injectEvent",
            eventName: "error",
            payload: [{ code: testCase.code }],
          },
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
      const adapter = yield* createElectronTestAdapter(testService, "electron-updater");
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
  ...lifecycleCases.map((testCase) =>
    lifecycleScenario("electron-updater", "electron-updater", testCase),
  ),
  ...errorCases.map(errorScenario),
  getLastUpdateErrorIsUndefinedUntilSomethingFails,
];
