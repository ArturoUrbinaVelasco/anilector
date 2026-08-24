/* ============================================================
   AniLector — visor integrado
   PDF (pdf.js) · EPUB (epub.js) · CBZ/ZIP (JSZip) · imágenes · texto · iframe
   ============================================================ */
import { t } from "./i18n.js";

const modal = () => document.getElementById("viewerModal");
const body = () => document.getElementById("viewerBody");
const titleEl = () => document.getElementById("viewerTitle");
const pageInfo = () => document.getElementById("vPageInfo");
const controls = () => document.getElementById("viewerControls");
const extLink = () => document.getElementById("vExternal");

const state = {
  mode: null,        // 'pdf' | 'epub' | 'images' | 'text' | 'iframe'
  pdf: null,
  page: 1,
  zoom: 1.2,
  images: [],
  imgIndex: 0,
  epubRendition: null,
  docKey: null,      // clave para recordar progreso
};

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
  } catch (_) {}
}

/* ---------- apertura / cierre ---------- */
function openModal(title, { showControls = true, external = null } = {}) {
  titleEl().textContent = title;
  controls().style.display = showControls ? "" : "none";
  if (external) { extLink().href = external; extLink().style.display = ""; }
  else extLink().style.display = "none";
  body().innerHTML = "";
  modal().classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
export function closeViewer() {
  modal().classList.add("hidden");
  document.body.style.overflow = "";
  if (state.epubRendition) { try { state.epubRendition.destroy(); } catch (_) {} }
  Object.assign(state, { mode: null, pdf: null, images: [], epubRendition: null, docKey: null });
  body().innerHTML = "";
}

/* ---------- PDF ---------- */
export async function openPdf(source, title) {
  openModal(title, { external: typeof source === "string" ? source : null });
  state.mode = "pdf";
  state.docKey = `pdf:${title}`;
  state.zoom = window.innerWidth < 720 ? 0.8 : 1.2;

  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const loading =
    typeof source === "string"
      ? pdfjsLib.getDocument({ url: source, withCredentials: false })
      : pdfjsLib.getDocument({ data: await source.arrayBuffer() });

  try {
    state.pdf = await loading.promise;
  } catch (e) {
    body().innerHTML = `<div class="iframe-fallback"><p>⚠️ ${e.message}</p>
      ${typeof source === "string" ? `<a class="btn btn-primary" target="_blank" rel="noopener" href="${source}">${t("reader.openTab")}</a>` : ""}</div>`;
    return;
  }
  state.page = progress()[state.docKey]?.page || 1;
  if (state.page > state.pdf.numPages) state.page = 1;

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

/* ---------- Imágenes / CBZ / ZIP ---------- */
export async function openImages(files, title) {
  openModal(title);
  state.mode = "images";
  state.docKey = `img:${title}`;
  state.images = files; // [{name, url}]
  state.imgIndex = Math.min(progress()[state.docKey]?.index || 0, files.length - 1);
  const img = document.createElement("img");
  img.className = "page-img";
  body().appendChild(img);
  renderImage();
}
function renderImage() {
  const img = body().querySelector("img.page-img");
  if (!img || !state.images.length) return;
  img.src = state.images[state.imgIndex].url;
  pageInfo().textContent = `${state.imgIndex + 1} / ${state.images.length}`;
  saveProgress(state.docKey, { index: state.imgIndex });
}

export async function openComicArchive(file, title) {
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files)
    .filter((n) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n) && !zip.files[n].dir)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const files = [];
  for (const n of names) {
    const blob = await zip.files[n].async("blob");
    files.push({ name: n, url: URL.createObjectURL(blob) });
  }
  if (!files.length) throw new Error(t("reader.unsupported"));
  await openImages(files, title || file.name);
}

/* ---------- Texto ---------- */
export async function openText(file, title) {
  openModal(title || file.name, { showControls: false });
  state.mode = "text";
  const div = document.createElement("div");
  div.className = "text-doc";
  div.textContent = await file.text();
  body().appendChild(div);
}

/* ---------- Iframe (páginas / lectores externos) ---------- */
export function openIframe(url, title) {
  openModal(title || url, { showControls: false, external: url });
  state.mode = "iframe";
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.allow = "fullscreen";
  frame.referrerPolicy = "no-referrer";
  body().appendChild(frame);

  // Si el sitio bloquea iframes no hay evento fiable: ofrecemos siempre salida.
  const note = document.createElement("div");
  note.className = "iframe-fallback";
  note.style.display = "none";
  note.innerHTML = `<p>${t("reader.iframeBlocked")}</p>
    <a class="btn btn-primary" href="${url}" target="_blank" rel="noopener">${t("reader.openTab")}</a>`;
  body().appendChild(note);
  frame.addEventListener("error", () => { note.style.display = ""; });
}

/* ---------- Router de archivos locales ---------- */
export async function openLocalFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;

  const images = files.filter((f) => /^image\//.test(f.type));
  if (images.length > 1 || (images.length === 1 && files.length === images.length && images.length > 0 && files.length > 1)) {
    const mapped = images
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
    return openImages(mapped, `${images.length} imgs`);
  }

  const f = files[0];
  const name = f.name.toLowerCase();
  if (name.endsWith(".pdf") || f.type === "application/pdf") return openPdf(f, f.name);
  if (name.endsWith(".epub")) return openEpub(f, f.name);
  if (name.endsWith(".cbz") || name.endsWith(".zip")) return openComicArchive(f, f.name);
  if (/^image\//.test(f.type)) return openImages([{ name: f.name, url: URL.createObjectURL(f) }], f.name);
  if (name.endsWith(".txt") || name.endsWith(".md") || /^text\//.test(f.type)) return openText(f, f.name);
  throw new Error(t("reader.unsupported"));
}

/* ---------- URL online ---------- */
export function openUrl(url, title) {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".pdf")) return openPdf(url, title || url.split("/").pop());
  return openIframe(url, title);
}

/* ---------- Controles ---------- */
export function bindViewerControls() {
  document.getElementById("vPrev").addEventListener("click", () => nav(-1));
  document.getElementById("vNext").addEventListener("click", () => nav(1));
  document.getElementById("vZoomIn").addEventListener("click", () => zoomBy(0.2));
  document.getElementById("vZoomOut").addEventListener("click", () => zoomBy(-0.2));
  document.addEventListener("keydown", (e) => {
    if (modal().classList.contains("hidden")) return;
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
  }
}
