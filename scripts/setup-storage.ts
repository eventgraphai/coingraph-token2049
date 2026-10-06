import { env } from "../lib/env";
import { storage } from "../lib/archive";

// Creates the private raw-archive bucket if it does not exist. Safe to re-run.
async function main() {
  const client = storage();
  if (!client) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

  const { data: buckets, error } = await client.listBuckets();
  if (error) throw error;

  const existing = buckets.find((b) => b.name === env.rawArchiveBucket);
  if (existing) {
    console.log(`bucket ${existing.name} exists (public=${existing.public})`);
    return;
  }
  const { error: createError } = await client.createBucket(env.rawArchiveBucket, { public: false });
  if (createError) throw createError;
  console.log(`created private bucket ${env.rawArchiveBucket}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
