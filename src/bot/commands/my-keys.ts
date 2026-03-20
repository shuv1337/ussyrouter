import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import {
  ensureUser,
  ensureGuild,
  isUserApproved,
  listUserKeyRequests,
} from "../../db/users";
import { listUserKeys } from "../../keys";
import { AbsoluteQuotaAdapter } from "../../quota";

const quota = new AbsoluteQuotaAdapter();

export const data = new SlashCommandBuilder()
  .setName("my-keys")
  .setDescription("View your API keys and usage");

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await ensureGuild(interaction.guildId);
  const userId = await ensureUser(interaction.user.id, interaction.guildId);
  const keys = await listUserKeys(userId);
  const userUsage = await quota.getUserUsage(userId);
  const approved = await isUserApproved(userId);
  const recentRequests = await listUserKeyRequests(userId, 3);

  const embed = new EmbedBuilder()
    .setTitle("Your API Keys")
    .setColor(0x5865f2)
    .addFields({
      name: "Account Budget",
      value: `$${(userUsage.budgetCents / 100).toFixed(2)} total | $${(userUsage.spentCents / 100).toFixed(2)} spent | $${(userUsage.remainingCents / 100).toFixed(2)} remaining`,
    });

  if (!approved) {
    embed.setDescription(
      "You are not approved yet. An admin must approve you by setting your budget before you can create API keys."
    );

    if (recentRequests.length > 0) {
      embed.addFields({
        name: "Recent Requests",
        value: recentRequests
          .map(
            (request) =>
              `#${request.id}: $${(request.requested_budget_cents / 100).toFixed(2)} - ${request.status}`
          )
          .join("\n"),
      });
    }

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (keys.length === 0) {
    embed.setDescription(
      "You have no API keys yet. Use the button below to create your first key."
    );
  } else {
    for (const key of keys) {
      const status = key.active ? "Active" : "Revoked";
      const limit =
        key.spend_limit_cents !== null
          ? `$${(key.spend_limit_cents / 100).toFixed(2)}`
          : "No limit";
      const spent = `$${(key.spent_cents / 100).toFixed(2)}`;

      embed.addFields({
        name: `${key.key_prefix}... - ${key.name}`,
        value: `Status: ${status} | Spent: ${spent} | Key Limit: ${limit}`,
      });
    }
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("create_key_modal")
      .setLabel(keys.length > 0 ? "Create New Key" : "Create First Key")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("manage_keys_menu")
      .setLabel("Manage Keys")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(keys.length === 0)
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}
