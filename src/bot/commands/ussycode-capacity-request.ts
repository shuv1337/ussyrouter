import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { ensureGuild, ensureUser } from "../../db/users";
import { isUssycodeApproved } from "../../db/ussycode";
import { buildReviewNotice } from "./review-notify";
import { createComputeRequest, updateComputeRequestMessage } from "../../db/compute-requests";
import { getApprovedUssycodeHandleForDiscord, getUssycodeQuotaByHandle } from "../../ussycode/quota";
import { diskMbToGb, formatTierLimit, listUssycodeTrustTiers } from "../../ussycode/trust-tiers";

const ADMIN_REVIEW_CHANNEL_ID = process.env.ADMIN_REVIEW_CHANNEL_ID?.trim() || null;
const ROUTUSSY_CHANNEL_ID = process.env.ROUTUSSY_CHANNEL_ID?.trim() || null;

export const data = new SlashCommandBuilder()
  .setName("ussycode-capacity-request")
  .setDescription("Ask for a higher Ussycode VM/storage tier")
  .addStringOption((opt) =>
    opt
      .setName("level")
      .setDescription("The tier you want to request")
      .setRequired(true)
      .addChoices(
        { name: "citizen", value: "citizen" },
        { name: "admin", value: "admin" }
      )
  )
  .addStringOption((opt) =>
    opt
      .setName("reason")
      .setDescription("What you want to build and why you need more capacity")
      .setRequired(true)
  );

async function resolveReviewChannel(interaction: ChatInputCommandInteraction) {
  const requestedChannelId = ADMIN_REVIEW_CHANNEL_ID ?? ROUTUSSY_CHANNEL_ID ?? interaction.channelId;
  const channel = await interaction.client.channels.fetch(requestedChannelId).catch(() => null);
  if (channel?.isTextBased() && "send" in channel) return channel;
  const fallback = interaction.channel;
  if (fallback?.isTextBased() && "send" in fallback) return fallback;
  return null;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await ensureGuild(interaction.guildId);
  const userId = await ensureUser(interaction.user.id, interaction.guildId);

  const approved = await isUssycodeApproved(userId);
  if (!approved) {
    await interaction.editReply({ content: "You need Ussycode access first. Use `/ussycode-request` to request access." });
    return;
  }

  const requestedLevel = interaction.options.getString("level", true);
  const reason = interaction.options.getString("reason", true);
  const handle = await getApprovedUssycodeHandleForDiscord(interaction.user.id);
  if (!handle) {
    await interaction.editReply({ content: "I could not determine your Ussycode handle yet. Try connecting once with SSH or contact an admin." });
    return;
  }

  const [current, tiers] = await Promise.all([
    getUssycodeQuotaByHandle(handle),
    listUssycodeTrustTiers(),
  ]);
  const requestedTier = tiers.find((tier) => tier.key === requestedLevel);
  if (!requestedTier || !requestedTier.requestable) {
    await interaction.editReply({ content: "That tier is not available to request right now." });
    return;
  }
  const requestId = await createComputeRequest(userId, interaction.guildId, interaction.user.id, requestedLevel, reason);

  const embed = new EmbedBuilder()
    .setTitle("Ussycode Capacity Request")
    .setColor(0xf5a623)
    .setDescription(
      "This requests a higher **VM capacity tier**. It does not change your AI budget. " +
        "If you need more AI spend, use `/request-key` instead."
    )
    .addFields(
      { name: "User", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Handle", value: `\`${handle}\``, inline: true },
      { name: "Current Tier", value: current.trust_level, inline: true },
      {
        name: "Requested Tier",
        value:
          `${requestedTier.key} — ${requestedTier.description}\n` +
          `Limits: ${formatTierLimit(requestedTier.vm_limit, "VMs")}, ${formatTierLimit(requestedTier.cpu_limit, "vCPU")}, ${formatTierLimit(requestedTier.ram_limit_mb, "MB RAM")}, ${formatTierLimit(diskMbToGb(requestedTier.disk_limit_mb), "GB disk")}`,
        inline: true,
      },
      { name: "Current Usage", value: `${current.vm_count} VM(s), ${current.total_disk_gb} GB disk`, inline: true },
      { name: "Reason", value: reason },
      { name: "Status", value: "Pending", inline: true },
      { name: "Request ID", value: `#${requestId}`, inline: true },
    )
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ussycode_capacity_approve:${requestId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ussycode_capacity_deny:${requestId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger),
  );

  const adminNotice = await buildReviewNotice(interaction, "New Ussycode capacity request pending review.");
  const reviewChannel = await resolveReviewChannel(interaction);
  if (!reviewChannel) {
    await interaction.editReply({ content: "I could not find a text channel to send this review request to." });
    return;
  }

  const reviewMessage = await reviewChannel.send({
    content: adminNotice.content,
    allowedMentions: adminNotice.allowedMentions,
    embeds: [embed],
    components: [row],
  });

  await updateComputeRequestMessage(requestId, reviewMessage.id, reviewChannel.id);
  await interaction.editReply({
    content:
      reviewChannel.id === interaction.channelId
        ? "Your Ussycode capacity request has been submitted for admin review."
        : `Your Ussycode capacity request has been submitted for admin review in <#${reviewChannel.id}>.`,
  });
}
