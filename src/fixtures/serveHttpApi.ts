import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpServer } from "effect/http";

/** Binds a router layer to an ephemeral port as one background fiber
 * bound to the caller's scope, returning that port. Extracted after this
 * exact shape showed up verbatim twice. */
export function serveHttpApiOnEphemeralPort<R>(
  routerLayer: Layer.Layer<never, never, R | HttpServer.HttpServer>,
) {
  return Effect.gen(function* () {
    const portDeferred = yield* Deferred.make<number>();
    const portSignalLayer = Layer.effectDiscard(
      Effect.gen(function* () {
        const server = yield* HttpServer.HttpServer;
        const port = server.address._tag === "UnixPathAddress" ? 0 : server.address.port;

        yield* Deferred.succeed(portDeferred, port);
      }),
    );
    const apiLayer = Layer.merge(routerLayer, portSignalLayer).pipe(
      Layer.provide(NodeHttpServer.layer(createServer, { port: 0 })),
    );

    yield* Effect.forkScoped(Layer.launch(apiLayer));

    return yield* Deferred.await(portDeferred);
  });
}
