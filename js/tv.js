/* ============================================================
   AniLector — TV en vivo (listas M3U de código abierto)
   Parser M3U + reproductor HLS (hls.js) embebido en la app.
   ============================================================ */
import { t } from "./i18n.js";
import { M3U_LISTS } from "./config.js";

const $ = (id) => document.getElementById(id);
const state = { listIndex: 0, channels: [], group: "", query: "", hls: null, current: -1, view: [] };
const cache = {}; // url → channels[]
const MAX_RENDER = 500;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- parser M3U ---------- */
export function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let cur = null;
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const logo = /tvg-logo="([^"]*)"/i.exec(line)?.[1] || "";
      const group = /group-title="([^"]*)"/i.exec(line)?.[1] || "";
      const name = line.slice(line.lastIndexOf(",") + 1).trim();
      cur = { name: name || "Canal", logo, group };
    } else if (line.startsWith("#")) {
      continue;
    } else if (cur) {
      cur.url = line;
      out.push(cur);
      cur = null;
    }
  }
  return out;
}

/* ---------- carga de lista ---------- */
async function loadList(i) {
  state.listIndex = i;
  state.group = "";
  state.query = "";
  const list = M3U_LISTS[i];
  const grid = $("tvGrid");
  grid.innerHTML = `<div class="loader"><div class="spinner"></div><span>${t("misc.loading")}</span></div>`;
  $("tvInfo").textContent = "";
  if (cache[list.url]) { state.channels = cache[list.url]; renderGroups(); renderChannels(); return; }
  try {
    const res = await fetch(list.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const channels = parseM3U(text).filter((c) => c.url);
    cache[list.url] = channels;
    state.channels = channels;
    renderGroups();
    renderChannels();
  } catch (e) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📡</div>
      <p>${t("tv.loadError")}</p>
      <a class="btn btn-ghost" href="${esc(list.url)}" target="_blank" rel="noopener">${t("tv.openList")} ↗</a>
    </div>`;
  }
}

/* ---------- filtros ---------- */
function filtered() {
  let ch = state.channels;
  if (state.group) ch = ch.filter((c) => c.group === state.group);
  if (state.query) {
    const q = state.query.toLowerCase();
    ch = ch.filter((c) => c.name.toLowerCase().includes(q));
  }
  return ch;
}

function renderGroups() {
  const sel = $("tvGroup");
  const groups = [...new Set(state.channels.map((c) => c.group).filter(Boolean))].sort();
  sel.innerHTML =
    `<option value="">${t("tv.allGroups")}</option>` +
    groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join("");
}

function renderChannels() {
  const grid = $("tvGrid");
  const ch = filtered();
  state.view = ch; // lista visible (para zapping anterior/siguiente)
  $("tvInfo").textContent = `${ch.length.toLocaleString()} ${t("tv.channels")}` +
    (ch.length > MAX_RENDER ? ` · ${t("tv.showingFirst")} ${MAX_RENDER}` : "");
  if (!ch.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🔎</div><p>${t("misc.noResults")}</p></div>`;
    return;
  }
  grid.innerHTML = ch.slice(0, MAX_RENDER).map((c, i) => {
    const logo = c.logo
      ? `<img class="tv-logo" loading="lazy" src="${esc(c.logo)}" alt="" onerror="this.style.visibility='hidden'" />`
      : `<div class="tv-logo tv-logo-fallback">📺</div>`;
    return `<button class="tv-row ${c === state.channels[state.current] ? "active" : ""}" data-vi="${i}">
      ${logo}
      <span class="tv-row-info">
        <span class="tv-name">${esc(c.name)}</span>
        ${c.group ? `<span class="tv-group">${esc(c.group)}</span>` : ""}
      </span>
    </button>`;
  }).join("");
}

function highlightCurrent() {
  const cur = state.channels[state.current];
  document.querySelectorAll("#tvGrid .tv-row").forEach((r) =>
    r.classList.toggle("active", state.view[Number(r.dataset.vi)] === cur));
}

/* ---------- reproductor ---------- */
function stopPlayback() {
  if (state.hls) { try { state.hls.destroy(); } catch (_) {} state.hls = null; }
  const v = $("tvVideo");
  if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
}

function playIndex(idx) {
  const channel = state.channels[idx];
  if (!channel) return;
  state.current = idx;
  const v = $("tvVideo");
  const err = $("tvError");
  const ph = $("tvPlaceholder");
  err.classList.add("hidden");
  ph.classList.add("hidden");
  v.classList.add("playing");
  $("tvNow").textContent = channel.name;
  $("tvExternal").href = channel.url;
  stopPlayback();
  highlightCurrent();

  const isHls = /\.m3u8(\?|$)/i.test(channel.url);
  const onFail = () => {
    err.classList.remove("hidden");
    err.innerHTML = `${t("tv.playError")} <a class="btn btn-primary btn-mini" href="${esc(channel.url)}" target="_blank" rel="noopener">${t("tv.openTab")}</a>`;
  };

  try {
    if (isHls && window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ maxBufferLength: 20 });
      state.hls = hls;
      hls.loadSource(channel.url);
      hls.attachMedia(v);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
      hls.on(window.Hls.Events.ERROR, (_e, data) => { if (data?.fatal) { stopPlayback(); onFail(); } });
    } else {
      v.src = channel.url; // Safari (HLS nativo) o streams directos
      v.play().catch(() => {});
      v.onerror = onFail;
    }
  } catch (_) { onFail(); }
}

// Zapping: avanza/retrocede dentro de la lista visible
function zap(dir) {
  if (!state.view.length) return;
  const cur = state.channels[state.current];
  let vi = state.view.indexOf(cur);
  if (vi < 0) vi = dir > 0 ? -1 : state.view.length;
  vi = (vi + dir + state.view.length) % state.view.length;
  const next = state.view[vi];
  playIndex(state.channels.indexOf(next));
  // desplazar la fila activa a la vista
  const row = document.querySelector(`#tvGrid .tv-row[data-vi="${vi}"]`);
  row?.scrollIntoView({ block: "nearest" });
}

/* ---------- interfaz ---------- */
export function initTv() {
  // selector de listas
  $("tvLists").innerHTML = M3U_LISTS.map((l, i) =>
    `<button class="chip ${i === 0 ? "active" : ""}" data-list="${i}">${l.flag} ${esc(l.name)}</button>`).join("");
  $("tvLists").addEventListener("click", (e) => {
    const b = e.target.closest("[data-list]");
    if (!b) return;
    document.querySelectorAll("#tvLists .chip").forEach((c) => c.classList.toggle("active", c === b));
    loadList(Number(b.dataset.list));
  });
  $("tvSearch").addEventListener("input", (e) => { state.query = e.target.value.trim(); renderChannels(); });
  $("tvGroup").addEventListener("change", (e) => { state.group = e.target.value; renderChannels(); });
  $("tvGrid").addEventListener("click", (e) => {
    const b = e.target.closest(".tv-row");
    if (b) playIndex(state.channels.indexOf(state.view[Number(b.dataset.vi)]));
  });
  $("tvPrev").addEventListener("click", () => zap(-1));
  $("tvNext").addEventListener("click", () => zap(1));
  // teclado: flechas para zapear cuando la vista TV está activa
  document.addEventListener("keydown", (e) => {
    if ($("viewTv").classList.contains("hidden")) return;
    if (document.activeElement === $("tvSearch")) return;
    if (e.key === "ArrowUp") { e.preventDefault(); zap(-1); }
    if (e.key === "ArrowDown") { e.preventDefault(); zap(1); }
  });
}

let loaded = false;
export function ensureTvLoaded() {
  if (loaded) return;
  loaded = true;
  loadList(0);
}
export function pauseTv() { stopPlayback(); }
