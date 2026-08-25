/* ============================================================
   AniLector — apartado "Sitios" (navegador integrado)
   Abre cualquier URL EMBEBIDA dentro de la app. Si el sitio
   bloquea el embebido (X-Frame-Options / CSP), ofrece salida.

   Los sitios FAVORITOS se guardan en localStorage ("anilector.sites")
   y viajan a Google Drive junto con la biblioteca, así que aparecen
   en todos los equipos donde inicies sesión.
   ============================================================ */
import { t } from "./i18n.js";
import { WEB_APPS, NO_EMBED_SITES } from "./config.js";

/* Sitios que prohíben mostrarse dentro de otra página: en vez de dejar
   un marco en blanco se avisa y se ofrece abrirlo en una pestaña. */
function blocksEmbedding(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return (NO_EMBED_SITES || []).some((d) => host === d || host.endsWith(`.${d}`));
  } catch (_) { return false; }
}

const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function normUrl(url) {
  url = String(url || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url;
}
// Nombre bonito por defecto: el dominio sin "www."
function hostName(url) {
  try { return new URL(normUrl(url)).hostname.replace(/^www\./, ""); }
  catch { return url; }
}
// Icono del propio sitio (si no carga, se cae al emoji por CSS/onerror).
function faviconOf(url) {
  try { return `${new URL(normUrl(url)).origin}/favicon.ico`; }
  catch { return ""; }
}

/* ---------- favoritos (localStorage + Drive) ---------- */
export function favSites() {
  try {
    const list = JSON.parse(localStorage.getItem("anilector.sites") || "[]");
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function saveSites(list) {
  localStorage.setItem("anilector.sites", JSON.stringify(list));
  window.dispatchEvent(new Event("anilector:datachanged"));
}
const sameUrl = (a, b) => normUrl(a).replace(/\/$/, "") === normUrl(b).replace(/\/$/, "");
function isFav(url) { return favSites().some((s) => sameUrl(s.url, url)); }

function addFav(url, name) {
  const u = normUrl(url);
  if (!u) return false;
  const list = favSites();
  if (list.some((s) => sameUrl(s.url, u))) return false;
  list.unshift({ url: u, name: (name || "").trim() || hostName(u), addedAt: new Date().toISOString() });
  saveSites(list);
  renderShortcuts();
  return true;
}
function removeFav(url) {
  saveSites(favSites().filter((s) => !sameUrl(s.url, url)));
  renderShortcuts();
}
function renameFav(url, name) {
  const list = favSites();
  const it = list.find((s) => sameUrl(s.url, url));
  if (!it) return;
  it.name = (name || "").trim() || hostName(url);
  saveSites(list);
  renderShortcuts();
}

/* ---------- apertura ---------- */
let current = "";
function open(url, title) {
  const u = normUrl(url);
  if (!u) return;
  current = u;
  $("webFrameWrap").classList.remove("hidden");
  $("webTitle").textContent = title || u;
  $("webExternal").href = u;
  syncFavButton();

  const frame = $("webFrame");
  const blocked = blocksEmbedding(u);
  // Los sitios de la lista ni se intentan: se sabe que devolverían un
  // recuadro vacío. Para el resto, aviso permanente por si acaso (no hay
  // evento fiable que avise de un iframe rechazado).
  frame.style.display = blocked ? "none" : "";
  frame.src = blocked ? "about:blank" : u;
  $("webHint").innerHTML = blocked
    ? `<span class="web-blocked">🚫 ${t("web.blocked")}</span>
       <a class="btn btn-primary btn-mini" href="${esc(u)}" target="_blank" rel="noopener">${t("web.openTab")}</a>`
    : `${t("web.hint")} <a class="btn btn-primary btn-mini" href="${esc(u)}" target="_blank" rel="noopener">${t("web.openTab")}</a>`;
  $("webFrameWrap").scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncFavButton() {
  const b = $("webFav");
  if (!b) return;
  const on = isFav(current);
  b.textContent = on ? "★" : "☆";
  b.classList.toggle("faved", on);
  b.title = on ? t("web.unfav") : t("web.fav");
}

/* ---------- accesos rápidos ---------- */
function renderShortcuts() {
  const box = $("webShortcuts");
  const favs = favSites();
  const fixed = WEB_APPS.map((a) => ({ ...a, fixed: true }));
  const all = [...favs, ...fixed];

  if (!all.length) {
    box.innerHTML = `<span class="tv-note">${t("web.empty")}</span>`;
    return;
  }
  box.innerHTML = all.map((a, i) => {
    const ico = faviconOf(a.url);
    return `
    <span class="site-chip${a.fixed ? " site-fixed" : ""}" data-url="${esc(a.url)}">
      <button class="site-open" data-open="${i}" title="${esc(a.url)}">
        ${ico
          ? `<img class="site-ico" src="${esc(ico)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'site-ico',textContent:'🌐'}))" />`
          : `<span class="site-ico">🌐</span>`}
        <span class="site-name">${esc(a.name)}</span>
      </button>
      ${a.fixed ? "" : `
        <button class="site-edit" data-edit="${esc(a.url)}" title="${t("web.rename")}">✎</button>
        <button class="site-del" data-del="${esc(a.url)}" title="${t("web.remove")}">✕</button>`}
    </span>`;
  }).join("");
  box._all = all;
}

export function initWebApps() {
  renderShortcuts();

  $("webShortcuts").addEventListener("click", (e) => {
    const box = $("webShortcuts");
    const del = e.target.closest("[data-del]");
    if (del) {
      removeFav(del.dataset.del);
      syncFavButton();
      return;
    }
    const ed = e.target.closest("[data-edit]");
    if (ed) {
      const cur = favSites().find((s) => sameUrl(s.url, ed.dataset.edit));
      const name = prompt(t("web.renamePrompt"), cur?.name || "");
      if (name !== null) renameFav(ed.dataset.edit, name);
      return;
    }
    const go = e.target.closest("[data-open]");
    if (go) {
      const a = (box._all || [])[Number(go.dataset.open)];
      if (a) open(a.url, a.name);
    }
  });

  $("webForm").addEventListener("submit", (e) => {
    e.preventDefault();
    open($("webUrl").value);
  });

  // ★ guardar / quitar el sitio que se está viendo
  $("webFav")?.addEventListener("click", () => {
    if (!current) return;
    if (isFav(current)) removeFav(current);
    else addFav(current, hostName(current));
    syncFavButton();
  });

  $("webClose").addEventListener("click", () => {
    $("webFrame").src = "about:blank";
    $("webFrameWrap").classList.add("hidden");
    current = "";
  });

  // Si la sync de Drive trae sitios de otro equipo, repintar.
  window.addEventListener("anilector:datachanged", renderShortcuts);
}
