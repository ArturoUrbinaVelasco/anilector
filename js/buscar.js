/* ============================================================
   AniLector — buscar DENTRO del documento
   ------------------------------------------------------------
   Esto estuvo mucho tiempo en la lista como «lo más caro» con el
   motivo equivocado: que el PDF se dibuja como una imagen. Eso es
   verdad de cómo se PINTA, pero no de lo que hay dentro: pdf.js
   entrega el texto de cada página con `getTextContent()`. Lo único
   que de verdad no se puede buscar es un PDF ESCANEADO, que es una
   foto de una página y no lleva texto ninguno — y eso hay que
   decirlo con todas las letras en vez de devolver «sin resultados»,
   que haría pensar que la palabra no está.

   Cada formato se busca como se puede buscar:
     · PDF   → texto por página; se salta a la página y se marcan
               los trozos encontrados sobre el dibujo.
     · EPUB  → epub.js busca por capítulos y devuelve un CFI, que
               es la dirección exacta dentro del libro.
     · MOBI, texto, Markdown y HTML → el documento ya está (o se
               termina de cargar) en la página: se recorre el texto
               de verdad y se envuelve lo hallado en <mark>.
     · Cómics e imágenes → no hay texto que buscar. Se dice.

   El texto extraído se guarda mientras el documento esté abierto:
   la primera búsqueda en un PDF de 300 páginas cuesta unos
   segundos, las siguientes son inmediatas.
   ============================================================ */
import { t } from "./i18n.js";

const TOPE = 300;          // resultados: más que esto no se lee nadie
const CONTEXTO = 45;       // caracteres a cada lado del hallazgo

let puente = null;         // lo que el visor presta: estado y navegación
let cache = { clave: null, paginas: null };
let resaltados = [];       // <mark> puestos, para poder quitarlos

export function initBuscar(p) { puente = p; }

/* Al abrir otro documento no vale nada de lo anterior. */
export function reiniciarBuscador() {
  cache = { clave: null, paginas: null };
  resaltados = [];
}

/* Comparar sin tildes ni mayúsculas: quien busca «mexico» espera
   encontrar «México», y quien busca «Ángel» espera «angel». */
export function normalizar(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
const limpiarEspacios = (s) => String(s || "").replace(/\s+/g, " ").trim();

/* Un trocito alrededor del hallazgo, para reconocerlo sin abrirlo.
   ⚠️ Los espacios PEGADOS al hallazgo no se pueden recortar: si se
   recortan, «El murcielago vuela» se lee «Elmurcielagovuela» en la lista
   de resultados. Se recorta solo por fuera. */
const colapsar = (s) => String(s || "").replace(/\s+/g, " ");
function contexto(texto, i, largo) {
  const ini = Math.max(0, i - CONTEXTO);
  const fin = Math.min(texto.length, i + largo + CONTEXTO);
  return {
    antes: (ini > 0 ? "…" : "") + colapsar(texto.slice(ini, i)).replace(/^ +/, ""),
    hallado: texto.slice(i, i + largo),
    despues: colapsar(texto.slice(i + largo, fin)).replace(/ +$/, "") + (fin < texto.length ? "…" : ""),
  };
}

/* Todas las posiciones de `aguja` en `pajar`, ya normalizados ambos.
   Se busca sobre el normalizado pero se recorta del ORIGINAL, y por eso
   la normalización no puede cambiar la longitud: quitar tildes con NFD
   la cambiaría, así que se normaliza carácter a carácter. */
function normalMismaLongitud(s) {
  let out = "";
  for (const c of s) {
    const n = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    out += n.length === 1 ? n : c.toLowerCase();
  }
  return out;
}
function posiciones(pajar, aguja) {
  const p = normalMismaLongitud(pajar), a = normalMismaLongitud(aguja);
  const res = [];
  let i = p.indexOf(a);
  while (i !== -1 && res.length < TOPE) {
    res.push(i);
    i = p.indexOf(a, i + a.length);
  }
  return res;
}

/* ---------- PDF ---------- */
/* El texto llega en trozos sueltos con su posición. Se pegan en una
   cadena y se apunta qué intervalo ocupa cada trozo, que es lo que
   permite después dibujar el recuadro encima de lo encontrado. */
async function textoDePagina(pdf, n) {
  const page = await pdf.getPage(n);
  const tc = await page.getTextContent();
  let texto = "";
  const trozos = [];
  for (const it of tc.items) {
    const s = it.str || "";
    if (s) {
      trozos.push({ ini: texto.length, fin: texto.length + s.length, it });
      texto += s;
    }
    // `hasEOL` marca fin de línea: sin este espacio, la última palabra de
    // una línea y la primera de la siguiente saldrían pegadas.
    if (it.hasEOL) texto += " ";
  }
  return { texto, trozos };
}

async function extraerPdf(pdf, clave, alProgreso, señal) {
  if (cache.clave === clave && cache.paginas) return cache.paginas;
  const paginas = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    if (señal?.aborted) throw new Error("cancelado");
    paginas.push(await textoDePagina(pdf, n));
    alProgreso?.(n, pdf.numPages);
  }
  cache = { clave, paginas };
  return paginas;
}

async function buscarEnPdf(consulta, alProgreso, señal) {
  const { estado } = puente;
  const paginas = await extraerPdf(estado.pdf, estado.docKey, alProgreso, señal);

  // ¿Hay texto siquiera? Un escaneo devuelve páginas vacías: decirlo es
  // la diferencia entre «no está» y «aquí no se puede buscar».
  const total = paginas.reduce((n, p) => n + p.texto.trim().length, 0);
  if (total < paginas.length * 2) {
    return { escaneado: true, resultados: [] };
  }

  const resultados = [];
  paginas.forEach((p, i) => {
    for (const pos of posiciones(p.texto, consulta)) {
      if (resultados.length >= TOPE) break;
      resultados.push({
        etiqueta: `${t("reader.page")} ${i + 1}`,
        ...contexto(p.texto, pos, consulta.length),
        ir: { modo: "pdf", pagina: i + 1, ini: pos, fin: pos + consulta.length },
      });
    }
  });
  return { escaneado: false, resultados };
}

/* Los recuadros sobre el dibujo.
   pdf.js da la posición y el ancho de cada TROZO de texto, no de cada
   letra. Marcar el trozo entero pinta la línea completa cuando el PDF
   escribe una frase de una sola vez, que es lo normal. Así que se
   reparte el ancho del trozo entre sus caracteres: exacto en una
   tipografía de ancho fijo y muy aproximado en el resto, pero infinitamente
   mejor que subrayar la línea entera. Medir cada letra de verdad exigiría
   cargar la tipografía y medirla, y no compensa. */
export function trozosAMarcar(pagina, ini, fin) {
  const p = cache.paginas?.[pagina - 1];
  if (!p) return [];
  const marcas = [];
  for (const x of p.trozos) {
    if (x.ini >= fin || x.fin <= ini) continue;
    const largo = x.fin - x.ini || 1;
    const desde = Math.max(0, ini - x.ini) / largo;          // 0..1
    const hasta = Math.min(largo, fin - x.ini) / largo;      // 0..1
    marcas.push({ it: x.it, desde, hasta });
  }
  return marcas;
}

/* ---------- EPUB ---------- */
async function buscarEnEpub(consulta, alProgreso, señal) {
  const libro = puente.estado.epubBook;
  const items = libro?.spine?.spineItems || [];
  const resultados = [];
  for (let i = 0; i < items.length; i++) {
    if (señal?.aborted) throw new Error("cancelado");
    const item = items[i];
    try {
      await item.load(libro.load.bind(libro));
      // `find` de epub.js devuelve [{ cfi, excerpt }] por capítulo.
      for (const h of item.find(consulta) || []) {
        if (resultados.length >= TOPE) break;
        const trozo = limpiarEspacios(h.excerpt || "");
        const donde = normalizar(trozo).indexOf(normalizar(consulta));
        resultados.push({
          etiqueta: item.idref || `${t("reader.chapter")} ${i + 1}`,
          ...(donde >= 0
            ? contexto(trozo, donde, consulta.length)
            : { antes: "", hallado: trozo, despues: "" }),
          ir: { modo: "epub", cfi: h.cfi },
        });
      }
    } catch (_) { /* un capítulo ilegible no debe parar la búsqueda */ }
    finally { try { item.unload(); } catch (_) {} }
    alProgreso?.(i + 1, items.length);
  }
  return { escaneado: false, resultados };
}

/* ---------- lo que vive en la página (MOBI, texto, Markdown, HTML) ---------- */
/* Se recorren los nodos de texto de verdad, no `innerHTML`: así las
   posiciones que se guardan sirven para resaltar exactamente ahí. */
function nodosDeTexto(raiz) {
  const salida = [];
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      const p = n.parentElement;
      if (!p || ["SCRIPT", "STYLE", "MARK"].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = w.nextNode())) salida.push(n);
  return salida;
}

async function buscarEnPagina(consulta, alProgreso, señal) {
  // MOBI carga por tandas: para buscar en todo el libro hay que tenerlo
  // todo. Es lo que pide quien busca, y se enseña el avance.
  if (puente.cargarTodo) await puente.cargarTodo(alProgreso, señal);
  const raiz = puente.cuerpo();
  const resultados = [];
  for (const nodo of nodosDeTexto(raiz)) {
    if (señal?.aborted) throw new Error("cancelado");
    const texto = nodo.nodeValue;
    for (const pos of posiciones(texto, consulta)) {
      if (resultados.length >= TOPE) break;
      const sec = nodo.parentElement?.closest?.(".ebook-section")?.dataset?.sec;
      resultados.push({
        etiqueta: sec != null ? `${t("reader.section")} ${Number(sec) + 1}` : "",
        ...contexto(texto, pos, consulta.length),
        ir: { modo: "pagina", nodo, pos, largo: consulta.length, sec: sec != null ? Number(sec) : null },
      });
    }
    if (resultados.length >= TOPE) break;
  }
  return { escaneado: false, resultados };
}

/* ---------- entrada ---------- */
export async function buscar(consulta, { alProgreso, señal } = {}) {
  const q = String(consulta || "").trim();
  if (q.length < 2) return { corta: true, resultados: [] };
  const modo = puente.estado.mode;

  if (modo === "pdf" && puente.estado.pdf) return buscarEnPdf(q, alProgreso, señal);
  if (modo === "epub" && puente.estado.epubBook) return buscarEnEpub(q, alProgreso, señal);
  if (["mobi", "text", "html"].includes(modo)) return buscarEnPagina(q, alProgreso, señal);
  return { sinTexto: true, resultados: [] };
}

/* ---------- resaltado en la página ---------- */
export function quitarResaltado() {
  for (const m of resaltados) {
    const p = m.parentNode;
    if (!p) continue;
    p.replaceChild(document.createTextNode(m.textContent), m);
    p.normalize();     // vuelve a juntar los trozos de texto partidos
  }
  resaltados = [];
}

export function resaltar(nodo, pos, largo) {
  quitarResaltado();
  try {
    const rango = document.createRange();
    rango.setStart(nodo, pos);
    rango.setEnd(nodo, pos + largo);
    const marca = document.createElement("mark");
    marca.className = "busca-hit";
    rango.surroundContents(marca);
    resaltados.push(marca);
    marca.scrollIntoView({ block: "center", behavior: "smooth" });
    return marca;
  } catch (_) {
    // El nodo puede haberse repintado desde que se buscó; en ese caso al
    // menos se salta a la sección, que es lo que hace quien llama.
    return null;
  }
}
