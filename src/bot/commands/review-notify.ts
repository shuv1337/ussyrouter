import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";

const ADMIN_REVIEW_ROLE_ID = process.env.ADMIN_REVIEW_ROLE_ID?.trim() || null;

export async function buildReviewNotice(
  interaction: ChatInputCommandInteraction,
  message: string
) {
  if (!interaction.guildId) {
    return { content: message };
  }

  if (ADMIN_REVIEW_ROLE_ID) {
    return {
      content: `<@&${ADMIN_REVIEW_ROLE_ID}> ${message}`,
      allowedMentions: { roles: [ADMIN_REVIEW_ROLE_ID] },
    };
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
      content: adminRoleIds.map((id) => `<@&${id}>`).join(" ") + ` ${message}`,
      allowedMentions: { roles: adminRoleIds },
    };
  }

  return {
    content: `<@${guild.ownerId}> ${message}`,
    allowedMentions: { users: [guild.ownerId] },
  };
}
