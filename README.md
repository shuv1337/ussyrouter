# routussy

Routussy is a Discord-managed OpenAI-compatible proxy. Admins approve users and set budgets, users create their own API keys, and the proxy enforces spend caps and per-model concurrency limits.

It also serves as the access-control and billing backend for [ussycode](https://github.com/mojomast/ussycode), a self-hosted SSH dev environment platform. Ussycode VMs authenticate to Routussy using SSH fingerprints, so users get LLM access inside their VMs without managing separate API keys.

Hosted endpoint for this deployment:

- Base URL: `https://api.ussyco.de/v1`
- Health check: `https://api.ussyco.de/health`

## Quick Start

```bash
bun install
bun run src/index.ts
```

Or with Docker:

```bash
cp .env.example .env
docker compose up --build
```

The service listens on port `3000` by default.

## Environment Variables

Required:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `UPSTREAM_URL` -- the upstream LLM provider base URL (e.g. Z.AI)
- `UPSTREAM_API_KEY`

Optional:

- `UPSTREAM_PREFIX` -- path prefix on the upstream (default `/v1`)
- `PUBLIC_URL` -- your external HTTPS URL so `/config` returns usable client snippets
- `ADMIN_REVIEW_CHANNEL_ID` -- where access requests are posted for admin review
- `MEDIA_ALERT_CHANNEL_ID` -- where media job failure alerts go
- `ROUTUSSY_CHANNEL_ID` -- fallback channel for requests and alerts
- `DISCORD_GUILD_IDS` -- comma-separated guild IDs for instant slash command registration
- `DATABASE_PATH` -- SQLite database location
- `GITHUB_TOKEN` -- for GitHub-related features
- `USSYCODE_INTERNAL_KEY` -- shared secret for ussycode internal API endpoints

## How It Works

### User Flow

1. New users run `/routussy-help` to learn the ropes
2. Users request access with `/request-key`, which posts to the admin review channel
3. Admins approve and set a budget from the request embed
4. Approved users create and manage their keys from `/my-keys`
5. Users point any OpenAI-compatible client at the proxy using their key
6. Routussy enforces per-user budget caps, per-model concurrency limits, and logs all usage

### Proxy

Routussy is a transparent OpenAI-compatible proxy. Any client that speaks the OpenAI API protocol works -- OpenCode, Cursor, Aider, Python/JS SDKs, raw cURL.

Keys use the `rsy-` prefix and are stored as SHA-256 hashes. The key is shown exactly once at creation time.

### Quota Enforcement

Three tiers of budget enforcement:

1. **Server-wide** -- optional global cap shared by all users (`/set-budget global`)
2. **Per-user** -- each user has an individual budget (`/set-budget user`)
3. **Per-key** -- each key can have its own sub-budget

Requests that would exceed any tier are rejected with HTTP 402.

## Discord Commands

### User Commands

| Command | Description |
|---|---|
| `/routussy-help` | How to get started |
| `/request-key` | Request access or additional budget |
| `/my-keys` | Create, list, and revoke your API keys |
| `/usage me` | Inspect your usage breakdown |
| `/config` | Get client config snippets (OpenCode, cURL, Python, JS, etc.) |
| `/generate image` | Generate Z.AI images |
| `/generate video` | Generate Z.AI videos (async, posts result when done) |
| `/generate ocr` | Extract text from images/PDFs with GLM-OCR |
| `/generate transcribe` | Transcribe audio with GLM-ASR |

### Admin Commands

| Command | Description |
|---|---|
| `/set-budget user` | Set or override a user's total budget |
| `/set-budget global` | Set the server-wide budget cap |
| `/set-budget global-view` | View server-wide budget status |
| `/set-budget global-clear` | Remove the server-wide budget cap |
| `/model-limits` | Manage per-model concurrency limits |
| `/routussy-stats` | Server or per-user stats |
| `/jobs` | Recent media job status |

### Ussycode Commands

| Command | Description |
|---|---|
| `/ussycode-request` | Request ussycode access (requires SSH public key) |
| `/ussycode-ssh` | Manage SSH keys after approval (add/remove/list) |
| `/ussycode-config` | View connection details and OpenCode config |

## Ussycode Integration

Routussy is the access-control and billing backend for [ussycode](https://github.com/mojomast/ussycode). The integration works as follows:

### Onboarding

1. A user runs `/ussycode-request` in Discord, providing their SSH public key
2. The request goes to the admin review channel for approval
3. On approval, Routussy stores the SSH public key in `ussycode_ssh_keys` and creates a hidden `ussycode-system` API key for the user
4. The user can now SSH into ussycode and their VM gets automatic LLM access

### SSH Authentication

Ussycode's SSH gateway calls Routussy's internal API to validate non-Tailscale connections:

- `GET /ussycode/authorized-keys` -- returns all approved SSH public keys (used by the SSH gateway to decide whether to allow a connection)
- `GET /ussycode/user-by-fingerprint?fingerprint=SHA256:...` -- resolves an SSH fingerprint to a Routussy user (used for billing attribution)

Both endpoints are secured with the `USSYCODE_INTERNAL_KEY` shared secret via Bearer token.

### Fingerprint-Based Proxy Auth

VMs inside ussycode authenticate to Routussy's LLM proxy using a special bearer token format:

```
Authorization: Bearer ussycode-fp:SHA256:<fingerprint>
```

When Routussy sees this prefix, it resolves the fingerprint to the user's `ussycode-system` key and charges usage against their budget. This means users never need to manually copy API keys into their VMs -- the SSH fingerprint is the identity.

### Data Flow

```
User SSHs into ussycode VM
  -> VM has OPENCODE_API_KEY=ussycode-fp:SHA256:<fingerprint>
  -> OpenCode sends requests to api.ussyco.de/v1 with that token
  -> Routussy resolves fingerprint -> user -> ussycode-system key
  -> Request proxied to upstream, usage charged to user's budget
```

### Database Tables

Routussy has two ussycode-specific tables:

- `ussycode_requests` -- tracks access requests and their approval status
- `ussycode_ssh_keys` -- stores approved SSH public keys and fingerprints, linked to Routussy users

## Model Concurrency Limits

- Default limits seeded on startup from `src/model-limits/defaults.ts`
- Display names come from the models.dev pricing cache when available
- Requests over a model's concurrent cap return HTTP 429
- Manage with `/model-limits list`, `/model-limits set`, `/model-limits remove`

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **Discord**: discord.js v14
- **Database**: SQLite via Kysely
- **Deployment**: Docker (see `docker-compose.yml`)
- **Upstream**: Z.AI GLM models (glm-4.5 through glm-5-turbo)

## Project Structure

```
src/
  index.ts              Bun.serve() entry point, routes, ussycode API endpoints
  bot/
    index.ts            Discord bot setup
    interactions.ts     Button/modal interaction handlers (including ussycode approve/deny)
    media-share.ts      Persistent share buttons for generated media
    commands/            Slash command definitions
  proxy/
    index.ts            OpenAI-compatible proxy with quota enforcement
    fingerprint-auth.ts Ussycode fingerprint -> API key resolution
    usage.ts            Usage logging
  db/
    index.ts            Migrations and connection
    schema.ts           Kysely table types (10 tables)
    users.ts            User/key/quota queries
    ussycode.ts         Ussycode-specific queries
    media.ts            Media job queries
    model-limits.ts     Concurrency limit queries
  ussycode/
    keys.ts             Ussycode system key helpers
    ssh.ts              SSH fingerprint utilities
  quota/                3-tier budget enforcement
  pricing/              models.dev pricing cache
  concurrency/          Per-model concurrency tracking
  media/                Media generation and storage
  model-limits/         Default concurrency limit seeds
```

## Credits

Built by [blong](https://github.com/belohnung) ([@belohnung](https://github.com/belohnung)).

Part of [The Ussyverse](https://ussy.host).

## License

[MIT](LICENSE)
