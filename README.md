# 🎛️ Nano Control

Superficie de control táctil **de baja latencia** para **Logic Pro** y **MainStage** (en vivo), inspirada en TouchOSC, Korg nanoKONTROL, Mackie Control y Ableton Push.
Funciona en **iPhone / iPad, Android y Mac** desde el navegador, sin instalar apps de tienda.

```
 iPhone / iPad / Android / Mac            Mac
┌──────────────────────────┐   WebSocket   ┌──────────────┐  CoreMIDI  ┌───────────┐
│  Nano Control (web app)  │ ◄───binario──►│ Puente Node  │ ◄────────► │ Logic Pro │
└──────────────────────────┘   1–3 ms LAN  └──────────────┘            └───────────┘
```

## Qué incluye

| Pestaña | Para qué sirve |
|---|---|
| **Mezcla** | 8 canales Mackie Control: fader con *touch*, V‑Pot con anillo de LEDs, R / S / M / SEL, medidores, nombres de pista y valores desde Logic, fader Master, bancos ◀▶, modos Pista/Envío/Pan/Plug‑in/EQ/Instrumento, Flip. |
| **Tocar** | Pads multitouch con **ayudas para tocar**: modo **Escala** (solo notas de la tonalidad, como Push), **Cromático** con notas fuera de escala atenuadas, **Acordes** diatónicos (tríadas, 7ª, con bajo, add9 en grados I–VII, con nombre y numeral romano) y **Batería** 4×4 estilo MPC (General MIDI / Drum Machine Designer). 14 escalas, octava ±, sustain, pitch bend con retorno, rueda de modulación, glissando deslizando el dedo, velocidad fija o por posición. |
| **Controles** | Estilo nanoKONTROL: 8 knobs, 8 faders, botones A (alterna) y B (momentáneo), pad XY. Para mapear con *Aprender* en Logic. |
| **Transporte** | Rueda Jog, Scrub, Zoom, marcadores, cursores, deshacer, guardar, Click, Drop/Replace, automatización (Read/Write/Touch/Latch/Trim), modificadores Shift/Option/Ctrl/Cmd, vistas del mezclador y F1–F8. |

La barra superior siempre muestra transporte, posición de Logic y la latencia real medida (ida y vuelta).

### Por qué es rápido
- Mensajes MIDI **crudos en binario** (3 bytes por movimiento, sin JSON) por WebSocket con `TCP_NODELAY`.
- Los mensajes simultáneos (un acorde de 4 notas) viajan en **un solo paquete**.
- Sin frameworks: eventos *pointer* nativos, multitouch real (cada dedo controla su fader), redibujado agrupado por frame y sin reflujo de layout al mover.
- Feedback filtrado: si tu dedo está en un fader, Logic no lo "pelea".
- Puertos MIDI **virtuales nativos** de CoreMIDI: nada de IAC ni drivers extra.

## Instalación (una sola vez, en el Mac)

1. Instala **Node.js LTS** desde <https://nodejs.org>.
2. Descarga este repositorio y haz **doble clic en `Iniciar Nano Control.command`**
   (o en Terminal: `npm install && npm start`).
3. En la ventana aparecerá una dirección tipo `http://192.168.1.20:7777` y un **código QR**.

## 🎹 Modo MainStage (para tocar en vivo)

En ⚙︎ Ajustes → **Modo: MainStage** (o abre `http://IP:7777/?modo=mainstage`). La app cambia a una interfaz de escenario:

| Pestaña | Para qué sirve |
|---|---|
| **En vivo** | **Setlist** con letra grande: cada tema envía su *Program Change* y cambia el patch de MainStage. Muestra el tema actual, el **siguiente**, tono, BPM y tus **notas** (acordes, letra, avisos). Botones gigantes **◀ Anterior / Siguiente ▶**. **Tempo** en vivo desde el reloj MIDI de MainStage con luz de pulso (amarilla en el 1). **TAP tempo**, botones de acción y **PÁNICO**. |
| **Tocar** | Los mismos pads con escalas, acordes y batería (para samples, loops o tocar encima). |
| **Controles** | 8 faders, 8 knobs, botones y XY para asignar a los controles de pantalla de MainStage. |

**Pensado para el escenario:**
- 🔒 **Bloqueo de escenario**: un toque al candado bloquea la setlist, las pestañas y los botones de cambio de patch para que un roce no te cambie el sonido en mitad de un tema. Para desbloquear, **mantén pulsado 1 segundo**.
- 🦶 **Pedal de página Bluetooth** (AirTurn, PageFlip, etc.): flecha derecha/abajo, AvPág o espacio = siguiente tema; flecha izquierda/arriba o RePág = anterior.
- 📱📱 **Varios dispositivos sincronizados**: si cambias de tema en el iPad, el iPhone también cambia. La setlist se guarda en el Mac (`~/.nano-control/setlist.json`) y la ven todos.
- La setlist también queda guardada en cada dispositivo: si se corta el Wi‑Fi, sigues viéndola.

### Configurar MainStage
1. **Cambiar patches con la setlist:** en MainStage, selecciona cada patch y en el **Inspector de patch** activa *Program Change* con un número. En Nano Control: **Editar** → añade los temas con el mismo número (o pulsa *Numerar PC* y numera igual en MainStage). Si al tocar un tema MainStage salta al patch de al lado, cambia ⚙︎ → *Números de Program Change: empiezan en 1*.
2. **Tempo en la pantalla:** en MainStage → **Ajustes → Sincronización → MIDI**, activa enviar **reloj MIDI** a `Nano Control`. Si tu versión no lo tiene, usa el botón TAP.
3. **Botones de acción** (modo **Layout**, ⌘L): crea o elige un botón, pulsa **Learn** y toca el botón en la pantalla. Después, en el inspector, asígnale una acción de MainStage:

   | Botón | CC | Acción sugerida en MainStage |
   |---|---|---|
   | TAP | 106 | Tap Tempo |
   | Patch − / Patch + | 102 / 103 | Previous Patch / Next Patch (útil si no usas setlist) |
   | Set − / Set + | 104 / 105 | Previous Set / Next Set |
   | Acción 1–4 | 107–110 | Lo que quieras: Playback, mute de una capa, Panic, etc. |

4. **Faders y knobs** (pestaña Controles): en **Layout** pulsa **Learn** en cada control de pantalla y mueve el control en Nano Control (faders CC 41–48, knobs CC 21–28). Para que los faders se coloquen solos al cambiar de patch, en el inspector del control elige **Enviar valor a → Nano Control**.
5. **Plantilla «TWO»:** en la pestaña Controles, la plantilla *MainStage «TWO»* ya usa los mismos CC que ese concierto (knobs CC14–21, faders CC2/3/4/5/6/8/9/12, Volumen CC7). Con **✎ Editar** puedes cambiar el nombre y el CC de cualquier control.
6. **Lista de patches:** MainStage no envía los nombres de sus patches por MIDI, así que en **Editar → 📋 Pegar o escribir toda la lista** escribes o pegas los nombres (una línea cada uno; «Set 1», «Set 2» crean secciones) y los Program Change se numeran solos.
7. **Sin setlist**, los botones Anterior/Siguiente envían CC102/CC103: asígnalos a *Previous/Next Patch* y funcionan igual.

## Configurar Logic Pro

**Mezclador (Mackie Control):**
1. Logic Pro → **Ajustes de superficies de control → Configuración…**
2. Menú **Nuevo → Instalar…**, elige **Mackie Designs · Mackie Control** → *Añadir*.
3. En el panel del dispositivo pon **Puerto de salida** y **Puerto de entrada** en **`Nano Control MCU`**.

Listo: los faders, nombres, medidores y botones quedan sincronizados en ambos sentidos.

**Instrumentos (pads):** las pistas de instrumento software reciben el puerto `Nano Control` automáticamente (Logic escucha todas las entradas MIDI). Elige una pista y toca.

**Knobs / faders / XY (pestaña Controles):** en Logic pulsa **⌘K** (Asignaciones de controlador → *Aprender*), toca un parámetro con el ratón y mueve el control en la pantalla. Mapa por defecto:

| Control | CC |
|---|---|
| Knobs 1–8 | 21–28 |
| Faders 1–8 | 41–48 |
| Botón A 1–8 (alterna) | 51–58 |
| Botón B 1–8 (momentáneo) | 61–68 |
| Pad XY | X = 12, Y = 13 |

Los canales MIDI de pads y controles se cambian en ⚙︎ Ajustes.

## En el móvil / tablet

1. Conéctalo a la **misma red** que el Mac y escanea el QR (o escribe la dirección).
2. **iPhone/iPad:** Compartir → **Añadir a pantalla de inicio** → se abre a pantalla completa como una app.
   **Android (Chrome):** menú ⋮ → *Añadir a pantalla de inicio*, o ⚙︎ → *Pantalla completa*.
3. En el Mac también puedes abrir `http://localhost:7777` (útil en pantallas táctiles o con un iPad como Sidecar).

Puedes conectar **varios dispositivos a la vez** (p. ej. iPad para la mezcla y iPhone para los pads): los faders se sincronizan entre ellos.

## Apps nativas (opcionales, recomendadas)

Las apps encuentran tu Mac **solas** por Bonjour (sin escribir IPs) y añaden pantalla completa real, pantalla siempre encendida, vibración háptica y reconexión automática. Dentro de la app, ⚙︎ → **Cambiar de Mac** vuelve a la pantalla de conexión.

### 🤖 Android (APK)
1. En tu Android abre la página **Releases** de este repositorio → *Nano Control para Android (última versión)*.
2. Toca **`nano-control.apk`**, ábrelo y acepta «Permitir instalar apps de esta fuente».
3. Abre Nano Control: tu Mac aparece en la lista → tócalo.

Extra en Android: el Wi‑Fi se pone en **modo de baja latencia** mientras usas la app.
La APK la compila GitHub automáticamente (`.github/workflows/android.yml`). Para compilarla tú: `cd apps/android && ./gradlew assembleRelease` (requiere Android SDK).

### 🍎 iPad (sin Mac, con Swift Playgrounds)
1. Instala **Swift Playgrounds** (gratis) en el iPad.
2. Copia la carpeta `apps/ios/NanoControl.swiftpm` al iPad (AirDrop o iCloud Drive) y ábrela con Swift Playgrounds.
3. Pulsa ▶︎ y luego **«Instalar en pantalla de inicio»** (o usa el menú *App Settings → Install*). Acepta el permiso de **Red local**.

### 🍎 iPhone (y iPad) con Xcode en el Mac
1. Instala **Xcode** (gratis) y abre `apps/ios/NanoControl.swiftpm` (doble clic).
2. En *Signing & Capabilities* elige tu **Apple ID** como equipo (vale una cuenta gratuita).
3. Conecta el iPhone por cable, selecciónalo arriba y pulsa ▶︎. La primera vez: en el iPhone, Ajustes → General → VPN y gestión de dispositivos → confiar en tu Apple ID.
4. Con una cuenta gratuita la firma dura 7 días (vuelve a pulsar ▶︎ para renovar). Con cuenta de desarrollador de pago dura un año.

> Sin instalar nada: en iPhone/iPad, Safari → Compartir → **Añadir a pantalla de inicio** también funciona a pantalla completa.

## Consejos para la mínima latencia
- 🥇 **Cable USB**: conecta el iPhone al Mac con cable y activa *Compartir Internet* / *Punto de acceso personal*; en Android activa *Anclaje USB*. Usa la IP que aparezca para esa interfaz. Latencia típica < 2 ms.
- 🥈 **Wi‑Fi de 5 GHz** cerca del router (evita redes de invitados con aislamiento de clientes).
- La latencia medida aparece arriba a la izquierda; si sube de ~15 ms revisa la red.
- En ⚙︎ elige faders **Relativos** (sin saltos al tocar, ideal para mezclar) o **Absolutos** (saltan al dedo, como TouchOSC).

## 🆘 La app no conecta (pantalla negra o vuelve a pedir conexión)

La app se conecta a la **ventana de Terminal de Nano Control** en el Mac, no a Logic ni a MainStage. Revisa en este orden:

1. **¿Está abierta la ventana de Terminal y dice «puente listo»?** Si la cerraste, abre otra vez `Iniciar Nano Control.command` y déjala abierta.
2. **Prueba en el propio Mac:** abre Safari en `http://localhost:7777`. Si se ve el controlador, el puente funciona.
3. **Prueba en el móvil con el navegador** (Chrome/Safari) usando la dirección exacta que muestra la Terminal (`http://192.168.x.x:7777`).
   - Si en la Terminal aparece `🌐 Interfaz pedida por …`, la red funciona.
   - Si no aparece nada, el problema es de red o del cortafuegos (sigue con los pasos 4 y 5).
4. **Misma red:** el móvil debe estar en el **mismo Wi‑Fi** que el Mac, sin datos móviles y sin red de «invitados» (esas redes aíslan los dispositivos).
5. **Cortafuegos y privacidad del Mac:**
   - Ajustes del Sistema → Red → **Cortafuegos** → Opciones → permite **node** (o desactívalo para probar).
   - Ajustes del Sistema → Privacidad y seguridad → **Red local** → activa **Terminal**.
6. Si tu Mac tiene **VPN** activada, desactívala para probar.

## Opciones del puente

```bash
node bridge/server.js --port 8000          # otro puerto
node bridge/server.js --pin 1234           # pide PIN (http://IP:7777/?pin=1234)
node bridge/server.js --name "Mi Control"  # otro nombre de puertos MIDI
node bridge/server.js --mock               # sin MIDI: imprime lo que enviaría (pruebas)
node bridge/server.js --no-bonjour         # no anunciarse en la red
```

## Estructura

```
bridge/server.js   Puente: HTTP + WebSocket + puertos MIDI virtuales + handshake Mackie Control + Bonjour
apps/android/      App nativa Android (WebView acelerado, descubrimiento NSD, Wi‑Fi baja latencia)
apps/ios/          App nativa iPhone/iPad (SwiftUI + WKWebView, descubrimiento Bonjour, hápticos)
web/index.html     App táctil (PWA)
web/app.js         Motor: red binaria, faders, V‑Pots, pads, escalas, acordes, feedback MCU
web/style.css      Diseño adaptable (iPhone, iPad, Android, Mac)
test/smoke.js      Prueba de punta a punta con navegador real (npm test)
test/mainstage.js  Prueba del modo MainStage (setlist, PC, reloj MIDI, sincronía, bloqueo)
```

## Licencia
MIT
