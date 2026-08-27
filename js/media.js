/* ============================================================
   AniLector — «Mi servidor»: tu propio Jellyfin o Emby
   ------------------------------------------------------------
   Un cliente para TU servidor de medios. Aquí NO hay ninguna
   dirección escrita en el código: la URL y la clave las escribes
   tú en el panel de conexión y viven en localStorage. Si están
   vacías, la vista lo dice y no intenta nada.

   Sirve para lo que TÚ tienes en tu servidor: tus películas, tus
   series y, si tu Jellyfin tiene TV en vivo configurada, sus
   canales. La app solo habla con la dirección que le des.

   ⚠️ LA CLAVE NO SE SINCRONIZA NI SE EXPORTA. Es una credencial:
   ni viaja a Drive ni entra en la copia de seguridad, para que un
   respaldo compartido no regale el acceso a tu servidor. Se queda
   en el aparato donde la escribiste. Está fuera de `CLAVES` en
   pwa.js y fuera de `KEYS` en auth.js a propósito.
   ============================================================ */
import { t } from "./i18n.js";

const CLAVE = "anilector.server";
const POR_PAGINA = 48;

/* ---------- configuración ---------- */
export function leerConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE) || "{}");
    return {
      url: (c.url || "").trim().replace(/\/+$/, ""),   // sin barra final
      key: (c.key || "").trim(),
      userId: c.userId || "",
      userName: c.userName || "",
      deviceId: c.deviceId || nuevoDeviceId(),
    };
  } catch {
    return { url: "", key: "", userId: "", userName: "", deviceId: nuevoDeviceId() };
  }
}
function guardarConfig(c) {
  try { localStorage.setItem(CLAVE, JSON.stringify(c)); } catch (_) {}
}
/* Un identificador estable para que tu servidor liste «AniLector»
   como un aparato reconocible en su panel, y no uno nuevo cada vez. */
function nuevoDeviceId() {
  return "anilector-" + Math.random().toString(36).slice(2, 12);
}
export function hayConfig() {
  const c = leerConfig();
  return !!(c.url && c.key && c.userId);
}

/* ---------- peticiones ---------- */
/* Solo `Token` es obligatorio; el resto lo pide Jellyfin «de buenas
   maneras» para poder identificar el cliente en su panel de mandos. */
function cabeceras(c) {
  return {
    Authorization: `MediaBrowser Token="${c.key}", Client="AniLector", ` +
      `Device="Navegador", DeviceId="${c.deviceId}", Version="3.17"`,
  };
}

/* El diagnóstico es la parte que más tiempo ahorra. Un `fetch` que
   falla desde el navegador NO dice por qué, y en este escenario hay
   tres culpables muy distintos con arreglos muy distintos. */
function diagnosticar(e, url) {
  if (e?.estado === 401 || e?.estado === 403) return t("srv.errKey");
  if (e?.estado === 404) return t("srv.err404");
  if (e?.estado) return `HTTP ${e.estado}`;

  // Contenido mixto: la app va por https y el servidor por http. El
  // navegador lo bloquea siempre, y es el fallo más probable con un
  // Jellyfin de casa en una IP local.
  const appSegura = location.protocol === "https:";
  if (appSegura && /^http:\/\//i.test(url)) return t("srv.errMixto");

  // Si no, casi seguro es CORS o que no se alcanza el servidor.
  return t("srv.errCors");
}

async function pedir(ruta, params = {}) {
  const c = leerConfig();
  if (!c.url) throw new Error(t("srv.errSinUrl"));
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== "" && v != null));
  const url = `${c.url}${ruta}${qs.toString() ? "?" + qs : ""}`;
  let res;
  try {
    res = await fetch(url, { headers: cabeceras(c) });
  } catch (e) {
    const err = new Error(diagnosticar(e, c.url));
    err.diagnostico = true;
    throw err;
  }
  if (!res.ok) {
    const e = new Error("");
    e.estado = res.status;
    const err = new Error(diagnosticar(e, c.url));
    err.diagnostico = true;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

/* ---------- API del servidor ---------- */
/* `/System/Info/Public` no pide autenticación: es la forma limpia de
   comprobar que la dirección responde y que hay un Jellyfin detrás,
   antes de culpar a la clave. */
export async function probar(url) {
  const limpia = String(url || "").trim().replace(/\/+$/, "");
  if (!limpia) throw new Error(t("srv.errSinUrl"));
  let res;
  try {
    res = await fetch(`${limpia}/System/Info/Public`);
  } catch (e) {
    const err = new Error(diagnosticar(e, limpia));
    err.diagnostico = true;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(diagnosticar({ estado: res.status }, limpia));
    err.diagnostico = true;
    throw err;
  }
  const d = await res.json();
  return { nombre: d.ServerName || "?", version: d.Version || "?" };
}

export const usuarios = () => pedir("/Users");
export const bibliotecas = (userId) => pedir(`/Users/${userId}/Views`);

export function portada(id, tag) {
  const c = leerConfig();
  if (!c.url || !id) return "";
  // La clave va en la dirección porque una <img> no puede llevar
  // cabeceras propias. Es la vía que el propio Jellyfin ofrece.
  const p = new URLSearchParams({ maxHeight: "450", quality: "88", api_key: c.key });
  if (tag) p.set("tag", tag);
  return `${c.url}/Items/${id}/Images/Primary?${p}`;
}

export function items({ userId, parentId, tipos, buscar, orden, pagina = 1 }) {
  return pedir(`/Users/${userId}/Items`, {
    ParentId: parentId || "",
    IncludeItemTypes: tipos || "Movie,Series",
    Recursive: "true",
    Fields: "PrimaryImageAspectRatio,ProductionYear,UserData",
    ImageTypeLimit: "1",
    EnableImageTypes: "Primary",
    SortBy: orden || "SortName",
    SortOrder: (orden === "DateCreated" || orden === "CommunityRating") ? "Descending" : "Ascending",
    SearchTerm: buscar || "",
    StartIndex: String((pagina - 1) * POR_PAGINA),
    Limit: String(POR_PAGINA),
  });
}

export const episodios = (userId, seriesId) =>
  pedir(`/Shows/${seriesId}/Episodes`, { userId, Fields: "ProductionYear", SortBy: "SortName" });

export const canales = (userId) =>
  pedir("/LiveTv/Channels", { userId, Limit: "300", Fields: "PrimaryImageAspectRatio" });

/* Direcciones de reproducción. La clave viaja como `api_key` porque el
   <video> y los trozos del HLS no pueden llevar cabeceras. */
export function urlHls(id) {
  const c = leerConfig();
  const p = new URLSearchParams({
    api_key: c.key,
    MediaSourceId: id,
    VideoCodec: "h264",
    AudioCodec: "aac,mp3",
    TranscodingMaxAudioChannels: "2",
  });
  return `${c.url}/Videos/${id}/master.m3u8?${p}`;
}
/* Reproducción directa, sin convertir: va mejor cuando el archivo ya
   es compatible con el navegador, y evita cargar de trabajo al servidor. */
export function urlDirecta(id) {
  const c = leerConfig();
  return `${c.url}/Videos/${id}/stream?static=true&api_key=${encodeURIComponent(c.key)}`;
}

export const PAGINA = POR_PAGINA;
export const guardar = guardarConfig;
