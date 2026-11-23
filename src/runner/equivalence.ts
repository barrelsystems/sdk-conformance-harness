import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import type { HttpApiClient } from "effect/http-api";
import type { TestServiceHttpApi } from "../protocol/testServiceApi.js";
import { connectToTestService } from "../fixtures/testServiceClient.js";

type NamedTestServices = ReadonlyMap<string, HttpApiClient.ForApi<typeof TestServiceHttpApi>>;

/** Unlike `Scenario` (one SDK vs. the spec, inside that SDK's own CI), an
 * equivalence check needs every SDK's test service live at once -- "do
 * they agree with each other," not "does this one match the spec." */
export interface EquivalenceCheck {
  readonly name: string;
  readonly run: (testServices: NamedTestServices) => Effect.Effect<void, unknown, never>;
}

export interface EquivalenceResult {
  readonly name: string;
  readonly passed: boolean;
  readonly error?: unknown;
}

export function runEquivalenceCheck(
  testServiceBaseUrls: ReadonlyMap<string, string>,
  check: EquivalenceCheck,
): Effect.Effect<EquivalenceResult> {
  if (testServiceBaseUrls.size < 2 || new Set(testServiceBaseUrls.values()).size < 2) {
    return Effect.succeed({
      name: check.name,
      passed: false,
      error: new Error("equivalence requires at least two distinct test services"),
    });
  }

  return Effect.gen(function* () {
    const testServices = new Map<string, HttpApiClient.ForApi<typeof TestServiceHttpApi>>();

    const sdkNames = new Set<string>();

    for (const [name, baseUrl] of testServiceBaseUrls) {
      const service = yield* connectToTestService(baseUrl);
      const capabilities = yield* service.testService.capabilities();
      if (sdkNames.has(capabilities.sdkName)) {
        return yield* Effect.fail(
          new Error(`equivalence repeats SDK implementation: ${capabilities.sdkName}`),
        );
      }

      sdkNames.add(capabilities.sdkName);
      testServices.set(name, service);
    }

    yield* check.run(testServices);
  }).pipe(
    Effect.exit,
    Effect.map((exit) =>
      exit._tag === "Success"
        ? { name: check.name, passed: true }
        : { name: check.name, passed: false, error: exit.cause },
    ),
    Effect.provide(FetchHttpClient.layer),
  );
}
