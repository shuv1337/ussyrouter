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
  type EmbedField,
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
import { getSharePayload, deleteSharePayload } from "./media-share";
import { getFreshVideoAsset } from "../media";
import {
  getUssycodeRequest,
  resolveUssycodeRequest,
  addUssycodeSshKey,
} from "../db/ussycode";
import { getOrCreateUssycodeKey } from "../ussycode/keys";
import { sshFingerprint } from "../ussycode/ssh";

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
    await showApproveRequestModal(interaction, parseInt(firstArg));
  } else if (action === "deny_request") {
    await handleDenyRequest(interaction, parseInt(firstArg));
  } else if (action === "create_key_modal") {
    await showCreateKeyModal(interaction);
  } else if (action === "manage_keys_menu") {
    await showManageKeysMenu(interaction);
  } else if (action === "revoke_key") {
    await handleRevokeKey(interaction, parseInt(firstArg));
  } else if (action === "share_media") {
    await handleShareMedia(interaction, firstArg);
  } else if (action === "ussycode_approve") {
    await handleUssycodeApprove(interaction, parseInt(firstArg));
  } else if (action === "ussycode_deny") {
    await handleUssycodeDeny(interaction, parseInt(firstArg));
  }
}

async function handleShareMedia(interaction: ButtonInteraction, shareId: string) {
  const payload = await getSharePayload(shareId);
  if (!payload) {
    await interaction.reply({
      content: "That media result is no longer available to share.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (payload.userId !== interaction.user.id) {
    await interaction.reply({
      content: "Only the original requester can share this result publicly.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(payload.title)
    .setColor(0x57f287)
    .setTimestamp();

  if (payload.description) {
    embed.setDescription(payload.description);
  }
  if (payload.fields) {
    embed.addFields(payload.fields);
  }

  let fileUrl = payload.fileUrl;
  let imageUrl = payload.imageUrl;

  if (payload.kind === "video" && payload.mediaJobId) {
    const fresh = await getFreshVideoAsset(payload.mediaJobId);
    if (fresh.status === "ready") {
      fileUrl = fresh.url;
      imageUrl = fresh.coverImageUrl ?? payload.imageUrl;
    } else if (fresh.status === "failed") {
      await interaction.reply({
        content: fresh.error ?? "That video is no longer available.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  const files = [] as Array<{ attachment: string; name?: string }>;
  if (fileUrl) {
    files.push({ attachment: fileUrl, name: payload.filename });
  }

  await interaction.reply({
    content: `<@${interaction.user.id}> shared a ${payload.kind} result from Routussy.`,
    embeds: [embed],
    files,
    allowedMentions: { users: [] },
  });

  await deleteSharePayload(shareId);
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function replaceOrAppendField(
  fields: EmbedField[],
  name: string,
  value: string,
  inline = true
): EmbedField[] {
  let found = false;
  const next = fields.map((field) => {
    if (field.name !== name) return field;
    found = true;
    return { name, value, inline };
  });

  if (!found) {
    next.push({ name, value, inline });
  }

  return next;
}

async function showApproveRequestModal(
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

  const modal = new ModalBuilder()
    .setCustomId(`approve_request_budget:${requestId}`)
    .setTitle("Approve Access Request");

  const budgetInput = new TextInputBuilder()
    .setCustomId("approved_budget")
    .setLabel("Approved Budget (USD)")
    .setPlaceholder((request.requested_budget_cents / 100).toFixed(2))
    .setValue((request.requested_budget_cents / 100).toFixed(2))
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(budgetInput)
  );

  await interaction.showModal(modal);
}

async function handleApproveRequest(
  interaction: ModalSubmitInteraction,
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

  const approvedBudgetRaw = interaction.fields.getTextInputValue("approved_budget");
  const approvedBudget = parseFloat(approvedBudgetRaw);
  if (isNaN(approvedBudget) || approvedBudget < 0) {
    await interaction.reply({
      content: "Approved budget must be a valid non-negative number.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const approvedBudgetCents = Math.round(approvedBudget * 100);

  await resolveKeyRequest(
    requestId,
    "approved",
    interaction.user.id,
    approvedBudgetCents
  );

  const user = await getUser(request.user_id);
  if (user) {
    const newBudget = user.budget_cents + approvedBudgetCents;
    await setUserBudget(request.user_id, newBudget);
  }

  const sourceMessage = request.channel_id && request.message_id
    ? await interaction.client.channels
        .fetch(request.channel_id)
        .then((channel) => {
          if (!channel?.isTextBased() || !("messages" in channel)) return null;
          return channel.messages.fetch(request.message_id!);
        })
        .catch(() => null)
    : null;

  const originalEmbed = sourceMessage?.embeds[0] ?? null;
  if (!sourceMessage || !originalEmbed) {
    await interaction.reply({
      content: `Approved request #${requestId} for ${formatUsd(approvedBudgetCents)}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let fields = originalEmbed.fields.map((field) => ({
    name: field.name,
    value: field.value,
    inline: field.inline ?? false,
  }));
  fields = replaceOrAppendField(
    fields,
    "Approved Budget",
    formatUsd(approvedBudgetCents),
    true
  );
  fields = replaceOrAppendField(
    fields,
    "Status",
    `Approved by <@${interaction.user.id}>`,
    true
  );

  const embed = new EmbedBuilder()
    .setTitle(originalEmbed.title ?? "API Key Request")
    .setColor(0x57f287)
    .setFields(fields)
    .setTimestamp();

  await sourceMessage.edit({
    embeds: [embed],
    components: [],
  });

  await interaction.reply({
    content: `Approved request #${requestId} for ${formatUsd(approvedBudgetCents)}.`,
    flags: MessageFlags.Ephemeral,
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
  } else if (interaction.customId.startsWith("approve_request_budget:")) {
    const requestId = parseInt(interaction.customId.split(":")[1] ?? "0");
    await handleApproveRequest(interaction, requestId);
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

// ── Ussycode button handlers ──────────────────────────────────────────

async function handleUssycodeApprove(
  interaction: ButtonInteraction,
  requestId: number
) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: "Only administrators can approve ussycode requests.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const request = await getUssycodeRequest(requestId);
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

  // Create the ussycode-system API key for this user
  const ussycodeKey = await getOrCreateUssycodeKey(request.user_id);

  // Compute fingerprint and store the initial SSH key
  const fingerprint = sshFingerprint(request.ssh_pubkey);
  if (fingerprint) {
    await addUssycodeSshKey(
      request.user_id,
      request.discord_user_id,
      request.ssh_pubkey,
      fingerprint,
      "initial"
    );
  }

  // Resolve the request
  await resolveUssycodeRequest(
    requestId,
    "approved",
    interaction.user.id,
    ussycodeKey.id
  );

  // Update the embed
  const originalEmbed = interaction.message.embeds[0];
  if (!originalEmbed) {
    await interaction.reply({
      content: `Approved ussycode request #${requestId}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let fields = originalEmbed.fields.map((f) => ({
    name: f.name,
    value: f.value,
    inline: f.inline ?? false,
  }));
  fields = replaceOrAppendField(
    fields,
    "Status",
    `Approved by <@${interaction.user.id}>`,
    true
  );
  fields = replaceOrAppendField(
    fields,
    "API Key",
    `\`${ussycodeKey.prefix}...\` (ussycode-system)`,
    true
  );

  const embed = new EmbedBuilder()
    .setTitle(originalEmbed.title ?? "Ussycode Access Request")
    .setColor(0x57f287)
    .setFields(fields)
    .setTimestamp();

  await interaction.update({
    embeds: [embed],
    components: [],
  });
}

async function handleUssycodeDeny(
  interaction: ButtonInteraction,
  requestId: number
) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: "Only administrators can deny ussycode requests.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const request = await getUssycodeRequest(requestId);
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

  await resolveUssycodeRequest(requestId, "denied", interaction.user.id);

  const originalEmbed = interaction.message.embeds[0];
  if (!originalEmbed) {
    await interaction.reply({
      content: `Denied ussycode request #${requestId}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const fields = originalEmbed.fields.map((f) =>
    f.name === "Status"
      ? { name: "Status", value: `Denied by <@${interaction.user.id}>`, inline: true }
      : { name: f.name, value: f.value, inline: f.inline ?? false }
  );

  const embed = new EmbedBuilder()
    .setTitle(originalEmbed.title ?? "Ussycode Access Request")
    .setColor(0xed4245)
    .setFields(fields)
    .setTimestamp();

  await interaction.update({
    embeds: [embed],
    components: [],
  });
}
