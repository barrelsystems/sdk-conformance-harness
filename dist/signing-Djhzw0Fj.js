import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { webcrypto } from "node:crypto";
import * as Effect from "effect/Effect";
// src/protocol/wireContract.ts
/** Independent re-declaration of Barrel's check-in/Policy wire contract --
* importing the thing being checked couldn't catch drift in it. This file
* IS the spec, not a copy of one. */
const AdapterState = Schema.Union([
	Schema.Struct({ type: Schema.Literal("idle") }),
	Schema.Struct({ type: Schema.Literal("checking") }),
	Schema.Struct({ type: Schema.Literal("available") }),
	Schema.Struct({
		type: Schema.Literal("downloading"),
		progress: Schema.optionalKey(Schema.Number)
	}),
	Schema.Struct({ type: Schema.Literal("downloaded") }),
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
	kind: Schema.Literal("adapterState"),
	firstObservedAt: Schema.String,
	lastObservedAt: Schema.String,
	occurrenceCount: Schema.Number,
	state: AdapterState
}), Schema.Struct({
	kind: Schema.Literal("updateError"),
	firstObservedAt: Schema.String,
	lastObservedAt: Schema.String,
	occurrenceCount: Schema.Number,
	phase: Schema.String,
	failureMode: Schema.String,
	platformCode: Schema.String
})]);
const Policy = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("current"),
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
		type: Schema.Literal("updateEligible"),
		issuedAt: Schema.String,
		environment: Schema.String,
		priority: Schema.optionalKey(Schema.Literals(["normal", "high"]))
	})
]);
const CheckInRequest = Schema.Struct({
	protocolVersion: Schema.Literal(1),
	installationId: Schema.String,
	eventId: Schema.String,
	checkedInAt: Schema.String,
	sdkVersion: Schema.String,
	observedVersion: Schema.String,
	platform: Schema.String,
	arch: Schema.String,
	osVersion: Schema.String,
	attributes: Schema.Record(Schema.String, Schema.String),
	adapterState: AdapterState,
	bufferedFacts: Schema.optionalKey(Schema.Array(BufferedFact))
});
const CheckInResponse = Schema.Struct({
	protocolVersion: Schema.Literal(1),
	policy: Schema.String,
	signature: Schema.String
});
const PreActionCheckRequest = Schema.Struct({
	protocolVersion: Schema.Literal(1),
	installationId: Schema.String,
	stage: Schema.Literals(["pre-download", "pre-apply"])
});
// src/protocol/testServiceApi.ts
/** The contract every SDK repo implements once, in its own language, as a
* small standalone HTTP service. This file is the one normative definition;
* each language's own test service implements the same wire shape independently. */
/** `variant` lets a test service wrapping more than one underlying
* adapter choose which one a scenario exercises -- interpreted however
* each platform's own test service needs to. */
const CreateAdapterRequest = Schema.Struct({
	checkInBaseUrl: Schema.String,
	publicKeyPem: Schema.String,
	variant: Schema.optionalKey(Schema.String)
});
const CreateAdapterResponse = Schema.Struct({ id: Schema.String });
/** `injectEvent`'s `eventName`/`payload` stay untyped here because each
* platform's raw event vocabulary differs; the per-platform scenario
* carries the valid names/payloads for its own adapter library. */
const AdapterCommand = Schema.Union([
	Schema.Struct({ command: Schema.Literal("checkNow") }),
	Schema.Struct({ command: Schema.Literal("getAdapterState") }),
	Schema.Struct({ command: Schema.Literal("getLastUpdateError") }),
	Schema.Struct({
		command: Schema.Literal("injectEvent"),
		eventName: Schema.String,
		payload: Schema.Unknown
	}),
	Schema.Struct({
		command: Schema.Literal("triggerPreActionCheck"),
		stage: Schema.Literals(["pre-download", "pre-apply"])
	})
]);
/** Deliberately `Schema.Unknown`: each command's own result shape is
* asserted by the scenario that issued the command, not constrained here. */
const AdapterCommandResponse = Schema.Struct({ result: Schema.Unknown });
/** `supportsCheckIn` lets the CLI skip check-in-dependent scenarios (like
* the happy-path check-in) against a test service that only implements
* `injectEvent`-driven conformance -- a real, not a hypothetical, gap. */
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
	payload: CheckInRequest,
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
		return {
			publicKeyPem: `-----BEGIN PUBLIC KEY-----\n${Buffer.from(publicDer).toString("base64")}\n-----END PUBLIC KEY-----\n`,
			sign: (policy) => Effect.promise(async () => {
				const policyJson = JSON.stringify(policy);
				const raw = await webcrypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(policyJson));
				return {
					policy: policyJson,
					signature: Buffer.from(raw).toString("base64")
				};
			})
		};
	});
}
export { Policy as _, AdapterCommandResponse as a, CreateAdapterResponse as c, TestServiceApi as d, TestServiceHttpApi as f, CheckInResponse as g, CheckInRequest as h, AdapterCommand as i, JitterFractionRequest as l, BufferedFact as m, MockBackendApi as n, Capabilities as o, AdapterState as p, MockBackendHttpApi as r, CreateAdapterRequest as s, generateTestKeypair as t, JitterFractionResponse as u, PreActionCheckRequest as v };

//# sourceMappingURL=signing-Djhzw0Fj.js.map