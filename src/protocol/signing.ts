import { webcrypto } from "node:crypto";
import * as Effect from "effect/Effect";
import type { UpdateEligibility } from "./wireContract.js";

/** A fresh Ed25519 keypair per harness run -- a conforming SDK must be
 * configured with this run's public key, never a baked-in one. Signs the
 * exact UTF-8 bytes of `JSON.stringify(updateEligibility)`. */
export interface TestKeypair {
  readonly publicKeyPem: string;
  readonly signRaw: (
    updateEligibilityJson: string,
  ) => Effect.Effect<{ updateEligibility: string; signature: string }>;
  readonly sign: (
    updateEligibility: UpdateEligibility,
  ) => Effect.Effect<{ updateEligibility: string; signature: string }>;
}

export function generateTestKeypair(): Effect.Effect<TestKeypair> {
  return Effect.promise(async () => {
    // Cast needed only because the lib.dom overload for `generateKey`
    // widens to `CryptoKey | CryptoKeyPair`; Ed25519 always yields a pair.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const { publicKey, privateKey } = (await webcrypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicDer = await webcrypto.subtle.exportKey("spki", publicKey);
    const publicBase64 = Buffer.from(publicDer).toString("base64");
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicBase64}\n-----END PUBLIC KEY-----\n`;

    function signRaw(updateEligibilityJson: string) {
      return Effect.promise(async () => {
        const raw = await webcrypto.subtle.sign(
          "Ed25519",
          privateKey,
          new TextEncoder().encode(updateEligibilityJson),
        );

        return {
          updateEligibility: updateEligibilityJson,
          signature: Buffer.from(raw).toString("base64"),
        };
      });
    }

    return {
      publicKeyPem,
      signRaw,
      sign: (updateEligibility: UpdateEligibility) => signRaw(JSON.stringify(updateEligibility)),
    };
  });
}
