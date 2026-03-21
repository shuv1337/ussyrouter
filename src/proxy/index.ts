import { resolveKey } from "../keys";
import { calculateCostCents, ensurePricing, listModels } from "../pricing";
import type { QuotaAdapter } from "../quota";
import { acquireModelSlot, releaseModelSlot } from "../concurrency";
import {
  extractUsage,
  extractUsageFromSse,
  roughTokenEstimate,
  type ParsedUsage,
} from "./usage";
import { resolveKeyByFingerprint } from "./fingerprint-auth";

export interface ProxyConfig {
  upstreamUrl: string;
  upstreamApiKey: string;
  quota: QuotaAdapter;
  // Path prefix the upstream expects before /chat/completions etc.
  // Defaults to "/v1". Set to "" if the base URL already includes the version.
  upstreamPrefix?: string;
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

function errorResponse(status: number, message: string, type = "error"): Response {
  return Response.json(
    { error: { message, type, code: status } },
    { status }
  );
}

function estimateInputTokens(body: any): number {
  const messages = body?.messages;
  if (Array.isArray(messages)) {
    let chars = 0;
    for (const msg of messages) {
      if (typeof msg?.content === "string") chars += msg.content.length;
    }
    return Math.max(100, Math.ceil(chars / 4));
  }
  if (typeof body?.input === "string") {
    return Math.max(100, Math.ceil(body.input.length / 4));
  }
  return 500;
}

// TransformStream-based streaming proxy matching closedrouter's pattern.
// Uses pipeTo instead of manual reader loop, with a rolling tail buffer for
// usage extraction from the final SSE events.
function buildStreamingTransform(
  onFinish: (accumulated: string) => void
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const TAIL_SIZE = 4096;
  let tail = "";

  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      const text = decoder.decode(chunk, { stream: true });
      tail = (tail + text).slice(-TAIL_SIZE);
    },
    flush() {
      onFinish(tail);
    },
  });
}

function recordUsage(
  usage: ParsedUsage,
  config: ProxyConfig,
  keyId: number,
  userId: string,
  endpoint: string
) {
  const cost = calculateCostCents(
    usage.model,
    usage.inputTokens,
    usage.outputTokens,
    usage.cachedInputTokens,
    usage.cacheWriteInputTokens
  );
  config.quota
    .record(keyId, userId, cost, usage.model, usage.inputTokens, usage.outputTokens, endpoint)
    .catch((err) => console.error("Failed to record usage:", err));
}

function buildModelsResponse(): Response {
  const data = [...listModels().entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([id, spec]) => ({
      id,
      object: "model",
      created: 0,
      owned_by: "z-ai",
      name: spec.name,
      metadata: {
        display_name: spec.name,
        tool_call: spec.tool_call,
        reasoning: spec.reasoning,
        attachment: spec.attachment,
        temperature: spec.temperature,
        interleaved: spec.interleaved ?? null,
        cost: spec.cost,
        limit: spec.limit,
        modalities: spec.modalities ?? null,
      },
    }));

  return Response.json({ object: "list", data });
}

async function handleProxyRequest(
  req: Request,
  config: ProxyConfig,
  endpoint: "completions" | "responses",
  upstreamPath: string
): Promise<Response> {
  const token = extractBearerToken(req);
  if (!token) {
    return errorResponse(401, "Missing API key");
  }

  // Support fingerprint-based auth for ussycode VMs:
  // Bearer token format: "ussycode-fp:<SHA256:fingerprint>"
  const resolved = token.startsWith("ussycode-fp:")
    ? await resolveKeyByFingerprint(token.slice("ussycode-fp:".length))
    : await resolveKey(token);
  if (!resolved) {
    return errorResponse(401, "Invalid API key");
  }
  if (!resolved.active) {
    return errorResponse(403, "API key has been revoked");
  }

  await ensurePricing();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const requestedModel: string = body?.model ?? "unknown";
  const isStreaming = body?.stream === true;

  const estimatedInput = estimateInputTokens(body);
  const estimatedOutput = Math.min(body?.max_tokens ?? 4096, 4096);
  const estimatedCost = calculateCostCents(requestedModel, estimatedInput, estimatedOutput);

  const check = await config.quota.check(resolved.id, estimatedCost);
  if (!check.allowed) {
    return errorResponse(
      429,
      `Quota exceeded: ${check.reason}. Remaining: $${(check.remainingCents / 100).toFixed(2)}`
    );
  }

  const slot = await acquireModelSlot(requestedModel);
  if (!slot.allowed) {
    return errorResponse(
      429,
      `Concurrency limit reached for ${slot.displayName} (${requestedModel}). Active: ${slot.current}/${slot.limit}`
    );
  }

  let released = false;
  const releaseSlot = () => {
    if (released) return;
    released = true;
    releaseModelSlot(requestedModel);
  };

  let upstreamResp: Response;
  try {
    upstreamResp = await fetch(`${config.upstreamUrl}${upstreamPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.upstreamApiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    releaseSlot();
    return errorResponse(502, "Failed to reach upstream provider");
  }

  if (isStreaming && upstreamResp.ok && upstreamResp.body) {
    const transform = buildStreamingTransform((accumulated) => {
      const usage = extractUsageFromSse(accumulated);
      if (usage) {
        recordUsage(usage, config, resolved.id, resolved.userId, endpoint);
      }
    });

    // pipe upstream through our TransformStream - avoids manual reader loop
    // and handles back-pressure properly
    upstreamResp.body.pipeTo(transform.writable).catch((err) => {
      console.error("Stream pipe error:", err);
    }).finally(() => {
      releaseSlot();
    });

    return new Response(transform.readable, {
      status: upstreamResp.status,
      headers: {
        "Content-Type": upstreamResp.headers.get("Content-Type") || "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  let raw: string;
  try {
    raw = await upstreamResp.text();
  } catch {
    releaseSlot();
    return errorResponse(502, "Upstream returned unreadable response");
  }

  releaseSlot();

  if (upstreamResp.ok) {
    const usage = extractUsage(raw);
    if (usage) {
      const cost = calculateCostCents(
        usage.model,
        usage.inputTokens,
        usage.outputTokens,
        usage.cachedInputTokens,
        usage.cacheWriteInputTokens
      );
      try {
        await config.quota.record(
          resolved.id,
          resolved.userId,
          cost,
          usage.model,
          usage.inputTokens,
          usage.outputTokens,
          endpoint
        );
      } catch (err) {
        console.error("Failed to record usage:", err);
      }
    } else {
      // no usage block - use rough estimate as fallback
      const fallbackOutput = roughTokenEstimate(raw);
      const fallbackCost = calculateCostCents(requestedModel, estimatedInput, fallbackOutput);
      try {
        await config.quota.record(
          resolved.id,
          resolved.userId,
          fallbackCost,
          requestedModel,
          estimatedInput,
          fallbackOutput,
          endpoint
        );
      } catch (err) {
        console.error("Failed to record fallback usage:", err);
      }
    }
  }

  const respHeaders = new Headers();
  respHeaders.set("Content-Type", "application/json");

  for (const h of [
    "x-ratelimit-limit-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-remaining-tokens",
  ]) {
    const v = upstreamResp.headers.get(h);
    if (v) respHeaders.set(h, v);
  }

  return new Response(raw, {
    status: upstreamResp.status,
    headers: respHeaders,
  });
}

export function createProxyRoutes(config: ProxyConfig) {
  const prefix = config.upstreamPrefix ?? "/v1";

  return {
    "/v1/chat/completions": {
      POST: (req: Request) =>
        handleProxyRequest(req, config, "completions", `${prefix}/chat/completions`),
    },
    "/v1/completions": {
      POST: (req: Request) =>
        handleProxyRequest(req, config, "completions", `${prefix}/completions`),
    },
    "/v1/responses": {
      POST: (req: Request) =>
        handleProxyRequest(req, config, "responses", `${prefix}/responses`),
    },
    "/v1/models": {
      GET: async () => {
        await ensurePricing();

        if (listModels().size > 0) {
          return buildModelsResponse();
        }

        const resp = await fetch(`${config.upstreamUrl}${prefix}/models`, {
          headers: { Authorization: `Bearer ${config.upstreamApiKey}` },
        });
        return new Response(resp.body, {
          status: resp.status,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  };
}
