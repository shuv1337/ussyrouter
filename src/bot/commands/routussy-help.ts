import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";

const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || "3000"}`).replace(/\/$/, "");
const API_BASE = `${PUBLIC_URL}/v1`;

export const data = new SlashCommandBuilder()
  .setName("routussy-help")
  .setDescription("Get started with Routussy");

export async function execute(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setTitle("Routussy Help")
    .setColor(0x5865f2)
    .setDescription("Routussy gives you a personal API key for the shared proxy after an admin approves your budget.")
    .addFields(
      {
        name: "1. Request Access",
        value: "Run `/request-key budget:<usd> reason:<why>` and wait for admin review.",
      },
      {
        name: "2. Create Your Key",
        value: "After approval, open `/my-keys` and use the create button. Your raw key is shown once.",
      },
      {
        name: "3. Connect Your Client",
        value: "Run `/config` and choose OpenCode, OpenAI-compatible, JavaScript, Python, or cURL.",
      },
      {
        name: "4. Track Spend",
        value: "Use `/usage me` to check your allocated budget, spend, and model usage.",
      },
      {
        name: "API Endpoint",
        value: `Base URL: \`${API_BASE}\`\nHealth: \`${PUBLIC_URL}/health\``,
      }
    );

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
