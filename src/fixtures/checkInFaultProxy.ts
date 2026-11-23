import { createServer, request, type Server } from "node:http";
import * as Effect from "effect/Effect";

export type CheckInFault = "none" | "disconnect" | "http-error" | "unreachable";

function listen(server: Server, port: number) {
  return Effect.callback<number, Error>((resume) => {
    function onError(error: Error): void {
      resume(Effect.fail(error));
    }

    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        resume(Effect.fail(new Error("fault proxy did not bind a TCP port")));
        return;
      }

      resume(Effect.succeed(address.port));
    });
  });
}

function close(server: Server) {
  return Effect.callback<void>((resume) => {
    server.closeAllConnections();
    server.close(() => resume(Effect.void));
  });
}

// Faults live at the HTTP/socket boundary; the SDK keeps its real transport,
// signature verification, scheduling, and public API behavior.
export function startCheckInFaultProxy(backendUrl: string) {
  return Effect.gen(function* () {
    let fault: CheckInFault = "none";
    let attempts = 0;
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createServer((incoming, response) => {
          attempts++;
          const requestFault = fault;
          if (requestFault === "disconnect") {
            incoming.socket.destroy();
            return;
          }

          const target = new URL(incoming.url ?? "/", backendUrl);
          const upstream = request(
            target,
            {
              method: incoming.method ?? "POST",
              headers: { ...incoming.headers, host: target.host },
            },
            (received) => {
              // Keep the valid signed body to detect clients that ignore status.
              response.writeHead(
                requestFault === "http-error" ? 503 : (received.statusCode ?? 502),
                received.headers,
              );
              received.on("error", () => response.destroy());
              received.pipe(response);
            },
          );
          upstream.on("error", () => response.destroy());
          incoming.on("error", () => upstream.destroy());
          response.on("close", () => upstream.destroy());
          incoming.pipe(upstream);
        }),
      ),
      close,
    );
    const port = yield* listen(server, 0);

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      attempts: () => Effect.sync(() => attempts),
      setFault: (next: CheckInFault) =>
        Effect.gen(function* () {
          fault = next;
          server.closeAllConnections();
          if (next === "unreachable") {
            yield* close(server);
          } else if (!server.listening) {
            yield* listen(server, port);
          }
        }),
    };
  });
}
