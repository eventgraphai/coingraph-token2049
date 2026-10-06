import { sql, insertChunked } from "../db";
import { fetchLogged, recordRowCount, sleep } from "../http";

// Free security and execution data:
// - GoPlus token security (EVM + Solana): honeypot, taxes, mint/freeze/blacklist/pause powers, upgradeability,
//   holder concentration. Daily, one token per call (free tier), ~2s apart.
// - GoPlus address security: scam / phishing / mixer / sanctioned flags for an address (live, on demand).
// - OFAC SDN crypto addresses (0xB10C lists, updated daily from OFAC): local sanctions screening.
// - DEX aggregator quotes (ParaSwap on Ethereum, KyberSwap on BNB Chain, Jupiter on Solana): the real price
//   impact of a trade of a given size (on demand, cached 5 minutes).

const GOPLUS = "https://api.gopluslabs.io/api/v1";
const CHAIN_ID: Record<string, string> = { eth: "1", bsc: "56" };
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead", "1nc1nerator11111111111111111111111111111111"]);

const flag = (v: unknown): boolean | null => (v === undefined || v === null || v === "" ? null : String(v) === "1");
const statusFlag = (v: unknown): boolean | null => (v && typeof v === "object" && "status" in (v as object) ? String((v as { status: unknown }).status) === "1" : flag(v));
const pct = (v: unknown): number | null => (v === undefined || v === null || v === "" ? null : Math.round(Number(v) * 10000) / 100);

type Holder = { address?: string; account?: string; percent?: string; is_locked?: number; tag?: string };

function topHoldersPct(holders: Holder[] | undefined): number | null {
  if (!holders?.length) return null;
  const real = holders.filter((h) => !BURN.has(String(h.address ?? h.account ?? "").toLowerCase()) && !BURN.has(String(h.address ?? h.account ?? "")) && !h.is_locked);
  return Math.round(real.slice(0, 10).reduce((s, h) => s + Number(h.percent ?? 0), 0) * 10000) / 100;
}

// Turns GoPlus fields into plain-language flags and an overall level.
export function assessContract(chain: string, x: Record<string, unknown>, isStablecoin: boolean, issuerControlled = isStablecoin) {
  const high: string[] = [];
  const medium: string[] = [];
  const evm = chain !== "sol";
  const buyTax = evm ? pct(x.buy_tax) : null;
  const sellTax = evm ? pct(x.sell_tax) : null;
  const f = {
    is_honeypot: evm ? flag(x.is_honeypot) : null,
    cannot_sell_all: evm ? flag(x.cannot_sell_all) : null,
    is_mintable: evm ? flag(x.is_mintable) : statusFlag(x.mintable),
    is_proxy: evm ? flag(x.is_proxy) : null,
    owner_change_balance: evm ? flag(x.owner_change_balance) : statusFlag(x.balance_mutable_authority),
    hidden_owner: evm ? flag(x.hidden_owner) : null,
    can_take_back_ownership: evm ? flag(x.can_take_back_ownership) : null,
    has_blacklist: evm ? flag(x.is_blacklisted) : null,
    transfer_pausable: evm ? flag(x.transfer_pausable) : null,
    selfdestruct: evm ? flag(x.selfdestruct) : null,
    is_open_source: evm ? flag(x.is_open_source) : null,
    freezable: evm ? null : statusFlag(x.freezable),
    metadata_mutable: evm ? null : statusFlag(x.metadata_mutable),
    trusted_token: flag(x.trust_list ?? x.trusted_token),
  };
  if (f.is_honeypot) high.push("Honeypot: buyers cannot sell");
  if (f.cannot_sell_all) high.push("Holders cannot sell their full balance");
  if (sellTax !== null && sellTax > 10) high.push(`Sell tax ${sellTax}%`);
  if (buyTax !== null && buyTax > 10) high.push(`Buy tax ${buyTax}%`);
  // Regulated stablecoins and tokenized funds must be able to freeze or claw back funds: expected, not a red flag.
  if (f.owner_change_balance) (issuerControlled ? medium : high).push(issuerControlled ? "Issuer can change holders' balances (normal for regulated stablecoins and tokenized funds)" : "Owner can change holders' balances");
  if (f.hidden_owner) high.push("Hidden owner");
  if (f.selfdestruct) high.push("Contract can self-destruct");
  if (f.is_open_source === false) high.push("Contract source code is not verified");
  if (f.can_take_back_ownership) medium.push("Ownership can be reclaimed after renouncing");
  if (f.is_mintable) medium.push("Supply can be increased (mint authority)");
  if (f.freezable) medium.push("Accounts can be frozen (freeze authority)");
  if (f.has_blacklist) medium.push("Contract can blacklist addresses");
  if (f.transfer_pausable) medium.push("Transfers can be paused");
  if (f.is_proxy) medium.push("Upgradeable contract (proxy): the code can change");
  if ((sellTax !== null && sellTax > 0 && sellTax <= 10) || (buyTax !== null && buyTax > 0 && buyTax <= 10)) medium.push(`Trading tax ${Math.max(buyTax ?? 0, sellTax ?? 0)}%`);
  // Issuer controls (mint, freeze, blacklist, pause, upgrade) are expected for fiat-backed stablecoins and
  // for many governance tokens; they are reported but rated medium, never high.
  const level = high.length ? "high" : medium.length ? "medium" : "low";
  const flags = [...high, ...medium];
  if (issuerControlled && medium.length && !high.length) flags.push("Issuer controls are expected for this kind of asset (stablecoin or tokenized fund)");
  return { level, flags, buyTax, sellTax, f };
}

type Contract = { coingecko_id: string; chain: string; address: string; is_stablecoin: boolean; issuer: boolean };

export async function syncTokenSecurity(): Promise<number> {
  const all: Contract[] = await sql<Contract[]>`
    select c.coingecko_id, c.chain, c.address, t.is_stablecoin,
           (t.is_stablecoin or exists (select 1 from unnest(coalesce(t.categories, '{}')) cat where cat ~* '^(tokenized|real world assets)' and cat !~* 'issuer')) as issuer
    from onchain_contracts c join tokens t using (coingecko_id)
    where t.in_universe and c.chain in ('eth', 'bsc', 'sol')
      and not exists (select 1 from token_security_snapshots s where s.coingecko_id = c.coingecko_id and s.chain = c.chain and s.captured_at > now() - interval '20 hours')
    order by t.market_cap_rank, c.chain`;
  // GoPlus sometimes answers a first request for a token with an empty result; misses get a second pass.
  let contracts: Contract[] = [...all];
  let n = 0;
  for (let pass = 1; pass <= 2 && contracts.length; pass++) {
    const missed: Contract[] = [];
    n += await scanContracts(contracts, missed);
    contracts = missed;
    if (contracts.length && pass === 1) await sleep(15_000);
  }
  return n;
}

async function scanContracts(contracts: Contract[], missed: Contract[]): Promise<number> {
  const captured = new Date();
  captured.setUTCSeconds(0, 0);
  let n = 0;
  for (const c of contracts) {
    try {
      const url = c.chain === "sol"
        ? `${GOPLUS}/solana/token_security?contract_addresses=${c.address}`
        : `${GOPLUS}/token_security/${CHAIN_ID[c.chain]}?contract_addresses=${c.address}`;
      const { data, apiCallId } = await fetchLogged<{ code: number; message: string; result?: Record<string, Record<string, unknown>> }>({
        provider: "goplus", endpoint: c.chain === "sol" ? "/solana/token_security" : "/token_security/{chain}", url, params: { chain: c.chain, address: c.address, coin: c.coingecko_id }, retries: 1, timeoutMs: 30_000,
      });
      const x = data.result ? Object.values(data.result)[0] : undefined;
      if (!x || !Object.keys(x).length) { missed.push(c); await sleep(2100); continue; }
      const a = assessContract(c.chain, x, c.is_stablecoin, c.issuer);
      await sql`
        insert into token_security_snapshots (coingecko_id, chain, address, captured_at, risk_level, risk_flags, is_honeypot, cannot_sell_all, buy_tax_pct, sell_tax_pct, is_mintable, is_proxy,
          owner_change_balance, hidden_owner, can_take_back_ownership, has_blacklist, transfer_pausable, selfdestruct, is_open_source, freezable, metadata_mutable, trusted_token,
          holder_count, top10_holders_pct, owner_address, creator_address, raw, api_call_id)
        values (${c.coingecko_id}, ${c.chain}, ${c.address}, ${captured}, ${a.level}, ${a.flags}, ${a.f.is_honeypot}, ${a.f.cannot_sell_all}, ${a.buyTax}, ${a.sellTax}, ${a.f.is_mintable}, ${a.f.is_proxy},
          ${a.f.owner_change_balance}, ${a.f.hidden_owner}, ${a.f.can_take_back_ownership}, ${a.f.has_blacklist}, ${a.f.transfer_pausable}, ${a.f.selfdestruct}, ${a.f.is_open_source}, ${a.f.freezable}, ${a.f.metadata_mutable}, ${a.f.trusted_token},
          ${x.holder_count ? Number(x.holder_count) : null}, ${topHoldersPct(x.holders as Holder[] | undefined)}, ${(x.owner_address as string) || null}, ${(x.creator_address as string) || null}, ${sql.json(x as never)}, ${apiCallId})
        on conflict do nothing`;
      await recordRowCount(apiCallId, 1);
      n++;
    } catch (err) {
      console.warn(`[security] ${c.coingecko_id} ${c.chain}: ${(err as Error).message.slice(0, 120)}`);
    }
    await sleep(2100); // free tier: 30 calls/minute
  }
  return n;
}

// OFAC SDN digital-currency addresses, refreshed daily.
const OFAC_LISTS: Record<string, string> = { ETH: "eth", BSC: "bsc", XBT: "btc", SOL: "sol", TRX: "trx", USDT: "usdt", USDC: "usdc", ARB: "arb" };
export async function syncSanctions(): Promise<number> {
  let n = 0;
  for (const [list, chain] of Object.entries(OFAC_LISTS)) {
    const { data, apiCallId } = await fetchLogged<string>({
      provider: "ofac", endpoint: `sanctioned_addresses_${list}`, parse: "text", retries: 1,
      url: `https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_${list}.txt`,
    });
    const evm = ["eth", "bsc", "arb", "usdt", "usdc"].includes(chain);
    const rows = data.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((address) => ({ chain, address: evm && address.startsWith("0x") ? address.toLowerCase() : address, updated_at: new Date() }));
    await insertChunked("sanctioned_addresses", rows, "on conflict (chain, address) do update set updated_at = excluded.updated_at");
    await recordRowCount(apiCallId, rows.length);
    n += rows.length;
  }
  return n;
}

// Screening for one address: OFAC (local) + GoPlus address flags (EVM, live).
export async function screenAddress(chain: string, address: string) {
  const evm = chain === "eth" || chain === "bsc";
  const key = evm ? address.toLowerCase() : address;
  const chains = evm ? ["eth", "bsc", "arb", "usdt", "usdc"] : [chain];
  const [hit] = await sql`select chain, source, updated_at from sanctioned_addresses where address = ${key} and chain = any(${chains}) limit 1`;
  const burn = BURN.has(key);
  let goplus: Record<string, boolean> | null = null;
  if (evm) {
    try {
      const { data } = await fetchLogged<{ code: number; result?: Record<string, string> }>({
        provider: "goplus", endpoint: "/address_security", url: `${GOPLUS}/address_security/${key}?chain_id=${CHAIN_ID[chain]}`, params: { chain, address: key }, retries: 1, timeoutMs: 20_000,
      });
      if (data.result) {
        const keys = ["sanctioned", "phishing_activities", "stealing_attack", "cybercrime", "money_laundering", "financial_crime", "darkweb_transactions", "blackmail_activities", "mixer", "fake_kyc", "malicious_mining_activities", "honeypot_related_address", "blacklist_doubt"];
        goplus = Object.fromEntries(keys.filter((k) => k in data.result!).map((k) => [k, data.result![k] === "1"]));
      }
    } catch {
      goplus = null;
    }
  }
  const flags = [
    ...(hit ? [`On the OFAC sanctions list (${hit.chain.toUpperCase()})`] : []),
    ...(burn ? ["Burn address: anything sent here is lost forever"] : []),
    ...Object.entries(goplus ?? {}).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " ")),
  ];
  return {
    sanctioned: Boolean(hit) || Boolean(goplus?.sanctioned), burn, flags,
    risk: hit || goplus?.sanctioned || burn || Object.values(goplus ?? {}).some(Boolean) ? "high" : "none_found",
    sources: [{ provider: "ofac", endpoint: "0xB10C sanctioned_addresses", as_of: hit?.updated_at ?? null }, ...(evm ? [{ provider: "goplus", endpoint: "/address_security" }] : [])],
  };
}

// Real price impact of a trade of `sizeUsd` (buy: stablecoin → token; sell: token → stablecoin).
const STABLE: Record<string, { address: string; decimals: number }> = {
  eth: { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 }, // USDC
  bsc: { address: "0x55d398326f99059ff775485246999027b3197955", decimals: 18 }, // USDT (BSC)
  sol: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 }, // USDC
};
const quoteCache = new Map<string, { at: number; value: DexQuote | null }>();
export type DexQuote = { chain: string; venue: string; side: "buy" | "sell"; size_usd: number; received_usd: number; price_impact_pct: number; as_of: string };

export async function dexQuote(coingeckoId: string, sizeUsd: number, side: "buy" | "sell" = "buy"): Promise<DexQuote | null> {
  const key = `${coingeckoId}|${Math.round(sizeUsd)}|${side}`;
  const hit = quoteCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  const [c] = await sql<{ chain: string; address: string; decimals: number; price: string }[]>`
    select c.chain, c.address, c.decimals, (select current_price from market_snapshots m where m.coingecko_id = c.coingecko_id order by captured_at desc limit 1) as price
    from onchain_contracts c join tokens t using (coingecko_id)
    where c.coingecko_id = ${coingeckoId} and c.chain in ('eth', 'bsc', 'sol') and c.decimals is not null and not t.is_stablecoin
    -- The token's home chain first (where its main liquidity lives), then Ethereum, Solana, BNB Chain.
    order by case when (t.asset_platform_id = 'ethereum' and c.chain = 'eth') or (t.asset_platform_id = 'binance-smart-chain' and c.chain = 'bsc') or (t.asset_platform_id = 'solana' and c.chain = 'sol') then 0 else 1 end,
             case c.chain when 'eth' then 0 when 'sol' then 1 else 2 end limit 1`;
  if (!c || !c.price) return null;
  const price = Number(c.price);
  const stable = STABLE[c.chain];
  const [src, dst] = side === "buy" ? [{ address: stable.address, decimals: stable.decimals }, { address: c.address, decimals: c.decimals }] : [{ address: c.address, decimals: c.decimals }, { address: stable.address, decimals: stable.decimals }];
  const inUnits = side === "buy" ? sizeUsd : sizeUsd / price;
  const amount = BigInt(Math.floor(inUnits * 10 ** Math.min(src.decimals, 12))) * BigInt(10) ** BigInt(Math.max(src.decimals - 12, 0));
  let outUnits: number | null = null;
  let venue = "";
  try {
    if (c.chain === "eth") {
      venue = "paraswap";
      const { data } = await fetchLogged<{ priceRoute?: { destAmount: string } }>({ provider: "paraswap", endpoint: "/prices", retries: 1, timeoutMs: 15_000, archive: false,
        url: `https://api.paraswap.io/prices/?srcToken=${src.address}&srcDecimals=${src.decimals}&destToken=${dst.address}&destDecimals=${dst.decimals}&amount=${amount}&side=SELL&network=1`, params: { coin: coingeckoId, size_usd: sizeUsd, side } });
      if (data.priceRoute) outUnits = Number(data.priceRoute.destAmount) / 10 ** dst.decimals;
    } else if (c.chain === "bsc") {
      venue = "kyberswap";
      const { data } = await fetchLogged<{ data?: { routeSummary?: { amountOut: string } } }>({ provider: "kyberswap", endpoint: "/routes", retries: 1, timeoutMs: 15_000, archive: false,
        url: `https://aggregator-api.kyberswap.com/bsc/api/v1/routes?tokenIn=${src.address}&tokenOut=${dst.address}&amountIn=${amount}`, params: { coin: coingeckoId, size_usd: sizeUsd, side } });
      if (data.data?.routeSummary) outUnits = Number(data.data.routeSummary.amountOut) / 10 ** dst.decimals;
    } else {
      venue = "jupiter";
      const { data } = await fetchLogged<{ outAmount?: string }>({ provider: "jupiter", endpoint: "/swap/v1/quote", retries: 1, timeoutMs: 15_000, archive: false,
        url: `https://lite-api.jup.ag/swap/v1/quote?inputMint=${src.address}&outputMint=${dst.address}&amount=${amount}&slippageBps=300`, params: { coin: coingeckoId, size_usd: sizeUsd, side } });
      if (data.outAmount) outUnits = Number(data.outAmount) / 10 ** dst.decimals;
    }
  } catch (err) {
    // ParaSwap refuses quotes above its max impact and reports the impact itself: keep it, it is the answer.
    const m = /ESTIMATED_LOSS_GREATER_THAN_MAX_IMPACT[^%]*?"value":"([\d.]+)%/.exec((err as Error).message);
    if (m) {
      const impact = Number(m[1]);
      const v: DexQuote = { chain: c.chain, venue, side, size_usd: sizeUsd, received_usd: Math.round(sizeUsd * (1 - impact / 100) * 100) / 100, price_impact_pct: impact, as_of: new Date().toISOString() };
      quoteCache.set(key, { at: Date.now(), value: v });
      return v;
    }
    console.warn(`[dex-quote] ${coingeckoId} ${c.chain}: ${(err as Error).message.slice(0, 100)}`);
  }
  let value: DexQuote | null = null;
  if (outUnits !== null && Number.isFinite(outUnits)) {
    const receivedUsd = side === "buy" ? outUnits * price : outUnits;
    value = { chain: c.chain, venue, side, size_usd: sizeUsd, received_usd: Math.round(receivedUsd * 100) / 100, price_impact_pct: Math.round(Math.max(0, (1 - receivedUsd / sizeUsd) * 100) * 1000) / 1000, as_of: new Date().toISOString() };
  }
  quoteCache.set(key, { at: Date.now(), value });
  return value;
}

// Re-scores stored snapshots from their raw GoPlus data (after a rule change), without new API calls.
export async function rescoreSecurity(): Promise<number> {
  const rows = await sql<{ coingecko_id: string; chain: string; captured_at: Date; raw: Record<string, unknown>; is_stablecoin: boolean; issuer: boolean }[]>`
    select s.coingecko_id, s.chain, s.captured_at, s.raw, t.is_stablecoin,
           (t.is_stablecoin or exists (select 1 from unnest(coalesce(t.categories, '{}')) cat where cat ~* '^(tokenized|real world assets)' and cat !~* 'issuer')) as issuer
    from token_security_snapshots s join tokens t using (coingecko_id)`;
  for (const r of rows) {
    const a = assessContract(r.chain, r.raw, r.is_stablecoin, r.issuer);
    await sql`update token_security_snapshots set risk_level = ${a.level}, risk_flags = ${a.flags} where coingecko_id = ${r.coingecko_id} and chain = ${r.chain} and captured_at = ${r.captured_at}`;
  }
  return rows.length;
}
