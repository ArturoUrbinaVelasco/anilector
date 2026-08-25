/* ============================================================
   AniLector — catálogo de Internet Archive (fábrica reutilizable)
   Se usa para Películas (VOD) y para Series retro. Catálogo legal
   y gratuito (dominio público / licencias libres).
   ============================================================ */
import { t } from "./i18n.js";
import { VOD_COLLECTIONS, RETRO_COLLECTIONS } from "./config.js";
import { openIframe } from "./viewer.js";

const IA = "https://archive.org";
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* prefix: 'vod' | 'retro' → usa los ids `${prefix}Grid`, `${prefix}Cats`… */
function createCatalog(prefix, collections, unitKey, mediatypes) {
  const state = { col: 0, query: "", sort: "downloads desc", page: 1, items: [], hasMore: false, loading: false, loaded: false };
  const gid = `${prefix}Grid`, cid = `${prefix}Cats`, sid = `${prefix}Search`,
        iid = `${prefix}Info`, mid = `${prefix}More`, sortId = `${prefix}Sort`;

  async function fetchPage({ append = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    const grid = $(gid);
    if (!append) { grid.innerHTML = `<div class="loader"><div class="spinner"></div><span>${t("misc.loading")}</span></div>`; state.page = 1; }

    const col = collections[state.col];
    let q = `mediatype:(${mediatypes})`;
    if (col?.collection) q += ` AND collection:(${col.collection})`;
    if (col?.query) q += ` AND (${col.query})`;
    if (state.query) {
      // Coincidencia PARCIAL (no exige el nombre exacto): cada palabra con
      // comodín, buscando en título y descripción.
      const terms = state.query.replace(/[":()\[\]]/g, " ").split(/\s+/).filter(Boolean);
      if (terms.length) {
        q += " AND (" + terms.map((w) => `(title:${w}* OR ${w}*)`).join(" AND ") + ")";
      }
    }

    const params = new URLSearchParams();
    params.set("q", q);
    ["identifier", "title", "year", "downloads"].forEach((f) => params.append("fl[]", f));
    params.append("sort[]", state.sort);
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
      $(iid).textContent = `${numFound.toLocaleString()} ${t(unitKey)}`;
    } catch (e) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🎬</div><p>${t("vod.error")}</p></div>`;
    } finally {
      state.loading = false;
    }
  }

  function render() {
    const grid = $(gid);
    if (!state.items.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🔎</div><p>${t("misc.noResults")}</p></div>`;
      $(mid).classList.add("hidden");
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
    $(mid).classList.toggle("hidden", !state.hasMore);
  }

  function play(id, title) {
    openIframe(`${IA}/embed/${encodeURIComponent(id)}`, title || "▶", { hint: false });
  }

  function init() {
    $(cid).innerHTML = collections.map((c, i) =>
      `<button class="chip ${i === 0 ? "active" : ""}" data-col="${i}">${esc(c.name)}</button>`).join("");
    $(cid).addEventListener("click", (e) => {
      const b = e.target.closest("[data-col]");
      if (!b) return;
      document.querySelectorAll(`#${cid} .chip`).forEach((c) => c.classList.toggle("active", c === b));
      state.col = Number(b.dataset.col);
      fetchPage();
    });
    let deb;
    $(sid).addEventListener("input", (e) => {
      clearTimeout(deb);
      state.query = e.target.value.trim();
      deb = setTimeout(() => fetchPage(), 350);
    });
    if ($(sortId)) $(sortId).addEventListener("change", (e) => { state.sort = e.target.value; fetchPage(); });
    $(gid).addEventListener("click", (e) => {
      const c = e.target.closest(".vod-card");
      if (c) play(c.dataset.id, c.dataset.title);
    });
    $(mid).addEventListener("click", () => { state.page++; fetchPage({ append: true }); });
  }

  function ensureLoaded() {
    if (state.loaded) return;
    state.loaded = true;
    fetchPage();
  }

  return { init, ensureLoaded };
}

// Películas: solo mediatype movies. Series retro: incluye colecciones de TV.
const movies = createCatalog("vod", VOD_COLLECTIONS, "vod.movies", "movies");
const retro = createCatalog("retro", RETRO_COLLECTIONS, "retro.items", "movies");

export function initVod() { movies.init(); }
export function ensureVodLoaded() { movies.ensureLoaded(); }
export function initRetro() { retro.init(); }
export function ensureRetroLoaded() { retro.ensureLoaded(); }
