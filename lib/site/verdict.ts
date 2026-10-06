// Verdict colours shared by the website (server and client). Good / watch / stop, nothing else.
export type Tone = "good" | "warn" | "bad" | "neutral";

const GOOD = new Set(["ALLOW", "SAFE", "A", "B", "SETUPS_FOUND", "BALANCED", "ACCUMULATING", "COMPLIANT", "QUIET", "RISK_ON", "proceed", "ok"]);
const WARN = new Set(["REDUCE", "WARN", "C", "ELEVATED", "NEUTRAL", "INCOMPLETE", "ACTIVE", "NOTHING_CLEAN", "NO_DATA", "caution"]);
const BAD = new Set(["BLOCK", "STOP", "D", "F", "CROWDED", "DISTRIBUTING", "BREACH", "RISK_OFF", "avoid"]);

export const toneOf = (v: string): Tone => (GOOD.has(v) ? "good" : WARN.has(v) ? "warn" : BAD.has(v) ? "bad" : "neutral");

export const TONE_TEXT: Record<Tone, string> = { good: "text-life", warn: "text-ember", bad: "text-blood", neutral: "text-mist" };
export const TONE_CHIP: Record<Tone, string> = {
  good: "border-life/35 bg-life/10 text-life",
  warn: "border-ember/35 bg-ember/10 text-ember",
  bad: "border-blood/35 bg-blood/10 text-blood",
  neutral: "border-edge bg-slab text-mist",
};

export const label = (v: string) => v.replace(/_/g, " ");
