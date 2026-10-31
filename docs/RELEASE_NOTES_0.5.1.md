# Pulso DJ 0.5.1 — Linux

Primera versión para Linux y primera con el repositorio público. Las funciones son las de la 0.5.0: consola de 4 decks, perfil de la Pioneer DDJ-SB3, scratch y KEY LOCK, biblioteca, pedidos del público desde el móvil y Auto DJ. Novedades completas en [la 0.5.0](https://github.com/lnavarrocarter/pulso-dj/releases/tag/v0.5.0).

## Descargas

| Sistema | Archivo |
| --- | --- |
| Windows 10/11 (x64) | `Pulso-DJ-0.5.1-Windows-Setup.exe` |
| Ubuntu, Debian y derivadas (x64) | `Pulso-DJ-0.5.1-Linux-amd64.deb` |
| Otras distribuciones Linux (x64) | `Pulso-DJ-0.5.1-Linux-x86_64.AppImage` |

Todas incluyen yt-dlp y no necesitan Node.js. `SHA256SUMS.txt` sirve para comprobar los archivos.

**Windows:** el instalador no está firmado. Si SmartScreen avisa, pulsa «Más información» y «Ejecutar de todas formas».

**Linux:** instala el `.deb` con `sudo apt install ./Pulso-DJ-0.5.1-Linux-amd64.deb`. El AppImage necesita FUSE 2 (`libfuse2t64` en Ubuntu 24.04) y permiso de ejecución. Ubuntu 24.04 puede impedir que arranque por cómo restringe el aislamiento de Electron; ahí conviene el `.deb`.

## Cambios desde la 0.5.0

- Paquetes para Linux: AppImage y `.deb` con yt-dlp para Linux incluido.
- Los paquetes se compilan en GitHub Actions, cada uno en su sistema y después de pasar allí las pruebas unitarias y de Electron.
- README actualizado.

## Validación y límites

Las pruebas unitarias y la prueba de Electron (audio, scratch, KEY LOCK, pads, sampler, filtros) pasan en Windows y en Ubuntu dentro de GitHub Actions.

Sin probar en Linux:
- la app instalada en un escritorio real;
- la controladora MIDI;
- la salida de 4 canales para los cascos;
- los pedidos del público.

Prerelease. El código propio aún no tiene licencia de código abierto.
