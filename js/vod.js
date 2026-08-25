/* ============================================================
   AniLector — Películas (VOD) con Internet Archive
   Catálogo legal y gratuito (dominio público / licencias libres).
   Búsqueda + cuadrícula de pósters + reproducción embebida.
   ============================================================ */
import { t } from "./i18n.js";
import { VOD_COLLECTIONS } from "./config.js";
import { openIframe } from "./viewer.js";

const IA = "https://archive.org";
const $ = (id) => document.getElementById(id);
const state = { col: 0, query: "", page: 1, items: [], hasMore: false, loading: false };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- consulta a Internet Archive ---------- */
async function fetchPage({ append = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  const grid = $("vodGrid");
  if (!append) { grid.innerHTML = `<div class="loader"><div class="spinner"></div><span>${t("misc.loading")}</span></div>`; state.page = 1; }

  const col = VOD_COLLECTIONS[state.col];
  let q = "mediatype:(movies)";
  if (col?.collection) q += ` AND collection:(${col.collection})`;
  if (col?.query) q += ` AND (${col.query})`;
  if (state.query) q += ` AND (title:(${state.query.replace(/[()]/g, "")}))`;

  const params = new URLSearchParams();
  params.set("q", q);
  ["identifier", "title", "year", "downloads"].forEach((f) => params.append("fl[]", f));
  params.append("sort[]", state.query ? "downloads desc" : "downloads desc");
  params.set("rows", "60");
  params.set("page", String(state.page));
  params.set("output", "json");

  try {
    const res = await fetch(`${IA}/advancedsearch.php?${params}`);
    if (!res.ok) throw new Error(`IA ${res.status}`);
    const data = await res.json();
    const docs = data.response?.docs || [];
    const numFound = data.response?.numFound || 0;
    state.items = append ? state.items.concat(docs) : docs;
    state.hasMore = state.page * 60 < numFound;
    render();
    $("vodInfo").textContent = `${numFound.toLocaleString()} ${t("vod.movies")}`;
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🎬</div><p>${t("vod.error")}</p></div>`;
  } finally {
    state.loading = false;
  }
}

function render() {
  const grid = $("vodGrid");
  if (!state.items.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🔎</div><p>${t("misc.noResults")}</p></div>`;
    $("vodMore").classList.add("hidden");
    return;
  }
  grid.innerHTML = state.items.map((m) => {
    const poster = `${IA}/services/img/${encodeURIComponent(m.identifier)}`;
    return `<article class="card vod-card" data-id="${esc(m.identifier)}" data-title="${esc(m.title || "")}">
      <img class="card-cover" loading="lazy" src="${esc(poster)}" alt=""
        onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'card-cover placeholder',textContent:'🎬'}))" />
      <div class="card-body">
        <h3 class="card-title">${esc(m.title || "—")}</h3>
        <div class="card-meta">${m.year ? `<span>📅 ${esc(m.year)}</span>` : ""}${m.downloads ? `<span>▶ ${Number(m.downloads).toLocaleString()}</span>` : ""}</div>
      </div>
    </article>`;
  }).join("");
  $("vodMore").classList.toggle("hidden", !state.hasMore);
}

function play(id, title) {
  // Reproductor legal embebido de Internet Archive
  openIframe(`${IA}/embed/${encodeURIComponent(id)}`, title || "Película", { hint: false });
}

/* ---------- interfaz ---------- */
export function initVod() {
  $("vodCats").innerHTML = VOD_COLLECTIONS.map((c, i) =>
    `<button class="chip ${i === 0 ? "active" : ""}" data-col="${i}">${esc(c.name)}</button>`).join("");
  $("vodCats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-col]");
    if (!b) return;
    document.querySelectorAll("#vodCats .chip").forEach((c) => c.classList.toggle("active", c === b));
    state.col = Number(b.dataset.col);
    fetchPage();
  });
  let deb;
  $("vodSearch").addEventListener("input", (e) => {
    clearTimeout(deb);
    state.query = e.target.value.trim();
    deb = setTimeout(() => fetchPage(), 350);
  });
  $("vodGrid").addEventListener("click", (e) => {
    const c = e.target.closest(".vod-card");
    if (c) play(c.dataset.id, c.dataset.title);
  });
  $("vodMore").addEventListener("click", () => { state.page++; fetchPage({ append: true }); });
}

let loaded = false;
export function ensureVodLoaded() {
  if (loaded) return;
  loaded = true;
  fetchPage();
}
