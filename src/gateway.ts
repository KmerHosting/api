import type { Config } from "./config";
import { ApiError, sha256 } from "./security";

export type Product = "domain" | "email" | "hosting" | "lxc";

type GatewayCall = {
  product: Product;
  productUserId: string;
  method: string;
  path: string;
  body?: unknown;
};

export type ProductResponse = { status: number; payload: unknown };

function baseUrl(config: Config, product: Product): string {
  return product === "domain" ? config.domainApiUrl
    : product === "email" ? config.emailApiUrl
    : product === "hosting" ? config.hostingApiUrl
    : config.lxcApiUrl;
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function callProduct(config: Config, call: GatewayCall): Promise<ProductResponse> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const requestId = crypto.randomUUID();
  const rawBody = call.body === undefined ? "" : JSON.stringify(call.body);
  const bodyHash = await sha256(rawBody);
  const canonical = [timestamp, requestId, call.method.toUpperCase(), call.path, bodyHash, call.productUserId].join(".");
  const signature = await hmac(config.gatewaySecret, canonical);
  const target = call.product === "lxc"
    ? `${baseUrl(config, call.product)}?path=${encodeURIComponent(call.path)}`
    : `${baseUrl(config, call.product)}${call.path}`;
  const response = await fetch(target, {
    method: call.method,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      "X-KmerHosting-Gateway-Timestamp": timestamp,
      "X-KmerHosting-Gateway-Request-Id": requestId,
      "X-KmerHosting-Gateway-User-Id": call.productUserId,
      "X-KmerHosting-Gateway-Signature": signature,
      "X-KmerHosting-Gateway-Body-Hash": bodyHash,
      "X-KmerHosting-Gateway-Path": call.path,
    },
    body: rawBody || undefined,
  });
  const text = await response.text();
  let payload: unknown = text;
  if (text) {
    try { payload = JSON.parse(text); } catch { /* upstream text is deliberately preserved */ }
  }
  return { status: response.status, payload };
}

export function productError(response: ProductResponse): never {
  const body = response.payload as { error?: { code?: string; message?: string } } | undefined;
  throw new ApiError(
    response.status >= 400 && response.status < 600 ? response.status : 502,
    body?.error?.code || "product_request_failed",
    body?.error?.message || "The product service could not complete this request.",
  );
}
