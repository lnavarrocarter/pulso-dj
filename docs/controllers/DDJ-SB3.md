# Pioneer DJ DDJ-SB3

Controladora de 2 canales (4 decks con SHIFT/DECK) para Serato DJ Lite. USB VID `2B73`, PID `0019`. En Windows funciona con el driver genérico (`usbaudio`): expone un puerto MIDI de entrada y otro de salida llamados `DDJ-SB3`, una salida de audio y una interfaz HID que no se usa.

Pulso DJ incluye un perfil integrado (`src/controllers.mjs`). Al pulsar «Conectar MIDI» la mesa se selecciona sola, el perfil se activa y la pantalla se sincroniza con la posición física de faders y potenciómetros. Las asignaciones aprendidas a mano tienen prioridad sobre el perfil.

La sincronización solo va de la mesa a la pantalla: la SB3 no tiene faders ni potenciómetros motorizados, así que mover un control en pantalla no lo mueve en la mesa. Hacia la mesa, Pulso envía LEDs y vúmetros.

## Fuentes

- Mapeo de Mixxx (`res/controllers/Pioneer-DDJ-SB3.midi.xml` y `Pioneer-DDJ-SB3-scripts.js`, v1.1.0): <https://github.com/mixxxdj/mixxx/blob/main/res/controllers/Pioneer-DDJ-SB3.midi.xml>
- Lista oficial de mensajes MIDI de Pioneer DJ: <https://www.pioneerdj.com/-/media/pioneerdj/software-info/controller/ddj-sb3/ddj-sb3_midi_message_list_e2.pdf> (no se pudo descargar automáticamente; consultar a mano)
- Captura con `npm run midi:guided` de la mesa física el 31-10-2026: 105 controles, 91 coinciden con Mixxx. El resto son duplicados de los potenciómetros de FX (CC 2/4 y 34/36 en canales 5 y 6), la nota 77 de los canales 1 y 2, y pads en modos que Mixxx no documenta (canal 9, notas 16-21).

## Canales MIDI

Los canales se numeran desde 1 (canal 1 = status `0x90`/`0xB0`).

| Canal | Contenido |
| --- | --- |
| 1 / 2 / 3 / 4 | Decks 1 a 4. Cada lado de la mesa controla una capa: deck 1 o 3 a la izquierda, 2 o 4 a la derecha (ver «DECK 3/4») |
| 5 / 6 | Sección FX izquierda / derecha |
| 7 | Mezclador global: crossfader, filtros, navegador, LOAD, master, auriculares |
| 8 / 9 / 10 / 11 | Pads de los decks 1 a 4 |

Los faders y potenciómetros son de 14 bits: el CC indicado es el MSB y el LSB es CC + 32. El perfil combina los dos. Con SHIFT pulsado la mesa envía notas y CC distintos, así que el perfil no necesita seguir el estado de SHIFT.

## Deck (canales 1-4)

| Control | Mensaje | En Pulso |
| --- | --- | --- |
| PLAY/PAUSE | nota 11 | Reproducir / pausar |
| SHIFT + PLAY | nota 71 | Volver al cue y seguir reproduciendo (stutter) |
| CUE | nota 12 | Volver al cue y pausar |
| SHIFT + CUE | nota 72 | Marcar el cue en la posición actual |
| SYNC | nota 88 | Ajustar la velocidad para igualar el BPM de otro deck: prefiere uno que suene en el otro lado del crossfader (BPM manual o Tap; dentro del rango de tempo) |
| SHIFT + SYNC (OFF) | nota 92 | Tempo a 0 % |
| AUTO LOOP | nota 20 | Activar loop del tamaño actual / salir |
| SHIFT + AUTO LOOP (RELOOP/EXIT) | nota 80 | Salir del loop o volver al último loop |
| SHIFT + 1/2X / SHIFT + 2X | nota 97 / 98 | LOOP IN / LOOP OUT: loop manual de cualquier longitud |
| 1/2X / 2X | nota 18 / 19 | Reducir / ampliar el tamaño del loop (1-16 beats) |
| Fader de tempo | CC 0 / 32 | Velocidad dentro del rango (±16 % al arrancar); arriba = más lento, como en la mesa |
| SHIFT + KEYLOCK (TEMPO RANGE) | nota 96 | Rango de tempo ±6 / ±10 / ±16 / ±50 % |
| KEYLOCK | nota 26 | Mantener el tono al cambiar el tempo (estiramiento WSOLA en el hilo de audio) |
| TRIM | CC 4 / 36 | Ganancia de entrada, −24 a +12 dB con 0 dB en el centro |
| HI / MID / LOW | CC 7 / 11 / 15 | Agudos / medios / graves |
| Fader de canal | CC 19 / 51 | Volumen |
| Jog, girar (borde o superficie) | CC 33 / 34 / 35, relativo (valor − 64) | Con la superficie tocada y VINYL activo: scratch audible, hacia delante o hacia atrás (720 pasos = 1,8 s de audio). Sin tocar: reproduciendo empuja la velocidad (nudge); en pausa desplaza la posición en silencio |
| Jog, tocar superficie | nota 53 / 54 (103 con SHIFT) | Con VINYL activo el disco se detiene bajo la mano y sigue al jog; al soltar sigue reproduciendo si estaba sonando |
| VINYL | nota 23 | Activar / desactivar el scratch al tocar el plato (activo al arrancar) |
| SHIFT + VINYL (SLIP) | nota 64 | Al soltar el plato tras un scratch, la pista sigue donde habría estado |
| CUE de auriculares (1 / 2) | nota 84 (104 con SHIFT) | Escuchar el canal por los cascos, antes del fader. Necesita la DDJ-SB3 como salida de audio |
| SHIFT + jog | CC 31 / 38 | Búsqueda rápida (0,25 s por paso) |

El plato en pantalla se ilumina mientras se gira el jog y se aclara mientras se toca su superficie.

Los faders y potenciómetros usan soft takeover: si la pantalla movió un control (ratón, SYNC o, más adelante, el Auto DJ), el control físico no lo cambia hasta que pasa por el valor de la pantalla, para que el sonido no salte. La SB3 no tiene faders motorizados.

## Pads (canales 8-11)

Cada modo usa 16 notas en el canal de pads del deck: 8 pads y los mismos 8 con SHIFT. La mesa cambia de modo por sí misma; Pulso lo sigue con los botones de modo (canal del deck) y con la nota de cada pad, y enciende el botón del modo activo. En pantalla, el desplegable Pads elige el modo y Mayús + clic es SHIFT + pad.

| Botón | Nota del botón | Notas de los pads | Pads en Pulso | Con SHIFT |
| --- | --- | --- | --- | --- |
| HOT CUE | 27 | 0-7 (8-15) | Hot cues 1-8: guardar o saltar | Borrar el hot cue |
| SHIFT + HOT CUE (BEAT JUMP) | 105 | 64-71 (72-79) | ½ y ×2 del salto, saltar atrás / adelante, ir al inicio, retroceder y avanzar mientras se pulsa, CENSOR (reproduce al revés mientras se pulsa, con slip) | Saltos de 4 / 8 / 16 / 32 beats atrás (pads 1-4) y adelante (5-8) |
| FX FADE | 30 | 16-23 (24-31) | Mientras se pulsa, cierra el paso alto (pads 1-4) o el paso bajo (5-8) y baja el nivel en 1 / 2 / 4 / 8 beats | Igual |
| SHIFT + FX FADE (ROLL) | 107 | 80-87 (88-95) | Loop roll de 1/16 a 8 beats mientras se pulsa; al soltar sigue donde habría estado | Igual |
| PAD SCRATCH | 32 | 32-39 (40-47) | Ocho patrones de scratch al tempo (baby, forward, backward, chirp, transformer, tear, stab) mientras se pulsa, con slip | Igual |
| SHIFT + PAD SCRATCH (SLICER) | 109 | 96-103 (104-111) | Divide los 8 beats siguientes en 8 trozos de 1 beat; cada pad repite su trozo mientras se pulsa, con slip | Igual |
| SAMPLER | 34 | 48-55 (56-63) | Pads 1-4: disparar las muestras 1-4. Pads 5-8: cargar la pista seleccionada en la biblioteca en la muestra 1-4 | Pads 1-4: parar. Pads 5-8: vaciar |
| SHIFT + SAMPLER (TRANS) | 110 | 112-119 (120-127) | Corta el sonido a ritmo de 1/16, 1/8, 1/4 y 1/2 beat (pads 1-4) o en tresillos (5-8) mientras se pulsa | Igual |

Los tiempos en beats usan el BPM del deck (manual o Tap). El sampler tiene 4 muestras compartidas por todos los decks y suena por el master.

## FX (canal 5 = lado izquierdo, canal 6 = lado derecho)

Cada sección FX actúa sobre el deck activo en su lado (1 o 3 a la izquierda, 2 o 4 a la derecha).

| Control | Mensaje | En Pulso |
| --- | --- | --- |
| Botones FX 1 / 2 / 3 | notas 71 / 72 / 73 | Encender / apagar echo / reverb / drive |
| SHIFT + FX 1 (SELECT) | nota 99 | Apagar todos los efectos del deck |
| SHIFT + FX 2 / 3 (BEAT ◄ / ►) | notas 100 / 101 | Tiempo del echo a la mitad / al doble (1/8 a 2 beats) |
| SHIFT + potenciómetro FX | CC 18 / 50 | Sin función |
| Potenciómetro FX | CC 6 / 38 (también envía 2/34 y 4/36) | Profundidad de los efectos encendidos |

## Mezclador (canal 7)

| Control | Mensaje | En Pulso |
| --- | --- | --- |
| Crossfader | CC 31 / 63 | Crossfader |
| FILTER decks 1-4 | CC 23-26 / 55-58 | A la izquierda del centro cierra el paso bajo, a la derecha el paso alto; el centro tiene una zona muerta del 2 % |
| LOAD decks 1-4 | notas 70-73 | Cargar en ese deck la pista seleccionada en la biblioteca; sin selección, abre el selector de archivo |
| Navegador, girar | CC 64 (CC 100 con SHIFT), relativo (1 = siguiente, 127 = anterior) | Mover la selección de la biblioteca (de 10 en 10 con SHIFT) |
| Navegador pulsado | nota 65 | Cargar la pista seleccionada en el primer deck visible que no esté sonando |
| SHIFT + navegador pulsado (BACK) | nota 66 | Ir a la primera pista de la lista |
| MASTER (cue) | nota 91 (120 con SHIFT) | Escuchar el master por los cascos |
| MASTER LEVEL, HEADPHONES LEVEL | CC 8 / 13 | Sin función: actúan directamente sobre el sonido en la mesa |

## Salida de audio y cascos

La tarjeta de sonido de la DDJ-SB3 tiene 4 salidas: 1-2 van a MASTER OUT y 3-4 a los cascos. Al elegir «DDJ-SB3» en Salida (barra superior), Pulso manda el master a 1-2 y la mezcla de CUE a 3-4. Con una salida de 2 canales no hay cascos y los botones CUE lo avisan. La elección se recuerda por el nombre del dispositivo.

Para mostrar el nombre de las salidas, Chromium exige que pase la comprobación del permiso de audio. Pulso solo deja pasar esa comprobación; las peticiones de micrófono se siguen denegando (desktop/permissions.cjs).

## DECK 3/4

Los botones DECK 3 y DECK 4 envían la nota 114. Mixxx la espera en el canal del deck nuevo (valor 127) y que los controles pasen a ese canal. En la captura de esta mesa llegó en el canal del deck 1/2 con valor 0 y no hubo mensajes en los canales 3/4. Pulso acepta las dos formas: la nota 114 fija la capa de su lado (valor 127: la de ese canal; valor 0: la otra), y todos los controles de un lado (botones, faders, jog, pads, FILTER, LOAD) van al deck de esa capa, lleguen por el canal que lleguen. Un mensaje en los canales 3/4, o en los números de FILTER y LOAD de los decks 3/4, también activa esa capa.

Los LEDs de un lado muestran el deck de su capa y se envían por los dos canales del lado. En pantalla, el número del deck que controla la mesa tiene un anillo iluminado; si se pasa al deck 3 o 4 con la vista de 2 decks, se abre la de 4. Los faders y potenciómetros no saltan al cambiar de capa: el deck nuevo recibe la última posición física de cada control y se aplica la toma suave.

Pulso no puede cambiar la capa desde el ordenador: al enviar la nota 114 a la mesa, la petición de estado sigue informando de los decks 1 y 2 (comprobado el 31-10-2026).

## Sincronización al conectar

Pulso envía el mismo SysEx que Mixxx al arrancar (`F0 00 20 7F 03 01 F7`). La SB3 responde con unos 85 mensajes: nota 114 en el canal del deck activo de cada lado, y el valor de todos los faders, potenciómetros, filtros, FX y crossfader. Durante 1,2 s el perfil aplica esos valores e ignora los de la capa de decks oculta, que no reflejan los controles físicos. Comprobado con la mesa física el 31-10-2026.

Para enviar el SysEx la app pide acceso MIDI con SysEx; si se deniega, conecta sin él y sin sincronización.

## LEDs y vúmetros

El perfil envía nota on (127 encendido / 0 apagado) al puerto de salida cuando cambia el estado: PLAY (reproduciendo), CUE (pista cargada y en pausa), AUTO LOOP (loop activo, también manual), KEYLOCK, VINYL, SLIP, CUE de cascos, MASTER, botón del modo de pads activo, los 8 pads según el modo (hot cue guardado, muestra cargada o sonando, trozo del slicer en curso, pad pulsado) y botones FX (efecto encendido). Los vúmetros de canal reciben CC 2 en el canal de cada deck (0-117, como en Mixxx). Al cambiar de dispositivo o cerrar la ventana se apagan.

## Pendiente

- Comprobar con la mesa la luz de cada pad en los modos que no son HOT CUE.
- Confirmar con la mesa qué mensajes envía al pulsar DECK 3/4 (el perfil admite las dos formas conocidas).
