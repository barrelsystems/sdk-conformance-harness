import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as Schema from "effect/Schema";

/** How many of a scenario's most recent runs count toward "sustained
 * regression" -- one bad run is noise; this many straight is a pattern. */
export const DEFAULT_TRACKED_RUNS = 5;

interface ScenarioHistory {
  readonly outcomes: ReadonlyArray<boolean>;
}

export interface RunHistory {
  readonly scenarios: Readonly<Record<string, ScenarioHistory>>;
}

const EMPTY_HISTORY: RunHistory = { scenarios: {} };

/** Missing, malformed or invalidly shaped history starts empty. Concurrent writers must use separate history paths. */
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

/** Append bounded recent outcomes and discard entries for scenarios absent from this run. */
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

/** Relegate only after a full window of consecutive failures; a partial history never meets the threshold. */
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

const History = Schema.Struct({
  scenarios: Schema.Record(
    Schema.String,
    Schema.Struct({ outcomes: Schema.Array(Schema.Boolean) }),
  ),
});

const isRunHistory = Schema.is(History);
