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

    await B.evaluate(() => window.__henrycraft.movePlayer(40, 22, 40));
    await sleep(400);
    const glide = await A.evaluate(async () => {
      const H = window.__henrycraft;
      const seen = [];
      for (let i = 0; i < 6; i++) {
        seen.push(H.mp.players()[0] ? H.mp.players()[0].x : null);
        await new Promise(r => requestAnimationFrame(r));
      }
      return seen;
    });
    const moved = glide.filter(v => v !== null);
    check('a remote player is interpolated rather than teleported',
          moved.length >= 2 && new Set(moved).size > 1,
          JSON.stringify(glide));

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
    await sleep(600);
    const dw = d.welcome();
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
    const inside = crowd.filter(c => c.welcome()).length;
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
    await sleep(600);
    const aw = audit.welcome() || {edits: {}};
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
              stale: H.mp.stale(), line: H.mp.statusLine()};
    });
    check('two players with no character number are not both drawn as Henry',
          old.them.length === 2 && old.them[0].look !== old.them[1].look &&
          old.them.every(p => p.label !== 'Henry'),
          JSON.stringify(old.them));
    check('and it says the server needs updating rather than saying nothing',
          old.stale === true && /needs updating/.test(old.line),
          JSON.stringify({stale: old.stale, line: old.line}));
    note(`an old server reads as: "${old.line}"`);

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
