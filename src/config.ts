export type Config = {
  host: string;
  port: number;
  production: boolean;
  supabaseUrl: string;
  serviceRoleKey: string;
  gatewaySecret: string;
  domainApiUrl: string;
  emailApiUrl: string;
  hostingApiUrl: string;
  lxcApiUrl: string;
  corsOrigins: Set<string>;
};

const required = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const production = env.NODE_ENV === "production";
  const origins = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (production && (origins.includes("*") || origins.some((origin) => !origin.startsWith("https://")))) {
    throw new Error("CORS_ORIGINS may contain only explicit HTTPS origins in production.");
  }

  return {
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 8787),
    production,
    supabaseUrl: required("SUPABASE_URL", env.SUPABASE_URL).replace(/\/$/, ""),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY),
    gatewaySecret: required("KMERHOSTING_GATEWAY_SECRET", env.KMERHOSTING_GATEWAY_SECRET),
    domainApiUrl: (env.DOMAIN_API_URL ?? `${required("SUPABASE_URL", env.SUPABASE_URL).replace(/\/$/, "")}/functions/v1/domain-api`).replace(/\/$/, ""),
    emailApiUrl: (env.EMAIL_API_URL ?? `${required("SUPABASE_URL", env.SUPABASE_URL).replace(/\/$/, "")}/functions/v1/eh-mail-api`).replace(/\/$/, ""),
    hostingApiUrl: (env.HOSTING_API_URL ?? `${required("SUPABASE_URL", env.SUPABASE_URL).replace(/\/$/, "")}/functions/v1/hosting-api-gateway`).replace(/\/$/, ""),
    lxcApiUrl: (env.LXC_API_URL ?? `${required("SUPABASE_URL", env.SUPABASE_URL).replace(/\/$/, "")}/functions/v1/dashboard-kvm-provider`).replace(/\/$/, ""),
    corsOrigins: new Set(origins),
  };
}
