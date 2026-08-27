/* ============================================================
   Lo que toda prueba necesita: navegador y servidor
   ------------------------------------------------------------
   Las suites usaban una ruta absoluta a Playwright, que solo
   existía en la máquina donde se escribieron. Aquí se resuelve
   una vez, en un sitio, con dos caminos:

     1. `playwright` instalado normalmente (npm i), que es lo que
        pasa al clonar el repositorio en cualquier equipo.
     2. Una instalación global, por si alguien lo tiene así.

   Si no está, se dice qué hay que teclear en vez de reventar con
   «Cannot find package», que no ayuda a nadie.
   ============================================================ */
let mod = null;
try {
  mod = await import("playwright");
} catch (_) {
  for (const ruta of [
    "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs",
    "/usr/local/lib/node_modules/playwright/index.mjs",
    `${process.env.APPDATA || ""}/npm/node_modules/playwright/index.mjs`,
  ]) {
    try { mod = await import(ruta); break; } catch (_) { /* siguiente */ }
  }
}

if (!mod) {
  console.error(`
  No encuentro Playwright, que es lo que abre el navegador de las pruebas.

    npm install            (instala lo que hace falta)
    npx playwright install chromium

  Y luego, desde la carpeta del repositorio:

    npm test
`);
  process.exit(1);
}

export const { chromium } = mod;

/* ---------- el servidor de la app ----------
   Todas las suites piden páginas a http://localhost:8765. Si no hay
   nadie escuchando, el fallo era un `ECONNREFUSED` en mitad de la
   primera petición, que no dice qué hacer. */
const PUERTO = Number(process.env.PORT || 8765);
export const BASE = `http://localhost:${PUERTO}`;

try {
  const r = await fetch(`${BASE}/index.html`, { signal: AbortSignal.timeout(2500) });
  if (!r.ok) throw new Error("HTTP " + r.status);
} catch (_) {
  console.error(`
  No hay nadie sirviendo la app en ${BASE}.

    npm start            (en otra terminal) y vuelve a lanzar esta prueba
    npm test             (pasa TODAS las suites y levanta el servidor solo)
    npm test -- v320     (una sola suite, con el servidor incluido)
`);
  process.exit(1);
}
