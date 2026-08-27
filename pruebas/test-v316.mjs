/* v3.16 — Películas y Series retro: se conecta `js/vod.js`, un catálogo
   de Internet Archive que llevaba tiempo terminado en el repo pero SIN
   enchufar (no lo importaba nadie, no estaba en el service worker y no
   tenía HTML).

   Internet Archive no se alcanza desde este entorno: su búsqueda se
   simula con `page.route`. Lo que se comprueba es NUESTRA parte —
   pestañas, carga perezosa, categorías, búsqueda, orden, paginación y
   que al pulsar una ficha se abra el reproductor legal de archive.org. */
import { chromium } from "./entorno.mjs";

const BASE = "http://localhost:8765";
let ok = 0, mal = 0;
const paso = (n, c) => { c ? (ok++, console.log("  ✅", n)) : (mal++, console.log("  ❌", n)); };
const seccion = (s) => console.log(`\n— ${s} —`);

const browser = await chromium.launch();

const docsFalsos = (n, prefijo) => Array.from({ length: n }, (_, i) => ({
  identifier: `${prefijo}-${i}`, title: `${prefijo} número ${i}`, year: 1950 + i, downloads: 1000 - i,
}));

async function nuevaPagina() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const page = await ctx.newPage();
  const pedidas = [];

  await page.route(/archive\.org\/advancedsearch\.php/, (r) => {
    const url = r.request().url();
    pedidas.push(url);
    const esRetro = /television|classic_tv/.test(decodeURIComponent(url));
    r.fulfill({ contentType: "application/json", body: JSON.stringify({
      response: { numFound: 137, docs: docsFalsos(6, esRetro ? "serie" : "peli") } }) });
  });
  await page.route(/archive\.org\/services\/img/, (r) =>
    r.fulfill({ contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") }));

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
const irA = async (page, vista) => {
  await page.evaluate((v) => {
    document.querySelectorAll(`.nav-tab[data-view="${v}"]`).forEach((b) => b.click());
  }, vista);
  await page.waitForTimeout(1000);
};
const leerUrl = (u) => decodeURIComponent(String(u || "").replace(/\+/g, " "));

/* ============ Películas ============ */
{
  seccion("Películas — la pestaña que estaba apagada");
  const { ctx, page, errores, pedidas } = await nuevaPagina();

  paso("hay pestaña de Películas",
    await page.evaluate(() => !!document.querySelector('.nav-tab[data-view="vod"]')));
  paso("y de Series retro",
    await page.evaluate(() => !!document.querySelector('.nav-tab[data-view="retro"]')));
  paso("NO se pide el catálogo hasta entrar (carga perezosa)",
    pedidas.length === 0);

  await irA(page, "vod");
  paso("al entrar, la vista se enseña",
    await page.evaluate(() => !document.getElementById("viewVod").classList.contains("hidden")));
  paso("ahora sí pide el catálogo a Internet Archive", pedidas.length > 0);

  const consulta = leerUrl(pedidas[0]);
  console.log("     consulta:", consulta.split("?")[1]?.slice(0, 100));
  paso("pide solo películas", /mediatype:\(movies\)/.test(consulta));
  paso("y arranca por las destacadas", /collection:\(feature_films\)/.test(consulta));

  const fichas = await page.$$eval("#vodGrid .vod-card .card-title", (n) => n.map((x) => x.textContent.trim()));
  console.log("     en pantalla:", fichas.length, "→", JSON.stringify(fichas.slice(0, 2)));
  paso("pinta las fichas del catálogo", fichas.length === 6);
  paso("dice cuántas hay en total",
    /137/.test(await page.textContent("#vodInfo")));

  const categorias = await page.$$eval("#vodCats .chip", (n) => n.map((x) => x.textContent.trim()));
  console.log("     categorías:", JSON.stringify(categorias.slice(0, 3)), "…");
  paso("ofrece categorías", categorias.length >= 6);
  paso("entre ellas, cine en español",
    categorias.some((c) => /espa[ñn]ol/i.test(c)));

  await page.click('#vodCats .chip:nth-child(2)');
  await page.waitForTimeout(700);
  paso("cambiar de categoría vuelve a preguntar",
    /language:\(Spanish/i.test(leerUrl(pedidas[pedidas.length - 1])));

  await page.fill("#vodSearch", "casablanca");
  await page.waitForTimeout(900);
  const conBusqueda = leerUrl(pedidas[pedidas.length - 1]);
  paso("buscar filtra por título con comodín (coincidencia parcial)",
    /title:casablanca\*/.test(conBusqueda));

  await page.selectOption("#vodSort", "year desc");
  await page.waitForTimeout(800);
  paso("se puede ordenar por año", /sort\[\]=year desc/.test(leerUrl(pedidas[pedidas.length - 1])));

  paso("hay botón de cargar más (hay 137 y se traen 60)",
    await page.evaluate(() => !document.getElementById("vodMore").classList.contains("hidden")));

  paso("sin errores de consola (películas)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Reproducción legal ============ */
{
  seccion("Reproducción — se abre el reproductor de archive.org");
  const { ctx, page, errores } = await nuevaPagina();
  await irA(page, "vod");
  await page.click("#vodGrid .vod-card");
  await page.waitForTimeout(800);

  paso("se abre el visor",
    await page.evaluate(() => !document.getElementById("viewerModal").classList.contains("hidden")));
  const src = await page.getAttribute("#viewerBody iframe", "src");
  console.log("     reproduce:", src);
  paso("desde archive.org, con su reproductor incrustado",
    /^https:\/\/archive\.org\/embed\//.test(src || ""));
  paso("y con el título de la película",
    /peli n[úu]mero/i.test(await page.textContent("#viewerTitle")));
  paso("sin proxies ni terceros: solo archive.org",
    !/proxy|workers\.dev|embedstream/i.test(src || ""));

  paso("sin errores de consola (reproducción)", errores.length === 0);
  await ctx.close();
}

/* ============ Series retro ============ */
{
  seccion("Series retro");
  const { ctx, page, errores, pedidas } = await nuevaPagina();
  await irA(page, "retro");
  paso("la vista se enseña",
    await page.evaluate(() => !document.getElementById("viewRetro").classList.contains("hidden")));
  const consulta = leerUrl(pedidas[0] || "");
  console.log("     consulta:", consulta.split("?")[1]?.slice(0, 90));
  paso("arranca por TV clásica", /collection:\(classic_tv\)/.test(consulta));
  paso("pinta sus fichas",
    (await page.$$eval("#retroGrid .vod-card", (n) => n.length)) === 6);

  const cats = await page.$$eval("#retroCats .chip", (n) => n.map((x) => x.textContent.trim()));
  paso("tiene sus propias categorías", cats.length >= 10);
  paso("y una en español", cats.some((c) => /espa[ñn]ol/i.test(c)));

  // Las dos vistas son independientes
  await irA(page, "vod");
  paso("cambiar a Películas esconde Series retro",
    await page.evaluate(() =>
      document.getElementById("viewRetro").classList.contains("hidden") &&
      !document.getElementById("viewVod").classList.contains("hidden")));

  paso("sin errores de consola (retro)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Está en el service worker ============ */
{
  seccion("Sin conexión");
  const res = await fetch(BASE + "/sw.js");
  const sw = await res.text();
  paso("vod.js entra en el esqueleto que se guarda sin conexión",
    /\.\/js\/vod\.js/.test(sw));
  // La versión solo puede subir: se compara numéricamente para que esta
  // prueba siga valiendo en releases posteriores.
  const num = (v) => v.split(".").map(Number).reduce((a, x, i) => a + x / 10 ** (i * 3), 0);
  const ver = (sw.match(/const VERSION = "v([\d.]+)"/) || [])[1] || "0";
  paso(`y la versión subió (v${ver} ≥ 3.16)`, num(ver) >= num("3.16.0"));
}

/* ============ Nada de la API pirata ============ */
{
  seccion("Comprobación de la línea del proyecto");
  const archivos = ["js/config.js", "js/vod.js", "js/app.js", "js/api.js", "index.html"];
  let sucio = [];
  for (const f of archivos) {
    const txt = await (await fetch(`${BASE}/${f}`)).text();
    if (/zonaaps|workers\.dev|moviedays|proxyvideo|embedstream|downloadvideo/i.test(txt)) sucio.push(f);
  }
  paso("no se coló ninguna referencia a la API de extracción ni a sus dominios",
    sucio.length === 0);
  if (sucio.length) console.log("   ", sucio);
}

await browser.close();
console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
