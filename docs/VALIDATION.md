# Validación y distribución

Estado al 13 de octubre de 2026, versión 0.4.0.

## Comprobado localmente

- 16 pruebas unitarias: crossfader, MIDI, tiempos/loops, instrucciones/actividad visual, síntesis WAV, permisos, URLs y descarga simulada/progreso/cancelación/limpieza.
- Prueba Electron de decodificación WAV, reproducción/pausa/búsqueda/pitch, final de pista, loops, hot cues y audio producido por FX.
- Prueba Electron de generación y reproducción de capa, adaptación, override manual y conservación de los decks.
- Cámara sintética: rechazo previo a habilitación, captura solo de vídeo, rechazo de micrófono y cierre de tracks.
- Importación real de un vídeo público Big Buck Bunny con decodificación de aproximadamente 634,6 segundos. No demuestra que cualquier URL funcione.
- Instaladores Windows generados y archivos del paquete contrastados con el código probado. yt-dlp empaquetado se verificó contra su checksum.

## Pendiente

Cámara física, mesa MIDI física, escucha de calidad, latencia medida, sesiones prolongadas, grandes bibliotecas, instalación/desinstalación mediante el asistente en otro equipo y toda la validación de macOS. Las pruebas actuales no convierten esta alpha en un producto listo para actuaciones.

## Automatización

GitHub Actions ejecuta las pruebas unitarias en Windows y macOS. Las pruebas Electron y de YouTube siguen siendo pasos locales explícitos: necesitan Electron/entorno gráfico o red, respectivamente. No se activa cámara real ni se descarga música en CI. Que exista un workflow no significa que ya haya pasado; revisar su resultado en cada commit.

## Versiones

Los instaladores alpha se publican como prereleases en el repositorio privado. Para construir:

```sh
npm ci
npm test
npm run test:desktop
npm run test:assistant
npm run dist -- --publish never
```

En Windows se genera NSIS; en macOS la configuración genera DMG. Las versiones no se firman sin certificados configurados. Los instaladores alpha pueden provocar avisos de procedencia. No hay actualizador automático.

## Dependencias y propiedad

La revisión inicial encontró avisos moderados en dependencias de desarrollo de electron-builder relacionadas con sprintf-js; el resultado puede cambiar. Ejecutar `npm audit` al preparar una distribución y resolver/revisar los avisos. La verificación inicial de dependencias de producción no detectó avisos; no constituye una garantía de seguridad.

La licencia del código propio permanece sin decidir. Los avisos de yt-dlp y sus componentes se distribuyen con el binario. Revisar también avisos de Electron, fuentes correspondientes y obligaciones de las versiones exactas antes de distribución pública/comercial. No subir claves, cookies, vídeos, música de prueba ni datos de cámara al repositorio.
