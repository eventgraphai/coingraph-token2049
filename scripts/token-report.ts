import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "../lib/db";

// `npm run report -- cardano [out.html]` — one page showing every column we store for a token,
// grouped by table, with the source endpoint, refresh cadence and the api_call that produced it.

type Section = {
  table: string;
  group: "Identity" | "CoinGecko" | "Exchanges (CCXT)" | "Investigation" | "Market context";
  source: string; // provider · endpoint as we call it
  cadence: string;
  note?: string;
  // Rows to show for this token; each row becomes one value column (labelled by `label`).
  query: (id: string) => Promise<Record<string, unknown>[]>;
  label?: (row: Record<string, unknown>) => string;
  count: (id: string) => Promise<number>;
};

const countWhere = (table: string, col = "coingecko_id") => async (id: string) =>
  (await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)} where ${sql(col)} = ${id}`)[0].n;

const SECTIONS: Section[] = [
  {
    table: "tokens", group: "Identity", source: "CoinGecko · /coins/markets (identity, rank) + /coins/{id} (details)",
    cadence: "rank every 1 min · details daily", note: "Source of truth for the token. Every other table links here by coingecko_id.",
    query: (id) => sql`select * from tokens where coingecko_id = ${id}`, count: countWhere("tokens"),
  },
  {
    table: "coins", group: "Identity", source: "CoinGecko · /coins/list?include_platform=true", cadence: "daily",
    note: "All ~21.9k CoinGecko coins with contract addresses per chain.",
    query: (id) => sql`select * from coins where coingecko_id = ${id}`, count: countWhere("coins"),
  },
  {
    table: "symbol_map", group: "Identity", source: "CCXT · loadMarkets() + fetchTickers() price check (±2% vs CoinGecko)", cadence: "daily",
    note: "Links this token to each exchange market. is_primary marks the venue candles are pulled from.",
    query: (id) => sql`select * from symbol_map where coingecko_id = ${id} order by market_type, is_primary desc, venue`,
    label: (r) => `${r.venue} ${r.market_type}`, count: countWhere("symbol_map"),
  },
  {
    table: "market_snapshots", group: "CoinGecko", source: "CoinGecko · /coins/markets (top 100, price_change_percentage=1h…1y)", cadence: "every 1 min (:40s)",
    query: (id) => sql`select * from market_snapshots where coingecko_id = ${id} order by captured_at desc limit 1`,
    label: () => "latest", count: countWhere("market_snapshots"),
  },
  {
    table: "market_chart_points", group: "CoinGecko", source: "CoinGecko · /coins/{id}/market_chart (days=7 → hourly; days=1 → 5-min)", cadence: "once + per investigation",
    query: (id) => sql`select distinct on (granularity) * from market_chart_points where coingecko_id = ${id} order by granularity, ts desc`,
    label: (r) => `latest ${r.granularity}`, count: countWhere("market_chart_points"),
  },
  {
    table: "coin_detail_snapshots", group: "CoinGecko", source: "CoinGecko · /coins/{id} (market_data, community, developer, sentiment)", cadence: "daily",
    query: (id) => sql`select * from coin_detail_snapshots where coingecko_id = ${id} order by captured_at desc limit 1`,
    label: () => "latest", count: countWhere("coin_detail_snapshots"),
  },
  {
    table: "derivatives_tickers", group: "CoinGecko", source: "CoinGecko · /derivatives?include_tickers=unexpired", cadence: "every 15 min",
    note: "Futures contracts on 100+ derivatives exchanges. Showing the 5 largest by open interest from the latest capture.",
    query: (id) => sql`select * from derivatives_tickers where coingecko_id = ${id}
      and captured_at = (select max(captured_at) from derivatives_tickers where coingecko_id = ${id})
      order by open_interest desc nulls last limit 5`,
    label: (r) => String(r.market), count: countWhere("derivatives_tickers"),
  },
  {
    table: "trending_snapshots", group: "CoinGecko", source: "CoinGecko · /search/trending", cadence: "every 10 min",
    note: "Rows exist only when the token is trending.",
    query: (id) => sql`select * from trending_snapshots where coingecko_id = ${id} order by captured_at desc limit 1`,
    label: () => "latest", count: countWhere("trending_snapshots"),
  },
  {
    table: "category_snapshots", group: "Market context", source: "CoinGecko · /coins/categories", cadence: "every 5 min",
    note: "Sector market data for the categories this token belongs to (latest snapshot each).",
    query: (id) => sql`select distinct on (cs.category_id) c.name as category_name, cs.* from category_snapshots cs
      join categories c on c.id = cs.category_id
      where c.name in (select unnest(categories) from tokens where coingecko_id = ${id})
      order by cs.category_id, cs.captured_at desc limit 6`,
    label: (r) => String(r.category_name),
    count: async (id) => (await sql<{ n: number }[]>`select count(*)::int as n from category_snapshots cs join categories c on c.id = cs.category_id
      where c.name in (select unnest(categories) from tokens where coingecko_id = ${id})`)[0].n,
  },
  {
    table: "global_snapshots", group: "Market context", source: "CoinGecko · /global", cadence: "every 10 min",
    note: "Whole-market context (not token-specific).",
    query: () => sql`select * from global_snapshots order by captured_at desc limit 1`,
    label: () => "latest", count: async () => (await sql<{ n: number }[]>`select count(*)::int as n from global_snapshots`)[0].n,
  },
  {
    table: "cex_ohlcv", group: "Exchanges (CCXT)",
    source: "Binance /api/v3/klines + /fapi/v1/klines (raw) · OKX /market/candles (raw) · others CCXT fetchOHLCV", cadence: "every 1 min (:05s), self-healing gaps",
    query: (id) => sql`select distinct on (venue, market_type) * from cex_ohlcv where coingecko_id = ${id} order by venue, market_type, ts desc`,
    label: (r) => `${r.venue} ${r.market_type}`, count: countWhere("cex_ohlcv"),
  },
  {
    table: "cex_ticker_snapshots", group: "Exchanges (CCXT)", source: "CCXT · fetchTickers() per venue and market type", cadence: "every 5 min",
    query: (id) => sql`select distinct on (venue, market_type) * from cex_ticker_snapshots where coingecko_id = ${id} order by venue, market_type, captured_at desc`,
    label: (r) => `${r.venue} ${r.market_type}`, count: countWhere("cex_ticker_snapshots"),
  },
  {
    table: "funding_rate_snapshots", group: "Exchanges (CCXT)", source: "CCXT · fetchFundingRates() (Binance USDⓈ-M, OKX, Bybit)", cadence: "every 5 min",
    query: (id) => sql`select distinct on (venue) * from funding_rate_snapshots where coingecko_id = ${id} order by venue, captured_at desc`,
    label: (r) => String(r.venue), count: countWhere("funding_rate_snapshots"),
  },
  {
    table: "open_interest_snapshots", group: "Exchanges (CCXT)",
    source: "Binance /futures/data/openInterestHist (5m) · OKX fetchOpenInterests() · Bybit fetchOpenInterest()", cadence: "every 5 min",
    note: "Compare venues by open_interest_value (USD); OKX amounts are contracts, Bybit reports contracts only.",
    query: (id) => sql`select distinct on (venue) * from open_interest_snapshots where coingecko_id = ${id} order by venue, exchange_ts desc`,
    label: (r) => String(r.venue), count: countWhere("open_interest_snapshots"),
  },
  {
    table: "futures_sentiment_snapshots", group: "Exchanges (CCXT)",
    source: "Binance /futures/data/globalLongShortAccountRatio · topLongShortAccountRatio · topLongShortPositionRatio · takerlongshortRatio",
    cadence: "every 5 min (5m buckets, late data merged in)",
    query: (id) => sql`select * from futures_sentiment_snapshots where coingecko_id = ${id} and taker_buy_sell_ratio is not null and global_long_short_ratio is not null order by ts desc limit 1`,
    label: () => "latest complete", count: countWhere("futures_sentiment_snapshots"),
  },
  {
    table: "exchange_markets", group: "Exchanges (CCXT)", source: "CCXT · loadMarkets()", cadence: "daily",
    note: "Market specs for each exchange market mapped to this token.",
    query: (id) => sql`select em.* from exchange_markets em join symbol_map m on m.venue = em.venue and m.symbol = em.symbol
      where m.coingecko_id = ${id} order by em.type, em.venue`,
    label: (r) => `${r.venue} ${r.type}`,
    count: async (id) => (await sql<{ n: number }[]>`select count(*)::int as n from symbol_map where coingecko_id = ${id}`)[0].n,
  },
  {
    table: "order_book_snapshots", group: "Investigation", source: "CCXT · fetchOrderBook(symbol, 100)", cadence: "per investigation",
    query: (id) => sql`select * from order_book_snapshots where coingecko_id = ${id} order by captured_at desc limit 1`,
    label: (r) => String(r.venue), count: countWhere("order_book_snapshots"),
  },
  {
    table: "cex_trades", group: "Investigation", source: "CCXT · fetchTrades(symbol, 1000)", cadence: "per investigation",
    query: (id) => sql`select * from cex_trades where coingecko_id = ${id} order by ts desc limit 1`,
    label: (r) => String(r.venue), count: countWhere("cex_trades"),
  },
];

const fmt = (v: unknown): { text: string; json: boolean } => {
  if (v === null || v === undefined) return { text: "", json: false };
  if (v instanceof Date) return { text: v.toISOString().replace(".000Z", "Z"), json: false };
  if (Array.isArray(v) && v.every((x) => typeof x !== "object")) return { text: v.join(", "), json: false };
  if (typeof v === "object") {
    const s = JSON.stringify(v, null, 1);
    return { text: s.length > 6000 ? `${s.slice(0, 6000)}\n… (${s.length.toLocaleString()} chars, truncated)` : s, json: true };
  }
  return { text: String(v), json: false };
};

async function main() {
  const id = process.argv[2] ?? "cardano";
  const [token] = await sql`select coingecko_id, upper(symbol) as symbol, name, market_cap_rank from tokens where coingecko_id = ${id}`;
  if (!token) throw new Error(`No token ${id} in tokens`);

  const types = new Map<string, Map<string, string>>();
  for (const r of await sql<{ table_name: string; column_name: string; data_type: string }[]>`
    select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' order by ordinal_position`) {
    if (!types.has(r.table_name)) types.set(r.table_name, new Map());
    types.get(r.table_name)!.set(r.column_name, r.data_type);
  }

  const sections = [];
  for (const s of SECTIONS) {
    const rows = await s.query(id);
    const columns = [...(types.get(s.table)?.keys() ?? [])];
    if (s.table === "category_snapshots") columns.unshift("category_name");
    // Resolve the api_call behind each displayed row (exact provenance).
    const callIds = rows.map((r) => r.api_call_id).filter((x): x is string | number => x !== null && x !== undefined);
    const calls = callIds.length
      ? await sql`select id, provider, endpoint, params, started_at, raw_path from api_calls where id = any(${callIds.map(Number)})`
      : [];
    const callById = new Map(calls.map((c) => [String(c.id), c]));
    sections.push({
      table: s.table,
      group: s.group,
      source: s.source,
      cadence: s.cadence,
      note: s.note ?? null,
      total: await s.count(id),
      headers: rows.map((r, i) => (s.label ? s.label(r) : rows.length > 1 ? `row ${i + 1}` : "value")),
      provenance: rows.map((r) => {
        const c = r.api_call_id != null ? callById.get(String(r.api_call_id)) : undefined;
        return c ? `api_call #${c.id} · ${c.provider} ${c.endpoint} · ${(c.started_at as Date).toISOString().slice(0, 19).replace("T", " ")} UTC${c.raw_path ? " · raw archived" : ""}` : null;
      }),
      columns: columns.map((col) => ({
        name: col,
        type: types.get(s.table)?.get(col) ?? (col === "category_name" ? "text (joined)" : ""),
        values: rows.map((r) => fmt(r[col])),
      })),
    });
  }

  const data = {
    token,
    generatedAt: new Date().toISOString(),
    sections,
  };
  const out = process.argv[3] ?? path.join("reports", `${id}.html`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, renderHtml(data));
  console.log(`wrote ${out} (${sections.length} tables, ${sections.reduce((a, s) => a + s.columns.length, 0)} columns)`);
  await sql.end();
}

function renderHtml(data: { token: Record<string, unknown> }): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const title = `${String(data.token.name).replace(/[<&]/g, "")} Data Inspector`;
  return TEMPLATE.replace("__TITLE__", title).replace("__DATA__", () => json);
}

const TEMPLATE = String.raw`<title>__TITLE__</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{
  --bg:#f3f6f7; --panel:#ffffff; --ink:#122028; --muted:#5a6b74; --line:#d9e2e6; --soft:#e9eff1;
  --accent:#0a6a85; --accent-soft:#dcedf2;
  --cg:#8a5300; --cg-soft:#f6ead6; --cx:#1d5aa6; --cx-soft:#e0eafa; --id:#3d4a52; --id-soft:#e6ebee; --inv:#7a3d8c; --inv-soft:#f1e4f5; --ctx:#3f6b2e; --ctx-soft:#e4efdd;
  --null:#a3b1b8;
  --sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  --cond:"IBM Plex Sans Condensed","IBM Plex Sans",system-ui,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  color-scheme:dark;
  --bg:#0e1519; --panel:#141e23; --ink:#e3ecef; --muted:#93a5ad; --line:#26343b; --soft:#1a262c;
  --accent:#5cc3df; --accent-soft:#163038;
  --cg:#f0b357; --cg-soft:#33270f; --cx:#86b4f3; --cx-soft:#162641; --id:#b8c5cc; --id-soft:#222e34; --inv:#d8a3e8; --inv-soft:#2e1b35; --ctx:#9fd18a; --ctx-soft:#1c2c16;
  --null:#4d5e66;
}}
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#0e1519; --panel:#141e23; --ink:#e3ecef; --muted:#93a5ad; --line:#26343b; --soft:#1a262c;
  --accent:#5cc3df; --accent-soft:#163038;
  --cg:#f0b357; --cg-soft:#33270f; --cx:#86b4f3; --cx-soft:#162641; --id:#b8c5cc; --id-soft:#222e34; --inv:#d8a3e8; --inv-soft:#2e1b35; --ctx:#9fd18a; --ctx-soft:#1c2c16;
  --null:#4d5e66;
}
body{background:var(--bg);color:var(--ink);font:14px/1.5 var(--sans);padding-inline:16px;padding-block:0 48px}
.wrap{max-width:1280px;margin:0 auto}
header{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--bg);padding-block:18px 12px;border-bottom:1px solid var(--line);display:grid;gap:10px}
.title{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px}
h1{font:600 28px/1.1 var(--cond);margin:0;text-wrap:balance;letter-spacing:.2px}
.sym{font:500 15px var(--mono);color:var(--accent);background:var(--accent-soft);padding:2px 8px;border-radius:4px}
.meta{color:var(--muted);font-size:13px}
.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
input[type=search]{font:14px var(--mono);padding:7px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);min-width:0;flex:1 1 260px;max-width:420px}
input[type=search]:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.chip{font:500 12px var(--sans);border:1px solid var(--line);background:var(--panel);color:var(--muted);padding:5px 10px;border-radius:999px;cursor:pointer}
.chip[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:28px;margin-top:20px}
nav{position:sticky;top:150px;align-self:start;display:grid;gap:14px;font-size:13px}
nav h3{font:600 11px var(--sans);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 4px}
nav a{display:flex;justify-content:space-between;gap:8px;color:var(--ink);text-decoration:none;padding:3px 6px;border-radius:4px;font-family:var(--mono);font-size:12px}
nav a:hover{background:var(--soft)}
nav a .n{color:var(--muted)}
main{display:grid;gap:22px;min-width:0}
section{background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
.sec-head{padding:14px 16px;border-bottom:1px solid var(--line);display:grid;gap:6px}
.sec-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
h2{font:500 17px var(--mono);margin:0}
.tag{font:600 11px var(--sans);text-transform:uppercase;letter-spacing:.06em;padding:3px 8px;border-radius:4px}
.g-Identity{color:var(--id);background:var(--id-soft)} .g-CoinGecko{color:var(--cg);background:var(--cg-soft)}
.g-Exchanges{color:var(--cx);background:var(--cx-soft)} .g-Investigation{color:var(--inv);background:var(--inv-soft)} .g-Market{color:var(--ctx);background:var(--ctx-soft)}
.rows{margin-left:auto;font:500 12px var(--mono);color:var(--muted);font-variant-numeric:tabular-nums}
.src{font:13px var(--mono);color:var(--ink)}
.src b{font:600 11px var(--sans);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-right:6px}
.note{color:var(--muted);font-size:13px;max-width:80ch}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;vertical-align:top;padding:7px 12px;border-bottom:1px solid var(--soft)}
thead th{font:600 12px var(--sans);color:var(--muted);background:var(--soft);white-space:nowrap;position:sticky;top:0}
thead th.val{font-family:var(--mono);color:var(--ink)}
td.col{font:500 12.5px var(--mono);white-space:nowrap;color:var(--ink)}
td.type{font:12px var(--mono);color:var(--muted);white-space:nowrap}
td.v{font:12.5px var(--mono);font-variant-numeric:tabular-nums;max-width:420px;overflow-wrap:anywhere}
td.v.null::after{content:"null";color:var(--null)}
details summary{cursor:pointer;color:var(--accent);font:12px var(--mono)}
details pre{margin:6px 0 0;max-height:320px;overflow:auto;background:var(--soft);padding:8px;border-radius:4px;font:11.5px/1.45 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere}
.prov{font:11.5px var(--mono);color:var(--muted)}
.empty{padding:14px 16px;color:var(--muted);font-size:13px}
tr.hide,section.hide{display:none}
@media (max-width:860px){.layout{grid-template-columns:1fr}nav{position:static;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}header{position:static}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style>
<div class="wrap">
  <header>
    <div class="title"><h1 id="name"></h1><span class="sym" id="sym"></span><span class="meta" id="meta"></span></div>
    <div class="controls">
      <input type="search" id="q" placeholder="Filter columns, e.g. volume, funding, rank" aria-label="Filter columns">
      <button class="chip" data-g="all" aria-pressed="true">All</button>
      <button class="chip" data-g="Identity" aria-pressed="false">Identity</button>
      <button class="chip" data-g="CoinGecko" aria-pressed="false">CoinGecko</button>
      <button class="chip" data-g="Exchanges (CCXT)" aria-pressed="false">Exchanges</button>
      <button class="chip" data-g="Market context" aria-pressed="false">Context</button>
      <button class="chip" data-g="Investigation" aria-pressed="false">Investigation</button>
    </div>
  </header>
  <div class="layout"><nav id="nav"></nav><main id="main"></main></div>
</div>
<script>
const DATA = __DATA__;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const gclass = (g) => "g-" + g.split(" ")[0];
const t = DATA.token;
$("#name").textContent = t.name;
$("#sym").textContent = t.symbol;
const totalCols = DATA.sections.reduce((a, s) => a + s.columns.length, 0);
$("#meta").textContent = "coingecko_id: " + t.coingecko_id + " · rank #" + t.market_cap_rank + " · " + DATA.sections.length + " tables · " + totalCols + " columns · snapshot " + DATA.generatedAt.slice(0, 16).replace("T", " ") + " UTC";

const groups = [...new Set(DATA.sections.map((s) => s.group))];
$("#nav").innerHTML = groups.map((g) => "<div><h3>" + esc(g) + "</h3>" + DATA.sections.filter((s) => s.group === g)
  .map((s) => '<a href="#' + s.table + '"><span>' + s.table + '</span><span class="n">' + s.total.toLocaleString() + "</span></a>").join("") + "</div>").join("");

$("#main").innerHTML = DATA.sections.map((s) => {
  const head = '<div class="sec-head"><div class="sec-top"><h2>' + s.table + '</h2><span class="tag ' + gclass(s.group) + '">' + esc(s.group) + '</span><span class="rows">' + s.total.toLocaleString() + " rows for this token</span></div>"
    + '<div class="src"><b>Source</b>' + esc(s.source) + '</div><div class="src"><b>Refresh</b>' + esc(s.cadence) + "</div>"
    + (s.note ? '<div class="note">' + esc(s.note) + "</div>" : "") + "</div>";
  if (!s.headers.length) {
    return '<section id="' + s.table + '" data-g="' + esc(s.group) + '">' + head + '<div class="empty">No rows yet. Columns: ' + s.columns.map((c) => c.name).join(", ") + "</div></section>";
  }
  const prov = s.provenance.some(Boolean) ? '<tr class="provrow"><td class="col">↳ fetched by</td><td class="type"></td>' + s.provenance.map((p) => '<td class="prov">' + (p ? esc(p) : "—") + "</td>").join("") + "</tr>" : "";
  const rows = s.columns.map((c) => '<tr data-c="' + esc(c.name.toLowerCase()) + '"><td class="col">' + esc(c.name) + '</td><td class="type">' + esc(c.type) + "</td>"
    + c.values.map((v) => !v.text ? '<td class="v null"></td>' : v.json
      ? '<td class="v"><details><summary>JSON · ' + v.text.length.toLocaleString() + " chars</summary><pre>" + esc(v.text) + "</pre></details></td>"
      : '<td class="v">' + esc(v.text) + "</td>").join("") + "</tr>").join("");
  return '<section id="' + s.table + '" data-g="' + esc(s.group) + '">' + head + '<div class="scroll"><table><thead><tr><th>Column</th><th>Type</th>'
    + s.headers.map((h) => '<th class="val">' + esc(h) + "</th>").join("") + "</tr></thead><tbody>" + prov + rows + "</tbody></table></div></section>";
}).join("");

let group = "all";
function apply() {
  const q = $("#q").value.trim().toLowerCase();
  document.querySelectorAll("main section").forEach((sec) => {
    const inGroup = group === "all" || sec.dataset.g === group;
    let any = false;
    sec.querySelectorAll("tbody tr[data-c]").forEach((tr) => { const m = !q || tr.dataset.c.includes(q); tr.classList.toggle("hide", !m); any ||= m; });
    sec.classList.toggle("hide", !inGroup || (q && !any && sec.querySelector("tbody")));
  });
}
$("#q").addEventListener("input", apply);
document.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
  group = b.dataset.g;
  document.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  apply();
}));
</script>
`;

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
