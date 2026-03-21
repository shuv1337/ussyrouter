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
import { ensureUser, ensureGuild } from "../../db/users";
import {
  createUssycodeRequest,
  updateUssycodeRequestMessage,
  isUssycodeApproved,
  listUserUssycodeRequests,
} from "../../db/ussycode";

const ADMIN_REVIEW_CHANNEL_ID = process.env.ADMIN_REVIEW_CHANNEL_ID?.trim() || null;
const ROUTUSSY_CHANNEL_ID = process.env.ROUTUSSY_CHANNEL_ID?.trim() || null;

export const data = new SlashCommandBuilder()
  .setName("ussycode-request")
  .setDescription("Request access to ussycode dev environments")
  .addStringOption((opt) =>
    opt
      .setName("ssh-key")
      .setDescription("Your SSH public key (starts with ssh-ed25519, ssh-rsa, etc.)")
      .setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName("reason")
      .setDescription("Why you want ussycode access")
      .setRequired(false)
  );

function validateSshPubkey(key: string): boolean {
  const trimmed = key.trim();
  return /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+[A-Za-z0-9+/=]+/.test(
    trimmed
  );
}

async function buildAdminReviewNotice(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    return { content: "New ussycode access request pending review." };
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
        " New ussycode access request pending review.",
      allowedMentions: { roles: adminRoleIds },
    };
  }

  return {
    content: "<@" + guild.ownerId + "> New ussycode access request pending review.",
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

  const sshKey = interaction.options.getString("ssh-key", true).trim();
  const reason = interaction.options.getString("reason") ?? "No reason provided";

  if (!validateSshPubkey(sshKey)) {
    await interaction.reply({
      content:
        "That doesn't look like a valid SSH public key. It should start with `ssh-ed25519`, `ssh-rsa`, `ecdsa-sha2-*`, etc.\n\n" +
        "You can find your public key with:\n```\ncat ~/.ssh/id_ed25519.pub\n```",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await ensureGuild(interaction.guildId);
  const userId = await ensureUser(interaction.user.id, interaction.guildId);

  // Check if already approved
  const alreadyApproved = await isUssycodeApproved(userId);
  if (alreadyApproved) {
    await interaction.reply({
      content:
        "You already have ussycode access. Use `/ussycode-ssh add` to add more SSH keys, or `/ussycode-config` to get your connection details.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check for existing pending request
  const existing = await listUserUssycodeRequests(userId, 1);
  const latestRequest = existing[0];
  if (latestRequest && latestRequest.status === "pending") {
    await interaction.reply({
      content: "You already have a pending ussycode access request. Please wait for admin review.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const requestId = await createUssycodeRequest(
    userId,
    interaction.guildId,
    interaction.user.id,
    sshKey
  );

  // Truncate key for display
  const keyParts = sshKey.split(" ");
  const keyType = keyParts[0];
  const keyData = keyParts[1] ?? "";
  const keyDisplay = `${keyType} ${keyData.slice(0, 12)}...${keyData.slice(-8)}`;
  const keyComment = keyParts.slice(2).join(" ") || "no comment";

  const embed = new EmbedBuilder()
    .setTitle("Ussycode Access Request")
    .setColor(0x9b59b6) // purple for ussycode
    .addFields(
      { name: "User", value: `<@${interaction.user.id}>`, inline: true },
      { name: "SSH Key Type", value: `\`${keyType}\``, inline: true },
      { name: "Key Comment", value: keyComment, inline: true },
      { name: "Key Preview", value: `\`${keyDisplay}\`` },
      { name: "Reason", value: reason },
      { name: "Status", value: "Pending", inline: true },
      { name: "Request ID", value: `#${requestId}`, inline: true }
    )
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ussycode_approve:${requestId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ussycode_deny:${requestId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
  );

  const adminNotice = await buildAdminReviewNotice(interaction);
  const reviewChannel = await resolveReviewChannel(interaction);

  if (!reviewChannel) {
    await interaction.reply({
      content: "I could not find a text channel to send this review request to.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reviewMessage = await reviewChannel.send({
    content: adminNotice.content,
    allowedMentions: adminNotice.allowedMentions,
    embeds: [embed],
    components: [row],
  });

  await interaction.reply({
    content:
      reviewChannel.id === interaction.channelId
        ? "Your ussycode access request has been submitted for admin review."
        : `Your ussycode access request has been submitted for admin review in <#${reviewChannel.id}>.`,
    flags: MessageFlags.Ephemeral,
  });

  await updateUssycodeRequestMessage(requestId, reviewMessage.id, reviewChannel.id);
}
