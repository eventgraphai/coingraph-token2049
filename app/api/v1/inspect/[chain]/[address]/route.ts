import { inspect, OPTIONS } from "@/lib/api/handlers";
import { paid } from "@/lib/x402/server";

export { OPTIONS };
export const GET = paid(inspect, { tier: "premium", group: "inspect", description: "Inspect a blockchain address live" });
