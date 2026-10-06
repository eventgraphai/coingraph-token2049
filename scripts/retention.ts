import { sql } from "../lib/db";
import { runRetention } from "../lib/retention";

// `npm run retention` — run the daily cleanup by hand.
runRetention()
  .then(async (n) => {
    console.log(`retention: ${n} rows/objects cleaned`);
    await sql.end();
  })
  .catch(async (err) => {
    console.error(err);
    await sql.end();
    process.exit(1);
  });
