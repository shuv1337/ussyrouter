import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { ensureUser, ensureGuild } from "../../db/users";
import {
  isUssycodeApproved,
  listUssycodeSshKeys,
} from "../../db/ussycode";
import { getUssycodeApiKey } from "../../ussycode/keys";
import { getApprovedUssycodeHandleForDiscord, getUssycodeQuotaByHandle } from "../../ussycode/quota";
import { listUssycodeTrustTiers } from "../../ussycode/trust-tiers";

const USSYCODE_GATEWAY_HOST = process.env.USSYCODE_GATEWAY_HOST?.trim() || "dev.ussyco.de";
const USSYCODE_GATEWAY_PORT = process.env.USSYCODE_GATEWAY_PORT?.trim() || "2224";
const USSYCODE_VM_BASE_DOMAIN = process.env.USSYCODE_VM_BASE_DOMAIN?.trim() || "dev.ussyco.de";

export const data = new SlashCommandBuilder()
  .setName("ussycode-config")
  .setDescription("Get your ussycode connection details and API key");

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
      content: "You need ussycode access first. Use `/ussycode-request` to request access.",
    });
    return;
  }

  const keys = await listUssycodeSshKeys(userId);
  const apiKey = await getUssycodeApiKey(userId);
  const handle = await getApprovedUssycodeHandleForDiscord(interaction.user.id);
  const [quota, tiers] = handle
    ? await Promise.all([
        getUssycodeQuotaByHandle(handle).catch(() => null),
        listUssycodeTrustTiers().catch(() => []),
      ])
    : [null, [] as Awaited<ReturnType<typeof listUssycodeTrustTiers>>];

  const sshKeyCount = keys.length;
  const keyDisplay = apiKey
    ? `\`${apiKey.prefix}...\` (auto-generated for ussycode)`
    : "None (contact an admin)";

  const embed = new EmbedBuilder()
    .setTitle("Ussycode Configuration")
    .setColor(0x9b59b6)
    .addFields(
      { name: "SSH Access", value: `\`ssh -p ${USSYCODE_GATEWAY_PORT} ${USSYCODE_GATEWAY_HOST}\``, inline: true },
      { name: "SSH Keys Registered", value: `${sshKeyCount}`, inline: true },
      { name: "Routussy API Key", value: keyDisplay },
      { name: "Ussycode Handle", value: handle ? `\`${handle}\`` : "Not available yet", inline: true },
      {
        name: "Current Capacity",
        value: quota
          ? (() => {
              const tier = tiers.find((t) => t.key === quota.trust_level);
              const desc = tier?.description ? ` (${tier.description})` : "";
              return `Tier: ${quota.trust_level}${desc}\nVMs: ${quota.vm_count}/${quota.vm_limit < 0 ? "∞" : quota.vm_limit}\nDisk: ${quota.total_disk_gb} GB / ${quota.disk_limit_mb < 0 ? "∞" : Math.floor(quota.disk_limit_mb / 1024)} GB`;
            })()
          : "Use `/ussycode-quota` to load your current VM limits.",
        inline: true,
      },
      {
        name: "VM Web Access",
        value: `\`https://<vmname>.${USSYCODE_VM_BASE_DOMAIN}\`\nEach VM gets a subdomain based on its name.`,
      },
      {
        name: "How It Works",
        value:
          "Your ussycode VMs launch **pi** as the default AI assistant on SSH login. " +
          "pi is pre-configured with the ussyrouter proxy and your budget is managed automatically. " +
          "OpenCode is also installed if you prefer it — just run `opencode` manually.",
      },
      {
        name: "AI Assistants (auto-configured in VMs)",
        value:
          "**pi** (default) — launches on SSH login\n" +
          "**OpenCode** — run `opencode` manually\n\n" +
          "Both use fingerprint-based auth against the Routussy proxy.\n" +
          "Budget and API access are injected automatically.",
      },
      {
        name: "Need More Capacity?",
        value:
          "Use `/ussycode-help` for the beginner guide, `/ussycode-quota` to see your current VM limits, and `/ussycode-capacity-request` to ask for a higher tier.",
      }
    );

  if (sshKeyCount === 0) {
    embed.addFields({
      name: "Next Step",
      value: "Add an SSH key with `/ussycode-ssh add` to connect.",
    });
  }

  await interaction.editReply({
    embeds: [embed],
  });
}
