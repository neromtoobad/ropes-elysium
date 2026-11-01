import type { NextConfig } from "next";
const config: NextConfig = {
  // Silence the workspace-root guess; a stray lockfile in $HOME misleads it.
  outputFileTracingRoot: import.meta.dirname,
  // The SDK opens a WebSocket and pulls in node built-ins; keep it external so
  // Next doesn't try to bundle it for the server runtime.
  serverExternalPackages: ["@somnia-chain/markets-sdk", "@prisma/client"],
  // Points and the boards are one page now; old links and shared posts land there.
  async redirects() {
    return [{ source: "/points", destination: "/leaders", permanent: true }];
  },
};
export default config;
