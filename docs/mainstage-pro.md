# 🎹 Concierto «En vivo Pro» para MainStage

Guía para montar un concierto profesional de teclados en vivo, optimizado para **baja latencia** y **poco uso de CPU**, y conectado a Nano Control en el celular.

La idea central de las plantillas profesionales es: **los instrumentos van en cada patch, pero la mezcla, la compresión y los efectos grandes viven una sola vez a nivel de concierto.** Así cada patch es ligero, los cambios de patch son instantáneos y todo suena coherente.

---

## 1. Ajustes de audio (lo primero, lo que más influye en la latencia)

MainStage → **Ajustes → Audio**:

| Ajuste | Valor | Por qué |
|---|---|---|
| Dispositivo de salida | Tu interfaz de audio (no los altavoces del Mac) | Los drivers de una interfaz tienen menos latencia |
| Frecuencia de muestreo | **48 kHz** | El estándar en directo; 96 kHz duplica el uso de CPU |
| Tamaño del búfer de E/S | **128** (prueba **64** si la CPU lo aguanta) | 128 a 48 kHz ≈ 2,7 ms: imperceptible |
| Búfer de seguridad de E/S (*I/O Safety Buffer*) | **Desactivado** | Añade latencia; actívalo solo si oyes chasquidos con el búfer bajo |
| Latencia del driver (*Driver Latency*, si aparece) | **Lo más bajo posible** | Apple recomienda bajarlo una vez elegido el búfer |

Si oyes chasquidos o crujidos, sube el búfer a 256 y revisa la sección 6 (plugins pesados).

**En el Mac durante el concierto:** conecta el cargador, cierra el resto de apps y desactiva «Bajo consumo». Mantén el Wi‑Fi encendido: Nano Control lo usa. Mejor aún, conecta el celular por cable USB.

---

## 2. Arquitectura del concierto (el «mapa» de la mezcla)

```
 PATCH (cada canción)                    CONCIERTO (siempre presente)
┌────────────────────┐
│ Piano     ─────────┼──► Bus PIANO ──┐
│ Rhodes/Órgano ─────┼──► Bus KEYS ───┤
│ Synth / Lead ──────┼──► Bus SYNTH ──┼──► Bus TECLADOS ─► MASTER ─► Salida 1‑2 (FOH)
│ Cuerdas ───────────┼──► Bus CUERDAS ┤    (comp + EQ)     (limitador)
└────────────────────┘                │
 SET (sigue sonando entre patches)    │
┌────────────────────┐                │
│ PAD ambiente ──────┼──► Bus PAD ────┘
└────────────────────┘
 Envíos de todos ──► AUX REVERB (ChromaVerb) ─┐
                 ──► AUX DELAY (sincronizado) ─┼──► Bus TECLADOS
                 ──► AUX SHIMMER (opcional) ───┘

 Metrónomo / Click / Guías ──► Salida 3‑4 (solo in‑ears, NUNCA al público)
```

### Por qué así
- **Los buses agrupan** los sonidos del mismo tipo: con un fader del celular subes todos los pianos, uses el patch que uses.
- **Una sola reverb y un solo delay** para todo el concierto, en lugar de uno por patch. Ahorra muchísima CPU, y las colas no se cortan al cambiar de patch.
- **El pad a nivel de Set** sigue sonando cuando cambias de patch dentro de esa canción: transiciones sin cortes, la técnica clásica de *worship*.

> ⚠️ **En tu captura, el canal «Metrónomo» y «Playback» salen por Output 1‑2.** Si la Output 1‑2 va a la consola de sala, el público podría oír el click. Mándalo a la **Output 3‑4** (o la que vaya a tus in‑ears).

---

## 3. Cómo crearlo en MainStage, paso a paso

**A. Buses a nivel de concierto**
1. Selecciona el **concierto** (lo primero de la Lista de patches).
2. En cada canal de instrumento de tus patches, en **Salida**, elige un **Bus** (Bus 1 = Piano, Bus 2 = Keys, Bus 3 = Synth, Bus 4 = Cuerdas, Bus 5 = Pad). MainStage crea automáticamente un canal auxiliar para cada bus a nivel de concierto.
3. Ponle nombre a cada auxiliar (doble clic en el nombre del canal).
4. Las salidas de esos auxiliares van a **Bus 10 = TECLADOS** (el bus general), y ese bus va a **Output 1‑2**.

**B. Efectos compartidos (envíos)**
1. En un canal de instrumento, en **Envíos**, elige **Bus 20** → renómbralo **REVERB** → inserta **ChromaVerb** (sala grande, *Mix 100 %*).
2. **Bus 21 = DELAY** → **Stereo Delay** con sincronización al tempo (corchea con puntillo, *Mix 100 %*, *Feedback* 25‑35 %).
3. Opcional: **Bus 22 = SHIMMER** → ChromaVerb con modo *Bloom* o *Dark Room*, decay largo, mucho pre‑delay.
4. En cada patch, sube el envío de cada instrumento a esos buses según el sonido (pads mucho, piano poco).

**C. Pad a nivel de Set**
1. Selecciona el **Set** (la carpeta, por ejemplo «Set 1»).
2. Añade ahí un canal de instrumento con tu pad (Alchemy, Sampler, o tu pad favorito) → Salida **Bus 5 (PAD)**.
3. Así el pad sigue sonando entre los patches de ese Set.

**D. Que los cambios de patch no corten colas**
En el inspector del concierto, busca la opción de cambio de patch o «silenciar patch anterior» y elige que **no** silencie el anterior. Así las colas de reverb y delay terminan de forma natural.

---

## 4. Compresión y EQ (valores de partida)

| Dónde | Plugin | Ajustes | Objetivo |
|---|---|---|---|
| Cada instrumento | **Channel EQ** | Filtro pasa‑altos: Pad 120 Hz, Piano 60 Hz, Cuerdas 150 Hz, Lead 200 Hz | Limpia graves que embarran la mezcla con el bajo |
| Bus PIANO / KEYS | **Compressor** (modelo *Platinum Digital*) | Ratio 2:1 · Ataque 15‑25 ms · Release Auto · 2‑3 dB de reducción | Igualar dinámica sin aplastar |
| Bus PAD | **Compressor** | Ratio 3:1 · Ataque 30 ms · 3‑4 dB | Pad estable y «detrás» |
| Bus TECLADOS | **Channel EQ** + **Compressor** | EQ: ‑2 dB en 300 Hz · Comp 1,5:1, ataque 30 ms, 1‑2 dB | «Pegamento» de todo el set |
| Master | **Limiter** (no Adaptive Limiter) | Techo de salida −1 dB · Lookahead mínimo | Seguridad contra picos |

**Niveles (gain staging):** cada instrumento con picos alrededor de −12 dB, los buses alrededor de −8 dB y el máster alrededor de −6 dB, con el limitador casi sin trabajar. Envía a la consola un nivel sano y constante.

---

## 5. Celular: plantilla «En vivo Pro (buses)»

En Nano Control (modo MainStage) → **Controles** → **Plantilla… → En vivo Pro (buses)**. Luego usa **🔗 Conectar con MainStage** para asignarlos con *Aprender*.

| Celular | CC | Conéctalo en MainStage a… |
|---|---|---|
| Fader **Pad** | 20 | Volumen del auxiliar Bus PAD |
| Fader **Piano** | 21 | Volumen del Bus PIANO |
| Fader **Keys** | 22 | Volumen del Bus KEYS |
| Fader **Synth** | 23 | Volumen del Bus SYNTH |
| Fader **Cuerdas** | 24 | Volumen del Bus CUERDAS |
| Fader **Lead** | 25 | Volumen del canal del lead (por patch) |
| Fader **Reverb** | 26 | Volumen del auxiliar REVERB |
| Fader **Delay** | 27 | Volumen del auxiliar DELAY |
| Fader **Master** | 28 | Volumen del Bus TECLADOS |
| Knob **Filtro Pad** | 52 | Cutoff del filtro del pad (o Channel EQ pasa‑bajos) |
| Knob **Rev Piano** | 53 | Envío a REVERB del piano |
| Knob **Drive Keys** | 54 | Drive del órgano/Rhodes |
| Knob **Filtro Syn** | 55 | Cutoff del synth |
| Knob **Swell** | 56 | Volumen de las cuerdas (para entradas suaves) |
| Knob **Delay Lead** | 57 | Envío a DELAY del lead |
| Knob **Shimmer** | 58 | Volumen del auxiliar SHIMMER |
| Knob **Feedback** | 59 | Feedback del Stereo Delay |
| Knob **Brillo** | 60 | Ganancia de agudos del EQ en Bus TECLADOS |
| Botones **Mute** (alternan) | 112‑117 | Mute de cada bus |
| Botón **Freeze** (alterna) | 118 | *Freeze* de ChromaVerb (o subir el decay al máximo) |
| Botón **Tap Delay** | 119 | Acción *Tap Tempo* |
| Pad XY | X = 74 · Y = 11 | X = filtro del synth · Y = swell (expresión) |

**Consejo:** asigna los faders de bus en el **diseño del concierto**, no por patch. Así funcionan igual en todas las canciones.

**Para que el celular siga a MainStage al cambiar de patch:** en el inspector de cada control, **Enviar valor a → Nano Control**. Los faders del celular se colocan solos.

---

## 6. Plugins: qué evitar en directo

| Evitar | Por qué | Usa en su lugar |
|---|---|---|
| **Adaptive Limiter** | Tiene *lookahead*: añade latencia | **Limiter** con lookahead mínimo |
| **Linear Phase EQ** | Añade mucha latencia | **Channel EQ** |
| **Space Designer** en cada patch | Mucha CPU | Una sola **ChromaVerb** en un auxiliar del concierto |
| Reverbs y delays dentro de cada patch | CPU duplicada, colas cortadas | Envíos a los auxiliares del concierto |
| Alchemy con muchas voces y efectos internos | CPU | Baja la polifonía (16‑24 voces) y quita sus efectos internos |
| Compresores con *Lookahead* activado | Latencia | Lookahead en 0 |

**Comprueba el consumo:** muestra el medidor de CPU en la barra de MainStage. Si en algún patch pasa del 70 %, ese patch tiene algo pesado.

---

## 7. Principios de las plantillas profesionales (Sunday Keys, Peter James/Hillsong)

Lo que tienen en común las plantillas de pago más usadas en *worship*, y cómo aplicarlo en la tuya:

| Principio | Cómo lo hacen | En tu concierto |
|---|---|---|
| **Pads siempre disponibles e independientes** | Sunday Keys trae un reproductor de pads ambientales (*Tonic*). Los *Ambient Pads* de Peter James ofrecen el pad en 3 octavas (grave, medio, agudo) con un fader para cada una | Pad a nivel de Set (sección 3C) y, si puedes, 3 capas de pad con faders separados |
| **Pads de audio en lugar de sintetizadores** | Peter James usa archivos WAV largos (12 min, uno por tono) en el plugin **Playback**, que se apagan solos con *fade* | Casi no gastan CPU: ideal para Macs modestos |
| **Reverbs pensadas por instrumento** | Peter James distribuye presets de reverb específicos para pianos, Rhodes, bajos, arpegios, leads y pads | Un auxiliar de reverb por familia, o envíos distintos a la misma reverb |
| **Controlador ya asignado** | Sunday Keys viene asignada al **Korg nanoKONTROL2** y a **TouchOSC** | En Nano Control: **Plantilla → nanoKONTROL2 (Sunday Keys)**. El celular se comporta igual que ese controlador |
| **Diseño para dos teclados** | Sunday Keys incluye un diseño listo para dos teclados | Si tocas con dos teclados, prepara el diseño desde el principio |
| **Pocos plugins de terceros** | Hay versiones «nativas» que solo usan plugins de MainStage; las versiones PRO necesitan plugins de pago (p. ej. Valhalla) | Empieza con plugins nativos: menos fallos y menos latencia |

## 8. Lista de comprobación antes de tocar

- [ ] Búfer en 128, 48 kHz, interfaz de audio seleccionada
- [ ] Click y guías por Output 3‑4, no por la 1‑2
- [ ] Limitador en el máster a −1 dB
- [ ] Setlist cargada en Nano Control (pestaña «En vivo»), con los Program Change correctos
- [ ] Controles del celular conectados con el asistente y concierto guardado (⌘S)
- [ ] Celular por cable USB o en el mismo Wi‑Fi de 5 GHz; bloqueo de escenario 🔒 activado durante el set
