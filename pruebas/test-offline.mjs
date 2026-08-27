/* Prueba del visor 100% sin conexión (v3.10):
   1) La app carga con pdf.js y epub.js servidos desde /vendor (sin CDN).
   2) Un PDF local abre y se pinta en el canvas.
   3) Un EPUB local abre y muestra el texto del capítulo.
   4) El service worker guarda el esqueleto y la app abre OFFLINE de verdad.
   El sandbox no tiene internet: cualquier petición externa se aborta,
   que es exactamente el escenario que queremos validar. */
import { chromium } from "./entorno.mjs";

const BASE = "http://localhost:8765";
// Se lee del propio sw.js para que la prueba no caduque en cada versión.
const VERSION_SW = (await (await fetch(BASE + "/sw.js")).text())
  .match(/const VERSION = "(v[\d.]+)"/)[1];
let ok = 0, mal = 0;
const paso = (nombre, cond) => {
  if (cond) { ok++; console.log("  ✅", nombre); }
  else { mal++; console.log("  ❌", nombre); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

// Sin internet: todo lo externo se corta al instante (más rápido que el timeout).
await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());

const page = await ctx.newPage();
const consolaErrores = [];
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const txt = m.text();
  // Esperado sin internet: hls/mpegts (CDN a propósito) y APIs externas.
  if (/cdnjs|jikan|anilist|googleapis|gstatic|ERR_FAILED|Failed to load resource/i.test(txt)) return;
  consolaErrores.push(txt);
});

console.log("— Carga de la app sin CDN —");
await page.goto(BASE + "/index.html", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.pdfjsLib && window.ePub, null, { timeout: 15000 })
  .catch(() => {});
paso("window.pdfjsLib presente (vendor/pdfjs)", await page.evaluate(() => !!window.pdfjsLib));
paso("window.ePub presente (vendor/epubjs)", await page.evaluate(() => !!window.ePub));
paso("versión de pdf.js = 3.11.174",
  await page.evaluate(() => window.pdfjsLib?.version === "3.11.174"));

console.log("— PDF local en el visor —");
await page.setInputFiles("#fileInput", "/home/claude/lector-otaku/fx/prueba.pdf");
await page.waitForSelector("#pdfCanvas", { timeout: 15000 }).catch(() => {});
paso("el modal del visor abre", await page.evaluate(() =>
  !document.getElementById("viewerModal").classList.contains("hidden")));
const canvasPintado = await page.evaluate(() => {
  const c = document.getElementById("pdfCanvas");
  if (!c || !c.width) return false;
  const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] !== px[4] || px[i + 1] !== px[5] || px[i + 2] !== px[6]) return true;
  }
  return false;
});
paso("el PDF se pinta en el canvas (no está en blanco)", canvasPintado);
paso("el worker de pdf.js es el del repo", await page.evaluate(() =>
  window.pdfjsLib.GlobalWorkerOptions.workerSrc === "vendor/pdfjs/pdf.worker.min.js"));
await page.click('[data-close="viewerModal"]');

console.log("— EPUB local en el visor —");
await page.setInputFiles("#fileInput", "/home/claude/lector-otaku/fx/prueba.epub");
await page.waitForSelector("#epubArea iframe", { timeout: 15000 }).catch(() => {});
const textoEpub = await page.evaluate(() => {
  const f = document.querySelector("#epubArea iframe");
  try { return f?.contentDocument?.body?.textContent || ""; } catch { return ""; }
});
paso("el EPUB se renderiza y se lee el capítulo", /Hola AniLector EPUB/.test(textoEpub));
await page.click('[data-close="viewerModal"]');

console.log("— Service worker: la app abre sin conexión —");
await page.evaluate(() => navigator.serviceWorker?.ready);
// esperar a que el SHELL esté cacheado (el SW añade de uno en uno)
const cacheado = await page.waitForFunction(async () => {
  const keys = await caches.keys();
  const k = keys.find((n) => n.startsWith("anilector-"));
  if (!k) return false;
  const c = await caches.open(k);
  const necesarios = ["vendor/pdfjs/pdf.min.js", "vendor/pdfjs/pdf.worker.min.js",
    "vendor/epubjs/epub.min.js", "vendor/jszip/jszip.min.js", "index.html"];
  for (const u of necesarios) if (!(await c.match(u))) return false;
  return true;
}, null, { timeout: 20000 }).then(() => true).catch(() => false);
paso("el SHELL (pdfjs, epubjs, jszip…) queda cacheado", cacheado);

const nombreCache = await page.evaluate(async () =>
  (await caches.keys()).find((n) => n.startsWith("anilector-")) || "");
paso("la caché es de la versión actual del service worker", nombreCache === "anilector-" + VERSION_SW);

await ctx.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForFunction(() => window.pdfjsLib && window.ePub, null, { timeout: 15000 })
  .catch(() => {});
paso("OFFLINE: la app vuelve a cargar", await page.evaluate(() =>
  !!document.getElementById("viewerModal")));
paso("OFFLINE: pdf.js y epub.js disponibles", await page.evaluate(() =>
  !!(window.pdfjsLib && window.ePub)));

// y el visor sigue funcionando sin red:
await page.setInputFiles("#fileInput", "/home/claude/lector-otaku/fx/prueba.pdf");
await page.waitForSelector("#pdfCanvas", { timeout: 15000 }).catch(() => {});
paso("OFFLINE: un PDF local abre igual", await page.evaluate(() => {
  const c = document.getElementById("pdfCanvas");
  return !!(c && c.width);
}));
await ctx.setOffline(false);

paso("sin errores de consola inesperados", consolaErrores.length === 0);
if (consolaErrores.length) console.log("   errores:", consolaErrores.slice(0, 5));

await browser.close();
console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
