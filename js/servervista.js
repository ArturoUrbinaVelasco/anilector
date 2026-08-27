/* ============================================================
   AniLector — vista de «Mi servidor»
   ------------------------------------------------------------
   Panel de conexión + cuadrícula de películas y series + TV en
   vivo del servidor. Toda la configuración la escribe el usuario;
   este archivo no conoce ninguna dirección.
   ============================================================ */
import { t } from "./i18n.js";
import * as SRV from "./media.js";

const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const S = {
  libs: [],        // bibliotecas + la pestaña de TV si existe
  lib: 0,
  buscar: "",
  orden: "SortName",
  pagina: 1,
  total: 0,
  serie: null,     // serie abierta: se muestran sus episodios
  titulo: "",      // lo que se está reproduciendo, para el aviso de error
  hls: null,
  cargando: false,
  arrancado: false,
};

/* ---------- reproducción ---------- */
function pararVideo() {
  if (S.hls) { try { S.hls.destroy(); } catch (_) {} S.hls = null; }
  const v = $("srvVideo");
  if (v) { try { v.pause(); } catch (_) {} v.removeAttribute("src"); v.load(); }
}
function cerrarReproductor() {
  pararVideo();
  $("srvPlayer").classList.add("hidden");
}

/* Se intenta HLS (funciona con casi cualquier archivo porque el
   servidor lo convierte al vuelo) y, si falla, reproducción directa:
   más ligera para el servidor cuando el archivo ya es compatible. */
function reproducir(item) {
  pararVideo();
  $("srvPlayer").classList.remove("hidden");
  S.titulo = tituloDe(item);
  $("srvNow").textContent = S.titulo;
  const v = $("srvVideo");

  const directa = () => {
    pararVideo();
    v.src = SRV.urlDirecta(item.Id);
    v.play().catch(() => {});
    v.onerror = () => avisoPlayer(t("srv.errPlay"));
  };

  const src = SRV.urlHls(item.Id);
  if (window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({ maxBufferLength: 30, manifestLoadingTimeOut: 15000 });
    S.hls = hls;
    hls.loadSource(src);
    hls.attachMedia(v);
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
    hls.on(window.Hls.Events.ERROR, (_e, d) => { if (d?.fatal) directa(); });
  } else {
    // Safari reproduce HLS de forma nativa.
    v.src = src;
    v.play().catch(() => directa());
    v.onerror = directa;
  }
  $("srvPlayer").scrollIntoView({ block: "start", behavior: "smooth" });
}
/* Si la reproducción falla, se avisa SIN perder el título: saber qué se
   estaba intentando ver es parte del diagnóstico. */
function avisoPlayer(msg) {
  $("srvNow").textContent = S.titulo ? `${S.titulo} — ${msg}` : msg;
}
function tituloDe(i) {
  if (i.Type === "Episode") {
    const t1 = i.SeriesName ? `${i.SeriesName} · ` : "";
    const num = i.ParentIndexNumber != null && i.IndexNumber != null
      ? `T${i.ParentIndexNumber}E${i.IndexNumber} · ` : "";
    return `${t1}${num}${i.Name || ""}`;
  }
  return i.Name || "—";
}

/* ---------- panel de conexión ----------
   Solo dos campos: dirección y clave. El usuario ya no se elige a mano
   —lo resuelve la prueba— y la forma en que viaja la clave también la
   decide ella. Lo que antes era un selector es ahora una lista de
   pasos que dice exactamente dónde falla. */
function pintarConfig() {
  const c = SRV.leerConfig();
  $("srvUrl").value = c.url;
  $("srvKey").value = c.key;
  $("srvBorrar").classList.toggle("hidden", !c.url && !c.key);
}
function estado(msg, tipo = "") {
  const el = $("srvStatus");
  el.textContent = msg || "";
  el.className = "srv-status" + (tipo ? " " + tipo : "");
}
function pintarPasos(pasos) {
  const el = $("srvPasos");
  if (!el) return;
  el.innerHTML = (pasos || []).map((p) =>
    `<li class="${p.ok ? "bien" : "mal"}"><b>${p.ok ? "✓" : "✗"} ${esc(p.etiqueta)}</b>
       <span>${esc(p.detalle || "")}</span></li>`).join("");
  el.classList.toggle("hidden", !(pasos || []).length);
}

/* La prueba no guarda nada: solo informa. Guardar es lo que persiste. */
async function probarConexion() {
  const url = $("srvUrl").value.trim();
  const key = $("srvKey").value.trim();
  if (!url) return estado(t("srv.errSinUrl"), "mal");

  estado(t("srv.probando"));
  pintarPasos([]);
  const r = await SRV.diagnostico(url, key);
  pintarPasos(r.pasos);
  estado(r.ok ? t("srv.pruebaOk") : t("srv.pruebaMal"), r.ok ? "bien" : "mal");
  return r;
}

/* Guardar prueba primero: no se guarda una configuración que no
   funciona, y así no hay que acordarse de pulsar «Probar» antes. */
async function guardarYCargar() {
  const url = $("srvUrl").value.trim();
  const key = $("srvKey").value.trim();
  if (!url || !key) return estado(t("srv.faltaTodo"), "mal");

  const r = await probarConexion();
  if (!r?.ok || !r.config) return;

  const c = SRV.leerConfig();
  SRV.guardar({ ...c, ...r.config });
  estado(t("srv.guardado"), "bien");
  $("srvBorrar").classList.remove("hidden");
  S.arrancado = false;
  S.libs = [];
  S.lib = 0;
  S.serie = null;
  aplicarVisibilidad();
  cargarBibliotecas();
}

/* Borrar en dos pasos sobre el propio botón, igual que en «Mis
   descargas»: un `confirm()` bloquea la pestaña entera. */
function borrarConexion(btn) {
  if (!btn.dataset.seguro) {
    btn.dataset.seguro = "1";
    btn.textContent = t("srv.borrarSeguro");
    clearTimeout(btn._t);
    btn._t = setTimeout(() => {
      delete btn.dataset.seguro;
      btn.textContent = t("srv.borrar");
    }, 4000);
    return;
  }
  clearTimeout(btn._t);
  delete btn.dataset.seguro;
  btn.textContent = t("srv.borrar");
  try { localStorage.removeItem("anilector.server"); } catch (_) {}
  cerrarReproductor();
  S.libs = []; S.lib = 0; S.serie = null; S.arrancado = false;
  $("srvGrid").innerHTML = "";
  $("srvLibs").innerHTML = "";
  $("srvInfo").textContent = "";
  pintarConfig();
  pintarPasos([]);
  estado(t("srv.borrado"), "aviso");
  aplicarVisibilidad();
}

/* ---------- catálogo ---------- */
function aplicarVisibilidad() {
  const hay = SRV.hayConfig();
  $("srvEmpty").classList.toggle("hidden", hay);
  $("srvCatalogo").classList.toggle("hidden", !hay);
  // Sin conexión guardada, el panel se abre solo: es lo único que
  // se puede hacer en esta pantalla.
  if (!hay) $("srvConfigBody").classList.remove("hidden");
}

async function cargarBibliotecas() {
  if (!SRV.hayConfig()) return;
  try {
    const vistas = await SRV.bibliotecas();
    S.libs = (vistas?.Items || [])
      .filter((v) => ["movies", "tvshows", "boxsets", "mixed"].includes(v.CollectionType) || !v.CollectionType)
      .map((v) => ({ id: v.Id, nombre: v.Name, tipo: v.CollectionType }));

    // TV en vivo: solo si este servidor la tiene configurada.
    try {
      const ch = await SRV.canales();
      if (ch?.Items?.length) {
        S.libs.push({ id: "__tv__", nombre: "📡 " + t("srv.liveTv"), tipo: "livetv" });
      }
    } catch (_) { /* si no hay TV en vivo, simplemente no aparece */ }

    pintarChips();
    S.lib = 0;
    cargarPagina();
  } catch (e) {
    $("srvGrid").innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${esc(e.message)}</p></div>`;
  }
}

function pintarChips() {
  $("srvLibs").innerHTML = S.libs.map((l, i) =>
    `<button class="chip ${i === S.lib ? "active" : ""}" data-lib="${i}">${esc(l.nombre)}</button>`).join("");
}

async function cargarPagina({ append = false } = {}) {
  if (S.cargando || !SRV.hayConfig()) return;
  const lib = S.libs[S.lib];
  if (!lib) return;
  S.cargando = true;
  const grid = $("srvGrid");
  if (!append) {
    grid.innerHTML = `<div class="loader"><div class="spinner"></div><span>${t("misc.loading")}</span></div>`;
    S.pagina = 1;
  }
  try {
    let datos;
    if (S.serie) {
      datos = await SRV.episodios(S.serie.Id);
    } else if (lib.tipo === "livetv") {
      datos = await SRV.canales();
    } else {
      datos = await SRV.items({
        parentId: lib.id,
        tipos: lib.tipo === "movies" ? "Movie" : lib.tipo === "tvshows" ? "Series" : "Movie,Series",
        buscar: S.buscar,
        orden: S.orden,
        pagina: S.pagina,
      });
    }
    const items = datos?.Items || [];
    S.total = datos?.TotalRecordCount ?? items.length;
    pintar(items, append);
    $("srvInfo").textContent = S.total
      ? `${S.total.toLocaleString()} ${t(S.serie ? "srv.episodios" : "srv.titulos")}` : "";
    $("srvMore").classList.toggle("hidden",
      !!S.serie || lib.tipo === "livetv" || S.pagina * SRV.PAGINA >= S.total);
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${esc(e.message)}</p></div>`;
    $("srvMore").classList.add("hidden");
  } finally {
    S.cargando = false;
  }
}

function pintar(items, append) {
  const grid = $("srvGrid");
  if (!items.length && !append) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🔎</div><p>${t("misc.noResults")}</p></div>`;
    return;
  }
  const html = items.map((i) => {
    const img = SRV.portada(i.Id, i.ImageTags?.Primary);
    const anio = i.ProductionYear ? `<span>📅 ${i.ProductionYear}</span>` : "";
    const marca = i.Type === "Series" ? `<span class="card-badge">${t("srv.serie")}</span>`
      : i.Type === "TvChannel" ? `<span class="card-badge">${t("srv.canal")}</span>` : "";
    const visto = i.UserData?.Played ? `<span class="srv-visto">✓</span>` : "";
    return `<article class="card srv-card" data-id="${esc(i.Id)}" data-tipo="${esc(i.Type || "")}">
      ${img
        ? `<img class="card-cover" loading="lazy" src="${esc(img)}" alt=""
             onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'card-cover placeholder',textContent:'🎬'}))" />`
        : `<div class="card-cover placeholder">🎬</div>`}
      ${marca}${visto}
      <div class="card-body">
        <h3 class="card-title">${esc(tituloDe(i))}</h3>
        <div class="card-meta">${anio}</div>
      </div>
    </article>`;
  }).join("");
  if (append) grid.insertAdjacentHTML("beforeend", html);
  else grid.innerHTML = html;
  // Los datos completos se guardan para poder reproducir sin volver a pedir.
  items.forEach((i) => (CACHE[i.Id] = i));
}
const CACHE = {};

function alPulsar(id) {
  const item = CACHE[id];
  if (!item) return;
  if (item.Type === "Series") {
    S.serie = item;
    $("srvBack").classList.remove("hidden");
    $("srvBack").textContent = `← ${item.Name}`;
    cargarPagina();
    return;
  }
  reproducir(item);
}

function volver() {
  S.serie = null;
  $("srvBack").classList.add("hidden");
  cargarPagina();
}

/* ---------- arranque ---------- */
export function initServidor() {
  pintarConfig();
  aplicarVisibilidad();

  $("srvConfigToggle").addEventListener("click", () => {
    const oculto = $("srvConfigBody").classList.toggle("hidden");
    $("srvConfigToggle").setAttribute("aria-expanded", String(!oculto));
  });
  $("srvProbar").addEventListener("click", probarConexion);
  $("srvGuardar").addEventListener("click", guardarYCargar);
  $("srvBorrar").addEventListener("click", (e) => borrarConexion(e.currentTarget));

  $("srvLibs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lib]");
    if (!b) return;
    S.lib = Number(b.dataset.lib);
    S.serie = null;
    $("srvBack").classList.add("hidden");
    pintarChips();
    cargarPagina();
  });
  $("srvGrid").addEventListener("click", (e) => {
    const c = e.target.closest(".srv-card");
    if (c) alPulsar(c.dataset.id);
  });
  $("srvBack").addEventListener("click", volver);
  $("srvMore").addEventListener("click", () => { S.pagina++; cargarPagina({ append: true }); });
  $("srvCerrarPlayer").addEventListener("click", cerrarReproductor);

  let deb;
  $("srvSearch").addEventListener("input", (e) => {
    clearTimeout(deb);
    S.buscar = e.target.value.trim();
    deb = setTimeout(() => { S.serie = null; $("srvBack").classList.add("hidden"); cargarPagina(); }, 350);
  });
  $("srvSort").addEventListener("change", (e) => { S.orden = e.target.value; cargarPagina(); });
}

/* Se pide el catálogo la primera vez que entras, no al abrir la app. */
export function ensureServidorLoaded() {
  aplicarVisibilidad();
  if (S.arrancado || !SRV.hayConfig()) return;
  S.arrancado = true;
  cargarBibliotecas();
}
export function pausarServidor() {
  pararVideo();
}
