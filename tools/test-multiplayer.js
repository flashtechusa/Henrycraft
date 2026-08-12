#!/usr/bin/env node
/*
 * Phase B tests - multiplayer.
 *
 *   node tools/test-multiplayer.js
 *
 * Runs the real Worker from server/ under `wrangler dev`, on a throwaway state
 * directory, and drives real browser pages against it. Nothing here is mocked:
 * the Durable Object doing the syncing is the one that gets deployed.
 *
 * Where a test is about the server (the ninth player, edits accumulating) the
 * other players are cheap Node sockets. Where it is about the client (what gets
 * drawn, what gets displayed, what happens when the wifi drops) it is a real
 * page in a real browser.
 *
 * Checks 5 and 6 of the brief - that solo play constructs no WebSocket and
 * issues no fetch - live in tools/test-offline.js, which stubs all five network
 * APIs. They are not duplicated here; they are the reason the INTERNET
 * permission could be added at all.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const {spawn} = require('child_process');

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

let passed = 0, failed = 0;
const notes = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}`); if (detail) console.log(`        ${detail}`); }
}
function note(l) { notes.push(l); console.log(`        ${l}`); }
/* A short code has no words in it, so the district it makes needs a name of its
   own rather than the code. */
const H_words = w => typeof w === 'string' && w.length > 3 && !/[0-9]/.test(w);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function serveGame() {
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

/* The worker, on a scratch state directory so yesterday's districts cannot make
   today's run pass. */
async function startWorker(port) {
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'henry-wrangler-'));
  const child = spawn('npx',
    ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port),
     '--persist-to', persist],
    {cwd: path.join(ROOT, 'server'),
     env: {...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1'},
     stdio: ['ignore', 'pipe', 'pipe']});
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('wrangler exited:\n' + log);
    try {
      const ok = await new Promise(res => {
        const r = http.get({host: '127.0.0.1', port, path: '/health', timeout: 1500}, s => {
          /* startsWith, not equals: /health now also says what the Worker can do,
             so that an out-of-date deployment can be spotted with curl. */
          let b = '';
          s.on('data', c => b += c);
          s.on('end', () => res(b.trim().startsWith('ok') ? b.trim() : false));
        });
        r.on('error', () => res(false));
        r.on('timeout', () => { r.destroy(); res(false); });
      });
      if (ok) return {child, persist, health: ok, log: () => log};
    } catch (_) {}
    await sleep(700);
  }
  throw new Error('worker never became healthy:\n' + log);
}

/* A player that is not a browser: used where the test is about the server. */
function rawClient(port, code, name, colour, offer, look) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/district/${code}`);
    const got = [];
    const timer = setTimeout(() => reject(new Error('raw client never opened')), 15000);
    ws.onmessage = e => { try { got.push(JSON.parse(e.data)); } catch (_) {} };
    ws.onerror = () => {};
    ws.onopen = () => {
      clearTimeout(timer);
      const join = {type: 'join', playerName: name, colour};
      if (offer) join.offer = offer;
      /* In the first join or not at all: the server ignores a second one, which is
         correct and is how this test first fooled itself. */
      if (look !== undefined) join.look = look;
      ws.send(JSON.stringify(join));
      resolve({
        ws, got,
        send: o => ws.send(JSON.stringify(o)),
        seen: t => got.filter(m => m.type === t),
        welcome: () => got.find(m => m.type === 'welcome') || null,
        close: () => { try { ws.close(); } catch (_) {} },
      });
    };
  });
}

/* Wait for raw clients to be welcomed rather than sleeping a fixed amount and
   hoping. Counting straight after a 120ms sleep is how "eight players fill a
   district" came back as 7 admitted on a loaded CI runner: the eighth welcome was
   in flight, not refused. */
async function welcomedAll(clients, ms) {
  const until = Date.now() + (ms || 15000);
  for (;;) {
    const n = clients.filter(c => c.welcome()).length;
    if (n === clients.length || Date.now() > until) return n;
    await sleep(100);
  }
}
async function welcomed(client, ms) {
  return (await welcomedAll([client], ms)) === 1 ? client.welcome() : null;
}

/* Short codes, as the game now makes them. The long slug-plus-ten form is still
   accepted by the server, and `codeLong` covers that. */
function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function codeLong(prefix) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += A[Math.floor(Math.random() * A.length)];
  return `${prefix}-${s}`;
}

/* Fail with the reason rather than with a stack trace from inside wrangler, which
   is how this first showed up in CI: the workflow pinned Node 20, wrangler needs
   22, and the raw clients below use the global WebSocket that Node 20 only has
   behind a flag. */
function requireNode22() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) return;
  console.error(`This suite needs Node 22 or newer; this is v${process.versions.node}.`);
  console.error('wrangler will not start below 22, and the raw test clients need');
  console.error('a global WebSocket. The other suites are fine on older Node.');
  process.exit(2);
}

(async () => {
  requireNode22();
  const {chromium} = loadPlaywright();
  const wPort = 8800 + Math.floor(Math.random() * 300);
  console.log('Henrycraft multiplayer tests\n');
  console.log(`starting the real worker on 127.0.0.1:${wPort} ...`);
  const worker = await startWorker(wPort);
  const {srv, port} = await serveGame();
  const url = `http://127.0.0.1:${port}/index.html?sync=127.0.0.1:${wPort}`;
  console.log(`worker says: ${worker.health}`);

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const errs = [];
  const pages = [];
  async function newPlayer(label, extraQuery, overrideUrl) {
    /* Small viewport on purpose: every open page is a software-rasterised voxel
       world, and this test needs several at once. */
    const ctx = await browser.newContext({viewport: {width: 640, height: 400}});
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`${label}: ${e.message}`));
    page.setDefaultTimeout(90000);
    await page.goto(overrideUrl || (url + (extraQuery || '')),
                    {waitUntil: 'load', timeout: 120000});
    await page.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready(),
                              {timeout: 150000});
    pages.push({label, page, ctx});
    return page;
  }
  const waitFor = (page, fn, arg, ms) =>
    page.waitForFunction(fn, arg, {timeout: ms || 20000}).then(() => true).catch(() => false);
  /* "In the same world together" is two facts, and the second one lags: the socket has
     to reach the new room and the roster has to come back. Asserting after a fixed
     sleep caught a client still connecting and reported it as being alone - a test
     failure that looked exactly like the bug it was meant to be watching for. */
  const waitTogether = (page, ms) => waitFor(page, () => {
    const H = window.__henrycraft;
    return H.mp.status() === 'sharing' && H.mp.players().length === 1;
  }, null, ms || 45000);

  try {
    // ---- 1: two clients, edits both ways --------------------------------------
    console.log('1. two clients in one district see each other\'s edits');
    const c1 = code();
    const A = await newPlayer('A');
    const B = await newPlayer('B');

    await A.evaluate(c => window.__henrycraft.mp.join(c), c1);
    const aSharing = await waitFor(A, () => window.__henrycraft.mp.status() === 'sharing');
    check('the first client to share becomes the district (adopted)', aSharing,
          'A status: ' + await A.evaluate(() => window.__henrycraft.mp.status()));

    /* A builds something first, so that what B is told about is a real district
       with real blocks in it rather than an empty one. */
    const spot = await A.evaluate(() => {
      const H = window.__henrycraft, y = H.surfaceY(20, 20) + 1;
      H.setBlock(20, y, 20, H.ids.RAINBOW);
      return {x: 20, y: y, z: 20, id: H.ids.RAINBOW};
    });
    await waitFor(A, () => window.__henrycraft.mp.queued() === 0);

    /* Somebody joining by a code has a district two seconds old with nothing in it.
       Asking them to choose between that and the shared world is a question with one
       answer, and it is what made joining feel complicated - so it is not asked. */
    await B.evaluate(c => window.__henrycraft.mp.join(c), c1);
    const bIn = await waitFor(B, () => window.__henrycraft.mp.status() === 'sharing',
                              null, 30000);
    const bPanels = await B.evaluate(() => ({
      pending: window.__henrycraft.mp.pending(),
      copyPanel: !document.getElementById('serverCopy').classList.contains('hide'),
      joinPanel: !document.getElementById('joinPanel').classList.contains('hide'),
    }));
    check('joining with an empty district just joins - no question, no second button',
          bIn && !bPanels.pending && !bPanels.copyPanel && !bPanels.joinPanel,
          JSON.stringify(bPanels));

    const bSaw = await waitFor(B, s => window.__henrycraft.getBlock(s.x, s.y, s.z) === s.id,
                               spot);
    check('what A had already built is there when B adopts the shared copy', bSaw,
          'B sees ' + await B.evaluate(s => window.__henrycraft.getBlock(s.x, s.y, s.z), spot));

    /* The coordinate is worked out once and reused. Reading surfaceY again after
       placing the block returns the block itself, which had this test looking one
       cell too high and calling a working sync a failure. */
    const spot2 = await B.evaluate(() => {
      const H = window.__henrycraft, y = H.surfaceY(24, 24) + 1;
      H.setBlock(24, y, 24, H.ids.DIAMOND);
      return {x: 24, y: y, z: 24, id: H.ids.DIAMOND};
    });
    const aSaw = await waitFor(A, s => window.__henrycraft.getBlock(s.x, s.y, s.z) === s.id,
                               spot2);
    check('and a block placed by B arrives at A', aSaw,
          'A sees ' + await A.evaluate(s => window.__henrycraft.getBlock(s.x, s.y, s.z), spot2));

    // each sees the other's avatar, and it glides rather than teleporting
    const rosterA = await A.evaluate(() => ({
      players: window.__henrycraft.mp.players(),
      roster: window.__henrycraft.mp.rosterText(),
    }));
    check('each client can see the other player', rosterA.players.length === 1,
          JSON.stringify(rosterA));

    /* Two separate claims, and they used to be muddled into one timing-dependent
       check that slept 400ms and then sampled six animation frames. On a runner
       drawing one frame a second that samples after the glide has finished, reads
       six identical numbers, and passed only because a frame happened to land in
       the gap. So: the wire is tested by waiting for the position to arrive, and
       the gliding is tested by driving the interpolation with a chosen dt. */
    await B.evaluate(() => window.__henrycraft.movePlayer(40, 22, 40));
    const moveArrived = await waitFor(A, () => {
      const p = window.__henrycraft.mp.players()[0];
      return !!p && Math.abs(p.x - 40) < 0.2 && Math.abs(p.z - 40) < 0.2;
    });
    check('a move made on one screen arrives on the other', moveArrived,
          JSON.stringify(await A.evaluate(() => window.__henrycraft.mp.players())));

    const glide = await A.evaluate(() => {
      const H = window.__henrycraft, p = H.mp.players()[0];
      if (!p) return null;
      /* Back to a known spot first, then glide 10 blocks with a dt well under the
         0.1s send interval, so a body that glides has to show its working. */
      H.mp.glideProbe(p.id, {x: 30, y: 22, z: 40}, 1, 1);
      return H.mp.glideProbe(p.id, {x: 40, y: 22, z: 40}, 0.02, 6);
    });
    const steps = glide ? glide.seen : [];
    check('a remote player is interpolated rather than teleported',
          glide && glide.from === 30 &&
          new Set(steps).size >= 5 &&                       /* every step distinct */
          steps.every((v, i) => i === 0 || v >= steps[i - 1]) &&   /* and monotonic */
          steps[0] < 34 && Math.abs(steps[steps.length - 1] - 40) < 0.01,
          JSON.stringify(glide));
    note(`a 10-block step is drawn over ${steps.length} frames: ${steps.join(' → ')}`);

    // and they cannot touch Henry
    const shove = await A.evaluate(async () => {
      const H = window.__henrycraft;
      const me = H.player();
      H.movePlayer(40, 22, 40);                 // stand exactly where B stands
      const start = H.player();
      await new Promise(r => setTimeout(r, 600));
      const end = H.player();
      return {start, end, dx: Math.abs(end.x - start.x), dz: Math.abs(end.z - start.z), me};
    });
    check('standing a remote player inside Henry does not push him',
          shove.dx < 0.001 && shove.dz < 0.001, JSON.stringify(shove));

    // ---- 2: third and fourth clients see accumulated state --------------------
    console.log('\n2. a third and fourth client arrive and see everything already built');
    /* This one HAS built something of its own, which is the case where the question
       is a real question: B1 says never merge silently, and never lose a build. */
    const C = await newPlayer('C');
    /* Build in the district first, then share it under the existing code - join()
       would make a brand new empty district and there would be nothing to ask
       about, which is how this test first fooled itself. */
    await C.evaluate(() => {
      const H = window.__henrycraft;
      H.setBlock(40, H.surfaceY(40, 40) + 1, 40, H.ids.BRICK);
    });
    await C.evaluate(c => window.__henrycraft.mp.start(c), c1);
    const cAsked = await waitFor(C, () => window.__henrycraft.mp.pending(), null, 30000);
    const cPanel = await C.evaluate(() => ({
      shown: !document.getElementById('serverCopy').classList.contains('hide'),
      text: document.getElementById('scWhat').textContent,
      together: !document.getElementById('together').classList.contains('hide'),
    }));
    check('a client that has built something IS asked before anything is replaced',
          cAsked && cPanel.shown && /blocks in it/.test(cPanel.text),
          JSON.stringify(cPanel));
    check('and only one panel is on screen while it asks',
          cPanel.shown && !cPanel.together, JSON.stringify(cPanel));
    note('the joiner with a build was shown: ' + cPanel.text);
    await C.evaluate(() => window.__henrycraft.mp.adopt());
    await waitFor(C, () => window.__henrycraft.mp.status() === 'sharing');
    const kept = await C.evaluate(() => window.__henrycraft.districts().list.length);
    check('accepting the shared copy keeps its own as a separate district',
          kept >= 2, `${kept} districts after adopting`);
    const cSees = await C.evaluate(s => ({
      a: window.__henrycraft.getBlock(s[0].x, s[0].y, s[0].z),
      b: window.__henrycraft.getBlock(s[1].x, s[1].y, s[1].z),
      want: [s[0].id, s[1].id],
      players: window.__henrycraft.mp.players().length,
    }), [spot, spot2]);
    check('the third client arrives with both earlier edits already in place',
          cSees.a === cSees.want[0] && cSees.b === cSees.want[1], JSON.stringify(cSees));
    check('and sees the two players already there', cSees.players === 2,
          `${cSees.players} others`);

    const d = await rawClient(wPort, c1, 'Gold Owl', '#f2c231');
    const dw = await welcomed(d);
    const dEdits = dw ? Object.keys(dw.edits || {}).length : -1;
    const dPlayers = dw ? dw.players.length : -1;
    check('a fourth client is handed the accumulated block map and roster on joining',
          dw && dEdits >= 2 && dPlayers === 3,
          `welcome: ${dEdits} edits, ${dPlayers} players`);
    note(`fourth client received ${dEdits} accumulated edits and ${dPlayers} players`);

    /* C's work is done, and every page still open is a software-rasterised world:
       leaving five running made the ninth player's page time out on load. */
    await pages.find(p => p.label === 'C').ctx.close();
    pages.splice(pages.findIndex(p => p.label === 'C'), 1);

    // ---- 3: the ninth is refused, kindly -------------------------------------
    console.log('\n3. the ninth player is turned away without a scene');
    const c2 = code();
    const crowd = [];
    for (let i = 0; i < 8; i++) {
      crowd.push(await rawClient(wPort, c2, 'Blue Otter', '#2f7fd6',
                                 i === 0 ? {seed: 5, starSeed: 5, theme: 'meadow', edits: {}} : null));
      await sleep(120);
    }
    const inside = await welcomedAll(crowd);
    const ninth = await newPlayer('ninth');
    await ninth.evaluate(c => window.__henrycraft.mp.join(c), c2);
    const refused = await waitFor(ninth, () => window.__henrycraft.mp.status() === 'full');
    const after = await ninth.evaluate(() => ({
      status: window.__henrycraft.mp.status(),
      on: window.__henrycraft.mp.on(),
      label: window.__henrycraft.mp.toggleLabel(),
      line: window.__henrycraft.mp.statusLine(),
      playable: window.__henrycraft.ready(),
      dialogs: ['serverCopy', 'joinPanel'].filter(id => {
        const e = document.getElementById(id);
        return e && !e.classList.contains('hide');
      }).length,
    }));
    check(`eight players fill a district (${inside} admitted)`, inside === 8,
          `${inside} of 8 got a welcome`);
    check('the ninth is refused and drops back to playing alone', refused && !after.on,
          JSON.stringify(after));
    check('no error dialog is put in front of the ninth player',
          after.dialogs === 0 && after.playable, JSON.stringify(after));
    note(`ninth player sees: "${after.line}"`);
    crowd.forEach(c => c.close());

    // ---- 4: a drop mid-session, then a quiet reconnect ------------------------
    console.log('\n4. a client that drops mid-session comes back without losing anything');
    const mine = await A.evaluate(() => {
      const H = window.__henrycraft, y = H.surfaceY(30, 12) + 1;
      H.setBlock(30, y, 12, H.ids.EMERALD);
      return {x: 30, y, z: 12, id: H.ids.EMERALD};
    });
    const flushed = await waitFor(A, () => window.__henrycraft.mp.queued() === 0);
    check('the edit reached the wire before the plug was pulled', flushed,
          'still queued: ' + await A.evaluate(() => window.__henrycraft.mp.queued()));
    await A.evaluate(() => window.__henrycraft.mp.drop());
    const wentQuiet = await waitFor(A, () => window.__henrycraft.mp.status() === 'reconnecting');
    // while A is away, somebody else builds
    const theirs = await B.evaluate(() => {
      const H = window.__henrycraft, y = H.surfaceY(33, 15) + 1;
      H.setBlock(33, y, 15, H.ids.LAPIS);
      return {x: 33, y, z: 15, id: H.ids.LAPIS};
    });
    const backAgain = await waitFor(A, () => window.__henrycraft.mp.status() === 'sharing', null, 30000);
    const resynced = await waitFor(A, t => window.__henrycraft.getBlock(t.x, t.y, t.z) === t.id,
                                   theirs, 30000);
    const stillMine = await A.evaluate(m => window.__henrycraft.getBlock(m.x, m.y, m.z), mine);
    check('the drop is handled quietly, with no dialog and no stop',
          wentQuiet, 'status went to ' + await A.evaluate(() => window.__henrycraft.mp.status()));
    check('it reconnects on its own', backAgain,
          'status: ' + await A.evaluate(() => window.__henrycraft.mp.status()));
    check('and picks up what was built while it was away', resynced,
          `expected ${theirs.id}`);
    check('without losing what it had built itself', stillMine === mine.id,
          `own block is now ${stillMine}, wanted ${mine.id}`);
    // and the server still holds both, which is what a later joiner would get
    const audit = await rawClient(wPort, c1, 'Lime Crab', '#4fc04f');
    const aw = (await welcomed(audit)) || {edits: {}};
    const has = k => Object.prototype.hasOwnProperty.call(aw.edits, k);
    const wantKeys = [[spot, 'A before B joined'], [spot2, 'B after adopting'],
                      [mine, 'A just before the drop'], [theirs, 'B during the drop']];
    const missing = wantKeys
      .filter(([k]) => !has(`${k.x},${k.y},${k.z}`))
      .map(([k, why]) => `${k.x},${k.y},${k.z} (${why})`);
    check('the server holds both sides of the split',
          has(`${mine.x},${mine.y},${mine.z}`) && has(`${theirs.x},${theirs.y},${theirs.z}`),
          `server has ${Object.keys(aw.edits).length} edits; missing: ` +
          (missing.join('; ') || 'none') + `; keys: ${Object.keys(aw.edits).join(' ')}`);
    note(`the server ended with ${Object.keys(aw.edits).length} of 4 expected blocks` +
         (missing.length ? `, missing ${missing.join('; ')}` : ', all four present'));
    audit.close();

    // ---- 7: nothing another player sends is ever rendered ---------------------
    console.log('\n7. no code path renders text from another player');
    const NASTY = '<img src=x onerror="document.title=\'pwned\'">';
    const hostile = await A.evaluate(async bad => {
      const H = window.__henrycraft;
      // straight into the client's message handler, exactly as the socket would
      H.mp.feed({type: 'joined', player: {id: 'evil1', name: bad, colour: 'javascript:alert(1)'}});
      H.mp.feed({type: 'joined', player: {id: 'evil2', name: 'Red Fox', colour: '#c0392b'}});
      H.mp.feed({type: 'moved', id: 'evil1', x: 20, y: 20, z: 20, yaw: 0});
      // and a message type that does not exist, carrying text
      H.mp.feed({type: 'chat', id: 'evil1', text: bad});
      H.mp.feed({type: 'say', message: bad});
      await new Promise(r => setTimeout(r, 300));
      /* Only text a person could actually read. document.body.textContent would
         include the inline <script> that *is* the game, where ws.onerror is an
         ordinary handler name - matching that says nothing about what is on
         screen. */
      function visibleText(){
        var out='', walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{
          acceptNode:function(n){
            var t=n.parentNode&&n.parentNode.nodeName;
            return (t==='SCRIPT'||t==='STYLE')?NodeFilter.FILTER_REJECT
                                              :NodeFilter.FILTER_ACCEPT;
          }
        });
        while(walk.nextNode()) out+=walk.currentNode.nodeValue+' ';
        return out;
      }
      var seen=visibleText();
      return {
        labels: H.mp.players().map(p => p.label),
        colours: H.mp.players().map(p => p.colour),
        roster: H.mp.rosterText(),
        bodyHasIt: document.body.innerHTML.indexOf(bad) >= 0,
        textHasIt: seen.indexOf('onerror') >= 0 || seen.indexOf('img src') >= 0,
        imgs: document.querySelectorAll('#ui img, .overlay img').length,
        title: document.title,
        safe: H.mp.safeName(bad),
      };
    }, NASTY);
    check('a hostile name is replaced with one from the fixed list, not shown',
          hostile.labels.indexOf(NASTY) < 0 && hostile.safe === 'Blue Fox',
          JSON.stringify(hostile.labels));
    check('it never reaches the page, as markup or as readable text',
          !hostile.bodyHasIt && !hostile.textHasIt && hostile.imgs === 0 &&
          hostile.title !== 'pwned',
          JSON.stringify({markup: hostile.bodyHasIt, text: hostile.textHasIt,
                          images: hostile.imgs, title: hostile.title}));
    check('an invalid colour falls back instead of being used as a value',
          hostile.colours.every(c => /^#[0-9a-f]{6}$/i.test(c)),
          JSON.stringify(hostile.colours));
    check('a message type that does not exist is dropped, text and all',
          hostile.roster.indexOf('onerror') < 0 && !/img|script/i.test(hostile.roster),
          JSON.stringify(hostile.roster));
    note(`roster after the hostile messages: "${hostile.roster.replace(/\s+/g, ' ').trim()}"`);

    // ---- the client-side pieces the brief asks for by shape -------------------
    console.log('\nB2 and B3: the toggle, the codes and the link');
    const shapes = await A.evaluate(() => {
      const H = window.__henrycraft, out = {};
      out.code = H.mp.code();
      out.re = H.mp.codeRe();
      out.made = H.mp.makeCode('green-meadow');
      out.tidy = [H.mp.tidy('k4tpuy'), H.mp.tidy('  K4TPUY '),
                  H.mp.tidy('K4tPuY'),
                  H.mp.tidy('  green-meadow-K7Q4XM2P9T  ')];
      out.words = H.mp.words('green-meadow-K7Q4XM2P9T');
      out.shortWords = H.mp.words('K4TPUY');
      out.link = H.mp.shareLink();
      out.max = H.mp.max();
      out.host = H.mp.host();
      out.endpoint = H.mp.endpoint('green-meadow-K7Q4XM2P9T');
      return out;
    });
    const re = new RegExp(shapes.re);
    check(`generated codes are six characters and nothing else ("${shapes.made}")`,
          re.test(shapes.made) && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(shapes.made),
          shapes.made);
    check('and the long codes already shared with the family still work',
          re.test('little-spring-mine-K4TPUYSCGJ'), 'long form rejected');
    check('no lookalike characters in a code, so it survives being read aloud',
          !/[IO01]/.test(shapes.made), shapes.made);
    check('a code typed in the wrong case still works',
          shapes.tidy.every(t => re.test(t)), JSON.stringify(shapes.tidy));
    check('a joined district gets a readable name, not the code',
          shapes.words === 'Green Meadow' &&
          H_words(shapes.shortWords), JSON.stringify([shapes.words, shapes.shortWords]));
    check('the share link carries the code and nothing else',
          /\?district=[A-Z0-9]{6}$/.test(shapes.link), shapes.link);
    check('the cap is 8 players', shapes.max === 8, String(shapes.max));
    note(`endpoint in production: wss://${shapes.host}/district/<code>`);

    /* The ninth-player page has done its job, and every page still open is a
       software-rendered voxel world competing for the same CPU. Leaving it running
       made the join below take longer than its wait allowed, which showed up as an
       intermittent failure rather than an honest one. */
    const ninthPage = pages.find(p => p.label === 'ninth');
    if (ninthPage) { await ninthPage.ctx.close(); pages.splice(pages.indexOf(ninthPage), 1); }
    d.close();

    // the deep link, in a fresh browser, as a grandparent would use it
    const G = await newPlayer('link', `&district=${c1}`);
    const arrived = await waitFor(G, () => window.__henrycraft.mp.status() === 'sharing' ||
                                            window.__henrycraft.mp.pending(), null, 60000);
    const gState = await G.evaluate(() => ({
      code: window.__henrycraft.mp.code(),
      name: window.__henrycraft.districts().list[0].name,
      playing: !document.getElementById('start').classList.contains('hide') === false,
    }));
    check('a ?district= link opens straight into that district', arrived && gState.code === c1,
          JSON.stringify({arrived, wanted: c1, got: gState.code, gState,
                          status: await G.evaluate(() => window.__henrycraft.mp.status())}));
    check('and starts playing rather than sitting on the title screen', gState.playing,
          JSON.stringify(gState));

    // ---- one character per colour ------------------------------------------
    console.log('\nEight characters, one per shirt colour');
    const looks = await A.evaluate(() => {
      const H = window.__henrycraft;
      const L = H.looks(), cols = H.colours();
      const key = k => [k.hair, k.skin, k.shirt, k.shoe, k.long].join('/');
      return {n: L.length, colours: cols.length,
              distinct: new Set(L.map(key)).size,
              faces: new Set(L.map(l => l.face)).size,
              longHaired: L.filter(l => l.long).length,
              henryShirt: L[0].shirt, henryHair: L[0].hair, henrySkin: L[0].skin,
              byColour: cols.map(c => H.lookForColour(c).shirt),
              named: L.map(l => l.name).filter(Boolean),
              unknownColour: H.lookForColour('#not-a-colour').shirt};
    });
    check(`there are ${looks.n} characters: eight anyones and the family`,
          looks.n === 14 && looks.colours === 8, JSON.stringify(looks));
    check('no two characters share a hair, skin, shirt and shoe combination',
          looks.distinct === looks.n, `${looks.distinct} distinct of ${looks.n}`);
    check(`each has its own face, drawn for its own skin (${looks.faces} of ${looks.n})`,
          looks.faces === looks.n, `${looks.faces} distinct faces`);
    check(`several have long hair, so they differ in silhouette too ` +
          `(${looks.longHaired})`,
          looks.longHaired >= 4, String(looks.longHaired));
    check('Henry is still the ginger one in the cream top',
          looks.henryShirt === 0xe4d7bb && looks.henryHair === 0xc9682f &&
          looks.henrySkin === 0xefc49c, JSON.stringify(looks));
    check('every colour maps to its own character, and an unknown colour falls back',
          new Set(looks.byColour).size === 8 && looks.unknownColour === 0xe4d7bb,
          JSON.stringify(looks.byColour.map(v => v.toString(16))));
    check(`everybody named is there (${looks.named.join(', ')})`,
          looks.named.join(',') === 'Henry,Pops,GiGi,Jonathan,Dad,Mommy,Christian',
          JSON.stringify(looks.named));

    /* End to end: the character another player is drawn as has to follow from the
       colour that actually came over the wire. */
    const seen = await A.evaluate(() => {
      const H = window.__henrycraft;
      return H.mp.players().map(p => ({colour: p.colour, shirt: p.shirt, hair: p.hair,
                                       lookIndex: p.lookIndex,
                                       expect: H.looks()[p.lookIndex]}));
    });
    check(`remote players are drawn as the character they said they are ` +
          `(${seen.length} checked)`,
          seen.length > 0 && seen.every(p => p.shirt === p.expect.shirt &&
                                            p.hair === p.expect.hair),
          JSON.stringify(seen));

    /* The names of real people are the server's to give, not the client's to
       claim. A raw client asks to be character 8 while calling itself something
       else entirely; the room must show it as Pops, and an out-of-range character
       must fall back rather than be honoured. */
    const impostor = await rawClient(wPort, c1, '<script>alert(1)</script>',
                                     '#c0392b', null, 8);
    await sleep(900);
    const asSeen = await A.evaluate(() => window.__henrycraft.mp.players()
                      .map(p => ({label: p.label, look: p.lookIndex})));
    check('a client claiming a family name is shown the name the server chose',
          asSeen.some(p => p.label === 'Pops') &&
          !asSeen.some(p => /script|Definitely/.test(p.label)),
          JSON.stringify(asSeen));
    const outOfRange = await rawClient(wPort, c1, 'Blue Fox', '#2f7fd6', null, 999);
    await sleep(700);
    const fell = await A.evaluate(() => {
      const H = window.__henrycraft, n = H.looks().length;
      const all = H.mp.players();
      return {ok: all.every(p => Number.isInteger(p.lookIndex) &&
                                 p.lookIndex >= 0 && p.lookIndex < n),
              seen: all.map(p => ({label: p.label, look: p.lookIndex}))};
    });
    check('a character number outside the list falls back instead of being honoured',
          fell.ok, JSON.stringify(fell.seen));
    impostor.close(); outOfRange.close();
    note(`characters: ${looks.n} distinct, ${looks.longHaired} long-haired, ` +
         `${looks.faces} faces drawn per skin tone`);

    /* ---- the same person on every screen ----
       The bug this is here for: the local player was always drawn as Henry, while
       everybody else drew him as whatever his colour said. Two devices side by side
       showed two different people, and moving "your Henry" moved somebody else's
       character on their screen. What he sees himself as and what the room sees have
       to be the same character. */
    console.log('\nThe same character on every screen');
    const aName = await A.evaluate(() => window.__henrycraft.mp.me().name);
    const aLook = await A.evaluate(() => window.__henrycraft.localLook());
    const bSawBefore = await B.evaluate(() => (window.__henrycraft.mp.players()
                          .find(p => p.lookIndex === 0) || {}).shirt);
    check('what he sees himself as is what the room sees him as',
          aLook.shirt === bSawBefore,
          JSON.stringify({heSees: aLook.shirt, roomSees: bSawBefore, name: aName}));

    /* And the name over his head, which the check above does not cover: Henry's
       own character had no name in the table, so the server named him from the word
       list and he turned up on somebody else's screen as "Silver Otter" while his
       own screen said HENRY. Both clients are on character 0 here, which is exactly
       the case that was broken. */
    const labels = await A.evaluate(() => ({mine: window.__henrycraft.localLabel(),
                                            look: window.__henrycraft.localLook().index}));
    const bLabelForA = await B.evaluate(() => window.__henrycraft.mp.players()
                          .map(p => ({label: p.label, look: p.lookIndex})));
    check(`the name over his own head is the name the room shows ("${labels.mine}")`,
          labels.look === 0 && labels.mine === 'Henry' &&
          bLabelForA.some(p => p.look === 0 && p.label === 'Henry'),
          JSON.stringify({heIs: labels, roomSees: bLabelForA}));

    /* Pick a different character, and it has to travel. */
    await A.evaluate(() => window.__henrycraft.chooseCharacter(3));
    const picked = await A.evaluate(() => window.__henrycraft.localLook());
    const travelled = await waitFor(B, shirt =>
      window.__henrycraft.mp.players().some(q => q.shirt === shirt),
      picked.shirt, 40000);
    const bSawAfter = await B.evaluate(shirt => (window.__henrycraft.mp.players()
                         .find(p => p.shirt === shirt) || {}).shirt, picked.shirt);
    check('choosing a character changes the body he walks around in',
          picked.index === 3 && picked.chosen === true, JSON.stringify(picked));
    check('and the room is drawing him as that character too',
          travelled && bSawAfter === picked.shirt,
          JSON.stringify({heSees: picked.shirt, roomSees: bSawAfter}));

    /* The picker itself: eight cards, each actually drawn. */
    const cards = await A.evaluate(() => {
      const H = window.__henrycraft;
      const out = [];
      for (let i = 0; i < H.looks().length; i++) out.push(H.cardPixels(i));
      document.getElementById('tWho').click();
      const open = !document.getElementById('whoAmI').classList.contains('hide');
      const n = document.querySelectorAll('#whoGrid .ccard').length;
      const marked = document.querySelectorAll('#whoGrid .ccard.on').length;
      document.getElementById('whoDone').click();
      return {out, open, n, marked};
    });
    check(`the picker shows ${cards.n} faces, with the current one marked`,
          cards.open && cards.n === 14 && cards.marked === 1,
          JSON.stringify({open: cards.open, n: cards.n, marked: cards.marked}));
    check('every card is actually drawn, not an empty box',
          cards.out.every(c => c.opaque > 900 && c.w === 54),
          JSON.stringify(cards.out.map(c => c.opaque)));
    note(`character choice travels: he picked ${picked.shirt.toString(16)} and the ` +
         `room redrew him as ${bSawAfter && bSawAfter.toString(16)}`);

    /* ---- an older server, which is what he actually hit ----
       A Worker that predates the character number sends everybody without one. The
       client used to settle on character 0 for those, and character 0 is Henry - so
       two players both showed up as Henry on the phone while the PC happened to look
       right. Falling back to the colour keeps people distinct, and the name of a
       character we were never told is not claimed. */
    console.log('\nAn out-of-date server must not turn everybody into Henry');
    const old = await A.evaluate(async () => {
      const H = window.__henrycraft;
      /* Exactly what an older server broadcasts: no look field at all. */
      H.mp.feed({type: 'joined', player: {id: 'old1', name: 'Gold Owl', colour: '#4fc04f'}});
      H.mp.feed({type: 'joined', player: {id: 'old2', name: 'Teal Wren', colour: '#9b59b6'}});
      await new Promise(r => setTimeout(r, 200));
      const them = H.mp.players().filter(p => /old/.test(p.id));
      return {them: them.map(p => ({label: p.label, look: p.lookIndex, shirt: p.shirt})),
              stale: H.mp.stale(), who: H.mp.staleWho(), line: H.mp.statusLine()};
    });
    check('two players with no character number are not both drawn as Henry',
          old.them.length === 2 && old.them[0].look !== old.them[1].look &&
          old.them.every(p => p.label !== 'Henry'),
          JSON.stringify(old.them));
    /* This worker is a current one, so a player arriving without a character number
       is running an out-of-date *game*. Saying "the sync server needs updating" here
       sent me to redeploy a server that was already deployed - the warning has to name
       the thing that is actually old. */
    check('and it blames the out-of-date game, not the server that is up to date',
          old.stale === true && old.who === 'client' &&
          /reload/i.test(old.line) && !/wrangler/i.test(old.line),
          JSON.stringify({stale: old.stale, who: old.who, line: old.line}));
    note(`a stale player reads as: "${old.line}"`);

    /* The other half: a server that never mentions portals is the older Worker, and
       then it really is the server that needs redeploying. */
    const oldSrv = await A.evaluate(async () => {
      const H = window.__henrycraft;
      /* A welcome with no portals field at all - exactly what the older Worker sends. */
      H.mp.feed({type: 'welcome', you: 'meX', adopted: false, seed: H.districts().seed,
                 starSeed: H.districts().seed, theme: H.districts().theme,
                 edits: {}, players: []});
      H.mp.feed({type: 'joined', player: {id: 'srv1', name: 'Gold Owl', colour: '#4fc04f'}});
      await new Promise(r => setTimeout(r, 250));
      return {who: H.mp.staleWho(), line: H.mp.statusLine(),
              shared: H.mp.portalsShared(),
              banner: document.getElementById('staleWarn').textContent};
    });
    check('a server that cannot share portals is named as the thing to redeploy',
          oldSrv.who === 'server' && oldSrv.shared === false &&
          /wrangler deploy/.test(oldSrv.banner),
          JSON.stringify(oldSrv));
    note(`an old server reads as: "${oldSrv.line}"`);

    /* And it un-latches. One stale phone joining for ten seconds used to leave the
       red banner up for the rest of the evening, telling him to fix something that
       was not broken. */
    const cleared = await A.evaluate(async () => {
      const H = window.__henrycraft;
      H.mp.feed({type: 'left', id: 'srv1'});
      await new Promise(r => setTimeout(r, 150));
      return {who: H.mp.staleWho(), stale: H.mp.stale(),
              hidden: document.getElementById('staleWarn').classList.contains('hide'),
              line: H.mp.statusLine()};
    });
    check('and the warning goes away when the out-of-date player does',
          cleared.who === null && cleared.stale === false && cleared.hidden === true,
          JSON.stringify(cleared));

    /* How many people are here, where he can see it without opening anything. */
    const chip = await A.evaluate(() => {
      const c = document.getElementById('peopleChip');
      return {shown: !c.classList.contains('hide'),
              count: document.getElementById('peopleNum').textContent,
              who: c.title,
              players: window.__henrycraft.mp.players().length};
    });
    check(`the player count is on screen and right (${chip.count} here)`,
          chip.shown && Number(chip.count) === chip.players + 1,
          JSON.stringify(chip));
    check('and it names who is here',
          chip.who.split(',').length === chip.players + 1, JSON.stringify(chip.who));
    note(`count chip: ${chip.count} people - ${chip.who}`);

    // leaving the district leaves the session
    await A.evaluate(() => window.__henrycraft.goHome());
    await sleep(500);
    const afterHome = await A.evaluate(() => ({on: window.__henrycraft.mp.on(),
                                               status: window.__henrycraft.mp.status(),
                                               players: window.__henrycraft.mp.players().length}));
    check('going somewhere else leaves the shared session behind',
          !afterHome.on && afterHome.players === 0, JSON.stringify(afterHome));

    /* ---- travelling together ------------------------------------------------

       The reason this whole protocol change exists. He and his dad built portals in
       a shared world and got: a portal one of them could use and the other could
       not; a second world when the other one lit the same frame; separate places
       after coming back; and a fresh duplicate district on every re-share. Every
       check below is one of those, turned round.

       Fresh pages, because the ones above have been dropped, refused and sent home,
       and this needs two clients in a known state. */
    console.log('\nWalking through a portal together');
    for (const label of ['A', 'B', 'link', 'ninth']) {
      const pg = pages.find(p => p.label === label);
      if (pg) { await pg.ctx.close(); pages.splice(pages.indexOf(pg), 1); }
    }
    const cT = code();
    const T1 = await newPlayer('T1');
    const T2 = await newPlayer('T2');

    /* T1 shares a world with a portal frame standing in it, finished but unlit. */
    const frame = await T1.evaluate(async c => {
      const H = window.__henrycraft, ids = H.ids;
      H.loadThemeSeed('meadow', 4242);
      const gy = H.surfaceY(30, 30);
      for (let y = gy; y < gy + 10; y++) for (let x = 24; x <= 36; x++) {
        for (let d = -4; d <= 4; d++) H.setBlock(x, y, 30 + d, ids.AIR);
      }
      const b = H.buildFrame({plane: 'x', w: 2, h: 3, ax: 29, ay: gy, fixed: 30,
                              fill: ids.SAND});
      for (let x = 24; x <= 36; x++) for (let d = -4; d <= 4; d++) {
        if (H.getBlock(x, gy - 1, 30 + d) === ids.AIR) H.setBlock(x, gy - 1, 30 + d, ids.STONE);
      }
      H.mp.start(c);
      return {probe: b.probe, gy};
    }, cT);
    await waitFor(T1, () => window.__henrycraft.mp.status() === 'sharing');
    await T2.evaluate(c => window.__henrycraft.mp.join(c), cT);
    await waitFor(T2, () => window.__henrycraft.mp.status() === 'sharing');
    const bothIn = await T1.evaluate(() => window.__henrycraft.mp.players().length);
    check('two players sharing a world, with a portal frame standing in it',
          bothIn === 1, `T1 sees ${bothIn} others`);
    const canShare = await T1.evaluate(() => window.__henrycraft.mp.portalsShared());
    check('the room says it can agree on where a portal goes', canShare === true,
          `portalsShared: ${canShare}`);

    /* T1 strikes the flint. The destination is minted once, by the server. */
    const homeCodes = await Promise.all([T1, T2].map(p => p.evaluate(() =>
      window.__henrycraft.districts().code)));
    const districtsBefore = await Promise.all([T1, T2].map(p => p.evaluate(() =>
      window.__henrycraft.districts().list.length)));
    await T1.evaluate(f => window.__henrycraft.tryLight(f.probe.x, f.probe.y, f.probe.z),
                      frame);
    const litOn = await Promise.all([T1, T2].map(p => waitFor(p, () =>
      window.__henrycraft.portals().some(q => q.lit && q.code))));
    check('one player lights it and it lights for both of them',
          litOn[0] && litOn[1], JSON.stringify(litOn));
    const seenBy = await Promise.all([T1, T2].map(p => p.evaluate(() => {
      const q = window.__henrycraft.portals().filter(x => x.lit)[0] || {};
      return {code: q.code, seed: q.destSeed, theme: q.destTheme, key: q.key};
    })));
    check('and both are bound to the same place, by code and by seed',
          !!seenBy[0].code && seenBy[0].code === seenBy[1].code &&
          seenBy[0].seed === seenBy[1].seed && seenBy[0].theme === seenBy[1].theme,
          JSON.stringify(seenBy));
    /* The bug in its purest form: the other player lighting the same frame used to
       mint a second world. It must be answered with the one that already exists. */
    await T2.evaluate(f => window.__henrycraft.tryLight(f.probe.x, f.probe.y, f.probe.z),
                      frame);
    await sleep(400);
    const afterSecond = await Promise.all([T1, T2].map(p => p.evaluate(() => {
      const lit = window.__henrycraft.portals().filter(q => q.lit);
      return {lit: lit.length, codes: lit.map(q => q.code),
              districts: window.__henrycraft.districts().list.length};
    })));
    check('the other player striking the same frame does not make a second world',
          afterSecond[0].codes[0] === seenBy[0].code &&
          afterSecond[1].codes[0] === seenBy[0].code &&
          afterSecond[0].lit === 1 && afterSecond[1].lit === 1,
          JSON.stringify(afterSecond));
    check('and lighting it built no district on either device yet',
          afterSecond[0].districts === districtsBefore[0] &&
          afterSecond[1].districts === districtsBefore[1],
          JSON.stringify({afterSecond, districtsBefore}));
    note(`both screens show one portal to ${seenBy[0].code} (${seenBy[0].theme})`);

    /* Both walk through, one after the other, as they would. */
    const goThrough = p => p.evaluate(() => {
      const H = window.__henrycraft;
      const q = H.portals().filter(x => x.lit)[0];
      return H.travel(q.id);
    });
    const wentT1 = await goThrough(T1);
    await waitFor(T1, c => window.__henrycraft.mp.code() === c, seenBy[0].code);
    await waitFor(T1, () => window.__henrycraft.mp.status() === 'sharing');
    const wentT2 = await goThrough(T2);
    await waitFor(T2, c => window.__henrycraft.mp.code() === c, seenBy[0].code);
    await waitFor(T2, () => window.__henrycraft.mp.status() === 'sharing');
    await sleep(1200);
    const landed = await Promise.all([T1, T2].map(p => p.evaluate(() => {
      const H = window.__henrycraft, d = H.districts();
      return {code: d.code, seed: d.seed, theme: d.theme, slug: d.current,
              room: H.mp.code(), on: H.mp.on(), status: H.mp.status(),
              others: H.mp.players().length,
              districts: d.list.length,
              back: H.portals().filter(q => q.lit && q.isReturn)
                     .map(q => ({code: q.code, key: q.key})),
              lit: H.portals().filter(q => q.lit).length};
    })));
    check('both of them travelled', wentT1 === true && wentT2 === true,
          JSON.stringify({wentT1, wentT2}));
    check('they arrive in the same world - same code, same seed, same theme',
          landed[0].code === seenBy[0].code && landed[1].code === seenBy[0].code &&
          landed[0].seed === landed[1].seed && landed[0].seed === seenBy[0].seed &&
          landed[0].theme === landed[1].theme,
          JSON.stringify(landed.map(a => ({code: a.code, seed: a.seed, theme: a.theme}))));
    check('and they are still playing together, in that world',
          landed[0].on && landed[1].on &&
          landed[0].status === 'sharing' && landed[1].status === 'sharing' &&
          landed[0].others === 1 && landed[1].others === 1,
          JSON.stringify(landed.map(a => ({on: a.on, status: a.status, others: a.others}))));
    check('with one way home between them, not one each',
          landed[0].back.length === 1 && landed[1].back.length === 1 &&
          landed[0].back[0].key === landed[1].back[0].key &&
          landed[0].back[0].code === homeCodes[0],
          JSON.stringify(landed.map(a => a.back)));
    note(`both arrived in ${landed[0].slug} (${landed[0].code}), ` +
         `one way home at ${landed[0].back[0] && landed[0].back[0].key}`);

    /* An edit made in the new world has to reach the other player, or they are in
       two copies of it rather than in it together. */
    const there = await T1.evaluate(() => {
      const H = window.__henrycraft, y = H.surfaceY(20, 44) + 1;
      H.setBlock(20, y, 44, H.ids.DIAMOND);
      return {x: 20, y: y, z: 44, id: H.ids.DIAMOND};
    });
    const sawThere = await waitFor(T2, s =>
      window.__henrycraft.getBlock(s.x, s.y, s.z) === s.id, there);
    check('a block placed in the new world arrives at the other player', sawThere,
          'T2 sees ' + await T2.evaluate(s => window.__henrycraft.getBlock(s.x, s.y, s.z), there));

    /* And home again, together. */
    const backHome = p => p.evaluate(() => {
      const H = window.__henrycraft;
      const q = H.portals().filter(x => x.lit && x.isReturn)[0];
      return H.travel(q.id);
    });
    await backHome(T1);
    await backHome(T2);
    await waitFor(T1, c => window.__henrycraft.mp.code() === c, homeCodes[0]);
    await waitFor(T2, c => window.__henrycraft.mp.code() === c, homeCodes[0]);
    await Promise.all([waitTogether(T1), waitTogether(T2)]);
    const home = await Promise.all([T1, T2].map(p => p.evaluate(() => {
      const H = window.__henrycraft, d = H.districts();
      return {code: d.code, slug: d.current, room: H.mp.code(),
              others: H.mp.players().length, status: H.mp.status(),
              districts: d.list.length};
    })));
    check('coming back puts them in the same place, still together',
          home[0].code === homeCodes[0] && home[1].code === homeCodes[0] &&
          home[0].others === 1 && home[1].others === 1,
          JSON.stringify(home));
    /* The duplicate-worlds bug: three round trips must not leave a row of
       near-identical districts behind. */
    for (let trip = 0; trip < 2; trip++) {
      await goThrough(T1); await goThrough(T2);
      await waitFor(T1, c => window.__henrycraft.mp.code() === c, seenBy[0].code);
      await waitFor(T2, c => window.__henrycraft.mp.code() === c, seenBy[0].code);
      await Promise.all([waitTogether(T1), waitTogether(T2)]);
      await backHome(T1); await backHome(T2);
      await waitFor(T1, c => window.__henrycraft.mp.code() === c, homeCodes[0]);
      await waitFor(T2, c => window.__henrycraft.mp.code() === c, homeCodes[0]);
      await Promise.all([waitTogether(T1), waitTogether(T2)]);
    }
    /* A generous deadline on purpose. Two software-rasterised worlds in one browser,
       eight room switches back to back with no human pause between them, is harder on
       a connection than anything a person does - and a client that is legitimately
       mid-reconnect ("Lost them for a moment") is behaving correctly, not failing.
       Long enough to let a real recovery finish; short enough that a genuine failure
       to reconnect still fails the check. */
    await Promise.all([waitTogether(T1, 45000), waitTogether(T2, 45000)]);
    const later = await Promise.all([T1, T2].map(p => p.evaluate(() => {
      const d = window.__henrycraft.districts();
      const H = window.__henrycraft;
      return {districts: d.list.length, code: d.code, seed: d.seed,
              names: d.list.map(x => x.name),
              why: H.mp.dupReason(), status: H.mp.status(),
              sock: H.mp.sockState(), attempts: H.mp.attempts(),
              pending: H.mp.retryPending(), line: H.mp.statusLine(),
              others: H.mp.players().length};
    })));
    check('three round trips later there is still one world at each end',
          later[0].districts === home[0].districts &&
          later[1].districts === home[1].districts,
          JSON.stringify(later.map(a => ({districts: a.districts, names: a.names}))));
    check('and they are still in the same one, together',
          later[0].code === homeCodes[0] && later[1].code === homeCodes[0] &&
          later[0].others === 1 && later[1].others === 1, JSON.stringify(later));
    note(`after three round trips: ${later[0].districts} districts on T1, ` +
         `${later[1].districts} on T2 (${later[0].names.join(', ')})`);

    /* What the server is actually holding, read straight out of it rather than
       inferred from the clients: one portal at each end and no more. Two players
       walking through within a second of each other both build a way home before
       either has heard from the room, so this is where a duplicate would show up. */
    await Promise.all([goThrough(T1), goThrough(T2)]);
    await waitFor(T1, c => window.__henrycraft.mp.code() === c, seenBy[0].code);
    await waitFor(T2, c => window.__henrycraft.mp.code() === c, seenBy[0].code);
    await Promise.all([waitTogether(T1), waitTogether(T2)]);
    const together = await Promise.all([T1, T2].map(p => p.evaluate(() => {
      const H = window.__henrycraft, d = H.districts();
      return {code: d.code, others: H.mp.players().length,
              lit: H.portals().filter(q => q.lit).length,
              keys: H.portals().filter(q => q.lit).map(q => q.key)};
    })));
    check('travelling at the same moment still lands them in one world together',
          together[0].code === seenBy[0].code && together[1].code === seenBy[0].code &&
          together[0].others === 1 && together[1].others === 1,
          JSON.stringify(together));
    check('and neither of them ends up with a way home the other cannot see',
          together[0].lit === 1 && together[1].lit === 1 &&
          together[0].keys[0] === together[1].keys[0],
          JSON.stringify(together));

    const roomA = await rawClient(wPort, homeCodes[0], 'Red Fox', '#c0392b');
    const roomB = await rawClient(wPort, seenBy[0].code, 'Blue Fox', '#2f7fd6');
    const [wA, wB] = [await welcomed(roomA), await welcomed(roomB)];
    const pA = (wA && wA.portals) || [], pB = (wB && wB.portals) || [];
    check('the server holds exactly one portal at each end, not one per trip',
          pA.length === 1 && pB.length === 1,
          `home has ${pA.length}, the new world has ${pB.length}`);
    check('the one at home leads to the new world, and the one there leads home',
          pA[0] && pA[0].dest.code === seenBy[0].code &&
          pB[0] && pB[0].dest.code === homeCodes[0] && pB[0].isReturn === true,
          JSON.stringify({out: pA[0] && pA[0].dest, back: pB[0] && pB[0].dest}));
    note(`server state: 1 portal in ${homeCodes[0]} -> ${pA[0] && pA[0].dest.code}, ` +
         `1 in ${seenBy[0].code} -> ${pB[0] && pB[0].dest.code}`);
    roomA.close(); roomB.close();

    /* Both strike the flint in the same instant, before either has heard anything.
       This is the race the server exists to settle, and it cannot be reached through
       two browsers: the second client's frame is already lit by then, so its game
       never asks again. Two raw sockets ask at once instead.

       Without the server reusing the record, both get a destination of their own and
       the two of them walk into different worlds - which is what happened. */
    const rc = code();
    const r1 = await rawClient(wPort, rc, 'Red Fox', '#c0392b',
                               {seed: 7, starSeed: 7, theme: 'meadow', edits: {}});
    const r2 = await rawClient(wPort, rc, 'Blue Fox', '#2f7fd6');
    await welcomedAll([r1, r2]);
    const sameFrame = {plane: 'x', fixed: 30, a0: 29, a1: 30, y0: 12, y1: 14, fill: 3};
    r1.send({type: 'portal', frame: sameFrame, theme: 'snowy'});
    r2.send({type: 'portal', frame: sameFrame, theme: 'desert'});
    await sleep(900);
    const answers = r1.seen('portal').concat(r2.seen('portal'))
                      .map(m => m.portal && m.portal.dest && m.portal.dest.code);
    const audit2 = await rawClient(wPort, rc, 'Gold Owl', '#f2c231');
    const wAudit = await welcomed(audit2);
    const held = (wAudit && wAudit.portals) || [];
    check('two players lighting the same frame at once get one destination, not two',
          answers.length >= 2 && new Set(answers).size === 1 && !!answers[0],
          JSON.stringify(answers));
    check('and the district is left holding one portal',
          held.length === 1 && held[0].dest.code === answers[0],
          JSON.stringify(held.map(h => h.dest && h.dest.code)));
    const distinct = [...new Set(answers)];
    note(`a simultaneous strike was answered ${answers.length} times, with ` +
         `${distinct.length} destination${distinct.length === 1 ? '' : 's'}: ` +
         distinct.join(', '));
    r1.close(); r2.close(); audit2.close();

    /* And it all still works alone. He plays on his own most of the day, and a
       portal built with his dad in the evening must not stop working in the morning -
       including after the page has been closed and reopened, which is when the
       destination has to be recovered from the save rather than from the room. */
    const alone = await T1.evaluate(() => {
      window.__henrycraft.mp.stop();
      return window.__henrycraft.districts().list.length;
    });
    await sleep(400);
    await T1.reload({waitUntil: 'load', timeout: 120000});
    await T1.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready(),
                             {timeout: 150000});
    const soloTrip = await T1.evaluate(async () => {
      const H = window.__henrycraft;
      const back = H.portals().filter(q => q.lit && q.isReturn)[0];
      if (!back) return {error: 'no way home survived the reload',
                         portals: H.portals()};
      const went = await H.travel(back.id);
      const d = H.districts();
      return {went, code: d.code, districts: d.list.length, on: H.mp.on(),
              wanted: back.code};
    });
    check('a portal built together still works when he is playing alone, ' +
          'even after a reload',
          soloTrip.went === true && soloTrip.code === homeCodes[0] &&
          soloTrip.on === false,
          JSON.stringify(soloTrip));
    check('and going through it alone does not mint yet another world',
          soloTrip.districts === alone, `${alone} before, ${soloTrip.districts} after`);
    note(`alone after a reload: walked home to ${soloTrip.code} ` +
         `with ${soloTrip.districts} districts, no session`);

    /* The case that covers everything he has already built.

       Most of his portals were lit on his own, months of building behind them, and
       they lead to districts that exist on one tablet. Starting a session used to
       leave every one of them refusing to work. They should instead become places the
       two of them can walk into - with what he built there still in them. */
    console.log('\nWorlds he built alone become places they can both go');
    for (const label of ['T1', 'T2']) {
      const pg = pages.find(p => p.label === label);
      if (pg) { await pg.ctx.close(); pages.splice(pages.indexOf(pg), 1); }
    }
    const cS = code();
    const S1 = await newPlayer('S1');
    const S2 = await newPlayer('S2');
    /* Alone: build a frame, light it, walk through, build something recognisable,
       come back. Exactly what an evening on his own leaves behind. */
    const solo = await S1.evaluate(async () => {
      const H = window.__henrycraft, ids = H.ids;
      H.loadThemeSeed('meadow', 909);
      const gy = H.surfaceY(30, 30);
      for (let y = gy; y < gy + 10; y++) for (let x = 24; x <= 36; x++) {
        for (let d = -4; d <= 4; d++) H.setBlock(x, y, 30 + d, ids.AIR);
      }
      const b = H.buildFrame({plane: 'x', w: 2, h: 3, ax: 29, ay: gy, fixed: 30,
                              fill: ids.SNOW});
      for (let x = 24; x <= 36; x++) for (let d = -4; d <= 4; d++) {
        if (H.getBlock(x, gy - 1, 30 + d) === ids.AIR) H.setBlock(x, gy - 1, 30 + d, ids.STONE);
      }
      const lit = await H.light(b.probe.x, b.probe.y, b.probe.z);
      const home = H.districts().current;
      await H.travel(lit.id);
      /* A tower of diamond, which is the sort of thing he leaves lying about, and
         which the other player must be able to see when they arrive. */
      const ty = H.surfaceY(18, 46) + 1;
      for (let i = 0; i < 4; i++) H.setBlock(18, ty + i, 46, ids.DIAMOND);
      const built = H.districts().current;
      const back = H.portals().filter(q => q.lit && q.isReturn)[0];
      await H.travel(back.id);
      return {home, built, tower: {x: 18, y: ty, z: 46, id: ids.DIAMOND},
              atHome: H.districts().current, portalId: lit.id,
              districts: H.districts().list.length};
    });
    check('a portal lit alone, a world built through it, and back home again',
          solo.atHome === solo.home && solo.built !== solo.home,
          JSON.stringify(solo));

    /* Now somebody joins him. */
    await S1.evaluate(c => window.__henrycraft.mp.start(c), cS);
    await waitFor(S1, () => window.__henrycraft.mp.status() === 'sharing');
    const adopted = await waitFor(S1, () =>
      window.__henrycraft.portals().some(q => q.lit && q.code), null, 25000);
    check('his portal is offered to the room as soon as anybody can join him',
          adopted, JSON.stringify(await S1.evaluate(() => window.__henrycraft.portals())));
    await S2.evaluate(c => window.__henrycraft.mp.join(c), cS);
    await waitFor(S2, () => window.__henrycraft.mp.status() === 'sharing');
    const sharedPortal = await waitFor(S2, () =>
      window.__henrycraft.portals().some(q => q.lit && q.code), null, 25000);
    check('and the other player sees it standing there, lit',
          sharedPortal, JSON.stringify(await S2.evaluate(() => window.__henrycraft.portals())));

    /* Both walk through. The world on the far side is his - the diamond has to be
       there when the other player arrives. */
    const walk = p => p.evaluate(() => {
      const H = window.__henrycraft;
      const q = H.portals().filter(x => x.lit && x.code && !x.isReturn)[0];
      return q ? H.travel(q.id) : false;
    });
    await walk(S1);
    await sleep(1500);
    await walk(S2);
    await sleep(2500);
    const inHis = await Promise.all([S1, S2].map(p => p.evaluate(t => {
      const H = window.__henrycraft, d = H.districts();
      return {code: d.code, slug: d.current, others: H.mp.players().length,
              tower: [0, 1, 2, 3].map(i => H.getBlock(t.x, t.y + i, t.z)),
              status: H.mp.status()};
    }, solo.tower)));
    /* Naming the district explicitly, not just checking that the two of them agree:
       if neither of them travelled at all they would agree perfectly, standing side
       by side at home, and this check would pass having proved nothing. */
    check('they both end up in the world he built alone, together',
          inHis[0].slug === solo.built && inHis[0].code &&
          inHis[0].code === inHis[1].code &&
          inHis[0].others === 1 && inHis[1].others === 1,
          JSON.stringify({wanted: solo.built,
                          got: inHis.map(x => ({slug: x.slug, code: x.code,
                                                others: x.others}))}));
    check('and what he built there is still standing, on both screens',
          inHis.every(x => x.tower.every(b => b === solo.tower.id)),
          JSON.stringify(inHis.map(x => x.tower)));
    note(`a world built alone (${inHis[0].slug}) became room ${inHis[0].code}, ` +
         `with his diamond tower intact on both screens`);

    /* ---- three things from an evening of real play -------------------------- */
    console.log('\nRejoining, waking up, and codes short enough to read out');
    for (const label of ['S1', 'S2']) {
      const pg = pages.find(p => p.label === label);
      if (pg) { await pg.ctx.close(); pages.splice(pages.indexOf(pg), 1); }
    }
    const R = await newPlayer('R');

    /* His picker had six districts called "Little Spring Mine (mine)". Once a shared
       district has been adopted, the room's blocks live in the local save - so every
       rejoin looked like a client turning up with a world of its own to protect, and
       protecting it meant duplicating it. Rejoining your own room must not do that. */
    const rc2 = code();
    const rejoin = await R.evaluate(async c => {
      const H = window.__henrycraft;
      H.setBlock(30, H.surfaceY(30, 30) + 1, 30, H.ids.BRICK);
      const before = H.districts().list.length;
      const counts = [];
      for (let i = 0; i < 4; i++) {
        H.mp.start(c);
        const until = Date.now() + 20000;
        while (H.mp.status() !== 'sharing' && Date.now() < until) {
          await new Promise(r => setTimeout(r, 100));
        }
        counts.push({n: H.districts().list.length, reunion: H.mp.reunion(),
                     status: H.mp.status()});
        H.mp.stop();
        await new Promise(r => setTimeout(r, 250));
      }
      return {before, counts, after: H.districts().list.length,
              names: H.districts().list.map(d => d.name)};
    }, rc2);
    check('sharing the same district four times over does not clone it four times',
          rejoin.after === rejoin.before,
          JSON.stringify({before: rejoin.before, after: rejoin.after,
                          names: rejoin.names}));
    check('and after the first time it knows it is coming back to its own room',
          rejoin.counts.slice(1).every(c => c.reunion === true) &&
          rejoin.counts.every(c => c.status === 'sharing'),
          JSON.stringify(rejoin.counts));
    check('so nothing called "(mine)" is ever created',
          !rejoin.names.some(n => /\(mine\)/.test(n)), JSON.stringify(rejoin.names));
    note(`four shares of one district: ${rejoin.before} district before, ` +
         `${rejoin.after} after`);

    /* "A person gets kicked out very easy, like if they put their phone down." A
       sleeping phone does not run timers, so the patient exponential retry was still
       sitting on its wait when he picked it up. Waking must throw that away. */
    const woke = await R.evaluate(async c => {
      const H = window.__henrycraft;
      H.mp.start(c);
      const until = Date.now() + 20000;
      while (H.mp.status() !== 'sharing' && Date.now() < until) {
        await new Promise(r => setTimeout(r, 100));
      }
      const on = H.mp.status();
      H.mp.drop();                                  /* the phone goes on the table */
      /* Wait for the drop to actually land rather than assuming a fixed number of
         milliseconds is enough. It is not: on the first run of this test the socket
         had not finished closing, so there was no retry to observe and the check
         after it passed having tested nothing. */
      const t0 = Date.now();
      const seen = Date.now() + 25000;
      const trace = [];
      while (!H.mp.retryPending() && Date.now() < seen) {
        trace.push(H.mp.status() + '/' + H.mp.sockState() + (H.mp.retryPending() ? '+t' : ''));
        await new Promise(r => setTimeout(r, 50));
      }
      const asleep = {status: H.mp.status(), pending: H.mp.retryPending(),
                      noticedAfterMs: Date.now() - t0,
                      trace: trace.slice(0, 4).join(' ')};
      /* Picked up again: the real event a browser fires. */
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise(r => setTimeout(r, 100));
      const poked = {pending: H.mp.retryPending(), status: H.mp.status(),
                     wasPending: asleep.pending};
      const back = Date.now() + 15000;
      while (H.mp.status() !== 'sharing' && Date.now() < back) {
        await new Promise(r => setTimeout(r, 100));
      }
      return {on, asleep, poked, ended: H.mp.status(), ms: Date.now()};
    }, rc2);
    check('a dropped connection leaves a patient retry waiting',
          woke.on === 'sharing' && woke.asleep.pending === true,
          JSON.stringify(woke));
    /* The number matters, not just that it eventually happens. Before the server was
       fixed to complete the closing handshake, this took 10,043ms - ten seconds in
       which the game believed it was still playing together and nothing arrived.
       Three seconds is a generous ceiling for a loaded CI runner; the real figure is
       the poll interval. */
    check(`and the drop is noticed at once, not eventually ` +
          `(${woke.asleep.noticedAfterMs}ms)`,
          woke.asleep.noticedAfterMs < 3000,
          `took ${woke.asleep.noticedAfterMs}ms; the server may not be completing ` +
          `the close handshake`);
    /* wasPending is in the condition on purpose: without it this passes when there
       was never a wait to throw away. */
    check('and picking the phone back up throws the wait away instead of sitting on it',
          woke.poked.wasPending === true && woke.poked.pending === false,
          JSON.stringify(woke.poked));
    check('so it is playing together again, not kicked out',
          woke.ended === 'sharing', JSON.stringify(woke));
    note(`a dropped socket was noticed after ${woke.asleep.noticedAfterMs}ms; ` +
         `waking cleared the wait (${woke.asleep.pending} -> ${woke.poked.pending}) ` +
         `and it is ${woke.ended}`);

    /* One world, one name.

       He and his son ended up in the same district calling it two different things -
       Sunny Creek on one screen, Quiet Glen on the other - because whoever joins by
       code never learned what the place was called. The name travels now, and only a
       name the game itself could have generated is ever accepted, so nothing anybody
       typed can cross. */
    const nc = code();
    const N1 = await newPlayer('N1');
    const N2 = await newPlayer('N2');
    const sharerSays = await N1.evaluate(async c => {
      const H = window.__henrycraft;
      /* A district with a name the game generated. The very first district is called
         "Home", which is not two words from the word lists - so nothing travels for
         it, and the joiner keeps its own name. That is deliberate: nearly everybody
         has a "Home" already, so adopting the name would land as "Home 2" and be more
         confusing than a different name. */
      await H.createDistrict('Bright Valley', 'meadow');
      H.mp.start(c);
      const until = Date.now() + 20000;
      while (H.mp.status() !== 'sharing' && Date.now() < until) {
        await new Promise(r => setTimeout(r, 100));
      }
      return {name: H.districts().list.filter(d => d.slug === H.districts().current)[0].name,
              generated: H.isGeneratedName(H.districts().list
                .filter(d => d.slug === H.districts().current)[0].name)};
    }, nc);
    await N2.evaluate(c => window.__henrycraft.mp.join(c), nc);
    await waitFor(N2, () => window.__henrycraft.mp.status() === 'sharing');
    const agreed = await waitFor(N2, n => {
      const d = window.__henrycraft.districts();
      const here = d.list.filter(x => x.slug === d.current)[0];
      return !!here && here.name === n;
    }, sharerSays.name, 15000);
    const theirName = await N2.evaluate(() => {
      const d = window.__henrycraft.districts();
      return (d.list.filter(x => x.slug === d.current)[0] || {}).name;
    });
    check('the world he shared has a name the game generated',
          sharerSays.generated === true, JSON.stringify(sharerSays));
    check('and whoever joins by code calls the place the same thing',
          agreed && theirName === sharerSays.name,
          `sharer says "${sharerSays.name}", joiner says "${theirName}"`);
    /* The same room is not the same world unless the ground is the same shape. A
       joiner that resyncs instead of adopting keeps its own randomly seeded terrain
       and merely has the other player's blocks painted on top - same code, same
       roster, different hills. That is what a forged "we have been here before"
       signal did, and it only showed up as an intermittent failure elsewhere. */
    const seeds = await Promise.all([N1, N2].map(p => p.evaluate(() =>
      ({seed: window.__henrycraft.districts().seed,
        theme: window.__henrycraft.districts().theme,
        why: window.__henrycraft.mp.dupReason()}))));
    check('and stands on the same ground, not just in the same room',
          seeds[0].seed === seeds[1].seed && seeds[0].theme === seeds[1].theme,
          JSON.stringify(seeds));
    note(`joiner adopted the world itself: seed ${seeds[1].seed} on both`);
    /* The safety half: a name typed over by hand must not travel, because a name that
       travels is a name another player reads. */
    const typed = await N1.evaluate(() => {
      const H = window.__henrycraft;
      return {ok: H.isGeneratedName('Sunny Creek'),
              typed: H.isGeneratedName('call me at 555 1234'),
              markup: H.isGeneratedName('<img src=x onerror=alert(1)>'),
              sneaky: H.isGeneratedName('Sunny Creek '),
              words: H.isGeneratedName('Zzzz Qqqq')};
    });
    check('a name that is not two words from the game\'s own lists is refused',
          typed.ok === true && typed.typed === false && typed.markup === false &&
          typed.sneaky === false && typed.words === false,
          JSON.stringify(typed));
    note(`one world, one name: both call it "${sharerSays.name}"`);
    for (const label of ['N1', 'N2']) {
      const pg = pages.find(p => p.label === label);
      if (pg) { await pg.ctx.close(); pages.splice(pages.indexOf(pg), 1); }
    }

    /* Breaking the way home, and mending it, while playing together.

       This is what ended their evening: he broke a block out of the return portal in a
       district they had travelled to and could not get back. Lighting it again has to
       lead to the same room, not to a new place - and the room has to agree, or the two
       of them are back to walking into different worlds. */
    console.log('\nMending a broken way home while playing together');
    const mc = code();
    const M1 = await newPlayer('M1');
    const mend = await M1.evaluate(async c => {
      const H = window.__henrycraft, ids = H.ids;
      H.loadThemeSeed('meadow', 616);
      const gy = H.surfaceY(30, 30);
      for (let y = gy; y < gy + 10; y++) for (let x = 24; x <= 36; x++) {
        for (let d = -4; d <= 4; d++) H.setBlock(x, y, 30 + d, ids.AIR);
      }
      const b = H.buildFrame({plane: 'x', w: 2, h: 3, ax: 29, ay: gy, fixed: 30,
                              fill: ids.SAND});
      for (let x = 24; x <= 36; x++) for (let d = -4; d <= 4; d++) {
        if (H.getBlock(x, gy - 1, 30 + d) === ids.AIR) H.setBlock(x, gy - 1, 30 + d, ids.STONE);
      }
      H.mp.start(c);
      let until = Date.now() + 25000;
      while (H.mp.status() !== 'sharing' && Date.now() < until) {
        await new Promise(r => setTimeout(r, 100));
      }
      H.tryLight(b.probe.x, b.probe.y, b.probe.z);
      until = Date.now() + 20000;
      while (!H.portals().some(q => q.lit) && Date.now() < until) {
        await new Promise(r => setTimeout(r, 100));
      }
      const out = H.portals().filter(q => q.lit)[0];
      if (!out) return {error: 'the portal never lit'};
      const wanted = out.code;
      await H.travel(out.id);
      until = Date.now() + 25000;
      while (H.mp.code() !== wanted && Date.now() < until) {
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 1500));
      const home = H.portals().filter(q => q.lit && q.isReturn)[0];
      if (!home) return {error: 'no way home was built'};
      const homeCode = home.code;
      H.breakBlock(home.a0, home.y0 - 1, home.fixed);
      const stranded = H.portals().filter(q => q.lit).length;
      H.setBlock(home.a0, home.y0 - 1, home.fixed, ids.OBSIDIAN);
      H.tryLight(home.a0, home.y0 - 1, home.fixed);
      until = Date.now() + 20000;
      while (!H.portals().some(q => q.lit && q.isReturn) && Date.now() < until) {
        await new Promise(r => setTimeout(r, 100));
      }
      const again = H.portals().filter(q => q.lit && q.isReturn)[0] || null;
      const districts = H.districts().list.length;
      const went = again ? await H.travel(again.id) : false;
      until = Date.now() + 25000;
      while (H.mp.code() !== homeCode && Date.now() < until) {
        await new Promise(r => setTimeout(r, 100));
      }
      return {wanted, homeCode, stranded, relitCode: again && again.code,
              went, districts, endedAt: H.mp.code(), endedIn: H.districts().code};
    }, mc);
    check('breaking the way home puts it out, as it should',
          mend.stranded === 0, JSON.stringify(mend));
    check('mending it and striking the obsidian lights it again, bound to the same room',
          !!mend.relitCode && mend.relitCode === mend.homeCode, JSON.stringify(mend));
    check('and it takes him home, to the room the others are in',
          mend.went === true && mend.endedAt === mend.homeCode &&
          mend.endedIn === mend.homeCode, JSON.stringify(mend));
    note(`a way home broken and mended still leads to ${mend.homeCode}`);
    {
      const pg = pages.find(p => p.label === 'M1');
      if (pg) { await pg.ctx.close(); pages.splice(pages.indexOf(pg), 1); }
    }

    /* A portal that still looks like a portal after coming back.

       The frame's filling is an ordinary block and is shared; the portal that replaces
       it is not, because each device fills its own opening in from the record. So the
       room still holds sand, or grass, or a rainbow for those cells - and replaying them
       on arrival painted the inside of the doorway back to blocks. The portal kept
       working, which is how it went unnoticed: it simply stopped looking like one. */
    console.log('\nA lit portal keeps looking like a portal');
    const kc = code();
    const K1 = await newPlayer('K1');
    const stillPortal = await K1.evaluate(async c => {
      const H = window.__henrycraft, ids = H.ids;
      H.loadThemeSeed('meadow', 313);
      const gy = H.surfaceY(30, 30);
      for (let y = gy; y < gy + 10; y++) for (let x = 24; x <= 36; x++) {
        for (let d = -4; d <= 4; d++) H.setBlock(x, y, 30 + d, ids.AIR);
      }
      /* Filled with the rainbow block, which is what he actually used. */
      const b = H.buildFrame({plane: 'x', w: 2, h: 3, ax: 29, ay: gy, fixed: 30,
                              fill: ids.RAINBOW});
      const inside = [];
      for (let x = 29; x <= 30; x++) for (let y = gy; y < gy + 3; y++) inside.push([x, y, 30]);
      H.mp.start(c);
      const until = Date.now() + 25000;
      while (H.mp.status() !== 'sharing' && Date.now() < until) {
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 800));
      H.tryLight(b.probe.x, b.probe.y, b.probe.z);
      const lit = Date.now() + 15000;
      while (!H.portals().some(q => q.lit) && Date.now() < lit) {
        await new Promise(r => setTimeout(r, 100));
      }
      const before = inside.map(c2 => H.getBlock(c2[0], c2[1], c2[2]));
      /* Exactly what arriving back replays: the room's memory of those cells. */
      inside.forEach(c2 => H.mp.feed({type: 'edited', x: c2[0], y: c2[1], z: c2[2],
                                      block: ids.RAINBOW, by: 'someone'}));
      await new Promise(r => setTimeout(r, 300));
      const after = inside.map(c2 => H.getBlock(c2[0], c2[1], c2[2]));
      /* And once it is put out, those cells are ordinary blocks again. */
      /* Put it out the way he does: break a block out of the frame. */
      H.breakBlock(29, gy - 1, 30);
      inside.forEach(c2 => H.mp.feed({type: 'edited', x: c2[0], y: c2[1], z: c2[2],
                                      block: ids.RAINBOW, by: 'someone'}));
      await new Promise(r => setTimeout(r, 300));
      const afterOut = inside.map(c2 => H.getBlock(c2[0], c2[1], c2[2]));
      return {portal: ids.PORTAL, rainbow: ids.RAINBOW, before, after, afterOut};
    }, kc);
    check('lighting it fills the doorway with portal',
          stillPortal.before.every(b => b === stillPortal.portal), JSON.stringify(stillPortal.before));
    check('and the room replaying what the frame was filled with does not paint over it',
          stillPortal.after.every(b => b === stillPortal.portal), JSON.stringify(stillPortal.after));
    check('but once the portal is out, those blocks are ordinary again',
          stillPortal.afterOut.every(b => b === stillPortal.rainbow), JSON.stringify(stillPortal.afterOut));
    note('a lit portal is not repainted by the room; an unlit frame is');
    {
      const pg = pages.find(p => p.label === 'K1');
      if (pg) { await pg.ctx.close(); pages.splice(pages.indexOf(pg), 1); }
    }

    /* A world with real building in it can be shared at all.

       The join used to carry the entire edit map, and the server drops any message over
       4096 bytes - about 280 blocks. So a district a child had actually built in
       produced a join that was silently thrown away: no welcome, no error, "Connecting"
       for ever. Every test in this file used a handful of blocks, which is why none of
       them caught it - and why starting a fresh world appeared to fix it. */
    console.log('\nA world with a lot built in it');
    const bgc = code();
    const B1 = await newPlayer('B1');
    const B2 = await newPlayer('B2');
    const big = await B1.evaluate(async c => {
      const H = window.__henrycraft, ids = H.ids;
      H.loadThemeSeed('meadow', 777);
      /* Six hundred blocks: an evening's building, and comfortably past the point where
         a join carrying them all is refused. */
      let n = 0;
      const where = [];
      for (let x = 10; x < 40; x++) {
        for (let z = 10; z < 30; z++) {
          const y = H.surfaceY(x, z) + 1;
          H.setBlock(x, y, z, ids.PLANKS);
          /* The exact cells, remembered. Reading surfaceY again on the other side
             returns the top of the block that has just arrived, so recomputing the
             coordinate looks at the air above it - a mistake I have now made twice in
             this file. */
          if (where.length < 40) where.push([x, y, z]);
          n++;
        }
      }
      const wouldHaveBeen = JSON.stringify({type: 'join', playerName: 'Blue Fox',
        colour: '#2f7fd6', offer: {seed: 1, starSeed: 1, theme: 'meadow',
        edits: H.editMap()}}).length;
      H.mp.start(c);
      const until = Date.now() + 30000;
      while (H.mp.status() !== 'sharing' && Date.now() < until) {
        await new Promise(r => setTimeout(r, 100));
      }
      return {n, where, wouldHaveBeen, status: H.mp.status(), line: H.mp.statusLine()};
    }, bgc);
    check(`a district with ${big.n} blocks in it can be shared at all`,
          big.status === 'sharing',
          `status ${big.status} - "${big.line}"; an all-in-one join would have been ` +
          `${big.wouldHaveBeen} bytes against a 4096 byte limit`);
    await B2.evaluate(c => window.__henrycraft.mp.join(c), bgc);
    await waitFor(B2, () => window.__henrycraft.mp.status() === 'sharing');
    const arrivedBlocks = await waitFor(B2, w => {
      const H = window.__henrycraft;
      return w.every(c => H.getBlock(c[0], c[1], c[2]) === H.ids.PLANKS);
    }, big.where, 120000);
    check(`and everything he built arrives at the other player ` +
          `(${big.where.length} cells checked)`, arrivedBlocks,
          'the building had not arrived within two minutes');
    note(`${big.n} blocks shared; an all-in-one join would have been ` +
         `${big.wouldHaveBeen} bytes against a 4096 byte limit`);
    for (const label of ['B1', 'B2']) {
      const pg = pages.find(p => p.label === label);
      if (pg) { await pg.ctx.close(); pages.splice(pages.indexOf(pg), 1); }
    }

    /* Racing a circuit together, which is what he wants a racing district for.

       A racing district is 128 blocks across where every other kind is 64, and the size
       comes from the theme rather than the save. So two devices on the same build agree
       without a word being said about it - but only if the theme really does travel, and
       only if the room's blocks can land in a world of that size. Both are worth a test:
       a circuit is the one district where the two of them will be in the same place at
       once on purpose. */
    console.log('\nRacing the same circuit together');
    const racecode = code();
    const R1 = await newPlayer('R1');
    const R2 = await newPlayer('R2');
    const raceHost = await R1.evaluate(async c => {
      const H = window.__henrycraft;
      H.loadThemeSeed('racing', 24680);
      /* Something built out past where the old 64-block world ended, so the check below
         is about the bigger world and not just about sharing. */
      const far = [[100, H.surfaceY(100, 100) + 1, 100], [110, H.surfaceY(110, 96) + 1, 96]];
      far.forEach(c2 => H.setBlock(c2[0], c2[1], c2[2], H.ids.DIAMOND));
      H.mp.start(c);
      const until = Date.now() + 30000;
      while (H.mp.status() !== 'sharing' && Date.now() < until) {
        await new Promise(r => setTimeout(r, 100));
      }
      const t = H.track();
      return {status: H.mp.status(), dims: H.dims(), far,
              lap: H.lapLength(), start: t && t.start, pushes: t && t.pushes};
    }, racecode);
    check('a racing district can be shared', raceHost.status === 'sharing',
          JSON.stringify(raceHost));
    await R2.evaluate(c => window.__henrycraft.mp.join(c), racecode);
    await waitFor(R2, () => window.__henrycraft.mp.status() === 'sharing');
    /* waitFor answers yes or no, so the numbers are read afterwards rather than returned
       from inside it - a mistake that cost a run: `true.dims` is not a helpful error. */
    const joinerArrived = await waitFor(R2, w => {
      const H = window.__henrycraft;
      if (!H.track()) return false;
      return w.far.every(c2 => H.getBlock(c2[0], c2[1], c2[2]) === H.ids.DIAMOND);
    }, raceHost, 120000);
    const raceJoiner = await R2.evaluate(() => {
      const H = window.__henrycraft, t = H.track();
      return {dims: H.dims(), lap: H.lapLength(), start: t && t.start,
              pushes: t && t.pushes,
              outside: H.mp.outside(), staleWho: H.mp.staleWho()};
    });
    check('and the other player gets the same circuit, 128 blocks and all',
          joinerArrived && raceJoiner.dims.WX === 128 &&
          raceJoiner.lap === raceHost.lap && raceJoiner.pushes === raceHost.pushes &&
          JSON.stringify(raceJoiner.start) === JSON.stringify(raceHost.start),
          JSON.stringify({host: raceHost, joiner: raceJoiner}));
    /* Blocks from out past 64 arrived and landed, so nothing was quietly dropped. */
    check('with nothing dropped for falling outside a smaller world',
          joinerArrived && raceJoiner.outside === 0 && raceJoiner.staleWho === null,
          JSON.stringify(raceJoiner));
    note(`both drove the same ${raceHost.lap}-block circuit in a ` +
         `${raceHost.dims.WX}-block district, start line at ` +
         `${raceHost.start.x.toFixed(0)},${raceHost.start.z.toFixed(0)}`);

    /* The standings, which is what he asked for: who is in front.

       Position alone cannot answer it - it cannot tell the leader from somebody a whole lap
       behind - so the lap number and how far through it travel with the move message and the
       Worker relays them. An older Worker drops them, and then the game says it does not
       know rather than guessing: being shown 1st while losing is exactly the kind of
       unfairness this game does not do. */
    console.log('\nWho is in front');
    /* R1 goes round a whole lap; R2 barely moves. */
    const led = await R1.evaluate(async () => {
      const H = window.__henrycraft;
      if (!H.kart()) H.toggleKart();
      H.clearKartMotion();
      let n = 0;
      for (let i = 0; i < 200 && H.laps() < 1; i++) {
        H.drive(1, () => H.autoSteer(), () => H.autoThrottle());
        n++;
      }
      /* Let the animation loop send the new position - drive() advances physics without it. */
      await new Promise(r => setTimeout(r, 1200));
      return {laps: H.laps(), prog: H.lapProgress(), seconds: n,
              standings: H.standings(), place: H.placeShown()};
    });
    await new Promise(r => setTimeout(r, 1200));
    const trailed = await R2.evaluate(async () => {
      const H = window.__henrycraft;
      if (!H.kart()) H.toggleKart();
      await new Promise(r => setTimeout(r, 600));
      /* Tap the "who is here" chip, which is how he opens it. The roster is only rebuilt
         while the panel is on screen - reading the DOM without opening it reads whatever was
         painted when somebody last joined, which is before anybody has driven anywhere. */
      document.getElementById('peopleChip').click();
      await new Promise(r => setTimeout(r, 900));
      return {laps: H.laps(), standings: H.standings(), place: H.placeShown(),
              roster: [].slice.call(document.querySelectorAll('#roster .rosterRow'))
                        .map(r => r.textContent)};
    });
    check(`the leader completed a lap and knows he is in front`,
          led.laps >= 1 && !!led.standings && led.standings.length === 2 &&
          led.standings[0].me === true && led.place.hidden === false &&
          led.place.text === '1st of 2', JSON.stringify(led));
    /* And the other device agrees, which is the part that needs the lap number to travel. */
    check('and the other player is told he is second, on the same reckoning',
          !!trailed.standings && trailed.standings.length === 2 &&
          trailed.standings[0].me === false &&
          trailed.place.hidden === false && trailed.place.text === '2nd of 2',
          JSON.stringify(trailed));
    check('a whole lap ahead counts as ahead, not as being round the next corner',
          !!trailed.standings &&
          trailed.standings[0].lap > trailed.standings[1].lap,
          JSON.stringify(trailed.standings));
    /* The panel is a scoreboard while a race is on: medals, and the lap each of them is on. */
    check('and the Playing-together panel lists them in order with their laps',
          trailed.roster.length === 2 &&
          /lap \d+/.test(trailed.roster[0]) && /lap \d+/.test(trailed.roster[1]),
          JSON.stringify(trailed.roster));
    note(`the leader drove ${led.laps} lap in ${led.seconds}s and both devices agree: ` +
         `"${led.place.text}" and "${trailed.place.text}"; panel reads ` +
         `${JSON.stringify(trailed.roster)}`);

    /* And where there is nothing to rank, nothing is shown. A one-player race has no
       standing worth printing, and neither does a meadow. */
    const nothingToRank = await R2.evaluate(() => {
      const H = window.__henrycraft;
      H.loadThemeSeed('meadow', 5);
      const off = {standings: H.standings(), place: H.placeShown()};
      /* Back to the circuit before anything downstream looks at it. Leaving him in a meadow
         made the item checks below compare nought against nought and pass without meaning
         anything - a meadow has no boxes to be untouched. */
      H.loadThemeSeed('racing', 24680);
      return {off, boxesBack: H.itemBoxes().length};
    });
    check('off a circuit there is no ranking and no chip',
          nothingToRank.off.standings === null &&
          nothingToRank.off.place.hidden === true, JSON.stringify(nothingToRank));

    /* Items, and the thing that matters about them: one player collecting every box on the
       circuit cannot touch the other one.

       The genre this borrows from is built on hitting whoever is in front. This game's brief
       is the opposite - remote players cannot damage, push, trap or otherwise affect each
       other - so every item works on the kart that collected it and on nothing else, and the
       catch-up mechanic pays out in the trailing driver's favour instead of punishing the
       leader. This is the check that says so rather than the comment. */
    const beforeItems = await R2.evaluate(() => {
      const H = window.__henrycraft;
      const p = H.player();
      return {at: {x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2)},
              kart: H.kart(), laps: H.laps(), stars: H.starsFound(),
              boxes: H.itemBoxes().length, taken: H.itemsTaken(),
              blocks: Object.keys(H.editMap()).length};
    });
    const raider = await R1.evaluate(() => {
      const H = window.__henrycraft;
      if (!H.kart()) H.toggleKart();
      /* Round the circuit twice, hoovering up every box on it. */
      H.drive(100, () => H.autoSteer(), () => H.autoThrottle());
      return {taken: H.itemsTaken(), boost: H.kartState().boost,
              laps: H.laps()};
    });
    await new Promise(r => setTimeout(r, 900));
    const afterItems = await R2.evaluate(() => {
      const H = window.__henrycraft;
      const p = H.player();
      return {at: {x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2)},
              kart: H.kart(), laps: H.laps(), stars: H.starsFound(),
              boxes: H.itemBoxes().length, taken: H.itemsTaken(),
              blocks: Object.keys(H.editMap()).length,
              state: H.kartState()};
    });
    check(`one player collected ${raider.taken} boxes`, raider.taken >= 4,
          JSON.stringify(raider));
    /* Not moved, not slowed, not sped up, nothing taken, nothing built or broken. */
    check('and none of it reached the other player at all',
          JSON.stringify(afterItems.at) === JSON.stringify(beforeItems.at) &&
          afterItems.laps === beforeItems.laps &&
          afterItems.stars === beforeItems.stars &&
          afterItems.blocks === beforeItems.blocks &&
          afterItems.state.boost === 0 && afterItems.state.star === 0 &&
          afterItems.state.drift === 0,
          JSON.stringify({before: beforeItems, after: afterItems}));
    /* His own boxes are his own: they do not disappear because somebody else drove through
       them, so a five-year-old cannot have one taken off him. */
    /* And there have to BE some, or this passes by comparing nought with nought. */
    check('and his own boxes are all still there to be collected',
          beforeItems.boxes >= 4 &&
          afterItems.boxes === beforeItems.boxes && afterItems.taken === 0,
          JSON.stringify({before: beforeItems, after: afterItems}));
    note(`${raider.taken} boxes collected by one player; the other was not moved, slowed, ` +
         `sped up or emptied, and still had all ${afterItems.boxes} of his own`);

    /* And the failure this guards against: a room whose world is bigger than the one this
       device can build, which is what an older game on the tablet would look like. The
       blocks arrive with coordinates it has no room for. Dropping them silently is how
       "I could see him but he could not see me" happens, so it has to say so. */
    const mismatch = await R2.evaluate(() => {
      const H = window.__henrycraft;
      const before = {outside: H.mp.outside(), staleWho: H.mp.staleWho()};
      /* A block from the far corner of a world twice as wide again as this one. */
      H.mp.feedEdit(200, 14, 200, H.ids.PLANKS);
      const after = {outside: H.mp.outside(), staleWho: H.mp.staleWho(),
                     line: H.mp.statusLine()};
      return {before, after};
    });
    check('a block from outside this world is noticed rather than dropped in silence',
          mismatch.after.outside === 1 && mismatch.after.staleWho === 'world',
          JSON.stringify(mismatch));
    check('and it says on the panel that this game is the old one, not the other one',
          /this game is out of date/i.test(mismatch.after.line) &&
          /reload this page/i.test(mismatch.after.line), JSON.stringify(mismatch));
    note(`a block from beyond the world reads as: "${mismatch.after.line}"`);
    /* And it must not latch: switching off and on again starts clean, which is the
       mistake the first version of the stale banner made. */
    const raceCleared = await R2.evaluate(async () => {
      const H = window.__henrycraft;
      H.mp.stop();
      await new Promise(r => setTimeout(r, 200));
      return {outside: H.mp.outside(), staleWho: H.mp.staleWho()};
    });
    check('and going back to playing alone clears it rather than latching it',
          raceCleared.outside === 0 && raceCleared.staleWho === null,
          JSON.stringify(raceCleared));
    for (const label of ['R1', 'R2']) {
      const pg = pages.find(p => p.label === label);
      if (pg) { await pg.ctx.close(); pages.splice(pages.indexOf(pg), 1); }
    }

    /* His son could not go through his own portals: "Could not open that place - try
       again", standing right in the doorway.

       The destination's record knew its join code; the index did not. The index is what
       travel searches, so the portal pointed at a place the game could not find - and
       the local slug that would have saved it had been thrown away the moment the room
       confirmed the portal. Reproduced here exactly, by taking the code out of the
       index and leaving it in the record. */
    console.log('\nA portal whose destination the index has lost track of');
    const pc = code();
    const P1 = await newPlayer('P1');
    const lost = await P1.evaluate(async c => {
      const H = window.__henrycraft, ids = H.ids;
      H.loadThemeSeed('meadow', 515);
      const gy = H.surfaceY(30, 30);
      for (let y = gy; y < gy + 10; y++) for (let x = 24; x <= 36; x++) {
        for (let d = -4; d <= 4; d++) H.setBlock(x, y, 30 + d, ids.AIR);
      }
      const b = H.buildFrame({plane: 'x', w: 2, h: 3, ax: 29, ay: gy, fixed: 30,
                              fill: ids.SAND});
      for (let x = 24; x <= 36; x++) for (let d = -4; d <= 4; d++) {
        if (H.getBlock(x, gy - 1, 30 + d) === ids.AIR) H.setBlock(x, gy - 1, 30 + d, ids.STONE);
      }
      const lit = await H.light(b.probe.x, b.probe.y, b.probe.z);
      /* Give the destination a code the way an earlier session would have, then take it
         out of the index - which is the state his tablet was in. */
      await H.travel(lit.id);
      const dest = H.districts().current;
      const back = H.portals().filter(q => q.lit && q.isReturn)[0];
      await H.travel(back.id);
      H.mp.start(c);
      const until = Date.now() + 20000;
      while (H.mp.status() !== 'sharing' && Date.now() < until) {
        await new Promise(r => setTimeout(r, 100));
      }
      /* Sharing adopts the portal and stamps a code on the destination. Now lose it. */
      await new Promise(r => setTimeout(r, 1500));
      await H.loseIndexCode(dest);
      const p = H.portals().filter(q => q.lit && !q.isReturn)[0];
      const before = H.districts().list.length;
      const went = await H.travel(p.id);
      const d = H.districts();
      return {dest, went, landed: d.current, before, after: d.list.length,
              hasCode: !!p.code, keptSlug: p.dest || null,
              code: d.code};
    }, pc);
    check('the portal was shared and knows its room', lost.hasCode === true,
          JSON.stringify(lost));
    check('and it still remembers where it goes locally, as a fallback',
          lost.keptSlug !== null, JSON.stringify(lost));
    check('so he goes through it even when the index has lost the code',
          lost.went === true && lost.landed === lost.dest, JSON.stringify(lost));
    check('and no second copy of that world is made on the way',
          lost.after === lost.before,
          `${lost.before} districts before, ${lost.after} after`);
    note(`index lost the code for ${lost.dest}: travelled anyway, ` +
         `${lost.after} districts (was ${lost.before})`);
    {
      const pg = pages.find(p => p.label === 'P1');
      if (pg) { await pg.ctx.close(); pages.splice(pages.indexOf(pg), 1); }
    }

    /* A wake event landing while the socket is still shaking hands.

       This is the bug that stopped Henry's tablet connecting at all: "not open yet"
       was treated as "broken", and pageshow and focus both fire around a page
       settling down - so on the slower of two devices every attempt was destroyed a
       moment after it started, and it sat on "Still trying to reach the others" for
       ever. It never showed up on the PC, because the handshake there finished before
       any event landed.

       Fired three times in a row on purpose, which is what a tablet does. */
    /* A server that accepts the connection and then says nothing at all, so the
       socket stays in CONNECTING for as long as we like. Locally a real handshake
       finishes in under ten milliseconds, which is why sampling for readyState 0
       never caught it and the first version of this check passed having tested
       nothing. */
    const slow = net.createServer(sock => { sock.on('error', () => {}); });
    await new Promise(r => slow.listen(0, '127.0.0.1', r));
    const slowPort = slow.address().port;
    const SL = await newPlayer('slow', null,
      `http://127.0.0.1:${port}/index.html?sync=127.0.0.1:${slowPort}`);
    const midShake = await SL.evaluate(async c => {
      const H = window.__henrycraft;
      H.mp.start(c);
      /* The socket is not made synchronously - mpStart waits on the stored identity
         first - so firing once immediately tests nothing (readyState -1: no socket).
         Fire repeatedly across the whole window instead, and record whether a
         CONNECTING socket was ever actually caught in the act. */
      /* Wait until the socket really is mid-handshake, which against this server it
         stays. Then fire what a tablet fires while a page settles down. */
      const wait = Date.now() + 8000;
      while (H.mp.sockState() !== 0 && Date.now() < wait) {
        await new Promise(r => setTimeout(r, 20));
      }
      const caught = H.mp.sockState() === 0;
      const before = H.mp.attempts();
      for (let i = 0; i < 40; i++) {
        window.dispatchEvent(new Event('pageshow'));
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise(r => setTimeout(r, 10));
      }
      return {caught, before, after: H.mp.attempts(),
              state: H.mp.sockState(), status: H.mp.status()};
    }, rc2);
    /* `caught` is in the condition deliberately: if the socket was never actually
       mid-handshake, this proves nothing and must not pass. */
    check('waking up while still connecting does not kill the attempt',
          midShake.caught === true && midShake.after === midShake.before &&
          midShake.state === 0,
          JSON.stringify(midShake));
    note(`120 wake events fired at a socket still shaking hands: ` +
         `${midShake.before} connection attempt before, ${midShake.after} after`);

    const slowPg = pages.find(p => p.label === 'slow');
    if (slowPg) { await slowPg.ctx.close(); pages.splice(pages.indexOf(slowPg), 1); }
    slow.close();

    /* "The code we have to use to sync up is way too long." His home district still
       carried little-spring-mine-K4TRUYSC6J from the first time it was ever shared.
       It gets a short one - and the old one keeps working, because portals are bound
       to codes now and shortening one must not orphan a way home. */
    const shortened = await R.evaluate(async lc => {
      const H = window.__henrycraft;
      H.mp.stop();
      H.mp.start(lc);                       /* as it was, long code and all */
      await new Promise(r => setTimeout(r, 400));
      const was = H.mp.code();
      H.mp.stop();
      await new Promise(r => setTimeout(r, 200));
      H.mp.start();                         /* shared again, no code given */
      await new Promise(r => setTimeout(r, 400));
      const now = H.mp.code();
      const d = H.districts();
      const me = d.list.filter(x => x.slug === d.current)[0] || {};
      H.mp.stop();
      return {was, now, aliases: me.codes, byOld: H.districtByCode(was),
              byNew: H.districtByCode(now), slug: d.current};
    }, codeLong('little-spring-mine'));
    check('a district still carrying a long code is given a short one',
          !/-/.test(shortened.now) && shortened.now.length === 6 &&
          /-/.test(shortened.was), JSON.stringify(shortened));
    check('and it still answers to the old one, so a portal bound to it is not orphaned',
          shortened.byOld === shortened.slug && shortened.byNew === shortened.slug &&
          (shortened.aliases || []).includes(shortened.was),
          JSON.stringify(shortened));
    note(`code shortened: ${shortened.was} -> ${shortened.now}, ` +
         `old one still finds ${shortened.byOld}`);

    /* ---- the state the game is actually in until the worker is deployed ----
       Pressing the button with nothing listening must not produce an error, a
       dialog, or a game that stops working. This is also the tunnel case, and the
       hotel-wifi case, and the case where a grandparent's link is stale. */
    /* Everything still open is a software-rendered voxel world competing for the
       same CPU, and the page below has to load from cold. Close the ones that are
       finished, or its load outruns the wait and the failure looks like a bug. */
    for (const label of ['B', 'link']) {
      const pg = pages.find(p => p.label === label);
      if (pg) { await pg.ctx.close(); pages.splice(pages.indexOf(pg), 1); }
    }

    console.log('\nUndeployed and unreachable: the button still cannot break anything');
    const dead = 8799;
    const D = await newPlayer('dead', null, `http://127.0.0.1:${port}/index.html?sync=127.0.0.1:${dead}`);
    await D.evaluate(() => {
      document.getElementById('btnMenu').click();
    });
    const menuShown = await D.evaluate(() =>
      !document.getElementById('menu').classList.contains('hide') &&
      document.getElementById('mTogether').textContent);
    await D.evaluate(() => document.getElementById('mTogether').click());
    await sleep(2500);
    const stranded = await D.evaluate(() => {
      const H = window.__henrycraft;
      const dialogOpen = ['serverCopy', 'joinPanel', 'win'].some(id => {
        const e = document.getElementById(id);
        return e && !e.classList.contains('hide');
      });
      const y = H.surfaceY(28, 28) + 1;
      H.setBlock(28, y, 28, H.ids.PLANKS);
      return {status: H.mp.status(), label: H.mp.toggleLabel(), line: H.mp.statusLine(),
              code: H.mp.code(), dialogOpen,
              built: H.getBlock(28, y, 28) === H.ids.PLANKS,
              togetherPanel: !document.getElementById('together').classList.contains('hide'),
              codeShown: document.getElementById('joinCode').textContent};
    });
    check('the pause menu offers the toggle, labelled for playing alone',
          /Playing alone/.test(menuShown || ''), JSON.stringify(menuShown));
    check(`one press opens the panel with a join code already generated ` +
          `("${stranded.codeShown}")`,
          stranded.togetherPanel && /^[A-Z0-9]{6}$/.test(stranded.codeShown),
          JSON.stringify({panel: stranded.togetherPanel, code: stranded.codeShown}));
    check('with nothing listening it keeps trying quietly and shows no error',
          stranded.status === 'reconnecting' && !stranded.dialogOpen,
          JSON.stringify(stranded));
    check('and the world still works while it cannot connect', stranded.built,
          JSON.stringify(stranded));
    note(`unreachable server reads as: "${stranded.line}"`);

    /* The marker that tells a deployed Worker apart from an older one. */
    check(`/health advertises what it can do ("${worker.health}")`,
          /look=1/.test(worker.health) && /characters=14/.test(worker.health),
          worker.health);

    check('no page errors in any client', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    for (const p of pages) { try { await p.ctx.close(); } catch (_) {} }
    try { await browser.close(); } catch (_) {}
    srv.close();
    try { worker.child.kill('SIGTERM'); } catch (_) {}
    await sleep(300);
    try { worker.child.kill('SIGKILL'); } catch (_) {}
    try { fs.rmSync(worker.persist, {recursive: true, force: true}); } catch (_) {}
  }

  console.log(`\npassed ${passed}, failed ${failed}`);
  console.log('\nReported numbers');
  notes.forEach(n => console.log('  - ' + n));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
