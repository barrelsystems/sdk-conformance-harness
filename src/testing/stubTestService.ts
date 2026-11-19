import { randomUUID, webcrypto } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { referenceJitterFraction } from "../protocol/jitter.js";
import { TestServiceHttpApi } from "../protocol/testServiceApi.js";
import type { AdapterState, CheckInResponse } from "../protocol/wireContract.js";
import { serveHttpApiOnEphemeralPort } from "../harness/serveHttpApi.js";

interface AdapterInstance {
  readonly checkInBaseUrl: string;
  readonly publicKeyPem: string;
  state: AdapterState;
}

function pemToDer(pem: string): Uint8Array {
  const base64Body = pem.replace(/-{5}(BEGIN|END) PUBLIC KEY-{5}/g, "").replace(/\s+/g, "");

  return Uint8Array.from(Buffer.from(base64Body, "base64"));
}

/** A minimal, real check-in implementation -- not a production adapter,
 * just enough to exercise this harness's own mock backend/signing/client
 * plumbing end-to-end in a test. */
const checkNow = Effect.fn("stubTestService.checkNow")(function* (adapter: AdapterInstance) {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.execute(
    HttpClientRequest.post(`${adapter.checkInBaseUrl}/check-in`).pipe(
      HttpClientRequest.setHeader("authorization", "Bearer test"),
      HttpClientRequest.bodyJsonUnsafe({
        protocolVersion: 1,
        installationId: "stub-installation",
        eventId: randomUUID(),
        checkedInAt: new Date().toISOString(),
        sdkVersion: "0.0.0",
        observedVersion: "0.0.0",
        platform: "test",
        arch: "test",
        osVersion: "test",
        attributes: {},
        adapterState: adapter.state,
      }),
    ),
  );
  const body = (yield* response.json) as CheckInResponse;

  const key = yield* Effect.promise(() =>
    webcrypto.subtle.importKey("spki", pemToDer(adapter.publicKeyPem), { name: "Ed25519" }, false, [
      "verify",
    ]),
  );
  const verified = yield* Effect.promise(() =>
    webcrypto.subtle.verify(
      "Ed25519",
      key,
      Uint8Array.from(Buffer.from(body.signature, "base64")),
      new TextEncoder().encode(body.policy),
    ),
  );

  if (!verified)
    return yield* Effect.die(new Error("stub test service: policy signature did not verify"));

  const policy = JSON.parse(body.policy) as { type: string };
  adapter.state = policy.type === "updateEligible" ? { type: "available" } : { type: "idle" };
});

/** Caller provides a `Scope` spanning however long this stub must stay
 * listening. `computeJitterFraction` defaults to the real reference
 * algorithm; tests pass a wrong one to prove drift gets caught. */
export function startStubTestService(
  computeJitterFraction: (installationId: string) => number = referenceJitterFraction,
) {
  return Effect.gen(function* () {
    const adapters = yield* Ref.make<Map<string, AdapterInstance>>(new Map());

    const GroupLayer = HttpApiBuilder.group(TestServiceHttpApi, "testService", (handlers) =>
      handlers
        .handle("capabilities", () =>
          Effect.succeed({ sdkName: "stub", sdkVersion: "0.0.0", supportsCheckIn: true }),
        )
        .handle("createAdapter", ({ payload }) =>
          Effect.gen(function* () {
            const id = randomUUID();

            yield* Ref.update(adapters, (map) => {
              const next = new Map(map);

              next.set(id, {
                checkInBaseUrl: payload.checkInBaseUrl,
                publicKeyPem: payload.publicKeyPem,
                state: { type: "idle" },
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

            if (payload.command === "checkNow") yield* checkNow(adapter).pipe(Effect.orDie);

            return { result: payload.command === "getAdapterState" ? adapter.state : null };
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
