import * as Schema from "effect/Schema";

/** Independent re-declaration of Barrel's check-in/Policy wire contract --
 * importing the thing being checked couldn't catch drift in it. This file
 * IS the spec, not a copy of one. */

export const AdapterState = Schema.Union([
  Schema.Struct({ type: Schema.Literal("idle") }),
  Schema.Struct({ type: Schema.Literal("checking") }),
  Schema.Struct({ type: Schema.Literal("available") }),
  Schema.Struct({
    type: Schema.Literal("downloading"),
    progress: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({ type: Schema.Literal("downloaded") }),
  Schema.Struct({ type: Schema.Literal("update-cancelled") }),
  Schema.Struct({
    type: Schema.Literal("failed"),
    category: Schema.Literals(["check", "download", "updater"]),
    code: Schema.String,
    platformCode: Schema.String,
  }),
]);
export type AdapterState = typeof AdapterState.Type;

export const BufferedFact = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("adapterState"),
    firstObservedAt: Schema.String,
    lastObservedAt: Schema.String,
    occurrenceCount: Schema.Number,
    state: AdapterState,
  }),
  Schema.Struct({
    kind: Schema.Literal("updateError"),
    firstObservedAt: Schema.String,
    lastObservedAt: Schema.String,
    occurrenceCount: Schema.Number,
    phase: Schema.String,
    failureMode: Schema.String,
    platformCode: Schema.String,
  }),
]);
export type BufferedFact = typeof BufferedFact.Type;

export const Policy = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("current"),
    issuedAt: Schema.String,
    environment: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("held"),
    issuedAt: Schema.String,
    environment: Schema.String,
    reason: Schema.optionalKey(Schema.String),
    until: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("updateEligible"),
    issuedAt: Schema.String,
    environment: Schema.String,
    priority: Schema.optionalKey(Schema.Literals(["normal", "high"])),
  }),
]);
export type Policy = typeof Policy.Type;

export const CheckInRequest = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  installationId: Schema.String,
  eventId: Schema.String,
  checkedInAt: Schema.String,
  sdkVersion: Schema.String,
  channel: Schema.String,
  observedVersion: Schema.String,
  platform: Schema.String,
  arch: Schema.String,
  osVersion: Schema.String,
  attributes: Schema.Record(Schema.String, Schema.String),
  adapterState: AdapterState,
  bufferedFacts: Schema.optionalKey(Schema.Array(BufferedFact)),
});
export type CheckInRequest = typeof CheckInRequest.Type;

export const CheckInResponse = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  policy: Schema.String,
  signature: Schema.String,
});
export type CheckInResponse = typeof CheckInResponse.Type;

export const PreActionCheckRequest = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  installationId: Schema.String,
  stage: Schema.Literals(["pre-download", "pre-apply"]),
});
export type PreActionCheckRequest = typeof PreActionCheckRequest.Type;
