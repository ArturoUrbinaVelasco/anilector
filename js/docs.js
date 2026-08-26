/* ============================================================
   AniLector — «Mis descargas»: documentos guardados en el aparato
   ------------------------------------------------------------
   Aquí viven los libros y capítulos que guardas para leer sin
   conexión. Es IndexedDB, NO localStorage, y eso es a propósito:

   · localStorage solo guarda texto y ronda los 5 MB EN TOTAL —
     ahí ya viven la biblioteca, el progreso y los vistos. Un solo
     PDF se lo comería entero.
   · IndexedDB guarda Blobs (el archivo tal cual, sin convertirlo a
     texto, que lo haría un 33 % más grande) y su espacio se mide
     en cientos de MB o GB según el disco.

   ⚠️ ESTOS ARCHIVOS NO SE SINCRONIZAN CON DRIVE NI ENTRAN EN EL
   RESPALDO JSON, y no es un olvido: son megas de datos que ni
   caben en la carpeta oculta de Drive ni tienen sentido en un
   archivo de ajustes. Lo que sí viaja es el progreso de lectura.

   Dos almacenes en vez de uno: `meta` (nombre, tamaño, fecha) y
   `blobs` (el archivo). IndexedDB lee el registro COMPLETO, así
   que si todo estuviera junto, pintar la lista cargaría en memoria
   todos los archivos guardados.
   ============================================================ */

const BD = "anilector-docs";
const VERSION = 1;
let bd = null;

function abrir() {
  if (bd) return Promise.resolve(bd);
  return new Promise((resolver, rechazar) => {
    if (!self.indexedDB) return rechazar(new Error("IndexedDB"));
    const pet = indexedDB.open(BD, VERSION);
    pet.onupgradeneeded = () => {
      const d = pet.result;
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "id" });
      if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs");
    };
    pet.onsuccess = () => { bd = pet.result; resolver(bd); };
    pet.onerror = () => rechazar(pet.error || new Error("IndexedDB"));
  });
}

function transaccion(almacenes, modo) {
  return abrir().then((d) => d.transaction(almacenes, modo));
}
function esperar(pet) {
  return new Promise((resolver, rechazar) => {
    pet.onsuccess = () => resolver(pet.result);
    pet.onerror = () => rechazar(pet.error);
  });
}

export function hayAlmacen() {
  return typeof self !== "undefined" && !!self.indexedDB;
}

/* La clave: nombre + tamaño. No es un hash del contenido (calcularlo
   obligaría a leer el archivo entero, y en un PDF de 200 MB eso se
   nota), pero basta para que volver a guardar el MISMO archivo lo
   reemplace en vez de duplicarlo. */
export function idDe(nombre, tamano) {
  return `${nombre}·${tamano}`;
}

export async function guardar(file, { titulo = null } = {}) {
  const id = idDe(file.name, file.size);
  const meta = {
    id,
    nombre: file.name,
    titulo: titulo || file.name,
    tipo: file.type || "",
    tamano: file.size,
    ts: Date.now(),
  };
  const tx = await transaccion(["meta", "blobs"], "readwrite");
  tx.objectStore("meta").put(meta);
  tx.objectStore("blobs").put(file, id);
  await new Promise((resolver, rechazar) => {
    tx.oncomplete = resolver;
    // Si no cabe, el navegador aborta la transacción con QuotaExceededError.
    tx.onerror = tx.onabort = () => rechazar(tx.error || new Error("QuotaExceededError"));
  });
  return meta;
}

/* Solo las fichas, nunca los archivos: esta es la razón de los dos
   almacenes. Lo más reciente primero. */
export async function listar() {
  if (!hayAlmacen()) return [];
  try {
    const tx = await transaccion(["meta"], "readonly");
    const todo = await esperar(tx.objectStore("meta").getAll());
    return (todo || []).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  } catch (_) {
    return [];
  }
}

export async function leer(id) {
  const tx = await transaccion(["blobs"], "readonly");
  const blob = await esperar(tx.objectStore("blobs").get(id));
  if (!blob) throw new Error("no está");
  return blob;
}

/* Devuelve un File, que es lo que el visor sabe abrir: así un
   documento guardado entra por el MISMO camino que uno de tu disco
   y hereda su punto de lectura (la clave del progreso es el nombre). */
export async function comoArchivo(meta) {
  const blob = await leer(meta.id);
  return new File([blob], meta.nombre, { type: meta.tipo || blob.type || "" });
}

export async function borrar(id) {
  const tx = await transaccion(["meta", "blobs"], "readwrite");
  tx.objectStore("meta").delete(id);
  tx.objectStore("blobs").delete(id);
  return new Promise((resolver, rechazar) => {
    tx.oncomplete = resolver;
    tx.onerror = tx.onabort = () => rechazar(tx.error);
  });
}

export async function existe(nombre, tamano) {
  try {
    const tx = await transaccion(["meta"], "readonly");
    return !!(await esperar(tx.objectStore("meta").get(idDe(nombre, tamano))));
  } catch (_) {
    return false;
  }
}

/* Cuánto ocupan tus descargas, sumando lo que dicen las fichas.
   `navigator.storage.estimate()` daría el total del sitio (caché del
   service worker incluida), que no es lo que se quiere enseñar aquí. */
export async function espacioUsado() {
  const fichas = await listar();
  return fichas.reduce((n, f) => n + (f.tamano || 0), 0);
}

/* Pedir almacenamiento «persistente». Sin esto, el navegador puede
   BORRAR lo guardado cuando le falte espacio, y un libro que creías
   descargado desaparecería. No siempre lo concede (depende de si has
   instalado la app, de cuánto la uses…), así que nunca se da por
   hecho: es una mejora, no un requisito. */
export async function pedirPersistencia() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (_) {
    return false;
  }
}

export function tamanoLegible(n) {
  if (!n && n !== 0) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
