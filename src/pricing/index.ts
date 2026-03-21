// Fetches and caches model specs from models.dev (zai provider)
// Costs in the TOML are per 1M tokens in USD

const GITHUB_RAW =
  "https://raw.githubusercontent.com/sst/models.dev/refs/heads/dev/providers/zai/models";
const MODEL_LIST_API =
  "https://api.github.com/repos/sst/models.dev/contents/providers/zai/models";

export interface ModelCost {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export interface ModelLimit {
  context: number;
  output: number;
}

export interface ModelSpec {
  name: string;
  tool_call: boolean;
  reasoning: boolean;
  attachment: boolean;
  temperature: boolean;
  interleaved?: { field: string };
  cost: ModelCost;
  limit: ModelLimit;
  modalities?: { input: string[]; output: string[] };
}

const cache = new Map<string, ModelSpec>();
let lastFetch = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour
const FETCH_TIMEOUT_MS = 8000;
const FALLBACK_MODELS: Record<string, ModelSpec> = {
  "glm-4.5": {
    name: "GLM-4.5",
    tool_call: true,
    reasoning: true,
    attachment: false,
    temperature: true,
    cost: { input: 0.6, output: 2.2, cache_read: 0.15, cache_write: 0.6 },
    limit: { context: 128000, output: 16384 },
    modalities: { input: ["text"], output: ["text"] },
  },
  "glm-4.5-flash": {
    name: "GLM-4.5-Flash",
    tool_call: true,
    reasoning: false,
    attachment: false,
    temperature: true,
    cost: { input: 0.2, output: 0.8, cache_read: 0.05, cache_write: 0.2 },
    limit: { context: 128000, output: 8192 },
    modalities: { input: ["text"], output: ["text"] },
  },
  "glm-5-turbo": {
    name: "GLM-5-Turbo",
    tool_call: true,
    reasoning: true,
    attachment: false,
    temperature: true,
    cost: { input: 0.8, output: 3.0, cache_read: 0.2, cache_write: 0.8 },
    limit: { context: 128000, output: 16384 },
    modalities: { input: ["text"], output: ["text"] },
  },
  "glm-image": {
    name: "GLM-Image",
    tool_call: false,
    reasoning: false,
    attachment: false,
    temperature: true,
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    limit: { context: 0, output: 0 },
    modalities: { input: ["text"], output: ["image"] },
  },
  "glm-ocr": {
    name: "GLM-OCR",
    tool_call: false,
    reasoning: false,
    attachment: true,
    temperature: false,
    cost: { input: 0.6, output: 2.2, cache_read: 0, cache_write: 0 },
    limit: { context: 128000, output: 8192 },
    modalities: { input: ["image", "pdf"], output: ["text"] },
  },
  "glm-asr-2512": {
    name: "GLM-ASR-2512",
    tool_call: false,
    reasoning: false,
    attachment: true,
    temperature: false,
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    limit: { context: 0, output: 0 },
    modalities: { input: ["audio"], output: ["text"] },
  },
  "viduq1-text": {
    name: "ViduQ1-text",
    tool_call: false,
    reasoning: false,
    attachment: false,
    temperature: true,
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    limit: { context: 0, output: 0 },
    modalities: { input: ["text"], output: ["video"] },
  },
  "viduq1-image": {
    name: "ViduQ1-image",
    tool_call: false,
    reasoning: false,
    attachment: true,
    temperature: true,
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    limit: { context: 0, output: 0 },
    modalities: { input: ["image"], output: ["video"] },
  },
  "viduq1-start-end": {
    name: "ViduQ1-Start-End",
    tool_call: false,
    reasoning: false,
    attachment: true,
    temperature: true,
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    limit: { context: 0, output: 0 },
    modalities: { input: ["image"], output: ["video"] },
  },
  "cogvideox-3": {
    name: "CogVideoX-3",
    tool_call: false,
    reasoning: false,
    attachment: true,
    temperature: true,
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    limit: { context: 0, output: 0 },
    modalities: { input: ["text", "image"], output: ["video"] },
  },
};

function ensureFallbackModels() {
  if (cache.size > 0) return;
  for (const [id, spec] of Object.entries(FALLBACK_MODELS)) {
    cache.set(id, spec);
  }
  lastFetch = Date.now();
  console.log(`Loaded fallback model cache: ${cache.size} models`);
}

function parseToml(raw: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentSection: string | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch?.[1]) {
      currentSection = sectionMatch[1];
      result[currentSection] = result[currentSection] || {};
      continue;
    }

    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch?.[1] && kvMatch[2]) {
      const key = kvMatch[1];
      let value: any = kvMatch[2].trim();

      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (value.startsWith('"') && value.endsWith('"'))
        value = value.slice(1, -1);
      else if (value.startsWith("[")) {
        value = value
          .slice(1, -1)
          .split(",")
          .map((v: string) => v.trim().replace(/"/g, ""))
          .filter(Boolean);
      } else {
        const num = Number(value.replace(/_/g, ""));
        if (!isNaN(num)) value = num;
      }

      if (currentSection) {
        result[currentSection][key] = value;
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

async function fetchModelList(): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(MODEL_LIST_API, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    console.error("Failed to fetch model list:", err);
    return [];
  }
  clearTimeout(timeout);

  if (!resp.ok) {
    console.error(`Failed to fetch model list: ${resp.status}`);
    return [];
  }

  const items = (await resp.json()) as { name: string }[];
  return items
    .filter((i) => i.name.endsWith(".toml"))
    .map((i) => i.name.replace(".toml", ""));
}

async function fetchModelSpec(modelId: string): Promise<ModelSpec | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(`${GITHUB_RAW}/${modelId}.toml`, {
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    return null;
  }
  clearTimeout(timeout);
  if (!resp.ok) return null;

  const raw = await resp.text();
  const p = parseToml(raw);

  if (!p.cost || !p.limit) return null;

  return {
    name: p.name || modelId,
    tool_call: p.tool_call ?? false,
    reasoning: p.reasoning ?? false,
    attachment: p.attachment ?? false,
    temperature: p.temperature ?? false,
    ...(p.interleaved?.field ? { interleaved: { field: p.interleaved.field } } : {}),
    cost: {
      input: p.cost.input ?? 0,
      output: p.cost.output ?? 0,
      cache_read: p.cost.cache_read ?? 0,
      cache_write: p.cost.cache_write ?? 0,
    },
    limit: {
      context: p.limit.context ?? 128000,
      output: p.limit.output ?? 8192,
    },
    ...(p.modalities ? { modalities: p.modalities } : {}),
  };
}

export async function refreshPricing(): Promise<void> {
  const modelIds = await fetchModelList();
  if (modelIds.length === 0) {
    ensureFallbackModels();
    return;
  }
  const results = await Promise.allSettled(
    modelIds.map((id) => fetchModelSpec(id).then((s) => [id, s] as const))
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value[1]) {
      cache.set(result.value[0], result.value[1]);
    }
  }

  lastFetch = Date.now();
  console.log(`Model cache loaded: ${cache.size} models`);
}

export async function ensurePricing(): Promise<void> {
  if (Date.now() - lastFetch > CACHE_TTL || cache.size === 0) {
    try {
      await refreshPricing();
    } catch (err) {
      console.error("Pricing refresh failed, using fallback model cache:", err);
      ensureFallbackModels();
    }
  }
}

export function getModelSpec(modelId: string): ModelSpec | null {
  return cache.get(modelId) || null;
}

export function listModels(): Map<string, ModelSpec> {
  return cache;
}

// 4-tier cost calculation matching closedrouter's approach:
// cache tokens are subtracted from input to avoid double-billing
export function calculateCostCents(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number {
  const spec = cache.get(modelId);
  if (!spec) {
    const inputCost = (inputTokens / 1_000_000) * 10;
    const outputCost = (outputTokens / 1_000_000) * 30;
    return Math.ceil((inputCost + outputCost) * 100);
  }

  const uncachedInput = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);
  const inputCost = (uncachedInput / 1_000_000) * spec.cost.input;
  const outputCost = (outputTokens / 1_000_000) * spec.cost.output;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * spec.cost.cache_read;
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * spec.cost.cache_write;

  return Math.ceil((inputCost + outputCost + cacheReadCost + cacheWriteCost) * 100);
}
