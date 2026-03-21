/**
 * SSH public key fingerprint utility.
 *
 * Computes the SHA-256 fingerprint of an OpenSSH public key in the same
 * format as `ssh-keygen -lf`: `SHA256:<base64-no-padding>`.
 */

/**
 * Compute the SHA-256 fingerprint of an SSH public key in authorized_keys format.
 * Returns the fingerprint as `SHA256:<base64-no-padding>` or `null` if the key is invalid.
 */
export function sshFingerprint(pubkey: string): string | null {
  const trimmed = pubkey.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return null;

  const keyData = parts[1];
  if (!keyData) return null;

  let decoded: Uint8Array;
  try {
    decoded = Buffer.from(keyData, "base64");
  } catch {
    return null;
  }

  if (decoded.length === 0) return null;

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(decoded);
  const digest = hasher.digest("base64");

  // Strip trailing '=' padding to match ssh-keygen output
  const clean = digest.replace(/=+$/, "");
  return `SHA256:${clean}`;
}
