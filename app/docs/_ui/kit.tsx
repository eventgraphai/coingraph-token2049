import Link from "next/link";
import type { ReactNode } from "react";
import { BASE_URL } from "@/lib/api/respond";
import examplesFile from "@/lib/docs/examples.json";
import { docMeta } from "@/lib/docs/nav";
import { CodeTabs, Copy, type Sample } from "./client";

export const API = `${BASE_URL}/api/v1`;

/* ================================================================ Page frame */
export function DocPage({ href, title, lede, children, eyebrow }: { href: string; title?: string; lede?: ReactNode; eyebrow?: string; children: ReactNode }) {
  const { page, prev, next } = docMeta(href);
  return (
    <article className="min-w-0 py-8 lg:py-10">
      <p className="text-[12.5px] font-medium text-brand">{eyebrow ?? page?.group}</p>
      <h1 className="mt-2 text-[clamp(28px,3.4vw,36px)] font-semibold leading-tight tracking-[-0.02em] text-bone">{title ?? page?.title}</h1>
      {(lede ?? page?.description) && <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-mist">{lede ?? page?.description}</p>}
      <div id="doc-content" className="docs-prose mt-8 max-w-3xl text-[15px] text-bone/90">{children}</div>
      <nav aria-label="Previous and next" className="mt-14 grid max-w-3xl gap-3 border-t border-edge pt-6 sm:grid-cols-2">
        {prev ? (
          <Link href={prev.href} className="no-u group rounded-xl border border-edge p-4 transition-colors hover:border-brand/50">
            <p className="text-[12px] text-mist">← Previous</p>
            <p className="mt-1 font-medium text-bone group-hover:text-brand">{prev.title}</p>
          </Link>
        ) : <span />}
        {next && (
          <Link href={next.href} className="no-u group rounded-xl border border-edge p-4 text-right transition-colors hover:border-brand/50">
            <p className="text-[12px] text-mist">Next →</p>
            <p className="mt-1 font-medium text-bone group-hover:text-brand">{next.title}</p>
          </Link>
        )}
      </nav>
    </article>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function H2({ children, id, toc }: { children: ReactNode; id?: string; toc?: string }) {
  const anchor = id ?? slug(typeof children === "string" ? children : toc ?? "section");
  return (
    <h2 id={anchor} data-toc={toc} className="group mt-12 mb-3 scroll-mt-24 text-[22px] font-semibold tracking-[-0.01em] text-bone first:mt-0">
      {children} <a href={`#${anchor}`} className="docs-anchor no-u text-mist" aria-label="Link to this section">#</a>
    </h2>
  );
}
export function H3({ children, id, toc }: { children: ReactNode; id?: string; toc?: string }) {
  const anchor = id ?? slug(typeof children === "string" ? children : toc ?? "sub");
  return (
    <h3 id={anchor} data-toc={toc} className="group mt-8 mb-2 scroll-mt-24 text-[17px] font-semibold text-bone">
      {children} <a href={`#${anchor}`} className="docs-anchor no-u text-mist" aria-label="Link to this section">#</a>
    </h3>
  );
}
export const P = ({ children }: { children: ReactNode }) => <p className="my-3">{children}</p>;
export const C = ({ children }: { children: ReactNode }) => <code>{children}</code>;
export function UL({ children }: { children: ReactNode }) {
  return <ul className="my-3 list-disc space-y-1.5 pl-5 marker:text-mist">{children}</ul>;
}

/* ================================================================ Callouts */
const CALLOUT = {
  note: { label: "Note", cls: "border-edge bg-slab", icon: "i" },
  tip: { label: "Tip", cls: "border-brand/40 bg-brand/[0.06]", icon: "✓" },
  warn: { label: "Important", cls: "border-ember/40 bg-ember/[0.07]", icon: "!" },
};
export function Callout({ kind = "note", title, children }: { kind?: keyof typeof CALLOUT; title?: string; children: ReactNode }) {
  const c = CALLOUT[kind];
  return (
    <div className={`my-5 flex gap-3 rounded-xl border px-4 py-3 text-[14px] ${c.cls}`}>
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${kind === "warn" ? "bg-ember/20 text-ember" : kind === "tip" ? "bg-brand/20 text-brand" : "bg-edge text-mist"}`}>{c.icon}</span>
      <div className="min-w-0"><p className="font-semibold text-bone">{title ?? c.label}</p><div className="mt-0.5 text-bone/85 [&>p]:my-1">{children}</div></div>
    </div>
  );
}

/* ================================================================ Cards */
export function Cards({ items, cols = 2 }: { items: { title: string; href: string; text: string; tag?: string }[]; cols?: 2 | 3 }) {
  return (
    <div className={`my-6 grid gap-3 ${cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2"}`}>
      {items.map((it) => (
        <Link key={it.href + it.title} href={it.href} className="no-u group rounded-xl border border-edge bg-slab p-4 transition-colors hover:border-brand/50">
          <p className="flex items-center justify-between gap-2 font-semibold text-bone group-hover:text-brand">{it.title}{it.tag && <span className="numerals rounded border border-edge px-1.5 py-0.5 text-[10px] font-normal text-mist">{it.tag}</span>}</p>
          <p className="mt-1.5 text-[13.5px] leading-snug text-mist">{it.text}</p>
        </Link>
      ))}
    </div>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="my-6 space-y-6 border-l border-edge pl-6 [counter-reset:step]">{children}</ol>;
}
export function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="relative [counter-increment:step] before:absolute before:-left-[37px] before:grid before:h-6 before:w-6 before:place-items-center before:rounded-full before:border before:border-edge before:bg-void before:text-[12px] before:font-semibold before:text-brand before:content-[counter(step)]">
      <p className="font-semibold text-bone">{title}</p>
      <div className="mt-1">{children}</div>
    </li>
  );
}

/* ================================================================ Tables */
export type Param = { name: string; type: string; required?: boolean; in?: string; description: ReactNode; default?: string };
export function Params({ rows, title = "Parameters" }: { rows: Param[]; title?: string }) {
  if (!rows.length) return null;
  return (
    <div className="my-5 overflow-hidden rounded-xl border border-edge">
      <p className="border-b border-edge bg-slab px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-mist">{title}</p>
      <ul className="divide-y divide-edge">
        {rows.map((r) => (
          <li key={r.name} className="px-4 py-3">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <code className="border-0! bg-transparent! p-0! font-semibold text-bone">{r.name}</code>
              <span className="numerals text-[12px] text-mist">{r.type}</span>
              {r.in && <span className="numerals text-[11px] text-mist">· {r.in}</span>}
              {r.required ? <span className="text-[11px] font-medium text-ember">required</span> : <span className="text-[11px] text-mist">optional</span>}
              {r.default && <span className="numerals text-[11px] text-mist">default {r.default}</span>}
            </p>
            <div className="mt-1 text-[14px] leading-relaxed text-bone/80">{r.description}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="my-5 overflow-x-auto rounded-xl border border-edge">
      <table className="w-full min-w-[520px] text-left text-[14px]">
        <thead className="bg-slab text-[12px] uppercase tracking-[0.06em] text-mist">
          <tr>{head.map((h) => <th key={h} className="px-4 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {rows.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k} className="px-4 py-2.5 align-top text-bone/85">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

/* ================================================================ Endpoint header */
const METHOD: Record<string, string> = { GET: "bg-life/15 text-life", POST: "bg-brand/15 text-brand", DELETE: "bg-blood/15 text-blood" };
export function Endpoint({ method, path }: { method: string; path: string }) {
  return (
    <div className="my-3 flex items-center gap-3 rounded-xl border border-edge bg-slab px-3 py-2.5">
      <span className={`numerals rounded-md px-2 py-0.5 text-[12px] font-bold ${METHOD[method] ?? "bg-edge text-mist"}`}>{method}</span>
      <code className="border-0! bg-transparent! p-0! min-w-0 flex-1 truncate text-[14px] text-bone">{path}</code>
      <span className="hidden sm:inline"><Copy text={`${API}${path.replace(/^\/v1/, "")}`} className="border-edge! bg-transparent! text-mist!" /></span>
    </div>
  );
}

/* ================================================================ JSON highlighting */
export function highlightJson(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      if (m[2]) out.push(<span key={k++} className="j-key">{m[1]}</span>, m[2]);
      else out.push(<span key={k++} className="j-str">{m[1]}</span>);
    } else if (m[3]) out.push(<span key={k++} className="j-lit">{m[3]}</span>);
    else if (m[4]) out.push(<span key={k++} className="j-num">{m[4]}</span>);
    else out.push(<span key={k++} className="j-pun">{m[5]}</span>);
    last = re.lastIndex;
  }
  out.push(text.slice(last));
  return out;
}

export function JsonBlock({ value, title }: { value: unknown; title?: string }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <CodeTabs title={title} samples={[{ label: "JSON", code: text, node: highlightJson(text) }]} />;
}

/* ================================================================ Request samples */
export function samples(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Sample[] {
  const url = `${API}${path}`;
  const hasBody = body !== undefined && method !== "GET";
  const json = hasBody ? JSON.stringify(body) : "";
  const pretty = hasBody ? JSON.stringify(body, null, 2) : "";
  const hdrs = { ...(hasBody ? { "content-type": "application/json" } : {}), ...headers };
  const curlH = Object.entries(hdrs).map(([k, v]) => ` \\\n  -H "${k}: ${v}"`).join("");
  const curl = method === "GET" && !Object.keys(headers).length
    ? `curl "${url}"`
    : `curl${method === "GET" ? "" : ` -X ${method}`} "${url}"${curlH}${hasBody ? ` \\\n  -d '${json}'` : ""}`;
  const jsOpts = [
    ...(method !== "GET" ? [`  method: "${method}",`] : []),
    ...(Object.keys(hdrs).length ? [`  headers: ${JSON.stringify(hdrs).replace(/":"/g, '": "').replace(/","/g, '", "')},`] : []),
    ...(hasBody ? [`  body: JSON.stringify(${pretty.replace(/\n/g, "\n  ")}),`] : []),
  ];
  const js = jsOpts.length
    ? `const res = await fetch("${url}", {\n${jsOpts.join("\n")}\n});\nconst { data } = await res.json();`
    : `const res = await fetch("${url}");\nconst { data, sources, as_of } = await res.json();`;
  const pyArgs = [`    "${url}",`, ...(Object.keys(headers).length ? [`    headers=${JSON.stringify(headers)},`] : []), ...(hasBody ? [`    json=${toPy(body)},`] : [])];
  const py = `import requests\n\nres = requests.${method.toLowerCase()}(\n${pyArgs.join("\n")}\n)\ndata = res.json()["data"]`;
  return [{ label: "cURL", code: curl }, { label: "JavaScript", code: js }, { label: "Python", code: py }];
}
function toPy(v: unknown): string {
  return JSON.stringify(v, null, 4).replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None").replace(/\n/g, "\n    ");
}

export function Request({ method, path, body, headers, title = "Request" }: { method: string; path: string; body?: unknown; headers?: Record<string, string>; title?: string }) {
  return <CodeTabs title={title} samples={samples(method, path, body, headers)} />;
}

/* ================================================================ Real examples */
type Ex = { request: { method: string; path: string; body?: unknown }; response: unknown };
const EXAMPLES = (examplesFile as { captured_at: string; examples: Record<string, Ex> }).examples;
export const CAPTURED_AT = (examplesFile as { captured_at: string }).captured_at;
export const example = (key: string): Ex | undefined => EXAMPLES[key];

export function Example({ id, label, showRequest = true }: { id: string; label?: string; showRequest?: boolean }) {
  const ex = EXAMPLES[id];
  if (!ex) return <Callout kind="note">Example not captured yet.</Callout>;
  return (
    <div className="my-5">
      {label && <p className="mb-1 text-[13px] font-medium text-bone">{label}</p>}
      {showRequest && <Request method={ex.request.method} path={ex.request.path} body={ex.request.body} />}
      <JsonBlock value={ex.response} title={`Response · real, captured ${CAPTURED_AT.slice(0, 16).replace("T", " ")} UTC · long lists trimmed`} />
    </div>
  );
}

/* ================================================================ JSON Schema → parameter rows */
type Schema = { type?: string | string[]; description?: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema; enum?: unknown[]; default?: unknown; minimum?: number; maximum?: number; anyOf?: Schema[] };
const typeOf = (s: Schema): string => {
  if (s.enum) return s.enum.map((e) => JSON.stringify(e)).join(" | ");
  if (s.anyOf) return s.anyOf.map(typeOf).join(" | ");
  if (s.type === "array") return `${s.items ? typeOf(s.items) : "any"}[]`;
  return Array.isArray(s.type) ? s.type.join(" | ") : s.type ?? "any";
};
export function schemaParams(schema: Schema, notes: Record<string, string> = {}, prefix = ""): Param[] {
  const rows: Param[] = [];
  for (const [k, s] of Object.entries(schema.properties ?? {})) {
    const name = prefix + k;
    const range = s.minimum !== undefined || s.maximum !== undefined ? ` (${s.minimum ?? "…"}–${s.maximum ?? "…"})` : "";
    rows.push({ name, type: typeOf(s) + range, required: (schema.required ?? []).includes(k) && s.default === undefined, default: s.default !== undefined ? JSON.stringify(s.default) : undefined, description: notes[name] ?? s.description ?? "" });
    if (s.type === "object" && s.properties) rows.push(...schemaParams(s, notes, `${name}.`));
  }
  return rows;
}

export function Badge({ children, tone = "mist" }: { children: ReactNode; tone?: "good" | "warn" | "bad" | "mist" | "brand" }) {
  const cls = { good: "border-life/40 text-life bg-life/10", warn: "border-ember/40 text-ember bg-ember/10", bad: "border-blood/40 text-blood bg-blood/10", mist: "border-edge text-mist bg-slab", brand: "border-brand/40 text-brand bg-brand/10" }[tone];
  return <span className={`numerals inline-block rounded border px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}
