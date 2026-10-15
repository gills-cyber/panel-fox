import { createServer } from "node:http";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, nativeTheme, session, shell } from "electron";

/** Stable origin so localStorage / IndexedDB survive restarts. */
const DESKTOP_PORT = 47821;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function webRoot() {
  if (app.isPackaged) return join(process.resourcesPath, "desktop-web");
  return join(fileURLToPath(new URL(".", import.meta.url)), "..", "desktop-web");
}

function prefsPath() {
  return join(app.getPath("userData"), "prefs.json");
}

async function readDiskPrefs() {
  try {
    const parsed = JSON.parse(await readFile(prefsPath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeDiskPrefs(patch) {
  const next = { ...(await readDiskPrefs()), ...patch, updatedAt: Date.now() };
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(prefsPath(), JSON.stringify(next));
  return next;
}

function applyNativeTheme(theme) {
  const dark = theme === "dark";
  nativeTheme.themeSource = dark ? "dark" : "light";
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setBackgroundColor(dark ? "#1c1c1e" : "#ececee");
  }
}

function themeBootScript(prefs) {
  const diskTheme = prefs.theme === "dark" || prefs.theme === "light" ? prefs.theme : "";
  const diskAt = typeof prefs.updatedAt === "number" ? prefs.updatedAt : 0;
  return `<script>try{var k="koma-prefs-v1";var p=JSON.parse(localStorage.getItem(k)||"{}");var disk=${JSON.stringify(diskTheme)};var diskAt=${diskAt};var localAt=typeof p.updatedAt==="number"?p.updatedAt:0;if((disk==="dark"||disk==="light")&&(p.theme!=="dark"&&p.theme!=="light"||diskAt>=localAt)){p.theme=disk;p.updatedAt=Math.max(diskAt,localAt);localStorage.setItem(k,JSON.stringify(p));localStorage.setItem("koma-theme",disk)}var t=p.theme==="dark"?"dark":"light";document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;if(t==="dark"){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#1c1c1e")}}catch(e){}</script>`;
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0] || "/");
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const full = normalize(join(root, rel));
  const rootNorm = normalize(root) + sep;
  if (full !== normalize(root) && !full.startsWith(rootNorm)) return null;
  return full;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function startServer(root) {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = (req.url || "/").split("?")[0];
      if (req.method === "POST" && (urlPath === "/__prefs" || urlPath === "/__prefs/")) {
        const raw = await readBody(req);
        let body = {};
        try {
          body = JSON.parse(raw.toString("utf8") || "{}");
        } catch {
          body = {};
        }
        const saved = await writeDiskPrefs(body);
        if (saved.theme === "dark" || saved.theme === "light") applyNativeTheme(saved.theme);
        res.writeHead(204, { "cache-control": "no-store" }).end();
        return;
      }
      if (req.method === "GET" && (urlPath === "/__prefs" || urlPath === "/__prefs/")) {
        const prefs = await readDiskPrefs();
        res.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        }).end(JSON.stringify(prefs));
        return;
      }
      let file = safeJoin(root, req.url || "/");
      if (!file) {
        res.writeHead(403).end();
        return;
      }
      let st;
      try {
        st = await stat(file);
      } catch {
        file = join(root, "index.html");
        st = await stat(file);
      }
      if (st.isDirectory()) file = join(file, "index.html");
      let data = await readFile(file);
      const ext = extname(file).toLowerCase();
      if (ext === ".html") {
        const prefs = await readDiskPrefs();
        const html = data.toString("utf8").replace("<head>", `<head>${themeBootScript(prefs)}`);
        data = Buffer.from(html);
      }
      res.writeHead(200, {
        "content-type": MIME[ext] || "application/octet-stream",
        "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      });
      res.end(data);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    const fail = (err) => reject(err);
    server.once("error", fail);
    server.listen(DESKTOP_PORT, "127.0.0.1", () => {
      server.off("error", fail);
      resolve();
    });
  });
  return { server, url: `http://127.0.0.1:${DESKTOP_PORT}/` };
}

async function persistRendererState(win) {
  const ses = session.fromPartition("persist:panelfox");
  if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
    try {
      const raw = await Promise.race([
        win.webContents.executeJavaScript(
          `(function(){try{return localStorage.getItem("koma-prefs-v1")}catch(e){return null}})()`,
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
      ]);
      if (typeof raw === "string" && raw) {
        const parsed = JSON.parse(raw);
        await writeDiskPrefs(parsed);
        if (parsed.theme === "dark" || parsed.theme === "light") applyNativeTheme(parsed.theme);
      }
    } catch {
      /* renderer gone */
    }
    try {
      await win.webContents.session.flushStorageData();
    } catch {
      /* fall through */
    }
  }
  try {
    await ses.flushStorageData();
  } catch {
    /* ignore */
  }
}

async function createWindow(url) {
  const prefs = await readDiskPrefs();
  const dark = prefs.theme === "dark";
  applyNativeTheme(dark ? "dark" : "light");
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    title: "PanelFox",
    // Packed, the fox icon sits in resources/ (the slimmed app.asar holds only main.mjs).
    icon: app.isPackaged
      ? join(process.resourcesPath, "icon.png")
      : fileURLToPath(new URL("./icon.png", import.meta.url)),
    backgroundColor: dark ? "#1c1c1e" : "#ececee",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      partition: "persist:panelfox",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  let persisting = false;
  win.on("close", (e) => {
    if (persisting) return;
    persisting = true;
    e.preventDefault();
    persistRendererState(win).finally(() => {
      if (!win.isDestroyed()) win.destroy();
    });
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.session.on("will-download", (_event, item) => {
    const pick = dialog.showSaveDialogSync(win, {
      defaultPath: item.getFilename(),
      title: "Save",
    });
    if (!pick) {
      item.cancel();
      return;
    }
    item.setSavePath(pick);
  });
  await win.loadURL(url);
}

app.setName("PanelFox");
app.setAppUserModelId("media.panelfox.studio");

let startUrl = "";
let quitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    const prefs = await readDiskPrefs();
    applyNativeTheme(prefs.theme === "dark" ? "dark" : "light");
    const { url } = await startServer(webRoot());
    startUrl = url;
    await createWindow(url);
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && startUrl) {
      void createWindow(startUrl);
    }
  });
  app.on("before-quit", (e) => {
    if (quitting) return;
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    if (!wins.length) return;
    e.preventDefault();
    quitting = true;
    Promise.all(wins.map((w) => persistRendererState(w))).finally(() => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.destroy();
      }
      app.quit();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
