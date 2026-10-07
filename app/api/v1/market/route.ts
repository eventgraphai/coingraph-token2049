import { market, OPTIONS } from "@/lib/api/handlers";
import { paid } from "@/lib/x402/server";

export { OPTIONS };
// Data tier: 25 free calls a day per caller, then 2 tADA.
export const GET = paid(market, { tier: "data", group: "data", description: "The whole market at a glance" });
