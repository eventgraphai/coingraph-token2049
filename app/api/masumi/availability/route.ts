// MIP-003 availability for the CoinGraph Crypto Analyst agent (Masumi registry apiBaseUrl = /api/masumi).
export async function GET() {
  return Response.json({ status: "available", type: "masumi-agent", message: "CoinGraph Crypto Analyst is ready. Hire it on Sokosumi." });
}
