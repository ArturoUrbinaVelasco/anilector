/* ============================================================
   AniLector — YouTube (estilo GreenTuber)
   Búsqueda vía Piped (frontend abierto de YouTube) + reproducción
   con el reproductor OFICIAL de YouTube (youtube-nocookie).
   ============================================================ */
import { t } from "./i18n.js";
import { PIPED_APIS, INVIDIOUS_APIS, BACKEND_URL } from "./config.js";

// GreenTuber: primero nuestro microservicio (server-side, sin CORS ni terceros
// caídos); si no hay backend o falla, respaldo con Piped/Invidious.
async function searchGreentuber(q) {
  if (BACKEND_URL) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${BACKEND_URL.replace(/\/$/, "")}/api/yt?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
      clearTimeout(timer);
      const d = await res.json();
      if (d.items?.length) return d.items;
    } catch (_) { /* respaldo abajo */ }
  }
  return searchPiped(q);
}

const $ = (id) => document.getElementById(id);
const state = { items: [] };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Extrae el ID de video de una URL o texto de YouTube (o devuelve null)
function videoId(input) {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

async function searchPiped(q) {
  let lastErr;
  for (const base of PIPED_APIS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`${res.status}`);
      const d = await res.json();
      const items = (d.items || d || [])
        .filter((i) => i.url || i.videoId)
        .map((i) => ({
          id: (i.url && i.url.split("v=")[1]) || i.videoId,
          title: i.title,
          uploader: i.uploaderName || i.author || "",
          thumb: i.thumbnail || i.thumbnails?.[0]?.url || "",
          duration: i.duration,
        }))
        .filter((i) => i.id);
      if (items.length) return items;
    } catch (e) { lastErr = e; }
  }
  // Respaldo: Invidious
  for (const base of INVIDIOUS_APIS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`${res.status}`);
      const d = await res.json();
      const items = (d || [])
        .filter((i) => i.videoId)
        .map((i) => ({
          id: i.videoId,
          title: i.title,
          uploader: i.author || "",
          thumb: (i.videoThumbnails || []).find((th) => th.quality === "medium")?.url || i.videoThumbnails?.[0]?.url || "",
          duration: i.lengthSeconds,
        }));
      if (items.length) return items;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("sin resultados");
}

function fmtDur(s) {
  if (!s) return "";
  if (typeof s === "string") return s; // ya viene como "4:20"
  if (s < 0) return "";
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function play(id, title) {
  $("ytPlayer").classList.remove("hidden");
  $("ytNow").textContent = title || id;
  $("ytExternal").href = `https://www.youtube.com/watch?v=${id}`;
  $("ytFrame").src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
  $("ytPlayer").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderResults() {
  const grid = $("ytGrid");
  if (!state.items.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🔎</div><p>${t("misc.noResults")}</p></div>`;
    return;
  }
  grid.innerHTML = state.items.map((v) => `
    <article class="card yt-card" data-id="${esc(v.id)}" data-title="${esc(v.title)}">
      <div class="yt-thumb-wrap">
        ${v.thumb ? `<img class="yt-thumb" loading="lazy" src="${esc(v.thumb)}" alt="" onerror="this.style.display='none'"/>` : `<div class="yt-thumb yt-thumb-ph">▶</div>`}
        ${v.duration ? `<span class="yt-dur">${fmtDur(v.duration)}</span>` : ""}
      </div>
      <div class="card-body">
        <h3 class="card-title">${esc(v.title)}</h3>
        <div class="card-meta">${v.uploader ? `<span>👤 ${esc(v.uploader)}</span>` : ""}</div>
      </div>
    </article>`).join("");
}

async function doSearch(q) {
  const grid = $("ytGrid");
  // ¿Pegó un enlace/ID directo? → reproducir de una vez
  const vid = videoId(q);
  if (vid) { play(vid, q); return; }
  grid.innerHTML = `<div class="loader"><div class="spinner"></div><span>${t("misc.loading")}</span></div>`;
  try {
    state.items = await searchGreentuber(q);
    renderResults();
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📺</div>
      <p>${t("yt.searchError")}</p></div>`;
  }
}

export function initYouTube() {
  $("ytForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("ytSearch").value.trim();
    if (q) doSearch(q);
  });
  $("ytGrid").addEventListener("click", (e) => {
    const c = e.target.closest(".yt-card");
    if (c) play(c.dataset.id, c.dataset.title);
  });
  $("ytClose").addEventListener("click", () => {
    $("ytFrame").src = "about:blank";
    $("ytPlayer").classList.add("hidden");
  });
}
