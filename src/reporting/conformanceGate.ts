import {
  readHistory,
  recordOutcomes,
  scenariosToRelegate,
  writeHistory,
} from "./relegationHistory.js";
import type { ScenarioResult } from "../runner/runAll.js";

/** Tier 1 must pass at 100%; tier 2 may regress to an 80% pass rate
 * before the run fails. Returns whichever tier each result should
 * actually be gated under, after applying this run's relegations. */
export function applyRelegations(
  results: ReadonlyArray<ScenarioResult>,
  historyPath: string,
  trackedRuns: number,
): {
  readonly effectiveResults: ReadonlyArray<ScenarioResult>;
  readonly relegated: ReadonlyArray<string>;
} {
  const previousHistory = readHistory(historyPath);
  const updatedHistory = recordOutcomes(previousHistory, results, trackedRuns);
  const tier1Names = results.filter((result) => result.tier === 1).map((result) => result.name);
  const relegated = scenariosToRelegate(updatedHistory, tier1Names, trackedRuns);
  const relegatedSet = new Set(relegated);
  const effectiveResults = results.map((result) =>
    relegatedSet.has(result.name) ? { ...result, tier: 2 as const } : result,
  );

  writeHistory(historyPath, updatedHistory);

  return { effectiveResults, relegated };
}

/** A tier-2 scenario never fails the run on its own -- only its pass rate
 * dropping below 80% does. An empty tier (no tier-2 scenarios this run)
 * trivially passes rather than dividing by zero. */
export function tier2PassRateBelowThreshold(results: ReadonlyArray<ScenarioResult>): boolean {
  const tier2 = results.filter((result) => result.tier === 2);

  if (tier2.length === 0) return false;

  const passRate = tier2.filter((result) => result.passed).length / tier2.length;

  return passRate < 0.8;
}
