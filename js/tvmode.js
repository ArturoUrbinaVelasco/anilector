/* ============================================================
   AniLector — modo Smart TV (navegación con control remoto)
   ------------------------------------------------------------
   En una TV no hay ratón ni dedo: solo un mando con flechas, OK y
   Atrás. Este módulo añade NAVEGACIÓN ESPACIAL: al pulsar una flecha
   busca el elemento accionable que esté realmente en esa dirección
   (no el siguiente del HTML, que es lo que haría el tabulador) y le
   pasa el foco.

   Además agranda la interfaz cuando el modo está activo: una TV se ve
   desde el sofá, a dos o tres metros, y los tamaños de un teléfono
   ahí no se leen.

   Se enciende solo en cuanto se usa una flecha (así el mando "lo
   despierta" sin configurar nada) y hay un interruptor manual.
   ============================================================ */
import { t } from "./i18n.js";

const KEY = "anilector.tvmode";
const $ = (id) => document.getElementById(id);

let activo = false;
let manual = null;   // true/false si el usuario lo forzó; null = automático

/* Elementos que se pueden enfocar y de verdad se ven. */
const SELECTOR = [
  "a[href]", "button:not([disabled])", "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])", "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  ".card", ".tv-row", ".yt-card", ".yt-rel", ".continue-card",
  ".ep-item", ".arch-item", ".site-chip", ".order-item",
].join(",");

function visible(el) {
  if (!el || el.disabled) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  // Fuera de la ventana por arriba/abajo se permite (se desplaza),
  // pero lo que está oculto de verdad no.
  const s = getComputedStyle(el);
  if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") return false;
  return !el.closest(".hidden");
}

/* Si hay un diálogo abierto, el foco no debe salir de él. */
function ambito() {
  const modales = [$("viewerModal"), $("detailModal"), $("brandModal")]
    .filter((m) => m && !m.classList.contains("hidden"));
  if (modales.length) return modales[modales.length - 1];
  const hoja = $("moreSheet");
  if (hoja && !hoja.classList.contains("hidden")) return hoja;
  return document.body;
}

function candidatos() {
  const raiz = ambito();
  return [...raiz.querySelectorAll(SELECTOR)].filter(visible);
}

/* Las tarjetas son <article>/<li>: sin tabindex el navegador no las
   puede enfocar, así que se las damos al vuelo. */
function hacerEnfocable(el) {
  if (el && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
}

const centro = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/* Elige el mejor destino en una dirección: se prioriza lo que está
   alineado (poca desviación lateral) y cerca. Sin el castigo lateral
   el foco saltaría en diagonal a cualquier lado. */
function mejorEn(dir, desde) {
  const base = desde.getBoundingClientRect();
  const c0 = centro(base);
  let mejor = null, mejorCoste = Infinity;

  for (const el of candidatos()) {
    if (el === desde) continue;
    const r = el.getBoundingClientRect();
    const c = centro(r);
    const dx = c.x - c0.x, dy = c.y - c0.y;

    let avance, lateral;
    if (dir === "ArrowRight")      { avance = r.left - base.right;  lateral = Math.abs(dy); if (avance < -base.width / 2) continue; }
    else if (dir === "ArrowLeft")  { avance = base.left - r.right;  lateral = Math.abs(dy); if (avance < -base.width / 2) continue; }
    else if (dir === "ArrowDown")  { avance = r.top - base.bottom;  lateral = Math.abs(dx); if (avance < -base.height / 2) continue; }
    else                           { avance = base.top - r.bottom;  lateral = Math.abs(dx); if (avance < -base.height / 2) continue; }

    // Solapes cuentan como distancia cero, no como negativa.
    const d = Math.max(avance, 0);
    const coste = d + lateral * 2;
    if (coste < mejorCoste) { mejorCoste = coste; mejor = el; }
  }
  return mejor;
}

function enfocar(el) {
  if (!el) return false;
  hacerEnfocable(el);
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  return true;
}

/* Punto de partida cuando aún no hay nada enfocado. */
function primero() {
  const lista = candidatos();
  if (!lista.length) return null;
  // El más arriba y a la izquierda de lo que se ve ahora.
  const dentro = lista.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  });
  return (dentro.length ? dentro : lista).sort((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return (ra.top - rb.top) || (ra.left - rb.left);
  })[0];
}

/* ---------- activación ---------- */
export function isTvMode() { return activo; }

export function setTvMode(on, { porUsuario = false } = {}) {
  activo = !!on;
  if (porUsuario) {
    manual = activo;
    try { localStorage.setItem(KEY, activo ? "1" : "0"); } catch (_) {}
  }
  document.documentElement.dataset.tv = activo ? "1" : "";
  const sw = $("tvModeToggle");
  if (sw) sw.checked = activo;
  if (activo && !document.activeElement?.matches?.(SELECTOR)) enfocar(primero());
}

/* Una pantalla muy ancha con puntero grueso es, casi seguro, una TV. */
function pareceTV() {
  try {
    return window.matchMedia("(min-width: 1280px) and (pointer: coarse)").matches;
  } catch { return false; }
}

/* ---------- teclado / mando ---------- */
function enCampoDeTexto(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" ||
    el.isContentEditable || el.tagName === "SELECT");
}

function onKey(e) {
  const k = e.key;
  const flechas = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

  // Encendido automático: la primera flecha del mando despierta el modo.
  if (!activo && manual !== false && flechas.includes(k) && !enCampoDeTexto(e.target)) {
    setTvMode(true);
    // Esa misma pulsación ya sirve para mover el foco.
  }
  if (!activo) return;

  // Atrás del mando: cerrar lo que esté abierto.
  if (k === "Escape" || k === "Backspace" || k === "GoBack" || k === "BrowserBack") {
    if (enCampoDeTexto(e.target) && k === "Backspace") return; // borrar texto
    const raiz = ambito();
    if (raiz !== document.body) {
      e.preventDefault();
      raiz.querySelector(".modal-close, #brandClose, #moreBtn")?.click();
      return;
    }
  }

  if (!flechas.includes(k)) return;
  // En un campo de texto las flechas mueven el cursor: solo se sale
  // con arriba/abajo, que ahí no hacen falta.
  if (enCampoDeTexto(e.target) && (k === "ArrowLeft" || k === "ArrowRight")) return;

  // En el visor con páginas, izquierda/derecha pasan página (lo maneja
  // viewer.js); aquí solo se ocupa de arriba/abajo para llegar a la barra.
  const visor = $("viewerModal");
  if (visor && !visor.classList.contains("hidden") &&
      (k === "ArrowLeft" || k === "ArrowRight")) return;

  const actual = document.activeElement && document.activeElement !== document.body
    ? document.activeElement : null;
  e.preventDefault();
  if (!actual) return void enfocar(primero());
  const destino = mejorEn(k, actual);
  if (destino) enfocar(destino);
}

function onKeyActivate(e) {
  if (!activo) return;
  if (e.key !== "Enter" && e.key !== " ") return;
  const el = document.activeElement;
  if (!el || el === document.body || enCampoDeTexto(el)) return;
  // Los botones y enlaces ya responden solos a Enter.
  if (el.tagName === "BUTTON" || el.tagName === "A") return;
  e.preventDefault();
  el.click();
}

export function initTvMode() {
  try {
    const g = localStorage.getItem(KEY);
    if (g === "1") manual = true;
    else if (g === "0") manual = false;
  } catch (_) {}

  if (manual === true || (manual === null && pareceTV())) setTvMode(true);

  document.addEventListener("keydown", onKey, true);
  document.addEventListener("keydown", onKeyActivate);

  // Con ratón o dedo se vuelve al modo normal (salvo que se haya forzado).
  const salir = () => { if (activo && manual !== true) setTvMode(false); };
  document.addEventListener("mousedown", salir);
  document.addEventListener("touchstart", salir, { passive: true });

  $("tvModeToggle")?.addEventListener("change", (e) =>
    setTvMode(e.target.checked, { porUsuario: true }));
}
