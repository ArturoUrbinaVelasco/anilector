/* v3.12 — lo que el usuario reportó probando v3.11:
     · EPUB: siempre «0%», no se veía avance al pasar de página.
     · MOBI: tampoco mostraba avance al recorrer el documento.
     · Pellizco/Ctrl+rueda: agrandaba TODA la app en vez del documento.
   Se prueba con `grande.epub` (30 capítulos), que es donde se ve el fallo:
   con un libro de 3 capítulos el porcentaje parecía funcionar. */
import { chromium } from "./entorno.mjs";

const BASE = "http://localhost:8765";
const FX = "/home/claude/lector-otaku/fx";
let ok = 0, mal = 0;
const paso = (n, c) => { c ? (ok++, console.log("  ✅", n)) : (mal++, console.log("  ❌", n)); };
const seccion = (s) => console.log(`\n— ${s} —`);

const browser = await chromium.launch();

const MOBI_FALSO = `
export class MOBI {
  async open() {
    const secciones = [];
    for (let i = 0; i < 12; i++) {
      secciones.push({ load: async () => URL.createObjectURL(new Blob(
        ['<h2>Seccion ' + i + '</h2><p style="height:900px">Contenido ' + i + '.</p>'],
        { type: "text/html" })) });
    }
    return { sections: secciones,
      toc: [{ label: "Principio", href: "filepos:0" }, { label: "Final", href: "filepos:10" }],
      resolveHref: (h) => ({ index: Number(String(h).split(":")[1]) || 0 }), destroy() {} };
  }
}`;

async function nuevaPagina({ conMobi = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  if (conMobi) {
    await ctx.route("**/vendor/foliate/mobi.js", (r) =>
      r.fulfill({ contentType: "application/javascript", body: MOBI_FALSO }));
  }
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

/* ============ EPUB: el avance se ve DESDE EL PRIMER MOMENTO ============ */
{
  seccion("EPUB grande (30 capítulos) — avance visible al instante");
  const { ctx, page, errores } = await nuevaPagina();
  await page.setInputFiles("#fileInput", `${FX}/grande.epub`);
  await page.waitForSelector("#epubArea iframe", { timeout: 15000 });
  await page.waitForTimeout(500);

  const inicial = (await page.textContent("#vPageInfo")).trim();
  console.log("     etiqueta inicial:", JSON.stringify(inicial));
  paso("NO se queda en «0%» al abrir (el fallo que reportó)", inicial !== "0%");
  paso("muestra el capítulo mientras calcula el porcentaje", /^c\.1\/30/.test(inicial));
  paso("muestra la página dentro del capítulo", /·\s*\d+\/\d+$/.test(inicial));

  await page.click("#vNext");
  await page.waitForTimeout(500);
  const segunda = (await page.textContent("#vPageInfo")).trim();
  console.log("     tras pasar página:", JSON.stringify(segunda));
  paso("al pasar de página el número CAMBIA (antes se quedaba en 0%)",
    segunda !== inicial);

  paso("la ayuda emergente explica capítulo y página",
    /Capítulo 1 de 30/.test(await page.getAttribute("#vPageInfo", "title") || ""));

  // El porcentaje solo debe aparecer cuando el recorrido ha TERMINADO
  // (mientras corre, epub.js devuelve ceros engañosos).
  const llegoPct = await page.waitForFunction(() =>
    /^\d+%/.test(document.getElementById("vPageInfo").textContent.trim()),
    null, { timeout: 40000 }).then(() => true).catch(() => false);
  paso("el porcentaje aparece cuando de verdad está calculado", llegoPct);
  console.log("     con porcentaje:", JSON.stringify((await page.textContent("#vPageInfo")).trim()));

  // Saltar al final: el porcentaje debe subir de verdad
  await page.click("#vToc");
  await page.click('.toc-item[data-i="29"]');
  await page.waitForTimeout(1500);
  const final = (await page.textContent("#vPageInfo")).trim();
  console.log("     último capítulo:", JSON.stringify(final));
  paso("en el último capítulo el porcentaje es alto (no 0%)",
    parseInt(final, 10) > 80);
  paso("y la ayuda dice que es el capítulo 30",
    /Capítulo 30 de 30/.test(await page.getAttribute("#vPageInfo", "title") || ""));

  paso("sin errores de consola (EPUB grande)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ MOBI: avance al recorrer ============ */
{
  seccion("MOBI — el número sigue dónde estás, no cuánto se ha cargado");
  const { ctx, page, errores } = await nuevaPagina({ conMobi: true });
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(64)], "libro.mobi", {}));
    const i = document.getElementById("fileInput");
    i.files = dt.files;
    i.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForSelector(".ebook-section", { timeout: 15000 });
  await page.waitForTimeout(500);

  const ini = (await page.textContent("#vPageInfo")).trim();
  console.log("     al abrir:", JSON.stringify(ini));
  paso("empieza en la sección 1", /^1\/12$/.test(ini));

  // Bajar por el documento
  await page.evaluate(() => { document.getElementById("viewerBody").scrollTop = 2600; });
  await page.waitForTimeout(500);
  const medio = (await page.textContent("#vPageInfo")).trim();
  console.log("     tras desplazarse:", JSON.stringify(medio));
  paso("al recorrer el documento el número AVANZA (antes no se movía)",
    medio !== ini && parseInt(medio, 10) > 1);

  paso("la ayuda emergente dice en qué sección vas",
    /Secci[oó]n \d+ de 12/i.test(await page.getAttribute("#vPageInfo", "title") || ""));

  // Volver arriba: debe retroceder
  await page.evaluate(() => { document.getElementById("viewerBody").scrollTop = 0; });
  await page.waitForTimeout(500);
  paso("al volver arriba el número retrocede",
    (await page.textContent("#vPageInfo")).trim() === "1/12");

  paso("sin errores de consola (MOBI)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Pellizco / Ctrl+rueda ============ */
{
  seccion("Pellizco y Ctrl+rueda — agrandan el DOCUMENTO, no la app");
  const { ctx, page, errores } = await nuevaPagina();

  // PDF: el zoom es el del documento
  await page.setInputFiles("#fileInput", `${FX}/prueba.pdf`);
  await page.waitForSelector("#pdfCanvas", { timeout: 15000 });
  await page.waitForTimeout(400);
  const anchoAntes = await page.evaluate(() => document.getElementById("pdfCanvas").width);

  const rueda = async (deltaY) => {
    await page.evaluate((dy) => {
      document.getElementById("viewerBody").dispatchEvent(
        new WheelEvent("wheel", { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true }));
    }, deltaY);
    await page.waitForTimeout(180);   // el freno entre pasos es de 90 ms
  };
  await rueda(-100);
  await rueda(-100);
  const anchoDespues = await page.evaluate(() => document.getElementById("pdfCanvas").width);
  paso("Ctrl+rueda hacia arriba agranda el PDF", anchoDespues > anchoAntes);

  const cancelado = await page.evaluate(() => {
    const ev = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    document.getElementById("viewerBody").dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  paso("el gesto se le quita al navegador (no hace su propio zoom)", cancelado);

  const sinCtrl = await page.evaluate(() => {
    const ev = new WheelEvent("wheel", { deltaY: -100, ctrlKey: false, bubbles: true, cancelable: true });
    document.getElementById("viewerBody").dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  paso("la rueda normal sigue desplazando, no hace zoom", sinCtrl === false);

  await page.click('[data-close="viewerModal"]');
  const fueraDelVisor = await page.evaluate(() => {
    const ev = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  paso("con el visor cerrado NO se toca el zoom del navegador", fueraDelVisor === false);

  // EPUB: el gesto tiene que funcionar dentro de su iframe
  await page.setInputFiles("#fileInput", `${FX}/prueba.epub`);
  await page.waitForSelector("#epubArea iframe", { timeout: 15000 });
  await page.waitForTimeout(800);
  const tamAntes = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("anilector.readType") || "{}").size ?? 1);
  const dentroCancelado = await page.evaluate(() => {
    const d = document.querySelector("#epubArea iframe").contentDocument;
    const ev = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    d.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  await page.waitForTimeout(300);
  const tamDespues = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("anilector.readType") || "{}").size);
  paso("dentro del EPUB el gesto también se recoge", dentroCancelado);
  paso("y agranda la letra del libro", tamDespues > tamAntes);

  paso("el área de lectura desactiva el zoom táctil del navegador",
    await page.evaluate(() =>
      getComputedStyle(document.getElementById("viewerBody")).touchAction.includes("pan")));

  paso("sin errores de consola (gestos)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

await browser.close();
console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
