import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { ensureUser, ensureGuild } from "../../db/users";
import {
  isUssycodeApproved,
  addUssycodeSshKey,
  removeUssycodeSshKey,
  listUssycodeSshKeys,
} from "../../db/ussycode";
import { sshFingerprint } from "../../ussycode/ssh";

export const data = new SlashCommandBuilder()
  .setName("ussycode-ssh")
  .setDescription("Manage your ussycode SSH keys")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Add an SSH public key for ussycode access")
      .addStringOption((opt) =>
        opt
          .setName("key")
          .setDescription("Your SSH public key (ssh-ed25519, ssh-rsa, etc.)")
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("label")
          .setDescription("A label for this key (e.g. laptop, desktop)")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove an SSH key from ussycode")
      .addIntegerOption((opt) =>
        opt
          .setName("key-id")
          .setDescription("The ID of the key to remove (from /ussycode-ssh list)")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List your ussycode SSH keys")
  );

function validateSshPubkey(key: string): boolean {
  const trimmed = key.trim();
  return /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+[A-Za-z0-9+/=]+/.test(
    trimmed
  );
}

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
      content:
        "You need ussycode access first. Use `/ussycode-request` to request access.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "add") {
    await handleAdd(interaction, userId);
  } else if (sub === "remove") {
    await handleRemove(interaction, userId);
  } else if (sub === "list") {
    await handleList(interaction, userId);
  }
}

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  userId: string
) {
  const key = interaction.options.getString("key", true).trim();
  const label = interaction.options.getString("label") ?? "default";

  if (!validateSshPubkey(key)) {
    await interaction.reply({
      content:
        "That doesn't look like a valid SSH public key. It should start with `ssh-ed25519`, `ssh-rsa`, etc.\n\n" +
        "Find your key with: `cat ~/.ssh/id_ed25519.pub`",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const fingerprint = sshFingerprint(key);
  if (!fingerprint) {
    await interaction.reply({
      content: "Could not compute fingerprint for that key. Make sure it's a valid SSH public key.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const keyId = await addUssycodeSshKey(
    userId,
    interaction.user.id,
    key,
    fingerprint,
    label
  );

  await interaction.reply({
    content: `SSH key added (ID: ${keyId}, label: \`${label}\`, fingerprint: \`${fingerprint}\`).\n\nYou can now SSH into ussycode with this key.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRemove(
  interaction: ChatInputCommandInteraction,
  userId: string
) {
  const keyId = interaction.options.getInteger("key-id", true);

  const removed = await removeUssycodeSshKey(keyId, userId);
  if (!removed) {
    await interaction.reply({
      content: "Key not found or you don't own it.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `SSH key #${keyId} has been removed.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  userId: string
) {
  const keys = await listUssycodeSshKeys(userId);

  if (keys.length === 0) {
    await interaction.reply({
      content: "You have no ussycode SSH keys. Use `/ussycode-ssh add` to add one.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Your Ussycode SSH Keys")
    .setColor(0x9b59b6)
    .setDescription(
      keys
        .map((k) => {
          const keyParts = k.ssh_pubkey.split(" ");
          const keyType = keyParts[0];
          return `**#${k.id}** \`${k.label}\` - ${keyType} (\`${k.fingerprint.slice(0, 20)}...\`)`;
        })
        .join("\n")
    );

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
