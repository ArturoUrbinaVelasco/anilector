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
  { name: "AnimeFénix", lang: "ES", url: "https://animefenix.tv/?s=%s" },
  { name: "AnimeFLV",   lang: "ES", url: "https://www3.animeflv.net/browse?q=%s" },
  { name: "JKAnime",    lang: "ES", url: "https://jkanime.net/buscar/%s/" },
  { name: "TioAnime",   lang: "ES", url: "https://tioanime.com/directorio?q=%s" },
  { name: "AnimeOnegai", lang: "ES", url: "https://www.animeonegai.com/es/search?q=%s" },
  { name: "Crunchyroll", lang: "ES/EN", url: "https://www.crunchyroll.com/es/search?q=%s" },
  { name: "HiAnime",    lang: "EN", url: "https://hianime.to/search?keyword=%s" },
];
