# Arquitectura de AniLector

Cómo está hecho esto y **por qué** está hecho así. Las decisiones importantes
están explicadas con su motivo, porque una decisión sin motivo se deshace sola
en cuanto alguien la ve rara.

---

## La idea de fondo: sin compilación

No hay ni empaquetador, ni framework, ni paso de compilación. El navegador
carga `index.html`, que importa `js/app.js` como **módulo nativo**, y ese
importa a los demás. Lo que hay en el repositorio es exactamente lo que llega
al navegador.

**Por qué**: publicar es copiar archivos a GitHub Pages. No hay build que se
rompa, ni dependencias que caduquen, ni una versión de Node que haya que
mantener para poder tocar una línea de CSS. Dentro de dos años esto seguirá
abriendo. El precio es que no hay TypeScript ni JSX, y que hay que escribir
JavaScript que el navegador entienda tal cual. Ha salido a cuenta.

- **~10.600 líneas** de JavaScript propio, en 23 módulos.
- **0 dependencias** en tiempo de ejecución del navegador (las librerías de
  `vendor/` son copias servidas por el propio sitio, no paquetes npm).
- Node solo hace falta para el **servidor de desarrollo** y las **pruebas**.

---

## Mapa de módulos

```
index.html ──▶ js/app.js  (arranque, vistas, biblioteca, estanterías)
                  │
    ┌─────────────┼───────────────┬──────────────┬─────────────┐
    ▼             ▼               ▼              ▼             ▼
 api.js       viewer.js       tv.js         youtube.js    servervista.js
 (catálogos)  (el visor)      (TV en vivo)  (vídeo)       (tu servidor)
    │             │                                          │
    │        ┌────┴─────┬──────────┬─────────┐               ▼
    │        ▼          ▼          ▼         ▼            media.js
    │    buscar.js  marcas.js  translate.js docs.js       (Jellyfin/Emby)
    │   (buscar     (marca-    (traductor   (descargas
    │    dentro)     dores)     del nav.)    IndexedDB)
    ▼
  red.js  ◀── también tv.js, vod.js  (límites de tiempo y reintentos)

  i18n.js (ES/EN, 404 claves cada uno)   ·   config.js (fuentes y listas)
  auth.js (Google Drive)  ·  pwa.js (instalación y respaldo)  ·  brand.js
  entradas.js (abrir desde fuera)  ·  tvmode.js (mando a distancia)
  sw.js (service worker: caché y «compartir con AniLector»)
```

### Quién hace qué

| Módulo | Responsabilidad |
|---|---|
| `app.js` | Arranque, cambio de vistas, biblioteca, búsqueda, estanterías de «Continuar» y «Seguir leyendo» |
| `api.js` | Catálogos externos: Jikan/AniList (anime, manga), Open Library, Google Books, Gutendex |
| `viewer.js` | El visor: PDF, EPUB, MOBI, cómics, texto, Markdown, HTML; progreso, tipografía, zoom |
| `buscar.js` | Buscar dentro del documento abierto, por formato |
| `marcas.js` | Marcadores con nota, por documento |
| `docs.js` | «Mis descargas»: archivos guardados en IndexedDB |
| `media.js` / `servervista.js` | Cliente de tu propio Jellyfin o Emby |
| `tv.js` / `vod.js` | TV en vivo (listas M3U abiertas) y catálogos del Internet Archive |
| `youtube.js` | Búsqueda y reproducción con el reproductor oficial |
| `red.js` | Peticiones con límite de tiempo y reintentos, en un solo sitio |
| `auth.js` / `pwa.js` | Sincronización con Drive, instalación y copia de seguridad |
| `i18n.js` | Todos los textos, en español e inglés |
| `sw.js` | Caché versionada, funcionamiento sin conexión y recepción de archivos compartidos |

---

## Los tres almacenes del navegador, y por qué son tres

Cada uno tiene un trabajo y no se mezclan. Confundirlos es la forma más rápida
de llenar el navegador y perder datos.

### 1. `localStorage` — texto, poco, y que importa
Unos **5 MB para todo el sitio**. Aquí viven la biblioteca, el progreso de
lectura, los ajustes, los sitios favoritos, las marcas y la configuración del
servidor. Es síncrono y simple.

**Cuidado**: cuando se llena, **deja de guardarse todo**, no solo lo último.
Por eso `anilector.progress` se poda a las 400 entradas más recientes y, si aun
así no cabe, se recorta a la mitad y **se avisa** en pantalla.

### 2. IndexedDB — los archivos
Base `anilector-docs`, con tres almacenes:

- `meta` — la ficha de cada descarga (nombre, tamaño, fecha).
- `blobs` — el archivo tal cual.
- `epubloc` — el índice de posiciones de cada EPUB.

**Por qué separados**: IndexedDB lee el registro completo, así que si la ficha y
el archivo estuvieran juntos, **listar diez descargas cargaría diez archivos en
memoria**.

### 3. Cache Storage — la app y el buzón
La gestiona `sw.js`: por un lado el esqueleto de la aplicación (versionado), y
por otro el **buzón de lo que te comparten** desde otra app, que se salva a
propósito del barrido que hace cada versión nueva.

---

## Decisiones que conviene no deshacer

### El número de versión del service worker es sagrado
`const VERSION` en `sw.js`. GitHub Pages sirve el CSS y el JS con caché de unos
minutos, y eso provocó una vez que el `index.html` nuevo cargara con el
`i18n.js` viejo. Con la caché controlada aquí, **al cambiar `VERSION` se borra
la anterior entera**: o está todo nuevo, o todo viejo, nunca mezclado.
`publicar.ps1` lo sube solo si hace falta.

### Las librerías del visor viven en `vendor/`, no en un CDN
pdf.js, epub.js, JSZip, libarchive y el lector de MOBI están **en el
repositorio**. El visor promete funcionar sin conexión, y un service worker
**no puede guardar archivos de otros dominios**. Las de TV (hls.js, mpegts.js)
sí siguen en CDN a propósito: los canales en vivo necesitan internet de todos
modos.

⚠️ **JSZip tiene que cargarse antes que `epub.min.js`**.

### El progreso se guarda por HUELLA del contenido, no por título
`huellaDe()` en `viewer.js`: tamaño + FNV-1a de los primeros y últimos 4 KB. Se
calcula en milisegundos aunque el PDF pese 200 MB. Antes la clave era el
título, y dos archivos llamados «Documento1» o «scan» —como salen del móvil y
del escáner— **compartían el punto de lectura**.

### La clave de tu servidor es una credencial
La configuración de «Mi servidor» **no se sincroniza con Drive ni entra en la
copia de seguridad**: está fuera de `CLAVES` en `pwa.js` y de `KEYS` en
`auth.js` a propósito, para que un respaldo compartido no regale el acceso.
Está escrito en la cabecera de `media.js` para que nadie la añada «por
completitud».

### Solo fuentes abiertas y legales
iptv-org, Internet Archive, MangaDex, Open Library, Google Books, Gutendex,
Wikisource, Standard Ebooks, LibriVox, Jikan/AniList, el reproductor oficial de
YouTube, bibliotecas públicas mexicanas y **tu propio servidor de medios**. Los
sitios de terceros que no permiten incrustarse están como *enlaces de
búsqueda*, no como reproductores. Hay una prueba que rastrea el repositorio y
falla si se cuela una referencia a APIs de extracción.

### Nada falla en silencio
- El **aviso de errores** va **en línea en `index.html`, antes de los
  módulos**: metido en un módulo no cazaría un módulo que no carga, que es
  justo el caso en que la pantalla se queda en blanco.
- Toda petición tiene **límite de tiempo** (`red.js`): un servidor que acepta la
  conexión y se calla dejaba el indicador girando para siempre.
- El **service worker no miente**: apunta los archivos del esqueleto que no
  pudo guardar, los reintenta y el panel dice si de verdad está lista sin
  conexión.

---

## Cosas del navegador que costó descubrir

Están aquí para que no haya que redescubrirlas.

- **Un EPUB no tiene páginas fijas.** El porcentaje exige recorrer el libro
  entero (`locations.generate()`), y **mientras corre, `percentageFromCfi` ya
  devuelve `0`, no `null`** — de ahí un «0%» fijo que parecía un error de
  cuenta. El índice se guarda ahora en IndexedDB: de 4.405 ms a 363 ms.
- **Una cabecera `Authorization` cambia el modelo de red**: obliga a un
  preflight `OPTIONS`. Por eso un servidor puede contestar a la consulta
  pública y no a la autenticada, y `fetch` no distingue eso de «no hay red».
- **`Translator.availability()` tumba la pestaña** en un Chromium sin modelos,
  mientras que `LanguageDetector.create()` falla limpiamente. Hay que detectar
  el idioma primero.
- **Chromium ya trae `launchQueue`** como propiedad nativa: asignarle encima
  falla en silencio.
- **`file_handlers` del manifiesto no admite comodines** tipo `image/*`.
- **Un `<button>` dentro de otro `<button>` lo deshace el navegador**: el de
  dentro acaba como hermano del de fuera.
- **El PDF sí tiene texto.** Se *dibuja* como imagen, pero `getTextContent()`
  entrega el texto de cada página. Lo único que no lleva texto es un PDF
  escaneado, y eso se detecta y se dice.

---

## El microservicio (opcional)

`anilector-api` es una función Edge que hace de proxy para dos cosas que el
navegador no puede hacer solo: leer un PDF de un dominio que no permite CORS
(`/api/file`, con soporte de rangos HTTP y protección anti-SSRF) y algunas
listas de TV. **La app funciona sin él**; solo pierde esos casos concretos. Su
dirección está en `js/config.js` (`BACKEND_URL`).
