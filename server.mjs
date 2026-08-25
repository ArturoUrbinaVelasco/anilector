/* ============================================================
   AniLector — servidor local (todo en uno)
   ------------------------------------------------------------
   Sirve la app Y un proxy HLS desde TU propia conexión, para
   reproducir dentro de la app los canales http/IP o con bloqueo
   por región que hoy solo se ven en pestaña nueva.

   Uso:
     node server.mjs
   Luego abre:  http://localhost:8787

   Requiere Node 18 o superior. No instala nada.
   ============================================================ */
import http from "node:http";
import os from "node:os";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = process.env.PORT || 8787;

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}
const ROOT = fileURLToPath(new URL(".", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/* ---------- proxy HLS ---------- */
function rewritePlaylist(text, targetUrl, selfBase) {
  const wrap = (abs) => `${selfBase}/api/hls?url=${encodeURIComponent(abs)}`;
  const toAbs = (uri) => { try { return new URL(uri, targetUrl).href; } catch { return uri; } };
  const rewriteAttrUri = (line) =>
    line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${wrap(toAbs(u))}"`);
  return text.split(/\r?\n/).map((line) => {
    const l = line.trim();
    if (!l) return line;
    if (l.startsWith("#")) return /URI="/.test(l) ? rewriteAttrUri(l) : line;
    return wrap(toAbs(l));
  }).join("\n");
}

async function handleHls(req, res, target) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (!target || !/^https?:\/\//i.test(target)) {
    res.writeHead(400); return res.end("url inválida");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let ref = "";
  try { const u = new URL(target); ref = `${u.protocol}//${u.host}/`; } catch (_) {}
  try {
    const up = await fetch(target, {
      redirect: "follow", signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "*/*", ...(ref ? { Referer: ref, Origin: ref.replace(/\/$/, "") } : {}) },
    });
    if (!up.ok) { res.writeHead(502); return res.end(`upstream ${up.status}`); }
    const ct = up.headers.get("content-type") || "";
    const isM3u = /\.m3u8(\?|$)/i.test(target) || /mpegurl/i.test(ct);
    const selfBase = `http://${req.headers.host}`;
    if (isM3u) {
      const text = await up.text();
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" });
      return res.end(rewritePlaylist(text, up.url || target, selfBase));
    }
    const buf = Buffer.from(await up.arrayBuffer());
    res.writeHead(200, { "Content-Type": ct || "video/mp2t", "Cache-Control": "public, max-age=10" });
    return res.end(buf);
  } catch (e) {
    res.writeHead(502); res.end("No se pudo alcanzar el stream: " + (e.message || e));
  } finally { clearTimeout(timer); }
}

/* ---------- estáticos ---------- */
async function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const full = normalize(join(ROOT, p));
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end("prohibido"); }
  try {
    const data = await readFile(full);
    res.writeHead(200, { "Content-Type": MIME[extname(full)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("no encontrado");
  }
}

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/hls") return handleHls(req, res, u.searchParams.get("url"));
  if (u.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, service: "anilector-local" }));
  }
  serveStatic(req, res);
}).listen(PORT, "0.0.0.0", async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  AniLector corriendo:`);
  console.log(`    En esta PC:      ${url}`);
  for (const ip of lanIPs()) console.log(`    En tu red/móvil: http://${ip}:${PORT}   (misma WiFi)`);
  console.log("\n  Se abrirá tu navegador. Ctrl+C para detener.\n");
  // Abrir el navegador automáticamente
  try {
    const { spawn } = await import("node:child_process");
    const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch (_) { /* si falla, el usuario abre la URL a mano */ }
});
