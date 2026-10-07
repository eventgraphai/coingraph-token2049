import { askPost, OPTIONS } from "@/lib/api/handlers";
import { paid } from "@/lib/x402/server";

export { OPTIONS };
export const POST = paid(askPost, { tier: "premium", group: "ask", description: "Ask a question about a token or check a claim" });
