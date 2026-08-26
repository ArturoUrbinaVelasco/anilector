/* ============================================================
   AniLector — puertas de entrada: abrir archivos DESDE FUERA
   ------------------------------------------------------------
   Hasta ahora, para leer algo había que entrar a la app y pulsar
   «Elegir archivos». Aquí se invierte: se puede empezar desde el
   archivo. Tres caminos, y los tres exigen tener la app INSTALADA:

   1. ARRASTRAR Y SOLTAR el archivo sobre la ventana. Es el único
      que funciona en cualquier navegador, instalada o no.
   2. DOBLE CLIC en el explorador de Windows (File Handling API).
      Chrome/Edge 102+ y solo en ESCRITORIO. El sistema pregunta
      una vez si quieres asociar esos archivos a la app.
   3. COMPARTIR desde otra app del móvil (Web Share Target). El
      navegador manda un POST a `./compartir`; ese POST NO llega a
      ningún servidor: lo intercepta nuestro service worker, deja
      los archivos en la caché y reenvía a la app.

   Ninguno cambia lo que la app hace: solo cómo se entra.
   ============================================================ */
import { t } from "./i18n.js";
import { openLocalFiles, openUrl } from "./viewer.js";

const CACHE_COMPARTIR = "anilector-compartido";

/* ---------- 1. arrastrar y soltar ---------- */
function iniciarArrastre() {
  let dentro = 0;      // dragenter/dragleave saltan también al pasar
                       // sobre elementos hijos: sin contador, la capa
                       // parpadearía al mover el ratón por la página.

  const capa = document.createElement("div");
  capa.id = "zonaSoltar";
  capa.className = "drop-zone hidden";
  capa.innerHTML = `<div class="drop-msg">📂 ${t("drop.here")}</div>`;
  document.body.appendChild(capa);

  const mostrar = (si) => capa.classList.toggle("hidden", !si);

  // SIN preventDefault en dragover, el navegador abre el archivo él
  // mismo y te saca de la app.
  document.addEventListener("dragover", (e) => {
    if (!traeArchivos(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  document.addEventListener("dragenter", (e) => {
    if (!traeArchivos(e)) return;
    e.preventDefault();
    if (++dentro === 1) mostrar(true);
  });
  document.addEventListener("dragleave", (e) => {
    if (!traeArchivos(e)) return;
    if (--dentro <= 0) { dentro = 0; mostrar(false); }
  });
  document.addEventListener("drop", async (e) => {
    if (!traeArchivos(e)) return;
    e.preventDefault();
    dentro = 0;
    mostrar(false);
    const archivos = Array.from(e.dataTransfer.files || []);
    if (archivos.length) return abrir(archivos);
    // Arrastrar un ENLACE (desde otra pestaña) también vale.
    const texto = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (/^https?:\/\//i.test((texto || "").trim())) openUrl(texto.trim());
  });
}
function traeArchivos(e) {
  const tipos = e.dataTransfer?.types;
  return !!tipos && (Array.from(tipos).includes("Files") ||
    Array.from(tipos).some((x) => x === "text/uri-list" || x === "text/plain"));
}

/* ---------- 2. doble clic en el explorador ---------- */
function iniciarArchivosDelSistema() {
  // La comprobación de `files` importa: hubo versiones con launchQueue
  // pero sin archivos, y sin esto se registraría un consumidor inútil.
  if (!("launchQueue" in window) || !("LaunchParams" in window) ||
      !("files" in LaunchParams.prototype)) return;

  window.launchQueue.setConsumer(async (params) => {
    if (!params?.files?.length) return;
    try {
      const archivos = await Promise.all(params.files.map((h) => h.getFile()));
      abrir(archivos);
    } catch (e) {
      console.warn("Archivo del sistema:", e.message);
    }
  });
}

/* ---------- 3. compartir desde otra app ---------- */
/* El service worker ya dejó los archivos en la caché y nos mandó aquí
   con ?compartido=N. Se recogen, se abren y se borra el rastro. */
async function recogerCompartido() {
  const params = new URLSearchParams(location.search);
  const enlace = params.get("abrir");
  const cuantos = Number(params.get("compartido") || 0);
  if (!enlace && !cuantos) return;

  limpiarUrl();          // que no se reabra al recargar

  if (enlace) return openUrl(enlace);

  try {
    const cache = await caches.open(CACHE_COMPARTIR);
    const archivos = [];
    for (let i = 0; i < cuantos; i++) {
      const res = await cache.match(new URL(`compartido/${i}`, document.baseURI).href);
      if (!res) continue;
      const blob = await res.blob();
      // El nombre viaja en una cabecera propia; va codificado porque las
      // cabeceras solo admiten ASCII y los títulos llevan tildes.
      const nombre = decodeURIComponent(res.headers.get("x-nombre") || `compartido-${i}`);
      archivos.push(new File([blob], nombre, {
        type: res.headers.get("content-type") || blob.type || "",
      }));
    }
    await caches.delete(CACHE_COMPARTIR);
    if (archivos.length) abrir(archivos);
  } catch (e) {
    console.warn("Compartido:", e.message);
  }
}
function limpiarUrl() {
  try {
    history.replaceState(null, "", location.pathname + location.hash);
  } catch (_) {}
}

/* ---------- común ---------- */
async function abrir(archivos) {
  try {
    await openLocalFiles(archivos);
  } catch (e) {
    console.warn("Abrir:", e.message);
    const el = document.getElementById("toast");
    if (el) {
      el.textContent = e.message || t("reader.unsupported");
      el.classList.remove("hidden");
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.add("hidden"), 3000);
    }
  }
}

export function initEntradas() {
  iniciarArrastre();
  iniciarArchivosDelSistema();
  recogerCompartido();
}
