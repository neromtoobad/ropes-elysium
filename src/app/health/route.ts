/** Railway's health check for the web service (the executor answers its own). */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, role: "web" }, { headers: { "cache-control": "no-store" } });
}
