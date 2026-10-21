/** Warm the transparency cache at boot: a cold read takes ~20 s on the rate-limited RPC. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getTransparency } = await import("./lib/transparency");
  getTransparency().catch(() => {});
}
