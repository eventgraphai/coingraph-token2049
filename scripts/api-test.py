#!/usr/bin/env python3
"""CoinGraph API end-to-end test suite: every endpoint, happy paths and error cases.

Usage:  python3 scripts/api-test.py                      # http://localhost:3000
        python3 scripts/api-test.py https://token2049.coingraph.ai
Paced at ~1.1s per call to stay under the free 60 requests/minute limit. Fresh /explain and /ask calls use Claude.
"""
import json, time, urllib.request, urllib.error, sys

ORIGIN = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
BASE = ORIGIN + "/api/v1"
PACE_SEC = 1.1
results = []

def call(method, path, body=None, headers=None, expect=200, check=None, timeout=300):
    time.sleep(PACE_SEC)
    url = BASE + path if path.startswith("/") else ORIGIN + path[1:]
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"content-type": "application/json", **(headers or {})})
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    except Exception as e:
        results.append((method, path, "ERR", expect, f"{e}", round(time.time()-t,1))); return None
    ms = round(time.time() - t, 1)
    try: js = json.loads(raw)
    except Exception: js = raw.decode(errors="ignore")
    note = ""
    okk = status == expect
    if okk and check:
        try:
            note = check(js) or ""
        except Exception as e:
            okk, note = False, f"check failed: {e}"
    if not okk and isinstance(js, dict) and "error" in js: note = js["error"].get("message", "")[:90]
    results.append((method, path[:70], status, expect, ("PASS " if okk else "FAIL ") + str(note)[:110], ms))
    return js

d = lambda js: js["data"]

# Discover
call("GET", "/tokens", check=lambda js: f"{d(js)['count']} tokens; first {d(js)['tokens'][0]['symbol']} ${d(js)['tokens'][0]['price_usd']}")
call("GET", "/tokens?q=aave", check=lambda js: f"{len(d(js)['results'])} results, tracked={d(js)['results'][0]['tracked']}")
call("GET", "/tokens?q=0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", check=lambda js: f"contract → {d(js)['results'][0]['id']}")
call("GET", "/status", check=lambda js: f"pipeline={d(js)['pipeline']} feeds={len(d(js)['feeds'])} nownodes={d(js)['budgets']['nownodes_requests_this_month']}")

# Understand: state
call("GET", "/state/aave", check=lambda js: f"sections={len([k for k in d(js) if k!='token'])} sources={len(js['sources'])}")
call("GET", "/state/BTC?sections=market,derivatives,onchain", check=lambda js: f"btc price ${d(js)['market']['price_usd']} oi={d(js)['derivatives']['open_interest']['total_usd']} chain={d(js)['onchain']['chain']}")
call("GET", "/state/0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82?sections=identity", check=lambda js: f"contract → {d(js)['token']['symbol']}")
call("GET", "/state/solana?sections=onchain,supply", check=lambda js: f"sol reserves={d(js)['onchain']['exchange_reserves']['total'] if isinstance(d(js)['onchain'].get('exchange_reserves'),dict) else d(js)['onchain'].get('exchange_reserves')} top10={d(js)['supply']['top_holders_pct']}")
call("GET", "/state/tether?sections=market", check=lambda js: f"stablecoin price {d(js)['market']['price_usd']}")
call("GET", "/state/notacoin", expect=404)
call("GET", "/state/aave?sections=market,bogus", expect=400)

# Understand: history
call("GET", "/history/chainlink", check=lambda js: f"series={list(d(js)['series'].keys())} events={ {k:len(v) for k,v in d(js)['events'].items()} }")
call("GET", "/history/bitcoin?since=2026-10-06T12:00:00Z&series=price,exchange_net_flow", check=lambda js: f"price pts={len(d(js)['series']['price']['points'])} flow pts={len(d(js)['series']['exchange_net_flow']['points'])}")
call("GET", "/history/bitcoin?since=yesterday", expect=400)
call("GET", "/history/aave?series=candles,tvl", check=lambda js: f"candles={d(js)['series']['candles']['points'].__len__() if isinstance(d(js)['series']['candles'],dict) else d(js)['series']['candles']} tvl={'ok' if isinstance(d(js)['series']['tvl'],dict) else d(js)['series']['tvl']}")

# Understand: market
call("GET", "/market", check=lambda js: f"sections={list(d(js).keys())}")
call("GET", "/market?sections=rankings,events", check=lambda js: f"gainers1h={[g['symbol'] for g in d(js)['rankings']['gainers_1h'][:3]]} whales={len(d(js)['events']['whale_transfers'])} headlines={len(d(js)['events']['headlines'])}")
call("GET", "/market?sections=nope", expect=400)

# Understand: inspect
call("GET", "/inspect/eth/0x28c6c06298d514db089934071355e5743bf21d60", check=lambda js: f"{d(js)['label']['name']} type={d(js)['type']} holdings=${round(d(js)['holdings_usd']/1e9,2)}B")
call("GET", "/inspect/bsc/0x8894e0a0c962cb723c1976a4421c95949be2d4e3", check=lambda js: f"{d(js)['label']} txs={d(js)['tx_count']}")
call("GET", "/inspect/btc/34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo", check=lambda js: f"{d(js)['label']['name'] if isinstance(d(js)['label'],dict) else d(js)['label']} btc={d(js)['native']['amount']}")
call("GET", "/inspect/sol/9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", check=lambda js: f"sol={d(js)['native']['amount']} type={d(js)['type']}")
call("GET", "/inspect/ada/addr1qxt208dm7m6zn4u2ljhs6ehwu7sglp57rtr9gylxauw49s07arfgvxt6gm3yaj7w37mjl4lxgl9xzfx563r2jlejkznsk49rh5", check=lambda js: f"ada={d(js)['native']['amount']} type={d(js)['type']}")
call("GET", "/inspect/tron/abc", expect=400)
call("GET", "/inspect/eth/0x123", expect=400)

# Decide: evaluate
ev = call("GET", "/evaluate/ethereum", check=lambda js: f"{d(js)['verdict']} conf={d(js)['confidence']} dims={ {k:v['rating'] for k,v in d(js)['dimensions'].items()} }")
call("GET", "/evaluate/bitcoin", check=lambda js: f"{d(js)['verdict']} onchain={d(js)['dimensions']['onchain']['rating']} liquidity={d(js)['dimensions']['liquidity']['rating']}")
call("GET", "/evaluate/jupiter-exchange-solana", check=lambda js: f"{d(js)['verdict']} supply={d(js)['dimensions']['supply']['rating']} top10 reason={[r['text'][:60] for r in d(js)['dimensions']['supply']['reasons']][:1]}")
call("POST", "/evaluate", {"token": "uniswap", "size_usd": 2000000, "policy": {"min_depth_usd": 500000, "max_funding_pct": 0.05}}, expect=201, check=lambda js: f"{d(js)['verdict']} impact={d(js)['size_check']['estimated_impact_pct']}% policy={ {k:v['result'] for k,v in d(js)['policy_check'].items()} }")
call("POST", "/evaluate", {"size_usd": 100}, expect=400)
call("POST", "/evaluate", {"token": "aave", "size_usd": -5}, expect=400)
call("POST", "/evaluate", "not json", expect=400)

# Decide: explain
ex = call("GET", "/explain/bitcoin", check=lambda js: f"#{d(js)['id']} '{d(js)['headline'][:60]}' evidence={len(d(js)['evidence'])}")
if isinstance(ex, dict) and "data" in ex: call("GET", f"/explain/bitcoin/{d(ex)['id']}", check=lambda js: f"by id ok: {d(js)['headline'][:40]}")
call("GET", "/explain/bitcoin/999999", expect=404)
_tl = call("GET", "/tokens")
_nobrief = next((t["id"] for t in (_tl or {}).get("data", {}).get("tokens", []) if not t.get("latest_headline")), None)
if _nobrief: call("GET", f"/explain/{_nobrief}", expect=404, check=None)
call("POST", "/explain", {"token": "chainlink", "hours": 2}, check=lambda js: f"fresh #{d(js)['id']} '{d(js)['headline'][:70]}' evidence={len(d(js)['evidence'])}", timeout=400)
call("POST", "/explain", {}, expect=400)

# Decide: ask
call("POST", "/ask", {"token": "ethereum", "question": "Is leverage in ETH futures currently crowded, and which side?"}, expect=201, check=lambda js: f"answer: {d(js)['answer'][:90]}… points={len(d(js)['key_points'])} conf={d(js)['confidence']}", timeout=400)
call("POST", "/ask", {"token": "aave"}, expect=400)
call("POST", "/ask", {"token": "aave", "question": "a", "claim": "b"}, expect=400)

# Watch: monitor
m = call("POST", "/monitor", {"tokens": ["bitcoin"], "webhook_url": "https://httpbin.org/post"}, expect=201, check=lambda js: f"id={d(js)['id']} secret starts {d(js)['secret'][:8]}")
call("POST", "/monitor", {"tokens": ["bitcoin"], "webhook_url": "http://insecure"}, expect=400)
call("POST", "/monitor", {"tokens": [], "webhook_url": "https://x.y"}, expect=400)
call("POST", "/monitor", {"tokens": ["nope-coin"], "webhook_url": "https://x.y"}, expect=404)
if isinstance(m, dict) and "data" in m:
    sec, mid = d(m)["secret"], d(m)["id"]
    call("GET", "/monitor", headers={"x-monitor-secret": sec}, check=lambda js: f"{len(d(js)['monitors'])} monitor(s)")
    call("GET", "/monitor", expect=401)
    call("DELETE", f"/monitor/{mid}", headers={"x-monitor-secret": sec}, check=lambda js: f"active={d(js)['active']}")
    call("DELETE", f"/monitor/{mid}", headers={"x-monitor-secret": sec}, expect=404)

# Trust
call("GET", "/record", check=lambda js: f"calls={d(js)['calibration']['total_calls']} graded={d(js)['calibration']['graded']} hit={d(js)['calibration']['hit_rate_pct']}%")
call("GET", "/record/bitcoin?kind=signal", check=lambda js: f"btc signals={len(d(js)['ledger'])}")
call("GET", "/record?since=2026-10-06T15:00:00Z&kind=brief", check=lambda js: f"briefs={len(d(js)['ledger'])}")
if isinstance(ev, dict) and "id" in ev: call("GET", f"/verify/{ev['id']}", check=lambda js: f"hash ok={d(js)['hash_matches_stored']} provenance={len(d(js)['provenance'])}")
call("GET", "/verify/3", check=lambda js: f"brief kind={d(js)['kind']} att={d(js)['attestation']['status'] if isinstance(d(js)['attestation'],dict) else d(js)['attestation']}")
call("GET", "/verify/eval_doesnotexist", expect=404)
call("GET", "/verify/zzz", expect=400)

# Docs
call("GET", "/openapi.json", check=lambda js: f"openapi {js['openapi']} paths={len(js['paths'])}")
call("GET", "@/llms.txt", check=lambda js: f"{len(js)} chars")
call("GET", "@/openapi.json", check=lambda js: f"rewrite ok, {len(js['paths'])} paths")
call("OPTIONS", "/tokens", expect=204)

print(f"\n{'METHOD':7}{'PATH':72}{'GOT':5}{'EXP':5}{'RESULT':112}{'s':>5}")
fails = 0
for mth, p, got, exp, note, ms in results:
    if not str(note).startswith("PASS"): fails += 1
    print(f"{mth:7}{p:72}{str(got):5}{str(exp):5}{note:112}{ms:>5}")
print(f"\n{len(results)} tests, {len(results)-fails} passed, {fails} failed  ({ORIGIN})")
sys.exit(1 if fails else 0)
