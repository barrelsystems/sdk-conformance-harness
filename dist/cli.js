#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Command } from "commander";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiClient } from "effect/http-api";
import { f as TestServiceHttpApi, r as MockBackendHttpApi, t as generateTestKeypair } from "./signing-Djhzw0Fj.js";
import "effect/Duration";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { createServer } from "node:http";
import * as Deferred from "effect/Deferred";
// src/harness/relegationHistory.ts
const EMPTY_HISTORY = { scenarios: {} };
/** Reads the run-history file at `path`. Both a missing file (the first
* run in a fresh checkout) and a malformed one are treated as empty
* history -- corrupt or absent history should never crash a run. */
function readHistory(path) {
	if (!existsSync(path)) return EMPTY_HISTORY;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return isRunHistory(parsed) ? parsed : EMPTY_HISTORY;
	} catch {
		return EMPTY_HISTORY;
	}
}
function writeHistory(path, history) {
	writeFileSync(path, `${JSON.stringify(history, null, 2)}\n`);
}
/** Appends this run's pass/fail outcome for every scenario, capping each
* scenario's own tracked outcomes at `maxRuns` (oldest dropped first). Any
* key not present in this run's `results` is dropped, so a renamed or
* removed scenario's orphaned history doesn't linger indefinitely. */
function recordOutcomes(history, results, maxRuns) {
	const scenarios = {};
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
function scenariosToRelegate(history, tier1Names, minRuns) {
	return tier1Names.filter((name) => {
		const outcomes = history.scenarios[name]?.outcomes ?? [];
		return outcomes.length >= minRuns && outcomes.every((passed) => !passed);
	});
}
function isRunHistory(value) {
	return typeof value === "object" && value !== null && "scenarios" in value && typeof value.scenarios === "object";
}
// src/harness/conformanceGate.ts
/** Tier 1 must pass at 100%; tier 2 may regress to an 80% pass rate
* before the run fails. Returns whichever tier each result should
* actually be gated under, after applying this run's relegations. */
function applyRelegations(results, historyPath, trackedRuns) {
	const updatedHistory = recordOutcomes(readHistory(historyPath), results, trackedRuns);
	const relegated = scenariosToRelegate(updatedHistory, results.filter((result) => result.tier === 1).map((result) => result.name), trackedRuns);
	const relegatedSet = new Set(relegated);
	const effectiveResults = results.map((result) => relegatedSet.has(result.name) ? {
		...result,
		tier: 2
	} : result);
	writeHistory(historyPath, updatedHistory);
	return {
		effectiveResults,
		relegated
	};
}
/** A tier-2 scenario never fails the run on its own -- only its pass rate
* dropping below 80% does. An empty tier (no tier-2 scenarios this run)
* trivially passes rather than dividing by zero. */
function tier2PassRateBelowThreshold(results) {
	const tier2 = results.filter((result) => result.tier === 2);
	if (tier2.length === 0) return false;
	return tier2.filter((result) => result.passed).length / tier2.length < .8;
}
// src/harness/testServiceClient.ts
/** Callers provide `FetchHttpClient.layer` around the whole scenario effect,
* not here -- the derived client's own calls need that layer live at call
* time, not just at derivation time. */
function connectToTestService(baseUrl) {
	return HttpApiClient.make(TestServiceHttpApi, { baseUrl });
}
// src/harness/equivalence.ts
function runEquivalenceCheck(testServiceBaseUrls, check) {
	return Effect.gen(function* () {
		const testServices = /* @__PURE__ */ new Map();
		for (const [name, baseUrl] of testServiceBaseUrls) testServices.set(name, yield* connectToTestService(baseUrl));
		const exit = yield* check.run(testServices).pipe(Effect.exit);
		return exit._tag === "Success" ? {
			name: check.name,
			passed: true
		} : {
			name: check.name,
			passed: false,
			error: exit.cause
		};
	}).pipe(Effect.provide(FetchHttpClient.layer));
}
// src/harness/junitReport.ts
/** `exactOptionalPropertyTypes` forbids an explicit `failureMessage: undefined`
* -- this conditionally omits the key entirely on a pass, instead. */
function toJUnitCase(options) {
	const { suiteName, name, passed, error } = options;
	return {
		suiteName,
		name,
		passed,
		...!passed && { failureMessage: String(error) }
	};
}
function escapeXml(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function groupBySuite(cases) {
	const bySuite = /* @__PURE__ */ new Map();
	for (const testCase of cases) {
		const suite = bySuite.get(testCase.suiteName) ?? [];
		suite.push(testCase);
		bySuite.set(testCase.suiteName, suite);
	}
	return bySuite;
}
function renderTestCase(testCase) {
	if (testCase.passed || !testCase.failureMessage) return `    <testcase name="${escapeXml(testCase.name)}" classname="${escapeXml(testCase.suiteName)}" />`;
	return [
		`    <testcase name="${escapeXml(testCase.name)}" classname="${escapeXml(testCase.suiteName)}">`,
		`      <failure message="${escapeXml(testCase.failureMessage)}" />`,
		`    </testcase>`
	].join("\n");
}
function renderTestSuite(suiteName, suiteCases) {
	const failureCount = suiteCases.filter((testCase) => !testCase.passed).length;
	const casesXml = suiteCases.map(renderTestCase).join("\n");
	return [
		`  <testsuite name="${escapeXml(suiteName)}" tests="${suiteCases.length}" failures="${failureCount}">`,
		casesXml,
		`  </testsuite>`
	].join("\n");
}
function renderJUnitXml(cases) {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${[...groupBySuite(cases)].map(([suiteName, suiteCases]) => renderTestSuite(suiteName, suiteCases)).join("\n")}\n</testsuites>\n`;
}
// src/harness/serveHttpApi.ts
/** Binds a router layer to an ephemeral port as one background fiber
* bound to the caller's scope, returning that port. Extracted after this
* exact shape showed up verbatim twice. */
function serveHttpApiOnEphemeralPort(routerLayer) {
	return Effect.gen(function* () {
		const portDeferred = yield* Deferred.make();
		const portSignalLayer = Layer.effectDiscard(Effect.gen(function* () {
			const server = yield* HttpServer.HttpServer;
			const port = server.address._tag === "UnixPathAddress" ? 0 : server.address.port;
			yield* Deferred.succeed(portDeferred, port);
		}));
		const apiLayer = Layer.merge(routerLayer, portSignalLayer).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port: 0 })));
		yield* Effect.forkScoped(Layer.launch(apiLayer));
		return yield* Deferred.await(portDeferred);
	});
}
// src/harness/mockBackend.ts
/** Caller provides a `Scope` (e.g. via `Effect.scoped`) spanning however long
* the backend must stay listening -- the background fiber serving it is
* interrupted, and the port released, when that scope closes. */
function startMockBackend() {
	return Effect.gen(function* () {
		const nextResponse = yield* Ref.make(null);
		const received = yield* Ref.make([]);
		const nextDelay = yield* Ref.make(null);
		const nextFailure = yield* Ref.make(false);
		const inFlight = yield* Ref.make(0);
		const peakInFlight = yield* Ref.make(0);
		const nextPreActionResponse = yield* Ref.make(null);
		const receivedPreActionChecks = yield* Ref.make([]);
		const respond = Effect.fn("mockBackend.respond")(function* (request) {
			yield* Ref.update(received, (log) => [...log, request]);
			return yield* trackInFlightThenRespondOrFail({
				nextResponse,
				nextDelay,
				nextFailure
			}, {
				inFlight,
				peakInFlight
			});
		});
		const respondToPreActionCheck = Effect.fn("mockBackend.respondToPreActionCheck")(function* (request) {
			yield* Ref.update(receivedPreActionChecks, (log) => [...log, request]);
			const response = yield* Ref.get(nextPreActionResponse);
			if (!response) return yield* Effect.die(/* @__PURE__ */ new Error("mock backend: no pre-action-check response configured for this scenario"));
			return response;
		});
		const GroupLayer = HttpApiBuilder.group(MockBackendHttpApi, "ingestion", (handlers) => handlers.handle("checkIn", ({ payload }) => respond(payload)).handle("preActionCheck", ({ payload }) => respondToPreActionCheck(payload)));
		return {
			baseUrl: `http://localhost:${yield* serveHttpApiOnEphemeralPort(HttpApiBuilder.layer(MockBackendHttpApi).pipe(Layer.provide(GroupLayer), HttpRouter.serve))}`,
			setNextResponse: (response) => Ref.set(nextResponse, response),
			receivedCheckIns: () => Ref.get(received),
			setNextCheckInDelay: (duration) => Ref.set(nextDelay, duration),
			setNextCheckInFailure: ({ shouldFail }) => Ref.set(nextFailure, shouldFail),
			peakConcurrentCheckIns: () => Ref.get(peakInFlight),
			setNextPreActionCheckResponse: (response) => Ref.set(nextPreActionResponse, response),
			receivedPreActionChecks: () => Ref.get(receivedPreActionChecks)
		};
	});
}
/** Applies the scripted delay/failure around producing a response, while
* keeping the concurrent-in-flight count accurate even if this fiber is
* interrupted (a timed-out scenario) partway through waiting. */
function trackInFlightThenRespondOrFail(script, counters) {
	return Effect.gen(function* () {
		const current = yield* Ref.updateAndGet(counters.inFlight, (n) => n + 1);
		yield* Ref.update(counters.peakInFlight, (peak) => Math.max(peak, current));
		const delay = yield* Ref.get(script.nextDelay);
		if (delay !== null) yield* Effect.sleep(delay);
		if (yield* Ref.get(script.nextFailure)) return yield* Effect.die(/* @__PURE__ */ new Error("mock backend: injected check-in failure"));
		const response = yield* Ref.get(script.nextResponse);
		if (!response) return yield* Effect.die(/* @__PURE__ */ new Error("mock backend: no response configured for this scenario"));
		return response;
	}).pipe(Effect.ensuring(Ref.update(counters.inFlight, (n) => n - 1)));
}
// src/harness/runAll.ts
/** Runs every scenario against one already-listening test service, each
* against its own fresh mock backend and keypair so scenarios can never
* leak state into one another. */
function runAllScenarios(testServiceBaseUrl, scenarios) {
	return Effect.forEach(scenarios, (scenario) => Effect.gen(function* () {
		const backend = yield* startMockBackend();
		const keypair = yield* generateTestKeypair();
		const testService = yield* connectToTestService(testServiceBaseUrl);
		const exit = yield* scenario.run({
			backend,
			keypair,
			testService
		}).pipe(Effect.exit);
		return exit._tag === "Success" ? {
			name: scenario.name,
			tier: scenario.tier,
			passed: true
		} : {
			name: scenario.name,
			tier: scenario.tier,
			passed: false,
			error: exit.cause
		};
	}).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)));
}
// src/scenarios/happyPathCheckIn.ts
/** The simplest conformance check: a `current` policy must leave the
* adapter reporting `idle` -- the tracer-bullet case every check-in loop
* must get right first. */
const happyPathCheckIn = {
	name: "a current policy leaves the adapter idle",
	tier: 1,
	run: ({ backend, keypair, testService }) => Effect.gen(function* () {
		const signed = yield* keypair.sign({
			type: "current",
			issuedAt: (/* @__PURE__ */ new Date()).toISOString(),
			environment: "conformance-harness"
		});
		yield* backend.setNextResponse({
			protocolVersion: 1,
			policy: signed.policy,
			signature: signed.signature
		});
		const adapter = yield* testService.testService.createAdapter({ payload: {
			checkInBaseUrl: backend.baseUrl,
			publicKeyPem: keypair.publicKeyPem
		} });
		yield* testService.testService.runCommand({
			params: { id: adapter.id },
			payload: { command: "checkNow" }
		});
		const state = yield* testService.testService.runCommand({
			params: { id: adapter.id },
			payload: { command: "getAdapterState" }
		});
		if (typeof state.result !== "object" || state.result === null || state.result.type !== "idle") return yield* Effect.die(/* @__PURE__ */ new Error(`expected adapter state "idle" after a current policy, got ${JSON.stringify(state.result)}`));
		yield* testService.testService.destroyAdapter({ params: { id: adapter.id } });
	})
};
// src/scenarios/jitterFractionEquivalence.ts
/** The one check in this harness that asserts true numeric equality, not
* "reasonable behavior" -- the spec requires the jitter fraction to be a
* deterministic function of `installationId`, identical in every SDK. */
const jitterFractionEquivalence = {
	name: "every SDK computes the identical jitter fraction for the same installationId",
	run: (testServices) => Effect.gen(function* () {
		const installationId = "equivalence-check-installation";
		const fractionsBySdk = /* @__PURE__ */ new Map();
		for (const [sdkName, client] of testServices) {
			const response = yield* client.testService.jitterFraction({ payload: { installationId } });
			fractionsBySdk.set(sdkName, response.fraction);
		}
		const fractions = [...fractionsBySdk.values()];
		if (!fractions.every((fraction) => fraction === fractions[0])) return yield* Effect.die(/* @__PURE__ */ new Error(`jitter fraction mismatch across SDKs: ${JSON.stringify([...fractionsBySdk])}`));
	})
};
// src/scenarios/preActionCheck.ts
/** `pre-action-check` conformance coverage. Tier 2: this is a brand-new
* wire endpoint and `triggerPreActionCheck` a brand-new test-service
* command -- no real SDK's test service implements it yet, so this is
* expected to fail there until each one adds support. */
const preActionCheckRoundTrip = {
	name: "pre-action-check sends a well-formed request and the adapter honors the signed policy it gets back",
	tier: 2,
	run: ({ backend, keypair, testService }) => Effect.gen(function* () {
		const signed = yield* keypair.sign({
			type: "held",
			issuedAt: (/* @__PURE__ */ new Date()).toISOString(),
			environment: "conformance-harness",
			reason: "maintenance window"
		});
		yield* backend.setNextPreActionCheckResponse({
			protocolVersion: 1,
			policy: signed.policy,
			signature: signed.signature
		});
		const adapter = yield* testService.testService.createAdapter({ payload: {
			checkInBaseUrl: backend.baseUrl,
			publicKeyPem: keypair.publicKeyPem
		} });
		const result = yield* testService.testService.runCommand({
			params: { id: adapter.id },
			payload: {
				command: "triggerPreActionCheck",
				stage: "pre-download"
			}
		});
		const lastRequest = (yield* backend.receivedPreActionChecks()).at(-1);
		if (lastRequest?.stage !== "pre-download") return yield* Effect.die(/* @__PURE__ */ new Error(`expected the request to carry stage "pre-download", got ${JSON.stringify(lastRequest)}`));
		if (result.result !== "held") return yield* Effect.die(/* @__PURE__ */ new Error(`expected the adapter to resolve a "held" policy from pre-action-check, got ${JSON.stringify(result.result)}`));
		yield* testService.testService.destroyAdapter({ params: { id: adapter.id } });
	})
};
// src/scenarios/adapterConformance.ts
/** Shared shape for a conformance check that creates an adapter, drives
* it, and asserts the exact resulting `AdapterState` before cleanup. */
function stateMappingScenario(options) {
	return {
		name: options.name,
		tier: options.tier ?? 1,
		run: (context) => Effect.gen(function* () {
			const adapter = yield* options.createAdapter(context);
			yield* options.act(context, adapter);
			const state = yield* context.testService.testService.runCommand({
				params: { id: adapter.id },
				payload: { command: "getAdapterState" }
			});
			if (!options.areEquivalent(state.result, options.expectedState)) return yield* Effect.die(/* @__PURE__ */ new Error(`expected ${JSON.stringify(options.expectedState)}, got ${JSON.stringify(state.result)}`));
			yield* context.testService.testService.destroyAdapter({ params: { id: adapter.id } });
		})
	};
}
// src/scenarios/resilience.ts
/** The one check-in state every resilience scenario expects to land on --
* none of them ever advance past `idle`, so a mismatch here means the
* adapter surfaced the injected fault instead of failing open. */
function statesHaveSameType(a, b) {
	return a.type === b.type;
}
function signedCurrentPolicy(keypair) {
	return keypair.sign({
		type: "current",
		issuedAt: (/* @__PURE__ */ new Date()).toISOString(),
		environment: "conformance-harness"
	});
}
// src/cli.ts
/** Every scenario needing the check-in handshake (mock backend + signed
* keypair), not just `injectEvent` -- gated on `supportsCheckIn`, since a
* test service without it can't run any of these. */
const CHECK_IN_SCENARIOS = [
	happyPathCheckIn,
	...[
		stateMappingScenario({
			name: "a check-in that never returns still lets the adapter proceed within a bounded time (fail-open)",
			tier: 2,
			createAdapter: ({ backend, keypair, testService }) => Effect.gen(function* () {
				yield* backend.setNextCheckInDelay("20 seconds");
				return yield* testService.testService.createAdapter({ payload: {
					checkInBaseUrl: backend.baseUrl,
					publicKeyPem: keypair.publicKeyPem
				} });
			}),
			act: ({ testService }, adapter) => testService.testService.runCommand({
				params: { id: adapter.id },
				payload: { command: "checkNow" }
			}).pipe(Effect.timeout("15 seconds")),
			areEquivalent: statesHaveSameType,
			expectedState: { type: "idle" }
		}),
		stateMappingScenario({
			name: "a check-in call that fails outright still leaves the adapter idle (fail-open)",
			createAdapter: ({ backend, keypair, testService }) => Effect.gen(function* () {
				yield* backend.setNextCheckInFailure({ shouldFail: true });
				return yield* testService.testService.createAdapter({ payload: {
					checkInBaseUrl: backend.baseUrl,
					publicKeyPem: keypair.publicKeyPem
				} });
			}),
			act: ({ testService }, adapter) => testService.testService.runCommand({
				params: { id: adapter.id },
				payload: { command: "checkNow" }
			}),
			areEquivalent: statesHaveSameType,
			expectedState: { type: "idle" }
		}),
		{
			name: "an in-flight check-in is never joined by a second, concurrent attempt",
			tier: 1,
			run: ({ backend, keypair, testService }) => Effect.gen(function* () {
				const signed = yield* signedCurrentPolicy(keypair);
				yield* backend.setNextResponse({
					protocolVersion: 1,
					policy: signed.policy,
					signature: signed.signature
				});
				yield* backend.setNextCheckInDelay("300 millis");
				const adapter = yield* testService.testService.createAdapter({ payload: {
					checkInBaseUrl: backend.baseUrl,
					publicKeyPem: keypair.publicKeyPem
				} });
				const checkNow = testService.testService.runCommand({
					params: { id: adapter.id },
					payload: { command: "checkNow" }
				});
				yield* Effect.all([checkNow, checkNow], { concurrency: "unbounded" });
				const peak = yield* backend.peakConcurrentCheckIns();
				if (peak > 1) return yield* Effect.die(/* @__PURE__ */ new Error(`expected at most 1 check-in in flight at a time, observed ${peak} overlapping`));
				yield* testService.testService.destroyAdapter({ params: { id: adapter.id } });
			})
		}
	],
	preActionCheckRoundTrip
];
function scenariosFor(capabilities) {
	return capabilities.supportsCheckIn ? CHECK_IN_SCENARIOS : [];
}
function writeJUnitReport(path, cases) {
	writeFileSync(path, renderJUnitXml(cases));
}
function runConformance(testServiceBaseUrl, options) {
	return Effect.gen(function* () {
		const capabilities = yield* (yield* connectToTestService(testServiceBaseUrl).pipe(Effect.provide(FetchHttpClient.layer))).testService.capabilities().pipe(Effect.provide(FetchHttpClient.layer));
		const scenarios = scenariosFor(capabilities);
		const suiteName = `${capabilities.sdkName}@${capabilities.sdkVersion}`;
		console.log(`running against ${suiteName} (${scenarios.length} scenarios)`);
		const results = yield* runAllScenarios(testServiceBaseUrl, scenarios);
		for (const result of results) {
			console.log(`${result.passed ? "PASS" : "FAIL"} [tier ${result.tier}] ${result.name}`);
			if (!result.passed) console.error(result.error);
		}
		if (options.junit) writeJUnitReport(options.junit, results.map((result) => toJUnitCase({
			suiteName,
			name: result.name,
			passed: result.passed,
			error: result.error
		})));
		const { effectiveResults, relegated } = applyRelegations(results, options.history, options.historyRuns);
		for (const name of relegated) console.error(`RELEGATED: "${name}" failed every one of its last ${options.historyRuns} runs -- auto-relegated from tier 1 to tier 2 for this run's gate.`);
		const tier1Failed = effectiveResults.some((result) => !result.passed && result.tier === 1);
		const tier2Failed = tier2PassRateBelowThreshold(effectiveResults);
		if (tier1Failed || tier2Failed) process.exitCode = 1;
	});
}
function runEquivalence(namedUrlArgs, options) {
	const testServiceBaseUrls = /* @__PURE__ */ new Map();
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
		const junitCases = [];
		for (const check of checks) {
			const result = yield* runEquivalenceCheck(testServiceBaseUrls, check);
			console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}`);
			if (!result.passed) {
				console.error(result.error);
				process.exitCode = 1;
			}
			junitCases.push(toJUnitCase({
				suiteName: "equivalence",
				name: result.name,
				passed: result.passed,
				error: result.error
			}));
		}
		if (options.junit) writeJUnitReport(options.junit, junitCases);
	});
}
const program = new Command();
program.name("sdk-conformance-harness").description("Shared conformance test harness for Barrel's per-platform SDKs");
program.command("conformance <test-service-base-url>").description("run this SDK's conformance scenarios against its own test service").option("--junit <path>", "also write results as JUnit XML, for CI PR-check integration").option("--history <path>", "run-history file tracking each scenario's pass/fail record, for tier-1 relegation", ".conformance-history.json").option("--history-runs <n>", "how many recent runs a scenario's relegation/trend is tracked over", (value) => Number.parseInt(value, 10), 5).action((testServiceBaseUrl, options) => {
	NodeRuntime.runMain(runConformance(testServiceBaseUrl, options));
});
program.command("equivalence <name=url...>").description("run cross-SDK equivalence checks against every named test service").option("--junit <path>", "also write results as JUnit XML, for CI PR-check integration").action((namedUrlArgs, options) => {
	NodeRuntime.runMain(runEquivalence(namedUrlArgs, options));
});
program.parse();
export {};

//# sourceMappingURL=cli.js.map