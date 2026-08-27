/* v3.19 — robustez: que nada falle en silencio, que nada se cuelgue,
   que el almacén no se llene y que abrir un EPUB no cueste 3 segundos.

   Se comprueba:
     · El aviso de errores salta con excepciones y con promesas
       rechazadas, y NO salta con una imagen que no carga.
     · Está EN LÍNEA en el HTML, antes de los módulos: si estuviera en
       un módulo no cazaría un módulo que no carga, que es el caso malo.
     · red.js: se planta al pasarse de tiempo, reintenta en 429/5xx y
       NO reintenta un 404.
     · El progreso se poda a 400 y conserva lo más reciente.
     · Dos documentos distintos con el MISMO nombre ya no comparten el
       punto de lectura, y el progreso viejo por título se migra.
     · El índice de posiciones del EPUB se guarda y se reutiliza.
     · La app dice la verdad sobre estar lista sin conexión.
     · El panel enseña el espacio ocupado. */
import { chromium } from "./entorno.mjs";

const BASE = "http://localhost:8765";
let ok = 0, mal = 0;
const paso = (n, c) => { c ? (ok++, console.log("  ✅", n)) : (mal++, console.log("  ❌", n)); };
const seccion = (s) => console.log(`\n— ${s} —`);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
async function nuevaPagina({ recogerErrores = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const page = await ctx.newPage();
  const errores = [];
  if (recogerErrores) {
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const x = m.text();
      if (/cdnjs|jikan|anilist|googleapis|gstatic|ERR_FAILED|Failed to load resource/i.test(x)) return;
      errores.push(x);
    });
  }
  await page.goto(BASE + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.pdfjsLib, null, { timeout: 15000 }).catch(() => {});
  return { ctx, page, errores };
}
const abrirVisor = (page, archivo, nombre) =>
  page.setInputFiles("#fileInput", { name: nombre, mimeType: "application/pdf",
    buffer: archivo });

/* ============ El aviso de errores ============ */
{
  seccion("Aviso de errores — nada vuelve a fallar en silencio");
  const html = await (await fetch(`${BASE}/index.html`)).text();
  const posAviso = html.indexOf("__anilectorErrores");
  const posModulo = html.indexOf('type="module"');
  paso("la red de seguridad va EN LÍNEA en el HTML", posAviso > 0);
  paso("y antes del primer módulo (si no, no cazaría un módulo que no carga)",
    posAviso > 0 && posAviso < posModulo);

  const { ctx, page } = await nuevaPagina({ recogerErrores: false });

  // 1) una excepción cualquiera
  await page.evaluate(() => setTimeout(() => { throw new Error("fallo de prueba 42"); }, 0));
  await esperar(400);
  let texto = await page.textContent("#avisoError").catch(() => "");
  console.log("     aviso:", texto.replace(/\s+/g, " ").slice(0, 80));
  paso("una excepción hace salir el aviso", /fallo de prueba 42/.test(texto));
  paso("con botón de copiar el detalle", /Copiar detalle/i.test(texto));

  // 2) una promesa rechazada, que es como fallan los módulos de verdad
  // Dentro de un setTimeout y sin devolverla: si se devuelve, Playwright
  // se la traga como error de `evaluate` y nunca llega a ser «no atendida».
  await page.evaluate(() => {
    setTimeout(() => { Promise.reject(new Error("promesa rota 7")); }, 0);
  });
  await esperar(400);
  texto = await page.textContent("#avisoError");
  paso("una promesa rechazada también", /promesa rota 7/.test(texto));
  paso("y se dice cuántos fallos van", /1 más|1 more/.test(texto));

  // 3) el detalle que se copia lleva lo necesario para depurar
  const detalle = await page.evaluate(() => {
    const e = window.__anilectorErrores;
    return { cuantos: e.length, tienePila: !!e[0].detalle, tieneCuando: !!e[0].cuando };
  });
  paso("se guarda la pila de llamadas", detalle.tienePila);
  paso("y la hora de cada uno", detalle.tieneCuando);

  // 4) cerrar
  await page.click('#avisoError button[data-a="cerrar"]');
  await esperar(200);
  paso("se puede cerrar", (await page.$("#avisoError")) === null);

  // 5) una imagen rota NO es una excepción: no debe asustar
  await page.evaluate(() => {
    const img = document.createElement("img");
    img.src = "/no-existe-esta-imagen.png";
    document.body.appendChild(img);
  });
  await esperar(600);
  paso("una imagen que no carga NO dispara el aviso", (await page.$("#avisoError")) === null);

  // 6) no crece sin límite
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) setTimeout(() => { throw new Error("ruido " + i); }, 0);
  });
  await esperar(700);
  const cuantos = await page.evaluate(() => window.__anilectorErrores.length);
  console.log("     errores guardados tras 40:", cuantos);
  paso("la lista de errores tiene tope", cuantos <= 20);
  await ctx.close();
}

/* ============ red.js ============ */
{
  seccion("Peticiones — límite de tiempo y reintentos");
  const { ctx, page } = await nuevaPagina();

  // Un servidor que acepta y no contesta: el caso que dejaba el
  // indicador girando para siempre.
  await page.route(/nunca-contesta\.example/, () => { /* jamás se resuelve */ });
  const plantón = await page.evaluate(async () => {
    const { pedir } = await import("/js/red.js");
    const t0 = Date.now();
    try {
      await pedir("https://nunca-contesta.example/x", { limite: 1200, reintentos: 0 });
      return { error: null };
    } catch (e) { return { error: e.message, agotado: e.agotado, ms: Date.now() - t0 }; }
  });
  console.log("     plantón:", JSON.stringify(plantón));
  paso("se planta en vez de esperar para siempre", plantón.agotado === true);
  paso("y tarda lo que se le dijo, no más", plantón.ms >= 1100 && plantón.ms < 3000);
  paso("con un mensaje que dice qué pasó, no «Failed to fetch»",
    /no contestó en/i.test(plantón.error) && !/failed to fetch/i.test(plantón.error));

  // 429 → reintenta y a la segunda va
  let veces429 = 0;
  await page.route(/limitado\.example/, (r) => {
    veces429++;
    if (veces429 === 1) return r.fulfill({ status: 429, body: "" });
    return r.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  const tras429 = await page.evaluate(async () => {
    const { pedirJson } = await import("/js/red.js");
    return pedirJson("https://limitado.example/x").catch((e) => ({ error: e.message }));
  });
  console.log(`     429 → intentos: ${veces429}, resultado:`, JSON.stringify(tras429));
  paso("un 429 se reintenta y a la segunda funciona", tras429?.ok === true && veces429 === 2);

  // 404 → NO se reintenta: repetirlo da lo mismo
  let veces404 = 0;
  await page.route(/no-existe\.example/, (r) => { veces404++; r.fulfill({ status: 404, body: "" }); });
  const tras404 = await page.evaluate(async () => {
    const { pedir } = await import("/js/red.js");
    return pedir("https://no-existe.example/x").then(() => null, (e) => ({ estado: e.estado }));
  });
  console.log(`     404 → intentos: ${veces404}`);
  paso("un 404 no se reintenta", veces404 === 1 && tras404.estado === 404);

  // Los módulos que no lo tenían, ahora lo usan
  for (const f of ["js/media.js", "js/vod.js", "js/tv.js"]) {
    const txt = await (await fetch(`${BASE}/${f}`)).text();
    paso(`${f} ya no usa fetch a pelo`, /from "\.\/red\.js"/.test(txt) && !/await fetch\(/.test(txt));
  }
  await ctx.close();
}

/* ============ Poda del progreso ============ */
{
  seccion("El progreso ya no crece sin límite");
  const { ctx, page, errores } = await nuevaPagina();
  const pdf = await (await fetch(`${BASE}/fx/prueba.pdf`)).arrayBuffer();

  // 500 entradas viejas, como quien lleva años usando la app
  await page.evaluate(() => {
    const p = {};
    for (let i = 0; i < 500; i++) p[`viejo:${i}`] = { v: { page: i }, t: 1000 + i };
    localStorage.setItem("anilector.progress", JSON.stringify(p));
  });
  const antes = await page.evaluate(() =>
    localStorage.getItem("anilector.progress").length);

  await abrirVisor(page, Buffer.from(pdf), "para-podar.pdf");
  await page.waitForSelector("#viewerModal:not(.hidden)", { timeout: 15000 });
  await esperar(1500);
  // Pasar de página fuerza a guardar
  await page.click("#vNext").catch(() => {});
  await esperar(900);

  const tras = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("anilector.progress") || "{}");
    const claves = Object.keys(p);
    return {
      cuantas: claves.length,
      bytes: localStorage.getItem("anilector.progress").length,
      conservaReciente: !!p["viejo:499"],
      tiraViejo: !p["viejo:0"],
      hayNueva: claves.some((k) => k.startsWith("doc:")),
    };
  });
  console.log(`     ${antes} bytes → ${tras.bytes} bytes · ${tras.cuantas} entradas`);
  paso("se poda al tope de 400", tras.cuantas <= 400);
  paso("conserva lo más reciente", tras.conservaReciente);
  paso("y tira lo más viejo", tras.tiraViejo);
  paso("la entrada nueva entra con huella de contenido", tras.hayNueva);
  paso("sin errores de consola (poda)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Dos archivos distintos con el mismo nombre ============ */
{
  seccion("El punto de lectura ya no se confunde entre archivos");
  const { ctx, page, errores } = await nuevaPagina();
  const uno = Buffer.from(await (await fetch(`${BASE}/fx/prueba.pdf`)).arrayBuffer());
  const otro = Buffer.from(await (await fetch(`${BASE}/fx/otro.pdf`)).arrayBuffer());

  await abrirVisor(page, uno, "Documento1.pdf");
  await page.waitForSelector("#viewerModal:not(.hidden)", { timeout: 15000 });
  await esperar(1200);
  const clave1 = await page.evaluate(() => Object.keys(
    JSON.parse(localStorage.getItem("anilector.progress") || "{}")));
  await page.click('[data-close="viewerModal"]');
  await esperar(500);

  await abrirVisor(page, otro, "Documento1.pdf");   // MISMO nombre, otro archivo
  await page.waitForSelector("#viewerModal:not(.hidden)", { timeout: 15000 });
  await esperar(1200);
  const claves = await page.evaluate(() => Object.keys(
    JSON.parse(localStorage.getItem("anilector.progress") || "{}")));
  console.log("     claves:", JSON.stringify(claves));
  paso("dos archivos distintos con el mismo nombre dan claves distintas",
    claves.length === 2 && new Set(claves).size === 2);
  paso("y ninguna es el título a secas", !claves.some((k) => /^pdf:Documento1/.test(k)));
  paso("sin errores de consola (huellas)", errores.length === 0);
  await ctx.close();
}

/* ============ Migración del progreso viejo ============ */
{
  seccion("Quien ya tenía progreso guardado no lo pierde");
  const { ctx, page } = await nuevaPagina();
  const uno = Buffer.from(await (await fetch(`${BASE}/fx/prueba.pdf`)).arrayBuffer());

  // Como lo guardaban las versiones anteriores: por título y sin fecha.
  await page.evaluate(() => localStorage.setItem("anilector.progress",
    JSON.stringify({ "pdf:ViejoConocido.pdf": { page: 3 } })));

  await abrirVisor(page, uno, "ViejoConocido.pdf");
  await page.waitForSelector("#viewerModal:not(.hidden)", { timeout: 15000 });
  await esperar(1600);

  const r = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("anilector.progress") || "{}");
    const nueva = Object.keys(p).find((k) => k.startsWith("doc:"));
    return {
      quedaVieja: "pdf:ViejoConocido.pdf" in p,
      nueva,
      pagina: nueva ? (p[nueva].v ?? p[nueva]).page : null,
    };
  });
  console.log("     migración:", JSON.stringify(r));
  paso("el progreso pasa a la clave nueva", !!r.nueva);
  paso("conservando la página en la que iba", r.pagina === 3);
  paso("y la entrada vieja se limpia", !r.quedaVieja);
  await ctx.close();
}

/* ============ Índice del EPUB ============ */
{
  seccion("Abrir un EPUB dos veces ya no cuesta lo mismo");
  const { ctx, page, errores } = await nuevaPagina();
  const epub = Buffer.from(await (await fetch(`${BASE}/fx/grande.epub`)).arrayBuffer());
  const abrirEpub = () => page.setInputFiles("#fileInput",
    { name: "grande.epub", mimeType: "application/epub+zip", buffer: epub });

  const conPorcentaje = () => page.waitForFunction(
    () => /\d+%/.test(document.getElementById("vPageInfo")?.textContent || ""),
    null, { timeout: 25000 });

  let t0 = Date.now();
  await abrirEpub();
  await page.waitForSelector("#viewerModal:not(.hidden)", { timeout: 20000 });
  await conPorcentaje();
  const primera = Date.now() - t0;

  const guardado = await page.evaluate(async () => {
    const d = await new Promise((res, rej) => {
      const p = indexedDB.open("anilector-docs");
      p.onsuccess = () => res(p.result); p.onerror = () => rej(p.error);
    });
    if (!d.objectStoreNames.contains("epubloc")) return { hay: false };
    const tx = d.transaction(["epubloc"], "readonly");
    const n = await new Promise((res) => {
      const q = tx.objectStore("epubloc").count();
      q.onsuccess = () => res(q.result);
    });
    return { hay: true, n };
  });
  console.log(`     primera apertura: ${primera} ms · índices guardados: ${guardado.n}`);
  paso("el índice se guarda en IndexedDB", guardado.hay && guardado.n === 1);

  await page.click('[data-close="viewerModal"]');
  // Esperar a que el visor cierre de verdad Y a que el indicador se
  // limpie: si no, el «%» del libro anterior daría un tiempo falso.
  // waitForSelector espera a que sea VISIBLE, y aquí se espera lo
  // contrario: hay que mirar la clase a mano.
  await page.waitForFunction(
    () => document.getElementById("viewerModal")?.classList.contains("hidden"),
    null, { timeout: 10000 });
  await page.waitForFunction(
    () => !/\d+%/.test(document.getElementById("vPageInfo")?.textContent || ""),
    null, { timeout: 10000 });
  await esperar(300);
  t0 = Date.now();
  await abrirEpub();
  await page.waitForSelector("#viewerModal:not(.hidden)", { timeout: 20000 });
  await conPorcentaje();
  const segunda = Date.now() - t0;
  console.log(`     segunda apertura: ${segunda} ms (antes: ${primera} ms)`);
  paso("la segunda vez el porcentaje llega antes", segunda < primera);
  paso("y no se guarda un índice duplicado", (await page.evaluate(async () => {
    const d = await new Promise((res) => {
      const p = indexedDB.open("anilector-docs"); p.onsuccess = () => res(p.result);
    });
    const tx = d.transaction(["epubloc"], "readonly");
    return new Promise((res) => {
      const q = tx.objectStore("epubloc").count();
      q.onsuccess = () => res(q.result);
    });
  })) === 1);
  paso("sin errores de consola (epub)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Sin conexión: la verdad ============ */
{
  seccion("La app dice la verdad sobre funcionar sin conexión");
  const sw = await (await fetch(`${BASE}/sw.js`)).text();
  paso("el service worker apunta lo que NO pudo guardar", /fallidos/.test(sw));
  paso("lo reintenta al activarse", /guardarShell\(cache, faltan\)/.test(sw));
  paso("y sabe contestar cuando se le pregunta", /estado-cache/.test(sw));

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 })
    .catch(() => {});
  await page.click("#brandBtn");
  await esperar(1500);
  const fila = await page.textContent("#offlineRow").catch(() => "");
  console.log("     estado:", fila.replace(/\s+/g, " ").slice(0, 70));
  paso("el panel dice si está lista y con cuántos archivos",
    /Listo para funcionar sin conexión/.test(fila) && /\d+/.test(fila));
  await ctx.close();
}

/* ============ Espacio ocupado ============ */
{
  seccion("Cuánto sitio ocupa esto");
  const { ctx, page } = await nuevaPagina();
  await page.evaluate(() => {
    const p = {};
    for (let i = 0; i < 200; i++) p[`x:${i}`] = { v: { page: i }, t: Date.now() };
    localStorage.setItem("anilector.progress", JSON.stringify(p));
  });
  await page.click("#brandBtn");
  await esperar(900);
  const texto = await page.textContent("#espacioRow");
  console.log("     espacio:", texto.replace(/\s+/g, " ").slice(0, 90));
  paso("se enseña lo que ocupan tus datos", /Tus datos/.test(texto));
  paso("con una cifra de verdad", /\d+([.,]\d+)?\s?(B|KB|MB|GB)/i.test(texto));
  paso("y el total del navegador si lo sabe", /Total en este navegador/.test(texto));
  await ctx.close();
}

await browser.close();
console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
