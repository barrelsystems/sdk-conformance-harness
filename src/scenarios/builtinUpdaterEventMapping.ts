import type { Scenario } from "../harness/scenario.js";
import { lifecycleScenario, type LifecycleCase } from "./electronTestAdapter.js";

/** Unlike electron-updater, every failure the built-in `autoUpdater`
 * reports funnels through a single `unknown`/`check` mapping. */
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
    description: "update-available maps to available, never synthesizing releaseNotes",
    eventName: "update-available",
    payload: [],
    expectedState: { type: "available" },
  },
  {
    description: "update-downloaded carries releaseNotes when the library provides one",
    eventName: "update-downloaded",
    payload: [{}, "fixed a thing"],
    expectedState: { type: "downloaded", releaseNotes: "fixed a thing" },
  },
  {
    description: "update-downloaded omits releaseNotes when the library gives an empty string",
    eventName: "update-downloaded",
    payload: [{}, ""],
    expectedState: { type: "downloaded" },
  },
  {
    // The real handler reads `error.message` only -- a plain object with
    // that property survives the JSON round-trip identically to a real
    // `Error`, whose `message` is non-enumerable and would be dropped.
    description: "the general error event always maps to failureMode unknown, phase check",
    eventName: "error",
    payload: [{ message: "synthetic" }],
    expectedState: {
      type: "failed",
      category: "check",
      code: "unknown",
      platformCode: "synthetic",
    },
  },
];

export const builtinUpdaterEventMappingScenarios: ReadonlyArray<Scenario> = lifecycleCases.map(
  (testCase) => lifecycleScenario("electron-builtin", "builtin", testCase),
);
