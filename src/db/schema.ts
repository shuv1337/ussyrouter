import type { Generated, ColumnType } from "kysely";

export interface Database {
  guilds: GuildsTable;
  users: UsersTable;
  api_keys: ApiKeysTable;
  key_requests: KeyRequestsTable;
  usage_log: UsageLogTable;
  model_limits: ModelLimitsTable;
}

export interface GuildsTable {
  id: string; // discord guild id
  default_budget_cents: number; // default budget for new users in cents
  global_budget_cents: number | null; // optional server-wide spend cap in cents
  spent_cents: number; // total spent by the guild in cents
  created_at: Generated<string>;
}

export interface UsersTable {
  id: string; // visored snowflake
  discord_id: string;
  guild_id: string;
  approved: number;
  budget_cents: number; // total budget allocated in cents
  spent_cents: number; // total spent in cents
  created_at: Generated<string>;
}

export interface ApiKeysTable {
  id: Generated<number>;
  key_hash: string; // sha256 of the key, for lookup
  key_prefix: string; // first 8 chars for display
  user_id: string;
  name: string;
  hidden: Generated<number>; // 1 = internal/system key, 0 = user-visible key
  spend_limit_cents: number | null; // per-key spend cap, null = use full user budget
  spent_cents: number; // spent on this key specifically
  active: Generated<number>; // 1 = active, 0 = revoked
  created_at: Generated<string>;
}

export interface KeyRequestsTable {
  id: Generated<number>;
  user_id: string;
  guild_id: string;
  discord_user_id: string;
  requested_budget_cents: number;
  approved_budget_cents: number | null;
  status: Generated<string>; // 'pending' | 'approved' | 'denied'
  reviewed_by: string | null; // admin discord id
  message_id: string | null; // discord message id for the embed
  channel_id: string | null;
  created_at: Generated<string>;
  resolved_at: string | null;
}

export interface UsageLogTable {
  id: Generated<number>;
  key_id: number;
  user_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number; // calculated cost in cents
  endpoint: string; // 'completions' | 'responses'
  created_at: Generated<string>;
}

export interface ModelLimitsTable {
  model_id: string;
  display_name: string;
  concurrency_limit: number;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}
