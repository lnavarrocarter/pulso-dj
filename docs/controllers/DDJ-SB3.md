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
| 1 / 2 / 3 / 4 | Decks 1 a 4. Los botones DECK 3/4 cambian por qué canal envía cada lado de la mesa |
| 5 / 6 | Sección FX izquierda / derecha |
| 7 | Mezclador global: crossfader, filtros, navegador, LOAD, master, auriculares |
| 8 / 9 / 10 / 11 | Pads de los decks 1 a 4 |

Los faders y potenciómetros son de 14 bits: el CC indicado es el MSB y el LSB es CC + 32. El perfil combina los dos. Con SHIFT pulsado la mesa envía notas y CC distintos, así que el perfil no necesita seguir el estado de SHIFT.

## Deck (canales 1-4)

| Control | Mensaje | En Pulso |
| --- | --- | --- |
| PLAY/PAUSE | nota 11 | Reproducir / pausar |
| CUE | nota 12 | Volver al cue y pausar |
| SHIFT + CUE | nota 72 | Marcar el cue en la posición actual |
| SYNC | nota 88 | Ajustar la velocidad para igualar el BPM de otro deck: prefiere uno que suene en el otro lado del crossfader (BPM manual o Tap; límite ±16 %) |
| AUTO LOOP | nota 20 | Activar loop del tamaño actual / salir |
| SHIFT + AUTO LOOP | nota 80 | Salir del loop |
| 1/2X / 2X | nota 18 / 19 | Reducir / ampliar el tamaño del loop (1-16 beats) |
| Fader de tempo | CC 0 / 32 | Velocidad ±16 %; arriba = más lento, como en la mesa |
| HI / MID / LOW | CC 7 / 11 / 15 | Agudos / medios / graves |
| Fader de canal | CC 19 / 51 | Volumen |
| Jog, girar (borde o superficie) | CC 33 / 34 / 35, relativo (valor − 64) | Reproduciendo: empuja la velocidad (nudge). En pausa: desplaza la posición (720 pasos = 1,8 s) |
| Jog, tocar superficie | nota 53 / 54 | Mientras se toca, pausa y deja mover la posición; al soltar sigue reproduciendo |
| SHIFT + jog | CC 31 / 38 | Búsqueda rápida (0,25 s por paso) |
| TRIM, KEYLOCK, VINYL, SHIFT + PLAY, CUE de auriculares | — | Sin función en Pulso |

El plato en pantalla se ilumina mientras se gira el jog y se aclara mientras se toca su superficie.

## Pads (canales 8-11, modo HOT CUE)

| Control | Mensaje | En Pulso |
| --- | --- | --- |
| Pads 1-4 | notas 0-3 | Hot cue 1-4: guardar o saltar |
| SHIFT + pads 1-4 | notas 8-11 | Borrar hot cue |
| Pads 5-8 | notas 4-7 | Loop de 1 / 2 / 4 / 8 beats (pulsar otra vez para salir) |

Los otros modos de pads (FX FADE, PAD SCRATCH, SAMPLER) envían notas que el perfil ignora.

## FX (canal 5 = lado izquierdo, canal 6 = lado derecho)

Cada sección FX actúa sobre el deck activo en su lado (1 o 3 a la izquierda, 2 o 4 a la derecha).

| Control | Mensaje | En Pulso |
| --- | --- | --- |
| Botones FX 1 / 2 / 3 | notas 71 / 72 / 73 | Encender / apagar echo / reverb / drive |
| SHIFT + botones FX | notas 99-101 | Apagar todos los efectos del deck |
| Potenciómetro FX | CC 6 / 38 (también envía 2/34 y 4/36) | Profundidad de los efectos encendidos |

## Mezclador (canal 7)

| Control | Mensaje | En Pulso |
| --- | --- | --- |
| Crossfader | CC 31 / 63 | Crossfader |
| FILTER decks 1-4 | CC 23-26 / 55-58 | A la izquierda del centro cierra el filtro paso bajo; la mitad derecha (paso alto) no tiene efecto |
| LOAD decks 1-4 | notas 70-73 | Cargar en ese deck la pista seleccionada en la biblioteca; sin selección, abre el selector de archivo |
| Navegador, girar | CC 64 (CC 100 con SHIFT), relativo (1 = siguiente, 127 = anterior) | Mover la selección de la biblioteca (de 10 en 10 con SHIFT) |
| Navegador pulsado, MASTER CUE, niveles de master y auriculares | nota 65, nota 91, CC 8 / 13 | Sin función (los niveles son analógicos) |

## Sincronización al conectar

Pulso envía el mismo SysEx que Mixxx al arrancar (`F0 00 20 7F 03 01 F7`). La SB3 responde con unos 85 mensajes: nota 114 en el canal del deck activo de cada lado, y el valor de todos los faders, potenciómetros, filtros, FX y crossfader. Durante 1,2 s el perfil aplica esos valores e ignora los de la capa de decks oculta, que no reflejan los controles físicos. Comprobado con la mesa física el 31-10-2026.

Para enviar el SysEx la app pide acceso MIDI con SysEx; si se deniega, conecta sin él y sin sincronización.

## LEDs y vúmetros

El perfil envía nota on (127 encendido / 0 apagado) al puerto de salida cuando cambia el estado: PLAY (reproduciendo), CUE (pista cargada y en pausa), AUTO LOOP (loop activo), HOT CUE (modo de pads), pads 1-4 (hot cue guardado), pads 5-8 (loop de ese tamaño activo) y botones FX (efecto encendido). Los vúmetros de canal reciben CC 2 en el canal de cada deck (0-117, como en Mixxx). Al cambiar de dispositivo o cerrar la ventana se apagan.

## Pendiente

- Scratch audible: hoy tocar el jog pausa y mueve la posición en silencio.
- Filtro paso alto para la mitad derecha de FILTER.
- Sampler y modos de pads adicionales.
- Comprobar qué envía la mesa al pulsar DECK 3/4: si no manda la posición de los controles, la nueva capa conserva los valores anteriores hasta que se mueve cada control.
