import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { ensureGuild, ensureUser } from "../../db/users";
import { isUssycodeApproved } from "../../db/ussycode";
import { getApprovedUssycodeHandleForDiscord, getUssycodeQuotaByHandle } from "../../ussycode/quota";
import { listUssycodeTrustTiers } from "../../ussycode/trust-tiers";

function formatLimit(value: number, unit = ""): string {
  if (value < 0) return `Unlimited${unit ? ` ${unit}` : ""}`;
  return `${value}${unit ? ` ${unit}` : ""}`;
}

export const data = new SlashCommandBuilder()
  .setName("ussycode-quota")
  .setDescription("View your current Ussycode VM and storage limits");

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
  const userId = await ensureUser(interaction.user.id, interaction.guildId);

  const approved = await isUssycodeApproved(userId);
  if (!approved) {
    await interaction.editReply({
      content: "You need Ussycode access first. Use `/ussycode-request` to request access.",
    });
    return;
  }

  const handle = await getApprovedUssycodeHandleForDiscord(interaction.user.id);
  if (!handle) {
    await interaction.editReply({
      content: "I could not determine your Ussycode handle yet. Try connecting once with SSH or contact an admin.",
    });
    return;
  }

  const [quota, tiers] = await Promise.all([
    getUssycodeQuotaByHandle(handle),
    listUssycodeTrustTiers(),
  ]);
  const tier = tiers.find((t) => t.key === quota.trust_level);
  const tierDescription = tier?.description ?? "Current tier";
  const diskLimitGb = quota.disk_limit_mb < 0 ? -1 : Math.floor(quota.disk_limit_mb / 1024);

  const embed = new EmbedBuilder()
    .setTitle("Your Ussycode Capacity")
    .setColor(0x9b59b6)
    .setDescription(
      "These are your **VM hosting limits**, not your AI budget. " +
        "Use `/usage me` for AI budget and `/ussycode-help` for a full explanation."
    )
    .addFields(
      { name: "Handle", value: `\`${quota.handle}\``, inline: true },
      { name: "Trust Level", value: `${quota.trust_level} — ${tierDescription}`, inline: true },
      { name: "VMs in Use", value: `${quota.vm_count} / ${formatLimit(quota.vm_limit)}`, inline: true },
      { name: "Disk in Use", value: `${quota.total_disk_gb} GB / ${formatLimit(diskLimitGb, "GB")}`, inline: true },
      { name: "Largest VM CPU", value: formatLimit(quota.cpu_limit, "vCPU"), inline: true },
      { name: "Largest VM RAM", value: formatLimit(quota.ram_limit_mb, "MB"), inline: true },
      {
        name: "What this means",
        value:
          "**VMs in Use** is how many machines you are currently using.\n" +
          "**Disk in Use** is your total VM disk usage.\n" +
          "**Largest VM CPU/RAM** is the maximum size any one VM can have.",
      },
      {
        name: "Need more?",
        value:
          "Run `/ussycode-capacity-request` if you need a higher tier. If you're not sure which tier to ask for, read `/ussycode-help` first.",
      }
    );

  await interaction.editReply({ embeds: [embed] });
}
