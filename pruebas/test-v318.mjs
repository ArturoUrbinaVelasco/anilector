/* v3.18 — «Mi servidor»: arreglo del «la clave funciona pero no devolvió usuarios».

   Lo nuevo que se comprueba aquí, y que v3.17 no comprobaba:
     · «Probar» hace una petición AUTENTICADA de verdad (no solo la pública).
     · Si el servidor no acepta la cabecera Authorization desde el
       navegador (preflight rechazado), la clave viaja por la dirección
       y la conexión FUNCIONA IGUAL. ← el fallo que reportó el usuario.
     · El usuario se resuelve solo: ya no hay selector.
     · Si la clave no lista usuarios, se sigue sin usuario.
     · Portadas y vídeo llevan `ApiKey` (actual) y `api_key` (Emby/viejo).
     · Rutas nuevas primero; las viejas solo si la nueva da 404.
     · «Guardar» prueba antes: no guarda una conexión que no funciona.
   Y todo lo de v3.17 que sigue vigente. */
import { chromium } from "./entorno.mjs";

const BASE = "http://localhost:8765";
const SRV = "https://mi-jelly.example";
const LLAVE = "clave-secreta-123";
let ok = 0, mal = 0;
const paso = (n, c) => { c ? (ok++, console.log("  ✅", n)) : (mal++, console.log("  ❌", n)); };
const seccion = (s) => console.log(`\n— ${s} —`);

const browser = await chromium.launch();

const PELIS = Array.from({ length: 5 }, (_, i) => ({
  Id: `m${i}`, Name: `Mi película ${i}`, Type: "Movie", ProductionYear: 2000 + i,
  ImageTags: { Primary: "tag" + i }, UserData: { Played: i === 0 },
}));
const SERIES = [{ Id: "s1", Name: "Mi serie", Type: "Series", ProductionYear: 2019, ImageTags: { Primary: "st" } }];
const EPIS = [
  { Id: "e1", Name: "Piloto", Type: "Episode", SeriesName: "Mi serie", ParentIndexNumber: 1, IndexNumber: 1 },
  { Id: "e2", Name: "Segundo", Type: "Episode", SeriesName: "Mi serie", ParentIndexNumber: 1, IndexNumber: 2 },
];
const CANALES = [{ Id: "c1", Name: "Canal de casa", Type: "TvChannel" }];
const LIBS = [
  { Id: "lib1", Name: "Películas", CollectionType: "movies" },
  { Id: "lib2", Name: "Series", CollectionType: "tvshows" },
  { Id: "lib9", Name: "Música", CollectionType: "music" },   // debe filtrarse
];

/* Un Jellyfin de mentira. Cada opción rompe algo a propósito:
     sinTv        → el servidor no tiene TV en vivo
     claveMala    → rechaza la clave siempre (401)
     sinPreflight → RECHAZA cualquier petición con cabecera Authorization,
                    que es exactamente lo que hace un preflight fallido
     sinUsuarios  → /Users devuelve lista vacía
     rutasViejas  → las rutas nuevas de Jellyfin dan 404 (Emby o 10.8)
     vistasVacias → las vistas del usuario llegan VACÍAS, aunque las
                    bibliotecas existan (pasa con claves de API)
     noEsJelly    → contesta JSON a todo, pero no es un servidor de medios */
async function montarJelly(page, pedidas, opciones = {}) {
  const { sinTv = false, claveMala = false, sinPreflight = false,
    sinUsuarios = false, rutasViejas = false, vistasVacias = false,
    noEsJelly = false } = opciones;
  const json = (r, body) => r.fulfill({ contentType: "application/json", body: JSON.stringify(body) });

  await page.route(/mi-jelly\.example/, (r) => {
    const url = new URL(r.request().url());
    const p = url.pathname;
    const cab = r.request().headers()["authorization"] || "";
    const porUrl = url.searchParams.get("ApiKey") || url.searchParams.get("api_key") || "";
    pedidas.push({
      p, cab, porUrl,
      nombreParam: url.searchParams.has("ApiKey") ? "ApiKey" : (url.searchParams.has("api_key") ? "api_key" : ""),
      buscar: url.searchParams.get("SearchTerm") || "",
      orden: url.searchParams.get("SortBy") || "",
      inicio: url.searchParams.get("StartIndex") || "",
      tipos: url.searchParams.get("IncludeItemTypes") || "",
      userId: url.searchParams.get("userId") || "",
    });

    // Un servicio que contesta JSON a cualquier ruta: ni versión ni
    // campos de servidor de medios. Debe caerse en el PRIMER paso.
    if (noEsJelly) return json(r, { status: "ready" });

    // El endpoint público no lleva autenticación: pasa siempre.
    if (p === "/System/Info/Public") {
      return json(r, { ServerName: "Casa", Version: "10.9.11", ProductName: "Jellyfin Server" });
    }

    // Preflight rechazado: una petición con cabecera propia no llega.
    // Para `fetch` esto es indistinguible de un fallo de red.
    if (sinPreflight && cab) return r.abort();

    const autenticada = !!cab || !!porUrl;
    if (!autenticada) return r.fulfill({ status: 401, body: "" });
    if (claveMala) return r.fulfill({ status: 401, body: "" });

    if (p === "/System/Info") return json(r, { ServerName: "Casa", Version: "10.9.11" });
    if (p === "/Users") {
      if (sinUsuarios) return json(r, []);
      return json(r, [{ Id: "u1", Name: "Arturo", Policy: { IsAdministrator: true } },
        { Id: "u2", Name: "Invitado" }]);
    }
    // Bibliotecas: ruta nueva, ruta vieja, y la de servidor sin usuario.
    if (p === "/UserViews") {
      if (rutasViejas) return r.fulfill({ status: 404, body: "" });
      return json(r, { Items: vistasVacias ? [] : LIBS });
    }
    if (p === "/Users/u1/Views") return json(r, { Items: vistasVacias ? [] : LIBS });
    if (p === "/Library/MediaFolders") {
      // Con `vistasVacias` esta vía también viene vacía: se quiere llegar
      // hasta la cuarta, la de las bibliotecas configuradas.
      return json(r, { Items: vistasVacias ? [] : LIBS });
    }
    if (p === "/Library/VirtualFolders") {
      // Forma distinta a propósito: el id viene en `ItemId`, no en `Id`.
      return json(r, LIBS.map((l) => ({ Name: l.Name, ItemId: l.Id, CollectionType: l.CollectionType })));
    }

    if (p === "/LiveTv/Channels") {
      if (sinTv) return r.fulfill({ status: 404, body: "" });
      return json(r, { Items: CANALES, TotalRecordCount: CANALES.length });
    }
    if (p === "/Items" || p === "/Users/u1/Items") {
      if (p === "/Items" && rutasViejas) return r.fulfill({ status: 404, body: "" });
      const tipos = url.searchParams.get("IncludeItemTypes") || "";
      const items = tipos === "Series" ? SERIES : PELIS;
      return json(r, { Items: items, TotalRecordCount: 120 });
    }
    if (p === "/Shows/s1/Episodes") return json(r, { Items: EPIS, TotalRecordCount: EPIS.length });
    if (p.startsWith("/Items/")) return r.fulfill({ contentType: "image/gif",
      body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") });
    if (p.includes("master.m3u8")) return r.fulfill({ contentType: "application/vnd.apple.mpegurl", body: "#EXTM3U" });
    return r.fulfill({ status: 404, body: "" });
  });
}

async function nuevaPagina(opciones = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const page = await ctx.newPage();
  const pedidas = [];
  await montarJelly(page, pedidas, opciones);
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

/* Las últimas peticiones son las portadas, así que para comprobar
   búsqueda, orden y paginación hay que mirar la última petición AL
   CATÁLOGO, no la última de todas. */
const ultimoCatalogo = (pedidas) =>
  [...pedidas].reverse().find((x) => /(^|\/)Items$/.test(x.p)) || {};
const pasosEnPantalla = (page) =>
  page.$$eval("#srvPasos li", (n) => n.map((x) => ({
    ok: x.classList.contains("bien"), texto: x.textContent.replace(/\s+/g, " ").trim() })));

const irAlServidor = async (page) => {
  await page.evaluate(() =>
    document.querySelectorAll('.nav-tab[data-view="server"]').forEach((b) => b.click()));
  await page.waitForTimeout(500);
};
async function conectar(page, { key = LLAVE } = {}) {
  await page.fill("#srvUrl", SRV);
  await page.fill("#srvKey", key);
  await page.click("#srvGuardar");
  await page.waitForTimeout(1800);
}

/* ============ Nada escrito en el código ============ */
{
  seccion("Cero direcciones en el código fuente");
  const archivos = ["js/media.js", "js/servervista.js", "index.html", "js/config.js"];
  let sucios = [];
  for (const f of archivos) {
    const txt = await (await fetch(`${BASE}/${f}`)).text();
    const limpio = txt.replace(/mi-servidor\.example[^"'\s]*/g, "");
    if (/https?:\/\/(?!fonts\.|localhost)[a-z0-9.-]*(jelly|emby|8096)/i.test(limpio)) sucios.push(f);
  }
  paso("ningún módulo trae una dirección de servidor quemada", sucios.length === 0);
  if (sucios.length) console.log("   ", sucios);

  const media = await (await fetch(`${BASE}/js/media.js`)).text();
  paso("la configuración se lee de localStorage",
    /localStorage\.getItem\("anilector\.server"\)|getItem\(CLAVE\)/.test(media));
  paso("y la clave se manda en la cabecera que espera Jellyfin",
    /MediaBrowser Token="\$\{c\.key\}"/.test(media));
}

/* ============ El panel, simplificado ============ */
{
  seccion("Panel simplificado — dirección y clave, y nada más");
  const html = await (await fetch(`${BASE}/index.html`)).text();
  paso("ya no hay selector de usuario", !/id="srvUser"/.test(html));
  paso("siguen la dirección y la clave", /id="srvUrl"/.test(html) && /id="srvKey"/.test(html));
  paso("y hay sitio para los pasos de la prueba", /id="srvPasos"/.test(html));
  const vista = await (await fetch(`${BASE}/js/servervista.js`)).text();
  paso("la vista no lee ningún selector de usuario", !/srvUser/.test(vista));
}

/* ============ Sin configurar ============ */
{
  seccion("Sin configurar — avisa y no pide nada");
  const { ctx, page, errores, pedidas } = await nuevaPagina();
  await irAlServidor(page);

  paso("la vista se enseña",
    await page.evaluate(() => !document.getElementById("viewServer").classList.contains("hidden")));
  paso("sale el aviso de que no hay servidor",
    await page.evaluate(() => !document.getElementById("srvEmpty").classList.contains("hidden")));
  paso("el catálogo está oculto",
    await page.evaluate(() => document.getElementById("srvCatalogo").classList.contains("hidden")));
  paso("el panel de conexión se abre solo",
    await page.evaluate(() => !document.getElementById("srvConfigBody").classList.contains("hidden")));
  paso("NO se hizo ninguna petición a ningún servidor", pedidas.length === 0);
  paso("la clave se escribe en un campo oculto",
    await page.getAttribute("#srvKey", "type") === "password");
  paso("sin errores de consola (sin configurar)", errores.length === 0);
  await ctx.close();
}

/* ============ La prueba comprueba la CLAVE, no solo la dirección ============ */
{
  seccion("«Probar» ahora sí comprueba la clave (el defecto de v3.17)");
  const { ctx, page, errores, pedidas } = await nuevaPagina();
  await irAlServidor(page);

  // Sin clave: se queda en el primer paso y lo dice.
  await page.fill("#srvUrl", SRV);
  await page.click("#srvProbar");
  await page.waitForTimeout(900);
  let ps = await pasosEnPantalla(page);
  console.log("     sin clave:", JSON.stringify(ps.map((x) => (x.ok ? "✓" : "✗") + " " + x.texto.slice(0, 42))));
  paso("la dirección responde y se marca en verde", ps[0]?.ok === true);
  paso("el paso de la clave se marca en rojo y pide la clave",
    ps[1] && ps[1].ok === false && /clave/i.test(ps[1].texto));
  paso("y NO dice que todo esté bien solo por la consulta pública",
    !/todo bien|listo/i.test(await page.textContent("#srvStatus")));

  // Con clave: hay una petición autenticada de verdad.
  await page.fill("#srvKey", LLAVE);
  await page.click("#srvProbar");
  await page.waitForTimeout(1500);
  ps = await pasosEnPantalla(page);
  console.log("     con clave:", JSON.stringify(ps.map((x) => (x.ok ? "✓" : "✗") + " " + x.texto.slice(0, 46))));
  paso("los tres pasos en verde", ps.length === 3 && ps.every((x) => x.ok));
  const auth = pedidas.find((x) => x.p === "/System/Info");
  paso("comprueba la clave contra un endpoint que SÍ exige autenticación", !!auth);
  paso("y manda el token en el formato exacto de Jellyfin",
    /^MediaBrowser Token="clave-secreta-123"/.test(auth?.cab || ""));
  paso("se identifica como AniLector en tu panel", /Client="AniLector"/.test(auth?.cab || ""));
  paso("dice qué usuario resolvió, sin preguntar", /Arturo/.test(ps[2]?.texto || ""));

  // Probar no guarda: guardar es lo que guarda.
  paso("probar no guarda nada todavía",
    await page.evaluate(() => !localStorage.getItem("anilector.server")));
  paso("sin errores de consola (prueba)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ EL FALLO REPORTADO: preflight rechazado ============ */
{
  seccion("Servidor que no acepta la cabecera — antes fallaba, ahora conecta");
  const { ctx, page, errores, pedidas } = await nuevaPagina({ sinPreflight: true });
  await irAlServidor(page);
  await conectar(page);

  const ps = await pasosEnPantalla(page);
  console.log("     pasos:", JSON.stringify(ps.map((x) => (x.ok ? "✓" : "✗") + " " + x.texto.slice(0, 50))));
  paso("la conexión sale adelante igual", ps.length === 3 && ps.every((x) => x.ok));
  paso("y explica que se usó la vía sin cabeceras",
    /por la dirección/i.test(ps[1]?.texto || ""));

  const conCabecera = pedidas.filter((x) => x.cab && x.p !== "/System/Info/Public");
  const porUrl = pedidas.filter((x) => x.porUrl === "clave-secreta-123");
  // Solo el tanteo inicial lleva cabecera; en cuanto se sabe que este
  // servidor no la acepta, ninguna otra petición vuelve a mandarla.
  paso("las peticiones dejan de llevar la cabecera que el servidor rechaza",
    porUrl.length > 5 && conCabecera.length === 1);
  console.log(`     con cabecera: ${conCabecera.length} (solo el tanteo) · por dirección: ${porUrl.length}`);

  const tarjetas = await page.$$eval("#srvGrid .srv-card .card-title", (n) => n.map((x) => x.textContent.trim()));
  paso("y el catálogo carga", tarjetas.length === 5);
  paso("se recuerda la vía que funcionó, para no tantear en cada petición",
    await page.evaluate(() => JSON.parse(localStorage.getItem("anilector.server") || "{}").modo === "consulta"));
  paso("sin errores de consola (sin preflight)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Servidor que no lista usuarios ============ */
{
  seccion("Clave que no lista usuarios — se sigue sin usuario");
  const { ctx, page, errores, pedidas } = await nuevaPagina({ sinUsuarios: true });
  await irAlServidor(page);
  await conectar(page);

  const ps = await pasosEnPantalla(page);
  console.log("     pasos:", JSON.stringify(ps.map((x) => (x.ok ? "✓" : "✗") + " " + x.texto.slice(0, 60))));
  paso("no se queda bloqueado: conecta igual", ps.length === 3 && ps.every((x) => x.ok));
  paso("avisa de que no se marcará lo ya visto", /sin usuario/i.test(ps[2]?.texto || ""));
  paso("las bibliotecas salen de las carpetas del servidor",
    pedidas.some((x) => x.p === "/Library/MediaFolders"));
  paso("y el catálogo carga",
    (await page.$$eval("#srvGrid .srv-card", (n) => n.length)) === 5);
  paso("sin errores de consola (sin usuarios)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Servidor viejo o Emby: rutas antiguas ============ */
{
  seccion("Servidor con las rutas antiguas (Emby / Jellyfin 10.8)");
  const { ctx, page, errores, pedidas } = await nuevaPagina({ rutasViejas: true });
  await irAlServidor(page);
  await conectar(page);

  paso("prueba primero la ruta nueva", pedidas.some((x) => x.p === "/UserViews"));
  paso("y al dar 404 usa la antigua", pedidas.some((x) => x.p === "/Users/u1/Views"));
  paso("lo mismo con el catálogo", pedidas.some((x) => x.p === "/Users/u1/Items"));
  const items = pedidas.filter((x) => x.p === "/Items").length;
  paso("y no repite el tanteo en cada página (se recuerda)", items <= 2);
  console.log(`     tanteos de /Items: ${items}`);
  paso("el catálogo carga igual",
    (await page.$$eval("#srvGrid .srv-card", (n) => n.length)) === 5);
  paso("sin errores de consola (rutas viejas)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Catálogo ============ */
{
  seccion("Catálogo — bibliotecas, búsqueda, orden, páginas");
  const { ctx, page, errores, pedidas } = await nuevaPagina();
  await irAlServidor(page);
  await conectar(page);

  const chips = await page.$$eval("#srvLibs .chip", (n) => n.map((x) => x.textContent.trim()));
  console.log("     bibliotecas:", JSON.stringify(chips));
  paso("se listan las bibliotecas", chips.length >= 2);
  paso("filtra las que no son de vídeo (la de Música no sale)",
    !chips.some((c) => /música/i.test(c)));
  paso("la TV en vivo del servidor aparece como sección",
    chips.some((c) => /TV en vivo/i.test(c)));
  paso("pinta la cuadrícula", (await page.$$eval("#srvGrid .srv-card", (n) => n.length)) === 5);
  paso("marca lo ya visto", (await page.$$eval(".srv-visto", (n) => n.length)) === 1);
  paso("dice cuántos títulos hay", /120/.test(await page.textContent("#srvInfo")));

  await page.fill("#srvSearch", "pelicula");
  await page.waitForTimeout(800);
  paso("la búsqueda va al servidor", ultimoCatalogo(pedidas).buscar === "pelicula");
  await page.selectOption("#srvSort", "DateCreated");
  await page.waitForTimeout(700);
  paso("se puede ordenar por añadido hace poco", ultimoCatalogo(pedidas).orden === "DateCreated");
  paso("hay «cargar más» (120 títulos, 48 por página)",
    await page.evaluate(() => !document.getElementById("srvMore").classList.contains("hidden")));
  await page.click("#srvMore");
  await page.waitForTimeout(700);
  paso("la siguiente página pide desde el índice 48", ultimoCatalogo(pedidas).inicio === "48");

  paso("sin errores de consola (catálogo)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Series → episodios ============ */
{
  seccion("Series → episodios → volver");
  const { ctx, page, errores, pedidas } = await nuevaPagina();
  await irAlServidor(page);
  await conectar(page);

  await page.click('#srvLibs .chip:nth-child(2)');   // biblioteca de Series
  await page.waitForTimeout(800);
  paso("la biblioteca de series pide solo series", ultimoCatalogo(pedidas).tipos === "Series");

  await page.click("#srvGrid .srv-card");
  await page.waitForTimeout(900);
  paso("al pulsar una serie se piden sus episodios",
    pedidas.some((x) => x.p === "/Shows/s1/Episodes"));
  const eps = await page.$$eval("#srvGrid .srv-card .card-title", (n) => n.map((x) => x.textContent.trim()));
  console.log("     episodios:", JSON.stringify(eps));
  paso("se listan con temporada y número", eps.some((e) => /T1E1/.test(e)));
  paso("aparece el botón de volver",
    await page.evaluate(() => !document.getElementById("srvBack").classList.contains("hidden")));
  await page.click("#srvBack");
  await page.waitForTimeout(800);
  paso("volver deja otra vez las series",
    (await page.$$eval("#srvGrid .srv-card .card-title", (n) => n.map((x) => x.textContent))).some((x) => /Mi serie/.test(x)));
  paso("sin errores de consola (series)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Reproducción y transporte de la clave en las URLs ============ */
{
  seccion("Reproducción — desde TU servidor, y con la clave actual");
  const { ctx, page, errores } = await nuevaPagina();
  await irAlServidor(page);
  await conectar(page);

  const urls = await page.evaluate(async () => {
    const m = await import("/js/media.js");
    return { portada: m.portada("m0", "tag0"), hls: m.urlHls("m0"), directa: m.urlDirecta("m0") };
  });
  const todas = Object.values(urls).join(" ");
  paso("las portadas y el vídeo usan ApiKey, el nombre actual de Jellyfin",
    /ApiKey=clave-secreta-123/.test(urls.portada) && /ApiKey=clave-secreta-123/.test(urls.hls) &&
    /ApiKey=clave-secreta-123/.test(urls.directa));
  paso("y mandan también api_key, que es el único que entiende Emby",
    (urls.portada.match(/api_key=/g) || []).length === 1 && /api_key=/.test(urls.hls));
  paso("todo apunta a tu servidor y a nada más",
    !/workers\.dev|proxyvideo|embedstream|zonaaps/i.test(todas) &&
    Object.values(urls).every((u) => u.startsWith("https://mi-jelly.example/")));

  await page.click("#srvGrid .srv-card");
  await page.waitForTimeout(900);
  paso("se abre el reproductor",
    await page.evaluate(() => !document.getElementById("srvPlayer").classList.contains("hidden")));
  paso("con el título de la película", /Mi película/.test(await page.textContent("#srvNow")));

  await page.click("#srvCerrarPlayer");
  await page.waitForTimeout(300);
  paso("cerrar detiene el vídeo y esconde el reproductor",
    await page.evaluate(() => {
      const v = document.getElementById("srvVideo");
      return document.getElementById("srvPlayer").classList.contains("hidden") && !v.getAttribute("src");
    }));

  await page.evaluate(() =>
    document.querySelectorAll('.nav-tab[data-view="tv"]').forEach((b) => b.click()));
  await page.waitForTimeout(400);
  paso("cambiar de pestaña no deja vídeo en segundo plano",
    await page.evaluate(() => document.getElementById("srvVideo").paused));
  paso("sin errores de consola (reproducción)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Los fallos reales, cada uno con su mensaje ============ */
{
  seccion("Diagnóstico — cada fallo con su mensaje y su arreglo");

  // 1) clave rechazada de las dos formas → es la clave
  const a = await nuevaPagina({ claveMala: true });
  await irAlServidor(a.page);
  await a.page.fill("#srvUrl", SRV);
  await a.page.fill("#srvKey", "mala");
  await a.page.click("#srvGuardar");
  await a.page.waitForTimeout(1800);
  const ps = await pasosEnPantalla(a.page);
  console.log("     clave mala →", (ps[1]?.texto || "").slice(0, 78));
  paso("con clave inválida dice que la revise", /rechaz(ó|o) la clave/i.test(ps[1]?.texto || ""));
  paso("no se marca ningún paso posterior en verde", ps.length === 2);
  paso("y NO guarda una conexión que no funciona",
    await a.page.evaluate(() => !localStorage.getItem("anilector.server")));
  paso("el catálogo sigue oculto",
    await a.page.evaluate(() => document.getElementById("srvCatalogo").classList.contains("hidden")));
  await a.ctx.close();

  // 2) servidor inalcanzable → CORS/alcance, con la pista del proxy
  const b = await nuevaPagina();
  await irAlServidor(b.page);
  await b.page.route(/otro-servidor\.example/, (r) => r.abort());
  await b.page.fill("#srvUrl", "https://otro-servidor.example");
  await b.page.click("#srvProbar");
  await b.page.waitForTimeout(1500);
  const ps2 = await pasosEnPantalla(b.page);
  console.log("     inalcanzable →", (ps2[0]?.texto || "").slice(0, 90));
  paso("si no se alcanza, explica el permiso que falta y cómo ponerlo",
    /Access-Control-Allow-Origin/i.test(ps2[0]?.texto || ""));
  await b.ctx.close();

  // 3) contenido mixto: la app en https y el servidor en http
  const c = await nuevaPagina();
  const dx = await c.page.evaluate(async () => {
    const m = await import("/js/media.js");
    const r = await m.diagnostico("http://192.168.1.50:8096", "x");
    return { mensaje: r.pasos[0]?.detalle || "" };
  });
  console.log("     http desde local →", (dx.mensaje || "").slice(0, 80));
  paso("el diagnóstico devuelve un mensaje útil, no «Failed to fetch»",
    !!dx.mensaje && !/failed to fetch/i.test(dx.mensaje));
  const media = await (await fetch(`${BASE}/js/media.js`)).text();
  paso("y contempla explícitamente el caso de contenido mixto (https + http)",
    /location\.protocol === "https:"/.test(media) && /errMixto/.test(media));
  paso("la explicación del preflight queda escrita en el código, no solo en el chat",
    /preflight/i.test(media));
  await c.ctx.close();
}

/* ============ Servidor sin TV en vivo ============ */
{
  seccion("Servidor sin TV en vivo — la sección no aparece");
  const { ctx, page, errores } = await nuevaPagina({ sinTv: true });
  await irAlServidor(page);
  await conectar(page);
  const chips = await page.$$eval("#srvLibs .chip", (n) => n.map((x) => x.textContent.trim()));
  console.log("     bibliotecas:", JSON.stringify(chips));
  paso("no se ofrece TV en vivo si el servidor no la tiene",
    !chips.some((c) => /TV en vivo/i.test(c)));
  paso("el resto del catálogo funciona igual",
    (await page.$$eval("#srvGrid .srv-card", (n) => n.length)) === 5);
  paso("sin errores de consola (sin TV)", errores.length === 0);
  await ctx.close();
}

/* ============ La clave es una credencial ============ */
{
  seccion("La clave no viaja a ninguna parte");
  const pwa = await (await fetch(`${BASE}/js/pwa.js`)).text();
  const auth = await (await fetch(`${BASE}/js/auth.js`)).text();
  paso("no entra en la copia de seguridad", !/anilector\.server/.test(pwa));
  paso("no se sincroniza con Drive", !/anilector\.server/.test(auth));
  const media = await (await fetch(`${BASE}/js/media.js`)).text();
  paso("y está escrito por qué, para que nadie la añada por error", /credencial/i.test(media));

  const { ctx, page } = await nuevaPagina();
  await irAlServidor(page);
  await conectar(page);
  paso("mientras está guardada, existe en el almacenamiento",
    await page.evaluate(() => !!localStorage.getItem("anilector.server")));
  await page.click("#srvBorrar");
  await page.waitForTimeout(200);
  paso("el primer clic de «Borrar» solo pregunta",
    /Borrar\?/.test(await page.textContent("#srvBorrar")) &&
    (await page.evaluate(() => !!localStorage.getItem("anilector.server"))));
  await page.click("#srvBorrar");
  await page.waitForTimeout(500);
  paso("el segundo la borra del aparato",
    await page.evaluate(() => !localStorage.getItem("anilector.server")));
  paso("y la vista vuelve a su aviso inicial",
    await page.evaluate(() => !document.getElementById("srvEmpty").classList.contains("hidden")));
  await ctx.close();
}

/* ============ Vistas de usuario vacías: se sigue buscando ============ */
{
  seccion("Vistas del usuario vacías — se prueban las demás vías");
  const { ctx, page, errores, pedidas } = await nuevaPagina({ vistasVacias: true });
  await irAlServidor(page);
  await conectar(page);

  const ps = await pasosEnPantalla(page);
  console.log("     pasos:", JSON.stringify(ps.map((x) => (x.ok ? "✓" : "✗") + " " + x.texto.slice(0, 46))));
  paso("una lista vacía no se da por definitiva: sigue con la vía siguiente",
    ps.length === 3 && ps.every((x) => x.ok));
  paso("prueba las vistas del usuario", pedidas.some((x) => x.p === "/UserViews"));
  paso("las carpetas del servidor", pedidas.some((x) => x.p === "/Library/MediaFolders"));
  paso("y termina en las bibliotecas configuradas",
    pedidas.some((x) => x.p === "/Library/VirtualFolders"));
  paso("normaliza el id, que ahí viene como ItemId",
    (await page.$$eval("#srvGrid .srv-card", (n) => n.length)) === 5);
  paso("y las bibliotecas salen en los chips",
    (await page.$$eval("#srvLibs .chip", (n) => n.length)) >= 2);
  paso("sin errores de consola (vistas vacías)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ Algo que no es un Jellyfin ============ */
{
  seccion("Una API que no es un servidor de medios — se detecta al primer paso");
  const { ctx, page, errores } = await nuevaPagina({ noEsJelly: true });
  await irAlServidor(page);
  await conectar(page);

  const ps = await pasosEnPantalla(page);
  console.log("     pasos:", JSON.stringify(ps.map((x) => (x.ok ? "✓" : "✗") + " " + x.texto.slice(0, 92))));
  paso("se cae en el PRIMER paso, no tres pasos después", ps.length === 1 && ps[0].ok === false);
  paso("y dice que eso no parece un Jellyfin ni un Emby",
    /no parece un Jellyfin/i.test(ps[0].texto));
  paso("además enseña qué contestó, para no adivinar",
    /contestó: status/i.test(ps[0].texto));
  paso("no guarda nada",
    await page.evaluate(() => !localStorage.getItem("anilector.server")));
  paso("sin errores de consola (no es Jellyfin)", errores.length === 0);
  if (errores.length) console.log("   ", errores.slice(0, 3));
  await ctx.close();
}

/* ============ La línea del proyecto ============ */
{
  seccion("Comprobación de la línea del proyecto");
  const sospechosos = /zonaaps|workers\.dev|moviedays|proxyvideo|embedstream|downloadvideo|\/extract\?/i;
  const archivos = ["index.html", "sw.js", "js/media.js", "js/servervista.js", "js/app.js",
    "js/vod.js", "js/config.js", "js/api.js", "js/i18n.js"];
  const sucios = [];
  for (const f of archivos) {
    const txt = await (await fetch(`${BASE}/${f}`)).text();
    if (sospechosos.test(txt)) sucios.push(f);
  }
  paso("no se coló ninguna referencia a la API de extracción ni a sus endpoints",
    sucios.length === 0);
  if (sucios.length) console.log("   ", sucios);
}

await browser.close();
console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
