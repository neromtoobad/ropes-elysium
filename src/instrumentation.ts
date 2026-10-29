/** Warm the transparency cache at boot: a cold read takes ~20 s on the rate-limited RPC. */
export async function register() {
  // Keep the import inside this branch so the edge bundle (middleware) never pulls in node code.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getTransparency } = await import("./lib/transparency");
    getTransparency().catch(() => {});
  }
}
