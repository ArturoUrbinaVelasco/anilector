/* ============================================================
   AniLector — traducción del texto que estás leyendo
   ------------------------------------------------------------
   Usa el traductor QUE YA TRAE EL NAVEGADOR (Translator API +
   LanguageDetector API de Chrome/Edge). Por qué así y no con un
   servicio de traducción:

   · No cuesta nada y no necesita cuenta ni clave de API. El proyecto
     entero es de coste cero y una API de pago rompería eso.
   · El texto NO sale de tu equipo: traduce el propio navegador.
   · Una vez descargado el idioma, funciona SIN CONEXIÓN, igual que el
     resto del visor.

   ⚠️ LÍMITE REAL, comprobado en la documentación de Chrome (ago-2026):
   estas dos APIs existen en Chrome y Edge de ESCRITORIO. En Chrome de
   Android todavía NO. No es algo que se pueda sortear desde la web: si
   el navegador no las trae, no hay traductor local que valga. Por eso,
   cuando no están, en vez de un botón muerto se explica qué pasa y se
   recuerda que el propio navegador del móvil sabe traducir la página.

   Se descartó a propósito el OCR de manga (leer el texto dibujado en
   la página): Tesseract en el navegador falla justo con lo que haría
   falta — japonés vertical dentro de globos — y el modelo que sí lo
   hace bien no corre en un navegador. Más vale no tenerlo que tenerlo
   devolviendo basura.
   ============================================================ */
import { t } from "./i18n.js";

/* Nombres para enseñar al usuario; el resto se muestra por su código. */
const IDIOMAS = {
  es: "español", en: "inglés", ja: "japonés", ko: "coreano", zh: "chino",
  fr: "francés", de: "alemán", it: "italiano", pt: "portugués", ru: "ruso",
  ar: "árabe", hi: "hindi", tr: "turco", nl: "neerlandés", pl: "polaco",
  vi: "vietnamita", th: "tailandés", id: "indonesio",
};
export const nombreIdioma = (c) => IDIOMAS[c] || (c || "?").toUpperCase();

/* Idiomas ofrecidos como destino. */
export const DESTINOS = ["es", "en", "pt", "fr", "de", "it", "ja"];

/* ⚠️ COMPROBADO, y no es lo que parece: que `Translator` exista en
   `window` NO significa que el navegador pueda traducir. Chromium lo
   expone siempre, y si los modelos no están instalados:
     · `LanguageDetector.create()` falla limpio → "Model not available".
     · `Translator.availability()` TUMBA LA PESTAÑA entera.
   Por eso el orden importa: primero se detecta el idioma (que es la
   llamada segura y además hace falta igual), y solo si eso funciona se
   toca el traductor. Así, en un navegador sin modelos, nunca se llega a
   la llamada que rompe. */
export function hayTraductor() {
  return typeof self !== "undefined" && "Translator" in self && "LanguageDetector" in self;
}

function errorSinApi() {
  const e = new Error(t("reader.trNoApi"));
  e.sinApi = true;
  return e;
}

export function idiomaDestino() {
  try {
    const v = localStorage.getItem("anilector.trLang");
    if (v && DESTINOS.includes(v)) return v;
  } catch (_) {}
  try { return (localStorage.getItem("anilector.lang") || "es") === "en" ? "en" : "es"; }
  catch { return "es"; }
}
export function guardarDestino(codigo) {
  try { localStorage.setItem("anilector.trLang", codigo); } catch (_) {}
}

/* ---------- recorrer el texto ----------
   Se traducen NODOS DE TEXTO, no innerHTML: así se conservan intactos
   los enlaces, las cursivas y las imágenes del libro. */
const SALTAR = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA"]);

function nodosDeTexto(raiz) {
  const doc = raiz.ownerDocument || raiz;
  const salida = [];
  const paseo = doc.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      // Un texto de una o dos letras (viñetas, números de nota) no aporta
      // nada traducido y gasta una llamada.
      if (n.nodeValue.trim().length < 2) return NodeFilter.FILTER_REJECT;
      let p = n.parentElement;
      while (p && p !== raiz) {
        if (SALTAR.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        p = p.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = paseo.nextNode())) salida.push(n);
  return salida;
}

export function muestraDeTexto(raices, max = 1200) {
  let s = "";
  for (const r of raices) {
    if (!r) continue;
    for (const n of nodosDeTexto(r)) {
      s += n.nodeValue.trim() + " ";
      if (s.length >= max) return s.slice(0, max);
    }
  }
  return s.trim();
}

/* ---------- detección ----------
   Devuelve el código del idioma, o null si el texto no da para decidirlo.
   Si es el NAVEGADOR el que no puede, lanza un error con `sinApi`: son
   dos cosas distintas y merecen mensajes distintos. */
export async function detectarIdioma(texto) {
  if (!hayTraductor()) throw errorSinApi();
  if (!texto) return null;

  let d;
  try {
    d = await self.LanguageDetector.create();
  } catch (_) {
    throw errorSinApi();          // "Model not available" y similares
  }
  try {
    const mejor = (await d.detect(texto) || [])[0];
    // Por debajo de este nivel de certeza es una adivinanza, y traducir
    // desde el idioma equivocado destroza el texto.
    return (!mejor || mejor.confidence < 0.5) ? null : mejor.detectedLanguage;
  } catch (_) {
    return null;
  } finally {
    try { d.destroy?.(); } catch (_) {}
  }
}

/* ---------- traducción ---------- */
/* Guarda el original en el propio nodo para poder volver atrás sin
   recargar el documento. */
const ORIGINAL = new WeakMap();

export async function traducir(raices, { origen, destino, onEstado } = {}) {
  if (!hayTraductor()) throw errorSinApi();

  // Se pregunta por la pareja de idiomas, pero sin fiarlo todo a esta
  // llamada: si el navegador se atraganta, se sigue y que hable create().
  let disponible = "available";
  try {
    disponible = await self.Translator.availability({
      sourceLanguage: origen, targetLanguage: destino,
    });
  } catch (_) { disponible = "available"; }

  if (disponible === "unavailable") {
    throw new Error(t("reader.trPair")
      .replace("%s", nombreIdioma(origen)).replace("%s", nombreIdioma(destino)));
  }
  // "downloadable" = hay que bajar el idioma; puede tardar y pesa, así
  // que se avisa en vez de dejar la app aparentemente colgada.
  if (disponible !== "available") onEstado?.(t("reader.trDownloading"));

  let traductor;
  try {
    traductor = await self.Translator.create({
      sourceLanguage: origen,
      targetLanguage: destino,
      monitor(m) {
        m.addEventListener?.("downloadprogress", (e) => {
          const pct = Math.round((e.loaded || 0) * 100);
          onEstado?.(`${t("reader.trDownloading")} ${pct}%`);
        });
      },
    });
  } catch (_) {
    throw errorSinApi();
  }

  try {
    const nodos = raices.filter(Boolean).flatMap((r) => nodosDeTexto(r));
    let hechos = 0;
    for (const n of nodos) {
      if (!ORIGINAL.has(n)) ORIGINAL.set(n, n.nodeValue);
      try {
        n.nodeValue = await traductor.translate(ORIGINAL.get(n));
      } catch (_) {
        // Un párrafo que falle no debe tumbar el resto del capítulo.
      }
      if (++hechos % 12 === 0) {
        onEstado?.(`${t("reader.trWorking")} ${Math.round((hechos / nodos.length) * 100)}%`);
      }
    }
    return hechos;
  } finally {
    try { traductor.destroy?.(); } catch (_) {}
  }
}

export function restaurar(raices) {
  for (const r of raices.filter(Boolean)) {
    for (const n of nodosDeTexto(r)) {
      if (ORIGINAL.has(n)) n.nodeValue = ORIGINAL.get(n);
    }
  }
}
