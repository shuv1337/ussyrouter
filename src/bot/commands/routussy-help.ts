import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";

const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || "3000"}`).replace(/\/$/, "");
const API_BASE = `${PUBLIC_URL}/v1`;
const ZAI_CODING_PLAN_URL = "https://z.ai/landing-page/coding-plan";

export const data = new SlashCommandBuilder()
  .setName("routussy-help")
  .setDescription("Get a beginner-friendly guide to Routussy and Ussycode");

export async function execute(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setTitle("Routussy Help")
    .setColor(0x5865f2)
    .setDescription(
      "Routussy is the shared AI gateway for the Ussyverse. It gives you an API key for model access. " +
        "If you also use Ussycode, that is the VM side of the system."
    )
    .addFields(
      {
        name: "Two systems, two kinds of limits",
        value:
          "**Routussy budget** = AI spend limit for model usage.\n" +
          "**Ussycode capacity** = VM/storage/CPU/RAM limits for your hosted machines.\n\n" +
          "Use `/usage me` for budget. Use `/ussycode-quota` for VM capacity.",
      },
      {
        name: "If you only want AI access",
        value:
          "1. Run `/request-key` to ask for budget.\n" +
          "2. After approval, run `/my-keys` to create your API key.\n" +
          "3. Run `/config` to get example client config snippets.",
      },
      {
        name: "If you want VMs too",
        value:
          "Run `/ussycode-help` for the full VM guide. That command explains SSH access, VM limits, trust levels, and how to request more capacity.",
      },
      {
        name: "Most useful commands",
        value:
          "`/request-key` — ask for AI budget\n" +
          "`/my-keys` — create and manage your Routussy API keys\n" +
          "`/config` — example configs for OpenCode, OpenAI SDKs, and cURL\n" +
          "`/usage me` — see your AI spend and remaining budget\n" +
          "`/ussycode-help` — beginner guide for the VM side\n" +
          "`/ussycode-quota` — see your VM/storage limits",
      },
      {
        name: "API Endpoint",
        value: `Base URL: \`${API_BASE}\`\nHealth: \`${PUBLIC_URL}/health\``,
      },
      {
        name: "Sponsored By Z.AI",
        value:
          `Z.AI is kindly sponsoring the Ussyverse and helping make Routussy possible. ` +
          `If you want to check out their coding plans, visit ${ZAI_CODING_PLAN_URL}`,
      }
    )
    .setFooter({ text: "New here? Start with /request-key for AI access, or /ussycode-help for VM access." });

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
