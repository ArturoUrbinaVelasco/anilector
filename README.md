# 📚 AniLector

Aplicación web **responsiva, multilenguaje (ES/EN) y con temas** para buscar **anime, manga y libros**, consultar cuántos **episodios, capítulos, tomos o ediciones** tiene cada obra **en su orden de visualización/lectura**, y **leer documentos (PDF, EPUB, MOBI/AZW3, comprimidos ZIP/RAR/7z/CBZ/CBR, imágenes, texto) en línea o desde tu equipo**, todo dentro de la misma aplicación.

> 100% frontend estático: no requiere servidor ni llaves de API. Ideal para **GitHub Pages**.

## ✨ Funciones

- 📺 **TV en vivo (página de inicio)**: reproductor integrado con selección de 4 listas M3U de código abierto de la comunidad (iptv-org México, Free-TV México, iptv-org Español y Cine 24/7). Buscador de canales, filtro por categoría y reproducción HLS dentro del sitio. Solo canales de transmisión abierta; las listas son editables en `js/config.js`.
- ▶️ **YouTube** (estilo GreenTuber): búsqueda que trae **videos y listas de reproducción**, botón de **ver más resultados**, panel de **Siguientes** que se recarga con cada video y **encadenado automático** al terminar (se puede apagar con la casilla «Encadenar»). Reproductor oficial de YouTube; también puedes pegar el enlace de un video o de una lista.
- 🌐 **Sitios**: abre cualquier página dentro de la app. Guarda tus **sitios favoritos** con ☆, renómbralos o bórralos; se sincronizan con Google Drive junto al resto de tus datos.

- 🔎 **Búsqueda web** de anime y manga (Jikan / MyAnimeList) y libros (Open Library + Google Books) por **nombre, género, año, estado y orden** (relevancia, calificación, popularidad, novedad, título).
- 📜 **Orden de visualización / lectura**: reconstruye la cadena *precuela → secuela* con el conteo de episodios/capítulos/tomos de cada entrega, más historias paralelas y spin-offs.
- 📖 **Lectura en línea dentro de la app**: libros con texto completo se abren embebidos (Internet Archive / Google Books); tráilers de anime embebidos.
- ▶ **Dónde ver/leer**: top 7 de sitios por título (español primero). Para anime, con el microservicio opcional se abre el **enlace exacto** del episodio; para manga, el listado real de **capítulos por tomo** con enlace exacto vía la API oficial de **MangaDex** (español priorizado).
- 👓 **Visor integrado**: PDF (pdf.js), EPUB (epub.js), MOBI/AZW3 (foliate), comprimidos **ZIP/CBZ, RAR/CBR, 7z/CB7, TAR/CBT** (JSZip + libarchive), imágenes, texto y Markdown — desde una **URL** o desde **archivos de tu equipo**. Recuerda tu página/posición por documento. Ver [Formatos del visor](#-formatos-del-visor).
- ⭐ **Mi Biblioteca**: guarda favoritos con estado (pendiente / leyendo / completado), marca episodios y capítulos como vistos y retoma desde **▶️ Continuar**. Con sesión de Google, biblioteca, progreso, vistos y sitios favoritos se sincronizan entre tus equipos.
- 🌗 **5 temas**: Oscuro, Claro, Medianoche, Sakura y Océano.
- 🌎 **Español e inglés**, cambiables al instante.
- 📱 **Responsivo**: diseñado para móvil, tableta y escritorio.

## 🚀 Uso local

No hay build. Dos opciones:

**Opción A — servidor local con proxy de TV (recomendado para ver más canales):**

```bash
node server.mjs
```

Abre `http://localhost:8787`. Este servidor sirve la app **y** hace de proxy de TV **desde tu propia conexión**, así se reproducen dentro de la app los canales `http`/IP o con bloqueo por región que en la versión web solo se abren en pestaña nueva. Requiere Node 18+.

### 📱 Ver la TV en el móvil u otro equipo

- **Misma WiFi (lo más fácil):** con `node server.mjs` corriendo en la PC, abre en el móvil la dirección `http://IP-DE-TU-PC:8787` que imprime la consola (ej. `http://192.168.1.50:8787`). Todo va por HTTP desde tu red, sin problemas de contenido mixto.
- **Desde cualquier lado (datos móviles):** expón tu servidor local con un túnel gratuito y open-source como **Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:8787`). Te da una URL `https://…`. Ábrela en el móvil, **o** en la app web pega esa URL en **TV → ➕ Añadir → Proxy de TV** para que la versión online reproduzca tus canales desde tu IP de casa.

**Opción B — solo estáticos (sin proxy):**

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080`.

## ☁️ Despliegue en GitHub Pages

1. Sube este repositorio a tu cuenta de GitHub.
2. En **Settings → Pages**, selecciona *Deploy from a branch*, rama `main`, carpeta `/ (root)`.
3. Tu app quedará en `https://<tu-usuario>.github.io/<repo>/`.

### ⚠️ Publicar una versión nueva: usa `publicar.ps1`

```powershell
.\publicar.ps1 "v4.0: lo que trae esta version"
```

Sube `VERSION` en `sw.js`, hace `add`, `commit`, `pull --rebase` y `push`, y se
para si algo falla.

**Por qué importa el número de versión.** El service worker guarda una copia de
la app en el navegador. Ese número es lo único que le dice «esto ya no vale,
bórralo y descárgalo otra vez». Si no cambia, el navegador sigue sirviendo la
copia vieja y **los cambios no se ven nunca**, por mucho que el push haya
funcionado. Peor aún: GitHub Pages cachea CSS y JS unos minutos por su cuenta,
así que sin ese salto de versión puede cargarse un `index.html` nuevo junto a un
`i18n.js` viejo y la interfaz sale rota (con textos crudos tipo `mnav.tv`). Ya
pasó una vez; el service worker existe justamente para que no vuelva a pasar.

Si prefieres hacerlo a mano, el orden es: **primero** editar `const VERSION` en
`sw.js`, y después `git add -A`, `git commit -m "…"`, `git pull --rebase`,
`git push`.

## 🧩 Fuentes de datos (gratuitas, sin llave)

| Fuente | Uso |
| --- | --- |
| [Jikan v4](https://jikan.moe) (MyAnimeList) | Anime y manga: búsqueda, géneros, detalle, relaciones |
| [Open Library](https://openlibrary.org/developers/api) | Libros: búsqueda, detalle, lectura vía Internet Archive |
| [Google Books](https://developers.google.com/books) | Libros: sinopsis, vistas previas y lectura web |

## 📖 Formatos del visor

**Desde tu equipo** (botón «Elegir archivos») y **desde un enlace directo**:

| Tipo | Formatos | Notas |
|---|---|---|
| Documentos | `PDF`, `EPUB` | Recuerda la página / posición |
| Kindle | `MOBI`, `AZW3`, `PRC` | Lectura continua por secciones |
| Comprimidos | `ZIP`/`CBZ`, `RAR`/`CBR`, `7z`/`CB7`, `TAR`/`CBT`, `.gz`, `.bz2`, `.xz` | Si dentro hay imágenes → lector de páginas; si hay de todo → lista para elegir |
| Imágenes | `JPG`, `PNG`, `GIF`, `WEBP`, `BMP`, `AVIF`, `SVG` | Varias a la vez = galería en orden natural |
| Texto | `TXT`, `MD`, `LOG`, `NFO`, `CSV`, `JSON`, `XML`, `SRT`, `VTT`, `ASS`… | Markdown se muestra con formato |

Detalles que conviene saber:

- **Las páginas de un comprimido se extraen de una en una**, no todas de golpe: un CBZ de 300 páginas
  abre igual de rápido que uno de 10, y la memoria se libera al cerrar.
- **Contraseña:** los **ZIP** protegidos sí se abren (te la pide). Los **RAR y 7z** cifrados **no**:
  la librería incluida no trae ese descifrado y el visor te lo dice claramente en vez de fallar en silencio.
- Un archivo **sin extensión** se identifica por sus primeros bytes.

### Desde un enlace

El visor abre una URL que apunte **directamente a un archivo**. Si el servidor no permite la descarga
desde el navegador (CORS), pasa por el proxy `/api/file` (microservicio o servidor local).

Se convierten solos a enlace directo: **Google Drive** (`/file/d/…`), **Dropbox** (`?dl=0`) y **GitHub** (`/blob/`).

**Terabox, Mega, MediaFire y similares no funcionan**: su enlace es una *página* que exige sesión, no un
archivo. El visor lo detecta y te explica qué hacer (descargarlo y abrirlo desde tu equipo, o pegar el
enlace directo). Ojo: en Vercel el proxy topa en unos MB por límite de la plataforma; para archivos
grandes conviene el **servidor local** (`node server.mjs`), que no tiene ese tope.

## 🗂 Estructura

```
index.html        # Interfaz (una sola página)
css/styles.css    # Estilos y 5 temas (variables CSS)
js/app.js         # Controlador principal
js/api.js         # Capa de datos (Jikan, Open Library, Google Books)
js/viewer.js      # Visor PDF/EPUB/MOBI/comprimidos/imagen/texto/Markdown/iframe
vendor/           # Librerías locales (libarchive, foliate, marked) — ver vendor/README.md
js/auth.js        # Sesión con Google + sincronización en Drive
js/config.js      # Configuración (Client ID de Google)
js/i18n.js        # Traducciones ES/EN
```

## 🔐 Inicio de sesión con Google (opcional)

Con sesión iniciada, la app muestra tu nombre y foto, y **respalda tu biblioteca y progreso de lectura en tu propio Google Drive** (carpeta privada de la app), sincronizándolos entre dispositivos. No hay servidor de por medio: es OAuth de Google directo en tu navegador.

Configuración (una sola vez, gratis, ~5 minutos):

1. Entra a [Google Cloud Console](https://console.cloud.google.com/) con tu cuenta de Google y crea un proyecto (p. ej. `anilector`).
2. Busca y habilita la **Google Drive API** (APIs y servicios → Biblioteca).
3. En **APIs y servicios → Pantalla de consentimiento OAuth**: tipo *Externo*, nombre `AniLector`, tu correo de soporte. En *Audience/Público* agrega tu correo como **usuario de prueba** (o publica la app).
4. En **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**: tipo *Aplicación web*, y en **Orígenes de JavaScript autorizados** agrega:
   - `https://<tu-usuario>.github.io`
   - `http://localhost:8080` (para pruebas locales)
5. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`) y pégalo en `js/config.js`:

```js
export const GOOGLE_CLIENT_ID = "TU_ID.apps.googleusercontent.com";
```

6. Sube el cambio (`git add -A && git commit -m "config google" && git push`).

Sin Client ID configurado, la app funciona normal, solo que sin sesión ni sincronización.

## 🔒 Privacidad

Tus favoritos, progreso de lectura y preferencias se guardan **solo en tu navegador** (`localStorage`). Los archivos locales nunca salen de tu equipo: se leen y renderizan en el propio navegador.

---
Hecho con ❤️ para lectores y otakus.
