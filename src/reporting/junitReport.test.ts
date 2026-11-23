import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { renderJUnitXml, toJUnitCase } from "./junitReport.js";

describe("renderJUnitXml", () => {
  it("groups cases by suite and counts failures per suite", () => {
    const xml = renderJUnitXml([
      toJUnitCase({
        suiteName: "swift@0.0.1",
        name: "a passing test",
        passed: true,
        error: undefined,
      }),
      toJUnitCase({
        suiteName: "swift@0.0.1",
        name: "a failing test",
        passed: false,
        error: new Error("expected <foo> & bar"),
      }),
      toJUnitCase({
        suiteName: "tauri@0.0.1",
        name: "another passing test",
        passed: true,
        error: undefined,
      }),
    ]);

    expect(xml).toContain('<testsuite name="swift@0.0.1" tests="2" failures="1">');
    expect(xml).toContain('<testsuite name="tauri@0.0.1" tests="1" failures="0">');
  });

  it("escapes XML-significant characters in names and failure messages", () => {
    const xml = renderJUnitXml([
      toJUnitCase({
        suiteName: "swift@0.0.1",
        name: 'a "quoted" & <tagged> test',
        passed: false,
        error: new Error("expected <foo> & bar"),
      }),
    ]);

    expect(xml).toContain("a &quot;quoted&quot; &amp; &lt;tagged&gt; test");
    expect(xml).toContain("expected &lt;foo&gt; &amp; bar");
  });

  it("omits the <failure> element entirely for a passing case", () => {
    const xml = renderJUnitXml([
      toJUnitCase({
        suiteName: "swift@0.0.1",
        name: "a passing test",
        passed: true,
        error: undefined,
      }),
    ]);

    expect(xml).not.toContain("<failure");
  });
  it.each(["", undefined])("keeps a failed case failed without a diagnostic: %s", (error) => {
    const xml = renderJUnitXml([
      toJUnitCase({ suiteName: "sdk", name: "failure", passed: false, error }),
    ]);

    expect(xml).toContain('failures="1"');
    expect(xml).toContain("<failure ");
  });

  it("retains assertion diagnostics from the runner's Effect cause", async () => {
    const exit = await Effect.runPromise(Effect.exit(Effect.die(new Error("held action ran"))));

    if (exit._tag !== "Failure") throw new Error("expected a failed effect");

    const testCase = toJUnitCase({
      suiteName: "sdk",
      name: "hold",
      passed: false,
      error: exit.cause,
    });
    expect(testCase.failureMessage).toContain("held action ran");
  });
});
