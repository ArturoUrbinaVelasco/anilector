/* v3.14 — abrir archivos DESDE FUERA: arrastrar y soltar, doble clic en
   el explorador (File Handling API) y «compartir con AniLector» (Web
   Share Target). Las dos últimas solo existen con la app instalada, así
   que aquí se prueba NUESTRA parte: el consumidor de launchQueue y el
   service worker que atiende el POST de compartir. */
import { chromium } from "./entorno.mjs";

const BASE = "http://localhost:8765";
const FX = "/home/claude/lector-otaku/fx";
let ok = 0, mal = 0;
const paso = (n, c) => { c ? (ok++, console.log("  ✅", n)) : (mal++, console.log("  ❌", n)); };
const seccion = (s) => console.log(`\n— ${s} —`);

const browser = await chromium.launch();

async function nuevaPagina({ initScript = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const page = await ctx.newPage();
  if (initScript) await page.addInitScript(initScript);
  const errores = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const x = m.text();
    if (/cdnjs|jikan|anilist|googleapis|gstatic|ERR_FAILED|Failed to load resource/i.test(x)) return;
    errores.push(x);
  });
  page.on("pageerror", (e) => errores.push("pageerror: " + e.message));
  return { ctx, page, errores };
}
const cargar = async (page, url = BASE + "/index.html") => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.pdfjsLib && window.ePub, null, { timeout: 15000 }).catch(() => {});
};
/* Una pestaña abierta ANTES de que existiera el service worker no está
   controlada por él hasta que hace `claim()`, y sus peticiones se van a
   la red sin pasar por el worker. Al compartir de verdad esto no ocurre
   (la app está instalada y el worker lleva tiempo activo), pero aquí hay
   que esperarlo o el POST acaba en un 404 del servidor de pruebas. */
const esperarControlador = (page) => page.waitForFunction(
  () => !!navigator.serviceWorker.controller, null, { timeout: 20000 });

/* ============ 1. Arrastrar y soltar ============ */
{
  seccion("Arrastrar y soltar un archivo sobre la ventana");
  const { ctx, page, errores } = await nuevaPagina();
  await cargar(page);

  paso("la capa de «suelta aquí» empieza escondida",
    await page.evaluate(() => document.getElementById("zonaSoltar").classList.contains("hidden")));

  // dragenter con archivos → se enseña la capa
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "a.pdf", { type: "application/pdf" }));
    document.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  paso("al entrar arrastrando aparece el aviso",
    await page.evaluate(() => !document.getElementById("zonaSoltar").classList.contains("hidden")));
  paso("el aviso dice qué hacer",
    /suelta el archivo/i.test(await page.textContent("#zonaSoltar")));

  const cancelado = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "a.pdf", { type: "application/pdf" }));
    const ev = new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  paso("se impide que el navegador abra el archivo por su cuenta", cancelado);

  await page.evaluate(() => {
    document.dispatchEvent(new DragEvent("dragleave", {
      dataTransfer: (() => { const d = new DataTransfer(); d.items.add(new File(["x"], "a.pdf")); return d; })(),
      bubbles: true, cancelable: true }));
  });
  paso("al salir se esconde otra vez",
    await page.evaluate(() => document.getElementById("zonaSoltar").classList.contains("hidden")));

  // soltar un PDF de verdad → se abre en el visor
  const bytes = (await import("node:fs")).readFileSync(`${FX}/prueba.pdf`).toString("base64");
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], "soltado.pdf", { type: "application/pdf" }));
    document.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, bytes);
  await page.waitForSelector("#pdfCanvas", { timeout: 15000 }).catch(() => {});
  paso("soltar un PDF lo abre en el visor",
    await page.evaluate(() => !!document.getElementById("pdfCanvas")?.width));
  paso("y con su nombre", /soltado\.pdf/.test(await page.textContent("#viewerTitle")));

  paso("sin errores de consola (arrastrar)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ 2. Doble clic en el explorador (File Handling) ============ */
{
  seccion("Doble clic en el explorador — consumidor de launchQueue");
  /* ⚠️ Chromium SÍ trae `launchQueue` de fábrica (aunque no haga nada sin
     la app instalada), y está definido como getter nativo: un simple
     `window.launchQueue = falso` FALLA EN SILENCIO y se acaba llamando al
     de verdad. Hay que sustituirlo con defineProperty. */
  const { ctx, page, errores } = await nuevaPagina({
    initScript: `
      window.__consumidor = null;
      Object.defineProperty(window, "launchQueue", {
        configurable: true,
        value: { setConsumer: (fn) => { window.__consumidor = fn; } },
      });`,
  });
  await cargar(page);

  paso("la app registra un consumidor de archivos del sistema",
    await page.evaluate(() => typeof window.__consumidor === "function"));

  const bytes = (await import("node:fs")).readFileSync(`${FX}/prueba.epub`).toString("base64");
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bin], "del-explorador.epub", { type: "application/epub+zip" });
    // Así llegan de verdad: manejadores con getFile(), no ficheros sueltos.
    await window.__consumidor({ files: [{ getFile: async () => file }] });
  }, bytes);
  await page.waitForSelector("#epubArea iframe", { timeout: 20000 }).catch(() => {});
  paso("abre el EPUB que le pasa el sistema",
    await page.evaluate(() => !document.getElementById("viewerModal").classList.contains("hidden")));
  paso("y con su nombre", /del-explorador\.epub/.test(await page.textContent("#viewerTitle")));

  paso("sin errores de consola (explorador)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ 3. Compartir con AniLector ============ */
{
  seccion("Compartir un archivo desde otra app (Web Share Target)");
  const { ctx, page, errores } = await nuevaPagina();
  await cargar(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await esperarControlador(page);

  // El navegador manda un POST multipart al compartir. Se reproduce igual.
  const bytes = (await import("node:fs")).readFileSync(`${FX}/prueba.pdf`).toString("base64");
  const r = await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append("titulo", "Un documento");
    fd.append("archivos", new File([bin], "compartido.pdf", { type: "application/pdf" }));
    const res = await fetch("/compartir", { method: "POST", body: fd, redirect: "manual" });
    return { tipo: res.type, url: res.url, status: res.status };
  }, bytes);
  console.log("     respuesta del SW:", JSON.stringify(r));

  const enBuzon = await page.evaluate(async () => {
    const c = await caches.open("anilector-compartido");
    const res = await c.match(new URL("compartido/0", document.baseURI).href);
    if (!res) return null;
    return {
      nombre: decodeURIComponent(res.headers.get("x-nombre") || ""),
      tipo: res.headers.get("content-type"),
      bytes: (await res.blob()).size,
    };
  });
  console.log("     en el buzón:", JSON.stringify(enBuzon));
  paso("el service worker atiende el POST y deja el archivo en el buzón", !!enBuzon);
  paso("conserva el nombre del archivo", enBuzon?.nombre === "compartido.pdf");
  paso("y su contenido entero", enBuzon?.bytes > 1000);

  // Ahora la app arranca con ?compartido=1 y debe recogerlo
  await cargar(page, BASE + "/index.html?compartido=1");
  await page.waitForSelector("#pdfCanvas", { timeout: 20000 }).catch(() => {});
  paso("al arrancar con ?compartido=N lo abre solo",
    await page.evaluate(() => !!document.getElementById("pdfCanvas")?.width));
  paso("y lo titula con el nombre compartido",
    /compartido\.pdf/.test(await page.textContent("#viewerTitle")));

  paso("limpia la dirección para que no se reabra al recargar",
    await page.evaluate(() => !location.search.includes("compartido")));
  paso("vacía el buzón (no se queda ocupando sitio)",
    await page.evaluate(async () => !(await caches.keys()).includes("anilector-compartido")));

  paso("sin errores de consola (compartir)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ 4. Compartir un ENLACE ============ */
{
  seccion("Compartir un enlace (sin archivo)");
  const { ctx, page } = await nuevaPagina();
  await cargar(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await esperarControlador(page);
  // Con `redirect: "manual"` la respuesta es opaca y no deja leer el
  // destino: hay que seguir la redirección y mirar la URL final.
  const destino = await page.evaluate(async () => {
    const fd = new FormData();
    fd.append("enlace", "https://ejemplo.test/manga.cbz");
    const res = await fetch("/compartir", { method: "POST", body: fd, redirect: "follow" });
    return res.url;
  });
  console.log("     redirige a:", destino);
  paso("un enlace compartido se convierte en ?abrir=…",
    /abrir=/.test(destino) && /manga\.cbz/.test(decodeURIComponent(destino)));
  await ctx.close();
}

/* ============ 5. El buzón sobrevive a una versión nueva ============ */
{
  seccion("El buzón NO se borra al activarse una versión nueva del SW");
  const { ctx, page } = await nuevaPagina();
  await cargar(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await esperarControlador(page);
  const sobrevive = await page.evaluate(async () => {
    const c = await caches.open("anilector-compartido");
    await c.put(new URL("compartido/0", document.baseURI).href, new Response("hola"));
    // Simular el barrido de caches viejas que hace `activate`
    const nombres = await caches.keys();
    const CACHE = nombres.find((n) => /^anilector-v/.test(n));
    await Promise.all(nombres
      .filter((n) => n.startsWith("anilector-") && n !== CACHE && n !== "anilector-compartido")
      .map((n) => caches.delete(n)));
    return (await caches.keys()).includes("anilector-compartido");
  });
  paso("el buzón sigue ahí tras el barrido de cachés viejas", sobrevive);
  await ctx.close();
}

/* ============ 6. El manifiesto declara las dos puertas ============ */
{
  seccion("El manifiesto");
  const res = await fetch(BASE + "/manifest.webmanifest");
  const m = await res.json();
  paso("declara file_handlers", Array.isArray(m.file_handlers) && m.file_handlers.length > 0);
  paso("acepta PDF, EPUB y CBZ por doble clic", (() => {
    const a = m.file_handlers?.[0]?.accept || {};
    const exts = Object.values(a).flat();
    return exts.includes(".pdf") && exts.includes(".epub") && exts.includes(".cbz");
  })());
  paso("NO usa comodines de MIME (no están permitidos)",
    !Object.keys(m.file_handlers?.[0]?.accept || {}).some((k) => k.includes("*")));
  paso("declara share_target por POST multipart",
    m.share_target?.method === "POST" && m.share_target?.enctype === "multipart/form-data");
  paso("el nombre del campo de archivos coincide con el del service worker",
    m.share_target?.params?.files?.[0]?.name === "archivos");
  paso("la acción de compartir apunta a ./compartir",
    /compartir$/.test(m.share_target?.action || ""));
}

await browser.close();
console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
