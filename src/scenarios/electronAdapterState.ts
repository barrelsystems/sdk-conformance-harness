import * as Schema from "effect/Schema";

/** `getAdapterState()`'s own public return type -- richer than
 * `wireContract.ts`'s `AdapterState` (the wire shape, no `releaseNotes`).
 * Shared by every electron adapter scenario, same type regardless of variant. */
export const ElectronAdapterState = Schema.Union([
  Schema.Struct({ type: Schema.Literal("idle") }),
  Schema.Struct({ type: Schema.Literal("checking") }),
  Schema.Struct({
    type: Schema.Literal("available"),
    releaseNotes: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("downloading"),
    progress: Schema.optionalKey(Schema.Number),
    releaseNotes: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("downloaded"),
    releaseNotes: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("update-cancelled") }),
  Schema.Struct({
    type: Schema.Literal("failed"),
    category: Schema.Literals(["check", "download", "updater"]),
    code: Schema.String,
    platformCode: Schema.String,
  }),
]);
export type ElectronAdapterState = typeof ElectronAdapterState.Type;

/** Key-order-independent by construction, unlike a `JSON.stringify`
 * comparison. */
export const electronAdapterStatesAreEquivalent = Schema.toEquivalence(ElectronAdapterState);
