import { gzipSync } from "node:zlib";
import { StorageClient } from "@supabase/storage-js";
import { env } from "./env";
import { sql } from "./db";

// Bronze layer: every raw API response is gzipped into object storage, keyed by api_calls.id.
// Uploads run in the background and never block or fail ingestion.
// Uses the storage-only client: supabase-js pulls in realtime, which needs WebSocket (Node 22+).

let client: StorageClient | null = null;
let warned = false;

export function storage(): StorageClient | null {
  if (!env.supabaseUrl || !env.supabaseServiceKey) {
    if (!warned) {
      console.warn("[archive] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — raw archive disabled");
      warned = true;
    }
    return null;
  }
  client ??= new StorageClient(`${env.supabaseUrl}/storage/v1`, {
    apikey: env.supabaseServiceKey,
    Authorization: `Bearer ${env.supabaseServiceKey}`,
  });
  return client;
}

export function archiveRaw(apiCallId: number, provider: string, endpoint: string, body: string): void {
  const bucket = storage();
  if (!bucket) return;

  const now = new Date();
  const day = now.toISOString().slice(0, 10).replaceAll("-", "/");
  const slug = endpoint.replace(/^\//, "").replace(/[^a-zA-Z0-9_-]+/g, "_") || "root";
  const path = `${provider}/${slug}/${day}/${now.toISOString().slice(11, 19).replaceAll(":", "")}-${apiCallId}.json.gz`;

  void (async () => {
    try {
      const { error } = await bucket
        .from(env.rawArchiveBucket)
        .upload(path, gzipSync(body), { contentType: "application/gzip", upsert: false });
      if (error) throw error;
      await sql`update api_calls set raw_path = ${path} where id = ${apiCallId}`;
    } catch (err) {
      console.warn(`[archive] upload failed for api_call ${apiCallId}:`, (err as Error).message);
    }
  })();
}
