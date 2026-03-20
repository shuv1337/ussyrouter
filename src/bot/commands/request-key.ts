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
  createKeyRequest,
  updateKeyRequestMessage,
  isUserApproved,
} from "../../db/users";

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

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const budgetUsd = interaction.options.getNumber("budget", true);
  const reason = interaction.options.getString("reason") ?? "No reason provided";
  const budgetCents = Math.round(budgetUsd * 100);

  await ensureGuild(interaction.guildId);
  const userId = await ensureUser(
    interaction.user.id,
    interaction.guildId
  );

  if (await isUserApproved(userId)) {
    await interaction.reply({
      content: "You already have admin approval. Use `/my-keys` to create and manage keys.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const requestId = await createKeyRequest(
    userId,
    interaction.guildId,
    interaction.user.id,
    budgetCents
  );

  const embed = new EmbedBuilder()
    .setTitle("API Key Request")
    .setColor(0xf5a623)
    .addFields(
      { name: "User", value: `<@${interaction.user.id}>`, inline: true },
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
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`deny_request:${requestId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
  );

  const adminNotice = await buildAdminReviewNotice(interaction);

  // send the approval embed to the channel
  const reply = await interaction.reply({
    content: adminNotice.content,
    allowedMentions: adminNotice.allowedMentions,
    embeds: [embed],
    components: [row],
    fetchReply: true,
  });

  await updateKeyRequestMessage(requestId, reply.id, reply.channelId);
}
