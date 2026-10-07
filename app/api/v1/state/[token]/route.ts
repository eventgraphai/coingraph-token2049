import { state, OPTIONS } from "@/lib/api/handlers";
import { paid } from "@/lib/x402/server";

export { OPTIONS };
// Data tier: 25 free calls a day per caller, then 2 tADA.
export const GET = paid(state, { tier: "data", group: "data", description: "Everything known about a token right now" });
