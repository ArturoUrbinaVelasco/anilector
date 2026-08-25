/* ============================================================
   AniLector — apartado "Sitios" (navegador integrado)
   Abre cualquier URL EMBEBIDA dentro de la app. Si el sitio
   bloquea el embebido (X-Frame-Options / CSP), ofrece salida.
   ============================================================ */
import { t } from "./i18n.js";
import { WEB_APPS } from "./config.js";

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

export function initWebApps() {
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
}
