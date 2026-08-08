import { createHash } from "node:crypto";

/** Hashes exact bytes. Keep the full hash for correctness; shorten only for display. */
export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function shortHash(fullHash: string): string {
  return fullHash.slice(0, 8).toUpperCase();
}
