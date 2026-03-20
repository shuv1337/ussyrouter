import { getDb } from "../db";
import type { QuotaAdapter, QuotaCheck, QuotaUsage } from "./types";

// Absolute quota: user has a fixed budget, keys have optional spend limits
export class AbsoluteQuotaAdapter implements QuotaAdapter {
  async check(keyId: number, estimatedCostCents: number): Promise<QuotaCheck> {
    const db = getDb();

    const key = await db
      .selectFrom("api_keys")
      .innerJoin("users", "users.id", "api_keys.user_id")
      .innerJoin("guilds", "guilds.id", "users.guild_id")
      .select([
        "api_keys.spend_limit_cents",
        "api_keys.spent_cents as key_spent",
        "api_keys.active",
        "users.budget_cents",
        "users.spent_cents as user_spent",
        "users.guild_id",
        "guilds.global_budget_cents",
        "guilds.spent_cents as guild_spent",
      ])
      .where("api_keys.id", "=", keyId)
      .executeTakeFirst();

    if (!key) {
      return { allowed: false, remainingCents: 0, reason: "Key not found" };
    }

    if (!key.active) {
      return { allowed: false, remainingCents: 0, reason: "Key is revoked" };
    }

    if (key.global_budget_cents !== null) {
      const guildRemaining = key.global_budget_cents - key.guild_spent;
      if (guildRemaining < estimatedCostCents) {
        return {
          allowed: false,
          remainingCents: Math.max(0, guildRemaining),
          reason: "Server API budget exceeded",
        };
      }
    }

    // check user-level budget
    const userRemaining = key.budget_cents - key.user_spent;
    if (userRemaining < estimatedCostCents) {
      return {
        allowed: false,
        remainingCents: Math.max(0, userRemaining),
        reason: "User budget exceeded",
      };
    }

    // check key-level spend limit if set
    if (key.spend_limit_cents !== null) {
      const keyRemaining = key.spend_limit_cents - key.key_spent;
      if (keyRemaining < estimatedCostCents) {
        return {
          allowed: false,
          remainingCents: Math.max(0, keyRemaining),
          reason: "Key spend limit exceeded",
        };
      }
    }

    const remaining =
      key.spend_limit_cents !== null
        ? Math.min(userRemaining, key.spend_limit_cents - key.key_spent)
        : userRemaining;

    const effectiveRemaining =
      key.global_budget_cents !== null
        ? Math.min(remaining, key.global_budget_cents - key.guild_spent)
        : remaining;

    return { allowed: true, remainingCents: effectiveRemaining };
  }

  async record(
    keyId: number,
    userId: string,
    costCents: number,
    model: string,
    inputTokens: number,
    outputTokens: number,
    endpoint: string
  ): Promise<void> {
    const db = getDb();

    await db
      .insertInto("usage_log")
      .values({
        key_id: keyId,
        user_id: userId,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_cents: costCents,
        endpoint,
        created_at: new Date().toISOString(),
      })
      .execute();

    await db
      .updateTable("api_keys")
      .set((eb) => ({
        spent_cents: eb("spent_cents", "+", costCents),
      }))
      .where("id", "=", keyId)
      .execute();

    await db
      .updateTable("users")
      .set((eb) => ({
        spent_cents: eb("spent_cents", "+", costCents),
      }))
      .where("id", "=", userId)
      .execute();

    const user = await db
      .selectFrom("users")
      .select("guild_id")
      .where("id", "=", userId)
      .executeTakeFirst();

    if (user) {
      await db
        .updateTable("guilds")
        .set((eb) => ({
          spent_cents: eb("spent_cents", "+", costCents),
        }))
        .where("id", "=", user.guild_id)
        .execute();
    }
  }

  async getUserUsage(userId: string): Promise<QuotaUsage> {
    const db = getDb();
    const user = await db
      .selectFrom("users")
      .select(["budget_cents", "spent_cents"])
      .where("id", "=", userId)
      .executeTakeFirst();

    if (!user)
      return { budgetCents: 0, spentCents: 0, remainingCents: 0 };

    return {
      budgetCents: user.budget_cents,
      spentCents: user.spent_cents,
      remainingCents: Math.max(0, user.budget_cents - user.spent_cents),
    };
  }

  async getKeyUsage(keyId: number): Promise<QuotaUsage> {
    const db = getDb();
    const key = await db
      .selectFrom("api_keys")
      .innerJoin("users", "users.id", "api_keys.user_id")
      .select([
        "api_keys.spend_limit_cents",
        "api_keys.spent_cents as key_spent",
        "users.budget_cents",
        "users.spent_cents as user_spent",
      ])
      .where("api_keys.id", "=", keyId)
      .executeTakeFirst();

    if (!key)
      return { budgetCents: 0, spentCents: 0, remainingCents: 0 };

    // effective budget for this key: the key's own spend limit if set,
    // otherwise the user's total remaining budget + what this key already spent
    // (since user_spent includes this key's spend)
    const userRemaining = key.budget_cents - key.user_spent;

    if (key.spend_limit_cents !== null) {
      // key has its own cap - effective budget is the smaller of key cap or user remaining + key spent
      const effectiveBudget = Math.min(
        key.spend_limit_cents,
        userRemaining + key.key_spent
      );
      return {
        budgetCents: effectiveBudget,
        spentCents: key.key_spent,
        remainingCents: Math.max(0, effectiveBudget - key.key_spent),
      };
    }

    // no key limit - key is bounded only by user budget
    return {
      budgetCents: key.budget_cents,
      spentCents: key.key_spent,
      remainingCents: Math.max(0, userRemaining),
    };
  }

  async getGuildUsage(guildId: string): Promise<QuotaUsage> {
    const db = getDb();
    const guild = await db
      .selectFrom("guilds")
      .select(["global_budget_cents", "spent_cents"])
      .where("id", "=", guildId)
      .executeTakeFirst();

    if (!guild) {
      return { budgetCents: 0, spentCents: 0, remainingCents: 0 };
    }

    return {
      budgetCents: guild.global_budget_cents ?? 0,
      spentCents: guild.spent_cents,
      remainingCents:
        guild.global_budget_cents === null
          ? Number.MAX_SAFE_INTEGER
          : Math.max(0, guild.global_budget_cents - guild.spent_cents),
    };
  }
}
