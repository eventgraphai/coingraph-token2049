import { timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { withX402, x402ResourceServer, type RouteConfig } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactCardanoScheme } from "@x402/cardano/exact/server";
import { BASE_URL, clientIp } from "../api/respond";
import { lovelace, PAYMENT, TIERS, X402_ENABLED, type Tier } from "../api/pricing";

const NETWORK = PAYMENT.network as `${string}:${string}`;

// x402 seller side (the "exact" scheme on Cardano). A paid route answers 402 with payment requirements; the
// caller pays in tADA on preprod, retries with PAYMENT-SIGNATURE, the facilitator verifies and settles, and the
// handler's answer is released. Three ways through without paying:
//   1. a design-partner key (Authorization: Bearer cg_…), configured in COINGRAPH_PARTNER_KEYS as "key:name,…"
//   2. the website's own playground (browser requests marked same-origin by the browser), within a daily allowance
//   3. the free daily allowance for Data calls (25/day per caller)
// If x402 is not configured (no seller address or facilitator) every route stays free.

type Ctx = { params: Promise<Record<string, string>> };
export type RouteHandler = (req: Request, ctx: Ctx) => Promise<Response>;
type Decision = { kind: "pay" } | { kind: "free"; via: "partner" | "allowance" | "disabled"; requester: string };

const CTX = new WeakMap<Request, Ctx>();
const DECISION = new WeakMap<Request, Decision>();

let server: x402ResourceServer | null = null;
function resourceServer(): x402ResourceServer {
  if (!server) {
    // Settlement waits for block inclusion on preprod (~20-60 s, sometimes longer): give the facilitator time.
    server = new x402ResourceServer(new HTTPFacilitatorClient({ url: PAYMENT.facilitator!, timeoutMs: 180_000 }));
    server.register(NETWORK, new ExactCardanoScheme());
  }
  return server;
}

// ---- Partner keys -------------------------------------------------------------------------------
function partnerFor(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(cg_[A-Za-z0-9_-]{16,})$/.exec(auth);
  if (!m) return null;
  const given = Buffer.from(m[1]);
  for (const entry of (process.env.COINGRAPH_PARTNER_KEYS ?? "").split(",")) {
    const [key, name] = entry.trim().split(":");
    if (!key) continue;
    const k = Buffer.from(key);
    if (k.length === given.length && timingSafeEqual(k, given)) return name || "partner";
  }
  return null;
}

// ---- Daily allowance ----------------------------------------------------------------------------
const buckets = new Map<string, { day: string; n: number }>();
function takeAllowance(key: string, limit: number): boolean {
  if (!Number.isFinite(limit)) return true;
  const day = new Date().toISOString().slice(0, 10);
  const b = buckets.get(key);
  if (!b || b.day !== day) { buckets.set(key, { day, n: 1 }); if (buckets.size > 50_000) buckets.clear(); return limit >= 1; }
  if (b.n >= limit) return false;
  b.n += 1;
  return true;
}
const fromOurSite = (req: Request) => req.headers.get("sec-fetch-site") === "same-origin" && (req.headers.get("origin") ?? "").replace(/\/$/, "") === BASE_URL.replace(/\/$/, "");

// Who is paying for this request, and how. Recorded for the handler via `requesterOf`.
function decide(req: Request, tier: Tier, group: string): Decision {
  if (!X402_ENABLED) return { kind: "free", via: "disabled", requester: "anonymous" };
  const partner = partnerFor(req);
  if (partner) return { kind: "free", via: "partner", requester: `partner:${partner}` };
  const info = TIERS[tier];
  // Data calls carry a public allowance; Premium/Pro allowances are for the website playground only.
  const allowanceApplies = tier === "data" || fromOurSite(req);
  if (allowanceApplies && takeAllowance(`${group}:${tier}:${clientIp(req)}`, info.free_per_day)) return { kind: "free", via: "allowance", requester: fromOurSite(req) ? "website" : "anonymous" };
  return { kind: "pay" };
}

export const requesterOf = (req: Request): string => {
  const d = DECISION.get(req);
  return d?.kind === "free" ? d.requester : "x402";
};

// ---- The gate -----------------------------------------------------------------------------------
export type PaidOptions = { tier: Tier | ((req: Request, ctx: Ctx) => Promise<Tier>); description: string; group: string };

export function paid(handler: RouteHandler, opts: PaidOptions): RouteHandler {
  const gated = new Map<Tier, (req: NextRequest) => Promise<NextResponse>>();
  const gate = (tier: Tier) => {
    let g = gated.get(tier);
    if (!g) {
      const json = (body: unknown) => ({ contentType: "application/json", body: JSON.stringify(body) });
      const route: RouteConfig = {
        accepts: {
          scheme: "exact", network: NETWORK, payTo: PAYMENT.address!, price: { asset: PAYMENT.asset, amount: lovelace(TIERS[tier].tada) }, maxTimeoutSeconds: 600,
          // Testnet micro-payments settle on the facilitator's own broadcast acceptance (-1); preprod block inclusion can take
          // minutes. Raise X402_L1_CONFIRMATIONS (0 = block inclusion, 1+ = depth) for real value.
          extra: { confirmationPolicy: { l1Confirmations: Number(process.env.X402_L1_CONFIRMATIONS ?? -1) } },
        },
        description: `${opts.description} (${TIERS[tier].label} tier, ${TIERS[tier].tada} tADA)`,
        mimeType: "application/json",
        serviceName: "CoinGraph",
        unpaidResponseBody: () => json({ error: { code: "payment_required", message: `This call costs ${TIERS[tier].tada} tADA on ${PAYMENT.network} (x402). Decode the PAYMENT-REQUIRED header, pay, and retry with PAYMENT-SIGNATURE; or send a design-partner key as Authorization: Bearer cg_…. Docs: ${BASE_URL}/docs/pricing` }, pricing: { tier, testnet_tada: TIERS[tier].tada, mainnet_usd: TIERS[tier].usd, asset: PAYMENT.asset, network: PAYMENT.network, pay_to: PAYMENT.address } }),
        settlementFailedResponseBody: (_ctx, result) => json({ error: { code: "settlement_failed", message: "Your payment could not be confirmed in time. If it was broadcast, retry the same request with the same PAYMENT-SIGNATURE: the facilitator resumes the same transaction and never charges twice.", detail: (result as { errorReason?: string }).errorReason ?? null, transaction: (result as { transaction?: string }).transaction ?? null } }),
      };
      const inner = async (req: NextRequest) => (await handler(req, CTX.get(req)!)) as NextResponse;
      g = withX402(inner, route, resourceServer());
      gated.set(tier, g);
    }
    return g;
  };
  return async (req, ctx) => {
    const tier = typeof opts.tier === "function" ? await opts.tier(req, ctx) : opts.tier;
    const decision = decide(req, tier, opts.group);
    DECISION.set(req, decision);
    if (decision.kind === "free") return handler(req, ctx);
    CTX.set(req, ctx);
    return gate(tier)(req as NextRequest);
  };
}
