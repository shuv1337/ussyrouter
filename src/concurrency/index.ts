import { getModelLimit, normalizeModelId } from "../db/model-limits";

const activeByModel = new Map<string, number>();

function increment(modelId: string): number {
  const next = (activeByModel.get(modelId) ?? 0) + 1;
  activeByModel.set(modelId, next);
  return next;
}

function decrement(modelId: string): void {
  const current = activeByModel.get(modelId) ?? 0;
  if (current <= 1) {
    activeByModel.delete(modelId);
    return;
  }
  activeByModel.set(modelId, current - 1);
}

export interface ConcurrencyCheck {
  allowed: boolean;
  current: number;
  limit: number | null;
  displayName: string;
}

export async function acquireModelSlot(modelId: string): Promise<ConcurrencyCheck> {
  const normalized = normalizeModelId(modelId);
  const config = await getModelLimit(normalized);

  if (!config) {
    increment(normalized);
    return {
      allowed: true,
      current: activeByModel.get(normalized) ?? 1,
      limit: null,
      displayName: modelId,
    };
  }

  const current = activeByModel.get(normalized) ?? 0;
  if (current >= config.concurrency_limit) {
    return {
      allowed: false,
      current,
      limit: config.concurrency_limit,
      displayName: config.display_name,
    };
  }

  increment(normalized);
  return {
    allowed: true,
    current: activeByModel.get(normalized) ?? 1,
    limit: config.concurrency_limit,
    displayName: config.display_name,
  };
}

export function releaseModelSlot(modelId: string): void {
  decrement(normalizeModelId(modelId));
}

export function getActiveModelCount(modelId: string): number {
  return activeByModel.get(normalizeModelId(modelId)) ?? 0;
}
