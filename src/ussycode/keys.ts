/**
 * Ussycode API key helpers.
 *
 * Each ussycode-approved user gets a hidden "ussycode-system" API key
 * that is automatically injected into their VMs for OpenCode to use.
 */

import { getDb } from "../db";
import { createKey } from "../keys";

const USSYCODE_KEY_NAME = "ussycode-system";

export interface UssycodeApiKey {
  id: number;
  prefix: string;
  rawKey?: string; // only present when newly created
}

/**
 * Get or create the ussycode-system hidden API key for a user.
 * Returns the key ID and prefix. The raw key is only returned on first creation.
 */
export async function getOrCreateUssycodeKey(
  userId: string
): Promise<UssycodeApiKey> {
  const db = getDb();
  const existing = await db
    .selectFrom("api_keys")
    .select(["id", "key_prefix"])
    .where("user_id", "=", userId)
    .where("name", "=", USSYCODE_KEY_NAME)
    .where("hidden", "=", 1)
    .where("active", "=", 1)
    .executeTakeFirst();

  if (existing) {
    return { id: existing.id, prefix: existing.key_prefix };
  }

  const created = await createKey(userId, USSYCODE_KEY_NAME, null, true);
  return { id: created.id, prefix: created.prefix, rawKey: created.rawKey };
}

/**
 * Get the existing ussycode-system key info (without creating one).
 * Used by /ussycode-config to display info without side effects.
 */
export async function getUssycodeApiKey(
  userId: string
): Promise<{ id: number; prefix: string } | null> {
  const db = getDb();
  const existing = await db
    .selectFrom("api_keys")
    .select(["id", "key_prefix"])
    .where("user_id", "=", userId)
    .where("name", "=", USSYCODE_KEY_NAME)
    .where("hidden", "=", 1)
    .where("active", "=", 1)
    .executeTakeFirst();

  if (!existing) return null;
  return { id: existing.id, prefix: existing.key_prefix };
}
