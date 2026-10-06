#!/usr/bin/env python3
"""CoinGraph MCP end-to-end test: initialize, list tools, call every tool (happy path + one error case).

Usage:  python3 scripts/mcp-test.py                       # http://localhost:3000/mcp
        python3 scripts/mcp-test.py https://token2049.coingraph.ai
Fresh briefs are not requested (they cost a Claude call); ask_about_token makes one Claude call.
"""
import json, sys, time, urllib.request, urllib.error

ORIGIN = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
URL = ORIGIN + "/mcp"
HEADERS = {"content-type": "application/json", "accept": "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18"}
results, rid = [], 0


def rpc(method, params=None, timeout=300):
    global rid
    rid += 1
    body = json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, **({"params": params} if params is not None else {})}).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def tool(name, args, check, expect_error=False):
    time.sleep(1.1)  # stay under 60 requests/minute
    t = time.time()
    status, res = rpc("tools/call", {"name": name, "arguments": args})
    secs = round(time.time() - t, 1)
    try:
        r = res["result"]
        text = r["content"][0]["text"]
        try:
            payload = json.loads(text)
        except ValueError:  # SDK-level input validation errors are plain text
            payload = {"error": {"message": text}}
        ok = bool(r.get("isError")) == expect_error
        note = check(payload) if ok else payload.get("error", {}).get("message", "")[:90]
    except Exception as e:  # noqa: BLE001
        ok, note = False, f"{e}: {str(res)[:120]}"
    results.append((name, "PASS" if ok else "FAIL", str(note)[:110], secs))
    return payload if ok else None


status, init = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "coingraph-mcp-test", "version": "1"}})
print("initialize:", status, init.get("result", {}).get("serverInfo"), "| instructions:", len(init.get("result", {}).get("instructions", "")), "chars")
status, tl = rpc("tools/list")
tools = tl["result"]["tools"]
print(f"tools/list: {len(tools)} tools")
for t in tools:
    print(f"  - {t['name']:22} {t.get('annotations', {}).get('title', '')!s:28} readOnly={t.get('annotations', {}).get('readOnlyHint')}  inputs={list(t['inputSchema'].get('properties', {}).keys())}")

d = lambda p: p["data"]
tool("search_tokens", {}, lambda p: f"{d(p)['count']} tokens")
tool("search_tokens", {"query": "aave"}, lambda p: f"{len(d(p)['results'])} results")
tool("get_token_snapshot", {"token": "ETH", "sections": "market,derivatives"}, lambda p: f"ETH ${d(p)['market']['price_usd']}")
tool("get_token_snapshot", {"token": "not-a-coin"}, lambda p: "error as expected", expect_error=True)
tool("get_token_timeline", {"token": "chainlink", "series": "price"}, lambda p: f"{len(d(p)['series']['price']['points'])} price points")
ev = tool("check_token", {"token": "bitcoin"}, lambda p: f"{d(p)['verdict']} ({p['id']})")
tool("check_token", {"token": "uniswap", "size_usd": 250000, "policy": {"min_depth_usd": 500000}}, lambda p: f"{d(p)['verdict']} impact {d(p)['size_check']['estimated_impact_pct']}%")
tool("get_token_brief", {"token": "bitcoin"}, lambda p: f"#{d(p)['id']} {d(p)['headline'][:60]}")
tool("ask_about_token", {"token": "solana", "question": "Is leverage in SOL futures crowded right now?"}, lambda p: f"{d(p)['answer'][:70]}…")
tool("ask_about_token", {"token": "solana"}, lambda p: "error as expected", expect_error=True)
w = tool("watch_tokens", {"tokens": ["bitcoin"], "webhook_url": "https://httpbin.org/post"}, lambda p: f"watch {d(p)['id']}")
tool("get_market_overview", {"sections": "overview,rankings"}, lambda p: f"BTC dominance {d(p)['overview']['btc_dominance_pct']}%")
tool("lookup_address", {"chain": "btc", "address": "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo"}, lambda p: f"{d(p)['label']['name'] if isinstance(d(p)['label'], dict) else d(p)['label']}")
tool("get_track_record", {"kind": "brief"}, lambda p: f"{d(p)['calibration']['total_calls']} briefs, hit {d(p)['calibration']['hit_rate_pct']}%")
if ev:
    tool("get_proof", {"id": ev["id"]}, lambda p: f"sha256 match={d(p)['hash_matches_stored']}")
tool("get_service_status", {}, lambda p: f"pipeline {d(p)['pipeline']}")
gk = tool("run_trade_gatekeeper", {"token": "aave", "size_usd": 50000}, lambda p: f"{d(p)['verdict']}: {d(p)['summary'][:70]}")
tool("run_wallet_guard", {"to_address": "0x0330070fd38ec3bb94f58fa55d40368271e9e54a", "chain": "eth"}, lambda p: f"{d(p)['verdict']} (sanctioned address)" if d(p)["verdict"] == "STOP" else 1 / 0)
tool("run_leverage_radar", {"top": 3}, lambda p: f"{d(p)['verdict']}: {d(p)['summary'][:70]}")
tool("run_trade_gatekeeper", {"size_usd": 5}, lambda p: "error as expected", expect_error=True)
if gk:
    tool("get_proof", {"id": gk["id"]}, lambda p: f"agent run sha256 match={d(p)['hash_matches_stored']}")
status, pl = rpc("prompts/list")
names = [x["name"] for x in pl.get("result", {}).get("prompts", [])]
results.append(("prompts/list", "PASS" if len(names) == 3 else "FAIL", ", ".join(names), 0))

# Clean up the test watch so it never fires.
if w:
    urllib.request.urlopen(urllib.request.Request(f"{ORIGIN}/api/v1/monitor/{w['data']['id']}", method="DELETE", headers={"x-monitor-secret": w["data"]["secret"]}), timeout=60)

print()
fails = 0
for name, res, note, secs in results:
    fails += res != "PASS"
    print(f"{res}  {name:22} {note:110} {secs:>5}s")
print(f"\n{len(results)} tool calls, {len(results) - fails} passed, {fails} failed  ({URL})")
sys.exit(1 if fails else 0)
