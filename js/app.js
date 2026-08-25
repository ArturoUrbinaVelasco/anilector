/* ============================================================
   AniLector — controlador principal
   ============================================================ */
import { t, setLang, getLang, applyTranslations } from "./i18n.js";
import {
  search, getGenres, getDetail, buildOrder, onProviderChange,
  filterEsEn, mangaReadingSites,
} from "./api.js";
import {
  openLocalFiles, openUrl, openIframe, openGoogleBook, closeViewer, bindViewerControls,
} from "./viewer.js";
import { initAuth } from "./auth.js";

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
function saveLib(list) {
  localStorage.setItem("anilector.library", JSON.stringify(list));
  window.dispatchEvent(new Event("anilector:datachanged"));
}
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
      ${statusSel}
    </div>
  </article>`;
}

/* ---------- vistas ---------- */
function showView(view) {
  S.view = view;
  $("viewSearch").classList.toggle("hidden", view !== "search");
  $("viewLibrary").classList.toggle("hidden", view !== "library");
  $("viewReader").classList.toggle("hidden", view !== "reader");
  document.querySelectorAll(".nav-tab").forEach((b) => {
    const active =
      (view === "search" && b.dataset.view === "search" && b.dataset.cat === S.cat) ||
      (view !== "search" && b.dataset.view === view);
    b.classList.toggle("active", active);
  });
  if (view === "library") renderLibrary();
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
      // Solo enlaces en español o inglés
      let sites = filterEsEn(d.streaming);
      if (d.cat === "manga") {
        // Garantizar al menos 5 sitios de lectura (plataformas legales ES/EN)
        const seen = new Set(sites.map((s) => { try { return new URL(s.url).hostname; } catch { return s.url; } }));
        for (const s of mangaReadingSites(d.title)) {
          let h; try { h = new URL(s.url).hostname; } catch { h = s.url; }
          if (!seen.has(h)) { sites.push(s); seen.add(h); }
        }
      }
      sites = sites.slice(0, d.cat === "manga" ? 8 : 10);
      if (d.cat === "book" || !sites.length) return "";
      const shortLang = (l) => l ? ` · ${String(l).replace(/english/i, "EN").replace(/spanish.*/i, "ES")}` : "";
      return `
      <div class="detail-section">
        <h3>${d.cat === "anime" ? t("detail.whereWatch") : t("detail.whereRead")}</h3>
        <div class="watch-links">
          ${sites.map((s) =>
            `<button class="btn btn-ghost" data-readurl="${esc(s.url)}" data-title="${esc(d.title)} — ${esc(s.site)}">${d.cat === "anime" ? "▶" : "📖"} ${esc(s.site)}${esc(shortLang(s.language))}</button>`).join("")}
        </div>
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
  box.querySelectorAll("[data-readia]").forEach((b) =>
    b.addEventListener("click", () =>
      openIframe(`https://archive.org/embed/${b.dataset.readia}`, b.dataset.title)));
  box.querySelectorAll("[data-readurl]").forEach((b) =>
    b.addEventListener("click", () => openIframe(b.dataset.readurl, b.dataset.title)));
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
  const list = lib().filter((x) => S.libFilter === "all" || x.status === S.libFilter);
  $("libraryGrid").innerHTML = list.map((i) => cardHTML(i, { library: true })).join("");
  $("libraryEmpty").classList.toggle("hidden", list.length > 0);
}

/* ---------- archivos recientes del visor ---------- */
function renderRecent() {
  let recent;
  try { recent = JSON.parse(localStorage.getItem("anilector.recent") || "[]"); }
  catch { recent = []; }
  $("recentFiles").innerHTML = recent.length
    ? `<small>${t("reader.recent")}</small>` +
      recent.map((r) => `<div class="recent-file">📄 ${esc(r)}</div>`).join("")
    : "";
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
    ["genreSelect", "yearSelect", "orderSelect", "statusSelect"].forEach((id) => ($(id).selectedIndex = 0));
  });
  ["genreSelect", "yearSelect", "orderSelect", "statusSelect"].forEach((id) =>
    $(id).addEventListener("change", () => { if (S.view === "search") runSearch(); }));

  document.querySelectorAll(".nav-tab").forEach((b) =>
    b.addEventListener("click", async () => {
      if (b.dataset.view === "search") {
        const changed = S.cat !== b.dataset.cat;
        S.cat = b.dataset.cat;
        showView("search");
        if (changed) { await loadGenres(); runSearch(); }
      } else showView(b.dataset.view);
    }));

  document.querySelectorAll(".chip[data-libfilter]").forEach((chip) =>
    chip.addEventListener("click", () => {
      S.libFilter = chip.dataset.libfilter;
      document.querySelectorAll(".chip[data-libfilter]").forEach((c) =>
        c.classList.toggle("active", c === chip));
      renderLibrary();
    }));

  $("brandHome").addEventListener("click", () => showView("search"));
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
    try {
      const names = Array.from(e.target.files).map((f) => f.name);
      await openLocalFiles(e.target.files);
      names.forEach(pushRecent);
    } catch (err) { toast(err.message); }
    e.target.value = "";
  });
  $("urlForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const url = $("urlInput").value.trim();
    if (url) { openUrl(url); pushRecent(url); }
  });

  // idioma y tema
  $("langSelect").addEventListener("change", (e) => {
    setLang(e.target.value);
    loadYears();
    loadGenres();
    if (S.view === "library") renderLibrary();
    renderRecent();
  });
  $("themeSelect").addEventListener("change", (e) => {
    document.documentElement.dataset.theme = e.target.value;
    localStorage.setItem("anilector.theme", e.target.value);
  });

  bindViewerControls();
}

/* ---------- arranque ---------- */
function init() {
  const theme = localStorage.getItem("anilector.theme") || "dark";
  document.documentElement.dataset.theme = theme;
  $("themeSelect").value = theme;

  const lang = getLang();
  $("langSelect").value = lang;
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
  bindEvents();
  // carga inicial: populares de anime
  runSearch();
}

init();
