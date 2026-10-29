import { NextResponse, type NextRequest } from "next/server";

/** ROPES moved to playropes.xyz; old links on ropes.nerom.site keep their path. */
const HOME = "playropes.xyz";
const OLD = new Set(["ropes.nerom.site", "www.playropes.xyz"]);

export function middleware(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0];
  if (!OLD.has(host)) return NextResponse.next();
  const url = new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${HOME}`);
  return NextResponse.redirect(url, 308);
}

export const config = {
  // Leave the health check alone so Railway's probe never follows a redirect.
  matcher: ["/((?!health).*)"],
};
