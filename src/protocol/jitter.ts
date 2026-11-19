const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): number {
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
}

/** The reference algorithm every SDK's own jitter implementation must match
 * exactly. An independent copy on purpose, the same reasoning as
 * `wireContract.ts`: importing the thing being checked couldn't catch drift in it. */
export function referenceJitterFraction(installationId: string): number {
  const hash = fnv1a(installationId);
  const sign = (hash & 1) === 0 ? 1 : -1;
  const magnitude = 0.1 + ((hash >>> 1) % 1000) / 1000 / 20; // 0.10..0.15

  return sign * magnitude;
}
