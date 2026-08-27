/* ============================================================
   AniLector — controlador principal
   ============================================================ */
import { t, setLang, getLang, applyTranslations } from "./i18n.js";
import {
  search, getGenres, getDetail, buildOrder, onProviderChange,
  filterEsEn, mangaReadingSites, animeWatchSites, bookReadingSites, findGutenberg,
  episodeSearchUrl, getEpisodes,
  getMangaChapters, getChapterPages, resolveExactLink, hasBackend,
} from "./api.js";
import {
  openLocalFiles, openLocalFile, openUrl, openIframe, openImages, openGoogleBook,
  closeViewer, bindViewerControls, openRemoteFile,
} from "./viewer.js";
import { BOOK_SITES_SHOWN, MX_LIBRARIES } from "./config.js";
import { initAuth } from "./auth.js";
import { initTv, ensureTvLoaded, pauseTv, countChannelMatches, applyChannelSearch } from "./tv.js";
import { initYouTube, searchYouTubeFor } from "./youtube.js";
import { initVod, ensureVodLoaded, initRetro, ensureRetroLoaded } from "./vod.js";
import { initServidor, ensureServidorLoaded, pausarServidor } from "./servervista.js";
import { initWebApps } from "./webapps.js";
import { initBrand } from "./brand.js";
import { initTvMode } from "./tvmode.js";
import { initPwa } from "./pwa.js";
import * as DOCS from "./docs.js";
import { initEntradas } from "./entradas.js";

/* ---------- estado ---------- */
const S = {
  cat: "anime",           // anime | manga | books
  view: "search",         // search | library | reader
  page: 1,
  lastQuery: null,
  items: [],
  libFilter: "all",
};

const $ = (id) => document.getElementById(id);

/* ---------- utilidades ---------- */
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 2400);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- biblioteca (localStorage) ---------- */
function lib() {
  try { return JSON.parse(localStorage.getItem("anilector.library") || "[]"); }
  catch { return []; }
}
/* El navegador da ~5 MB para todo. Si se llena, `setItem` LANZA: antes
   eso rompía la acción sin decir nada y el usuario creía que había
   guardado. Ahora se avisa y se le dice qué hacer. */
function guardarClave(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
    window.dispatchEvent(new Event("anilector:datachanged"));
    return true;
  } catch (e) {
    console.warn("localStorage:", e.name);
    toast(e.name === "QuotaExceededError" ? t("misc.storageFull") : t("misc.saveFailed"));
    return false;
  }
}
function saveLib(list) { return guardarClave("anilector.library", list); }
function inLib(id) { return lib().some((x) => x.id === id); }
function toggleLib(item) {
  const list = lib();
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) { list.splice(i, 1); toast(t("library.removed")); }
  else {
    list.unshift({
      id: item.id, sourceId: item.sourceId, cat: item.cat, src: item.src || null,
      title: item.title, cover: item.cover, year: item.year,
      type: item.type, counts: item.counts, url: item.url,
      ia: item.ia || null, status: "pending", addedAt: new Date().toISOString(),
    });
    toast(t("library.added"));
  }
  saveLib(list);
  if (S.view === "library") renderLibrary();
}

/* ---------- vistos / leídos + "Continuar" (localStorage + Drive) ---------- */
function seenStore() {
  try { return JSON.parse(localStorage.getItem("anilector.seen") || "{}"); }
  catch { return {}; }
}
function saveSeen(store) { return guardarClave("anilector.seen", store); }
// kind: "ep" (episodio) | "ch" (capítulo)
function markSeen(item, kind, n, on = true) {
  const store = seenStore();
  const e = store[item.id] || {};
  e.title = item.title; e.cover = item.cover; e.cat = item.cat;
  // Snapshot mínimo para poder reabrir el detalle en otra sesión.
  e.base = {
    id: item.id, sourceId: item.sourceId, cat: item.cat, src: item.src || null,
    title: item.title, cover: item.cover, year: item.year,
    type: item.type, counts: item.counts, url: item.url, ia: item.ia || null,
  };
  const bag = kind === "ch" ? (e.chs = e.chs || {}) : (e.eps = e.eps || {});
  if (on) { bag[n] = 1; e.last = n; e.lastKind = kind; e.ts = Date.now(); }
  else { delete bag[n]; }
  // Si ya no queda nada marcado, quitar la entrada.
  if (!Object.keys(e.eps || {}).length && !Object.keys(e.chs || {}).length) delete store[item.id];
  else store[item.id] = e;
  saveSeen(store);
}
function isSeen(id, kind, n) {
  const e = seenStore()[id];
  if (!e) return false;
  return !!(kind === "ch" ? e.chs?.[n] : e.eps?.[n]);
}
/* Cuánto llevas de una obra: marcados vs. total conocido. */
function progressOf(e) {
  const hechos = Object.keys(e.eps || {}).length + Object.keys(e.chs || {}).length;
  const c = e.base?.counts || {};
  const total = e.lastKind === "ch" ? (c.chapters || 0) : (c.episodes || 0);
  return { hechos, total: total > 0 ? total : 0 };
}
function continueList() {
  const store = seenStore();
  return Object.entries(store)
    .filter(([, e]) => e.last != null)
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 12);
}
function renderContinue() {
  const items = continueList();
  const sec = $("continueSection");
  const row = $("continueRow");
  if (!sec || !row) return;
  sec.classList.toggle("hidden", items.length === 0);
  const kindLbl = (e) => e.lastKind === "ch"
    ? `${t("detail.chapter")} ${e.last}` : `Ep. ${e.last}`;
  row.innerHTML = items.map((e) => {
    const p = progressOf(e);
    return `
    <button class="continue-card" data-id="${esc(e.id)}" title="${esc(e.title)}">
      ${e.cover
        ? `<img class="continue-cover" loading="lazy" src="${esc(e.cover)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'continue-cover ph',textContent:'📖'}))" />`
        : `<div class="continue-cover ph">${e.cat === "anime" ? "🎬" : e.cat === "manga" ? "📖" : "📕"}</div>`}
      ${p.total ? `<span class="continue-bar"><i style="width:${Math.round(p.hechos / p.total * 100)}%"></i></span>` : ""}
      <span class="continue-name">${esc(e.title)}</span>
      <span class="continue-badge">▶ ${esc(kindLbl(e))}${p.total ? ` · ${p.hechos}/${p.total}` : ""}</span>
      <button class="continue-del" data-del="${esc(e.id)}" title="${t("library.removeContinue")}">✕</button>
    </button>`;
  }).join("");
  row.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const store = seenStore();
      delete store[b.dataset.del];
      saveSeen(store);
      renderLibrary();
    }));
  row.querySelectorAll(".continue-card").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.id;
      // Si el ítem no está en resultados ni biblioteca, inyectar su snapshot.
      if (!S.items.find((x) => x.id === id) && !lib().find((x) => x.id === id)) {
        const snap = seenStore()[id]?.base;
        if (snap) S.items.push(snap);
      }
      openDetail(id);
    }));
}

/* ---------- textos de conteo ---------- */
function countsText(item) {
  const c = item.counts || {};
  const parts = [];
  if (c.episodes) parts.push(`${c.episodes} ${t("detail.episodes").toLowerCase()}`);
  if (c.chapters) parts.push(`${c.chapters} ${t("detail.chapters").toLowerCase()}`);
  if (c.volumes) parts.push(`${c.volumes} ${t("detail.volumes").toLowerCase()}`);
  if (c.editions) parts.push(`${c.editions} ${t("detail.editions").toLowerCase()}`);
  if (c.pages) parts.push(`~${c.pages} ${t("detail.pages").toLowerCase()}`);
  return parts.join(" · ") || "—";
}

/* ---------- tarjetas ---------- */
/* Etiqueta de acceso en la tarjeta: de un vistazo se ve qué puedes leer
   ya y qué no. Solo tiene sentido en libros. */
const ETIQUETA_ACCESO = {
  libre:    { cls: "ac-libre",    icono: "🆓", clave: "access.free" },
  prestamo: { cls: "ac-prestamo", icono: "🔁", clave: "access.borrow" },
  previa:   { cls: "ac-previa",   icono: "👁️", clave: "access.preview" },
  pago:     { cls: "ac-pago",     icono: "💲", clave: "access.paid" },
  // Sin etiqueta, un libro sin copia digital parecía simplemente uno al
  // que se le olvidó la suya: mejor decirlo.
  no:       { cls: "ac-no",       icono: "📕", clave: "access.none" },
};
function accesoHTML(item) {
  if (item.cat !== "book") return "";
  const e = ETIQUETA_ACCESO[item.acceso];
  const formatos = (item.formatos || [])
    .map((f) => `<span class="fmt-chip">${f === "online" ? t("fmt.online") : f.toUpperCase()}</span>`)
    .join("");
  if (!e && !formatos) return "";
  return `<div class="card-acceso">
    ${e ? `<span class="ac-chip ${e.cls}">${e.icono} ${t(e.clave)}</span>` : ""}
    ${formatos}
  </div>`;
}

function cardHTML(item, { library = false } = {}) {
  const cover = item.cover
    ? `<img class="card-cover" loading="lazy" src="${esc(item.cover)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'card-cover placeholder',textContent:'📕'}))" />`
    : `<div class="card-cover placeholder">${item.cat === "anime" ? "🎬" : item.cat === "manga" ? "📖" : "📕"}</div>`;
  const faved = inLib(item.id);
  const statusSel = library
    ? `<select class="lib-status" data-id="${esc(item.id)}">
        <option value="pending" ${item.status === "pending" ? "selected" : ""}>${t("library.pending")}</option>
        <option value="reading" ${item.status === "reading" ? "selected" : ""}>${t("library.reading")}</option>
        <option value="done" ${item.status === "done" ? "selected" : ""}>${t("library.done")}</option>
      </select>`
    : "";
  return `
  <article class="card" data-id="${esc(item.id)}">
    ${cover}
    <span class="card-badge">${esc(item.type || t(`type.${item.cat === "book" ? "book" : item.cat}`))}</span>
    ${item.score ? `<span class="card-score">★ ${item.score}</span>` : ""}
    <button class="card-fav ${faved ? "faved" : ""}" data-fav="${esc(item.id)}" title="⭐">${faved ? "★" : "☆"}</button>
    <div class="card-body">
      <h3 class="card-title">${esc(item.title)}</h3>
      <div class="card-meta">
        ${item.year ? `<span>📅 ${item.year}</span>` : ""}
        ${item.authors?.length ? `<span>✍️ ${esc(item.authors[0])}</span>` : ""}
      </div>
      <div class="card-counts">${countsText(item)}</div>
      ${accesoHTML(item)}
      ${statusSel}
    </div>
  </article>`;
}

/* ---------- vistas ---------- */
function showView(view) {
  S.view = view;
  $("viewTv").classList.toggle("hidden", view !== "tv");
  $("viewServer").classList.toggle("hidden", view !== "server");
  $("viewVod").classList.toggle("hidden", view !== "vod");
  $("viewRetro").classList.toggle("hidden", view !== "retro");
  $("viewYt").classList.toggle("hidden", view !== "yt");
  $("viewWeb").classList.toggle("hidden", view !== "web");
  $("viewSearch").classList.toggle("hidden", view !== "search");
  $("viewLibrary").classList.toggle("hidden", view !== "library");
  $("viewReader").classList.toggle("hidden", view !== "reader");
  document.querySelectorAll(".nav-tab").forEach((b) => {
    const active =
      (view === "search" && b.dataset.view === "search" && b.dataset.cat === S.cat) ||
      (view !== "search" && b.dataset.view === view);
    b.classList.toggle("active", active);
  });
  // Barra inferior: «Buscar» cubre anime/manga/libros; Sitios y Visor
  // viven en «Más», así que ahí se marca ese botón.
  document.querySelectorAll(".mnav-btn").forEach((b) => {
    const mv = b.dataset.mview;
    // Películas, Series retro, Sitios y Visor viven dentro de «Más»:
    // con cualquiera de ellas abierta, el marcado es ese botón.
    const enMas = ["web", "reader", "vod", "retro", "server"].includes(view);
    const active = mv ? mv === view : enMas;
    b.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-catchip]").forEach((c) =>
    c.classList.toggle("active", c.dataset.catchip === S.cat));
  if (view === "library") renderLibrary();
  // Los catálogos se piden la primera vez que entras, no al arrancar la
  // app: son dos consultas a Internet Archive que no todo el mundo usa.
  if (view === "vod") ensureVodLoaded();
  if (view === "retro") ensureRetroLoaded();
  if (view === "server") ensureServidorLoaded();
  else pausarServidor();   // no dejar vídeo sonando en segundo plano
  if (view === "tv") ensureTvLoaded();
  else pauseTv(); // no reproducir en segundo plano
}

/* ---------- búsqueda ---------- */
async function runSearch({ append = false } = {}) {
  const q = $("searchInput").value.trim();
  const params = {
    cat: S.cat,
    q,
    genre: $("genreSelect").value,
    year: $("yearSelect").value,
    order: $("orderSelect").value,
    status: $("statusSelect").value,
    page: append ? S.page + 1 : 1,
  };
  if (S.cat === "books") {
    params.access = $("accessSelect").value;
    params.lang = $("bookLangSelect").value;
    params.fmt = $("fmtSelect").value;
    params.author = $("authorInput").value.trim();
  }
  if (!append) { S.items = []; $("resultsGrid").innerHTML = ""; }
  $("emptyState").classList.add("hidden");
  $("loader").classList.remove("hidden");
  $("loadMoreWrap").classList.add("hidden");
  try {
    const { items, hasMore, total } = await search(params);
    S.page = params.page;
    S.lastQuery = params;
    S.items = append ? S.items.concat(items) : items;
    $("resultsGrid").insertAdjacentHTML("beforeend", items.map((i) => cardHTML(i)).join(""));
    $("resultsInfo").textContent =
      total != null ? `${total.toLocaleString()} ${t("misc.results")}` : "";
    renderCrossLinks(q);
    $("loadMoreWrap").classList.toggle("hidden", !hasMore);
    if (!S.items.length) {
      $("emptyState").classList.remove("hidden");
      $("emptyState").querySelector("h2").textContent = t("misc.noResults");
    }
  } catch (e) {
    console.error(e);
    toast(t("misc.error"));
    if (!S.items.length) $("emptyState").classList.remove("hidden");
  } finally {
    $("loader").classList.add("hidden");
  }
}

/* ---------- buscador único: puentes a TV y YouTube ----------
   La barra de arriba busca anime/manga/libros, pero lo que escribes
   muchas veces también existe como canal o como video. En vez de hacer
   otra búsqueda pesada, se ofrecen atajos: los canales se cuentan sobre
   la lista ya cargada (gratis) y YouTube solo se consulta si lo pides. */
function renderCrossLinks(q) {
  const box = $("crossLinks");
  if (!box) return;
  const query = String(q || "").trim();
  if (!query) { box.innerHTML = ""; box.classList.add("hidden"); return; }

  let canales = 0;
  try { canales = countChannelMatches(query); } catch (_) {}

  box.classList.remove("hidden");
  box.innerHTML = `
    ${canales ? `<button class="chip" id="crossTv">📺 ${canales} ${t("cross.channels")}</button>` : ""}
    <button class="chip" id="crossYt">▶️ ${t("cross.youtube")}</button>`;
  $("crossTv")?.addEventListener("click", () => {
    showView("tv");
    ensureTvLoaded();
    applyChannelSearch(query);
  });
  $("crossYt")?.addEventListener("click", () => {
    showView("yt");
    searchYouTubeFor(query);
  });
}

/* ---------- filtros ---------- */
let genreReq = 0;
async function loadGenres() {
  const sel = $("genreSelect");
  const req = ++genreReq;
  sel.innerHTML = `<option value="">${t("filter.any")}</option>`;
  try {
    const genres = await getGenres(S.cat);
    if (req !== genreReq) return; // llegó una carga más reciente
    sel.innerHTML =
      `<option value="">${t("filter.any")}</option>` +
      genres.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("");
  } catch (_) { /* sin géneros no pasa nada */ }
}
function loadYears() {
  const sel = $("yearSelect");
  sel.innerHTML = `<option value="">${t("filter.any")}</option>`;
  const now = new Date().getFullYear() + 1;
  const years = [];
  for (let y = now; y >= 1950; y--) years.push(y);
  sel.insertAdjacentHTML("beforeend", years.map((y) => `<option>${y}</option>`).join(""));
}

/* ---------- detalle ---------- */
async function openDetail(id) {
  const base = S.items.find((x) => x.id === id) || lib().find((x) => x.id === id);
  if (!base) return;
  const modal = $("detailModal");
  const box = $("detailContent");
  box.innerHTML = `<div class="loader"><div class="spinner"></div><span>${t("misc.loading")}</span></div>`;
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  let d;
  try { d = await getDetail(base); }
  catch (e) { console.error(e); d = base; }

  const stats = [];
  const c = d.counts || {};
  if (c.episodes) stats.push([t("detail.episodes"), c.episodes]);
  if (c.chapters) stats.push([t("detail.chapters"), c.chapters]);
  if (c.volumes) stats.push([t("detail.volumes"), c.volumes]);
  if (c.editions) stats.push([t("detail.editions"), c.editions]);
  if (c.pages) stats.push([t("detail.pages"), c.pages]);
  if (d.score) stats.push([t("detail.score"), `★ ${d.score}`]);
  if (d.year) stats.push([t("detail.year"), d.year]);
  if (d.status) stats.push([t("detail.status"), d.status]);

  const faved = inLib(d.id);
  const actions = [];
  actions.push(`<button class="btn ${faved ? "btn-ghost" : "btn-primary"}" data-detailfav="${esc(d.id)}">
    ${faved ? "★ " + t("detail.unfav") : "☆ " + t("detail.fav")}</button>`);

  if (d.cat === "book") {
    if (d.ia) actions.push(`<button class="btn btn-primary" data-readia="${esc(d.ia)}" data-title="${esc(d.title)}">${t("detail.readOnline")}</button>`);
    else if ((d.gbooks?.id || d.gbooks?.isbn) && d.gbooks.viewability !== "NO_PAGES")
      actions.push(`<button class="btn btn-primary" data-gbook="${esc(d.gbooks.id || "")}" data-isbn="${esc(d.gbooks.isbn || "")}" data-preview="${esc(d.gbooks.preview || "")}" data-title="${esc(d.title)}">${t("detail.readOnline")}</button>`);
    actions.push(`<a class="btn btn-ghost" href="${esc(d.url)}" target="_blank" rel="noopener">${t("detail.viewOL")} ↗</a>`);
    if (d.gbooks?.preview)
      actions.push(`<a class="btn btn-ghost" href="${esc(d.gbooks.preview)}" target="_blank" rel="noopener">${t("detail.viewGB")} ↗</a>`);
  } else {
    if (d.trailer) actions.push(`<button class="btn btn-primary" data-readurl="${esc(d.trailer)}" data-title="${esc(d.title)} — Trailer">▶ Trailer</button>`);
    actions.push(`<a class="btn btn-ghost" href="${esc(d.url)}" target="_blank" rel="noopener">${d.src === "al" ? t("detail.viewAL") : t("detail.viewMAL")} ↗</a>`);
    for (const ex of d.external || []) {
      if (/official/i.test(ex.name || "")) {
        actions.push(`<a class="btn btn-ghost" href="${esc(ex.url)}" target="_blank" rel="noopener">${t("detail.viewSite")} ↗</a>`);
        break;
      }
    }
  }

  const authorsLine = d.authors?.length
    ? `<div class="detail-sub">✍️ ${t("detail.authors")}: ${esc(d.authors.join(", "))}</div>` : "";

  box.innerHTML = `
    <div class="detail-hero">
      ${d.cover ? `<img class="detail-cover" src="${esc(d.cover)}" alt="" />` : ""}
      <div class="detail-main">
        <h2>${esc(d.title)}</h2>
        ${d.originalTitle ? `<div class="detail-sub">${esc(d.originalTitle)}</div>` : ""}
        ${authorsLine}
        <div class="detail-stats">
          ${stats.map(([k, v]) => `<div class="stat-pill"><b>${esc(v)}</b>${esc(k)}</div>`).join("")}
        </div>
        <div class="detail-genres">
          ${(d.genres || []).slice(0, 8).map((g) => `<span class="genre-tag">${esc(g)}</span>`).join("")}
        </div>
      </div>
    </div>
    <div class="detail-actions">${actions.join("")}</div>
    ${(() => {
      const shortLang = (l) => l ? ` · ${String(l).replace(/english/i, "EN").replace(/spanish.*/i, "ES")}` : "";

      // LIBROS: bibliotecas de dominio público. Arriba se inserta después
      // el botón de Project Gutenberg si la obra está ahí (lectura dentro
      // de la app); esto se resuelve aparte porque tarda una petición.
      if (d.cat === "book") {
        const bs = bookReadingSites(d.title, d.authors?.[0]).slice(0, BOOK_SITES_SHOWN);
        return `
        <div class="detail-section">
          <h3>${t("detail.whereRead")}</h3>
          <div id="gutenBox"></div>
          <p class="ep-hint">${t("detail.publicDomain")}</p>
          <div class="watch-links">
            ${bs.map((s) =>
              `<button class="btn btn-ghost watch-site" data-booksite data-url="${esc(s.url)}" data-title="${esc(d.title)} — ${esc(s.site)}">📖 ${esc(s.site)}${esc(shortLang(s.language))}</button>`).join("")}
          </div>
        </div>
        ${estanteria(t("book.collection").replace("%s", d.coleccion?.nombre || ""), d.coleccion?.items)}
        ${estanteria(t("book.moreByAuthor").replace("%s", d.authors?.[0] || ""), d.masDelAutor)}`;
      }
      // Proveedores OFICIALES con licencia que reportan Jikan/AniList:
      // anime (Crunchyroll, Netflix, HIDIVE…) y también manga (MANGA Plus,
      // Azuki, Comikey… vía AniList): enlace EXACTO y legal a la ficha.
      const official = [];
      {
        const seenOff = new Set();
        for (const s of filterEsEn(d.streaming || [])) {
          const k = s.site.toLowerCase();
          if (!seenOff.has(k)) { official.push(s); seenOff.add(k); }
        }
      }
      // Sitios de config (búsqueda; algunos con resolución exacta vía microservicio).
      let sites = d.cat === "anime" ? animeWatchSites(d.title) : mangaReadingSites(d.title);
      sites = sites.slice(0, 7);
      if (!official.length && !sites.length) return "";
      const icon = d.cat === "anime" ? "▶" : "📖";
      const officialUI = official.length ? `
        <div class="watch-official-wrap">
          <span class="watch-official-label">✅ ${t("detail.official")}</span>
          <div class="watch-official">
            ${official.map((s) =>
              `<button class="btn btn-official" data-officialurl="${esc(s.url)}" data-title="${esc(d.title)} — ${esc(s.site)}">${icon} ${esc(s.site)}${esc(shortLang(s.language))}</button>`).join("")}
          </div>
        </div>` : "";
      const listUI = d.cat === "anime"
        ? ((d.counts?.episodes || d.src !== "al") ? `
          <div class="episodes-block">
            <button class="btn btn-ghost" id="epToggle">📺 ${t("detail.episodesBtn")}</button>
            <div id="epBox" class="hidden"></div>
          </div>` : "")
        : `
          <div class="episodes-block">
            <button class="btn btn-ghost" id="chToggle">📚 ${t("detail.chaptersBtn")}</button>
            <div id="chBox" class="hidden"></div>
          </div>`;
      return `
      <div class="detail-section">
        <h3>${d.cat === "anime" ? t("detail.whereWatch") : t("detail.whereRead")}</h3>
        ${officialUI}
        ${sites.length ? `<div class="watch-links" id="watchLinks">
          ${sites.map((s, i) =>
            `<button class="btn ${i === 0 && !official.length ? "btn-primary" : "btn-ghost"} watch-site" data-site="${i}" data-url="${esc(s.url)}" data-title="${esc(d.title)} — ${esc(s.site)}">${icon} ${esc(s.site)}${esc(shortLang(s.language))}</button>`).join("")}
        </div>` : ""}
        ${listUI}
      </div>`;
    })()}
    ${d.synopsis ? `<div class="detail-section"><h3>${t("detail.synopsis")}</h3><p class="detail-synopsis">${esc(d.synopsis)}</p></div>` : ""}
    ${d.cat !== "book" ? `
      <div class="detail-section">
        <h3>${t("detail.order")}</h3>
        <div id="orderBox">
          <button class="btn btn-ghost" id="orderBtn">${t("detail.orderBtn")}</button>
        </div>
      </div>` : ""}
  `;

  // eventos del detalle
  box.querySelector("[data-detailfav]")?.addEventListener("click", (e) => {
    toggleLib(d);
    openDetail(id); // re-render
  });
  /* Estanterías: abrir otro libro sin salir. `openDetail` busca la obra
     en S.items, así que primero hay que meterla ahí. */
  box.querySelectorAll(".estante-item").forEach((b) =>
    b.addEventListener("click", () => {
      const otro = [...(d.masDelAutor || []), ...(d.coleccion?.items || [])]
        .find((x) => x.id === b.dataset.id);
      if (!otro) return;
      if (!S.items.some((x) => x.id === otro.id)) S.items.push(otro);
      openDetail(otro.id);
    }));
  box.querySelectorAll("[data-readia]").forEach((b) =>
    b.addEventListener("click", () =>
      openIframe(`https://archive.org/embed/${b.dataset.readia}`, b.dataset.title)));
  box.querySelectorAll("[data-readurl]").forEach((b) =>
    b.addEventListener("click", () => openIframe(b.dataset.readurl, b.dataset.title)));
  // Proveedores oficiales: abrir la ficha licenciada dentro del visor.
  box.querySelectorAll("[data-officialurl]").forEach((b) =>
    b.addEventListener("click", () => openIframe(b.dataset.officialurl, b.dataset.title)));

  // Botones de bibliotecas de libros (abren la búsqueda del sitio)
  box.querySelectorAll("[data-booksite]").forEach((b) =>
    b.addEventListener("click", () => openIframe(b.dataset.url, b.dataset.title)));

  // ¿Está en Project Gutenberg? Entonces se puede LEER aquí mismo.
  if (d.cat === "book") {
    findGutenberg(d.title, d.authors || []).then((g) => {
      const boxG = $("gutenBox");
      if (!boxG || !g || !(g.epub || g.html)) return;
      const idioma = g.lang === "es" ? "🇪🇸" : g.lang === "en" ? "🇬🇧" : "🌐";
      boxG.innerHTML = `
        <div class="watch-official-wrap">
          <span class="watch-official-label">✅ ${t("detail.gutenFound")}</span>
          <div class="watch-official">
            ${g.epub ? `<button class="btn btn-official" id="gutenRead">📗 ${t("detail.readHere")} ${idioma}</button>` : ""}
            <a class="btn btn-ghost" href="${esc(g.page)}" target="_blank" rel="noopener">Gutenberg ↗</a>
          </div>
        </div>`;
      $("gutenRead")?.addEventListener("click", () => {
        // El EPUB vive en gutenberg.org, que no manda cabeceras CORS: se
        // baja por el proxy del microservicio y se abre en el visor.
        openRemoteFile(g.epub, `${d.title} — Gutenberg`, { fileName: `${g.id}.epub` });
      });
    }).catch(() => {});
  }

  // --- Sitios "dónde ver/leer" + listado de episodios/capítulos ---
  const watchSites = d.cat === "anime"
    ? animeWatchSites(d.title).slice(0, 7)
    : d.cat === "manga" ? mangaReadingSites(d.title).slice(0, 7) : [];
  let activeSite = 0;
  const resolved = {}; // provider → {animeUrl, episodeTemplate} | null (ya consultado)

  box.querySelectorAll(".watch-site").forEach((b) =>
    b.addEventListener("click", async () => {
      const i = Number(b.dataset.site);
      const s = watchSites[i];
      // marcar sitio activo (para el listado de episodios/capítulos)
      activeSite = i;
      box.querySelectorAll(".watch-site").forEach((x) => {
        x.classList.toggle("btn-primary", x === b);
        x.classList.toggle("btn-ghost", x !== b);
      });
      // Con backend + proveedor de anime: abrir el ENLACE EXACTO.
      if (s && s.provider && d.cat === "anime" && hasBackend()) {
        if (resolved[s.provider] === undefined) {
          const prev = b.textContent;
          b.textContent = "⏳ " + t("misc.loading");
          resolved[s.provider] = await resolveExactLink(s.provider, d.title);
          b.textContent = prev;
        }
        const r = resolved[s.provider];
        if (r?.animeUrl) return openIframe(r.animeUrl, b.dataset.title);
      }
      openIframe(b.dataset.url, b.dataset.title); // respaldo: búsqueda
    }));

  // --- Listado de capítulos de manga (MangaDex, enlace exacto) ---
  const chToggle = $("chToggle");
  if (chToggle) {
    chToggle.addEventListener("click", async () => {
      const boxC = $("chBox");
      if (!boxC.classList.contains("hidden") && boxC.dataset.loaded) { boxC.classList.add("hidden"); return; }
      boxC.classList.remove("hidden");
      if (boxC.dataset.loaded) return;
      boxC.innerHTML = `<div class="loader"><div class="spinner"></div><span>${t("misc.loading")}</span></div>`;
      const chapters = await getMangaChapters(d);
      if (!chapters || !chapters.length) {
        boxC.innerHTML = `<p class="detail-sub">${t("detail.noChapters")}</p>`;
        boxC.dataset.loaded = "1";
        return;
      }
      // Agrupar por tomo
      const groups = new Map();
      for (const c of chapters) {
        const v = c.volume ? `${t("detail.volume")} ${c.volume}` : t("detail.noVolume");
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v).push(c);
      }
      const flag = (l) => (l === "es" || l === "es-la" ? "🇪🇸" : l === "en" ? "🇬🇧" : "🌐");
      boxC.innerHTML = `
        <p class="ep-hint">${t("detail.chaptersHint")}</p>
        ${[...groups.entries()].map(([vol, chs]) => `
          <div class="vol-group">
            <div class="vol-title">📦 ${esc(vol)}</div>
            <ol class="order-list ep-list">
              ${chs.map((c) => `
                <li class="order-item ep-item ${isSeen(d.id, "ch", c.chapter) ? "is-seen" : ""}" data-url="${esc(c.url)}" data-cid="${esc(c.id)}" data-n="${esc(c.chapter)}">
                  <button class="ep-seen" data-seen title="${esc(t("detail.markSeen"))}">✓</button>
                  <span class="order-num">${esc(c.chapter)}</span>
                  <div class="order-info">
                    <div class="order-title">${flag(c.lang)} ${esc(c.title || `${t("detail.chapter")} ${c.chapter}`)}</div>
                  </div>
                  <span class="ep-go">📖</span>
                </li>`).join("")}
            </ol>
          </div>`).join("")}`;
      boxC.dataset.loaded = "1";
      boxC.querySelectorAll(".ep-seen").forEach((btn) =>
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const li = btn.closest(".ep-item");
          const on = !li.classList.contains("is-seen");
          li.classList.toggle("is-seen", on);
          markSeen(d, "ch", li.dataset.n, on);
        }));
      boxC.querySelectorAll(".ep-item").forEach((li) =>
        li.addEventListener("click", async () => {
          const site = watchSites[activeSite] || watchSites[0];
          const label = `${d.title} — ${t("detail.chapter")} ${li.dataset.n}`;
          li.classList.add("is-seen");
          markSeen(d, "ch", li.dataset.n); // marcar leído al abrir
          // MangaDex → lector integrado (páginas reales vía at-home API)
          if ((site?.provider === "mangadex" || !site) && li.dataset.cid) {
            if (li.dataset.busy) return;
            li.dataset.busy = "1";
            li.classList.add("ep-loading");
            try {
              const urls = await getChapterPages(li.dataset.cid);
              openImages(urls.map((u, i) => ({ name: `${i + 1}`, url: u })), label);
            } catch (err) {
              console.warn("Lector integrado:", err.message);
              openIframe(li.dataset.url, label); // respaldo: mangadex.org
            } finally {
              li.classList.remove("ep-loading");
              delete li.dataset.busy;
            }
          } else if (site) {
            openIframe(episodeSearchUrl(site, d.title, li.dataset.n),
              `${label} · ${site.site}`);
          } else {
            openIframe(li.dataset.url, label);
          }
        }));
    });
  }

  const epToggle = $("epToggle");
  if (epToggle) {
    epToggle.addEventListener("click", async () => {
      const boxE = $("epBox");
      if (!boxE.classList.contains("hidden") && boxE.dataset.loaded) {
        boxE.classList.toggle("hidden");
        return;
      }
      boxE.classList.remove("hidden");
      if (boxE.dataset.loaded) return;
      boxE.innerHTML = `<div class="loader"><div class="spinner"></div><span>${t("misc.loading")}</span></div>`;
      const eps = await getEpisodes(d);
      if (!eps || !eps.length) {
        boxE.innerHTML = `<p class="detail-sub">${t("detail.noEpisodes")}</p>`;
        boxE.dataset.loaded = "1";
        return;
      }
      const sitesForEp = watchSites.length ? watchSites : animeWatchSites(d.title);
      boxE.innerHTML = `
        <p class="ep-hint">${t("detail.episodesHint")}</p>
        <div class="ep-bulk">
          <button class="btn btn-ghost btn-mini" id="epAll">✓✓ ${t("detail.markAll")}</button>
          <button class="btn btn-ghost btn-mini" id="epNone">✕ ${t("detail.markNone")}</button>
          <span id="epProgress" class="ep-progress"></span>
        </div>
        <ol class="order-list ep-list">
          ${eps.map((e) => `
            <li class="order-item ep-item ${isSeen(d.id, "ep", e.number) ? "is-seen" : ""}" data-n="${e.number}">
              <button class="ep-seen" data-seen title="${esc(t("detail.markSeen"))}">✓</button>
              <span class="order-num">${e.number}</span>
              <div class="order-info">
                <div class="order-title">${esc(e.title)}</div>
              </div>
              <span class="ep-go">▶</span>
            </li>`).join("")}
        </ol>`;
      boxE.dataset.loaded = "1";

      // Contador de avance y marcado en bloque (una temporada de golpe).
      const refreshProgress = () => {
        const total = eps.length;
        const vistos = boxE.querySelectorAll(".ep-item.is-seen").length;
        const el = $("epProgress");
        if (el) el.textContent = `${vistos}/${total}`;
      };
      refreshProgress();
      $("epAll")?.addEventListener("click", () => {
        boxE.querySelectorAll(".ep-item").forEach((li) => {
          if (!li.classList.contains("is-seen")) {
            li.classList.add("is-seen");
            markSeen(d, "ep", li.dataset.n, true);
          }
        });
        refreshProgress();
      });
      $("epNone")?.addEventListener("click", () => {
        boxE.querySelectorAll(".ep-item").forEach((li) => {
          li.classList.remove("is-seen");
          markSeen(d, "ep", li.dataset.n, false);
        });
        refreshProgress();
      });

      boxE.querySelectorAll(".ep-seen").forEach((btn) =>
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const li = btn.closest(".ep-item");
          const on = !li.classList.contains("is-seen");
          li.classList.toggle("is-seen", on);
          markSeen(d, "ep", li.dataset.n, on);
          refreshProgress();
        }));
      boxE.querySelectorAll(".ep-item").forEach((li) =>
        li.addEventListener("click", async () => {
          const n = li.dataset.n;
          const site = sitesForEp[activeSite] || sitesForEp[0];
          const title = `${d.title} — Ep. ${n} · ${site.site}`;
          li.classList.add("is-seen");
          markSeen(d, "ep", n); // marcar visto al abrir
          // Con backend + proveedor: enlace EXACTO del episodio.
          if (site.provider && hasBackend()) {
            if (resolved[site.provider] === undefined) {
              li.querySelector(".ep-go").textContent = "⏳";
              resolved[site.provider] = await resolveExactLink(site.provider, d.title);
              li.querySelector(".ep-go").textContent = "▶";
            }
            const r = resolved[site.provider];
            if (r?.episodeTemplate)
              return openIframe(r.episodeTemplate.replace("{n}", n), title);
          }
          openIframe(episodeSearchUrl(site, d.title, n), title); // respaldo
        }));
    });
  }

  box.querySelectorAll("[data-gbook]").forEach((b) =>
    b.addEventListener("click", () =>
      openGoogleBook({ volumeId: b.dataset.gbook || null, isbn: b.dataset.isbn || null, previewUrl: b.dataset.preview || null }, b.dataset.title)));

  $("orderBtn")?.addEventListener("click", async () => {
    const boxO = $("orderBox");
    boxO.innerHTML = `<div class="loader"><div class="spinner"></div><span>${t("detail.orderLoading")}</span></div>`;
    try {
      const { chain, extras } = await buildOrder(d);
      if (chain.length <= 1 && !extras.length) {
        boxO.innerHTML = `<p class="detail-sub">${t("detail.orderNone")}</p>`;
        return;
      }
      boxO.innerHTML = `
        <ol class="order-list">
          ${chain.map((n, i) => `
            <li class="order-item ${n.sourceId === d.sourceId ? "current" : ""}" data-mal="${n.sourceId}">
              <span class="order-num">${i + 1}</span>
              <div class="order-info">
                <div class="order-title">${esc(n.title)}</div>
                <div class="order-meta">${esc(n.type || "")} ${n.year ? "· " + n.year : ""} · ${countsText(n)}</div>
              </div>
            </li>`).join("")}
          ${extras.map((x) => `
            <li class="order-item" data-exturl="${esc(x.url)}">
              <span class="order-num">＋</span>
              <div class="order-info">
                <div class="order-title">${esc(x.name)}</div>
                <div class="order-meta"><span class="relation-tag">${esc(x.relation)}</span></div>
              </div>
            </li>`).join("")}
        </ol>`;
      boxO.querySelectorAll(".order-item[data-mal]").forEach((li) =>
        li.addEventListener("click", () => {
          const node = chain.find((n) => String(n.sourceId) === li.dataset.mal);
          if (node) { S.items.push(node); openDetail(node.id); }
        }));
      boxO.querySelectorAll(".order-item[data-exturl]").forEach((li) =>
        li.addEventListener("click", () => window.open(li.dataset.exturl, "_blank", "noopener")));
    } catch (e) {
      console.error(e);
      boxO.innerHTML = `<p class="detail-sub">${t("misc.error")}</p>`;
    }
  });
}

function closeDetail() {
  $("detailModal").classList.add("hidden");
  document.body.style.overflow = "";
}

/* ---------- biblioteca ---------- */
function renderLibrary() {
  renderContinue();
  const list = lib().filter((x) => S.libFilter === "all" || x.status === S.libFilter);
  $("libraryGrid").innerHTML = list.map((i) => cardHTML(i, { library: true })).join("");
  // Ocultar el estado vacío si hay tarjetas guardadas o algo en "Continuar".
  $("libraryEmpty").classList.toggle("hidden", list.length > 0 || continueList().length > 0);
}

/* ---------- archivos recientes del visor ---------- */
function renderRecent() {
  let recent;
  try { recent = JSON.parse(localStorage.getItem("anilector.recent") || "[]"); }
  catch { recent = []; }
  /* Los enlaces se pueden volver a abrir; los archivos de tu equipo NO:
     el navegador no puede reabrir un archivo del disco por su nombre, hay
     que volver a elegirlo. Por eso unos son botones y los otros no. */
  $("recentFiles").innerHTML = recent.length
    ? `<small>${t("reader.recent")}</small>` +
      recent.map((r) => /^https?:\/\//i.test(r)
        ? `<button class="recent-file recent-link" data-url="${esc(r)}" title="${t("reader.open")}">🔗 ${esc(r)}</button>`
        : `<div class="recent-file" title="${t("reader.recentLocal")}">📄 ${esc(r)}</div>`).join("")
    : "";
}
/* Estantería horizontal de libros dentro de una ficha («Más de este
   autor», «Otros tomos»). Si no hay nada, no se pinta el hueco. */
function estanteria(titulo, items) {
  if (!items?.length) return "";
  return `
  <div class="detail-section">
    <h3>${esc(titulo)}</h3>
    <div class="estante">
      ${items.map((b) => `
        <button class="estante-item" data-id="${esc(b.id)}" title="${esc(b.title)}">
          <img loading="lazy" src="${esc(b.cover)}" alt="" />
          <span>${esc(b.title)}</span>
          ${b.year ? `<small>${b.year}</small>` : ""}
        </button>`).join("")}
    </div>
  </div>`;
}

/* ---------- filtros y bibliotecas: solo en libros ---------- */
function ajustarFiltrosPorCat() {
  const libros = S.cat === "books";
  document.querySelectorAll(".solo-libros").forEach((e) => e.classList.toggle("hidden", !libros));
  document.querySelectorAll(".solo-otros").forEach((e) => e.classList.toggle("hidden", libros));
  $("mxLibs").classList.toggle("hidden", !libros);
}

function renderMxLibs() {
  $("mxLibsList").innerHTML = MX_LIBRARIES.map((b) => `
    <a class="mx-lib" href="${esc(b.url)}" target="_blank" rel="noopener">
      <span class="mx-lib-name">${esc(b.name)} ↗</span>
      <span class="mx-lib-tema">${esc(b.tema)}</span>
    </a>`).join("");
}

/* ---------- Mis descargas (documentos guardados en el aparato) ---------- */
async function renderDescargas() {
  const caja = $("descargasBox");
  if (!caja) return;
  if (!DOCS.hayAlmacen()) return caja.classList.add("hidden");

  const fichas = await DOCS.listar();
  caja.classList.toggle("hidden", fichas.length === 0);
  if (!fichas.length) return;

  $("descargasEspacio").textContent =
    `${fichas.length} · ${DOCS.tamanoLegible(await DOCS.espacioUsado())}`;
  $("descargasLista").innerHTML = fichas.map((f) => `
    <div class="dl-item" data-id="${esc(f.id)}">
      <button class="dl-open" data-id="${esc(f.id)}" title="${t("downloads.open")}">
        <span class="dl-name">📄 ${esc(f.titulo || f.nombre)}</span>
        <span class="dl-meta">${DOCS.tamanoLegible(f.tamano)} · ${fechaCorta(f.ts)}</span>
      </button>
      <button class="dl-del" data-id="${esc(f.id)}" title="${t("downloads.delete")}">✕</button>
    </div>`).join("");
}
function fechaCorta(ts) {
  try { return new Date(ts).toLocaleDateString(getLang() === "en" ? "en" : "es",
    { day: "numeric", month: "short" }); }
  catch { return ""; }
}

async function abrirDescarga(id) {
  const fichas = await DOCS.listar();
  const meta = fichas.find((f) => f.id === id);
  if (!meta) return toast(t("downloads.missing"));
  try {
    // Entra por el mismo camino que un archivo del equipo, así que
    // conserva el punto de lectura que ya tuviera.
    await openLocalFile(await DOCS.comoArchivo(meta));
  } catch (e) {
    toast(e.message || t("downloads.missing"));
  }
}

/* Borrar pide confirmación EN EL PROPIO BOTÓN. Un `confirm()` bloquea
   la pestaña entera y en la app instalada queda fatal. */
function pedirBorrado(btn) {
  if (btn.dataset.seguro) return true;
  btn.dataset.seguro = "1";
  const previo = btn.textContent;
  btn.textContent = t("downloads.confirm");
  btn.classList.add("dl-del-armado");
  btn._t = setTimeout(() => {
    delete btn.dataset.seguro;
    btn.textContent = previo;
    btn.classList.remove("dl-del-armado");
  }, 4000);
  return false;
}

function pushRecent(name) {
  try {
    let r = JSON.parse(localStorage.getItem("anilector.recent") || "[]");
    r = [name, ...r.filter((x) => x !== name)].slice(0, 5);
    localStorage.setItem("anilector.recent", JSON.stringify(r));
  } catch (_) {}
  renderRecent();
}

/* ---------- eventos globales ---------- */
function bindEvents() {
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    showView("search");
    runSearch();
  });
  $("toggleFilters").addEventListener("click", () =>
    $("filtersPanel").classList.toggle("hidden"));
  $("clearFilters").addEventListener("click", () => {
    ["genreSelect", "yearSelect", "orderSelect", "statusSelect", "bookLangSelect", "fmtSelect"]
      .forEach((id) => ($(id).selectedIndex = 0));
    // «Disponibilidad» vuelve a Gratis, que es el arranque por defecto.
    $("accessSelect").value = "libre";
    $("authorInput").value = "";
    if (S.view === "search") runSearch();
  });
  ["genreSelect", "yearSelect", "orderSelect", "statusSelect",
   "accessSelect", "bookLangSelect", "fmtSelect"].forEach((id) =>
    $(id).addEventListener("change", () => { if (S.view === "search") runSearch(); }));
  // El autor es un campo de texto: se busca al pulsar Enter o al salir.
  $("authorInput").addEventListener("change", () => { if (S.view === "search") runSearch(); });
  $("authorInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (S.view === "search") runSearch(); }
  });

  // Bibliotecas de México
  renderMxLibs();
  $("mxLibsToggle").addEventListener("click", () => {
    const abierto = !$("mxLibsBody").classList.toggle("hidden");
    $("mxLibsToggle").setAttribute("aria-expanded", String(abierto));
    $("mxLibsToggle").querySelector(".mx-libs-caret").textContent = abierto ? "▴" : "▾";
  });

  // Cambiar de categoría (anime/manga/libros) desde donde sea.
  async function gotoCat(cat) {
    const changed = S.cat !== cat;
    S.cat = cat;
    showView("search");
    ajustarFiltrosPorCat();
    // Sin await: loadGenres ya resetea el selector de inmediato y la
    // búsqueda no debe esperar a los géneros (con Jikan lento dejaba
    // los resultados de la categoría anterior en pantalla).
    if (changed) loadGenres();
    if (changed || !S.items.length) runSearch();
  }

  document.querySelectorAll(".nav-tab").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.view === "search") gotoCat(b.dataset.cat);
      else showView(b.dataset.view);
    }));

  /* ---------- navegación móvil (barra inferior + hoja «Más») ---------- */
  document.querySelectorAll(".mnav-btn[data-mview]").forEach((b) =>
    b.addEventListener("click", () => {
      closeMore();
      if (b.dataset.mview === "search") gotoCat(S.cat);
      else showView(b.dataset.mview);
    }));

  const sheet = $("moreSheet");
  const openMore = () => sheet.classList.remove("hidden");
  function closeMore() { sheet.classList.add("hidden"); }
  $("moreBtn").addEventListener("click", () =>
    sheet.classList.contains("hidden") ? openMore() : closeMore());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeMore(); });
  sheet.querySelectorAll(".more-item[data-mview]").forEach((b) =>
    b.addEventListener("click", () => { closeMore(); showView(b.dataset.mview); }));

  // Chips de categoría dentro de Buscar
  document.querySelectorAll("[data-catchip]").forEach((b) =>
    b.addEventListener("click", () => gotoCat(b.dataset.catchip)));
  $("toggleFiltersM")?.addEventListener("click", () =>
    $("filtersPanel").classList.toggle("hidden"));

  document.querySelectorAll(".chip[data-libfilter]").forEach((chip) =>
    chip.addEventListener("click", () => {
      S.libFilter = chip.dataset.libfilter;
      document.querySelectorAll(".chip[data-libfilter]").forEach((c) =>
        c.classList.toggle("active", c === chip));
      renderLibrary();
    }));

  $("brandHome").addEventListener("click", () => showView("tv"));
  $("explorePopular").addEventListener("click", () => runSearch());
  $("loadMoreBtn").addEventListener("click", () => runSearch({ append: true }));

  // delegación: tarjetas y favoritos
  document.body.addEventListener("click", (e) => {
    const fav = e.target.closest("[data-fav]");
    if (fav) {
      e.stopPropagation();
      const item = S.items.find((x) => x.id === fav.dataset.fav) || lib().find((x) => x.id === fav.dataset.fav);
      if (item) {
        toggleLib(item);
        fav.classList.toggle("faved");
        fav.textContent = fav.classList.contains("faved") ? "★" : "☆";
      }
      return;
    }
    const card = e.target.closest(".card");
    if (card && !e.target.closest(".lib-status")) openDetail(card.dataset.id);
  });

  // estado en biblioteca
  document.body.addEventListener("change", (e) => {
    if (e.target.matches(".lib-status")) {
      const list = lib();
      const it = list.find((x) => x.id === e.target.dataset.id);
      if (it) { it.status = e.target.value; saveLib(list); renderLibrary(); }
    }
  });

  // cierres de modal
  document.querySelectorAll(".modal-close").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.close === "viewerModal") closeViewer();
      else closeDetail();
    }));
  $("detailModal").addEventListener("click", (e) => {
    if (e.target === $("detailModal")) closeDetail();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("detailModal").classList.contains("hidden")) closeDetail();
  });

  // visor
  $("fileInput").addEventListener("change", async (e) => {
    // Copiar la lista y limpiar el input ANTES de abrir: si el visor se
    // queda esperando (p. ej. pidiendo contraseña), el input seguiría con
    // el archivo puesto y volver a elegir el MISMO no dispararía nada.
    const files = Array.from(e.target.files);
    e.target.value = "";
    if (!files.length) return;
    try {
      await openLocalFiles(files);
      files.forEach((f) => pushRecent(f.name));
    } catch (err) { toast(err.message); }
  });
  $("urlForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const url = $("urlInput").value.trim();
    if (url) { openUrl(url); pushRecent(url); }
  });
  // Reabrir un enlace reciente con un clic (antes la lista era decorativa).
  $("recentFiles").addEventListener("click", (e) => {
    const b = e.target.closest(".recent-link");
    if (!b) return;
    openUrl(b.dataset.url);
    pushRecent(b.dataset.url);
  });

  // Mis descargas: abrir y borrar
  $("descargasLista").addEventListener("click", async (e) => {
    const abrir = e.target.closest(".dl-open");
    if (abrir) return abrirDescarga(abrir.dataset.id);
    const borrar = e.target.closest(".dl-del");
    if (!borrar) return;
    if (!pedirBorrado(borrar)) return;      // primer clic: solo arma
    clearTimeout(borrar._t);
    try {
      await DOCS.borrar(borrar.dataset.id);
      toast(t("downloads.deleted"));
    } catch (_) {
      toast(t("downloads.deleteFailed"));
    }
    renderDescargas();
  });
  // El visor avisa cuando guarda algo, para repintar el estante.
  window.addEventListener("anilector:descargas", renderDescargas);

  // idioma y tema (los selectores del encabezado y los de la hoja «Más»
  // son el mismo ajuste: se mantienen sincronizados)
  const applyLang = (v) => {
    setLang(v);
    $("langSelect").value = v;
    $("langSelectM").value = v;
    loadYears();
    loadGenres();
    if (S.view === "library") renderLibrary();
    renderRecent();
  };
  const applyTheme = (v) => {
    document.documentElement.dataset.theme = v;
    localStorage.setItem("anilector.theme", v);
    $("themeSelect").value = v;
    $("themeSelectM").value = v;
  };
  $("langSelect").addEventListener("change", (e) => applyLang(e.target.value));
  $("langSelectM").addEventListener("change", (e) => applyLang(e.target.value));
  $("themeSelect").addEventListener("change", (e) => applyTheme(e.target.value));
  $("themeSelectM").addEventListener("change", (e) => applyTheme(e.target.value));

  bindViewerControls();
}

/* Mide la barra superior y el reproductor de TV para que los elementos
   fijos se coloquen justo debajo. Con medidas fijas en CSS se solapaban,
   porque el encabezado cambia de alto según el idioma y el ancho. */
function syncStickyOffsets() {
  const root = document.documentElement;
  const tb = document.querySelector(".topbar");
  const st = document.querySelector(".tv-stage");
  if (tb) root.style.setProperty("--topbar-h", `${Math.round(tb.getBoundingClientRect().height)}px`);
  if (st) root.style.setProperty("--tv-stage-h", `${Math.round(st.getBoundingClientRect().height)}px`);
}

/* ---------- arranque ---------- */
function init() {
  const theme = localStorage.getItem("anilector.theme") || "dark";
  document.documentElement.dataset.theme = theme;
  $("themeSelect").value = theme;
  $("themeSelectM").value = theme;

  const lang = getLang();
  $("langSelect").value = lang;
  $("langSelectM").value = lang;
  setLang(lang);

  onProviderChange(() => {
    toast(t("misc.fallback"));
    loadGenres();
  });

  initAuth(() => {
    if (S.view === "library") renderLibrary();
    renderRecent();
  });

  loadYears();
  loadGenres();
  renderRecent();
  renderDescargas();
  bindEvents();
  ajustarFiltrosPorCat();
  initTv();
  initVod();
  initRetro();
  initServidor();
  initYouTube();
  initWebApps();
  initBrand();
  initTvMode();
  initPwa();
  // Arrastrar y soltar, doble clic en el explorador y «compartir con
  // AniLector». Va al final: necesita el visor y el toast ya montados.
  initEntradas();

  syncStickyOffsets();
  window.addEventListener("resize", syncStickyOffsets);
  window.addEventListener("orientationchange", syncStickyOffsets);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(syncStickyOffsets);
    document.querySelectorAll(".topbar, .tv-stage").forEach((el) => ro.observe(el));
  }

  // Página de inicio: TV en vivo
  showView("tv");
}

init();
