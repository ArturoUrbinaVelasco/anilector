/* ============================================================
   AniLector — configuración
   ============================================================
   Inicio de sesión con Google (opcional):
   Pega aquí tu Client ID de OAuth 2.0 (tipo "Aplicación web").
   Guía paso a paso en el README, sección "Inicio de sesión con Google".
   Si se deja vacío, la app funciona igual pero sin sesión ni
   sincronización con Google Drive. */
export const GOOGLE_CLIENT_ID = "458798326994-lt03dlrr87ee3i80pqmogb185fsl797h.apps.googleusercontent.com";

/* ------------------------------------------------------------
   Sitios "Dónde verlo" para ANIME (top 7, editable).
   Cada sitio abre la BÚSQUEDA del título dentro de la app.
   %s se reemplaza por el título. Estos portales cambian de
   dominio con frecuencia: si alguno deja de abrir, actualiza
   aquí su URL y listo (no toques el resto del código).
   ------------------------------------------------------------ */
export const ANIME_SITES = [
  { name: "AnimeFLV",   lang: "ES", provider: "animeflv", url: "https://www3.animeflv.net/browse?q=%s" },
  { name: "TioAnime",   lang: "ES", provider: "tioanime", url: "https://tioanime.com/directorio?q=%s" },
  { name: "JKAnime",    lang: "ES", provider: "jkanime",  url: "https://jkanime.net/buscar/%s/" },
  { name: "AnimeFénix", lang: "ES", url: "https://animefenix2.tv/directorio/anime?q=%s" },
  { name: "AnimeOnegai", lang: "ES", url: "https://www.animeonegai.com/es/search?q=%s" },
  { name: "Crunchyroll", lang: "ES/EN", url: "https://www.crunchyroll.com/es/search?q=%s" },
  { name: "HiAnime",    lang: "EN", url: "https://hianime.to/search?keyword=%s" },
];

/* ------------------------------------------------------------
   Sitios "Dónde leerlo" para MANGA (top 7, editable, español primero).
   MangaDex además entrega el listado real de capítulos por tomo con
   enlace EXACTO (vía su API oficial); el resto abre la búsqueda.
   ------------------------------------------------------------ */
export const MANGA_SITES = [
  { name: "MangaDex", lang: "ES/EN", provider: "mangadex", url: "https://mangadex.org/search?q=%s" },
  { name: "MANGA Plus", lang: "ES/EN", url: "https://mangaplus.shueisha.co.jp/search_result?keyword=%s" },
  { name: "Webtoon", lang: "ES", url: "https://www.webtoons.com/es/search?keyword=%s" },
  { name: "Google Play Libros", lang: "ES", url: "https://play.google.com/store/search?q=%s%20manga&c=books" },
  { name: "Kobo", lang: "ES", url: "https://www.kobo.com/mx/es/search?query=%s" },
  { name: "VIZ Media", lang: "EN", url: "https://www.viz.com/search?search=%s" },
  { name: "Comixology", lang: "EN", url: "https://www.comixology.com/search?search=%s" },
];

/* ------------------------------------------------------------
   Sitios "Dónde leerlo" para LIBROS de dominio público (español primero).
   Todos son legales y gratuitos: obras cuyos derechos ya expiraron o que
   se publican con licencia libre.

   Además de estos enlaces de búsqueda, la app busca el libro en Project
   Gutenberg (API Gutendex) y, si lo encuentra, abre el EPUB DENTRO del
   visor sin salir de AniLector.

   ⚠️ Los buscadores de estos sitios no se pudieron comprobar desde el
   entorno donde se programó esto. Si alguno abre vacío o da error, es
   solo cuestión de corregir su URL AQUÍ (el resto del código no cambia).
   Marcados con (?) los que conviene revisar primero.
   ------------------------------------------------------------ */
export const BOOK_SITES = [
  { name: "Elejandría",        lang: "ES", url: "https://www.elejandria.com/buscar?q=%s" },
  { name: "Textos.info",       lang: "ES", url: "https://www.textos.info/buscar?texto=%s" },      // (?)
  { name: "Cervantes Virtual", lang: "ES", url: "https://www.cervantesvirtual.com/buscador/?q=%s" }, // (?)
  { name: "Wikisource",        lang: "ES", url: "https://es.wikisource.org/w/index.php?search=%s" },
  { name: "PlanetaLibro",      lang: "ES", url: "https://planetalibro.net/?s=%s" },               // (?)
  { name: "Gutenberg",         lang: "ES/EN", url: "https://www.gutenberg.org/ebooks/search/?query=%s" },
  { name: "Standard Ebooks",   lang: "EN", url: "https://standardebooks.org/ebooks?query=%s" },
  { name: "Internet Archive",  lang: "ES/EN", url: "https://archive.org/search?query=%s" },
  { name: "LibriVox 🔊",       lang: "ES/EN", url: "https://librivox.org/search?q=%s&search_form=advanced" },
  { name: "Europeana",         lang: "ES/EN", url: "https://www.europeana.eu/es/search?query=%s" },
  { name: "BNE Hispánica",     lang: "ES", url: "https://bdh.bne.es/bnesearch/Search.do?text=%s" }, // (?)
  { name: "Ganso y Pulpo",     lang: "ES", url: "https://gansoypulpo.com/?s=%s" },                 // (?)
  { name: "Google Libros",     lang: "ES/EN", url: "https://www.google.com/search?tbm=bks&q=%s" },
];
/* Cuántos botones de la lista de arriba se muestran en la ficha. */
export const BOOK_SITES_SHOWN = 9;

/* ------------------------------------------------------------
   Sitios que NO se dejan ver dentro de la app.
   Mandan cabeceras (X-Frame-Options / CSP frame-ancestors) que le
   prohíben al navegador mostrarlos dentro de otra página, y no existe
   forma de saltárselo ni evento fiable para detectarlo: el marco
   simplemente se queda en blanco.
   Al estar aquí, la app avisa ANTES con un botón para abrirlos en una
   pestaña, en lugar de dejarte mirando un recuadro vacío.
   Se compara por dominio (incluye subdominios). Si algún sitio cambia
   de política, basta con quitarlo de esta lista.
   ------------------------------------------------------------ */
export const NO_EMBED_SITES = [
  "mangadex.org",
  "webtoons.com",
  "crunchyroll.com",
  "netflix.com",
  "viz.com",
  "kobo.com",
  "play.google.com",
  "comixology.com",
  "amazon.com",
  "mangaplus.shueisha.co.jp",
  "hianime.to",
  "animeonegai.com",
  "disneyplus.com",
  "primevideo.com",
  "max.com",
  "hidive.com",
];

/* ------------------------------------------------------------
   Microservicio que encuentra el ENLACE EXACTO del anime/episodio
   (los proveedores marcados arriba con "provider"). Sin él, la app
   abre la búsqueda del sitio como respaldo. Guía en anilector-api/README.
   Ej: "https://anilector-api.vercel.app"  (sin barra final)
   ------------------------------------------------------------ */
export const BACKEND_URL = "https://anilector-api.vercel.app";

/* ------------------------------------------------------------
   TV en vivo — listas M3U de código abierto (comunidad, GitHub).
   Agregan canales que se transmiten en ABIERTO y gratis por
   internet (no canales de paga). Prioridad: México. Editable.
   Si una lista deja de servir, cambia su URL aquí.
   ------------------------------------------------------------ */
export const M3U_LISTS = [
  { name: "México · iptv-org", flag: "🇲🇽", url: "https://iptv-org.github.io/iptv/countries/mx.m3u" },
  { name: "México · Free-TV", flag: "🇲🇽", url: "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_mexico.m3u8" },
  { name: "Español · iptv-org", flag: "🌎", url: "https://iptv-org.github.io/iptv/languages/spa.m3u" },
  { name: "Cine 24/7 · iptv-org", flag: "🎬", url: "https://iptv-org.github.io/iptv/categories/movies.m3u" },
];

/* ------------------------------------------------------------
   Películas (VOD) — Internet Archive (dominio público / libres).
   Catálogo 100% legal y gratuito. Categorías editables (son
   "colecciones" reales de archive.org).
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   Apartado "Sitios" — accesos rápidos que se abren EMBEBIDOS
   dentro de AniLector (en vez de una pestaña nueva). Editable.
   Nota: algunos sitios se bloquean a sí mismos para no mostrarse
   dentro de otras páginas; en ese caso no hay forma de forzarlo.
   Ej: { name: "Greentube", url: "https://…" }
   ------------------------------------------------------------ */
export const WEB_APPS = [
  // { name: "Mi Screenarr", url: "http://192.168.1.50:7878" },  // tu panel autohospedado
  // { name: "Mi sitio", url: "https://tu-sitio.example" },
];

/* Buscador de Google DENTRO de la app (Programmable Search Engine).
   Como la página de google.com no se puede embeber, se usa el buscador
   oficial embebible de Google. Crea uno gratis en
   https://programmablesearchengine.google.com (marca "Buscar en toda la web")
   y pega aquí el ID del buscador (cx). Vacío = el buscador abre en pestaña nueva. */
export const GOOGLE_CSE_ID = "";

/* ------------------------------------------------------------
   YouTube (estilo GreenTuber): búsqueda vía instancias Piped
   (frontend abierto de YouTube, con CORS). Reproducción con el
   iframe OFICIAL de YouTube. Si una instancia falla, se prueba la
   siguiente. Puedes reordenar/añadir instancias aquí.
   ------------------------------------------------------------ */
export const PIPED_APIS = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.yt",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.ducks.party",
];

/* Respaldo de búsqueda: instancias Invidious (otro frontend abierto de
   YouTube). Se usan si todas las de Piped fallan. */
export const INVIDIOUS_APIS = [
  "https://invidious.nerdvpn.de",
  "https://inv.nadeko.net",
  "https://yewtu.be",
];

/* API oficial de YouTube (opcional, más estable que Piped).
   Consíguela gratis en Google Cloud → "YouTube Data API v3" → crea una
   clave de API y pégala aquí. Si se deja vacía, solo se usa GreenTuber (Piped). */
export const YOUTUBE_API_KEY = "";

export const VOD_COLLECTIONS = [
  { name: "Destacadas", collection: "feature_films" },
  { name: "Cine en español", query: 'language:(Spanish OR spanish OR español OR castellano)' },
  { name: "Ciencia ficción y terror", collection: "SciFi_Horror" },
  { name: "Cine negro", collection: "film_noir" },
  { name: "Comedia", query: 'subject:(comedy)' },
  { name: "Western", query: 'subject:(western)' },
  { name: "Documentales", query: 'subject:(documentary)' },
  { name: "Animación", collection: "animationandcartoons" },
];

/* Series retro / TV clásica (Internet Archive, dominio público). Editable. */
export const RETRO_COLLECTIONS = [
  { name: "TV clásica", collection: "classic_tv" },
  { name: "Todo TV retro", query: 'subject:(television)' },
  { name: "En español", query: 'subject:(television) AND language:(Spanish OR spanish OR español)' },
  { name: "Caricaturas retro", collection: "animationandcartoons" },
  { name: "Ciencia ficción", query: 'subject:(television) AND subject:("science fiction")' },
  { name: "Comedia", query: 'subject:(television) AND subject:(comedy)' },
  { name: "Western", query: 'subject:(television) AND subject:(western)' },
  { name: "Terror y misterio", query: 'subject:(television) AND (subject:(horror) OR subject:(mystery))' },
  { name: "Aventura y acción", query: 'subject:(television) AND (subject:(adventure) OR subject:(action))' },
  { name: "Drama", query: 'subject:(television) AND subject:(drama)' },
  { name: "Infantil", query: 'subject:(television) AND (subject:(children) OR subject:(kids))' },
  { name: "Superhéroes", query: 'subject:(television) AND subject:(superhero)' },
  { name: "Noticieros y documental", query: 'subject:(television) AND (subject:(news) OR subject:(documentary))' },
  { name: "Anuncios retro", query: 'subject:(commercials OR advertising)' },
];
