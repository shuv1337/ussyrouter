/**
 * Fingerprint-based authentication for ussycode VMs.
 *
 * Instead of using a traditional API key, ussycode VMs authenticate to
 * the routussy proxy using their SSH fingerprint. The fingerprint is
 * looked up in the ussycode_ssh_keys table to find the associated user
 * and their ussycode-system API key.
 */

import type { ResolvedKey } from "../keys";
import { getDb } from "../db";

/**
 * Resolve a user's ussycode-system API key by their SSH fingerprint.
 * Returns the same ResolvedKey shape as resolveKey() for compatibility
 * with the proxy auth flow.
 */
export async function resolveKeyByFingerprint(
  fingerprint: string
): Promise<ResolvedKey | null> {
  const db = getDb();

  const result = await db
    .selectFrom("ussycode_ssh_keys")
    .innerJoin("users", "users.id", "ussycode_ssh_keys.user_id")
    .innerJoin("api_keys", (join) =>
      join
        .onRef("api_keys.user_id", "=", "users.id")
        .on("api_keys.name", "=", "ussycode-system")
        .on("api_keys.hidden", "=", 1)
    )
    .select([
      "api_keys.id",
      "api_keys.user_id as userId",
      "api_keys.name",
      "api_keys.active",
    ])
    .where("ussycode_ssh_keys.fingerprint", "=", fingerprint)
    .where("ussycode_ssh_keys.active", "=", 1)
    .executeTakeFirst();

  if (!result) return null;

  return {
    id: result.id,
    userId: result.userId,
    name: result.name,
    active: result.active === 1,
  };
}
