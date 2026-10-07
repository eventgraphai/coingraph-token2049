import { evaluatePost, OPTIONS } from "@/lib/api/handlers";
import { paid } from "@/lib/x402/server";

export { OPTIONS };
export const POST = paid(evaluatePost, { tier: "premium", group: "evaluate", description: "Check a token sized to your order and rules" });
