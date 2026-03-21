import { getDb } from "./index";

/**
 * Create a new mail inbox for a Discord user.
 * Returns the new inbox ID, or null if the address is already taken.
 */
export async function createInbox(
  discordId: string,
  address: string
): Promise<number | null> {
  const db = getDb();

  // Check if address already exists (active or not — addresses are globally unique)
  const existing = await db
    .selectFrom("mail_inboxes")
    .select("id")
    .where("address", "=", address.toLowerCase())
    .executeTakeFirst();

  if (existing) return null;

  const result = await db
    .insertInto("mail_inboxes")
    .values({
      discord_id: discordId,
      address: address.toLowerCase(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return result.id;
}

/**
 * List active inboxes for a Discord user.
 */
export async function listInboxes(discordId: string) {
  const db = getDb();
  return db
    .selectFrom("mail_inboxes")
    .selectAll()
    .where("discord_id", "=", discordId)
    .where("active", "=", 1)
    .orderBy("created_at", "asc")
    .execute();
}

/**
 * Count active inboxes for a Discord user.
 */
export async function countActiveInboxes(discordId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .selectFrom("mail_inboxes")
    .select(db.fn.countAll<number>().as("count"))
    .where("discord_id", "=", discordId)
    .where("active", "=", 1)
    .executeTakeFirstOrThrow();
  return result.count;
}

/**
 * Get the max_inboxes limit for a user. Uses the highest value among their inboxes,
 * or the default of 3 if they have none.
 */
export async function getMaxInboxes(discordId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .selectFrom("mail_inboxes")
    .select(db.fn.max("max_inboxes").as("max"))
    .where("discord_id", "=", discordId)
    .executeTakeFirst();
  return result?.max ?? 3;
}

/**
 * Deactivate (soft-delete) an inbox by address for a specific Discord user.
 * Returns true if the inbox was found and deactivated.
 */
export async function deleteInbox(
  discordId: string,
  address: string
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .updateTable("mail_inboxes")
    .set({ active: 0 })
    .where("discord_id", "=", discordId)
    .where("address", "=", address.toLowerCase())
    .where("active", "=", 1)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

/**
 * Look up an active inbox by its address (local part).
 * Returns the inbox row or undefined if not found/inactive.
 */
export async function getInboxByAddress(address: string) {
  const db = getDb();
  return db
    .selectFrom("mail_inboxes")
    .selectAll()
    .where("address", "=", address.toLowerCase())
    .where("active", "=", 1)
    .executeTakeFirst();
}

/**
 * Store a received email message.
 */
export async function storeMessage(msg: {
  inboxId: number;
  fromAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  rawHeaders: string | null;
}): Promise<number> {
  const db = getDb();
  const result = await db
    .insertInto("mail_messages")
    .values({
      inbox_id: msg.inboxId,
      from_address: msg.fromAddress,
      subject: msg.subject,
      body_text: msg.bodyText,
      body_html: msg.bodyHtml,
      raw_headers: msg.rawHeaders,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return result.id;
}

/**
 * List recent messages for an inbox.
 */
export async function listMessages(inboxId: number, limit = 10) {
  const db = getDb();
  return db
    .selectFrom("mail_messages")
    .selectAll()
    .where("inbox_id", "=", inboxId)
    .orderBy("received_at", "desc")
    .limit(limit)
    .execute();
}
