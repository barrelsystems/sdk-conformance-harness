import { UpdateState } from "./wireContract.js";
import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

/** The contract every SDK repo implements once, in its own language, as a
 * small standalone HTTP service. This file is the one normative definition;
 * each language's own test service implements the same wire shape independently. */

export const CreateAdapterRequest = Schema.Struct({
  checkInBaseUrl: Schema.String,
  attributes: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  debug: Schema.optionalKey(Schema.Boolean),
  checkInIntervalMs: Schema.optionalKey(Schema.Number),
  lifecycle: Schema.optionalKey(Schema.Boolean),
  installationPersistence: Schema.optionalKey(Schema.Literal("failed")),
  publicKeyPem: Schema.String,
  /** Reported verbatim on check-in; omission uses the SDK default. */
  channel: Schema.optionalKey(Schema.String),
});
export type CreateAdapterRequest = typeof CreateAdapterRequest.Type;

export const CreateAdapterResponse = Schema.Struct({ id: Schema.String });

export const FactObservation = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("lifecycleState"), state: UpdateState }),
  Schema.Struct({ kind: Schema.Literal("updateError"), platformCode: Schema.String }),
]);
export type FactObservation = typeof FactObservation.Type;

export const AdapterCommand = Schema.Union([
  Schema.Struct({ command: Schema.Literal("getCadenceState") }),
  Schema.Struct({ command: Schema.Literal("restoreInstallationPersistence") }),
  Schema.Struct({ command: Schema.Literal("getPersistedInstallationId") }),
  Schema.Struct({
    command: Schema.Literal("triggerLifecycle"),
    event: Schema.Literals(["foreground", "resume"]),
  }),
  Schema.Struct({
    command: Schema.Literal("recordFacts"),
    facts: Schema.Array(FactObservation),
    concurrent: Schema.Boolean,
  }),
  Schema.Struct({ command: Schema.Literal("getBufferedFacts") }),
  Schema.Struct({ command: Schema.Literal("getPersistedBuffer") }),
  Schema.Struct({ command: Schema.Literal("clearBuffer") }),
  Schema.Struct({
    command: Schema.Literal("setBufferPersistence"),
    mode: Schema.Literals(["normal", "blocked", "failed"]),
  }),
  Schema.Struct({ command: Schema.Literal("getBufferPersistenceState") }),
  Schema.Struct({
    command: Schema.Literal("probeBufferExit"),
    mode: Schema.Literals(["settled", "pending"]),
    facts: Schema.Array(FactObservation),
  }),
  Schema.Struct({ command: Schema.Literal("checkNow") }),
  Schema.Struct({ command: Schema.Literal("getUpdateState") }),
  Schema.Struct({ command: Schema.Literal("getUpdateEligibility") }),
  Schema.Struct({ command: Schema.Literal("getUpdaterActivity") }),
  Schema.Struct({
    command: Schema.Literal("prepareAction"),
    stage: Schema.Literals(["pre-download", "pre-apply"]),
  }),
  Schema.Struct({ command: Schema.Literal("getLastUpdateError") }),
  Schema.Struct({ command: Schema.Literal("prepareUpdaterFailure") }),
  Schema.Struct({
    command: Schema.Literal("runAction"),
    stage: Schema.Literals(["pre-download", "pre-apply"]),
  }),
]);
export type AdapterCommand = typeof AdapterCommand.Type;

/** Counts calls at the native updater boundary, including host-controlled actions. */
export const UpdaterActivity = Schema.Struct({
  checks: Schema.Number,
  downloads: Schema.Number,
  applies: Schema.Number,
});
export type UpdaterActivity = typeof UpdaterActivity.Type;

/** Deliberately `Schema.Unknown`: each command's own result shape is
 * asserted by the scenario that issued the command, not constrained here. */
export const AdapterCommandResponse = Schema.Struct({ result: Schema.Unknown });

/** Reject services without the required check-in capability rather than silently skipping conformance scenarios. */
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
