import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import type { HttpApiClient } from "effect/http-api";
import type { TestServiceHttpApi } from "../protocol/testServiceApi.js";
import { connectToTestService } from "./testServiceClient.js";

export type NamedTestServices = ReadonlyMap<
  string,
  HttpApiClient.ForApi<typeof TestServiceHttpApi>
>;

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
  return Effect.gen(function* () {
    const testServices = new Map<string, HttpApiClient.ForApi<typeof TestServiceHttpApi>>();

    for (const [name, baseUrl] of testServiceBaseUrls) {
      testServices.set(name, yield* connectToTestService(baseUrl));
    }

    const exit = yield* check.run(testServices).pipe(Effect.exit);

    return exit._tag === "Success"
      ? { name: check.name, passed: true }
      : { name: check.name, passed: false, error: exit.cause };
  }).pipe(Effect.provide(FetchHttpClient.layer));
}
