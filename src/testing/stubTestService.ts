import { randomUUID, webcrypto } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Ref from "effect/Ref";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { referenceJitterFraction } from "../protocol/jitter.js";
import { TestServiceHttpApi } from "../protocol/testServiceApi.js";
import {
  UpdateEligibility,
  type UpdateState,
  type CheckInResponse,
} from "../protocol/wireContract.js";
import { serveHttpApiOnEphemeralPort } from "../fixtures/serveHttpApi.js";

interface AdapterInstance {
  readonly installationId: string;
  readonly checkInBaseUrl: string;
  readonly publicKeyPem: string;
  readonly channel: string;
  readonly credential: string;
  state: UpdateState;
  updateEligibility: UpdateEligibility | null;
  activity: { checks: number; downloads: number; applies: number };
  readonly checkInInFlight: Ref.Ref<boolean>;
}

function pemToDer(pem: string): Uint8Array {
  const base64Body = pem.replace(/-{5}(BEGIN|END) PUBLIC KEY-{5}/g, "").replace(/\s+/g, "");

  return Uint8Array.from(Buffer.from(base64Body, "base64"));
}

/** Shared by `checkNow` and `preActionCheck` below -- both get back a
 * signed `UpdateEligibility` the same way and must reject it identically on
 * a bad signature, so the verify step lives in one place. */
function verifyUpdateEligibilitySignature(adapter: AdapterInstance, body: CheckInResponse) {
  return Effect.gen(function* () {
    const key = yield* Effect.promise(() =>
      webcrypto.subtle.importKey(
        "spki",
        pemToDer(adapter.publicKeyPem),
        { name: "Ed25519" },
        false,
        ["verify"],
      ),
    );
    const verified = yield* Effect.promise(() =>
      webcrypto.subtle.verify(
        "Ed25519",
        key,
        Uint8Array.from(Buffer.from(body.signature, "base64")),
        new TextEncoder().encode(body.updateEligibility),
      ),
    );

    if (!verified)
      return yield* Effect.die(
        new Error("stub test service: update-eligibility signature did not verify"),
      );

    return yield* Schema.decodeUnknownEffect(UpdateEligibility)(JSON.parse(body.updateEligibility));
  });
}

/** A minimal, real check-in implementation -- not a production adapter,
 * just enough to exercise this harness's own mock backend/signing/client
 * plumbing end-to-end in a test. */
const checkNow = Effect.fn("stubTestService.checkNow")(function* (adapter: AdapterInstance) {
  // No-overlap: a second attempt while one's already in flight is a
  // no-op, never a second concurrent request.
  const alreadyInFlight = yield* Ref.get(adapter.checkInInFlight);

  if (alreadyInFlight) return;

  yield* Ref.set(adapter.checkInInFlight, true);

  yield* Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(
      HttpClientRequest.post(`${adapter.checkInBaseUrl}/check-in`).pipe(
        HttpClientRequest.setHeader("authorization", `Bearer ${adapter.credential}`),
        HttpClientRequest.bodyJsonUnsafe({
          protocolVersion: 1,
          installationId: adapter.installationId,
          eventId: randomUUID(),
          checkedInAt: new Date().toISOString(),
          sdkVersion: "0.0.0",
          channel: adapter.channel,
          observedVersion: "0.0.0",
          platform: "test",
          arch: "test",
          osVersion: "test",
          attributes: {},
          bufferedFacts: [],
          checkInIntervalMs: 1_800_000,
          lifecycleState: adapter.state,
        }),
      ),
    );
    const body = (yield* response.json) as CheckInResponse;
    if (["idle", "failed", "update-cancelled"].includes(adapter.state.type))
      adapter.activity.checks++;
    adapter.updateEligibility = yield* verifyUpdateEligibilitySignature(adapter, body);
  }).pipe(
    // Fail-open: any failure here (network, decode, bad signature) leaves
    // `state` exactly as it was, never a crash or a surfaced error.
    Effect.timeout("10 seconds"),
    Effect.catchCause(() => Effect.void),
    Effect.ensuring(Ref.set(adapter.checkInInFlight, false)),
  );
});

/** The pre-action endpoint verifies a fresh decision without replacing the periodic check-in workflow. */
const preActionCheck = Effect.fn("stubTestService.preActionCheck")(function* (
  adapter: AdapterInstance,
  stage: "pre-download" | "pre-apply",
) {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.execute(
    HttpClientRequest.post(`${adapter.checkInBaseUrl}/pre-action-check`).pipe(
      HttpClientRequest.setHeader("authorization", `Bearer ${adapter.credential}`),
      HttpClientRequest.bodyJsonUnsafe({
        protocolVersion: 1,
        installationId: adapter.installationId,
        stage,
      }),
    ),
  );
  const body = (yield* response.json) as CheckInResponse;
  const updateEligibility = yield* verifyUpdateEligibilitySignature(adapter, body);

  adapter.updateEligibility = updateEligibility;
  return updateEligibility.type;
});

/** Caller provides a `Scope` spanning however long this stub must stay
 * listening. `computeJitterFraction` defaults to the real reference
 * algorithm; tests pass a wrong one to prove drift gets caught. */
export function startStubTestService({
  computeJitterFraction = referenceJitterFraction,
  sdkName = "stub",
  credential = "test-service",
}: {
  computeJitterFraction?: (installationId: string) => number;
  sdkName?: string;
  credential?: string;
} = {}) {
  return Effect.gen(function* () {
    const adapters = yield* Ref.make<Map<string, AdapterInstance>>(new Map());

    const GroupLayer = HttpApiBuilder.group(TestServiceHttpApi, "testService", (handlers) =>
      handlers
        .handle("capabilities", () =>
          Effect.succeed({ sdkName, sdkVersion: "0.0.0", supportsCheckIn: true }),
        )
        .handle("createAdapter", ({ payload }) =>
          Effect.gen(function* () {
            const id = randomUUID();
            const checkInInFlight = yield* Ref.make(false);

            yield* Ref.update(adapters, (map) => {
              const next = new Map(map);

              next.set(id, {
                installationId: randomUUID(),
                checkInBaseUrl: payload.checkInBaseUrl,
                publicKeyPem: payload.publicKeyPem,
                channel: payload.channel ?? "stable",
                credential,
                state: { type: "idle" },
                updateEligibility: null,
                activity: { checks: 0, downloads: 0, applies: 0 },
                checkInInFlight,
              });

              return next;
            });

            return { id };
          }),
        )
        .handle("runCommand", ({ params, payload }) =>
          Effect.gen(function* () {
            const map = yield* Ref.get(adapters);
            const adapter = map.get(params.id);

            if (!adapter)
              return yield* Effect.die(
                new Error(`stub test service: unknown adapter ${params.id}`),
              );

            if (payload.command === "checkNow") {
              yield* checkNow(adapter).pipe(Effect.orDie);
              return { result: null };
            }

            if (payload.command === "getUpdaterActivity")
              return { result: { ...adapter.activity } };
            if (payload.command === "prepareAction") {
              adapter.state = {
                type: payload.stage === "pre-download" ? "available" : "downloaded",
              };
              return { result: null };
            }

            if (payload.command === "runAction") {
              const eligibilityType = yield* preActionCheck(adapter, payload.stage).pipe(
                Effect.timeout("10 seconds"),
                Effect.catchCause(() => Effect.succeed("unrestricted")),
              );

              if (eligibilityType !== "held") {
                if (payload.stage === "pre-download") adapter.activity.downloads++;
                else adapter.activity.applies++;
              }

              return { result: { ...adapter.activity } };
            }

            if (payload.command === "getUpdateEligibility")
              return { result: adapter.updateEligibility };

            if (payload.command === "getUpdateState") return { result: adapter.state };
            if (payload.command === "getLastUpdateError") return { result: null };

            return yield* Effect.die(
              new Error(`stub test service: unsupported command ${payload.command}`),
            );
          }).pipe(Effect.provide(FetchHttpClient.layer)),
        )
        .handle("destroyAdapter", ({ params }) =>
          Ref.update(adapters, (map) => {
            const next = new Map(map);

            next.delete(params.id);

            return next;
          }),
        )
        .handle("jitterFraction", ({ payload }) =>
          Effect.succeed({ fraction: computeJitterFraction(payload.installationId) }),
        ),
    );

    const routerLayer = HttpApiBuilder.layer(TestServiceHttpApi).pipe(
      Layer.provide(GroupLayer),
      HttpRouter.serve,
    );
    const port = yield* serveHttpApiOnEphemeralPort(routerLayer);

    return `http://localhost:${port}`;
  });
}
