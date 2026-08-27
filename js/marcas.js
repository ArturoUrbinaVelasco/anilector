/* ============================================================
   AniLector — marcadores con nota
   ------------------------------------------------------------
   Un lector sin marcadores obliga a recordar el número de página
   para volver a un sitio. Aquí cada marca guarda DÓNDE (en el
   idioma de cada formato: página en PDF, CFI en EPUB, sección y
   desplazamiento en MOBI y texto, índice en los cómics) y una nota
   opcional para saber por qué la dejaste.

   Se guardan bajo la HUELLA del documento (v3.19), así que valen
   aunque muevas o renombres el archivo, y no se confunden entre dos
   archivos con el mismo nombre.

   Entran en la copia de seguridad y en la sincronización con Drive:
   son datos que costaría rehacer, al contrario que la caché.
   ============================================================ */
const CLAVE = "anilector.marcas";
const TOPE_DOC = 200;      // por documento; de sobra para cualquier lectura

function todas() {
  try { return JSON.parse(localStorage.getItem(CLAVE) || "{}"); }
  catch { return {}; }
}
function guardarTodas(m) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(m));
    window.dispatchEvent(new Event("anilector:datachanged"));
    return true;
  } catch (_) {
    // Sin sitio: se avisa igual que con el progreso, no se pierde en silencio.
    window.dispatchEvent(new CustomEvent("anilector:almacenlleno"));
    return false;
  }
}

export function listar(docKey) {
  if (!docKey) return [];
  const l = todas()[docKey] || [];
  // Más recientes primero: es el orden en que se buscan.
  return [...l].sort((a, b) => (b.t || 0) - (a.t || 0));
}

export function añadir(docKey, { pos, etiqueta = "", nota = "" }) {
  if (!docKey || !pos) return null;
  const m = todas();
  const lista = m[docKey] || [];
  const marca = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    pos, etiqueta, nota, t: Date.now(),
  };
  lista.push(marca);
  // Si alguien llega a 200 marcas en un documento, se tira la más vieja.
  m[docKey] = lista.slice(-TOPE_DOC);
  return guardarTodas(m) ? marca : null;
}

export function editarNota(docKey, id, nota) {
  const m = todas();
  const marca = (m[docKey] || []).find((x) => x.id === id);
  if (!marca) return false;
  marca.nota = String(nota || "").slice(0, 500);
  return guardarTodas(m);
}

export function borrar(docKey, id) {
  const m = todas();
  if (!m[docKey]) return false;
  m[docKey] = m[docKey].filter((x) => x.id !== id);
  if (!m[docKey].length) delete m[docKey];
  return guardarTodas(m);
}

export function cuantas(docKey) {
  return (todas()[docKey] || []).length;
}

/* Al borrar un documento de «Mis descargas» no tiene sentido conservar
   sus marcas, pero tampoco se borran a la ligera: solo cuando quien
   llama lo pide expresamente. */
export function borrarDoc(docKey) {
  const m = todas();
  if (!m[docKey]) return false;
  delete m[docKey];
  return guardarTodas(m);
}
