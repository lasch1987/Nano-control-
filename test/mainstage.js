// Prueba del modo MainStage: setlist + Program Change, pedal, reloj MIDI, sincronía entre dispositivos y bloqueo.
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.log('Playwright no disponible; omito la prueba.'); process.exit(0); }

const PORT = 7793;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nano-home-'));
const sent = [];
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'bridge', 'server.js'), '--mock', '--no-bonjour', '--port', String(PORT)], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, HOME: home },
});
srv.stdout.on('data', (d) => { for (const l of String(d).split('\n')) if (l.startsWith('MIDI>')) sent.push(l.slice(6)); });
const inject = (l) => srv.stdin.write(l + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ✔ ' : '  ✘ ') + msg); if (!ok) fails++; };
const has = (re) => sent.some((s) => re.test(s));

(async () => {
  await wait(700);
  const browser = await chromium.launch();
  const ctxA = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const ctxB = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
  for (const p of [a, b]) {
    await p.goto(`http://localhost:${PORT}/?modo=mainstage`);
    await p.waitForFunction(() => document.querySelector('#status').classList.contains('on'));
  }
  check(await a.isVisible('#page-live'), 'abre en la pestaña «En vivo»');
  check(!(await a.isVisible('#tabs button[data-page="mixer"]')), 'pestañas de Logic ocultas');

  // Crear setlist con el editor
  await a.click('#btn-edit-setlist');
  for (const [name, key, bpm, notes] of [['Intro', 'Do', '90', 'Pad + piano'], ['Tema 2', 'Sol', '120', 'Coro x2\nSolo de sintetizador'], ['Final', 'Re', '128', '']]) {
    await a.click('#se-add');
    const row = a.locator('.se-row').last();
    await row.locator('.se-name').fill(name);
    await row.locator('.se-key').fill(key);
    await row.locator('.se-bpm').fill(bpm);
    if (notes) await row.locator('.se-notes').fill(notes);
  }
  await a.click('#se-save');
  await wait(400);
  check(fs.existsSync(path.join(home, '.nano-control', 'setlist.json')), 'setlist guardada en el Mac');
  check((await a.locator('#setlist li').count()) === 3, 'setlist con 3 temas en el iPad');
  check((await b.locator('#setlist li').count()) === 3, 'el iPhone recibió la setlist automáticamente');

  sent.length = 0;
  await a.click('#setlist li:nth-child(2)');
  await wait(250);
  check(has(/^0 c0 01$/), 'tocar «Tema 2» envía Program Change 1');
  check((await a.textContent('#now-name')) === 'Tema 2', 'tema actual en grande');
  check((await a.textContent('#now-notes')).includes('Coro x2'), 'notas del tema visibles');
  check((await b.textContent('#live-now-name')).includes('Tema 2'), 'el otro dispositivo sigue el cambio de tema');

  sent.length = 0;
  await a.keyboard.press('ArrowRight');
  await wait(200);
  check(has(/^0 c0 02$/), 'pedal (flecha →) pasa al siguiente: PC 2');

  // Reloj MIDI a 120 BPM (20.83 ms por tick)
  inject('0 fa');
  for (let i = 0; i < 72; i++) { inject('0 f8'); await wait(20.83); }
  await wait(200);
  const bpm = parseFloat(await a.textContent('#bpm'));
  check(Math.abs(bpm - 120) < 6, 'tempo del reloj MIDI ≈ 120 BPM (leído: ' + bpm + ')');

  // Tap tempo envía CC106
  sent.length = 0;
  await a.click('.live-actions .tap');
  await wait(150);
  check(has(/^0 b0 6a 7f/), 'TAP envía CC106');

  await a.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'ms-ipad-live.png') });
  await b.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'ms-iphone-live.png') });

  // Bloqueo de escenario
  await a.click('#btn-lock');
  sent.length = 0;
  await a.click('#btn-next', { force: true });
  await a.click('#setlist li:nth-child(1)', { force: true });
  await wait(200);
  check(!has(/^0 c0/), 'bloqueado: no cambia de tema por un toque accidental');
  check(await a.evaluate(() => document.body.classList.contains('locked')), 'modo bloqueo activo');

  // Desbloquear (mantener 1 s) y pegar la lista con secciones
  const lb = await a.locator('#btn-lock').boundingBox();
  await a.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await a.mouse.down();
  await wait(1200);
  await a.mouse.up();
  check(!(await a.evaluate(() => document.body.classList.contains('locked'))), 'mantener 1 s desbloquea');
  await a.click('#btn-edit-setlist');
  await a.click('#se-bulk-wrap summary');
  await a.fill('#se-bulk', 'Set 1\nB - SAVES bASS\nAb - FOR EVERYONE\nSolar Noise\nSet 2\nC - Closer');
  await a.click('#se-bulk-apply');
  await a.click('#se-save');
  await wait(400);
  check((await a.locator('#setlist li.section').count()) === 2, 'secciones Set 1 / Set 2 en la setlist');
  check((await a.locator('#setlist li:not(.section)').count()) === 4, '4 patches importados pegando la lista');
  sent.length = 0;
  await a.click('#setlist li:has-text("C - Closer")');
  await wait(200);
  check(has(/^0 c0 03$/), 'PC numerados saltando las secciones (C - Closer = PC 3)');
  check((await a.textContent('#now-key')).includes('C'), 'tono leído del nombre');
  await a.keyboard.press('ArrowLeft');
  await wait(150);
  check((await a.textContent('#now-name')) === 'Solar Noise', 'anterior salta la sección');

  // Controles con la plantilla «TWO»
  await a.click('#tabs button[data-page="controls"]');
  check((await a.locator('.ctl-strip').count()) === 10, 'plantilla TWO: 10 tiras');
  sent.length = 0;
  const fb = await a.locator('.ctl-strip').first().locator('.fader').boundingBox();
  await a.mouse.move(fb.x + fb.width / 2, fb.y + fb.height - 20);
  await a.mouse.down();
  await a.mouse.move(fb.x + fb.width / 2, fb.y + 20, { steps: 6 });
  await a.mouse.up();
  await wait(150);
  check(has(/^0 b0 02 /), 'fader 1 envía CC2 (Breath), como en tu concierto');
  // Editar un control
  await a.click('#ctl-bar .btn');
  await a.locator('.ctl-strip').first().locator('.knob2').click();
  await a.fill('#ctl-editor input[name=n]', 'Filtro');
  await a.fill('#ctl-editor input[name=cc]', '74');
  await a.click('#ctl-editor button[value=ok]');
  await wait(150);
  check((await a.locator('.ctl-strip').first().locator('.cc').first().textContent()).includes('CC74'), 'control editado: Filtro CC74');
  await a.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'ms-ipad-controls.png') });
  await b.click('#tabs button[data-page="controls"]');
  await b.setViewportSize({ width: 390, height: 844 });
  await wait(200);
  await b.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'ms-phone-controls.png') });
  await b.click('#tabs button[data-page="live"]');
  await wait(200);
  await b.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'ms-phone-live.png') });

  await a.click('#btn-settings', { force: true });
  check(errors.length === 0, 'sin errores JS ' + errors.join(' | '));
  await browser.close();
  srv.kill();
  fs.rmSync(home, { recursive: true, force: true });
  console.log(fails ? `\n${fails} fallo(s)` : '\nTodo OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
