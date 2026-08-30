import { expect, test } from "bun:test";
import { loadConfig } from "../src/config";

const base = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  KMERHOSTING_GATEWAY_SECRET: "a-long-random-gateway-secret",
};

test("keeps the server-to-server API closed to browser origins by default", () => {
  expect(loadConfig(base).corsOrigins.size).toBe(0);
});

test("rejects wildcard CORS in production", () => {
  expect(() => loadConfig({ ...base, CORS_ORIGINS: "*" })).toThrow("explicit HTTPS origins");
});
