// Prueba de punta a punta: puente en modo --mock + navegador real (Playwright/Chromium).
const { spawn } = require('child_process');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.log('Playwright no disponible; omito la prueba.'); process.exit(0); }

const PORT = 7791;
const sent = [];
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'bridge', 'server.js'), '--mock', '--port', String(PORT)], { stdio: ['pipe', 'pipe', 'inherit'] });
srv.stdout.on('data', (d) => { for (const l of String(d).split('\n')) if (l.startsWith('MIDI>')) sent.push(l.slice(6)); });
const inject = (l) => srv.stdin.write(l + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ✔ ' : '  ✘ ') + msg); if (!ok) fails++; };
const has = (re) => sent.some((s) => re.test(s));

(async () => {
  await wait(700);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => document.querySelector('#status').classList.contains('on'));
  await wait(2200);
  check(/ms/.test(await page.textContent('#rtt')), 'conectado y midiendo latencia: ' + (await page.textContent('#rtt')));

  // Play del transporte → nota 0x5E en el puerto MCU
  await page.click('#transport button:nth-child(4)');
  await wait(150);
  check(has(/^1 90 5e 7f/) && has(/^1 90 5e 00/), 'Play envía nota MCU 0x5E on/off');

  // Fader 1: arrastrar → touch (0x68) + pitch bend canal 0
  const f = await page.locator('.strip').first().locator('.fader').boundingBox();
  await page.mouse.move(f.x + f.width / 2, f.y + f.height - 25);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2, { steps: 8 });
  await page.mouse.up();
  await wait(150);
  check(has(/^1 90 68 7f/) && has(/^1 e0 /) && has(/^1 90 68 00/), 'Fader 1 envía touch + pitch bend');

  // Feedback de Logic: nombre de pista, fader, LED de mute, timecode
  const name = 'Bajo   '.split('').map((c) => c.charCodeAt(0).toString(16)).join(' ');
  inject(`1 f0 00 00 66 14 12 00 ${name} f7`);
  inject('1 e0 7f 7f');
  inject('1 90 10 7f');
  inject('1 b0 40 31');
  await wait(300);
  check((await page.textContent('.strip .name')) === 'Bajo', 'LCD: nombre de pista recibido');
  const v = await page.evaluate(() => getComputedStyle(document.querySelector('.strip .fader')).getPropertyValue('--v'));
  check(Math.abs(parseFloat(v) - 1) < 0.01, 'fader movido por Logic (--v=' + v.trim() + ')');
  check((await page.getAttribute('.strip .btns button:nth-child(3)', 'data-led')) === 'on', 'LED de Mute encendido por Logic');
  check((await page.textContent('#tc')).trim().endsWith('1'), 'timecode actualizado');

  // Pads: tocar un pad en modo Acordes → 3 notas en el mismo paquete
  await page.click('#tabs button[data-page="play"]');
  await page.click('#play-bar .seg button:nth-child(3)');
  sent.length = 0;
  const pad = await page.locator('.pad').last().boundingBox(); // fila inferior: tríadas
  const firstBottom = page.locator('.pad').nth((await page.locator('.pad').count()) - 8);
  const fb = await firstBottom.boundingBox();
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await page.mouse.down();
  await wait(80);
  await page.mouse.up();
  await wait(150);
  check(has(/^0 90 3c/) && has(/^0 90 40/) && has(/^0 90 43/), 'Acorde de Do (I) = 60/64/67 note on');
  check(has(/^0 80 3c/) && has(/^0 80 43/), 'note off al soltar');
  check((await firstBottom.textContent()).startsWith('Do'), 'pad etiquetado: ' + (await firstBottom.textContent()));

  // Controles CC
  await page.click('#tabs button[data-page="controls"]');
  sent.length = 0;
  const k = await page.locator('.knob2').first().boundingBox();
  await page.mouse.move(k.x + k.width / 2, k.y + k.height / 2);
  await page.mouse.down();
  await page.mouse.move(k.x + k.width / 2, k.y - 60, { steps: 6 });
  await page.mouse.up();
  await wait(150);
  check(has(/^0 b0 15 /), 'Knob 1 envía CC21');

  for (const [w, hgt, name] of [[1180, 820, 'ipad'], [844, 390, 'iphone-horizontal'], [390, 844, 'iphone-vertical']]) {
    await page.setViewportSize({ width: w, height: hgt });
    for (const p of ['mixer', 'play', 'controls', 'nav']) {
      await page.click(`#tabs button[data-page="${p}"]`);
      await wait(120);
      await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', `${name}-${p}.png`) });
    }
  }
  check(errors.length === 0, 'sin errores JS ' + errors.join(' | '));
  await browser.close();
  srv.kill();
  console.log(fails ? `\n${fails} fallo(s)` : '\nTodo OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
