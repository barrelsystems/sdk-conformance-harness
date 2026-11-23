import { HttpApiClient } from "effect/http-api";
import { TestServiceHttpApi } from "../protocol/testServiceApi.js";

/** Callers provide `FetchHttpClient.layer` around the whole scenario effect,
 * not here -- the derived client's own calls need that layer live at call
 * time, not just at derivation time. */
export function connectToTestService(baseUrl: string) {
  return HttpApiClient.make(TestServiceHttpApi, { baseUrl });
}
