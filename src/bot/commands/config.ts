import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { listModels, ensurePricing, type ModelSpec } from "../../pricing";

const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || "3000"}`).replace(/\/$/, "");
const API_BASE = `${PUBLIC_URL}/v1`;

function specToProviderModel(spec: ModelSpec): object {
  return {
    name: spec.name,
    tool_call: spec.tool_call,
    reasoning: spec.reasoning,
    attachment: spec.attachment,
    temperature: spec.temperature,
    ...(spec.interleaved ? { interleaved: spec.interleaved } : {}),
    cost: spec.cost,
    limit: spec.limit,
  };
}

function getDefaultModel(): string {
  return listModels().keys().next().value ?? "glm-4.5";
}

function getSmallModel(): string {
  if (listModels().has("glm-4.5-flash")) return "glm-4.5-flash";
  return getDefaultModel();
}

function buildOpencodeSnippet(): string {
  const models: Record<string, object> = {};
  for (const [id, spec] of listModels()) {
    models[id] = specToProviderModel(spec);
  }

  return JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      provider: {
        zai: {
          options: {
            baseURL: API_BASE,
            apiKey: "YOUR_ROUTUSSY_API_KEY",
          },
          models,
        },
      },
      model: `zai/${getDefaultModel()}`,
      small_model: `zai/${getSmallModel()}`,
    },
    null,
    2
  );
}

function buildOpenAiSnippet(model: string): string {
  return [
    `Base URL: ${API_BASE}`,
    "Auth: Bearer <your ROUTUSSY_API_KEY>",
    "Compatible endpoints:",
    `- GET ${API_BASE}/models`,
    `- POST ${API_BASE}/chat/completions`,
    `- POST ${API_BASE}/completions`,
    `- POST ${API_BASE}/responses`,
    "",
    "Example request body:",
    "```json",
    JSON.stringify(
      {
        model,
        messages: [{ role: "user", content: "Hello!" }],
      },
      null,
      2
    ),
    "```",
  ].join("\n");
}

function buildJavaScriptSnippet(model: string): string {
  return `\
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.ROUTUSSY_API_KEY,
  baseURL: "${API_BASE}",
});

const response = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0]?.message?.content);
`;
}

function buildPythonSnippet(model: string): string {
  return `\
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_ROUTUSSY_API_KEY",
    base_url="${API_BASE}",
)

response = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(response.choices[0].message.content)
`;
}

function buildCurlSnippet(model: string): string {
  return `\
curl ${API_BASE}/chat/completions \\
  -H "Authorization: Bearer $ROUTUSSY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
`;
}

function buildEndpointsSnippet(): string {
  return [
    `Public base URL: ${PUBLIC_URL}`,
    `API base URL: ${API_BASE}`,
    "Useful endpoints:",
    `- ${PUBLIC_URL}/health`,
    `- ${API_BASE}/models`,
    `- ${API_BASE}/chat/completions`,
    `- ${API_BASE}/completions`,
    `- ${API_BASE}/responses`,
    "Use your generated Routussy key as the Bearer token.",
  ].join("\n");
}

async function replyWithSnippet(
  interaction: ChatInputCommandInteraction,
  content: string,
  filename: string,
  preface: string
) {
  if (content.length > 1800) {
    await interaction.reply({
      content: preface,
      files: [{ attachment: Buffer.from(content), name: filename }],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `${preface}\n\n${content.includes("```") ? content : `\`\`\`\n${content}\n\`\`\``}`,
    flags: MessageFlags.Ephemeral,
  });
}

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Get a client config snippet for this proxy")
  .addStringOption((opt) =>
    opt
      .setName("format")
      .setDescription("What kind of config do you want?")
      .setRequired(true)
      .addChoices(
        { name: "OpenCode", value: "opencode" },
        { name: "OpenAI Compatible", value: "openai" },
        { name: "JavaScript (OpenAI SDK)", value: "javascript" },
        { name: "Python (OpenAI SDK)", value: "python" },
        { name: "cURL Example", value: "curl" },
        { name: "Endpoints / Base URL", value: "endpoints" }
      )
  )
  .addStringOption((opt) =>
    opt
      .setName("model")
      .setDescription("Optional model id for examples, e.g. glm-4.5")
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await ensurePricing();
  const format = interaction.options.getString("format", true);
  const model = interaction.options.getString("model")?.trim() || getDefaultModel();

  if (format === "opencode") {
    await replyWithSnippet(
      interaction,
      buildOpencodeSnippet(),
      "opencode.json",
      "Add this to `opencode.json`, replace `YOUR_ROUTUSSY_API_KEY`, and OpenCode will use its official `zai` provider pointed at Routussy."
    );
    return;
  }

  if (format === "openai") {
    await replyWithSnippet(
      interaction,
      buildOpenAiSnippet(model),
      "routussy-openai-compatible.txt",
      "Use Routussy as an OpenAI-compatible API with your generated API key."
    );
    return;
  }

  if (format === "javascript") {
    await replyWithSnippet(
      interaction,
      `\`\`\`ts\n${buildJavaScriptSnippet(model)}\n\`\`\``,
      "routussy-openai.ts",
      "JavaScript example using the OpenAI SDK:"
    );
    return;
  }

  if (format === "python") {
    await replyWithSnippet(
      interaction,
      `\`\`\`py\n${buildPythonSnippet(model)}\n\`\`\``,
      "routussy-openai.py",
      "Python example using the OpenAI SDK:"
    );
    return;
  }

  if (format === "curl") {
    await replyWithSnippet(
      interaction,
      `\`\`\`bash\n${buildCurlSnippet(model)}\n\`\`\``,
      "routussy-curl.sh",
      "cURL example:"
    );
    return;
  }

  await replyWithSnippet(
    interaction,
    buildEndpointsSnippet(),
    "routussy-endpoints.txt",
    "Connection details:"
  );
}
