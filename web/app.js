/* Nano Control — superficie táctil para Logic Pro.
 * Sin frameworks ni dependencias: cada toque se convierte en bytes MIDI y sale por el
 * WebSocket en el mismo tick (los mensajes simultáneos, como un acorde, viajan en un solo paquete).
 */
'use strict';

// ════════════════════════ Utilidades ════════════════════════
const $ = (s, r = document) => r.querySelector(s);
function h(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ════════════════════════ Ajustes ════════════════════════
const DEFAULTS = {
  faderMode: 'relative',
  velMode: 'fixed',
  velocity: 100,
  playChannel: 0,
  ctlChannel: 0,
  noteNames: 'es',
  haptics: true,
  pin: '',
  // pads
  layout: 'scale',
  key: 0,
  scale: 'Mayor',
  octave: 3,
  rows: 0, // 0 = automático
  // modo
  mode: 'logic', // 'logic' | 'mainstage'
  pcBase: 0, // MainStage muestra los Program Change desde 0 o desde 1
};
const settings = Object.assign({}, DEFAULTS, (() => {
  try { return JSON.parse(localStorage.getItem('nano.settings') || '{}'); } catch (_) { return {}; }
})());
function saveSettings() {
  try { localStorage.setItem('nano.settings', JSON.stringify(settings)); } catch (_) {}
}
// ?modo=mainstage o ?modo=logic en la dirección fija el modo (útil para un marcador por modo)
{
  const m = new URLSearchParams(location.search).get('modo');
  if (m === 'mainstage' || m === 'logic') {
    settings.mode = m;
    saveSettings();
  }
}
const MS = settings.mode === 'mainstage';
document.body.classList.add(MS ? 'mode-mainstage' : 'mode-logic');
// Vibración: en las apps nativas usamos el motor háptico del sistema (iPhone incluido)
const nativeHaptic =
  (window.NanoNative && ((ms) => window.NanoNative.vibrate(ms))) ||
  (window.webkit?.messageHandlers?.haptic && (() => window.webkit.messageHandlers.haptic.postMessage(1))) ||
  (navigator.vibrate && ((ms) => navigator.vibrate(ms))) ||
  null;
function haptic() {
  if (settings.haptics && nativeHaptic) nativeHaptic(6);
}

// ════════════════════════ Red (WebSocket binario) ════════════════════════
const P_GEN = 0, P_MCU = 1, C_PING = 0xff, C_SYNC = 0xfe;

const net = {
  ws: null,
  q: [[], []],
  flushQueued: false,
  pings: new Map(),
  seq: 0,
  retry: 300,

  connect() {
    const pin = settings.pin || new URLSearchParams(location.search).get('pin') || '';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws${pin ? '?pin=' + encodeURIComponent(pin) : ''}`);
    } catch (_) {
      return setTimeout(() => this.connect(), 1000);
    }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.retry = 300;
      setStatus('on');
      ws.send(Uint8Array.of(C_SYNC));
      this.ping();
      if (MS) live.load();
    };
    ws.onmessage = (e) => onFrame(new Uint8Array(e.data));
    ws.onclose = (e) => {
      setStatus(e.code === 4001 ? 'pin' : 'off');
      this.ws = null;
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 1.6, 3000);
    };
    ws.onerror = () => {};
    this.ws = ws;
  },

  send(port, a, b, c) {
    const q = this.q[port];
    q.push(a, b);
    if (c !== undefined) q.push(c);
    if (!this.flushQueued) {
      this.flushQueued = true;
      queueMicrotask(() => this.flush());
    }
  },

  flush() {
    this.flushQueued = false;
    const ws = this.ws;
    for (let p = 0; p < 2; p++) {
      const q = this.q[p];
      if (!q.length) continue;
      if (ws && ws.readyState === 1) {
        const buf = new Uint8Array(q.length + 1);
        buf[0] = p;
        buf.set(q, 1);
        ws.send(buf);
      }
      q.length = 0;
    }
  },

  ping() {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    const s = (this.seq = (this.seq + 1) & 0x7f);
    this.pings.set(s, performance.now());
    ws.send(Uint8Array.of(C_PING, s));
  },
};
setInterval(() => net.ping(), 2000);

let rttAvg = null;
function setStatus(st) {
  const el = $('#status');
  el.className = 'status ' + st;
  if (st !== 'on') $('#rtt').textContent = st === 'pin' ? 'PIN' : 'sin red';
}

const midi = {
  mcu: (a, b, c) => net.send(P_MCU, a, b, c),
  gen: (a, b, c) => net.send(P_GEN, a, b, c),
  mcuNote(note, on) { this.mcu(0x90, note, on ? 0x7f : 0x00); },
  cc(ch, cc, v) { this.gen(0xb0 | ch, cc, v); },
  noteOn(ch, n, v) { this.gen(0x90 | ch, n, v); },
  noteOff(ch, n) { this.gen(0x80 | ch, n, 0); },
};

// ════════════════════════ Recepción ════════════════════════
function onFrame(d) {
  const port = d[0];
  if (port === 0xfd) return live.onClock(d);
  if (port === 0xfc) return live.load();
  if (port === 0xfb) return live.select((d[1] << 7) | d[2], false);
  if (port === C_PING) {
    const t0 = net.pings.get(d[1]);
    if (t0 !== undefined) {
      net.pings.delete(d[1]);
      const rtt = performance.now() - t0;
      rttAvg = rttAvg == null ? rtt : rttAvg * 0.7 + rtt * 0.3;
      $('#rtt').textContent = rttAvg.toFixed(rttAvg < 10 ? 1 : 0) + ' ms';
    }
    return;
  }
  let i = 1;
  while (i < d.length) {
    const s = d[i];
    if (s === 0xf0) {
      const e = d.indexOf(0xf7, i);
      if (e < 0) break;
      if (port === P_MCU) mcuSysex(d.subarray(i, e + 1));
      i = e + 1;
      continue;
    }
    if (s < 0x80) { i++; continue; }
    const hi = s & 0xf0;
    const len = hi === 0xc0 || hi === 0xd0 ? 2 : hi < 0xf0 ? 3 : 1;
    if (i + len > d.length) break;
    if (port === P_MCU) mcuMsg(s, d[i + 1], d[i + 2]);
    else if (port === P_GEN) genMsg(s, d[i + 1], d[i + 2]);
    i += len;
  }
}

// Render agrupado por frame de pantalla
const dirty = new Set();
let rafQueued = false;
function invalidate(fn) {
  dirty.add(fn);
  if (!rafQueued) {
    rafQueued = true;
    requestAnimationFrame(renderFrame);
  }
}
function renderFrame(t) {
  rafQueued = false;
  const fns = Array.from(dirty);
  dirty.clear();
  for (const f of fns) f(t);
}

// ════════════════════════ Componentes táctiles ════════════════════════

/** Botón: momentáneo (nota on/off) o con enclavamiento (para modificadores). */
function makeButton(label, { cls = '', onPress, onRelease, latch = false, title } = {}) {
  const el = h('button', 'btn ' + cls, label);
  if (title) el.title = title;
  let pid = null;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (pid !== null) return;
    pid = e.pointerId;
    try { el.setPointerCapture(pid); } catch (_) {}
    haptic();
    if (latch) {
      const on = !el.classList.contains('latched');
      el.classList.toggle('latched', on);
      (on ? onPress : onRelease)?.();
      return;
    }
    el.classList.add('pressed');
    onPress?.();
  });
  const up = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    if (latch) return;
    el.classList.remove('pressed');
    onRelease?.();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  return el;
}

/** Botón Mackie: envía nota y su LED lo controla Logic. */
const ledMap = new Map(); // nota -> [elementos]
function mcuButton(label, note, cls = '', opts = {}) {
  const el = makeButton(label, {
    cls,
    latch: opts.latch,
    title: opts.title,
    onPress: () => midi.mcuNote(note, true),
    onRelease: () => midi.mcuNote(note, false),
  });
  if (!ledMap.has(note)) ledMap.set(note, []);
  ledMap.get(note).push(el);
  return el;
}

/** Fader vertical con multitouch real (cada dedo controla su fader). */
class Fader {
  constructor({ onChange, onTouch, color } = {}) {
    this.el = h('div', 'fader');
    this.el.append(h('div', 'track'), h('div', 'cap'));
    this.el.firstChild.append(h('div', 'fill'));
    if (color) this.el.style.setProperty('--fc', color);
    this.v = 0;
    this.pid = null;
    this.onChange = onChange;
    this.onTouch = onTouch;
    this._render = () => this.el.style.setProperty('--v', this.v.toFixed(4));
    const el = this.el;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('lostpointercapture', (e) => this.up(e));
  }
  down(e) {
    e.preventDefault();
    if (this.pid !== null) return;
    this.pid = e.pointerId;
    try { this.el.setPointerCapture(this.pid); } catch (_) {}
    const r = this.el.getBoundingClientRect();
    const cap = this.el.querySelector('.cap').offsetHeight;
    this.top = r.top + cap / 2;
    this.travel = Math.max(20, r.height - cap);
    this.y0 = e.clientY;
    this.v0 = this.v;
    this.el.classList.add('touch');
    this.onTouch?.(true);
    haptic();
    if (settings.faderMode === 'absolute') this.set(1 - (e.clientY - this.top) / this.travel, true);
  }
  move(e) {
    if (e.pointerId !== this.pid) return;
    if (settings.faderMode === 'absolute') this.set(1 - (e.clientY - this.top) / this.travel, true);
    else this.set(this.v0 + (this.y0 - e.clientY) / this.travel, true);
  }
  up(e) {
    if (e.pointerId !== this.pid) return;
    this.pid = null;
    this.el.classList.remove('touch');
    this.onTouch?.(false);
  }
  set(v, emit) {
    v = clamp(v, 0, 1);
    if (v === this.v) return;
    this.v = v;
    this._render();
    if (emit) this.onChange?.(v);
  }
  setRemote(v) {
    if (this.pid !== null) return; // el dedo manda: no pelear con Logic
    this.v = clamp(v, 0, 1);
    invalidate(this._render);
  }
}

/** Knob por arrastre vertical. modo 'abs' (0..1) o 'rel' (ticks ±). Toque corto = onTap. */
class Knob {
  constructor(el, { mode = 'abs', onChange, onTicks, onTap, onTapUp, sens = 180, tickPx = 7 } = {}) {
    this.el = el;
    this.v = 0;
    this.pid = null;
    Object.assign(this, { mode, onChange, onTicks, onTap, onTapUp, sens, tickPx });
    this._render = () => el.style.setProperty('--v', this.v.toFixed(4));
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.pid !== null) return;
      this.pid = e.pointerId;
      try { el.setPointerCapture(this.pid); } catch (_) {}
      this.y0 = this.yl = e.clientY;
      this.x0 = e.clientX;
      this.t0 = performance.now();
      this.v0 = this.v;
      this.acc = 0;
      this.moved = false;
      el.classList.add('active');
      haptic();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pid) return;
      const dy = this.y0 - e.clientY + (e.clientX - this.x0) * 0.5;
      if (Math.abs(dy) > 4) this.moved = true;
      if (this.mode === 'abs') {
        this.set(this.v0 + dy / this.sens, true);
      } else {
        this.acc += this.yl - e.clientY;
        this.yl = e.clientY;
        const t = Math.trunc(this.acc / this.tickPx);
        if (t) {
          this.acc -= t * this.tickPx;
          this.onTicks?.(t);
        }
      }
    });
    const up = (e) => {
      if (e.pointerId !== this.pid) return;
      this.pid = null;
      el.classList.remove('active');
      if (!this.moved && performance.now() - this.t0 < 350) {
        this.onTap?.();
        this.onTapUp?.();
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }
  set(v, emit) {
    v = clamp(v, 0, 1);
    if (v === this.v) return;
    this.v = v;
    this._render();
    if (emit) this.onChange?.(v);
  }
  setRemote(v) {
    if (this.pid !== null) return;
    this.v = clamp(v, 0, 1);
    invalidate(this._render);
  }
}

/** V-Pot del Mackie: knob relativo + anillo de 11 LEDs controlado por Logic. */
class VPot {
  constructor(ch) {
    this.el = h('div', 'vpot');
    this.leds = [];
    for (let i = 0; i < 11; i++) {
      const l = h('span', 'led');
      const a = -135 + i * 27;
      l.style.transform = `rotate(${a}deg) translateY(-22px)`;
      this.leds.push(l);
      this.el.append(l);
    }
    this.center = h('span', 'center');
    this.el.append(h('div', 'knob'), this.center);
    this.ringVal = 0;
    this._render = () => this.renderRing();
    new Knob(this.el, {
      mode: 'rel',
      tickPx: 6,
      onTicks: (t) => {
        const n = Math.min(Math.abs(t), 15);
        midi.mcu(0xb0, 0x10 + ch, t > 0 ? n : 0x40 | n);
      },
      onTap: () => {
        // Pulsar el V-Pot (p.ej. centra el paneo en Logic)
        this.el.classList.add('pushed');
        midi.mcuNote(0x20 + ch, true);
        setTimeout(() => {
          midi.mcuNote(0x20 + ch, false);
          this.el.classList.remove('pushed');
        }, 60);
      },
    });
  }
  ring(v) {
    this.ringVal = v;
    invalidate(this._render);
  }
  renderRing() {
    const v = this.ringVal;
    const pos = v & 0x0f;
    const mode = (v >> 4) & 0x03;
    for (let i = 0; i < 11; i++) {
      const p = i + 1;
      let on = false;
      if (pos > 0) {
        if (mode === 0) on = p === pos;
        else if (mode === 1) on = pos >= 6 ? p >= 6 && p <= pos : p <= 6 && p >= pos;
        else if (mode === 2) on = p <= pos;
        else on = Math.abs(p - 6) <= pos - 1;
      }
      this.leds[i].classList.toggle('on', on);
    }
    this.center.classList.toggle('on', !!(v & 0x40));
  }
}

/** Medidor con caída suave (como el MCU físico). */
class Meter {
  constructor() {
    this.el = h('div', 'meter');
    this.lvl = h('div', 'lvl');
    this.el.append(this.lvl);
    this.v = 0;
    this.shown = -1;
  }
  setLevel(l) {
    if (l === 0x0e) return this.el.classList.add('clip');
    if (l === 0x0f) return this.el.classList.remove('clip');
    this.v = Math.max(this.v, clamp(l / 12, 0, 1));
    meters.kick();
  }
}
const meters = {
  list: [],
  running: false,
  last: 0,
  kick() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.tick(t));
  },
  tick(t) {
    const dt = Math.min(100, t - this.last);
    this.last = t;
    let any = false;
    for (const m of this.list) {
      if (m.v > 0) {
        m.v = Math.max(0, m.v - dt / 1400); // ~1.4 s de caída a cero
        any = true;
      }
      const q = Math.round(m.v * 200);
      if (q !== m.shown) {
        m.shown = q;
        m.lvl.style.transform = `scaleY(${q / 200})`;
      }
    }
    if (any) requestAnimationFrame((tt) => this.tick(tt));
    else this.running = false;
  },
};

// ════════════════════════ Mackie Control (Logic) ════════════════════════
const mcu = {
  faders: [],
  vpots: [],
  meters: [],
  strips: [],
  lcd: new Uint8Array(112).fill(32),
  tc: new Array(10).fill(32),
  tcDots: new Array(10).fill(false),
  assign: [32, 32],
};

function mcuMsg(s, a, b) {
  const hi = s & 0xf0, ch = s & 0x0f;
  if (hi === 0xe0) {
    mcu.faders[ch]?.setRemote(((b << 7) | a) / 16383);
  } else if (hi === 0x90 || hi === 0x80) {
    const vel = hi === 0x90 ? b : 0;
    const els = ledMap.get(a);
    if (els) {
      const st = vel === 0x7f ? 'on' : vel === 0x01 ? 'flash' : '';
      for (const el of els) el.dataset.led = st;
    }
    if (a >= 0x18 && a <= 0x1f) mcu.strips[a - 0x18]?.classList.toggle('selected', vel > 0);
  } else if (hi === 0xb0) {
    if (a >= 0x30 && a <= 0x37) mcu.vpots[a - 0x30]?.ring(b);
    else if (a >= 0x40 && a <= 0x49) {
      const i = a - 0x40;
      let c = b & 0x3f;
      if (c < 0x20) c += 0x40;
      mcu.tc[i] = c;
      mcu.tcDots[i] = !!(b & 0x40);
      invalidate(renderTc);
    } else if (a === 0x4a || a === 0x4b) {
      let c = b & 0x3f;
      if (c < 0x20) c += 0x40;
      mcu.assign[a === 0x4b ? 0 : 1] = c;
      invalidate(renderAssign);
    }
  } else if (hi === 0xd0) {
    mcu.meters[a >> 4]?.setLevel(a & 0x0f);
  }
}

function mcuSysex(m) {
  // F0 00 00 66 14 12 offset chars... F7  → pantalla LCD (2 filas × 56)
  if (m.length < 8 || m[1] !== 0 || m[2] !== 0 || m[3] !== 0x66 || m[5] !== 0x12) return;
  const off = m[6];
  for (let i = 7; i < m.length - 1; i++) {
    const p = off + i - 7;
    if (p < 112) mcu.lcd[p] = m[i];
  }
  invalidate(renderLcd);
}

function lcdText(start, len) {
  let s = '';
  for (let i = start; i < start + len; i++) s += String.fromCharCode(mcu.lcd[i] < 32 ? 32 : mcu.lcd[i]);
  return s;
}
function renderLcd() {
  for (let i = 0; i < 8; i++) {
    const st = mcu.strips[i];
    if (!st) continue;
    const name = lcdText(i * 7, 7).trim();
    const val = lcdText(56 + i * 7, 7).trim();
    if (st._name.textContent !== name) st._name.textContent = name || ' ';
    if (st._val.textContent !== val) st._val.textContent = val || ' ';
  }
}
function renderTc() {
  const el = $('#tc');
  let html = '';
  for (let i = 9; i >= 0; i--) {
    const c = String.fromCharCode(mcu.tc[i]);
    html += c === '<' || c === '&' ? ' ' : c;
    if (mcu.tcDots[i]) html += '.';
  }
  el.textContent = html;
}
function renderAssign() {
  const el = $('#assign');
  if (el) el.textContent = String.fromCharCode(...mcu.assign);
}

function buildMixer() {
  const strips = $('#strips');
  for (let ch = 0; ch < 8; ch++) {
    const st = h('div', 'strip');
    st._name = h('div', 'lcd name', `Pista ${ch + 1}`);
    st._val = h('div', 'lcd val', ' ');
    const vp = new VPot(ch);
    const btns = h('div', 'btns');
    btns.append(
      mcuButton('R', 0x00 + ch, 'c-rec', { title: 'Grabar' }),
      mcuButton('S', 0x08 + ch, 'c-solo', { title: 'Solo' }),
      mcuButton('M', 0x10 + ch, 'c-mute', { title: 'Mute' }),
      mcuButton('SEL', 0x18 + ch, 'c-sel', { title: 'Seleccionar' })
    );
    const meter = new Meter();
    const fader = new Fader({
      onChange: faderSender(ch),
      onTouch: (on) => midi.mcuNote(0x68 + ch, on),
    });
    const row = h('div', 'fader-row');
    row.append(meter.el, fader.el);
    st.append(st._name, vp.el, st._val, btns, row);
    strips.append(st);
    mcu.strips[ch] = st;
    mcu.vpots[ch] = vp;
    mcu.meters[ch] = meter;
    mcu.faders[ch] = fader;
    meters.list.push(meter);
  }

  const side = $('#mixer-side');
  const assignLcd = h('div', 'lcd assign');
  assignLcd.id = 'assign';
  assignLcd.textContent = '  ';

  const vmode = h('div', 'grid3');
  vmode.append(
    mcuButton('Pista', 0x28),
    mcuButton('Envío', 0x29),
    mcuButton('Pan', 0x2a),
    mcuButton('Plug', 0x2b),
    mcuButton('EQ', 0x2c),
    mcuButton('Instr', 0x2d)
  );
  const bank = h('div', 'grid2');
  bank.append(
    mcuButton('◀◀ 8', 0x2e, '', { title: 'Banco anterior' }),
    mcuButton('8 ▶▶', 0x2f, '', { title: 'Banco siguiente' }),
    mcuButton('◀ 1', 0x30, '', { title: 'Canal anterior' }),
    mcuButton('1 ▶', 0x31, '', { title: 'Canal siguiente' })
  );
  const extra = h('div', 'grid2');
  extra.append(mcuButton('Flip', 0x32), mcuButton('Global', 0x33));

  const master = h('div', 'master');
  const mf = new Fader({
    color: '#ff9a1a',
    onChange: faderSender(8),
    onTouch: (on) => midi.mcuNote(0x70, on),
  });
  mcu.faders[8] = mf;
  const mcol = h('div');
  mcol.style.cssText = 'display:flex;flex-direction:column;justify-content:space-between;';
  mcol.append(h('div', 'label', 'Master'), h('div', 'label', 'Out'));
  master.append(mf.el, mcol);

  side.append(assignLcd, vmode, bank, extra, master);
}

function faderSender(ch) {
  let last = -1;
  return (v) => {
    const q = Math.round(v * 16383);
    if (q === last) return;
    last = q;
    midi.mcu(0xe0 | ch, q & 0x7f, q >> 7);
  };
}

function buildTopTransport() {
  const t = $('#transport');
  t.append(
    mcuButton('⏮', 0x5b, '', { title: 'Rebobinar' }),
    mcuButton('⏭', 0x5c, '', { title: 'Avanzar' }),
    mcuButton('⏹', 0x5d, '', { title: 'Stop' }),
    mcuButton('▶', 0x5e, 'c-play', { title: 'Play' }),
    mcuButton('●', 0x5f, 'c-rec', { title: 'Grabar' }),
    mcuButton('⟳', 0x56, 'c-warn', { title: 'Ciclo' })
  );
}

// ════════════════════════ Pestaña Transporte / navegación ════════════════════════
function buildNav() {
  const grid = $('#nav-grid');

  // Rueda Jog
  const jogPanel = h('div', 'panel');
  jogPanel.append(h('h3', null, 'Rueda Jog · desplaza el cursor de reproducción'));
  const jw = h('div', 'jog-wrap');
  const jog = h('div', 'jog');
  const rot = h('div', 'rot');
  rot.append(h('div', 'mark'));
  jog.append(rot);
  jw.append(jog);
  const jogBtns = h('div', 'g');
  jogBtns.style.gridTemplateColumns = 'repeat(3,1fr)';
  jogBtns.append(
    mcuButton('Scrub', 0x65, 'c-warn'),
    mcuButton('Nudge', 0x55),
    mcuButton('Zoom', 0x64, 'c-warn')
  );
  jogPanel.append(jw, jogBtns);

  let jpid = null, lastAng = 0, accAng = 0, angle = 0, cx = 0, cy = 0;
  const angOf = (e) => (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
  jog.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (jpid !== null) return;
    jpid = e.pointerId;
    jog.setPointerCapture(jpid);
    const r = jog.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    lastAng = angOf(e);
    accAng = 0;
  });
  jog.addEventListener('pointermove', (e) => {
    if (e.pointerId !== jpid) return;
    const a = angOf(e);
    let d = a - lastAng;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    lastAng = a;
    accAng += d;
    angle += d;
    rot.style.transform = `rotate(${angle}deg)`;
    const STEP = 8;
    const t = Math.trunc(accAng / STEP);
    if (t) {
      accAng -= t * STEP;
      const n = Math.min(Math.abs(t), 15);
      midi.mcu(0xb0, 0x3c, t > 0 ? n : 0x40 | n);
    }
  });
  const jup = (e) => { if (e.pointerId === jpid) jpid = null; };
  jog.addEventListener('pointerup', jup);
  jog.addEventListener('pointercancel', jup);

  // Transporte grande + utilidades
  const tp = h('div', 'panel');
  tp.append(h('h3', null, 'Transporte'));
  const big = h('div', 'big-transport');
  big.append(
    mcuButton('⏮', 0x5b), mcuButton('⏹', 0x5d), mcuButton('⏭', 0x5c),
    mcuButton('⟳', 0x56, 'c-warn'), mcuButton('▶', 0x5e, 'c-play'), mcuButton('●', 0x5f, 'c-rec')
  );
  const util = h('div', 'g');
  util.style.gridTemplateColumns = 'repeat(3,1fr)';
  util.append(
    mcuButton('Click', 0x59, 'c-warn', { title: 'Metrónomo' }),
    mcuButton('Marcador', 0x54, 'c-warn'),
    mcuButton('Solo', 0x5a, 'c-solo'),
    mcuButton('Drop', 0x57, 'c-warn'),
    mcuButton('Replace', 0x58, 'c-warn'),
    mcuButton('SMPTE/Beats', 0x35),
    mcuButton('Deshacer', 0x51),
    mcuButton('Guardar', 0x50),
    mcuButton('Nombre/Valor', 0x34)
  );
  const arrows = h('div', 'g');
  arrows.style.gridTemplateColumns = 'repeat(3,1fr)';
  const sp = () => h('div');
  arrows.append(
    sp(), mcuButton('▲', 0x60), sp(),
    mcuButton('◀', 0x62), mcuButton('Enter', 0x53), mcuButton('▶', 0x63),
    mcuButton('Cancel', 0x52), mcuButton('▼', 0x61), sp()
  );
  tp.append(big, util, h('h3', 'nav-hint', 'Cursores · con «Marcador» o «Zoom» saltan entre marcadores / hacen zoom'), arrows);

  // Automatización, modificadores, teclas F
  const ap = h('div', 'panel');
  ap.append(h('h3', null, 'Automatización'));
  const auto = h('div', 'g');
  auto.style.gridTemplateColumns = 'repeat(3,1fr)';
  auto.append(
    mcuButton('Read/Off', 0x4a, 'c-sel'),
    mcuButton('Write', 0x4b, 'c-rec'),
    mcuButton('Trim', 0x4c, 'c-warn'),
    mcuButton('Touch', 0x4d, 'c-warn'),
    mcuButton('Latch', 0x4e, 'c-warn'),
    mcuButton('Group', 0x4f)
  );
  const mods = h('div', 'g');
  mods.style.gridTemplateColumns = 'repeat(4,1fr)';
  mods.append(
    mcuButton('Shift', 0x46, '', { latch: true }),
    mcuButton('Option', 0x47, '', { latch: true }),
    mcuButton('Ctrl', 0x48, '', { latch: true }),
    mcuButton('Cmd', 0x49, '', { latch: true })
  );
  const views = h('div', 'g');
  views.style.gridTemplateColumns = 'repeat(4,1fr)';
  const vnames = ['MIDI', 'Inputs', 'Audio', 'Instr', 'Aux', 'Buses', 'Outputs', 'User'];
  vnames.forEach((n, i) => views.append(mcuButton(n, 0x3e + i)));
  const fk = h('div', 'g');
  fk.style.gridTemplateColumns = 'repeat(4,1fr)';
  for (let i = 0; i < 8; i++) fk.append(mcuButton('F' + (i + 1), 0x36 + i));
  ap.append(auto, h('h3', null, 'Modificadores (tocar = mantener)'), mods, h('h3', null, 'Vistas del mezclador'), views, h('h3', null, 'Teclas F (asignables en Logic)'), fk);

  grid.append(jogPanel, tp, ap);
}

// ════════════════════════ Pestaña Tocar (pads con escala, acordes y batería) ════════════════════════
const NAMES = {
  en: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  es: ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'],
};
const SCALES = {
  'Mayor': [0, 2, 4, 5, 7, 9, 11],
  'Menor natural': [0, 2, 3, 5, 7, 8, 10],
  'Menor armónica': [0, 2, 3, 5, 7, 8, 11],
  'Menor melódica': [0, 2, 3, 5, 7, 9, 11],
  'Dórica': [0, 2, 3, 5, 7, 9, 10],
  'Frigia': [0, 1, 3, 5, 7, 8, 10],
  'Lidia': [0, 2, 4, 6, 7, 9, 11],
  'Mixolidia': [0, 2, 4, 5, 7, 9, 10],
  'Locria': [0, 1, 3, 5, 6, 8, 10],
  'Frigia dominante': [0, 1, 4, 5, 7, 8, 10],
  'Pentatónica mayor': [0, 2, 4, 7, 9],
  'Pentatónica menor': [0, 3, 5, 7, 10],
  'Blues': [0, 3, 5, 6, 7, 10],
  'Cromática': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const DRUMS = {
  36: 'Bombo', 37: 'Aro', 38: 'Caja', 39: 'Palmas', 40: 'Caja 2', 41: 'Tom gr.', 42: 'HH cerr.', 43: 'Tom gr.2',
  44: 'HH pedal', 45: 'Tom bajo', 46: 'HH abier.', 47: 'Tom med.', 48: 'Tom med.2', 49: 'Crash', 50: 'Tom agudo', 51: 'Ride',
  52: 'China', 53: 'Ride bell', 54: 'Pandero', 55: 'Splash', 56: 'Cencerro', 57: 'Crash 2', 58: 'Vibraslap', 59: 'Ride 2',
  60: 'Bongó ag.', 61: 'Bongó gr.', 62: 'Conga mute', 63: 'Conga ag.', 64: 'Conga gr.', 65: 'Timbal ag.', 66: 'Timbal gr.', 67: 'Agogó',
};
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

const noteName = (n, oct = true) => NAMES[settings.noteNames][n % 12] + (oct ? Math.floor(n / 12) - 2 : ''); // Logic: Do3 = 60

function chordInfo(notes) {
  const r = notes[0];
  const iv = new Set(notes.map((n) => (n - r + 120) % 12));
  const third = iv.has(4) ? 4 : iv.has(3) ? 3 : 0;
  const fifth = iv.has(7) ? 7 : iv.has(6) ? 6 : iv.has(8) ? 8 : 0;
  const sev = notes.length >= 4 ? (iv.has(11) ? 11 : iv.has(10) ? 10 : iv.has(9) && fifth === 6 ? 9 : 0) : 0;
  let q = '?';
  if (third === 4 && fifth === 7) q = sev === 11 ? 'maj7' : sev === 10 ? '7' : '';
  else if (third === 3 && fifth === 7) q = sev === 10 ? 'm7' : sev === 11 ? 'm(maj7)' : 'm';
  else if (third === 3 && fifth === 6) q = sev === 10 ? 'ø7' : sev === 9 ? '°7' : '°';
  else if (third === 4 && fifth === 8) q = sev === 11 ? '+maj7' : '+';
  else if (!third && fifth === 7) q = 'sus';
  return { q, minor: third === 3 };
}

const play = {
  pads: [],
  rows: 4,
  cols: 8,
  held: new Map(), // pointerId -> {pad, notes}
  noteCount: new Map(), // nota -> nº de dedos
  sustain: false,
  bend: null,
  mod: null,
};

function buildPlay() {
  const bar = $('#play-bar');
  const seg = h('div', 'seg');
  const layouts = [['scale', 'Escala'], ['chrom', 'Cromático'], ['chords', 'Acordes'], ['drums', 'Batería']];
  for (const [k, lbl] of layouts) {
    const b = makeButton(lbl, { onPress: () => { settings.layout = k; saveSettings(); refreshPlay(); } });
    b.dataset.k = k;
    seg.append(b);
  }
  const keySel = h('select');
  keySel.title = 'Tonalidad';
  const scaleSel = h('select');
  scaleSel.title = 'Escala';
  for (const s of Object.keys(SCALES)) scaleSel.append(new Option(s, s));
  keySel.onchange = () => { settings.key = +keySel.value; saveSettings(); refreshPlay(); };
  scaleSel.onchange = () => { settings.scale = scaleSel.value; saveSettings(); refreshPlay(); };

  const octDown = makeButton('Oct −', { onPress: () => { allNotesOff(); settings.octave = clamp(settings.octave - 1, -1, 7); saveSettings(); refreshPlay(); } });
  const octUp = makeButton('Oct +', { onPress: () => { allNotesOff(); settings.octave = clamp(settings.octave + 1, -1, 7); saveSettings(); refreshPlay(); } });
  const octLbl = h('div', 'oct');
  octLbl.id = 'oct-lbl';
  const rowsSel = h('select');
  rowsSel.title = 'Filas de pads';
  [['0', 'Filas: auto'], ['4', '4 filas'], ['6', '6 filas'], ['8', '8 filas']].forEach(([v, l]) => rowsSel.append(new Option(l, v)));
  rowsSel.value = String(settings.rows);
  rowsSel.onchange = () => { settings.rows = +rowsSel.value; saveSettings(); refreshPlay(); };

  const sus = makeButton('Sustain', {
    latch: true,
    onPress: () => { play.sustain = true; midi.cc(settings.playChannel, 64, 127); },
    onRelease: () => { play.sustain = false; midi.cc(settings.playChannel, 64, 0); },
  });
  const panic = makeButton('Pánico', { cls: 'c-rec', onPress: panicAll });

  bar.append(seg, keySel, scaleSel, octDown, octLbl, octUp, rowsSel, sus, panic);
  play.keySel = keySel;
  play.scaleSel = scaleSel;
  play.seg = seg;

  // Tiras de pitch bend (vuelve al centro) y modulación (CC1)
  const wrap = $('#bend-wrap');
  play.bend = touchStrip('Bend', 0.5, true, (v) => {
    const q = Math.round(v * 16383);
    midi.gen(0xe0 | settings.playChannel, q & 0x7f, q >> 7);
  });
  play.mod = touchStrip('Mod', 0, false, (v) => midi.cc(settings.playChannel, 1, Math.round(v * 127)));
  wrap.append(play.bend, play.mod);

  // Pads: un solo listener para toda la rejilla → permite deslizar entre pads (glissando)
  const grid = $('#pads');
  let gr = null;
  const hit = (e) => {
    const x = e.clientX - gr.left, y = e.clientY - gr.top;
    const c = Math.floor((x / gr.width) * play.cols), r = Math.floor((y / gr.height) * play.rows);
    if (c < 0 || r < 0 || c >= play.cols || r >= play.rows) return null;
    const fy = (y / gr.height) * play.rows - r;
    return { pad: play.pads[r * play.cols + c], fy };
  };
  grid.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    gr = grid.getBoundingClientRect();
    try { grid.setPointerCapture(e.pointerId); } catch (_) {}
    const hres = hit(e);
    if (hres) padOn(e.pointerId, hres.pad, hres.fy);
  });
  grid.addEventListener('pointermove', (e) => {
    const cur = play.held.get(e.pointerId);
    if (!cur || !gr) return;
    const hres = hit(e);
    if (hres && hres.pad !== cur.pad) {
      padOff(e.pointerId);
      padOn(e.pointerId, hres.pad, hres.fy);
    }
  });
  const up = (e) => padOff(e.pointerId);
  grid.addEventListener('pointerup', up);
  grid.addEventListener('pointercancel', up);
  grid.addEventListener('lostpointercapture', up);

  let rz = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { if ($('#page-play').classList.contains('on')) refreshPlay(); }, 120);
  });
  refreshPlay();
}

function touchStrip(label, init, spring, onChange) {
  const el = h('div', 'touch-strip');
  el.append(h('div', 'bar'), h('div', 'lbl', label));
  let v = init, pid = null, r = null, last = -1;
  const set = (nv) => {
    v = clamp(nv, 0, 1);
    el.style.setProperty('--v', v);
    const q = Math.round(v * 1000);
    if (q !== last) { last = q; onChange(v); }
  };
  el.style.setProperty('--v', v);
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (pid !== null) return;
    pid = e.pointerId;
    el.setPointerCapture(pid);
    r = el.getBoundingClientRect();
    set(1 - (e.clientY - r.top - 13) / (r.height - 26));
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === pid) set(1 - (e.clientY - r.top - 13) / (r.height - 26)); });
  const up = (e) => { if (e.pointerId !== pid) return; pid = null; if (spring) set(0.5); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  return el;
}

function refreshPlay() {
  allNotesOff();
  const ks = play.keySel;
  const oldKey = settings.key;
  ks.innerHTML = '';
  NAMES[settings.noteNames].forEach((n, i) => ks.append(new Option(n, i)));
  ks.value = String(oldKey);
  play.scaleSel.value = settings.scale;
  for (const b of play.seg.children) b.classList.toggle('latched', b.dataset.k === settings.layout);
  const drums = settings.layout === 'drums';
  ks.disabled = play.scaleSel.disabled = drums;
  $('#oct-lbl').textContent = drums ? 'Banco ' + (settings.octave + 2) : noteName(12 * (settings.octave + 2) + settings.key);

  const grid = $('#pads');
  const rows = settings.rows || (grid.clientHeight > 520 ? 8 : grid.clientHeight > 380 ? 6 : 4);
  // (la orientación puede cambiar: refreshPlay se llama de nuevo en 'resize')
  // En vertical (móvil) usamos 4 columnas: pads más grandes. Acordes siempre 8 (I–VII + I).
  const narrow = grid.clientWidth < 520;
  const cols = narrow && settings.layout !== 'chords' ? 4 : 8;
  grid.classList.toggle('narrow', narrow);
  play.rows = rows;
  play.cols = cols;
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  grid.innerHTML = '';
  play.pads = [];
  play.byNote = new Map();

  const scale = SCALES[settings.scale] || SCALES['Mayor'];
  const base = 12 * (settings.octave + 2) + settings.key;
  const inScale = (n) => scale.includes((((n - settings.key) % 12) + 12) % 12);
  const deg = (d) => base + Math.floor(d / scale.length) * 12 + scale[((d % scale.length) + scale.length) % scale.length];

  for (let r = 0; r < rows; r++) {
    const rb = rows - 1 - r; // fila desde abajo
    for (let c = 0; c < cols; c++) {
      const pad = h('div', 'pad');
      let notes = [];
      if (settings.layout === 'scale') {
        // Como Push: en tonalidad, cada fila sube una cuarta (3 grados)
        const off = scale.length >= 7 ? 3 : 2;
        const n = deg(rb * off + c);
        notes = [n];
        pad.classList.toggle('root', (n - settings.key) % 12 === 0);
        pad.innerHTML = `<b>${noteName(n, false)}</b><small>${noteName(n)}</small>`;
      } else if (settings.layout === 'chrom') {
        const n = base + rb * 5 + c;
        notes = [n];
        if (!inScale(n)) pad.classList.add('out');
        if ((((n - settings.key) % 12) + 12) % 12 === 0) pad.classList.add('root');
        pad.innerHTML = `<b>${noteName(n, false)}</b><small>${noteName(n)}</small>`;
      } else if (settings.layout === 'chords') {
        const d = c; // I..VII y I (8ª)
        const type = rb % 4;
        const octUp = Math.floor(rb / 4) * scale.length;
        const dd = d + octUp;
        if (type === 0) notes = [deg(dd), deg(dd + 2), deg(dd + 4)];
        else if (type === 1) notes = [deg(dd), deg(dd + 2), deg(dd + 4), deg(dd + 6)];
        else if (type === 2) notes = [deg(dd) - 12, deg(dd), deg(dd + 2), deg(dd + 4)];
        else notes = [deg(dd), deg(dd + 2), deg(dd + 4), deg(dd + 8)];
        const core = type === 2 ? notes.slice(1) : type === 3 ? notes.slice(0, 3) : notes;
        const info = chordInfo(core);
        const rn = scale.length === 7 ? ROMAN[d % 7] : String((d % scale.length) + 1);
        const roman = info.minor || info.q.startsWith('°') || info.q.startsWith('ø') ? rn.toLowerCase() : rn;
        const suffix = type === 3 ? info.q + ' add9' : info.q;
        const sub = ['', '7ª', 'con bajo', 'add9'][type];
        pad.classList.add('chord');
        if (d % 7 === 0) pad.classList.add('tonic');
        pad.innerHTML = `<b>${noteName(notes[type === 2 ? 1 : 0], false)}${suffix}</b><small>${roman}${sub ? ' · ' + sub : ''}</small>`;
      } else {
        // Batería: dos bloques 4×4 (estilo MPC). Bloque izquierdo 36–51, derecho 52–67
        const blk = Math.floor(rb / 4) * (cols / 4) + Math.floor(c / 4);
        const n = 36 + (settings.octave - 3) * 32 + blk * 16 + (rb % 4) * 4 + (c % 4);
        notes = [clamp(n, 0, 127)];
        pad.classList.add('drum');
        pad.innerHTML = `<b>${DRUMS[n] || noteName(n)}</b><small>${n}</small>`;
      }
      notes = notes.filter((n) => n >= 0 && n <= 127);
      pad._notes = notes;
      pad._on = 0;
      play.pads.push(pad);
      if (notes.length === 1) {
        if (!play.byNote.has(notes[0])) play.byNote.set(notes[0], []);
        play.byNote.get(notes[0]).push(pad);
      }
      grid.append(pad);
    }
  }
}

function padOn(pid, pad, fy) {
  if (!pad || !pad._notes.length) return;
  const vel = settings.velMode === 'position' ? clamp(Math.round(127 - fy * 97), 1, 127) : settings.velocity;
  const ch = settings.playChannel;
  for (const n of pad._notes) {
    const cnt = play.noteCount.get(n) || 0;
    if (cnt > 0) midi.noteOff(ch, n); // re-disparo limpio
    midi.noteOn(ch, n, vel);
    play.noteCount.set(n, cnt + 1);
    lightNote(n, true);
  }
  pad._on++;
  pad.classList.add('on');
  play.held.set(pid, { pad, notes: pad._notes });
  haptic();
}
function padOff(pid) {
  const cur = play.held.get(pid);
  if (!cur) return;
  play.held.delete(pid);
  const ch = settings.playChannel;
  for (const n of cur.notes) {
    const cnt = (play.noteCount.get(n) || 1) - 1;
    if (cnt <= 0) {
      play.noteCount.delete(n);
      midi.noteOff(ch, n);
      lightNote(n, false);
    } else play.noteCount.set(n, cnt);
  }
  if (--cur.pad._on <= 0) {
    cur.pad._on = 0;
    cur.pad.classList.remove('on');
  }
}
function lightNote(n, on) {
  // En los modos de nota única se iluminan todos los pads con la misma nota (como Push)
  const list = play.byNote?.get(n);
  if (list) for (const p of list) if (!p._on) p.classList.toggle('ghost', on);
}
function allNotesOff() {
  for (const pid of Array.from(play.held.keys())) padOff(pid);
}
function panicAll() {
  allNotesOff();
  for (let ch = 0; ch < 16; ch++) {
    midi.cc(ch, 64, 0);
    midi.cc(ch, 123, 0);
    midi.cc(ch, 120, 0);
  }
  play.noteCount.clear();
}

// ════════════════════════ Pestaña Controles (estilo nanoKONTROL, MIDI Learn) ════════════════════════
// Mapa por defecto (fácil de aprender en Logic con Cmd+K / "Aprender"):
//   Knobs CC 21–28 · Faders CC 41–48 · Botón A (alterna) CC 51–58 · Botón B (momentáneo) CC 61–68 · XY = CC 12 / 13
const genCtl = new Map(); // "ch:cc" -> objeto con setRemote(v)
function genMsg(s, a, b) {
  const hi = s & 0xf0, ch = s & 0x0f;
  if (hi === 0xb0) genCtl.get(ch + ':' + a)?.setRemote(b / 127);
}
function regCtl(cc, obj) {
  // Siempre por el canal actual de controles
  genCtl.set(cc, obj);
}
function ctlKey(cc) { return settings.ctlChannel + ':' + cc; }

function ccSender(cc) {
  let last = -1;
  return (v) => {
    const q = Math.round(v * 127);
    if (q === last) return;
    last = q;
    midi.cc(settings.ctlChannel, cc, q);
  };
}

// Plantillas de controles. Cada tira puede tener knob, botón A, botón B y fader (todos opcionales).
const CTL_PRESETS = {
  nano: {
    title: 'Nano (por defecto)',
    xy: [12, 13],
    strips: Array.from({ length: 8 }, (_, i) => ({
      knob: { n: 'Knob ' + (i + 1), cc: 21 + i },
      a: { n: 'A', cc: 51 + i, t: 'toggle' },
      b: { n: 'B', cc: 61 + i, t: 'mom' },
      fader: { n: 'Fader ' + (i + 1), cc: 41 + i },
    })),
  },
  two: {
    title: 'MainStage «TWO»',
    xy: [1, 11],
    strips: [
      ...[['Breath', 2], ['CC3', 3], ['Foot', 4], ['CC5', 5], ['Data', 6], ['Balance', 8], ['CC9', 9], ['CC12', 12]].map(([n, cc], i) => ({
        knob: { n: 'Tweak ' + (i + 1), cc: 14 + i },
        a: { n: ['G', 'A', 'B', '?', 'C', 'D', 'E', 'F'][i], cc: 22 + i, t: 'mom' },
        fader: { n, cc },
      })),
      { knob: { n: 'RVRB', cc: 91 }, fader: { n: 'Volumen', cc: 7 } },
      { knob: { n: 'DLY', cc: 92 } },
    ],
  },
};

function loadCtlLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem('nano.ctlLayout') || 'null');
    if (saved && Array.isArray(saved.strips)) return saved;
  } catch (_) {}
  return JSON.parse(JSON.stringify(CTL_PRESETS[MS ? 'two' : 'nano']));
}
let ctlLayout = null;
function saveCtlLayout() {
  try { localStorage.setItem('nano.ctlLayout', JSON.stringify(ctlLayout)); } catch (_) {}
}

function buildControls() {
  ctlLayout = loadCtlLayout();
  const page = $('#page-controls');

  // Barra: plantilla + modo edición
  const bar = $('#ctl-bar');
  bar.innerHTML = '';
  const presetSel = h('select');
  presetSel.title = 'Plantilla';
  presetSel.append(new Option('Plantilla…', ''));
  for (const [k, p] of Object.entries(CTL_PRESETS)) presetSel.append(new Option(p.title, k));
  presetSel.onchange = () => {
    const k = presetSel.value;
    presetSel.value = '';
    if (!k) return;
    ctlLayout = JSON.parse(JSON.stringify(CTL_PRESETS[k]));
    saveCtlLayout();
    buildControls();
  };
  const edit = h('button', 'btn', '✎ Editar');
  edit.type = 'button';
  edit.addEventListener('click', () => {
    const on = !page.classList.contains('editing');
    page.classList.toggle('editing', on);
    edit.textContent = on ? '✓ Listo' : '✎ Editar';
    edit.classList.toggle('latched', on);
    hint.textContent = on ? 'Toca un control para cambiar su nombre o su número CC' : `Canal MIDI ${settings.ctlChannel + 1} · en MainStage usa «Learn» en modo Layout`;
  });
  const hint = h('span', 'label', `Canal MIDI ${settings.ctlChannel + 1} · en MainStage usa «Learn» en modo Layout`);
  const wizBtn = h('button', 'btn wiz-open', '🔗 Conectar con MainStage');
  wizBtn.type = 'button';
  wizBtn.addEventListener('click', () => wizard.open());
  bar.append(presetSel, edit, wizBtn, hint);
  bar.classList.add('lockable');

  // Tiras
  const wrap = $('#ctl-strips');
  wrap.innerHTML = '';
  wrap.style.setProperty('--n', ctlLayout.strips.length);
  const reg = [];
  const send = (cc, v) => midi.cc(settings.ctlChannel, cc, v);
  ctlLayout.strips.forEach((sp, i) => {
    const st = h('div', 'ctl-strip');
    const tag = (el, field) => { el.dataset.ctl = i + ':' + field; return el; };
    if (sp.knob) {
      const kEl = tag(h('div', 'knob2'), 'knob');
      const knob = new Knob(kEl, { mode: 'abs', onChange: ccSender(sp.knob.cc) });
      st.append(kEl, tag(h('div', 'cc', `${sp.knob.n}\nCC${sp.knob.cc}`), 'knob'));
      reg.push([sp.knob.cc, knob]);
    } else st.append(h('div', 'knob-gap'));
    for (const f of ['a', 'b']) {
      const d = sp[f];
      if (!d) continue;
      const btn = makeButton(d.n, {
        latch: d.t === 'toggle',
        onPress: () => send(d.cc, 127),
        onRelease: () => send(d.cc, 0),
        title: 'CC' + d.cc,
      });
      tag(btn, f);
      st.append(btn);
      reg.push([d.cc, { setRemote: (v) => d.t === 'toggle' && btn.classList.toggle('latched', v > 0.5) }]);
    }
    if (sp.fader) {
      const fader = new Fader({ onChange: ccSender(sp.fader.cc), color: sp.fader.cc === 7 ? '#ff9a1a' : '#19c3ff' });
      tag(fader.el, 'fader');
      st.append(fader.el, tag(h('div', 'cc', `${sp.fader.n}\nCC${sp.fader.cc}`), 'fader'));
      reg.push([sp.fader.cc, fader]);
    } else st.append(h('div', 'fader-gap'));
    wrap.append(st);
  });

  // Pad XY
  const [xcc, ycc] = ctlLayout.xy || [12, 13];
  const xw = $('#xy-wrap');
  xw.innerHTML = '';
  const xy = h('div', 'xy');
  xy.append(h('div', 'hx'), h('div', 'hy'), h('div', 'dot'));
  const sx = ccSender(xcc), sy = ccSender(ycc);
  let pid = null, r = null;
  const setXY = (x, y, emit) => {
    xy.style.setProperty('--x', x);
    xy.style.setProperty('--y', y);
    if (emit) { sx(x); sy(y); }
  };
  setXY(0.5, 0.5, false);
  const fromEv = (e) => setXY(clamp((e.clientX - r.left) / r.width, 0, 1), clamp(1 - (e.clientY - r.top) / r.height, 0, 1), true);
  xy.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (pid !== null) return;
    pid = e.pointerId;
    xy.setPointerCapture(pid);
    r = xy.getBoundingClientRect();
    fromEv(e);
  });
  xy.addEventListener('pointermove', (e) => { if (e.pointerId === pid) fromEv(e); });
  const up = (e) => { if (e.pointerId === pid) pid = null; };
  xy.addEventListener('pointerup', up);
  xy.addEventListener('pointercancel', up);
  xw.append(h('div', 'label', `Pad XY · X = CC${xcc} · Y = CC${ycc}`), xy);

  play.ctlReg = reg;
  rebindControls();

  // En modo edición, tocar un control abre su editor en lugar de enviar MIDI
  if (!page._editHooked) {
    page._editHooked = true;
    page.addEventListener('pointerdown', (e) => {
      if (!page.classList.contains('editing')) return;
      const el = e.target.closest('[data-ctl]');
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const [si, field] = el.dataset.ctl.split(':');
      editControl(+si, field);
    }, true);
  }
}

// ════════════════════════ Asistente de conexión con MainStage ════════════════════════
// Recorre todos los controles uno a uno. En MainStage: modo Diseño → selecciona el control → Aprender.
// Aquí: «Mover» envía un pequeño movimiento de ese control para que MainStage lo aprenda.
const wizard = {
  steps: [],
  i: 0,
  el: null,

  build() {
    const steps = [];
    const objFor = (cc) => (play.ctlReg || []).find(([c]) => c === cc)?.[1];
    const add = (kind, d, sel, group) => steps.push({ kind, name: d.n, cc: d.cc, sel, group, obj: objFor(d.cc) });
    const S = ctlLayout.strips;
    S.forEach((sp, i) => sp.knob && add('knob', sp.knob, `[data-ctl="${i}:knob"]`, 'Knobs'));
    S.forEach((sp, i) => ['a', 'b'].forEach((f) => sp[f] && add('btn', sp[f], `[data-ctl="${i}:${f}"]`, 'Botones')));
    S.forEach((sp, i) => sp.fader && add('fader', sp.fader, `[data-ctl="${i}:fader"]`, 'Faders'));
    if (MS) {
      [['TAP (Tap Tempo)', 106], ['Patch − (Previous Patch)', 102], ['Patch + (Next Patch)', 103], ['Set − (Previous Set)', 104],
        ['Set + (Next Set)', 105], ['Acción 1', 107], ['Acción 2', 108], ['Acción 3', 109], ['Acción 4', 110]]
        .forEach(([n, cc]) => steps.push({ kind: 'btn', name: n, cc, sel: null, group: 'Acciones (pestaña En vivo)' }));
    }
    return steps;
  },

  open() {
    this.steps = this.build();
    this.i = 0;
    if (!this.el) {
      const el = h('div', 'wizard');
      el.innerHTML = `
        <div class="wz-head"><span class="wz-step"></span><button type="button" class="wz-close" aria-label="Cerrar">✕</button></div>
        <div class="wz-name"></div>
        <div class="wz-help"></div>
        <div class="wz-row">
          <button type="button" class="wz-prev">◀</button>
          <button type="button" class="wz-send primary">↕ Mover</button>
          <button type="button" class="wz-next">Siguiente ▶</button>
        </div>`;
      document.body.append(el);
      el.querySelector('.wz-close').addEventListener('click', () => this.close());
      el.querySelector('.wz-prev').addEventListener('click', () => this.go(this.i - 1));
      el.querySelector('.wz-next').addEventListener('click', () => this.go(this.i + 1));
      el.querySelector('.wz-send').addEventListener('click', () => this.send());
      this.el = el;
    }
    this.el.hidden = false;
    this.go(0);
  },

  close() {
    if (this.el) this.el.hidden = true;
    document.querySelectorAll('.wiz-target').forEach((e) => e.classList.remove('wiz-target'));
  },

  go(i) {
    if (i >= this.steps.length) {
      this.el.querySelector('.wz-step').textContent = '¡Listo!';
      this.el.querySelector('.wz-name').textContent = '✅ Todos los controles enviados';
      this.el.querySelector('.wz-help').innerHTML = 'En MainStage desactiva <b>Aprender</b>, vuelve a <b>Interpretación</b> y guarda el concierto (⌘S). Prueba moviendo los controles del celular.';
      document.querySelectorAll('.wiz-target').forEach((e) => e.classList.remove('wiz-target'));
      this.i = this.steps.length;
      return;
    }
    this.i = clamp(i, 0, this.steps.length - 1);
    const st = this.steps[this.i];
    document.querySelectorAll('.wiz-target').forEach((e) => e.classList.remove('wiz-target'));
    const target = st.sel && document.querySelector(st.sel);
    if (target) {
      target.classList.add('wiz-target');
      target.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    const kindName = { knob: 'knob', fader: 'fader', btn: 'botón' }[st.kind];
    this.el.querySelector('.wz-step').textContent = `Paso ${this.i + 1} de ${this.steps.length} · ${st.group}`;
    this.el.querySelector('.wz-name').textContent = `${st.name} · CC${st.cc}`;
    this.el.querySelector('.wz-help').innerHTML =
      `En MainStage (modo <b>Diseño</b>, con <b>Aprender</b> activo) haz clic en el <b>${kindName}</b> que quieras para «${st.name}». Luego toca <b>↕ Mover</b>.`;
  },

  /** Envía un movimiento corto para que MainStage lo aprenda, y deja el control donde estaba. */
  send() {
    const st = this.steps[this.i];
    if (!st) return;
    const ch = settings.ctlChannel;
    haptic();
    if (st.kind === 'btn') {
      midi.cc(ch, st.cc, 127);
      setTimeout(() => midi.cc(ch, st.cc, 0), 150);
    } else {
      const base = Math.round(((st.obj && st.obj.v) || 0) * 127);
      const lo = clamp(base - 16, 0, 127), hi = clamp(base + 16, 0, 127);
      const seq = [];
      for (let v = lo; v <= hi; v += 4) seq.push(v);
      for (let v = hi; v >= base; v -= 4) seq.push(v);
      seq.push(base);
      seq.forEach((v, k) => setTimeout(() => midi.cc(ch, st.cc, v), k * 18));
    }
    const b = this.el.querySelector('.wz-send');
    b.textContent = '✓ Enviado';
    setTimeout(() => { b.textContent = '↕ Mover'; }, 700);
  },
};

function editControl(si, field) {
  const d = ctlLayout.strips[si][field];
  if (!d) return;
  const dlg = $('#ctl-editor');
  const f = dlg.querySelector('form');
  f.elements.n.value = d.n;
  f.elements.cc.value = d.cc;
  const isBtn = field === 'a' || field === 'b';
  f.elements.t.closest('label').hidden = !isBtn;
  f.elements.t.value = d.t || 'mom';
  dlg.querySelector('h2').textContent = { knob: 'Knob', fader: 'Fader', a: 'Botón', b: 'Botón' }[field] + ' ' + (si + 1);
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const cc = parseInt(f.elements.cc.value, 10);
    d.n = f.elements.n.value.trim().slice(0, 14) || d.n;
    if (cc >= 0 && cc <= 127) d.cc = cc;
    if (isBtn) d.t = f.elements.t.value;
    saveCtlLayout();
    buildControls();
    $('#page-controls').classList.add('editing');
    const eb = $('#ctl-bar .btn');
    eb.textContent = '✓ Listo';
    eb.classList.add('latched');
  };
  dlg.showModal();
}

function rebindControls() {
  genCtl.clear();
  for (const [cc, obj] of play.ctlReg || []) regCtl(ctlKey(cc), obj);
}


// ════════════════════════ Modo MainStage: en vivo ════════════════════════
// Setlist con Program Change, tempo por reloj MIDI, tap tempo, acciones, bloqueo de escenario
// y pedal de página Bluetooth (flechas / AvPág) para cambiar de tema con el pie.
const live = {
  songs: [],
  idx: 0,
  lastClock: 0,
  taps: [],
  beatEls: [],

  pin() {
    const pin = settings.pin || new URLSearchParams(location.search).get('pin') || '';
    return pin ? '?pin=' + encodeURIComponent(pin) : '';
  },

  async load() {
    try {
      const r = await fetch('/api/setlist' + this.pin(), { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      this.songs = Array.isArray(data.songs) ? data.songs : [];
      try { localStorage.setItem('nano.setlist', JSON.stringify(this.songs)); } catch (_) {}
    } catch (_) {
      // Sin conexión: usamos la última copia guardada en este dispositivo
      try { this.songs = JSON.parse(localStorage.getItem('nano.setlist') || '[]'); } catch (_) { this.songs = []; }
    }
    this.idx = clamp(this.idx, 0, Math.max(0, this.songs.length - 1));
    if (this.songs[this.idx]?.type === 'set') {
      const j = this.songs.findIndex((x, k) => k > this.idx && x.type !== 'set');
      if (j >= 0) this.idx = j;
    }
    this.render();
  },

  async save(songs) {
    const r = await fetch('/api/setlist' + this.pin(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songs }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    this.songs = songs;
    try { localStorage.setItem('nano.setlist', JSON.stringify(songs)); } catch (_) {}
    this.render();
  },

  /** Cambia de tema. send=true envía el Program Change y avisa a los demás dispositivos. */
  select(i, send = true) {
    if (!this.songs.length) return;
    i = clamp(i, 0, this.songs.length - 1);
    // Los títulos de sección (Set 1, Set 2…) no son patches: saltamos al siguiente patch
    if (this.songs[i].type === 'set') {
      const j = this.songs.findIndex((x, k) => k > i && x.type !== 'set');
      if (j < 0) return;
      i = j;
    }
    this.idx = i;
    const song = this.songs[i];
    if (send) {
      const ch = settings.ctlChannel;
      const bank = parseInt(song.bank, 10);
      if (bank >= 0 && bank <= 127) midi.cc(ch, 0, bank);
      const pc = parseInt(song.pc, 10);
      if (!isNaN(pc)) {
        const v = clamp(pc - settings.pcBase, 0, 127);
        midi.gen(0xc0 | ch, v);
      }
      const ws = net.ws;
      if (ws && ws.readyState === 1) ws.send(Uint8Array.of(0xfb, (i >> 7) & 0x7f, i & 0x7f));
      haptic();
    }
    this.render();
  },

  step(d) {
    if (this.songs.some((x) => x.type !== 'set')) {
      let i = this.idx + d;
      while (i >= 0 && i < this.songs.length && this.songs[i].type === 'set') i += d;
      if (i < 0 || i >= this.songs.length) return;
      return this.select(i);
    }
    // Sin setlist: botones «Patch ±» de MainStage (asígnalos con Learn a Next/Previous Patch)
    const cc = d > 0 ? 103 : 102;
    midi.cc(settings.ctlChannel, cc, 127);
    setTimeout(() => midi.cc(settings.ctlChannel, cc, 0), 40);
    haptic();
  },

  render() {
    const list = $('#setlist');
    if (!list) return;
    list.innerHTML = '';
    let num = 0;
    this.songs.forEach((song, i) => {
      if (song.type === 'set') {
        list.append(h('li', 'section', song.name || 'Set'));
        return;
      }
      num++;
      song._num = num;
      const li = h('li', i === this.idx ? 'current' : '');
      const meta = [song.pc !== '' && song.pc != null ? 'PC ' + song.pc : '', song.key, song.bpm ? song.bpm + ' bpm' : '']
        .filter(Boolean)
        .join(' · ');
      li.append(h('span', 'n', String(num)), h('span', 't', song.name || 'Sin nombre'), h('small', null, meta));
      li.addEventListener('click', () => this.select(i));
      list.append(li);
    });
    const cur = this.songs[this.idx] && this.songs[this.idx].type !== 'set' ? this.songs[this.idx] : null;
    const nxt = this.songs.find((x, k) => k > this.idx && x.type !== 'set');
    const sec = [...this.songs.slice(0, this.idx + 1)].reverse().find((x) => x.type === 'set');
    $('#now-num').textContent = cur ? `${sec ? sec.name + ' · ' : ''}${cur._num} / ${num}` : '';
    $('#now-key').textContent = cur && cur.key ? 'Tono: ' + cur.key : '';
    $('#now-bpm').textContent = cur && cur.bpm ? cur.bpm + ' bpm' : '';
    $('#now-name').textContent = cur ? cur.name || 'Sin nombre' : 'Crea tu setlist con «Editar»';
    $('#now-notes').textContent = cur ? cur.notes || '' : 'Sin setlist, «Anterior / Siguiente» envían CC102 / CC103: asígnalos en MainStage a «Previous Patch / Next Patch».';
    $('#next-name').textContent = nxt ? nxt.name : cur ? '(fin del set)' : '—';
    $('#live-now-name').textContent = cur ? `${cur._num}. ${cur.name || ''}` : 'MainStage';
    list.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  },

  onClock(d) {
    const type = d[1];
    if (type === 1) {
      const bpm = ((d[2] << 7) | d[3]) / 10;
      this.lastClock = performance.now();
      if (bpm > 0) $('#bpm').textContent = bpm.toFixed(bpm < 100 ? 1 : 0);
      $('#clock-hint').textContent = 'Reloj MIDI de MainStage';
      this.flash(d[4] % 4);
    } else if (type === 3) {
      $('#clock-hint').textContent = 'Reproduciendo';
    } else if (type === 2) {
      $('#clock-hint').textContent = 'Parado';
    }
  },

  flash(beat) {
    const dots = this.beatEls;
    dots.forEach((el, i) => el.classList.toggle('on', i === beat));
    for (const el of document.querySelectorAll('.beat-dot')) {
      el.classList.toggle('down', beat === 0);
      el.classList.add('hit');
    }
    clearTimeout(this._ft);
    this._ft = setTimeout(() => {
      for (const el of document.querySelectorAll('.beat-dot')) el.classList.remove('hit');
    }, 110);
  },

  tap() {
    const now = performance.now();
    this.taps = this.taps.filter((t) => now - t < 2500);
    this.taps.push(now);
    if (this.taps.length >= 2 && now - this.lastClock > 2000) {
      const iv = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
      $('#bpm').textContent = Math.round(60000 / iv);
      $('#clock-hint').textContent = 'Tap tempo';
    }
    this.flash((this.taps.length - 1) % 4);
  },
};

function buildLive() {
  live.beatEls = Array.from(document.querySelectorAll('.tempo .beats span'));
  $('#btn-prev').addEventListener('click', () => live.step(-1));
  $('#btn-next').addEventListener('click', () => live.step(+1));

  // Acciones: CC momentáneos para asignar con «Learn» en el Layout de MainStage
  const acts = $('#live-actions');
  const tap = makeButton('TAP\nCC106', {
    cls: 'tap',
    onPress: () => { midi.cc(settings.ctlChannel, 106, 127); live.tap(); },
    onRelease: () => midi.cc(settings.ctlChannel, 106, 0),
  });
  acts.append(tap);
  const defs = [
    ['Patch −', 102], ['Patch +', 103], ['Set −', 104], ['Set +', 105],
    ['Acción 1', 107], ['Acción 2', 108], ['Acción 3', 109], ['Acción 4', 110],
  ];
  for (const [label, cc] of defs) {
    const b = makeButton(label + '\nCC' + cc, {
      cls: 'lockable',
      onPress: () => midi.cc(settings.ctlChannel, cc, 127),
      onRelease: () => midi.cc(settings.ctlChannel, cc, 0),
    });
    acts.append(b);
  }
  const panic = makeButton('PÁNICO', { cls: 'c-rec panic', onPress: panicAll });
  acts.append(panic);

  // Pedal de página Bluetooth / teclado: → ↓ AvPág Espacio = siguiente · ← ↑ RePág = anterior
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select, dialog')) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); live.step(+1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); live.step(-1); }
  });

  // Bloqueo de escenario: un toque bloquea; mantener 1 s desbloquea
  const lock = $('#btn-lock');
  let lockTimer = null;
  const setLocked = (on) => {
    document.body.classList.toggle('locked', on);
    lock.textContent = on ? '🔒' : '🔓';
    haptic();
  };
  lock.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!document.body.classList.contains('locked')) return setLocked(true);
    lock.classList.add('holding');
    lockTimer = setTimeout(() => { lock.classList.remove('holding'); setLocked(false); }, 1000);
  });
  const cancel = () => { clearTimeout(lockTimer); lock.classList.remove('holding'); };
  lock.addEventListener('pointerup', cancel);
  lock.addEventListener('pointercancel', cancel);
  lock.addEventListener('pointerleave', cancel);

  buildSetlistEditor();
  try { live.songs = JSON.parse(localStorage.getItem('nano.setlist') || '[]'); } catch (_) {}
  live.render();
}

function buildSetlistEditor() {
  const dlg = $('#setlist-editor');
  const rows = $('#se-rows');
  let draft = [];

  const field = (song, key, ph, cls, type = 'text') => {
    const el = h(type === 'area' ? 'textarea' : 'input', cls);
    if (type !== 'area') el.type = type;
    if (type === 'number') { el.inputMode = 'numeric'; el.min = 0; el.max = 300; }
    el.placeholder = ph;
    el.value = song[key] ?? '';
    el.addEventListener('input', () => { song[key] = el.value; });
    return el;
  };
  const draw = () => {
    rows.innerHTML = '';
    let num = 0;
    draft.forEach((song, i) => {
      const isSet = song.type === 'set';
      if (!isSet) num++;
      const r = h('div', 'se-row' + (isSet ? ' section' : ''));
      const tools = h('div', 'se-tools');
      const mk = (txt, fn, cls) => {
        const b = h('button', cls, txt);
        b.type = 'button';
        b.addEventListener('click', fn);
        return b;
      };
      tools.append(
        mk('▲', () => { if (i > 0) { [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; draw(); } }),
        mk('▼', () => { if (i < draft.length - 1) { [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]]; draw(); } }),
        mk('✕', () => { draft.splice(i, 1); draw(); }, 'danger')
      );
      if (isSet) {
        r.append(h('span', 'se-num', '§'), field(song, 'name', 'Nombre de la sección (Set 1…)', 'se-name'), h('span'), h('span'), h('span'), tools);
        rows.append(r);
        return;
      }
      r.append(
        h('span', 'se-num', String(num)),
        field(song, 'name', 'Nombre del tema', 'se-name'),
        field(song, 'pc', 'PC', 'se-pc', 'number'),
        field(song, 'key', 'Tono', 'se-key'),
        field(song, 'bpm', 'BPM', 'se-bpm', 'number'),
        tools,
        field(song, 'notes', 'Notas, acordes, letra o avisos para este tema…', 'se-notes', 'area')
      );
      rows.append(r);
    });
    if (!draft.length) rows.append(h('p', 'hint', 'Aún no hay temas. Pulsa «+ Añadir tema».'));
  };

  $('#btn-edit-setlist').addEventListener('click', () => {
    draft = live.songs.map((s) => Object.assign({}, s));
    $('#se-msg').textContent = '';
    draw();
    dlg.showModal();
  });
  $('#se-add').addEventListener('click', () => {
    const last = draft[draft.length - 1];
    const pc = last && last.pc !== '' && !isNaN(parseInt(last.pc, 10)) ? parseInt(last.pc, 10) + 1 : settings.pcBase;
    draft.push({ name: '', pc: String(pc), key: '', bpm: '', notes: '' });
    draw();
    rows.lastElementChild?.querySelector('.se-name')?.focus();
  });
  $('#se-autopc').addEventListener('click', () => {
    let n = settings.pcBase;
    for (const s of draft) if (s.type !== 'set') s.pc = String(n++);
    draw();
  });
  $('#se-addset').addEventListener('click', () => {
    draft.push({ type: 'set', name: 'Set ' + (draft.filter((x) => x.type === 'set').length + 1) });
    draw();
  });
  // Pegar la lista de patches tal cual (una línea por patch). «Set …», «#…» o «…:» crean secciones.
  $('#se-bulk-apply').addEventListener('click', () => {
    const txt = $('#se-bulk').value;
    const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    let n = settings.pcBase;
    draft = lines.map((l) => {
      if (/^(set|conjunto)\b/i.test(l) || l.startsWith('#') || l.endsWith(':')) {
        return { type: 'set', name: l.replace(/^#\s*/, '').replace(/:$/, '') };
      }
      const key = (l.match(/^([A-G][#b]?m?)\s*[-–]\s+/) || [])[1] || '';
      return { name: l, pc: String(n++), key, bpm: '', notes: '' };
    });
    $('#se-bulk').value = '';
    $('#se-bulk-wrap').open = false;
    draw();
  });
  $('#se-save').addEventListener('click', async () => {
    const clean = draft
      .map((s) => (s.type === 'set' ? { type: 'set', name: String(s.name || '').trim() || 'Set' } : {
        name: String(s.name || '').trim(),
        pc: String(s.pc ?? '').trim(),
        bank: String(s.bank ?? '').trim(),
        key: String(s.key || '').trim(),
        bpm: String(s.bpm || '').trim(),
        notes: String(s.notes || ''),
      }))
      .filter((s) => s.type === 'set' || s.name || s.pc);
    try {
      await live.save(clean);
      dlg.close();
    } catch (e) {
      $('#se-msg').textContent = 'No se pudo guardar en el Mac (' + e.message + '). ¿Está abierto Nano Control?';
    }
  });
}

// ════════════════════════ Ajustes, pestañas y arranque ════════════════════════
function buildSettings() {
  const dlg = $('#settings');
  const f = dlg.querySelector('form');
  for (const name of ['playChannel', 'ctlChannel']) {
    const sel = f.elements[name];
    for (let i = 0; i < 16; i++) sel.append(new Option('Canal ' + (i + 1), i));
  }
  const load = () => {
    for (const el of f.elements) {
      if (!el.name || !(el.name in settings)) continue;
      if (el.type === 'checkbox') el.checked = !!settings[el.name];
      else el.value = settings[el.name];
    }
    f.querySelector('output').textContent = settings.velocity;
  };
  f.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.name) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (['velocity', 'playChannel', 'ctlChannel', 'pcBase'].includes(el.name)) v = +v;
    if (el.name === 'playChannel') allNotesOff();
    settings[el.name] = v;
    f.querySelector('output').textContent = settings.velocity;
    saveSettings();
    if (el.name === 'noteNames') refreshPlay();
    if (el.name === 'ctlChannel') rebindControls();
    if (el.name === 'mode') {
      // Cambiar de modo reconstruye la interfaz
      const u = new URL(location.href);
      u.searchParams.delete('modo');
      location.replace(u.toString());
    }
  });
  f.addEventListener('change', (e) => {
    if (e.target.name === 'pin' && net.ws) net.ws.close();
  });
  $('#btn-settings').addEventListener('click', () => { load(); dlg.showModal(); });
  $('#btn-panic').addEventListener('click', panicAll);
  // Dentro de las apps nativas (Android / iOS): botón para volver a la pantalla de conexión
  const iosNano = window.webkit?.messageHandlers?.nano;
  if (window.NanoNative || iosNano) {
    $('#btn-fullscreen').hidden = true;
    const sw = $('#btn-switch');
    sw.hidden = false;
    sw.addEventListener('click', () => {
      panicAll();
      if (window.NanoNative?.disconnect) window.NanoNative.disconnect();
      else iosNano?.postMessage('disconnect');
    });
  }
  $('#btn-fullscreen').addEventListener('click', () => {
    const d = document.documentElement;
    (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d);
    try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch (_) {}
  });
}

function buildTabs() {
  const tabs = $('#tabs');
  const show = (p) => {
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.page === p);
    for (const s of document.querySelectorAll('.page')) s.classList.toggle('on', s.id === 'page-' + p);
    try { localStorage.setItem('nano.page', p); } catch (_) {}
    if (p === 'play') refreshPlay();
  };
  tabs.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button');
    if (b) { e.preventDefault(); show(b.dataset.page); }
  });
  const allowed = (pg) => {
    const b = tabs.querySelector(`button[data-page="${pg}"]`);
    return b && getComputedStyle(b).display !== 'none';
  };
  let p = MS ? 'live' : 'mixer';
  try { p = localStorage.getItem('nano.page') || p; } catch (_) {}
  if (!allowed(p)) p = MS ? 'live' : 'mixer';
  show(p);
}

// Mantener la pantalla encendida (si el navegador lo permite)
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch (_) {}
}
document.addEventListener('pointerdown', keepAwake, { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    keepAwake();
    if (!net.ws) net.connect();
  } else allNotesOff();
});

// Bloquear gestos del sistema que estorban al tocar (zoom, menú contextual, scroll elástico)
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

buildTopTransport();
buildMixer();
buildNav();
buildPlay();
buildControls();
buildLive();
buildSettings();
buildTabs();
renderTc();
mcu.tc.fill(45); // guiones hasta que Logic envíe la posición
renderTc();
net.connect();

window.__nano = { settings, net, mcu, play, live, wizard }; // para depurar desde la consola
