import { config } from "dotenv";

// Scripts and the worker run outside Next.js, so load .env.local ourselves.
// On Railway the variables come from the environment and this is a no-op.
config({ path: ".env.local", quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const match = /^(\d+)\s*(s|m|h)?$/.exec(raw.trim());
  if (!match) throw new Error(`Invalid interval ${name}=${raw} (use e.g. 60s, 5m, 1h)`);
  const n = Number(match[1]);
  return match[2] === "h" ? n * 3600 : match[2] === "m" ? n * 60 : n;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  coingeckoApiKey: required("COINGECKO_API_KEY"),
  universeSize: Number(process.env.UNIVERSE_SIZE ?? 100),

  // Raw response archive (bronze). Optional: when unset, archiving is skipped with a warning.
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  rawArchiveBucket: process.env.RAW_ARCHIVE_BUCKET ?? "raw-api",

  // Poll intervals in seconds, matched to CoinGecko's documented cache times.
  intervals: {
    markets: seconds("CG_MARKETS_INTERVAL", 60),
    global: seconds("CG_GLOBAL_INTERVAL", 600),
    categories: seconds("CG_CATEGORIES_INTERVAL", 300),
    trending: seconds("CG_TRENDING_INTERVAL", 600),
    derivatives: seconds("CG_DERIVATIVES_INTERVAL", 900),
    daily: seconds("CG_DAILY_INTERVAL", 86400),
    keyUsage: seconds("CG_KEY_INTERVAL", 3600),
  },
};
