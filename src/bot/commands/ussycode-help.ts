import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { diskMbToGb, formatTierLimit, listUssycodeTrustTiers } from "../../ussycode/trust-tiers";

const USSYCODE_GATEWAY_HOST = process.env.USSYCODE_GATEWAY_HOST?.trim() || "dev.ussyco.de";
const USSYCODE_GATEWAY_PORT = process.env.USSYCODE_GATEWAY_PORT?.trim() || "2224";
const USSYCODE_VM_BASE_DOMAIN = process.env.USSYCODE_VM_BASE_DOMAIN?.trim() || "dev.ussyco.de";

export const data = new SlashCommandBuilder()
  .setName("ussycode-help")
  .setDescription("Learn how Ussycode works, step by step");

export async function execute(interaction: ChatInputCommandInteraction) {
  const tiers = await listUssycodeTrustTiers();
  const tierLines = tiers
    .map((tier) => {
      const parts = [
        formatTierLimit(tier.vm_limit, "VMs"),
        formatTierLimit(tier.cpu_limit, "vCPU per VM"),
        formatTierLimit(tier.ram_limit_mb, "MB RAM per VM"),
        formatTierLimit(diskMbToGb(tier.disk_limit_mb), "GB disk total"),
      ];
      return `**${tier.key}** — ${tier.description}\n${parts.join(", ")}`;
    })
    .join("\n\n");

  const embed = new EmbedBuilder()
    .setTitle("Ussycode Help")
    .setColor(0x9b59b6)
    .setDescription(
      "Ussycode gives you Linux VMs you can SSH into, build on, and share on the web. " +
        "If you're new, the main thing to know is that **AI budget** and **VM capacity** are different."
    )
    .addFields(
      {
        name: "What is Ussycode?",
        value:
          "A personal VM hosting system inside the Ussyverse. You connect over SSH, create and manage VMs, and each VM can expose a web app at its own subdomain.",
      },
      {
        name: "Budget vs Capacity",
        value:
          "**Routussy budget** is money for AI model usage. Use `/usage me` for that.\n" +
          "**Ussycode capacity** is how many VMs and how much CPU, RAM, and disk you can use. Use `/ussycode-quota` for that.",
      },
      {
        name: "Step 1: Request access",
        value:
          "Run `/ussycode-request` with your SSH public key. After an admin approves you, you can connect and add more keys later with `/ussycode-ssh add`.",
      },
      {
        name: "Step 2: Get your connection info",
        value:
          "Run `/ussycode-config`. It shows your SSH command, your handle, your current capacity, and the web domain pattern for your VMs.",
      },
      {
        name: "Step 3: Connect over SSH",
        value:
          `Use: \`ssh -p ${USSYCODE_GATEWAY_PORT} ${USSYCODE_GATEWAY_HOST}\`\n` +
          "When you connect, Ussycode figures out who you are from your approved SSH key.",
      },
      {
        name: "Step 4: Use your VM",
        value:
          "After you connect, you can create, start, stop, and SSH into your VMs. Each VM also gets a web address like " +
          `\`https://<vm-name>.${USSYCODE_VM_BASE_DOMAIN}\` when it serves an app.`,
      },
      {
        name: "What does 'trust level' mean?",
        value:
          "Trust level is Ussycode's name for your VM capacity tier. It is **not** your AI budget.",
      },
      {
        name: "Current tiers",
        value: tierLines,
      },
      {
        name: "How to read `/ussycode-quota`",
        value:
          "**VMs in Use** = how many machines you are using out of your limit.\n" +
          "**Disk in Use** = how much total VM disk you are using out of your limit.\n" +
          "**Largest VM CPU / RAM** = the biggest single VM size your tier allows.",
      },
      {
        name: "How to request more capacity",
        value:
          "If you need more than your current tier allows, run `/ussycode-capacity-request`. Explain what you are building and why you need more room.",
      },
      {
        name: "Useful commands",
        value:
          "`/ussycode-request` — ask for initial access\n" +
          "`/ussycode-config` — connection details and current setup\n" +
          "`/ussycode-ssh add` — add another SSH key\n" +
          "`/ussycode-ssh list` — see your approved SSH keys\n" +
          "`/ussycode-quota` — see your VM/storage limits\n" +
          "`/ussycode-capacity-request` — ask for a higher tier",
      }
    )
    .setFooter({ text: "Tip: If something is unclear, start with /ussycode-config and /ussycode-quota." });

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
