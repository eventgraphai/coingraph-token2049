import { monitorGet, monitorPost, OPTIONS } from "@/lib/api/handlers";
import { paid } from "@/lib/x402/server";

export { monitorGet as GET, OPTIONS };
export const POST = paid(monitorPost, { tier: "premium", group: "monitor", description: "Create a monitor with signed webhooks" });
