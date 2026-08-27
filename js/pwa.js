/* ============================================================
   AniLector — instalación (PWA) y copia de seguridad en archivo
   ============================================================ */
import { t } from "./i18n.js";

const $ = (id) => document.getElementById(id);

/* Todo lo que compone "tus datos": lo que auth.js sincroniza con Drive
   MÁS los ajustes que solo viven en este equipo. Un respaldo sirve para
   volver a dejar la app como estaba, así que aquí entra todo.
   ⚠️ Faltaban `tvcustom` (tus listas M3U propias, que pueden ser el dato
   más difícil de recuperar), `proxyurl` y los ajustes de lectura: se
   perdían al reinstalar aunque hubieras exportado. */
const CLAVES = [
  "anilector.library", "anilector.progress", "anilector.recent",
  "anilector.seen", "anilector.sites", "anilector.tvfavs",
  "anilector.brand", "anilector.theme", "anilector.lang",
  "anilector.tvlast", "anilector.ytprogress", "anilector.ythistory",
  "anilector.tvcustom", "anilector.proxyurl", "anilector.ytdur",
  "anilector.ytAutoplay", "anilector.tvmode", "anilector.webtoon",
  "anilector.readNight", "anilector.readType",
];

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 3000);
}

/* ---------- copia de seguridad ---------- */
export function exportarDatos() {
  const datos = { app: "AniLector", version: 1, fecha: new Date().toISOString(), datos: {} };
  for (const k of CLAVES) {
    const v = localStorage.getItem(k);
    if (v != null) datos.datos[k] = v;
  }
  const blob = new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const hoy = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `anilector-respaldo-${hoy}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(t("backup.exported"));
}

export async function importarDatos(file) {
  const texto = await file.text();
  let d;
  try { d = JSON.parse(texto); } catch { throw new Error(t("backup.badFile")); }
  if (!d || d.app !== "AniLector" || !d.datos) throw new Error(t("backup.badFile"));

  let n = 0;
  for (const [k, v] of Object.entries(d.datos)) {
    // Solo claves conocidas: un archivo manipulado no debe poder
    // escribir cualquier cosa en el almacenamiento.
    if (!CLAVES.includes(k)) continue;
    try { localStorage.setItem(k, String(v)); n++; } catch (_) {}
  }
  if (!n) throw new Error(t("backup.empty"));
  return n;
}

/* ---------- service worker ---------- */
function registrarSW() {
  if (!("serviceWorker" in navigator)) return;
  // Solo con https (o localhost): el navegador no lo permite si no.
  if (location.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;

  // ¿Ya había un service worker al cargar la página? Es la diferencia
  // entre "es la primera visita" y "acaba de llegar una versión nueva".
  const habiaControlador = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.register("./sw.js").catch((e) =>
    console.warn("Service worker:", e.message));

  let recargando = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // En la PRIMERA instalación no se recarga: la página ya está bien y
    // recargar de golpe se ve como un parpadeo raro nada más entrar.
    // Solo se recarga cuando releva a una versión anterior, para que el
    // HTML y el JS queden de la misma versión.
    if (!habiaControlador || recargando) return;
    recargando = true;
    location.reload();
  });
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.tipo === "sw-actualizado") toast(t("pwa.updated"));
    if (e.data?.tipo === "estado-cache") pintarEstadoCache(e.data);
  });

  // Se pregunta en cuanto haya alguien a quien preguntar.
  navigator.serviceWorker.ready.then(() => preguntarEstadoCache()).catch(() => {});
}

/* ---------- ¿de verdad funciona sin conexión? ----------
   El service worker guarda los archivos de uno en uno para que un fallo
   suelto no lo tumbe entero, pero eso hacía que la app dijera estar
   lista sin conexión cuando le faltaban piezas — y solo se descubría
   al quedarse sin red, que es el peor momento. Ahora se pregunta y se
   dice la verdad, con un botón para reintentar lo que falte. */
function alSW(mensaje) {
  navigator.serviceWorker?.controller?.postMessage(mensaje);
}
export function preguntarEstadoCache() { alSW({ tipo: "estado-cache" }); }

function pintarEstadoCache({ total = 0, faltan = [] }) {
  const fila = $("offlineRow");
  if (!fila) return;
  fila.classList.remove("hidden");
  const bien = !faltan.length;
  fila.className = "offline-row " + (bien ? "bien" : "mal");
  fila.innerHTML = bien
    ? `<span>✅ ${esc(t("offline.listo").replace("%s", String(total)))}</span>`
    : `<span>⚠️ ${esc(t("offline.faltan").replace("%s", String(faltan.length)))}</span>
       <button id="offlineRetry" class="btn btn-ghost btn-sm">${esc(t("offline.reintentar"))}</button>`;
  $("offlineRetry")?.addEventListener("click", (ev) => {
    ev.currentTarget.disabled = true;
    ev.currentTarget.textContent = t("offline.reintentando");
    alSW({ tipo: "reintentar-cache" });
  });
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- botón de instalar ---------- */
let promptInstalar = null;

export function initPwa() {
  registrarSW();

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptInstalar = e;
    $("pwaInstallRow")?.classList.remove("hidden");
  });
  window.addEventListener("appinstalled", () => {
    promptInstalar = null;
    $("pwaInstallRow")?.classList.add("hidden");
    toast(t("pwa.installed"));
  });

  $("pwaInstall")?.addEventListener("click", async () => {
    if (!promptInstalar) return;
    promptInstalar.prompt();
    try { await promptInstalar.userChoice; } catch (_) {}
    promptInstalar = null;
    $("pwaInstallRow")?.classList.add("hidden");
  });

  $("backupExport")?.addEventListener("click", exportarDatos);
  $("backupImport")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const n = await importarDatos(f);
      toast(t("backup.imported").replace("%s", n));
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      toast(err.message);
    }
  });
}
