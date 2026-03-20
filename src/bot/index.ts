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
import {
  handleButton,
  handleModalSubmit,
  handleSelectMenu,
  handleSetLimitButton,
} from "./interactions";

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
  await rest.put(Routes.applicationCommands(clientId), { body });
  for (const guildId of getGuildCommandIds()) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body,
    });
    console.log(`Registered commands for guild ${guildId}.`);
  }
  console.log("Commands registered.");
}

export function createBot(token: string) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
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
  });

  client.login(token);
  return client;
}
