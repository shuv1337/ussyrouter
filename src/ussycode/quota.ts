import { getDb } from "../db";

const USSYCODE_API_BASE = process.env.USSYCODE_API_BASE?.trim() || "https://apiussy.shuv.dev";
const USSYCODE_INTERNAL_KEY = process.env.USSYCODE_INTERNAL_KEY?.trim() || null;

export interface UssycodeQuotaStatus {
  handle: string;
  trust_level: string;
  vm_count: number;
  total_disk_gb: number;
  vm_limit: number;
  cpu_limit: number;
  ram_limit_mb: number;
  disk_limit_mb: number;
}

function requireInternalKey(): string {
  if (!USSYCODE_INTERNAL_KEY) {
    throw new Error("USSYCODE_INTERNAL_KEY is not configured");
  }
  return USSYCODE_INTERNAL_KEY;
}

function deriveUssycodeHandle(discordId: string): string {
  const raw = discordId.trim().toLowerCase();
  let handle = "";
  let lastHyphen = false;
  for (const ch of raw) {
    if (ch >= "a" && ch <= "z") {
      handle += ch;
      lastHyphen = false;
    } else if (ch >= "0" && ch <= "9") {
      handle += ch;
      lastHyphen = false;
    } else if (handle.length > 0 && !lastHyphen) {
      handle += "-";
      lastHyphen = true;
    }
  }
  handle = handle.replace(/^-+|-+$/g, "");
  if (!handle) handle = "user";
  if (!/^[a-z]/.test(handle)) handle = `u-${handle}`;
  if (handle.length > 20) handle = handle.slice(0, 20).replace(/-+$/g, "");
  if (handle.length < 2) handle = `${handle}1`;
  return handle;
}

export async function getUssycodeQuotaByHandle(handle: string): Promise<UssycodeQuotaStatus> {
  const internalKey = requireInternalKey();
  const url = new URL(`${USSYCODE_API_BASE}/internal/quota`);
  url.searchParams.set("handle", handle);

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${internalKey}`,
    },
  });

  if (!resp.ok) {
    throw new Error(`ussycode quota lookup failed: ${resp.status} ${await resp.text()}`);
  }

  return (await resp.json()) as UssycodeQuotaStatus;
}

export async function setUssycodeTrustByHandle(handle: string, trustLevel: string): Promise<UssycodeQuotaStatus> {
  const internalKey = requireInternalKey();
  const resp = await fetch(`${USSYCODE_API_BASE}/internal/trust`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${internalKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ handle, trust_level: trustLevel }),
  });

  if (!resp.ok) {
    throw new Error(`ussycode trust update failed: ${resp.status} ${await resp.text()}`);
  }

  return (await resp.json()) as UssycodeQuotaStatus;
}

export async function getApprovedUssycodeHandleForDiscord(discordId: string): Promise<string | null> {
  const db = getDb();
  const approved = await db
    .selectFrom("ussycode_requests")
    .select(["id"])
    .where("discord_user_id", "=", discordId)
    .where("status", "=", "approved")
    .executeTakeFirst();

  if (!approved) return null;
  return deriveUssycodeHandle(discordId);
}
