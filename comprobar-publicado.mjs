/* ============================================================
   AniLector — comprobar lo que hay PUBLICADO
   ------------------------------------------------------------
   Las pruebas comprueban el código de esta carpeta. Esto comprueba
   lo que de verdad están sirviendo a los navegadores, que no es lo
   mismo: un archivo que no se subió, un despliegue a medias o una
   caché de GitHub Pages tardona no se ven de ninguna otra forma.

     node comprobar-publicado.mjs

   Mira tres cosas:
     1. Que la versión del service worker publicado coincide con la
        de este sw.js. Si no, es que el despliegue aún no ha subido
        (GitHub Pages tarda 1-2 min) o que faltó hacer push.
     2. Que TODOS los archivos del esqueleto responden 200. Si uno
        falta, la app se instala «bien» pero se rompe sin conexión.
     3. Que el manifiesto y el index están donde deben.

   Sale con código 1 si algo falla, para poder encadenarlo.
   ============================================================ */
import { readFile } from "node:fs/promises";

const SITIO = process.argv[2] || "https://arturourbinavelasco.github.io/anilector/";
const base = SITIO.replace(/\/*$/, "/");

let mal = 0;
const bien = (t) => console.log("  \x1b[32m✓\x1b[0m " + t);
const fallo = (t) => { mal++; console.log("  \x1b[31m✗\x1b[0m " + t); };

console.log(`\nComprobando ${base}\n`);

/* --- 1. la versión --- */
const local = await readFile(new URL("./sw.js", import.meta.url), "utf8");
const vLocal = (local.match(/const VERSION = "([^"]+)"/) || [])[1];

let vPublicada = null, swTexto = "";
try {
  const r = await fetch(base + "sw.js", { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  swTexto = await r.text();
  vPublicada = (swTexto.match(/const VERSION = "([^"]+)"/) || [])[1];
} catch (e) {
  fallo(`no se pudo leer el sw.js publicado: ${e.message}`);
}

if (vPublicada) {
  if (vPublicada === vLocal) bien(`versión publicada ${vPublicada} (coincide)`);
  else fallo(`aquí ${vLocal}, publicado ${vPublicada} — ¿falta publicar, o GitHub Pages aún no ha refrescado?`);
}

/* --- 2. el esqueleto entero --- */
const shell = [...(swTexto.match(/"\.\/[^"]+"/g) || [])]
  .map((s) => s.slice(3, -1))
  .filter((s) => s && !s.startsWith("__"));

if (!shell.length) {
  fallo("no pude leer la lista de archivos del esqueleto");
} else {
  const resultados = await Promise.all(shell.map(async (ruta) => {
    try {
      const r = await fetch(base + ruta, { method: "HEAD", cache: "no-store" });
      return { ruta, estado: r.status };
    } catch (e) { return { ruta, estado: 0, error: e.message }; }
  }));
  const rotos = resultados.filter((r) => r.estado !== 200);
  if (rotos.length) {
    fallo(`${rotos.length} de ${shell.length} archivos del esqueleto NO responden:`);
    for (const r of rotos.slice(0, 12)) console.log(`      ${r.estado || "sin respuesta"}  ${r.ruta}`);
  } else {
    bien(`los ${shell.length} archivos del esqueleto responden`);
  }
}

/* --- 3. lo mínimo para que la app arranque --- */
for (const [ruta, que] of [["index.html", "la página"], ["manifest.webmanifest", "el manifiesto"]]) {
  try {
    const r = await fetch(base + ruta, { cache: "no-store" });
    r.ok ? bien(`${que} responde`) : fallo(`${que} responde ${r.status}`);
  } catch (e) { fallo(`${que} no responde: ${e.message}`); }
}

console.log(mal ? `\n\x1b[31m${mal} problema(s).\x1b[0m\n` : "\n\x1b[32mTodo correcto.\x1b[0m\n");
process.exit(mal ? 1 : 0);
