#!/usr/bin/env node
/*
 * Phase B checks 5 and 6: solo play must touch no network, ever.
 *
 *   node tools/test-offline.js
 *
 * This is the test that protects the tablet. The APK now carries the INTERNET
 * permission because multiplayer needs it, which removes the hard guarantee that
 * used to come from simply not having it - so the guarantee has to come from
 * here instead.
 *
 * Written before the multiplayer client, on purpose. It passes against a build
 * with no networking in it at all, which means it is a net underneath the client
 * work rather than a description of it afterwards.
 *
 * Both constructors are replaced before any page script runs. Stubbing rather
 * than merely observing is the point: if the game ever tries to open a socket
 * while solo, the stub records it and the test fails, and check 6 additionally
 * proves the game still works with nothing real behind them.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html': 'text/html', '.png': 'image/png',
               '.webmanifest': 'application/manifest+json'};

function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_PATH, 'playwright',
                   '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(c); } catch (_) {}
  }
  console.error('Could not load Playwright. Install it, or set PLAYWRIGHT_PATH.');
  process.exit(2);
}

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = (req.url.split('?')[0] || '/').replace(/^\/+/, '') || 'index.html';
      const f = path.join(ROOT, rel);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(404); return res.end('nf');
      }
      res.writeHead(200, {'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream'});
      res.end(fs.readFileSync(f));
    });
    srv.listen(0, '127.0.0.1', () => resolve({srv, port: srv.address().port}));
  });
}

let passed = 0, failed = 0;
const notes = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}`); if (detail) console.log(`        ${detail}`); }
}
function note(l) { notes.push(l); console.log(`        ${l}`); }

/* Replaces every way a page can reach the network, recording each attempt.
   Installed via addInitScript so it is in place before the game's own script. */
const STUBS = `
  window.__net = {ws: [], fetch: [], xhr: [], sse: [], beacon: []};
  const RealWS = window.WebSocket;
  window.WebSocket = function (url, protos) {
    window.__net.ws.push(String(url));
    // Return something socket-shaped that never connects, so a caller that does
    // not check gets no exception and the test still records the attempt.
    return {
      url: String(url), readyState: 3, protocol: '',
      send() {}, close() {},
      addEventListener() {}, removeEventListener() {},
      onopen: null, onclose: null, onmessage: null, onerror: null,
    };
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CLOSED = 3;
  window.WebSocket.CONNECTING = 0; window.WebSocket.CLOSING = 2;
  window.__RealWS = RealWS;

  window.fetch = function (input) {
    const u = (input && input.url) ? input.url : String(input);
    window.__net.fetch.push(u);
    return Promise.reject(new Error('network stubbed'));
  };

  const RealXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const x = new RealXHR();
    const open = x.open;
    x.open = function (m, u) { window.__net.xhr.push(String(u)); return open.apply(x, arguments); };
    return x;
  };

  if (window.EventSource) {
    window.EventSource = function (url) { window.__net.sse.push(String(url)); return {close(){},addEventListener(){}}; };
  }
  if (navigator.sendBeacon) {
    navigator.sendBeacon = function (url) { window.__net.beacon.push(String(url)); return false; };
  }
`;

(async () => {
  const {chromium} = loadPlaywright();
  const {srv, port} = await serve();
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext({
    viewport: {width: 1024, height: 700}, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();

  // Second, independent line of evidence: watch at the network layer too, so the
  // test does not rely solely on its own stubs being complete.
  const offOrigin = [];
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('request', r => {
    if (!r.url().startsWith(origin)) offOrigin.push(r.method() + ' ' + r.url());
  });
  page.on('websocket', ws => offOrigin.push('WS ' + ws.url()));

  await page.addInitScript(STUBS);
  await page.goto(origin + '/index.html', {waitUntil: 'load'});
  await page.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready(),
                             {timeout: 60000});

  console.log('Henrycraft offline-safety checks\n');
  console.log('6. solo play works with the network stubbed out entirely');

  // Exercise the things a child actually does, all while solo.
  const played = await page.evaluate(async () => {
    const H = window.__henrycraft;
    const before = H.districts().list.length;
    // dig, build, save
    H.setBlock(20, 12, 20, H.ids.BRICK);
    H.setBlock(21, 12, 20, H.ids.FIRE);
    await H.saveNow();
    // a second district, then switch back and forth
    const made = await H.createDistrict('Net Test', 'desert');
    const home = H.districts().list.find(d => d.slug !== made).slug;
    await H.switchDistrict(home);
    await H.switchDistrict(made);
    await H.deleteDistrict(made);
    // and a full theme regeneration
    H.loadThemeSeed('island', 4242);
    return {
      districtsBefore: before,
      districtsAfter: H.districts().list.length,
      stars: H.starState().length,
      animals: H.animals(),
      fish: H.fish().length,
      blockBack: H.getBlock(20, 12, 20),
      brick: H.ids.BRICK,
    };
  });
  await page.click('#playBtn');
  await page.waitForTimeout(600);
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(5200);        // let the 4s autosave fire

  const saved = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('henrycraft-'));
    return {keys: keys.length, hasIndex: keys.includes('henrycraft-districts')};
  });

  check('the world generates, saves and reloads with no network available',
        played.stars === 10 && played.animals > 0 && saved.hasIndex,
        JSON.stringify({played, saved}));
  check('districts can be created, switched and deleted offline',
        played.districtsAfter === played.districtsBefore,
        `${played.districtsBefore} -> ${played.districtsAfter}`);
  check('no page errors while the network is stubbed', errs.length === 0, errs.join(' | '));
  note(`played offline: ${played.stars} stars, ${played.animals} animals, ` +
       `${played.fish} fish, ${saved.keys} storage keys written`);

  console.log('\n5. with multiplayer off, nothing is constructed and nothing is fetched');
  const net = await page.evaluate(() => window.__net);

  check('WebSocket was never constructed',
        net.ws.length === 0, 'attempted: ' + JSON.stringify(net.ws));
  check('fetch was never called',
        net.fetch.length === 0, 'attempted: ' + JSON.stringify(net.fetch));
  check('XMLHttpRequest was never opened',
        net.xhr.length === 0, 'attempted: ' + JSON.stringify(net.xhr));
  check('EventSource was never constructed',
        net.sse.length === 0, 'attempted: ' + JSON.stringify(net.sse));
  check('sendBeacon was never called',
        net.beacon.length === 0, 'attempted: ' + JSON.stringify(net.beacon));
  // The page legitimately loads its own icons and manifest as same-origin
  // subresources; what must never happen is a request leaving the origin.
  check('no request left the page origin',
        offOrigin.length === 0, JSON.stringify(offOrigin.slice(0, 6)));
  note('checked WebSocket, fetch, XMLHttpRequest, EventSource and sendBeacon, ' +
       'plus every request at the browser layer');

  await ctx.close();
  await browser.close();
  srv.close();

  console.log(`\npassed ${passed}, failed ${failed}`);
  console.log('\nReported numbers');
  notes.forEach(n => console.log('  - ' + n));
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
