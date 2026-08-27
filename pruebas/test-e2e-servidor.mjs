/* Validación de extremo a extremo de «Mi servidor».
   ------------------------------------------------------------
   Las suites anteriores simulan las respuestas con `page.route`,
   que no pasa por la red: no prueba CORS ni preflight de verdad.
   Aquí se levanta el «Jellyfin de pruebas» como un servidor HTTP
   real en otro puerto y el navegador habla con él de verdad, con
   su origen distinto y sus preflight. Es lo más parecido a su
   Jellyfin que se puede montar sin tenerlo. */
import { chromium } from "./entorno.mjs";
import { spawn } from "node:child_process";

const APP = "http://localhost:8765";
const JELLY = "http://localhost:8096";
let ok = 0, mal = 0;
const paso = (n, c) => { c ? (ok++, console.log("  ✅", n)) : (mal++, console.log("  ❌", n)); };
const seccion = (s) => console.log(`\n— ${s} —`);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let jelly = null;
const GUION = new URL("../pruebas-servidor/jellyfin-de-pruebas.mjs", import.meta.url).pathname;

async function levantar(averias = []) {
  await parar();
  /* ⚠️ El PUERTO se pasa EXPLÍCITO. El servidor de pruebas lee `PORT`, y
     como aquí se hereda el entorno, si quien lanza las pruebas tiene
     PORT=8765 (el de la app) el falso Jellyfin intentaba levantarse en
     ese mismo puerto, moría, y el fallo aparecía mucho después como
     «element is not visible». */
  jelly = spawn("node", [GUION, ...averias],
    { env: { ...process.env, SILENCIO: "1", PORT: "8096" }, stdio: "ignore" });
  /* Esperar a que CONTESTE, no un tiempo fijo: si el puerto 8096 está
     ocupado por otra cosa, el servidor no arranca y las pruebas fallaban
     con «element is not visible», que no dice nada del puerto. */
  for (let i = 0; i < 25; i++) {
    try {
      const r = await fetch(`${JELLY}/System/Info/Public`, { signal: AbortSignal.timeout(600) });
      if (r.ok) return;
    } catch (_) { /* aún no */ }
    await esperar(250);
  }
  console.error(`\n  El Jellyfin de pruebas no arrancó en ${JELLY}.` +
    `\n  Lo más probable es que el puerto esté ocupado. Ciérralo y repite.\n`);
  process.exit(1);
}
async function parar() {
  if (!jelly) return;
  jelly.kill("SIGKILL");
  jelly = null;
  await esperar(300);
}

const browser = await chromium.launch();
async function nuevaPagina() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  // Solo se corta lo que sale de la máquina: los dos localhost son reales.
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const page = await ctx.newPage();
  const errores = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const x = m.text();
    if (/cdnjs|jikan|anilist|googleapis|gstatic|ERR_FAILED|Failed to load resource/i.test(x)) return;
    errores.push(x);
  });
  page.on("pageerror", (e) => errores.push("pageerror: " + e.message));
  await page.goto(APP + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.pdfjsLib, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() =>
    document.querySelectorAll('.nav-tab[data-view="server"]').forEach((b) => b.click()));
  await esperar(500);
  return { ctx, page, errores };
}
async function conectar(page, clave = "prueba-123") {
  await page.fill("#srvUrl", JELLY);
  await page.fill("#srvKey", clave);
  await page.click("#srvGuardar");
  await esperar(2500);
}
const pasos = (page) =>
  page.$$eval("#srvPasos li", (n) => n.map((x) => ({
    ok: x.classList.contains("bien"), texto: x.textContent.replace(/\s+/g, " ").trim() })));

/* ============ Servidor sano ============ */
{
  seccion("Servidor real, sin averías");
  await levantar();
  const { ctx, page, errores } = await nuevaPagina();
  await conectar(page);
  const ps = await pasos(page);
  ps.forEach((x) => console.log(`     ${x.ok ? "✓" : "✗"} ${x.texto.slice(0, 96)}`));
  paso("los tres pasos en verde contra un servidor de verdad",
    ps.length === 3 && ps.every((x) => x.ok));
  paso("reconoce el servidor por su nombre y versión", /Servidor de pruebas/.test(ps[0]?.texto || ""));
  paso("usa la cabecera cuando el servidor la acepta", /por cabecera/i.test(ps[1]?.texto || ""));

  const chips = await page.$$eval("#srvLibs .chip", (n) => n.map((x) => x.textContent.trim()));
  console.log("     bibliotecas:", JSON.stringify(chips));
  paso("las bibliotecas de vídeo salen y la de Música no",
    chips.some((c) => /Películas/.test(c)) && !chips.some((c) => /Música/.test(c)));
  paso("la TV en vivo del servidor aparece", chips.some((c) => /TV en vivo/i.test(c)));
  paso("la cuadrícula se llena", (await page.$$eval("#srvGrid .srv-card", (n) => n.length)) === 12);

  // Las portadas vienen del servidor de verdad: si CORS o la clave
  // fallaran, se verían los marcadores de posición.
  const portadas = await page.$$eval("#srvGrid img.card-cover", (n) => n.length);
  const cargadas = await page.$$eval("#srvGrid img.card-cover",
    (n) => n.filter((x) => x.naturalWidth > 0).length);
  console.log(`     portadas: ${cargadas}/${portadas} cargadas de verdad`);
  paso("las portadas se descargan con la clave en la dirección", cargadas > 0);

  await page.fill("#srvSearch", "torre");
  await esperar(900);
  const tras = await page.$$eval("#srvGrid .srv-card .card-title", (n) => n.map((x) => x.textContent.trim()));
  console.log("     buscando «torre»:", JSON.stringify(tras));
  paso("la búsqueda la resuelve el servidor", tras.length === 1 && /torre/i.test(tras[0]));
  await page.fill("#srvSearch", "");
  await esperar(900);

  paso("sin errores de consola (sano)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 4));
  await ctx.close();
}

/* ============ Reproducción de verdad ============ */
{
  seccion("Reproducción — un vídeo real, no un mock");
  /* El Chromium de Playwright se compila SIN H.264 ni AAC (devuelve ""
     en canPlayType y da DEMUXER_ERROR_NO_SUPPORTED_STREAMS), así que el
     servidor de pruebas sirve WebM para esta parte. No es un apaño del
     lado de la app: Chrome y Edge de verdad reproducen los dos, y lo que
     aquí se valida —que el vídeo llega, se decodifica y se puede saltar
     por él— es lo mismo en ambos formatos. */
  await levantar(["--webm"]);
  const { ctx, page, errores } = await nuevaPagina();
  await conectar(page);
  await page.click("#srvGrid .srv-card");
  await esperar(1200);

  paso("se abre el reproductor",
    await page.evaluate(() => !document.getElementById("srvPlayer").classList.contains("hidden")));

  // Sin hls.js (no hay CDN aquí) el navegador no puede con el m3u8 y
  // AniLector cae a la reproducción directa. Se comprueba que la caída
  // funciona: es la vía que usará cualquier archivo ya compatible.
  const v = await page.evaluate(async () => {
    const el = document.getElementById("srvVideo");
    for (let i = 0; i < 30 && el.readyState < 2; i++) await new Promise((r) => setTimeout(r, 300));
    try { await el.play(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 1200));
    return { src: el.currentSrc || el.src, readyState: el.readyState,
      duracion: el.duration, tiempo: el.currentTime, ancho: el.videoWidth };
  });
  console.log("     vídeo:", JSON.stringify(v));
  paso("el vídeo llega a tener datos suficientes para pintarse", v.readyState >= 2);
  paso("y trae imagen de verdad (ancho > 0)", v.ancho > 0);
  paso("con la duración que dice el archivo", v.duracion > 5 && v.duracion < 8);
  paso("y avanza al darle a reproducir", v.tiempo > 0);
  paso("la fuente es tu servidor y nadie más", /^http:\/\/localhost:8096\//.test(v.src));

  // Saltar por el vídeo: sin Range no funcionaría.
  const salto = await page.evaluate(async () => {
    const el = document.getElementById("srvVideo");
    el.currentTime = 4;
    await new Promise((r) => setTimeout(r, 900));
    return el.currentTime;
  });
  console.log("     tras saltar al segundo 4:", salto);
  paso("se puede saltar por el vídeo (el servidor sirve por rangos)", salto > 3);

  paso("sin errores de consola (reproducción)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 4));
  await ctx.close();
}

/* ============ EL FALLO REPORTADO, con preflight real ============ */
{
  seccion("Servidor que permite el origen pero NO la cabecera (preflight real)");
  await levantar(["--sin-cabecera"]);
  const { ctx, page, errores } = await nuevaPagina();
  await conectar(page);
  const ps = await pasos(page);
  ps.forEach((x) => console.log(`     ${x.ok ? "✓" : "✗"} ${x.texto.slice(0, 96)}`));
  paso("conecta igual, con un preflight rechazado de verdad",
    ps.length === 3 && ps.every((x) => x.ok));
  paso("y dice que usó la vía sin cabeceras", /por la dirección/i.test(ps[1]?.texto || ""));
  paso("el catálogo carga", (await page.$$eval("#srvGrid .srv-card", (n) => n.length)) === 12);
  paso("se recuerda la vía en el aparato",
    await page.evaluate(() => JSON.parse(localStorage.getItem("anilector.server") || "{}").modo === "consulta"));
  paso("sin errores de consola (sin cabecera)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 4));
  await ctx.close();
}

/* ============ Vistas vacías ============ */
{
  seccion("Vistas del usuario vacías — la cuarta vía salva el día");
  await levantar(["--vistas-vacias"]);
  const { ctx, page, errores } = await nuevaPagina();
  await conectar(page);
  const ps = await pasos(page);
  ps.forEach((x) => console.log(`     ${x.ok ? "✓" : "✗"} ${x.texto.slice(0, 96)}`));
  paso("encuentra las bibliotecas por otra vía", ps.length === 3 && ps.every((x) => x.ok));
  paso("el catálogo carga", (await page.$$eval("#srvGrid .srv-card", (n) => n.length)) === 12);
  paso("sin errores de consola (vistas vacías)", errores.length === 0);
  await ctx.close();
}

/* ============ No es un Jellyfin ============ */
{
  seccion("Algo que contesta JSON pero no es un servidor de medios");
  await levantar(["--no-soy-jellyfin"]);
  const { ctx, page, errores } = await nuevaPagina();
  await conectar(page);
  const ps = await pasos(page);
  ps.forEach((x) => console.log(`     ${x.ok ? "✓" : "✗"} ${x.texto.slice(0, 130)}`));
  paso("se para en el primer paso", ps.length === 1 && !ps[0].ok);
  paso("dice que eso no parece un Jellyfin ni un Emby", /no parece un Jellyfin/i.test(ps[0].texto));
  paso("y enseña qué contestó", /contestó/i.test(ps[0].texto));
  paso("no guarda nada", await page.evaluate(() => !localStorage.getItem("anilector.server")));
  paso("sin errores de consola (no es Jellyfin)", errores.length === 0);
  await ctx.close();
}

/* ============ Servidor apagado ============ */
{
  seccion("Servidor apagado — mensaje útil, no «Failed to fetch»");
  await parar();
  const { ctx, page } = await nuevaPagina();
  await conectar(page);
  const ps = await pasos(page);
  console.log(`     ${ps[0]?.ok ? "✓" : "✗"} ${(ps[0]?.texto || "").slice(0, 120)}`);
  paso("falla en el primer paso", ps.length === 1 && !ps[0].ok);
  paso("y explica qué mirar, no el error crudo del navegador",
    !/failed to fetch/i.test(ps[0].texto) && /Access-Control-Allow-Origin|no esté accesible/i.test(ps[0].texto));
  await ctx.close();
}

await parar();
await browser.close();
console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
