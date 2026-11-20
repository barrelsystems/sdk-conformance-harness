import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

/** The contract every SDK repo implements once, in its own language, as a
 * small standalone HTTP service. This file is the one normative definition;
 * each language's own test service implements the same wire shape independently. */

/** `variant` lets a test service wrapping more than one underlying
 * adapter choose which one a scenario exercises -- interpreted however
 * each platform's own test service needs to. */
export const CreateAdapterRequest = Schema.Struct({
  checkInBaseUrl: Schema.String,
  publicKeyPem: Schema.String,
  variant: Schema.optionalKey(Schema.String),
});
export type CreateAdapterRequest = typeof CreateAdapterRequest.Type;

export const CreateAdapterResponse = Schema.Struct({ id: Schema.String });

/** `injectEvent`'s `eventName`/`payload` stay untyped here because each
 * platform's raw event vocabulary differs; the per-platform scenario
 * carries the valid names/payloads for its own adapter library. */
export const AdapterCommand = Schema.Union([
  Schema.Struct({ command: Schema.Literal("checkNow") }),
  Schema.Struct({ command: Schema.Literal("getAdapterState") }),
  Schema.Struct({ command: Schema.Literal("getLastUpdateError") }),
  Schema.Struct({
    command: Schema.Literal("injectEvent"),
    eventName: Schema.String,
    payload: Schema.Unknown,
  }),
]);
export type AdapterCommand = typeof AdapterCommand.Type;

/** Deliberately `Schema.Unknown`: each command's own result shape is
 * asserted by the scenario that issued the command, not constrained here. */
export const AdapterCommandResponse = Schema.Struct({ result: Schema.Unknown });

/** `supportsCheckIn` lets the CLI skip check-in-dependent scenarios (like
 * the happy-path check-in) against a test service that only implements
 * `injectEvent`-driven conformance -- a real, not a hypothetical, gap. */
export const Capabilities = Schema.Struct({
  sdkName: Schema.String,
  sdkVersion: Schema.String,
  supportsCheckIn: Schema.Boolean,
});

/** A pure function required to be byte-identical across every SDK for the
 * same input -- exposed directly since it's stateless. */
export const JitterFractionRequest = Schema.Struct({ installationId: Schema.String });
export const JitterFractionResponse = Schema.Struct({ fraction: Schema.Number });

export class TestServiceApi extends HttpApiGroup.make("testService")
  .add(HttpApiEndpoint.get("capabilities", "/", { success: Capabilities }))
  .add(
    HttpApiEndpoint.post("createAdapter", "/adapters", {
      payload: CreateAdapterRequest,
      success: CreateAdapterResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("runCommand", "/adapters/:id/commands", {
      params: { id: Schema.String },
      payload: AdapterCommand,
      success: AdapterCommandResponse,
    }),
  )
  .add(HttpApiEndpoint.delete("destroyAdapter", "/adapters/:id", { params: { id: Schema.String } }))
  .add(
    HttpApiEndpoint.post("jitterFraction", "/pure/jitter-fraction", {
      payload: JitterFractionRequest,
      success: JitterFractionResponse,
    }),
  ) {}

export class TestServiceHttpApi extends HttpApi.make("sdk-test-service").add(TestServiceApi) {}
