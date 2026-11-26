import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { webcrypto } from "node:crypto";
import * as Effect from "effect/Effect";
// src/protocol/wireContract.ts
const Uuid = Schema.String.check(Schema.makeFilter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)));
const Timestamp = Schema.String.check(Schema.makeFilter((value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))));
/** Independent re-declaration of Barrel's check-in/UpdateEligibility wire contract --
* importing the thing being checked couldn't catch drift in it. This file
* IS the spec, not a copy of one. */
const UpdateState = Schema.Union([
	Schema.Struct({ type: Schema.Literal("idle") }),
	Schema.Struct({
		type: Schema.Literal("available"),
		releaseNotes: Schema.optionalKey(Schema.String)
	}),
	Schema.Struct({
		type: Schema.Literal("downloading"),
		progress: Schema.optionalKey(Schema.Number)
	}),
	Schema.Struct({ type: Schema.Literal("downloaded") }),
	Schema.Struct({ type: Schema.Literal("applying") }),
	Schema.Struct({ type: Schema.Literal("update-cancelled") }),
	Schema.Struct({
		type: Schema.Literal("failed"),
		category: Schema.Literals([
			"check",
			"download",
			"updater"
		]),
		code: Schema.String,
		platformCode: Schema.String
	})
]);
const BufferedFact = Schema.Union([Schema.Struct({
	kind: Schema.Literal("lifecycleState"),
	firstObservedAt: Schema.String,
	lastObservedAt: Schema.String,
	occurrenceCount: Schema.Number,
	state: UpdateState
}), Schema.Struct({
	kind: Schema.Literal("updateError"),
	firstObservedAt: Schema.String,
	lastObservedAt: Schema.String,
	occurrenceCount: Schema.Number,
	phase: Schema.String,
	failureMode: Schema.String,
	platformCode: Schema.String
})]);
const UpdateEligibility = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("unrestricted"),
		issuedAt: Schema.String,
		environment: Schema.String
	}),
	Schema.Struct({
		type: Schema.Literal("held"),
		issuedAt: Schema.String,
		environment: Schema.String,
		reason: Schema.optionalKey(Schema.String),
		until: Schema.optionalKey(Schema.String)
	}),
	Schema.Struct({
		type: Schema.Literal("eligible"),
		issuedAt: Schema.String,
		environment: Schema.String,
		priority: Schema.optionalKey(Schema.Literals(["normal", "high"]))
	})
]);
const CheckInRequest = Schema.Struct({
	protocolVersion: Schema.Literal(1),
	installationId: Uuid,
	eventId: Uuid,
	checkedInAt: Timestamp,
	sdkVersion: Schema.String,
	channel: Schema.String,
	observedVersion: Schema.String,
	platform: Schema.String,
	arch: Schema.String,
	osVersion: Schema.String,
	attributes: Schema.Record(Schema.String, Schema.String),
	lifecycleState: UpdateState,
	checkInIntervalMs: Schema.optionalKey(Schema.Number),
	bufferedFacts: Schema.optionalKey(Schema.Array(BufferedFact))
});
const CheckInResponse = Schema.Struct({
	protocolVersion: Schema.Literal(1),
	updateEligibility: Schema.String,
	signature: Schema.String
});
const PreActionCheckRequest = Schema.Struct({
	protocolVersion: Schema.Literal(1),
	installationId: Uuid,
	stage: Schema.Literals(["pre-download", "pre-apply"])
});
// src/protocol/testServiceApi.ts
/** The contract every SDK repo implements once, in its own language, as a
* small standalone HTTP service. This file is the one normative definition;
* each language's own test service implements the same wire shape independently. */
const CreateAdapterRequest = Schema.Struct({
	checkInBaseUrl: Schema.String,
	attributes: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	debug: Schema.optionalKey(Schema.Boolean),
	checkInIntervalMs: Schema.optionalKey(Schema.Number),
	lifecycle: Schema.optionalKey(Schema.Boolean),
	installationPersistence: Schema.optionalKey(Schema.Literal("failed")),
	publicKeyPem: Schema.String,
	/** Reported verbatim on check-in; omission uses the SDK default. */
	channel: Schema.optionalKey(Schema.String)
});
const CreateAdapterResponse = Schema.Struct({ id: Schema.String });
const FactObservation = Schema.Union([Schema.Struct({
	kind: Schema.Literal("lifecycleState"),
	state: UpdateState
}), Schema.Struct({
	kind: Schema.Literal("updateError"),
	platformCode: Schema.String
})]);
const AdapterCommand = Schema.Union([
	Schema.Struct({ command: Schema.Literal("getCadenceState") }),
	Schema.Struct({ command: Schema.Literal("restoreInstallationPersistence") }),
	Schema.Struct({ command: Schema.Literal("getPersistedInstallationId") }),
	Schema.Struct({
		command: Schema.Literal("triggerLifecycle"),
		event: Schema.Literals(["foreground", "resume"])
	}),
	Schema.Struct({
		command: Schema.Literal("recordFacts"),
		facts: Schema.Array(FactObservation),
		concurrent: Schema.Boolean
	}),
	Schema.Struct({ command: Schema.Literal("getBufferedFacts") }),
	Schema.Struct({ command: Schema.Literal("getPersistedBuffer") }),
	Schema.Struct({ command: Schema.Literal("clearBuffer") }),
	Schema.Struct({
		command: Schema.Literal("setBufferPersistence"),
		mode: Schema.Literals([
			"normal",
			"blocked",
			"failed"
		])
	}),
	Schema.Struct({ command: Schema.Literal("getBufferPersistenceState") }),
	Schema.Struct({
		command: Schema.Literal("probeBufferExit"),
		mode: Schema.Literals(["settled", "pending"]),
		facts: Schema.Array(FactObservation)
	}),
	Schema.Struct({ command: Schema.Literal("checkNow") }),
	Schema.Struct({ command: Schema.Literal("getUpdateState") }),
	Schema.Struct({ command: Schema.Literal("getUpdateEligibility") }),
	Schema.Struct({ command: Schema.Literal("getUpdaterActivity") }),
	Schema.Struct({
		command: Schema.Literal("prepareAction"),
		stage: Schema.Literals(["pre-download", "pre-apply"])
	}),
	Schema.Struct({ command: Schema.Literal("getLastUpdateError") }),
	Schema.Struct({ command: Schema.Literal("prepareUpdaterFailure") }),
	Schema.Struct({
		command: Schema.Literal("runAction"),
		stage: Schema.Literals(["pre-download", "pre-apply"])
	})
]);
/** Counts calls at the native updater boundary, including host-controlled actions. */
const UpdaterActivity = Schema.Struct({
	checks: Schema.Number,
	downloads: Schema.Number,
	applies: Schema.Number
});
/** Deliberately `Schema.Unknown`: each command's own result shape is
* asserted by the scenario that issued the command, not constrained here. */
const AdapterCommandResponse = Schema.Struct({ result: Schema.Unknown });
/** Reject services without the required check-in capability rather than silently skipping conformance scenarios. */
const Capabilities = Schema.Struct({
	sdkName: Schema.String,
	sdkVersion: Schema.String,
	supportsCheckIn: Schema.Boolean
});
/** A pure function required to be byte-identical across every SDK for the
* same input -- exposed directly since it's stateless. */
const JitterFractionRequest = Schema.Struct({ installationId: Schema.String });
const JitterFractionResponse = Schema.Struct({ fraction: Schema.Number });
var TestServiceApi = class extends HttpApiGroup.make("testService").add(HttpApiEndpoint.get("capabilities", "/", { success: Capabilities })).add(HttpApiEndpoint.post("createAdapter", "/adapters", {
	payload: CreateAdapterRequest,
	success: CreateAdapterResponse
})).add(HttpApiEndpoint.post("runCommand", "/adapters/:id/commands", {
	params: { id: Schema.String },
	payload: AdapterCommand,
	success: AdapterCommandResponse
})).add(HttpApiEndpoint.delete("destroyAdapter", "/adapters/:id", { params: { id: Schema.String } })).add(HttpApiEndpoint.post("jitterFraction", "/pure/jitter-fraction", {
	payload: JitterFractionRequest,
	success: JitterFractionResponse
})) {};
var TestServiceHttpApi = class extends HttpApi.make("sdk-test-service").add(TestServiceApi) {};
// src/protocol/mockBackendApi.ts
/** The harness's own simulation of Barrel's real ingestion endpoint. Every
* scenario configures what this server returns before pointing a test
* service's adapter at it. */
var MockBackendApi = class extends HttpApiGroup.make("ingestion").add(HttpApiEndpoint.post("checkIn", "/check-in", {
	headers: { authorization: Schema.String },
	payload: Schema.Unknown,
	success: CheckInResponse
})).add(HttpApiEndpoint.post("preActionCheck", "/pre-action-check", {
	headers: { authorization: Schema.String },
	payload: PreActionCheckRequest,
	success: CheckInResponse
})) {};
var MockBackendHttpApi = class extends HttpApi.make("barrel-mock-backend").add(MockBackendApi) {};
// src/protocol/signing.ts
function generateTestKeypair() {
	return Effect.promise(async () => {
		const { publicKey, privateKey } = await webcrypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
		const publicDer = await webcrypto.subtle.exportKey("spki", publicKey);
		const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(publicDer).toString("base64")}\n-----END PUBLIC KEY-----\n`;
		function signRaw(updateEligibilityJson) {
			return Effect.promise(async () => {
				const raw = await webcrypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(updateEligibilityJson));
				return {
					updateEligibility: updateEligibilityJson,
					signature: Buffer.from(raw).toString("base64")
				};
			});
		}
		return {
			publicKeyPem,
			signRaw,
			sign: (updateEligibility) => signRaw(JSON.stringify(updateEligibility))
		};
	});
}
// src/protocol/jitter.ts
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 16777619;
function fnv1a(input) {
	let hash = FNV_OFFSET_BASIS;
	for (let index = 0; index < input.length; index++) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, FNV_PRIME);
	}
	return hash >>> 0;
}
/** The reference algorithm every SDK's own jitter implementation must match
* exactly. An independent copy on purpose, the same reasoning as
* `wireContract.ts`: importing the thing being checked couldn't catch drift in it. */
function referenceJitterFraction(installationId) {
	const hash = fnv1a(installationId);
	return ((hash & 1) === 0 ? 1 : -1) * (.1 + (hash >>> 1) % 1e3 / 1e3 / 20);
}
export { CheckInRequest as _, AdapterCommand as a, UpdateEligibility as b, CreateAdapterRequest as c, JitterFractionRequest as d, JitterFractionResponse as f, BufferedFact as g, UpdaterActivity as h, MockBackendHttpApi as i, CreateAdapterResponse as l, TestServiceHttpApi as m, generateTestKeypair as n, AdapterCommandResponse as o, TestServiceApi as p, MockBackendApi as r, Capabilities as s, referenceJitterFraction as t, FactObservation as u, CheckInResponse as v, UpdateState as x, PreActionCheckRequest as y };

//# sourceMappingURL=jitter-D9p08fbZ.js.map