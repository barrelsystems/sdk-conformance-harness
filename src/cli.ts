#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { NodeRuntime } from "@effect/platform-node";
import { Command } from "commander";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import { applyRelegations, tier2PassRateBelowThreshold } from "./harness/conformanceGate.js";
import { runEquivalenceCheck } from "./harness/equivalence.js";
import { renderJUnitXml, toJUnitCase, type JUnitCase } from "./harness/junitReport.js";
import { DEFAULT_TRACKED_RUNS } from "./harness/relegationHistory.js";
import { runAllScenarios } from "./harness/runAll.js";
import type { Scenario } from "./harness/scenario.js";
import { connectToTestService } from "./harness/testServiceClient.js";
import { happyPathCheckIn } from "./scenarios/happyPathCheckIn.js";
import { jitterFractionEquivalence } from "./scenarios/jitterFractionEquivalence.js";
import { preActionCheckRoundTrip } from "./scenarios/preActionCheck.js";
import { resilienceScenarios } from "./scenarios/resilience.js";

/** Every scenario needing the check-in handshake (mock backend + signed
 * keypair), not just `injectEvent` -- gated on `supportsCheckIn`, since a
 * test service without it can't run any of these. */
const CHECK_IN_SCENARIOS: ReadonlyArray<Scenario> = [
  happyPathCheckIn,
  ...resilienceScenarios,
  preActionCheckRoundTrip,
];

function scenariosFor(capabilities: {
  readonly supportsCheckIn: boolean;
}): ReadonlyArray<Scenario> {
  return capabilities.supportsCheckIn ? CHECK_IN_SCENARIOS : [];
}

function writeJUnitReport(path: string, cases: ReadonlyArray<JUnitCase>): void {
  writeFileSync(path, renderJUnitXml(cases));
}

function runConformance(
  testServiceBaseUrl: string,
  options: { readonly junit?: string; readonly history: string; readonly historyRuns: number },
) {
  return Effect.gen(function* () {
    const testService = yield* connectToTestService(testServiceBaseUrl).pipe(
      Effect.provide(FetchHttpClient.layer),
    );
    const capabilities = yield* testService.testService
      .capabilities()
      .pipe(Effect.provide(FetchHttpClient.layer));
    const scenarios = scenariosFor(capabilities);
    const suiteName = `${capabilities.sdkName}@${capabilities.sdkVersion}`;

    console.log(`running against ${suiteName} (${scenarios.length} scenarios)`);

    const results = yield* runAllScenarios(testServiceBaseUrl, scenarios);

    for (const result of results) {
      console.log(`${result.passed ? "PASS" : "FAIL"} [tier ${result.tier}] ${result.name}`);
      if (!result.passed) console.error(result.error);
    }

    if (options.junit) {
      writeJUnitReport(
        options.junit,
        results.map((result) =>
          toJUnitCase({ suiteName, name: result.name, passed: result.passed, error: result.error }),
        ),
      );
    }

    const { effectiveResults, relegated } = applyRelegations(
      results,
      options.history,
      options.historyRuns,
    );

    for (const name of relegated) {
      console.error(
        `RELEGATED: "${name}" failed every one of its last ${options.historyRuns} runs -- ` +
          `auto-relegated from tier 1 to tier 2 for this run's gate.`,
      );
    }

    const tier1Failed = effectiveResults.some((result) => !result.passed && result.tier === 1);
    const tier2Failed = tier2PassRateBelowThreshold(effectiveResults);

    if (tier1Failed || tier2Failed) process.exitCode = 1;
  });
}

function runEquivalence(namedUrlArgs: ReadonlyArray<string>, options: { readonly junit?: string }) {
  const testServiceBaseUrls = new Map<string, string>();

  for (const arg of namedUrlArgs) {
    const [name, url] = arg.split("=", 2);

    if (!name || !url) {
      console.error(`invalid name=url argument: "${arg}"`);
      process.exit(1);
    }

    testServiceBaseUrls.set(name, url);
  }

  const checks = [jitterFractionEquivalence];

  return Effect.gen(function* () {
    const junitCases: Array<JUnitCase> = [];

    for (const check of checks) {
      const result = yield* runEquivalenceCheck(testServiceBaseUrls, check);

      console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}`);
      if (!result.passed) {
        console.error(result.error);
        process.exitCode = 1;
      }
      junitCases.push(
        toJUnitCase({
          suiteName: "equivalence",
          name: result.name,
          passed: result.passed,
          error: result.error,
        }),
      );
    }

    if (options.junit) writeJUnitReport(options.junit, junitCases);
  });
}

const program = new Command();

program
  .name("sdk-conformance-harness")
  .description("Shared conformance test harness for Barrel's per-platform SDKs");

program
  .command("conformance <test-service-base-url>")
  .description("run this SDK's conformance scenarios against its own test service")
  .option("--junit <path>", "also write results as JUnit XML, for CI PR-check integration")
  .option(
    "--history <path>",
    "run-history file tracking each scenario's pass/fail record, for tier-1 relegation",
    ".conformance-history.json",
  )
  .option(
    "--history-runs <n>",
    "how many recent runs a scenario's relegation/trend is tracked over",
    (value: string) => Number.parseInt(value, 10),
    DEFAULT_TRACKED_RUNS,
  )
  .action(
    (
      testServiceBaseUrl: string,
      options: { junit?: string; history: string; historyRuns: number },
    ) => {
      NodeRuntime.runMain(runConformance(testServiceBaseUrl, options));
    },
  );

program
  .command("equivalence <name=url...>")
  .description("run cross-SDK equivalence checks against every named test service")
  .option("--junit <path>", "also write results as JUnit XML, for CI PR-check integration")
  .action((namedUrlArgs: ReadonlyArray<string>, options: { junit?: string }) => {
    NodeRuntime.runMain(runEquivalence(namedUrlArgs, options));
  });

program.parse();
