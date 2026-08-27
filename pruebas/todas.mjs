/* ============================================================
   Ejecuta TODAS las suites y resume
   ------------------------------------------------------------
     npm test

   Se encarga de lo que antes había que recordar a mano:
     · genera los archivos de prueba (`fx/`) si faltan,
     · levanta el servidor local en el 8765 si no está ya,
     · pasa las suites una por una, en orden,
     · y al final dice cuántas van y cuáles fallaron.

   Cada suite es independiente y se puede lanzar suelta:
     node pruebas/test-v320.mjs
   ============================================================ */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = dirname(AQUI);
const PUERTO = Number(process.env.PORT || 8765);
const BASE = `http://localhost:${PUERTO}`;

/* En el orden en que se escribieron: si algo se rompe, se ve antes
   dónde empezó. `e2e-servidor` va al final porque levanta su propio
   servidor y es la más lenta. */
const SUITES = [
  "test-v311.mjs", "test-v312.mjs", "test-v313.mjs", "test-v314.mjs",
  "test-v315.mjs", "test-v316.mjs", "test-v318.mjs", "test-v319.mjs",
  "test-v320.mjs", "test-offline.mjs", "test-e2e-servidor.mjs",
];
const soloEstas = process.argv.slice(2);
const lista = soloEstas.length
  ? SUITES.filter((s) => soloEstas.some((x) => s.includes(x)))
  : SUITES;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function responde(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; }
  catch (_) { return false; }
}

/* --- 1. los archivos de prueba --- */
if (!existsSync(join(RAIZ, "fx", "grande.epub"))) {
  console.log("· generando los archivos de prueba…");
  const py = spawnSync(process.execPath, [join(AQUI, "fixtures.mjs")], { stdio: "inherit" });
  if (py.status !== 0) {
    console.error("\nNo pude generar `fx/`. ¿Está python instalado?\n");
    process.exit(1);
  }
}

/* --- 2. el servidor --- */
let servidor = null;
if (!(await responde(`${BASE}/index.html`))) {
  console.log(`· levantando el servidor en el ${PUERTO}…`);
  servidor = spawn(process.execPath, [join(RAIZ, "server.mjs")], {
    env: { ...process.env, PORT: String(PUERTO) },
    stdio: "ignore",
    detached: false,
  });
  for (let i = 0; i < 20 && !(await responde(`${BASE}/index.html`)); i++) await dormir(400);
  if (!(await responde(`${BASE}/index.html`))) {
    console.error("\nEl servidor no arrancó. Prueba a mano: npm start\n");
    process.exit(1);
  }
} else {
  console.log(`· ya había un servidor en el ${PUERTO}`);
}

/* --- 3. las suites --- */
const resultados = [];
for (const suite of lista) {
  process.stdout.write(`\n══ ${suite} ${"═".repeat(Math.max(0, 46 - suite.length))}\n`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(AQUI, suite)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PUERTO) },
  });
  const salida = (r.stdout?.toString() || "") + (r.stderr?.toString() || "");
  const ultima = salida.trim().split("\n").filter((l) => /bien, \d+ mal/.test(l)).pop() || "";
  const m = ultima.match(/(\d+) bien, (\d+) mal/);
  const bien = m ? Number(m[1]) : 0;
  const mal = m ? Number(m[2]) : NaN;
  resultados.push({ suite, bien, mal, seg: ((Date.now() - t0) / 1000).toFixed(1) });

  if (!m || mal > 0) {
    // Si algo falló, se enseña la salida entera: es cuando hace falta.
    console.log(salida.trimEnd());
  } else {
    console.log(`   ${bien} bien, 0 mal   (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}

servidor?.kill();

/* --- 4. el resumen --- */
console.log("\n" + "─".repeat(52));
let total = 0, rotas = 0;
for (const r of resultados) {
  const estado = Number.isNaN(r.mal) ? "  ¿?" : r.mal ? `${r.mal} MAL` : "  ok";
  console.log(`  ${r.suite.padEnd(24)} ${String(r.bien).padStart(4)} ${estado.padStart(7)}  ${r.seg.padStart(6)} s`);
  total += r.bien;
  if (r.mal || Number.isNaN(r.mal)) rotas++;
}
console.log("─".repeat(52));
console.log(rotas
  ? `\n  \x1b[31m${total} pruebas pasaron, pero ${rotas} suite(s) fallaron.\x1b[0m\n`
  : `\n  \x1b[32m${total} pruebas, todas en verde.\x1b[0m\n`);
process.exit(rotas ? 1 : 0);
