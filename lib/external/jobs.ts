import { sql, insertChunked } from "../db";
import { fetchLogged, recordRowCount } from "../http";

// External context feeds: news headlines from public RSS feeds (matched to coins by name / symbol),
// the Fear & Greed index, and DefiLlama protocol TVL. All free; all logged in api_calls like every other call.

// ---------------------------------------------------------------------------
// News (RSS). Title + link + time only; matched to coins mentioned in the title.
// ---------------------------------------------------------------------------
const FEEDS: { source: string; url: string }[] = [
  { source: "coindesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "decrypt", url: "https://decrypt.co/feed" },
  { source: "theblock", url: "https://www.theblock.co/rss.xml" },
];

// Names and symbols that are ordinary words; matching them would tag unrelated headlines.
const AMBIGUOUS = new Set(["rain", "story", "core", "pi", "canton", "figure", "sky", "mantle", "venice", "night", "stable", "aster", "pump", "sun", "lit", "one", "cc", "u", "m", "gt", "btw", "wbt", "ake", "stacks", "render", "world", "memecore", "internet computer", "the open network"]);

type Matcher = { coingecko_id: string; patterns: RegExp[] };

async function coinMatchers(): Promise<Matcher[]> {
  const rows = await sql<{ coingecko_id: string; symbol: string; name: string }[]>`select coingecko_id, symbol, name from tokens where in_universe`;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return rows.map((t) => {
    const patterns: RegExp[] = [];
    const name = t.name.replace(/\s*\(.*\)$/, "").trim();
    if (name.length >= 3 && !AMBIGUOUS.has(name.toLowerCase())) patterns.push(new RegExp(`(^|[^a-z])${esc(name)}($|[^a-z])`, "i"));
    const sym = t.symbol.toUpperCase();
    if (sym.length >= 3 && !AMBIGUOUS.has(sym.toLowerCase())) patterns.push(new RegExp(`(^|[^A-Za-z])\\$?${esc(sym)}($|[^A-Za-z])`));
    else if (sym.length >= 2) patterns.push(new RegExp(`\\$${esc(sym)}($|[^A-Za-z])`));
    return { coingecko_id: t.coingecko_id, patterns };
  });
}

const unescape = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]+>/g, "").trim();
const tag = (xml: string, name: string) => unescape(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)?.[1] ?? "");

type RssText = string;

export async function syncNews(): Promise<number> {
  const matchers = await coinMatchers();
  const rows: Record<string, unknown>[] = [];
  for (const feed of FEEDS) {
    try {
      const { data: xml, apiCallId } = await fetchLogged<RssText>({
        provider: "rss", endpoint: feed.source, url: feed.url, headers: { "user-agent": "CoinGraph/1.0 (news reader; +https://coingraph.ai)", accept: "application/rss+xml, application/xml, text/xml" },
        retries: 1, timeoutMs: 30_000, parse: "text",
      });
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
      let n = 0;
      for (const item of items) {
        const title = tag(item, "title");
        const url = tag(item, "link") || (/<guid[^>]*>(https?:[^<]+)<\/guid>/.exec(item)?.[1] ?? "");
        const published = new Date(tag(item, "pubDate"));
        if (!title || !url || Number.isNaN(published.getTime())) continue;
        const coins = matchers.filter((m) => m.patterns.some((p) => p.test(title))).map((m) => m.coingecko_id);
        const categories = [...item.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/g)].map((m) => unescape(m[1])).filter(Boolean).slice(0, 8);
        rows.push({ source: feed.source, url, title: title.slice(0, 500), published_at: published, coins, categories: categories.length ? categories : null, api_call_id: apiCallId });
        n++;
      }
      await recordRowCount(apiCallId, n);
    } catch (err) {
      console.warn(`[news] ${feed.source}: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  // Re-tag already stored items if the coin list changed is not needed: coins are tagged at insert time.
  const before = await sql<{ n: number }[]>`select count(*)::int as n from news_items`;
  await insertChunked("news_items", rows, "on conflict (source, url) do nothing");
  const after = await sql<{ n: number }[]>`select count(*)::int as n from news_items`;
  return after[0].n - before[0].n;
}

// ---------------------------------------------------------------------------
// Fear & Greed index (alternative.me), daily.
// ---------------------------------------------------------------------------
export async function syncFearGreed(): Promise<number> {
  const { data, apiCallId } = await fetchLogged<{ data: { value: string; value_classification: string; timestamp: string }[] }>({
    provider: "alternative.me", endpoint: "/fng", url: "https://api.alternative.me/fng/?limit=30", retries: 1,
  });
  const rows = (data.data ?? []).map((d) => ({
    day: new Date(Number(d.timestamp) * 1000).toISOString().slice(0, 10), value: Number(d.value), classification: d.value_classification, api_call_id: apiCallId,
  }));
  const n = await insertChunked("market_sentiment_snapshots", rows, "on conflict (day) do nothing");
  await recordRowCount(apiCallId, rows.length);
  return n;
}

// ---------------------------------------------------------------------------
// DefiLlama TVL for protocols whose token is in the universe. Protocol versions (Aave V2/V3, Uniswap V2/V3…)
// usually carry the CoinGecko id on the parent protocol, so both direct and parent matches are used.
// ---------------------------------------------------------------------------
type LlamaProtocol = { name: string; slug: string; gecko_id?: string | null; parentProtocol?: string | null; tvl?: number | null; change_1d?: number | null; change_7d?: number | null; mcap?: number | null; category?: string; chains?: string[] };
type LlamaParent = { id: string; name: string; gecko_id?: string | null };

export async function syncProtocolTvl(): Promise<number> {
  const captured = new Date();
  captured.setUTCMinutes(0, 0, 0);
  const ids = new Set((await sql<{ coingecko_id: string }[]>`select coingecko_id from tokens where in_universe`).map((r) => r.coingecko_id));
  // Parent protocols (Aave, Uniswap, PancakeSwap…) carry the CoinGecko id; their versions reference the parent.
  const { data: lite } = await fetchLogged<{ parentProtocols?: LlamaParent[] }>({
    provider: "defillama", endpoint: "/lite/protocols2", url: "https://api.llama.fi/lite/protocols2", retries: 1, timeoutMs: 90_000, archive: false,
  });
  const parentGecko = new Map((lite.parentProtocols ?? []).filter((p) => p.gecko_id).map((p) => [p.id, p.gecko_id as string]));
  const { data: protocols, apiCallId } = await fetchLogged<LlamaProtocol[]>({
    provider: "defillama", endpoint: "/protocols", url: "https://api.llama.fi/protocols", retries: 1, timeoutMs: 90_000, archive: false,
  });
  const rows: Record<string, unknown>[] = [];
  for (const p of protocols) {
    const coin = (p.gecko_id && ids.has(p.gecko_id) ? p.gecko_id : null) ?? (p.parentProtocol && ids.has(parentGecko.get(p.parentProtocol) ?? "") ? parentGecko.get(p.parentProtocol)! : null);
    if (!coin || !p.tvl || p.tvl < 1_000_000) continue; // chain "protocols" with no TVL are not useful
    rows.push({ captured_at: captured, coingecko_id: coin, protocol: p.slug, name: p.name, category: p.category ?? null, chains: p.chains ?? null,
                tvl_usd: p.tvl, change_1d_pct: p.change_1d ?? null, change_7d_pct: p.change_7d ?? null, mcap_usd: p.mcap ?? null, api_call_id: apiCallId });
  }
  const n = await insertChunked("protocol_tvl_snapshots", rows, "on conflict do nothing");
  await recordRowCount(apiCallId, rows.length);
  return n;
}
