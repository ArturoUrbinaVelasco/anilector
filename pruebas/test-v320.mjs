/* v3.20 — buscar dentro del documento, marcadores y «seguir leyendo».

   Lo que se comprueba:
     · Buscar en PDF: encuentra, dice cuántos, salta a la página y marca
       el hallazgo sobre el dibujo. Sin tildes ni mayúsculas.
     · Un PDF SIN texto (un escaneo) se distingue de «no aparece».
     · Buscar en EPUB por capítulos, y en los modos de texto con
       resaltado en la página.
     · En cómics se dice que no hay texto que buscar.
     · Marcadores: poner, ir, escribir nota, borrar; con la huella del
       documento, y presentes en el respaldo y en la sincronización.
     · «Seguir leyendo»: sale lo empezado, con lo más reciente primero,
       y distingue lo guardado en la app de lo que no. */
import { chromium } from "./entorno.mjs";

const BASE = "http://localhost:8765";
let ok = 0, mal = 0;
const paso = (n, c) => { c ? (ok++, console.log("  ✅", n)) : (mal++, console.log("  ❌", n)); };
const seccion = (s) => console.log(`\n— ${s} —`);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
async function nuevaPagina() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
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
  await page.goto(BASE + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.pdfjsLib, null, { timeout: 15000 }).catch(() => {});
  return { ctx, page, errores };
}
const traer = async (ruta) => Buffer.from(await (await fetch(`${BASE}/${ruta}`)).arrayBuffer());
const abrir = (page, buf, nombre, tipo = "application/pdf") =>
  page.setInputFiles("#fileInput", { name: nombre, mimeType: tipo, buffer: buf });

/* Los botones del visor ALTERNAN su panel: hay que abrirlo solo si está
   cerrado, o el segundo clic lo esconde. */
async function abrirPanel(page, boton, panel) {
  const abierto = await page.evaluate((id) =>
    !document.getElementById(id).classList.contains("hidden"), panel);
  if (!abierto) await page.click(boton);
  await esperar(400);
}

async function buscarEn(page, texto) {
  // El botón ALTERNA el panel: si ya está abierto, volver a pulsarlo lo
  // cerraría. Se abre solo cuando hace falta.
  const abierto = await page.evaluate(() =>
    !document.getElementById("vBuscaPanel").classList.contains("hidden"));
  if (!abierto) await page.click("#vBusca");
  await page.waitForSelector("#vBuscaInput", { timeout: 5000 });
  await page.fill("#vBuscaInput", texto);
  await page.click("#vBuscaIr");
  await page.waitForFunction(
    () => !/Buscando/i.test(document.getElementById("vBuscaEstado")?.textContent || ""),
    null, { timeout: 30000 });
  return {
    estado: (await page.textContent("#vBuscaEstado")).trim(),
    items: await page.$$eval(".busca-item", (n) => n.map((x) => x.textContent.replace(/\s+/g, " ").trim())),
  };
}

/* ============ Buscar en un PDF ============ */
{
  seccion("Buscar dentro de un PDF");
  const { ctx, page, errores } = await nuevaPagina();
  const pdf = await traer("fx/buscable.pdf");
  await abrir(page, pdf, "buscable.pdf");
  await page.waitForSelector("#viewerModal:not(.hidden)", { timeout: 15000 });
  await esperar(1500);

  paso("el botón de buscar aparece en PDF",
    await page.evaluate(() => document.getElementById("vBusca").style.display !== "none"));

  let r = await buscarEn(page, "murcielago");
  console.log("     estado:", r.estado, "| primeros:", JSON.stringify(r.items.slice(0, 2)));
  paso("encuentra sin necesidad de escribir las tildes", /\d+ resultados/.test(r.estado));
  paso("y enseña en qué página está cada uno", r.items.some((x) => /gina \d/i.test(x)));
  paso("con el texto de alrededor para reconocerlo", r.items.some((x) => x.length > 20));

  // Saltar a un resultado que NO esté en la página actual
  const antes = await page.textContent("#vPageInfo");
  await page.click(".busca-item:last-child");
  await esperar(1200);
  const despues = await page.textContent("#vPageInfo");
  console.log(`     ${antes.trim()} → ${despues.trim()}`);
  paso("pulsar un resultado salta a su página", antes.trim() !== despues.trim());

  // El recuadro amarillo sobre el dibujo: se compara el canvas con y sin marca
  const pintado = await page.evaluate(() => {
    const c = document.getElementById("pdfCanvas");
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let amarillos = 0;
    for (let i = 0; i < d.length; i += 4) {
      // amarillo translúcido sobre blanco: mucho rojo y verde, poco azul
      if (d[i] > 200 && d[i + 1] > 180 && d[i + 2] < 170) amarillos++;
    }
    return amarillos;
  });
  console.log("     píxeles marcados:", pintado);
  paso("y lo encontrado queda marcado sobre el dibujo", pintado > 50);

  // Una búsqueda que no está
  r = await buscarEn(page, "hipopotamo");
  paso("lo que no está se dice claramente", /No aparece/i.test(r.estado));
  // Demasiado corta
  r = await buscarEn(page, "a");
  paso("con una sola letra pide más", /dos letras/i.test(r.estado));

  paso("sin errores de consola (pdf)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Un PDF escaneado ============ */
{
  seccion("Un PDF escaneado — se dice que no hay texto, no «no aparece»");
  const { ctx, page, errores } = await nuevaPagina();
  await abrir(page, await traer("fx/escaneado.pdf"), "escaneado.pdf");
  await page.waitForSelector("#viewerModal:not(.hidden)", { timeout: 15000 });
  await esperar(1500);
  const r = await buscarEn(page, "loquesea");
  console.log("     estado:", r.estado);
  paso("distingue un escaneo de una palabra que no está", /escaneo/i.test(r.estado));
  paso("y no dice «no aparece», que haría pensar otra cosa", !/No aparece/i.test(r.estado));
  paso("sin errores de consola (escaneado)", errores.length === 0);
  await ctx.close();
}

/* ============ Buscar en un EPUB ============ */
{
  seccion("Buscar dentro de un EPUB");
  const { ctx, page, errores } = await nuevaPagina();
  await abrir(page, await traer("fx/grande.epub"), "grande.epub", "application/epub+zip");
  await page.waitForSelector("#epubArea iframe", { timeout: 20000 });
  await esperar(1200);
  const r = await buscarEn(page, "capitulo");
  console.log("     estado:", r.estado, "| primeros:", JSON.stringify(r.items.slice(0, 2)));
  paso("encuentra a lo largo del libro", /\d+ resultados/.test(r.estado));
  paso("y dice en qué capítulo", r.items.length > 0 && r.items[0].length > 3);

  await page.click(".busca-item:last-child");
  await esperar(2000);
  paso("saltar a un resultado no rompe nada",
    await page.evaluate(() => !!document.querySelector("#epubArea iframe")));
  paso("sin errores de consola (epub)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Buscar en texto plano ============ */
{
  seccion("Buscar en un documento de texto — con resaltado en la página");
  const { ctx, page, errores } = await nuevaPagina();
  const txt = Buffer.from(
    "Primera linea del documento.\n".repeat(20) +
    "Aquí aparece la palabra ornitorrinco una vez.\n" +
    "Segunda parte del documento.\n".repeat(20), "utf8");
  await abrir(page, txt, "notas.txt", "text/plain");
  await page.waitForSelector("#viewerModal:not(.hidden)", { timeout: 15000 });
  await esperar(1200);

  const r = await buscarEn(page, "ornitorrinco");
  console.log("     estado:", r.estado);
  paso("encuentra en el texto", /1 resultados|\d+ resultados/.test(r.estado));

  await page.click(".busca-item");
  await esperar(800);
  const marcado = await page.evaluate(() => {
    const m = document.querySelector("mark.busca-hit");
    return m ? m.textContent : null;
  });
  console.log("     resaltado:", JSON.stringify(marcado));
  paso("y lo resalta en el propio documento", /ornitorrinco/i.test(marcado || ""));
  paso("sin errores de consola (texto)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Un cómic no tiene texto ============ */
{
  seccion("En un cómic no se ofrece buscar");
  const { ctx, page } = await nuevaPagina();
  await abrir(page, await traer("fx/comic.cbz"), "comic.cbz", "application/zip");
  await page.waitForSelector("#viewerModal:not(.hidden)", { timeout: 20000 });
  await esperar(1800);
  paso("el botón de buscar no se ofrece",
    await page.evaluate(() => document.getElementById("vBusca").style.display === "none"));
  paso("pero el de marcadores sí (una página se puede marcar)",
    await page.evaluate(() => document.getElementById("vMarcas").style.display !== "none"));
  await ctx.close();
}

/* ============ Marcadores ============ */
{
  seccion("Marcadores con nota");
  const { ctx, page, errores } = await nuevaPagina();
  await abrir(page, await traer("fx/buscable.pdf"), "buscable.pdf");
  await page.waitForSelector("#viewerModal:not(.hidden)", { timeout: 15000 });
  await esperar(1500);

  // Ir a la página 3 y marcarla
  await page.click("#vNext"); await esperar(500);
  await page.click("#vNext"); await esperar(700);
  const pagMarcada = (await page.textContent("#vPageInfo")).trim();
  await abrirPanel(page, "#vMarcas", "vMarcasPanel");
  await page.waitForSelector("#vMarcaNueva", { timeout: 5000 });
  await page.click("#vMarcaNueva");
  await esperar(500);

  const marcas = await page.$$eval(".marca", (n) => n.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  console.log("     marcas:", JSON.stringify(marcas));
  paso("se pone la marca donde estás", marcas.length === 1 && marcas[0].includes("3"));
  paso("el botón enseña cuántas hay", /🔖1/.test(await page.textContent("#vMarcas")));

  // Escribir una nota
  await page.click("[data-nota]");
  await page.waitForSelector(".marca-input", { timeout: 5000 });
  await page.fill(".marca-input", "aquí empieza lo bueno");
  await page.press(".marca-input", "Enter");
  await esperar(500);
  paso("se le puede escribir una nota",
    /aquí empieza lo bueno/.test(await page.textContent("#vMarcasPanel")));

  // Volver a la página 1 y usar la marca para regresar
  await page.click("#vPrev"); await esperar(400);
  await page.click("#vPrev"); await esperar(600);
  await abrirPanel(page, "#vMarcas", "vMarcasPanel");
  await page.click("[data-ir]");
  await esperar(900);
  paso("pulsar la marca vuelve a su sitio",
    (await page.textContent("#vPageInfo")).trim() === pagMarcada);

  // Se guarda bajo la huella del documento
  const guardadas = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("anilector.marcas") || "{}"));
  const claves = Object.keys(guardadas);
  console.log("     clave:", JSON.stringify(claves));
  paso("se guardan bajo la huella del documento",
    claves.length === 1 && claves[0].startsWith("doc:"));
  paso("con su nota y su posición",
    guardadas[claves[0]][0].nota === "aquí empieza lo bueno" &&
    guardadas[claves[0]][0].pos.modo === "pdf");

  // Borrar
  await abrirPanel(page, "#vMarcas", "vMarcasPanel");
  await page.click("[data-del]");
  await esperar(500);
  paso("y se pueden quitar",
    (await page.evaluate(() => Object.keys(
      JSON.parse(localStorage.getItem("anilector.marcas") || "{}")).length)) === 0);

  paso("sin errores de consola (marcas)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Las marcas son datos que hay que conservar ============ */
{
  seccion("Las marcas viajan con tus datos");
  const pwa = await (await fetch(`${BASE}/js/pwa.js`)).text();
  const auth = await (await fetch(`${BASE}/js/auth.js`)).text();
  paso("entran en la copia de seguridad", /anilector\.marcas/.test(pwa));
  paso("y se sincronizan con Drive", /anilector\.marcas/.test(auth));
  const media = await (await fetch(`${BASE}/js/media.js`)).text();
  paso("y la clave del servidor sigue SIN entrar en ninguna de las dos",
    !/anilector\.server/.test(pwa) && !/anilector\.server/.test(auth) && /credencial/i.test(media));
}

/* ============ Seguir leyendo ============ */
{
  seccion("«Seguir leyendo» — los documentos empezados");
  const { ctx, page, errores } = await nuevaPagina();

  // Un documento abierto de verdad deja su rastro
  await abrir(page, await traer("fx/buscable.pdf"), "informe.pdf");
  await page.waitForSelector("#viewerModal:not(.hidden)", { timeout: 15000 });
  await esperar(1200);
  await page.click("#vNext");
  await esperar(900);
  await page.click('[data-close="viewerModal"]');
  await esperar(600);

  await page.evaluate(() =>
    document.querySelectorAll('.nav-tab[data-view="library"],[data-mview="library"]').forEach((b) => b.click()));
  await esperar(1200);

  const visible = await page.evaluate(() =>
    !document.getElementById("docsSection").classList.contains("hidden"));
  paso("la estantería aparece cuando hay algo empezado", visible);
  const tarjetas = await page.$$eval(".doc-card", (n) => n.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  console.log("     tarjetas:", JSON.stringify(tarjetas));
  paso("con el nombre del archivo", tarjetas.some((x) => /informe\.pdf/.test(x)));
  paso("y por dónde ibas", tarjetas.some((x) => /P(á|a)g\.? 2/i.test(x)));
  paso("marcado como no guardado, que es lo que es",
    await page.evaluate(() => !document.querySelector(".doc-card").dataset.dentro));

  // Al pulsarlo, se explica en vez de no hacer nada
  await page.click(".doc-card");
  await esperar(600);
  const aviso = await page.textContent("#toast");
  console.log("     al pulsar:", aviso.slice(0, 70));
  paso("pulsarlo explica por qué no se puede reabrir solo", /no está guardado/i.test(aviso));

  // Lo más reciente primero
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("anilector.progress") || "{}");
    p["doc:aaa.111"] = { v: { page: 1 }, t: 1, n: "viejisimo.pdf", s: 10 };
    p["doc:bbb.222"] = { v: { page: 9 }, t: Date.now() + 5000, n: "recientisimo.epub", s: 20 };
    localStorage.setItem("anilector.progress", JSON.stringify(p));
  });
  await page.evaluate(() =>
    document.querySelectorAll('.nav-tab[data-view="tv"]').forEach((b) => b.click()));
  await esperar(400);
  await page.evaluate(() =>
    document.querySelectorAll('.nav-tab[data-view="library"],[data-mview="library"]').forEach((b) => b.click()));
  await esperar(1000);
  const orden = await page.$$eval(".doc-card", (n) => n.map((x) => x.title));
  console.log("     orden:", JSON.stringify(orden));
  paso("lo más reciente sale primero", orden[0] === "recientisimo.epub");
  paso("y lo más viejo al final", orden[orden.length - 1] === "viejisimo.pdf");

  // La ✕ tiene que estar DENTRO de la tarjeta: antes se colaba fuera
  // porque era un <button> dentro de otro <button>, que el navegador
  // deshace, y acababa suelta en la fila.
  paso("la ✕ está dentro de su tarjeta",
    (await page.$$eval(".doc-card [data-deldoc]", (n) => n.length)) > 0);
  paso("y no queda ninguna suelta en la fila",
    (await page.$$eval("#docsRow > [data-deldoc]", (n) => n.length)) === 0);

  // Quitar uno de la lista
  const antes = orden.length;
  await page.click(".doc-card [data-deldoc]");
  await esperar(600);
  const ahora = await page.$$eval(".doc-card", (n) => n.length);
  paso("se puede quitar de la lista", ahora === antes - 1);

  paso("sin errores de consola (seguir leyendo)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

await browser.close();
console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
