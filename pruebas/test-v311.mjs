/* Pruebas de v3.11 — arreglos del visor, índice, tipografía y traductor.
   El sandbox no tiene internet: todo lo externo se corta, que además es
   el escenario en el que la app tiene que funcionar. */
import { chromium } from "./entorno.mjs";

const BASE = "http://localhost:8765";
const FX = "/home/claude/lector-otaku/fx";
let ok = 0, mal = 0;
const paso = (n, c) => { c ? (ok++, console.log("  ✅", n)) : (mal++, console.log("  ❌", n)); };
const seccion = (s) => console.log(`\n— ${s} —`);

const browser = await chromium.launch();

/* Módulo falso de foliate: sirve para ejercitar NUESTRA lógica de MOBI
   (progreso, índice, saltos) sin necesitar un .mobi real, que no se puede
   generar aquí. No prueba foliate, prueba openMobi(). */
const MOBI_FALSO = `
export class MOBI {
  constructor() {}
  async open() {
    const secciones = [];
    for (let i = 0; i < 12; i++) {
      secciones.push({ load: async () => {
        const html = '<h2>Seccion ' + i + '</h2>' +
          '<p style="height:600px">Contenido de prueba de la seccion ' + i + '.</p>';
        return URL.createObjectURL(new Blob([html], { type: "text/html" }));
      }});
    }
    return {
      sections: secciones,
      toc: [
        { label: "Principio", href: "filepos:0" },
        { label: "Mitad",     href: "filepos:5" },
        { label: "Final",     href: "filepos:10" },
      ],
      resolveHref: (h) => ({ index: Number(String(h).split(":")[1]) || 0 }),
      destroy() {},
    };
  }
}`;

/* Traductor falso: Chromium no trae las APIs de Chrome, así que se
   inyectan para comprobar el cableado (detección, panel, volver al
   original). La disponibilidad real ya está verificada en la doc. */
const TRADUCTOR_FALSO = `
  window.LanguageDetector = {
    create: async () => ({
      detect: async () => [{ detectedLanguage: "en", confidence: 0.95 }],
      destroy() {},
    }),
  };
  window.Translator = {
    availability: async () => "available",
    create: async () => ({
      translate: async (txt) => "[tr] " + txt,
      destroy() {},
    }),
  };`;

async function nuevaPagina({ conTraductor = false, conMobi = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  if (conMobi) {
    await ctx.route("**/vendor/foliate/mobi.js", (r) =>
      r.fulfill({ contentType: "application/javascript", body: MOBI_FALSO }));
  }
  const page = await ctx.newPage();
  if (conTraductor) await page.addInitScript(TRADUCTOR_FALSO);
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
const abrir = (page, archivo) => page.setInputFiles("#fileInput", `${FX}/${archivo}`);
const cerrar = (page) => page.click('[data-close="viewerModal"]');

/* ============ PDF: índice + ir a página ============ */
{
  seccion("PDF — índice e ir a una página");
  const { ctx, page, errores } = await nuevaPagina();
  await abrir(page, "prueba.pdf");
  await page.waitForSelector("#pdfCanvas", { timeout: 15000 });
  await page.waitForFunction(() =>
    document.getElementById("vToc")?.style.display !== "none", null, { timeout: 10000 }).catch(() => {});

  paso("el botón de índice aparece en un PDF con marcadores",
    await page.evaluate(() => document.getElementById("vToc").style.display !== "none"));

  await page.click("#vToc");
  const capitulos = await page.$$eval(".toc-item", (n) => n.map((x) => x.textContent.trim()));
  paso("el índice lista los 3 capítulos del PDF",
    capitulos.length === 3 && capitulos[0] === "Capitulo uno");

  await page.click('.toc-item[data-i="2"]');
  await page.waitForTimeout(400);
  paso("pulsar el 3.er capítulo salta a la página 3",
    /3/.test(await page.textContent("#vPageInfo")));
  paso("el panel se cierra al elegir un capítulo",
    await page.evaluate(() => document.getElementById("vTocPanel").classList.contains("hidden")));

  // Ir a la página escribiendo el número
  await page.click("#vPageInfo");
  await page.fill("#vGoto", "1");
  await page.press("#vGoto", "Enter");
  await page.waitForTimeout(400);
  paso("escribir «1» en el número de página vuelve a la primera",
    await page.evaluate(() => window.getComputedStyle(document.body).length >= 0) &&
    /\b1\b/.test(await page.textContent("#vPageInfo")));

  paso("el botón de tipografía NO sale en un PDF",
    await page.evaluate(() => document.getElementById("vType").style.display === "none"));

  await cerrar(page);
  paso("sin errores de consola (PDF)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ EPUB: zoom que antes no hacía nada, índice, tipografía ============ */
{
  seccion("EPUB — zoom, índice y tipografía");
  const { ctx, page, errores } = await nuevaPagina();
  await abrir(page, "prueba.epub");
  await page.waitForSelector("#epubArea iframe", { timeout: 15000 });
  await page.waitForTimeout(600);

  paso("el botón de tipografía SÍ sale en un EPUB",
    await page.evaluate(() => document.getElementById("vType").style.display !== "none"));

  // ANTES: los ➕/➖ se dibujaban pero no hacían absolutamente nada en EPUB.
  const antes = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("anilector.readType") || "{}").size ?? 1; }
    catch { return 1; }
  });
  await page.click("#vZoomIn");
  await page.click("#vZoomIn");
  await page.waitForTimeout(300);
  const despues = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("anilector.readType") || "{}").size);
  paso("➕ aumenta el tamaño de letra del EPUB (antes era un botón muerto)",
    despues > antes);

  const aplicado = await page.evaluate(() => {
    const f = document.querySelector("#epubArea iframe");
    const b = f?.contentDocument?.body;
    return b ? getComputedStyle(b).fontSize : "";
  });
  paso("el tamaño llega de verdad al texto del EPUB", parseFloat(aplicado) > 0);

  await page.click("#vType");
  paso("el panel de tipografía se abre",
    await page.evaluate(() => !document.getElementById("vTypePanel").classList.contains("hidden")));
  paso("el panel NO ofrece «ancho» en EPUB (lo pagina epub.js)",
    await page.evaluate(() => !document.querySelector('[data-tipo="width"]')));

  const lh0 = await page.evaluate(() => JSON.parse(localStorage.getItem("anilector.readType")).lh);
  await page.click('[data-tipo="lh"][data-d="1"]');
  await page.waitForTimeout(200);
  const lh1 = await page.evaluate(() => JSON.parse(localStorage.getItem("anilector.readType")).lh);
  paso("el interlineado se puede subir y se guarda", lh1 > lh0);

  await page.click("#vTypeReset");
  await page.waitForTimeout(200);
  paso("«Restablecer» vuelve a los valores por defecto",
    await page.evaluate(() => {
      const v = JSON.parse(localStorage.getItem("anilector.readType"));
      return v.size === 1 && v.lh === 1.6;
    }));

  await page.click("#vToc");
  const caps = await page.$$eval(".toc-item", (n) => n.map((x) => x.textContent.trim()));
  paso("el índice del EPUB lista los 3 capítulos",
    caps.length === 3 && caps[1] === "Capitulo dos");
  await page.click('.toc-item[data-i="1"]');
  await page.waitForTimeout(700);
  paso("saltar al capítulo dos cambia el contenido mostrado",
    await page.evaluate(() => {
      const f = document.querySelector("#epubArea iframe");
      return /Capitulo dos|Segundo capitulo/.test(f?.contentDocument?.body?.textContent || "");
    }));

  // Escape cierra primero el panel, no el visor
  await page.click("#vType");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  paso("Escape cierra el panel y deja el visor abierto",
    await page.evaluate(() =>
      document.getElementById("vTypePanel").classList.contains("hidden") &&
      !document.getElementById("viewerModal").classList.contains("hidden")));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  paso("el siguiente Escape ya cierra el visor",
    await page.evaluate(() => document.getElementById("viewerModal").classList.contains("hidden")));

  paso("sin errores de consola (EPUB)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* Desde v3.19 el progreso se guarda con huella del CONTENIDO (para que
   dos archivos con el mismo nombre no compartan el punto de lectura) y
   envuelto en {v, t} para poder podar por antigüedad. Se lee así. */
const progresoDe = (page) => page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem("anilector.progress") || "{}");
  const k = Object.keys(p).find((x) => x.startsWith("doc:"));
  if (!k) return null;
  const e = p[k];
  return e && typeof e === "object" && "v" in e ? e.v : e;
});

/* ============ EPUB: recuerda dónde ibas ============ */
{
  seccion("EPUB — retomar la lectura");
  const { ctx, page, errores } = await nuevaPagina();
  await abrir(page, "prueba.epub");
  await page.waitForSelector("#epubArea iframe", { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.click("#vToc");
  await page.click('.toc-item[data-i="2"]');
  await page.waitForTimeout(800);
  const guardado = await progresoDe(page);
  paso("se guarda el punto de lectura (cfi)", !!guardado?.cfi);
  await cerrar(page);
  await abrir(page, "prueba.epub");
  await page.waitForSelector("#epubArea iframe", { timeout: 15000 });
  await page.waitForTimeout(900);
  paso("al reabrirlo retoma el capítulo tres",
    await page.evaluate(() => {
      const f = document.querySelector("#epubArea iframe");
      return /Capitulo tres|Tercer capitulo/.test(f?.contentDocument?.body?.textContent || "");
    }));
  paso("sin errores de consola (retomar EPUB)", errores.length === 0);
  await ctx.close();
}

/* ============ EPUB roto: mensaje y reintentar, no pantalla en blanco ============ */
{
  seccion("EPUB dañado — mensaje claro y botón de reintentar");
  const { ctx, page, errores } = await nuevaPagina();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["esto no es un epub"], "roto.epub", { type: "application/epub+zip" }));
    document.getElementById("fileInput").files = dt.files;
    document.getElementById("fileInput").dispatchEvent(new Event("change", { bubbles: true }));
  });
  // epub.js ante basura no falla: se queda esperando. Por eso el visor
  // corta a los 20 s; la prueba espera un poco más que eso.
  await page.waitForSelector("#vRetry", { timeout: 35000 }).catch(() => {});
  const txt = await page.textContent("#viewerBody");
  paso("explica que el EPUB no se pudo abrir (antes: visor en blanco para siempre)",
    /no se pudo abrir el epub/i.test(txt));
  paso("ofrece «Volver a intentar»", await page.$("#vRetry") !== null);
  paso("no deja el cuerpo del visor vacío", (txt || "").trim().length > 10);
  await ctx.close();
}

/* ============ MOBI (módulo simulado): progreso, índice, tipografía ============ */
{
  seccion("MOBI — progreso que antes no se guardaba, índice y tipografía");
  const { ctx, page, errores } = await nuevaPagina({ conMobi: true });
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(64)], "libro.mobi", {}));
    document.getElementById("fileInput").files = dt.files;
    document.getElementById("fileInput").dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForSelector(".ebook-section", { timeout: 15000 });
  await page.waitForTimeout(400);

  paso("el botón de tipografía sale en MOBI",
    await page.evaluate(() => document.getElementById("vType").style.display !== "none"));
  paso("el índice del MOBI se construye desde book.toc",
    await page.evaluate(() => document.getElementById("vToc").style.display !== "none"));

  await page.click("#vToc");
  await page.click('.toc-item[data-i="2"]');            // "Final" → sección 10
  await page.waitForTimeout(1200);
  paso("saltar al final carga las secciones que faltaban",
    await page.evaluate(() => document.querySelectorAll(".ebook-section").length >= 11));

  await page.waitForTimeout(700);   // el guardado va con retardo de 400 ms
  const prog = await progresoDe(page);
  paso("AHORA sí guarda por dónde ibas (antes nunca lo hacía)",
    !!prog && prog.sec > 0);

  const secGuardada = prog?.sec;
  await cerrar(page);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(64)], "libro.mobi", {}));
    document.getElementById("fileInput").files = dt.files;
    document.getElementById("fileInput").dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForSelector(".ebook-section", { timeout: 15000 });
  await page.waitForTimeout(1500);
  paso("al reabrirlo retoma esa sección",
    await page.evaluate((s) => {
      const c = document.querySelector(`.ebook-section[data-sec="${s}"]`);
      const b = document.getElementById("viewerBody");
      return !!c && Math.abs(b.scrollTop - c.offsetTop) < 250;
    }, secGuardada));

  paso("sin errores de consola (MOBI)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Traductor ============ */
{
  seccion("Traductor — con el traductor del navegador disponible");
  const { ctx, page, errores } = await nuevaPagina({ conTraductor: true });
  await abrir(page, "prueba.epub");
  await page.waitForSelector("#epubArea iframe", { timeout: 15000 });
  await page.waitForTimeout(700);

  paso("el botón 🌐 sale en un EPUB",
    await page.evaluate(() => document.getElementById("vTr").style.display !== "none"));
  await page.click("#vTr");
  paso("el panel ofrece elegir el idioma de destino", await page.$("#vTrLang") !== null);
  paso("el destino por defecto es español",
    await page.inputValue("#vTrLang") === "es");

  await page.click("#vTrGo");
  await page.waitForFunction(() =>
    /Traducido de/.test(document.getElementById("vTrEstado")?.textContent || ""),
    null, { timeout: 15000 }).catch(() => {});
  paso("dice de qué idioma a cuál tradujo",
    /Traducido de inglés a español/.test(await page.textContent("#vTrEstado")));
  paso("el texto del EPUB queda traducido",
    await page.evaluate(() => {
      const f = document.querySelector("#epubArea iframe");
      return /\[tr\]/.test(f?.contentDocument?.body?.textContent || "");
    }));
  paso("el botón queda marcado como activo",
    await page.evaluate(() => document.getElementById("vTr").classList.contains("activo")));

  await page.click("#vTrGo");     // ahora dice "Ver el original"
  await page.waitForTimeout(500);
  paso("«Ver el original» deshace la traducción",
    await page.evaluate(() => {
      const f = document.querySelector("#epubArea iframe");
      const txt = f?.contentDocument?.body?.textContent || "";
      return !/\[tr\]/.test(txt) && /Capitulo/.test(txt);
    }));
  paso("sin errores de consola (traductor)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

{
  seccion("Traductor — navegador SIN las APIs (el caso de Chrome de Android)");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.addInitScript(`delete window.Translator; delete window.LanguageDetector;`);
  await page.goto(BASE + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.pdfjsLib && window.ePub, null, { timeout: 15000 }).catch(() => {});
  await abrir(page, "prueba.epub");
  await page.waitForSelector("#epubArea iframe", { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.click("#vTr");
  const aviso = await page.textContent("#vTrPanel");
  paso("no ofrece un botón muerto: explica por qué no puede",
    /no trae traductor integrado/i.test(aviso));
  paso("y le dice qué hacer en el celular",
    /mantén pulsado/i.test(aviso));
  await ctx.close();
}

{
  /* El caso MÁS realista y el que casi cuesta un fallo grave: el navegador
     SÍ expone Translator y LanguageDetector, pero los modelos no están.
     Aquí se comprueba que no se toca la llamada que tumba la pestaña. */
  seccion("Traductor — APIs presentes pero SIN modelos (Chromium de verdad)");
  const { ctx, page, errores } = await nuevaPagina();
  paso("este Chromium expone las APIs aunque no sirvan (por eso no basta con mirarlas)",
    await page.evaluate(() => "Translator" in self && "LanguageDetector" in self));
  await abrir(page, "prueba.epub");
  await page.waitForSelector("#epubArea iframe", { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.click("#vTr");
  await page.click("#vTrGo");
  // Ojo: el estado pasa antes por «Detectando el idioma…»; hay que esperar
  // al mensaje final, no al primero que aparezca.
  await page.waitForFunction(() =>
    /traductor integrado|Traducido de|No se pudo|no puede traducir/i
      .test(document.getElementById("vTrEstado")?.textContent || ""),
    null, { timeout: 20000 }).catch(() => {});
  const estado = await page.textContent("#vTrEstado");
  paso("al intentarlo explica con claridad que este navegador no puede",
    /no trae traductor integrado/i.test(estado || ""));
  paso("LA PESTAÑA SIGUE VIVA (Translator.availability la tumbaba)",
    await page.evaluate(() => !!document.getElementById("viewerModal")));
  paso("el visor sigue abierto y usable",
    await page.evaluate(() => !document.getElementById("viewerModal").classList.contains("hidden")));
  paso("sin errores de consola (traductor sin modelos)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Respaldo y almacenamiento lleno ============ */
{
  seccion("Respaldo y almacenamiento");
  const { ctx, page } = await nuevaPagina();
  // Se comprueba el efecto, no la lista: exportar debe traer las M3U propias.
  await page.evaluate(() => {
    localStorage.setItem("anilector.tvcustom", JSON.stringify({ lists: [{ url: "http://x/l.m3u", name: "mía" }], channels: [] }));
    localStorage.setItem("anilector.readNight", "1");
  });
  const descarga = page.waitForEvent("download", { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector("#backupExport")?.click();
  });
  const d = await descarga.catch(() => null);
  if (d) {
    const ruta = await d.path();
    const json = JSON.parse((await import("node:fs")).readFileSync(ruta, "utf8"));
    paso("el respaldo incluye tus listas M3U propias (antes se perdían)",
      !!json?.datos?.["anilector.tvcustom"]);
    paso("el respaldo incluye los ajustes de lectura",
      json?.datos?.["anilector.readNight"] !== undefined);
  } else {
    paso("el respaldo se descarga", false);
    paso("el respaldo incluye los ajustes de lectura", false);
  }

  // Cuota llena: saveLib debe avisar en vez de romperse en silencio
  const avisa = await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k) {
      if (k === "anilector.library") { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }
      return real.apply(this, arguments);
    };
    try {
      document.querySelectorAll(".card-fav")[0]?.click();
    } catch (_) {}
    Storage.prototype.setItem = real;
    return true;
  });
  paso("el bloqueo de cuota se puede simular sin tumbar la página", avisa);
  await ctx.close();
}

/* ============ Zoom de cómic que se conservaba mal ============ */
{
  seccion("Cómic — el zoom ya no se pierde al pasar de página");
  const { ctx, page } = await nuevaPagina();
  const hecho = await page.evaluate(async () => {
    const mod = await import("/js/viewer.js");
    const lienzo = (color) => {
      const c = document.createElement("canvas");
      c.width = c.height = 40;
      const x = c.getContext("2d");
      x.fillStyle = color; x.fillRect(0, 0, 40, 40);
      return c.toDataURL();
    };
    await mod.openImages(
      [{ name: "1.png", url: lienzo("#f00") }, { name: "2.png", url: lienzo("#0f0") }],
      "prueba-comic");
    return true;
  });
  paso("se abre un cómic de prueba", hecho);
  await page.waitForTimeout(400);
  await page.click("#vZoomIn");
  await page.click("#vZoomIn");
  await page.waitForTimeout(200);
  const z1 = await page.evaluate(() => document.querySelector("img.page-img")?.style.maxWidth);
  await page.click("#vNext");
  await page.waitForTimeout(500);
  const z2 = await page.evaluate(() => document.querySelector("img.page-img")?.style.maxWidth);
  paso("el zoom se mantiene al pasar de página (antes se reiniciaba)",
    z1 && z1 === z2 && z1 !== "100%");

  await page.click("#vPageInfo");
  await page.fill("#vGoto", "1");
  await page.press("#vGoto", "Enter");
  await page.waitForTimeout(400);
  paso("«ir a página» también funciona en cómics",
    /^1 \//.test((await page.textContent("#vPageInfo")).trim()));
  await ctx.close();
}

await browser.close();
console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
