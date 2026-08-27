/* ============================================================
   Jellyfin de pruebas para AniLector
   ------------------------------------------------------------
   Un servidor de mentira que habla como un Jellyfin de verdad,
   para poder validar el apartado «Mi servidor» sin depender de
   que tengas uno montado.

   CÓMO SE USA
     node jellyfin-de-pruebas.mjs
   y en AniLector → Mi servidor → Conexión:
     URL:   http://localhost:8096
     Clave: la que quieras (cualquier texto no vacío)

   Si abres AniLector por https, el navegador BLOQUEARÁ un
   servidor en http: para probar, abre AniLector en local
   (Iniciar-AniLector.bat) y así los dos van por http.

   CÓMO ROMPERLO A PROPÓSITO
   Cada avería reproduce un fallo real, para ver qué dice el
   panel de conexión en cada caso:

     --sin-cabecera    rechaza la cabecera Authorization, como un
                       servidor con el CORS a medio configurar.
                       AniLector debe conectar IGUAL, por la otra vía.
     --vistas-vacias   las vistas del usuario llegan vacías; las
                       bibliotecas solo aparecen por la cuarta vía.
     --sin-usuarios    la clave no puede listar usuarios: AniLector
                       debe seguir, avisando de que no marcará lo visto.
     --rutas-viejas    solo entiende las rutas antiguas (Emby, 10.8).
     --sin-tv          sin TV en vivo: esa sección no debe aparecer.
     --clave-mala      rechaza cualquier clave (401).
     --no-soy-jellyfin contesta JSON a todo sin ser un servidor de
                       medios: AniLector debe cazarlo en el PASO 1.
     --webm            sirve el vídeo en WebM en vez de MP4. Solo hace
                       falta en navegadores compilados sin H.264 (el
                       Chromium de las pruebas automáticas); Chrome y
                       Edge normales reproducen los dos.

   Se pueden combinar. Ctrl+C para parar.
   Sin dependencias: solo Node.
   ============================================================ */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PORT || 8096);
const F = new Set(process.argv.slice(2));
const av = (n) => F.has("--" + n);

const PELIS = [
  "Duelo en la niebla", "Aurora", "El último tren", "Casa de papel",
  "Verano del 99", "Camino largo", "Mar adentro", "La torre",
  "Cielo rojo", "Nadie en casa", "Cuatro estaciones", "Andén 7",
].map((Name, i) => ({
  Id: `m${i}`, Name, Type: "Movie", ProductionYear: 2005 + i,
  ImageTags: { Primary: `t${i}` }, UserData: { Played: i % 5 === 0 },
}));
const SERIES = [
  { Id: "s1", Name: "La casa del árbol", Type: "Series", ProductionYear: 2019, ImageTags: { Primary: "s1" } },
  { Id: "s2", Name: "ノースライト", Type: "Series", ProductionYear: 2021, ImageTags: { Primary: "s2" } },
];
const EPIS = Array.from({ length: 8 }, (_, i) => ({
  Id: `e${i}`, Name: `Episodio ${i + 1}`, Type: "Episode", SeriesName: "La casa del árbol",
  ParentIndexNumber: 1, IndexNumber: i + 1, ImageTags: { Primary: `e${i}` },
}));
const CANALES = [
  { Id: "c1", Name: "Canal de casa", Type: "TvChannel", ImageTags: { Primary: "c1" } },
  { Id: "c2", Name: "Cocina 24h", Type: "TvChannel", ImageTags: { Primary: "c2" } },
];
const LIBS = [
  { Id: "lib1", Name: "Películas", CollectionType: "movies" },
  { Id: "lib2", Name: "Series", CollectionType: "tvshows" },
  { Id: "lib9", Name: "Música", CollectionType: "music" },   // AniLector debe filtrarla
];

const servidor = createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PUERTO}`);
  const p = u.pathname.replace(/\/+$/, "") || "/";
  const cab = req.headers["authorization"] || "";
  const porUrl = u.searchParams.get("ApiKey") || u.searchParams.get("api_key") || "";

  /* --- CORS ---
     Un Jellyfin recién instalado NO trae esto puesto: es la razón
     nº1 por la que un cliente web no conecta. Aquí va abierto,
     salvo que se pida la avería `--sin-cabecera`. */
  const origen = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origen);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
  if (!av("sin-cabecera")) {
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Emby-Token");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    // Con `--sin-cabecera` el preflight se rechaza: es exactamente lo
    // que hace un servidor que permite el origen pero no la cabecera.
    res.writeHead(av("sin-cabecera") ? 403 : 204).end();
    return log(req, p, av("sin-cabecera") ? 403 : 204, "preflight");
  }

  const json = (o, code = 200) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(o));
    log(req, p, code);
  };
  const vacio = (code) => { res.writeHead(code).end(); log(req, p, code); };

  // Una API cualquiera que contesta JSON a todo, sin ser un servidor
  // de medios. AniLector debe cazarlo en el primer paso.
  if (av("no-soy-jellyfin")) return json({ status: "ready" });

  // Lo público no lleva clave: sirve para saber que la dirección responde.
  if (p === "/System/Info/Public") {
    return json({
      Id: "servidor-de-pruebas", ServerName: "Servidor de pruebas",
      Version: "10.9.11", ProductName: "Jellyfin Server",
      OperatingSystem: process.platform, StartupWizardCompleted: true,
    });
  }

  // A partir de aquí, todo exige clave: si no, la prueba no probaría nada.
  if (av("sin-cabecera") && cab) return vacio(403);
  if (!cab && !porUrl) return vacio(401);
  if (av("clave-mala")) return vacio(401);

  const viejas = av("rutas-viejas");
  const uid = "u1";

  if (p === "/System/Info") return json({ ServerName: "Servidor de pruebas", Version: "10.9.11" });

  if (p === "/Users") {
    if (av("sin-usuarios")) return json([]);
    return json([
      { Id: uid, Name: "Arturo", Policy: { IsAdministrator: true } },
      { Id: "u2", Name: "Invitado" },
    ]);
  }

  /* Bibliotecas por las cuatro vías que prueba AniLector. */
  if (p === "/UserViews") return viejas ? vacio(404) : json({ Items: av("vistas-vacias") ? [] : LIBS });
  if (p === `/Users/${uid}/Views`) return json({ Items: av("vistas-vacias") ? [] : LIBS });
  if (p === "/Library/MediaFolders") return json({ Items: av("vistas-vacias") ? [] : LIBS });
  if (p === "/Library/VirtualFolders") {
    // Forma distinta a propósito: aquí el id viene en `ItemId`.
    return json(LIBS.map((l) => ({ Name: l.Name, ItemId: l.Id, CollectionType: l.CollectionType })));
  }

  if (p === "/LiveTv/Channels") {
    if (av("sin-tv")) return vacio(404);
    return json({ Items: CANALES, TotalRecordCount: CANALES.length });
  }

  if (p === "/Items" || p === `/Users/${uid}/Items`) {
    if (p === "/Items" && viejas) return vacio(404);
    const tipos = u.searchParams.get("IncludeItemTypes") || "";
    const buscar = (u.searchParams.get("SearchTerm") || "").toLowerCase();
    const desde = Number(u.searchParams.get("StartIndex") || 0);
    const limite = Number(u.searchParams.get("Limit") || 48);
    let base = tipos === "Series" ? SERIES : tipos === "Movie" ? PELIS : [...PELIS, ...SERIES];
    if (buscar) base = base.filter((x) => x.Name.toLowerCase().includes(buscar));
    if (u.searchParams.get("SortOrder") === "Descending") base = [...base].reverse();
    return json({ Items: base.slice(desde, desde + limite), TotalRecordCount: base.length });
  }

  const ep = p.match(/^\/Shows\/([^/]+)\/Episodes$/);
  if (ep) return json({ Items: EPIS, TotalRecordCount: EPIS.length });

  /* Portadas: se dibujan al vuelo, así no hay que traer imágenes. */
  const img = p.match(/^\/Items\/([^/]+)\/Images\//);
  if (img) {
    const semilla = [...img[1]].reduce((a, c) => a + c.charCodeAt(0), 0);
    const tono = (semilla * 37) % 360;
    res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8" });
    res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450">
  <rect width="300" height="450" fill="hsl(${tono},42%,26%)"/>
  <circle cx="150" cy="170" r="70" fill="hsl(${tono},58%,52%)" opacity=".5"/>
  <text x="150" y="390" font-family="sans-serif" font-size="20" fill="#fff"
        text-anchor="middle" opacity=".85">${img[1]}</text>
</svg>`);
    return log(req, p, 200, "portada");
  }

  /* Reproducción.
     · master.m3u8 → una lista HLS real, con la clave metida en cada
       trozo (los trozos los pide el reproductor por su cuenta y no
       heredan la de la lista).
     · stream?static=true → el archivo tal cual, con soporte de Range
       para poder saltar por el vídeo. */
  const hls = p.match(/^\/Videos\/([^/]+)\/master\.m3u8$/);
  if (hls) {
    const clave = encodeURIComponent(porUrl || "x");
    const lista = (await readFile(join(AQUI, "lista.m3u8"), "utf8"))
      .replace('URI="init.mp4"', `URI="/Videos/${hls[1]}/hls/init.mp4?ApiKey=${clave}"`)
      .replace(/^seg0\.m4s$/m, `/Videos/${hls[1]}/hls/seg0.m4s?ApiKey=${clave}`);
    res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
    res.end(lista);
    return log(req, p, 200, "hls");
  }
  const trozo = p.match(/^\/Videos\/[^/]+\/hls\/(init\.mp4|seg\d+\.m4s)$/);
  if (trozo) return enviarArchivo(req, res, join(AQUI, trozo[1]), "video/mp4", p);
  if (/^\/Videos\/[^/]+\/stream$/.test(p)) {
    const webm = av("webm");
    return enviarArchivo(req, res, join(AQUI, webm ? "muestra.webm" : "muestra.mp4"),
      webm ? "video/webm" : "video/mp4", p);
  }

  // Lo que Jellyfin no conoce, tampoco este.
  vacio(404);
});

/* Envío de archivos con Range: sin esto el vídeo no deja saltar. */
async function enviarArchivo(req, res, ruta, tipo, p) {
  let info;
  try { info = await stat(ruta); } catch { res.writeHead(404).end(); return log(req, p, 404); }
  const rango = req.headers.range;
  if (rango) {
    const m = /bytes=(\d*)-(\d*)/.exec(rango) || [];
    const ini = m[1] ? Number(m[1]) : 0;
    const fin = m[2] ? Number(m[2]) : info.size - 1;
    res.writeHead(206, {
      "content-type": tipo,
      "content-range": `bytes ${ini}-${fin}/${info.size}`,
      "accept-ranges": "bytes",
      "content-length": fin - ini + 1,
    });
    createReadStream(ruta, { start: ini, end: fin }).pipe(res);
    return log(req, p, 206);
  }
  res.writeHead(200, { "content-type": tipo, "content-length": info.size, "accept-ranges": "bytes" });
  createReadStream(ruta).pipe(res);
  log(req, p, 200);
}

/* El registro en pantalla es media herramienta: se ve al momento qué
   pide AniLector, con qué clave y por qué vía viaja. */
function log(req, p, code, nota = "") {
  if (process.env.SILENCIO) return;
  const via = req.headers["authorization"] ? "cabecera" : "dirección";
  const color = code >= 400 ? "\x1b[31m" : "\x1b[32m";
  console.log(`${color}${String(code).padEnd(3)}\x1b[0m ${req.method.padEnd(4)} ${p.padEnd(38)} ${via} ${nota}`);
}

servidor.listen(PUERTO, () => {
  const averias = [...F].join(" ") || "ninguna";
  console.log(`
  Jellyfin de pruebas escuchando en  http://localhost:${PUERTO}

  En AniLector → Mi servidor → Conexión:
    URL:   http://localhost:${PUERTO}
    Clave: cualquier texto (por ejemplo  prueba-123 )

  Averías activas: ${averias}
  Ctrl+C para parar.
`);
});
