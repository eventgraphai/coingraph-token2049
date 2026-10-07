// An AI agent buying a CoinGraph answer with x402 on Cardano preprod.
//
//   npx tsx scripts/x402-buyer.ts [base-url] [agent-id] ['{"token":"solana","size_usd":5000}']
//
// It calls a paid route, receives 402 Payment Required, builds and signs a tADA payment from the buyer wallet
// (CARDANO_BUYER_MNEMONIC in .env.local), retries with PAYMENT-SIGNATURE, and prints the verdict plus the
// on-chain receipt. Spending is capped per payment by the spend controls below.

import { readFileSync } from "node:fs";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import { toClientCardanoSigner } from "@x402/cardano";

function loadEnv(path = ".env.local") {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^([A-Z_0-9]+)=(.*)$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch { /* no env file */ }
}
loadEnv();

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const AGENT = process.argv[3] ?? "trade-gatekeeper";
const BODY = process.argv[4] ?? JSON.stringify({ token: "solana", size_usd: 5000, side: "buy" });
const MAX_TADA_PER_PAYMENT = 12;

const mnemonic = process.env.CARDANO_BUYER_MNEMONIC;
const projectId = process.env.BLOCKFROST_PROJECT_ID;
if (!mnemonic || !projectId) { console.error("Need CARDANO_BUYER_MNEMONIC and BLOCKFROST_PROJECT_ID in .env.local"); process.exit(1); }

const signer = toClientCardanoSigner({
  mnemonic,
  network: "cardano:preprod",
  provider: { blockfrost: { baseUrl: process.env.BLOCKFROST_BASE_URL ?? "https://cardano-preprod.blockfrost.io/api/v0", projectId }, requestTimeoutMs: 30_000 },
});
const client = new x402Client()
  .register("cardano:*", new ExactCardanoScheme(signer))
  .setSpendControls({ allowedAssets: [{ network: "cardano:*", asset: "lovelace", maxAmountPerPayment: String(MAX_TADA_PER_PAYMENT * 1_000_000) }] });
const payingFetch = wrapFetchWithPayment(fetch, client);

async function main() {
  const url = `${BASE}/api/v1/agents/${AGENT}`;
  console.log(`Agent → POST ${url}\n       body ${BODY}`);

  // 1. Look at the price first (plain fetch, no payment).
  const quote = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: BODY });
  const required = quote.headers.get("PAYMENT-REQUIRED");
  if (quote.status !== 402 || !required) { console.log(`No payment required (HTTP ${quote.status}); the route is free for this caller.`); console.log((await quote.text()).slice(0, 400)); return; }
  const req = decodePaymentRequiredHeader(required);
  const offer = req.accepts[0];
  console.log(`Seller ← 402 Payment Required: ${Number(offer.amount) / 1_000_000} tADA on ${offer.network} to ${offer.payTo.slice(0, 16)}… (${req.resource?.description ?? ""})`);

  // 2. Pay and retry automatically.
  const t = Date.now();
  console.log("Agent  → signing a Cardano payment and retrying with PAYMENT-SIGNATURE …");
  const res = await payingFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: BODY });
  const text = await res.text();
  const receiptHeader = res.headers.get("PAYMENT-RESPONSE");
  const receipt = receiptHeader ? decodePaymentResponseHeader(receiptHeader) : null;
  console.log(`Seller ← HTTP ${res.status} after ${((Date.now() - t) / 1000).toFixed(1)}s`);
  if (receipt) {
    console.log(`Receipt: ${JSON.stringify(receipt)}`);
    if (receipt.success && receipt.transaction) console.log(`         https://preprod.cardanoscan.io/transaction/${receipt.transaction}`);
  }
  try {
    const json = JSON.parse(text);
    const d = json.data ?? json;
    console.log(`Answer:  ${d.verdict ?? ""} — ${(d.summary ?? JSON.stringify(d)).slice(0, 200)}`);
    if (d.verify_url) console.log(`Proof:   ${d.verify_url}`);
  } catch { console.log(text.slice(0, 500)); }
  if (res.status >= 400) process.exit(1);
}

main().catch((e) => { console.error("Buyer failed:", e instanceof Error ? e.message : e); process.exit(1); });
