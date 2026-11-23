import { describe, expect, it } from "vitest";
import { scenariosFor } from "./scenarios.js";

describe("scenario selection", () => {
  it("rejects a service that cannot run the required scenarios", () => {
    expect(() => scenariosFor({ supportsCheckIn: false })).toThrow("does not support");
  });

  it("uses unique scenario names so reports and history cannot overwrite each other", () => {
    const scenarios = scenariosFor({ supportsCheckIn: true });
    expect(scenarios.length).toBeGreaterThan(0);
    expect(new Set(scenarios.map(({ name }) => name)).size).toBe(scenarios.length);
  });
});
