/* Genera los archivos de prueba (`fx/`) llamando a `make-fx.py`.
   Existe para que `npm run fixtures` funcione igual en Windows, donde el
   intérprete se llama `python`, y en Linux o macOS, donde es `python3`. */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const guion = join(dirname(fileURLToPath(import.meta.url)), "make-fx.py");
const candidatos = process.platform === "win32"
  ? ["python", "py", "python3"]
  : ["python3", "python"];

for (const py of candidatos) {
  const r = spawnSync(py, [guion], { stdio: "inherit" });
  if (r.status === 0) process.exit(0);
  if (r.error?.code !== "ENOENT") process.exit(r.status ?? 1);
}

console.error(`
  No encuentro Python, que es lo que genera los archivos de prueba.
  Instálalo (python.org) y repite:  npm run fixtures
`);
process.exit(1);
