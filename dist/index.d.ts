import * as Schema from "effect/Schema";
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
/** Independent re-declaration of Barrel's check-in/UpdateEligibility wire contract --
 * importing the thing being checked couldn't catch drift in it. This file
 * IS the spec, not a copy of one. */
export declare const UpdateState: Schema.Union<readonly [Schema.Struct<{
  readonly type: Schema.Literal<"idle">;
}>, Schema.Struct<{
  readonly type: Schema.Literal<"available">;
  readonly releaseNotes: Schema.optionalKey<Schema.String>;
}>, Schema.Struct<{
  readonly type: Schema.Literal<"downloading">;
  readonly progress: Schema.optionalKey<Schema.Number>;
}>, Schema.Struct<{
  readonly type: Schema.Literal<"downloaded">;
}>, Schema.Struct<{
  readonly type: Schema.Literal<"applying">;
}>, Schema.Struct<{
  readonly type: Schema.Literal<"update-cancelled">;
}>, Schema.Struct<{
  readonly type: Schema.Literal<"failed">;
  readonly category: Schema.Literals<readonly ["check", "download", "updater"]>;
  readonly code: Schema.String;
  readonly platformCode: Schema.String;
}>]>;
export type UpdateState = typeof UpdateState.Type;
export declare const BufferedFact: Schema.Union<readonly [Schema.Struct<{
  readonly kind: Schema.Literal<"lifecycleState">;
  readonly firstObservedAt: Schema.String;
  readonly lastObservedAt: Schema.String;
  readonly occurrenceCount: Schema.Number;
  readonly state: Schema.Union<readonly [Schema.Struct<{
    readonly type: Schema.Literal<"idle">;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"available">;
    readonly releaseNotes: Schema.optionalKey<Schema.String>;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"downloading">;
    readonly progress: Schema.optionalKey<Schema.Number>;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"downloaded">;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"applying">;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"update-cancelled">;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"failed">;
    readonly category: Schema.Literals<readonly ["check", "download", "updater"]>;
    readonly code: Schema.String;
    readonly platformCode: Schema.String;
  }>]>;
}>, Schema.Struct<{
  readonly kind: Schema.Literal<"updateError">;
  readonly firstObservedAt: Schema.String;
  readonly lastObservedAt: Schema.String;
  readonly occurrenceCount: Schema.Number;
  readonly phase: Schema.String;
  readonly failureMode: Schema.String;
  readonly platformCode: Schema.String;
}>]>;
export type BufferedFact = typeof BufferedFact.Type;
export declare const UpdateEligibility: Schema.Union<readonly [Schema.Struct<{
  readonly type: Schema.Literal<"unrestricted">;
  readonly issuedAt: Schema.String;
  readonly environment: Schema.String;
}>, Schema.Struct<{
  readonly type: Schema.Literal<"held">;
  readonly issuedAt: Schema.String;
  readonly environment: Schema.String;
  readonly reason: Schema.optionalKey<Schema.String>;
  readonly until: Schema.optionalKey<Schema.String>;
}>, Schema.Struct<{
  readonly type: Schema.Literal<"eligible">;
  readonly issuedAt: Schema.String;
  readonly environment: Schema.String;
  readonly priority: Schema.optionalKey<Schema.Literals<readonly ["normal", "high"]>>;
}>]>;
export type UpdateEligibility = typeof UpdateEligibility.Type;
export declare const CheckInRequest: Schema.Struct<{
  readonly protocolVersion: Schema.Literal<1>;
  readonly installationId: Schema.String;
  readonly eventId: Schema.String;
  readonly checkedInAt: Schema.String;
  readonly sdkVersion: Schema.String;
  readonly channel: Schema.String;
  readonly observedVersion: Schema.String;
  readonly platform: Schema.String;
  readonly arch: Schema.String;
  readonly osVersion: Schema.String;
  readonly attributes: Schema.$Record<Schema.String, Schema.String>;
  readonly lifecycleState: Schema.Union<readonly [Schema.Struct<{
    readonly type: Schema.Literal<"idle">;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"available">;
    readonly releaseNotes: Schema.optionalKey<Schema.String>;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"downloading">;
    readonly progress: Schema.optionalKey<Schema.Number>;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"downloaded">;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"applying">;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"update-cancelled">;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"failed">;
    readonly category: Schema.Literals<readonly ["check", "download", "updater"]>;
    readonly code: Schema.String;
    readonly platformCode: Schema.String;
  }>]>;
  readonly checkInIntervalMs: Schema.optionalKey<Schema.Number>;
  readonly bufferedFacts: Schema.optionalKey<Schema.$Array<Schema.Union<readonly [Schema.Struct<{
    readonly kind: Schema.Literal<"lifecycleState">;
    readonly firstObservedAt: Schema.String;
    readonly lastObservedAt: Schema.String;
    readonly occurrenceCount: Schema.Number;
    readonly state: Schema.Union<readonly [Schema.Struct<{
      readonly type: Schema.Literal<"idle">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"available">;
      readonly releaseNotes: Schema.optionalKey<Schema.String>;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"downloading">;
      readonly progress: Schema.optionalKey<Schema.Number>;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"downloaded">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"applying">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"update-cancelled">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"failed">;
      readonly category: Schema.Literals<readonly ["check", "download", "updater"]>;
      readonly code: Schema.String;
      readonly platformCode: Schema.String;
    }>]>;
  }>, Schema.Struct<{
    readonly kind: Schema.Literal<"updateError">;
    readonly firstObservedAt: Schema.String;
    readonly lastObservedAt: Schema.String;
    readonly occurrenceCount: Schema.Number;
    readonly phase: Schema.String;
    readonly failureMode: Schema.String;
    readonly platformCode: Schema.String;
  }>]>>>;
}>;
export type CheckInRequest = typeof CheckInRequest.Type;
export declare const CheckInResponse: Schema.Struct<{
  readonly protocolVersion: Schema.Literal<1>;
  readonly updateEligibility: Schema.String;
  readonly signature: Schema.String;
}>;
export type CheckInResponse = typeof CheckInResponse.Type;
export declare const PreActionCheckRequest: Schema.Struct<{
  readonly protocolVersion: Schema.Literal<1>;
  readonly installationId: Schema.String;
  readonly stage: Schema.Literals<readonly ["pre-download", "pre-apply"]>;
}>;
export type PreActionCheckRequest = typeof PreActionCheckRequest.Type;
/** The contract every SDK repo implements once, in its own language, as a
 * small standalone HTTP service. This file is the one normative definition;
 * each language's own test service implements the same wire shape independently. */
export declare const CreateAdapterRequest: Schema.Struct<{
  readonly checkInBaseUrl: Schema.String;
  readonly attributes: Schema.optionalKey<Schema.$Record<Schema.String, Schema.String>>;
  readonly debug: Schema.optionalKey<Schema.Boolean>;
  readonly checkInIntervalMs: Schema.optionalKey<Schema.Number>;
  readonly lifecycle: Schema.optionalKey<Schema.Boolean>;
  readonly installationPersistence: Schema.optionalKey<Schema.Literal<"failed">>;
  readonly publicKeyPem: Schema.String;
  /** Reported verbatim on check-in; omission uses the SDK default. */
  readonly channel: Schema.optionalKey<Schema.String>;
}>;
export type CreateAdapterRequest = typeof CreateAdapterRequest.Type;
export declare const CreateAdapterResponse: Schema.Struct<{
  readonly id: Schema.String;
}>;
export declare const FactObservation: Schema.Union<readonly [Schema.Struct<{
  readonly kind: Schema.Literal<"lifecycleState">;
  readonly state: Schema.Union<readonly [Schema.Struct<{
    readonly type: Schema.Literal<"idle">;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"available">;
    readonly releaseNotes: Schema.optionalKey<Schema.String>;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"downloading">;
    readonly progress: Schema.optionalKey<Schema.Number>;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"downloaded">;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"applying">;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"update-cancelled">;
  }>, Schema.Struct<{
    readonly type: Schema.Literal<"failed">;
    readonly category: Schema.Literals<readonly ["check", "download", "updater"]>;
    readonly code: Schema.String;
    readonly platformCode: Schema.String;
  }>]>;
}>, Schema.Struct<{
  readonly kind: Schema.Literal<"updateError">;
  readonly platformCode: Schema.String;
}>]>;
export type FactObservation = typeof FactObservation.Type;
export declare const AdapterCommand: Schema.Union<readonly [Schema.Struct<{
  readonly command: Schema.Literal<"getCadenceState">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"restoreInstallationPersistence">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getPersistedInstallationId">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"triggerLifecycle">;
  readonly event: Schema.Literals<readonly ["foreground", "resume"]>;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"recordFacts">;
  readonly facts: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
    readonly kind: Schema.Literal<"lifecycleState">;
    readonly state: Schema.Union<readonly [Schema.Struct<{
      readonly type: Schema.Literal<"idle">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"available">;
      readonly releaseNotes: Schema.optionalKey<Schema.String>;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"downloading">;
      readonly progress: Schema.optionalKey<Schema.Number>;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"downloaded">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"applying">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"update-cancelled">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"failed">;
      readonly category: Schema.Literals<readonly ["check", "download", "updater"]>;
      readonly code: Schema.String;
      readonly platformCode: Schema.String;
    }>]>;
  }>, Schema.Struct<{
    readonly kind: Schema.Literal<"updateError">;
    readonly platformCode: Schema.String;
  }>]>>;
  readonly concurrent: Schema.Boolean;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getBufferedFacts">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getPersistedBuffer">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"clearBuffer">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"setBufferPersistence">;
  readonly mode: Schema.Literals<readonly ["normal", "blocked", "failed"]>;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getBufferPersistenceState">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"probeBufferExit">;
  readonly mode: Schema.Literals<readonly ["settled", "pending"]>;
  readonly facts: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
    readonly kind: Schema.Literal<"lifecycleState">;
    readonly state: Schema.Union<readonly [Schema.Struct<{
      readonly type: Schema.Literal<"idle">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"available">;
      readonly releaseNotes: Schema.optionalKey<Schema.String>;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"downloading">;
      readonly progress: Schema.optionalKey<Schema.Number>;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"downloaded">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"applying">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"update-cancelled">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"failed">;
      readonly category: Schema.Literals<readonly ["check", "download", "updater"]>;
      readonly code: Schema.String;
      readonly platformCode: Schema.String;
    }>]>;
  }>, Schema.Struct<{
    readonly kind: Schema.Literal<"updateError">;
    readonly platformCode: Schema.String;
  }>]>>;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"checkNow">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getUpdateState">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getUpdateEligibility">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getUpdaterActivity">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"prepareAction">;
  readonly stage: Schema.Literals<readonly ["pre-download", "pre-apply"]>;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getLastUpdateError">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"prepareUpdaterFailure">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"runAction">;
  readonly stage: Schema.Literals<readonly ["pre-download", "pre-apply"]>;
}>]>;
export type AdapterCommand = typeof AdapterCommand.Type;
/** Counts calls at the native updater boundary, including host-controlled actions. */
export declare const UpdaterActivity: Schema.Struct<{
  readonly checks: Schema.Number;
  readonly downloads: Schema.Number;
  readonly applies: Schema.Number;
}>;
export type UpdaterActivity = typeof UpdaterActivity.Type;
/** Deliberately `Schema.Unknown`: each command's own result shape is
 * asserted by the scenario that issued the command, not constrained here. */
export declare const AdapterCommandResponse: Schema.Struct<{
  readonly result: Schema.Unknown;
}>;
/** Reject services without the required check-in capability rather than silently skipping conformance scenarios. */
export declare const Capabilities: Schema.Struct<{
  readonly sdkName: Schema.String;
  readonly sdkVersion: Schema.String;
  readonly supportsCheckIn: Schema.Boolean;
}>;
/** A pure function required to be byte-identical across every SDK for the
 * same input -- exposed directly since it's stateless. */
export declare const JitterFractionRequest: Schema.Struct<{
  readonly installationId: Schema.String;
}>;
export declare const JitterFractionResponse: Schema.Struct<{
  readonly fraction: Schema.Number;
}>;
declare const TestServiceApi_base: HttpApiGroup.HttpApiGroup<"testService", HttpApiEndpoint.HttpApiEndpoint<"capabilities", "GET", "/", never, never, never, never, Schema.toCodecJson<Schema.Struct<{
  readonly sdkName: Schema.String;
  readonly sdkVersion: Schema.String;
  readonly supportsCheckIn: Schema.Boolean;
}>>, never, never, never> | HttpApiEndpoint.HttpApiEndpoint<"createAdapter", "POST", "/adapters", never, never, Schema.toCodecJson<Schema.Struct<{
  readonly checkInBaseUrl: Schema.String;
  readonly attributes: Schema.optionalKey<Schema.$Record<Schema.String, Schema.String>>;
  readonly debug: Schema.optionalKey<Schema.Boolean>;
  readonly checkInIntervalMs: Schema.optionalKey<Schema.Number>;
  readonly lifecycle: Schema.optionalKey<Schema.Boolean>;
  readonly installationPersistence: Schema.optionalKey<Schema.Literal<"failed">>;
  readonly publicKeyPem: Schema.String;
  /** Reported verbatim on check-in; omission uses the SDK default. */
  readonly channel: Schema.optionalKey<Schema.String>;
}>>, never, Schema.toCodecJson<Schema.Struct<{
  readonly id: Schema.String;
}>>, never, never, never> | HttpApiEndpoint.HttpApiEndpoint<"runCommand", "POST", "/adapters/:id/commands", Schema.toCodecStringTree<Schema.Struct<{
  id: Schema.String;
}>>, never, Schema.toCodecJson<Schema.Union<readonly [Schema.Struct<{
  readonly command: Schema.Literal<"getCadenceState">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"restoreInstallationPersistence">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getPersistedInstallationId">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"triggerLifecycle">;
  readonly event: Schema.Literals<readonly ["foreground", "resume"]>;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"recordFacts">;
  readonly facts: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
    readonly kind: Schema.Literal<"lifecycleState">;
    readonly state: Schema.Union<readonly [Schema.Struct<{
      readonly type: Schema.Literal<"idle">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"available">;
      readonly releaseNotes: Schema.optionalKey<Schema.String>;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"downloading">;
      readonly progress: Schema.optionalKey<Schema.Number>;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"downloaded">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"applying">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"update-cancelled">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"failed">;
      readonly category: Schema.Literals<readonly ["check", "download", "updater"]>;
      readonly code: Schema.String;
      readonly platformCode: Schema.String;
    }>]>;
  }>, Schema.Struct<{
    readonly kind: Schema.Literal<"updateError">;
    readonly platformCode: Schema.String;
  }>]>>;
  readonly concurrent: Schema.Boolean;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getBufferedFacts">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getPersistedBuffer">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"clearBuffer">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"setBufferPersistence">;
  readonly mode: Schema.Literals<readonly ["normal", "blocked", "failed"]>;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getBufferPersistenceState">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"probeBufferExit">;
  readonly mode: Schema.Literals<readonly ["settled", "pending"]>;
  readonly facts: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
    readonly kind: Schema.Literal<"lifecycleState">;
    readonly state: Schema.Union<readonly [Schema.Struct<{
      readonly type: Schema.Literal<"idle">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"available">;
      readonly releaseNotes: Schema.optionalKey<Schema.String>;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"downloading">;
      readonly progress: Schema.optionalKey<Schema.Number>;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"downloaded">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"applying">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"update-cancelled">;
    }>, Schema.Struct<{
      readonly type: Schema.Literal<"failed">;
      readonly category: Schema.Literals<readonly ["check", "download", "updater"]>;
      readonly code: Schema.String;
      readonly platformCode: Schema.String;
    }>]>;
  }>, Schema.Struct<{
    readonly kind: Schema.Literal<"updateError">;
    readonly platformCode: Schema.String;
  }>]>>;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"checkNow">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getUpdateState">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getUpdateEligibility">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getUpdaterActivity">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"prepareAction">;
  readonly stage: Schema.Literals<readonly ["pre-download", "pre-apply"]>;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"getLastUpdateError">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"prepareUpdaterFailure">;
}>, Schema.Struct<{
  readonly command: Schema.Literal<"runAction">;
  readonly stage: Schema.Literals<readonly ["pre-download", "pre-apply"]>;
}>]>>, never, Schema.toCodecJson<Schema.Struct<{
  readonly result: Schema.Unknown;
}>>, never, never, never> | HttpApiEndpoint.HttpApiEndpoint<"destroyAdapter", "DELETE", "/adapters/:id", Schema.toCodecStringTree<Schema.Struct<{
  id: Schema.String;
}>>, never, never, never, Schema.toCodecJson<import("effect/http-api/HttpApiSchema").NoContent>, never, never, never> | HttpApiEndpoint.HttpApiEndpoint<"jitterFraction", "POST", "/pure/jitter-fraction", never, never, Schema.toCodecJson<Schema.Struct<{
  readonly installationId: Schema.String;
}>>, never, Schema.toCodecJson<Schema.Struct<{
  readonly fraction: Schema.Number;
}>>, never, never, never>, false>;
export declare class TestServiceApi extends TestServiceApi_base {}
declare const TestServiceHttpApi_base: HttpApi.HttpApi<"sdk-test-service", typeof TestServiceApi>;
export declare class TestServiceHttpApi extends TestServiceHttpApi_base {}
declare const MockBackendApi_base: HttpApiGroup.HttpApiGroup<"ingestion", HttpApiEndpoint.HttpApiEndpoint<"checkIn", "POST", "/check-in", never, never, Schema.toCodecJson<Schema.Unknown>, Schema.toCodecStringTree<Schema.Struct<{
  authorization: Schema.String;
}>>, Schema.toCodecJson<Schema.Struct<{
  readonly protocolVersion: Schema.Literal<1>;
  readonly updateEligibility: Schema.String;
  readonly signature: Schema.String;
}>>, never, never, never> | HttpApiEndpoint.HttpApiEndpoint<"preActionCheck", "POST", "/pre-action-check", never, never, Schema.toCodecJson<Schema.Struct<{
  readonly protocolVersion: Schema.Literal<1>;
  readonly installationId: Schema.String;
  readonly stage: Schema.Literals<readonly ["pre-download", "pre-apply"]>;
}>>, Schema.toCodecStringTree<Schema.Struct<{
  authorization: Schema.String;
}>>, Schema.toCodecJson<Schema.Struct<{
  readonly protocolVersion: Schema.Literal<1>;
  readonly updateEligibility: Schema.String;
  readonly signature: Schema.String;
}>>, never, never, never>, false>;
/** The harness's own simulation of Barrel's real ingestion endpoint. Every
 * scenario configures what this server returns before pointing a test
 * service's adapter at it. */
export declare class MockBackendApi extends MockBackendApi_base {}
declare const MockBackendHttpApi_base: HttpApi.HttpApi<"barrel-mock-backend", typeof MockBackendApi>;
export declare class MockBackendHttpApi extends MockBackendHttpApi_base {}
/** A fresh Ed25519 keypair per harness run -- a conforming SDK must be
 * configured with this run's public key, never a baked-in one. Signs the
 * exact UTF-8 bytes of `JSON.stringify(updateEligibility)`. */
export interface TestKeypair {
  readonly publicKeyPem: string;
  readonly signRaw: (updateEligibilityJson: string) => Effect.Effect<{
    updateEligibility: string;
    signature: string;
  }>;
  readonly sign: (updateEligibility: UpdateEligibility) => Effect.Effect<{
    updateEligibility: string;
    signature: string;
  }>;
}
export declare function generateTestKeypair(): Effect.Effect<TestKeypair>;
/** The reference algorithm every SDK's own jitter implementation must match
 * exactly. An independent copy on purpose, the same reasoning as
 * `wireContract.ts`: importing the thing being checked couldn't catch drift in it. */
export declare function referenceJitterFraction(installationId: string): number;
/** The scripted response the next check-in call returns -- set by a
 * scenario before pointing a test service's adapter here, so every
 * scenario drives the backend rather than the backend guessing. */
interface MockBackendHandle {
  readonly baseUrl: string;
  readonly receivedCheckInAuthorization: () => Effect.Effect<ReadonlyArray<string>>;
  readonly receivedRawCheckIns: () => Effect.Effect<ReadonlyArray<unknown>>;
  readonly setNextResponse: (response: CheckInResponse) => Effect.Effect<void>;
  readonly receivedCheckIns: () => Effect.Effect<ReadonlyArray<CheckInRequest>>;
  /** Delays every later check-in response by this long, until cleared --
   * a resilience scenario's way of simulating a slow or hung backend. */
  /** Holds responses until the returned release effect runs. */
  readonly blockCheckInResponses: () => Effect.Effect<Effect.Effect<void>>;
  readonly setNextCheckInDelay: (duration: Duration.Input | null) => Effect.Effect<void>;
  /** Makes every later check-in fail outright instead of responding --
   * a resilience scenario's way of simulating an ingestion-side outage. */
  readonly setNextCheckInFailure: (options: {
    readonly shouldFail: boolean;
  }) => Effect.Effect<void>;
  /** The largest number of check-in requests this backend has ever had
   * in flight at once -- how a no-overlap scenario would observe overlap. */
  readonly peakConcurrentCheckIns: () => Effect.Effect<number>;
  readonly setNextPreActionCheckResponse: (response: CheckInResponse) => Effect.Effect<void>;
  readonly setNextPreActionCheckDelay: (duration: Duration.Input | null) => Effect.Effect<void>;
  readonly setNextPreActionCheckFailure: (options: {
    readonly shouldFail: boolean;
  }) => Effect.Effect<void>;
  readonly receivedPreActionChecks: () => Effect.Effect<ReadonlyArray<PreActionCheckRequest>>;
}
type TestServiceClient = HttpApiClient.ForApi<typeof TestServiceHttpApi>;
/** What every scenario's `run` is handed -- pulled out as its own type so
 * a scenario-building helper can name it
 * directly instead of re-deriving or re-inlining this shape. */
interface ScenarioContext {
  readonly backend: MockBackendHandle;
  readonly keypair: TestKeypair;
  readonly testService: TestServiceClient;
}
/** One conformance check: drive the SDK's real adapter through a sequence
 * of commands and assert on the outcome. Throwing fails the scenario;
 * returning normally passes it. */
interface Scenario {
  readonly name: string;
  /** Tier 1 must pass at 100%; tier 2 may regress to an 80% pass rate
   * before the run fails. A tier-1 scenario auto-relegates to tier 2
   * after failing its last N runs straight (`relegationHistory.ts`). */
  readonly tier: 1 | 2;
  readonly run: (context: ScenarioContext) => Effect.Effect<void, unknown, never>;
}
type NamedTestServices = ReadonlyMap<string, HttpApiClient.ForApi<typeof TestServiceHttpApi>>;
/** Unlike `Scenario` (one SDK vs. the spec, inside that SDK's own CI), an
 * equivalence check needs every SDK's test service live at once -- "do
 * they agree with each other," not "does this one match the spec." */
interface EquivalenceCheck {
  readonly name: string;
  readonly run: (testServices: NamedTestServices) => Effect.Effect<void, unknown, never>;
}
interface EquivalenceResult {
  readonly name: string;
  readonly passed: boolean;
  readonly error?: unknown;
}
export type { EquivalenceCheck, EquivalenceResult, Scenario };
//# sourceMappingURL=index.d.ts.map