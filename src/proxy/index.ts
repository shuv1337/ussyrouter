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
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

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

// Make an upstream HTTP request using node:http/node:https instead of Bun's
// fetch(). Bun's fetch body stream has a hardcoded idle timeout on .read()
// that kills long-running SSE streams (e.g. during LLM reasoning/tool-use
// pauses where the upstream may be silent for 30+ seconds). Node's HTTP
// client has no such timeout.
function upstreamRequest(
  url: string,
  apiKey: string,
  body: string,
): Promise<{ status: number; headers: Record<string, string>; stream: import("node:stream").Readable }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const fn = isHttps ? httpsRequest : httpRequest;

    const req = fn(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "Accept": "text/event-stream",
        },
        // No socket timeout — we want to wait indefinitely for SSE chunks
      },
      (res) => {
        const hdrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") hdrs[k] = v;
          else if (Array.isArray(v)) hdrs[k] = v.join(", ");
        }
        resolve({ status: res.statusCode ?? 502, headers: hdrs, stream: res });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Convert a Node Readable stream to a web ReadableStream that Bun.serve()
// can actually consume. Uses a pull-based approach with an internal buffer
// because Bun.serve() doesn't properly pull from Readable.toWeb() streams.
function nodeStreamToWebPullBased(
  nodeStream: import("node:stream").Readable,
  onFinish: (tail: string) => void,
  onError: (err: unknown) => void,
  onChunk?: () => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const TAIL_SIZE = 4096;
  let tail = "";
  
  // Internal buffer: node stream pushes data here, pull() drains it
  const pending: Uint8Array[] = [];
  let nodeEnded = false;
  let nodeError: unknown = null;
  let waiting: (() => void) | null = null; // resolve function for pull() awaiting data

  nodeStream.on("data", (chunk: Buffer) => {
    const bytes = new Uint8Array(chunk);
    pending.push(bytes);
    onChunk?.();
    const text = decoder.decode(bytes, { stream: true });
    tail = (tail + text).slice(-TAIL_SIZE);
    // Wake up pull() if it's waiting
    if (waiting) { const w = waiting; waiting = null; w(); }
  });

  nodeStream.on("end", () => {
    nodeEnded = true;
    if (waiting) { const w = waiting; waiting = null; w(); }
  });

  nodeStream.on("error", (err) => {
    nodeError = err;
    if (waiting) { const w = waiting; waiting = null; w(); }
  });

  return new ReadableStream({
    async pull(controller) {
      // Drain any buffered chunks first
      while (pending.length > 0) {
        controller.enqueue(pending.shift()!);
      }
      
      if (nodeEnded) {
        onFinish(tail);
        controller.close();
        return;
      }
      
      if (nodeError) {
        onError(nodeError);
        controller.close();
        return;
      }

      // Wait for more data from the node stream
      await new Promise<void>((resolve) => { waiting = resolve; });
      
      // Drain what arrived
      while (pending.length > 0) {
        controller.enqueue(pending.shift()!);
      }
      
      if (nodeEnded) {
        onFinish(tail);
        controller.close();
        return;
      }
      
      if (nodeError) {
        onError(nodeError);
        controller.close();
        return;
      }
    },
    cancel() {
      nodeStream.destroy();
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

  // For streaming requests, use node:http/node:https to avoid Bun's fetch
  // body stream idle timeout. For non-streaming, Bun's fetch is fine since
  // the body is consumed immediately with .text().
  if (isStreaming) {
    const reqId = Math.random().toString(36).slice(2, 8);
    const t0 = Date.now();
    console.log(`[${reqId}] stream START model=${requestedModel} user=${resolved.userId}`);

    let upstream: { status: number; headers: Record<string, string>; stream: import("node:stream").Readable };
    try {
      upstream = await upstreamRequest(
        `${config.upstreamUrl}${upstreamPath}`,
        config.upstreamApiKey,
        JSON.stringify(body),
      );
    } catch (err) {
      releaseSlot();
      console.error(`[${reqId}] upstream connect failed after ${Date.now() - t0}ms:`, err);
      return errorResponse(502, "Failed to reach upstream provider");
    }

    console.log(`[${reqId}] upstream responded status=${upstream.status} after ${Date.now() - t0}ms`);

    if (upstream.status >= 200 && upstream.status < 300) {
      let chunks = 0;
      const webStream = nodeStreamToWebPullBased(
        upstream.stream,
        (accumulated: string) => {
          console.log(`[${reqId}] stream END chunks=${chunks} elapsed=${Date.now() - t0}ms`);
          const usage = extractUsageFromSse(accumulated);
          if (usage) {
            recordUsage(usage, config, resolved.id, resolved.userId, endpoint);
          }
          releaseSlot();
        },
        (err: unknown) => {
          console.error(`[${reqId}] stream ERROR chunks=${chunks} elapsed=${Date.now() - t0}ms:`, err);
          releaseSlot();
        },
        () => { chunks++; }, // onChunk counter
      );

      return new Response(webStream, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers["content-type"] || "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // Non-2xx streaming response — read full body and return as error
    const chunks: Buffer[] = [];
    for await (const chunk of upstream.stream) {
      chunks.push(chunk);
    }
    releaseSlot();
    const raw = Buffer.concat(chunks).toString();
    return new Response(raw, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Non-streaming path: use Bun's fetch (no idle timeout issue since body
  // is consumed immediately)
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
