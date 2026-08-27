# Jellyfin de pruebas — para validar «Mi servidor»

Un servidor que habla como un Jellyfin de verdad, para probar el apartado
**Mi servidor** de AniLector sin necesitar uno montado. Son solo dos
archivos y Node, que ya tienes.

## Arrancarlo

```powershell
cd "C:\Users\Arturo Urbina\Downloads\anilector-src\pruebas-servidor"
node jellyfin-de-pruebas.mjs
```

Y en otra ventana, AniLector en local:

```powershell
cd "C:\Users\Arturo Urbina\Downloads\anilector-src"
.\Iniciar-AniLector.bat
```

En **Mi servidor → Conexión**:

| Campo | Valor |
|---|---|
| URL de tu servidor | `http://localhost:8096` |
| Clave de API | cualquier texto, por ejemplo `prueba-123` |

Pulsa **Guardar**. Deberías ver los tres pasos en verde, dos bibliotecas
más «📡 TV en vivo», doce películas con portada, y un vídeo de 6 segundos
que se reproduce y por el que se puede saltar.

⚠️ **Los dos por http.** Si abres AniLector por https (GitHub Pages) el
navegador bloqueará un servidor en http, y no hay forma de saltarlo desde
la web. Para esta prueba, AniLector en local.

## Romperlo a propósito

Cada avería reproduce un fallo real. Sirven para ver **qué dice el panel
en cada caso** y comprobar que AniLector lo aguanta:

```powershell
node jellyfin-de-pruebas.mjs --sin-cabecera
```

| Avería | Qué simula | Qué debe pasar |
|---|---|---|
| `--sin-cabecera` | Un Jellyfin que permite el origen pero **no la cabecera `Authorization`** — el CORS a medio configurar. **Esto es lo que te falló.** | Conecta igual, y el paso 2 dice «por la dirección» |
| `--vistas-vacias` | Las vistas del usuario llegan vacías aunque las bibliotecas existan (pasa con claves de API) | Conecta: las encuentra por la cuarta vía |
| `--sin-usuarios` | La clave no puede listar usuarios | Conecta, avisando de que no marcará lo ya visto |
| `--rutas-viejas` | Emby o Jellyfin 10.8: solo entiende las rutas antiguas | Conecta, cayendo a la ruta vieja tras el 404 |
| `--sin-tv` | Un servidor sin TV en vivo | La sección de TV **no** aparece |
| `--clave-mala` | Rechaza cualquier clave | Paso 2 en rojo: «revísala o crea una nueva» |
| `--no-soy-jellyfin` | Una API que contesta JSON a todo sin ser un servidor de medios | Paso **1** en rojo: «eso no parece un Jellyfin» |
| `--webm` | Sirve el vídeo en WebM | Solo hace falta en navegadores sin H.264 |

Se pueden combinar. `Ctrl+C` para parar. El servidor imprime cada
petición que le hace AniLector, con qué vía viaja la clave y qué
contestó: es media herramienta de diagnóstico.

## Si quieres un Jellyfin de verdad

El servidor de pruebas valida **el cliente**, no tu instalación. Para lo
segundo, Jellyfin tiene instalador para Windows y queda en
`http://localhost:8096`. Dos cosas que vas a necesitar:

1. **Crear la clave**: Panel de administración → Claves de API → nueva,
   con el nombre AniLector.
2. **Permitir el origen**: Panel → Redes → *CORS hosts*. Sin esto, un
   cliente web no puede leer sus respuestas — es el motivo nº1 por el que
   no conecta. Si además pones ahí solo el origen pero no la cabecera
   `Authorization`, AniLector conecta por la otra vía y te lo dice.

La demo pública de Jellyfin (`demo.jellyfin.org/stable`, usuario `demo`
sin contraseña) sirve para *ver* Jellyfin, pero **no** para esta prueba:
no eres administrador, así que no puedes crear una clave, y su CORS no
está abierto para otros orígenes.

## Qué NO es esto

No es parte de la app y no se publica: `pruebas-servidor/` está en el
`.gitignore`. Es una herramienta de escritorio para ti. Los vídeos de
muestra son un rectángulo con un tono de 440 Hz generado con ffmpeg, no
contenido de nadie.
