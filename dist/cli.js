#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Command, InvalidArgumentError } from "commander";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http";
import * as Schema from "effect/Schema";
import { HttpApiBuilder, HttpApiClient } from "effect/http-api";
import { _ as CheckInRequest, h as UpdaterActivity, i as MockBackendHttpApi, m as TestServiceHttpApi, n as generateTestKeypair, t as referenceJitterFraction, x as UpdateState } from "./jitter-D9p08fbZ.js";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import "effect/Duration";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { createServer, request } from "node:http";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
// src/reporting/relegationHistory.ts
const EMPTY_HISTORY = { scenarios: {} };
/** Missing, malformed or invalidly shaped history starts empty. Concurrent writers must use separate history paths. */
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
/** Append bounded recent outcomes and discard entries for scenarios absent from this run. */
function recordOutcomes(history, results, maxRuns) {
	const scenarios = {};
	for (const result of results) {
		const previousOutcomes = history.scenarios[result.name]?.outcomes ?? [];
		scenarios[result.name] = { outcomes: [...previousOutcomes, result.passed].slice(-maxRuns) };
	}
	return { scenarios };
}
/** Relegate only after a full window of consecutive failures; a partial history never meets the threshold. */
function scenariosToRelegate(history, tier1Names, minRuns) {
	return tier1Names.filter((name) => {
		const outcomes = history.scenarios[name]?.outcomes ?? [];
		return outcomes.length >= minRuns && outcomes.every((passed) => !passed);
	});
}
const History = Schema.Struct({ scenarios: Schema.Record(Schema.String, Schema.Struct({ outcomes: Schema.Array(Schema.Boolean) })) });
const isRunHistory = Schema.is(History);
// src/reporting/conformanceGate.ts
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
// src/fixtures/testServiceClient.ts
/** Callers provide `FetchHttpClient.layer` around the whole scenario effect,
* not here -- the derived client's own calls need that layer live at call
* time, not just at derivation time. */
function connectToTestService(baseUrl) {
	return HttpApiClient.make(TestServiceHttpApi, { baseUrl });
}
// src/runner/equivalence.ts
function runEquivalenceCheck(testServiceBaseUrls, check) {
	if (testServiceBaseUrls.size < 2 || new Set(testServiceBaseUrls.values()).size < 2) return Effect.succeed({
		name: check.name,
		passed: false,
		error: /* @__PURE__ */ new Error("equivalence requires at least two distinct test services")
	});
	return Effect.gen(function* () {
		const testServices = /* @__PURE__ */ new Map();
		const sdkNames = /* @__PURE__ */ new Set();
		for (const [name, baseUrl] of testServiceBaseUrls) {
			const service = yield* connectToTestService(baseUrl);
			const capabilities = yield* service.testService.capabilities();
			if (sdkNames.has(capabilities.sdkName)) return yield* Effect.fail(/* @__PURE__ */ new Error(`equivalence repeats SDK implementation: ${capabilities.sdkName}`));
			sdkNames.add(capabilities.sdkName);
			testServices.set(name, service);
		}
		yield* check.run(testServices);
	}).pipe(Effect.exit, Effect.map((exit) => exit._tag === "Success" ? {
		name: check.name,
		passed: true
	} : {
		name: check.name,
		passed: false,
		error: exit.cause
	}), Effect.provide(FetchHttpClient.layer));
}
// src/reporting/junitReport.ts
/** `exactOptionalPropertyTypes` forbids an explicit `failureMessage: undefined`
* -- this conditionally omits the key entirely on a pass, instead. */
function toJUnitCase(options) {
	const { suiteName, name, passed, error } = options;
	return {
		suiteName,
		name,
		passed,
		...!passed && { failureMessage: Cause.isCause(error) ? Cause.pretty(error) : String(error) }
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
	if (testCase.passed) return `    <testcase name="${escapeXml(testCase.name)}" classname="${escapeXml(testCase.suiteName)}" />`;
	return [
		`    <testcase name="${escapeXml(testCase.name)}" classname="${escapeXml(testCase.suiteName)}">`,
		`      <failure message="${escapeXml(testCase.failureMessage || "Scenario failed without a diagnostic")}" />`,
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
// src/fixtures/serveHttpApi.ts
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
// src/fixtures/mockBackend.ts
/** Caller provides a `Scope` (e.g. via `Effect.scoped`) spanning however long
* the backend must stay listening -- the background fiber serving it is
* interrupted, and the port released, when that scope closes. */
function startMockBackend() {
	return Effect.gen(function* () {
		const authorization = yield* Ref.make([]);
		const rawReceived = yield* Ref.make([]);
		const nextResponse = yield* Ref.make(null);
		const received = yield* Ref.make([]);
		const nextDelay = yield* Ref.make(null);
		const checkInGate = yield* Ref.make(null);
		const nextFailure = yield* Ref.make(false);
		const inFlight = yield* Ref.make(0);
		const peakInFlight = yield* Ref.make(0);
		const preActionDelay = yield* Ref.make(null);
		const preActionFailure = yield* Ref.make(false);
		const nextPreActionResponse = yield* Ref.make(null);
		const receivedPreActionChecks = yield* Ref.make([]);
		const respond = Effect.fn("mockBackend.respond")(function* (request) {
			yield* Ref.update(received, (log) => [...log, request]);
			return yield* trackInFlightThenRespondOrFail({
				nextResponse,
				nextDelay,
				nextFailure,
				checkInGate
			}, {
				inFlight,
				peakInFlight
			});
		});
		const respondToPreActionCheck = Effect.fn("mockBackend.respondToPreActionCheck")(function* (request) {
			yield* Ref.update(receivedPreActionChecks, (log) => [...log, request]);
			const delay = yield* Ref.get(preActionDelay);
			if (delay !== null) yield* Effect.sleep(delay);
			if (yield* Ref.get(preActionFailure)) return yield* Effect.die(/* @__PURE__ */ new Error("mock backend: injected pre-action-check failure"));
			const response = yield* Ref.get(nextPreActionResponse);
			if (!response) return yield* Effect.die(/* @__PURE__ */ new Error("mock backend: no pre-action-check response configured for this scenario"));
			return response;
		});
		const GroupLayer = HttpApiBuilder.group(MockBackendHttpApi, "ingestion", (handlers) => handlers.handle("checkIn", ({ payload, headers }) => Effect.gen(function* () {
			yield* Ref.update(authorization, (log) => [...log, headers.authorization]);
			yield* Ref.update(rawReceived, (log) => [...log, payload]);
			return yield* respond(yield* Schema.decodeUnknownEffect(CheckInRequest)(payload).pipe(Effect.orDie));
		})).handle("preActionCheck", ({ payload }) => respondToPreActionCheck(payload)));
		return {
			baseUrl: `http://localhost:${yield* serveHttpApiOnEphemeralPort(HttpApiBuilder.layer(MockBackendHttpApi).pipe(Layer.provide(GroupLayer), HttpRouter.serve))}`,
			receivedCheckInAuthorization: () => Ref.get(authorization),
			receivedRawCheckIns: () => Ref.get(rawReceived),
			setNextResponse: (response) => Ref.set(nextResponse, response),
			receivedCheckIns: () => Ref.get(received),
			blockCheckInResponses: () => Effect.gen(function* () {
				const gate = yield* Deferred.make();
				yield* Ref.set(checkInGate, gate);
				return Effect.gen(function* () {
					yield* Deferred.succeed(gate, void 0);
					yield* Ref.set(checkInGate, null);
				});
			}),
			setNextCheckInDelay: (duration) => Ref.set(nextDelay, duration),
			setNextCheckInFailure: ({ shouldFail }) => Ref.set(nextFailure, shouldFail),
			peakConcurrentCheckIns: () => Ref.get(peakInFlight),
			setNextPreActionCheckResponse: (response) => Ref.set(nextPreActionResponse, response),
			setNextPreActionCheckDelay: (duration) => Ref.set(preActionDelay, duration),
			setNextPreActionCheckFailure: ({ shouldFail }) => Ref.set(preActionFailure, shouldFail),
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
		const gate = yield* Ref.get(script.checkInGate);
		if (gate !== null) yield* Deferred.await(gate);
		const delay = yield* Ref.get(script.nextDelay);
		if (delay !== null) yield* Effect.sleep(delay);
		if (yield* Ref.get(script.nextFailure)) return yield* Effect.die(/* @__PURE__ */ new Error("mock backend: injected check-in failure"));
		const response = yield* Ref.get(script.nextResponse);
		if (!response) return yield* Effect.die(/* @__PURE__ */ new Error("mock backend: no response configured for this scenario"));
		return response;
	}).pipe(Effect.ensuring(Ref.update(counters.inFlight, (n) => n - 1)));
}
// src/runner/runAll.ts
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
// src/fixtures/adapterFixture.ts
function withAdapter$1(context, run, config = {}) {
	const api = context.testService.testService;
	return Effect.acquireUseRelease(api.createAdapter({ payload: {
		checkInBaseUrl: context.backend.baseUrl,
		publicKeyPem: context.keypair.publicKeyPem,
		...config
	} }), ({ id }) => run((payload) => api.runCommand({
		params: { id },
		payload
	}).pipe(Effect.map((response) => response.result))), ({ id }) => api.destroyAdapter({ params: { id } }).pipe(Effect.orDie));
}
function updaterActivity(command) {
	return command({ command: "getUpdaterActivity" }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(UpdaterActivity)));
}
// src/scenarios/wireIdentity.ts
const wireIdentity = {
	name: "check-ins generate fresh event identities and valid timestamps while preserving installation identity",
	tier: 1,
	run: (context) => Effect.gen(function* () {
		const signed = yield* context.keypair.sign({
			type: "held",
			issuedAt: (/* @__PURE__ */ new Date()).toISOString(),
			environment: "test"
		});
		yield* context.backend.setNextResponse({
			protocolVersion: 1,
			...signed
		});
		yield* withAdapter$1(context, (command) => Effect.gen(function* () {
			for (let tick = 0; tick < 3; tick++) yield* command({ command: "checkNow" });
			const requests = yield* context.backend.receivedCheckIns();
			ok(requests.length >= 3);
			strictEqual(new Set(requests.map(({ eventId }) => eventId)).size, requests.length);
			strictEqual(new Set(requests.map(({ installationId }) => installationId)).size, 1);
			ok(requests.every(({ checkedInAt }) => Number.isFinite(Date.parse(checkedInAt))));
			const headers = yield* context.backend.receivedCheckInAuthorization();
			strictEqual(headers.length, requests.length);
			ok(headers.every((value) => value === "Bearer test-service"));
		}));
	})
};
// src/fixtures/runtimeAssertions.ts
const CadenceState = Schema.Struct({
	intervalMs: Schema.NullOr(Schema.Number),
	inFlight: Schema.Boolean,
	logs: Schema.Array(Schema.String),
	lifecycleEvents: Schema.Array(Schema.Literals(["foreground", "resume"]))
});
function waitForCheckIns(context, count) {
	return Effect.gen(function* () {
		for (let attempt = 0; attempt < 200; attempt++) {
			const received = yield* context.backend.receivedCheckIns();
			if (received.length >= count) return received;
			yield* Effect.sleep("20 millis");
		}
		return yield* Effect.die(/* @__PURE__ */ new Error(`expected ${count} production check-ins`));
	});
}
function readState(command) {
	return command({ command: "getCadenceState" }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(CadenceState)));
}
function waitForIdle(command) {
	return Effect.gen(function* () {
		for (let attempt = 0; attempt < 200; attempt++) {
			if (!(yield* readState(command)).inFlight) return;
			yield* Effect.sleep("20 millis");
		}
		return yield* Effect.die(/* @__PURE__ */ new Error("cadence did not become idle"));
	});
}
// src/scenarios/updateEligibility.ts
const base = {
	issuedAt: "2026-01-01T00:00:00.000Z",
	environment: "test"
};
const updateEligibilityCases = [
	{
		...base,
		type: "unrestricted"
	},
	{
		...base,
		type: "held"
	},
	{
		...base,
		type: "held",
		reason: "maintenance",
		until: "2099-01-01T00:00:00.000Z"
	},
	{
		...base,
		type: "eligible"
	},
	{
		...base,
		type: "eligible",
		priority: "normal"
	},
	{
		...base,
		type: "eligible",
		priority: "high"
	}
];
function invalidUpdateEligibilityResponses(keypair) {
	return Effect.gen(function* () {
		const valid = yield* keypair.sign({
			...base,
			type: "eligible",
			priority: "high"
		});
		const wrongKey = yield* (yield* generateTestKeypair()).sign({
			...base,
			type: "unrestricted"
		});
		const malformed = yield* keypair.signRaw("not json");
		const unknown = yield* keypair.signRaw(JSON.stringify({
			...base,
			type: "unknown"
		}));
		const missingFields = yield* keypair.signRaw("{\"type\":\"held\"}");
		return [
			{
				...valid,
				updateEligibility: valid.updateEligibility.replace("\"high\"", "\"normal\"")
			},
			{
				...valid,
				signature: "not-base64!"
			},
			wrongKey,
			malformed,
			unknown,
			missingFields
		].map((response) => ({
			protocolVersion: 1,
			...response
		}));
	});
}
const updateEligibilityScenarios = [
	{
		name: "every signed UpdateEligibility variant is cached and observable",
		tier: 1,
		run: (context) => withAdapter$1(context, (command) => Effect.gen(function* () {
			deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), null);
			const initialState = yield* command({ command: "getUpdateState" });
			for (const updateEligibility of updateEligibilityCases) {
				const signed = yield* context.keypair.sign(updateEligibility);
				yield* context.backend.setNextResponse({
					protocolVersion: 1,
					...signed
				});
				yield* command({ command: "checkNow" });
				deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), updateEligibility);
				deepStrictEqual(yield* command({ command: "getUpdateState" }), initialState);
			}
		}))
	},
	{
		name: "invalid signatures, invalid update eligibilities and failed check-ins preserve the last verified update eligibility",
		tier: 1,
		run: (context) => withAdapter$1(context, (command) => Effect.gen(function* () {
			const invalid = yield* invalidUpdateEligibilityResponses(context.keypair);
			const cached = {
				...base,
				type: "held",
				reason: "cached decision"
			};
			const signed = yield* context.keypair.sign(cached);
			for (const expected of [null, cached]) {
				if (expected) {
					yield* context.backend.setNextResponse({
						protocolVersion: 1,
						...signed
					});
					yield* command({ command: "checkNow" });
				}
				for (const response of invalid) {
					yield* context.backend.setNextResponse(response);
					yield* command({ command: "checkNow" });
					deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), expected);
				}
				yield* context.backend.setNextCheckInFailure({ shouldFail: true });
				yield* command({ command: "checkNow" });
				deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), expected);
				yield* context.backend.setNextCheckInFailure({ shouldFail: false });
			}
		}))
	},
	{
		name: "absent, normal and high priority never force a download or apply",
		tier: 1,
		run: (context) => withAdapter$1(context, (command) => Effect.gen(function* () {
			for (const priority of [
				void 0,
				"normal",
				"high"
			]) {
				const updateEligibility = {
					...base,
					type: "eligible",
					...priority ? { priority } : {}
				};
				const signed = yield* context.keypair.sign(updateEligibility);
				yield* context.backend.setNextResponse({
					protocolVersion: 1,
					...signed
				});
				yield* command({
					command: "prepareAction",
					stage: "pre-download"
				});
				const before = yield* updaterActivity(command);
				yield* command({ command: "checkNow" });
				deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), updateEligibility);
				const after = yield* updaterActivity(command);
				deepStrictEqual(after, {
					checks: before.checks,
					downloads: before.downloads,
					applies: before.applies
				});
				yield* command({
					command: "prepareAction",
					stage: "pre-download"
				});
				const offered = yield* updaterActivity(command);
				deepStrictEqual([offered.downloads, offered.applies], [after.downloads, after.applies]);
				yield* command({
					command: "prepareAction",
					stage: "pre-apply"
				});
				const downloaded = yield* updaterActivity(command);
				deepStrictEqual(downloaded.applies, offered.applies);
				const requests = yield* context.backend.receivedPreActionChecks();
				deepStrictEqual(requests, []);
			}
		}))
	}
];
// src/scenarios/preActionCheck.ts
const stages = ["pre-download", "pre-apply"];
function assertAction(command, options) {
	return Effect.gen(function* () {
		yield* command({
			command: "prepareAction",
			stage: options.stage
		});
		const before = yield* updaterActivity(command);
		yield* command({
			command: "runAction",
			stage: options.stage
		}).pipe(Effect.timeout("15 seconds"));
		const after = yield* updaterActivity(command);
		const field = options.stage === "pre-download" ? "downloads" : "applies";
		deepStrictEqual(after, {
			...before,
			[field]: before[field] + (options.proceeds ? 1 : 0)
		});
	});
}
function assertRequest(context, stage, before) {
	return Effect.gen(function* () {
		const requests = yield* context.backend.receivedPreActionChecks();
		strictEqual(requests.length, before + 1);
		strictEqual(requests.at(-1)?.stage, stage);
		const checkIns = yield* context.backend.receivedCheckIns();
		strictEqual(requests.at(-1)?.installationId, checkIns.at(-1)?.installationId);
	});
}
const preActionCheckScenarios = [
	{
		name: "production download and apply each check once; held blocks and other eligibility verdicts allow the action",
		tier: 1,
		run: (context) => withAdapter$1(context, (command) => Effect.gen(function* () {
			const signedCache = yield* context.keypair.sign({
				type: "unrestricted",
				issuedAt: "2026-01-01T00:00:00.000Z",
				environment: "cached"
			});
			yield* context.backend.setNextResponse({
				protocolVersion: 1,
				...signedCache
			});
			yield* command({ command: "checkNow" });
			for (const stage of stages) for (const updateEligibility of updateEligibilityCases) {
				const signed = yield* context.keypair.sign(updateEligibility);
				yield* context.backend.setNextPreActionCheckResponse({
					protocolVersion: 1,
					...signed
				});
				yield* context.backend.setNextResponse({
					protocolVersion: 1,
					...signed
				});
				const before = (yield* context.backend.receivedPreActionChecks()).length;
				yield* assertAction(command, {
					stage,
					proceeds: updateEligibility.type !== "held"
				});
				yield* assertRequest(context, stage, before);
				deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), updateEligibility);
			}
		}))
	},
	{
		name: "production download and apply proceed on invalid signatures, malformed eligibility verdicts and HTTP failure",
		tier: 1,
		run: (context) => withAdapter$1(context, (command) => Effect.gen(function* () {
			const invalid = yield* invalidUpdateEligibilityResponses(context.keypair);
			const cached = {
				type: "held",
				issuedAt: "2026-01-01T00:00:00.000Z",
				environment: "cached"
			};
			const signed = yield* context.keypair.sign(cached);
			yield* context.backend.setNextResponse({
				protocolVersion: 1,
				...signed
			});
			yield* command({ command: "checkNow" });
			for (const stage of stages) {
				for (const response of invalid) {
					yield* context.backend.setNextPreActionCheckResponse(response);
					const before = (yield* context.backend.receivedPreActionChecks()).length;
					yield* assertAction(command, {
						stage,
						proceeds: true
					});
					yield* assertRequest(context, stage, before);
					deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), cached);
				}
				yield* context.backend.setNextPreActionCheckFailure({ shouldFail: true });
				const before = (yield* context.backend.receivedPreActionChecks()).length;
				yield* assertAction(command, {
					stage,
					proceeds: true
				});
				yield* assertRequest(context, stage, before);
				deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), cached);
				yield* context.backend.setNextPreActionCheckFailure({ shouldFail: false });
			}
		}))
	},
	{
		name: "production download and apply proceed when the backend cannot be reached",
		tier: 1,
		run: (context) => withAdapter$1({
			...context,
			backend: {
				...context.backend,
				baseUrl: "http://127.0.0.1:0"
			}
		}, (command) => Effect.gen(function* () {
			for (const stage of stages) {
				yield* assertAction(command, {
					stage,
					proceeds: true
				});
				deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), null);
			}
		}))
	},
	{
		name: "neither download nor apply starts before its pre-action response",
		tier: 1,
		run: (context) => withAdapter$1(context, (command) => Effect.gen(function* () {
			const signed = yield* context.keypair.sign({
				type: "unrestricted",
				issuedAt: "2026-01-01T00:00:00.000Z",
				environment: "test"
			});
			yield* context.backend.setNextPreActionCheckResponse({
				protocolVersion: 1,
				...signed
			});
			yield* context.backend.setNextPreActionCheckDelay("300 millis");
			for (const stage of stages) {
				yield* command({
					command: "prepareAction",
					stage
				});
				const before = yield* updaterActivity(command);
				yield* Effect.all([command({
					command: "runAction",
					stage
				}), Effect.gen(function* () {
					yield* Effect.sleep("100 millis");
					deepStrictEqual(yield* updaterActivity(command), before);
				})], { concurrency: "unbounded" });
				const after = yield* updaterActivity(command);
				const field = stage === "pre-download" ? "downloads" : "applies";
				deepStrictEqual(after, {
					...before,
					[field]: before[field] + 1
				});
			}
		}))
	},
	{
		name: "production download and apply proceed within a bounded timeout",
		tier: 2,
		run: (context) => withAdapter$1(context, (command) => Effect.gen(function* () {
			yield* context.backend.setNextPreActionCheckDelay("20 seconds");
			for (const stage of stages) yield* assertAction(command, {
				stage,
				proceeds: true
			});
		}))
	}
];
const applyingStateSync = {
	name: "native apply awaits its applying check-in during a state-sync burst and an active heartbeat",
	tier: 1,
	run: (context) => withAdapter$1(context, (command) => Effect.gen(function* () {
		const signed = yield* context.keypair.sign({
			type: "held",
			issuedAt: (/* @__PURE__ */ new Date()).toISOString(),
			environment: "test"
		});
		yield* context.backend.setNextResponse({
			protocolVersion: 1,
			...signed
		});
		const allowed = yield* context.keypair.sign({
			type: "unrestricted",
			issuedAt: (/* @__PURE__ */ new Date()).toISOString(),
			environment: "test"
		});
		yield* context.backend.setNextPreActionCheckResponse({
			protocolVersion: 1,
			...allowed
		});
		yield* command({ command: "checkNow" });
		yield* command({
			command: "prepareAction",
			stage: "pre-apply"
		});
		yield* waitForIdle(command);
		yield* context.backend.setNextCheckInDelay("800 millis");
		const count = (yield* context.backend.receivedCheckIns()).length;
		yield* command({
			command: "triggerLifecycle",
			event: "foreground"
		});
		for (let attempt = 0; attempt < 200; attempt++) {
			if ((yield* context.backend.receivedCheckIns()).length > count) break;
			yield* Effect.sleep("20 millis");
		}
		strictEqual((yield* context.backend.receivedCheckIns()).length, count + 1);
		const before = yield* updaterActivity(command);
		yield* Effect.all([command({
			command: "runAction",
			stage: "pre-apply"
		}), Effect.gen(function* () {
			yield* Effect.sleep("300 millis");
			deepStrictEqual(yield* updaterActivity(command), before);
		})], { concurrency: "unbounded" });
		strictEqual((yield* updaterActivity(command)).applies, before.applies + 1);
		ok((yield* context.backend.receivedCheckIns()).some((request) => request.lifecycleState.type === "applying"));
	}), { lifecycle: true })
};
// src/scenarios/cadenceResilience.ts
function withAdapter(context, config, run) {
	return Effect.gen(function* () {
		const signed = yield* context.keypair.sign({
			type: "held",
			issuedAt: (/* @__PURE__ */ new Date()).toISOString(),
			environment: "test"
		});
		yield* context.backend.setNextResponse({
			protocolVersion: 1,
			...signed
		});
		yield* withAdapter$1(context, run, config);
	});
}
const cadenceResilienceScenarios = [
	{
		name: "production check-ins bound attribute keys and UTF-8 value bytes without corrupting text",
		tier: 1,
		run: (context) => Effect.gen(function* () {
			const oversized = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`key-${i}`, "x" + "😀".repeat(80)]));
			const cases = [{
				small: "café 😀",
				exact: "x".repeat(256)
			}, oversized];
			for (const attributes of cases) yield* withAdapter(context, { attributes }, (command) => Effect.gen(function* () {
				const before = (yield* context.backend.receivedCheckIns()).length;
				yield* command({ command: "checkNow" });
				const saved = (yield* waitForCheckIns(context, before + 1)).at(-1)?.attributes;
				ok(saved);
				strictEqual(Object.keys(saved).length, Math.min(20, Object.keys(attributes).length));
				for (const [key, value] of Object.entries(saved)) {
					ok(Buffer.byteLength(value, "utf8") <= 256);
					ok(!value.includes("�"));
					ok(attributes[key]?.startsWith(value));
					if (Buffer.byteLength(attributes[key] ?? "", "utf8") <= 256) strictEqual(value, attributes[key]);
				}
			}));
		})
	},
	{
		name: "failed installation-ID persistence retries the same runtime ID once storage recovers",
		tier: 1,
		run: (context) => withAdapter(context, {
			installationPersistence: "failed",
			lifecycle: true
		}, (command) => Effect.gen(function* () {
			const first = (yield* waitForCheckIns(context, 1))[0];
			yield* waitForIdle(command);
			ok(first);
			ok(/^[0-9a-f-]{36}$/i.test(first.installationId));
			strictEqual(yield* command({ command: "getPersistedInstallationId" }), null);
			yield* command({ command: "restoreInstallationPersistence" });
			strictEqual(yield* command({ command: "getPersistedInstallationId" }), null, "restoring storage must not supply the persistence retry");
			const count = (yield* context.backend.receivedCheckIns()).length;
			yield* command({
				command: "triggerLifecycle",
				event: "foreground"
			});
			const requests = yield* waitForCheckIns(context, count + 1);
			yield* waitForIdle(command);
			strictEqual(yield* command({ command: "getPersistedInstallationId" }), first.installationId);
			ok(requests.every((request) => request.installationId === first.installationId));
		}))
	},
	{
		name: "native scheduling clamps cadence bounds and reports the nominal interval independently of jitter",
		tier: 1,
		run: (context) => Effect.gen(function* () {
			for (const config of [
				{ checkInIntervalMs: 1 },
				{
					checkInIntervalMs: 1,
					debug: false
				},
				{
					checkInIntervalMs: 1,
					debug: true
				},
				{
					checkInIntervalMs: 36e5,
					debug: true
				},
				{
					checkInIntervalMs: 72e5,
					debug: true
				},
				{
					checkInIntervalMs: 216e5,
					debug: true
				}
			]) {
				const count = (yield* context.backend.receivedCheckIns()).length;
				yield* withAdapter(context, {
					...config,
					lifecycle: true
				}, (command) => Effect.gen(function* () {
					const requests = yield* waitForCheckIns(context, count + 1);
					const id = requests.at(-1)?.installationId;
					ok(id);
					const state = yield* readState(command);
					ok(state.intervalMs !== null);
					const nominal = Math.min(72e5, Math.max(9e5, config.checkInIntervalMs));
					strictEqual(requests.at(-1)?.checkInIntervalMs, nominal);
					const expected = nominal * (1 + referenceJitterFraction(id));
					ok(Math.abs(state.intervalMs - expected) <= 1);
					if (!config.debug) deepStrictEqual(state.logs, []);
					else if (config.checkInIntervalMs !== nominal) ok(state.logs.some((line) => line.includes("clamped")));
				}));
			}
		})
	},
	{
		name: "native foreground and supported resume triggers check in without overlapping or queuing attempts",
		tier: 1,
		run: (context) => withAdapter(context, { lifecycle: true }, (command) => Effect.gen(function* () {
			yield* waitForCheckIns(context, 1);
			yield* waitForIdle(command);
			const state = yield* readState(command);
			ok(state.lifecycleEvents.includes("foreground"));
			if ((yield* context.testService.testService.capabilities()).sdkName !== "tauri") ok(state.lifecycleEvents.includes("resume"));
			for (const event of state.lifecycleEvents) {
				const before = (yield* context.backend.receivedCheckIns()).length;
				yield* context.backend.setNextCheckInDelay("400 millis");
				yield* command({
					command: "triggerLifecycle",
					event
				});
				yield* waitForCheckIns(context, before + 1);
				yield* command({
					command: "triggerLifecycle",
					event
				});
				yield* waitForIdle(command);
				yield* Effect.sleep("100 millis");
				strictEqual((yield* context.backend.receivedCheckIns()).length, before + 1, "in-flight lifecycle trigger must be skipped, not queued");
				strictEqual(yield* context.backend.peakConcurrentCheckIns(), 1);
				yield* context.backend.setNextCheckInDelay(null);
				yield* command({
					command: "triggerLifecycle",
					event
				});
				yield* waitForCheckIns(context, before + 2);
				yield* waitForIdle(command);
			}
		}))
	},
	{
		name: "reportable native transitions sync immediately and debounce until five quiet seconds",
		tier: 1,
		run: (context) => withAdapter(context, { lifecycle: true }, (command) => Effect.gen(function* () {
			yield* waitForCheckIns(context, 1);
			yield* waitForIdle(command);
			yield* Effect.sleep("5500 millis");
			const before = (yield* context.backend.receivedCheckIns()).length;
			yield* command({
				command: "prepareAction",
				stage: "pre-download"
			});
			const leading = yield* waitForCheckIns(context, before + 1);
			strictEqual(leading.at(-1)?.lifecycleState.type, "available");
			yield* Effect.sleep("3 seconds");
			yield* command({
				command: "prepareAction",
				stage: "pre-download"
			});
			const afterPreparation = yield* updaterActivity(command);
			yield* Effect.sleep("2500 millis");
			strictEqual((yield* context.backend.receivedCheckIns()).length, before + 1);
			yield* Effect.sleep("3 seconds");
			const requests = yield* waitForCheckIns(context, before + 2);
			strictEqual(requests.length, before + 2);
			strictEqual(requests.at(-1)?.lifecycleState.type, "available");
			strictEqual(requests.at(-1)?.checkInIntervalMs, 18e5);
			deepStrictEqual(yield* updaterActivity(command), afterPreparation);
		}))
	},
	applyingStateSync,
	{
		name: "a reportable transition during an in-flight heartbeat is sent after that request finishes",
		tier: 1,
		run: (context) => withAdapter(context, { lifecycle: true }, (command) => Effect.gen(function* () {
			yield* waitForCheckIns(context, 1);
			yield* waitForIdle(command);
			yield* Effect.sleep("5500 millis");
			const before = (yield* context.backend.receivedCheckIns()).length;
			yield* context.backend.setNextCheckInDelay("600 millis");
			yield* command({
				command: "triggerLifecycle",
				event: "foreground"
			});
			yield* waitForCheckIns(context, before + 1);
			yield* command({
				command: "prepareAction",
				stage: "pre-download"
			});
			const requests = yield* waitForCheckIns(context, before + 2);
			strictEqual(requests.at(-1)?.lifecycleState.type, "available");
		}))
	}
];
// src/fixtures/checkInFaultProxy.ts
function listen(server, port) {
	return Effect.callback((resume) => {
		function onError(error) {
			resume(Effect.fail(error));
		}
		server.once("error", onError);
		server.listen(port, "127.0.0.1", () => {
			server.removeListener("error", onError);
			const address = server.address();
			if (address === null || typeof address === "string") {
				resume(Effect.fail(/* @__PURE__ */ new Error("fault proxy did not bind a TCP port")));
				return;
			}
			resume(Effect.succeed(address.port));
		});
	});
}
function close(server) {
	return Effect.callback((resume) => {
		server.closeAllConnections();
		server.close(() => resume(Effect.void));
	});
}
function startCheckInFaultProxy(backendUrl) {
	return Effect.gen(function* () {
		let fault = "none";
		let attempts = 0;
		const server = yield* Effect.acquireRelease(Effect.sync(() => createServer((incoming, response) => {
			attempts++;
			const requestFault = fault;
			if (requestFault === "disconnect") {
				incoming.socket.destroy();
				return;
			}
			const target = new URL(incoming.url ?? "/", backendUrl);
			const upstream = request(target, {
				method: incoming.method ?? "POST",
				headers: {
					...incoming.headers,
					host: target.host
				}
			}, (received) => {
				response.writeHead(requestFault === "http-error" ? 503 : received.statusCode ?? 502, received.headers);
				received.on("error", () => response.destroy());
				received.pipe(response);
			});
			upstream.on("error", () => response.destroy());
			incoming.on("error", () => upstream.destroy());
			response.on("close", () => upstream.destroy());
			incoming.pipe(upstream);
		})), close);
		const port = yield* listen(server, 0);
		return {
			baseUrl: `http://127.0.0.1:${port}`,
			attempts: () => Effect.sync(() => attempts),
			setFault: (next) => Effect.gen(function* () {
				fault = next;
				server.closeAllConnections();
				if (next === "unreachable") yield* close(server);
				else if (!server.listening) yield* listen(server, port);
			})
		};
	});
}
// src/scenarios/failOpen.ts
function failOpenScenario(options) {
	return {
		name: options.name,
		tier: 1,
		run: (context) => Effect.gen(function* () {
			const proxy = yield* startCheckInFaultProxy(context.backend.baseUrl);
			const cached = {
				type: "held",
				issuedAt: (/* @__PURE__ */ new Date()).toISOString(),
				environment: "cached"
			};
			const recovered = {
				...cached,
				environment: "recovered"
			};
			const signedCache = yield* context.keypair.sign(cached);
			const signedRecovery = yield* context.keypair.sign(recovered);
			yield* context.backend.setNextResponse({
				protocolVersion: 1,
				...signedCache
			});
			yield* withAdapter$1(context, (command) => Effect.gen(function* () {
				yield* command({ command: "checkNow" });
				yield* waitForIdle(command);
				deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), cached);
				yield* command({ command: "prepareUpdaterFailure" });
				yield* command({
					command: "prepareAction",
					stage: "pre-download"
				});
				yield* waitForIdle(command);
				const state = yield* command({ command: "getUpdateState" });
				const lastError = yield* command({ command: "getLastUpdateError" });
				ok(lastError, "fixture must establish a classified updater error");
				const activity = yield* updaterActivity(command);
				const before = yield* proxy.attempts();
				yield* context.backend.setNextResponse({
					protocolVersion: 1,
					...signedRecovery,
					...options.badSignature ? { updateEligibility: signedRecovery.updateEligibility.replace("recovered", "tampered") } : {}
				});
				yield* proxy.setFault(options.fault);
				yield* command({ command: "checkNow" }).pipe(Effect.timeout("13 seconds"));
				yield* waitForIdle(command);
				deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), cached);
				deepStrictEqual(yield* command({ command: "getUpdateState" }), state);
				deepStrictEqual(yield* command({ command: "getLastUpdateError" }), lastError);
				deepStrictEqual(yield* updaterActivity(command), activity);
				const attempts = yield* proxy.attempts();
				strictEqual(attempts, before + (options.fault === "unreachable" ? 0 : 1));
				yield* Effect.sleep("300 millis");
				strictEqual(yield* proxy.attempts(), attempts, "failure must not start its own retry loop");
				deepStrictEqual(yield* updaterActivity(command), activity);
				yield* proxy.setFault("none");
				yield* context.backend.setNextResponse({
					protocolVersion: 1,
					...signedRecovery
				});
				yield* command({
					command: "triggerLifecycle",
					event: "foreground"
				});
				for (let attempt = 0; attempt < 200; attempt++) {
					const updateEligibility = yield* command({ command: "getUpdateEligibility" });
					if (isDeepStrictEqual(updateEligibility, recovered)) break;
					yield* Effect.sleep("20 millis");
				}
				yield* waitForIdle(command);
				deepStrictEqual(yield* command({ command: "getUpdateEligibility" }), recovered);
				strictEqual(yield* proxy.attempts(), attempts + 1);
				deepStrictEqual(yield* command({ command: "getUpdateState" }), state);
				deepStrictEqual(yield* command({ command: "getLastUpdateError" }), lastError);
				const allowed = yield* context.keypair.sign({
					...recovered,
					type: "unrestricted"
				});
				yield* context.backend.setNextPreActionCheckResponse({
					protocolVersion: 1,
					...allowed
				});
				for (const stage of ["pre-download", "pre-apply"]) {
					yield* command({
						command: "prepareAction",
						stage
					});
					const beforeAction = yield* updaterActivity(command);
					yield* command({
						command: "runAction",
						stage
					});
					const field = stage === "pre-download" ? "downloads" : "applies";
					const afterAction = yield* updaterActivity(command);
					strictEqual(afterAction[field], beforeAction[field] + 1);
				}
			}), {
				checkInBaseUrl: proxy.baseUrl,
				lifecycle: true
			});
		}).pipe(Effect.scoped)
	};
}
const failOpenScenarios = [
	failOpenScenario({
		name: "a connection reset preserves SDK state and the next lifecycle tick recovers",
		fault: "disconnect"
	}),
	failOpenScenario({
		name: "a non-2xx signed response preserves SDK state and the next lifecycle tick recovers",
		fault: "http-error"
	}),
	failOpenScenario({
		name: "an unreachable backend preserves SDK state and the next lifecycle tick recovers",
		fault: "unreachable"
	}),
	failOpenScenario({
		name: "a bad update-eligibility signature preserves SDK state and the next lifecycle tick recovers",
		fault: "none",
		badSignature: true
	})
];
// src/scenarios/bufferedFacts.ts
const StoredFact = Schema.Struct({
	kind: Schema.Literals(["lifecycleState", "updateError"]),
	state: Schema.optionalKey(UpdateState),
	failure: Schema.optionalKey(Schema.Struct({ platformCode: Schema.String })),
	firstObservedAt: Schema.String,
	lastObservedAt: Schema.String,
	occurrenceCount: Schema.Number
});
function readFacts(command) {
	return command({ command: "getBufferedFacts" }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredFact))));
}
function record(command, facts, options = {}) {
	return command({
		command: "recordFacts",
		facts,
		concurrent: options.concurrent ?? false
	});
}
function state(type) {
	return {
		kind: "lifecycleState",
		state: { type }
	};
}
function progress(value) {
	return {
		kind: "lifecycleState",
		state: {
			type: "downloading",
			progress: value
		}
	};
}
function failure(code) {
	return {
		kind: "updateError",
		platformCode: code
	};
}
function withBuffer(context, run) {
	return Effect.gen(function* () {
		const signed = yield* context.keypair.sign({
			type: "held",
			issuedAt: (/* @__PURE__ */ new Date()).toISOString(),
			environment: "test"
		});
		yield* context.backend.setNextResponse({
			protocolVersion: 1,
			...signed
		});
		yield* withAdapter$1(context, (command) => Effect.gen(function* () {
			yield* command({ command: "checkNow" });
			yield* command({ command: "clearBuffer" });
			yield* run(command);
		}));
	});
}
function assertPersisted(command) {
	return Effect.gen(function* () {
		const memory = yield* command({ command: "getBufferedFacts" });
		const disk = yield* command({ command: "getPersistedBuffer" }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ facts: Schema.Array(Schema.Unknown) }))));
		deepStrictEqual(disk.facts, memory);
		ok(!JSON.stringify(disk).includes("\"title\""));
	});
}
const bufferedFactsScenarios = [
	{
		name: "only adjacent identical facts merge; progress and intervening observations remain distinct",
		tier: 1,
		run: (context) => withBuffer(context, (command) => Effect.gen(function* () {
			yield* record(command, [state("downloaded")]);
			const first = (yield* readFacts(command))[0];
			ok(first);
			yield* Effect.sleep("1100 millis");
			yield* record(command, [
				state("downloaded"),
				progress(10),
				progress(20),
				state("downloaded"),
				failure("repeat"),
				failure("repeat")
			]);
			const firstError = (yield* readFacts(command))[4];
			ok(firstError);
			yield* Effect.sleep("1100 millis");
			yield* record(command, [failure("repeat")]);
			const facts = yield* readFacts(command);
			strictEqual(facts.length, 5);
			const merged = facts[0];
			ok(merged);
			strictEqual(merged.occurrenceCount, 2);
			strictEqual(merged.firstObservedAt, first.firstObservedAt);
			ok(Date.parse(merged.lastObservedAt) > Date.parse(first.lastObservedAt));
			deepStrictEqual(facts.map((fact) => fact.state?.type ?? fact.failure?.platformCode), [
				"downloaded",
				"downloading",
				"downloading",
				"downloaded",
				"repeat"
			]);
			const mergedError = facts[4];
			ok(mergedError);
			strictEqual(mergedError.occurrenceCount, 3);
			strictEqual(mergedError.firstObservedAt, firstError.firstObservedAt);
			ok(Date.parse(mergedError.lastObservedAt) > Date.parse(firstError.lastObservedAt));
			yield* record(command, [{
				kind: "lifecycleState",
				state: {
					type: "available",
					releaseNotes: "first notes"
				}
			}, {
				kind: "lifecycleState",
				state: {
					type: "available",
					releaseNotes: "second notes"
				}
			}]);
			strictEqual((yield* readFacts(command)).length, 7);
			yield* assertPersisted(command);
			yield* command({ command: "clearBuffer" });
			yield* command({
				command: "prepareAction",
				stage: "pre-download"
			});
			let observed = false;
			for (let attempt = 0; attempt < 50; attempt++) {
				if ((yield* readFacts(command)).some((fact) => fact.state?.type === "available")) {
					observed = true;
					break;
				}
				yield* Effect.sleep("20 millis");
			}
			ok(observed, "the production adapter must record its available transition in this buffer");
		}))
	},
	{
		name: "the 32-fact bound preserves terminal facts and evicts the oldest equal-priority observation",
		tier: 1,
		run: (context) => withBuffer(context, (command) => Effect.gen(function* () {
			yield* record(command, Array.from({ length: 32 }, (_, i) => progress(i)));
			yield* record(command, [failure("terminal"), progress(32)]);
			let facts = yield* readFacts(command);
			strictEqual(facts.length, 32);
			ok(facts.some((fact) => fact.failure?.platformCode === "terminal"));
			deepStrictEqual(facts.filter((fact) => fact.state?.type === "downloading").map((fact) => fact.state?.type === "downloading" ? fact.state.progress : null), Array.from({ length: 31 }, (_, i) => i + 2));
			yield* command({ command: "clearBuffer" });
			yield* record(command, Array.from({ length: 32 }, (_, i) => failure(`terminal-${i}`)));
			yield* record(command, [progress(90)]);
			facts = yield* readFacts(command);
			strictEqual(facts.length, 32);
			ok(facts.every((fact) => fact.kind === "updateError"));
			yield* record(command, [failure("terminal-32")]);
			facts = yield* readFacts(command);
			deepStrictEqual(facts.map((fact) => fact.failure?.platformCode), Array.from({ length: 32 }, (_, i) => `terminal-${i + 1}`));
			yield* command({ command: "clearBuffer" });
			yield* record(command, [
				state("downloaded"),
				state("update-cancelled"),
				{
					kind: "lifecycleState",
					state: {
						type: "failed",
						category: "download",
						code: "unknown",
						platformCode: "failed"
					}
				},
				...Array.from({ length: 29 }, (_, i) => progress(i))
			]);
			yield* record(command, [progress(90)]);
			facts = yield* readFacts(command);
			deepStrictEqual(facts.slice(0, 3).map((fact) => fact.state?.type), [
				"downloaded",
				"update-cancelled",
				"failed"
			]);
			strictEqual(facts.length, 32);
			yield* assertPersisted(command);
		}))
	},
	{
		name: "failed and delayed check-ins preserve facts; acknowledgment clears only the sent snapshot",
		tier: 1,
		run: (context) => withBuffer(context, (command) => Effect.gen(function* () {
			yield* record(command, [failure("snapshot")]);
			yield* context.backend.setNextCheckInFailure({ shouldFail: true });
			yield* command({ command: "checkNow" });
			strictEqual((yield* readFacts(command)).length, 1);
			yield* context.backend.setNextCheckInFailure({ shouldFail: false });
			yield* context.backend.setNextCheckInDelay("400 millis");
			yield* Effect.all([command({ command: "checkNow" }), Effect.gen(function* () {
				yield* Effect.sleep("100 millis");
				strictEqual((yield* readFacts(command)).length, 1);
				yield* record(command, [
					failure("snapshot"),
					state("downloaded"),
					failure("snapshot")
				]);
			})], { concurrency: "unbounded" });
			const remaining = yield* readFacts(command);
			strictEqual(remaining.length, 3);
			strictEqual(remaining[0]?.occurrenceCount, 2);
			strictEqual(remaining[2]?.occurrenceCount, 1);
			strictEqual(remaining[2]?.failure?.platformCode, "snapshot");
			const raw = yield* context.backend.receivedRawCheckIns();
			ok(!JSON.stringify(raw).includes("\"title\""));
			const sent = (yield* context.backend.receivedCheckIns()).at(-1)?.bufferedFacts;
			strictEqual(sent?.length, 1);
			strictEqual(sent?.[0]?.occurrenceCount, 1);
			yield* assertPersisted(command);
			yield* context.backend.setNextCheckInDelay(null);
			yield* command({ command: "checkNow" });
			deepStrictEqual(yield* readFacts(command), []);
			yield* assertPersisted(command);
		}))
	},
	{
		name: "concurrent observations persist the complete buffer without derived titles",
		tier: 1,
		run: (context) => withBuffer(context, (command) => Effect.gen(function* () {
			yield* record(command, Array.from({ length: 64 }, () => failure("concurrent")), { concurrent: true });
			const facts = yield* readFacts(command);
			strictEqual(facts.length, 1);
			strictEqual(facts[0]?.occurrenceCount, 64);
			yield* assertPersisted(command);
		}))
	},
	{
		name: "a real process exit restores the latest buffer through the production synchronous exit hook",
		tier: 1,
		run: (context) => withBuffer(context, (command) => Effect.gen(function* () {
			const result = yield* command({
				command: "probeBufferExit",
				mode: "settled",
				facts: [state("downloaded"), failure("exit-probe")]
			}).pipe(Effect.timeout("20 seconds"));
			ok(!JSON.stringify(result).includes("\"title\""));
			const { facts, recoveredFacts } = yield* Schema.decodeUnknownEffect(Schema.Struct({
				facts: Schema.Array(StoredFact),
				recoveredFacts: Schema.Array(StoredFact)
			}))(result);
			deepStrictEqual(recoveredFacts, facts);
			strictEqual(facts.length, 2);
			strictEqual(facts[0]?.state?.type, "downloaded");
			strictEqual(facts[1]?.failure?.platformCode, "exit-probe");
		}))
	},
	{
		name: "blocked disk writes leave observations responsive and persist the latest complete snapshot",
		tier: 1,
		run: (context) => withBuffer(context, (command) => Effect.gen(function* () {
			yield* command({
				command: "setBufferPersistence",
				mode: "blocked"
			});
			yield* record(command, [state("idle")]).pipe(Effect.timeout("2 seconds"));
			let blocked = false;
			for (let attempt = 0; attempt < 100; attempt++) {
				if ((yield* command({ command: "getBufferPersistenceState" }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ blockedWrite: Schema.Boolean }))))).blockedWrite) {
					blocked = true;
					break;
				}
				yield* Effect.sleep("20 millis");
			}
			ok(blocked, "the native disk writer must actually be waiting");
			yield* record(command, [state("downloaded"), failure("latest")]).pipe(Effect.timeout("2 seconds"));
			strictEqual((yield* readFacts(command).pipe(Effect.timeout("2 seconds"))).length, 3);
			yield* command({
				command: "setBufferPersistence",
				mode: "normal"
			});
			yield* assertPersisted(command);
		}).pipe(Effect.ensuring(command({
			command: "setBufferPersistence",
			mode: "normal"
		}).pipe(Effect.orDie))))
	},
	{
		name: "failed native writes preserve memory and the next observation retries the complete snapshot",
		tier: 1,
		run: (context) => withBuffer(context, (command) => Effect.gen(function* () {
			yield* command({
				command: "setBufferPersistence",
				mode: "failed"
			});
			yield* record(command, [failure("disk-failed")]).pipe(Effect.timeout("2 seconds"));
			strictEqual((yield* readFacts(command)).length, 1);
			yield* command({
				command: "setBufferPersistence",
				mode: "normal"
			});
			yield* record(command, [state("downloaded")]);
			strictEqual((yield* readFacts(command)).length, 2);
			yield* assertPersisted(command);
		}).pipe(Effect.ensuring(command({
			command: "setBufferPersistence",
			mode: "normal"
		}).pipe(Effect.orDie))))
	},
	{
		name: "orderly exit with a blocked pending write recovers the latest complete buffer in a fresh process",
		tier: 1,
		run: (context) => withBuffer(context, (command) => Effect.gen(function* () {
			const result = yield* command({
				command: "probeBufferExit",
				mode: "pending",
				facts: [
					state("idle"),
					state("downloaded"),
					failure("pending-exit")
				]
			}).pipe(Effect.timeout("20 seconds"));
			ok(!JSON.stringify(result).includes("\"title\""));
			const saved = yield* Schema.decodeUnknownEffect(Schema.Struct({
				facts: Schema.Array(StoredFact),
				recoveredFacts: Schema.Array(StoredFact),
				pendingWriteObserved: Schema.Boolean
			}))(result);
			ok(saved.pendingWriteObserved);
			strictEqual(saved.facts.length, 3);
			strictEqual(saved.facts[2]?.failure?.platformCode, "pending-exit");
			deepStrictEqual(saved.recoveredFacts, saved.facts);
		}))
	}
];
// src/runner/scenarios.ts
/** Every scenario needing the check-in handshake (mock backend + signed
* keypair) -- gated on `supportsCheckIn`, since a test service without it
* can't run any of these. */
const CHECK_IN_SCENARIOS = [
	{
		name: "an unrestricted eligibility leaves the adapter idle",
		tier: 1,
		run: (context) => Effect.gen(function* () {
			const { backend, keypair } = context;
			for (const channel of [
				void 0,
				"Beta / Custom",
				""
			]) {
				const signed = yield* keypair.sign({
					type: "unrestricted",
					issuedAt: (/* @__PURE__ */ new Date()).toISOString(),
					environment: "conformance-harness"
				});
				yield* backend.setNextResponse({
					protocolVersion: 1,
					updateEligibility: signed.updateEligibility,
					signature: signed.signature
				});
				yield* withAdapter$1(context, (command) => Effect.gen(function* () {
					yield* command({ command: "checkNow" });
					const checkIns = yield* backend.receivedCheckIns();
					const latest = checkIns[checkIns.length - 1];
					const expectedChannel = channel ?? "stable";
					if (latest?.channel !== expectedChannel) return yield* Effect.die(/* @__PURE__ */ new Error(`expected channel ${JSON.stringify(expectedChannel)}, got ${JSON.stringify(latest?.channel)}`));
					const state = { result: yield* command({ command: "getUpdateState" }) };
					if (typeof state.result !== "object" || state.result === null || state.result.type !== "idle") return yield* Effect.die(/* @__PURE__ */ new Error(`expected adapter state "idle" after an unrestricted update eligibility, got ${JSON.stringify(state.result)}`));
				}), channel === void 0 ? {} : { channel });
			}
		})
	},
	wireIdentity,
	...[
		{
			name: "a hung production check-in times out around ten seconds and the next attempt can proceed",
			tier: 1,
			run: (context) => Effect.gen(function* () {
				const signed = yield* context.keypair.sign({
					type: "held",
					issuedAt: (/* @__PURE__ */ new Date()).toISOString(),
					environment: "test"
				});
				yield* context.backend.setNextResponse({
					protocolVersion: 1,
					...signed
				});
				yield* withAdapter$1(context, (command) => Effect.gen(function* () {
					yield* command({ command: "checkNow" });
					const before = (yield* context.backend.receivedCheckIns()).length;
					yield* context.backend.setNextCheckInDelay("20 seconds");
					const start = Date.now();
					yield* command({ command: "checkNow" }).pipe(Effect.timeout("13 seconds"));
					const elapsed = Date.now() - start;
					ok(elapsed >= 8500 && elapsed <= 12500, `timeout was ${elapsed}ms`);
					strictEqual((yield* context.backend.receivedCheckIns()).length, before + 1);
					yield* context.backend.setNextCheckInDelay(null);
					yield* command({ command: "checkNow" }).pipe(Effect.timeout("3 seconds"));
					strictEqual((yield* context.backend.receivedCheckIns()).length, before + 2);
				}));
			})
		},
		{
			name: "a check-in call that fails outright still leaves the adapter idle (fail-open)",
			tier: 1,
			run: (context) => Effect.gen(function* () {
				yield* context.backend.setNextCheckInFailure({ shouldFail: true });
				yield* withAdapter$1(context, (command) => Effect.gen(function* () {
					const before = (yield* context.backend.receivedCheckIns()).length;
					yield* command({ command: "checkNow" });
					strictEqual((yield* context.backend.receivedCheckIns()).length, before + 1);
					deepStrictEqual(yield* command({ command: "getUpdateState" }), { type: "idle" });
					strictEqual(yield* command({ command: "getUpdateEligibility" }), null);
				}));
			})
		},
		{
			name: "an in-flight attempt skips a second tick and releases the guard for a later check-in",
			tier: 1,
			run: (context) => Effect.gen(function* () {
				const signed = yield* context.keypair.sign({
					type: "held",
					issuedAt: (/* @__PURE__ */ new Date()).toISOString(),
					environment: "test"
				});
				yield* context.backend.setNextResponse({
					protocolVersion: 1,
					...signed
				});
				yield* withAdapter$1(context, (command) => Effect.gen(function* () {
					yield* command({ command: "checkNow" });
					const before = (yield* context.backend.receivedCheckIns()).length;
					yield* Effect.acquireUseRelease(context.backend.blockCheckInResponses(), (release) => Effect.gen(function* () {
						yield* Effect.all([command({ command: "checkNow" }), Effect.gen(function* () {
							let observed = false;
							for (let attempt = 0; attempt < 100; attempt++) {
								if ((yield* context.backend.receivedCheckIns()).length > before) {
									observed = true;
									break;
								}
								yield* Effect.sleep("10 millis");
							}
							ok(observed, "first request must reach the backend before the competing tick");
							yield* command({ command: "checkNow" });
							yield* release;
						})], { concurrency: "unbounded" }).pipe(Effect.timeout("5 seconds"));
					}), (release) => release);
					strictEqual((yield* context.backend.receivedCheckIns()).length, before + 1);
					strictEqual(yield* context.backend.peakConcurrentCheckIns(), 1);
					yield* command({ command: "checkNow" });
					strictEqual((yield* context.backend.receivedCheckIns()).length, before + 2);
				}));
			})
		}
	],
	...failOpenScenarios,
	...cadenceResilienceScenarios,
	...updateEligibilityScenarios,
	...bufferedFactsScenarios,
	...preActionCheckScenarios
];
function scenariosFor(capabilities) {
	if (!capabilities.supportsCheckIn) throw new Error("test service does not support required check-in conformance");
	return CHECK_IN_SCENARIOS;
}
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
// src/cli.ts
function parseHistoryRuns(value) {
	const runs = Number(value);
	if (!/^\d+$/.test(value) || !Number.isSafeInteger(runs) || runs < 1) throw new InvalidArgumentError("history runs must be a positive integer");
	return runs;
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
		if (testServiceBaseUrls.has(name)) throw new Error(`duplicate SDK name: ${name}`);
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
program.command("conformance <test-service-base-url>").description("run this SDK's conformance scenarios against its own test service").option("--junit <path>", "also write results as JUnit XML, for CI PR-check integration").option("--history <path>", "run-history file tracking each scenario's pass/fail record, for tier-1 relegation", ".conformance-history.json").option("--history-runs <n>", "how many recent runs a scenario's relegation/trend is tracked over", (value) => parseHistoryRuns(value), 5).action((testServiceBaseUrl, options) => {
	NodeRuntime.runMain(runConformance(testServiceBaseUrl, options));
});
program.command("equivalence <name=url...>").description("run cross-SDK equivalence checks against every named test service").option("--junit <path>", "also write results as JUnit XML, for CI PR-check integration").action((namedUrlArgs, options) => {
	NodeRuntime.runMain(runEquivalence(namedUrlArgs, options));
});
program.parse();
export {};

//# sourceMappingURL=cli.js.map