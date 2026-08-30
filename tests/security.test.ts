import { expect, test } from "bun:test";
import { ApiError, assertActiveKey, extractBearerKey, requireScope, sha256 } from "../src/security";

test("hashes keys with dashboard-compatible SHA-256", async () => {
  expect(await sha256("kh_live_example")).toBe("40ed4b96dd543521d4b47f8b97adef641e6b164202fd83d0a356e34bc7fa663d");
});

test("only accepts KmerHosting Bearer keys", () => {
  expect(extractBearerKey("Bearer kh_live_abc_123")).toBe("kh_live_abc_123");
  expect(() => extractBearerKey("Bearer anything-else")).toThrow(ApiError);
});

test("rejects missing scopes and inactive keys", () => {
  expect(() => requireScope(["services:read"], "domains:read")).toThrow(ApiError);
  expect(() => assertActiveKey({ revoked_at: null, disabled_at: "2026-01-01T00:00:00Z", expires_at: null })).toThrow(ApiError);
});
