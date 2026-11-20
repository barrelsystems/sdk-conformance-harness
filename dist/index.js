import { _ as Policy, a as AdapterCommandResponse, c as CreateAdapterResponse, d as TestServiceApi, f as TestServiceHttpApi, g as CheckInResponse, h as CheckInRequest, i as AdapterCommand, l as JitterFractionRequest, m as BufferedFact, n as MockBackendApi, o as Capabilities, p as AdapterState, r as MockBackendHttpApi, s as CreateAdapterRequest, t as generateTestKeypair, u as JitterFractionResponse, v as PreActionCheckRequest } from "./signing-Djhzw0Fj.js";
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
export { AdapterCommand, AdapterCommandResponse, AdapterState, BufferedFact, Capabilities, CheckInRequest, CheckInResponse, CreateAdapterRequest, CreateAdapterResponse, JitterFractionRequest, JitterFractionResponse, MockBackendApi, MockBackendHttpApi, Policy, PreActionCheckRequest, TestServiceApi, TestServiceHttpApi, generateTestKeypair, referenceJitterFraction };

//# sourceMappingURL=index.js.map