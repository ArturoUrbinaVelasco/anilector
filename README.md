# 📚 AniLector

Aplicación web **responsiva, multilenguaje (ES/EN) y con temas** para buscar **anime, manga y libros**, consultar cuántos **episodios, capítulos, tomos o ediciones** tiene cada obra **en su orden de visualización/lectura**, y **leer documentos (PDF, EPUB, CBZ, imágenes, texto) en línea o desde tu equipo**, todo dentro de la misma aplicación.

> 100% frontend estático: no requiere servidor ni llaves de API. Ideal para **GitHub Pages**.

## ✨ Funciones

- 📺 **TV en vivo (página de inicio)**: reproductor integrado con selección de 4 listas M3U de código abierto de la comunidad (iptv-org México, Free-TV México, iptv-org Español y Cine 24/7). Buscador de canales, filtro por categoría y reproducción HLS dentro del sitio. Solo canales de transmisión abierta; las listas son editables en `js/config.js`.
- 🎬 **Películas (VOD)**: catálogo gratuito y legal de **Internet Archive** (dominio público y licencias libres) en cuadrícula estilo Netflix, con categorías (destacadas, ciencia ficción/terror, cine negro, animación, clásicos), buscador y reproducción embebida dentro de la app.

- 🔎 **Búsqueda web** de anime y manga (Jikan / MyAnimeList) y libros (Open Library + Google Books) por **nombre, género, año, estado y orden** (relevancia, calificación, popularidad, novedad, título).
- 📜 **Orden de visualización / lectura**: reconstruye la cadena *precuela → secuela* con el conteo de episodios/capítulos/tomos de cada entrega, más historias paralelas y spin-offs.
- 📖 **Lectura en línea dentro de la app**: libros con texto completo se abren embebidos (Internet Archive / Google Books); tráilers de anime embebidos.
- ▶ **Dónde ver/leer**: top 7 de sitios por título (español primero). Para anime, con el microservicio opcional se abre el **enlace exacto** del episodio; para manga, el listado real de **capítulos por tomo** con enlace exacto vía la API oficial de **MangaDex** (español priorizado).
- 👓 **Visor integrado**: PDF (pdf.js), EPUB (epub.js), CBZ/ZIP de manga (JSZip), imágenes y texto — desde una **URL** o desde **archivos de tu equipo**. Recuerda tu página/posición por documento.
- ⭐ **Mi Biblioteca**: guarda favoritos con estado (pendiente / leyendo / completado). Persistente en tu navegador.
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

## 🧩 Fuentes de datos (gratuitas, sin llave)

| Fuente | Uso |
| --- | --- |
| [Jikan v4](https://jikan.moe) (MyAnimeList) | Anime y manga: búsqueda, géneros, detalle, relaciones |
| [Open Library](https://openlibrary.org/developers/api) | Libros: búsqueda, detalle, lectura vía Internet Archive |
| [Google Books](https://developers.google.com/books) | Libros: sinopsis, vistas previas y lectura web |

## 🗂 Estructura

```
index.html        # Interfaz (una sola página)
css/styles.css    # Estilos y 5 temas (variables CSS)
js/app.js         # Controlador principal
js/api.js         # Capa de datos (Jikan, Open Library, Google Books)
js/viewer.js      # Visor PDF/EPUB/CBZ/imagen/texto/iframe
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
