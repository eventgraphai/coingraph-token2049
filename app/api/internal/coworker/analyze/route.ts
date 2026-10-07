import { timingSafeEqual } from "node:crypto";
import { analyze } from "@/lib/coworker/analyst";

// Private endpoint for the CoinGraph Coworker worker: plain-language Task in, write-up out.
// Locked with COWORKER_SECRET (sent as the x-coworker-secret header); never linked publicly.

export const maxDuration = 300;

function authorised(req: Request): boolean {
  const expected = process.env.COWORKER_SECRET ?? "";
  const given = req.headers.get("x-coworker-secret") ?? "";
  if (expected.length < 32 || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: { code: "unauthorized", message: "Not allowed." } }, { status: 401 });
  let body: { request?: unknown; requester?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: { code: "invalid_json", message: "Body must be JSON." } }, { status: 400 }); }
  const request = typeof body.request === "string" ? body.request.trim() : "";
  if (!request || request.length > 20_000) return Response.json({ error: { code: "invalid_request", message: "request must be 1 to 20,000 characters." } }, { status: 400 });
  const requester = typeof body.requester === "string" ? body.requester.slice(0, 120) : "sokosumi";
  try {
    const result = await analyze(request, requester);
    return Response.json({ data: result });
  } catch (e) {
    console.error("[coworker] analyze failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: { code: "analysis_failed", message: "The analysis could not complete." } }, { status: 502 });
  }
}
