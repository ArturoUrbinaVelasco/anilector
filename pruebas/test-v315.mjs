/* v3.15 — Libros: filtros de verdad, lo gratis primero, colecciones y
   bibliotecas de México.

   ⚠️ Open Library y Google Books NO se pueden alcanzar desde este entorno
   (sin salida a internet; Open Library además bloquea lectores
   automáticos y Google Books devolvió 429). Se simulan con `page.route`,
   lo que además permite comprobar LO IMPORTANTE: que la app filtra por su
   cuenta aunque el servidor devuelva cosas que no pediste. Esa red de
   seguridad es justo la razón de que exista. */
import { chromium } from "./entorno.mjs";

const BASE = "http://localhost:8765";
let ok = 0, mal = 0;
const paso = (n, c) => { c ? (ok++, console.log("  ✅", n)) : (mal++, console.log("  ❌", n)); };
const seccion = (s) => console.log(`\n— ${s} —`);

const browser = await chromium.launch();

/* Un catálogo falso de Open Library con MEZCLA a propósito: hay libros
   libres, prestables y sin copia, en español y en inglés. Si la app se
   fiara del servidor, todos pasarían. */
const DOCS_OL = [
  { key: "/works/OL1W", title: "Cuentos libres", author_name: ["Ana López"], first_publish_year: 1999,
    cover_i: 1, language: ["spa"], ebook_access: "public", ia: ["cuentos-libres"], edition_count: 3 },
  { key: "/works/OL2W", title: "Novela prestada", author_name: ["Ana López"], first_publish_year: 2005,
    cover_i: 2, language: ["spa"], ebook_access: "borrowable", edition_count: 1 },
  { key: "/works/OL3W", title: "English only", author_name: ["John Doe"], first_publish_year: 2010,
    cover_i: 3, language: ["eng"], ebook_access: "public", ia: ["english-only"], edition_count: 2 },
  { key: "/works/OL4W", title: "Sin copia digital", author_name: ["Ana López"], first_publish_year: 1980,
    cover_i: 4, language: ["spa"], ebook_access: "no_ebook", edition_count: 5 },
];

const ITEMS_GB = [
  { id: "gb1", volumeInfo: { title: "Libro de pago", authors: ["Autora X"], language: "es",
      publishedDate: "2020-03-01", imageLinks: { thumbnail: "http://x/1.jpg" }, pageCount: 300 },
    saleInfo: { saleability: "FOR_SALE" },
    accessInfo: { viewability: "PARTIAL", epub: { isAvailable: true }, pdf: { isAvailable: false },
      webReaderLink: "https://books.google/x1" } },
  { id: "gb2", volumeInfo: { title: "Gratis con EPUB", authors: ["Autora Y"], language: "es",
      publishedDate: "2018", imageLinks: { thumbnail: "https://x/2.jpg" } },
    saleInfo: { saleability: "FREE" },
    accessInfo: { viewability: "ALL_PAGES", epub: { isAvailable: true }, pdf: { isAvailable: true },
      webReaderLink: "https://books.google/x2" } },
];

async function nuevaPagina({ rutas = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const page = await ctx.newPage();
  const pedidas = [];

  if (rutas) {
    await page.route(/openlibrary\.org\/search\.json/, (r) => {
      pedidas.push(r.request().url());
      r.fulfill({ contentType: "application/json",
        body: JSON.stringify({ numFound: DOCS_OL.length, docs: DOCS_OL }) });
    });
    await page.route(/googleapis\.com\/books\/v1\/volumes/, (r) => {
      pedidas.push(r.request().url());
      r.fulfill({ contentType: "application/json",
        body: JSON.stringify({ totalItems: ITEMS_GB.length, items: ITEMS_GB }) });
    });
    // Portadas: un pixel, para que no fallen las peticiones de imagen.
    await page.route(/covers\.openlibrary\.org/, (r) =>
      r.fulfill({ contentType: "image/gif",
        body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") }));
  }

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
  return { ctx, page, errores, pedidas };
}

const irALibros = async (page) => {
  await page.evaluate(() =>
    document.querySelectorAll('[data-catchip="books"]').forEach((b) => b.click()));
  await page.waitForTimeout(900);
  // El panel de filtros arranca plegado: hay que desplegarlo para poder
  // pulsar dentro (un campo oculto no se puede rellenar).
  await page.evaluate(() =>
    document.getElementById("filtersPanel").classList.remove("hidden"));
};
const titulos = (page) => page.$$eval(".card-title", (n) => n.map((x) => x.textContent.trim()));
/* En una URL los espacios viajan como `+`, y decodeURIComponent NO los
   convierte: hay que cambiarlos antes o `autor:"Ana López"` se lee como
   `autor:"Ana+López"` y las comprobaciones fallan sin motivo. */
const leerUrl = (u) => decodeURIComponent(String(u || "").replace(/\+/g, " "));

/* ============ Filtros y red de seguridad ============ */
{
  seccion("Filtros de libros — la app comprueba por su cuenta");
  const { ctx, page, errores, pedidas } = await nuevaPagina();
  await irALibros(page);

  paso("los filtros de libros aparecen al entrar en Libros",
    await page.evaluate(() => !document.getElementById("accessSelect").closest(".filter-group").classList.contains("hidden")));
  paso("el filtro «Estado» (de anime) se esconde",
    await page.evaluate(() => document.querySelector(".solo-otros").classList.contains("hidden")));
  paso("arranca en «Gratis para leer»",
    await page.inputValue("#accessSelect") === "libre");

  const url1 = pedidas.find((u) => u.includes("openlibrary")) || "";
  console.log("     consulta:", leerUrl(url1.split("?")[1] || "").slice(0, 110));
  paso("pide a Open Library solo lo de lectura libre",
    /ebook_access:public/.test(leerUrl(url1)));

  /* EL SERVIDOR FALSO DEVUELVE DE TODO. La app debe quedarse solo con lo
     libre: es la comprobación que justifica todo el filtrado local. */
  const t1 = await titulos(page);
  console.log("     en pantalla:", JSON.stringify(t1));
  paso("descarta el prestable aunque el servidor lo devuelva",
    !t1.includes("Novela prestada"));
  paso("descarta el que no tiene copia digital",
    !t1.includes("Sin copia digital"));
  paso("deja pasar los libres", t1.includes("Cuentos libres"));

  // Idioma
  await page.selectOption("#bookLangSelect", "es");
  await page.waitForTimeout(800);
  const t2 = await titulos(page);
  console.log("     solo español:", JSON.stringify(t2));
  paso("pide el idioma a Open Library en código de 3 letras",
    /language:spa/.test(leerUrl(pedidas[pedidas.length - 1])));
  paso("y descarta el que está en inglés aunque venga en la respuesta",
    !t2.includes("English only") && t2.includes("Cuentos libres"));

  // Autor
  await page.fill("#authorInput", "Ana López");
  await page.press("#authorInput", "Enter");
  await page.waitForTimeout(800);
  paso("busca por autor",
    /author:"Ana L/.test(leerUrl(pedidas[pedidas.length - 1])));

  // Materia en español pero enviada en inglés
  await page.selectOption("#genreSelect", { label: "Cuentos" }).catch(() => {});
  await page.waitForTimeout(800);
  paso("las materias se enseñan en español y se piden en inglés",
    /subject:"short stories"/.test(leerUrl(pedidas[pedidas.length - 1])));

  paso("sin errores de consola (filtros)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Gratis primero y etiquetas ============ */
{
  seccion("«Todo» — lo gratis se pone arriba y se etiqueta");
  const { ctx, page, errores } = await nuevaPagina();
  await irALibros(page);
  await page.selectOption("#accessSelect", "");
  await page.waitForTimeout(900);

  const t = await titulos(page);
  console.log("     orden:", JSON.stringify(t));
  paso("ahora sí salen los cuatro", t.length === 4);
  paso("lo gratis va antes que lo prestable",
    t.indexOf("Cuentos libres") < t.indexOf("Novela prestada"));
  paso("y lo prestable antes que lo que no tiene copia",
    t.indexOf("Novela prestada") < t.indexOf("Sin copia digital"));

  const etiquetas = await page.$$eval(".card-acceso", (n) => n.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  console.log("     etiquetas:", JSON.stringify(etiquetas.slice(0, 3)));
  paso("cada libro dice si es gratis, prestable o no",
    etiquetas.some((x) => /Gratis/.test(x)) && etiquetas.some((x) => /préstamo/i.test(x)));
  paso("y qué formato tiene", etiquetas.some((x) => /Leer en línea/i.test(x)));

  paso("sin errores de consola (orden)", errores.length === 0);
  await ctx.close();
}

/* ============ De pago → Google Books ============ */
{
  seccion("«De pago» y EPUB — cambia al catálogo que sí sabe de eso");
  const { ctx, page, errores, pedidas } = await nuevaPagina();
  await irALibros(page);
  await page.selectOption("#accessSelect", "pago");
  await page.waitForTimeout(900);

  const ultima = leerUrl(pedidas[pedidas.length - 1] || "");
  console.log("     consulta:", ultima.split("?")[1]?.slice(0, 110));
  paso("para «de pago» pregunta a Google Books, no a Open Library",
    ultima.includes("googleapis.com"));
  paso("y usa su filtro de libros de pago", /filter=paid-ebooks/.test(ultima));

  const t = await titulos(page);
  console.log("     en pantalla:", JSON.stringify(t));
  paso("enseña el de pago y descarta el gratis",
    t.includes("Libro de pago") && !t.includes("Gratis con EPUB"));

  await page.selectOption("#accessSelect", "libre");
  await page.selectOption("#fmtSelect", "epub");
  await page.waitForTimeout(900);
  const ultima2 = leerUrl(pedidas[pedidas.length - 1] || "");
  paso("para EPUB también va a Google Books", ultima2.includes("googleapis.com"));
  paso("y pide expresamente EPUB descargable", /download=epub/.test(ultima2));

  await page.selectOption("#fmtSelect", "pdf");
  await page.waitForTimeout(900);
  const t3 = await titulos(page);
  console.log("     solo PDF:", JSON.stringify(t3));
  paso("filtrando por PDF descarta el que no lo tiene",
    !t3.includes("Libro de pago") && t3.includes("Gratis con EPUB"));

  paso("las portadas http se sirven por https",
    await page.$$eval(".card-cover", (n) =>
      n.every((x) => !x.getAttribute("src") || !x.getAttribute("src").startsWith("http://"))));

  paso("sin errores de consola (pago)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Bibliotecas de México ============ */
{
  seccion("Bibliotecas abiertas de México");
  const { ctx, page } = await nuevaPagina();
  await irALibros(page);
  paso("la sección aparece en Libros",
    await page.evaluate(() => !document.getElementById("mxLibs").classList.contains("hidden")));
  await page.click("#mxLibsToggle");
  await page.waitForTimeout(300);

  const enlaces = await page.$$eval(".mx-lib", (n) =>
    n.map((a) => ({ nombre: a.querySelector(".mx-lib-name").textContent.trim(), url: a.href,
                    destino: a.target, rel: a.rel })));
  console.log("     bibliotecas:", enlaces.length);
  paso("hay varias bibliotecas", enlaces.length >= 8);
  paso("todas se abren en pestaña nueva y con rel seguro",
    enlaces.every((e) => e.destino === "_blank" && /noopener/.test(e.rel)));
  paso("todas son https (nada de contenido mixto)",
    enlaces.every((e) => e.url.startsWith("https://")));
  paso("está CONALITEG, para docentes",
    enlaces.some((e) => /Texto SEP/i.test(e.nombre)));
  paso("está Libros OA de la UNAM",
    enlaces.some((e) => /Libros OA/i.test(e.nombre)));
  paso("y SciELO México, para lo médico",
    enlaces.some((e) => /SciELO/i.test(e.nombre)));
  paso("NO está el Repositorio Nacional (su certificado está caducado)",
    !enlaces.some((e) => /repositorionacional/i.test(e.url)));
  paso("se avisa de que no se pueden buscar desde aquí",
    /no deja buscar su catálogo|ninguna deja buscar/i.test(await page.textContent(".mx-libs-help")));

  paso("la sección NO sale en anime", await (async () => {
    await page.evaluate(() =>
      document.querySelectorAll('[data-catchip="anime"]').forEach((b) => b.click()));
    await page.waitForTimeout(700);
    return page.evaluate(() => document.getElementById("mxLibs").classList.contains("hidden"));
  })());
  await ctx.close();
}

/* ============ Sitios corregidos ============ */
{
  seccion("Buscadores de bibliotecas corregidos");
  const { ctx, page } = await nuevaPagina();
  const sitios = await page.evaluate(async () => (await import("/js/config.js")).BOOK_SITES);
  const textos = sitios.find((s) => /Textos/i.test(s.name));
  console.log("     Textos.info →", textos?.url);
  paso("Textos.info usa la ruta correcta (su ?texto= no buscaba nada)",
    textos?.url === "https://www.textos.info/buscar/%s");
  paso("PlanetaLibro se quitó (su ?s= devolvía la portada)",
    !sitios.some((s) => /planetalibro/i.test(s.url)));
  paso("todos los buscadores llevan el hueco del término",
    sitios.every((s) => s.url.includes("%s")));
  paso("y todos son https", sitios.every((s) => s.url.startsWith("https://")));
  await ctx.close();
}

/* ============ Colecciones y más del autor ============ */
{
  seccion("Ficha: más del autor y otros tomos");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));

  await page.route(/covers\.openlibrary\.org/, (r) =>
    r.fulfill({ contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") }));
  // Ficha de la obra: incluye colección
  await page.route(/openlibrary\.org\/works\/OL1W\.json/, (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({
      description: "Una descripción.", subjects: ["Short stories"], series: ["Los Cuentos #2"] }) }));
  await page.route(/openlibrary\.org\/search\.json/, (r) => {
    const u = decodeURIComponent(r.request().url());
    // Devuelve algo distinto según lo que se pida, para distinguir estantes
    const docs = /series:/.test(u)
      ? [{ key: "/works/OLT1W", title: "Tomo uno de la saga", author_name: ["Ana López"],
           cover_i: 9, language: ["spa"], ebook_access: "public", first_publish_year: 1998 }]
      : DOCS_OL;
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ numFound: docs.length, docs }) });
  });
  await page.route(/googleapis\.com\/books\/v1\/volumes/, (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ totalItems: 0, items: [] }) }));

  await page.goto(BASE + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.pdfjsLib, null, { timeout: 15000 }).catch(() => {});
  await irALibros(page);
  await page.click(".card");
  await page.waitForTimeout(2000);

  const secciones = await page.$$eval("#detailContent .detail-section h3", (n) =>
    n.map((x) => x.textContent.trim()));
  console.log("     secciones:", JSON.stringify(secciones));
  paso("sale «Más de <autor>»", secciones.some((s) => /Más de Ana López/i.test(s)));
  paso("sale «Otros tomos» con el nombre limpio de la colección",
    secciones.some((s) => /Otros tomos de «Los Cuentos»/i.test(s)));

  const enEstante = await page.$$eval(".estante-item span", (n) => n.map((x) => x.textContent.trim()));
  paso("el estante lista libros", enEstante.length > 0);
  paso("y el libro abierto no se repite en su propio estante",
    !enEstante.includes("Cuentos libres"));

  await page.click(".estante-item");
  await page.waitForTimeout(1500);
  paso("pulsar un libro del estante abre su ficha",
    /Tomo uno de la saga|Novela prestada|English only/.test(
      await page.textContent("#detailContent")));

  paso("sin errores de página (ficha)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

await browser.close();
console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
