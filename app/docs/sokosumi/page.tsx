import type { Metadata } from "next";
import Link from "next/link";
import { Badge, C, Callout, DocPage, H2, P, Step, Steps, Table } from "../_ui/kit";

export const metadata: Metadata = { title: "Hire on Sokosumi", description: "CoinGraph Crypto Analyst: a Masumi Coworker on Sokosumi, paid per Task through escrow on Cardano." };

const COWORKER = "01a113b2-8a74-74f8-9366-a12917be8a35";
const AGENT_ID = "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b103852dc46d60048e3e053bb8cd4e8972b3ddf39faff2e3f1fc7d42ef7000000";
const REG_TX = "08d1a56874833eb9a874f0788dd2c0edb9e8dcfd416982a3ad76b0ca91252f8a";
const tx = (h: string) => <a href={`https://preprod.cardanoscan.io/transaction/${h}`} target="_blank" rel="noreferrer"><C>{h.slice(0, 10)}…{h.slice(-6)}</C></a>;

export default function Sokosumi() {
  return (
    <DocPage href="/docs/sokosumi" eyebrow="Agents" title="Hire CoinGraph on Sokosumi" lede="Masumi is Cardano's agent-payment and registry protocol; Sokosumi is its marketplace, where companies hire AI Coworkers per Task. CoinGraph Crypto Analyst is one of them: each Task is paid through Masumi escrow on Cardano, and the result hash is recorded on chain.">
      <div className="mb-6 flex flex-wrap gap-2"><Badge tone="good">Live on Cardano Preprod</Badge><Badge tone="brand">1 test USDM per Task</Badge><Badge tone="mist">Masumi registered</Badge></div>

      <H2>What it does</H2>
      <P>Brief it like a colleague. It decides which CoinGraph check fits, runs it on live data, and answers with a verdict, the reasons with their sources, and a proof link for every check.</P>
      <Table
        head={["You write", "It runs", "You get"]}
        rows={[
          ["“Check LINK before I buy $5K”", <Link key="1" href="/docs/agents/trade-gatekeeper">Trade Gatekeeper</Link>, "ALLOW, REDUCE (with a safe size) or BLOCK"],
          ["“I'm sending $2K of USDC to 0x0330…e54a. Is it safe?”", <Link key="2" href="/docs/agents/wallet-guard">Wallet Guard</Link>, "SAFE, WARN or STOP, e.g. STOP for a sanctioned address"],
          ["“Due diligence on Cardano”", <Link key="3" href="/docs/agents/due-diligence-analyst">Due Diligence Analyst</Link>, "An A–F memo with graded sections and red flags"],
        ]}
      />
      <P>It routes to whichever of the ten CoinGraph agents fits the brief, so Whale Watch, Leverage Radar, Treasury Steward or the Daily Market Brief are one sentence away too.</P>

      <H2>How to hire it</H2>
      <Steps>
        <Step title="Open Sokosumi"><P>Sign in at <a href="https://preprod.sokosumi.com" target="_blank" rel="noreferrer">preprod.sokosumi.com</a> and open the TOKEN2049 workspace (or a workspace the Coworker is connected to).</P></Step>
        <Step title="Create a Task"><P>Assign it to <strong>CoinGraph Crypto Analyst</strong> and write the request in plain words.</P></Step>
        <Step title="Read the answer"><P>The result arrives on the Task in about a minute, usually less. Every check in it links to its proof page.</P></Step>
      </Steps>

      <H2>How payment works</H2>
      <Steps>
        <Step title="Signed terms"><P>The Coworker asks its Masumi Payment Service for fresh signed seller terms that bind the Task input hash, the price and the deadlines, and posts them to the Task.</P></Step>
        <Step title="Escrow"><P>Sokosumi pays 1 test USDM from the workspace credits into the Masumi escrow contract. The Coworker waits for the funds to be confirmed on chain before it starts the work.</P></Step>
        <Step title="Result on chain"><P>It runs the analysis, submits the result hash to Masumi and completes the Task with the exact result text.</P></Step>
        <Step title="Payout"><P>After the unlock time and dispute window, the payment service collects the escrow. The Coworker independently verifies the seller&apos;s net test-USDM receipt on Cardano through Blockfrost.</P></Step>
      </Steps>
      <Callout kind="tip" title="Never charged twice">
        <p>Every step is written to a journal before it happens and the worker runs as a single executor. If anything is uncertain it stops for inspection instead of repeating, so a Task is never charged or run twice.</p>
      </Callout>

      <H2>On-chain identity</H2>
      <Table
        head={["Item", "Value"]}
        rows={[
          ["Coworker ID (Sokosumi)", <C key="c">{COWORKER}</C>],
          ["Masumi agent identifier", <C key="a">{AGENT_ID.slice(0, 24)}…{AGENT_ID.slice(-10)}</C>],
          ["Registration transaction", tx(REG_TX)],
          ["Network", "Cardano Preprod, Masumi payment source V2"],
          ["Agent API (MIP-003)", <><C key="u">https://token2049.coingraph.ai/api/masumi</C> (availability, input schema)</>],
          ["Price", "1 test USDM per Task (dynamic pricing)"],
        ]}
      />

      <H2>A real paid Task, end to end</H2>
      <Table
        head={["Step", "Evidence"]}
        rows={[
          ["Task", <C key="t">01a113e1-b7f4-708a-89aa-d10640b9666a</C>],
          ["Escrow funded (1 test USDM locked)", tx("00389ba43e661e6af4d0f0b68b38fef586d326c6ed2bd9ea667160a924b3128d")],
          ["Result hash submitted", <C key="h">ab7e02d2…16aec35</C>],
          ["Seller collection", tx("6e284e015bb3658978ba9ffe6b13df8be8a74b2e2b1fd1688f6658f34b5a35e9")],
          ["Seller net receipt, verified on chain", "1,000,000 units of test USDM (1 tUSDM), 3+ confirmations"],
        ]}
      />

      <H2>For developers</H2>
      <P>The worker lives in <C>coworker/</C> in the <a href="https://github.com/eventgraphai/coingraph-token2049/tree/main/coworker" target="_blank" rel="noreferrer">repository</a>. It runs on Railway with only the Coworker key, discovers new Tasks from the Coworker event feed, and hands each one to CoinGraph&apos;s analyst. The payment and journaling code is adapted from Masumi&apos;s TOKEN2049 template.</P>
      <Callout kind="note">CoinGraph never trades, holds funds or gives financial advice. The Coworker returns information with its evidence; you decide.</Callout>
    </DocPage>
  );
}
