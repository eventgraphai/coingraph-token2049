import { sql } from "../db";
import { blockbook, blockfrost, fromUnits, rpc } from "../nownodes/client";
import { ApiError, num, round, type Source } from "./respond";
import { screenAddress } from "../security/jobs";

// GET /v1/inspect/{chain}/{address}: who owns an address, live from the chain through NOWNodes.

export const CHAINS = ["eth", "bsc", "btc", "sol", "ada"] as const;
export type Chain = (typeof CHAINS)[number];

export async function inspectAddress(chain: Chain, address: string) {
  const addr = chain === "eth" || chain === "bsc" ? address.toLowerCase() : address;
  if ((chain === "eth" || chain === "bsc") && !/^0x[0-9a-f]{40}$/.test(addr)) throw new ApiError(400, "invalid_address", "EVM addresses are 0x followed by 40 hex characters.");
  // Non-EVM addresses are base58 / bech32 strings; anything else is rejected before it reaches an upstream URL.
  if (chain !== "eth" && chain !== "bsc" && !/^[A-Za-z0-9]{20,120}$/.test(addr)) throw new ApiError(400, "invalid_address", `Not a valid ${chain} address.`);
  const [label] = await sql`select entity, label, kind, confidence from wallet_labels where chain = ${chain} and address = ${addr}`;
  const prices = new Map((await sql<{ coingecko_id: string; current_price: string }[]>`select distinct on (coingecko_id) coingecko_id, current_price from market_snapshots where captured_at > now() - interval '2 hours' order by coingecko_id, captured_at desc`).map((r) => [r.coingecko_id, Number(r.current_price)]));
  const sources: Source[] = [];
  const asOf = new Date();

  let profile: Record<string, unknown>;
  if (chain === "eth" || chain === "bsc") {
    const contracts = new Map((await sql<{ coingecko_id: string; address: string; decimals: number; symbol: string }[]>`select coingecko_id, address, decimals, symbol from onchain_contracts where chain = ${chain}`).map((c) => [c.address, c]));
    const { data } = await blockbook<{ balance: string; txs: number; nonce?: string; tokens?: { contract: string; balance?: string; decimals?: number; symbol?: string; name?: string; type?: string }[] }>(
      chain === "eth" ? "eth-blockbook" : "bsc-blockbook", `/address/${addr}?details=tokenBalances`, `${chain}:/address/{wallet}:inspect`, { wallet: addr });
    const native = Number(BigInt(data.balance ?? "0")) / 1e18;
    const nativeId = chain === "eth" ? "ethereum" : "binancecoin";
    const holdings = (data.tokens ?? []).map((t) => {
      const c = contracts.get(t.contract?.toLowerCase() ?? "");
      const amount = t.balance ? fromUnits(BigInt(t.balance), t.decimals ?? c?.decimals ?? 18) : 0;
      const price = c ? prices.get(c.coingecko_id) : undefined;
      return { token: c?.coingecko_id ?? null, symbol: (c?.symbol ?? t.symbol ?? "").toUpperCase(), contract: t.contract, amount: round(amount, 6), usd: price !== undefined ? round(amount * price) : null, tracked: Boolean(c) };
    }).filter((h) => (h.amount ?? 0) > 0).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)).slice(0, 50);
    const recent = await sql`select coingecko_id, tx_hash, block_ts, from_address, to_address, amount, amount_usd, from_entity, to_entity, direction from onchain_transfers where chain = ${chain} and (from_address = ${addr} or to_address = ${addr}) order by block_ts desc limit 20`;
    profile = {
      native: { symbol: chain === "eth" ? "ETH" : "BNB", amount: round(native, 6), usd: prices.has(nativeId) ? round(native * prices.get(nativeId)!) : null },
      holdings, holdings_usd: round(holdings.reduce((s, h) => s + (h.usd ?? 0), 0) + (prices.has(nativeId) ? native * prices.get(nativeId)! : 0)),
      tx_count: data.txs, nonce: data.nonce ? Number(data.nonce) : null,
      recent_large_moves: recent.map((r) => ({ at: r.block_ts, token: r.coingecko_id, tx: r.tx_hash, direction: r.from_address === addr ? "out" : "in", counterparty: r.from_address === addr ? r.to_address : r.from_address, counterparty_entity: r.from_address === addr ? r.to_entity : r.from_entity, amount: num(r.amount), usd: num(r.amount_usd) })),
      type: label?.kind === "exchange" ? "exchange" : label?.kind === "burn" ? "burn" : data.txs < 50 ? "new or rarely used wallet" : data.txs > 100_000 ? "very active (exchange, contract or bot)" : "established wallet",
    };
    sources.push({ provider: "nownodes", endpoint: `${chain}-blockbook:/address/{wallet}`, as_of: asOf });
  } else if (chain === "btc") {
    const { data } = await blockbook<{ balance: string; txs: number; totalReceived?: string; totalSent?: string }>("btcbook", `/address/${addr}?details=basic`, "btc:/address/{wallet}:inspect", { wallet: addr });
    const btc = Number(data.balance ?? 0) / 1e8;
    const recent = await sql`select tx_hash, block_ts, from_address, to_address, amount, amount_usd, from_entity, to_entity, direction from onchain_transfers where chain = 'btc' and (from_address = ${addr} or to_address = ${addr}) order by block_ts desc limit 20`;
    profile = {
      native: { symbol: "BTC", amount: round(btc, 8), usd: prices.has("bitcoin") ? round(btc * prices.get("bitcoin")!) : null },
      total_received_btc: round(Number(data.totalReceived ?? 0) / 1e8, 4), total_sent_btc: round(Number(data.totalSent ?? 0) / 1e8, 4), tx_count: data.txs,
      recent_large_moves: recent.map((r) => ({ at: r.block_ts, tx: r.tx_hash, direction: r.from_address === addr ? "out" : "in", counterparty: r.from_address === addr ? r.to_address : r.from_address, counterparty_entity: r.from_address === addr ? r.to_entity : r.from_entity, amount: num(r.amount), usd: num(r.amount_usd) })),
      type: label?.kind === "exchange" ? "exchange" : data.txs < 5 ? "new or rarely used address" : data.txs > 10_000 ? "very active (exchange or service)" : "established address",
    };
    sources.push({ provider: "nownodes", endpoint: "btcbook:/address/{wallet}", as_of: asOf });
  } else if (chain === "sol") {
    const { data: bal } = await rpc<{ value: number }>("sol", "getBalance", [addr], { params: { wallet: addr }, logical: "sol:getBalance:inspect" });
    const { data: sigs } = await rpc<{ signature: string; blockTime: number | null; err: unknown }[]>("sol", "getSignaturesForAddress", [addr, { limit: 20 }], { params: { wallet: addr }, logical: "sol:getSignaturesForAddress:inspect" });
    const sol = bal.value / 1e9;
    profile = {
      native: { symbol: "SOL", amount: round(sol, 6), usd: prices.has("solana") ? round(sol * prices.get("solana")!) : null },
      recent_transactions: sigs.map((s) => ({ signature: s.signature, at: s.blockTime ? new Date(s.blockTime * 1000) : null, failed: Boolean(s.err) })),
      type: label?.kind === "exchange" ? "exchange" : sol > 10_000 ? "large holder" : "wallet",
    };
    sources.push({ provider: "nownodes", endpoint: "sol:getBalance + getSignaturesForAddress", as_of: asOf });
  } else {
    const { data } = await blockfrost<{ amount: { unit: string; quantity: string }[]; stake_address?: string; type?: string; script?: boolean }>(`/addresses/${addr}`, "ada:/addresses/{address}:inspect", { address: addr });
    const lovelace = Number(data.amount?.find((a) => a.unit === "lovelace")?.quantity ?? 0);
    const recent = await sql`select tx_hash, block_ts, from_address, to_address, amount, amount_usd, direction from onchain_transfers where chain = 'ada' and (from_address = ${addr} or to_address = ${addr}) order by block_ts desc limit 20`;
    profile = {
      native: { symbol: "ADA", amount: round(lovelace / 1e6, 6), usd: prices.has("cardano") ? round((lovelace / 1e6) * prices.get("cardano")!) : null },
      other_assets: (data.amount ?? []).filter((a) => a.unit !== "lovelace").length, stake_address: data.stake_address ?? null, script: data.script ?? false,
      recent_large_moves: recent.map((r) => ({ at: r.block_ts, tx: r.tx_hash, direction: r.from_address === addr ? "out" : "in", counterparty: r.from_address === addr ? r.to_address : r.from_address, amount: num(r.amount), usd: num(r.amount_usd) })),
      type: label?.kind === "exchange" ? "exchange" : data.script ? "script" : "wallet",
    };
    sources.push({ provider: "nownodes", endpoint: "ada-blockfrost:/addresses/{address}", as_of: asOf });
  }

  // Screening: OFAC sanctions (local list) + GoPlus scam/phishing/mixer flags (EVM) + burn addresses.
  const screening = await screenAddress(chain, addr).catch(() => null);
  if (screening) sources.push(...screening.sources);
  return {
    data: {
      chain, address: addr, label: label ? { entity: label.entity, name: label.label, kind: label.kind, confidence: label.confidence } : "unlabelled",
      screening: screening ? { risk: screening.risk, sanctioned: screening.sanctioned, burn_address: screening.burn, flags: screening.flags } : "unassessed",
      ...profile,
    },
    sources, as_of: asOf,
  };
}
