import { getDb } from ".";

export async function createUssycodeRequest(
  userId: string,
  guildId: string,
  discordUserId: string,
  sshPubkey: string
): Promise<number> {
  const db = getDb();
  const result = await db
    .insertInto("ussycode_requests")
    .values({
      user_id: userId,
      guild_id: guildId,
      discord_user_id: discordUserId,
      ssh_pubkey: sshPubkey,
      status: "pending",
      created_at: new Date().toISOString(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return result.id;
}

export async function getUssycodeRequest(requestId: number) {
  const db = getDb();
  return db
    .selectFrom("ussycode_requests")
    .selectAll()
    .where("id", "=", requestId)
    .executeTakeFirst();
}

export async function resolveUssycodeRequest(
  requestId: number,
  status: "approved" | "denied",
  reviewedBy: string,
  apiKeyId?: number | null
): Promise<void> {
  const db = getDb();
  await db
    .updateTable("ussycode_requests")
    .set({
      status,
      reviewed_by: reviewedBy,
      api_key_id: apiKeyId ?? null,
      resolved_at: new Date().toISOString(),
    })
    .where("id", "=", requestId)
    .execute();
}

export async function updateUssycodeRequestMessage(
  requestId: number,
  messageId: string,
  channelId: string
): Promise<void> {
  const db = getDb();
  await db
    .updateTable("ussycode_requests")
    .set({ message_id: messageId, channel_id: channelId })
    .where("id", "=", requestId)
    .execute();
}

export async function isUssycodeApproved(userId: string): Promise<boolean> {
  const db = getDb();
  const row = await db
    .selectFrom("ussycode_requests")
    .select("id")
    .where("user_id", "=", userId)
    .where("status", "=", "approved")
    .executeTakeFirst();
  return !!row;
}

export async function listUserUssycodeRequests(userId: string, limit = 5) {
  const db = getDb();
  return db
    .selectFrom("ussycode_requests")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute();
}

// ── SSH Key management ─────────────────────────────────────────────

export async function addUssycodeSshKey(
  userId: string,
  discordUserId: string,
  sshPubkey: string,
  fingerprint: string,
  label: string
): Promise<number> {
  const db = getDb();
  const result = await db
    .insertInto("ussycode_ssh_keys")
    .values({
      user_id: userId,
      discord_user_id: discordUserId,
      ssh_pubkey: sshPubkey,
      fingerprint,
      label,
      active: 1,
      created_at: new Date().toISOString(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return result.id;
}

export async function removeUssycodeSshKey(
  keyId: number,
  userId: string
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .updateTable("ussycode_ssh_keys")
    .set({ active: 0 })
    .where("id", "=", keyId)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  return (result.numUpdatedRows ?? 0n) > 0n;
}

export async function listUssycodeSshKeys(userId: string) {
  const db = getDb();
  return db
    .selectFrom("ussycode_ssh_keys")
    .selectAll()
    .where("user_id", "=", userId)
    .where("active", "=", 1)
    .orderBy("created_at", "desc")
    .execute();
}

/** Returns ALL active ussycode SSH keys across all users (for the authorized_keys API). */
export async function listAllActiveUssycodeSshKeys() {
  const db = getDb();
  return db
    .selectFrom("ussycode_ssh_keys")
    .innerJoin("users", "users.id", "ussycode_ssh_keys.user_id")
    .innerJoin("api_keys", (join) =>
      join
        .onRef("api_keys.user_id", "=", "users.id")
        .on("api_keys.name", "=", "ussycode-system")
        .on("api_keys.hidden", "=", 1)
        .on("api_keys.active", "=", 1)
    )
    .select([
      "ussycode_ssh_keys.ssh_pubkey",
      "ussycode_ssh_keys.fingerprint",
      "ussycode_ssh_keys.discord_user_id",
      "users.id as user_id",
    ])
    .where("ussycode_ssh_keys.active", "=", 1)
    .execute();
}

/** Look up a user by SSH fingerprint and return their routussy API key. */
export async function getUssycodeUserByFingerprint(fingerprint: string) {
  const db = getDb();
  return db
    .selectFrom("ussycode_ssh_keys")
    .innerJoin("users", "users.id", "ussycode_ssh_keys.user_id")
    .innerJoin("api_keys", (join) =>
      join
        .onRef("api_keys.user_id", "=", "users.id")
        .on("api_keys.name", "=", "ussycode-system")
        .on("api_keys.hidden", "=", 1)
        .on("api_keys.active", "=", 1)
    )
    .select([
      "users.id as user_id",
      "users.discord_id",
      "users.budget_cents",
      "users.spent_cents",
      "ussycode_ssh_keys.ssh_pubkey",
      "api_keys.key_prefix",
    ])
    .where("ussycode_ssh_keys.fingerprint", "=", fingerprint)
    .where("ussycode_ssh_keys.active", "=", 1)
    .executeTakeFirst();
}
