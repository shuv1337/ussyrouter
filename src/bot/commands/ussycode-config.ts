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
