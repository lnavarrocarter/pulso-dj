# Roadmap de Pulso DJ

Actualizado el 13 de octubre de 2026. Las fases siguientes son prioridades propuestas, sin fechas comprometidas. Las versiones 0.1–0.4 describen iteraciones locales; el primer snapshot Git corresponde a 0.4.

## Objetivo

Crear un software de DJ para Windows y macOS utilizable por otros usuarios, compatible con distintas controladoras USB mediante perfiles de hardware. Combinar mezcla tradicional, loops/efectos, segmentos musicales creados por el software y asistencia según criterios del DJ y señales del ambiente.

La preferencia actual para observar el ambiente es **cámara + indicaciones del DJ**. No se ha localizado la supuesta librería de Suno; por eso la primera alternativa crea segmentos con síntesis local. Integrar un modelo generativo real sigue pendiente.

## Entregado hasta 0.4

- [x] Base de escritorio Electron y motor Web Audio separado de la interfaz.
- [x] Dos decks, transporte, EQ, pitch, crossfader, master y visualizaciones.
- [x] Aprendizaje MIDI de notas/CC y persistencia local de asignaciones.
- [x] Loops por BPM manual, Tap tempo, hot cues y cuatro efectos por deck.
- [x] Importación de audio de YouTube, cancelación, límites y guardado del original.
- [x] Segmentos locales de cuatro compases, capa de mezcla y exportación WAV.
- [x] Cámara opcional, actividad visual agregada, indicaciones limitadas y adaptación de la capa.
- [x] Instalador Windows, 16 pruebas unitarias y pruebas de integración de audio/asistencia.
- [x] Código y documentación preparados para GitHub, con instalador alpha como asset de una versión.

## Fase 1 — Base de audio y hardware validada

Prioridad máxima antes de usarlo en actuaciones.

- [ ] Identificar la marca/modelo de la mesa y su protocolo (MIDI, HID o propietario).
- [ ] Probar la mesa real en Windows y macOS; transporte, faders, EQ, pads y reconexión USB.
- [ ] Compilar, instalar y probar macOS, en las arquitecturas que se decida soportar.
- [ ] Selección explícita de tarjeta, salidas master + cue/auriculares y ruteo multicanal.
- [ ] Medir latencia, cortes, deriva de transporte, CPU y memoria; pruebas de sesiones largas.
- [ ] Decidir si Web Audio cumple los resultados necesarios o si hace falta un motor nativo C++/Rust e integración ASIO/CoreAudio.
- [ ] Recuperación ante cambio de dispositivo, suspensión y desconexiones.

Criterio de aceptación: reproducción y preescucha funcionales con hardware real en ambos sistemas, sin cortes en una sesión de duración acordada y con métricas documentadas. Las cifras objetivo se fijarán a partir del hardware y las mediciones, no se dan por garantizadas.

## Fase 2 — Biblioteca y compatibilidad reutilizable

- [ ] Biblioteca persistente: metadatos, búsqueda, playlists, historial y preferencias.
- [ ] Streaming o lectura por bloques; análisis en segundo plano para reducir memoria y bloqueos.
- [ ] Cues, loops y ajustes guardados por pista, con identificadores resistentes a cambios de ruta.
- [ ] Perfiles de controladoras importables/exportables, identidad estable y asignaciones editables.
- [ ] Jog wheels relativos, CC de 14 bits, LEDs/SysEx y adaptadores HID cuando el hardware lo requiera.
- [ ] Diagnóstico claro de formatos, dispositivos y fallos de carga.

Criterio de aceptación: cerrar/reabrir conserva biblioteca y puntos; una colección representativa se maneja sin cargarla entera en RAM y dos usuarios pueden compartir un perfil de mesa.

## Fase 3 — Mezcla musical precisa y exportación

- [ ] Análisis de BPM, tonalidad y beatgrid editable por el DJ.
- [ ] Quantización de hot cues y loops, sync y cambios de longitud de loop sin saltos indebidos.
- [ ] Time-stretch/key lock y evaluación de calidad; scratch según el soporte del hardware.
- [ ] Echo/FX sincronizados al tempo efectivo y control de colas/transiciones.
- [ ] Grabación/exportación del master con pistas, capa generada y efectos; gestión de duración y memoria.
- [ ] Alineación de segmentos con compases reales y compatibilidad armónica.

Criterio de aceptación: transiciones y loops verificados contra referencias temporales, exportación que represente la mezcla audible y pruebas de calidad escuchadas por DJs. Actualmente el WAV exportado contiene solo el segmento, sin mezcla ni ajustes de reproducción.

## Fase 4 — DJ asistido por un modelo real

- [ ] Elegir un proveedor/modelo disponible y con acceso de API confirmado: Suno u otra alternativa, sin asumir que ya tenemos sus modelos o credenciales.
- [ ] Adaptador de generación con autenticación fuera del renderer, límites de coste, cancelación, cola, reintentos y validación de resultados.
- [ ] Generar con anticipación; mantener música disponible durante latencias o fallos del proveedor.
- [ ] Interpretación de criterios más amplios: estilo, energía, duración, restricciones y objetivos de la sesión.
- [ ] Biblioteca etiquetada y recomendación de la siguiente pista con explicación.
- [ ] Modo asistido que propone acciones; modo automático activado explícitamente y con parada/override inmediato.
- [ ] Ejecutar transiciones, variar segmentos y dosificar FX respetando BPM/beatgrid, límites de ganancia y controles manuales.
- [ ] Evaluar recomendaciones y generación con sesiones reproducibles y valoración del DJ.

Criterio de aceptación: un proveedor real genera audio que se prepara y reproduce sin interrupciones de la sesión; la recomendación explica qué criterio usa; fallos o presupuesto agotado conservan reproducción y control manual. Una secuencia de reglas no se presentará como un modelo generativo.

## Fase 5 — Ambiente de la fiesta y beta de producto

- [ ] Validar la cámara real y el estimador con iluminación de fiesta y movimiento de la cámara.
- [ ] Calibración, indicador de calidad de señal y reducción/desactivación del aporte visual cuando sea poco fiable.
- [ ] Evaluar si un modelo de visión mejora una medida de actividad útil, conservando procesamiento local cuando sea viable.
- [ ] Mantener el vídeo como señal auxiliar: no identificar personas ni inferir emociones, gustos o características sensibles.
- [ ] Controles de privacidad visibles, apagado inmediato y manejo de desconexión.
- [ ] Firma Windows, firma/notarización macOS, actualizaciones y posibilidad de volver a una versión estable.
- [ ] Resolver avisos de dependencias de empaquetado y revisar avisos/licencias de todas las distribuciones.
- [ ] Elegir licencia del código, distribución gratuita/comercial, plataformas/mesas soportadas y canales de soporte.
- [ ] Beta con otros DJs, pruebas de instalación/desinstalación, accesibilidad y funcionamiento prolongado.

Criterio de aceptación: instaladores firmados de ambos sistemas, compatibilidad publicada con hardware verificado, gestión transparente de cámara y evidencia de estabilidad en la beta.

## Decisiones abiertas

1. Modelo exacto de la controladora y sistemas/arquitecturas que deben soportarse.
2. Latencia objetivo, dispositivos multicanal y necesidad de motor nativo.
3. Proveedor de generación, acceso, costes y condiciones para los usos previstos.
4. Alcance del modo automático y límites que siempre impondrá el DJ.
5. Licencia, nombre definitivo, identidad visual y modelo de distribución.

Micrófono no forma parte de la preferencia actual y permanece bloqueado. No se priorizan suscripciones/cuentas para las funciones locales ni dependencia obligatoria de la nube para reproducir música.
