import { buildLlmsTxt } from "@/lib/api/openapi";
import { CORS } from "@/lib/api/respond";

export async function GET() {
  return new Response(buildLlmsTxt(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300", ...CORS } });
}
