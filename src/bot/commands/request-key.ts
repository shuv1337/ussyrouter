import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import {
  ensureUser,
  ensureGuild,
  getUser,
  createKeyRequest,
  updateKeyRequestMessage,
  isUserApproved,
} from "../../db/users";

const ADMIN_REVIEW_CHANNEL_ID = process.env.ADMIN_REVIEW_CHANNEL_ID?.trim() || null;
const ROUTUSSY_CHANNEL_ID = process.env.ROUTUSSY_CHANNEL_ID?.trim() || null;

export const data = new SlashCommandBuilder()
  .setName("request-key")
  .setDescription("Request an API key with budget allocation")
  .addNumberOption((opt) =>
    opt
      .setName("budget")
      .setDescription("Requested budget in USD (e.g. 5.00)")
      .setRequired(true)
      .setMinValue(0.01)
  )
  .addStringOption((opt) =>
    opt
      .setName("reason")
      .setDescription("Why you need this key")
      .setRequired(false)
  );

async function buildAdminReviewNotice(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    return { content: "New access request pending review." };
  }

  const guild = await interaction.client.guilds.fetch(interaction.guildId);
  const roles = await guild.roles.fetch();
  const adminRoleIds = roles
    .filter(
      (role) =>
        role &&
        role.id !== guild.id &&
        role.permissions.has(PermissionFlagsBits.Administrator)
    )
    .map((role) => role.id);

  if (adminRoleIds.length > 0) {
    return {
      content:
        adminRoleIds.map((id) => "<@&" + id + ">").join(" ") +
        " New access request pending review.",
      allowedMentions: { roles: adminRoleIds },
    };
  }

  return {
    content: "<@" + guild.ownerId + "> New access request pending review.",
    allowedMentions: { users: [guild.ownerId] },
  };
}

async function resolveReviewChannel(interaction: ChatInputCommandInteraction) {
  const requestedChannelId = ADMIN_REVIEW_CHANNEL_ID ?? ROUTUSSY_CHANNEL_ID ?? interaction.channelId;
  const channel = await interaction.client.channels
    .fetch(requestedChannelId)
    .catch(() => null);

  if (channel?.isTextBased() && "send" in channel) {
    return channel;
  }

  const fallback = interaction.channel;
  if (fallback?.isTextBased() && "send" in fallback) {
    return fallback;
  }

  return null;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const budgetUsd = interaction.options.getNumber("budget", true);
  const reason = interaction.options.getString("reason") ?? "No reason provided";
  const budgetCents = Math.round(budgetUsd * 100);

  await ensureGuild(interaction.guildId);
  const userId = await ensureUser(
    interaction.user.id,
    interaction.guildId
  );
  const user = await getUser(userId);
  const approved = await isUserApproved(userId);

  const requestId = await createKeyRequest(
    userId,
    interaction.guildId,
    interaction.user.id,
    budgetCents
  );

  const currentBudgetCents = user?.budget_cents ?? 0;
  const spentCents = user?.spent_cents ?? 0;
  const remainingCents = Math.max(0, currentBudgetCents - spentCents);

  const embed = new EmbedBuilder()
    .setTitle(approved ? "Additional Budget Request" : "API Key Request")
    .setColor(0xf5a623)
    .addFields(
      { name: "User", value: `<@${interaction.user.id}>`, inline: true },
      {
        name: "Current Budget",
        value: `$${(currentBudgetCents / 100).toFixed(2)}`,
        inline: true,
      },
      {
        name: "Remaining Spend",
        value: `$${(remainingCents / 100).toFixed(2)}`,
        inline: true,
      },
      {
        name: "Requested Budget",
        value: `$${budgetUsd.toFixed(2)}`,
        inline: true,
      },
      { name: "Reason", value: reason },
      { name: "Status", value: "Pending", inline: true },
      { name: "Request ID", value: `#${requestId}`, inline: true }
    )
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_request:${requestId}`)
      .setLabel("Approve / Edit Budget")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`deny_request:${requestId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
  );

  const adminNotice = await buildAdminReviewNotice(interaction);
  const reviewChannel = await resolveReviewChannel(interaction);

  if (!reviewChannel) {
    await interaction.editReply({
      content: "I could not find a text channel to send this review request to.",
    });
    return;
  }

  const reviewMessage = await reviewChannel.send({
    content: adminNotice.content,
    allowedMentions: adminNotice.allowedMentions,
    embeds: [embed],
    components: [row],
  });

  await interaction.editReply({
    content:
      reviewChannel.id === interaction.channelId
        ? "Your budget request has been submitted for admin review."
        : `Your budget request has been submitted for admin review in <#${reviewChannel.id}>.`,
  });

  await updateKeyRequestMessage(requestId, reviewMessage.id, reviewChannel.id);
}
