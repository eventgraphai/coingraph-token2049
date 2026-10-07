import { explainPost, OPTIONS } from "@/lib/api/handlers";
import { paid } from "@/lib/x402/server";

export { OPTIONS };
export const POST = paid(explainPost, { tier: "premium", group: "explain", description: "Run a fresh investigation and write a cited brief" });
