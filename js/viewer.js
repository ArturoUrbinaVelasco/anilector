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
  epubRendition: null,
  mobiBook: null,
  archive: null,     // handle de libarchive abierto (hay que cerrarlo)
  blobUrls: new Set(),
  docKey: null,      // clave para recordar progreso
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
function showError(msg, url) {
  body().innerHTML = `<div class="iframe-fallback"><p>⚠️ ${esc(msg)}</p>
    ${url ? `<a class="btn btn-primary" target="_blank" rel="noopener" href="${esc(url)}">${t("reader.openTab")}</a>` : ""}</div>`;
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

/* ---------- progreso recordado ---------- */
function progress() {
  try { return JSON.parse(localStorage.getItem("anilector.progress") || "{}"); }
  catch { return {}; }
}
function saveProgress(key, value) {
  if (!key) return;
  try {
    const p = progress();
    p[key] = value;
    localStorage.setItem("anilector.progress", JSON.stringify(p));
    window.dispatchEvent(new Event("anilector:datachanged"));
  } catch (_) {}
}

/* ---------- apertura / cierre ---------- */
function openModal(title, { showControls = true, external = null } = {}) {
  titleEl().textContent = title;
  controls().style.display = showControls ? "" : "none";
  // Restaurar ◀ ▶ : el modo MOBI los oculta y sin esto seguirían ocultos
  // en el siguiente documento que se abra.
  document.getElementById("vPrev").style.display = "";
  document.getElementById("vNext").style.display = "";
  if (external) { extLink().href = external; extLink().style.display = ""; }
  else extLink().style.display = "none";
  body().innerHTML = "";
  body().scrollTop = 0;
  modal().classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
export function closeViewer() {
  modal().classList.add("hidden");
  document.body.style.overflow = "";
  if (state.epubRendition) { try { state.epubRendition.destroy(); } catch (_) {} }
  if (state.mobiBook?.destroy) { try { state.mobiBook.destroy(); } catch (_) {} }
  if (state.archive?.close) { try { state.archive.close(); } catch (_) {} }
  if (state.pdf?.destroy) { try { state.pdf.destroy(); } catch (_) {} }
  revokeAll();
  Object.assign(state, {
    mode: null, pdf: null, images: [], imgIndex: 0,
    epubRendition: null, mobiBook: null, archive: null, docKey: null,
  });
  body().innerHTML = "";
}

/* ---------- PDF ---------- */
export async function openPdf(source, title) {
  const isUrl = typeof source === "string";
  openModal(title, { external: isUrl ? source : null });
  showLoader();
  state.mode = "pdf";
  state.docKey = `pdf:${title}`;
  state.zoom = window.innerWidth < 720 ? 0.8 : 1.2;

  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

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
    return showError(e.message, isUrl ? source : null);
  }

  state.page = progress()[state.docKey]?.page || 1;
  if (state.page > state.pdf.numPages) state.page = 1;

  body().innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.id = "pdfCanvas";
  body().appendChild(canvas);
  await renderPdfPage();
}

async function renderPdfPage() {
  const page = await state.pdf.getPage(state.page);
  const viewport = page.getViewport({ scale: state.zoom * (window.devicePixelRatio || 1) });
  const canvas = document.getElementById("pdfCanvas");
  if (!canvas) return;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  pageInfo().textContent = `${t("reader.page")} ${state.page} ${t("reader.of")} ${state.pdf.numPages}`;
  saveProgress(state.docKey, { page: state.page });
}

/* ---------- EPUB ---------- */
export async function openEpub(file, title) {
  openModal(title || file.name);
  state.mode = "epub";
  state.docKey = `epub:${file.name}`;
  const area = document.createElement("div");
  area.id = "epubArea";
  body().appendChild(area);
  const book = window.ePub(await file.arrayBuffer());
  const rendition = book.renderTo("epubArea", { width: "100%", height: "100%", flow: "paginated" });
  state.epubRendition = rendition;
  const saved = progress()[state.docKey]?.cfi;
  await rendition.display(saved || undefined);
  rendition.on("relocated", (loc) => {
    saveProgress(state.docKey, { cfi: loc.start.cfi });
    const pct = book.locations?.percentageFromCfi
      ? Math.round((book.locations.percentageFromCfi(loc.start.cfi) || 0) * 100)
      : null;
    pageInfo().textContent = pct != null && !isNaN(pct) ? `${pct}%` : "…";
  });
  book.ready.then(() => book.locations.generate(1000)).catch(() => {});
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
  state.docKey = `mobi:${file.name}`;
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
        frag.innerHTML = sanitizeHTML(html);
        doc.insertBefore(frag, sentinel);
      } catch (e) {
        console.warn("MOBI sección:", e.message);
      }
      loaded++;
    }
    pageInfo().textContent = `${loaded} / ${sections.length}`;
    if (loaded >= sections.length) sentinel.remove();
    busy = false;
  }
  const io = new IntersectionObserver((ents) => {
    if (ents.some((e) => e.isIntersecting)) loadNext(2);
  }, { root: body(), rootMargin: "600px" });
  io.observe(sentinel);
  controls().style.display = "";
  document.getElementById("vPrev").style.display = "none";
  document.getElementById("vNext").style.display = "none";
  await loadNext(3);
}

/* ---------- Markdown ---------- */
let markedMod = null;
export async function openMarkdown(file, title) {
  openModal(title || file.name, { showControls: false });
  showLoader();
  state.mode = "html";
  try {
    if (!markedMod) markedMod = await import("../vendor/marked.esm.js");
    const src = await readTextSmart(file);
    const html = markedMod.marked.parse(src, { async: false, breaks: false, gfm: true });
    body().innerHTML = `<div class="ebook-doc markdown-doc">${sanitizeHTML(html)}</div>`;
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
  state.imgIndex = Math.min(progress()[state.docKey]?.index || 0, Math.max(0, pages.length - 1));
  body().innerHTML = "";
  const img = document.createElement("img");
  img.className = "page-img";
  img.alt = "";
  body().appendChild(img);
  await renderImage();
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
  saveProgress(state.docKey, { index: idx });
  try {
    const url = await resolvePage(p);
    if (state.imgIndex !== idx || state.mode !== "images") return; // el usuario ya pasó de página
    img.src = url;
    img.style.display = "";
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
  openModal(title || file.name, { showControls: false });
  state.mode = "text";
  const div = document.createElement("div");
  div.className = "text-doc";
  div.textContent = await readTextSmart(file);
  body().innerHTML = "";
  body().appendChild(div);
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
export async function openRemoteFile(url, title) {
  openModal(title || url, { showControls: false, external: url });
  showLoader(t("reader.downloading"));

  const fetchWith = async (target) => {
    const res = await fetch(target, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  };

  let res;
  try {
    res = await fetchWith(url);                     // directo (si el servidor manda CORS)
  } catch (e1) {
    const prox = proxiedUrl(url);
    if (!prox) return showError(t("reader.corsBlocked"), url);
    try { res = await fetchWith(prox); }
    catch (e2) { return showError(`${t("reader.downloadFailed")} (${e2.message})`, url); }
  }

  // Si nos devolvieron una página HTML, no era un archivo directo.
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (ctype.includes("text/html") && !/\.html?$/i.test(url.split(/[?#]/)[0]))
    return showSharePageHelp(url, title);

  try {
    const blob = await res.blob();
    const name = decodeURIComponent((url.split(/[?#]/)[0].split("/").pop() || "archivo"));
    return await openLocalFile(new File([blob], name, { type: blob.type }));
  } catch (e) {
    return showError(`${t("reader.downloadFailed")} (${e.message})`, url);
  }
}

/* ---------- Controles ---------- */
export function bindViewerControls() {
  document.getElementById("vPrev").addEventListener("click", () => nav(-1));
  document.getElementById("vNext").addEventListener("click", () => nav(1));
  document.getElementById("vZoomIn").addEventListener("click", () => zoomBy(0.2));
  document.getElementById("vZoomOut").addEventListener("click", () => zoomBy(-0.2));
  document.addEventListener("keydown", (e) => {
    if (modal().classList.contains("hidden")) return;
    if (e.target.matches("input, textarea")) return;   // no robar teclas al campo de contraseña
    if (e.key === "ArrowLeft") nav(-1);
    if (e.key === "ArrowRight") nav(1);
    if (e.key === "Escape") closeViewer();
  });
}
function nav(dir) {
  if (state.mode === "pdf" && state.pdf) {
    const next = state.page + dir;
    if (next >= 1 && next <= state.pdf.numPages) { state.page = next; renderPdfPage(); }
  } else if (state.mode === "images") {
    const next = state.imgIndex + dir;
    if (next >= 0 && next < state.images.length) { state.imgIndex = next; renderImage(); }
  } else if (state.mode === "epub" && state.epubRendition) {
    dir > 0 ? state.epubRendition.next() : state.epubRendition.prev();
  }
}
function zoomBy(d) {
  if (state.mode === "pdf" && state.pdf) {
    state.zoom = Math.min(3, Math.max(0.4, state.zoom + d));
    renderPdfPage();
  } else if (state.mode === "images") {
    const img = body().querySelector("img.page-img");
    if (!img) return;
    const cur = parseFloat(img.dataset.zoom || "1");
    const z = Math.min(3, Math.max(0.4, cur + d));
    img.dataset.zoom = z;
    img.style.maxWidth = `${z * 100}%`;
    img.style.maxHeight = z === 1 ? "100%" : "none";
  } else if (state.mode === "mobi" || state.mode === "html" || state.mode === "text") {
    const doc = body().querySelector(".ebook-doc, .text-doc");
    if (!doc) return;
    const cur = parseFloat(doc.dataset.zoom || "1");
    const z = Math.min(2.5, Math.max(0.6, cur + d));
    doc.dataset.zoom = z;
    doc.style.fontSize = `${z}rem`;
  }
}
