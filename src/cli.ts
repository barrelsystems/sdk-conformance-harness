#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { NodeRuntime } from "@effect/platform-node";
import { Command } from "commander";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import { runEquivalenceCheck } from "./harness/equivalence.js";
import { renderJUnitXml, toJUnitCase, type JUnitCase } from "./harness/junitReport.js";
import { runAllScenarios } from "./harness/runAll.js";
import { connectToTestService } from "./harness/testServiceClient.js";
import { jitterFractionEquivalence } from "./scenarios/jitterFractionEquivalence.js";
import { happyPathCheckIn } from "./scenarios/happyPathCheckIn.js";
import { electronUpdaterEventMappingScenarios } from "./scenarios/electronUpdaterEventMapping.js";

/** `happyPathCheckIn` is gated on the declared `supportsCheckIn`, not
 * assumed -- an `injectEvent`-only test service never implements it, so
 * bundling it unconditionally would guarantee a failure, not add a check. */
function scenariosFor(capabilities: {
  readonly sdkName: string;
  readonly supportsCheckIn: boolean;
}) {
  const platformScenarios =
    capabilities.sdkName === "electron-updater" ? electronUpdaterEventMappingScenarios : [];

  return capabilities.supportsCheckIn
    ? [happyPathCheckIn, ...platformScenarios]
    : platformScenarios;
}

function writeJUnitReport(path: string, cases: ReadonlyArray<JUnitCase>): void {
  writeFileSync(path, renderJUnitXml(cases));
}

function runConformance(testServiceBaseUrl: string, options: { readonly junit?: string }) {
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

    const failedRequiredTier = results.some((result) => !result.passed && result.tier === 1);

    if (failedRequiredTier) process.exitCode = 1;
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
  .action((testServiceBaseUrl: string, options: { junit?: string }) => {
    NodeRuntime.runMain(runConformance(testServiceBaseUrl, options));
  });

program
  .command("equivalence <name=url...>")
  .description("run cross-SDK equivalence checks against every named test service")
  .option("--junit <path>", "also write results as JUnit XML, for CI PR-check integration")
  .action((namedUrlArgs: ReadonlyArray<string>, options: { junit?: string }) => {
    NodeRuntime.runMain(runEquivalence(namedUrlArgs, options));
  });

program.parse();
