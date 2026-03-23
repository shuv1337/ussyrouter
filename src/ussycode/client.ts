/**
 * Shared internal ussycode API client.
 * Centralizes auth + base URL for all ussycode internal API calls.
 */

export const USSYCODE_API_BASE =
  process.env.USSYCODE_API_BASE?.trim() || "https://apiussy.shuv.dev";

const USSYCODE_INTERNAL_KEY =
  process.env.USSYCODE_INTERNAL_KEY?.trim() || null;

export function requireInternalKey(): string {
  if (!USSYCODE_INTERNAL_KEY) {
    throw new Error("USSYCODE_INTERNAL_KEY is not configured");
  }
  return USSYCODE_INTERNAL_KEY;
}

/**
 * Make an authenticated GET request to an ussycode internal API endpoint.
 */
export async function ussycodeInternalGet(
  path: string,
  search?: Record<string, string>
): Promise<Response> {
  const url = new URL(`${USSYCODE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(search ?? {})) {
    url.searchParams.set(key, value);
  }

  return fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${requireInternalKey()}`,
    },
  });
}

/**
 * Make an authenticated POST request to an ussycode internal API endpoint.
 */
export async function ussycodeInternalPost(
  path: string,
  body: unknown
): Promise<Response> {
  return fetch(`${USSYCODE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireInternalKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}