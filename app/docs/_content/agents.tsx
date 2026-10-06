import type { ReactNode } from "react";

// Agent documentation beyond what the registry holds: when to use it, how it decides (matching the code in
// lib/agents), what each verdict means, what the result contains, and which real examples to show.

export type AgentDoc = {
  useWhen: string[];
  decides: ReactNode[];
  verdicts: Record<string, string>;
  result: [string, string][];
  examples: { key: string; label: string }[];
  notes?: ReactNode;
};

export const AGENT_DOCS: Record<string, AgentDoc> = {
  "trade-gatekeeper": {
    useWhen: ["A trading agent is about to place an order and needs a go / no-go.", "A person wants to know whether a size fits the market before clicking buy.", "A fund wants an auditable pre-trade check attached to every order."],
    decides: [
      "Runs the full token check sized to your order.",
      "Prices the order on the best route: exchange order books (asks for a buy, bids for a sell) or a live on-chain quote from ParaSwap, KyberSwap or Jupiter on the token's home chain.",
      "Impact limit: max_impact_pct if you set it, otherwise 1% for top-20 tokens and 2% for the rest.",
      "BLOCK if one of your rules fails, the check says avoid, or even the best route costs more than twice the limit.",
      "REDUCE if impact is over the limit or the order is more than 1% of daily volume, with the largest safe size.",
      "ALLOW otherwise, with any caution from the check passed on as a warning.",
    ],
    verdicts: { ALLOW: "The order fits current liquidity and nothing in the check stops it.", REDUCE: "Go ahead with a smaller order; result.size.max_safe_usd says how much.", BLOCK: "Do not place this order now; the reasons say why." },
    result: [["size", "requested_usd and max_safe_usd (0 on BLOCK)."], ["impact", "best_route, best_pct, every route priced, limit_pct and share_of_daily_volume_pct."], ["check", "The underlying check: verdict, confidence, dimension ratings and evaluation_id."], ["policy", "Your rules, pass / fail / unknown."], ["latest_brief", "The latest brief when the token is rated caution or avoid."]],
    examples: [{ key: "agent:trade-gatekeeper", label: "ALLOW: buy $5K of SOL" }, { key: "agent:trade-gatekeeper:reduce", label: "REDUCE: buy $10K of RAIN with a 0.25% impact limit" }, { key: "agent:trade-gatekeeper:block", label: "BLOCK: buy $10K of LEO" }],
    notes: <>For liquid tokens such as ADA, LINK and SOL, an order of a few thousand dollars barely moves the price, so the answer is usually ALLOW. REDUCE and BLOCK show up on thin tokens, on tokens with contract or concentration risks, or when you set a tight <code>max_impact_pct</code>.</>,
  },
  "wallet-guard": {
    useWhen: ["A wallet app wants a safety check before the user signs.", "An agent is about to send funds to an address it has not seen before.", "A person wants to know if a token they are swapping into is safe."],
    decides: [
      "Token: contract risks on its home chain (honeypot test, taxes, mint, freeze, blacklist, owner powers) and the real price impact of the amount.",
      "Recipient, read live: OFAC sanctions, GoPlus scam and phishing flags, burn addresses, brand-new wallets, and look-alikes of known exchange addresses (address poisoning).",
      "STOP on a sanctioned, flagged, burn or look-alike recipient, a dangerous contract, or more than 5% price impact.",
      "WARN on 2–5% impact, a serious market risk on the token, or a large send to a new wallet.",
    ],
    verdicts: { SAFE: "Nothing risky found.", WARN: "You can continue, but read the warning first.", STOP: "Do not sign." },
    result: [["token", "Symbol, the check's verdict, contract rating, price impact and proof id."], ["recipient", "Label, type, transaction count, screening and any look-alike match."]],
    examples: [{ key: "agent:wallet-guard", label: "SAFE: swap $5K into LINK, send to a Binance wallet" }, { key: "agent:wallet-guard:stop", label: "STOP: send to an address on the OFAC list" }],
  },
  "due-diligence-analyst": {
    useWhen: ["Before adding a token to a portfolio, a listing or a treasury.", "A research or compliance team needs a consistent, sourced memo.", "A person wants the full picture on one token in plain language."],
    decides: [
      "Grades six sections from 0 to 100: Liquidity & markets (25%), Supply & concentration (20%), Contract & admin powers (20%), Onchain activity (10%), Derivatives & leverage (10%), Development, usage & community (15%).",
      "Grade bands: A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40, F below.",
      "Three or more red flags cap the grade at D.",
      "Claude writes a short executive summary from the graded sections only.",
    ],
    verdicts: { A: "Strong on every section.", B: "Solid, with minor concerns.", C: "Mixed: read the red flags.", D: "Weak or several red flags.", F: "Fails on fundamentals." },
    result: [["overall", "Grade and score."], ["sections[]", "Name, score, grade, findings and sources."], ["red_flags, strengths", "The headline issues and positives."], ["current_check, latest_brief, recent_news", "Today's check, the latest brief and headlines."], ["coingraph_track_record_30d, method", "How CoinGraph's calls on this token have done, and how the grade is computed."]],
    examples: [{ key: "agent:due-diligence-analyst", label: "Cardano" }],
  },
  "opportunity-scout": {
    useWhen: ["A trader wants ideas that already passed a risk check.", "A newsletter or app wants a daily shortlist with reasons and invalidation levels."],
    decides: ["Collects today's movers: price, volume spikes, open interest and exchange outflows.", "Runs the full check on each and drops anything rated avoid.", "Ranks the rest, preferring proceed over caution, and gives the price that would prove each idea wrong."],
    verdicts: { SETUPS_FOUND: "At least one mover passed the check.", NOTHING_CLEAN: "Things are moving, but none passed." },
    result: [["setups[]", "token, price_usd, why (what is moving), check, risks, invalidation_usd, horizon, direction and evaluation_id."], ["dropped[]", "Movers that failed the check, and why."], ["scanned", "How many movers were checked."]],
    examples: [{ key: "agent:opportunity-scout", label: "Top 3 setups" }],
  },
  "leverage-radar": {
    useWhen: ["Before opening a leveraged position.", "A risk team wants to know where a squeeze or flush is most likely."],
    decides: ["Scores each futures market 0–100 for crowding from funding against its own 14-day history, open-interest growth (especially while price is flat), top traders' long/short against their 7-day average, open interest as a share of market cap, and recent liquidations.", "CROWDED at 65 or more, ELEVATED at 45 or more."],
    verdicts: { CROWDED: "One side is stretched: squeeze risk is high.", ELEVATED: "Leverage is building; watch it.", BALANCED: "No market is stretched." },
    result: [["markets[]", "Token, score, regime, the crowded side and the reasons."]],
    examples: [{ key: "agent:leverage-radar", label: "SOL, ADA and LINK" }],
  },
  "whale-watch": {
    useWhen: ["Before a large position, to see whether big holders are buying or selling.", "To explain a move: are coins leaving or entering exchanges?"],
    decides: ["Compares today's net exchange flow with its own daily history (a z-score) and checks whether exchange reserves agree.", "DISTRIBUTING when coins flow onto exchanges unusually and reserves are not falling; ACCUMULATING for the reverse.", "Profiles the wallets behind the largest transfers live."],
    verdicts: { ACCUMULATING: "Coins are leaving exchanges: holders taking custody.", DISTRIBUTING: "Coins are moving onto exchanges: possible selling ahead.", NEUTRAL: "Flows are within the normal range.", NO_DATA: "The token's chain is not covered on chain." },
    result: [["exchange_flows, net_24h_zscore, daily_net_7d", "Net exchange flow, how unusual today is, and the last 7 days."], ["reserves_7d_change_pct", "Change in exchange reserves."], ["deposits, withdrawals, other_large_moves", "Largest transfers to, from and outside exchanges."], ["wallet_profiles", "Live profiles of the wallets involved."]],
    examples: [{ key: "agent:whale-watch", label: "Chainlink" }],
  },
  "portfolio-checkup": {
    useWhen: ["A wallet app shows a health score for the user's holdings.", "A person wants to know what to fix in a wallet."],
    decides: ["Reads the wallet's balances live and checks every tracked token.", "Starts at 100 and deducts for concentration (stablecoins excluded), positions that fail or need caution, positions that would take more than 3 days to exit at 5% of daily volume, and value in untracked tokens.", "Grades: A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40, F below. Lists the fixes that matter most."],
    verdicts: { A: "Healthy.", B: "Good, with something to improve.", C: "Needs attention.", D: "Several problems.", F: "Serious problems." },
    result: [["score, grade, total_usd", "The health score and wallet value."], ["concentration_hhi, stablecoin_share_pct", "How concentrated the wallet is."], ["positions[]", "Each holding: share, check, contract rating, days to exit."], ["fixes[]", "What to change, most important first."]],
    examples: [{ key: "agent:portfolio-checkup", label: "An Ethereum wallet" }],
  },
  "treasury-steward": {
    useWhen: ["A DAO or company treasury must prove its holdings meet its investment policy.", "Before a governance vote, to attach evidence to a proposal."],
    decides: ["Checks every asset against every rule: minimum depth, top-10 holders, funding, exchange inflow, mint authority, exit slippage for the whole position, and share of market cap.", "Exit slippage uses the cheaper of a live on-chain sell quote and the exchange order books.", "Native coins (ADA, SOL, ETH…) have no token contract, so no admin can mint; the mint rule passes for them."],
    verdicts: { COMPLIANT: "Every asset passes every rule.", BREACH: "At least one rule fails.", INCOMPLETE: "No failures, but at least one rule could not be measured." },
    result: [["assets[]", "Token, value, status, every rule's pass / fail / unknown with detail, and a proof id."], ["total_usd", "The treasury's total."]],
    examples: [{ key: "agent:treasury-steward", label: "A $20K community treasury in ADA, LINK and SOL" }],
  },
  "alert-watchtower": {
    useWhen: ["You hold or follow a few tokens and want every alert explained.", "An app needs signed webhooks without building the signal engine."],
    decides: ["Collects recent signals at or above your severity on your tokens, each with the brief that explains it.", "With a webhook URL it also creates a monitor, so new signals and briefs are pushed to you, signed."],
    verdicts: { ACTIVE: "There are alerts in the window.", QUIET: "Nothing at your severity." },
    result: [["alerts[]", "Token, kind, direction, severity, time and the explaining brief."], ["per_token", "Counts per token."], ["watch", "The monitor id and how messages are signed (only with a webhook)."]],
    examples: [{ key: "agent:alert-watchtower", label: "ADA, LINK and SOL" }],
    notes: <>The monitor secret is returned once in the response and is not stored in the public run record.</>,
  },
  "daily-market-brief": {
    useWhen: ["A morning summary for a person, a team channel or a newsletter.", "An agent needs market context before acting."],
    decides: ["RISK_ON when at least 60% of the top 100 are up and the market cap rose; RISK_OFF when 40% or fewer are up and it fell; NEUTRAL otherwise.", "Adds graded calls from the record, the most crowded futures, the biggest movers, headlines and your holdings."],
    verdicts: { RISK_ON: "Broad strength.", RISK_OFF: "Broad weakness.", NEUTRAL: "Mixed." },
    result: [["markdown", "The brief as readable text."], ["regime, overview, breadth, sentiment, flows", "The numbers behind it."], ["crowded, headlines, holdings", "Crowded trades, news and your tokens."]],
    examples: [{ key: "agent:daily-market-brief", label: "With ADA, LINK and SOL as holdings" }],
  },
};
