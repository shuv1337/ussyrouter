import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import {
  clearModelLimit,
  listModelLimits,
  setModelLimit,
} from "../../db/model-limits";
import { ensurePricing, getModelSpec, listModels } from "../../pricing";

function requireAdmin(interaction: ChatInputCommandInteraction): boolean {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  );
}

function normalizeInputModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

export const data = new SlashCommandBuilder()
  .setName("model-limits")
  .setDescription("View and manage per-model concurrency limits")
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List configured model concurrency limits")
  )
  .addSubcommand((sub) =>
    sub
      .setName("set")
      .setDescription("Set a concurrency limit for a model id")
      .addStringOption((opt) =>
        opt
          .setName("model")
          .setDescription("models.dev model id, e.g. glm-4.5")
          .setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt
          .setName("limit")
          .setDescription("Max concurrent requests")
          .setRequired(true)
          .setMinValue(1)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove a configured concurrency limit for a model id")
      .addStringOption((opt) =>
        opt
          .setName("model")
          .setDescription("models.dev model id")
          .setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await ensurePricing();
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "list") {
    const limits = await listModelLimits();
    if (limits.length === 0) {
      await interaction.reply({
        content: "No model concurrency limits configured.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = limits.map(
      (item) => `\`${item.model_id}\` (${item.display_name}): ${item.concurrency_limit}`
    );
    const content = `Configured concurrency limits:\n${lines.join("\n")}`;

    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!requireAdmin(interaction)) {
    await interaction.reply({
      content: "You need Administrator permission to modify model limits.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modelId = normalizeInputModelId(
    interaction.options.getString("model", true)
  );
  const spec = getModelSpec(modelId) ?? listModels().get(modelId) ?? null;

  if (subcommand === "set") {
    const limit = interaction.options.getInteger("limit", true);
    await setModelLimit(modelId, limit, spec?.name ?? modelId);
    await interaction.reply({
      content: `Set concurrency limit for \`${modelId}\` to ${limit}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "remove") {
    const removed = await clearModelLimit(modelId);
    await interaction.reply({
      content: removed
        ? `Removed concurrency limit for \`${modelId}\`.`
        : `No configured concurrency limit found for \`${modelId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
