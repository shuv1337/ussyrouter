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

  await ensureGuild(interaction.guildId);
  const userId = await ensureUser(interaction.user.id, interaction.guildId);

  const approved = await isUssycodeApproved(userId);
  if (!approved) {
    await interaction.reply({
      content: "You need ussycode access first. Use `/ussycode-request` to request access.",
      flags: MessageFlags.Ephemeral,
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
      { name: "SSH Access", value: "`ssh -p 2224 dev.ussyco.de`", inline: true },
      { name: "SSH Keys Registered", value: `${sshKeyCount}`, inline: true },
      { name: "Routussy API Key", value: keyDisplay },
      {
        name: "VM Web Access",
        value: "`https://<vmname>.dev.ussyco.de`\nEach VM gets a subdomain based on its name.",
      },
      {
        name: "How It Works",
        value:
          "Your ussycode VMs are pre-configured with OpenCode pointing at the Routussy proxy. " +
          "Your API key and budget are automatically injected -- just SSH in and start coding.",
      },
      {
        name: "OpenCode Config (auto-injected in VMs)",
        value:
          "```json\n" +
          JSON.stringify(
            {
              provider: {
                zai: {
                  npm: "@ai-sdk/openai-compatible",
                  options: {
                    apiKey: "env:OPENCODE_API_KEY",
                    baseURL: "env:OPENCODE_BASE_URL",
                  },
                },
              },
            },
            null,
            2
          ) +
          "\n```",
      }
    );

  if (sshKeyCount === 0) {
    embed.addFields({
      name: "Next Step",
      value: "Add an SSH key with `/ussycode-ssh add` to connect.",
    });
  }

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
