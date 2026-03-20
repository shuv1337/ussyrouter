import { getModelSpec } from "../pricing";
import { seedModelLimits } from "../db/model-limits";

export const DEFAULT_MODEL_LIMITS: Record<string, number> = {
  "glm-4.6": 3,
  "glm-4.6v-flashx": 3,
  "glm-4.7": 2,
  "glm-image": 1,
  "glm-5-turbo": 1,
  "glm-4.5": 10,
  "glm-4.6v": 10,
  "glm-4.7-flash": 1,
  "glm-4.7-flashx": 3,
  "glm-ocr": 2,
  "glm-5": 32,
  "glm-4-plus": 20,
  "glm-4.5v": 10,
  "glm-4.6v-flash": 1,
  "autoglm-phone-multilingual": 5,
  "glm-4.5-air": 5,
  "glm-4.5-airx": 5,
  "glm-4.5-flash": 2,
  "glm-4-32b-0414-128k": 15,
  "cogview-4-250304": 5,
  "glm-asr-2512": 5,
  "viduq1-text": 5,
  "viduq1-image": 5,
  "viduq1-start-end": 5,
  "vidu2-image": 5,
  "vidu2-start-end": 5,
  "vidu2-reference": 5,
  "cogvideox-3": 1,
};

export async function seedDefaultModelLimits(): Promise<void> {
  const seeds = Object.entries(DEFAULT_MODEL_LIMITS).map(
    ([modelId, concurrencyLimit]) => ({
      modelId,
      displayName: getModelSpec(modelId)?.name ?? modelId,
      concurrencyLimit,
    })
  );

  await seedModelLimits(seeds);
}
