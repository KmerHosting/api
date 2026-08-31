import { expect, test } from "bun:test";
import { callProduct, productError } from "../src/gateway";
import { ApiError } from "../src/security";
import type { Config } from "../src/config";

const config: Config = {
  host: "127.0.0.1",
  port: 8787,
  production: true,
  supabaseUrl: "https://supabase.example.test",
  serviceRoleKey: "service-role-test",
  gatewaySecret: "gateway-secret-test",
  domainApiUrl: "https://domain.example.test",
  emailApiUrl: "https://email.example.test",
  hostingApiUrl: "https://hosting.example.test",
  lxcApiUrl: "https://lxc.example.test",
  corsOrigins: new Set(),
};

test("signs product requests with the gateway contract and never sends a user API key", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    captured = { url: String(input), init };
    return Response.json({ ok: true });
  }) as typeof fetch;

  try {
    const result = await callProduct(config, {
      product: "lxc",
      productUserId: "external-user-1",
      method: "POST",
      path: "/action",
      body: { serviceId: "service-1", action: "restart" },
    });
    expect(result.status).toBe(200);
    expect(captured?.url).toBe("https://lxc.example.test?path=%2Faction");
    const headers = new Headers(captured?.init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer service-role-test");
    expect(headers.get("X-KmerHosting-Gateway-User-Id")).toBe("external-user-1");
    expect(headers.get("X-KmerHosting-Gateway-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(headers.get("X-KmerHosting-Gateway-Timestamp")).toMatch(/^\d+$/);
    expect(headers.get("X-KmerHosting-Gateway-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(captured?.init?.body)).toContain("restart");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps upstream error payloads to API errors without losing their message", () => {
  expect(() => productError({
    status: 422,
    payload: { error: { code: "invalid_record", message: "The DNS record is invalid." } },
  })).toThrow(new ApiError(422, "invalid_record", "The DNS record is invalid."));
});

test("uses a safe gateway fallback for malformed upstream errors", () => {
  try {
    productError({ status: 200, payload: "upstream text" });
    throw new Error("expected productError to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: "product_request_failed", message: "The product service could not complete this request." });
  }
});
