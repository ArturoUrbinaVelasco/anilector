/* v3.13 — «Mis descargas»: guardar documentos dentro de la app para
   leerlos sin conexión. Lo importante que se comprueba aquí:
     · guardar un PDF/EPUB desde el visor
     · que el estante aparezca, liste y diga cuánto ocupa
     · que SOBREVIVA a recargar la página (es el sentido de todo esto)
     · que se pueda reabrir Y CONSERVE el punto de lectura
     · que se abra ESTANDO SIN CONEXIÓN
     · borrar con confirmación en dos pasos
     · que un cómic de páginas remotas se guarde como CBZ */
import { chromium } from "./entorno.mjs";

const BASE = "http://localhost:8765";
const FX = "/home/claude/lector-otaku/fx";
let ok = 0, mal = 0;
const paso = (n, c) => { c ? (ok++, console.log("  ✅", n)) : (mal++, console.log("  ❌", n)); };
const seccion = (s) => console.log(`\n— ${s} —`);

const browser = await chromium.launch();

async function nuevaPagina(ctxDado) {
  const ctx = ctxDado || await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (!ctxDado) await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
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
  await page.waitForFunction(() => window.pdfjsLib && window.ePub, null, { timeout: 15000 }).catch(() => {});
  return { ctx, page, errores };
}
const irAlVisor = (page) => page.evaluate(() => {
  document.querySelectorAll("[data-view]").forEach((b) => {
    if (b.dataset.view === "reader") b.click();
  });
});

/* ============ Guardar, listar, persistir ============ */
{
  seccion("Guardar un documento en la app");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const { page, errores } = await nuevaPagina(ctx);

  paso("el estante no se enseña cuando no hay nada guardado",
    await page.evaluate(() => document.getElementById("descargasBox").classList.contains("hidden")));

  await page.setInputFiles("#fileInput", `${FX}/grande.epub`);
  await page.waitForSelector("#epubArea iframe", { timeout: 15000 });
  await page.waitForTimeout(700);

  paso("el botón 📥 aparece con un archivo abierto",
    await page.evaluate(() => document.getElementById("vKeep").style.display !== "none"));
  paso("y todavía no está marcado como guardado",
    await page.evaluate(() => !document.getElementById("vKeep").classList.contains("activo")));

  await page.click("#vKeep");
  await page.waitForFunction(() =>
    document.getElementById("vKeep").classList.contains("activo"), null, { timeout: 15000 })
    .catch(() => {});
  paso("tras guardar, el botón queda marcado",
    await page.evaluate(() => document.getElementById("vKeep").classList.contains("activo")));

  const guardado = await page.evaluate(async () => {
    const d = await import("/js/docs.js");
    return (await d.listar()).map((f) => ({ nombre: f.nombre, tamano: f.tamano }));
  });
  paso("el archivo queda en el almacén con su tamaño real",
    guardado.length === 1 && guardado[0].nombre === "grande.epub" && guardado[0].tamano > 1000);

  // Guardar dos veces el mismo archivo no debe duplicarlo
  await page.click("#vKeep");
  await page.waitForTimeout(1200);
  const trasRepetir = await page.evaluate(async () =>
    (await (await import("/js/docs.js")).listar()).length);
  paso("guardar el mismo archivo otra vez NO lo duplica", trasRepetir === 1);

  await page.click('[data-close="viewerModal"]');
  await irAlVisor(page);
  await page.waitForTimeout(400);
  paso("el estante ya se enseña",
    await page.evaluate(() => !document.getElementById("descargasBox").classList.contains("hidden")));
  paso("lista el documento con su nombre",
    /grande\.epub/.test(await page.textContent("#descargasLista")));
  paso("dice cuántos hay y cuánto ocupan",
    /^1 · [\d.,]+ ?(B|KB|MB)/.test((await page.textContent("#descargasEspacio")).trim()));

  paso("sin errores de consola (guardar)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));

  /* ---- sobrevivir a una recarga: es TODO el sentido de esto ---- */
  seccion("Sobrevivir a cerrar y volver (misma sesión del navegador)");
  const p2 = await ctx.newPage();
  await p2.goto(BASE + "/index.html", { waitUntil: "domcontentloaded" });
  await p2.waitForFunction(() => window.ePub, null, { timeout: 15000 }).catch(() => {});
  await irAlVisor(p2);
  await p2.waitForTimeout(700);
  paso("la descarga sigue ahí en una pestaña nueva",
    /grande\.epub/.test(await p2.textContent("#descargasLista")));

  /* ---- reabrir desde el estante, conservando el punto de lectura ---- */
  seccion("Reabrir desde el estante");
  // dejar una marca de lectura primero
  await p2.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("anilector.progress") || "{}");
    p["epub:grande.epub"] = { cfi: "epubcfi(/6/40!/4/2/1:0)" };
    localStorage.setItem("anilector.progress", JSON.stringify(p));
  });
  await p2.click(".dl-open");
  await p2.waitForSelector("#epubArea iframe", { timeout: 20000 });
  await p2.waitForTimeout(1500);
  paso("el documento guardado se abre en el visor",
    await p2.evaluate(() => !document.getElementById("viewerModal").classList.contains("hidden")));
  const etiqueta = (await p2.textContent("#vPageInfo")).trim();
  console.log("     posición al reabrir:", JSON.stringify(etiqueta));
  paso("retoma el punto de lectura guardado (no empieza de cero)",
    !/^c\.1\/30/.test(etiqueta));
  paso("el 📥 sale ya marcado (reconoce que está descargado)",
    await p2.evaluate(() => document.getElementById("vKeep").classList.contains("activo")));

  /* ---- SIN CONEXIÓN ---- */
  seccion("Abrirlo SIN CONEXIÓN");
  await p2.click('[data-close="viewerModal"]');
  await ctx.setOffline(true);
  await p2.reload({ waitUntil: "domcontentloaded" });
  await p2.waitForFunction(() => window.ePub, null, { timeout: 15000 }).catch(() => {});
  await irAlVisor(p2);
  await p2.waitForTimeout(700);
  paso("OFFLINE: el estante sigue listando la descarga",
    /grande\.epub/.test(await p2.textContent("#descargasLista")));
  await p2.click(".dl-open");
  await p2.waitForSelector("#epubArea iframe", { timeout: 20000 }).catch(() => {});
  paso("OFFLINE: el libro se abre y se lee",
    await p2.evaluate(() => {
      const f = document.querySelector("#epubArea iframe");
      return /Capitulo/.test(f?.contentDocument?.body?.textContent || "");
    }));
  await ctx.setOffline(false);
  await p2.click('[data-close="viewerModal"]');

  /* ---- borrar en dos pasos ---- */
  seccion("Borrar con confirmación en dos pasos");
  await irAlVisor(p2);
  await p2.waitForTimeout(400);
  await p2.click(".dl-del");
  await p2.waitForTimeout(200);
  paso("el primer clic solo pregunta, no borra",
    /Borrar\?/.test(await p2.textContent(".dl-del")) &&
    (await p2.evaluate(async () => (await (await import("/js/docs.js")).listar()).length)) === 1);
  await p2.click(".dl-del");
  await p2.waitForTimeout(900);
  paso("el segundo clic sí borra",
    (await p2.evaluate(async () => (await (await import("/js/docs.js")).listar()).length)) === 0);
  paso("y el estante vuelve a esconderse",
    await p2.evaluate(() => document.getElementById("descargasBox").classList.contains("hidden")));

  await ctx.close();
}

/* ============ Cómic remoto → se guarda como CBZ ============ */
{
  seccion("Cómic de páginas remotas — se empaqueta como CBZ");
  const { ctx, page, errores } = await nuevaPagina();
  await page.evaluate(async () => {
    const mod = await import("/js/viewer.js");
    const lienzo = (color) => {
      const c = document.createElement("canvas");
      c.width = c.height = 30;
      const x = c.getContext("2d");
      x.fillStyle = color; x.fillRect(0, 0, 30, 30);
      return c.toDataURL();
    };
    // { name, url }: así llegan los capítulos de MangaDex — sin archivo.
    await mod.openImages(
      [{ name: "1.png", url: lienzo("#f00") }, { name: "2.png", url: lienzo("#0f0") }],
      "Capitulo de prueba");
  });
  await page.waitForTimeout(600);
  paso("el 📥 también sale en un cómic sin archivo de origen",
    await page.evaluate(() => document.getElementById("vKeep").style.display !== "none"));

  await page.click("#vKeep");
  /* Se espera la señal que ve el usuario (el botón marcado), no a sondear
     IndexedDB: un `waitForFunction` con `import()` dentro del predicado
     resultó inestable y fallaba 1 de cada 3 veces sin que la app tuviera
     nada que ver. */
  await page.waitForFunction(() =>
    document.getElementById("vKeep").classList.contains("activo"), null, { timeout: 25000 })
    .catch(() => {});
  const fichas = await page.evaluate(async () =>
    (await (await import("/js/docs.js")).listar()).map((f) => f.nombre));
  console.log("     guardado como:", JSON.stringify(fichas));
  paso("se guarda con nombre .cbz", /\.cbz$/.test(fichas[0] || ""));

  // y el CBZ guardado tiene que poder abrirse
  await page.click('[data-close="viewerModal"]');
  await irAlVisor(page);
  await page.waitForTimeout(400);
  await page.click(".dl-open");
  await page.waitForTimeout(2500);
  paso("el CBZ guardado se abre y enseña las 2 páginas",
    /2$/.test((await page.textContent("#vPageInfo")).trim()) ||
    /\/ 2/.test(await page.textContent("#vPageInfo")));

  paso("sin errores de consola (cómic)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Sin IndexedDB: nada debe romperse ============ */
{
  seccion("Navegador sin IndexedDB — la app sigue funcionando");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await page.addInitScript(`
    Object.defineProperty(window, "indexedDB", { get: () => undefined, configurable: true });`);
  await page.goto(BASE + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.ePub, null, { timeout: 15000 }).catch(() => {});
  await irAlVisor(page);
  await page.waitForTimeout(400);
  paso("el estante se queda escondido, sin errores",
    await page.evaluate(() => document.getElementById("descargasBox").classList.contains("hidden")));

  await page.setInputFiles("#fileInput", `${FX}/prueba.pdf`);
  await page.waitForSelector("#pdfCanvas", { timeout: 15000 });
  await page.waitForTimeout(500);
  paso("el botón 📥 no se ofrece si no hay dónde guardar",
    await page.evaluate(() => document.getElementById("vKeep").style.display === "none"));
  paso("el visor funciona igual", await page.evaluate(() =>
    !!document.getElementById("pdfCanvas")?.width));
  paso("sin errores de página", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

await browser.close();
console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
