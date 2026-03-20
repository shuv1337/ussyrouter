import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { ensureGuild, ensureUser, getUserByDiscord } from "../../db/users";
import { getDb } from "../../db";
import type { QuotaUsage } from "../../quota";
import { AbsoluteQuotaAdapter } from "../../quota";

const quota = new AbsoluteQuotaAdapter();

function buildUsageEmbed(title: string, usage: QuotaUsage): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0x5865f2)
    .addFields(
      { name: "Budget", value: `$${(usage.budgetCents / 100).toFixed(2)}`, inline: true },
      { name: "Spent", value: `$${(usage.spentCents / 100).toFixed(2)}`, inline: true },
      { name: "Remaining", value: `$${(usage.remainingCents / 100).toFixed(2)}`, inline: true },
    );
}

export const data = new SlashCommandBuilder()
  .setName("usage")
  .setDescription("View usage stats")
  .addSubcommand((sub) =>
    sub.setName("me").setDescription("View your own usage")
  )
  .addSubcommand((sub) =>
    sub
      .setName("user")
      .setDescription("View a user's usage (admin only)")
      .addUserOption((opt) =>
        opt.setName("target").setDescription("The user").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("server").setDescription("View server-wide usage (admin only)")
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await ensureGuild(interaction.guildId);
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "me") {
    const userId = await ensureUser(interaction.user.id, interaction.guildId);
    const usage = await quota.getUserUsage(userId);

    const db = getDb();
    const modelBreakdown = await db
      .selectFrom("usage_log")
      .select([
        "model",
        (eb) => eb.fn.sum<number>("cost_cents").as("total_cost"),
        (eb) => eb.fn.count<number>("id").as("request_count"),
      ])
      .where("user_id", "=", userId)
      .groupBy("model")
      .orderBy("total_cost", "desc")
      .limit(10)
      .execute();

    const embed = buildUsageEmbed("Your Usage", usage);

    if (modelBreakdown.length > 0) {
      const lines = modelBreakdown.map(
        (m) =>
          `\`${m.model}\`: $${(Number(m.total_cost) / 100).toFixed(2)} (${m.request_count} reqs)`
      );
      embed.addFields({ name: "By Model", value: lines.join("\n") });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } else if (subcommand === "user") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: "You need Administrator permission to view other users.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = interaction.options.getUser("target", true);
    const user = await getUserByDiscord(target.id, interaction.guildId);

    if (!user) {
      await interaction.reply({
        content: "User has no account in this server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const usage = await quota.getUserUsage(user.id);
    const embed = buildUsageEmbed(`Usage for ${target.displayName}`, usage);

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } else if (subcommand === "server") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: "You need Administrator permission to view server stats.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const db = getDb();
    const stats = await db
      .selectFrom("users")
      .select([
        (eb) => eb.fn.sum<number>("budget_cents").as("total_budget"),
        (eb) => eb.fn.sum<number>("spent_cents").as("total_spent"),
        (eb) => eb.fn.count<number>("id").as("user_count"),
      ])
      .where("guild_id", "=", interaction.guildId)
      .executeTakeFirst();

    const keyCount = await db
      .selectFrom("api_keys")
      .innerJoin("users", "users.id", "api_keys.user_id")
      .select((eb) => eb.fn.count<number>("api_keys.id").as("count"))
      .where("users.guild_id", "=", interaction.guildId)
      .where("api_keys.active", "=", 1)
      .where("api_keys.hidden", "=", 0)
      .executeTakeFirst();

    const embed = new EmbedBuilder()
      .setTitle("Server Usage")
      .setColor(0x5865f2)
      .addFields(
        {
          name: "Total Budget Allocated",
          value: `$${(Number(stats?.total_budget ?? 0) / 100).toFixed(2)}`,
          inline: true,
        },
        {
          name: "Total Spent",
          value: `$${(Number(stats?.total_spent ?? 0) / 100).toFixed(2)}`,
          inline: true,
        },
        { name: "Users", value: `${stats?.user_count ?? 0}`, inline: true },
        { name: "Active Keys", value: `${keyCount?.count ?? 0}`, inline: true },
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}
