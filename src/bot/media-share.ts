const store = new Map<string, StoredSharePayload>();

export interface StoredSharePayload {
  userId: string;
  kind: "image" | "video" | "ocr" | "transcription";
  title: string;
  description?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  imageUrl?: string;
  fileUrl?: string;
  filename?: string;
  mimeType?: string;
  createdAt: number;
}

export function saveSharePayload(payload: StoredSharePayload): string {
  const id = crypto.randomUUID();
  store.set(id, payload);
  return id;
}

export function getSharePayload(id: string): StoredSharePayload | null {
  return store.get(id) ?? null;
}

export function deleteSharePayload(id: string): void {
  store.delete(id);
}
