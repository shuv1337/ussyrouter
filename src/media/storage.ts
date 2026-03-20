const MEDIA_ROOT = process.env.MEDIA_ROOT || "/data/media";
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || "3000"}`).replace(/\/$/, "");

export interface CachedMediaFile {
  filePath: string;
  publicPath: string;
  publicUrl: string;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function cacheRemoteMedia(
  sourceUrl: string,
  subdir: string,
  filename: string
): Promise<CachedMediaFile> {
  const dirPath = `${MEDIA_ROOT}/${subdir}`;
  await Bun.$`mkdir -p ${dirPath}`.quiet();

  const safeName = sanitizeFileName(filename);
  const filePath = `${dirPath}/${safeName}`;
  const resp = await fetch(sourceUrl);
  if (!resp.ok) {
    throw new Error(`Failed to download media asset: ${resp.status}`);
  }

  await Bun.write(filePath, resp);
  const publicPath = `/media/${subdir}/${safeName}`;
  return {
    filePath,
    publicPath,
    publicUrl: `${PUBLIC_URL}${publicPath}`,
  };
}

export function getMediaFilePath(pathname: string): string | null {
  if (!pathname.startsWith("/media/")) {
    return null;
  }
  const relative = pathname.slice("/media/".length);
  if (!relative || relative.includes("..")) {
    return null;
  }
  return `${MEDIA_ROOT}/${relative}`;
}
