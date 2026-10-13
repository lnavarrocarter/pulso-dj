# Pulso DJ 0.4.0 — Alpha

Primera versión del proyecto subida a GitHub. Incluye el estado actual del código y la documentación de todas las iteraciones locales.

Dos decks con EQ/pitch/crossfader; loops, hot cues y efectos; aprendizaje MIDI; importación de audio de YouTube; segmentos musicales locales y asistencia por indicaciones/actividad visual de cámara.

La asistencia usa síntesis y reglas locales. No contiene un modelo de Suno ni selecciona canciones automáticamente. La cámara es opcional y no graba ni envía vídeo.

## Instalación

Descarga `Pulso-DJ-0.4.0-Windows-Setup.exe` y ejecútalo. Incluye accesos directos, desinstalador y herramientas de importación. No requiere Node.js para usar la aplicación. El instalador no está firmado; Windows puede mostrar un aviso de procedencia. El archivo `SHA256SUMS.txt` permite comprobar su integridad.

## Validación y límites

16 pruebas unitarias aprobadas y pruebas Electron de audio/asistencia. Cámara probada con dispositivo sintético; importación YouTube verificada con un vídeo público. Sin validación de mesa/cámara reales, calidad audible, sesión prolongada ni macOS. No hay preescucha independiente ni garantía para actuaciones. No se entrega un DMG.

Consulta el README, guía de uso, arquitectura, validación y roadmap para el alcance completo y próximos pasos. Esta publicación es una prerelease en un repositorio privado; la licencia del código propio sigue pendiente.
