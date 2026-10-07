// Small server-rendered SVG charts. No client code, no libraries: each chart is a few hundred bytes of SVG,
// which keeps a page with a dozen charts fast and crawlable.

const fmtCompact = (v: number) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const fmtNum = (v: number, digits = 2) => Intl.NumberFormat("en", { maximumFractionDigits: v >= 1000 ? 0 : digits }).format(v);

export type Point = [number, number]; // [time ms, value]

function scale(points: Point[], w: number, h: number, pad = 2, zeroBase = false) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (zeroBase) { y0 = Math.min(0, y0); y1 = Math.max(0, y1); }
  if (y1 === y0) { y0 -= 1; y1 += 1; }
  const X = (x: number) => pad + ((x - x0) / Math.max(1, x1 - x0)) * (w - 2 * pad);
  const Y = (y: number) => h - pad - ((y - y0) / (y1 - y0)) * (h - 2 * pad);
  return { X, Y, y0, y1, x0, x1 };
}

// A tiny line for table rows: green if it ends above where it started, red otherwise.
export function Sparkline({ points, w = 96, h = 28 }: { points: Point[]; w?: number; h?: number }) {
  if (points.length < 2) return <svg width={w} height={h} aria-hidden />;
  const { X, Y } = scale(points, w, h);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(" ");
  const up = points[points.length - 1][1] >= points[0][1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label={up ? "up" : "down"} className="block">
      <path d={d} fill="none" stroke={up ? "var(--color-life)" : "var(--color-blood)"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// A line chart with a filled area, min/max labels and a few time ticks.
export function LineChart({ points, h = 160, unit = "$", color = "var(--color-brand)", zeroBase = false, title }: { points: Point[]; h?: number; unit?: string; color?: string; zeroBase?: boolean; title?: string }) {
  const w = 640;
  if (points.length < 2) return <p className="text-[12px] text-mist">Not enough data yet.</p>;
  const { X, Y, y0, y1, x0, x1 } = scale(points, w, h, 6, zeroBase);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(" ");
  const area = `${d} L${X(x1).toFixed(1)} ${h - 6} L${X(x0).toFixed(1)} ${h - 6} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => x0 + f * (x1 - x0));
  const span = x1 - x0;
  const label = (t: number) => (span > 3 * 86_400_000 ? new Date(t).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" }) : new Date(t).toISOString().slice(11, 16));
  const fmt = (v: number) => (unit === "$" ? `$${fmtCompact(v)}` : unit === "%" ? `${fmtNum(v, 3)}%` : fmtCompact(v));
  const last = points[points.length - 1][1];
  return (
    <figure className="w-full">
      {title && <figcaption className="mb-1 flex items-baseline justify-between text-[12px]"><span className="text-mist">{title}</span><span className="numerals text-bone">{fmt(last)}</span></figcaption>}
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={title}>
        <defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.25" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        {zeroBase && y0 < 0 && y1 > 0 && <line x1={6} x2={w - 6} y1={Y(0)} y2={Y(0)} stroke="var(--color-edge)" strokeDasharray="3 4" />}
        <path d={area} fill="url(#area)" />
        <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
        <text x={8} y={14} fontSize="10" fill="var(--color-mist)" style={{ fontFamily: "var(--font-mono)" }}>{fmt(y1)}</text>
        <text x={8} y={h - 10} fontSize="10" fill="var(--color-mist)" style={{ fontFamily: "var(--font-mono)" }}>{fmt(y0)}</text>
        {ticks.map((t, i) => <text key={i} x={X(t)} y={h - 0} fontSize="9" textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} fill="var(--color-mist)" style={{ fontFamily: "var(--font-mono)" }}>{label(t)}</text>)}
      </svg>
    </figure>
  );
}

// Vertical bars around zero: inflow/outflow, funding, net flow.
export function BarChart({ points, h = 120, title, unit = "$" }: { points: Point[]; h?: number; title?: string; unit?: string }) {
  const w = 640;
  if (!points.length) return <p className="text-[12px] text-mist">Not enough data yet.</p>;
  const max = Math.max(1e-9, ...points.map((p) => Math.abs(p[1])));
  const mid = h / 2;
  const bw = Math.max(1, (w - 12) / points.length - 1);
  const fmt = (v: number) => (unit === "$" ? `$${fmtCompact(v)}` : unit === "%" ? `${fmtNum(v, 3)}%` : fmtCompact(v));
  return (
    <figure className="w-full">
      {title && <figcaption className="mb-1 flex items-baseline justify-between text-[12px]"><span className="text-mist">{title}</span><span className="numerals text-bone">±{fmt(max)}</span></figcaption>}
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={title}>
        <line x1={6} x2={w - 6} y1={mid} y2={mid} stroke="var(--color-edge)" />
        {points.map((p, i) => {
          const x = 6 + i * ((w - 12) / points.length);
          const hh = (Math.abs(p[1]) / max) * (mid - 4);
          return <rect key={i} x={x} y={p[1] >= 0 ? mid - hh : mid} width={bw} height={Math.max(0.5, hh)} fill={p[1] >= 0 ? "var(--color-life)" : "var(--color-blood)"} opacity="0.85" />;
        })}
      </svg>
    </figure>
  );
}

// Horizontal bars for a few labelled values (depth per venue, reserves per exchange).
export function HBars({ rows, unit = "$" }: { rows: { label: string; value: number; hint?: string }[]; unit?: string }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
  const fmt = (v: number) => (unit === "$" ? `$${fmtCompact(v)}` : unit === "%" ? `${fmtNum(v, 2)}%` : fmtCompact(v));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[110px_1fr_70px] items-center gap-2 text-[12px]">
          <span className="truncate text-bone/90" title={r.hint ?? r.label}>{r.label}</span>
          <span className="h-2 overflow-hidden rounded bg-ink"><span className="block h-full rounded bg-brand/70" style={{ width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%` }} /></span>
          <span className="numerals text-right text-mist">{fmt(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

// Two-sided bar: percentage of a whole (e.g. share of tokens up vs down).
export function Split({ left, right, leftLabel, rightLabel }: { left: number; right: number; leftLabel: string; rightLabel: string }) {
  const total = Math.max(1, left + right);
  const l = Math.round((left / total) * 100);
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded bg-ink"><span className="bg-life" style={{ width: `${l}%` }} /><span className="bg-blood" style={{ width: `${100 - l}%` }} /></div>
      <div className="mt-1 flex justify-between text-[11px] text-mist"><span><span className="text-life">{left}</span> {leftLabel}</span><span><span className="text-blood">{right}</span> {rightLabel}</span></div>
    </div>
  );
}

export const money = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? "—" : v >= 1 ? `$${fmtNum(v, digits)}` : `$${v.toPrecision(3)}`);
export const compactMoney = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `$${fmtCompact(v)}`);
export const pct = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${fmtNum(v, digits)}%`);
export const pctTone = (v: number | null | undefined) => (v == null ? "text-mist" : v > 0 ? "text-life" : v < 0 ? "text-blood" : "text-mist");
