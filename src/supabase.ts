import type { Config } from "./config";

type RequestInitWithHeaders = RequestInit & { headers?: HeadersInit };

export class SupabaseRest {
  constructor(private readonly config: Config) {}

  private async request(path: string, init: RequestInitWithHeaders = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("apikey", this.config.serviceRoleKey);
    headers.set("Authorization", `Bearer ${this.config.serviceRoleKey}`);
    headers.set("Content-Type", "application/json");
    return fetch(`${this.config.supabaseUrl}${path}`, { ...init, headers });
  }

  async rest<T>(path: string, init: RequestInitWithHeaders = {}): Promise<T> {
    const response = await this.request(`/rest/v1/${path}`, init);
    if (!response.ok) throw new Error(`Supabase REST request failed (${response.status}).`);
    return (await response.json()) as T;
  }

  async rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.request(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Supabase RPC request failed (${response.status}).`);
    return (await response.json()) as T;
  }

  async update(path: string, body: Record<string, unknown>): Promise<void> {
    const response = await this.request(`/rest/v1/${path}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Supabase update failed (${response.status}).`);
  }

  async insert(path: string, body: Record<string, unknown>): Promise<void> {
    const response = await this.request(`/rest/v1/${path}`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Supabase insert failed (${response.status}).`);
  }

  async productIdentity(userId: string, product: "domain" | "emails" | "lxc"): Promise<string> {
    const rows = await this.rest<Array<{ external_user_id: string | null }>>(
      `dashboard_product_identities?select=external_user_id&user_id=eq.${userId}&product=eq.${product}&limit=1`,
    );
    const externalUserId = rows[0]?.external_user_id?.trim();
    if (!externalUserId) throw new Error(`No ${product} product identity is linked to this account.`);
    return externalUserId;
  }
}
