import {
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
  StringSelectMenuBuilder,
} from "discord.js";
import {
  getKeyRequest,
  resolveKeyRequest,
  setUserBudget,
  getUser,
  ensureUser,
  ensureGuild,
  isUserApproved,
} from "../db/users";
import { createKey, revokeKey, setKeySpendLimit, listUserKeys } from "../keys";
import { getDb } from "../db";

async function getKeyOwner(keyId: number): Promise<string | null> {
  const db = getDb();
  const key = await db
    .selectFrom("api_keys")
    .innerJoin("users", "users.id", "api_keys.user_id")
    .select(["users.discord_id"])
    .where("api_keys.id", "=", keyId)
    .executeTakeFirst();
  return key?.discord_id ?? null;
}

export async function handleButton(interaction: ButtonInteraction) {
  const [action, ...args] = interaction.customId.split(":");
  const firstArg = args[0] ?? "0";

  if (action === "approve_request") {
    await handleApproveRequest(interaction, parseInt(firstArg));
  } else if (action === "deny_request") {
    await handleDenyRequest(interaction, parseInt(firstArg));
  } else if (action === "create_key_modal") {
    await showCreateKeyModal(interaction);
  } else if (action === "manage_keys_menu") {
    await showManageKeysMenu(interaction);
  } else if (action === "revoke_key") {
    await handleRevokeKey(interaction, parseInt(firstArg));
  }
}

async function handleApproveRequest(
  interaction: ButtonInteraction,
  requestId: number
) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: "Only administrators can approve requests.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const request = await getKeyRequest(requestId);
  if (!request) {
    await interaction.reply({
      content: "Request not found.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (request.status !== "pending") {
    await interaction.reply({
      content: `This request has already been ${request.status}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await resolveKeyRequest(requestId, "approved", interaction.user.id);

  const user = await getUser(request.user_id);
  if (user) {
    const newBudget = user.budget_cents + request.requested_budget_cents;
    await setUserBudget(request.user_id, newBudget);
  }

  const originalEmbed = interaction.message.embeds[0];
  if (!originalEmbed) return;

  // find the Status field by name rather than hardcoded index
  const fields = originalEmbed.fields.map((f) =>
    f.name === "Status"
      ? { name: "Status", value: `Approved by <@${interaction.user.id}>`, inline: true }
      : f
  );

  const embed = new EmbedBuilder()
    .setTitle(originalEmbed.title ?? "API Key Request")
    .setColor(0x57f287)
    .setFields(fields)
    .setTimestamp();

  await interaction.update({
    embeds: [embed],
    components: [],
  });
}

async function handleDenyRequest(
  interaction: ButtonInteraction,
  requestId: number
) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: "Only administrators can deny requests.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const request = await getKeyRequest(requestId);
  if (!request) {
    await interaction.reply({
      content: "Request not found.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (request.status !== "pending") {
    await interaction.reply({
      content: `This request has already been ${request.status}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await resolveKeyRequest(requestId, "denied", interaction.user.id);

  const originalEmbed = interaction.message.embeds[0];
  if (!originalEmbed) return;

  const fields = originalEmbed.fields.map((f) =>
    f.name === "Status"
      ? { name: "Status", value: `Denied by <@${interaction.user.id}>`, inline: true }
      : f
  );

  const embed = new EmbedBuilder()
    .setTitle(originalEmbed.title ?? "API Key Request")
    .setColor(0xed4245)
    .setFields(fields)
    .setTimestamp();

  await interaction.update({
    embeds: [embed],
    components: [],
  });
}

async function showCreateKeyModal(interaction: ButtonInteraction) {
  const modal = new ModalBuilder()
    .setCustomId("create_key_submit")
    .setTitle("Create API Key");

  const nameInput = new TextInputBuilder()
    .setCustomId("key_name")
    .setLabel("Key Name")
    .setPlaceholder("e.g. my-project")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(64);

  const limitInput = new TextInputBuilder()
    .setCustomId("spend_limit")
    .setLabel("Spend Limit (USD, leave empty for no limit)")
    .setPlaceholder("e.g. 5.00")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(limitInput)
  );

  await interaction.showModal(modal);
}

async function showManageKeysMenu(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;

  await ensureGuild(interaction.guildId);
  const userId = await ensureUser(interaction.user.id, interaction.guildId);
  const approved = await isUserApproved(userId);

  if (!approved) {
    await interaction.reply({
      content: "You need admin approval before you can manage API keys.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const keys = await listUserKeys(userId);
  const activeKeys = keys.filter((k) => k.active);

  if (activeKeys.length === 0) {
    await interaction.reply({
      content: "You have no active keys to manage.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId("manage_key_select")
    .setPlaceholder("Select a key to manage")
    .addOptions(
      activeKeys.map((k) => ({
        label: `${k.key_prefix}... - ${k.name}`,
        value: String(k.id),
        description: `Spent: $${(k.spent_cents / 100).toFixed(2)}`,
      }))
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    select
  );

  await interaction.reply({
    content: "Select a key to manage:",
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRevokeKey(
  interaction: ButtonInteraction,
  keyId: number
) {
  // verify the key belongs to the interacting user
  const owner = await getKeyOwner(keyId);
  if (owner !== interaction.user.id) {
    await interaction.reply({
      content: "You can only revoke your own keys.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await revokeKey(keyId);
  await interaction.reply({
    content: `Key #${keyId} has been revoked.`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction) {
  if (interaction.customId === "create_key_submit") {
    await handleCreateKeySubmit(interaction);
  } else if (interaction.customId.startsWith("set_spend_limit:")) {
    const keyId = parseInt(interaction.customId.split(":")[1] ?? "0");
    await handleSetSpendLimit(interaction, keyId);
  }
}

async function handleCreateKeySubmit(interaction: ModalSubmitInteraction) {
  if (!interaction.guildId) return;

  await ensureGuild(interaction.guildId);
  const userId = await ensureUser(interaction.user.id, interaction.guildId);
  const approved = await isUserApproved(userId);

  if (!approved) {
    await interaction.reply({
      content: "You need admin approval before you can create API keys.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const name = interaction.fields.getTextInputValue("key_name");
  const limitStr = interaction.fields.getTextInputValue("spend_limit");
  let limitCents: number | null = null;

  if (limitStr) {
    const parsed = parseFloat(limitStr);
    if (isNaN(parsed) || parsed < 0) {
      await interaction.reply({
        content: "Invalid spend limit. Please enter a valid number.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    limitCents = Math.round(parsed * 100);
  }

  const key = await createKey(userId, name, limitCents);

  const embed = new EmbedBuilder()
    .setTitle("API Key Created")
    .setColor(0x57f287)
    .setDescription(
      "**Save this key now - it will not be shown again.**"
    )
    .addFields(
      { name: "Name", value: key.name, inline: true },
      {
        name: "Spend Limit",
        value: limitCents ? `$${(limitCents / 100).toFixed(2)}` : "No limit",
        inline: true,
      },
      { name: "Key", value: `\`\`\`${key.rawKey}\`\`\`` }
    );

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSetSpendLimit(
  interaction: ModalSubmitInteraction,
  keyId: number
) {
  // verify ownership
  const owner = await getKeyOwner(keyId);
  if (owner !== interaction.user.id) {
    await interaction.reply({
      content: "You can only modify your own keys.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const limitStr = interaction.fields.getTextInputValue("new_spend_limit");

  let limitCents: number | null = null;
  if (limitStr) {
    const parsed = parseFloat(limitStr);
    if (isNaN(parsed) || parsed < 0) {
      await interaction.reply({
        content: "Invalid spend limit.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    limitCents = Math.round(parsed * 100);
  }

  await setKeySpendLimit(keyId, limitCents);
  await interaction.reply({
    content: limitCents
      ? `Spend limit set to $${(limitCents / 100).toFixed(2)}.`
      : "Spend limit removed.",
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleSelectMenu(
  interaction: StringSelectMenuInteraction
) {
  if (interaction.customId === "manage_key_select") {
    const keyId = parseInt(interaction.values[0] ?? "0");
    await showKeyManagement(interaction, keyId);
  }
}

async function showKeyManagement(
  interaction: StringSelectMenuInteraction,
  keyId: number
) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`set_limit_modal:${keyId}`)
      .setLabel("Set Spend Limit")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`revoke_key:${keyId}`)
      .setLabel("Revoke Key")
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.update({
    content: `Managing key #${keyId}:`,
    components: [row],
  });
}

export async function handleSetLimitButton(interaction: ButtonInteraction) {
  const keyId = interaction.customId.split(":")[1] ?? "0";

  const modal = new ModalBuilder()
    .setCustomId(`set_spend_limit:${keyId}`)
    .setTitle("Set Spend Limit");

  const limitInput = new TextInputBuilder()
    .setCustomId("new_spend_limit")
    .setLabel("New Spend Limit (USD, empty to remove)")
    .setPlaceholder("e.g. 10.00")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(limitInput)
  );

  await interaction.showModal(modal);
}
