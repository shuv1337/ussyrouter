import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { ensureGuild, ensureUser } from "../../db/users";
import { isUssycodeApproved } from "../../db/ussycode";
import { getApprovedUssycodeHandleForDiscord } from "../../ussycode/quota";
import {
  listUssycodeVMsByHandle,
  UssycodeVMListError,
  type UssycodeVM,
} from "../../ussycode/vms";

const MAX_VM_FIELDS = 10;

const STATUS_DISPLAY: Record<string, { emoji: string; label: string }> = {
  running: { emoji: "🟢", label: "Running" },
  creating: { emoji: "🟡", label: "Creating" },
  stopped: { emoji: "⚪", label: "Stopped" },
  error: { emoji: "🔴", label: "Error" },
};

function formatResources(vcpu: number, memMb: number, diskGb: number): string {
  const ram =
    memMb >= 1024 ? `${(memMb / 1024).toFixed(1)} GB` : `${memMb} MB`;
  return `${vcpu} vCPU · ${ram} RAM · ${diskGb} GB disk`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatVMField(vm: UssycodeVM): { name: string; value: string } {
  const st = STATUS_DISPLAY[vm.status] ?? { emoji: "❓", label: vm.status };
  const urlDisplay =
    vm.status === "running" ? vm.public_url : `${vm.public_url} (offline)`;

  let value =
    `**Status:** ${st.label}\n` +
    `**Image:** ${vm.image}\n` +
    `**Resources:** ${formatResources(vm.vcpu, vm.memory_mb, vm.disk_gb)}\n` +
    `**URL:** ${urlDisplay}`;

  if (vm.node) {
    value += `\n**Node:** ${vm.node.name}`;
  }

  value += `\n**Created:** ${formatDate(vm.created_at)}`;

  return { name: `${st.emoji} ${vm.name}`, value };
}

export const data = new SlashCommandBuilder()
  .setName("ussycode-vms")
  .setDescription("List your Ussycode VMs and their status");

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
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

  let vms: UssycodeVM[];
  try {
    vms = await listUssycodeVMsByHandle(handle);
  } catch (err) {
    if (
      err instanceof UssycodeVMListError &&
      err.status === 404 &&
      err.body.includes("unknown user")
    ) {
      await interaction.editReply({
        content:
          "Your Ussycode access is approved, but your local ussycode account has not been created yet. SSH into `ussycode.shuv.dev` once, then run `/ussycode-vms` again.",
      });
      return;
    }

    console.error("[ussycode-vms] command error", err);
    await interaction.editReply({
      content: `Failed to fetch your VMs: ${err instanceof Error ? err.message : "unknown error"}`,
    });
    return;
  }

  if (vms.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle("Your Ussycode VMs")
      .setColor(0x9b59b6)
      .setDescription(
        "You don't have any VMs yet.\n\n" +
          "Connect via SSH and run `new` to create one:\n" +
          "```\nssh ussycode.shuv.dev\n```"
      );

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const shown = vms.slice(0, MAX_VM_FIELDS);
  const hiddenCount = vms.length - shown.length;

  const embed = new EmbedBuilder()
    .setTitle(`Your Ussycode VMs (${vms.length})`)
    .setColor(0x9b59b6);

  for (const vm of shown) {
    embed.addFields(formatVMField(vm));
  }

  if (hiddenCount > 0) {
    embed.addFields({
      name: "More VMs",
      value: `Showing ${shown.length} of ${vms.length} VMs. ${hiddenCount} more not shown in Discord to stay within embed limits.`,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}