/* ============================================================
   AniLector — YouTube (estilo GreenTuber)
   Búsqueda vía microservicio (o Piped/Invidious de respaldo) y
   reproducción con el reproductor OFICIAL de YouTube.

   Lo que hace que se sienta como YouTube y no como una lista fija:
   · Usa la IFrame API (enablejsapi) para SABER cuándo termina un video.
     Un iframe normal no avisa de nada, y por eso antes se quedaba
     parado al acabar.
   · Al terminar, encadena con el siguiente de la cola (una lista de
     reproducción o los resultados) y, si no hay, con los RELACIONADOS
     del video que se acaba de ver — que se recargan en cada video.
   · Los resultados incluyen LISTAS de reproducción y un botón para
     traer más páginas.
   ============================================================ */
import { t } from "./i18n.js";
import { PIPED_APIS, INVIDIOUS_APIS, BACKEND_URL } from "./config.js";

const $ = (id) => document.getElementById(id);
const API = (BACKEND_URL || "").replace(/\/$/, "");

const state = {
  items: [],          // lo que se ve en el grid
  nextPage: null,     // token para "ver más resultados"
  lastQuery: "",
  queue: [],          // cola de reproducción (lista o resultados)
  qIndex: -1,
  current: null,      // { id, title }
  related: [],        // relacionados del video actual
  autoplay: true,
  history: [],        // ids ya reproducidos, para no repetir en cadena
  fDur: "",           // filtro de duración
  fEdad: "",          // (reservado) filtro de antigüedad
};

/* ---------- minuto recordado e historial ----------
   Ya se recuerda por dónde vas en capítulos y páginas; con los videos
   faltaba. Se guarda el segundo cada pocos segundos mientras se
   reproduce y se retoma al volver a abrirlo. */
const PROG_KEY = "anilector.ytprogress";
const HIST_KEY = "anilector.ythistory";
const MIN_GUARDAR = 15;     // por debajo de esto no vale la pena
const MARGEN_FIN = 20;      // si falta menos, se considera terminado

function leerJSON(k, def) {
  try { return JSON.parse(localStorage.getItem(k) || "null") ?? def; }
  catch { return def; }
}
function progresos() { return leerJSON(PROG_KEY, {}); }
function guardarProgreso(id, seg, dur) {
  if (!id || !(seg > MIN_GUARDAR)) return;
  const p = progresos();
  // Terminado o casi: se olvida, para no ofrecer "retomar" al final.
  if (dur && dur - seg < MARGEN_FIN) delete p[id];
  else p[id] = { s: Math.floor(seg), d: Math.floor(dur || 0), ts: Date.now() };
  // Tope para que no crezca sin control
  const ids = Object.keys(p).sort((a, b) => (p[b].ts || 0) - (p[a].ts || 0));
  for (const extra of ids.slice(200)) delete p[extra];
  try { localStorage.setItem(PROG_KEY, JSON.stringify(p)); } catch (_) {}
}
function progresoDe(id) { return progresos()[id] ?? null; }

export function historial() { return leerJSON(HIST_KEY, []); }
function anotarHistorial(v) {
  if (!v?.id) return;
  const h = historial().filter((x) => x.id !== v.id);
  h.unshift({ id: v.id, title: v.title || v.id, uploader: v.uploader || "",
              thumb: v.thumb || "", duration: v.duration || "", ts: Date.now() });
  try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 100))); } catch (_) {}
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Extrae el ID de video de una URL o texto de YouTube (o devuelve null)
function videoId(input) {
  const s = String(input || "").trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : null;
}
// Extrae el ID de una lista de reproducción de una URL
function listId(input) {
  const m = String(input || "").match(/[?&]list=([\w-]+)/);
  return m ? m[1] : null;
}

function fmtDur(s) {
  if (!s) return "";
  if (typeof s === "string") return s; // ya viene como "4:20"
  if (s < 0) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtViews(n) {
  if (!n) return "";
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)} K`;
  return String(n);
}

/* ---------- llamadas al microservicio (con respaldo) ---------- */
async function apiGet(params, timeout = 12000) {
  if (!API) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API}/api/yt?${new URLSearchParams(params)}`, { signal: ctrl.signal });
    const d = await res.json();
    return d && !d.error ? d : (d?.items?.length ? d : null);
  } catch (_) { return null; }
  finally { clearTimeout(timer); }
}

async function searchGreentuber(q) {
  const d = await apiGet({ q });
  if (d?.items?.length) return { items: d.items, nextPage: d.nextPage || null };
  const items = await searchPiped(q);
  return { items, nextPage: null };
}

async function searchPiped(q) {
  let lastErr;
  for (const base of PIPED_APIS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      // filter=all para que también lleguen las listas de reproducción
      const res = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=all`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`${res.status}`);
      const d = await res.json();
      const items = (d.items || d || []).map(fromPiped).filter(Boolean);
      if (items.length) return items;
    } catch (e) { lastErr = e; }
  }
  // Respaldo: Invidious
  for (const base of INVIDIOUS_APIS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${base}/api/v1/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`${res.status}`);
      const d = await res.json();
      const items = (d || []).map(fromInvidious).filter(Boolean);
      if (items.length) return items;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("sin resultados");
}

function fromPiped(i) {
  const isList = i.type === "playlist" || /^\/playlist/.test(i.url || "");
  if (isList) {
    const id = i.playlistId || (i.url || "").split("list=")[1];
    if (!id) return null;
    return {
      type: "playlist", id, title: i.name || i.title || "",
      uploader: i.uploaderName || "", thumb: i.thumbnail || "",
      videoCount: i.videos > 0 ? i.videos : null,
    };
  }
  const id = i.videoId || (i.url || "").split("v=")[1];
  if (!id || i.type === "channel") return null;
  return {
    type: "video", id, title: i.title || i.name || "",
    uploader: i.uploaderName || i.author || "",
    thumb: i.thumbnail || i.thumbnails?.[0]?.url || "",
    duration: fmtDur(i.duration), seconds: typeof i.duration === "number" ? i.duration : null,
    views: i.views > 0 ? i.views : null,
  };
}
function fromInvidious(i) {
  if (i.type === "playlist" && i.playlistId) {
    return {
      type: "playlist", id: i.playlistId, title: i.title || "",
      uploader: i.author || "", thumb: i.playlistThumbnail || "",
      videoCount: i.videoCount || null,
    };
  }
  if (!i.videoId) return null;
  return {
    type: "video", id: i.videoId, title: i.title || "", uploader: i.author || "",
    thumb: (i.videoThumbnails || []).find((th) => th.quality === "medium")?.url || i.videoThumbnails?.[0]?.url || "",
    duration: fmtDur(i.lengthSeconds), seconds: i.lengthSeconds || null,
    views: i.viewCount || null,
  };
}

// Relacionados: microservicio y, si no, /streams de Piped.
async function fetchRelated(id) {
  const d = await apiGet({ related: id });
  if (d?.items?.length) return d.items;
  for (const base of PIPED_APIS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const res = await fetch(`${base}/streams/${id}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const d2 = await res.json();
      const items = (d2.relatedStreams || []).map(fromPiped).filter((x) => x && x.type === "video");
      if (items.length) return items;
    } catch (_) {}
  }
  return [];
}

async function fetchPlaylist(id) {
  const d = await apiGet({ playlist: id });
  if (d?.items?.length) return d;
  for (const base of PIPED_APIS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${base}/playlists/${id}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const d2 = await res.json();
      const items = (d2.relatedStreams || []).map(fromPiped).filter((x) => x && x.type === "video");
      if (items.length) return { id, title: d2.name || "", items };
    } catch (_) {}
  }
  return { id, title: "", items: [] };
}

/* ---------- reproductor con IFrame API ----------
   Sin la API el iframe es una caja negra: no avisa cuándo acaba el
   video, que es justo lo que hace falta para encadenar el siguiente. */
let ytApiReady = null;
let player = null;
function loadIframeApi() {
  if (ytApiReady) return ytApiReady;
  ytApiReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev?.(); } catch (_) {} resolve(); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => reject(new Error("IFrame API"));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error("IFrame API timeout")), 12000);
  }).catch((e) => { ytApiReady = null; throw e; });
  return ytApiReady;
}

let tickProgreso = null;
function onPlayerState(ev) {
  // 1 = reproduciendo, 2 = pausa, 0 = terminado
  clearInterval(tickProgreso);
  if (ev.data === 1) {
    tickProgreso = setInterval(() => {
      try {
        guardarProgreso(state.current?.id, player.getCurrentTime(), player.getDuration());
      } catch (_) {}
    }, 5000);
  } else if (ev.data === 2) {
    try { guardarProgreso(state.current?.id, player.getCurrentTime(), player.getDuration()); } catch (_) {}
  }
  if (ev.data === 0) {
    // Terminado: se olvida el punto guardado y se encadena.
    try {
      const p = progresos(); delete p[state.current?.id];
      localStorage.setItem(PROG_KEY, JSON.stringify(p));
    } catch (_) {}
    playNext();
  }
}

async function mountPlayer(id, desde = 0) {
  await loadIframeApi();
  if (player?.loadVideoById) {
    // El objeto acepta el segundo de inicio: así se retoma donde ibas.
    player.loadVideoById(desde > 0 ? { videoId: id, startSeconds: desde } : id);
    return;
  }
  // Si quedó un iframe del respaldo, hay que devolver el hueco a <div>.
  if ($("ytFrame")?.tagName === "IFRAME") resetPlayerHost();
  player = new window.YT.Player("ytFrame", {
    videoId: id,
    playerVars: {
      autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1,
      ...(desde > 0 ? { start: Math.floor(desde) } : {}),
    },
    events: { onStateChange: onPlayerState },
  });
}

/* Respaldo si la IFrame API no carga (bloqueada, sin red…): iframe
   normal. El video se ve; lo único que se pierde es el encadenado
   automático, porque un iframe suelto no avisa cuándo termina. */
function mountPlain(id, desde = 0) {
  const host = $("ytFrame");
  if (!host) return;
  const src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` +
    (desde > 0 ? `&start=${Math.floor(desde)}` : "");
  if (host.tagName === "IFRAME") { host.src = src; return; }
  const f = document.createElement("iframe");
  f.id = "ytFrame";
  f.src = src;
  f.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
  f.allowFullscreen = true;
  f.referrerPolicy = "strict-origin-when-cross-origin";
  host.replaceWith(f);
}

/* Deja el hueco listo para volver a montar el reproductor. */
function resetPlayerHost() {
  try { player?.destroy?.(); } catch (_) {}
  player = null;
  const el = $("ytFrame");
  if (el) {
    const div = document.createElement("div");
    div.id = "ytFrame";
    el.replaceWith(div);
  }
}

async function play(id, title, { queue = null, index = -1 } = {}) {
  if (!id) return;
  state.current = { id, title: title || id };
  if (queue) { state.queue = queue; state.qIndex = index; }
  else if (state.queue.length) {
    const i = state.queue.findIndex((v) => v.id === id);
    state.qIndex = i;
  }
  if (!state.history.includes(id)) state.history.push(id);

  $("ytPlayer").classList.remove("hidden");
  $("ytNow").textContent = title || id;
  $("ytExternal").href = `https://www.youtube.com/watch?v=${id}`;

  // ¿Habíamos dejado este video a medias?
  const guardado = progresoDe(id);
  const desde = guardado?.s > MIN_GUARDAR ? guardado.s : 0;
  anotarHistorial({ id, title, ...(state.queue.find((v) => v.id === id) || {}) });

  try { await mountPlayer(id, desde); }
  catch (_) { mountPlain(id, desde); }
  if (desde) mostrarRetomado(desde);
  $("ytPlayer").scrollIntoView({ behavior: "smooth", block: "start" });
  markPlaying();
  loadRelated(id);
}

/* Lo que corresponde reproducir después: primero la cola (una lista de
   reproducción o los resultados), y si se acabó, el mejor relacionado. */
function nextUp() {
  if (state.qIndex >= 0 && state.qIndex + 1 < state.queue.length)
    return state.queue[state.qIndex + 1];
  const fresh = state.related.find((v) => !state.history.includes(v.id));
  return fresh || state.related[0] || null;
}

function playNext() {
  if (!state.autoplay) return;
  const n = nextUp();
  if (!n) return;
  const inQueue = state.qIndex >= 0 && state.queue[state.qIndex + 1]?.id === n.id;
  if (inQueue) play(n.id, n.title, { queue: state.queue, index: state.qIndex + 1 });
  else play(n.id, n.title, { queue: state.related, index: state.related.findIndex((v) => v.id === n.id) });
}

/* Aviso discreto de que se retomó el video, con opción de empezar de cero. */
function mostrarRetomado(seg) {
  const bar = $("ytResumed");
  if (!bar) return;
  bar.classList.remove("hidden");
  bar.innerHTML = `<span>⏪ ${t("yt.resumedAt").replace("%s", fmtDur(seg))}</span>
    <button class="btn btn-ghost btn-mini" id="ytFromStart">${t("yt.fromStart")}</button>`;
  $("ytFromStart").addEventListener("click", () => {
    try { player?.seekTo(0, true); } catch (_) {}
    bar.classList.add("hidden");
  });
  clearTimeout(bar._t);
  bar._t = setTimeout(() => bar.classList.add("hidden"), 8000);
}

async function loadRelated(id) {
  const box = $("ytRelated");
  if (!box) return;
  box.innerHTML = `<div class="yt-rel-head">${t("yt.related")}</div>
    <div class="loader"><div class="spinner"></div></div>`;
  let items = [];
  try { items = await fetchRelated(id); } catch (_) {}
  if (state.current?.id !== id) return;      // el usuario ya cambió de video
  state.related = items;
  if (!items.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="yt-rel-head">${t("yt.related")}</div>` +
    items.slice(0, 20).map((v) => `
      <button class="yt-rel" data-id="${esc(v.id)}" data-title="${esc(v.title)}">
        <span class="yt-rel-thumb">
          ${v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'"/>` : "▶"}
          ${v.duration ? `<span class="yt-dur">${esc(fmtDur(v.duration))}</span>` : ""}
        </span>
        <span class="yt-rel-info">
          <span class="yt-rel-title">${esc(v.title)}</span>
          <span class="yt-rel-meta">${esc(v.uploader || "")}${v.views ? ` · ${fmtViews(v.views)}` : ""}</span>
        </span>
      </button>`).join("");
  updateNextLabel();
}

function updateNextLabel() {
  const b = $("ytNext");
  if (!b) return;
  const n = nextUp();
  b.disabled = !n;
  b.title = n ? `${t("yt.next")}: ${n.title}` : t("yt.next");
}

function markPlaying() {
  document.querySelectorAll(".yt-card").forEach((c) =>
    c.classList.toggle("playing", c.dataset.id === state.current?.id));
  document.querySelectorAll(".yt-rel").forEach((c) =>
    c.classList.toggle("playing", c.dataset.id === state.current?.id));
  updateNextLabel();
}

/* ---------- resultados ---------- */
function cardHTML(v) {
  if (v.type === "playlist") {
    return `
    <article class="card yt-card yt-playlist" data-list="${esc(v.id)}" data-title="${esc(v.title)}">
      <div class="yt-thumb-wrap">
        ${v.thumb ? `<img class="yt-thumb" loading="lazy" src="${esc(v.thumb)}" alt="" onerror="this.style.display='none'"/>` : `<div class="yt-thumb yt-thumb-ph">☰</div>`}
        <span class="yt-listbadge">☰ ${v.videoCount ? `${v.videoCount} ` : ""}${t("yt.videos")}</span>
      </div>
      <div class="card-body">
        <h3 class="card-title">${esc(v.title)}</h3>
        <div class="card-meta">${v.uploader ? `<span>👤 ${esc(v.uploader)}</span>` : ""}</div>
      </div>
    </article>`;
  }
  return `
    <article class="card yt-card" data-id="${esc(v.id)}" data-title="${esc(v.title)}">
      <div class="yt-thumb-wrap">
        ${v.thumb ? `<img class="yt-thumb" loading="lazy" src="${esc(v.thumb)}" alt="" onerror="this.style.display='none'"/>` : `<div class="yt-thumb yt-thumb-ph">▶</div>`}
        ${v.duration ? `<span class="yt-dur">${esc(fmtDur(v.duration))}</span>` : ""}
      </div>
      <div class="card-body">
        <h3 class="card-title">${esc(v.title)}</h3>
        <div class="card-meta">
          ${v.uploader ? `<span>👤 ${esc(v.uploader)}</span>` : ""}
          ${v.views ? `<span>👁 ${fmtViews(v.views)}</span>` : ""}
        </div>
      </div>
    </article>`;
}

function renderResults({ append = false } = {}) {
  const grid = $("ytGrid");
  const visibles = aplicarFiltros(state.items);
  const ocultos = state.items.length - visibles.length;
  const aviso = $("ytFilterInfo");
  if (aviso) {
    aviso.classList.toggle("hidden", !ocultos);
    if (ocultos) aviso.textContent = t("yt.filtered").replace("%s", ocultos);
  }
  if (!visibles.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🔎</div><p>${t("misc.noResults")}</p></div>`;
    $("ytMoreWrap").classList.add("hidden");
    return;
  }
  // Con filtros activos se repinta entero: el recorte cambia el orden.
  grid.innerHTML = visibles.map(cardHTML).join("");
  $("ytMoreWrap").classList.toggle("hidden", !state.nextPage);
  markPlaying();
}

/* Filtros de duración y antigüedad.
   El scraper no puede pedirle a YouTube sus filtros oficiales (irían en
   un token cifrado), así que se aplican sobre los resultados que llegan.
   Por eso se avisa de cuántos se ocultaron: si el filtro es estricto
   puede dejar pocos, y conviene pulsar «ver más resultados». */
function pasaFiltros(v) {
  if (v.type === "playlist") return state.fDur === "" && state.fEdad === "";
  if (state.fDur) {
    const seg = v.seconds ?? null;
    if (seg == null) return false;
    if (state.fDur === "short" && seg > 4 * 60) return false;
    if (state.fDur === "medium" && (seg <= 4 * 60 || seg > 20 * 60)) return false;
    if (state.fDur === "long" && seg <= 20 * 60) return false;
  }
  return true;
}
function aplicarFiltros(items) {
  return (items || []).filter(pasaFiltros);
}

async function doSearch(q) {
  const grid = $("ytGrid");
  // ¿Pegó una LISTA? → abrirla
  const lid = listId(q);
  if (lid) return openPlaylist(lid, q);
  // ¿Pegó un enlace/ID de video? → reproducir de una vez
  const vid = videoId(q);
  if (vid) { play(vid, q); return; }

  state.lastQuery = q;
  grid.innerHTML = `<div class="loader"><div class="spinner"></div><span>${t("misc.loading")}</span></div>`;
  $("ytMoreWrap").classList.add("hidden");
  try {
    const { items, nextPage } = await searchGreentuber(q);
    state.items = items;
    state.nextPage = nextPage;
    renderResults();
  } catch (e) {
    state.items = []; state.nextPage = null;
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📺</div>
      <p>${t("yt.searchError")}</p></div>`;
  }
}

async function loadMore() {
  if (!state.nextPage) return;
  const btn = $("ytMore");
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = t("misc.loading");
  const d = await apiGet({ page: state.nextPage });
  btn.disabled = false;
  btn.textContent = prev;
  if (!d?.items?.length) {
    state.nextPage = null;
    $("ytMoreWrap").classList.add("hidden");
    return;
  }
  const known = new Set(state.items.map((i) => `${i.type}:${i.id}`));
  state.items = state.items.concat(d.items.filter((i) => !known.has(`${i.type}:${i.id}`)));
  state.nextPage = d.nextPage || null;
  renderResults({ append: true });
}

async function openPlaylist(id, label) {
  const grid = $("ytGrid");
  grid.innerHTML = `<div class="loader"><div class="spinner"></div><span>${t("misc.loading")}</span></div>`;
  $("ytMoreWrap").classList.add("hidden");
  const d = await fetchPlaylist(id);
  if (!d.items.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">☰</div><p>${t("yt.emptyList")}</p></div>`;
    return;
  }
  state.items = d.items;
  state.nextPage = null;
  renderResults();
  // Encabezado con el nombre de la lista y botón de reproducir todo
  const head = $("ytListHead");
  head.classList.remove("hidden");
  head.innerHTML = `<span class="yt-list-title">☰ ${esc(d.title || label || t("yt.list"))} · ${d.items.length} ${t("yt.videos")}</span>
    <button class="btn btn-primary btn-mini" id="ytPlayAll">▶ ${t("yt.playAll")}</button>
    <button class="btn btn-ghost btn-mini" id="ytBack">✕</button>`;
  $("ytPlayAll").addEventListener("click", () =>
    play(d.items[0].id, d.items[0].title, { queue: d.items, index: 0 }));
  $("ytBack").addEventListener("click", () => {
    head.classList.add("hidden");
    if (state.lastQuery) doSearch(state.lastQuery);
    else { state.items = []; renderResults(); }
  });
}

/* Buscar desde fuera (lo usa el buscador único del encabezado). */
export function searchYouTubeFor(q) {
  const el = $("ytSearch");
  if (el) el.value = q;
  doSearch(q);
}

/* Historial de lo reproducido. */
function mostrarHistorial() {
  const h = historial();
  const grid = $("ytGrid");
  $("ytMoreWrap").classList.add("hidden");
  $("ytFilterInfo")?.classList.add("hidden");
  const head = $("ytListHead");
  head.classList.remove("hidden");
  head.innerHTML = `<span class="yt-list-title">🕘 ${t("yt.history")} · ${h.length}</span>
    ${h.length ? `<button class="btn btn-ghost btn-mini" id="ytHistClear">${t("yt.clearHistory")}</button>` : ""}
    <button class="btn btn-ghost btn-mini" id="ytHistBack">✕</button>`;
  $("ytHistBack").addEventListener("click", () => {
    head.classList.add("hidden");
    if (state.lastQuery) doSearch(state.lastQuery);
    else { state.items = []; renderResults(); }
  });
  $("ytHistClear")?.addEventListener("click", () => {
    try { localStorage.removeItem(HIST_KEY); } catch (_) {}
    mostrarHistorial();
  });
  if (!h.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🕘</div><p>${t("yt.noHistory")}</p></div>`;
    return;
  }
  // Se muestran con su punto guardado, si lo hay.
  state.items = h.map((v) => ({ ...v, type: "video" }));
  state.nextPage = null;
  grid.innerHTML = state.items.map((v) => {
    const pr = progresoDe(v.id);
    const pct = pr?.d ? Math.min(100, Math.round(pr.s / pr.d * 100)) : 0;
    return cardHTML(v).replace("</div>\n    </article>",
      `</div>${pct ? `<span class="yt-progress"><i style="width:${pct}%"></i></span>` : ""}
    </article>`);
  }).join("");
  markPlaying();
}

export function initYouTube() {
  $("ytForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("ytSearch").value.trim();
    if (q) doSearch(q);
  });

  $("ytGrid").addEventListener("click", (e) => {
    const c = e.target.closest(".yt-card");
    if (!c) return;
    if (c.dataset.list) return openPlaylist(c.dataset.list, c.dataset.title);
    // Al elegir un resultado, la cola pasan a ser los resultados: al
    // terminar sigue el siguiente de la lista, como en YouTube.
    const videos = state.items.filter((i) => i.type !== "playlist");
    const idx = videos.findIndex((v) => v.id === c.dataset.id);
    play(c.dataset.id, c.dataset.title, { queue: videos, index: idx });
  });

  $("ytRelated").addEventListener("click", (e) => {
    const b = e.target.closest(".yt-rel");
    if (!b) return;
    const idx = state.related.findIndex((v) => v.id === b.dataset.id);
    play(b.dataset.id, b.dataset.title, { queue: state.related, index: idx });
  });

  $("ytMore").addEventListener("click", loadMore);
  $("ytHistory")?.addEventListener("click", mostrarHistorial);
  $("ytDuration")?.addEventListener("change", (e) => {
    state.fDur = e.target.value;
    try { localStorage.setItem("anilector.ytdur", state.fDur); } catch (_) {}
    renderResults();
  });
  try {
    const g = localStorage.getItem("anilector.ytdur") || "";
    state.fDur = g;
    if ($("ytDuration")) $("ytDuration").value = g;
  } catch (_) {}
  $("ytNext").addEventListener("click", () => {
    const n = nextUp();
    if (n) playNext();
  });

  const chk = $("ytAutoplay");
  try { state.autoplay = localStorage.getItem("anilector.ytAutoplay") !== "0"; } catch (_) {}
  chk.checked = state.autoplay;
  chk.addEventListener("change", () => {
    state.autoplay = chk.checked;
    try { localStorage.setItem("anilector.ytAutoplay", chk.checked ? "1" : "0"); } catch (_) {}
  });

  $("ytClose").addEventListener("click", () => {
    try { player?.stopVideo?.(); } catch (_) {}
    resetPlayerHost();          // sin esto quedaba un reproductor muerto
    $("ytPlayer").classList.add("hidden");
    $("ytRelated").innerHTML = "";
    state.current = null;
    state.related = [];
    markPlaying();
  });
}
