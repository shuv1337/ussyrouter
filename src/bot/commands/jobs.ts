import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { listRecentMediaJobs } from "../../db/media";

export const data = new SlashCommandBuilder()
  .setName("jobs")
  .setDescription("Inspect recent Routussy media jobs")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addIntegerOption((opt) =>
    opt
      .setName("limit")
      .setDescription("Number of recent jobs to show")
      .setMinValue(1)
      .setMaxValue(25)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: "You need Administrator permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const limit = interaction.options.getInteger("limit") ?? 10;
  const jobs = await listRecentMediaJobs(limit);

  if (jobs.length === 0) {
    await interaction.reply({
      content: "No media jobs found.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Recent Media Jobs")
    .setColor(0x5865f2)
    .setDescription(
      jobs
        .map(
          (job) =>
            `\`${job.task_id}\` - ${job.model} - ${job.status} - billed:${job.billed ? "yes" : "no"} - $${(job.cost_cents / 100).toFixed(2)}`
        )
        .join("\n")
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
