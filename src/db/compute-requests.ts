import { getDb } from ".";

export type ComputeRequestStatus = "pending" | "approved" | "denied";

export async function createComputeRequest(
  userId: string,
  guildId: string,
  discordUserId: string,
  requestedTrustLevel: string,
  reason: string
): Promise<number> {
  const db = getDb();
  const result = await db
    .insertInto("compute_requests")
    .values({
      user_id: userId,
      guild_id: guildId,
      discord_user_id: discordUserId,
      requested_trust_level: requestedTrustLevel,
      reason,
      status: "pending",
      created_at: new Date().toISOString(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return result.id;
}

export async function getComputeRequest(requestId: number) {
  const db = getDb();
  return db
    .selectFrom("compute_requests")
    .selectAll()
    .where("id", "=", requestId)
    .executeTakeFirst();
}

export async function listUserComputeRequests(userId: string, limit = 5) {
  const db = getDb();
  return db
    .selectFrom("compute_requests")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute();
}

export async function resolveComputeRequest(
  requestId: number,
  status: ComputeRequestStatus,
  reviewedBy: string,
  approvedTrustLevel?: string | null
): Promise<void> {
  const db = getDb();
  await db
    .updateTable("compute_requests")
    .set({
      status,
      approved_trust_level: approvedTrustLevel ?? null,
      reviewed_by: reviewedBy,
      resolved_at: new Date().toISOString(),
    })
    .where("id", "=", requestId)
    .execute();
}

export async function updateComputeRequestMessage(
  requestId: number,
  messageId: string,
  channelId: string
): Promise<void> {
  const db = getDb();
  await db
    .updateTable("compute_requests")
    .set({ message_id: messageId, channel_id: channelId })
    .where("id", "=", requestId)
    .execute();
}
