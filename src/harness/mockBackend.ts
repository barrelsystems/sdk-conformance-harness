import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { MockBackendHttpApi } from "../protocol/mockBackendApi.js";
import type {
  CheckInRequest,
  CheckInResponse,
  PreActionCheckRequest,
} from "../protocol/wireContract.js";
import { serveHttpApiOnEphemeralPort } from "./serveHttpApi.js";

/** The scripted response the next check-in call returns -- set by a
 * scenario before pointing a test service's adapter here, so every
 * scenario drives the backend rather than the backend guessing. */
export interface MockBackendHandle {
  readonly baseUrl: string;
  readonly setNextResponse: (response: CheckInResponse) => Effect.Effect<void>;
  readonly receivedCheckIns: () => Effect.Effect<ReadonlyArray<CheckInRequest>>;
  /** Delays every later check-in response by this long, until cleared --
   * a resilience scenario's way of simulating a slow or hung backend. */
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

/** Caller provides a `Scope` (e.g. via `Effect.scoped`) spanning however long
 * the backend must stay listening -- the background fiber serving it is
 * interrupted, and the port released, when that scope closes. */
export function startMockBackend() {
  return Effect.gen(function* () {
    const nextResponse = yield* Ref.make<CheckInResponse | null>(null);
    const received = yield* Ref.make<ReadonlyArray<CheckInRequest>>([]);
    const nextDelay = yield* Ref.make<Duration.Input | null>(null);
    const nextFailure = yield* Ref.make(false);
    const inFlight = yield* Ref.make(0);
    const peakInFlight = yield* Ref.make(0);
    const preActionDelay = yield* Ref.make<Duration.Input | null>(null);
    const preActionFailure = yield* Ref.make(false);
    const nextPreActionResponse = yield* Ref.make<CheckInResponse | null>(null);
    const receivedPreActionChecks = yield* Ref.make<ReadonlyArray<PreActionCheckRequest>>([]);

    const respond = Effect.fn("mockBackend.respond")(function* (request: CheckInRequest) {
      yield* Ref.update(received, (log) => [...log, request]);

      return yield* trackInFlightThenRespondOrFail(
        { nextResponse, nextDelay, nextFailure },
        { inFlight, peakInFlight },
      );
    });

    const respondToPreActionCheck = Effect.fn("mockBackend.respondToPreActionCheck")(function* (
      request: PreActionCheckRequest,
    ) {
      yield* Ref.update(receivedPreActionChecks, (log) => [...log, request]);

      const delay = yield* Ref.get(preActionDelay);

      if (delay !== null) yield* Effect.sleep(delay);
      if (yield* Ref.get(preActionFailure)) {
        return yield* Effect.die(new Error("mock backend: injected pre-action-check failure"));
      }

      const response = yield* Ref.get(nextPreActionResponse);

      if (!response)
        return yield* Effect.die(
          new Error("mock backend: no pre-action-check response configured for this scenario"),
        );

      return response;
    });

    const GroupLayer = HttpApiBuilder.group(MockBackendHttpApi, "ingestion", (handlers) =>
      handlers
        .handle("checkIn", ({ payload }) => respond(payload))
        .handle("preActionCheck", ({ payload }) => respondToPreActionCheck(payload)),
    );

    const routerLayer = HttpApiBuilder.layer(MockBackendHttpApi).pipe(
      Layer.provide(GroupLayer),
      HttpRouter.serve,
    );
    const port = yield* serveHttpApiOnEphemeralPort(routerLayer);

    return {
      baseUrl: `http://localhost:${port}`,
      setNextResponse: (response: CheckInResponse) => Ref.set(nextResponse, response),
      receivedCheckIns: () => Ref.get(received),
      setNextCheckInDelay: (duration: Duration.Input | null) => Ref.set(nextDelay, duration),
      setNextCheckInFailure: ({ shouldFail }: { readonly shouldFail: boolean }) =>
        Ref.set(nextFailure, shouldFail),
      peakConcurrentCheckIns: () => Ref.get(peakInFlight),
      setNextPreActionCheckResponse: (response: CheckInResponse) =>
        Ref.set(nextPreActionResponse, response),
      setNextPreActionCheckDelay: (duration: Duration.Input | null) =>
        Ref.set(preActionDelay, duration),
      setNextPreActionCheckFailure: ({ shouldFail }: { readonly shouldFail: boolean }) =>
        Ref.set(preActionFailure, shouldFail),
      receivedPreActionChecks: () => Ref.get(receivedPreActionChecks),
    };
  });
}

/** Applies the scripted delay/failure around producing a response, while
 * keeping the concurrent-in-flight count accurate even if this fiber is
 * interrupted (a timed-out scenario) partway through waiting. */
function trackInFlightThenRespondOrFail(
  script: {
    readonly nextResponse: Ref.Ref<CheckInResponse | null>;
    readonly nextDelay: Ref.Ref<Duration.Input | null>;
    readonly nextFailure: Ref.Ref<boolean>;
  },
  counters: { readonly inFlight: Ref.Ref<number>; readonly peakInFlight: Ref.Ref<number> },
) {
  return Effect.gen(function* () {
    const current = yield* Ref.updateAndGet(counters.inFlight, (n) => n + 1);

    yield* Ref.update(counters.peakInFlight, (peak) => Math.max(peak, current));

    const delay = yield* Ref.get(script.nextDelay);

    if (delay !== null) yield* Effect.sleep(delay);

    const shouldFail = yield* Ref.get(script.nextFailure);

    if (shouldFail) return yield* Effect.die(new Error("mock backend: injected check-in failure"));

    const response = yield* Ref.get(script.nextResponse);

    if (!response)
      return yield* Effect.die(new Error("mock backend: no response configured for this scenario"));

    return response;
  }).pipe(Effect.ensuring(Ref.update(counters.inFlight, (n) => n - 1)));
}
