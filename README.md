# Pulso DJ

Aplicación de escritorio para mezclar música con cuatro decks, tocar con una controladora MIDI y dejar que el público pida canciones desde el móvil. Funciona en Windows y Linux; macOS está configurado pero sin compilar ni probar.

**Estado: alpha 0.5.1.** Probada con una Pioneer DDJ-SB3. No está validada para actuaciones ni sustituye a Serato, rekordbox o VirtualDJ. El Auto DJ mezcla por orden y a tempo; todavía no elige canciones con IA. El asistente musical usa síntesis y reglas locales, sin modelo generativo.

![Interfaz de Pulso DJ](preview.png)

## Funciones actuales

| Área | Implementado |
| --- | --- |
| Mezcla | Cuatro decks, mezclador con TRIM, EQ de tres bandas, filtro paso bajo/alto, faders, crossfader con asignación A/THRU/B y master |
| Platos | Scratch audible, nudge, KEY LOCK (tempo sin cambiar el tono), rango de tempo ±6 a ±50 %, slip |
| Performance | Cue, 8 hot cues, loops automáticos y manuales, roll, slicer, beat jump, censor, FX fade, trans, sampler de 4 muestras y pad scratch |
| Efectos | Echo con tiempo en beats, reverb, filtro y drive por deck |
| Tempo | Detección automática de BPM y de la posición de los beats; SYNC y Tap |
| Hardware | Perfil integrado para la Pioneer DDJ-SB3 (todos sus controles MIDI, LEDs y vúmetros); aprendizaje MIDI para otras mesas |
| Cascos | Preescucha (CUE) por las salidas 3-4 de una tarjeta de 4 canales, como la de la DDJ-SB3 |
| Biblioteca | Enlaces de YouTube (varios a la vez) y archivos locales, guardados entre sesiones |
| Pedidos | Los invitados mandan canciones y su parte favorita desde el móvil, en el mismo wifi; el DJ las aprueba |
| Auto DJ | Mezcla los decks 1 y 2 a tempo: pedidos primero, después la biblioteca |
| Creación | Segmentos de house, techno o ambient con tonalidad, tempo y energía, y exportación WAV |

La controladora debe enviar MIDI por USB. Para otras mesas, la sección «Asignar controles a mano» aprende botones y potenciómetros uno a uno.

## Instalar

Descarga la [última versión](https://github.com/lnavarrocarter/pulso-dj/releases). Todas incluyen el importador de YouTube (yt-dlp) y no necesitan Node.js, Python ni FFmpeg.

**Windows.** Ejecuta `Pulso-DJ-<versión>-Windows-Setup.exe`. El instalador no está firmado: si Windows SmartScreen avisa, pulsa «Más información» y «Ejecutar de todas formas».

**Linux (x64).** En Ubuntu o Debian, instala el `.deb`:

```sh
sudo apt install ./Pulso-DJ-<versión>-Linux-amd64.deb
```

En otras distribuciones usa el AppImage:

```sh
chmod +x Pulso-DJ-<versión>-Linux-x86_64.AppImage
./Pulso-DJ-<versión>-Linux-x86_64.AppImage
```

El AppImage necesita FUSE 2 (`sudo apt install libfuse2t64` en Ubuntu 24.04). Ubuntu 24.04 restringe el aislamiento que usa Electron y puede impedir que el AppImage arranque; en ese caso usa el `.deb`.

`SHA256SUMS.txt`, en cada versión, sirve para comprobar que el archivo no se alteró.

## Desarrollar

Requisitos: Node.js 24 LTS con npm y Git. En Windows, macOS o Linux:

```sh
git clone https://github.com/lnavarrocarter/pulso-dj.git
cd pulso-dj
npm ci
npm start
```

`npm start` descarga yt-dlp de su publicación oficial si falta y comprueba su SHA-256; esa preparación necesita Internet. La mezcla, la biblioteca local y la síntesis no necesitan servidor ni cuenta.

## Verificar y empaquetar

```sh
npm test
npm run test:desktop
npm run dist -- --publish never
```

- `npm test`: 53 pruebas de lógica, perfil de la DDJ-SB3, detección de tempo, biblioteca, servidor de pedidos, permisos e importador.
- `test:desktop`: la app en Electron con audio silenciado. Cubre transporte, loops, hot cues, efectos, filtros, scratch, KEY LOCK, pads y sampler.
- `npm run test:youtube`: prueba opcional de red que descarga un vídeo público; puede fallar por restricciones de YouTube.
- Los paquetes salen en `release/`. Cada plataforma se compila en su propio sistema.

**Publicar una versión.** Sube la etiqueta `vX.Y.Z` con `docs/RELEASE_NOTES_X.Y.Z.md` escrito. El workflow `Release` de GitHub Actions hace el resto:

1. Compila el instalador de Windows y el AppImage y el `.deb` de Linux, cada uno en su sistema.
2. Pasa allí las pruebas.
3. Los publica como prerelease con sus sumas de comprobación.

## Documentación

- [Mapa de la Pioneer DDJ-SB3](docs/controllers/DDJ-SB3.md): cada control, sus mensajes MIDI y lo que hace en Pulso.
- [Roadmap y criterios de aceptación](docs/ROADMAP.md): fases priorizadas, lo que falta y decisiones abiertas.
- [Guía de uso y límites](docs/USER_GUIDE.md).
- [Arquitectura](docs/ARCHITECTURE.md): módulos, grafo de audio y permisos.
- [Validación y distribución](docs/VALIDATION.md): qué se ha probado y qué sigue sin comprobar.
- [Historial](CHANGELOG.md): evolución de 0.1 a 0.5.

## Límites principales

- **Audio:** sin ASIO, y sin grabación del master.
- **Memoria:** cada pista se decodifica entera en memoria, hasta 20 minutos y 128 MB.
- **Hot cues:** no se guardan entre sesiones.
- **Auto DJ:** mezcla los últimos 32 beats de cada pista, sin buscar el mejor punto de la canción.
- **Pedidos:** necesitan que el ordenador y los móviles estén en la misma red privada, y que los móviles tengan Internet para ver YouTube.

La cámara del asistente mide cambios de imagen, no emociones ni personas. Se activa con un botón y no graba ni envía vídeo.

## Distribución y licencias

El repositorio es público, pero el código propio todavía no tiene una licencia de código abierto. Puedes leerlo e instalar la aplicación, pero no reutilizar el código sin permiso del autor.

Electron, yt-dlp y sus dependencias conservan sus licencias; los avisos de yt-dlp se incluyen en `assets/tools/` y en los instaladores. Usa música propia o autorizada.
