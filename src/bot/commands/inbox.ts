import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import {
  createInbox,
  listInboxes,
  deleteInbox,
  countActiveInboxes,
  getMaxInboxes,
} from "../../db/mail";

const DOMAIN = "basilisk.services";

// Only allow alphanumeric, dots, hyphens, underscores. 3-32 chars.
function isValidAddress(addr: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/i.test(addr);
}

// Reserved local parts that should not be claimable
const RESERVED = new Set([
  "postmaster",
  "abuse",
  "admin",
  "root",
  "webmaster",
  "hostmaster",
  "mailer-daemon",
  "noreply",
  "no-reply",
  "info",
  "support",
  "security",
  "mail",
  "test",
]);

export const data = new SlashCommandBuilder()
  .setName("inbox")
  .setDescription("Manage your ussymail inboxes")
  .addSubcommand((sub) =>
    sub
      .setName("create")
      .setDescription("Create a new email inbox")
      .addStringOption((opt) =>
        opt
          .setName("name")
          .setDescription(
            "Address name (leave empty for random). Will become <name>@" +
              DOMAIN
          )
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List your active inboxes")
  )
  .addSubcommand((sub) =>
    sub
      .setName("delete")
      .setDescription("Delete one of your inboxes")
      .addStringOption((opt) =>
        opt
          .setName("address")
          .setDescription("The inbox address to delete (local part only)")
          .setRequired(true)
      )
  );

function generateRandomAddress(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "create") {
    await handleCreate(interaction);
  } else if (sub === "list") {
    await handleList(interaction);
  } else if (sub === "delete") {
    await handleDelete(interaction);
  }
}

async function handleCreate(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;
  const nameOpt = interaction.options.getString("name");

  // Check inbox limit
  const current = await countActiveInboxes(discordId);
  const max = await getMaxInboxes(discordId);
  if (current >= max) {
    await interaction.reply({
      content: `You already have ${current}/${max} inboxes. Delete one first or request a higher limit.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let address: string;
  if (nameOpt) {
    address = nameOpt.trim().toLowerCase();
    if (!isValidAddress(address)) {
      await interaction.reply({
        content:
          "Invalid address name. Use 3-32 characters: letters, numbers, dots, hyphens, underscores. Must start and end with a letter or number.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (RESERVED.has(address)) {
      await interaction.reply({
        content: `\`${address}\` is a reserved address and cannot be claimed.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } else {
    // Generate random address
    address = generateRandomAddress();
  }

  const id = await createInbox(discordId, address);
  if (id === null) {
    if (nameOpt) {
      await interaction.reply({
        content: `\`${address}@${DOMAIN}\` is already taken. Try a different name.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      // Extremely unlikely collision with random address, just retry
      const retry = generateRandomAddress();
      const retryId = await createInbox(discordId, retry);
      if (retryId === null) {
        await interaction.reply({
          content: "Failed to create inbox (address collision). Please try again.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      address = retry;
    }
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Inbox Created")
    .setColor(0x57f287)
    .addFields(
      { name: "Address", value: `\`${address}@${DOMAIN}\`` },
      {
        name: "How it works",
        value:
          "Emails sent to this address will be forwarded to your Discord DMs. Make sure your DMs are open for this server.",
      }
    )
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleList(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;
  const inboxes = await listInboxes(discordId);

  if (inboxes.length === 0) {
    await interaction.reply({
      content:
        "You have no active inboxes. Use `/inbox create` to create one.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const max = await getMaxInboxes(discordId);
  const lines = inboxes.map(
    (inbox, i) =>
      `${i + 1}. \`${inbox.address}@${DOMAIN}\` — created ${inbox.created_at}`
  );

  const embed = new EmbedBuilder()
    .setTitle("Your Inboxes")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${inboxes.length}/${max} slots used` })
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleDelete(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;
  const address = interaction.options
    .getString("address", true)
    .trim()
    .toLowerCase();

  const deleted = await deleteInbox(discordId, address);
  if (!deleted) {
    await interaction.reply({
      content: `No active inbox found with address \`${address}\`. Use \`/inbox list\` to see your inboxes.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `Inbox \`${address}@${DOMAIN}\` has been deleted. Emails to this address will no longer be forwarded.`,
    flags: MessageFlags.Ephemeral,
  });
}
