/* ============================================================
   AniLector — TV en vivo (listas M3U de código abierto)
   Parser M3U + reproductor HLS (hls.js) embebido en la app.
   ============================================================ */
import { t } from "./i18n.js";
import { M3U_LISTS, BACKEND_URL } from "./config.js";

// Base del proxy (en orden de prioridad):
//  1) Proxy personalizado que el usuario configura (localStorage) — sirve
//     para usar tu servidor de casa desde el móvil u otro equipo.
//  2) En local (localhost/IP de tu red) el propio servidor lo sirve en el mismo origen.
//  3) En la web pública, el microservicio (BACKEND_URL).
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname) ||
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
function userProxy() {
  try { return (localStorage.getItem("anilector.proxyurl") || "").trim().replace(/\/$/, ""); }
  catch { return ""; }
}
function proxyBase() {
  const up = userProxy();
  if (up) return up;
  if (isLocal) return "";
  return (BACKEND_URL || "").replace(/\/$/, "");
}
const hasProxy = () => !!userProxy() || isLocal || !!BACKEND_URL;
const proxied = (url) => `${proxyBase()}/api/hls?url=${encodeURIComponent(url)}`;

const $ = (id) => document.getElementById(id);
const state = { listIndex: 0, channels: [], group: "", query: "", hls: null, current: -1, view: [] };
const cache = {}; // url → channels[]
const MAX_RENDER = 500;

/* ---------- fuentes personalizadas (IPTV manual, persistente) ---------- */
function loadCustom() {
  try { return JSON.parse(localStorage.getItem("anilector.tvcustom") || '{"lists":[],"channels":[]}'); }
  catch { return { lists: [], channels: [] }; }
}
function saveCustom(c) { localStorage.setItem("anilector.tvcustom", JSON.stringify(c)); }
let custom = loadCustom();

// Fuentes = listas fijas + listas del usuario + (virtual) "Mis canales"
function sources() {
  const s = M3U_LISTS.map((l) => ({ ...l }));
  custom.lists.forEach((l) => s.push({ name: l.name, flag: "➕", url: l.url, custom: true }));
  if (custom.channels.length) s.push({ name: t("tv.myChannels"), flag: "⭐", virtual: true });
  return s;
}

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
  if ($("tvSearch")) $("tvSearch").value = "";
  const list = sources()[i];
  const grid = $("tvGrid");
  if (!list) return;

  // Lista virtual "Mis canales"
  if (list.virtual) {
    state.channels = custom.channels.map((c) => ({ name: c.name, url: c.url, logo: "", group: "" }));
    renderGroups(); renderChannels(); return;
  }

  grid.innerHTML = `<div class="loader"><div class="spinner"></div><span>${t("misc.loading")}</span></div>`;
  $("tvInfo").textContent = "";
  if (cache[list.url]) { state.channels = cache[list.url]; renderGroups(); renderChannels(); return; }
  async function fetchM3U(u) {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }
  try {
    let text;
    try {
      text = await fetchM3U(list.url); // intento directo
    } catch (e1) {
      if (!hasProxy()) throw e1;
      text = await fetchM3U(proxied(list.url)); // respaldo por proxy (CORS)
    }
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

function playIndex(idx, useProxy = null) {
  const channel = state.channels[idx];
  if (!channel) return;
  state.current = idx;
  // Contenido mixto seguro (canal http:// en una web https://): usar proxy
  // directamente, sin perder tiempo en un intento directo que el navegador bloquea.
  if (useProxy === null) {
    const mixed = location.protocol === "https:" && /^http:\/\//i.test(channel.url);
    useProxy = mixed && hasProxy();
  }
  const v = $("tvVideo");
  const err = $("tvError");
  const ph = $("tvPlaceholder");
  err.classList.add("hidden");
  ph.classList.add("hidden");
  v.classList.add("playing");
  $("tvNow").textContent = channel.name + (useProxy ? " · 🛡️" : "");
  $("tvExternal").href = channel.url;
  stopPlayback();
  highlightCurrent();

  const isHls = /\.m3u8(\?|$)/i.test(channel.url);
  const src = useProxy && hasProxy() ? proxied(channel.url) : channel.url;

  const onFail = () => {
    // 1º intento falla y hay proxy → reintentar por el proxy automáticamente
    if (!useProxy && hasProxy()) return playIndex(idx, true);
    // Sin proxy o ya falló también: mostrar opciones
    err.classList.remove("hidden");
    const retry = !hasProxy()
      ? ""
      : `<button class="btn btn-ghost btn-mini" id="tvRetryProxy">🛡️ ${t("tv.retryProxy")}</button>`;
    err.innerHTML = `${t("tv.playError")} ${retry}
      <a class="btn btn-primary btn-mini" href="${esc(channel.url)}" target="_blank" rel="noopener">${t("tv.openTab")}</a>`;
    const rb = $("tvRetryProxy");
    if (rb) rb.addEventListener("click", () => playIndex(idx, true));
  };

  try {
    if (isHls && window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ maxBufferLength: 20, manifestLoadingTimeOut: 12000 });
      state.hls = hls;
      hls.loadSource(src);
      hls.attachMedia(v);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
      hls.on(window.Hls.Events.ERROR, (_e, data) => { if (data?.fatal) { stopPlayback(); onFail(); } });
    } else {
      v.src = src; // Safari (HLS nativo) o streams directos (mp4, etc.)
      v.play().catch(() => {});
      v.onerror = onFail;
    }
  } catch (_) { onFail(); }
}

// Enviar el canal actual a VLC (descarga una lista .m3u que VLC abre)
function sendToVlc() {
  const ch = state.channels[state.current];
  if (!ch) return;
  const m3u = `#EXTM3U\n#EXTINF:-1,${ch.name}\n${ch.url}\n`;
  const blob = new Blob([m3u], { type: "audio/x-mpegurl" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${ch.name.replace(/[^\w.-]+/g, "_")}.m3u`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
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

function renderSources() {
  const arr = sources();
  $("tvLists").innerHTML =
    arr.map((l, i) =>
      `<button class="chip ${i === state.listIndex ? "active" : ""}" data-list="${i}">${l.flag} ${esc(l.name)}</button>`).join("") +
    `<button class="chip chip-add" id="tvAddBtn">➕ ${t("tv.add")}</button>`;
}

/* ---------- interfaz ---------- */
export function initTv() {
  renderSources();
  $("tvLists").addEventListener("click", (e) => {
    if (e.target.closest("#tvAddBtn")) { $("tvAddPanel").classList.toggle("hidden"); return; }
    const b = e.target.closest("[data-list]");
    if (!b) return;
    state.listIndex = Number(b.dataset.list);
    document.querySelectorAll("#tvLists .chip").forEach((c) => c.classList.toggle("active", c === b));
    loadList(state.listIndex);
  });

  // Añadir IPTV manual (lista M3U o canal directo)
  renderCustomList();
  $("tvAddList").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("tvAddName").value.trim() || "Mi lista";
    const url = $("tvAddUrl").value.trim();
    if (!url) return;
    custom.lists.push({ name, url });
    saveCustom(custom);
    $("tvAddName").value = ""; $("tvAddUrl").value = "";
    $("tvAddPanel").classList.add("hidden");
    renderSources(); renderCustomList();
    state.listIndex = sources().findIndex((s) => s.custom && s.url === url);
    document.querySelectorAll("#tvLists .chip").forEach((c, i) => c.classList.toggle("active", i === state.listIndex));
    loadList(state.listIndex);
  });
  $("tvAddChannel").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("tvChName").value.trim() || "Mi canal";
    const url = $("tvChUrl").value.trim();
    if (!url) return;
    custom.channels.push({ name, url });
    saveCustom(custom);
    $("tvChName").value = ""; $("tvChUrl").value = "";
    $("tvAddPanel").classList.add("hidden");
    renderSources(); renderCustomList();
    // ir a "Mis canales" y reproducir el recién agregado
    const idx = sources().findIndex((s) => s.virtual);
    state.listIndex = idx;
    document.querySelectorAll("#tvLists .chip").forEach((c, i) => c.classList.toggle("active", i === idx));
    loadList(idx);
  });
  $("tvSearch").addEventListener("input", (e) => { state.query = e.target.value.trim(); renderChannels(); });
  $("tvGroup").addEventListener("change", (e) => { state.group = e.target.value; renderChannels(); });
  $("tvGrid").addEventListener("click", (e) => {
    const b = e.target.closest(".tv-row");
    if (b) playIndex(state.channels.indexOf(state.view[Number(b.dataset.vi)]));
  });
  $("tvPrev").addEventListener("click", () => zap(-1));
  $("tvNext").addEventListener("click", () => zap(1));
  $("tvVlc").addEventListener("click", sendToVlc);

  // Proxy de TV personalizado (para móvil/otros equipos)
  if ($("tvProxyUrl")) $("tvProxyUrl").value = userProxy();
  $("tvProxyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("tvProxyUrl").value.trim();
    try { localStorage.setItem("anilector.proxyurl", v); } catch (_) {}
    // limpiar caché de listas para recargar por el nuevo proxy
    for (const k of Object.keys(cache)) delete cache[k];
    $("tvAddPanel").classList.add("hidden");
    loadList(state.listIndex);
  });
  // teclado: flechas para zapear cuando la vista TV está activa
  document.addEventListener("keydown", (e) => {
    if ($("viewTv").classList.contains("hidden")) return;
    if (document.activeElement === $("tvSearch")) return;
    if (e.key === "ArrowUp") { e.preventDefault(); zap(-1); }
    if (e.key === "ArrowDown") { e.preventDefault(); zap(1); }
  });
}

// Panel: administrar fuentes personalizadas (eliminar)
function renderCustomList() {
  const box = $("tvCustomList");
  if (!box) return;
  const items = [
    ...custom.lists.map((l, i) => ({ kind: "list", i, label: `📃 ${l.name}` })),
    ...custom.channels.map((c, i) => ({ kind: "ch", i, label: `⭐ ${c.name}` })),
  ];
  box.innerHTML = items.length
    ? items.map((it) => `<div class="tv-custom-item"><span>${esc(it.label)}</span>
        <button class="btn btn-ghost btn-mini" data-del="${it.kind}:${it.i}">🗑</button></div>`).join("")
    : `<span class="tv-note">${t("tv.noCustom")}</span>`;
  box.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      const [kind, i] = b.dataset.del.split(":");
      if (kind === "list") custom.lists.splice(Number(i), 1);
      else custom.channels.splice(Number(i), 1);
      saveCustom(custom);
      state.listIndex = 0;
      renderSources(); renderCustomList();
      document.querySelectorAll("#tvLists .chip").forEach((c, k) => c.classList.toggle("active", k === 0));
      loadList(0);
    }));
}

let loaded = false;
export function ensureTvLoaded() {
  if (loaded) return;
  loaded = true;
  loadList(0);
}
export function pauseTv() { stopPlayback(); }
