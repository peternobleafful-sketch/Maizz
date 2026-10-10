import { randomBytes } from "node:crypto";

/** A fresh, unguessable gift reference such as mz_3f9a... (28 characters). */
export function newGiftReference(prefix = "mz"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}
