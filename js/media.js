/* ============================================================
   AniLector — «Mi servidor»: tu propio Jellyfin o Emby
   ------------------------------------------------------------
   Un cliente para TU servidor de medios. Aquí NO hay ninguna
   dirección escrita en el código: la URL y la clave las escribes
   tú en el panel de conexión y viven en localStorage. Si están
   vacías, la vista lo dice y no intenta nada.

   ⚠️ LA CLAVE NO SE SINCRONIZA NI SE EXPORTA. Es una credencial:
   ni viaja a Drive ni entra en la copia de seguridad, para que un
   respaldo compartido no regale el acceso a tu servidor. Se queda
   en el aparato donde la escribiste. Está fuera de `CLAVES` en
   pwa.js y fuera de `KEYS` en auth.js a propósito.

   ============================================================
   v3.18 — POR QUÉ «LA CLAVE FUNCIONA PERO NO DEVUELVE USUARIOS»
   ------------------------------------------------------------
   En v3.17 «Probar conexión» solo consultaba /System/Info/Public,
   que NO lleva autenticación: decía «todo bien» sin haber probado
   la clave ni una vez. Y la primera petición autenticada fallaba
   en silencio por una razón que no era la clave:

   Una petición con cabecera `Authorization` NO es una petición
   «simple»: el navegador manda antes un preflight OPTIONS y exige
   que el servidor conteste que acepta esa cabecera. La consulta
   pública sí es simple y pasa sin preflight. Con el CORS de
   Jellyfin a medio configurar el resultado es exactamente el que
   se vio: la prueba pasa y la lista de usuarios llega vacía.

   Por eso ahora:
   · La prueba es POR PASOS y una de ellas es autenticada de verdad.
   · La clave puede viajar de dos formas y se prueban las dos: por
     cabecera (lo recomendado) o dentro de la dirección, que no
     lleva cabeceras propias y por tanto NO dispara preflight.
   · Se recuerda la que funcionó, para no volver a tantear.
   · `api_key` está deprecado y desaparece en Jellyfin 12; el actual
     es `ApiKey`. Se mandan los dos: Emby y los Jellyfin viejos solo
     entienden el primero, y cada servidor ignora el que no conoce.
   ============================================================ */
import { t } from "./i18n.js";

const CLAVE = "anilector.server";
const POR_PAGINA = 48;
const VERSION_CLIENTE = "3.18";

/* ---------- configuración ---------- */
export function leerConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE) || "{}");
    return {
      url: (c.url || "").trim().replace(/\/+$/, ""),   // sin barra final
      key: (c.key || "").trim(),
      userId: c.userId || "",
      userName: c.userName || "",
      // Cómo viaja la clave: "cabecera" o "consulta". Lo decide la prueba.
      modo: c.modo === "consulta" ? "consulta" : "cabecera",
      // Servidores que no dejan listar usuarios con una clave de API:
      // se trabaja sin usuario y se pierde solo el «ya visto».
      sinUsuario: !!c.sinUsuario,
      deviceId: c.deviceId || nuevoDeviceId(),
    };
  } catch {
    return { url: "", key: "", userId: "", userName: "", modo: "cabecera",
      sinUsuario: false, deviceId: nuevoDeviceId() };
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
/* Basta con dirección y clave: el usuario, si hace falta, lo resuelve
   la prueba sola. Ya no hay nada que elegir a mano. */
export function hayConfig() {
  const c = leerConfig();
  return !!(c.url && c.key);
}

/* ---------- llamada de bajo nivel ---------- */
function cabecera(c) {
  /* Solo `Token` es obligatorio; el resto lo pide Jellyfin «de buenas
     maneras» para poder identificar el cliente en su panel de mandos. */
  return `MediaBrowser Token="${c.key}", Client="AniLector", ` +
    `Device="Navegador", DeviceId="${c.deviceId}", Version="${VERSION_CLIENTE}"`;
}

async function llamar(c, ruta, params = {}) {
  if (!c.url) throw fallo({ sinUrl: true }, "");
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== "" && v != null));
  const opciones = {};
  if (c.key) {
    if (c.modo === "consulta") {
      qs.set("ApiKey", c.key);      // Jellyfin actual
      qs.set("api_key", c.key);     // Emby y Jellyfin antiguos
    } else {
      opciones.headers = { Authorization: cabecera(c) };
    }
  }
  const url = `${c.url}${ruta}${qs.toString() ? "?" + qs : ""}`;
  let res;
  try {
    res = await fetch(url, opciones);
  } catch (e) {
    // Aquí caen también los preflight rechazados: el navegador no
    // cuenta nada más que «Failed to fetch».
    throw fallo({ red: true }, c.url);
  }
  if (!res.ok) throw fallo({ estado: res.status }, c.url);
  return res.status === 204 ? null : res.json();
}

function fallo(info, url) {
  const err = new Error(diagnosticar(info, url));
  Object.assign(err, info);
  err.diagnostico = true;
  return err;
}

/* El diagnóstico es la parte que más tiempo ahorra. Un `fetch` que
   falla desde el navegador NO dice por qué, y en este escenario hay
   varios culpables muy distintos con arreglos muy distintos. */
function diagnosticar(e, url) {
  if (e?.sinUrl) return t("srv.errSinUrl");
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

/* ---------- rutas que cambiaron de sitio ----------
   Jellyfin movió las rutas de usuario y las viejas se irán en la 12,
   pero Emby y los Jellyfin antiguos solo entienden las viejas. Se
   prueba la nueva, y solo si da 404 se prueba la vieja: cualquier
   otro fallo (clave, CORS, red) daría igual en las dos. La que vale
   se recuerda para no volver a tantear en cada petición. */
const RUTAS = {
  items: [
    (u) => ["/Items", { userId: u }],
    (u) => [`/Users/${u}/Items`, {}],
  ],
  vistas: [
    (u) => ["/UserViews", { userId: u }],
    (u) => [`/Users/${u}/Views`, {}],
  ],
};
const rutaElegida = {};

async function pedirRuta(nombre, userId, params = {}, cfg) {
  const c = cfg || leerConfig();
  const candidatas = RUTAS[nombre];
  const desde = rutaElegida[nombre] ?? 0;
  let ultimo;
  for (let i = desde; i < candidatas.length; i++) {
    const [ruta, extra] = candidatas[i](userId);
    try {
      const r = await llamar(c, ruta, { ...extra, ...params });
      rutaElegida[nombre] = i;
      return r;
    } catch (e) {
      ultimo = e;
      if (e.estado !== 404) throw e;
    }
  }
  throw ultimo;
}

/* ---------- la prueba, por pasos ----------
   Devuelve una lista de pasos para pintar en pantalla y, si todo fue
   bien, la configuración lista para guardar. Cada paso dice qué se
   comprobó y con qué resultado: así se ve DÓNDE falla, que es lo
   único que permite arreglarlo. */
export async function diagnostico(url, key) {
  const limpia = String(url || "").trim().replace(/\/+$/, "");
  const pasos = [];
  const base = leerConfig();
  const anon = { url: limpia, key: "", modo: "cabecera", deviceId: base.deviceId };

  if (!limpia) {
    pasos.push({ etiqueta: t("srv.pasoResponde"), ok: false, detalle: t("srv.errSinUrl") });
    return { ok: false, pasos };
  }

  /* 1) ¿Responde y hay un servidor de medios detrás? Sin autenticación. */
  let info;
  try {
    info = await llamar(anon, "/System/Info/Public");
  } catch (e) {
    pasos.push({ etiqueta: t("srv.pasoResponde"), ok: false, detalle: e.message });
    return { ok: false, pasos };
  }
  const producto = info?.ProductName || "Jellyfin/Emby";
  pasos.push({
    etiqueta: t("srv.pasoResponde"), ok: true,
    detalle: `${info?.ServerName || "?"} · ${producto} ${info?.Version || ""}`.trim(),
  });

  /* 2) ¿Acepta la clave? Esta petición SÍ está autenticada — es la que
        faltaba en v3.17. Se prueban los dos transportes por orden. */
  if (!key) {
    pasos.push({ etiqueta: t("srv.pasoClave"), ok: false, detalle: t("srv.faltaClave") });
    return { ok: false, pasos, nombre: info?.ServerName || "", version: info?.Version || "" };
  }
  let modo = "", ultimo = null;
  for (const m of ["cabecera", "consulta"]) {
    try {
      await llamar({ ...anon, key, modo: m }, "/System/Info");
      modo = m;
      break;
    } catch (e) { ultimo = e; }
  }
  if (!modo) {
    /* Distinguir es lo importante: si el servidor CONTESTÓ y rechazó la
       clave, la clave está mal. Si no contestó de ninguna de las dos
       formas —cuando la consulta pública sí funcionó—, lo que falla es
       el permiso del servidor para peticiones autenticadas. */
    const rechazada = ultimo?.estado === 401 || ultimo?.estado === 403;
    pasos.push({
      etiqueta: t("srv.pasoClave"), ok: false,
      detalle: rechazada ? t("srv.errKey") : t("srv.errClaveDos"),
    });
    return { ok: false, pasos };
  }
  pasos.push({
    etiqueta: t("srv.pasoClave"), ok: true,
    detalle: t(modo === "cabecera" ? "srv.pasoCab" : "srv.pasoQuery"),
  });

  /* 3) ¿Quién soy y qué bibliotecas veo? El usuario se resuelve solo:
        se prefiere el administrador, y si el servidor no deja listar
        usuarios con una clave de API se sigue sin usuario. */
  const cfg = { url: limpia, key, modo, deviceId: base.deviceId, userId: "", userName: "", sinUsuario: false };
  try {
    const us = await llamar(cfg, "/Users");
    const lista = Array.isArray(us) ? us : (us?.Items || []);
    const yo = lista.find((u) => u?.Policy?.IsAdministrator) || lista[0];
    if (yo?.Id) { cfg.userId = yo.Id; cfg.userName = yo.Name || ""; }
  } catch (_) { /* se sigue sin usuario, ver abajo */ }
  cfg.sinUsuario = !cfg.userId;

  let libs = [];
  try {
    const v = await vistasDe(cfg);
    libs = v?.Items || [];
  } catch (e) {
    pasos.push({ etiqueta: t("srv.pasoBiblio"), ok: false, detalle: e.message });
    return { ok: false, pasos };
  }
  if (!libs.length) {
    pasos.push({ etiqueta: t("srv.pasoBiblio"), ok: false, detalle: t("srv.sinBiblio") });
    return { ok: false, pasos };
  }
  pasos.push({
    etiqueta: t("srv.pasoBiblio"), ok: true,
    detalle: t("srv.pasoLibs").replace("%s", String(libs.length)) +
      (cfg.userId ? ` · ${cfg.userName || cfg.userId}` : ` · ${t("srv.pasoSinUsuario")}`),
  });

  return { ok: true, pasos, config: cfg, nombre: info?.ServerName || "", version: info?.Version || "" };
}

/* ---------- API del servidor ---------- */
/* Bibliotecas. Con usuario, las suyas; sin usuario, las carpetas de
   medios del servidor — que es lo que hay cuando la clave no lista
   usuarios. */
async function vistasDe(cfg) {
  const c = cfg || leerConfig();
  if (c.userId) return pedirRuta("vistas", c.userId, {}, c);
  return llamar(c, "/Library/MediaFolders");
}
export const bibliotecas = () => vistasDe(null);

export function portada(id, tag) {
  const c = leerConfig();
  if (!c.url || !id) return "";
  // La clave va en la dirección porque una <img> no puede llevar
  // cabeceras propias. Es la vía que el propio Jellyfin ofrece.
  const p = new URLSearchParams({ maxHeight: "450", quality: "88" });
  clavePorUrl(p, c.key);
  if (tag) p.set("tag", tag);
  return `${c.url}/Items/${id}/Images/Primary?${p}`;
}
/* `ApiKey` es el nombre actual en Jellyfin; `api_key` está deprecado y
   desaparece en la 12, pero es el único que entienden Emby y los
   Jellyfin viejos. Se mandan los dos y cada servidor usa el suyo. */
function clavePorUrl(p, key) {
  if (!key) return p;
  p.set("ApiKey", key);
  p.set("api_key", key);
  return p;
}

export function items({ parentId, tipos, buscar, orden, pagina = 1 }) {
  const c = leerConfig();
  const params = {
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
  };
  // Sin usuario no viene `UserData`, así que no se marcará lo ya visto.
  // Es la única pérdida de ese modo, y es preferible a no funcionar.
  if (c.userId) return pedirRuta("items", c.userId, params, c);
  return llamar(c, "/Items", params);
}

export const episodios = (seriesId) => {
  const c = leerConfig();
  return llamar(c, `/Shows/${seriesId}/Episodes`,
    { userId: c.userId, Fields: "ProductionYear,UserData", SortBy: "SortName" });
};

export const canales = () => {
  const c = leerConfig();
  return llamar(c, "/LiveTv/Channels",
    { userId: c.userId, Limit: "300", Fields: "PrimaryImageAspectRatio" });
};

/* Direcciones de reproducción. La clave viaja en la dirección porque el
   <video> y los trozos del HLS no pueden llevar cabeceras. */
export function urlHls(id) {
  const c = leerConfig();
  const p = new URLSearchParams({
    MediaSourceId: id,
    VideoCodec: "h264",
    AudioCodec: "aac,mp3",
    TranscodingMaxAudioChannels: "2",
  });
  clavePorUrl(p, c.key);
  return `${c.url}/Videos/${id}/master.m3u8?${p}`;
}
/* Reproducción directa, sin convertir: va mejor cuando el archivo ya
   es compatible con el navegador, y evita cargar de trabajo al servidor. */
export function urlDirecta(id) {
  const c = leerConfig();
  const p = new URLSearchParams({ static: "true" });
  clavePorUrl(p, c.key);
  return `${c.url}/Videos/${id}/stream?${p}`;
}

export const PAGINA = POR_PAGINA;
export const guardar = guardarConfig;
