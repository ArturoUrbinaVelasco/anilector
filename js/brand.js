/* ============================================================
   AniLector — personalización de marca (nombre y logo)
   ------------------------------------------------------------
   Cambia el nombre que se ve en el encabezado, el título de la
   pestaña y el icono (favicon). El logo puede ser un emoji o una
   imagen propia.

   Las imágenes se REDIMENSIONAN antes de guardarlas: localStorage
   ronda los 5 MB en total y ahí viven también la biblioteca y el
   progreso, así que meter una foto de 4 MB tal cual dejaría la app
   sin espacio (y además viajaría entera a Google Drive en cada
   sincronización).
   ============================================================ */
import { t } from "./i18n.js";

const KEY = "anilector.brand";
const DEFAULTS = {
  name: "AniLector",
  emoji: "📚",
  image: "",                     // dataURL si el usuario sube una
  tagline: "Anime · Manga · Libros",
};
const LOGO_PX = 128;             // tamaño al que se reduce la imagen
const $ = (id) => document.getElementById(id);

export function getBrand() {
  try {
    const b = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...DEFAULTS, ...(b && typeof b === "object" ? b : {}) };
  } catch { return { ...DEFAULTS }; }
}
function saveBrand(b) {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (_) {}
  window.dispatchEvent(new Event("anilector:datachanged"));
}

/* Icono de pestaña: la imagen si la hay, si no el emoji dibujado como SVG. */
function faviconFor(b) {
  if (b.image) return b.image;
  const emoji = b.emoji || DEFAULTS.emoji;
  return "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<text y=".9em" font-size="90">${emoji}</text></svg>`);
}

/* Aplica la marca a toda la página.
   `datachanged` se dispara con cualquier cambio (marcar un episodio,
   guardar un favorito…), así que se comprueba antes si la marca cambió
   de verdad: repintar el logo en cada evento haría parpadear la imagen. */
let ultimaFirma = null;
export function applyBrand(b = getBrand(), { force = false } = {}) {
  const firma = JSON.stringify([b.name, b.tagline, b.emoji, b.image]);
  if (!force && firma === ultimaFirma) return;
  ultimaFirma = firma;
  const nombre = (b.name || DEFAULTS.name).trim() || DEFAULTS.name;

  // Título de la pestaña
  document.title = b.tagline ? `${nombre} — ${b.tagline}` : nombre;

  // Nombre en el encabezado
  document.querySelectorAll(".brand-name").forEach((el) => { el.textContent = nombre; });

  // Logo del encabezado
  document.querySelectorAll(".brand-icon").forEach((el) => {
    if (b.image) {
      el.innerHTML = `<img src="${b.image}" alt="" class="brand-img" />`;
    } else {
      el.textContent = b.emoji || DEFAULTS.emoji;
    }
  });

  // Favicon
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = faviconFor(b);
}

/* Reduce una imagen a un cuadrado de LOGO_PX, conservando proporción
   y transparencia. Devuelve un dataURL PNG (~10-30 KB). */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Imagen no válida"));
      img.onload = () => {
        const lado = LOGO_PX;
        const c = document.createElement("canvas");
        c.width = c.height = lado;
        const ctx = c.getContext("2d");
        // "contain": la imagen entera cabe, centrada, sin recortar
        const escala = Math.min(lado / img.width, lado / img.height);
        const w = Math.round(img.width * escala);
        const h = Math.round(img.height * escala);
        ctx.drawImage(img, Math.round((lado - w) / 2), Math.round((lado - h) / 2), w, h);
        resolve(c.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------- panel ---------- */
function open() {
  const b = getBrand();
  const modal = $("brandModal");
  $("brandName").value = b.name;
  $("brandTagline").value = b.tagline;
  $("brandEmoji").value = b.image ? "" : (b.emoji || "");
  renderPreview(b);
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  // Al abrir el panel se refresca lo que se mide: el espacio ocupado y
  // si de verdad está lista la copia sin conexión.
  window.dispatchEvent(new Event("anilector:panelabierto"));
}
function close() {
  $("brandModal").classList.add("hidden");
  document.body.style.overflow = "";
}

// Estado del panel mientras se edita (no se guarda hasta pulsar Guardar)
let editing = null;

function renderPreview(b) {
  const box = $("brandPreview");
  if (!box) return;
  const nombre = (b.name || DEFAULTS.name).trim() || DEFAULTS.name;
  box.innerHTML = `
    <div class="brand-prev-row">
      <span class="brand-prev-logo">${b.image
        ? `<img src="${b.image}" alt="" />`
        : (b.emoji || DEFAULTS.emoji)}</span>
      <span class="brand-prev-name">${nombre.replace(/[&<>"']/g, "")}</span>
    </div>
    <div class="brand-prev-tab">🔖 ${(b.tagline ? `${nombre} — ${b.tagline}` : nombre).replace(/[&<>"']/g, "")}</div>`;
}

export function initBrand() {
  applyBrand();

  const abrir = () => { editing = getBrand(); open(); };
  $("brandBtn")?.addEventListener("click", abrir);
  $("brandBtnM")?.addEventListener("click", () => {
    $("moreSheet")?.classList.add("hidden");
    abrir();
  });

  $("brandClose")?.addEventListener("click", close);
  $("brandModal")?.addEventListener("click", (e) => {
    if (e.target === $("brandModal")) close();
  });

  // Vista previa en vivo
  const sync = () => {
    editing = {
      ...editing,
      name: $("brandName").value,
      tagline: $("brandTagline").value,
      emoji: $("brandEmoji").value.trim() || DEFAULTS.emoji,
    };
    renderPreview(editing);
  };
  ["brandName", "brandTagline", "brandEmoji"].forEach((id) =>
    $(id)?.addEventListener("input", () => {
      // Si escribe un emoji, deja de usarse la imagen subida
      if (id === "brandEmoji" && $(id).value.trim()) editing.image = "";
      sync();
    }));

  $("brandFile")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const aviso = $("brandMsg");
    try {
      if (!/^image\//.test(f.type)) throw new Error(t("brand.notImage"));
      editing.image = await shrinkImage(f);
      editing.emoji = "";
      $("brandEmoji").value = "";
      aviso.textContent = "";
      renderPreview(editing);
    } catch (err) {
      aviso.textContent = err.message;
    }
  });

  $("brandClear")?.addEventListener("click", () => {
    editing.image = "";
    editing.emoji = $("brandEmoji").value.trim() || DEFAULTS.emoji;
    renderPreview(editing);
  });

  $("brandReset")?.addEventListener("click", () => {
    editing = { ...DEFAULTS };
    $("brandName").value = DEFAULTS.name;
    $("brandTagline").value = DEFAULTS.tagline;
    $("brandEmoji").value = DEFAULTS.emoji;
    renderPreview(editing);
  });

  $("brandSave")?.addEventListener("click", () => {
    const b = {
      name: ($("brandName").value || "").trim() || DEFAULTS.name,
      tagline: ($("brandTagline").value || "").trim(),
      emoji: editing.image ? "" : (($("brandEmoji").value || "").trim() || DEFAULTS.emoji),
      image: editing.image || "",
    };
    saveBrand(b);
    applyBrand(b, { force: true });
    close();
  });

  // Si llega una marca distinta desde otro equipo (Drive), repintar.
  window.addEventListener("anilector:datachanged", () => applyBrand());
}
