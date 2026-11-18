# 🎛️ Nano Control

Superficie de control táctil **de baja latencia** para **Logic Pro**, inspirada en TouchOSC, Korg nanoKONTROL, Mackie Control y Ableton Push.
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
```

## Licencia
MIT
