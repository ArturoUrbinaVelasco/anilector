/* ============================================================
   AniLector — visor integrado
   PDF (pdf.js) · EPUB (epub.js) · MOBI/AZW3 (foliate) ·
   comprimidos ZIP/CBZ (JSZip) y RAR/CBR · 7z/CB7 · TAR/CBT (libarchive) ·
   imágenes · texto · Markdown (marked) · iframe
   ------------------------------------------------------------
   Las librerías pesadas viven en /vendor y se cargan BAJO DEMANDA
   (import dinámico): no afectan el arranque de la app.
   ============================================================ */
import { t } from "./i18n.js";
import { BACKEND_URL, NO_EMBED_SITES } from "./config.js";
import * as TR from "./translate.js";
import * as DOCS from "./docs.js";
import * as BUSCA from "./buscar.js";
import * as MARCAS from "./marcas.js";

const modal = () => document.getElementById("viewerModal");
const body = () => document.getElementById("viewerBody");
const titleEl = () => document.getElementById("viewerTitle");
const pageInfo = () => document.getElementById("vPageInfo");
const controls = () => document.getElementById("viewerControls");
const extLink = () => document.getElementById("vExternal");

const state = {
  mode: null,        // 'pdf' | 'epub' | 'mobi' | 'images' | 'text' | 'html' | 'list' | 'iframe'
  pdf: null,
  page: 1,
  zoom: 1.2,
  images: [],
  imgIndex: 0,
  imgZoom: 1,        // zoom de las páginas de cómic (se conserva al pasar de página)
  epubRendition: null,
  epubBook: null,
  mobiBook: null,
  archive: null,     // handle de libarchive abierto (hay que cerrarlo)
  webtoon: false,    // tira vertical en vez de página a página
  night: false,      // lectura nocturna (filtro cálido)
  blobUrls: new Set(),
  docKey: null,      // clave para recordar progreso
  toc: [],           // índice del documento: [{ label, nivel, ir() }]
  archivoOrigen: null, // el File abierto, para poder guardarlo con 📥
  tipo: null,        // tipografía de lectura (tamaño / interlineado / ancho)
  onScroll: null,    // handler de scroll del modo MOBI (hay que quitarlo al cerrar)
  nombreDoc: "",     // nombre y tamaño del archivo, para la estantería de «seguir leyendo»
  tamanoDoc: 0,
  irASeccion: null,  // navegación de los modos de texto (la pone openMobi)
  cargarTodo: null,  // cargar el documento entero, para poder buscar en él
  marcarPdf: null,   // { pagina, ini, fin } a resaltar sobre el dibujo del PDF
};

/* ---------- extensiones reconocidas ---------- */
const RE_IMAGE = /\.(jpe?g|png|gif|webp|bmp|avif|jxl|svg|tiff?|ico)$/i;
const RE_MD    = /\.(md|markdown|mdown|mkd)$/i;
const RE_TEXT  = /\.(txt|log|nfo|diz|csv|tsv|json|xml|ya?ml|ini|conf|cfg|srt|vtt|ass|ssa|sub|opf|ncx|html?)$/i;
const RE_ZIP   = /\.(cbz|zip)$/i;
const RE_ARCH  = /\.(cbr|rar|cb7|7z|cbt|tar|t?gz|tbz2?|bz2|txz|xz|lzma|zst|zstd|lz4|iso|cpio|ar|arj|lha|lzh)$/i;
const RE_PDF   = /\.pdf$/i;
const RE_EPUB  = /\.epub$/i;
const RE_MOBI  = /\.(mobi|azw3?|prc|kf8)$/i;
// Todo lo que el visor sabe abrir como ARCHIVO (para enlaces directos).
const RE_FILEY = new RegExp(
  [RE_IMAGE, RE_MD, RE_TEXT, RE_ZIP, RE_ARCH, RE_PDF, RE_EPUB, RE_MOBI]
    .map((r) => r.source).join("|"), "i");

/* ---------- blob URLs: se revocan al cerrar (evita fugas de memoria) ---------- */
function trackUrl(u) {
  if (typeof u === "string" && u.startsWith("blob:")) state.blobUrls.add(u);
  return u;
}
function dropUrl(u) {
  if (typeof u === "string" && u.startsWith("blob:")) {
    state.blobUrls.delete(u);
    try { URL.revokeObjectURL(u); } catch (_) {}
  }
}
function revokeAll() {
  for (const u of state.blobUrls) { try { URL.revokeObjectURL(u); } catch (_) {} }
  state.blobUrls.clear();
}

/* ---------- utilidades ---------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function humanSize(n) {
  if (!n && n !== 0) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
const naturalSort = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });

function showLoader(msg) {
  body().innerHTML = `<div class="loader"><div class="spinner"></div><span>${esc(msg || t("misc.loading"))}</span></div>`;
}
/* `alReintentar` añade el botón de volver a intentar. La TV ya lo tenía
   desde hace tiempo y el visor no: un fallo de red pasajero obligaba a
   cerrar y volver a elegir el archivo. */
function showError(msg, url, alReintentar) {
  body().innerHTML = `<div class="iframe-fallback"><p>⚠️ ${esc(msg)}</p>
    <div class="err-actions">
      ${alReintentar ? `<button class="btn btn-primary" id="vRetry">${t("reader.retry")}</button>` : ""}
      ${url ? `<a class="btn ${alReintentar ? "btn-ghost" : "btn-primary"}" target="_blank" rel="noopener" href="${esc(url)}">${t("reader.openTab")}</a>` : ""}
    </div></div>`;
  if (alReintentar) document.getElementById("vRetry")?.addEventListener("click", () => alReintentar());
}

/* Un servidor que acepta la conexión y luego no contesta dejaba el
   "Descargando el archivo…" girando indefinidamente: el visor era el
   único módulo sin límite de espera (api.js y youtube.js ya lo tenían). */
const ESPERA_MAX = 30000;

/* Corta una promesa que puede no resolverse NUNCA. Hace falta porque hay
   librerías que, ante un archivo que no es lo que dice ser, ni resuelven
   ni fallan: se quedan esperando, y con ellas el visor. */
function conLimite(promesa, ms = ESPERA_MAX) {
  return new Promise((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error(t("reader.timeout"))), ms);
    promesa.then(
      (v) => { clearTimeout(reloj); resolver(v); },
      (e) => { clearTimeout(reloj); rechazar(e); },
    );
  });
}

async function fetchConLimite(url, opts = {}, ms = ESPERA_MAX) {
  const ac = new AbortController();
  const reloj = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } catch (e) {
    if (e.name === "AbortError") throw new Error(t("reader.timeout"));
    throw e;
  } finally {
    clearTimeout(reloj);
  }
}

/* Quita todo lo ejecutable de un HTML de terceros (MOBI / Markdown). */
function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,iframe,object,embed,form,link,meta,base").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) el.removeAttribute(a.name);
      if ((n === "href" || n === "src") && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  });
  doc.querySelectorAll("a[href]").forEach((a) => {
    if (/^\s*(https?:)?\/\//i.test(a.getAttribute("href"))) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  });
  return doc.body.innerHTML;
}

/* Lee texto respetando UTF-8 y cayendo a windows-1252 para .nfo/.srt viejos. */
async function readTextSmart(blob) {
  const buf = await blob.arrayBuffer();
  let s = new TextDecoder("utf-8").decode(buf);
  if (s.includes("�")) {
    try {
      const alt = new TextDecoder("windows-1252").decode(buf);
      if (!alt.includes("�")) s = alt;
    } catch (_) {}
  }
  return s;
}

/* ---------- progreso recordado ----------
   ⚠️ ESTO CRECÍA SIN LÍMITE. Cada documento abierto dejaba su entrada
   para siempre, y `localStorage` son ~5 MB PARA TODO: biblioteca,
   ajustes, sitios, favoritos, listas de TV. Al llenarse no falla solo
   el progreso: deja de guardarse TODO, y encima en silencio.

   Ahora cada entrada lleva la fecha del último uso y se conservan las
   MAXIMO más recientes. Con 400, el punto de lectura de 400 documentos
   distintos: nadie llega ahí leyendo, y el archivo no pasa de unos
   pocos cientos de KB. */
const MAXIMO_PROGRESO = 400;

function progress() {
  try { return JSON.parse(localStorage.getItem("anilector.progress") || "{}"); }
  catch { return {}; }
}

/* Las entradas viejas son valores sueltos (un número o un CFI) y las
   nuevas son `{v, t}`. Se leen las dos formas para no perder el punto
   de lectura de nadie al actualizar. */
export function valorProgreso(entrada) {
  return entrada && typeof entrada === "object" && "v" in entrada ? entrada.v : entrada;
}
/* Lo que hay guardado para una clave, ya desenvuelto. */
function leerProgreso(clave) {
  return valorProgreso(progress()[clave]) || null;
}

/* ---------- huella de un documento local ----------
   ⚠️ ANTES LA CLAVE DEL PDF ERA EL TÍTULO. Dos archivos distintos
   llamados «Documento1», «scan» o «CamScanner 05-04» —que es como
   salen del móvil y del escáner— compartían el punto de lectura: abrías
   uno y te dejaba en la página de otro.

   La huella mira el TAMAÑO y los primeros y últimos 4 KB. No es un
   hash criptográfico y no pretende serlo: basta para que dos archivos
   distintos no colisionen, y se calcula en milisegundos aunque el PDF
   pese 200 MB (leer el archivo entero para esto sería absurdo). */
export async function huellaDe(archivo, titulo = "") {
  if (!archivo) return `doc:${titulo}`;
  try {
    const trozo = 4096;
    let buffers, tam;
    if (typeof archivo.arrayBuffer === "function") {          // File o Blob
      tam = archivo.size;
      const partes = [archivo.slice(0, trozo)];
      if (tam > trozo * 2) partes.push(archivo.slice(tam - trozo));
      buffers = await Promise.all(partes.map((b) => b.arrayBuffer()));
    } else if (archivo.byteLength != null) {                  // ArrayBuffer o vista
      const bytes = archivo instanceof Uint8Array ? archivo : new Uint8Array(
        archivo.buffer || archivo, archivo.byteOffset || 0, archivo.byteLength);
      tam = bytes.length;
      buffers = [bytes.slice(0, trozo).buffer];
      if (tam > trozo * 2) buffers.push(bytes.slice(tam - trozo).buffer);
    } else {
      return `doc:${titulo}`;
    }
    let h = 2166136261 >>> 0;                       // FNV-1a de 32 bits
    for (const buf of buffers) {
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 16777619) >>> 0;
      }
    }
    return `doc:${tam.toString(36)}.${h.toString(36)}`;
  } catch (_) {
    return `doc:${titulo}`;
  }
}

/* Al abrir con huella se mira si había progreso guardado con la clave
   vieja (por título) y se traslada: nadie pierde por dónde iba al
   actualizar. La entrada vieja se borra para no dejar basura. */
function migrarClaveVieja(claveVieja, claveNueva) {
  if (!claveVieja || claveVieja === claveNueva) return;
  try {
    const p = progress();
    if (p[claveNueva] || !p[claveVieja]) return;
    p[claveNueva] = { v: valorProgreso(p[claveVieja]), t: Date.now() };
    delete p[claveVieja];
    localStorage.setItem("anilector.progress", JSON.stringify(p));
  } catch (_) {}
}

function podar(p) {
  const claves = Object.keys(p);
  if (claves.length <= MAXIMO_PROGRESO) return p;
  // Sin fecha (entradas de antes de esta versión) van las primeras a la
  // basura: son las más antiguas por definición.
  claves.sort((a, b) => (p[b]?.t || 0) - (p[a]?.t || 0));
  const podado = {};
  for (const k of claves.slice(0, MAXIMO_PROGRESO)) podado[k] = p[k];
  return podado;
}

function saveProgress(key, value) {
  if (!key) return;
  try {
    let p = progress();
    /* El nombre y el tamaño se guardan CON el progreso porque la clave es
       una huella (`doc:1dk.13pn3ci`) y sola no dice nada: sin esto no se
       puede listar «lo que estabas leyendo» ni volver a abrirlo. */
    p[key] = {
      v: value, t: Date.now(),
      n: state.nombreDoc || p[key]?.n || "",
      s: state.tamanoDoc || p[key]?.s || 0,
    };
    p = podar(p);
    try {
      localStorage.setItem("anilector.progress", JSON.stringify(p));
    } catch (e) {
      // Si aun así no cabe, es que el problema está en otra parte del
      // almacenamiento: se recorta a la mitad y se avisa arriba.
      if (e?.name !== "QuotaExceededError") throw e;
      const mitad = {};
      for (const k of Object.keys(p).sort((a, b) => (p[b]?.t || 0) - (p[a]?.t || 0))
        .slice(0, Math.floor(MAXIMO_PROGRESO / 2))) mitad[k] = p[k];
      localStorage.setItem("anilector.progress", JSON.stringify(mitad));
      window.dispatchEvent(new CustomEvent("anilector:almacenlleno"));
    }
    window.dispatchEvent(new Event("anilector:datachanged"));
  } catch (_) {}
}

/* ---------- tipografía de lectura ----------
   Los botones ➖/➕ solo cambiaban el tamaño, y en EPUB no hacían nada
   porque zoomBy() no tenía rama para ese modo. Aquí vive el ajuste
   completo (tamaño, interlineado y ancho de columna), compartido por
   EPUB, MOBI, Markdown y texto, y recordado entre sesiones. */
const TIPO_DEF = { size: 1, lh: 1.6, width: 42 };   // rem · veces · caracteres
const TIPO_LIM = { size: [0.6, 2.5], lh: [1.1, 2.4], width: [24, 90] };
const MODOS_TEXTO = ["epub", "mobi", "html", "text"];

function acotar(v, [min, max], porDefecto) {
  const n = parseFloat(v);
  return isNaN(n) ? porDefecto : Math.min(max, Math.max(min, n));
}
function leerTipo() {
  try {
    const v = JSON.parse(localStorage.getItem("anilector.readType") || "{}");
    return {
      size: acotar(v.size, TIPO_LIM.size, TIPO_DEF.size),
      lh: acotar(v.lh, TIPO_LIM.lh, TIPO_DEF.lh),
      width: acotar(v.width, TIPO_LIM.width, TIPO_DEF.width),
    };
  } catch { return { ...TIPO_DEF }; }
}
function guardarTipo() {
  try { localStorage.setItem("anilector.readType", JSON.stringify(state.tipo)); } catch (_) {}
}
function aplicarTipo() {
  if (!state.tipo) state.tipo = leerTipo();
  const { size, lh, width } = state.tipo;
  // El EPUB se pinta dentro de un iframe propio: los estilos hay que
  // inyectarlos por la API de epub.js, no tocando el DOM de fuera.
  if (state.mode === "epub" && state.epubRendition) {
    try {
      state.epubRendition.themes.fontSize(`${Math.round(size * 100)}%`);
      state.epubRendition.themes.override("line-height", String(lh));
    } catch (_) {}
    return;
  }
  const doc = body().querySelector(".ebook-doc, .text-doc");
  if (!doc) return;
  doc.style.fontSize = `${size}rem`;
  doc.style.lineHeight = String(lh);
  // El ancho de columna no aplica al EPUB (lo pagina epub.js por su cuenta).
  doc.style.maxWidth = `${width}ch`;
  doc.style.marginInline = "auto";
}
function cambiarTipo(campo, delta) {
  if (!state.tipo) state.tipo = leerTipo();
  const paso = { size: 0.1, lh: 0.1, width: 4 }[campo];
  state.tipo[campo] = acotar(state.tipo[campo] + delta * paso, TIPO_LIM[campo], TIPO_DEF[campo]);
  // Redondeo para que no se acumulen decimales feos al pulsar muchas veces.
  state.tipo[campo] = Math.round(state.tipo[campo] * 100) / 100;
  guardarTipo();
  aplicarTipo();
  pintarPanelTipo();
}

const PANELES = ["vTocPanel", "vTypePanel", "vTrPanel", "vBuscaPanel", "vMarcasPanel"];
function cerrarPaneles(salvo) {
  for (const id of PANELES) {
    if (id !== salvo) document.getElementById(id)?.classList.add("hidden");
  }
}
function pintarPanelTipo() {
  const panel = document.getElementById("vTypePanel");
  if (!panel || panel.classList.contains("hidden")) return;
  if (!state.tipo) state.tipo = leerTipo();
  const esEpub = state.mode === "epub";
  const fila = (campo, etiqueta, valor) => `
    <div class="tipo-fila">
      <span class="tipo-nombre">${etiqueta}</span>
      <button class="btn btn-ghost" data-tipo="${campo}" data-d="-1" aria-label="${etiqueta} −">−</button>
      <span class="tipo-valor">${valor}</span>
      <button class="btn btn-ghost" data-tipo="${campo}" data-d="1" aria-label="${etiqueta} +">+</button>
    </div>`;
  panel.innerHTML =
    fila("size", t("reader.typeSize"), `${Math.round(state.tipo.size * 100)}%`) +
    fila("lh", t("reader.typeLine"), state.tipo.lh.toFixed(1)) +
    (esEpub ? "" : fila("width", t("reader.typeWidth"), `${Math.round(state.tipo.width)}`)) +
    `<button class="btn btn-ghost tipo-reset" id="vTypeReset">${t("reader.typeReset")}</button>`;
}
function alternarPanelTipo() {
  const panel = document.getElementById("vTypePanel");
  if (!panel) return;
  const abierto = !panel.classList.contains("hidden");
  cerrarPaneles("vTypePanel");
  panel.classList.toggle("hidden", abierto);
  if (!abierto) pintarPanelTipo();
}

/* ---------- traducción del texto que estás leyendo ----------
   La lógica vive en translate.js; aquí solo van las raíces del documento
   y el panel. El EPUB se pinta dentro de un iframe propio, así que sus
   raíces se piden a epub.js en vez de buscarlas en el DOM de fuera. */
function raicesTexto() {
  if (state.mode === "epub" && state.epubRendition) {
    try {
      return (state.epubRendition.getContents() || [])
        .map((c) => c.content || c.document?.body)
        .filter(Boolean);
    } catch (_) { return []; }
  }
  const doc = body().querySelector(".ebook-doc, .text-doc");
  return doc ? [doc] : [];
}
function ajustarBotonTr() {
  const b = document.getElementById("vTr");
  if (b) b.style.display = MODOS_TEXTO.includes(state.mode) ? "" : "none";
}
function estadoTr(msg) {
  const el = document.getElementById("vTrEstado");
  if (el) el.textContent = msg || "";
}
/* Si el navegador ni siquiera tiene las APIs, se dice de entrada. Si las
   tiene, se ofrece el botón: saber si de verdad funcionan exige probar, y
   esa prueba (la detección) es justo el primer paso de traducir. */
function pintarPanelTr() {
  const panel = document.getElementById("vTrPanel");
  if (!panel || panel.classList.contains("hidden")) return;
  if (!TR.hayTraductor()) {
    panel.innerHTML = `<p class="tr-aviso">${esc(t("reader.trNoApi"))}</p>`;
    return;
  }
  const destino = TR.idiomaDestino();
  panel.innerHTML = `
    <div class="tipo-fila">
      <span class="tipo-nombre">${t("reader.trTarget")}</span>
      <select id="vTrLang" class="tr-select">
        ${TR.DESTINOS.map((c) =>
          `<option value="${c}"${c === destino ? " selected" : ""}>${esc(TR.nombreIdioma(c))}</option>`).join("")}
      </select>
    </div>
    <button class="btn btn-primary tr-accion" id="vTrGo">
      ${state.trOn ? t("reader.trOriginal") : t("reader.translate")}
    </button>
    <p class="tr-estado" id="vTrEstado"></p>`;
}
function alternarPanelTr() {
  const panel = document.getElementById("vTrPanel");
  if (!panel) return;
  const abierto = !panel.classList.contains("hidden");
  cerrarPaneles("vTrPanel");
  panel.classList.toggle("hidden", abierto);
  if (!abierto) pintarPanelTr();
}

async function traducirDocumento() {
  const raices = raicesTexto();
  if (!raices.length) return estadoTr(t("reader.trFailed"));
  const destino = document.getElementById("vTrLang")?.value || TR.idiomaDestino();
  TR.guardarDestino(destino);

  try {
    estadoTr(t("reader.trDetecting"));
    // La detección va primero también porque es la llamada segura: si el
    // navegador no trae los modelos, falla aquí con un mensaje claro y
    // no se llega a tocar el traductor (ver el comentario de translate.js).
    const origen = await TR.detectarIdioma(TR.muestraDeTexto(raices));
    if (!origen) return estadoTr(t("reader.trUnknown"));
    if (origen === destino) {
      return estadoTr(t("reader.trSame").replace("%s", TR.nombreIdioma(destino)));
    }

    estadoTr(t("reader.trWorking"));
    await TR.traducir(raices, { origen, destino, onEstado: estadoTr });
    state.trOn = true;
    state.trPar = { origen, destino };
    estadoTr(t("reader.trDone")
      .replace("%s", TR.nombreIdioma(origen)).replace("%s", TR.nombreIdioma(destino)));
    const b = document.getElementById("vTrGo");
    if (b) b.textContent = t("reader.trOriginal");
    const btn = document.getElementById("vTr");
    if (btn) btn.classList.add("activo");
  } catch (e) {
    estadoTr(e.message || t("reader.trFailed"));
  }
}
function volverAlOriginal() {
  TR.restaurar(raicesTexto());
  state.trOn = false;
  state.trPar = null;
  estadoTr("");
  const b = document.getElementById("vTrGo");
  if (b) b.textContent = t("reader.translate");
  document.getElementById("vTr")?.classList.remove("activo");
}

/* ---------- índice (tabla de contenidos) ----------
   `items` = [{ label, nivel, ir() }]. Cada formato lo construye a su
   manera (epub.js, pdf.js y foliate lo exponen) y aquí se pinta igual. */
function ponerIndice(items) {
  state.toc = (items || []).filter((i) => i && i.label);
  const btn = document.getElementById("vToc");
  if (btn) btn.style.display = state.toc.length ? "" : "none";
}
function alternarPanelIndice() {
  const panel = document.getElementById("vTocPanel");
  if (!panel) return;
  const abierto = !panel.classList.contains("hidden");
  cerrarPaneles("vTocPanel");
  panel.classList.toggle("hidden", abierto);
  if (abierto) return;
  panel.innerHTML = `<ol class="toc-lista">` + state.toc.map((it, i) =>
    `<li><button class="toc-item" data-i="${i}" style="padding-left:${0.6 + (it.nivel || 0) * 0.9}rem">${esc(it.label)}</button></li>`
  ).join("") + `</ol>`;
}


/* ============================================================
   Buscar dentro del documento y marcadores
   ------------------------------------------------------------
   Las dos cosas necesitan lo mismo: SABER DÓNDE ESTÁS y PODER IR
   a un sitio concreto. Cada formato habla su idioma —página en
   PDF, CFI en EPUB, sección en MOBI, índice en los cómics— así que
   la posición se guarda con su `modo` y hay un solo sitio que sabe
   interpretarla. Un resultado de búsqueda y un marcador se navegan
   con el mismo código.
   ============================================================ */

/* Dónde estás ahora mismo, en el idioma del formato abierto. */
function posicionActual() {
  switch (state.mode) {
    case "pdf":
      return { pos: { modo: "pdf", pagina: state.page },
        etiqueta: `${t("reader.page")} ${state.page}` };
    case "epub": {
      const cfi = state.epubRendition?.currentLocation?.()?.start?.cfi;
      return cfi ? { pos: { modo: "epub", cfi }, etiqueta: pageInfo()?.textContent || "" } : null;
    }
    case "images":
      return { pos: { modo: "imagen", index: state.imgIndex },
        etiqueta: `${state.imgIndex + 1} / ${state.images.length}` };
    case "mobi": case "text": case "html": {
      const doc = document.getElementById("ebookDoc") || body();
      let sec = 0, caja = null;
      for (const c of doc.querySelectorAll(".ebook-section")) {
        if (c.offsetTop <= body().scrollTop + 4) { sec = Number(c.dataset.sec) || 0; caja = c; }
        else break;
      }
      const off = Math.round(body().scrollTop - (caja?.offsetTop || 0));
      return { pos: { modo: "pagina", sec, off }, etiqueta: pageInfo()?.textContent || "" };
    }
    default:
      return null;
  }
}

/* Ir a una posición, venga de una búsqueda o de un marcador. */
async function irAPosicion(pos) {
  if (!pos) return;
  cerrarPaneles();
  if (pos.modo === "pdf" && state.pdf) {
    state.page = Math.min(Math.max(1, pos.pagina || 1), state.pdf.numPages);
    // Los recuadros solo se pintan si el hallazgo trae su intervalo:
    // un marcador señala una página, no un trozo de texto.
    state.marcarPdf = pos.ini != null ? { pagina: state.page, ini: pos.ini, fin: pos.fin } : null;
    await renderPdfPage();
    return;
  }
  if (pos.modo === "epub" && state.epubRendition) {
    try {
      await state.epubRendition.display(pos.cfi);
      // Subrayado nativo de epub.js: sobrevive al repintado del capítulo.
      try {
        state.epubRendition.annotations?.remove?.(pos.cfi, "highlight");
        state.epubRendition.annotations?.highlight?.(pos.cfi);
      } catch (_) {}
    } catch (_) {}
    return;
  }
  if (pos.modo === "imagen") {
    state.imgIndex = Math.min(Math.max(0, pos.index || 0), Math.max(0, state.images.length - 1));
    if (state.webtoon) {
      document.querySelector(`.webtoon-page[data-i="${state.imgIndex}"]`)
        ?.scrollIntoView({ block: "start" });
    } else renderImage();
    return;
  }
  if (pos.modo === "pagina") {
    // Un resultado de búsqueda trae el nodo exacto; un marcador, la
    // sección y el desplazamiento.
    if (pos.nodo?.isConnected) {
      if (BUSCA.resaltar(pos.nodo, pos.pos, pos.largo)) return;
    }
    if (state.irASeccion) await state.irASeccion(pos.sec || 0);
    const caja = document.querySelector(`.ebook-section[data-sec="${pos.sec || 0}"]`);
    if (caja) body().scrollTop = caja.offsetTop + (pos.off || 0);
  }
}

/* ---------- panel de búsqueda ---------- */
let cancelarBusqueda = null;

function ajustarBotonBuscar() {
  const b = document.getElementById("vBusca");
  if (!b) return;
  // En cómics e imágenes no hay texto: el botón no se ofrece.
  b.style.display = ["pdf", "epub", "mobi", "text", "html"].includes(state.mode) ? "" : "none";
}

function alternarPanelBuscar() {
  const panel = document.getElementById("vBuscaPanel");
  if (!panel) return;
  const abierto = !panel.classList.contains("hidden");
  cerrarPaneles("vBuscaPanel");
  panel.classList.toggle("hidden", abierto);
  if (abierto) return;
  if (!panel.dataset.listo) {
    panel.innerHTML = `
      <div class="busca-barra">
        <input id="vBuscaInput" type="search" placeholder="${esc(t("busca.ph"))}"
               autocomplete="off" spellcheck="false" />
        <button id="vBuscaIr" class="btn btn-primary btn-sm">${esc(t("busca.ir"))}</button>
      </div>
      <p id="vBuscaEstado" class="busca-estado"></p>
      <div id="vBuscaLista" class="busca-lista"></div>`;
    panel.dataset.listo = "1";
    const lanzar = () => lanzarBusqueda(document.getElementById("vBuscaInput").value);
    document.getElementById("vBuscaIr").addEventListener("click", lanzar);
    document.getElementById("vBuscaInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); lanzar(); }
    });
    document.getElementById("vBuscaLista").addEventListener("click", (e) => {
      const b = e.target.closest("[data-r]");
      if (b) irAPosicion(ultimosResultados[Number(b.dataset.r)]?.ir);
    });
  }
  document.getElementById("vBuscaInput")?.focus();
}

let ultimosResultados = [];

async function lanzarBusqueda(consulta) {
  const estado = document.getElementById("vBuscaEstado");
  const lista = document.getElementById("vBuscaLista");
  if (!estado || !lista) return;

  // Una búsqueda nueva cancela la anterior: en un PDF grande la primera
  // tarda, y no tiene sentido esperar a que acabe algo que ya no importa.
  cancelarBusqueda?.abort();
  const ctrl = new AbortController();
  cancelarBusqueda = ctrl;

  BUSCA.quitarResaltado();
  lista.innerHTML = "";
  estado.textContent = t("busca.buscando");

  let r;
  try {
    r = await BUSCA.buscar(consulta, {
      señal: ctrl.signal,
      alProgreso: (hechas, total) => {
        if (total > 8) estado.textContent = `${t("busca.buscando")} ${hechas}/${total}`;
      },
    });
  } catch (e) {
    if (!ctrl.signal.aborted) estado.textContent = t("busca.error");
    return;
  }
  if (ctrl.signal.aborted) return;

  if (r.corta) return void (estado.textContent = t("busca.corta"));
  if (r.sinTexto) return void (estado.textContent = t("busca.sinTexto"));
  if (r.escaneado) return void (estado.textContent = t("busca.escaneado"));

  ultimosResultados = r.resultados;
  if (!r.resultados.length) return void (estado.textContent = t("busca.nada"));
  estado.textContent = t("busca.cuantos").replace("%s", String(r.resultados.length));
  lista.innerHTML = r.resultados.map((x, i) => `
    <button class="busca-item" data-r="${i}">
      ${x.etiqueta ? `<span class="busca-donde">${esc(x.etiqueta)}</span>` : ""}
      <span class="busca-txt">${esc(x.antes)}<mark>${esc(x.hallado)}</mark>${esc(x.despues)}</span>
    </button>`).join("");
}

/* ---------- panel de marcadores ---------- */
function ajustarBotonMarcas() {
  const b = document.getElementById("vMarcas");
  if (!b) return;
  const sirve = ["pdf", "epub", "mobi", "text", "html", "images"].includes(state.mode);
  b.style.display = sirve ? "" : "none";
  if (!sirve) return;
  const n = MARCAS.cuantas(state.docKey);
  b.textContent = n ? `🔖${n}` : "🔖";
  b.classList.toggle("activo", n > 0);
}

function alternarPanelMarcas() {
  const panel = document.getElementById("vMarcasPanel");
  if (!panel) return;
  const abierto = !panel.classList.contains("hidden");
  cerrarPaneles("vMarcasPanel");
  panel.classList.toggle("hidden", abierto);
  if (!abierto) pintarMarcas();
}

function pintarMarcas() {
  const panel = document.getElementById("vMarcasPanel");
  if (!panel || panel.classList.contains("hidden")) return;
  const lista = MARCAS.listar(state.docKey);
  panel.innerHTML = `
    <button id="vMarcaNueva" class="btn btn-primary btn-sm marca-nueva">${esc(t("marca.nueva"))}</button>
    ${lista.length ? `<div class="marca-lista">${lista.map((m) => `
      <div class="marca" data-id="${esc(m.id)}">
        <button class="marca-ir" data-ir="${esc(m.id)}">
          <span class="marca-donde">${esc(m.etiqueta || "—")}</span>
          <span class="marca-nota">${esc(m.nota || t("marca.sinNota"))}</span>
        </button>
        <div class="marca-acciones">
          <button class="btn btn-ghost btn-sm" data-nota="${esc(m.id)}" title="${esc(t("marca.editar"))}">✏️</button>
          <button class="btn btn-ghost btn-sm" data-del="${esc(m.id)}" title="${esc(t("marca.borrar"))}">🗑️</button>
        </div>
      </div>`).join("")}</div>`
      : `<p class="busca-estado">${esc(t("marca.vacio"))}</p>`}`;

  document.getElementById("vMarcaNueva").addEventListener("click", () => {
    const aqui = posicionActual();
    if (!aqui) return;
    const m = MARCAS.añadir(state.docKey, { pos: aqui.pos, etiqueta: aqui.etiqueta });
    if (m) { pintarMarcas(); ajustarBotonMarcas(); toastVisor(t("marca.puesta")); }
  });
  panel.querySelectorAll("[data-ir]").forEach((b) => b.addEventListener("click", () => {
    const m = MARCAS.listar(state.docKey).find((x) => x.id === b.dataset.ir);
    if (m) irAPosicion(m.pos);
  }));
  panel.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    MARCAS.borrar(state.docKey, b.dataset.del);
    pintarMarcas(); ajustarBotonMarcas();
  }));
  /* La nota se edita EN EL SITIO, con el mismo patrón que «ir a la
     página»: nada de `prompt()`, que bloquea la pestaña entera y en el
     móvil a veces ni aparece. */
  panel.querySelectorAll("[data-nota]").forEach((b) => b.addEventListener("click", () => {
    const fila = b.closest(".marca");
    const hueco = fila?.querySelector(".marca-nota");
    if (!hueco || hueco.querySelector("input")) return;
    const m = MARCAS.listar(state.docKey).find((x) => x.id === b.dataset.nota);
    if (!m) return;
    hueco.innerHTML = `<input class="marca-input" type="text" maxlength="500" />`;
    const inp = hueco.querySelector("input");
    inp.value = m.nota || "";
    inp.focus();
    inp.select();
    let cerrado = false;
    const cerrar = (aplicar) => {
      if (cerrado) return;
      cerrado = true;
      if (aplicar) MARCAS.editarNota(state.docKey, m.id, inp.value);
      pintarMarcas();
    };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();      // que ◀ ▶ del visor no se lleven las flechas
      if (e.key === "Enter") cerrar(true);
      if (e.key === "Escape") cerrar(false);
    });
    inp.addEventListener("blur", () => cerrar(true));
  }));
}

/* ---------- apertura / cierre ---------- */
let origenPendiente = null;      // lo pone openLocalFile, lo recoge openModal

function openModal(title, { showControls = true, external = null } = {}) {
  titleEl().textContent = title;
  controls().style.display = showControls ? "" : "none";
  // Restaurar ◀ ▶ : el modo MOBI los oculta y sin esto seguirían ocultos
  // en el siguiente documento que se abra.
  document.getElementById("vPrev").style.display = "";
  document.getElementById("vNext").style.display = "";
  if (external) { extLink().href = external; extLink().style.display = ""; }
  else extLink().style.display = "none";
  // Cada documento empieza sin índice y con los paneles cerrados. El botón
  // de tipografía lo vuelve a encender quien tenga texto que fluya.
  cerrarPaneles();
  ponerIndice([]);
  for (const id of ["vType", "vTr", "vKeep", "vBusca", "vMarcas"]) {
    const b = document.getElementById(id);
    if (b) { b.style.display = "none"; b.classList.remove("activo"); }
  }
  // Nada del documento anterior vale para el nuevo.
  BUSCA.reiniciarBuscador();
  BUSCA.quitarResaltado();
  ultimosResultados = [];
  cancelarBusqueda?.abort();
  cancelarBusqueda = null;
  const panelBusca = document.getElementById("vBuscaPanel");
  if (panelBusca) { panelBusca.innerHTML = ""; delete panelBusca.dataset.listo; }
  state.irASeccion = null;
  state.cargarTodo = null;
  state.marcarPdf = null;
  state.trOn = false;
  state.trPar = null;
  state.archivoOrigen = origenPendiente;
  origenPendiente = null;
  state.tipo = leerTipo();
  body().innerHTML = "";
  body().scrollTop = 0;
  modal().classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
/* El botón de tipografía solo tiene sentido donde hay texto que fluye. */
function ajustarBotonTipo() {
  const b = document.getElementById("vType");
  if (b) b.style.display = MODOS_TEXTO.includes(state.mode) ? "" : "none";
}
export function closeViewer() {
  modal().classList.add("hidden");
  document.body.style.overflow = "";
  if (state.epubRendition) { try { state.epubRendition.destroy(); } catch (_) {} }
  if (state.mobiBook?.destroy) { try { state.mobiBook.destroy(); } catch (_) {} }
  if (state.archive?.close) { try { state.archive.close(); } catch (_) {} }
  if (state.pdf?.destroy) { try { state.pdf.destroy(); } catch (_) {} }
  if (state.onScroll) { body().removeEventListener("scroll", state.onScroll); state.onScroll = null; }
  revokeAll();
  document.getElementById("vWebtoon")?.remove();
  document.getElementById("vSave")?.remove();
  document.getElementById("vNight")?.remove();
  body().classList.remove("night");
  cerrarPaneles();
  ponerIndice([]);
  // El indicador se queda con lo del documento anterior si no se limpia:
  // al abrir el siguiente se ve un instante «pág. 7 de 300» de otro libro.
  const info = pageInfo();
  if (info) { info.textContent = "–"; info.title = ""; }
  BUSCA.reiniciarBuscador();
  BUSCA.quitarResaltado();
  ultimosResultados = [];
  cancelarBusqueda?.abort();
  cancelarBusqueda = null;
  Object.assign(state, {
    mode: null, pdf: null, images: [], imgIndex: 0, imgZoom: 1,
    epubRendition: null, epubBook: null, mobiBook: null, archive: null, docKey: null,
    archivoOrigen: null, irASeccion: null, cargarTodo: null, marcarPdf: null,
    nombreDoc: "", tamanoDoc: 0,
  });
  body().innerHTML = "";
}

/* ---------- PDF ---------- */
export async function openPdf(source, title) {
  const isUrl = typeof source === "string";
  openModal(title, { external: isUrl ? source : null });
  showLoader();
  state.mode = "pdf";
  // Con archivo local, la huella del contenido; con una dirección, la
  // dirección misma, que ya identifica el documento sin ambigüedad.
  state.docKey = isUrl ? `pdf:${source}` : await huellaDe(source, title);
  if (!isUrl) migrarClaveVieja(`pdf:${title}`, state.docKey);
  state.nombreDoc = title || source?.name || "";
  state.tamanoDoc = isUrl ? 0 : (source?.size || 0);
  state.zoom = window.innerWidth < 720 ? 0.8 : 1.2;

  const pdfjsLib = window.pdfjsLib;
  // El worker vive en el repo (vendor/) para que los PDF abran sin conexión;
  // la ruta se resuelve contra la página, no contra este archivo js/.
  pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";

  const load = (src) =>
    (typeof src === "string"
      ? pdfjsLib.getDocument({ url: src, withCredentials: false })
      : pdfjsLib.getDocument({ data: src })).promise;

  try {
    if (isUrl) {
      // Directo primero (respeta los rangos HTTP, ideal en PDFs grandes);
      // si CORS lo bloquea, se reintenta por el proxy del microservicio.
      try { state.pdf = await load(source); }
      catch (e) {
        const prox = proxiedUrl(source);
        if (!prox) throw e;
        state.pdf = await load(prox);
      }
    } else {
      state.pdf = await load(await source.arrayBuffer());
    }
  } catch (e) {
    return showError(e.message, isUrl ? source : null, () => openPdf(source, title));
  }

  state.page = leerProgreso(state.docKey)?.page || 1;
  if (state.page > state.pdf.numPages) state.page = 1;

  body().innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.id = "pdfCanvas";
  body().appendChild(canvas);
  ajustarBotonTipo();
  ajustarBotonGuardar();
  ajustarBotonBuscar();
  ajustarBotonMarcas();
  await renderPdfPage();
  await indicePdf();
}

/* Índice del PDF. `dest` puede venir como nombre (string) o como array
   cuyo primer elemento es la referencia de la página; pdf.js resuelve
   ambos, pero hay que pedírselo explícitamente. */
async function indicePdf() {
  let esquema = null;
  try { esquema = await state.pdf.getOutline(); } catch (_) { return; }
  if (!esquema?.length) return;

  const aPagina = async (dest) => {
    try {
      const d = typeof dest === "string" ? await state.pdf.getDestination(dest) : dest;
      if (!Array.isArray(d) || !d[0]) return null;
      return (await state.pdf.getPageIndex(d[0])) + 1;
    } catch (_) { return null; }
  };

  const plano = [];
  const aplanar = (arr, nivel) => {
    for (const it of arr || []) {
      plano.push({
        label: (it.title || "").trim(),
        nivel,
        ir: async () => {
          const n = await aPagina(it.dest);
          if (!n) return;
          state.page = Math.min(Math.max(1, n), state.pdf.numPages);
          renderPdfPage();
        },
      });
      if (it.items?.length) aplanar(it.items, nivel + 1);
    }
  };
  aplanar(esquema, 0);
  ponerIndice(plano);
}

async function renderPdfPage() {
  const page = await state.pdf.getPage(state.page);
  const viewport = page.getViewport({ scale: state.zoom * (window.devicePixelRatio || 1) });
  const canvas = document.getElementById("pdfCanvas");
  if (!canvas) return;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;

  /* Lo encontrado por la búsqueda, marcado encima del dibujo. Se pintan
     los TROZOS de texto que toca el hallazgo (pdf.js da la posición de
     cada trozo, no de cada letra) usando la misma transformación con la
     que se ha dibujado la página, así que cuadra a cualquier zoom. */
  if (state.marcarPdf?.pagina === state.page) {
    const marcas = BUSCA.trozosAMarcar(state.page, state.marcarPdf.ini, state.marcarPdf.fin);
    ctx.save();
    ctx.fillStyle = "rgba(255, 214, 0, .38)";
    for (const { it, desde, hasta } of marcas) {
      try {
        const m = window.pdfjsLib.Util.transform(viewport.transform, it.transform);
        const alto = Math.hypot(m[2], m[3]) || it.height || 10;
        const escala = Math.hypot(m[0], m[1]) / (Math.hypot(it.transform[0], it.transform[1]) || 1);
        const anchoTotal = (it.width || 0) * escala;
        const x = m[4] + anchoTotal * desde;
        const ancho = anchoTotal * (hasta - desde);
        if (ancho > 0.5) ctx.fillRect(x, m[5] - alto, ancho, alto);
      } catch (_) { /* un trozo raro no debe romper el pintado */ }
    }
    ctx.restore();
  }
  ajustarBotonMarcas();
  pageInfo().textContent = `${t("reader.page")} ${state.page} ${t("reader.of")} ${state.pdf.numPages}`;
  pageInfo().title = t("reader.goToPage");
  saveProgress(state.docKey, { page: state.page });
}

/* ---------- EPUB ---------- */
/* Un EPUB no tiene páginas fijas: el texto se reparte según el tamaño de
   letra y de la pantalla, así que «página 40 de 300» no existe. Lo que sí
   hay, y desde el primer instante, es el capítulo y la página DENTRO del
   capítulo (`loc.start.displayed`). El porcentaje global llega después. */
function mostrarAvanceEpub(book, loc, porcentajeListo) {
  const d = loc?.start?.displayed;
  const pagina = d?.total ? `${d.page}/${d.total}` : "";

  /* ⚠️ NO basta con preguntar el porcentaje: MIENTRAS epub.js recorre el
     libro, `percentageFromCfi` YA DEVUELVE NÚMEROS — un 0 para todo lo
     que aún no ha procesado. Por eso salía «0%» fijo incluso al saltar al
     último capítulo. Solo vale cuando el recorrido ha TERMINADO. */
  let pct = null;
  if (porcentajeListo) {
    try {
      const v = book.locations?.percentageFromCfi?.(loc.start.cfi);
      if (typeof v === "number" && isFinite(v)) pct = Math.round(v * 100);
    } catch (_) {}
  }

  const capitulos = book.spine?.length || book.spine?.items?.length || 0;
  const cap = capitulos ? `${(loc.start.index ?? 0) + 1}/${capitulos}` : "";

  const cabeza = pct != null ? `${pct}%` : (cap ? `c.${cap}` : "");
  pageInfo().textContent = [cabeza, pagina].filter(Boolean).join(" · ") || "…";
  pageInfo().title = [
    cap ? t("reader.infoChapter").replace("%s", cap.replace("/", " " + t("reader.of") + " ")) : "",
    d?.total ? t("reader.infoPage").replace("%s", `${d.page} ${t("reader.of")} ${d.total}`) : "",
    pct != null ? `${pct}%` : t("reader.infoCalc"),
  ].filter(Boolean).join(" · ");
}
export async function openEpub(file, title) {
  openModal(title || file.name);
  state.mode = "epub";
  // Mismo motivo que en el PDF: dos «libro.epub» distintos no deben
  // compartir el punto de lectura.
  state.docKey = await huellaDe(file, file.name);
  migrarClaveVieja(`epub:${file.name}`, state.docKey);
  state.nombreDoc = file.name || title || "";
  state.tamanoDoc = file.size || 0;
  // Un EPUB grande tarda en analizarse: sin esto se veía el visor en
  // blanco, sin explicación, hasta que aparecía la primera página.
  showLoader();

  let book, rendition;
  try {
    book = window.ePub(await file.arrayBuffer());
    // El área se monta bajo el cargador (no en su lugar): si esto falla,
    // showError la sustituye y no queda un visor vacío.
    const area = document.createElement("div");
    area.id = "epubArea";
    area.style.visibility = "hidden";
    body().appendChild(area);
    rendition = book.renderTo("epubArea", { width: "100%", height: "100%", flow: "paginated" });
    state.epubBook = book;
    state.epubRendition = rendition;
    // Con un archivo que no es un EPUB, epub.js no lanza: se queda
    // esperando para siempre y el visor se quedaba en blanco sin decir
    // nada. Por eso hay límite de tiempo, no solo try/catch.
    book.opened?.catch?.(() => {});
    const saved = leerProgreso(state.docKey)?.cfi;
    const mostrar = async () => {
      // Si el punto guardado ya no existe (el archivo cambió), no se
      // pierde el libro entero: se abre por el principio.
      try { await rendition.display(saved || undefined); }
      catch (_) { await rendition.display(); }
    };
    await conLimite(mostrar(), 20000);
    body().querySelector(".loader")?.remove();
    area.style.visibility = "";
  } catch (e) {
    // Antes esto reventaba hacia arriba y dejaba el visor abierto y vacío.
    try { rendition?.destroy?.(); } catch (_) {}
    state.epubRendition = null;
    state.epubBook = null;
    return showError(`${t("reader.epubFailed")} (${e.message})`, null, () => openEpub(file, title));
  }

  ajustarBotonTipo();
  ajustarBotonTr();
  ajustarBotonGuardar();
  ajustarBotonBuscar();
  ajustarBotonMarcas();
  aplicarTipo();
  let porcentajeListo = false;
  rendition.on("relocated", (loc) => {
    saveProgress(state.docKey, { cfi: loc.start.cfi });
    mostrarAvanceEpub(book, loc, porcentajeListo);
  });

  /* El porcentaje NO está disponible al abrir: epub.js tiene que recorrer
     el libro entero para calcularlo (medido: 3 s en un libro pequeño, más
     en uno de verdad y más aún en un teléfono). Mientras tanto devuelve
     null, y antes eso se pintaba como «0%» fijo: parecía que el libro no
     avanzaba. Ahora se enseña capítulo y página desde el primer momento,
     y el porcentaje se añade en cuanto está listo. */
  book.ready
    .then(async () => {
      /* El índice no cambia nunca para un mismo archivo, así que la
         segunda vez que abres un libro es instantáneo: se carga el que
         se guardó. Solo si no hay nada guardado se recalcula, y se
         guarda para la próxima. */
      const clave = `loc:${state.docKey}`;
      const guardado = await DOCS.leerIndiceEpub(clave);
      if (guardado) {
        try {
          book.locations.load(guardado);
          if (book.locations.length()) return;
        } catch (_) { /* índice ilegible: se recalcula abajo */ }
      }
      await book.locations.generate(1000);
      try { await DOCS.guardarIndiceEpub(clave, book.locations.save()); } catch (_) {}
    })
    .then(() => {
      porcentajeListo = true;
      const actual = rendition.currentLocation?.();
      if (actual?.start) mostrarAvanceEpub(book, actual, true);
    })
    .catch(() => {});

  /* Pellizco dentro del EPUB: cada capítulo se pinta en su propio iframe,
     así que los gestos hay que engancharlos ahí. El `hook` solo alcanza a
     los iframes FUTUROS — el que ya está en pantalla hay que hacerlo a
     mano, o el gesto no funciona hasta pasar de página. */
  const prepararIframe = (contents) => {
    const d = contents?.document || contents;
    if (!d) return;
    activarGestosZoom(d);
    try { d.documentElement.style.touchAction = "pan-x pan-y"; } catch (_) {}
  };
  try { rendition.hooks?.content?.register?.(prepararIframe); } catch (_) {}
  try { (rendition.getContents() || []).forEach(prepararIframe); } catch (_) {}

  // Al pasar de página, epub.js pinta la sección en un iframe nuevo y la
  // traducción se quedaría atrás. Si estaba activa, se vuelve a aplicar.
  rendition.on("rendered", () => {
    if (!state.trOn || !state.trPar) return;
    TR.traducir(raicesTexto(), { ...state.trPar }).catch(() => {});
  });

  // Índice: epub.js ya lo tenía cargado y no se usaba.
  book.loaded?.navigation?.then((nav) => {
    const plano = [];
    const aplanar = (arr, nivel) => {
      for (const it of arr || []) {
        plano.push({
          label: (it.label || "").trim(),
          nivel,
          ir: () => { try { rendition.display(it.href); } catch (_) {} },
        });
        if (it.subitems?.length) aplanar(it.subitems, nivel + 1);
      }
    };
    aplanar(nav?.toc, 0);
    ponerIndice(plano);
  }).catch(() => {});
}

/* ---------- MOBI / AZW3 (Kindle) ---------- */
let mobiMod = null;
async function loadMobiLib() {
  if (!mobiMod) mobiMod = await import("../vendor/foliate/mobi.js");
  return mobiMod;
}
// zlib nativo del navegador: evita cargar otra librería solo para las fuentes.
async function unzlib(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function openMobi(file, title) {
  openModal(title || file.name, { showControls: false });
  showLoader();
  state.mode = "mobi";
  state.docKey = await huellaDe(file, file.name);
  migrarClaveVieja(`mobi:${file.name}`, state.docKey);
  state.nombreDoc = file.name || title || "";
  state.tamanoDoc = file.size || 0;
  let book;
  try {
    const { MOBI } = await loadMobiLib();
    book = await new MOBI({ unzlib }).open(file);
  } catch (e) {
    return showError(`${t("reader.unsupported")} (${e.message})`);
  }
  state.mobiBook = book;

  const sections = (book.sections || []).filter((s) => typeof s.load === "function");
  if (!sections.length) return showError(t("reader.unsupported"));

  body().innerHTML = `<div class="ebook-doc" id="ebookDoc"></div>`;
  const doc = document.getElementById("ebookDoc");
  const sentinel = document.createElement("div");
  sentinel.className = "ebook-sentinel";
  doc.appendChild(sentinel);

  let loaded = 0;
  let busy = false;
  async function loadNext(n = 2) {
    if (busy || loaded >= sections.length) return;
    busy = true;
    for (let k = 0; k < n && loaded < sections.length; k++) {
      const sec = sections[loaded];
      try {
        const url = trackUrl(await sec.load());
        const html = await (await fetch(url)).text();
        const frag = document.createElement("section");
        frag.className = "ebook-section";
        frag.dataset.sec = loaded;          // para el índice y para retomar
        frag.innerHTML = sanitizeHTML(html);
        doc.insertBefore(frag, sentinel);
      } catch (e) {
        console.warn("MOBI sección:", e.message);
      }
      loaded++;
    }
    // OJO: aquí antes se pintaba `loaded / total`, o sea CUÁNTAS SECCIONES
    // SE HABÍAN CARGADO, no por dónde ibas. Al recorrer el documento el
    // número casi no se movía y parecía que no avanzaba nada.
    mostrarAvanceMobi();
    if (loaded >= sections.length) sentinel.remove();
    busy = false;
  }

  let secActual = 0;
  function mostrarAvanceMobi() {
    pageInfo().textContent = `${secActual + 1}/${sections.length}`;
    pageInfo().title = t("reader.infoSection")
      .replace("%s", `${secActual + 1} ${t("reader.of")} ${sections.length}`);
  }
  /* Cuál es la sección que estás mirando: la última cuyo comienzo queda
     por encima del borde superior del área de lectura. */
  function seccionVisible() {
    let sec = 0;
    for (const c of doc.querySelectorAll(".ebook-section")) {
      if (c.offsetTop <= body().scrollTop + 4) sec = Number(c.dataset.sec) || 0;
      else break;
    }
    return sec;
  }
  /* Saltar a una sección exige haber cargado las anteriores (el documento
     es una tira continua). Se cargan en tandas grandes para que un salto
     al capítulo 30 no sean 30 vueltas. */
  async function loadUntil(i) {
    let vueltas = 0;
    while (loaded <= i && loaded < sections.length && vueltas++ < 200) {
      while (busy) await new Promise((r) => setTimeout(r, 30));
      await loadNext(Math.max(4, Math.min(20, i - loaded + 1)));
    }
  }
  async function irASeccion(i) {
    if (!(i >= 0)) return;
    await loadUntil(i);
    doc.querySelector(`.ebook-section[data-sec="${i}"]`)?.scrollIntoView({ block: "start" });
  }
  // Lo que necesitan la búsqueda y los marcadores para moverse por aquí.
  state.irASeccion = irASeccion;
  /* Buscar exige tener el libro entero: se cargan las secciones que
     falten en tandas grandes, avisando del avance. Es lo que pide quien
     busca, y solo pasa la primera vez. */
  state.cargarTodo = async (alProgreso, señal) => {
    while (loaded < sections.length) {
      if (señal?.aborted) return;
      await loadNext(20);
      alProgreso?.(loaded, sections.length);
    }
  };

  const io = new IntersectionObserver((ents) => {
    if (ents.some((e) => e.isIntersecting)) loadNext(2);
  }, { root: body(), rootMargin: "600px" });
  io.observe(sentinel);
  controls().style.display = "";
  document.getElementById("vPrev").style.display = "none";
  document.getElementById("vNext").style.display = "none";
  ajustarBotonTipo();
  ajustarBotonTr();
  ajustarBotonGuardar();
  ajustarBotonBuscar();
  ajustarBotonMarcas();
  await loadNext(3);
  aplicarTipo();

  /* Recordar por dónde vas. El modo MOBI preparaba la clave del progreso
     y NUNCA la guardaba: un libro de 500 páginas se reabría siempre por
     el principio. Se guarda la sección visible arriba y el desplazamiento
     dentro de ella. */
  const guardarSitio = () => {
    const sec = seccionVisible();
    const caja = doc.querySelector(`.ebook-section[data-sec="${sec}"]`);
    saveProgress(state.docKey, {
      sec,
      off: Math.round(body().scrollTop - (caja?.offsetTop || 0)),
    });
  };
  let reloj = null;
  state.onScroll = () => {
    // El número se actualiza al instante (es barato); guardar en disco va
    // con retardo para no escribir en cada píxel de scroll.
    const sec = seccionVisible();
    if (sec !== secActual) { secActual = sec; mostrarAvanceMobi(); }
    clearTimeout(reloj);
    reloj = setTimeout(guardarSitio, 400);
  };
  body().addEventListener("scroll", state.onScroll);

  // Índice: foliate expone book.toc y resolveHref() → { index } de sección.
  try {
    const plano = [];
    const aplanar = (arr, nivel) => {
      for (const it of arr || []) {
        plano.push({
          label: (it.label || "").trim(),
          nivel,
          ir: async () => {
            try {
              const r = await book.resolveHref(it.href);
              if (r && r.index >= 0) await irASeccion(r.index);
            } catch (_) {}
          },
        });
        if (it.subitems?.length) aplanar(it.subitems, nivel + 1);
      }
    };
    aplanar(book.toc, 0);
    ponerIndice(plano);
  } catch (_) {}

  // Retomar donde se quedó (después de montar todo lo anterior).
  const guardado = leerProgreso(state.docKey);
  if (guardado?.sec > 0 || guardado?.off > 0) {
    showLoaderFlotante();
    await irASeccion(guardado.sec || 0);
    const caja = doc.querySelector(`.ebook-section[data-sec="${guardado.sec || 0}"]`);
    if (caja) body().scrollTop = caja.offsetTop + (guardado.off || 0);
    quitarLoaderFlotante();
    secActual = seccionVisible();
  }
  mostrarAvanceMobi();
}

/* Aviso discreto mientras se cargan las secciones de un salto largo:
   el documento ya está en pantalla, así que no se puede usar showLoader
   (borraría lo cargado). */
function showLoaderFlotante() {
  quitarLoaderFlotante();
  const el = document.createElement("div");
  el.id = "vJumping";
  el.className = "jump-toast";
  el.textContent = t("reader.jumping");
  body().appendChild(el);
}
function quitarLoaderFlotante() {
  document.getElementById("vJumping")?.remove();
}

/* ---------- Markdown ---------- */
let markedMod = null;
export async function openMarkdown(file, title) {
  openModal(title || file.name);
  showLoader();
  state.mode = "html";
  try {
    if (!markedMod) markedMod = await import("../vendor/marked.esm.js");
    const src = await readTextSmart(file);
    const html = markedMod.marked.parse(src, { async: false, breaks: false, gfm: true });
    body().innerHTML = `<div class="ebook-doc markdown-doc">${sanitizeHTML(html)}</div>`;
    soloLectura();
  } catch (e) {
    // Si marked falla por lo que sea, al menos mostramos el texto crudo.
    console.warn("Markdown:", e.message);
    return openText(file, title);
  }
}

/* ---------- Imágenes / páginas de cómic (carga perezosa) ----------
   `pages` acepta { name, url } (ya resuelto) o { name, get: async () => url }
   para extraer del comprimido solo la página que se está viendo. */
const PAGE_CACHE = 8; // páginas resueltas que se mantienen en memoria
export async function openImages(pages, title) {
  openModal(title);
  state.mode = "images";
  state.docKey = `img:${title}`;
  state.images = pages;
  state.imgZoom = 1;
  state.imgIndex = Math.min(leerProgreso(state.docKey)?.index || 0, Math.max(0, pages.length - 1));
  try { state.webtoon = localStorage.getItem("anilector.webtoon") === "1"; } catch (_) { state.webtoon = false; }
  addWebtoonToggle();
  ajustarBotonGuardar();
  ajustarBotonBuscar();
  ajustarBotonMarcas();
  if (state.webtoon) return renderWebtoon();
  body().innerHTML = "";
  const img = document.createElement("img");
  img.className = "page-img";
  img.alt = "";
  body().appendChild(img);
  await renderImage();
}

/* Guarda las páginas abiertas como un CBZ para leerlo sin conexión.
   Un CBZ es un ZIP de imágenes numeradas: con JSZip (ya cargado) se
   arma en el navegador, sin subir nada a ningún sitio. */
function nombreLimpio() {
  return (titleEl().textContent || "manga").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

/* Arma el CBZ y devuelve el Blob. Se separó de la descarga porque
   ahora hay dos destinos: tu disco (💾) y las descargas de la app (📥). */
async function armarCBZ(alProgreso) {
  if (!window.JSZip) throw new Error("JSZip");
  const zip = new window.JSZip();
  const total = state.images.length;
  const ancho = String(total).length;
  for (let i = 0; i < total; i++) {
    alProgreso?.(`${i + 1}/${total}`);
    const url = await resolvePage(state.images[i]);
    const blob = await (await fetch(url)).blob();
    const ext = (state.images[i].name?.match(/\.(\w+)$/)?.[1] || "jpg").toLowerCase();
    zip.file(`${String(i + 1).padStart(ancho, "0")}.${ext}`, blob);
  }
  alProgreso?.("⏳");
  return zip.generateAsync({ type: "blob" });
}

/* Envuelve una tarea larga de un botón: lo bloquea, enseña el avance
   y siempre lo deja como estaba, salga bien o mal. */
async function conBoton(id, tarea) {
  const btn = document.getElementById(id);
  if (!btn || btn.dataset.busy) return;
  const original = btn.textContent;
  btn.dataset.busy = "1";
  try {
    await tarea((txt) => { btn.textContent = txt; });
  } finally {
    btn.textContent = original;
    delete btn.dataset.busy;
  }
}

async function descargarCBZ() {
  return conBoton("vSave", async (avisar) => {
    try {
      const out = await armarCBZ(avisar);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(out);
      a.download = `${nombreLimpio()}.cbz`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      console.warn("CBZ:", e.message);
      toastVisor(t("reader.saveFailed"));
    }
  });
}

/* ---------- guardar en la app (Mis descargas) ---------- */
/* Un cómic cuyas páginas viven en internet se empaqueta como CBZ; el
   resto se guarda tal cual, que ya es un archivo. */
async function guardarEnLaApp() {
  return conBoton("vKeep", async (avisar) => {
    try {
      let archivo = state.archivoOrigen;
      if (!archivo && state.mode === "images" && state.images.length) {
        const blob = await armarCBZ(avisar);
        archivo = new File([blob], `${nombreLimpio()}.cbz`, { type: "application/zip" });
      }
      if (!archivo) return toastVisor(t("reader.keepUnsupported"));

      avisar("⏳");
      await DOCS.guardar(archivo, { titulo: titleEl().textContent || archivo.name });
      DOCS.pedirPersistencia();           // que el navegador no lo borre por falta de sitio
      marcarGuardado(true);
      toastVisor(t("reader.keptOk"));
      window.dispatchEvent(new Event("anilector:descargas"));
    } catch (e) {
      console.warn("Guardar en la app:", e.name, e.message);
      toastVisor(/quota/i.test(e.name + e.message)
        ? t("reader.keepNoRoom") : t("reader.keepFailed"));
    }
  });
}

function marcarGuardado(si) {
  const b = document.getElementById("vKeep");
  if (!b) return;
  b.classList.toggle("activo", !!si);
  b.title = si ? t("reader.keptTitle") : t("reader.keep");
}

/* El botón solo aparece si hay algo que guardar y dónde guardarlo, y
   se marca si ese documento ya está descargado. */
async function ajustarBotonGuardar() {
  const b = document.getElementById("vKeep");
  if (!b) return;
  const puede = DOCS.hayAlmacen() &&
    (!!state.archivoOrigen || (state.mode === "images" && state.images.length > 0));
  b.style.display = puede ? "" : "none";
  if (!puede) return;
  const f = state.archivoOrigen;
  marcarGuardado(f ? await DOCS.existe(f.name, f.size) : false);
}

/* Aviso corto dentro del visor: `alert()` bloquea la pestaña entera y
   en una app instalada queda especialmente mal. */
function toastVisor(msg) {
  quitarLoaderFlotante();
  const el = document.createElement("div");
  el.id = "vJumping";
  el.className = "jump-toast";
  el.textContent = msg;
  body().appendChild(el);
  setTimeout(() => { if (document.getElementById("vJumping") === el) el.remove(); }, 3500);
}

/* Modo lectura nocturna: baja el brillo y calienta el tono. Es un
   filtro CSS sobre las páginas, no toca los archivos. */
function aplicarNoche() {
  document.getElementById("viewerBody")?.classList.toggle("night", !!state.night);
  const b = document.getElementById("vNight");
  if (b) b.textContent = state.night ? "🌙" : "☀️";
}
function toggleNoche() {
  state.night = !state.night;
  try { localStorage.setItem("anilector.readNight", state.night ? "1" : "0"); } catch (_) {}
  aplicarNoche();
}

/* Botón para alternar entre página a página y tira vertical. */
function addWebtoonToggle() {
  document.getElementById("vWebtoon")?.remove();
  const btn = document.createElement("button");
  btn.id = "vWebtoon";
  btn.className = "btn btn-ghost";
  btn.title = t("reader.webtoon");
  btn.textContent = state.webtoon ? "📜" : "📄";
  btn.addEventListener("click", () => {
    state.webtoon = !state.webtoon;
    try { localStorage.setItem("anilector.webtoon", state.webtoon ? "1" : "0"); } catch (_) {}
    btn.textContent = state.webtoon ? "📜" : "📄";
    if (state.webtoon) renderWebtoon();
    else {
      body().innerHTML = "";
      const img = document.createElement("img");
      img.className = "page-img";
      body().appendChild(img);
      renderImage();
    }
  });
  controls().insertBefore(btn, document.getElementById("vZoomOut"));

  // Guardar como CBZ (solo si las páginas vienen de un comprimido)
  document.getElementById("vSave")?.remove();
  if (state.images.some((p) => typeof p.get === "function")) {
    const save = document.createElement("button");
    save.id = "vSave";
    save.className = "btn btn-ghost";
    save.title = t("reader.saveCbz");
    save.textContent = "💾";
    save.addEventListener("click", descargarCBZ);
    controls().insertBefore(save, document.getElementById("vZoomOut"));
  }

  // Lectura nocturna
  document.getElementById("vNight")?.remove();
  const night = document.createElement("button");
  night.id = "vNight";
  night.className = "btn btn-ghost";
  night.title = t("reader.night");
  night.addEventListener("click", toggleNoche);
  controls().insertBefore(night, document.getElementById("vZoomOut"));
  try { state.night = localStorage.getItem("anilector.readNight") === "1"; } catch (_) {}
  aplicarNoche();
}

/* Tira vertical continua (estilo webtoon). Las páginas se cargan según
   se acercan a la pantalla, así una obra de 200 páginas abre igual de
   rápido que una de 10. */
function renderWebtoon() {
  const idx0 = state.imgIndex;
  body().innerHTML = `<div class="webtoon" id="webtoonStrip"></div>`;
  const strip = document.getElementById("webtoonStrip");
  strip.innerHTML = state.images.map((p, i) =>
    `<div class="webtoon-page" data-i="${i}"><span class="webtoon-num">${i + 1}</span></div>`).join("");

  const cargar = (slot) => {
    const i = Number(slot.dataset.i);
    if (slot.dataset.done) return;
    slot.dataset.done = "1";
    resolvePage(state.images[i]).then((url) => {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = url;
      slot.appendChild(img);
    }).catch(() => {
      slot.dataset.done = "";
      slot.classList.add("failed");
    });
  };

  const io = new IntersectionObserver((ents) => {
    for (const e of ents) {
      if (e.isIntersecting) {
        cargar(e.target);
        // La página más visible define dónde te quedaste.
        const i = Number(e.target.dataset.i);
        if (e.intersectionRatio > 0.5 && i !== state.imgIndex) {
          state.imgIndex = i;
          pageInfo().textContent = `${i + 1} / ${state.images.length}`;
          saveProgress(state.docKey, { index: i });
        }
      }
    }
  }, { root: body(), rootMargin: "800px 0px", threshold: [0, 0.51] });
  strip.querySelectorAll(".webtoon-page").forEach((s) => io.observe(s));

  pageInfo().textContent = `${idx0 + 1} / ${state.images.length}`;
  // Retomar donde se quedó
  const destino = strip.querySelector(`.webtoon-page[data-i="${idx0}"]`);
  if (destino) setTimeout(() => destino.scrollIntoView({ block: "start" }), 60);
}

async function resolvePage(p) {
  if (p.url) return p.url;
  if (!p._pending) {
    p._pending = Promise.resolve()
      .then(() => p.get())
      .then((u) => { p._url = trackUrl(u); return u; })
      .catch((e) => { p._pending = null; throw e; });
  }
  return p._pending;
}
function trimPageCache() {
  state.images.forEach((p, i) => {
    if (!p._url) return;
    if (Math.abs(i - state.imgIndex) > PAGE_CACHE) {
      dropUrl(p._url);
      p._url = null;
      p._pending = null;
    }
  });
}
async function renderImage() {
  const img = body().querySelector("img.page-img");
  if (!img || !state.images.length) return;
  const idx = state.imgIndex;
  const p = state.images[idx];
  pageInfo().textContent = `${idx + 1} / ${state.images.length}`;
  pageInfo().title = t("reader.goToPage");
  saveProgress(state.docKey, { index: idx });
  try {
    const url = await resolvePage(p);
    if (state.imgIndex !== idx || state.mode !== "images") return; // el usuario ya pasó de página
    img.src = url;
    img.style.display = "";
    aplicarZoomImagen();
    body().querySelector(".page-error")?.remove();
  } catch (e) {
    console.warn("Página:", e.message);
    if (state.imgIndex !== idx) return;
    // Que no se quede en blanco sin explicación.
    img.removeAttribute("src");
    img.style.display = "none";
    if (!body().querySelector(".page-error")) {
      const box = document.createElement("div");
      box.className = "iframe-fallback page-error";
      box.innerHTML = `<p>⚠️ ${t("reader.pageFailed")}</p>`;
      body().appendChild(box);
    }
  }
  // precarga de la siguiente y limpieza de las lejanas
  const next = state.images[idx + 1];
  if (next && !next.url) resolvePage(next).catch(() => {});
  trimPageCache();
}

/* ---------- Comprimidos ---------- */
let archiveLib = null;
async function loadArchiveLib() {
  if (!archiveLib) {
    const mod = await import("../vendor/libarchive/libarchive.js");
    mod.Archive.init({
      // Mismo origen obligatorio: los navegadores no permiten Workers de otro dominio.
      workerUrl: new URL("../vendor/libarchive/worker-bundle.js", import.meta.url).href,
    });
    archiveLib = mod.Archive;
  }
  return archiveLib;
}

/* Pide una contraseña dentro del visor. Devuelve string o null si cancela. */
function askPassword(name, wrong = false) {
  return new Promise((resolve) => {
    body().innerHTML = `
      <form class="pw-form" id="pwForm">
        <div class="pw-icon">${wrong ? "⚠️" : "🔒"}</div>
        <p${wrong ? ' class="pw-wrong"' : ""}>${wrong ? t("reader.pwWrong") : t("reader.pwPrompt")}</p>
        <div class="pw-file">${esc(name)}</div>
        <input id="pwInput" type="password" autocomplete="off" placeholder="${t("reader.pwPlaceholder")}" />
        <div class="pw-actions">
          <button class="btn btn-primary" type="submit">${t("reader.pwOpen")}</button>
          <button class="btn btn-ghost" type="button" id="pwCancel">${t("reader.pwCancel")}</button>
        </div>
      </form>`;
    const form = document.getElementById("pwForm");
    const input = document.getElementById("pwInput");
    input.focus();
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      resolve(input.value || "");
    });
    document.getElementById("pwCancel").addEventListener("click", () => resolve(null));
  });
}

/* Abre un comprimido y devuelve una lista de entradas perezosas:
   [{ name, size, getBlob() }]  — sin extraer nada todavía. */
async function listArchive(file) {
  const name = file.name.toLowerCase();

  // ZIP/CBZ: JSZip ya está cargado y es más rápido. Si falla (AES,
  // ZIP64 raro, cifrado), se reintenta con libarchive más abajo.
  if (RE_ZIP.test(name)) {
    try {
      const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
      const entries = Object.keys(zip.files)
        .filter((n) => !zip.files[n].dir)
        .sort(naturalSort)
        .map((n) => ({
          name: n,
          size: zip.files[n]._data?.uncompressedSize ?? null,
          getBlob: () => zip.files[n].async("blob"),
        }));
      if (entries.length) return { entries, close: () => {} };
    } catch (e) {
      console.warn("JSZip falló, probando libarchive:", e.message);
    }
  }

  const Archive = await loadArchiveLib();
  // Cerrar un comprimido anterior antes de abrir otro (cada uno usa un Worker).
  if (state.archive?.close) { try { state.archive.close(); } catch (_) {} }
  const archive = await Archive.open(file);
  state.archive = archive;

  /* ¿Viene cifrado? `hasEncryptedData()` puede devolver null (indeterminado),
     y con las CABECERAS cifradas (rar -hp, 7z -mhe) ni siquiera se puede
     listar: devuelve una lista vacía en vez de fallar.

     LÍMITE REAL de este build de libarchive (comprobado con archivos de
     prueba): solo sabe DESCIFRAR ZIP. En RAR y 7z protegidos consigue
     listar los nombres pero al extraer devuelve "not supported" o un error
     de checksum. Por eso, en cuanto detectamos cifrado en rar/7z se avisa
     con claridad en lugar de pedir una contraseña que no serviría. */
  const fmt = /\.(cbr|rar)$/i.test(name) ? "RAR" : /\.(cb7|7z)$/i.test(name) ? "7z" : null;
  const cryptoUnsupported = () => {
    try { archive.close(); } catch (_) {}
    state.archive = null;
    const err = new Error(t("reader.cryptoUnsupported").replace("%s", fmt || "?"));
    err.code = "crypto-unsupported";
    return err;
  };

  let declared = null;
  try { declared = await archive.hasEncryptedData(); } catch (_) {}
  if (declared === true && fmt) throw cryptoUnsupported();

  const giveUp = () => { try { archive.close(); } catch (_) {} state.archive = null; return null; };
  const build = (arr) => arr
    .map(({ file: f, path }) => ({
      name: `${path || ""}${f.name}`,
      size: f.size ?? null,
      getBlob: () => f.extract(),
    }))
    .sort((a, b) => naturalSort(a.name, b.name));

  let gavePassword = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt === 0 ? declared === true : true) {
      const pw = await askPassword(file.name, gavePassword);
      if (pw === null) return giveUp();
      await archive.usePassword(pw);
      gavePassword = true;
      showLoader();
    }

    let arr = null;
    try { arr = await archive.getFilesArray(); } catch (_) { arr = null; }

    if (!arr || !arr.length) {
      // rar/7z que no lista nada = cabeceras cifradas → no soportado.
      if (fmt) throw cryptoUnsupported();
      if (!gavePassword && attempt < 2) continue;      // zip raro: probar clave
      return { entries: [], close: () => { try { archive.close(); } catch (_) {} } };
    }

    const entries = build(arr);
    try {
      // Prueba real: listar puede funcionar aunque no se pueda descifrar.
      await entries[0].getBlob();
      return { entries, close: () => { try { archive.close(); } catch (_) {} } };
    } catch (e) {
      if (fmt && /encrypt|support|checksum|crc|password/i.test(e.message))
        throw cryptoUnsupported();
      if (attempt === 2) throw e;                      // error real, no de clave
      // ZIP con clave equivocada → se vuelve a pedir en la siguiente vuelta.
    }
  }
  return giveUp();
}

/* Punto de entrada para cualquier comprimido. Si dentro hay imágenes se
   abre como cómic; si hay un solo documento, se abre ése; si es una mezcla,
   se muestra el contenido para elegir. */
export async function openComicArchive(file, title) {
  openModal(title || file.name, { showControls: false });
  showLoader(t("reader.openingArchive"));

  let listed;
  try {
    listed = await listArchive(file);
  } catch (e) {
    console.warn("Comprimido:", e);
    if (e.code === "crypto-unsupported") {
      body().innerHTML = `
        <div class="iframe-fallback share-help">
          <p class="share-title">🔒 ${t("reader.cryptoTitle")}</p>
          <p>${esc(e.message)}</p>
          <ol class="share-steps">
            <li>${t("reader.cryptoStep1")}</li>
            <li>${t("reader.cryptoStep2")}</li>
          </ol>
        </div>`;
      return;
    }
    return showError(`${t("reader.archiveError")} (${e.message})`);
  }
  if (!listed) return closeViewer();          // el usuario canceló la contraseña
  const { entries } = listed;
  if (!entries.length) return showError(t("reader.emptyArchive"));

  const images = entries.filter((e) => RE_IMAGE.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name));
  const docs = entries.filter((e) => RE_PDF.test(e.name) || RE_EPUB.test(e.name) || RE_MOBI.test(e.name));

  // Caso manga: mayoría imágenes → lector de páginas con carga perezosa.
  if (images.length && images.length >= entries.length - docs.length) {
    const pages = images.map((e) => ({
      name: e.name,
      get: async () => URL.createObjectURL(await e.getBlob()),
    }));
    await openImages(pages, title || file.name);
    if (entries.length > images.length) addArchiveBrowserButton(entries, file.name);
    return;
  }

  // Un único documento dentro: abrirlo directo.
  if (docs.length === 1 && entries.length <= 3) {
    return openEntry(docs[0]);
  }

  // Mezcla: mostrar el contenido.
  return renderArchiveList(entries, title || file.name);
}

async function openEntry(entry) {
  showLoader(entry.name);
  const blob = await entry.getBlob();
  const base = entry.name.split("/").pop() || entry.name;
  return openLocalFile(new File([blob], base, { type: blob.type || "" }));
}

function renderArchiveList(entries, title) {
  state.mode = "list";
  titleEl().textContent = title;
  controls().style.display = "none";
  body().innerHTML = `
    <div class="arch-wrap">
      <p class="arch-head">📦 ${entries.length} ${t("reader.archiveItems")}</p>
      <ol class="arch-list">
        ${entries.map((e, i) => `
          <li class="arch-item" data-i="${i}">
            <span class="arch-icon">${entryIcon(e.name)}</span>
            <span class="arch-name">${esc(e.name)}</span>
            <span class="arch-size">${esc(humanSize(e.size))}</span>
          </li>`).join("")}
      </ol>
    </div>`;
  body().querySelectorAll(".arch-item").forEach((li) =>
    li.addEventListener("click", async () => {
      const e = entries[Number(li.dataset.i)];
      try { await openEntry(e); }
      catch (err) { showError(err.message); }
    }));
}
function entryIcon(name) {
  if (RE_IMAGE.test(name)) return "🖼️";
  if (RE_PDF.test(name)) return "📕";
  if (RE_EPUB.test(name) || RE_MOBI.test(name)) return "📗";
  if (RE_MD.test(name) || RE_TEXT.test(name)) return "📄";
  if (RE_ZIP.test(name) || RE_ARCH.test(name)) return "📦";
  return "📎";
}
function addArchiveBrowserButton(entries, title) {
  const btn = document.createElement("button");
  btn.className = "btn btn-ghost arch-toggle";
  btn.textContent = `📦 ${t("reader.seeContents")}`;
  btn.addEventListener("click", () => renderArchiveList(entries, title));
  body().appendChild(btn);
}

/* ---------- Texto ---------- */
export async function openText(file, title) {
  openModal(title || file.name);
  state.mode = "text";
  const div = document.createElement("div");
  div.className = "text-doc";
  div.textContent = await readTextSmart(file);
  body().innerHTML = "";
  body().appendChild(div);
  soloLectura();
}

/* Documento de una sola tira: no hay páginas que pasar, pero sí tamaño de
   letra que ajustar. Antes se ocultaba la barra entera y por eso los
   ➖/➕ nunca llegaban a usarse en texto ni en Markdown. */
function soloLectura() {
  controls().style.display = "";
  document.getElementById("vPrev").style.display = "none";
  document.getElementById("vNext").style.display = "none";
  pageInfo().textContent = "";
  ajustarBotonTipo();
  ajustarBotonTr();
  ajustarBotonGuardar();
  ajustarBotonBuscar();
  ajustarBotonMarcas();
  aplicarTipo();
}

/* ¿Este sitio prohíbe mostrarse dentro de otra página? */
export function blocksEmbedding(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return (NO_EMBED_SITES || []).some((d) => host === d || host.endsWith(`.${d}`));
  } catch (_) { return false; }
}

/* Aviso para los sitios que no se dejan embeber: mejor decirlo de frente
   que enseñar un recuadro en blanco que nunca va a cargar. */
function showNoEmbed(url, title) {
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch (_) {}
  openModal(title || host, { showControls: false, external: url });
  state.mode = "text";
  body().innerHTML = `
    <div class="iframe-fallback share-help">
      <p class="share-title">🚫 ${t("reader.noEmbedTitle")}</p>
      <p>${t("reader.noEmbedBody").replace("%s", esc(host))}</p>
      <a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener">${t("reader.openTab")}</a>
    </div>`;
}

/* ---------- Iframe (páginas / lectores externos) ---------- */
export function openIframe(url, title, { hint = true, force = false } = {}) {
  if (!force && blocksEmbedding(url)) return showNoEmbed(url, title);
  openModal(title || url, { showControls: false, external: url });
  state.mode = "iframe";
  const wrap = document.createElement("div");
  wrap.className = "iframe-wrap";
  if (hint) {
    // Muchos sitios bloquean la vista integrada (X-Frame-Options) y no hay
    // evento fiable para detectarlo: mostramos una barra de ayuda permanente.
    const bar = document.createElement("div");
    bar.className = "viewer-hint";
    bar.innerHTML = `<span>${t("reader.embedHint")}</span>
      <a class="btn btn-primary btn-mini" href="${esc(url)}" target="_blank" rel="noopener">${t("reader.openTab")}</a>`;
    wrap.appendChild(bar);
  }
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.allow = "fullscreen; autoplay";
  frame.referrerPolicy = "no-referrer";
  wrap.appendChild(frame);
  body().appendChild(wrap);
}

/* ---------- Lector embebido de Google Books ---------- */
let gbApiReady = null;
function loadGoogleBooksApi() {
  if (gbApiReady) return gbApiReady;
  gbApiReady = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://www.google.com/books/jsapi.js";
    s.onload = () => {
      try {
        window.google.books.load();
        window.google.books.setOnLoadCallback(() => resolve());
      } catch (e) { reject(e); }
    };
    s.onerror = () => reject(new Error("Google Books API"));
    document.head.appendChild(s);
  });
  return gbApiReady;
}

export async function openGoogleBook({ volumeId, isbn, previewUrl }, title) {
  openModal(title, { showControls: false, external: previewUrl || null });
  state.mode = "iframe";
  const holder = document.createElement("div");
  holder.id = "gbViewer";
  holder.style.cssText = "width:100%;height:100%;background:#fff;border-radius:8px;";
  body().appendChild(holder);
  const fallback = () => {
    body().innerHTML = `<div class="iframe-fallback"><p>${t("reader.iframeBlocked")}</p>
      ${previewUrl ? `<a class="btn btn-primary" href="${esc(previewUrl)}" target="_blank" rel="noopener">${t("reader.openTab")}</a>` : ""}</div>`;
  };
  try {
    await loadGoogleBooksApi();
    const viewer = new window.google.books.DefaultViewer(holder);
    const ids = [];
    if (volumeId) ids.push(volumeId);
    if (isbn) ids.push(`ISBN:${isbn}`);
    const tryLoad = (i) => {
      if (i >= ids.length) return fallback();
      viewer.load(ids[i], () => tryLoad(i + 1));
    };
    tryLoad(0);
  } catch (e) { fallback(); }
}

/* ---------- Router de archivos locales ---------- */
export async function openLocalFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;

  // Varias imágenes seleccionadas → galería ordenada naturalmente.
  const images = files.filter((f) => RE_IMAGE.test(f.name) || /^image\//.test(f.type));
  if (images.length > 1 && images.length === files.length) {
    const pages = images
      .sort((a, b) => naturalSort(a.name, b.name))
      .map((f) => ({ name: f.name, url: trackUrl(URL.createObjectURL(f)) }));
    return openImages(pages, `${images.length} ${t("reader.imagesLabel")}`);
  }
  return openLocalFile(files[0]);
}

export async function openLocalFile(f) {
  /* Se recuerda el archivo para poder guardarlo con 📥 sin volver a
     pedírselo al usuario ni a la red. Se deja «pendiente» y lo recoge
     openModal: así un capítulo de MangaDex, que llega por otro camino,
     no hereda por error el archivo del documento anterior. */
  origenPendiente = f;
  const name = (f.name || "").toLowerCase();
  if (RE_PDF.test(name) || f.type === "application/pdf") return openPdf(f, f.name);
  if (RE_EPUB.test(name)) return openEpub(f, f.name);
  if (RE_MOBI.test(name)) return openMobi(f, f.name);
  if (RE_ZIP.test(name) || RE_ARCH.test(name)) return openComicArchive(f, f.name);
  if (RE_IMAGE.test(name) || /^image\//.test(f.type))
    return openImages([{ name: f.name, url: trackUrl(URL.createObjectURL(f)) }], f.name);
  if (RE_MD.test(name)) return openMarkdown(f, f.name);
  if (RE_TEXT.test(name) || /^text\//.test(f.type)) return openText(f, f.name);
  // Sin extensión reconocida: mirar los primeros bytes.
  const kind = await sniffKind(f);
  if (kind === "pdf") return openPdf(f, f.name);
  if (kind === "epub") return openEpub(f, f.name);
  if (kind === "mobi") return openMobi(f, f.name);
  if (kind === "zip" || kind === "archive") return openComicArchive(f, f.name);
  if (kind === "image") return openImages([{ name: f.name, url: trackUrl(URL.createObjectURL(f)) }], f.name);
  if (kind === "text") return openText(f, f.name);
  throw new Error(t("reader.unsupported"));
}

/* Detección por "números mágicos" para archivos sin extensión útil. */
async function sniffKind(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 68).arrayBuffer());
    const ascii = (from, len) => String.fromCharCode(...head.slice(from, from + len));
    if (ascii(0, 4) === "%PDF") return "pdf";
    if (ascii(0, 4) === "Rar!") return "archive";
    if (head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf) return "archive";
    if (head[0] === 0x1f && head[1] === 0x8b) return "archive";               // gzip
    if (ascii(0, 5) === "ustar" || ascii(257, 5) === "ustar") return "archive";
    if (ascii(60, 8) === "BOOKMOBI") return "mobi";
    if (head[0] === 0x50 && head[1] === 0x4b) {                                // PK.. (zip/epub)
      const probe = String.fromCharCode(...new Uint8Array(await file.slice(0, 120).arrayBuffer()));
      return probe.includes("mimetypeapplication/epub") ? "epub" : "zip";
    }
    if (head[0] === 0xff && head[1] === 0xd8) return "image";                  // jpeg
    if (head[0] === 0x89 && ascii(1, 3) === "PNG") return "image";
    if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image";
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image";
    // ¿Texto plano? Sin bytes de control raros en los primeros 64.
    const printable = head.every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b !== 127));
    if (printable) return "text";
  } catch (_) {}
  return null;
}

/* ---------- Archivos desde un enlace ---------- */

/* Convierte enlaces de "página de descarga" conocidos en enlace directo. */
export function normalizeFileUrl(raw) {
  let url = String(raw || "").trim();
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    // Google Drive: /file/d/<ID>/view  →  descarga directa
    if (host === "drive.google.com") {
      const id = u.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || u.searchParams.get("id");
      if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
    }
    // Dropbox: ?dl=0 → ?dl=1
    if (host.endsWith("dropbox.com")) {
      u.searchParams.set("dl", "1");
      return u.toString();
    }
    // GitHub: blob → raw
    if (host === "github.com" && u.pathname.includes("/blob/"))
      return url.replace("//github.com/", "//raw.githubusercontent.com/").replace("/blob/", "/");
  } catch (_) {}
  return url;
}

/* Sitios que comparten mediante una PÁGINA, no un archivo directo. */
const SHARE_PAGES = /(^|\.)(terabox|1024terabox|teraboxapp|4funbox|mirrobox|nephobox|momerybox|dubox|mega|mediafire|1fichier|zippyshare|anonfiles|gofile|pixeldrain|krakenfiles|sendspace)\./i;
function isSharePage(url) {
  try { return SHARE_PAGES.test(new URL(url).hostname); } catch (_) { return false; }
}

/* URL a través del proxy (evita el bloqueo CORS del navegador).
   Misma prioridad que en TV: proxy propio del usuario → servidor local
   (server.mjs, sin límite de tamaño) → microservicio en Vercel. */
const isLocalHost = ["localhost", "127.0.0.1"].includes(location.hostname) ||
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
function proxyBase() {
  try {
    const own = (localStorage.getItem("anilector.proxyurl") || "").trim().replace(/\/$/, "");
    if (own) return own;
  } catch (_) {}
  if (isLocalHost) return "";                       // el propio servidor local
  return (BACKEND_URL || "").replace(/\/$/, "");
}
export function proxiedUrl(url) {
  const base = proxyBase();
  if (!base && !isLocalHost) return null;           // sin proxy disponible
  return `${base}/api/file?url=${encodeURIComponent(url)}`;
}

export function openUrl(rawUrl, title) {
  const url = normalizeFileUrl(rawUrl);
  const clean = url.split(/[?#]/)[0];
  const guessed = decodeURIComponent(clean.split("/").pop() || "") || "archivo";

  if (isSharePage(url)) return showSharePageHelp(url, title);
  if (RE_PDF.test(clean)) return openPdf(url, title || guessed);
  if (RE_FILEY.test(clean)) return openRemoteFile(url, title || guessed);
  return openIframe(url, title);
}

/* Explica por qué un enlace de Terabox/Mega/etc. no es un archivo. */
function showSharePageHelp(url, title) {
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch (_) {}
  openModal(title || host, { showControls: false, external: url });
  state.mode = "text";
  body().innerHTML = `
    <div class="iframe-fallback share-help">
      <p class="share-title">🔗 ${t("reader.sharePageTitle")}</p>
      <p>${t("reader.sharePageBody").replace("%s", esc(host))}</p>
      <ol class="share-steps">
        <li>${t("reader.shareStep1")}</li>
        <li>${t("reader.shareStep2")}</li>
        <li>${t("reader.shareStep3")}</li>
      </ol>
      <a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener">${t("reader.openTab")}</a>
    </div>`;
}

/* Descarga el archivo (directo si CORS lo permite; si no, por el proxy)
   y lo abre con el visor que corresponda. */
export async function openRemoteFile(url, title, { fileName = null } = {}) {
  openModal(title || url, { showControls: false, external: url });
  showLoader(t("reader.downloading"));

  const reintentar = () => openRemoteFile(url, title, { fileName });
  const fetchWith = async (target) => {
    const res = await fetchConLimite(target, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  };

  let res;
  try {
    res = await fetchWith(url);                     // directo (si el servidor manda CORS)
  } catch (e1) {
    const prox = proxiedUrl(url);
    if (!prox) return showError(t("reader.corsBlocked"), url, reintentar);
    try { res = await fetchWith(prox); }
    catch (e2) { return showError(`${t("reader.downloadFailed")} (${e2.message})`, url, reintentar); }
  }

  // Si nos devolvieron una página HTML, no era un archivo directo.
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (ctype.includes("text/html") && !/\.html?$/i.test(url.split(/[?#]/)[0]))
    return showSharePageHelp(url, title);

  try {
    const blob = await res.blob();
    // `fileName` permite forzar la extensión cuando la URL no la trae
    // (p. ej. los EPUB de Gutenberg acaban en ".epub3.images").
    const name = fileName ||
      decodeURIComponent((url.split(/[?#]/)[0].split("/").pop() || "archivo"));
    return await openLocalFile(new File([blob], name, { type: blob.type }));
  } catch (e) {
    return showError(`${t("reader.downloadFailed")} (${e.message})`, url, reintentar);
  }
}

/* ---------- Controles ---------- */
export function bindViewerControls() {
  document.getElementById("vPrev").addEventListener("click", () => nav(-1));
  document.getElementById("vNext").addEventListener("click", () => nav(1));
  document.getElementById("vZoomIn").addEventListener("click", () => zoomBy(0.2));
  document.getElementById("vZoomOut").addEventListener("click", () => zoomBy(-0.2));
  document.getElementById("vToc")?.addEventListener("click", alternarPanelIndice);
  document.getElementById("vType")?.addEventListener("click", alternarPanelTipo);
  document.getElementById("vBusca")?.addEventListener("click", alternarPanelBuscar);
  document.getElementById("vMarcas")?.addEventListener("click", alternarPanelMarcas);
  // El puente que el buscador necesita del visor.
  BUSCA.initBuscar({
    estado: state,
    cuerpo: body,
    cargarTodo: (p, s2) => state.cargarTodo?.(p, s2),
  });
  document.getElementById("vTr")?.addEventListener("click", alternarPanelTr);
  document.getElementById("vKeep")?.addEventListener("click", guardarEnLaApp);
  document.getElementById("vTrPanel")?.addEventListener("click", (e) => {
    if (e.target.id !== "vTrGo") return;
    if (state.trOn) volverAlOriginal();
    else traducirDocumento();
  });

  // Saltar a una página escribiendo el número (PDF y cómics).
  pageInfo().addEventListener("click", pedirPagina);

  // Pellizco / Ctrl+rueda sobre el documento (el EPUB se engancha aparte,
  // dentro de su iframe, al abrirlo).
  activarGestosZoom(document);

  document.getElementById("vTocPanel")?.addEventListener("click", (e) => {
    const b = e.target.closest(".toc-item");
    if (!b) return;
    cerrarPaneles();
    state.toc[Number(b.dataset.i)]?.ir();
  });
  document.getElementById("vTypePanel")?.addEventListener("click", (e) => {
    if (e.target.id === "vTypeReset") {
      state.tipo = { ...TIPO_DEF };
      guardarTipo(); aplicarTipo(); pintarPanelTipo();
      return;
    }
    const b = e.target.closest("[data-tipo]");
    if (b) cambiarTipo(b.dataset.tipo, Number(b.dataset.d));
  });

  document.addEventListener("keydown", (e) => {
    if (modal().classList.contains("hidden")) return;
    if (e.target.matches("input, textarea")) return;   // no robar teclas al campo de contraseña
    if (e.key === "ArrowLeft") nav(-1);
    if (e.key === "ArrowRight") nav(1);
    if (e.key === "Escape") {
      // Primero cierra el panel abierto; solo si no hay ninguno, el visor.
      const abierto = ["vTocPanel", "vTypePanel"]
        .some((id) => !document.getElementById(id)?.classList.contains("hidden"));
      if (abierto) cerrarPaneles();
      else closeViewer();
    }
  });
}

/* Escribir el número de página en vez de pulsar ▶ cien veces. */
function pedirPagina() {
  const total = state.mode === "pdf" ? state.pdf?.numPages
    : state.mode === "images" ? state.images.length : 0;
  if (!total || pageInfo().querySelector("input")) return;
  const actual = state.mode === "pdf" ? state.page : state.imgIndex + 1;
  const previo = pageInfo().textContent;
  pageInfo().innerHTML =
    `<input id="vGoto" class="goto-input" type="number" min="1" max="${total}" value="${actual}" />`;
  const inp = document.getElementById("vGoto");
  inp.focus();
  inp.select();

  let cerrado = false;
  const cerrar = (aplicar) => {
    if (cerrado) return;
    cerrado = true;
    const n = Math.min(total, Math.max(1, parseInt(inp.value, 10) || actual));
    pageInfo().textContent = previo;
    if (!aplicar || n === actual) return;
    if (state.mode === "pdf") { state.page = n; renderPdfPage(); }
    else {
      state.imgIndex = n - 1;
      if (state.webtoon) {
        document.querySelector(`.webtoon-page[data-i="${n - 1}"]`)?.scrollIntoView({ block: "start" });
        pageInfo().textContent = `${n} / ${total}`;
        saveProgress(state.docKey, { index: n - 1 });
      } else renderImage();
    }
  };
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") cerrar(true);
    if (e.key === "Escape") cerrar(false);
  });
  inp.addEventListener("blur", () => cerrar(true));
}
function nav(dir) {
  if (state.mode === "pdf" && state.pdf) {
    const next = state.page + dir;
    if (next >= 1 && next <= state.pdf.numPages) { state.page = next; renderPdfPage(); }
  } else if (state.mode === "images") {
    const next = state.imgIndex + dir;
    if (next < 0 || next >= state.images.length) return;
    state.imgIndex = next;
    if (state.webtoon) {
      document.querySelector(`.webtoon-page[data-i="${next}"]`)?.scrollIntoView({ block: "start" });
      pageInfo().textContent = `${next + 1} / ${state.images.length}`;
      saveProgress(state.docKey, { index: next });
    } else renderImage();
  } else if (state.mode === "epub" && state.epubRendition) {
    dir > 0 ? state.epubRendition.next() : state.epubRendition.prev();
  }
}
function zoomBy(d) {
  if (state.mode === "pdf" && state.pdf) {
    state.zoom = Math.min(3, Math.max(0.4, state.zoom + d));
    renderPdfPage();
  } else if (state.mode === "images") {
    // El zoom vive en el estado, no en el <img>: antes se perdía en cuanto
    // pasabas de página, porque renderImage() crea el elemento de nuevo.
    state.imgZoom = Math.min(3, Math.max(0.4, state.imgZoom + d));
    aplicarZoomImagen();
  } else if (MODOS_TEXTO.includes(state.mode)) {
    // Los ➖/➕ mueven el tamaño de la tipografía, EPUB incluido (antes esta
    // rama no existía para EPUB y los botones no hacían nada).
    cambiarTipo("size", d > 0 ? 1 : -1);
  }
}
/* ---------- pellizco y Ctrl+rueda ----------
   Sin esto, pellizcar en el trackpad o con dos dedos agranda TODA la web
   (menús y barras incluidos), que es justo lo que no quieres leyendo. El
   pellizco del trackpad llega al navegador como una rueda con Ctrl
   pulsado; el de los dedos, como dos toques a la vez. */
const PASO_ZOOM = 0.2;
const FRENO_ZOOM = 90;      // ms entre pasos: el PDF se vuelve a dibujar en cada uno
let ultimoZoom = 0;

function enVisor() {
  return !modal()?.classList.contains("hidden");
}
function zoomFrenado(d) {
  const ahora = Date.now();
  if (ahora - ultimoZoom < FRENO_ZOOM) return;
  ultimoZoom = ahora;
  zoomBy(d);
}

export function activarGestosZoom(doc) {
  if (!doc || doc.__aniGestos) return;
  doc.__aniGestos = true;

  doc.addEventListener("wheel", (e) => {
    if (!e.ctrlKey || !enVisor()) return;
    e.preventDefault();                       // si no, el navegador hace su zoom
    zoomFrenado(e.deltaY < 0 ? PASO_ZOOM : -PASO_ZOOM);
  }, { passive: false });

  const separacion = (t) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  let base = 0;
  doc.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2 && enVisor()) base = separacion(e.touches);
  }, { passive: true });
  doc.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 2 || !base || !enVisor()) return;
    e.preventDefault();
    const ahora = separacion(e.touches);
    const razon = ahora / base;
    // Umbral generoso: un pellizco tembloroso no debe disparar diez pasos.
    if (razon > 1.15) { zoomFrenado(PASO_ZOOM); base = ahora; }
    else if (razon < 0.87) { zoomFrenado(-PASO_ZOOM); base = ahora; }
  }, { passive: false });
  doc.addEventListener("touchend", () => { base = 0; }, { passive: true });
  doc.addEventListener("touchcancel", () => { base = 0; }, { passive: true });
}

function aplicarZoomImagen() {
  const img = body().querySelector("img.page-img");
  if (!img) return;
  const z = state.imgZoom;
  img.style.maxWidth = `${z * 100}%`;
  img.style.maxHeight = z === 1 ? "100%" : "none";
}
