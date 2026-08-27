/* ============================================================
   AniLector — service worker
   ------------------------------------------------------------
   Hace dos cosas:

   1) La app abre al instante y funciona sin conexión para lo que no
      necesita internet (el visor, tus archivos locales, la interfaz).

   2) ARREGLA EL PROBLEMA DE LAS VERSIONES VIEJAS. GitHub Pages sirve
      el CSS y el JS con caché de unos minutos, y eso provocó que el
      index.html nuevo cargara con el i18n.js viejo (salían textos
      como "mnav.tv" y la barra sin estilos). Aquí la caché la
      controlamos nosotros: al cambiar VERSION se borra la anterior
      entera, así que o está todo nuevo o todo viejo, nunca mezclado.

   ⚠️ AL PUBLICAR UNA VERSIÓN NUEVA, SUBE EL NÚMERO DE `VERSION`.
      Es el único paso manual; sin él los navegadores seguirán con la
      copia guardada.
   ============================================================ */
const VERSION = "v3.16.0";
const CACHE = `anilector-${VERSION}`;
/* Buzón de lo que te comparten desde otra app. Va aparte de la caché
   de la app porque NO debe borrarse al publicar una versión nueva. */
const CACHE_COMPARTIR = "anilector-compartido";

/* El esqueleto de la app. Las librerías de /vendor son grandes pero se
   guardan una sola vez y valen mucho sin conexión. */
const SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/api.js",
  "./js/auth.js",
  "./js/brand.js",
  "./js/config.js",
  "./js/i18n.js",
  "./js/tv.js",
  "./js/vod.js",
  "./js/tvmode.js",
  "./js/docs.js",
  "./js/entradas.js",
  "./js/translate.js",
  "./js/viewer.js",
  "./js/webapps.js",
  "./js/youtube.js",
  "./js/pwa.js",
  "./vendor/jszip/jszip.min.js",
  "./vendor/pdfjs/pdf.min.js",
  "./vendor/pdfjs/pdf.worker.min.js",
  "./vendor/epubjs/epub.min.js",
  "./vendor/marked.esm.js",
  "./vendor/libarchive/libarchive.js",
  "./vendor/libarchive/worker-bundle.js",
  "./vendor/libarchive/libarchive.wasm",
  "./vendor/foliate/mobi.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // addAll falla entero si un archivo falta; se añaden de uno en uno
    // para que un despiste no deje la app sin service worker.
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();      // la versión nueva no espera a que cierres pestañas
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres
      // ⚠️ El buzón de compartidos se salva a propósito: si alguien
      // comparte un archivo justo mientras se activa una versión nueva,
      // borrarlo aquí lo haría desaparecer camino de la app.
      .filter((n) => n.startsWith("anilector-") && n !== CACHE && n !== CACHE_COMPARTIR)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
    // Avisar a las pestañas abiertas de que hay versión nueva.
    const clientes = await self.clients.matchAll({ type: "window" });
    for (const c of clientes) c.postMessage({ tipo: "sw-actualizado", version: VERSION });
  })());
});

self.addEventListener("message", (e) => {
  if (e.data?.tipo === "saltar-espera") self.skipWaiting();
});

/* Estrategias:
   · HTML  → red primero (para ver los cambios cuanto antes), caché si no hay red.
   · resto del mismo origen → caché primero (ya está versionada).
   · otros dominios (CDN, APIs, streams) → NO se tocan: nunca se cachean,
     porque son datos vivos y cachearlos daría resultados obsoletos. */
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const urlPeticion = new URL(req.url);

  /* ---------- «Compartir con AniLector» ----------
     Al compartir desde otra app, el navegador hace un POST a ./compartir.
     Ese POST no sale a ningún servidor —GitHub Pages solo sirve archivos
     estáticos y no sabría qué hacer con él—: lo atendemos aquí. Los
     archivos se dejan en un buzón (Cache Storage) y se reenvía a la app
     con ?compartido=N para que los recoja.
     El nombre del archivo viaja en una cabecera propia, codificado,
     porque las cabeceras HTTP solo admiten ASCII. */
  if (req.method === "POST" && urlPeticion.pathname.endsWith("/compartir")) {
    e.respondWith((async () => {
      const base = self.registration.scope;
      try {
        const datos = await req.formData();
        const archivos = datos.getAll("archivos").filter((f) => f && f.size >= 0 && f.name);

        if (archivos.length) {
          const cache = await caches.open(CACHE_COMPARTIR);
          await Promise.all(archivos.map((f, i) => cache.put(
            new URL(`compartido/${i}`, base).href,
            new Response(f, {
              headers: {
                "content-type": f.type || "application/octet-stream",
                "x-nombre": encodeURIComponent(f.name || `archivo-${i}`),
              },
            }))));
          return Response.redirect(
            new URL(`index.html?compartido=${archivos.length}`, base).href, 303);
        }

        // Sin archivos: puede ser un enlace compartido desde el navegador.
        const enlace = (datos.get("enlace") || datos.get("texto") || "").toString().trim();
        const soloUrl = (enlace.match(/https?:\/\/\S+/) || [])[0];
        if (soloUrl) {
          return Response.redirect(
            new URL(`index.html?abrir=${encodeURIComponent(soloUrl)}`, base).href, 303);
        }
      } catch (_) {
        // Que un fallo aquí no deje al usuario en una pantalla de error.
      }
      return Response.redirect(new URL("index.html", base).href, 303);
    })());
    return;
  }

  if (req.method !== "GET") return;

  const url = urlPeticion;
  if (url.origin !== self.location.origin) return;      // fuera: sin tocar
  if (url.pathname.startsWith("/api/")) return;         // proxy del servidor local

  const esHTML = req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (esHTML) {
    e.respondWith((async () => {
      try {
        const red = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, red.clone());
        return red;
      } catch (_) {
        return (await caches.match(req)) ||
               (await caches.match("./index.html")) ||
               Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const guardado = await caches.match(req);
    if (guardado) return guardado;
    try {
      const red = await fetch(req);
      if (red.ok && red.type === "basic") {
        const c = await caches.open(CACHE);
        c.put(req, red.clone());
      }
      return red;
    } catch (_) {
      return guardado || Response.error();
    }
  })());
});
