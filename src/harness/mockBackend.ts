import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { MockBackendHttpApi } from "../protocol/mockBackendApi.js";
import type { CheckInRequest, CheckInResponse } from "../protocol/wireContract.js";
import { serveHttpApiOnEphemeralPort } from "./serveHttpApi.js";

/** The scripted response the next check-in call returns -- set by a
 * scenario before pointing a test service's adapter here, so every
 * scenario drives the backend rather than the backend guessing. */
export interface MockBackendHandle {
  readonly baseUrl: string;
  readonly setNextResponse: (response: CheckInResponse) => Effect.Effect<void>;
  readonly receivedCheckIns: () => Effect.Effect<ReadonlyArray<CheckInRequest>>;
}

/** Caller provides a `Scope` (e.g. via `Effect.scoped`) spanning however long
 * the backend must stay listening -- the background fiber serving it is
 * interrupted, and the port released, when that scope closes. */
export function startMockBackend() {
  return Effect.gen(function* () {
    const nextResponse = yield* Ref.make<CheckInResponse | null>(null);
    const received = yield* Ref.make<ReadonlyArray<CheckInRequest>>([]);

    const respond = Effect.fn("mockBackend.respond")(function* (request: CheckInRequest) {
      yield* Ref.update(received, (log) => [...log, request]);
      const response = yield* Ref.get(nextResponse);

      if (!response)
        return yield* Effect.die(
          new Error("mock backend: no response configured for this scenario"),
        );

      return response;
    });

    const GroupLayer = HttpApiBuilder.group(MockBackendHttpApi, "ingestion", (handlers) =>
      handlers
        .handle("checkIn", ({ payload }) => respond(payload))
        .handle("preActionCheck", ({ payload }) =>
          respond({
            protocolVersion: payload.protocolVersion,
            installationId: payload.installationId,
            eventId: "",
            checkedInAt: "",
            sdkVersion: "",
            observedVersion: "",
            platform: "",
            arch: "",
            osVersion: "",
            attributes: {},
            adapterState: { type: "idle" },
          }),
        ),
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
    };
  });
}
