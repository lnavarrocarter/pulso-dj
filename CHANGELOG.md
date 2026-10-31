# Historial

Iteraciones locales construidas el 13 de octubre de 2026. El repositorio empieza con el snapshot 0.4.0; no hay commits históricos que representen las versiones anteriores.

## 0.5.1 — Linux

AppImage y `.deb` para Linux x64 con yt-dlp para Linux incluido. Los paquetes de Windows y Linux se compilan en GitHub Actions, cada uno en su sistema y tras pasar allí las pruebas. Repositorio público y README actualizado.

## 0.5.0 — Mesa y pista

Consola de cuatro decks pensada para la Pioneer DDJ-SB3, con perfil integrado y sincronización de faders al conectar. Cubre todos los controles que envían MIDI:
- los ocho modos de pads;
- las funciones con SHIFT;
- TRIM, el FILTER de dos lados, VINYL y SLIP;
- loops manuales y el rango de tempo;
- CUE de cascos por la tarjeta de sonido de la mesa;
- DECK 3/4.

Los LEDs y vúmetros de la mesa siguen el estado de la app, y la toma suave evita saltos de los faders físicos.

Motor de deck en el hilo de audio: scratch audible y KEY LOCK por estiramiento WSOLA. Hot cues 1-8, roll, slicer, beat jump, censor, FX fade, trans, sampler de 4 muestras y patrones de pad scratch.

Biblioteca persistente para enlaces de YouTube y archivos locales, cargables en cualquier deck. Pedidos del público desde el móvil en la red local, con QR, código de sesión y aprobación del DJ. Detección de BPM y de beats, y un Auto DJ que mezcla los decks 1 y 2 a tempo.

La pantalla se refresca a la frecuencia del monitor. Los títulos importados conservan acentos y emoji.

## 0.4.0 — Assist

Síntesis de segmentos house/techno/ambient, capa de mezcla independiente, exportación WAV, indicaciones limitadas, cámara opcional y adaptación de filtro/volumen según energía manual y actividad visual. Permisos de vídeo separados de micrófono y pruebas con cámara sintética. No incluye un modelo generativo.

## 0.3.0 — YouTube

Importación de vídeos individuales públicos mediante yt-dlp, progreso/cancelación, limpieza temporal, guardado del audio original y herramientas incluidas en el instalador. Prueba real de descarga y decodificación.

## 0.2.0 — Performance

Interfaz animada, loops por BPM manual, Tap tempo, cuatro hot cues y echo/reverb/filtro/drive por deck. Controles asignables a MIDI e instalador NSIS de Windows.

## 0.1.0 — Base

Dos decks, transporte, EQ, pitch, crossfader, master, forma de onda y MIDI. Electron con renderer aislado y pruebas básicas de lógica/audio.
