# Arquitectura

## Aplicación

Electron ejecuta una interfaz local HTML/CSS/ES modules. `desktop/main.cjs` crea la ventana, valida el origen de llamadas IPC y proporciona selectores nativos, guardado e importación. `preload.cjs` expone métodos concretos mediante `contextBridge`. El renderer no tiene Node.js, usa aislamiento de contexto, sandbox y CSP; se bloquean navegación externa y nuevas ventanas.

## Audio

`src/audio.mjs` contiene `Mixer` y `Deck`. Cada deck conecta su fuente a EQ, filtro y drive; se suman rutas seca, echo y reverb, seguidas de ganancia del canal y ganancia del crossfader. Ambas señales llegan al master, compresor, analizador y salida estéreo del sistema.

El transporte mantiene posición/tiempo/velocidad y usa loops nativos de AudioBufferSourceNode. La curva del crossfader mantiene potencia constante. La fuente se recrea al buscar/reanudar. No existen aún lectura por bloques, beatgrid ni time-stretch; el pitch cambia también el tono.

## Control e interfaz

`src/app.mjs` conecta el estado a controles, visualizaciones, hot cues, loops y aprendizaje MIDI. `core.mjs` contiene funciones puras de mezcla, tiempos y mensajes MIDI. Los perfiles actuales se guardan en localStorage con dispositivo/tipo/canal/número; faltan identidad estable, portabilidad y perfiles de fabricante.

## Segmentos y asistencia

`assistant-core.mjs` sintetiza PCM mono y codifica WAV: percusión por eventos, bajo, acordes periódicos y límites de amplitud. Incluye interpretación de un conjunto pequeño de indicaciones y cálculo de actividad visual/energía objetivo.

`assistant.mjs` contiene `SegmentLayer`, una fuente en loop con filtro y ganancia conectada directamente al master, y el montaje del panel. La capa no reemplaza decks ni pasa por su crossfader. La cámara se reduce a escala de grises; se compara con el fotograma anterior compensando cambios de brillo uniforme. Se conserva solo el fotograma previo en memoria, no una grabación.

La contribución visual es acotada y suavizada. La asistencia ajusta solo filtro y volumen de la capa cada ocho segundos como máximo, con umbral de cambio. Las órdenes manuales dominan; mover su volumen desactiva la asistencia. No hay detección de emociones ni modelo neuronal.

## Permisos

`desktop/permissions.cjs` permite MIDI sin SysEx y vídeo solo cuando el panel ha habilitado explícitamente cámara. Micrófono y permisos desconocidos se rechazan. Los streams se detienen al apagar, desconectarse o cerrar la página. macOS tiene una descripción de uso de cámara preparada, pendiente de validar en un Mac.

## YouTube

`desktop/youtube.cjs` normaliza enlaces a un vídeo YouTube de 11 caracteres, descarta parámetros y rechaza otros hosts/protocolos. Ejecuta yt-dlp sin shell, configuración del usuario, plugins ni cookies. Usa Electron en modo Node como runtime auxiliar. Limita tamaño/duración, permite una tarea, informa progreso y soporta cancelación/timeout. Lee el audio descargado y limpia la carpeta temporal que creó, validando su ubicación antes de borrarla.

`prepare-tools.cjs` obtiene el binario oficial, verifica SHA-256 y incluye manifest/licencias. El instalador lo empaqueta como recurso externo. El formato de audio se conserva; no hay mejora de calidad ni recodificación. Cambios de YouTube pueden romper la importación.

## Evolución hacia IA

Separar un futuro proveedor de música (`solicitar → esperar/consultar → validar → preparar pista`) del planificador DJ y de la ejecución de audio. Las claves deben quedarse en el proceso principal o backend apropiado. El planificador recibirá criterios manuales, datos musicales de la biblioteca y una señal agregada con calidad conocida; emitirá propuestas/acciones acotadas y explicables.

La generación no debe bloquear el transporte. El modo automático necesita cola preparada, presupuesto, fallback local y override. Antes de delegar transiciones, hace falta precisión musical de la fase 3 del roadmap. No se ejecutarán respuestas del modelo como código o comandos arbitrarios.
