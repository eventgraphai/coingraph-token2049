import { buildOpenApi } from "@/lib/api/openapi";
import { CORS } from "@/lib/api/respond";

export async function GET() {
  return new Response(JSON.stringify(buildOpenApi(), null, 2), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300", ...CORS } });
}
