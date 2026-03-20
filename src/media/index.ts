import { acquireModelSlot, releaseModelSlot } from "../concurrency";
import { createMediaJob, getMediaJobByTaskId, listPendingMediaJobs, updateMediaJob } from "../db/media";
import { getOrCreateSystemKey } from "../keys";
import { calculateCostCents } from "../pricing";
import type { QuotaAdapter } from "../quota";

const ZAI_BASE = (process.env.UPSTREAM_URL || "https://api.z.ai/api").replace(/\/$/, "");
const ZAI_PREFIX = process.env.UPSTREAM_PREFIX ?? "/paas/v4";
const ZAI_API_KEY = process.env.UPSTREAM_API_KEY || "";

const IMAGE_MODEL_COSTS_USD: Record<string, number> = {
  "glm-image": 0.015,
  "cogview-4-250304": 0.01,
};

const VIDEO_MODEL_COSTS_USD: Record<string, number> = {
  "cogvideox-3": 0.2,
  "viduq1-text": 0.4,
  "viduq1-image": 0.4,
  "viduq1-start-end": 0.4,
  "vidu2-image": 0.2,
  "vidu2-start-end": 0.2,
  "vidu2-reference": 0.4,
};

interface ZaiErrorPayload {
  message?: string;
  error?: { message?: string };
}

interface ZaiImagePayload extends ZaiErrorPayload {
  data?: Array<{ url?: string }>;
}

interface ZaiVideoStartPayload extends ZaiErrorPayload {
  id?: string;
}

interface ZaiVideoResultPayload extends ZaiErrorPayload {
  task_status?: string;
  video_result?: Array<{ url?: string; cover_image_url?: string }>;
}

interface ZaiOcrPayload extends ZaiErrorPayload {
  model?: string;
  md_results?: string;
  layout_visualization?: string[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

interface ZaiTranscriptionPayload extends ZaiErrorPayload {
  model?: string;
  text?: string;
}

function getZaiErrorMessage(payload: ZaiErrorPayload, fallback: string): string {
  return payload.message || payload.error?.message || fallback;
}

export interface ImageRequest {
  userId: string;
  discordUserId: string;
  prompt: string;
  model: string;
  size?: string;
  quality?: string;
}

export interface ImageResult {
  model: string;
  url: string;
  costCents: number;
}

export interface VideoRequest {
  userId: string;
  discordUserId: string;
  prompt?: string;
  model: string;
  imageUrls?: string[];
  withAudio?: boolean;
  aspectRatio?: string;
  size?: string;
  duration?: number;
  movementAmplitude?: string;
  quality?: string;
  fps?: number;
}

export interface VideoResult {
  model: string;
  url: string;
  coverImageUrl?: string;
  costCents: number;
}

export interface VideoJobRequest extends VideoRequest {
  guildId: string;
  channelId: string;
}

export interface VideoJobResult {
  taskId: string;
  model: string;
  costCents: number;
}

export interface OcrRequest {
  userId: string;
  discordUserId: string;
  fileUrl: string;
  needLayoutVisualization?: boolean;
}

export interface OcrResult {
  model: string;
  markdown: string;
  visualizationUrls: string[];
  costCents: number;
}

export interface TranscriptionRequest {
  userId: string;
  discordUserId: string;
  file: Blob;
  filename: string;
  prompt?: string;
  durationSeconds?: number | null;
}

export interface TranscriptionResult {
  model: string;
  text: string;
  costCents: number;
}

function getImageCostCents(model: string): number {
  return Math.round((IMAGE_MODEL_COSTS_USD[model] ?? 0.02) * 100);
}

function getVideoCostCents(model: string): number {
  return Math.round((VIDEO_MODEL_COSTS_USD[model] ?? 0.5) * 100);
}

function estimateAsrCostCents(durationSeconds?: number | null): number {
  const minutes = Math.max(1 / 60, (durationSeconds ?? 30) / 60);
  return Math.max(1, Math.ceil(minutes * 0.24));
}

async function checkBudget(
  quota: QuotaAdapter,
  userId: string,
  estimatedCostCents: number
): Promise<number> {
  const systemKeyId = await getOrCreateSystemKey(userId);
  const check = await quota.check(systemKeyId, estimatedCostCents);
  if (!check.allowed) {
    throw new Error(
      `Quota exceeded: ${check.reason}. Remaining: $${(check.remainingCents / 100).toFixed(2)}`
    );
  }
  return systemKeyId;
}

async function zaiFetch(path: string, init: RequestInit): Promise<Response> {
  if (!ZAI_API_KEY) {
    throw new Error("Missing UPSTREAM_API_KEY for Z.AI media requests");
  }

  return fetch(`${ZAI_BASE}${ZAI_PREFIX}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ZAI_API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

export async function generateImage(
  quota: QuotaAdapter,
  input: ImageRequest
): Promise<ImageResult> {
  const estimatedCostCents = getImageCostCents(input.model);
  const systemKeyId = await checkBudget(quota, input.userId, estimatedCostCents);
  const slot = await acquireModelSlot(input.model);

  if (!slot.allowed) {
    throw new Error(
      `Concurrency limit reached for ${slot.displayName} (${input.model}). Active: ${slot.current}/${slot.limit}`
    );
  }

  try {
    const resp = await zaiFetch("/images/generations", {
      method: "POST",
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        size: input.size,
        quality: input.quality,
        user_id: input.discordUserId,
      }),
    });

    const payload = (await resp.json()) as ZaiImagePayload;
    if (!resp.ok) {
      throw new Error(getZaiErrorMessage(payload, "Image generation failed"));
    }

    const url = payload?.data?.[0]?.url;
    if (!url) {
      throw new Error("Z.AI did not return an image URL");
    }

    await quota.record(systemKeyId, input.userId, estimatedCostCents, input.model, 0, 0, "image.generate");
    return { model: input.model, url, costCents: estimatedCostCents };
  } finally {
    releaseModelSlot(input.model);
  }
}

async function pollVideoResult(taskId: string): Promise<any> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const resp = await zaiFetch(`/async-result/${taskId}`, { method: "GET" });
    const payload = (await resp.json()) as ZaiVideoResultPayload;

    if (!resp.ok) {
      throw new Error(getZaiErrorMessage(payload, "Failed to fetch video status"));
    }

    if (payload?.task_status === "SUCCESS") {
      return payload;
    }

    if (payload?.task_status === "FAIL") {
      throw new Error(getZaiErrorMessage(payload, "Video generation failed"));
    }

    const waitMs = attempt < 3 ? 2000 : attempt < 12 ? 5000 : 10000;
    await Bun.sleep(waitMs);
  }

  throw new Error("Video generation timed out while waiting for Z.AI");
}

export async function generateVideo(
  quota: QuotaAdapter,
  input: VideoRequest
): Promise<VideoResult> {
  const estimatedCostCents = getVideoCostCents(input.model);
  const systemKeyId = await checkBudget(quota, input.userId, estimatedCostCents);
  const slot = await acquireModelSlot(input.model);

  if (!slot.allowed) {
    throw new Error(
      `Concurrency limit reached for ${slot.displayName} (${input.model}). Active: ${slot.current}/${slot.limit}`
    );
  }

  try {
    const resp = await zaiFetch("/videos/generations", {
      method: "POST",
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        image_url: input.imageUrls,
        with_audio: input.withAudio,
        aspect_ratio: input.aspectRatio,
        size: input.size,
        duration: input.duration,
        movement_amplitude: input.movementAmplitude,
        quality: input.quality,
        fps: input.fps,
        user_id: input.discordUserId,
      }),
    });

    const payload = (await resp.json()) as ZaiVideoStartPayload;
    if (!resp.ok) {
      throw new Error(getZaiErrorMessage(payload, "Video generation failed"));
    }

    const taskId = payload?.id;
    if (!taskId) {
      throw new Error("Z.AI did not return a video task id");
    }

    const result = await pollVideoResult(taskId);
    const video = result?.video_result?.[0];
    if (!video?.url) {
      throw new Error("Z.AI did not return a generated video URL");
    }

    await quota.record(systemKeyId, input.userId, estimatedCostCents, input.model, 0, 0, "video.generate");
    return {
      model: input.model,
      url: video.url,
      coverImageUrl: video.cover_image_url,
      costCents: estimatedCostCents,
    };
  } finally {
    releaseModelSlot(input.model);
  }
}

export async function startVideoJob(
  quota: QuotaAdapter,
  input: VideoJobRequest
): Promise<VideoJobResult> {
  const estimatedCostCents = getVideoCostCents(input.model);
  const systemKeyId = await checkBudget(quota, input.userId, estimatedCostCents);
  const slot = await acquireModelSlot(input.model);

  if (!slot.allowed) {
    throw new Error(
      `Concurrency limit reached for ${slot.displayName} (${input.model}). Active: ${slot.current}/${slot.limit}`
    );
  }

  try {
    const resp = await zaiFetch("/videos/generations", {
      method: "POST",
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        image_url: input.imageUrls,
        with_audio: input.withAudio,
        aspect_ratio: input.aspectRatio,
        size: input.size,
        duration: input.duration,
        movement_amplitude: input.movementAmplitude,
        quality: input.quality,
        fps: input.fps,
        user_id: input.discordUserId,
      }),
    });

    const payload = (await resp.json()) as ZaiVideoStartPayload;
    if (!resp.ok) {
      throw new Error(getZaiErrorMessage(payload, "Video generation failed"));
    }

    const taskId = payload?.id;
    if (!taskId) {
      throw new Error("Z.AI did not return a video task id");
    }

    await createMediaJob({
      id: crypto.randomUUID(),
      task_id: taskId,
      kind: "video",
      status: "queued",
      billed: 0,
      user_id: input.userId,
      discord_user_id: input.discordUserId,
      guild_id: input.guildId,
      channel_id: input.channelId,
      system_key_id: systemKeyId,
      model: input.model,
      prompt: input.prompt ?? null,
      cost_cents: estimatedCostCents,
      result_url: null,
      cover_image_url: null,
      error_message: null,
    });

    return { taskId, model: input.model, costCents: estimatedCostCents };
  } finally {
    releaseModelSlot(input.model);
  }
}

export async function parseLayout(
  quota: QuotaAdapter,
  input: OcrRequest
): Promise<OcrResult> {
  const estimatedCostCents = 1;
  const systemKeyId = await checkBudget(quota, input.userId, estimatedCostCents);
  const slot = await acquireModelSlot("glm-ocr");

  if (!slot.allowed) {
    throw new Error(
      `Concurrency limit reached for ${slot.displayName} (glm-ocr). Active: ${slot.current}/${slot.limit}`
    );
  }

  try {
    const resp = await zaiFetch("/layout_parsing", {
      method: "POST",
      body: JSON.stringify({
        model: "glm-ocr",
        file: input.fileUrl,
        need_layout_visualization: input.needLayoutVisualization ?? true,
        user_id: input.discordUserId,
      }),
    });

    const payload = (await resp.json()) as ZaiOcrPayload;
    if (!resp.ok) {
      throw new Error(getZaiErrorMessage(payload, "OCR request failed"));
    }

    const usage = payload.usage;
    const costCents = usage
      ? calculateCostCents(
          "glm-ocr",
          usage.prompt_tokens ?? 0,
          usage.completion_tokens ?? 0,
          usage.prompt_tokens_details?.cached_tokens ?? 0,
          0
        )
      : estimatedCostCents;

    await quota.record(
      systemKeyId,
      input.userId,
      costCents,
      "glm-ocr",
      usage?.prompt_tokens ?? 0,
      usage?.completion_tokens ?? 0,
      "ocr.parse"
    );

    return {
      model: payload.model ?? "glm-ocr",
      markdown: payload.md_results ?? "",
      visualizationUrls: payload.layout_visualization ?? [],
      costCents,
    };
  } finally {
    releaseModelSlot("glm-ocr");
  }
}

export async function transcribeAudio(
  quota: QuotaAdapter,
  input: TranscriptionRequest
): Promise<TranscriptionResult> {
  const estimatedCostCents = estimateAsrCostCents(input.durationSeconds);
  const systemKeyId = await checkBudget(quota, input.userId, estimatedCostCents);
  const slot = await acquireModelSlot("glm-asr-2512");

  if (!slot.allowed) {
    throw new Error(
      `Concurrency limit reached for ${slot.displayName} (glm-asr-2512). Active: ${slot.current}/${slot.limit}`
    );
  }

  try {
    const form = new FormData();
    form.set("model", "glm-asr-2512");
    form.set("file", input.file, input.filename);
    form.set("stream", "false");
    form.set("user_id", input.discordUserId);
    if (input.prompt) {
      form.set("prompt", input.prompt);
    }

    const resp = await fetch(`${ZAI_BASE}${ZAI_PREFIX}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ZAI_API_KEY}`,
      },
      body: form,
    });

    const payload = (await resp.json()) as ZaiTranscriptionPayload;
    if (!resp.ok) {
      throw new Error(getZaiErrorMessage(payload, "Audio transcription failed"));
    }

    await quota.record(
      systemKeyId,
      input.userId,
      estimatedCostCents,
      "glm-asr-2512",
      0,
      0,
      "audio.transcription"
    );

    return {
      model: payload.model ?? "glm-asr-2512",
      text: payload.text ?? "",
      costCents: estimatedCostCents,
    };
  } finally {
    releaseModelSlot("glm-asr-2512");
  }
}

export async function checkVideoJobStatus(taskId: string): Promise<{
  done: boolean;
  url?: string;
  coverImageUrl?: string;
  error?: string;
}> {
  const resp = await zaiFetch(`/async-result/${taskId}`, { method: "GET" });
  const payload = (await resp.json()) as ZaiVideoResultPayload;

  if (!resp.ok) {
    throw new Error(getZaiErrorMessage(payload, "Failed to fetch video status"));
  }

  if (payload.task_status === "PROCESSING") {
    return { done: false };
  }

  if (payload.task_status === "FAIL") {
    return { done: true, error: getZaiErrorMessage(payload, "Video generation failed") };
  }

  const video = payload?.video_result?.[0];
  if (!video?.url) {
    return { done: true, error: "Z.AI did not return a generated video URL" };
  }

  return {
    done: true,
    url: video.url,
    coverImageUrl: video.cover_image_url,
  };
}

export async function getFreshVideoAsset(taskId: string): Promise<{
  status: "ready" | "processing" | "failed";
  url?: string;
  coverImageUrl?: string;
  error?: string;
}> {
  const status = await checkVideoJobStatus(taskId);
  if (!status.done) {
    return { status: "processing" };
  }
  if (status.error || !status.url) {
    return { status: "failed", error: status.error ?? "Video generation failed" };
  }
  return {
    status: "ready",
    url: status.url,
    coverImageUrl: status.coverImageUrl,
  };
}

export async function deliverPendingVideoJobs(
  quota: QuotaAdapter,
  publish: (job: {
    taskId: string;
    discordUserId: string;
    channelId: string;
    model: string;
    prompt: string | null;
    costCents: number;
    resultUrl: string;
    coverImageUrl: string | null;
  }) => Promise<void>
): Promise<void> {
  const jobs = await listPendingMediaJobs();

  for (const job of jobs) {
    try {
      const status = await checkVideoJobStatus(job.task_id);
      if (!status.done) {
        await updateMediaJob(job.task_id, { status: "processing" });
        continue;
      }

      if (status.error || !status.url) {
        await updateMediaJob(job.task_id, {
          status: "failed",
          error_message: status.error ?? "Unknown video generation failure",
        });
        continue;
      }

      if (!job.billed) {
        await quota.record(
          job.system_key_id,
          job.user_id,
          job.cost_cents,
          job.model,
          0,
          0,
          "video.generate"
        );
      }

      await publish({
        taskId: job.task_id,
        discordUserId: job.discord_user_id,
        channelId: job.channel_id,
        model: job.model,
        prompt: job.prompt,
        costCents: job.cost_cents,
        resultUrl: status.url,
        coverImageUrl: status.coverImageUrl ?? null,
      });

      await updateMediaJob(job.task_id, {
        status: "completed",
        billed: 1,
        result_url: status.url,
        cover_image_url: status.coverImageUrl ?? null,
        error_message: null,
      });
    } catch (err) {
      await updateMediaJob(job.task_id, {
        status: "failed",
        error_message: err instanceof Error ? err.message : "Unknown video generation failure",
      });
    }
  }
}
