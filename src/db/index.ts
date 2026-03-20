import { Kysely, sql } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { Database as SqliteDB } from "bun:sqlite";
import type { Database } from "./schema";

let db: Kysely<Database> | null = null;

export function getDb(): Kysely<Database> {
  if (!db) {
    const path = process.env.DATABASE_PATH || "routussy.db";
    db = new Kysely<Database>({
      dialect: new BunSqliteDialect({
        database: new SqliteDB(path),
      }),
    });
  }
  return db;
}

const CURRENT_TIMESTAMP = sql`(datetime('now'))`;

export async function migrate() {
  const db = getDb();

  await db.schema
    .createTable("guilds")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("default_budget_cents", "integer", (col) =>
      col.notNull().defaultTo(0)
    )
    .addColumn("global_budget_cents", "integer")
    .addColumn("spent_cents", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .execute();

  try {
    await db.schema
      .alterTable("guilds")
      .addColumn("global_budget_cents", "integer")
      .execute();
  } catch (err) {
    if (!String(err).includes("duplicate column name")) {
      throw err;
    }
  }

  try {
    await db.schema
      .alterTable("guilds")
      .addColumn("spent_cents", "integer", (col) => col.notNull().defaultTo(0))
      .execute();
  } catch (err) {
    if (!String(err).includes("duplicate column name")) {
      throw err;
    }
  }

  await sql`
    UPDATE guilds
    SET spent_cents = COALESCE((
      SELECT SUM(users.spent_cents)
      FROM users
      WHERE users.guild_id = guilds.id
    ), 0)
  `.execute(db);

  await db.schema
    .createTable("users")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("discord_id", "text", (col) => col.notNull())
    .addColumn("guild_id", "text", (col) =>
      col.notNull().references("guilds.id")
    )
    .addColumn("approved", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("budget_cents", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("spent_cents", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .execute();

  try {
    await db.schema
      .alterTable("users")
      .addColumn("approved", "integer", (col) => col.notNull().defaultTo(0))
      .execute();
  } catch (err) {
    if (!String(err).includes("duplicate column name")) {
      throw err;
    }
  }

  await sql`
    UPDATE users
    SET approved = 1
    WHERE budget_cents > 0 AND approved = 0
  `.execute(db);

  await db.schema
    .createTable("api_keys")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("key_hash", "text", (col) => col.notNull().unique())
    .addColumn("key_prefix", "text", (col) => col.notNull())
    .addColumn("user_id", "text", (col) =>
      col.notNull().references("users.id")
    )
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("hidden", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("spend_limit_cents", "integer")
    .addColumn("spent_cents", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("active", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .execute();

  try {
    await db.schema
      .alterTable("api_keys")
      .addColumn("hidden", "integer", (col) => col.notNull().defaultTo(0))
      .execute();
  } catch (err) {
    if (!String(err).includes("duplicate column name")) {
      throw err;
    }
  }

  await db.schema
    .createTable("key_requests")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("user_id", "text", (col) =>
      col.notNull().references("users.id")
    )
    .addColumn("guild_id", "text", (col) =>
      col.notNull().references("guilds.id")
    )
    .addColumn("discord_user_id", "text", (col) => col.notNull())
    .addColumn("requested_budget_cents", "integer", (col) => col.notNull())
    .addColumn("approved_budget_cents", "integer")
    .addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
    .addColumn("reviewed_by", "text")
    .addColumn("message_id", "text")
    .addColumn("channel_id", "text")
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .addColumn("resolved_at", "text")
    .execute();

  try {
    await db.schema
      .alterTable("key_requests")
      .addColumn("approved_budget_cents", "integer")
      .execute();
  } catch (err) {
    if (!String(err).includes("duplicate column name")) {
      throw err;
    }
  }

  await sql`
    UPDATE key_requests
    SET approved_budget_cents = requested_budget_cents
    WHERE status = 'approved' AND approved_budget_cents IS NULL
  `.execute(db);

  await db.schema
    .createTable("usage_log")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("key_id", "integer", (col) =>
      col.notNull().references("api_keys.id")
    )
    .addColumn("user_id", "text", (col) =>
      col.notNull().references("users.id")
    )
    .addColumn("model", "text", (col) => col.notNull())
    .addColumn("input_tokens", "integer", (col) => col.notNull())
    .addColumn("output_tokens", "integer", (col) => col.notNull())
    .addColumn("cost_cents", "integer", (col) => col.notNull())
    .addColumn("endpoint", "text", (col) => col.notNull())
    .addColumn("idempotency_key", "text")
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .execute();

  try {
    await db.schema
      .alterTable("usage_log")
      .addColumn("idempotency_key", "text")
      .execute();
  } catch (err) {
    if (!String(err).includes("duplicate column name")) {
      throw err;
    }
  }

  await db.schema
    .createTable("model_limits")
    .ifNotExists()
    .addColumn("model_id", "text", (col) => col.primaryKey())
    .addColumn("display_name", "text", (col) => col.notNull())
    .addColumn("concurrency_limit", "integer", (col) => col.notNull())
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .addColumn("updated_at", "text", (col) =>
      col.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .execute();

  await db.schema
    .createIndex("idx_api_keys_hash")
    .ifNotExists()
    .on("api_keys")
    .column("key_hash")
    .execute();

  await db.schema
    .createIndex("idx_users_discord_guild")
    .ifNotExists()
    .on("users")
    .columns(["discord_id", "guild_id"])
    .unique()
    .execute();

  await db.schema
    .createIndex("idx_usage_log_key")
    .ifNotExists()
    .on("usage_log")
    .column("key_id")
    .execute();

  await db.schema
    .createIndex("idx_usage_log_user")
    .ifNotExists()
    .on("usage_log")
    .column("user_id")
    .execute();

  await db.schema
    .createIndex("idx_usage_log_idempotency")
    .ifNotExists()
    .on("usage_log")
    .column("idempotency_key")
    .execute();

  await db.schema
    .createIndex("idx_model_limits_display_name")
    .ifNotExists()
    .on("model_limits")
    .column("display_name")
    .execute();

  await db.schema
    .createTable("media_shares")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("user_discord_id", "text", (col) => col.notNull())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("description", "text")
    .addColumn("fields_json", "text")
    .addColumn("image_url", "text")
    .addColumn("file_url", "text")
    .addColumn("media_job_id", "text")
    .addColumn("filename", "text")
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .execute();

  try {
    await db.schema
      .alterTable("media_shares")
      .addColumn("media_job_id", "text")
      .execute();
  } catch (err) {
    if (!String(err).includes("duplicate column name")) {
      throw err;
    }
  }

  await db.schema
    .createTable("media_jobs")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("task_id", "text", (col) => col.notNull().unique())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("billed", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("user_id", "text", (col) => col.notNull().references("users.id"))
    .addColumn("discord_user_id", "text", (col) => col.notNull())
    .addColumn("guild_id", "text", (col) => col.notNull().references("guilds.id"))
    .addColumn("channel_id", "text", (col) => col.notNull())
    .addColumn("system_key_id", "integer", (col) => col.notNull().references("api_keys.id"))
    .addColumn("model", "text", (col) => col.notNull())
    .addColumn("prompt", "text")
    .addColumn("cost_cents", "integer", (col) => col.notNull())
    .addColumn("result_url", "text")
    .addColumn("cached_path", "text")
    .addColumn("cached_url", "text")
    .addColumn("cover_image_url", "text")
    .addColumn("error_message", "text")
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .addColumn("updated_at", "text", (col) =>
      col.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .execute();

  try {
    await db.schema
      .alterTable("media_jobs")
      .addColumn("cached_path", "text")
      .execute();
  } catch (err) {
    if (!String(err).includes("duplicate column name")) {
      throw err;
    }
  }

  try {
    await db.schema
      .alterTable("media_jobs")
      .addColumn("cached_url", "text")
      .execute();
  } catch (err) {
    if (!String(err).includes("duplicate column name")) {
      throw err;
    }
  }
}
