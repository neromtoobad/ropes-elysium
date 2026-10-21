import { ICS } from "@/lib/launch";

export const dynamic = "force-static";

export function GET() {
  return new Response(ICS, {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="elysium-mainnet.ics"' },
  });
}
