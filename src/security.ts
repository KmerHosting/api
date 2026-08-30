export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function extractBearerCredential(header: string | null): string {
  const match = header?.match(/^Bearer\s+(kh_(?:live|oauth)_[A-Za-z0-9_-]+)$/);
  if (!match) {
    throw new ApiError(401, "invalid_token", "Use Authorization: Bearer KMERHOSTING_API_KEY or an OAuth access token.");
  }
  return match[1];
}

export function extractBearerKey(header: string | null): string {
  const credential = extractBearerCredential(header);
  if (!credential.startsWith("kh_live_")) {
    throw new ApiError(401, "invalid_api_key", "Use a kh_live_ API key for this operation.");
  }
  return credential;
}

export async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function requireScope(scopes: string[], scope: string): void {
  if (!scopes.includes(scope)) {
    throw new ApiError(403, "insufficient_scope", `This API key requires the ${scope} scope.`);
  }
}

export function assertActiveKey(key: { revoked_at: string | null; disabled_at: string | null; expires_at: string | null }): void {
  if (key.revoked_at || key.disabled_at || (key.expires_at && Date.parse(key.expires_at) <= Date.now())) {
    throw new ApiError(401, "invalid_api_key", "This API key is inactive, revoked, or expired.");
  }
}

export function assertActiveToken(token: { revoked_at: string | null; expires_at: string | null }): void {
  if (token.revoked_at || (token.expires_at && Date.parse(token.expires_at) <= Date.now())) {
    throw new ApiError(401, "invalid_token", "This OAuth access token is inactive, revoked, or expired.");
  }
}
