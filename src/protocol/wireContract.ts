import * as Schema from "effect/Schema";

const Uuid = Schema.String.check(
  Schema.makeFilter((value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  ),
);
const Timestamp = Schema.String.check(
  Schema.makeFilter(
    (value: string) => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
  ),
);

/** Independent re-declaration of Barrel's check-in/UpdateEligibility wire contract --
 * importing the thing being checked couldn't catch drift in it. This file
 * IS the spec, not a copy of one. */

export const UpdateState = Schema.Union([
  Schema.Struct({ type: Schema.Literal("idle") }),
  Schema.Struct({
    type: Schema.Literal("available"),
    releaseNotes: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("downloading"),
    progress: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({ type: Schema.Literal("downloaded") }),
  Schema.Struct({ type: Schema.Literal("applying") }),
  Schema.Struct({ type: Schema.Literal("update-cancelled") }),
  Schema.Struct({
    type: Schema.Literal("failed"),
    category: Schema.Literals(["check", "download", "updater"]),
    code: Schema.String,
    platformCode: Schema.String,
  }),
]);
export type UpdateState = typeof UpdateState.Type;

export const BufferedFact = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("lifecycleState"),
    firstObservedAt: Schema.String,
    lastObservedAt: Schema.String,
    occurrenceCount: Schema.Number,
    state: UpdateState,
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

export const UpdateEligibility = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("unrestricted"),
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
    type: Schema.Literal("eligible"),
    issuedAt: Schema.String,
    environment: Schema.String,
    priority: Schema.optionalKey(Schema.Literals(["normal", "high"])),
  }),
]);
export type UpdateEligibility = typeof UpdateEligibility.Type;

export const CheckInRequest = Schema.Struct({
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
  bufferedFacts: Schema.optionalKey(Schema.Array(BufferedFact)),
});
export type CheckInRequest = typeof CheckInRequest.Type;

export const CheckInResponse = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  updateEligibility: Schema.String,
  signature: Schema.String,
});
export type CheckInResponse = typeof CheckInResponse.Type;

export const PreActionCheckRequest = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  installationId: Uuid,
  stage: Schema.Literals(["pre-download", "pre-apply"]),
});
export type PreActionCheckRequest = typeof PreActionCheckRequest.Type;
