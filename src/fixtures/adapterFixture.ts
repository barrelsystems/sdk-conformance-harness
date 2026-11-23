import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ScenarioContext } from "../runner/scenario.js";
import {
  UpdaterActivity,
  type AdapterCommand,
  type CreateAdapterRequest,
} from "../protocol/testServiceApi.js";

export function withAdapter(
  context: ScenarioContext,
  run: (
    command: (payload: AdapterCommand) => Effect.Effect<unknown, unknown>,
  ) => Effect.Effect<void, unknown>,
  config: Partial<CreateAdapterRequest> = {},
) {
  const api = context.testService.testService;

  return Effect.acquireUseRelease(
    api.createAdapter({
      payload: {
        checkInBaseUrl: context.backend.baseUrl,
        publicKeyPem: context.keypair.publicKeyPem,
        ...config,
      },
    }),
    ({ id }) =>
      run((payload) =>
        api.runCommand({ params: { id }, payload }).pipe(Effect.map((response) => response.result)),
      ),
    ({ id }) => api.destroyAdapter({ params: { id } }).pipe(Effect.orDie),
  );
}

export type AdapterCommands = (payload: AdapterCommand) => Effect.Effect<unknown, unknown>;

export function updaterActivity(command: AdapterCommands) {
  return command({ command: "getUpdaterActivity" }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(UpdaterActivity)),
  );
}
