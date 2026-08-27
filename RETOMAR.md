# Retomar AniLector en cualquier equipo

Todo lo que hace falta para clonar esto en otra máquina, verlo funcionando,
pasar las pruebas y seguir. Sin depender de ninguna conversación anterior.

---

## En cinco minutos

```bash
git clone https://github.com/ArturoUrbinaVelasco/anilector.git
cd anilector

npm install                        # solo Playwright, para las pruebas
npx playwright install chromium    # el navegador con el que se prueba

npm start                          # http://localhost:8765
npm test                           # las 432 pruebas
```

`npm start` levanta `server.mjs`, que sirve el sitio tal cual con los tipos MIME
correctos (hace falta el de `.wasm`). En Windows también sirve
`Iniciar-AniLector.bat`.

**Node 18 o superior** (usa `fetch` nativo). Para regenerar los archivos de
prueba hace falta **Python 3**, pero `npm test` lo hace solo.

---

## Probar a mano

Abre `http://localhost:8765` y pasa por esto, que es lo que cubre la app:

| Apartado | Qué probar |
|---|---|
| **TV en vivo** | Elegir lista, buscar canal, reproducir |
| **Mi servidor** | Ver abajo: hay un Jellyfin de mentira para esto |
| **Películas / Series retro** | Catálogos del Internet Archive; se reproducen dentro |
| **YouTube** | Buscar, encadenar, pegar un enlace |
| **Anime / Manga / Libros** | Buscar, abrir ficha, filtros de libros |
| **El visor** | Arrastra un PDF, un EPUB o un CBZ a la ventana |
| **Buscar dentro** | 🔍 en la barra del visor. Prueba con y sin tildes |
| **Marcadores** | 🔖 poner, escribir nota, volver |
| **Seguir leyendo** | Cierra un documento a medias y mira «Mi Biblioteca» |
| **Mis descargas** | 📥 en el visor guarda el archivo dentro de la app |
| **Sin conexión** | Modo avión y recarga: el visor y lo guardado siguen |

### «Mi servidor» sin tener un servidor
Hay un Jellyfin de mentira que habla como uno de verdad:

```bash
npm run servidor-de-pruebas        # http://localhost:8096
```
En **Mi servidor → Conexión**: URL `http://localhost:8096`, clave cualquier
texto. Los dos por `http`: si abres la app por `https`, el navegador bloquea un
servidor en `http` y no hay forma de saltarlo.

Trae interruptores para romperlo a propósito y ver qué dice el panel en cada
caso — `--sin-cabecera`, `--clave-mala`, `--no-soy-jellyfin`, `--vistas-vacias`,
`--rutas-viejas`, `--sin-tv`. Todo está en `pruebas-servidor/LEEME.md`.

---

## Las pruebas

```bash
npm test              # todas, con resumen
npm test -- v320      # una suite suelta (levanta el servidor si hace falta)
node pruebas/test-v320.mjs    # a pelo, con `npm start` corriendo en otra terminal
```

Son **432** repartidas en 11 suites. No usan internet: cada API externa está
simulada con `page.route`, salvo `test-e2e-servidor.mjs`, que levanta un
servidor HTTP **de verdad** en otro puerto para probar CORS y preflight, que es
lo único que los simulacros no pueden probar.

| Suite | Qué cubre |
|---|---|
| `test-v311` | Índice, tipografía, traductor, «ir a página» |
| `test-v312` | Progreso en EPUB y MOBI, pellizco para acercar |
| `test-v313` | «Mis descargas» (IndexedDB) |
| `test-v314` | Arrastrar y soltar, abrir desde el sistema, compartir |
| `test-v315` | Libros: filtros, gratis primero, bibliotecas de México |
| `test-v316` | Internet Archive, y que no se cuele ninguna API de extracción |
| `test-v318` | «Mi servidor» con un Jellyfin simulado y sus averías |
| `test-v319` | Robustez: avisos, límites de tiempo, poda, huellas, caché |
| `test-v320` | Buscar dentro, marcadores, «seguir leyendo» |
| `test-offline` | Que la app abre y lee sin conexión |
| `test-e2e-servidor` | Servidor HTTP real: CORS, preflight, vídeo, rangos |

### Si algo falla
- **`ECONNREFUSED` en el 8765** → falta `npm start`, o usa `npm test`.
- **Una prueba de vídeo con `readyState: 0`** → el Chromium de Playwright viene
  **sin H.264 ni AAC**. No es la app: usa WebM (`--webm` en el servidor de
  pruebas). Chrome y Edge normales reproducen los dos.
- **`test-offline` falla una** → es algo inestable. Repítela antes de investigar.
- **El puerto 8096 ocupado** → el servidor de pruebas lo dirá con esas palabras.

---

## Publicar

```powershell
.\publicar.ps1 "v3.21: lo que trae esta versión"
node comprobar-publicado.mjs
```

`publicar.ps1` **sube el `VERSION` de `sw.js`** —sin eso los navegadores siguen
sirviendo la copia guardada—, hace `add`, `commit`, `pull --rebase` y `push`, y
se para en cuanto algo falla.

`comprobar-publicado.mjs` mira el sitio **ya publicado**: que la versión
coincida y que los 34 archivos del esqueleto respondan. GitHub Pages tarda 1-2
minutos, así que reintenta solo. Ejecútalo desde una máquina con salida a
internet.

⚠️ **Si Windows bloquea el script**:
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

---

## Estado al 27/08/2026

**Publicado y vivo: v3.19.** En la carpeta, sin publicar: **v3.20** (buscar
dentro del documento, marcadores con nota, «seguir leyendo») y esta preparación
del repositorio.

https://arturourbinavelasco.github.io/anilector/

### Lo que falta por probar a mano
1. **Buscar dentro** de un PDF grande de verdad y de un EPUB largo.
2. Los **filtros de libros** con búsquedas reales: es lo único que no se puede
   verificar en un entorno sin internet, porque esas APIs no se alcanzan.
3. **Reinstalar la app** para que Windows registre el doble clic sobre un
   archivo y Android el «Compartir con AniLector».
4. El **televisor con el mando** y el **pellizco con dos dedos** en el móvil.

### Ideas que quedan en la lista
- **Mi servidor**: continuar donde se quedó (`PlaybackPositionTicks`), marcar
  como visto al terminar, subtítulos, y entrar con usuario y contraseña para no
  tener que crear una clave de API.
- **Atajos del manifiesto** (`shortcuts`) para abrir directo en TV o YouTube.
- **Canales gratis oficiales** (Pluto TV, Canela, Samsung TV Plus) vía iptv-org.
- **OCR** para poder buscar dentro de PDF escaneados. Hoy se detectan y se
  avisa; buscarlos de verdad costaría ~2 MB de librería y segundos por página.

---

## Dos reglas de la casa

**1. Solo fuentes abiertas y legales.** Ver `ARQUITECTURA.md`. Hay una prueba
que rastrea el repositorio buscando referencias a APIs de extracción y **falla**
si alguna aparece. Si algún día parece buena idea añadir un «proxy de vídeo»
configurable, la respuesta ya está pensada: *dónde se guarda la URL nunca fue el
problema*.

**2. Sube el `VERSION` de `sw.js` en cada publicación.** Es el único paso
manual que no perdona, y `publicar.ps1` lo hace por ti.

---

## Estructura

```
index.html          la app entera, una sola página
js/                 23 módulos ES nativos, sin compilar
css/styles.css      todos los estilos
vendor/             pdf.js, epub.js, JSZip, libarchive, MOBI (a propósito aquí)
sw.js               service worker: caché versionada y compartir
server.mjs          servidor de desarrollo (tipos MIME correctos)
pruebas/            las 11 suites + generador de archivos de prueba
pruebas-servidor/   un Jellyfin de mentira para probar «Mi servidor»
publicar.ps1        publicar en GitHub Pages, con red de seguridad
comprobar-publicado.mjs   comprobar lo que de verdad se está sirviendo
ARQUITECTURA.md     cómo está hecho y por qué
```
