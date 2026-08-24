# 📚 AniLector

Aplicación web **responsiva, multilenguaje (ES/EN) y con temas** para buscar **anime, manga y libros**, consultar cuántos **episodios, capítulos, tomos o ediciones** tiene cada obra **en su orden de visualización/lectura**, y **leer documentos (PDF, EPUB, CBZ, imágenes, texto) en línea o desde tu equipo**, todo dentro de la misma aplicación.

> 100% frontend estático: no requiere servidor ni llaves de API. Ideal para **GitHub Pages**.

## ✨ Funciones

- 🔎 **Búsqueda web** de anime y manga (Jikan / MyAnimeList) y libros (Open Library + Google Books) por **nombre, género, año, estado y orden** (relevancia, calificación, popularidad, novedad, título).
- 📜 **Orden de visualización / lectura**: reconstruye la cadena *precuela → secuela* con el conteo de episodios/capítulos/tomos de cada entrega, más historias paralelas y spin-offs.
- 📖 **Lectura en línea dentro de la app**: libros con texto completo se abren embebidos (Internet Archive / Google Books); tráilers de anime embebidos.
- 👓 **Visor integrado**: PDF (pdf.js), EPUB (epub.js), CBZ/ZIP de manga (JSZip), imágenes y texto — desde una **URL** o desde **archivos de tu equipo**. Recuerda tu página/posición por documento.
- ⭐ **Mi Biblioteca**: guarda favoritos con estado (pendiente / leyendo / completado). Persistente en tu navegador.
- 🌗 **5 temas**: Oscuro, Claro, Medianoche, Sakura y Océano.
- 🌎 **Español e inglés**, cambiables al instante.
- 📱 **Responsivo**: diseñado para móvil, tableta y escritorio.

## 🚀 Uso local

No hay build. Solo sirve la carpeta:

```bash
python3 -m http.server 8080
# o
npx serve .
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
js/i18n.js        # Traducciones ES/EN
```

## 🔒 Privacidad

Tus favoritos, progreso de lectura y preferencias se guardan **solo en tu navegador** (`localStorage`). Los archivos locales nunca salen de tu equipo: se leen y renderizan en el propio navegador.

---
Hecho con ❤️ para lectores y otakus.
