import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import {
  ensureGuild,
  ensureUser,
  setUserBudget,
  setGuildDefaultBudget,
  setGuildGlobalBudget,
  getGuildBudgetUsage,
} from "../../db/users";

export const data = new SlashCommandBuilder()
  .setName("set-budget")
  .setDescription("Set budget for a user or guild default (admin only)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("user")
      .setDescription("Set a specific user's budget")
      .addUserOption((opt) =>
        opt.setName("target").setDescription("The user").setRequired(true)
      )
      .addNumberOption((opt) =>
        opt
          .setName("amount")
          .setDescription("Budget in USD")
          .setRequired(true)
          .setMinValue(0)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("default")
      .setDescription("Set the default budget for new users in this server")
      .addNumberOption((opt) =>
        opt
          .setName("amount")
          .setDescription("Default budget in USD")
          .setRequired(true)
          .setMinValue(0)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("global")
      .setDescription("Set the total API budget available to this server")
      .addNumberOption((opt) =>
        opt
          .setName("amount")
          .setDescription("Server-wide budget in USD")
          .setRequired(true)
          .setMinValue(0)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("global-clear")
      .setDescription("Remove the server-wide API budget cap")
  )
  .addSubcommand((sub) =>
    sub
      .setName("global-view")
      .setDescription("View the server-wide API budget usage")
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await ensureGuild(interaction.guildId);
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "user") {
    const target = interaction.options.getUser("target", true);
    const amount = interaction.options.getNumber("amount", true);
    const cents = Math.round(amount * 100);

    const userId = await ensureUser(target.id, interaction.guildId);
    await setUserBudget(userId, cents);

    await interaction.editReply({
      content: `Budget for <@${target.id}> set to **$${amount.toFixed(2)}**.`,
    });
  } else if (subcommand === "default") {
    const amount = interaction.options.getNumber("amount", true);
    const cents = Math.round(amount * 100);

    await setGuildDefaultBudget(interaction.guildId, cents);

    await interaction.editReply({
      content: `Default budget for new users set to **$${amount.toFixed(2)}**.`,
    });
  } else if (subcommand === "global") {
    const amount = interaction.options.getNumber("amount", true);
    const cents = Math.round(amount * 100);
    await setGuildGlobalBudget(interaction.guildId, cents);
    const usage = await getGuildBudgetUsage(interaction.guildId);

    await interaction.editReply({
      content:
        `Server API budget set to **$${amount.toFixed(2)}**. ` +
        `Spent: **$${(usage.spentCents / 100).toFixed(2)}**. ` +
        `Remaining: **$${((usage.remainingCents ?? 0) / 100).toFixed(2)}**.`,
    });
  } else if (subcommand === "global-clear") {
    await setGuildGlobalBudget(interaction.guildId, null);
    const usage = await getGuildBudgetUsage(interaction.guildId);

    await interaction.editReply({
      content:
        `Server API budget cap cleared. ` +
        `Spent so far: **$${(usage.spentCents / 100).toFixed(2)}**.`,
    });
  } else if (subcommand === "global-view") {
    const usage = await getGuildBudgetUsage(interaction.guildId);
    const budgetLabel =
      usage.budgetCents === null
        ? "Unlimited"
        : `$${(usage.budgetCents / 100).toFixed(2)}`;
    const remainingLabel =
      usage.remainingCents === null
        ? "Unlimited"
        : `$${(usage.remainingCents / 100).toFixed(2)}`;

    await interaction.editReply({
      content:
        `Server API budget: **${budgetLabel}**\n` +
        `Spent: **$${(usage.spentCents / 100).toFixed(2)}**\n` +
        `Remaining: **${remainingLabel}**`,
    });
  }
}
