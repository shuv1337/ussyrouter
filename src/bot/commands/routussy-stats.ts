import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { ensureGuild } from "../../db/users";
import { getDb } from "../../db";

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export const data = new SlashCommandBuilder()
  .setName("routussy-stats")
  .setDescription("Show public server stats for Routussy")
  .addUserOption((opt) =>
    opt
      .setName("target")
      .setDescription("Optional user to show a public spend breakdown for")
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: "You need Administrator permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await ensureGuild(interaction.guildId);
  const db = getDb();
  const target = interaction.options.getUser("target");

  if (target) {
    const user = await db
      .selectFrom("users")
      .selectAll()
      .where("guild_id", "=", interaction.guildId)
      .where("discord_id", "=", target.id)
      .executeTakeFirst();

    if (!user) {
      await interaction.editReply({
        content: "That user does not have a Routussy account in this server yet.",
      });
      return;
    }

    const usageStats = await db
      .selectFrom("usage_log")
      .select([
        (eb) => eb.fn.count<number>("id").as("request_count"),
        (eb) => eb.fn.sum<number>("input_tokens").as("input_tokens"),
        (eb) => eb.fn.sum<number>("output_tokens").as("output_tokens"),
        (eb) => eb.fn.sum<number>("cost_cents").as("cost_cents"),
      ])
      .where("user_id", "=", user.id)
      .executeTakeFirst();

    const modelStats = await db
      .selectFrom("usage_log")
      .select([
        "model",
        (eb) => eb.fn.count<number>("id").as("request_count"),
        (eb) => eb.fn.sum<number>("input_tokens").as("input_tokens"),
        (eb) => eb.fn.sum<number>("output_tokens").as("output_tokens"),
        (eb) => eb.fn.sum<number>("cost_cents").as("cost_cents"),
      ])
      .where("user_id", "=", user.id)
      .groupBy("model")
      .orderBy("request_count", "desc")
      .limit(8)
      .execute();

    const keyStats = await db
      .selectFrom("api_keys")
      .select([
        (eb) => eb.fn.count<number>("id").as("key_count"),
        (eb) => eb.fn.sum<number>(eb.case().when("active", "=", 1).then(1).else(0).end()).as("active_key_count"),
      ])
      .where("user_id", "=", user.id)
      .where("hidden", "=", 0)
      .executeTakeFirst();

    const embed = new EmbedBuilder()
      .setTitle(`Routussy Stats: ${target.displayName}`)
      .setColor(0x5865f2)
      .setDescription(user.approved ? "Approved user" : "Pending approval")
      .addFields(
        {
          name: "Budget",
          value: `Allocated ${formatUsd(user.budget_cents)}\nSpent ${formatUsd(user.spent_cents)}\nRemaining ${formatUsd(Math.max(0, user.budget_cents - user.spent_cents))}`,
          inline: true,
        },
        {
          name: "Keys",
          value: `Active ${keyStats?.active_key_count ?? 0}\nTotal ${keyStats?.key_count ?? 0}`,
          inline: true,
        },
        {
          name: "Tokens",
          value: `In ${formatNumber(Number(usageStats?.input_tokens ?? 0))}\nOut ${formatNumber(Number(usageStats?.output_tokens ?? 0))}`,
          inline: true,
        },
        {
          name: "LLM Calls",
          value: `${usageStats?.request_count ?? 0} completed requests`,
          inline: true,
        }
      )
      .setTimestamp();

    if (modelStats.length > 0) {
      embed.addFields({
        name: "Top Models",
        value: modelStats
          .map(
            (item, index) =>
              `${index + 1}. \`${item.model}\` - ${item.request_count} reqs - ${formatUsd(Number(item.cost_cents ?? 0))}`
          )
          .join("\n"),
      });
    }

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const userStats = await db
    .selectFrom("users")
    .select([
      (eb) => eb.fn.count<number>("id").as("user_count"),
      (eb) => eb.fn.sum<number>("budget_cents").as("total_budget"),
      (eb) => eb.fn.sum<number>("spent_cents").as("total_spent"),
      (eb) => eb.fn.sum<number>(eb.case().when("approved", "=", 1).then(1).else(0).end()).as("approved_count"),
    ])
    .where("guild_id", "=", interaction.guildId)
    .executeTakeFirst();

  const keyStats = await db
    .selectFrom("api_keys")
    .innerJoin("users", "users.id", "api_keys.user_id")
    .select([
      (eb) => eb.fn.count<number>("api_keys.id").as("key_count"),
      (eb) => eb.fn.sum<number>(eb.case().when("api_keys.active", "=", 1).then(1).else(0).end()).as("active_key_count"),
    ])
    .where("users.guild_id", "=", interaction.guildId)
    .where("api_keys.hidden", "=", 0)
    .executeTakeFirst();

  const requestStats = await db
    .selectFrom("key_requests")
    .select([
      (eb) => eb.fn.count<number>("id").as("request_count"),
      (eb) => eb.fn.sum<number>(eb.case().when("status", "=", "pending").then(1).else(0).end()).as("pending_count"),
    ])
    .where("guild_id", "=", interaction.guildId)
    .executeTakeFirst();

  const usageStats = await db
    .selectFrom("usage_log")
    .innerJoin("users", "users.id", "usage_log.user_id")
    .select([
      (eb) => eb.fn.count<number>("usage_log.id").as("request_count"),
      (eb) => eb.fn.sum<number>("usage_log.input_tokens").as("input_tokens"),
      (eb) => eb.fn.sum<number>("usage_log.output_tokens").as("output_tokens"),
      (eb) => eb.fn.sum<number>("usage_log.cost_cents").as("cost_cents"),
    ])
    .where("users.guild_id", "=", interaction.guildId)
    .executeTakeFirst();

  const modelStats = await db
    .selectFrom("usage_log")
    .innerJoin("users", "users.id", "usage_log.user_id")
    .select([
      "usage_log.model as model",
      (eb) => eb.fn.count<number>("usage_log.id").as("request_count"),
      (eb) => eb.fn.sum<number>("usage_log.input_tokens").as("input_tokens"),
      (eb) => eb.fn.sum<number>("usage_log.output_tokens").as("output_tokens"),
      (eb) => eb.fn.sum<number>("usage_log.cost_cents").as("cost_cents"),
    ])
    .where("users.guild_id", "=", interaction.guildId)
    .groupBy("usage_log.model")
    .orderBy("request_count", "desc")
    .limit(8)
    .execute();

  const topUsers = await db
    .selectFrom("users")
    .select(["discord_id", "budget_cents", "spent_cents"])
    .where("guild_id", "=", interaction.guildId)
    .orderBy("spent_cents", "desc")
    .limit(8)
    .execute();

  const totalBudget = Number(userStats?.total_budget ?? 0);
  const totalSpent = Number(userStats?.total_spent ?? 0);
  const totalInput = Number(usageStats?.input_tokens ?? 0);
  const totalOutput = Number(usageStats?.output_tokens ?? 0);
  const guild = await db
    .selectFrom("guilds")
    .select(["global_budget_cents", "spent_cents"])
    .where("id", "=", interaction.guildId)
    .executeTakeFirst();
  const serverBudgetLabel =
    guild?.global_budget_cents === null || guild?.global_budget_cents === undefined
      ? "Unlimited"
      : `${formatUsd(guild.global_budget_cents)} total`;
  const serverRemainingLabel =
    guild?.global_budget_cents === null || guild?.global_budget_cents === undefined
      ? "Unlimited"
      : formatUsd(Math.max(0, guild.global_budget_cents - guild.spent_cents));

  const embed = new EmbedBuilder()
    .setTitle("Routussy Stats")
    .setColor(0x57f287)
    .setDescription("Public server health for the shared proxy.")
    .addFields(
      {
        name: "Users 👥",
        value: `${userStats?.approved_count ?? 0} approved / ${userStats?.user_count ?? 0} total`,
        inline: true,
      },
      {
        name: "Budget 💸",
        value: `${formatUsd(totalSpent)} spent / ${formatUsd(totalBudget)} allocated`,
        inline: true,
      },
      {
        name: "Server Cap 🌍",
        value: `${formatUsd(guild?.spent_cents ?? 0)} spent / ${serverBudgetLabel}\nRemaining ${serverRemainingLabel}`,
        inline: true,
      },
      {
        name: "Requests 📬",
        value: `${requestStats?.pending_count ?? 0} pending approvals / ${requestStats?.request_count ?? 0} total access requests`,
        inline: true,
      },
      {
        name: "Keys 🔑",
        value: `${keyStats?.active_key_count ?? 0} active / ${keyStats?.key_count ?? 0} total`,
        inline: true,
      },
      {
        name: "Tokens 🧠",
        value: `${formatNumber(totalInput)} in / ${formatNumber(totalOutput)} out`,
        inline: true,
      },
      {
        name: "LLM Calls ⚡",
        value: `${usageStats?.request_count ?? 0} completed requests`,
        inline: true,
      }
    )
    .setTimestamp();

  if (modelStats.length > 0) {
    embed.addFields({
      name: "Top Models 📊",
      value: modelStats
        .map(
          (item, index) =>
            `${index + 1}. \`${item.model}\` - ${item.request_count} reqs - ${formatNumber(Number(item.input_tokens ?? 0) + Number(item.output_tokens ?? 0))} tok - ${formatUsd(Number(item.cost_cents ?? 0))}`
        )
        .join("\n"),
    });
  }

  if (topUsers.length > 0) {
    embed.addFields({
      name: "Top Users By Spend 🏆",
      value: topUsers
        .map(
          (user, index) =>
            `${index + 1}. <@${user.discord_id}> - ${formatUsd(user.spent_cents)} / ${formatUsd(user.budget_cents)}`
        )
        .join("\n"),
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
