import { migrate } from "./db";
import { createBot, registerCommands } from "./bot";
import { createProxyRoutes } from "./proxy";
import { AbsoluteQuotaAdapter } from "./quota";
import { ensurePricing } from "./pricing";
import { seedDefaultModelLimits } from "./model-limits/defaults";

const REQUIRED_ENV = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "UPSTREAM_URL",
  "UPSTREAM_API_KEY",
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const PORT = parseInt(process.env.PORT || "3000");
const UPSTREAM_URL = process.env.UPSTREAM_URL!;
const UPSTREAM_API_KEY = process.env.UPSTREAM_API_KEY!;
const UPSTREAM_PREFIX = process.env.UPSTREAM_PREFIX ?? "/v1";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN!;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!;

async function main() {
  console.log("Running migrations...");
  await migrate();

  console.log("Loading pricing data...");
  await ensurePricing();

  console.log("Seeding model concurrency limits...");
  await seedDefaultModelLimits();

  console.log("Registering Discord commands...");
  await registerCommands(DISCORD_TOKEN, DISCORD_CLIENT_ID);

  console.log("Starting Discord bot...");
  createBot(DISCORD_TOKEN);

  const quota = new AbsoluteQuotaAdapter();
  const proxyRoutes = createProxyRoutes({
    upstreamUrl: UPSTREAM_URL,
    upstreamApiKey: UPSTREAM_API_KEY,
    upstreamPrefix: UPSTREAM_PREFIX,
    quota,
  });

  Bun.serve({
    port: PORT,
    routes: {
      ...proxyRoutes,
      "/health": {
        GET: () => Response.json({ status: "ok", timestamp: new Date().toISOString() }),
      },
    },
    fetch(req) {
      return Response.json(
        { error: { message: "Not found", type: "error", code: 404 } },
        { status: 404 }
      );
    },
  });

  console.log(`Routussy proxy listening on port ${PORT}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
