import { env } from "../env";
import { fetchLogged, type LoggedResponse } from "../http";

const BASE_URL = "https://pro-api.coingecko.com/api/v3";

export function cg<T>(
  endpoint: string,
  params: Record<string, string | number | boolean> = {},
  logicalEndpoint = endpoint,
): Promise<LoggedResponse<T>> {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const url = `${BASE_URL}${endpoint}${query.size ? `?${query}` : ""}`;
  return fetchLogged<T>({
    provider: "coingecko",
    endpoint: logicalEndpoint,
    url,
    params: { path: endpoint, ...params },
    headers: { "x-cg-pro-api-key": env.coingeckoApiKey, accept: "application/json" },
  });
}

// Normalizers: CoinGecko mixes nulls, missing keys, ISO strings and unix seconds.
export const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

export const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

export const ts = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

export const json = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
