import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readHistory,
  recordOutcomes,
  scenariosToRelegate,
  writeHistory,
  type RunHistory,
} from "./relegationHistory.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conformance-history-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readHistory", () => {
  it("returns empty history when the file doesn't exist yet", () => {
    expect(readHistory(join(dir, "missing.json"))).toEqual({ scenarios: {} });
  });

  it("returns empty history for a malformed file rather than throwing", () => {
    const path = join(dir, "corrupt.json");

    writeFileSync(path, "{ not valid json");
    expect(readHistory(path)).toEqual({ scenarios: {} });
  });

  it("round-trips through writeHistory", () => {
    const path = join(dir, "history.json");
    const history: RunHistory = { scenarios: { "scenario a": { outcomes: [true, false] } } };

    writeHistory(path, history);
    expect(readHistory(path)).toEqual(history);
  });
});

describe("recordOutcomes", () => {
  it("appends this run's outcome for each scenario", () => {
    const history: RunHistory = { scenarios: { a: { outcomes: [true] } } };
    const next = recordOutcomes(history, [{ name: "a", passed: false }], 5);

    expect(next.scenarios["a"]).toEqual({ outcomes: [true, false] });
  });

  it("caps tracked outcomes at maxRuns, dropping the oldest first", () => {
    const history: RunHistory = { scenarios: { a: { outcomes: [true, true, true] } } };
    const next = recordOutcomes(history, [{ name: "a", passed: false }], 3);

    expect(next.scenarios["a"]).toEqual({ outcomes: [true, true, false] });
  });

  it("prunes a scenario key absent from this run's results, e.g. renamed or removed", () => {
    const history: RunHistory = {
      scenarios: { a: { outcomes: [true] }, b: { outcomes: [false] } },
    };
    const next = recordOutcomes(history, [{ name: "a", passed: true }], 5);

    expect(next.scenarios["b"]).toBeUndefined();
  });
});

describe("scenariosToRelegate", () => {
  it("relegates a tier-1 scenario that failed every one of its last N runs", () => {
    const history: RunHistory = { scenarios: { a: { outcomes: [false, false, false] } } };

    expect(scenariosToRelegate(history, ["a"], 3)).toEqual(["a"]);
  });

  it("does not relegate a scenario with fewer than N recorded runs", () => {
    const history: RunHistory = { scenarios: { a: { outcomes: [false, false] } } };

    expect(scenariosToRelegate(history, ["a"], 3)).toEqual([]);
  });

  it("does not relegate a scenario that passed even one of its last N runs", () => {
    const history: RunHistory = { scenarios: { a: { outcomes: [false, true, false] } } };

    expect(scenariosToRelegate(history, ["a"], 3)).toEqual([]);
  });

  it("only considers the names passed in, even if history tracks others", () => {
    const history: RunHistory = { scenarios: { a: { outcomes: [false, false, false] } } };

    expect(scenariosToRelegate(history, ["b"], 3)).toEqual([]);
  });
});
