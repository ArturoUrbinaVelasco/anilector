/* ============================================================
   AniLector — apartado "Sitios" (navegador integrado)
   Abre cualquier URL EMBEBIDA dentro de la app. Si el sitio
   bloquea el embebido (X-Frame-Options / CSP), ofrece salida.
   ============================================================ */
import { t } from "./i18n.js";
import { WEB_APPS, GOOGLE_CSE_ID } from "./config.js";

const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function normUrl(url) {
  url = url.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url;
}

function open(url, title) {
  const u = normUrl(url);
  if (!u) return;
  $("webFrameWrap").classList.remove("hidden");
  $("webTitle").textContent = title || u;
  $("webExternal").href = u;
  const f = $("webFrame");
  f.src = u;
  // Muchos sitios bloquean iframes sin evento fiable → aviso permanente.
  $("webHint").innerHTML =
    `${t("web.hint")} <a class="btn btn-primary btn-mini" href="${esc(u)}" target="_blank" rel="noopener">${t("web.openTab")}</a>`;
  $("webFrameWrap").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Buscador de Google embebido (Programmable Search Engine) ---------- */
let cseLoaded = false;
function ensureCse() {
  if (cseLoaded || !GOOGLE_CSE_ID) return;
  cseLoaded = true;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://cse.google.com/cse.js?cx=${encodeURIComponent(GOOGLE_CSE_ID)}`;
  document.head.appendChild(s);
}
function googleSearch(q) {
  if (GOOGLE_CSE_ID) {
    // Buscador oficial embebible de Google (resultados dentro de la app)
    $("webFrameWrap").classList.add("hidden");
    const box = $("webCse");
    box.classList.remove("hidden");
    box.innerHTML = `<div class="gcse-search"></div>`;
    ensureCse();
    // Ejecuta la búsqueda cuando el elemento está listo
    const run = () => {
      const el = window.google?.search?.cse?.element?.getElement("searchresults-only0") ||
                 window.google?.search?.cse?.element?.getAllElements &&
                 Object.values(window.google.search.cse.element.getAllElements())[0];
      if (el && el.execute) el.execute(q);
      else setTimeout(run, 400);
    };
    setTimeout(run, 600);
  } else {
    // Sin CSE configurado: abre Google en pestaña nueva (no se puede embeber)
    window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, "_blank", "noopener");
  }
}

export function initWebApps() {
  // Buscador de Google
  $("webGoogleForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("webGoogle").value.trim();
    if (q) googleSearch(q);
  });
  $("webShortcuts").innerHTML = WEB_APPS.map((a, i) =>
    `<button class="chip" data-app="${i}">🌐 ${esc(a.name)}</button>`).join("") ||
    `<span class="tv-note">${t("web.empty")}</span>`;
  $("webShortcuts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-app]");
    if (b) open(WEB_APPS[Number(b.dataset.app)].url, WEB_APPS[Number(b.dataset.app)].name);
  });
  $("webForm").addEventListener("submit", (e) => {
    e.preventDefault();
    open($("webUrl").value);
  });
  $("webClose").addEventListener("click", () => {
    $("webFrame").src = "about:blank";
    $("webFrameWrap").classList.add("hidden");
  });
  // abrir un sitio oculta el buscador de Google y viceversa
  $("webForm").addEventListener("submit", () => $("webCse")?.classList.add("hidden"));
}
