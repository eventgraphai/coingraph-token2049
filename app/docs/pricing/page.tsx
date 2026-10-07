import type { Metadata } from "next";
import Link from "next/link";
import { PAYMENT } from "@/lib/api/pricing";
import { CodeTabs } from "../_ui/client";
import { API, Badge, C, Callout, DocPage, H2, H3, P, Step, Steps, Table, highlightJson } from "../_ui/kit";

export const metadata: Metadata = { title: "Pricing & payments", description: "CoinGraph tiers, x402 pay-per-call on Cardano (live on preprod), Masumi, and design-partner API keys." };

const PAYMENT_REQUIRED = JSON.stringify({
  x402Version: 2,
  error: "Payment required",
  resource: { url: `${API}/agents/trade-gatekeeper`, description: "Run a CoinGraph agent (Premium tier, 5 tADA)", mimeType: "application/json", serviceName: "CoinGraph" },
  accepts: [{ scheme: "exact", network: "cardano:preprod", amount: "5000000", asset: "lovelace", payTo: PAYMENT.address ?? "addr_test1…", maxTimeoutSeconds: 600, extra: { confirmationPolicy: { l1Confirmations: -1 } } }],
}, null, 2);

const RECEIPT = JSON.stringify({ success: true, payer: "addr_test1qrwcm2ks…szndmw", transaction: "d3a147217859d56695edf6135e4c34c5b483efa120052e7bde4215b39bd1d477", network: "cardano:preprod", extra: { status: "mempool", confirmations: -1 } }, null, 2);

const BUYER = `import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import { toClientCardanoSigner } from "@x402/cardano";

// A preprod wallet with some tADA (faucet: docs.cardano.org/cardano-testnets/tools/faucet)
const signer = toClientCardanoSigner({
  mnemonic: process.env.CARDANO_BUYER_MNEMONIC!,
  network: "cardano:preprod",
  provider: { blockfrost: { baseUrl: "https://cardano-preprod.blockfrost.io/api/v0", projectId: process.env.BLOCKFROST_PROJECT_ID! } },
});

const client = new x402Client()
  .register("cardano:*", new ExactCardanoScheme(signer))
  // Never pay more than 12 tADA for one call.
  .setSpendControls({ allowedAssets: [{ network: "cardano:*", asset: "lovelace", maxAmountPerPayment: "12000000" }] });

const payingFetch = wrapFetchWithPayment(fetch, client);

// 402 → pay → retry happens inside payingFetch.
const res = await payingFetch("${API}/agents/trade-gatekeeper", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: "solana", size_usd: 5000, side: "buy" }),
});
const { data } = await res.json();          // { verdict: "ALLOW", summary, reasons, verify_url, … }
const receipt = res.headers.get("PAYMENT-RESPONSE"); // base64 JSON with the Cardano transaction id`;

export default function Pricing() {
  return (
    <DocPage href="/docs/pricing" lede="Agents pay per call with x402 on Cardano, with no account and no key. Apps use an API key on a contract. The free tier stays free.">
      <div className="mb-6 flex flex-wrap gap-2"><Badge tone="good">x402 live on Cardano preprod</Badge><Badge tone="brand">Prices in tADA</Badge></div>

      <H2>Tiers</H2>
      <Table
        head={["Tier", "Testnet", "Mainnet", "Includes"]}
        rows={[
          [<Badge key="f" tone="good">Free</Badge>, "0", "$0", "Token list and search, status, the standard check (GET evaluate), briefs (GET explain), track record and proofs. MCP during the preview."],
          [<Badge key="d" tone="mist">Data</Badge>, "2 tADA", "$0.01", "Token state, history and market overview. The first 25 calls each day are free."],
          [<Badge key="p" tone="brand">Premium</Badge>, "5 tADA", "$0.05", "Checks sized to your order and rules, fresh investigations, questions, address lookups, monitors, and six agents."],
          [<Badge key="r" tone="brand">Pro</Badge>, "10 tADA", "$0.25", "Due Diligence Analyst, Opportunity Scout, Portfolio Checkup and Treasury Steward: agents that check many tokens or rules in one run."],
        ]}
      />
      <P>Mainnet prices sit at market rates: $0.01 per call is in line with CoinGecko, CoinMarketCap and Nansen per-call data plans, and a Pro run costs less than the five to twenty calls it replaces. Current prices and the seller address are always published at <Link href="/docs/api/status">/v1/status</Link>.</P>

      <H2>What is live today</H2>
      <Table
        head={["Capability", "Status"]}
        rows={[
          ["x402 pay-per-call on the REST API", <Badge key="1" tone="good">Live on Cardano preprod</Badge>],
          ["Masumi Coworker on Sokosumi (escrow per Task)", <Badge key="2" tone="good">Live on Cardano preprod</Badge>],
          ["MCP server for Claude, Claude Code, Cursor", <Badge key="3" tone="good">Live, free preview</Badge>],
          ["Design-partner API keys", <Badge key="4" tone="good">Live, issued by hand</Badge>],
          ["Chainlink CRE attestation of proofs", <Badge key="5" tone="warn">In progress</Badge>],
          ["Self-service accounts, usage and prepaid packs", <Badge key="6" tone="mist">Planned</Badge>],
          ["Mainnet pricing and subscriptions", <Badge key="7" tone="mist">Planned</Badge>],
        ]}
      />

      <H2>How x402 works</H2>
      <P>x402 uses the HTTP status <C>402 Payment Required</C>. An agent needs only a Cardano wallet:</P>
      <Steps>
        <Step title="Call the endpoint"><P>Without payment, a paid endpoint answers 402. The <C>PAYMENT-REQUIRED</C> header (base64 JSON) says what to pay, in what asset, and to which address; the body repeats it in plain words.</P></Step>
        <Step title="Pay"><P>The agent builds and signs a Cardano transaction for the exact amount, but does not broadcast it. <C>@x402/fetch</C> with <C>@x402/cardano</C> does this automatically within a spending cap you set.</P></Step>
        <Step title="Retry with the signed payment"><P>The agent repeats the request with the <C>PAYMENT-SIGNATURE</C> header. CoinGraph&apos;s facilitator verifies the transaction, the answer is computed, the facilitator broadcasts the payment, and the answer is released with a <C>PAYMENT-RESPONSE</C> receipt carrying the transaction id.</P></Step>
      </Steps>
      <CodeTabs title="402 response (decoded PAYMENT-REQUIRED header, real)" samples={[{ label: "JSON", code: PAYMENT_REQUIRED, node: highlightJson(PAYMENT_REQUIRED) }]} />
      <CodeTabs title="Receipt (decoded PAYMENT-RESPONSE header, real)" samples={[{ label: "JSON", code: RECEIPT, node: highlightJson(RECEIPT) }]} />
      <P>A whole round trip takes a few seconds. <a href="https://preprod.cardanoscan.io/transaction/d3a147217859d56695edf6135e4c34c5b483efa120052e7bde4215b39bd1d477" target="_blank" rel="noreferrer">That transaction on Cardanoscan</a>. The facilitator is not custodial: it only verifies and broadcasts a transaction the agent has already signed, and never holds funds.</P>

      <H3 id="pay-from-code">Pay from code</H3>
      <P>Packages: <C>@x402/fetch</C>, <C>@x402/cardano</C> and <C>@x402/core</C>, version 2.26.0.</P>
      <CodeTabs samples={[{ label: "TypeScript", code: BUYER }]} />
      <P>The same buyer is in the repository as <C>scripts/x402-buyer.ts</C>.</P>

      <H3>Confirmation policy</H3>
      <P>On preprod, CoinGraph releases the answer once its facilitator has broadcast the payment and the node accepted it (<C>l1Confirmations: -1</C>), because preprod blocks can be minutes apart. For real value on mainnet the policy would require block inclusion or depth, which the same code supports by changing one setting.</P>
      <Callout kind="note">On Cardano every payment output must carry a minimum amount of ADA, which is why testnet prices start at 2 tADA. On mainnet, cent-level calls are sold as prepaid packs or priced in a stablecoin.</Callout>

      <H2>Free allowances</H2>
      <Table
        head={["Who", "Allowance"]}
        rows={[
          ["Any caller", "25 Data calls a day (state, history, market)."],
          ["The website playground", "10 Premium and 5 Pro agent runs a day per visitor, so people can try agents without a wallet."],
          ["MCP (Claude, Cursor…)", "Free during the hackathon preview, including agent runs; the same calls cost 5–10 tADA over REST. After the preview, MCP carries the same tiers."],
        ]}
      />

      <H2>Design partners</H2>
      <P>Early integrators (teams building agents, wallets or treasuries) get a free key in exchange for feedback, and use it instead of paying per call: send it as <C>Authorization: Bearer cg_…</C>. Write to <a href="mailto:ajay@coingraph.ai?subject=CoinGraph%20design%20partner">ajay@coingraph.ai</a>.</P>

      <H2>Masumi</H2>
      <P>Masumi is Cardano&apos;s agent-payment and registry protocol; Sokosumi is its marketplace, where companies hire AI “Coworkers” per Task. CoinGraph Crypto Analyst is registered on Masumi and hired on Sokosumi for 1 test USDM per Task (USDM is a USD stablecoin on Cardano; the test version runs on preprod), held in escrow until the result is delivered, with the result hash recorded on chain. See <Link href="/docs/sokosumi">Hire on Sokosumi</Link>.</P>
    </DocPage>
  );
}
