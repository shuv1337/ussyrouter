import { getDb } from ".";

export interface ModelLimitSeed {
  modelId: string;
  displayName: string;
  concurrencyLimit: number;
}

export function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

export async function seedModelLimits(seeds: ModelLimitSeed[]): Promise<void> {
  const db = getDb();

  for (const seed of seeds) {
    await db
      .insertInto("model_limits")
      .values({
        model_id: normalizeModelId(seed.modelId),
        display_name: seed.displayName,
        concurrency_limit: seed.concurrencyLimit,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .onConflict((oc) => oc.column("model_id").doNothing())
      .execute();
  }
}

export async function listModelLimits() {
  const db = getDb();
  return db
    .selectFrom("model_limits")
    .selectAll()
    .orderBy("display_name", "asc")
    .execute();
}

export async function getModelLimit(modelId: string) {
  const db = getDb();
  return db
    .selectFrom("model_limits")
    .selectAll()
    .where("model_id", "=", normalizeModelId(modelId))
    .executeTakeFirst();
}

export async function setModelLimit(
  modelId: string,
  concurrencyLimit: number,
  displayName?: string
): Promise<void> {
  const db = getDb();
  const normalized = normalizeModelId(modelId);
  const current = await getModelLimit(normalized);

  if (current) {
    await db
      .updateTable("model_limits")
      .set({
        display_name: displayName ?? current.display_name,
        concurrency_limit: concurrencyLimit,
        updated_at: new Date().toISOString(),
      })
      .where("model_id", "=", normalized)
      .execute();
    return;
  }

  await db
    .insertInto("model_limits")
    .values({
      model_id: normalized,
      display_name: displayName ?? modelId,
      concurrency_limit: concurrencyLimit,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .execute();
}

export async function clearModelLimit(modelId: string): Promise<boolean> {
  const db = getDb();
  const normalized = normalizeModelId(modelId);
  const result = await db
    .deleteFrom("model_limits")
    .where("model_id", "=", normalized)
    .executeTakeFirst();

  return Number(result.numDeletedRows) > 0;
}
