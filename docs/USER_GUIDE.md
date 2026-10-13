# Pulso DJ · Assist 0.4

Aplicación de escritorio local para desarrollar un producto de DJ para Windows y macOS. Nombre provisional. Esta versión es una alpha de ingeniería; no está validada para actuaciones ni es un reemplazo completo de VirtualDJ.

## Ejecutar

Para usarlo en Windows sin Node.js, abre `release/Pulso-DJ-0.4.0-Windows-Setup.exe`. El asistente permite elegir carpeta y crea accesos directos y desinstalador. No tiene certificado de editor; Windows puede mostrar un aviso de procedencia. No se entrega aún un DMG para Mac: se debe generar y probar allí.

## Asistente musical local

No se encontró una librería/modelo de Suno en el proyecto. La versión 0.4 implementa una alternativa local: síntesis de patrones musicales y reglas de asistencia. No contiene un modelo de IA generativa, no comprende órdenes arbitrarias y no genera voces ni canciones completas. Su arquitectura separa generación, señales de ambiente y control de audio para poder integrar un modelo real más adelante.

1. Elige House, Techno o Ambient, una tonalidad menor y un BPM entre 60 y 180. También puedes usar el BPM manual de un deck, incluido su cambio de velocidad.
2. Pulsa **Crear y mezclar segmento**. Se crea un loop de 4 compases con percusión, bajo y acordes (Ambient usa acordes). Su volumen empieza bajo; se reproduce como una capa independiente sumada al master, junto a tus pistas. No reemplaza los decks y no pasa por su crossfader. **Detener capa** para esa capa sin detener tus pistas.
3. Ajusta la energía deseada o escribe una de las indicaciones reconocidas: «sube energía», «baja energía», «suave» o «mantener»; pulsa **Aplicar**.
4. Si quieres usar vídeo, pulsa **Activar cámara**. No se activa al abrir la aplicación. El procesamiento usa imágenes reducidas de 64 × 48 píxeles, compara cambios visuales a 4 Hz y descarta los fotogramas. No identifica personas, cuenta asistentes, graba, envía imágenes ni infiere emociones o preferencias. Luces, cambios de escena y movimiento de la cámara pueden dar medidas erróneas. Puedes apagarla y seguir con control manual. El micrófono permanece denegado.
5. Pulsa **Adaptar segmento al ambiente**. La indicación manual domina; la cámara solo añade una contribución limitada al objetivo. Como máximo cada 8 segundos, y cuando el objetivo cambia suficientemente, se ajustan gradualmente el filtro y volumen de la capa. No se seleccionan ni reemplazan canciones automáticamente. Mover manualmente el volumen de la capa detiene la asistencia. Detener asistencia conserva el último ajuste y permite seguir usando la capa.
6. **Guardar WAV…** guarda el segmento generado sin los ajustes posteriores de filtro/volumen. Puedes cargar ese WAV en un deck. No exporta la mezcla con tus otras pistas ni con los efectos de los decks.

El inicio junto a un deck usa un pulso estimado desde su BPM manual y posición, sin detección automática de beatgrid. No puede garantizar alineación musical exacta ni compatibilidad armónica. Cambiar posteriormente el pitch/BPM del deck no reajusta el segmento existente: vuelve a crearlo. Generar otro segmento reemplaza la capa anterior con una breve transición de volumen.

Validación 0.4: 16 pruebas de lógica/generación/importación y pruebas en Electron de decodificación WAV, loop de capa, control manual/asistido y permisos de cámara. La prueba de cámara usa un dispositivo sintético de Chromium, sin abrir hardware real. Falta validar una cámara real, el entorno de una fiesta, calidad audible y macOS. No se valida la idoneidad para una actuación.

```sh
npm run test:assistant
```

## Importar una URL de YouTube

En el deck, abre **Importar audio de YouTube**, pega la URL de un vídeo y pulsa **Importar al deck**. Se descarga el audio público disponible (M4A o WebM), se decodifica y se carga como pista. Puedes reproducirlo, usar loops, hot cues y efectos. Usa vídeos propios o cuyo audio tengas autorización para descargar y utilizar.

El botón **Guardar audio original…** permite conservar el archivo descargado en la carpeta que elijas. No exporta los efectos, cambios de velocidad ni la mezcla. La copia temporal de descarga se elimina al terminar, fallar o cancelar; la pista sigue en memoria hasta cargar otra o cerrar la aplicación. Los archivos que guardas explícitamente se conservan.

Límites: un vídeo individual por importación, hasta 20 minutos y 128 MB, una importación simultánea y un tiempo de espera de 6 minutos. No se admiten playlists, directos ni contenido que requiera autenticación o tenga DRM. No se leen cookies, contraseñas ni cuentas del navegador. YouTube puede bloquear algunos vídeos o cambiar su funcionamiento; no hay garantía de compatibilidad permanente. Es necesario tener conexión a Internet y usar la aplicación de escritorio: el navegador solo admite archivos locales.

El instalador incluye el ejecutable oficial de yt-dlp. La descarga de herramientas en compilación verifica SHA-256 contra el checksum de la publicación oficial y registra versión/origen en `assets/tools/win/manifest.json`. No se instala Python, FFmpeg ni Node.js por separado: se usa el runtime de Electron para los desafíos JavaScript compatibles con yt-dlp. No se recodifica ni se mejora la calidad de origen.

Para preparar herramientas desde código fuente, ejecuta `npm run tools:prepare`; `npm start` y `npm run dist` también las preparan si faltan. Para actualizar explícitamente yt-dlp: `npm run tools:prepare -- --update`, volver a probar y reconstruir el instalador. Las herramientas de macOS se descargan al compilar en un Mac.

Validación: 11 pruebas de lógica/importador, prueba de transporte y FX en Electron, y prueba real de importación/decodificación del cortometraje público Big Buck Bunny de Blender Foundation (634,6 segundos). No se ha probado que todos los vídeos funcionen. `npm run test:youtube` reproduce la prueba de red y descarga ese vídeo temporalmente; requiere Internet y disponibilidad del vídeo.

Referencias: [yt-dlp](https://github.com/yt-dlp/yt-dlp), [runtime y soporte EJS](https://github.com/yt-dlp/yt-dlp/wiki/EJS). El ejecutable se distribuye con su licencia y avisos en la carpeta `tools` de la aplicación. Se debe revisar también la información de licencias de las dependencias embebidas antes de una distribución pública.

## Novedades 0.2

- Platos que giran durante reproducción, espectro reactivo y región de loop visible. Se respeta la preferencia de reducir movimiento.
- Cuatro hot cues por deck: primer toque guarda; siguientes toques saltan y reproducen. Shift + clic borra. Se reinician al cargar otra pista y no se guardan entre sesiones.
- Loops de 1, 2, 4, 8 y 16 beats. Usa el BPM original de la canción o Tap tempo. No hay análisis automático ni cuantización: el loop empieza donde lo activas, o se desplaza hacia atrás si no cabe antes del final. Cambiar BPM afecta al siguiente loop. Cambiar velocidad modifica la duración real de los beats.
- Echo de medio beat según BPM manual, reverb, filtro paso bajo y drive. Restablecer FX desactiva los cuatro. Las colas de echo/reverb pueden seguir brevemente tras pausar o cargar otra pista. Echo no sigue automáticamente el pitch.
- 46 funciones MIDI asignables, incluidos hot cues, loops, FX y reset. Notas para botones y CC absolutos de 7 bits para faders.

La selección de archivos también funciona en el navegador si este permite cargar los módulos; abrir HTML por `file://` puede bloquearlos. Se recomienda la aplicación instalada.

## Ejecutar desde el código fuente

Instala Node.js LTS con npm. Desde esta carpeta:

```sh
npm ci
npm start
```

Carga un archivo en cada deck y pulsa Reproducir. Elige la salida de audio en el sistema operativo antes de abrir la aplicación. Todo funciona sin cuenta, servidor ni suscripción.

## Implementado

- Dos decks independientes, reproducción, pausa, búsqueda y punto cue por pista.
- Volumen por canal, EQ de tres bandas, velocidad ±16%, crossfader de potencia constante y master.
- Forma de onda resumida, tiempo, nivel de salida y compresor de protección. El compresor no garantiza evitar todo pico.
- Entradas MIDI, aprendizaje de notas para botones y CC absolutos de 7 bits para potenciómetros/faders; asignaciones guardadas localmente.
- Interfaz aislada del sistema; acceso a archivos únicamente mediante selector nativo.

USB describe la conexión, no el protocolo. Se requiere que la mesa exponga MIDI al sistema. HID, protocolos propietarios, jog wheels relativos, LEDs, SysEx y controles de 14 bits necesitan adaptadores específicos. Identificadores MIDI pueden cambiar al reinstalar un controlador o mover el dispositivo a otro sistema; en ese caso hay que volver a asignar.

## Límites de esta versión

- Audio mediante Web Audio en Electron; la latencia depende del sistema, dispositivo y controladores. No hay integración ASIO ni garantía de tiempo real profesional.
- Salida estéreo del sistema. No hay preescucha independiente, selección de tarjeta ni ruteo de cuatro canales.
- Cambiar velocidad cambia también el tono. No hay key lock, BPM automático, beatgrid, sync, scratch o grabación.
- Audio decodificado completo en memoria: límite de archivo de 128 MB y de duración de 20 minutos (comprobado después de decodificar). El consumo de RAM depende de la duración, canales y frecuencia. No es aún adecuado para una biblioteca grande; streaming y análisis en segundo plano son la siguiente fase.
- Los formatos disponibles dependen de Chromium y del sistema; la selección de un archivo no garantiza su decodificación.
- No se han probado una mesa real ni macOS en esta entrega.

## Estructura

`desktop/`: ventana, permisos y selector de archivos. `src/audio.mjs`: grafo de audio y transporte. `src/core.mjs`: funciones puras de mezcla y MIDI. `src/app.mjs`: interfaz, aprendizaje y estado. `tests/`: verificaciones automáticas.

## Compilar instaladores

```sh
npm test
npm run test:desktop
npm run pack
npm run dist
```

Compilar y verificar Windows en Windows; macOS en macOS. Los artefactos salen en `release/`. Para distribuir a usuarios faltan firma de Windows, firma/notarización de Apple, política de versiones y actualizaciones, soporte y pruebas de dispositivos. Los instaladores sin firma pueden generar avisos del sistema.

La prueba de integración comprueba apertura de la interfaz, aislamiento, decodificación WAV, reproducción, pausa, búsqueda, velocidad y final de pista con audio sintético silenciado. También comprueba varias vueltas de loop, pausa y salida del loop, guardado/recall/borrado de hot cues, audio retardado de echo, cola de reverb, atenuación del filtro y activación/reset de drive. No comprueba calidad audible ni latencia física. El instalador se ha generado y se ha verificado que el paquete incluye los archivos probados; no se ha ejecutado su asistente de instalación en este equipo.

La revisión inicial de dependencias no encontró avisos en dependencias de producción. Detectó avisos moderados en la cadena de herramientas de empaquetado (`electron-builder` → `sprintf-js`); no había una versión corregida publicada de `sprintf-js` al verificar. Es necesario revisar y resolver esta cadena antes de establecer un proceso de distribución pública.

## Camino hacia un producto público

1. Validar reproducción y MIDI con el modelo exacto de mesa, en Windows y macOS. Medir cortes, latencia y uso de memoria bajo carga.
2. Diseñar salida master + cue de auriculares y selección de dispositivos. Evaluar un motor nativo (C++/Rust) si las mediciones o los controladores lo exigen.
3. Añadir biblioteca persistente, streaming, perfiles de hardware importables/exportables y análisis de forma de onda/BPM en segundo plano.
4. Incorporar beatgrid, sync, cuantización de loops y time-stretch después de comprobar precisión del transporte.
5. Crear instaladores firmados, pruebas de larga duración, recuperación de desconexiones y beta con usuarios.

## Licencia y datos

No se ha elegido licencia para el código propio: debe decidirse antes de publicar o distribuir. Electron, yt-dlp y las dependencias conservan sus licencias; se deben incluir sus avisos correspondientes al distribuir. No hay telemetría. La importación de YouTube contacta YouTube mediante yt-dlp, y npm/las herramientas de compilación necesitan red para descargar dependencias. Las asignaciones MIDI se guardan en los datos locales de Electron. No se distribuye música.

Documentación técnica: [seguridad de Electron](https://www.electronjs.org/docs/latest/tutorial/security/), [permisos de sesión](https://www.electronjs.org/docs/latest/api/session), [transporte Web Audio](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode).
