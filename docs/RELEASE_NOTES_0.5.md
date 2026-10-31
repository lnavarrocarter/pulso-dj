# Pulso DJ 0.5.0 — Mesa y pista

Versión centrada en tocar con una controladora real (Pioneer DDJ-SB3), en una biblioteca de pistas y en dejar que el público pida canciones.

## Novedades

- **Consola de 4 decks** con mezclador central, crossfader con asignación A/THRU/B y vúmetros por canal.
- **Pioneer DDJ-SB3 integrada:** se reconoce al conectarla y la pantalla toma la posición de faders y potenciómetros. Cubre todos los controles que envían MIDI, incluidos los ocho modos de pads, las funciones con SHIFT y DECK 3/4. Los LEDs y vúmetros de la mesa siguen a la app. Mapa completo en `docs/controllers/DDJ-SB3.md`.
- **Scratch audible y KEY LOCK:** cambiar el tempo ya no cambia el tono.
- **Cascos:** eligiendo la DDJ-SB3 como salida, el master sale por MASTER OUT y el CUE por los cascos.
- **Biblioteca:** enlaces de YouTube (varios a la vez, en cola) y archivos locales, guardados entre sesiones. Se cargan en cualquier deck con botón, arrastrando, con el teclado o con el navegador de la mesa.
- **Pedidos del público:** los invitados escanean un QR en el mismo wifi, ponen su nombre, un enlace de YouTube y su parte favorita (hasta 3 minutos). Cada pedido espera tu aprobación y luego carga en esa parte.
- **Auto DJ:** detecta el BPM de cada pista. Mezcla los decks 1 y 2 a tempo, primero los pedidos y luego la biblioteca.

## Instalación

Descarga `Pulso-DJ-0.5.0-Windows-Setup.exe` y ejecútalo. Incluye accesos directos, desinstalador y yt-dlp. No requiere Node.js. El instalador no está firmado: Windows SmartScreen puede avisar («Más información» → «Ejecutar de todas formas»). `SHA256SUMS.txt` permite comprobar su integridad.

Al abrir los pedidos por primera vez, Windows pregunta si permite el acceso de red a Pulso DJ: permite solo **redes privadas**, y comprueba que tu wifi está marcado como red privada en Windows.

## Validación y límites

53 pruebas unitarias. Las pruebas de Electron cubren audio, scratch, KEY LOCK, pads, sampler y filtros. Con la mesa física se probaron la conexión, la sincronización de controles y la salida de 4 canales.

Probados de principio a fin en la app:
- un pedido real de YouTube desde una ventana del tamaño de un móvil;
- el Auto DJ con pistas sintéticas.

Sin probar:
- pulsar DECK 3/4 en la mesa;
- la sensación del scratch y la calidad audible de KEY LOCK;
- el Auto DJ con música real;
- sesiones largas y macOS.

El Auto DJ elige por orden, no por estilo ni tonalidad, y mezcla siempre los últimos 32 beats de cada pista.

Prerelease en un repositorio privado; la licencia del código propio sigue pendiente.
