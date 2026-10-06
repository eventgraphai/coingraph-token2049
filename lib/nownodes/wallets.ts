import { sql } from "../db";
import { blockbook, ZERO_ADDRESS } from "./client";

// Known exchange wallets from public labels (Etherscan / BscScan / Arkham style labels). Seeded into
// wallet_labels, then verified against the chain: an exchange hot wallet has a very large transaction
// count, so anything that looks idle is deactivated rather than used for tagging.

type Seed = { entity: string; label: string; address: string; kind?: string; confidence?: "high" | "medium" };

const ETH: Seed[] = [
  { entity: "binance", label: "Binance 1", address: "0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE" },
  { entity: "binance", label: "Binance 2", address: "0xD551234Ae421e3BCBA99A0Da6d736074f22192FF" },
  { entity: "binance", label: "Binance 3", address: "0x564286362092D8e7936f0549571a803B203aAceD" },
  { entity: "binance", label: "Binance 4", address: "0x0681d8Db095565FE8A346fA0277bFfdE9C0eDBBF" },
  { entity: "binance", label: "Binance 5", address: "0xfE9e8709d3215310075d67E3ed32A380CCf451C8" },
  { entity: "binance", label: "Binance 6", address: "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3" },
  { entity: "binance", label: "Binance 7", address: "0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8" },
  { entity: "binance", label: "Binance 8", address: "0xF977814e90dA44bFA03b6295A0616a897441aceC" },
  { entity: "binance", label: "Binance 14", address: "0x28C6c06298d514Db089934071355E5743bf21d60" },
  { entity: "binance", label: "Binance 15", address: "0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549" },
  { entity: "binance", label: "Binance 16", address: "0xDFd5293D8e347dFe59E90eFd55b2956a1343963d" },
  { entity: "binance", label: "Binance 17", address: "0x56Eddb7aa87536c09CCc2793473599fD21A8b17F" },
  { entity: "binance", label: "Binance 18", address: "0x9696f59E4d72E237BE84fFD425DCaD154Bf96976" },
  { entity: "binance", label: "Binance 19", address: "0xE2fc31F816A9b94326492132018C3aEcC4a93aE1" },
  { entity: "binance", label: "Binance 20", address: "0x4976A4A02f38326660D17bf34b431dC6e2eb2327" },
  { entity: "binance", label: "Binance 28", address: "0x5a52E96BAcdaBb82fd05763E25335261B270Efcb" },
  { entity: "okx", label: "OKX", address: "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b" },
  { entity: "okx", label: "OKX 2", address: "0xA7EFAe728D2936e78BDA97dc267687568dD593f3" },
  { entity: "okx", label: "OKX 3", address: "0x5041ed759Dd4aFc3a72b8192C143F72f4724081A" },
  { entity: "okx", label: "OKX 6", address: "0x98EC059Dc3aDFBdd63429454aEB0c990FBA4A128" },
  { entity: "okx", label: "OKX 7", address: "0x2c8FBB630289363Ac80705A1a61273f76fD5a161", confidence: "medium" },
  { entity: "coinbase", label: "Coinbase 1", address: "0x71660c4005BA85c37ccec55d0C4493E66Fe775d3" },
  { entity: "coinbase", label: "Coinbase 2", address: "0x503828976D22510aad0201ac7EC88293211D23Da" },
  { entity: "coinbase", label: "Coinbase 3", address: "0xdDfAbCdc4D8FfC6d5beaf154f18B778f892A0740" },
  { entity: "coinbase", label: "Coinbase 4", address: "0x3cD751E6b0078Be393132286c442345e5DC49699" },
  { entity: "coinbase", label: "Coinbase 5", address: "0xb5d85CBf7cB3EE0D56b3bB207D5Fc4B82f43F511" },
  { entity: "coinbase", label: "Coinbase 6", address: "0xeB2629a2734e272Bcc07BDA959863f316F4bD4Cf" },
  { entity: "coinbase", label: "Coinbase 7", address: "0x77696bb39917C91A0c3908D577d5e322095425cA" },
  { entity: "coinbase", label: "Coinbase 10", address: "0xA9D1e08C7793af67e9d92fe308d5697FB81d3E43" },
  { entity: "kraken", label: "Kraken 1", address: "0x53d284357ec70cE289D6D64134DfAc8E511c8a3D" },
  { entity: "kraken", label: "Kraken 4", address: "0x2910543Af39abA0Cd09dBb2D50200b3E800A63D2" },
  { entity: "kraken", label: "Kraken 5", address: "0x267be1C1D684F78cb4F6a176C4911b741E4Ffdc0" },
  { entity: "kraken", label: "Kraken 6", address: "0x0A869d79a7052C7f1b55a8EbAbbEa3420F0D1E13" },
  { entity: "kraken", label: "Kraken 7", address: "0xE853c56864A2ebe4576a807D26Fdc4A0adA51919" },
  { entity: "kraken", label: "Kraken 13", address: "0xDA9dfA130Df4dE4673b89022EE50ff26f6EA73Cf" },
  { entity: "bybit", label: "Bybit", address: "0xf89d7b9c864f589bbF53a82105107622B35EaA40" },
  { entity: "bybit", label: "Bybit 2", address: "0x1Db92e2EeBC8E0c075a02BeA49a2935BcD2dFCF4" },
  { entity: "gate", label: "Gate.io 1", address: "0x0D0707963952f2fBA59dD06f2b425ace40b492Fe" },
  { entity: "gate", label: "Gate.io 2", address: "0x1C4b70a3968436B9A0a9cf5205c787eb81Bb558c" },
  { entity: "bitfinex", label: "Bitfinex 1", address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" },
  { entity: "bitfinex", label: "Bitfinex 2", address: "0x876EabF441B2EE5B5b0554Fd502a8E0600950cFa" },
  { entity: "bitfinex", label: "Bitfinex 3", address: "0x77134cbC06cB00b66F4c7e623D5fdBF6777635EC" },
  { entity: "htx", label: "HTX 1", address: "0xaB5C66752a9e8167967685F1450532fB96d5d24f" },
  { entity: "htx", label: "HTX 2", address: "0x6748F50f686bfbcA6Fe8ad62b22228b87F31ff2b" },
  { entity: "htx", label: "HTX 3", address: "0xfdb16996831753d5331fF813c29a93c76834A0AD" },
  { entity: "htx", label: "HTX 5", address: "0xeEe28d484628d41A82d01e21d12E2E78D69920da" },
  { entity: "htx", label: "HTX 6", address: "0x5C985E89DDe482eFE97ea9f1950aD149Eb73829B" },
  { entity: "htx", label: "HTX 7", address: "0xDc76CD25977E0a5Ae17155770273aD58648900D3" },
  { entity: "kucoin", label: "KuCoin 1", address: "0x2B5634C42055806a59e9107ED44D43c426E58258" },
  { entity: "kucoin", label: "KuCoin 2", address: "0x689C56AEf474Df92D44A1B70850f808488F9769C" },
  { entity: "kucoin", label: "KuCoin 4", address: "0xa1D8d972560C2f8144AF871Db508F0B0B10a3fBf" },
  { entity: "kucoin", label: "KuCoin 5", address: "0x4ad64983349C49dEfE8d7A4686202d24b25D0CE8" },
  { entity: "kucoin", label: "KuCoin 6", address: "0x1692E170361cEFD1eb7240ec13D048Fd9aF6d667" },
  { entity: "kucoin", label: "KuCoin 7", address: "0xD6216fC19DB775Df9774a6E33526131dA7D19a2c" },
  { entity: "kucoin", label: "KuCoin 8", address: "0xe59Cd29be3BE4461d79C0881D238Cbe87D64595A" },
  { entity: "crypto.com", label: "Crypto.com 1", address: "0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3" },
  { entity: "crypto.com", label: "Crypto.com 2", address: "0x46340b20830761efd32832A74d7169B29FEB9758" },
  { entity: "crypto.com", label: "Crypto.com 3", address: "0x72A53cDBBcc1b9efa39c834A540550e23463AAcB" },
  { entity: "crypto.com", label: "Crypto.com 4", address: "0x7758E507850da48cd47df1fB5F875c23E3340C50" },
  { entity: "bitget", label: "Bitget", address: "0x0639556F03714A74a5fEEaF5736a4A64fF70D206" },
  { entity: "bitget", label: "Bitget 2", address: "0x1AB4973a48dc892Cd9971ECE8e01DcC7688f8F23", confidence: "medium" },
  { entity: "mexc", label: "MEXC", address: "0x75e89d5979E4f6Fba9F97c104c2F0AFB3F1dcB88" },
  { entity: "mexc", label: "MEXC 2", address: "0x0211f3ceDbEf3143223D3ACF0e589747933e8527" },
  { entity: "robinhood", label: "Robinhood", address: "0x40B38765696e3d5d8d9d834D8AaD4bB6e418E489" },
  { entity: "robinhood", label: "Robinhood 2", address: "0xCBD6832Ebc203e49E2B771897067fce3c58575ac", confidence: "medium" },
  { entity: "burn", label: "Null address", address: ZERO_ADDRESS, kind: "burn" },
  { entity: "burn", label: "0x…dEaD", address: "0x000000000000000000000000000000000000dEaD", kind: "burn" },
];

const BSC: Seed[] = [
  { entity: "binance", label: "Binance Hot 6", address: "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3" },
  { entity: "binance", label: "Binance Hot 8", address: "0x3c783c21a0383057D128bae431894a5C19F9Cf06", confidence: "medium" },
  { entity: "binance", label: "Binance Hot 10", address: "0xdccF3B77dA55107280bd850ea519DF3705D1a0e7", confidence: "medium" },
  { entity: "binance", label: "Binance Hot 13", address: "0x515b72Ed8a97F42C568D6A143232775018f133C8", confidence: "medium" },
  { entity: "binance", label: "Binance 8", address: "0xF977814e90dA44bFA03b6295A0616a897441aceC" },
  { entity: "binance", label: "Binance 19", address: "0xE2fc31F816A9b94326492132018C3aEcC4a93aE1" },
  { entity: "binance", label: "Binance Hot 20", address: "0x161bA15A5F335c9f06BB5BbB0A9cE14076FBb645", confidence: "medium" },
  { entity: "okx", label: "OKX", address: "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b" },
  { entity: "gate", label: "Gate.io", address: "0x0D0707963952f2fBA59dD06f2b425ace40b492Fe" },
  { entity: "kucoin", label: "KuCoin", address: "0xD6216fC19DB775Df9774a6E33526131dA7D19a2c" },
  { entity: "bybit", label: "Bybit", address: "0xf89d7b9c864f589bbF53a82105107622B35EaA40" },
  { entity: "mexc", label: "MEXC", address: "0x4982085C9e2F89F2eCb8131Eca71aFAD896e89CB", confidence: "medium" },
  { entity: "bitget", label: "Bitget", address: "0x0639556F03714A74a5fEEaF5736a4A64fF70D206", confidence: "medium" },
  { entity: "burn", label: "Null address", address: ZERO_ADDRESS, kind: "burn" },
  { entity: "burn", label: "0x…dEaD", address: "0x000000000000000000000000000000000000dEaD", kind: "burn" },
];

const BTC: Seed[] = [
  { entity: "binance", label: "Binance cold", address: "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo" },
  { entity: "binance", label: "Binance", address: "3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6" },
  { entity: "binance", label: "Binance", address: "1LQv8aKtQoiY5M5zkaG8RWL7LMwNzNsLfb" },
  { entity: "binance", label: "Binance hot", address: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h" },
  { entity: "binance", label: "Binance", address: "3LYJfcfHPXYJreMsASk2jkn69LWEYKzexb" },
  { entity: "binance", label: "Binance", address: "1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s" },
  { entity: "binance", label: "Binance", address: "39884E3j6KZj82FK4vcCrkUvWYL5MQaS3v", confidence: "medium" },
  { entity: "bitfinex", label: "Bitfinex cold", address: "bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97" },
  { entity: "bitfinex", label: "Bitfinex", address: "3JZq4atUahhuA9rLhXLMhhTo133J9rF97j", confidence: "medium" },
  { entity: "htx", label: "HTX cold", address: "3Cbq7aT1tY8kMxWLbitaG7yT6bPbKChq64", confidence: "medium" },
  { entity: "htx", label: "HTX", address: "1Pzaqw98PeRfyHypfqyEgg5yycJRsENrE7", confidence: "medium" },
  { entity: "kraken", label: "Kraken", address: "36zSLdRv1jyewjmvj6cvcHRBLgR8sN2vZN", confidence: "medium" },
  { entity: "bitstamp", label: "Bitstamp", address: "3FHNBLobJnbCTFTVakh5TXmEneyf5PT61B", confidence: "medium" },
  { entity: "bitstamp", label: "Bitstamp", address: "3DVJfEsDTPkGDvqPCLC41X85L1B1DQWDyh", confidence: "medium" },
  { entity: "bittrex", label: "Bittrex", address: "1Kr6QSydW9bFQG1mXiPNNu6WpJGmUa9i1g", confidence: "medium" },
  { entity: "bittrex", label: "Bittrex", address: "385cR5DM96n1HvBDMzLHPYcw89fZAXULJP", confidence: "medium" },
  { entity: "okx", label: "OKX", address: "3P3QsMVK89JBNqZQv5zMAKG8FK3kJM4rjt", confidence: "medium" },
];

const SEEDS: { chain: string; list: Seed[] }[] = [
  { chain: "eth", list: ETH },
  { chain: "bsc", list: BSC },
  { chain: "btc", list: BTC },
];

const norm = (chain: string, address: string) => (chain === "btc" ? address : address.toLowerCase());

export async function seedWalletLabels(): Promise<number> {
  let n = 0;
  for (const { chain, list } of SEEDS) {
    for (const s of list) {
      await sql`
        insert into wallet_labels (chain, address, entity, label, kind, source, confidence)
        values (${chain}, ${norm(chain, s.address)}, ${s.entity}, ${s.label}, ${s.kind ?? "exchange"}, 'public labels', ${s.confidence ?? "high"})
        on conflict (chain, address) do update set entity = excluded.entity, label = excluded.label, kind = excluded.kind`;
      n++;
    }
  }
  return n;
}

type AddressInfo = { balance: string; txs: number; nonTokenTxs?: number };

// Checks each exchange wallet on its chain: records transaction count and native balance, and
// deactivates wallets with almost no history (a mislabeled or retired address must not tag transfers).
export async function verifyWalletLabels(chain: "eth" | "bsc" | "btc", minTxs = 100): Promise<number> {
  const rows = await sql<{ address: string }[]>`
    select address from wallet_labels where chain = ${chain} and kind = 'exchange' and (verified_at is null or verified_at < now() - interval '7 days')`;
  const iface = chain === "btc" ? "btcbook" : chain === "eth" ? "eth-blockbook" : "bsc-blockbook";
  const decimals = chain === "btc" ? 8 : 18;
  let checked = 0;
  for (const { address } of rows) {
    try {
      const { data } = await blockbook<AddressInfo>(iface, `/address/${address}?details=basic`, `${chain}:/address/{wallet}:basic`, { wallet: address });
      const txs = Number(data.txs ?? 0);
      const balance = Number(data.balance ?? 0) / 10 ** decimals;
      await sql`update wallet_labels set tx_count = ${txs}, balance_native = ${balance}, active = ${txs >= minTxs}, verified_at = now()
                where chain = ${chain} and address = ${address}`;
      checked++;
    } catch (err) {
      // Not checkable (e.g. invalid address): never use it for tagging.
      await sql`update wallet_labels set active = false, verified_at = now() where chain = ${chain} and address = ${address}`;
      console.warn(`[wallets] ${chain} ${address}: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  return checked;
}

export type LabelMap = Map<string, { entity: string; kind: string }>;

export async function loadLabels(chain: string): Promise<LabelMap> {
  const rows = await sql<{ address: string; entity: string; kind: string }[]>`
    select address, entity, kind from wallet_labels where chain = ${chain} and active`;
  return new Map(rows.map((r) => [r.address, { entity: r.entity, kind: r.kind }]));
}
