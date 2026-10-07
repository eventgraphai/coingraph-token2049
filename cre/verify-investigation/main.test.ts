import { describe, expect } from "bun:test";
import { createHash } from "node:crypto";
import { test } from "@chainlink/cre-sdk/test";
import { canonical, fingerprint, initWorkflow, type Config } from "./main";

const config: Config = { schedule: "0 */5 * * * *", baseUrl: "https://token2049.coingraph.ai", batch: 3, workflowName: "verify-investigation-test", mode: "simulation" };

describe("canonical", () => {
  test("sorts keys at every level and writes no whitespace", () => {
    expect(canonical({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  });
  test("matches the server's canonical form for scalars", () => {
    expect(canonical(null)).toBe("null");
    expect(canonical("é\"")).toBe(JSON.stringify("é\""));
    expect(canonical(1.5)).toBe("1.5");
  });
});

describe("fingerprint", () => {
  test("equals node's sha256 of the same bytes", () => {
    const canon = canonical({ verdict: "proceed", token: { id: "chainlink", symbol: "LINK" }, size_usd: 5000 });
    expect(fingerprint(canon)).toBe(createHash("sha256").update(canon).digest("hex"));
  });
});

describe("initWorkflow", () => {
  test("registers one cron handler on the configured schedule", () => {
    const handlers = initWorkflow(config);
    expect(handlers).toHaveLength(1);
    expect(handlers[0].trigger.config.schedule).toBe(config.schedule);
  });
});
