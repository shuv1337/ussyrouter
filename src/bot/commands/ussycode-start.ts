import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { ensureGuild, ensureUser } from "../../db/users";
import { isUssycodeApproved } from "../../db/ussycode";
import { getApprovedUssycodeHandleForDiscord } from "../../ussycode/quota";
import {
  listUssycodeVMsByHandle,
  startVMByHandle,
  UssycodeVMActionError,
  UssycodeVMListError,
} from "../../ussycode/vms";

export const data = new SlashCommandBuilder()
  .setName("ussycode-start")
  .setDescription("Start one of your stopped Ussycode VMs")
  .addStringOption((opt) =>
    opt
      .setName("vm")
      .setDescription("Name of the VM to start")
      .setRequired(true)
      .setAutocomplete(true)
  );

export async function autocomplete(interaction: any) {
  const focused = interaction.options.getFocused().toLowerCase();

  try {
    const handle = await getApprovedUssycodeHandleForDiscord(
      interaction.user.id
    );
    if (!handle) {
      await interaction.respond([]);
      return;
    }

    const vms = await listUssycodeVMsByHandle(handle);
    const stopped = vms.filter((vm) => vm.status === "stopped");
    const filtered = stopped
      .filter((vm) => vm.name.toLowerCase().includes(focused))
      .slice(0, 25);

    await interaction.respond(
      filtered.map((vm) => ({ name: vm.name, value: vm.name }))
    );
  } catch {
    await interaction.respond([]);
  }
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const vmName = interaction.options.getString("vm", true).trim();
  if (!vmName) {
    await interaction.reply({
      content: "Please provide a VM name.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await ensureGuild(interaction.guildId);
  const userId = await ensureUser(interaction.user.id, interaction.guildId);

  const approved = await isUssycodeApproved(userId);
  if (!approved) {
    await interaction.editReply({
      content:
        "You haven't requested Ussycode access yet. Run `/ussycode-request` first.",
    });
    return;
  }

  const handle = await getApprovedUssycodeHandleForDiscord(
    interaction.user.id
  );
  if (!handle) {
    await interaction.editReply({
      content:
        "Could not determine your Ussycode handle. Try connecting once with SSH or contact an admin.",
    });
    return;
  }

  try {
    await startVMByHandle(handle, vmName);
  } catch (err) {
    if (err instanceof UssycodeVMActionError) {
      if (err.status === 404) {
        await interaction.editReply({
          content: `VM **${vmName}** not found. Run \`/ussycode-vms\` to see your VMs.`,
        });
        return;
      }
      if (err.status === 409) {
        await interaction.editReply({
          content: `VM **${vmName}** is already running.`,
        });
        return;
      }
    }

    console.error("[ussycode-start] command error", err);
    await interaction.editReply({
      content: `Failed to start **${vmName}**: ${err instanceof Error ? err.message : "unknown error"}`,
    });
    return;
  }

  await interaction.editReply({
    content: `🟢 VM **${vmName}** is starting up! Give it a moment, then connect via SSH.`,
  });
}
