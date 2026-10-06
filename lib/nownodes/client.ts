import { sql } from "../db";
import { fetchLogged, type LoggedResponse } from "../http";

// NOWNodes access (all mainnet). Every call is logged in api_calls with provider "nownodes" and a
// logical endpoint of the form "<interface>:<method or path>", e.g. "eth:eth_getLogs", "btc:/block/{height}".

export type EvmChain = "eth" | "bsc";
export type Chain = EvmChain | "btc" | "sol" | "ada";

const PROVIDER = "nownodes";

function apiKey(): string {
  const key = process.env.NOWNODES_API_KEY;
  if (!key) throw new Error("Missing required env var NOWNODES_API_KEY");
  return key;
}

const HOSTS = {
  eth: "eth.nownodes.io",
  "eth-archive": "eth-archive.nownodes.io",
  "eth-blockbook": "eth-blockbook.nownodes.io",
  bsc: "bsc.nownodes.io",
  "bsc-blockbook": "bsc-blockbook.nownodes.io",
  btc: "btc.nownodes.io",
  btcbook: "btcbook.nownodes.io",
  sol: "sol.nownodes.io",
  "ada-blockfrost": "ada-blockfrost.nownodes.io",
  "ada-graphql": "ada-graphql.nownodes.io",
} as const;
export type Interface = keyof typeof HOSTS;

type RpcResult<T> = { result?: T; error?: { code: number; message: string } };

// JSON-RPC (EVM chains, Bitcoin Core, Solana).
export async function rpc<T>(
  iface: Interface,
  method: string,
  params: unknown[],
  opts: { logical?: string; params?: Record<string, unknown>; archive?: boolean; timeoutMs?: number } = {},
): Promise<LoggedResponse<T>> {
  const { data, apiCallId } = await fetchLogged<RpcResult<T>>({
    provider: PROVIDER,
    endpoint: opts.logical ?? `${iface}:${method}`,
    url: `https://${HOSTS[iface]}`,
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    params: opts.params ?? { method },
    headers: { "api-key": apiKey(), "content-type": "application/json" },
    archive: opts.archive,
    timeoutMs: opts.timeoutMs ?? 120_000,
    retries: 2,
  });
  if (data.error || data.result === undefined) {
    const message = data.error?.message ?? "empty result";
    await sql`update api_calls set ok = false, error = ${message.slice(0, 1000)} where id = ${apiCallId}`;
    throw new Error(`${iface} ${method}: ${message}`);
  }
  return { data: data.result, apiCallId };
}

// Blockbook REST (eth-blockbook, bsc-blockbook, btcbook). `logical` keeps api_calls endpoints stable
// (e.g. "btc:/block/{height}") while the real path varies.
export function blockbook<T>(
  iface: "eth-blockbook" | "bsc-blockbook" | "btcbook",
  path: string,
  logical: string,
  params: Record<string, unknown> = {},
): Promise<LoggedResponse<T>> {
  return fetchLogged<T>({
    provider: PROVIDER,
    endpoint: logical,
    url: `https://${HOSTS[iface]}/api/v2${path}`,
    params: { path, ...params },
    headers: { "api-key": apiKey() },
    timeoutMs: 90_000,
    retries: 2,
  });
}

// Blockfrost-compatible Cardano REST (mainnet).
export function blockfrost<T>(path: string, logical: string, params: Record<string, unknown> = {}): Promise<LoggedResponse<T>> {
  return fetchLogged<T>({
    provider: PROVIDER,
    endpoint: logical,
    url: `https://${HOSTS["ada-blockfrost"]}${path}`,
    params: { path, ...params },
    headers: { "api-key": apiKey() },
    retries: 2,
  });
}

// Cardano GraphQL (mainnet).
export async function adaGraphql<T>(query: string, variables: Record<string, unknown>, logical: string): Promise<LoggedResponse<T>> {
  const { data, apiCallId } = await fetchLogged<{ data?: T; errors?: { message: string }[] }>({
    provider: PROVIDER,
    endpoint: logical,
    url: `https://${HOSTS["ada-graphql"]}`,
    method: "POST",
    body: JSON.stringify({ query, variables }),
    params: variables,
    headers: { "api-key": apiKey(), "content-type": "application/json" },
    timeoutMs: 120_000,
    retries: 2,
  });
  if (data.errors?.length || !data.data) {
    const message = data.errors?.map((e) => e.message).join("; ") ?? "empty result";
    await sql`update api_calls set ok = false, error = ${message.slice(0, 1000)} where id = ${apiCallId}`;
    throw new Error(`ada-graphql: ${message}`);
  }
  return { data: data.data, apiCallId };
}

// Public monitoring API (no key): status and height of each NOWNodes interface.
export type NodeStatus = { interface: string; height: number; heightDeviation: number; status: string };
export function nodeStatus(tickers: string[]): Promise<LoggedResponse<[string, NodeStatus[]][]>> {
  return fetchLogged({
    provider: PROVIDER,
    endpoint: "watcher:/networks/status",
    url: `https://watcher.nownodes.io/api/v1.0/networks/status?tickers=${tickers.join(",")}`,
    params: { tickers },
    retries: 1,
  });
}

// Helpers for EVM responses.
export const hexToNumber = (hex: string): number => Number(BigInt(hex));
export const hexToBigInt = (hex: string): bigint => BigInt(hex);
export const toHex = (n: number): string => `0x${n.toString(16)}`;
// Token amount from a raw integer and decimals, as a JS number (USD-level precision is enough here).
export function fromUnits(raw: bigint, decimals: number): number {
  if (decimals <= 0) return Number(raw);
  const base = BigInt(10) ** BigInt(decimals);
  const whole = raw / base;
  const frac = Number(raw % base) / Number(base);
  return Number(whole) + frac;
}
// 32-byte topic → 20-byte address (lowercase).
export const topicToAddress = (topic: string): string => `0x${topic.slice(26).toLowerCase()}`;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
