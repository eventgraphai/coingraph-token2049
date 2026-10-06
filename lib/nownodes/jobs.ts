import { sql, insertChunked } from "../db";
import { recordRowCount } from "../http";
import {
  adaGraphql, blockbook, blockfrost, fromUnits, hexToNumber, nodeStatus, rpc, toHex, topicToAddress,
  TRANSFER_TOPIC, ZERO_ADDRESS, type EvmChain,
} from "./client";
import { loadLabels, type LabelMap } from "./wallets";

// NOWNodes ingestion (mainnet): token flows and large transfers on Ethereum / BNB Chain, exchange
// reserves, network fees, Bitcoin blocks and mempool, large Cardano transfers, Solana holder
// concentration, and NOWNodes node health. Every row keys on coingecko_id like the rest of the DB.

export const LARGE_TRANSFER_USD = Number(process.env.ONCHAIN_LARGE_TRANSFER_USD ?? 25_000);
export const LARGE_BTC_USD = Number(process.env.ONCHAIN_LARGE_BTC_USD ?? 500_000);
export const LARGE_ADA_USD = Number(process.env.ONCHAIN_LARGE_ADA_USD ?? 100_000);
const WINDOW_SEC = 900;

const EVM: Record<EvmChain, { platform: string; native: string; blocksPer15m: number; chunk: number; maxBlocksPerRun: number; confirmations: number; feeBlocks: number }> = {
  eth: { platform: "ethereum", native: "ethereum", blocksPer15m: 75, chunk: 100, maxBlocksPerRun: 600, confirmations: 3, feeBlocks: 75 },
  bsc: { platform: "binance-smart-chain", native: "binancecoin", blocksPer15m: 1200, chunk: 1300, maxBlocksPerRun: 6500, confirmations: 15, feeBlocks: 1000 },
};

const minuteNow = () => {
  const d = new Date();
  d.setUTCSeconds(0, 0);
  return d;
};
const windowStart = (ts: Date) => new Date(Math.floor(ts.getTime() / 1000 / WINDOW_SEC) * WINDOW_SEC * 1000);

// Latest price per coin from our own CoinGecko feed (no extra API calls).
async function latestPrices(): Promise<Map<string, number>> {
  const rows = await sql<{ coingecko_id: string; current_price: string | null }[]>`
    select distinct on (coingecko_id) coingecko_id, current_price from market_snapshots
    where captured_at > now() - interval '2 hours' order by coingecko_id, captured_at desc`;
  return new Map(rows.filter((r) => r.current_price !== null).map((r) => [r.coingecko_id, Number(r.current_price)]));
}

async function getCursor(chain: string, feed: string): Promise<number | null> {
  const [row] = await sql<{ cursor: string }[]>`select cursor from onchain_scan_cursors where chain = ${chain} and feed = ${feed}`;
  return row ? Number(row.cursor) : null;
}
async function setCursor(chain: string, feed: string, cursor: number) {
  await sql`insert into onchain_scan_cursors (chain, feed, cursor, updated_at) values (${chain}, ${feed}, ${cursor}, now())
            on conflict (chain, feed) do update set cursor = excluded.cursor, updated_at = now()`;
}

type Direction = "to_exchange" | "from_exchange" | "exchange_internal" | "mint" | "burn" | "other";
function direction(from: string, to: string, labels: LabelMap): { direction: Direction; fromEntity: string | null; toEntity: string | null } {
  const f = labels.get(from);
  const t = labels.get(to);
  const fromEntity = f?.entity ?? null;
  const toEntity = t?.entity ?? null;
  if (from === ZERO_ADDRESS) return { direction: "mint", fromEntity, toEntity };
  if (t?.kind === "burn" || to === ZERO_ADDRESS) return { direction: "burn", fromEntity, toEntity };
  const fx = f?.kind === "exchange";
  const tx = t?.kind === "exchange";
  if (fx && tx) return { direction: "exchange_internal", fromEntity, toEntity };
  if (tx) return { direction: "to_exchange", fromEntity, toEntity };
  if (fx) return { direction: "from_exchange", fromEntity, toEntity };
  return { direction: "other", fromEntity, toEntity };
}

// Per (coin, window) aggregate, upserted additively so a window split across two runs still sums correctly.
type Flow = {
  coingecko_id: string; chain: string; window_start: Date; transfer_count: number; volume: number; volume_usd: number;
  senders: Set<string>; receivers: Set<string>; exchange_inflow_usd: number; exchange_outflow_usd: number;
  large_transfer_count: number; mint_usd: number; burn_usd: number; price_usd: number | null; from_block: number | null; to_block: number | null;
};
function flowFor(map: Map<string, Flow>, coin: string, chain: string, ws: Date, price: number | null): Flow {
  const key = `${coin}|${ws.getTime()}`;
  let f = map.get(key);
  if (!f) {
    f = { coingecko_id: coin, chain, window_start: ws, transfer_count: 0, volume: 0, volume_usd: 0, senders: new Set(), receivers: new Set(),
          exchange_inflow_usd: 0, exchange_outflow_usd: 0, large_transfer_count: 0, mint_usd: 0, burn_usd: 0, price_usd: price, from_block: null, to_block: null };
    map.set(key, f);
  }
  return f;
}
function addFlow(f: Flow, amount: number, usd: number, from: string, to: string, dir: Direction, block: number | null) {
  f.transfer_count++;
  f.volume += amount;
  f.volume_usd += usd;
  f.senders.add(from);
  f.receivers.add(to);
  if (dir === "to_exchange") f.exchange_inflow_usd += usd;
  if (dir === "from_exchange") f.exchange_outflow_usd += usd;
  if (dir === "mint") f.mint_usd += usd;
  if (dir === "burn") f.burn_usd += usd;
  if (block !== null) {
    f.from_block = f.from_block === null ? block : Math.min(f.from_block, block);
    f.to_block = f.to_block === null ? block : Math.max(f.to_block, block);
  }
}
async function upsertFlows(flows: Iterable<Flow>, apiCallId: number | null): Promise<number> {
  let n = 0;
  for (const f of flows) {
    await sql`
      insert into onchain_flow_snapshots (coingecko_id, chain, window_start, transfer_count, volume, volume_usd, unique_senders, unique_receivers,
        exchange_inflow_usd, exchange_outflow_usd, exchange_net_usd, large_transfer_count, mint_usd, burn_usd, price_usd, from_block, to_block, api_call_id)
      values (${f.coingecko_id}, ${f.chain}, ${f.window_start}, ${f.transfer_count}, ${f.volume}, ${f.volume_usd}, ${f.senders.size}, ${f.receivers.size},
        ${f.exchange_inflow_usd}, ${f.exchange_outflow_usd}, ${f.exchange_inflow_usd - f.exchange_outflow_usd}, ${f.large_transfer_count}, ${f.mint_usd}, ${f.burn_usd},
        ${f.price_usd}, ${f.from_block}, ${f.to_block}, ${apiCallId})
      on conflict (coingecko_id, chain, window_start) do update set
        transfer_count = onchain_flow_snapshots.transfer_count + excluded.transfer_count,
        volume = onchain_flow_snapshots.volume + excluded.volume,
        volume_usd = coalesce(onchain_flow_snapshots.volume_usd, 0) + coalesce(excluded.volume_usd, 0),
        unique_senders = coalesce(onchain_flow_snapshots.unique_senders, 0) + coalesce(excluded.unique_senders, 0),
        unique_receivers = coalesce(onchain_flow_snapshots.unique_receivers, 0) + coalesce(excluded.unique_receivers, 0),
        exchange_inflow_usd = onchain_flow_snapshots.exchange_inflow_usd + excluded.exchange_inflow_usd,
        exchange_outflow_usd = onchain_flow_snapshots.exchange_outflow_usd + excluded.exchange_outflow_usd,
        exchange_net_usd = onchain_flow_snapshots.exchange_net_usd + excluded.exchange_net_usd,
        large_transfer_count = onchain_flow_snapshots.large_transfer_count + excluded.large_transfer_count,
        mint_usd = onchain_flow_snapshots.mint_usd + excluded.mint_usd,
        burn_usd = onchain_flow_snapshots.burn_usd + excluded.burn_usd,
        price_usd = coalesce(excluded.price_usd, onchain_flow_snapshots.price_usd),
        from_block = least(onchain_flow_snapshots.from_block, excluded.from_block),
        to_block = greatest(onchain_flow_snapshots.to_block, excluded.to_block),
        api_call_id = coalesce(excluded.api_call_id, onchain_flow_snapshots.api_call_id),
        updated_at = now()`;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Contract map: coingecko_id → (chain, address, decimals), from CoinGecko's platform data.
// ---------------------------------------------------------------------------
const PLATFORM_CHAIN: Record<string, string> = { ethereum: "eth", "binance-smart-chain": "bsc", solana: "sol", cardano: "ada" };

export async function syncOnchainContracts(): Promise<number> {
  const tokens = await sql<{ coingecko_id: string; symbol: string; name: string; platforms: Record<string, string> | null; detail_platforms: Record<string, { decimal_place?: number | null }> | null }[]>`
    select coingecko_id, symbol, name, platforms, detail_platforms from tokens where in_universe`;
  let n = 0;
  for (const t of tokens) {
    for (const [platform, chain] of Object.entries(PLATFORM_CHAIN)) {
      const raw = t.platforms?.[platform];
      if (!raw) continue;
      const address = chain === "eth" || chain === "bsc" ? raw.toLowerCase() : raw;
      if ((chain === "eth" || chain === "bsc") && !/^0x[0-9a-f]{40}$/.test(address)) continue;
      const decimals = t.detail_platforms?.[platform]?.decimal_place ?? null;
      await sql`
        insert into onchain_contracts (coingecko_id, chain, address, decimals, symbol, name, source, updated_at)
        values (${t.coingecko_id}, ${chain}, ${address}, ${decimals}, ${t.symbol}, ${t.name}, 'coingecko', now())
        on conflict (coingecko_id, chain) do update set address = excluded.address,
          decimals = coalesce(onchain_contracts.decimals, excluded.decimals), symbol = excluded.symbol, name = excluded.name, updated_at = now()`;
      n++;
    }
  }
  // Decimals missing from CoinGecko: ask Blockbook once.
  const missing = await sql<{ coingecko_id: string; chain: EvmChain; address: string }[]>`
    select coingecko_id, chain, address from onchain_contracts where chain in ('eth', 'bsc') and decimals is null`;
  for (const m of missing) {
    try {
      const { data } = await blockbook<{ decimals?: number; symbol?: string; name?: string }>(
        m.chain === "eth" ? "eth-blockbook" : "bsc-blockbook", `/contract/${m.address}`, `${m.chain}:/contract/{address}`, { address: m.address });
      if (data.decimals !== undefined) {
        await sql`update onchain_contracts set decimals = ${data.decimals}, source = 'blockbook', updated_at = now() where coingecko_id = ${m.coingecko_id} and chain = ${m.chain}`;
      }
    } catch (err) {
      console.warn(`[contracts] ${m.chain} ${m.coingecko_id}: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Token flows (ETH, BSC): all Transfer events of every tracked token since the last scanned block.
// One eth_getLogs per block chunk covers every contract; aggregates per 15-min window + large transfers.
// ---------------------------------------------------------------------------
type Log = { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string; logIndex: string };

async function blockTimestamp(chain: EvmChain, block: number): Promise<number> {
  const { data } = await rpc<{ timestamp: string }>(chain, "eth_getBlockByNumber", [toHex(block), false], { params: { block } });
  return hexToNumber(data.timestamp);
}

export async function syncTokenFlows(chain: EvmChain): Promise<number> {
  const cfg = EVM[chain];
  const { data: headHex } = await rpc<string>(chain, "eth_blockNumber", []);
  const head = hexToNumber(headHex) - cfg.confirmations;
  const cursor = await getCursor(chain, "flows");
  const from = cursor === null ? head - cfg.blocksPer15m + 1 : cursor + 1;
  const to = Math.min(head, from + cfg.maxBlocksPerRun - 1);
  if (from > to) return 0;

  // Stablecoins move far more value, so "large" is 10× higher for them to keep the transfer table about whales.
  const contracts = new Map(
    (await sql<{ coingecko_id: string; address: string; decimals: number; large_usd: number }[]>`
      select c.coingecko_id, c.address, c.decimals, case when t.is_stablecoin then ${LARGE_TRANSFER_USD * 10} else ${LARGE_TRANSFER_USD} end as large_usd
      from onchain_contracts c join tokens t using (coingecko_id) where c.chain = ${chain} and c.decimals is not null`)
      .map((c) => [c.address, { ...c, large_usd: Number(c.large_usd) }]),
  );
  if (!contracts.size) throw new Error(`no ${chain} contracts mapped — run syncOnchainContracts first`);
  const labels = await loadLabels(chain);
  const prices = await latestPrices();

  const flows = new Map<string, Flow>();
  const transfers: Record<string, unknown>[] = [];
  let lastCallId: number | null = null;
  let logCount = 0;

  // Chunks are split in half when the node refuses a range (too many results).
  const pending: [number, number][] = [];
  for (let a = from; a <= to; a += cfg.chunk) pending.push([a, Math.min(a + cfg.chunk - 1, to)]);
  while (pending.length) {
    const [a, b] = pending.shift()!;
    let logs: Log[];
    let callId: number;
    try {
      const res = await rpc<Log[]>(chain, "eth_getLogs",
        [{ fromBlock: toHex(a), toBlock: toHex(b), address: [...contracts.keys()], topics: [TRANSFER_TOPIC] }],
        { params: { fromBlock: a, toBlock: b, contracts: contracts.size }, archive: false });
      logs = res.data;
      callId = res.apiCallId;
    } catch (err) {
      if (b > a && /limit|too many|exceed|size|timeout/i.test((err as Error).message)) {
        const mid = Math.floor((a + b) / 2);
        pending.unshift([a, mid], [mid + 1, b]);
        continue;
      }
      throw err;
    }
    lastCallId = callId;
    logCount += logs.length;
    await recordRowCount(callId, logs.length);

    // Block times: interpolate between the chunk's first and last block (fixed slot times on both chains).
    const tsA = await blockTimestamp(chain, a);
    const tsB = b === a ? tsA : await blockTimestamp(chain, b);
    const tsOf = (block: number) => new Date((b === a ? tsA : tsA + ((tsB - tsA) * (block - a)) / (b - a)) * 1000);

    for (const log of logs) {
      const c = contracts.get(log.address.toLowerCase());
      if (!c || log.topics.length < 3) continue;
      const fromAddr = topicToAddress(log.topics[1]);
      const toAddr = topicToAddress(log.topics[2]);
      const amount = fromUnits(BigInt(log.data === "0x" ? "0x0" : log.data), c.decimals);
      const price = prices.get(c.coingecko_id) ?? null;
      const usd = price !== null ? amount * price : 0;
      const block = hexToNumber(log.blockNumber);
      const ts = tsOf(block);
      const d = direction(fromAddr, toAddr, labels);
      const f = flowFor(flows, c.coingecko_id, chain, windowStart(ts), price);
      addFlow(f, amount, usd, fromAddr, toAddr, d.direction, block);
      if (usd >= c.large_usd) {
        f.large_transfer_count++;
        transfers.push({
          chain, tx_hash: log.transactionHash, log_index: hexToNumber(log.logIndex), block_number: block, block_ts: ts,
          coingecko_id: c.coingecko_id, contract: c.address, from_address: fromAddr, to_address: toAddr, amount, amount_usd: usd,
          from_entity: d.fromEntity, to_entity: d.toEntity, direction: d.direction, api_call_id: callId,
        });
      }
    }
  }

  await insertChunked("onchain_transfers", transfers, "on conflict do nothing");
  const windows = await upsertFlows(flows.values(), lastCallId);
  await setCursor(chain, "flows", to);
  console.log(`[nn:${chain}-flows] blocks ${from}-${to}: ${logCount} transfers → ${windows} window rows, ${transfers.length} large`);
  return transfers.length + windows;
}

// ---------------------------------------------------------------------------
// Network fees / congestion (ETH, BSC) from eth_feeHistory over the last ~15 minutes of blocks.
// ---------------------------------------------------------------------------
type FeeHistory = { oldestBlock: string; baseFeePerGas: string[]; gasUsedRatio: number[]; reward?: string[][] };
const gwei = (hex: string) => Number(BigInt(hex)) / 1e9;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function syncChainFees(): Promise<number> {
  const captured = minuteNow();
  let n = 0;
  for (const chain of ["eth", "bsc"] as EvmChain[]) {
    const blocks = EVM[chain].feeBlocks;
    const { data, apiCallId } = await rpc<FeeHistory>(chain, "eth_feeHistory", [toHex(blocks), "latest", [25, 50, 75]], { params: { blocks } });
    const rewards = data.reward ?? [];
    const pct = (i: number) => avg(rewards.map((r) => gwei(r[i] ?? "0x0")));
    await sql`
      insert into chain_fee_snapshots (captured_at, chain, block_number, base_fee_gwei, priority_fee_p25_gwei, priority_fee_p50_gwei, priority_fee_p75_gwei, gas_used_ratio, blocks_sampled, api_call_id)
      values (${captured}, ${chain}, ${hexToNumber(data.oldestBlock) + data.gasUsedRatio.length - 1}, ${avg(data.baseFeePerGas.slice(-blocks).map(gwei))},
              ${pct(0)}, ${pct(1)}, ${pct(2)}, ${avg(data.gasUsedRatio)}, ${data.gasUsedRatio.length}, ${apiCallId})
      on conflict (captured_at, chain) do nothing`;
    await recordRowCount(apiCallId, 1);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Exchange reserves (ETH, BSC): native + every tracked token held by each known exchange wallet.
// ---------------------------------------------------------------------------
type AddressTokens = { balance: string; txs: number; tokens?: { type: string; contract: string; balance?: string; decimals?: number; symbol?: string }[] };

// Hourly: the `topWallets` wallets holding the most value (by their latest snapshot), plus any never
// snapshotted. Daily (topWallets = 0): every active exchange wallet. Keeps the hourly feed ~25 calls.
export async function syncExchangeReserves(topWallets = Number(process.env.NN_RESERVES_HOURLY_WALLETS ?? 25)): Promise<number> {
  const captured = minuteNow();
  const prices = await latestPrices();
  const rows: Record<string, unknown>[] = [];
  for (const chain of ["eth", "bsc"] as EvmChain[]) {
    const contracts = new Map(
      (await sql<{ coingecko_id: string; address: string; decimals: number }[]>`
        select coingecko_id, address, decimals from onchain_contracts where chain = ${chain} and decimals is not null`).map((c) => [c.address, c]),
    );
    const wallets = await sql<{ address: string; entity: string }[]>`
      with latest as (
        select wallet, sum(balance_usd) as usd from exchange_reserve_snapshots r
        where chain = ${chain} and captured_at = (select max(captured_at) from exchange_reserve_snapshots where chain = ${chain} and wallet = r.wallet)
        group by wallet),
      ranked as (
        select w.address, w.entity, l.usd, row_number() over (order by l.usd desc nulls last) as rank
        from wallet_labels w left join latest l on l.wallet = w.address
        where w.chain = ${chain} and w.kind = 'exchange' and w.active)
      select address, entity from ranked where ${topWallets} = 0 or rank <= ${topWallets} or usd is null order by rank`;
    for (const w of wallets) {
      try {
        const { data, apiCallId } = await blockbook<AddressTokens>(chain === "eth" ? "eth-blockbook" : "bsc-blockbook",
          `/address/${w.address}?details=tokenBalances`, `${chain}:/address/{wallet}`, { wallet: w.address, entity: w.entity });
        const native = Number(BigInt(data.balance ?? "0")) / 1e18;
        const nativeId = EVM[chain].native;
        rows.push({ captured_at: captured, chain, wallet: w.address, entity: w.entity, coingecko_id: nativeId, balance: native,
                    balance_usd: prices.has(nativeId) ? native * prices.get(nativeId)! : null, api_call_id: apiCallId });
        let count = 1;
        for (const t of data.tokens ?? []) {
          const c = contracts.get(t.contract?.toLowerCase() ?? "");
          if (!c || !t.balance) continue;
          const balance = fromUnits(BigInt(t.balance), t.decimals ?? c.decimals);
          const price = prices.get(c.coingecko_id);
          rows.push({ captured_at: captured, chain, wallet: w.address, entity: w.entity, coingecko_id: c.coingecko_id, balance,
                      balance_usd: price !== undefined ? balance * price : null, api_call_id: apiCallId });
          count++;
        }
        await recordRowCount(apiCallId, count);
      } catch (err) {
        console.warn(`[reserves] ${chain} ${w.entity} ${w.address}: ${(err as Error).message.slice(0, 120)}`);
      }
    }
  }
  await insertChunked("exchange_reserve_snapshots", rows, "on conflict do nothing");
  return rows.length;
}

// ---------------------------------------------------------------------------
// Bitcoin blocks: per-block totals + large transfers (outputs to addresses not among the inputs).
// ---------------------------------------------------------------------------
type BtcVin = { addresses?: string[]; isAddress?: boolean; value?: string; coinbase?: string };
type BtcVout = { addresses?: string[]; isAddress?: boolean; value?: string; n: number };
type BtcTx = { txid: string; blockTime: number; value: string; valueIn?: string; fees?: string; vin: BtcVin[]; vout: BtcVout[] };
type BtcBlock = { page?: number; totalPages?: number; hash: string; height: number; time: number; size: number; txCount: number; txs?: BtcTx[] };

export async function syncBtcBlocks(maxBlocks = 12): Promise<number> {
  const { data: info } = await blockbook<{ blockbook: { bestHeight: number } }>("btcbook", "/", "btc:/", {});
  const best = info.blockbook.bestHeight - 1; // one confirmation
  const cursor = await getCursor("btc", "blocks");
  const from = cursor === null ? best - 2 : cursor + 1;
  if (from > best) return 0;
  const to = Math.min(best, from + maxBlocks - 1);

  const labels = await loadLabels("btc");
  const prices = await latestPrices();
  const price = prices.get("bitcoin") ?? null;
  const largeBtc = price ? LARGE_BTC_USD / price : Infinity;
  let rows = 0;

  for (let height = from; height <= to; height++) {
    const transfers: Record<string, unknown>[] = [];
    let block: BtcBlock | null = null;
    let totalOut = 0, fees = 0, inflow = 0, outflow = 0, callId = 0;
    const flows = new Map<string, Flow>();
    for (let page = 1; ; page++) {
      const { data, apiCallId } = await blockbook<BtcBlock>("btcbook", `/block/${height}?page=${page}`, "btc:/block/{height}", { height, page });
      callId = apiCallId;
      block ??= data;
      await recordRowCount(apiCallId, data.txs?.length ?? 0);
      for (const tx of data.txs ?? []) {
        const outBtc = Number(tx.value) / 1e8;
        totalOut += outBtc;
        fees += Number(tx.fees ?? 0) / 1e8;
        const inputAddrs = new Set(tx.vin.flatMap((v) => (v.isAddress && v.addresses) || []));
        if (!inputAddrs.size) continue; // coinbase
        const sender = [...tx.vin].filter((v) => v.isAddress && v.addresses?.length).sort((x, y) => Number(y.value ?? 0) - Number(x.value ?? 0))[0]?.addresses?.[0] ?? null;
        const ts = new Date(tx.blockTime * 1000);
        for (const out of tx.vout) {
          const addr = out.isAddress ? out.addresses?.[0] : undefined;
          if (!addr || inputAddrs.has(addr)) continue;
          const btc = Number(out.value ?? 0) / 1e8;
          const usd = price ? btc * price : 0;
          const d = direction(sender ?? "", addr, labels);
          if (d.direction === "to_exchange") inflow += usd;
          if (d.direction === "from_exchange") outflow += usd;
          if (btc >= largeBtc) {
            transfers.push({ chain: "btc", tx_hash: tx.txid, log_index: out.n, block_number: height, block_ts: ts, coingecko_id: "bitcoin", contract: null,
                             from_address: sender, to_address: addr, amount: btc, amount_usd: usd, from_entity: d.fromEntity, to_entity: d.toEntity, direction: d.direction, api_call_id: apiCallId });
          }
        }
      }
      if (!data.totalPages || page >= data.totalPages) break;
    }
    if (!block) continue;
    const ts = new Date(block.time * 1000);
    const f = flowFor(flows, "bitcoin", "btc", windowStart(ts), price);
    f.transfer_count += block.txCount;
    f.volume += totalOut;
    f.volume_usd += price ? totalOut * price : 0;
    f.exchange_inflow_usd += inflow;
    f.exchange_outflow_usd += outflow;
    f.large_transfer_count += transfers.length;
    f.from_block = f.to_block = height;
    await sql`
      insert into btc_block_snapshots (height, block_hash, block_ts, tx_count, total_output_btc, total_output_usd, fees_btc, size_bytes, large_transfer_count, exchange_inflow_usd, exchange_outflow_usd, api_call_id)
      values (${height}, ${block.hash}, ${ts}, ${block.txCount}, ${totalOut}, ${price ? totalOut * price : null}, ${fees}, ${block.size}, ${transfers.length}, ${inflow}, ${outflow}, ${callId})
      on conflict (height) do nothing`;
    await insertChunked("onchain_transfers", transfers, "on conflict do nothing");
    await upsertFlows(flows.values(), callId);
    await setCursor("btc", "blocks", height);
    rows += 1 + transfers.length;
  }
  console.log(`[nn:btc-blocks] blocks ${from}-${to}: ${rows} rows`);
  return rows;
}

// Bitcoin mempool + fee estimates (pending transactions, congestion).
export async function syncBtcMempool(): Promise<number> {
  const captured = minuteNow();
  const { data: m, apiCallId } = await rpc<{ size: number; bytes: number; total_fee?: number; mempoolminfee?: number }>("btc", "getmempoolinfo", []);
  const fee = async (blocks: number) => {
    const { data } = await rpc<{ feerate?: number }>("btc", "estimatesmartfee", [blocks], { params: { blocks } });
    return data.feerate !== undefined ? data.feerate * 1e5 : null; // BTC/kvB → sat/vB
  };
  const [f1, f3, f6] = [await fee(1), null, await fee(6)]; // 3-block estimate skipped to save a call per sample
  await sql`
    insert into btc_mempool_snapshots (captured_at, tx_count, bytes, total_fee_btc, min_fee_sat_vb, fee_1_block_sat_vb, fee_3_blocks_sat_vb, fee_6_blocks_sat_vb, info, api_call_id)
    values (${captured}, ${m.size}, ${m.bytes}, ${m.total_fee ?? null}, ${m.mempoolminfee !== undefined ? m.mempoolminfee * 1e5 : null}, ${f1}, ${f3}, ${f6}, ${sql.json(m as never)}, ${apiCallId})
    on conflict (captured_at) do nothing`;
  await recordRowCount(apiCallId, 1);
  return 1;
}

// ---------------------------------------------------------------------------
// Cardano: large ADA transfers since the last run (GraphQL filters by total output).
// ---------------------------------------------------------------------------
type AdaTx = { hash: string; totalOutput: string; fee: string; includedAt: string; block: { number: number }; inputs: { address: string; value: string }[]; outputs: { address: string; value: string }[] };

export async function syncAdaLargeTransfers(): Promise<number> {
  const prices = await latestPrices();
  const price = prices.get("cardano") ?? null;
  if (!price) return 0;
  const minLovelace = Math.ceil((LARGE_ADA_USD / price) * 1e6);
  const cursor = await getCursor("ada", "transfers");
  const since = new Date((cursor ?? Math.floor(Date.now() / 1000) - WINDOW_SEC) * 1000).toISOString();
  const { data, apiCallId } = await adaGraphql<{ transactions: AdaTx[] }>(
    `query ($since: DateTime!, $min: String!) {
       transactions(limit: 500, order_by: {includedAt: asc}, where: {includedAt: {_gte: $since}, totalOutput: {_gte: $min}}) {
         hash totalOutput fee includedAt block { number } inputs { address value } outputs { address value }
       } }`,
    { since, min: String(minLovelace) }, "ada:graphql:transactions");

  const labels = await loadLabels("ada");
  const flows = new Map<string, Flow>();
  const transfers: Record<string, unknown>[] = [];
  let latest = cursor ?? 0;
  for (const tx of data.transactions) {
    const inputs = new Set(tx.inputs.map((i) => i.address));
    const sender = [...tx.inputs].sort((a, b) => Number(b.value) - Number(a.value))[0]?.address ?? null;
    // What actually left the sender: outputs to addresses that were not inputs (the rest is change).
    const sent = tx.outputs.filter((o) => !inputs.has(o.address)).sort((a, b) => Number(b.value) - Number(a.value));
    const sentLovelace = sent.reduce((s, o) => s + Number(o.value), 0);
    const out = sent[0];
    const ts = new Date(tx.includedAt);
    latest = Math.max(latest, Math.floor(ts.getTime() / 1000));
    if (!out || sentLovelace < minLovelace) continue; // consolidation / self-transfer
    const ada = sentLovelace / 1e6;
    const usd = ada * price;
    const d = direction(sender ?? "", out.address, labels);
    const f = flowFor(flows, "cardano", "ada", windowStart(ts), price);
    addFlow(f, ada, usd, sender ?? "", out.address, d.direction, tx.block.number);
    f.large_transfer_count++;
    transfers.push({ chain: "ada", tx_hash: tx.hash, log_index: 0, block_number: tx.block.number, block_ts: ts, coingecko_id: "cardano", contract: null,
                     from_address: sender, to_address: out.address, amount: ada, amount_usd: usd, from_entity: d.fromEntity, to_entity: d.toEntity, direction: d.direction, api_call_id: apiCallId });
  }
  await insertChunked("onchain_transfers", transfers, "on conflict do nothing");
  await upsertFlows(flows.values(), apiCallId);
  await recordRowCount(apiCallId, transfers.length);
  // Re-query from the last seen second (inclusive); duplicates are skipped by the primary key.
  await setCursor("ada", "transfers", latest || Math.floor(Date.now() / 1000) - 120);
  return transfers.length;
}

// ---------------------------------------------------------------------------
// Holder concentration (Solana tokens in the universe), daily.
// ---------------------------------------------------------------------------
type TokenAmount = { amount: string; decimals: number; uiAmount: number | null };
type LargestAccount = TokenAmount & { address: string };

export async function syncHolderConcentration(): Promise<number> {
  const captured = minuteNow();
  // Stablecoins are skipped: concentration is meaningless for them and their account sets are too large for the RPC.
  const tokens = await sql<{ coingecko_id: string; address: string }[]>`
    select c.coingecko_id, c.address from onchain_contracts c join tokens t using (coingecko_id) where c.chain = 'sol' and not t.is_stablecoin`;
  let n = 0;
  for (const t of tokens) {
    try {
      const supplyRes = await rpc<{ value: TokenAmount }>("sol", "getTokenSupply", [t.address], { params: { mint: t.address, coin: t.coingecko_id } });
      const { data: largest, apiCallId } = await rpc<{ value: LargestAccount[] }>("sol", "getTokenLargestAccounts", [t.address], { params: { mint: t.address, coin: t.coingecko_id }, timeoutMs: 180_000 });
      const supply = fromUnits(BigInt(supplyRes.data.value.amount), supplyRes.data.value.decimals);
      const holders = largest.value.map((h) => ({ address: h.address, amount: fromUnits(BigInt(h.amount), h.decimals) })).sort((a, b) => b.amount - a.amount);
      const pct = (k: number) => (supply > 0 ? (holders.slice(0, k).reduce((s, h) => s + h.amount, 0) / supply) * 100 : null);
      await sql`
        insert into token_holder_snapshots (coingecko_id, chain, captured_at, supply, top10_pct, top20_pct, holders, api_call_id)
        values (${t.coingecko_id}, 'sol', ${captured}, ${supply}, ${pct(10)}, ${pct(20)}, ${sql.json(holders as never)}, ${apiCallId})
        on conflict do nothing`;
      await recordRowCount(apiCallId, holders.length);
      n++;
    } catch (err) {
      console.warn(`[holders] ${t.coingecko_id}: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  return n;
}

// Cardano asset supply + first page of holders for NIGHT (Blockfrost-compatible). Kept small: Blockfrost
// cannot sort holders by quantity, so this records supply and a sample rather than true concentration.
export async function syncCardanoAssets(): Promise<number> {
  const assets = await sql<{ coingecko_id: string; address: string }[]>`select coingecko_id, address from onchain_contracts where chain = 'ada'`;
  let n = 0;
  for (const a of assets) {
    try {
      const { data: asset, apiCallId } = await blockfrost<{ quantity: string }>(`/assets/${a.address}`, "ada:/assets/{asset}", { asset: a.address, coin: a.coingecko_id });
      await sql`
        insert into token_holder_snapshots (coingecko_id, chain, captured_at, supply, api_call_id)
        values (${a.coingecko_id}, 'ada', ${minuteNow()}, ${Number(asset.quantity)}, ${apiCallId}) on conflict do nothing`;
      n++;
    } catch (err) {
      console.warn(`[ada-assets] ${a.coingecko_id}: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// NOWNodes node health (public monitoring API).
// ---------------------------------------------------------------------------
export async function syncNodeStatus(): Promise<number> {
  const captured = minuteNow();
  const { data, apiCallId } = await nodeStatus(["eth", "bsc", "btc", "sol", "ada"]);
  const rows = data.flatMap(([chain, nodes]) => nodes.map((n) => ({
    captured_at: captured, chain, interface: n.interface, status: n.status, height: n.height ?? null, height_deviation: n.heightDeviation ?? null,
  })));
  await insertChunked("nownodes_node_status", rows, "on conflict do nothing");
  await recordRowCount(apiCallId, rows.length);
  return rows.length;
}
