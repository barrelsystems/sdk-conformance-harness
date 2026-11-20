import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** How many of a scenario's most recent runs count toward "sustained
 * regression" -- one bad run is noise; this many straight is a pattern. */
export const DEFAULT_TRACKED_RUNS = 5;

export interface ScenarioHistory {
  readonly outcomes: ReadonlyArray<boolean>;
}

export interface RunHistory {
  readonly scenarios: Readonly<Record<string, ScenarioHistory>>;
}

export const EMPTY_HISTORY: RunHistory = { scenarios: {} };

/** Reads the run-history file at `path`. Both a missing file (the first
 * run in a fresh checkout) and a malformed one are treated as empty
 * history -- corrupt or absent history should never crash a run. */
// Known limitation: this read and its matching `writeHistory` are an
// unsynchronized read-modify-write pair. Concurrent invocations sharing
// one history file (a CI matrix, retries) can race and silently lose updates.
export function readHistory(path: string): RunHistory {
  if (!existsSync(path)) return EMPTY_HISTORY;

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));

    return isRunHistory(parsed) ? parsed : EMPTY_HISTORY;
  } catch {
    return EMPTY_HISTORY;
  }
}

// Known limitation: a forked-PR CI run typically has no push-back access,
// so nothing commits this write back -- the file resets to empty every
// run there and relegation never accumulates.
export function writeHistory(path: string, history: RunHistory): void {
  writeFileSync(path, `${JSON.stringify(history, null, 2)}\n`);
}

/** Appends this run's pass/fail outcome for every scenario, capping each
 * scenario's own tracked outcomes at `maxRuns` (oldest dropped first). Any
 * key not present in this run's `results` is dropped, so a renamed or
 * removed scenario's orphaned history doesn't linger indefinitely. */
export function recordOutcomes(
  history: RunHistory,
  results: ReadonlyArray<{ readonly name: string; readonly passed: boolean }>,
  maxRuns: number,
): RunHistory {
  const scenarios: Record<string, ScenarioHistory> = {};

  for (const result of results) {
    const previousOutcomes = history.scenarios[result.name]?.outcomes ?? [];

    scenarios[result.name] = { outcomes: [...previousOutcomes, result.passed].slice(-maxRuns) };
  }

  return { scenarios };
}

/** A tier-1 scenario relegates to tier 2 once it has `minRuns` recorded
 * outcomes and every single one of them failed -- sustained regression,
 * not one bad run. Fewer than `minRuns` recorded outcomes never relegates,
 * even if all of them so far failed. */
export function scenariosToRelegate(
  history: RunHistory,
  tier1Names: ReadonlyArray<string>,
  minRuns: number,
): ReadonlyArray<string> {
  return tier1Names.filter((name) => {
    const outcomes = history.scenarios[name]?.outcomes ?? [];

    return outcomes.length >= minRuns && outcomes.every((passed) => !passed);
  });
}

function isRunHistory(value: unknown): value is RunHistory {
  return (
    typeof value === "object" &&
    value !== null &&
    "scenarios" in value &&
    typeof (value as { scenarios: unknown }).scenarios === "object"
  );
}
