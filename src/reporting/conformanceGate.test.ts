import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyRelegations, tier2PassRateBelowThreshold } from "./conformanceGate.js";
import { readHistory } from "./relegationHistory.js";
import type { ScenarioResult } from "../runner/runAll.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conformance-gate-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("tier2PassRateBelowThreshold", () => {
  it("is false with no tier-2 scenarios at all", () => {
    const results: ReadonlyArray<ScenarioResult> = [{ name: "a", tier: 1, passed: false }];

    expect(tier2PassRateBelowThreshold(results)).toBe(false);
  });

  it("is false at exactly 80%", () => {
    const results: ReadonlyArray<ScenarioResult> = [
      { name: "a", tier: 2, passed: true },
      { name: "b", tier: 2, passed: true },
      { name: "c", tier: 2, passed: true },
      { name: "d", tier: 2, passed: true },
      { name: "e", tier: 2, passed: false },
    ];

    expect(tier2PassRateBelowThreshold(results)).toBe(false);
  });

  it("is true just under 80%", () => {
    const results: ReadonlyArray<ScenarioResult> = [
      { name: "a", tier: 2, passed: true },
      { name: "b", tier: 2, passed: true },
      { name: "c", tier: 2, passed: true },
      { name: "d", tier: 2, passed: false },
      { name: "e", tier: 2, passed: false },
    ];

    expect(tier2PassRateBelowThreshold(results)).toBe(true);
  });
});

describe("applyRelegations", () => {
  it("leaves tiers untouched and writes history on a scenario's first-ever failure", () => {
    const path = join(dir, "history.json");
    const results: ReadonlyArray<ScenarioResult> = [{ name: "a", tier: 1, passed: false }];
    const { effectiveResults, relegated } = applyRelegations(results, path, 5);

    expect(relegated).toEqual([]);
    expect(effectiveResults).toEqual(results);
    expect(readHistory(path).scenarios["a"]).toEqual({ outcomes: [false] });
  });

  it("relegates a tier-1 scenario to tier 2 after it fails its last N runs straight", () => {
    const path = join(dir, "history.json");

    for (let run = 0; run < 2; run++) {
      applyRelegations([{ name: "a", tier: 1, passed: false }], path, 3);
    }

    const { effectiveResults, relegated } = applyRelegations(
      [{ name: "a", tier: 1, passed: false }],
      path,
      3,
    );

    expect(relegated).toEqual(["a"]);
    expect(effectiveResults).toEqual([{ name: "a", tier: 2, passed: false }]);
  });

  it("never relegates a passing scenario", () => {
    const path = join(dir, "history.json");

    for (let run = 0; run < 3; run++) {
      applyRelegations([{ name: "a", tier: 1, passed: true }], path, 3);
    }

    const { relegated } = applyRelegations([{ name: "a", tier: 1, passed: true }], path, 3);

    expect(relegated).toEqual([]);
  });
});
