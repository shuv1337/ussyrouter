import { nanoid } from "nanoid";
import { getDb } from ".";

export async function ensureGuild(
  guildId: string,
  defaultBudgetCents = 0
): Promise<void> {
  const db = getDb();
  await db
    .insertInto("guilds")
    .values({
      id: guildId,
      default_budget_cents: defaultBudgetCents,
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}

export async function getGuild(guildId: string) {
  const db = getDb();
  return db
    .selectFrom("guilds")
    .selectAll()
    .where("id", "=", guildId)
    .executeTakeFirst();
}

export async function setGuildDefaultBudget(
  guildId: string,
  cents: number
): Promise<void> {
  const db = getDb();
  await db
    .updateTable("guilds")
    .set({ default_budget_cents: cents })
    .where("id", "=", guildId)
    .execute();
}

export async function ensureUser(
  discordId: string,
  guildId: string
): Promise<string> {
  const db = getDb();
  const id = nanoid(16);
  const guild = await getGuild(guildId);
  const defaultBudgetCents = guild?.default_budget_cents ?? 0;
  const approved = defaultBudgetCents > 0 ? 1 : 0;

  await db
    .insertInto("users")
    .values({
      id,
      discord_id: discordId,
      guild_id: guildId,
      approved,
      budget_cents: defaultBudgetCents,
      spent_cents: 0,
    })
    .onConflict((oc) =>
      oc.columns(["discord_id", "guild_id"]).doNothing()
    )
    .execute();

  // fetch the actual id (either newly inserted or existing)
  const user = await db
    .selectFrom("users")
    .select("id")
    .where("discord_id", "=", discordId)
    .where("guild_id", "=", guildId)
    .executeTakeFirstOrThrow();

  return user.id;
}

export async function getUser(userId: string) {
  const db = getDb();
  return db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", userId)
    .executeTakeFirst();
}

export async function getUserByDiscord(discordId: string, guildId: string) {
  const db = getDb();
  return db
    .selectFrom("users")
    .selectAll()
    .where("discord_id", "=", discordId)
    .where("guild_id", "=", guildId)
    .executeTakeFirst();
}

export async function setUserBudget(
  userId: string,
  budgetCents: number
): Promise<void> {
  const db = getDb();
  await db
    .updateTable("users")
    .set({ budget_cents: budgetCents, approved: 1 })
    .where("id", "=", userId)
    .execute();
}

export async function isUserApproved(userId: string): Promise<boolean> {
  const user = await getUser(userId);
  return user?.approved === 1;
}

export async function listUserKeyRequests(userId: string, limit = 5) {
  const db = getDb();
  return db
    .selectFrom("key_requests")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute();
}

export async function createKeyRequest(
  userId: string,
  guildId: string,
  discordUserId: string,
  requestedBudgetCents: number
): Promise<number> {
  const db = getDb();
  const result = await db
    .insertInto("key_requests")
    .values({
      user_id: userId,
      guild_id: guildId,
      discord_user_id: discordUserId,
      requested_budget_cents: requestedBudgetCents,
      status: "pending",
      created_at: new Date().toISOString(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return result.id;
}

export async function getKeyRequest(requestId: number) {
  const db = getDb();
  return db
    .selectFrom("key_requests")
    .selectAll()
    .where("id", "=", requestId)
    .executeTakeFirst();
}

export async function resolveKeyRequest(
  requestId: number,
  status: "approved" | "denied",
  reviewedBy: string
): Promise<void> {
  const db = getDb();
  await db
    .updateTable("key_requests")
    .set({
      status,
      reviewed_by: reviewedBy,
      resolved_at: new Date().toISOString(),
    })
    .where("id", "=", requestId)
    .execute();
}

export async function updateKeyRequestMessage(
  requestId: number,
  messageId: string,
  channelId: string
): Promise<void> {
  const db = getDb();
  await db
    .updateTable("key_requests")
    .set({ message_id: messageId, channel_id: channelId })
    .where("id", "=", requestId)
    .execute();
}
