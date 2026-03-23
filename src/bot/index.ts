import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
  type Interaction,
  MessageFlags,
} from "discord.js";
import * as requestKey from "./commands/request-key";
import * as setBudget from "./commands/set-budget";
import * as myKeys from "./commands/my-keys";
import * as usage from "./commands/usage";
import * as config from "./commands/config";
import * as modelLimits from "./commands/model-limits";
import * as routussyHelp from "./commands/routussy-help";
import * as routussyStats from "./commands/routussy-stats";
import * as generate from "./commands/generate";
import * as jobs from "./commands/jobs";
import * as ussycodeRequest from "./commands/ussycode-request";
import * as ussycodeSsh from "./commands/ussycode-ssh";
import * as ussycodeConfig from "./commands/ussycode-config";
import * as ussycodeHelp from "./commands/ussycode-help";
import * as ussycodeQuota from "./commands/ussycode-quota";
import * as ussycodeCapacityRequest from "./commands/ussycode-capacity-request";
import * as ussycodeVms from "./commands/ussycode-vms";
import * as ussycodeStart from "./commands/ussycode-start";
import * as ussycodeStop from "./commands/ussycode-stop";
import {
  handleButton,
  handleModalSubmit,
  handleSelectMenu,
  handleSetLimitButton,
} from "./interactions";
import { deliverPendingVideoJobs } from "../media";
import { AbsoluteQuotaAdapter } from "../quota";
import { saveSharePayload } from "./media-share";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";

const ALERT_CHANNEL_ID =
  process.env.MEDIA_ALERT_CHANNEL_ID?.trim() || process.env.ROUTUSSY_CHANNEL_ID?.trim() || null;

async function resolveAlertChannel(client: Client): Promise<any | null> {
  if (ALERT_CHANNEL_ID) {
    return client.channels.fetch(ALERT_CHANNEL_ID).catch(() => null);
  }

  for (const guildId of getGuildCommandIds()) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;

    const channels = await guild.channels.fetch().catch(() => null);
    const channel = channels
      ?.filter(Boolean)
      .find((candidate) => candidate?.isTextBased() && "name" in candidate && candidate.name === "routussy");

    if (channel) {
      return channel;
    }
  }

  return null;
}

const commands = [
  requestKey,
  setBudget,
  myKeys,
  usage,
  config,
  modelLimits,
  routussyHelp,
  routussyStats,
  generate,
  jobs,
  ussycodeRequest,
  ussycodeSsh,
  ussycodeConfig,
  ussycodeHelp,
  ussycodeQuota,
  ussycodeCapacityRequest,
  ussycodeVms,
  ussycodeStart,
  ussycodeStop,
];

function getGuildCommandIds(): string[] {
  return (process.env.DISCORD_GUILD_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function registerCommands(token: string, clientId: string) {
  const rest = new REST().setToken(token);
  const body = commands.map((c) => c.data.toJSON());

  console.log(`Registering ${body.length} slash commands...`);
  try {
    await rest.put(Routes.applicationCommands(clientId), { body });
  } catch (err) {
    console.error("Failed to register global commands, continuing:", err);
  }
  for (const guildId of getGuildCommandIds()) {
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body,
      });
      console.log(`Registered commands for guild ${guildId}.`);
    } catch (err) {
      console.error(`Failed to register commands for guild ${guildId}, continuing:`, err);
    }
  }
  console.log("Commands registered.");
}

export function createBot(token: string) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  const quota = new AbsoluteQuotaAdapter();

  const loginWithRetry = () => {
    client.login(token).catch((err) => {
      console.error("Discord login failed, retrying in 30s:", err);
      setTimeout(loginWithRetry, 30000);
    });
  };

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        const cmd = commands.find(
          (c) => c.data.name === interaction.commandName
        ) as any;
        if (cmd?.autocomplete) await cmd.autocomplete(interaction);
        return;
      } else if (interaction.isChatInputCommand()) {
        const cmd = commands.find(
          (c) => c.data.name === interaction.commandName
        );
        if (cmd) await cmd.execute(interaction);
      } else if (interaction.isButton()) {
        if (interaction.customId.startsWith("set_limit_modal:")) {
          await handleSetLimitButton(interaction);
        } else {
          await handleButton(interaction);
        }
      } else if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction);
      }
    } catch (err) {
      console.error("Interaction error:", err);
      const reply = {
        content: "Something went wrong.",
        flags: MessageFlags.Ephemeral,
      } as const;

      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      }
    }
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`Bot logged in as ${c.user.tag}`);
    const pollAndDeliver = async () => {
      await deliverPendingVideoJobs(quota, async (job) => {
      const channel = await c.channels.fetch(job.channelId).catch(() => null);
      if (!channel?.isTextBased()) {
        return;
      }

      const shareId = await saveSharePayload({
        userId: job.discordUserId,
        kind: "video",
        title: "Routussy Video",
        description: job.prompt ?? "Generated from source image(s)",
        fields: [
          { name: "Model", value: `\`${job.model}\``, inline: true },
          { name: "Cost", value: `$${(job.costCents / 100).toFixed(2)}`, inline: true },
          { name: "Video URL", value: job.resultUrl },
        ],
        imageUrl: job.coverImageUrl ?? undefined,
        fileUrl: job.resultUrl,
        mediaJobId: job.taskId,
        filename: "routussy-video.mp4",
        createdAt: Date.now(),
      });

      const embed = new EmbedBuilder()
        .setTitle("Video Ready")
        .setColor(0x57f287)
        .setDescription(job.prompt ?? "Generated from source image(s)")
        .addFields(
          { name: "Model", value: `\`${job.model}\``, inline: true },
          { name: "Cost", value: `$${(job.costCents / 100).toFixed(2)}`, inline: true },
          { name: "Video URL", value: job.resultUrl }
        );

      if (job.coverImageUrl) {
        embed.setImage(job.coverImageUrl);
      }

      if (!("send" in channel)) {
        return;
      }

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`share_media:${shareId}`)
          .setLabel("Share Publicly")
          .setStyle(ButtonStyle.Secondary)
      );

      await channel.send({
        content: `<@${job.discordUserId}> your video is ready.`,
        embeds: [embed],
        components: [row],
        allowedMentions: { users: [job.discordUserId] },
      });
      });
    };

    void pollAndDeliver();
    setInterval(() => {
      void pollAndDeliver();
    }, 15000);

    setInterval(async () => {
      try {
        const { listRecentMediaJobs } = await import("../db/media");
        const recent = await listRecentMediaJobs(10);
        const failed = recent.filter(
          (job) =>
            job.status === "failed" &&
            job.error_message &&
            (!job.alerted_at || job.alerted_error !== job.error_message)
        );
        if (failed.length === 0) return;
        const channel = await resolveAlertChannel(c);
        if (!channel?.isTextBased() || !("send" in channel)) return;
        const batch = failed.slice(0, 3);
        await channel.send({
          content:
            "Routussy media job alert:\n" +
            batch
              .map(
                (job) =>
                  `\`${job.task_id}\` ${job.model} failed: ${job.error_message ?? "unknown error"}`
              )
              .join("\n"),
        });
        const { updateMediaJob } = await import("../db/media");
        await Promise.all(
          batch.map((job) =>
            updateMediaJob(job.task_id, {
              alerted_at: new Date().toISOString(),
              alerted_error: job.error_message ?? null,
            })
          )
        );
      } catch (err) {
        console.error("Failed to send media job alert:", err);
      }
    }, 60000);
  });

  loginWithRetry();
  return client;
}
