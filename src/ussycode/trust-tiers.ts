import { ussycodeInternalGet } from "./client";

export interface UssycodeTrustTier {
  key: string;
  display_name: string;
  description: string;
  vm_limit: number;
  cpu_limit: number;
  ram_limit_mb: number;
  disk_limit_mb: number;
  can_access_admin: boolean;
  requestable: boolean;
}

export async function listUssycodeTrustTiers(): Promise<UssycodeTrustTier[]> {
  const resp = await ussycodeInternalGet("/internal/trust-tiers");

  if (!resp.ok) {
    throw new Error(`ussycode trust-tier lookup failed: ${resp.status} ${await resp.text()}`);
  }

  const payload = (await resp.json()) as { tiers: UssycodeTrustTier[] };
  return payload.tiers;
}

export function formatTierLimit(value: number, unit = ""): string {
  if (value < 0) return `unlimited${unit ? ` ${unit}` : ""}`;
  return `${value}${unit ? ` ${unit}` : ""}`;
}

export function diskMbToGb(value: number): number {
  if (value < 0) return -1;
  return Math.floor(value / 1024);
}
