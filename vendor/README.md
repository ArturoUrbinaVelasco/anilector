# vendor/ — librerías de terceros

Estas librerías se guardan **dentro del repo** (no se cargan desde un CDN) por dos motivos:

1. **libarchive** corre en un Web Worker, y los navegadores **prohíben crear un Worker
   desde otro dominio**. Tiene que ser del mismo origen que la app.
2. El `worker-bundle.js` busca `libarchive.wasm` **junto a él**; si se separan, no carga.

3. Desde que la app es **instalable**, todo lo que el visor necesita tiene que
   funcionar **sin conexión**, y el service worker solo puede guardar archivos
   de este mismo sitio. Por eso JSZip, pdf.js y epub.js también viven aquí.
   (hls.js y mpegts.js siguen en CDN a propósito: los canales de TV en vivo
   necesitan internet de todos modos.)

`libarchive`, `foliate` y `marked` se cargan **bajo demanda** (`import()`
dinámico): solo se descargan al abrir un archivo de ese tipo. `jszip`,
`pdfjs` y `epubjs` entran con `<script defer>` desde `index.html`.

| Carpeta | Qué es | Para qué | Licencia |
|---|---|---|---|
| `libarchive/` | [libarchive.js](https://github.com/nika-begiashvili/libarchivejs) 2.0.2 | RAR v4/v5, 7z, TAR, ZIP (y CBR/CB7/CBT/CBZ), con contraseña | MIT |
| `foliate/` | [foliate-js](https://github.com/johnfactotum/foliate-js) `mobi.js` | MOBI y AZW3 (Kindle) | MIT |
| `marked.esm.js` | [marked](https://github.com/markedjs/marked) 18 | Markdown con formato | MIT |
| `jszip/` | [JSZip](https://github.com/Stuk/jszip) 3.10.1 | Abrir ZIP/CBZ y armar el CBZ al guardar | MIT |
| `pdfjs/` | [pdf.js](https://github.com/mozilla/pdf.js) 3.11.174 | PDF (visor + su worker, siempre juntos) | Apache-2.0 |
| `epubjs/` | [epub.js](https://github.com/futurepress/epub.js) 0.3.93 | EPUB (usa JSZip por debajo) | BSD |

## Cómo actualizarlas

```bash
npm pack libarchive.js@2.0.2 foliate-js marked jszip pdfjs-dist@3.11.174 epubjs@0.3.93
# descomprimir y copiar:
#   libarchive.js/dist/{libarchive.js,worker-bundle.js,libarchive.wasm} -> vendor/libarchive/
#   foliate-js/mobi.js                                                  -> vendor/foliate/
#   marked/lib/marked.esm.js                                            -> vendor/marked.esm.js
#   jszip/dist/jszip.min.js                                             -> vendor/jszip/
#   pdfjs-dist/build/{pdf.min.js,pdf.worker.min.js}                     -> vendor/pdfjs/
#   epubjs/dist/epub.min.js                                             -> vendor/epubjs/
```

Los tres archivos de `libarchive/` van **siempre juntos**: si actualizas uno, actualiza los tres.
Lo mismo `pdf.min.js` y `pdf.worker.min.js`: son la misma versión de pdf.js partida en dos.
Al añadir o renombrar archivos aquí, **actualiza también la lista `SHELL` de `sw.js`**,
o el modo sin conexión no los guardará.
