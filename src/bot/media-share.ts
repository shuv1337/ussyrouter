import { deleteMediaShare, getMediaShare, saveMediaShare } from "../db/media";

export interface StoredSharePayload {
  userId: string;
  kind: "image" | "video" | "ocr" | "transcription";
  title: string;
  description?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  imageUrl?: string;
  fileUrl?: string;
  mediaJobId?: string;
  filename?: string;
  createdAt: number;
}

export async function saveSharePayload(payload: StoredSharePayload): Promise<string> {
  const id = crypto.randomUUID();
  await saveMediaShare({
    id,
    user_discord_id: payload.userId,
    kind: payload.kind,
    title: payload.title,
    description: payload.description ?? null,
    fields_json: payload.fields ? JSON.stringify(payload.fields) : null,
    image_url: payload.imageUrl ?? null,
    file_url: payload.fileUrl ?? null,
    media_job_id: payload.mediaJobId ?? null,
    filename: payload.filename ?? null,
  });
  return id;
}

export async function getSharePayload(id: string): Promise<StoredSharePayload | null> {
  const payload = await getMediaShare(id);
  if (!payload) return null;

  return {
    userId: payload.user_discord_id,
    kind: payload.kind as StoredSharePayload["kind"],
    title: payload.title,
    description: payload.description ?? undefined,
    fields: payload.fields_json
      ? (JSON.parse(payload.fields_json) as StoredSharePayload["fields"])
      : undefined,
    imageUrl: payload.image_url ?? undefined,
    fileUrl: payload.file_url ?? undefined,
    mediaJobId: payload.media_job_id ?? undefined,
    filename: payload.filename ?? undefined,
    createdAt: payload.created_at ? new Date(payload.created_at).getTime() : Date.now(),
  };
}

export async function deleteSharePayload(id: string): Promise<void> {
  await deleteMediaShare(id);
}
