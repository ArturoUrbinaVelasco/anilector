# vendor/ — librerías de terceros

Estas librerías se guardan **dentro del repo** (no se cargan desde un CDN) por dos motivos:

1. **libarchive** corre en un Web Worker, y los navegadores **prohíben crear un Worker
   desde otro dominio**. Tiene que ser del mismo origen que la app.
2. El `worker-bundle.js` busca `libarchive.wasm` **junto a él**; si se separan, no carga.

Todas se cargan **bajo demanda** (`import()` dinámico): no pesan en el arranque de la app.
Solo se descargan cuando abres un archivo de ese tipo.

| Carpeta | Qué es | Para qué | Licencia |
|---|---|---|---|
| `libarchive/` | [libarchive.js](https://github.com/nika-begiashvili/libarchivejs) 2.0.2 | RAR v4/v5, 7z, TAR, ZIP (y CBR/CB7/CBT/CBZ), con contraseña | MIT |
| `foliate/` | [foliate-js](https://github.com/johnfactotum/foliate-js) `mobi.js` | MOBI y AZW3 (Kindle) | MIT |
| `marked.esm.js` | [marked](https://github.com/markedjs/marked) 18 | Markdown con formato | MIT |

## Cómo actualizarlas

```bash
npm pack libarchive.js@2.0.2 foliate-js marked
# descomprimir y copiar:
#   libarchive.js/dist/{libarchive.js,worker-bundle.js,libarchive.wasm} -> vendor/libarchive/
#   foliate-js/mobi.js                                                  -> vendor/foliate/
#   marked/lib/marked.esm.js                                            -> vendor/marked.esm.js
```

Los tres archivos de `libarchive/` van **siempre juntos**: si actualizas uno, actualiza los tres.
