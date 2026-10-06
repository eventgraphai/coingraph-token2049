import { sql } from "../lib/db";
import * as nn from "../lib/nownodes/jobs";
import { seedWalletLabels, verifySolanaWallets, verifyWalletLabels } from "../lib/nownodes/wallets";

// `npm run nownodes -- <command>` — run one NOWNodes job by hand.
const commands: Record<string, () => Promise<unknown>> = {
  contracts: nn.syncOnchainContracts,
  wallets: async () => {
    const seeded = await seedWalletLabels();
    const checked = (await verifyWalletLabels("eth")) + (await verifyWalletLabels("bsc")) + (await verifyWalletLabels("btc")) + (await verifySolanaWallets());
    return { seeded, checked };
  },
  "sol-wallets": async () => ({ seeded: await seedWalletLabels(), checked: await verifySolanaWallets() }),
  "sol-reserves": nn.syncSolanaReserves,
  "eth-flows": () => nn.syncTokenFlows("eth"),
  "bsc-flows": () => nn.syncTokenFlows("bsc"),
  fees: nn.syncChainFees,
  reserves: nn.syncExchangeReserves,
  "btc-blocks": () => nn.syncBtcBlocks(),
  "btc-mempool": nn.syncBtcMempool,
  "ada-transfers": nn.syncAdaLargeTransfers,
  holders: nn.syncHolderConcentration,
  "ada-assets": nn.syncCardanoAssets,
  "node-status": nn.syncNodeStatus,
};

async function main() {
  const name = process.argv[2];
  const command = commands[name];
  if (!command) {
    console.error(`usage: npm run nownodes -- <${Object.keys(commands).join("|")}>`);
    process.exit(1);
  }
  const started = Date.now();
  const result = await command();
  console.log(`${name}: ${typeof result === "object" ? JSON.stringify(result) : result} (${Date.now() - started}ms)`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
