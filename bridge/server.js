#!/usr/bin/env node
/*
 * Nano Control — puente de baja latencia entre la superficie táctil (navegador)
 * y Logic Pro.
 *
 *  Navegador (iOS / Android / Mac)  ──WebSocket binario──►  este puente  ──CoreMIDI──►  Logic Pro
 *                                    ◄── feedback (faders, nombres, medidores, LEDs) ──
 *
 * Crea dos puertos MIDI virtuales:
 *   "Nano Control MCU"  → protocolo Mackie Control (mezclador, transporte, feedback)
 *   "Nano Control"      → MIDI genérico (pads/notas, CC de knobs, faders, XY)
 *
 * Protocolo del WebSocket (binario, sin JSON para no perder tiempo):
 *   [puerto, ...bytes MIDI]       puerto 0 = genérico, 1 = MCU
 *   [0xFF, ...]                   ping: el puente lo devuelve tal cual (mide latencia)
 *   [0xFE]                        el cliente pide el estado actual del MCU (resync)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(argVal('--port', process.env.NANO_PORT || 7777));
const NAME = argVal('--name', 'Nano Control');
const PIN = argVal('--pin', process.env.NANO_PIN || '');
const NO_MIDI = args.includes('--no-midi');

const PORT_GENERIC = 0;
const PORT_MCU = 1;
const CTRL_PING = 0xff;
const CTRL_SYNC = 0xfe;
const CTRL_CLOCK = 0xfd; // [0xFD, tipo(1=pulso,2=stop,3=start), bpm*10 hi, lo, nº de pulso]
const CTRL_SETLIST = 0xfc; // [0xFC] la setlist cambió: volver a pedirla
const CTRL_SONG = 0xfb; // [0xFB, idx hi, idx lo] tema actual (sincroniza varios dispositivos)

// ───────────────────────────── MIDI ─────────────────────────────
function createMock() {
  // Puertos simulados: imprimen lo enviado y aceptan feedback por stdin, p.ej.:
  //   1 e0 00 40      (Logic mueve el fader 1 al centro)
  const { EventEmitter } = require('events');
  const mk = (idx) => ({
    label: 'mock' + idx,
    out: { sendMessage: (m) => console.log(`MIDI> ${idx} ${m.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`) },
    inp: new EventEmitter(),
  });
  const p = [mk(0), mk(1)];
  require('readline')
    .createInterface({ input: process.stdin })
    .on('line', (line) => {
      const [port, ...bytes] = line.trim().split(/\s+/).map((x) => parseInt(x, 16));
      if (p[port] && bytes.length) p[port].inp.emit('message', 0, bytes);
    });
  return p;
}

function createMidi() {
  if (NO_MIDI) return null;
  if (args.includes('--mock')) return createMock();
  let midi;
  try {
    midi = require('@julusian/midi');
  } catch (e) {
    console.warn('⚠️  No se pudo cargar el módulo MIDI (' + e.message + '). Modo simulación.');
    return null;
  }
  const make = (label, wantClock) => {
    let out, inp;
    try {
      out = new midi.Output();
      inp = new midi.Input();
      out.openVirtualPort(label);
      // SysEx sí (pantalla LCD del MCU); reloj MIDI solo en el puerto genérico (tempo de MainStage)
      inp.ignoreTypes(false, !wantClock, true);
      inp.openVirtualPort(label);
    } catch (e) {
      console.warn(`⚠️  No se pudo abrir el puerto virtual "${label}": ${e.message}`);
      return null;
    }
    return { out, inp, label };
  };
  const generic = make(NAME, true);
  const mcu = make(NAME + ' MCU');
  if (!generic && !mcu) return null;
  return [generic, mcu];
}

const ports = createMidi() || [null, null];

function midiSend(port, bytes) {
  const p = ports[port];
  if (p) p.out.sendMessage(bytes);
}

// ──────────────────── Estado MCU (para sincronizar clientes nuevos) ────────────────────
// Guardamos el último valor de todo lo que Logic envía, así una tablet que se conecta
// tarde ve los faders, nombres y LEDs correctos al instante.
const mcuState = {
  faders: new Map(), // canal -> [E0+ch, lsb, msb]
  notes: new Map(), // nota -> [90, nota, vel]  (LEDs)
  ccs: new Map(), // cc -> [B0, cc, val]  (anillos V-Pot, timecode, display de asignación)
  lcd: new Array(112).fill(32),
};
const genericState = new Map(); // "status:data1" -> mensaje (feedback de CC al puerto genérico)

const MCU_SYSEX_HDR = [0xf0, 0x00, 0x00, 0x66, 0x14];
const SERIAL = [0x4e, 0x41, 0x4e, 0x4f, 0x30, 0x30, 0x31]; // "NANO001"

function isMcuSysex(m, cmd) {
  if (m.length < 7 || m[0] !== 0xf0) return false;
  for (let i = 1; i < 5; i++) if (m[i] !== MCU_SYSEX_HDR[i]) return false;
  return cmd === undefined || m[5] === cmd;
}

function trackMcu(m) {
  const st = m[0] & 0xf0;
  if (st === 0xe0) mcuState.faders.set(m[0] & 0x0f, m);
  else if (st === 0x90) mcuState.notes.set(m[1], m);
  else if (st === 0xb0) mcuState.ccs.set(m[1], m);
  else if (isMcuSysex(m, 0x12)) {
    // Escritura en la pantalla LCD: F0 00 00 66 14 12 offset chars... F7
    const off = m[6];
    for (let i = 7; i < m.length - 1 && off + i - 7 < 112; i++) mcuState.lcd[off + i - 7] = m[i];
  }
}

// Handshake Mackie Control (Logic lo usa para detectar la superficie)
function handleMcuHandshake(m) {
  if (!isMcuSysex(m)) return false;
  const cmd = m[5];
  if (cmd === 0x00) {
    // Device query → Host connection query (serial + challenge)
    midiSend(PORT_MCU, [...MCU_SYSEX_HDR, 0x01, ...SERIAL, 0x01, 0x02, 0x03, 0x04, 0xf7]);
    return true;
  }
  if (cmd === 0x02) {
    // Host connection reply → confirmación
    midiSend(PORT_MCU, [...MCU_SYSEX_HDR, 0x03, ...SERIAL, 0xf7]);
    return true;
  }
  if (cmd === 0x13) {
    // Version request
    const v = Array.from('V1.02', (c) => c.charCodeAt(0));
    midiSend(PORT_MCU, [...MCU_SYSEX_HDR, 0x14, ...v, 0xf7]);
    return true;
  }
  if (cmd === 0x1a) {
    // Serial number request
    midiSend(PORT_MCU, [...MCU_SYSEX_HDR, 0x1b, ...SERIAL, 0xf7]);
    return true;
  }
  return false;
}

// ───────────────────────────── HTTP (sirve la app) ─────────────────────────────
const WEB_DIR = path.join(__dirname, '..', 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};
const fileCache = new Map();

// ───────────────────── Setlist (MainStage): se guarda en el Mac y la comparten todos los dispositivos ─────────────────────
const DATA_DIR = path.join(os.homedir(), '.nano-control');
const SETLIST_FILE = path.join(DATA_DIR, 'setlist.json');
let currentSong = 0;

function handleApi(req, res, url) {
  if (PIN && url.searchParams.get('pin') !== PIN) {
    res.writeHead(401).end();
    return;
  }
  if (req.method === 'GET') {
    fs.readFile(SETLIST_FILE, (err, buf) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(err ? '{"songs":[]}' : buf);
    });
    return;
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      let data;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!data || !Array.isArray(data.songs)) throw new Error('formato');
      } catch (_) {
        res.writeHead(400).end('JSON inválido');
        return;
      }
      fs.mkdir(DATA_DIR, { recursive: true }, () => {
        const tmp = SETLIST_FILE + '.tmp';
        fs.writeFile(tmp, JSON.stringify(data, null, 2), (e) => {
          if (e) return res.writeHead(500).end(String(e.message));
          fs.rename(tmp, SETLIST_FILE, () => {
            res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
            broadcast(Buffer.from([CTRL_SETLIST]));
            console.log(`🎼 Setlist guardada (${data.songs.length} temas) en ${SETLIST_FILE}`);
          });
        });
      });
    });
    return;
  }
  res.writeHead(405).end();
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url || '/', 'http://x');
  if (reqUrl.pathname === '/api/setlist') return handleApi(req, res, reqUrl);
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(WEB_DIR, urlPath));
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404');
      return;
    }
    const cached = fileCache.get(filePath);
    const send = (buf) =>
      res
        .writeHead(200, {
          'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        })
        .end(buf);
    if (cached && cached.mtime === st.mtimeMs) return send(cached.buf);
    fs.readFile(filePath, (e, buf) => {
      if (e) return res.writeHead(500).end();
      fileCache.set(filePath, { mtime: st.mtimeMs, buf });
      send(buf);
    });
  });
});

// ───────────────────────────── WebSocket ─────────────────────────────
const wss = new WebSocketServer({ server, perMessageDeflate: false, maxPayload: 4096 });

function broadcast(buf) {
  for (const c of wss.clients) if (c.readyState === 1 && c.authed) c.send(buf);
}

function frame(port, m) {
  const b = Buffer.allocUnsafe(m.length + 1);
  b[0] = port;
  for (let i = 0; i < m.length; i++) b[i + 1] = m[i];
  return b;
}

function sendSync(ws) {
  const msgs = [];
  const lcd = mcuState.lcd;
  msgs.push(frame(PORT_MCU, [...MCU_SYSEX_HDR, 0x12, 0x00, ...lcd, 0xf7]));
  for (const m of mcuState.faders.values()) msgs.push(frame(PORT_MCU, m));
  for (const m of mcuState.notes.values()) msgs.push(frame(PORT_MCU, m));
  for (const m of mcuState.ccs.values()) msgs.push(frame(PORT_MCU, m));
  for (const m of genericState.values()) msgs.push(frame(PORT_GENERIC, m));
  msgs.push(Buffer.from([CTRL_SONG, (currentSong >> 7) & 0x7f, currentSong & 0x7f]));
  for (const b of msgs) ws.send(b);
}

wss.on('connection', (ws, req) => {
  ws._socket.setNoDelay(true); // sin algoritmo de Nagle: cada mensaje sale ya
  const url = new URL(req.url || '/', 'http://x');
  ws.authed = !PIN || url.searchParams.get('pin') === PIN;
  if (!ws.authed) {
    ws.close(4001, 'PIN incorrecto');
    return;
  }
  const who = req.socket.remoteAddress;
  console.log(`📱 Conectado: ${who}  (${wss.clients.size} cliente/s)`);

  ws.on('message', (data, isBinary) => {
    if (isBinary && data.length === 3 && data[0] === CTRL_SONG) {
      // Un dispositivo cambió de tema: los demás lo siguen
      currentSong = (data[1] << 7) | data[2];
      for (const c of wss.clients) if (c !== ws && c.readyState === 1 && c.authed) c.send(data);
      return;
    }
    if (!isBinary || data.length < 2) {
      if (isBinary && data.length === 1 && data[0] === CTRL_SYNC) sendSync(ws);
      return;
    }
    const port = data[0];
    if (port === CTRL_PING) {
      ws.send(data);
      return;
    }
    if (port !== PORT_GENERIC && port !== PORT_MCU) return;
    // Un frame puede traer varios mensajes MIDI cortos seguidos (acordes): los separamos
    let i = 1;
    while (i < data.length) {
      const s = data[i];
      if (s === 0xf0) {
        const end = data.indexOf(0xf7, i);
        if (end < 0) break;
        midiSend(port, Array.from(data.subarray(i, end + 1)));
        i = end + 1;
        continue;
      }
      const hi = s & 0xf0;
      const len = hi === 0xc0 || hi === 0xd0 ? 2 : hi >= 0x80 && hi < 0xf0 ? 3 : 1;
      if (len === 1 || i + len > data.length) break;
      midiSend(port, [data[i], data[i + 1], data[i + 2]].slice(0, len));
      i += len;
    }
    // Reflejar a otros clientes (p.ej. iPad + iPhone a la vez) para que se muevan juntos
    // En MCU solo reflejamos faders (pitch bend): los LEDs los decide Logic.
    const relay = port === PORT_GENERIC || (data[1] & 0xf0) === 0xe0;
    if (relay && wss.clients.size > 1) {
      for (const c of wss.clients) if (c !== ws && c.readyState === 1 && c.authed) c.send(data);
    }
  });
  ws.on('close', () => console.log(`👋 Desconectado: ${who}`));
  ws.on('error', () => {});
});

// Feedback desde Logic → clientes
if (ports[PORT_MCU]) {
  ports[PORT_MCU].inp.on('message', (_dt, m) => {
    if (handleMcuHandshake(m)) return;
    trackMcu(m);
    broadcast(frame(PORT_MCU, m));
  });
}
if (ports[PORT_GENERIC]) {
  ports[PORT_GENERIC].inp.on('message', (_dt, m) => {
    if (m[0] >= 0xf8) return onClock(m[0]); // reloj MIDI: lo resumimos en un mensaje por pulso
    const st = m[0] & 0xf0;
    if (st === 0xb0 || st === 0xe0) genericState.set(m[0] + ':' + (st === 0xb0 ? m[1] : 0), m);
    broadcast(frame(PORT_GENERIC, m));
  });
}

// Reloj MIDI (24 ticks por negra) → un mensaje por pulso con el BPM, en vez de 48 mensajes/s
const clock = { ticks: 0, beat: 0, last: 0n, avg: 0 };
function onClock(b) {
  if (b === 0xfa) {
    clock.ticks = 0;
    clock.beat = 0;
    broadcast(Buffer.from([CTRL_CLOCK, 3, 0, 0, 0]));
    return;
  }
  if (b === 0xfc) {
    broadcast(Buffer.from([CTRL_CLOCK, 2, 0, 0, 0]));
    return;
  }
  if (b !== 0xf8) return;
  const now = process.hrtime.bigint();
  if (clock.last) {
    const dt = Number(now - clock.last) / 1e6;
    if (dt > 0 && dt < 250) clock.avg = clock.avg ? clock.avg * 0.92 + dt * 0.08 : dt;
    else clock.avg = 0;
  }
  clock.last = now;
  if (clock.ticks % 24 === 0) {
    const b10 = clock.avg ? Math.min(16383, Math.round(600000 / (clock.avg * 24))) : 0;
    broadcast(Buffer.from([CTRL_CLOCK, 1, (b10 >> 7) & 0x7f, b10 & 0x7f, clock.beat & 0x7f]));
    clock.beat++;
  }
  clock.ticks++;
}

// ───────────────────────────── Arranque ─────────────────────────────
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  const pinQ = PIN ? `?pin=${encodeURIComponent(PIN)}` : '';
  const main = addrs[0] ? `http://${addrs[0].address}:${PORT}/${pinQ}` : `http://localhost:${PORT}/${pinQ}`;
  console.log('\n🎛️  NANO CONTROL — puente listo\n');
  console.log(
    ports[PORT_MCU]
      ? `   MIDI: puertos virtuales "${NAME} MCU" (Mackie Control) y "${NAME}" (MIDI genérico)`
      : '   MIDI: MODO SIMULACIÓN (sin puertos MIDI)'
  );
  console.log(`   En este Mac:        http://localhost:${PORT}/${pinQ}`);
  for (const a of addrs) console.log(`   En tu móvil/tablet: http://${a.address}:${PORT}/${pinQ}   (${a.name})`);
  if (addrs[0]) console.log(`   Modo MainStage:     http://${addrs[0].address}:${PORT}/?modo=mainstage${PIN ? '&pin=' + encodeURIComponent(PIN) : ''}`);
  console.log('\n   Escanea con la cámara del móvil (misma red Wi‑Fi):\n');
  try {
    require('qrcode-terminal').generate(main, { small: true });
  } catch (_) {}
  console.log('   Ctrl+C para salir.\n');
  advertise(addrs);
});

// Anuncio Bonjour/mDNS: las apps de Android, iPhone e iPad encuentran este Mac solas.
let bonjour = null;
function advertise(addrs) {
  if (args.includes('--no-bonjour')) return;
  try {
    const { Bonjour } = require('bonjour-service');
    bonjour = new Bonjour();
    bonjour.publish({
      name: `${NAME} (${os.hostname().replace(/\.local$/, '')})`,
      type: 'nanocontrol',
      port: PORT,
      txt: { ip: addrs.map((a) => a.address).join(','), port: String(PORT), pin: PIN ? '1' : '0' },
    });
  } catch (e) {
    console.warn('⚠️  Bonjour no disponible (' + e.message + '); en la app escribe la IP a mano.');
  }
}

function shutdown() {
  try { bonjour && bonjour.unpublishAll(() => bonjour.destroy()); } catch (_) {}
  for (const p of ports) {
    if (!p) continue;
    try {
      p.inp.closePort();
      p.out.closePort();
    } catch (_) {}
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
