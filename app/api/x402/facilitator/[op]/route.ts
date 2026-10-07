import { x402Facilitator } from "@x402/core/facilitator";
import { ExactCardanoScheme } from "@x402/cardano/exact/facilitator";
import { toFacilitatorCardanoSigner } from "@x402/cardano";

// CoinGraph's own x402 facilitator for Cardano preprod: verifies the buyer's signed transaction, broadcasts it and
// reports settlement evidence. It holds no keys and no funds (provider-only signer over Blockfrost). Hosted here
// because the public hackathon facilitator sits behind a 60 s proxy timeout, which preprod block times can exceed.
// Mempool acceptance is enabled for testnet micro-payments; routes choose their own confirmation policy.

export const maxDuration = 300;

const NETWORK = (process.env.X402_NETWORK ?? "cardano:preprod") as `${string}:${string}`;

let facilitator: x402Facilitator | null = null;
function get(): x402Facilitator {
  if (!facilitator) {
    const projectId = process.env.BLOCKFROST_PROJECT_ID;
    if (!projectId) throw new Error("BLOCKFROST_PROJECT_ID is not set");
    const signer = toFacilitatorCardanoSigner({
      network: NETWORK,
      provider: { blockfrost: { baseUrl: process.env.BLOCKFROST_BASE_URL ?? "https://cardano-preprod.blockfrost.io/api/v0", projectId }, requestTimeoutMs: 30_000 },
      awaitConfirmation: false,
    });
    facilitator = new x402Facilitator().register(NETWORK, new ExactCardanoScheme(signer, { acceptMempool: true, confirmationTimeoutMs: 150_000, confirmationPollMs: 5_000 }));
  }
  return facilitator;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (op !== "supported") return json({ error: "not_found" }, 404);
  try { return json(get().getSupported()); } catch (e) { return json({ error: (e as Error).message }, 500); }
}

export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (op !== "verify" && op !== "settle") return json({ error: "not_found" }, 404);
  let body: { paymentPayload?: unknown; paymentRequirements?: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (!body?.paymentPayload || !body?.paymentRequirements) return json({ error: "paymentPayload and paymentRequirements are required" }, 400);
  try {
    const f = get();
    const result = op === "verify"
      ? await f.verify(body.paymentPayload as never, body.paymentRequirements as never)
      : await f.settle(body.paymentPayload as never, body.paymentRequirements as never);
    return json(result);
  } catch (e) {
    console.error(`[x402 facilitator] ${op} failed:`, e instanceof Error ? e.message : e);
    return json({ error: "facilitator_error", message: e instanceof Error ? e.message : String(e) }, 500);
  }
}
