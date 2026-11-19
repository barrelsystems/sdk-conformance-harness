import * as Effect from "effect/Effect";
import type { EquivalenceCheck } from "../harness/equivalence.js";

/** The one check in this harness that asserts true numeric equality, not
 * "reasonable behavior" -- the spec requires the jitter fraction to be a
 * deterministic function of `installationId`, identical in every SDK. */
export const jitterFractionEquivalence: EquivalenceCheck = {
  name: "every SDK computes the identical jitter fraction for the same installationId",
  run: (testServices) =>
    Effect.gen(function* () {
      const installationId = "equivalence-check-installation";
      const fractionsBySdk = new Map<string, number>();

      for (const [sdkName, client] of testServices) {
        const response = yield* client.testService.jitterFraction({ payload: { installationId } });

        fractionsBySdk.set(sdkName, response.fraction);
      }

      const fractions = [...fractionsBySdk.values()];
      const allIdentical = fractions.every((fraction) => fraction === fractions[0]);

      if (!allIdentical) {
        return yield* Effect.die(
          new Error(`jitter fraction mismatch across SDKs: ${JSON.stringify([...fractionsBySdk])}`),
        );
      }
    }),
};
