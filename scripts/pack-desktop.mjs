import { cpSync, mkdirSync, readdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const staticDir = join(root, ".vercel", "output", "static");
const dest = join(root, "desktop-web");
if (!existsSync(staticDir)) {
  console.error("Run npm run build first — no production static files.");
  process.exit(1);
}

if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(staticDir, dest, { recursive: true });
rmSync(join(dest, "downloads"), { recursive: true, force: true });

const assets = readdirSync(join(dest, "assets"));
const indexJs = assets.find((f) => f.startsWith("index-") && f.endsWith(".js"));
const routesJs = assets.find((f) => f.startsWith("routes-") && f.endsWith(".js"));
const styles = assets.find((f) => f.startsWith("styles-") && f.endsWith(".css"));
if (!indexJs || !routesJs || !styles) {
  console.error("Missing client assets", { indexJs, routesJs, styles });
  process.exit(1);
}

function stripChrome(html) {
  return html
    .replace(/<script src="https:\/\/grok\.com\/grok-app-builder\/extensions\.js"[^>]*><\/script>/g, "")
    .replace(/<link rel="manifest"[^>]*>/g, "")
    .replace(/<link rel="apple-touch-icon"[^>]*>/g, "");
}

function isBootable(html) {
  return (
    html.length > 8000 &&
    html.includes(indexJs) &&
    html.includes(styles) &&
    /PanelFox/.test(html) &&
    /data-koma-menubar/.test(html)
  );
}

async function htmlFrom(port) {
  const res = await fetch(`http://127.0.0.1:${port}/`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = stripChrome(await res.text());
  if (!isBootable(html)) throw new Error("not production html");
  return html;
}

let html = "";
for (const port of [18769, 18768, 8081, 4173]) {
  try {
    html = await htmlFrom(port);
    console.log("captured SSR html from", port);
    break;
  } catch {
    /* next */
  }
}

if (!html) {
  const port = 18765;
  const viteBin = join(root, "node_modules", ".bin", "vite");
  const child = spawn(
    viteBin,
    ["preview", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: root, stdio: "pipe", env: process.env },
  );
  try {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        html = await htmlFrom(port);
        console.log("captured SSR html from spawned", port);
        break;
      } catch {
        /* wait */
      }
    }
  } finally {
    child.kill("SIGTERM");
  }
}

if (!html || !isBootable(html)) {
  console.error("Could not capture bootable SSR HTML. Refusing to pack a blank desktop app.");
  process.exit(1);
}

html = await vendorFonts(html);
writeFileSync(join(dest, "index.html"), html);
console.log("desktop-web packed", { indexJs, routesJs, styles, htmlBytes: html.length });

/**
 * The desktop app should open fast and work offline, so the Google Fonts
 * stylesheet (render-blocking, and unreachable offline) is copied into the
 * app with its font files. If the fonts cannot be fetched, the page keeps the
 * online stylesheet as before.
 */
async function vendorFonts(page) {
  const link = page.match(/<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"[^>]*>/);
  if (!link) return page;
  const href = link[1].replace(/&amp;/g, "&");
  const agent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  try {
    const res = await fetch(href, { headers: { "user-agent": agent } });
    if (!res.ok) throw new Error(`fonts css HTTP ${res.status}`);
    let css = await res.text();
    const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]))];
    const fontDir = join(dest, "fonts");
    mkdirSync(fontDir, { recursive: true });
    const names = new Map();
    let next = 0;
    const worker = async () => {
      while (next < urls.length) {
        const url = urls[next++];
        const name = url.replace(/^https:\/\/fonts\.gstatic\.com\/s\//, "").replace(/[^a-zA-Z0-9.]+/g, "-");
        const r = await fetch(url, { headers: { "user-agent": agent } });
        if (!r.ok) throw new Error(`font HTTP ${r.status}: ${url}`);
        writeFileSync(join(fontDir, name), Buffer.from(await r.arrayBuffer()));
        names.set(url, name);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    css = css.replace(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g, (_, url) => `url(/fonts/${names.get(url)})`);
    writeFileSync(join(fontDir, "fonts.css"), css);
    console.log("fonts vendored", { files: urls.length });
    return page
      .replace(link[0], '<link rel="stylesheet" href="/fonts/fonts.css"/>')
      .replace(/<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>/g, "");
  } catch (err) {
    console.warn("fonts not vendored; the app loads them online", String(err));
    return page;
  }
}
