/* ============================================================
   AniLector — peticiones de red con límite de tiempo
   ------------------------------------------------------------
   POR QUÉ EXISTE ESTE ARCHIVO

   Un `fetch` sin límite de tiempo NO falla nunca: si el servidor
   acepta la conexión y luego se calla, la promesa se queda ahí
   colgada y el indicador de carga gira para siempre. Es el peor
   fallo posible, porque no se distingue de «va lento» y no deja
   rastro en ninguna parte.

   `api.js` y `youtube.js` ya lo hacían bien cada uno por su
   cuenta; `media.js`, `vod.js` y `tv.js` no lo hacían en
   absoluto. Aquí está el mismo comportamiento una sola vez:

     · Límite de tiempo (12 s por defecto) con AbortController.
     · UN reintento en fallo de red, 429 (límite de peticiones) y
       5xx (caída pasajera) — que son los que se arreglan solos.
       Un 404 o un 401 NO se reintentan: repetirlos da lo mismo.
     · Mensajes en español que dicen qué pasó, no «Failed to fetch».
   ============================================================ */
import { t } from "./i18n.js";

export const LIMITE = 12000;

/* Un fallo con causa reconocible. `estado` es el código HTTP si
   lo hubo; `agotado` marca el que se pasó de tiempo. */
export class ErrorDeRed extends Error {
  constructor(mensaje, extra = {}) {
    super(mensaje);
    this.name = "ErrorDeRed";
    Object.assign(this, extra);
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pedir(url, opciones = {}) {
  const {
    limite = LIMITE,
    reintentos = 1,
    etiqueta = "",
    ...resto
  } = opciones;

  let ultimo;
  for (let intento = 0; intento <= reintentos; intento++) {
    const ctrl = new AbortController();
    // Si quien llama ya trae su propio AbortSignal, se respeta:
    // cancelar desde fuera debe seguir funcionando.
    if (resto.signal) {
      if (resto.signal.aborted) ctrl.abort();
      else resto.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }
    const reloj = setTimeout(() => ctrl.abort(), limite);
    let res;
    try {
      res = await fetch(url, { ...resto, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(reloj);
      // Cancelado desde fuera: no es un fallo, no se reintenta.
      if (resto.signal?.aborted) throw e;
      const agotado = e?.name === "AbortError";
      ultimo = new ErrorDeRed(
        agotado ? t("red.agotado").replace("%s", String(limite / 1000)) : t("red.sinRed"),
        { agotado, etiqueta, causa: e });
      if (intento < reintentos) { await dormir(900 * (intento + 1)); continue; }
      throw ultimo;
    } finally { clearTimeout(reloj); }

    if (res.ok) return res;

    // Solo lo que puede arreglarse solo merece otra oportunidad.
    if ((res.status === 429 || res.status >= 500) && intento < reintentos) {
      await dormir(res.status === 429 ? 1400 : 900);
      continue;
    }
    throw new ErrorDeRed(
      res.status === 429 ? t("red.limite") : `${etiqueta || "HTTP"} ${res.status}`,
      { estado: res.status, etiqueta });
  }
  throw ultimo;
}

export async function pedirJson(url, opciones = {}) {
  const res = await pedir(url, opciones);
  return res.status === 204 ? null : res.json();
}
