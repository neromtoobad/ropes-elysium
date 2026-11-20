// node render.mjs a-home a-trade …  → png/<name>.png at 1440 wide, full page, 1x
import { createRequire } from "node:module"; import path from "node:path"; import { fileURLToPath, pathToFileURL } from "node:url"; import { mkdirSync } from "node:fs";
const here = path.dirname(fileURLToPath(import.meta.url));
const puppeteer = createRequire(path.join(here, "../../../video/package.json"))("puppeteer-core");
mkdirSync(path.join(here, "png"), { recursive: true });
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--allow-file-access-from-files", "--force-color-profile=srgb"] });
for (const n of process.argv.slice(2)) { const p = await b.newPage(); const mobile = n.includes("mobile");
  await p.setViewport({ width: mobile ? 390 : 1440, height: 900, deviceScaleFactor: mobile ? 2 : 1 });
  await p.goto(pathToFileURL(path.join(here, n + ".html")).href, { waitUntil: "networkidle0" }); await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(here, "png", n + ".png"), fullPage: true }); await p.close(); console.log("→ png/" + n + ".png"); }
await b.close();
