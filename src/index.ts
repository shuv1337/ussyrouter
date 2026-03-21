import { migrate } from "./db";
import { createBot, registerCommands } from "./bot";
import { createProxyRoutes } from "./proxy";
import { AbsoluteQuotaAdapter } from "./quota";
import { ensurePricing } from "./pricing";
import { seedDefaultModelLimits } from "./model-limits/defaults";
import { getMediaFilePath } from "./media/storage";
import {
  listAllActiveUssycodeSshKeys,
  getUssycodeUserByFingerprint,
} from "./db/ussycode";

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
const USSYCODE_INTERNAL_KEY = process.env.USSYCODE_INTERNAL_KEY?.trim() || null;

/**
 * Verify that a request to the ussycode internal API is authorized.
 * Uses a shared secret (USSYCODE_INTERNAL_KEY) passed via Bearer token.
 * If no key is configured, the endpoints are open (for local dev).
 */
function verifyUssycodeAuth(req: Request): boolean {
  if (!USSYCODE_INTERNAL_KEY) return true; // no key configured = open access (dev mode)
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token === USSYCODE_INTERNAL_KEY;
}

async function main() {
  console.log("Running migrations...");
  await migrate();

  console.log("Loading pricing data...");
  await ensurePricing();

  console.log("Seeding model concurrency limits...");
  await seedDefaultModelLimits();

  console.log("Registering Discord commands...");
  registerCommands(DISCORD_TOKEN, DISCORD_CLIENT_ID).catch((err) => {
    console.error("Command registration failed, continuing startup:", err);
  });

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
      "/ussycode/authorized-keys": {
        GET: async (req) => {
          if (!verifyUssycodeAuth(req)) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
          }
          try {
            const keys = await listAllActiveUssycodeSshKeys();
            return Response.json({
              keys: keys.map((k) => ({
                ssh_pubkey: k.ssh_pubkey,
                fingerprint: k.fingerprint,
                discord_user_id: k.discord_user_id,
                user_id: k.user_id,
              })),
            });
          } catch (err) {
            console.error("Error listing ussycode SSH keys:", err);
            return Response.json({ error: "Internal error" }, { status: 500 });
          }
        },
      },
      "/ussycode/user-by-fingerprint": {
        GET: async (req) => {
          if (!verifyUssycodeAuth(req)) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
          }
          const url = new URL(req.url);
          const fingerprint = url.searchParams.get("fingerprint");
          if (!fingerprint) {
            return Response.json(
              { error: "Missing ?fingerprint= query param" },
              { status: 400 }
            );
          }
          try {
            const user = await getUssycodeUserByFingerprint(fingerprint);
            if (!user) {
              return Response.json({ error: "Not found" }, { status: 404 });
            }
            return Response.json({
              user_id: user.user_id,
              discord_id: user.discord_id,
              budget_cents: user.budget_cents,
              spent_cents: user.spent_cents,
              ssh_pubkey: user.ssh_pubkey,
              api_key_prefix: user.key_prefix,
            });
          } catch (err) {
            console.error("Error looking up ussycode user:", err);
            return Response.json({ error: "Internal error" }, { status: 500 });
          }
        },
      },
    },
    fetch(req) {
      const mediaPath = getMediaFilePath(new URL(req.url).pathname);
      if (mediaPath) {
        const file = Bun.file(mediaPath);
        return new Response(file, {
          headers: {
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }

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
