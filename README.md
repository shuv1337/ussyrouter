# routussy

Routussy is a Discord-managed OpenAI-compatible proxy. Admins approve users and set budgets, users create their own API keys, and the proxy enforces spend caps and per-model concurrency limits.

To install dependencies:

```bash
bun install
```

To run locally:

```bash
bun run src/index.ts
```

Hosted endpoint for this deployment:

- Base URL: `https://api.ussyco.de/v1`
- Health check: `https://api.ussyco.de/health`

To run in Docker:

```bash
cp .env.example .env
docker compose up --build
```

The service listens on port `3000` by default. Configure the required env vars in `.env` first:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `UPSTREAM_URL`
- `UPSTREAM_API_KEY`

Optional:

- `UPSTREAM_PREFIX`
- `PUBLIC_URL`
- `ADMIN_REVIEW_CHANNEL_ID`
- `DISCORD_GUILD_IDS`
- `DATABASE_PATH`
- `GITHUB_TOKEN`

If you are running a public deployment, set `PUBLIC_URL` to your external HTTPS URL so `/config` returns usable client snippets.

If you want new slash commands to appear immediately in your server instead of waiting for global propagation, set `DISCORD_GUILD_IDS` to a comma-separated list of guild ids.

User flow:

- New users can start with `/routussy-help`
- Users request access with `/request-key`
- Approved users can also use `/request-key` again to request additional budget
- New access requests are posted to `ADMIN_REVIEW_CHANNEL_ID` when set, otherwise to the same channel where the request was made
- New access requests ping all roles with Discord `Administrator`; if no admin role exists, the server owner is pinged instead
- Request embeds show the user's current budget and remaining spend before review
- Admins approve access from the request message and can edit the approved budget before confirming
- Admins can still set or override a user's total budget with `/set-budget user`
- Approved users create and manage their keys from `/my-keys`
- Users can inspect usage with `/usage me`

Config snippets:

- `/config format:OpenCode` returns a full `opencode.json` snippet that points OpenCode's official `zai` provider at Routussy with an inline `apiKey`
- `/config format:OpenAI Compatible` returns base URL and endpoint details
- `/config format:JavaScript (OpenAI SDK)` returns a JS example
- `/config format:Python (OpenAI SDK)` returns a Python example
- `/config format:cURL Example` returns a curl request
- `/config format:Endpoints / Base URL` returns the public URLs
- Most formats accept an optional `model` argument for tailored examples

Admin commands:

- `/set-budget user` sets or overrides a user's total budget
- `/set-budget global` sets the server-wide API budget cap shared by everyone
- `/set-budget global-view` shows the current server-wide API budget, spent amount, and remaining amount
- `/set-budget global-clear` removes the server-wide API budget cap
- `/model-limits` manages per-model concurrency limits
- `/routussy-stats` posts public server stats including allocated budget, spend, tokens, and model usage
- `/routussy-stats target:@user` posts a public per-user breakdown with budget, remaining spend, calls, keys, and top models

User commands:

- `/routussy-help` explains how to request access, create a key, connect a client, check usage, and includes a thank-you plus coding-plan link for Z.AI
- `/generate image` creates Z.AI images, auto-uploads them into Discord, and charges the result against the user's Routussy budget
- `/generate video` creates Z.AI videos, returns the generated URL plus cover image, and charges the result against the user's Routussy budget
- `/generate ocr` extracts text from an image or PDF with GLM-OCR and charges the result against the user's Routussy budget
- `/generate transcribe` transcribes a WAV or MP3 clip with GLM-ASR-2512 and charges the result against the user's Routussy budget
- Generated image/video/OCR/transcription results include a `Share Publicly` button for the original requester

Model concurrency limits:

- Default limits are seeded on startup from `src/model-limits/defaults.ts` using models.dev model ids as the keys.
- Display names come from the models.dev pricing cache when available.
- Requests over a model's configured concurrent cap return HTTP `429`.
- Use `/model-limits list` to inspect current limits.
- Use `/model-limits set model:<models.dev-id> limit:<number>` to change one later.
- Use `/model-limits remove model:<models.dev-id>` to delete a custom limit.

This project was created using `bun init` in bun v1.3.10. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
