import { getDb } from ".";

export interface StoredSharePayload {
  id: string;
  user_discord_id: string;
  kind: string;
  title: string;
  description: string | null;
  fields_json: string | null;
  image_url: string | null;
  file_url: string | null;
  media_job_id?: string | null;
  filename: string | null;
  created_at?: string;
}

export async function saveMediaShare(payload: StoredSharePayload): Promise<void> {
  const db = getDb();
  await db
    .insertInto("media_shares")
    .values(payload)
    .execute();
}

export async function getMediaShare(id: string) {
  const db = getDb();
  return db
    .selectFrom("media_shares")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function deleteMediaShare(id: string): Promise<void> {
  const db = getDb();
  await db.deleteFrom("media_shares").where("id", "=", id).execute();
}

export interface MediaJobRow {
  id: string;
  task_id: string;
  kind: string;
  status: string;
  billed: number;
  user_id: string;
  discord_user_id: string;
  guild_id: string;
  channel_id: string;
  system_key_id: number;
  model: string;
  prompt: string | null;
  cost_cents: number;
  result_url: string | null;
  cached_path?: string | null;
  cached_url?: string | null;
  cover_image_url: string | null;
  error_message: string | null;
  alerted_at?: string | null;
  alerted_error?: string | null;
  created_at?: string;
  updated_at?: string;
}

export async function createMediaJob(job: MediaJobRow): Promise<void> {
  const db = getDb();
  await db.insertInto("media_jobs").values(job).execute();
}

export async function getMediaJobByTaskId(taskId: string) {
  const db = getDb();
  return db
    .selectFrom("media_jobs")
    .selectAll()
    .where("task_id", "=", taskId)
    .executeTakeFirst();
}

export async function getMediaJob(id: string) {
  const db = getDb();
  return db
    .selectFrom("media_jobs")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function listPendingMediaJobs() {
  const db = getDb();
  return db
    .selectFrom("media_jobs")
    .selectAll()
    .where("status", "in", ["queued", "processing"])
    .orderBy("created_at", "asc")
    .execute();
}

export async function listRecentMediaJobs(limit = 20) {
  const db = getDb();
  return db
    .selectFrom("media_jobs")
    .selectAll()
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute();
}

export async function updateMediaJob(
  taskId: string,
  fields: Partial<Omit<MediaJobRow, "id" | "task_id">>
): Promise<void> {
  const db = getDb();
  await db
    .updateTable("media_jobs")
    .set({
      ...fields,
      updated_at: new Date().toISOString(),
    })
    .where("task_id", "=", taskId)
    .execute();
}
