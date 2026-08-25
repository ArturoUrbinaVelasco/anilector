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
  { name: "AnimeFénix", lang: "ES", url: "https://animefenix.tv/?s=%s" },
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
   Microservicio que encuentra el ENLACE EXACTO del anime/episodio
   (los proveedores marcados arriba con "provider"). Sin él, la app
   abre la búsqueda del sitio como respaldo. Guía en anilector-api/README.
   Ej: "https://anilector-api.vercel.app"  (sin barra final)
   ------------------------------------------------------------ */
export const BACKEND_URL = "";

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
