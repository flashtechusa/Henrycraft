#!/usr/bin/env node
/*
 * The racing circuit.
 *
 *   node tools/test-racing.js
 *
 * A track is only a track if you can get round it. Screenshots prove a road exists;
 * they do not prove a corner can be taken at speed, that the road never runs into a
 * hillside, or that a lap counts when you have actually done one. So the important
 * checks here drive - the real input the stick fills in, through the real updatePlayer
 * that collides - and they do it over twenty seeds, because a generator that produces
 * one good circuit and nineteen bad ones is not a generator.
 *
 * The other thing being asserted, over and over, is that nothing here can hurt him.
 * No fail states: no way to be stuck, nothing that ends, nothing to lose, and driving
 * off the track is slower and nothing else.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SEEDS = 20;

function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_PATH, 'playwright',
                   '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(c); } catch (_) {}
  }
  console.error('Could not load Playwright. Install it, or set PLAYWRIGHT_PATH.');
  process.exit(2);
}

const TYPES = {'.html': 'text/html', '.png': 'image/png',
               '.webmanifest': 'application/manifest+json'};
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

(async () => {
  const {chromium} = loadPlaywright();
  const {srv, port} = await serve();
  const url = `http://127.0.0.1:${port}/index.html`;
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const errs = [];
  const ctx = await browser.newContext({viewport: {width: 900, height: 560}});
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  page.setDefaultTimeout(90000);

  console.log('Henrycraft racing tests\n');

  try {
    await page.goto(url, {waitUntil: 'load', timeout: 120000});
    await page.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready(),
                               {timeout: 150000});

    // ---- 1: there is a circuit, and it is a closed loop ----------------------
    console.log('1. every seed lays a closed circuit that fits in the world');
    const shapes = await page.evaluate(n => {
      const H = window.__henrycraft, out = [];
      for (let i = 0; i < n; i++) {
        H.loadThemeSeed('racing', 3000 + i * 37);
        const t = H.track();
        if (!t) { out.push({seed: 3000 + i * 37, missing: true }); continue; }
        /* Walk the centre line: every sample must be inside the world with room for
           the road and its kerbs, and consecutive samples must be a small step apart -
           a gap would be a road with a hole in it. */
        let worst = 0, minR = 1e9, maxR = 0, offWorld = 0, biggestStep = 0;
        /* The corners, as a driver meets them: the radius of the circle through three
           points a few blocks apart. A hairpin is welcome; something tighter than a kart
           can physically turn is not. */
        let tightest = 1e9;
        /* The world is not 64 blocks any more - a racing district is wider than the rest,
           so every bound here is asked for rather than assumed. */
        const W = H.dims().WX;
        const N0 = t.pts.length, look = Math.round(6 / 0.34);
        for (let k = 0; k < N0; k++) {
          const p = t.pts[k], q = t.pts[(k + 1) % N0];
          const r = Math.hypot(p.x - t.cx, p.z - t.cz);
          minR = Math.min(minR, r); maxR = Math.max(maxR, r);
          if (p.x < t.half + 2 || p.z < t.half + 2 ||
              p.x > W - t.half - 2 || p.z > W - t.half - 2) offWorld++;
          biggestStep = Math.max(biggestStep, Math.hypot(p.x - q.x, p.z - q.z));
          /* The road is flat now, so any height change at all is a fault. */
          worst = Math.max(worst, Math.abs(p.y - q.y));
          const A = t.pts[(k - look + N0) % N0], B = p, C = t.pts[(k + look) % N0];
          const area = Math.abs((B.x - A.x) * (C.z - A.z) - (C.x - A.x) * (B.z - A.z)) / 2;
          if (area > 1e-6) {
            const ab = Math.hypot(B.x - A.x, B.z - A.z), bc = Math.hypot(C.x - B.x, C.z - B.z),
                  ca = Math.hypot(A.x - C.x, A.z - C.z);
            tightest = Math.min(tightest, (ab * bc * ca) / (4 * area));
          }
        }
        /* Closed: the last sample joins the first. */
        const closes = Math.hypot(t.pts[0].x - t.pts[t.pts.length - 1].x,
                                  t.pts[0].z - t.pts[t.pts.length - 1].z) < 1.2;
        /* Never doubles back on itself: no two samples a quarter lap apart may be
           within a road's width of each other, which is what a figure of eight looks
           like from the inside. */
        let pinch = 1e9;
        const N = t.pts.length;
        for (let k = 0; k < N; k += 4) {
          for (let j = k + Math.floor(N * 0.12); j < k + N - Math.floor(N * 0.12); j += 4) {
            const a = t.pts[k], b = t.pts[j % N];
            pinch = Math.min(pinch, Math.hypot(a.x - b.x, a.z - b.z));
          }
        }
        out.push({seed: 3000 + i * 37, minR: +minR.toFixed(1), maxR: +maxR.toFixed(1),
                  offWorld, closes, worstStep: +worst.toFixed(2),
                  biggestStep: +biggestStep.toFixed(2), pinch: +pinch.toFixed(1),
                  lap: H.lapLength(), tightest: +tightest.toFixed(1),
                  reach: +(maxR - minR).toFixed(1), pushes: t.pushes});
      }
      return out;
    }, SEEDS);
    check(`all ${SEEDS} seeds produce a circuit`,
          shapes.every(s => !s.missing), JSON.stringify(shapes.filter(s => s.missing)));
    check('every circuit closes on itself',
          shapes.every(s => s.closes), JSON.stringify(shapes.filter(s => !s.closes)));
    check('and stays inside the world with room for the kerbs',
          shapes.every(s => s.offWorld === 0),
          JSON.stringify(shapes.filter(s => s.offWorld)));
    check('no circuit doubles back close enough to cross itself',
          shapes.every(s => s.pinch > 9),
          JSON.stringify(shapes.filter(s => s.pinch <= 9).map(s => ({seed: s.seed, pinch: s.pinch}))));
    /* Flat, and that is not a detail: a slope quantised to blocks is a staircase, and a
       staircase at kart speed is a kart that bounces the whole way round. He looked at an
       earlier version and said the road was bumpy. */
    check('the road is perfectly flat, everywhere, on every seed',
          shapes.every(s => s.worstStep === 0),
          JSON.stringify(shapes.filter(s => s.worstStep > 0)
                               .map(s => ({seed: s.seed, step: s.worstStep}))));
    /* He asked for a lap that takes half a minute to a minute. At kart pace that is 350 to
       620 blocks of road - see TRACK_MIN_LAP. The wobbly circle managed 110 whatever the
       seed, and the first grid version 230, so this is the check that says the world had to
       get bigger. Section 4 measures the time itself, by driving. */
    check(`every lap is 350 to 620 blocks ` +
          `(${Math.min(...shapes.map(s => s.lap))} to ${Math.max(...shapes.map(s => s.lap))})`,
          shapes.every(s => s.lap >= 350 && s.lap <= 620),
          JSON.stringify(shapes.filter(s => s.lap < 350 || s.lap > 620)
                               .map(s => ({seed: s.seed, lap: s.lap}))));
    check('with corners of genuinely different sizes, none too tight for a kart',
          shapes.every(s => s.tightest >= 4.2 && s.reach >= 6),
          JSON.stringify(shapes.map(s => ({seed: s.seed, tightest: s.tightest,
                                           reach: s.reach}))));
    /* The check that catches a dull circuit rather than a broken one, and it is here
       because a seed slipped through without it: 500 blocks long, every length and corner
       test passed, and the shape was a plain rectangle round the edge of the world with an
       empty field in the middle. Length alone does not make a circuit - the detours pushed
       through the middle do, and pushes counts them. Zero means the fallback ring. */
    check('every circuit has at least four detours pushed through the middle of it',
          shapes.every(s => s.pushes >= 4),
          JSON.stringify(shapes.filter(s => s.pushes < 4)
                               .map(s => ({seed: s.seed, pushes: s.pushes, lap: s.lap}))));
    const rs = shapes.filter(s => !s.missing);
    note(`lap length ${Math.min(...rs.map(s => s.lap))} to ` +
         `${Math.max(...rs.map(s => s.lap))} blocks; tightest corner ` +
         `${Math.min(...rs.map(s => s.tightest))} blocks of radius across ${rs.length} seeds`);

    // ---- 2: the road is actually laid, and is dry ----------------------------
    console.log('\n2. the circuit is built out of road, above the water');
    const built = await page.evaluate(n => {
      const H = window.__henrycraft, ids = H.ids, out = [];
      for (let i = 0; i < n; i++) {
        H.loadThemeSeed('racing', 3000 + i * 37);
        const t = H.track();
        let road = 0, wet = 0, blocked = 0, kerbs = 0;
        for (let k = 0; k < t.pts.length; k += 7) {
          const p = t.pts[k];
          const x = Math.floor(p.x), z = Math.floor(p.z);
          /* At the road's own height. Reading surfaceY instead finds the leaves of a
             tree beside the road, or a plank of the start arch, and reports the circuit
             as unpaved when it is not - the first version of this check did exactly
             that. */
          /* Find the column's real driving surface first, then look up from it, rather
             than measuring clearance from the height the sample claims. An earlier version
             measured from the sample and reported the road surface itself as an obstruction
             standing in the road - a fine example of a test being confidently wrong - so
             the block either side is still allowed for here even though a flat road should
             not need it. If it ever does need it, section 1 fails first. */
          const isRoad = y2 => {
            const b2 = H.getBlock(x, y2, z);
            return b2 === ids.ROAD || b2 === ids.ROADLINE || b2 === ids.GRID;
          };
          let top = null;
          for (const cand of [p.y + 1, p.y, p.y - 1]) { if (isRoad(cand)) { top = cand; break; } }
          if (top !== null) road++;
          /* Nothing standing in the road, and no water lying on it. */
          for (let up = 1; top !== null && up <= 3; up++) {
            const a = H.getBlock(x, top + up, z);
            if (a === ids.WATER) wet++;
            /* Leaves overhead are scenery, not an obstruction - he drives under them.
               Anything solid in the road is a different matter. */
            else if (a !== ids.AIR && a !== ids.LEAVES) blocked++;
          }
          if (top === null) continue;
          /* A kerb just outside the road's edge, on at least one side. */
          /* Across the road, not away from the middle of the circuit: the loop wobbles,
             so the radial direction is not the perpendicular, and probing along it walks
             diagonally off the kerb. */
          const nxt = t.pts[(k + 6) % t.pts.length];
          const tx = nxt.x - p.x, tz = nxt.z - p.z;
          const tl = Math.hypot(tx, tz) || 1;
          const px2 = -tz / tl, pz2 = tx / tl;
          const off = t.half + 0.6;      /* the kerb sits just outside the road's edge */
          const kerbAt = (sx, sz) => {
            for (let yy = top - 1; yy <= top + 1; yy++) {
              if (H.getBlock(Math.floor(sx), yy, Math.floor(sz)) === ids.KERB) return true;
            }
            return false;
          };
          if (kerbAt(p.x + px2 * off, p.z + pz2 * off) ||
              kerbAt(p.x - px2 * off, p.z - pz2 * off)) kerbs++;
        }
        /* How much of the district the circuit takes up. A long lap in a 64-block world
           covers a lot of it - that is arithmetic, not a fault - but if a layout ever
           merged two corridors into one field of tarmac this is the number that would
           say so. */
        const W = H.dims().WX, area = W * W;
        let paved = 0;
        for (let x = 0; x < W; x++) {
          for (let z = 0; z < W; z++) {
            const b = H.getBlock(x, t.y, z);
            if (b === ids.ROAD || b === ids.ROADLINE || b === ids.GRID || b === ids.KERB) paved++;
          }
        }
        const samples = Math.ceil(t.pts.length / 7);
        out.push({seed: 3000 + i * 37, samples, road, wet, blocked, kerbs,
                  paved: +(paved / area).toFixed(3),
                  /* what a ribbon that long and that wide has to cover */
                  expect: +(H.lapLength() * (t.half * 2 + 2) / area).toFixed(3)});
      }
      return out;
    }, SEEDS);
    check('the whole centre line is road, on every seed',
          built.every(b => b.road === b.samples),
          JSON.stringify(built.filter(b => b.road !== b.samples)));
    check('no part of the circuit is under water',
          built.every(b => b.wet === 0), JSON.stringify(built.filter(b => b.wet)));
    check('and nothing is standing in the road',
          built.every(b => b.blocked === 0), JSON.stringify(built.filter(b => b.blocked)));
    /* Not quite every single point. The probe steps across the road from one sample and
       lands a block or so off where the kerb actually is at the start arch, where the grid
       replaces it. Measured: 96% to 100% of samples on every seed, so 90% is a bar that
       would notice a missing kerb rather than one written to accommodate whatever the code
       happens to do - an earlier version of this asked for 70% on the strength of a merged
       corridor that the layout no longer produces, which is no bar at all. */
    check('the road is kerbed rather than just ending',
          built.every(b => b.kerbs > b.samples * 0.9),
          JSON.stringify(built.map(b => ({seed: b.seed, kerbs: b.kerbs, of: b.samples}))));
    const kerbPct = built.map(b => b.kerbs / b.samples);
    note(`checked ${built[0].samples} points round each of ${SEEDS} circuits; ` +
         `kerbed on ${(Math.min(...kerbPct) * 100).toFixed(0)}% to ` +
         `${(Math.max(...kerbPct) * 100).toFixed(0)}% of them`);
    /* The circuit is allowed to fill most of the district. A 230-block lap of 11-wide road
       IS 60-odd per cent of a 64-block world, and that ceiling is the world's size rather
       than anything about the layout, so what is checked is that the paved area matches
       what a ribbon that long and that wide accounts for - no more, and not much less.

       Worth being honest about how much this proves: on purpose I built a version whose
       corridors ran eight blocks apart with a nine-block road, so they genuinely overlapped,
       and this ratio only moved from 1.00 to 0.95. Overlapping a ribbon with itself barely
       changes its area. The check above it - the kerb - is the one that noticed, and loudly:
       33% of samples kerbed against a bar of 90%. This one is a sanity band against a
       generator that pours tarmac somewhere it should not, not a merge detector. */
    check('as much of the district is paved as the lap accounts for, and no more',
          built.every(b => b.paved >= b.expect * 0.9 && b.paved <= b.expect * 1.1),
          JSON.stringify(built.filter(b => b.paved < b.expect * 0.9 || b.paved > b.expect * 1.1)
                              .map(b => ({seed: b.seed, paved: b.paved, expect: b.expect}))));
    const pv = built.map(b => b.paved);
    note(`the road and its kerbs cover ${(Math.min(...pv) * 100).toFixed(0)}% to ` +
         `${(Math.max(...pv) * 100).toFixed(0)}% of a district, within a tenth of what the ` +
         `lap's own length accounts for (it was 57% to 64% before the world grew)`);

    /* Every square of the road, not just the centre line.

       The check above walks the middle of the road every seventh sample, which is 256 points
       out of five thousand squares of tarmac - so a hole at the kerb, or a boulder a block
       off the racing line, was invisible to it. A hole in a road at fifteen blocks a second
       is a jolt he did not ask for, and this game does not do jolts. Leaves are allowed
       through: they hang over the verge and he drives under them. */
    const surface = await page.evaluate(n => {
      const H = window.__henrycraft, ids = H.ids, out = [];
      for (let i = 0; i < n; i += 4) {
        H.loadThemeSeed('racing', 3000 + i * 37);
        const t = H.track(), W = H.dims().WX;
        let squares = 0, holes = 0, blocked = 0;
        const worst = [];
        for (let x = 0; x < W; x++) for (let z = 0; z < W; z++) {
          let best = 1e9;
          for (let k = 0; k < t.pts.length; k += 3) {
            const d = Math.hypot(t.pts[k].x - (x + 0.5), t.pts[k].z - (z + 0.5));
            if (d < best) best = d;
          }
          if (best > t.half) continue;
          squares++;
          const on = H.getBlock(x, t.y, z);
          if (on !== ids.ROAD && on !== ids.ROADLINE && on !== ids.GRID && on !== ids.KERB) {
            holes++;
            if (worst.length < 5) worst.push({x, z, block: on, what: 'not road'});
          }
          for (let up = 1; up <= 3; up++) {
            const ab = H.getBlock(x, t.y + up, z);
            if (ab !== ids.AIR && ab !== ids.LEAVES) {
              blocked++;
              if (worst.length < 5) worst.push({x, z, up, block: ab, what: 'in the way'});
            }
          }
        }
        out.push({seed: 3000 + i * 37, squares, holes, blocked, worst});
      }
      return out;
    }, SEEDS);
    check('every square of the road is road, with no holes anywhere in it',
          surface.every(s => s.holes === 0),
          JSON.stringify(surface.filter(s => s.holes)));
    check('and nothing solid stands anywhere on it, not just on the racing line',
          surface.every(s => s.blocked === 0),
          JSON.stringify(surface.filter(s => s.blocked)));
    note(`${surface.reduce((a, s) => a + s.squares, 0)} squares of tarmac checked across ` +
         `${surface.length} circuits, block by block, for holes and obstructions`);

    // ---- 3: he starts on the grid, in a kart --------------------------------
    console.log('\n3. he arrives on the start line');
    const start = await page.evaluate(() => {
      const H = window.__henrycraft, ids = H.ids;
      H.loadThemeSeed('racing', 4242);
      const t = H.track();
      const p = H.player();
      const under = H.getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z));
      return {t, p, under, grid: ids.GRID, road: ids.ROAD, line: ids.ROADLINE,
              onRoad: H.onRoad(p.x, p.y, p.z),
              kartButtonShown: !document.getElementById('kartBtn').classList.contains('hide'),
              distToStart: +Math.hypot(p.x - t.start.x, p.z - t.start.z).toFixed(2)};
    });
    check('he starts on the start line, not in a field',
          start.distToStart < 2 && start.onRoad === true, JSON.stringify(start));
    check('and the kart button is there for him to press',
          start.kartButtonShown === true, JSON.stringify(start));
    note(`spawn is ${start.distToStart} blocks from the start line, on ` +
         `block ${start.under}`);

    // ---- 4: a kart can get round the lap -----------------------------------
    console.log('\n4. a kart gets round the circuit, on every seed');
    const laps = await page.evaluate(async n => {
      const H = window.__henrycraft, out = [];
      for (let i = 0; i < n; i++) {
        H.loadThemeSeed('racing', 3000 + i * 37);
        if (!H.kart()) H.toggleKart();
        /* Ninety seconds of driving, steering for the centre line and squeezing the
           throttle the way a person does - enough to get round a 500-block lap and out
           the other side even on the slowest layout, which is what lets the time per lap
           below be worked out by division rather than guessed at. */
        const SECONDS = 90;
        const r = H.drive(SECONDS, () => H.autoSteer(), () => H.autoThrottle());
        out.push({seed: 3000 + i * 37, turned: r.turned, laps: r.laps,
                  offRoad: r.offRoadFrames, frames: r.frames,
                  maxSpeed: r.maxSpeed, minY: r.minY, stalled: r.stalledFrames,
                  lap: H.lapLength(),
                  /* seconds a lap, at the pace of a driver who knows the way round */
                  spl: r.turned > 0 ? +(SECONDS / r.turned).toFixed(1) : null});
        if (H.kart()) H.toggleKart();
      }
      return out;
    }, SEEDS);
    check(`a full lap is driveable on all ${SEEDS} seeds`,
          laps.every(l => l.turned >= 1),
          JSON.stringify(laps.filter(l => l.turned < 1)
                             .map(l => ({seed: l.seed, turned: l.turned,
                                         stalled: l.stalled, lap: l.lap}))));
    /* Never wedged. Rolling slowly round a hairpin is fine; sitting still against
       something is the one thing a five-year-old cannot get out of by himself. */
    check('and he is never left sitting still against anything',
          laps.every(l => l.stalled / l.frames < 0.06),
          JSON.stringify(laps.map(l => ({seed: l.seed,
                                         stuck: +(l.stalled / l.frames).toFixed(2)}))));
    check('and the lap counter notices',
          laps.every(l => l.laps >= 1),
          JSON.stringify(laps.filter(l => l.laps < 1).map(l => ({seed: l.seed, laps: l.laps}))));
    check('the kart stays on the road nearly all the way round',
          laps.every(l => l.offRoad / l.frames < 0.25),
          JSON.stringify(laps.map(l => ({seed: l.seed,
                                         off: +(l.offRoad / l.frames).toFixed(2) }))));
    check('and never falls out of the world',
          laps.every(l => l.minY > 0), JSON.stringify(laps.filter(l => l.minY <= 0)));
    /* The thing he actually asked for, measured by driving rather than by arithmetic on the
       lap length: "a lap should take 30 seconds to a minute to complete". This is the pace
       of a driver who knows the way round, so his own laps will be slower - that is the
       right way round for a bar to be wrong. */
    check('a lap takes between 30 seconds and a minute to get round',
          laps.every(l => l.spl !== null && l.spl >= 30 && l.spl <= 60),
          JSON.stringify(laps.filter(l => l.spl === null || l.spl < 30 || l.spl > 60)
                             .map(l => ({seed: l.seed, seconds: l.spl, lap: l.lap}))));
    const turns = laps.map(l => l.turned), spls = laps.map(l => l.spl);
    note(`a lap takes ${Math.min(...spls)}s to ${Math.max(...spls)}s to drive; ` +
         `top speed ${Math.max(...laps.map(l => l.maxSpeed)).toFixed(1)} blocks a second ` +
         `(${Math.min(...turns).toFixed(2)} to ${Math.max(...turns).toFixed(2)} laps in 90s)`);

    // ---- 5: the stars are on the track -------------------------------------
    console.log('\n5. the stars are round the circuit, where a kart will find them');
    const stars = await page.evaluate(n => {
      const H = window.__henrycraft, out = [];
      for (let i = 0; i < n; i++) {
        H.loadThemeSeed('racing', 3000 + i * 37);
        const t = H.track();
        const ss = H.stars();
        let onRoad = 0, reachable = 0;
        ss.forEach(s => {
          const r = Math.hypot(s.x - t.cx, s.z - t.cz);
          /* Within the road, allowing for the kerb. */
          let near = 1e9;
          t.pts.forEach(p => { near = Math.min(near, Math.hypot(p.x - s.x, p.z - s.z)); });
          if (near <= t.half) onRoad++;
          /* At a height a kart can touch: the driver's head is about 1.4 up. */
          /* Height measured against the road, for the same reason as above. */
          let ny = 0;
          t.pts.forEach(p => {
            if (Math.hypot(p.x - s.x, p.z - s.z) <= near + 0.01) ny = p.y;
          });
          if (s.y - ny <= 2.8 && s.y - ny >= 0.4) reachable++;
        });
        out.push({seed: 3000 + i * 37, count: ss.length, onRoad, reachable});
      }
      return out;
    }, SEEDS);
    check('ten stars on every circuit',
          stars.every(s => s.count === 10), JSON.stringify(stars.filter(s => s.count !== 10)));
    check('every star sits on the road, not out in the grass',
          stars.every(s => s.onRoad === s.count),
          JSON.stringify(stars.filter(s => s.onRoad !== s.count)));
    check('and low enough for a kart to drive through',
          stars.every(s => s.reachable === s.count),
          JSON.stringify(stars.filter(s => s.reachable !== s.count)));

    /* Driving into one has to collect it - at kart speed, on a slow tablet, which is
       where a fixed pickup radius would be driven straight through. */
    const collected = await page.evaluate(() => {
      const H = window.__henrycraft;
      H.loadThemeSeed('racing', 4242);
      if (!H.kart()) H.toggleKart();
      const before = H.starsFound();
      const r = H.drive(45, () => H.autoSteer(), () => H.autoThrottle());
      return {before, after: H.starsFound(), total: H.stars().length, turned: r.turned};
    });
    check('driving round collects the stars he drives through',
          collected.after > collected.before, JSON.stringify(collected));
    note(`one lap and a bit collected ${collected.after} of ${collected.total} stars`);

    // ---- 6: nothing here can hurt him --------------------------------------
    console.log('\n6. nothing about racing can hurt, trap or end anything');
    const safe = await page.evaluate(async () => {
      const H = window.__henrycraft;
      H.loadThemeSeed('racing', 4242);
      if (!H.kart()) H.toggleKart();
      /* Off the road on purpose: a quarter turn, then straight on into the country. The
         first version of this held the stick over for twelve seconds and called it driving
         off the track - it drove in circles, and reported whatever speed it happened to
         end at. */
      H.turn(Math.PI / 2);
      const off = H.drive(8, () => 0, () => 1);
      const at = H.player();
      const grassSpeed = Math.hypot(at.vx, at.vz);
      /* Whatever he has driven into out there - a tree, a hillside, the edge of the world -
         he has to be able to get himself out of it. That is the property that matters, not
         whether something can stop him: a tree stops him in a meadow too. Reverse, and see
         whether the world lets go. */
      H.drive(2.5, () => 0, () => -1);
      const backAt = H.player();
      const reversed = Math.hypot(backAt.x - at.x, backAt.z - at.z);
      const stillDriving = H.kart();
      /* And he can always get out on foot, wherever he is. */
      H.toggleKart();
      const outNow = !H.kart();
      const p2 = H.player();
      return {off, stillDriving, outNow, reversed: +reversed.toFixed(2),
              endSpeed: +grassSpeed.toFixed(2),
              offRoadShare: +(off.offRoadFrames / off.frames).toFixed(2),
              stuck: +(off.stalledFrames / off.frames).toFixed(2),
              inWorld: p2.x > 0 && p2.x < H.dims().WX && p2.z > 0 &&
                       p2.z < H.dims().WZ && p2.y > 0,
              stars: H.stars().length, laps: H.laps()};
    });
    check('driving off the circuit does not stop him or take anything away',
          safe.stillDriving === true && safe.off.minY > 0 &&
          safe.stars === 10 && safe.laps >= 0, JSON.stringify(safe));
    /* The one that would matter to him: whatever he drives into, reversing gets him out. */
    check('and whatever he drives into out there, he can reverse out of it',
          safe.reversed > 2, JSON.stringify(safe));
    check('he can get out of the kart wherever he happens to be',
          safe.outNow === true && safe.inWorld === true, JSON.stringify(safe));
    check('and the lap count never goes backwards or below zero',
          safe.laps >= 0, JSON.stringify(safe));
    /* Most of that run was off the road, and he was moving for most of it. No speed is
       claimed here on purpose: he leaves the road already carrying road speed, so the
       fastest he goes during the run is a tarmac number wearing a grass hat, and the speed
       he ends at is whatever a tree left him. Grass being slower than tarmac is measured
       where it can be measured honestly - the drive round the lap in section 4, which never
       exceeds 11.5, against 5.5 for grass in KART_GRASS. */
    check('he spends that run off the road and keeps moving through it',
          safe.offRoadShare > 0.5 && safe.stuck < 0.5, JSON.stringify(safe));
    note(`driven off the road: ${(safe.offRoadShare * 100).toFixed(0)}% of the run on the ` +
         `grass, stopped for ${(safe.stuck * 100).toFixed(0)}% of it, and reverses ` +
         `${safe.reversed} blocks straight back out of whatever he met`);

    /* Reversing round the lap must not count laps - being given a lap for going
       backwards is confusing, and taking one away would be worse. */
    const backwards = await page.evaluate(() => {
      const H = window.__henrycraft;
      H.loadThemeSeed('racing', 4242);
      if (!H.kart()) H.toggleKart();
      const forwards = H.drive(20, () => H.autoSteer(), () => H.autoThrottle());
      const after = H.laps();
      /* Now spin round and go back the way he came. */
      H.turn(Math.PI);
      const back = H.drive(20, () => -H.autoSteer(), () => H.autoThrottle());
      return {after, backLaps: H.laps(), forwards: forwards.turned, back: back.turned};
    });
    check('going back round the other way never takes a lap away',
          backwards.backLaps >= backwards.after, JSON.stringify(backwards));

    // ---- 7: walking is exactly as it was -----------------------------------
    console.log('\n7. getting out of the kart gives him back the game he had');
    const walking = await page.evaluate(async () => {
      const H = window.__henrycraft;
      H.loadThemeSeed('meadow', 99);
      const noTrack = H.track();
      const noButton = document.getElementById('kartBtn').classList.contains('hide');
      /* Walking pace on flat ground, in a district with no circuit in it. */
      const r = H.drive(3, () => 0);
      return {noTrack, noButton, walkSpeed: r.maxSpeed, kart: H.kart()};
    });
    check('a district that is not a circuit has no track and no kart button',
          walking.noTrack === null && walking.noButton === true, JSON.stringify(walking));
    check('and walking is still walking - about five blocks a second, not twelve',
          walking.walkSpeed > 4 && walking.walkSpeed < 6.2,
          `walked at ${walking.walkSpeed} blocks a second`);
    note(`walking tops out at ${walking.walkSpeed} blocks a second, ` +
         `a kart at ${Math.max(...laps.map(l => l.maxSpeed)).toFixed(1)}`);

    // ---- 8: it comes back the same after a reload ---------------------------
    console.log('\n8. the same circuit comes back after closing the game');
    const before = await page.evaluate(async () => {
      const H = window.__henrycraft;
      await H.createDistrict('Sunny Circuit', 'racing');
      const t = H.track();
      return {slug: H.districts().current, cx: t.cx, cz: t.cz,
              pts: t.pts.filter((_, i) => i % 200 === 0),
              start: t.start};
    });
    await page.reload({waitUntil: 'load'});
    await page.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready());
    const after = await page.evaluate(() => {
      const H = window.__henrycraft;
      const t = H.track();
      return {slug: H.districts().current, track: t,
              pts: t ? t.pts.filter((_, i) => i % 200 === 0) : null};
    });
    check('the circuit is still there after a reload',
          !!after.track && after.slug === before.slug,
          JSON.stringify({was: before.slug, now: after.slug, has: !!after.track}));
    check('and it is the same circuit, block for block',
          !!after.pts && JSON.stringify(after.pts) === JSON.stringify(before.pts),
          JSON.stringify({was: before.pts, now: after.pts}));
    note(`circuit at ${before.cx},${before.cz} reloaded identical`);

    // ---- 8b: driving is not building ----------------------------------------
    console.log('\n8b. the block cursor is gone while he is driving');
    const cursor = await page.evaluate(async () => {
      const H = window.__henrycraft;
      H.loadThemeSeed('racing', 4242);
      document.getElementById('playBtn').click();
      const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      /* What is on the screen, as a player would see it: is the picker showing, and what
         does the line of key hints say? */
      const shown = () => ({
        palette: getComputedStyle(document.getElementById('palette')).display !== 'none',
        hint: getComputedStyle(document.getElementById('hint')).display !== 'none',
        crosshair: getComputedStyle(document.getElementById('crosshair')).display !== 'none',
      });
      if (H.kart()) H.toggleKart();
      await frame();
      const walking = H.aiming();
      const chromeWalking = shown();
      /* Dig with the cursor up, to be sure the road is diggable on foot at all - otherwise
         the check below would pass on a road nothing can touch. */
      const p = H.player();
      const under = [Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)];
      const wasRoad = H.getBlock(under[0], under[1], under[2]);
      H.digDown();
      const dugOnFoot = H.getBlock(under[0], under[1], under[2]) !== wasRoad;
      H.setBlock(under[0], under[1], under[2], wasRoad);

      H.toggleKart();
      await frame();
      const driving = H.aiming();
      const chromeDriving = shown();
      /* Every way in: the wireframe box, the ghost block, digging what he is looking at,
         placing a block, and digging straight down through the floor of the kart. */
      const before = H.getBlock(under[0], under[1], under[2]);
      H.digDown(); H.dig(); H.build();
      const after = H.getBlock(under[0], under[1], under[2]);
      H.toggleKart();
      await frame();
      const backOnFoot = H.aiming();
      return {walking, driving, backOnFoot, dugOnFoot, dugWhileDriving: before !== after,
              chrome: {walking: chromeWalking, driving: chromeDriving, back: shown()}};
    });
    check('on foot the cursor is there, as it always was',
          cursor.walking.highlight === true && cursor.walking.canBuild === true,
          JSON.stringify(cursor.walking));
    check('and on foot he really can dig the road, so the next check means something',
          cursor.dugOnFoot === true, JSON.stringify(cursor));
    check('in the kart the wireframe box and the ghost block are both gone',
          cursor.driving.highlight === false && cursor.driving.ghost === false,
          JSON.stringify(cursor.driving));
    /* Hiding the box while leaving digging on would be worse than leaving the box: an
       invisible cursor taking a bite out of the road at eleven blocks a second. */
    check('and nothing can be dug or placed from the driving seat',
          cursor.driving.aim === false && cursor.driving.target === false &&
          cursor.dugWhileDriving === false, JSON.stringify(cursor));
    check('getting out gives the cursor straight back',
          cursor.backOnFoot.highlight === true && cursor.backOnFoot.canBuild === true,
          JSON.stringify(cursor.backOnFoot));
    /* And with it the block picker. A row of blocks that cannot be placed is worse than no
       row at all, and the key hints list digging, which is half wrong from the seat. */
    check('the block picker and the key hints go away with the cursor, and come back',
          cursor.chrome.walking.palette === true && cursor.chrome.driving.palette === false &&
          cursor.chrome.back.palette === true &&
          cursor.chrome.walking.hint === true && cursor.chrome.driving.hint === false &&
          cursor.chrome.back.hint === true, JSON.stringify(cursor.chrome));
    /* The white cross in the middle is an aiming mark, and there is nothing to aim at from
       the driving seat. It was the one piece of building chrome I left behind when the rest
       went, so on an empty track it was the only thing on the screen - which is exactly how
       it got noticed. Computed style, not class names: the block button taught me that a
       class can be set and the thing still drawn. */
    check('and so does the aiming cross, which has nothing to aim at in a kart',
          cursor.chrome.walking.crosshair === true &&
          cursor.chrome.driving.crosshair === false &&
          cursor.chrome.back.crosshair === true, JSON.stringify(cursor.chrome));
    /* And the lap chips must sit clear of the buttons on the right at every size he might
       hold the thing at, rather than under the one button he needs while driving. Letting
       the top row wrap put five chips down the left of a 390-wide phone and across the
       buttons, which is why they have a row of their own. */
    const SIZES = [[1440, 900], [1024, 640], [900, 560], [820, 520], [390, 780]];
    const fits = [];
    /* In the kart, or there is nothing to measure: the row is properly hidden on foot now,
       so its rectangle is all zeros and every comparison below quietly reads as a failure.
       An earlier version of this check measured it on foot and passed - only because the
       `hide` class had no rule behind it, so the row was on screen the whole time. */
    await page.evaluate(() => {
      const H = window.__henrycraft;
      if (!H.kart()) H.toggleKart();
    });
    for (const [w, h] of SIZES) {
      await page.setViewportSize({width: w, height: h});
      fits.push(await page.evaluate(async wh => {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const R = id => {
          const b = document.getElementById(id).getBoundingClientRect();
          return {left: Math.round(b.left), right: Math.round(b.right),
                  top: Math.round(b.top), bottom: Math.round(b.bottom)};
        };
        /* The row above it, not the whole corner - the lap row lives inside topLeft now,
           so measuring against topLeft would be measuring it against itself. */
        const first = document.querySelector('#topLeft .hudrow').getBoundingClientRect();
        const race = R('raceRow'), right = R('topRight');
        return {size: wh, race, first: {bottom: Math.round(first.bottom),
                                        right: Math.round(first.right)}, right,
                /* Below the row above it, and finishing before the buttons begin. */
                below: race.top >= Math.round(first.bottom) - 2,
                clear: race.right <= right.left,
                /* Whether the row above it already runs into the buttons. On a narrow
                   phone it does, and always did - three chips do not fit in 390px beside
                   four buttons. That is the existing HUD's problem, not the lap clock's,
                   so the lap row is held to it rather than blamed for it. */
                topClear: Math.round(first.right) <= right.left,
                /* And one row, not a column: two chips side by side are ~44px tall. */
                oneRow: race.bottom - race.top < 60};
      }, `${w}x${h}`));
    }
    await page.setViewportSize({width: 900, height: 560});
    await page.evaluate(() => {
      const H = window.__henrycraft;
      if (H.kart()) H.toggleKart();
    });
    /* And the row really is off the screen on foot, which is the other half of it. */
    const rowOnFoot = await page.evaluate(() =>
      getComputedStyle(document.getElementById('raceRow')).display === 'none');
    check('the lap chips are not on screen at all while he is walking',
          rowOnFoot === true, `raceRow display was not none on foot`);
    check('the lap chips are one row, under the others, at every size',
          fits.every(f => f.below && f.oneRow),
          JSON.stringify(fits.filter(f => !(f.below && f.oneRow))));
    /* Clear of the buttons wherever the row above it is - so the lap clock never introduces
       an overlap the HUD did not already have. */
    check('and clear of the buttons wherever the row above them is',
          fits.every(f => !f.topClear || f.clear),
          JSON.stringify(fits.filter(f => f.topClear && !f.clear)));
    const narrow = fits.filter(f => !f.topClear).map(f => f.size);
    note(`lap row measured at ${SIZES.map(s => s.join('x')).join(', ')}: one row, below the ` +
         `others` + (narrow.length
           ? `; at ${narrow.join(' and ')} the row above it already reaches the buttons, ` +
             `which it did before there was a lap clock`
           : `, always left of the buttons`));

    /* The tablet's own controls. A fresh context with touch on, because the action pads only
       exist there: checking them on a desktop page would be checking that something already
       hidden is hidden, which is how the `hide` class went years without a rule behind it. */
    const padsCtx = await browser.newContext({viewport: {width: 900, height: 560},
                                              hasTouch: true, isMobile: true});
    const padsPage = await padsCtx.newPage();
    try {
      await padsPage.goto(url, {waitUntil: 'load', timeout: 120000});
      await padsPage.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready(),
                                     {timeout: 150000});
      const pads = await padsPage.evaluate(async () => {
        const H = window.__henrycraft;
        H.loadThemeSeed('racing', 4242);
        document.getElementById('playBtn').click();
        const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const vis = id => getComputedStyle(document.getElementById(id)).display !== 'none';
        const drawn = id => document.getElementById(id).getClientRects().length > 0;
        const shot = () => ({
          touch: document.body.classList.contains('touch'),
          pads: drawn('pads'), blockBtn: drawn('blockBtn'), stick: drawn('stick'),
          kartBtn: drawn('kartBtn'), menu: drawn('btnMenu'), view: drawn('btnView'),
          /* Actually rendered, not merely styled as visible. A child of a display:none
             parent still reports its own computed display, so counting that reported seven
             buttons inside a hidden cluster. getClientRects is empty for anything the page
             is not drawing, whatever the reason. */
          buttons: [].slice.call(document.querySelectorAll('#pads .blockbtn'))
                     .filter(b => b.getClientRects().length > 0).length,
        });
        if (H.kart()) H.toggleKart();
        await frame();
        const walking = shot();
        H.toggleKart();
        await frame();
        const driving = shot();
        /* In the air, then into the kart: he must not be left flying with no way down. */
        H.toggleKart();
        H.setFly(true);
        const flyingOnFoot = H.player().fly;
        H.toggleKart();
        await frame();
        const gotInFlying = {fly: H.player().fly, pads: shot()};
        H.toggleKart();
        await frame();
        const back = shot();
        return {walking, driving, back, flyingOnFoot, gotInFlying};
      });
      check('on the tablet the seven action buttons are there while he is on foot',
            pads.walking.touch === true && pads.walking.pads === true &&
            pads.walking.buttons === 7, JSON.stringify(pads.walking));
      check('and every one of them is gone from the driving seat',
            pads.driving.pads === false && pads.driving.buttons === 0 &&
            pads.driving.blockBtn === false, JSON.stringify(pads.driving));
      /* But not the stick, which is how he steers, nor the way out of the kart. */
      check('the stick and the way out of the kart stay exactly where they were',
            pads.driving.stick === true && pads.driving.kartBtn === true &&
            pads.driving.menu === true && pads.driving.view === true,
            JSON.stringify(pads.driving));
      check('and getting out brings all seven straight back',
            pads.back.pads === true && pads.back.buttons === 7 &&
            pads.back.blockBtn === true, JSON.stringify(pads.back));
      /* Climbing into a kart in mid-air has to put him down, or the Fly Lower button
         disappears while he is still up there. */
      check('climbing into a kart while flying lands him first',
            pads.flyingOnFoot === true && pads.gotInFlying.fly === false,
            JSON.stringify(pads.gotInFlying));
      note(`on a tablet: ${pads.walking.buttons} action buttons on foot, ` +
           `${pads.driving.buttons} in the kart, ${pads.back.buttons} again after getting out`);
    } finally {
      await padsCtx.close();
    }

    // ---- 8c: timed laps -----------------------------------------------------
    console.log('\n8c. laps are timed, and the times are honest');
    const timed = await page.evaluate(async () => {
      const H = window.__henrycraft;
      H.loadThemeSeed('racing', 4242);
      /* The game has to be running, or the chip is never repainted and the text read back
         is whatever was last written on a lap boundary - which is how the first version of
         this check managed to pass while reading a stale "0.0s". */
      document.getElementById('playBtn').click();
      const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!H.kart()) H.toggleKart();
      const atStart = H.lapTimes();
      /* Lap by lap, recording each one as it lands. Driving a fixed two minutes and then
         comparing the best against the last was the first version, and it is wrong now that
         a lap can be marked as not-driven: a rescued or flown lap is timed and shown but
         never becomes the best, so the last lap really can be quicker than the best one. */
      const seen = [];
      let laps = H.laps();
      for (let i = 0; i < 200 && seen.length < 3; i++) {
        H.drive(1, () => H.autoSteer(), () => H.autoThrottle());
        if (H.laps() > laps) {
          laps = H.laps();
          const t = H.lapTimes();
          seen.push({last: t.last, best: t.best, clean: t.clean});
        }
      }
      await frame();
      const after = H.lapTimes();
      return {atStart, after, laps, seen, lapLength: H.lapLength()};
    });
    check('the clock starts at nothing and runs while he drives',
          timed.atStart.now === 0 && timed.atStart.last === null &&
          timed.after.now > 0, JSON.stringify(timed));
    check(`a completed lap is given a time (${timed.after.last}s)`,
          timed.laps >= 2 && timed.after.last !== null && timed.after.last > 20 &&
          timed.after.last < 90, JSON.stringify(timed));
    /* The best never gets worse, and it is one of the laps he actually drove. */
    check('his best never goes up, lap after lap',
          timed.seen.every((l, i) => i === 0 || l.best <= timed.seen[i - 1].best + 0.001),
          JSON.stringify(timed.seen));
    check('and it is the quickest of the laps he drove all of himself',
          timed.after.best !== null &&
          Math.abs(timed.after.best -
                   Math.min(...timed.seen.map(l => l.last))) < 0.02,
          JSON.stringify({best: timed.after.best, laps: timed.seen}));
    check('the clock restarts for the next lap rather than running on',
          timed.after.now < timed.after.last, JSON.stringify(timed.after));
    /* And the chip agrees with the clock behind it - which is the part that would break
       silently if the repaint stopped being called. Within a third of a second rather than
       exactly: the clock is repainted ten times a second and goes on running afterwards, so
       insisting on the same digits is insisting on a race being won. */
    const shownNow = parseFloat(timed.after.shown.now);
    check('and the chip shows the clock and his best, in seconds he can read',
          timed.after.shown.hidden === false &&
          Math.abs(shownNow - timed.after.now) < 0.3 &&
          timed.after.shown.best === 'best ' + timed.after.best.toFixed(1) + 's',
          JSON.stringify({shown: timed.after.shown, now: timed.after.now,
                          last: timed.after.last, best: timed.after.best}));
    note(`two laps driven: last ${timed.after.last}s, best ${timed.after.best}s, ` +
         `chip reads "⏱ ${timed.after.shown.now} ${timed.after.shown.best}"`);

    /* A lap he did not drive all of is shown but never becomes his best. Flying is the
       case that matters: it stays allowed in a kart, because it is how he gets himself out
       of anywhere, and it is not driving. */
    const flown = await page.evaluate(async () => {
      const H = window.__henrycraft;
      H.loadThemeSeed('racing', 4242);
      if (!H.kart()) H.toggleKart();
      H.drive(120, () => H.autoSteer(), () => H.autoThrottle());
      const honest = H.lapTimes();
      /* Now fly part of a lap and finish it. */
      const lapsBefore = H.laps();
      H.setFly(true);
      H.drive(4, () => H.autoSteer(), () => H.autoThrottle());
      const midFlight = H.lapTimes();
      H.setFly(false);
      /* Finish exactly this lap and stop. Driving on for a fixed two minutes instead was the
         first version, and it failed for an honest reason: a later clean lap beat the old
         best fair and square, which says nothing about the flown one. */
      for (let i = 0; i < 150 && H.laps() === lapsBefore; i++) {
        H.drive(1, () => H.autoSteer(), () => H.autoThrottle());
      }
      const afterFlying = H.lapTimes();
      return {honest, midFlight, afterFlying, lapsBefore, lapsAfter: H.laps()};
    });
    check('flying marks the lap as not driven',
          flown.midFlight.clean === false, JSON.stringify(flown.midFlight));
    check('and a lap with flying in it never becomes his best',
          flown.lapsAfter === flown.lapsBefore + 1 &&
          flown.afterFlying.last !== null &&
          flown.afterFlying.best === flown.honest.best, JSON.stringify(flown));
    /* And the clean flag has to recover, or every lap after one flight is untimeable. */
    check('the lap after that counts again',
          flown.afterFlying.clean === true, JSON.stringify(flown.afterFlying));
    note(`best stayed at ${flown.afterFlying.best}s through a flown lap`);

    /* Getting out mid-lap must not leave a half-driven lap looking like a fast one. */
    const walked = await page.evaluate(async () => {
      const H = window.__henrycraft;
      H.loadThemeSeed('racing', 4242);
      if (!H.kart()) H.toggleKart();
      H.drive(30, () => H.autoSteer(), () => H.autoThrottle());
      const part = H.lapTimes();
      H.toggleKart();                     /* out, halfway round */
      H.drive(6, () => 0);                /* a walk about, which must not be timed */
      const onFoot = H.lapTimes();
      H.toggleKart();                     /* back in */
      const backIn = H.lapTimes();
      return {part, onFoot, backIn};
    });
    check('the clock does not run while he is out of the kart',
          walked.onFoot.now === walked.part.now, JSON.stringify(walked));
    check('and climbing back in starts a fresh lap rather than a fast half of one',
          walked.backIn.now === 0 && walked.backIn.clean === true,
          JSON.stringify(walked));
    note(`out of the kart the clock held at ${walked.onFoot.now}s and restarted at 0`);

    // ---- 8d: powerslides -----------------------------------------------------
    console.log('\n8d. leaning on a corner slides the kart and pays a boost');
    const drift = await page.evaluate(() => {
      const H = window.__henrycraft;
      /* A driver who commits to a corner, which is what a thumb does: autoSteer aims at the
         centre line and is forever correcting, so it never holds a slide. Multiplying and
         clamping it saturates the stick through a corner and leaves it near nothing on a
         straight - a person, roughly.

         The first version of this used a skid pad instead: hold the stick at 0.9 and drive
         in a circle. That leaves the road at once, scrubs down to four blocks a second, and
         cannot sustain a drift at all - so it measured the rig rather than the game. */
      const committed = () => Math.max(-1, Math.min(1, H.autoSteer() * 3.5));
      const grid = () => {
        H.loadThemeSeed('racing', 4242);
        if (!H.kart()) H.toggleKart();
        H.clearKartMotion();
      };

      /* A minute of real driving, and what the drifting did over it. */
      grid();
      const run = H.drive(60, committed, () => H.autoThrottle());

      /* A straight line cannot start one. */
      grid();
      H.drive(2.0, () => 0, () => 1);
      const straight = H.kartState();

      /* Charge one up on the road, watching the chip at every step. */
      grid();
      let charging = null;
      const icons = [];
      for (let i = 0; i < 600 && !charging; i++) {
        H.drive(0.05, committed, () => H.autoThrottle());
        H.paintHud();
        const k = H.kartState();
        icons.push({tier: k.tier, boost: k.boost, icon: k.shown.icon, hidden: k.shown.hidden});
        if (k.tier >= 0 && k.boost === 0) charging = k;
      }
      /* One gentle step must not throw the charge away.

         A hard step first, because the grace period is shared: the committed driver has
         already spent some of it on its own corrections, so easing off from an unknown
         amount of slack measures the driver rather than the rule. Holding hard for a frame
         is what resets it, and is what a thumb through a corner is doing anyway. */
      const dir = charging ? (charging.dir || 1) : 1;
      H.drive(0.05, () => 0.9 * dir, () => 1);
      const held = H.kartState();
      H.drive(0.12, () => 0.15 * dir, () => 1);
      const wobbled = H.kartState();
      /* Letting go properly ends it and pays out. */
      H.drive(0.5, () => 0, () => 1);
      const released = H.kartState();

      /* Turning the other way throws the charge away. A fresh slide starts the same step,
         because the stick is already over far enough to start one - so what is checked is
         that the sparks are gone, not that the drift is. */
      grid();
      let charged2 = null;
      for (let i = 0; i < 600 && !charged2; i++) {
        H.drive(0.05, committed, () => H.autoThrottle());
        const k = H.kartState();
        if (k.tier >= 0 && k.boost === 0) charged2 = k;
      }
      H.drive(0.06, () => -(charged2 ? charged2.dir : 1), () => 1);
      const flipped = H.kartState();

      /* Gold is reachable, searched for rather than assumed on one lap. A lap's best spark
         varies from run to run - the items it collects change its speed and so its line - so
         asserting gold on a single lap is asserting that a dice landed the right way up.
         What is fixed is that gold is reachable at all, which is what this looks for. */
      grid();
      const hunt = H.drive(90, committed, () => H.autoThrottle());

      /* Creeping along cannot drift: a slide at walking pace is a wobble. */
      grid();
      const crawl = [];
      for (let i = 0; i < 8; i++) { H.drive(0.08, () => 0.9, () => 0.1); crawl.push(H.kartState()); }

      return {run: {driftPct: +(run.driftFrames / run.frames).toFixed(2),
                    boostPct: +(run.boostFrames / run.frames).toFixed(2),
                    drifts: run.drifts, bestTier: run.bestTier,
                    maxSpeed: run.maxSpeed, turned: +run.turned.toFixed(2),
                    stuck: +(run.stalledFrames / run.frames).toFixed(3)},
              straight, icons, charging, held, wobbled, released, charged2, flipped,
              hunt: {bestTier: hunt.bestTier, longest: hunt.longestDrift,
                     drifts: hunt.drifts},
              crawl: {maxDrift: Math.max(...crawl.map(c => c.drift)),
                      maxSpeed: Math.max(...crawl.map(c => c.speed))}};
    });
    check('driving straight never starts a slide',
          drift.straight.drift === 0 && drift.straight.tier === -1,
          JSON.stringify(drift.straight));
    check('a committed driver drifts through the corners of a real lap',
          drift.run.driftPct > 0.10 && drift.run.drifts >= 8,
          JSON.stringify(drift.run));
    check('charging at least an orange spark on the way round',
          drift.run.bestTier >= 1, JSON.stringify(drift.run));
    check('and gold is reachable by driving',
          drift.hunt.bestTier === 2, JSON.stringify(drift.hunt));
    /* The boost is the point of it: faster than a kart can go on its own. */
    check(`the boost is worth more than top speed (${drift.run.maxSpeed} against 11.5)`,
          drift.run.maxSpeed > 11.5 * 1.2 && drift.run.boostPct > 0.15,
          JSON.stringify(drift.run));
    /* And none of it can leave him stuck, which is the one thing he cannot undo himself. */
    check('and none of it ever leaves him sitting still',
          drift.run.stuck < 0.02, JSON.stringify(drift.run));
    /* A spark while it charges, a flame while it fires, and never nothing at either. */
    const sparks = drift.icons.filter(i => i.tier >= 0 && i.boost === 0);
    const flames = drift.icons.filter(i => i.boost > 0);
    check('the chip shows a spark while it charges and a flame while it fires',
          sparks.length > 0 && flames.length > 0 &&
          sparks.every(i => !i.hidden && ['\ud83d\udc99', '\ud83e\udde1', '\ud83d\udc9b'].indexOf(i.icon) >= 0) &&
          flames.every(i => !i.hidden && i.icon === '\ud83d\udd25'),
          JSON.stringify({sparks: sparks.slice(0, 3), flames: flames.slice(0, 3)}));
    /* The hysteresis, which is the difference between a mechanic and a rumour: nobody holds
       a stick at a constant angle, and without it nothing drifted at all. */
    check('easing off for a moment does not throw the slide away',
          !!drift.charging && drift.wobbled.drift > drift.held.drift &&
          drift.wobbled.tier >= drift.held.tier,
          JSON.stringify({held: drift.held, wobbled: drift.wobbled}));
    check('and letting go properly ends it and pays the boost',
          drift.released.drift === 0 && drift.released.boost > 0,
          JSON.stringify(drift.released));
    check('turning the other way throws the charge away',
          !!drift.charged2 && drift.charged2.tier >= 0 && drift.flipped.tier === -1,
          JSON.stringify({charged: drift.charged2, flipped: drift.flipped}));
    check('creeping along cannot drift at all',
          drift.crawl.maxDrift === 0, JSON.stringify(drift.crawl));
    note(`the longest single slide over 90 seconds is ${drift.hunt.longest}s, across ` +
         `${drift.hunt.drifts} of them - which is what the three spark thresholds are ` +
         `scaled to`);
    note(`a committed lap spends ${(drift.run.driftPct * 100).toFixed(0)}% of itself ` +
         `sliding and ${(drift.run.boostPct * 100).toFixed(0)}% boosting, over ` +
         `${drift.run.drifts} drifts, topping out at ${drift.run.maxSpeed} blocks a second ` +
         `against 11.5 unboosted - and never once stuck`);

    /* Being lifted back onto the road, which is the thing that makes none of the above
       able to leave him stranded. */
    const rescue = await page.evaluate(() => {
      const H = window.__henrycraft;
      H.loadThemeSeed('racing', 4242);
      if (!H.kart()) H.toggleKart();
      H.clearKartMotion();
      /* Off the road and into whatever is out there, throttle down the whole way. */
      H.turn(Math.PI / 2);
      const r = H.drive(14, () => 0, () => 1);
      const p = H.player();
      const back = {onRoad: H.onRoad(p.x, p.y, p.z), clean: H.lapTimes().clean,
                    stuck: H.kartState().stuck};
      /* And parked up on purpose, with no throttle, he is left exactly where he is - looking
         at the view is not the same as being stuck. */
      H.loadThemeSeed('racing', 4242);
      if (!H.kart()) H.toggleKart();
      H.clearKartMotion();
      H.turn(Math.PI / 2);
      H.drive(3.0, () => 0, () => 1);          /* out onto the grass */
      const parkedAt = H.player();
      H.drive(4.0, () => 0, () => 0);          /* let go, and wait */
      const stillAt = H.player();
      return {back, moved: +Math.hypot(stillAt.x - parkedAt.x, stillAt.z - parkedAt.z).toFixed(2),
              parkedOnRoad: H.onRoad(stillAt.x, stillAt.y, stillAt.z),
              minY: r.minY};
    });
    check('driving into the scenery and holding the throttle puts him back on the road',
          rescue.back.onRoad === true && rescue.minY > 0, JSON.stringify(rescue));
    /* A leg-up, so the lap it happened on cannot become his best - the same rule flying gets. */
    check('and the lap he was carried through cannot become his best',
          rescue.back.clean === false, JSON.stringify(rescue.back));
    /* And it must not fire when he has simply parked. */
    check('parking off the road on purpose leaves him exactly where he parked',
          rescue.parkedOnRoad === false && rescue.moved < 2.5, JSON.stringify(rescue));
    note(`held against the scenery he is set back on the road within ${1.4}s; parked with ` +
         `the throttle off he stays put (moved ${rescue.moved} blocks in four seconds)`);

    // ---- 8e: item boxes ------------------------------------------------------
    console.log('\n8e. item boxes, and not one of them can hurt anybody');
    const items = await page.evaluate(async () => {
      const H = window.__henrycraft, ids = H.ids;
      H.loadThemeSeed('racing', 4242);
      const t = H.track();
      const boxes = H.itemBoxes();
      /* Every box has to be over the road, at a height a kart drives through, and inside
         the world. A box out on the grass is a box he never finds. */
      let onRoad = 0, reachable = 0;
      boxes.forEach(b => {
        const under = H.getBlock(Math.floor(b.x), t.y, Math.floor(b.z));
        if (under === ids.ROAD || under === ids.ROADLINE || under === ids.GRID) onRoad++;
        if (b.y - t.y > 0.5 && b.y - t.y < 2.6) reachable++;
      });
      /* Now drive, and see whether they are collected and whether they come back. */
      if (!H.kart()) H.toggleKart();
      H.clearKartMotion();
      const before = H.itemBoxes().filter(b => b.out).length;
      H.drive(25, () => H.autoSteer(), () => H.autoThrottle());
      /* The running total, not how many are away right now. A box collected ten seconds ago
         has already come back and is indistinguishable from one never touched - which is
         how the first version of this reported one pickup out of five. */
      const collected = H.itemsTaken();
      const down = H.itemBoxes().map((b, i) => (b.out ? -1 : i)).filter(i => i >= 0);
      const held = H.itemHeld();
      /* Now wait for them without collecting any more: out of the kart, the timers still
         run and pickups do not. Driving on instead collects fresh boxes, so the count never
         settles and "they all came back" can never be true. */
      H.toggleKart();
      H.drive(9, () => 0, () => 0);
      const stillDown = H.itemBoxes().map((b, i) => (b.out ? -1 : i)).filter(i => i >= 0);
      return {n: boxes.length, onRoad, reachable, before, collected, held, down, stillDown,
              lap: H.lapLength()};
    });
    check(`there are ${items.n} boxes and every one is over the road`,
          items.n >= 4 && items.onRoad === items.n, JSON.stringify(items));
    check('at a height a kart drives through',
          items.reachable === items.n, JSON.stringify(items));
    check(`driving through them collects them (${items.collected} in 25 seconds)`,
          items.collected >= 3 && items.held !== null, JSON.stringify(items));
    check('and every one comes back, so a lap is never used up',
          items.down.length > 0 && items.stillDown.length === 0, JSON.stringify(items));
    note(`${items.n} boxes round a ${items.lap}-block lap; ${items.collected} collected in ` +
         `25 seconds, and the ${items.down.length} still away all came back within nine`);

    /* The rubber band, measured. Weighted towards a plain mushroom when he is in front and
       towards the good ones when he is behind - which is the whole catch-up mechanic here,
       because nothing gets thrown at anybody. */
    const weights = await page.evaluate(() => {
      const H = window.__henrycraft;
      H.loadThemeSeed('racing', 4242);
      return {lead: H.rollItems(0, 4000), mid: H.rollItems(0.5, 4000),
              back: H.rollItems(1, 4000)};
    });
    const share = (r, k) => r[k] / Object.keys(r).reduce((a, x) => a + r[x], 0);
    check('in front he mostly gets a plain mushroom',
          share(weights.lead, 'mushroom') > 0.5 && share(weights.lead, 'star') < 0.1,
          JSON.stringify(weights.lead));
    check('a long way behind he mostly gets the good ones',
          share(weights.back, 'golden') + share(weights.back, 'star') > 0.5 &&
          share(weights.back, 'mushroom') < 0.15, JSON.stringify(weights.back));
    check('and every box gives something - there is no empty one',
          Object.keys(weights.mid).every(k => weights.mid[k] > 0), JSON.stringify(weights.mid));
    note(`in front: ${(share(weights.lead, 'mushroom') * 100).toFixed(0)}% mushroom, ` +
         `${(share(weights.lead, 'star') * 100).toFixed(0)}% star. Behind: ` +
         `${(share(weights.back, 'mushroom') * 100).toFixed(0)}% mushroom, ` +
         `${((share(weights.back, 'golden') + share(weights.back, 'star')) * 100).toFixed(0)}% ` +
         `golden or star`);

    /* What each item does, and - the part that matters - what none of them does. */
    const effects = await page.evaluate(() => {
      const H = window.__henrycraft, out = {};
      ['mushroom', 'triple', 'golden', 'star'].forEach(k => {
        H.loadThemeSeed('racing', 4242);
        if (!H.kart()) H.toggleKart();
        H.clearKartMotion();
        const before = H.kartState();
        H.giveItemNamed(k);
        const after = H.kartState();
        /* A star makes the grass as quick as the road, which is the strongest thing any of
           them does. Measured by driving off the track with one and seeing the speed. */
        H.drive(0.02, () => 0, () => 1);
        out[k] = {boostBefore: before.boost, boost: after.boost, star: after.star};
      });
      /* And with a star, grass is not slow. */
      H.loadThemeSeed('racing', 4242);
      if (!H.kart()) H.toggleKart();
      H.clearKartMotion();
      H.turn(Math.PI / 2);
      const plain = H.drive(6, () => 0, () => 1).maxSpeed;
      H.loadThemeSeed('racing', 4242);
      if (!H.kart()) H.toggleKart();
      H.clearKartMotion();
      H.turn(Math.PI / 2);
      H.giveItemNamed('star');
      const starred = H.drive(6, () => 0, () => 1).maxSpeed;
      return {out, plain, starred};
    });
    check('every item gives a boost, and the good ones give a longer one',
          effects.out.mushroom.boost > 0 &&
          effects.out.triple.boost > effects.out.mushroom.boost &&
          effects.out.golden.boost > effects.out.triple.boost,
          JSON.stringify(effects.out));
    check('only the star changes anything besides the boost',
          effects.out.star.star > 0 && effects.out.mushroom.star === 0 &&
          effects.out.triple.star === 0 && effects.out.golden.star === 0,
          JSON.stringify(effects.out));
    note(`a mushroom is worth ${effects.out.mushroom.boost}s of boost, three ` +
         `${effects.out.triple.boost}s, a golden one ${effects.out.golden.boost}s, and a ` +
         `star ${effects.out.star.boost}s plus ${effects.out.star.star}s of fast grass`);

    /* Where a message lands. He drove a lap with his son and told me the power-up messages
       came up "very large in the middle of the screen and it blocks your view" - which they
       did: the same 46-pixel toast that is right for a five-year-old pottering about is a
       blindfold at fifteen blocks a second. */
    console.log('\n8e2. messages get out of the way while he is driving');
    const msgs = await page.evaluate(async () => {
      const H = window.__henrycraft;
      H.loadThemeSeed('racing', 4242);
      document.getElementById('playBtn').click();
      const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      /* Read the moment the message is said, with no frame in between. A message
         clears itself after 1150ms of wall clock, while `frame()` waits two animation
         frames - so on a runner drawing a frame and a half a second the wait outlives
         the thing it is waiting for, and the check reports a message that never showed.
         It did show: the failure had the right text in the right chip at the right
         size, with the class already gone. Nothing here needs a frame anyway, because
         toast() sets the class and the kart flag synchronously. The frames that remain
         are after toggleKart, which repaints the HUD. */
      if (H.kart()) H.toggleKart();
      await frame();
      H.say('On foot message');
      const walking = H.messages();
      H.toggleKart();
      await frame();
      H.say('Driving message');
      const driving = H.messages();
      /* A real item, through the real path, rather than a test poking the toast. */
      H.giveItemNamed('golden');
      const item = H.messages();
      H.toggleKart();
      await frame();
      H.say('Out again');
      const back = H.messages();
      return {walking, driving, item, back};
    });
    check('on foot a message is the big one across the middle, as it always was',
          msgs.walking.big.shown === true && msgs.walking.small.shown === false &&
          parseFloat(msgs.walking.big.size) >= 26, JSON.stringify(msgs.walking));
    check('in the kart it is the small one out of the way instead',
          msgs.driving.small.shown === true && msgs.driving.big.shown === false &&
          parseFloat(msgs.driving.small.size) <= 16, JSON.stringify(msgs.driving));
    /* And a power-up says so through the same path, which is the one he complained about. */
    check('and a power-up goes the same way rather than over the road',
          msgs.item.small.shown === true && msgs.item.big.shown === false &&
          /mushroom/i.test(msgs.item.small.text), JSON.stringify(msgs.item));
    check('getting out puts messages back in the middle',
          msgs.back.big.shown === true && msgs.back.small.shown === false,
          JSON.stringify(msgs.back));
    note(`driving messages are ${msgs.driving.small.size} in a chip under the clock, ` +
         `against ${msgs.walking.big.size} across the middle on foot`);

    // ---- 8f: the book of lap times -------------------------------------------
    console.log('\n8f. every lap he has driven, in a list he can open');
    const book = await page.evaluate(async () => {
      const H = window.__henrycraft;
      H.loadThemeSeed('racing', 4242);
      document.getElementById('playBtn').click();
      if (!H.kart()) H.toggleKart();
      H.clearKartMotion();
      const empty = H.lapBook();
      /* Three laps, and see whether all three are written down. */
      let laps = H.laps();
      for (let i = 0; i < 250 && H.lapLog().length < 3; i++) {
        H.drive(1, () => H.autoSteer(), () => H.autoThrottle());
      }
      const log = H.lapLog();
      const shown = H.lapBook();
      /* Opening and closing it, the way he would. */
      H.openLapBook();
      const opened = H.lapBook().open;
      H.closeLapBook();
      const closed = H.lapBook().open;
      return {empty, log, shown, opened, closed, laps: H.laps(),
              times: H.lapTimes()};
    });
    check('an empty book says so rather than showing nothing at all',
          book.empty.rows.length === 0, JSON.stringify(book.empty));
    check(`every lap he drives is written down (${book.log.length} of them)`,
          book.log.length >= 3 && book.log.every(l => l.t > 20 && l.t < 120),
          JSON.stringify(book.log));
    check('and the list shows one row per lap, newest first',
          book.shown.rows.length === book.log.length &&
          book.shown.rows[0].text.indexOf(book.log[book.log.length - 1].t.toFixed(1)) >= 0,
          JSON.stringify({rows: book.shown.rows, log: book.log}));
    /* Exactly one row is the best, and it is the quickest clean lap in the book. */
    const bestRows = book.shown.rows.filter(r => r.best);
    const cleanTimes = book.log.filter(l => l.clean).map(l => l.t);
    check('exactly one lap is marked as his best, and it is the quickest clean one',
          bestRows.length === 1 &&
          bestRows[0].text.indexOf(Math.min(...cleanTimes).toFixed(1)) >= 0,
          JSON.stringify({bestRows, cleanTimes}));
    check('tapping the clock opens the list and the button closes it',
          book.opened === true && book.closed === false,
          JSON.stringify({opened: book.opened, closed: book.closed}));
    note(`${book.log.length} laps in the book: ` +
         `${book.log.map(l => l.t.toFixed(1) + 's' + (l.clean ? '' : ' (helped)')).join(', ')}`);

    /* And the book survives a reload, because it is saved with the district. */
    const bookSaved = await page.evaluate(async () => {
      const H = window.__henrycraft;
      await H.createDistrict('Lap Book Circuit', 'racing');
      if (!H.kart()) H.toggleKart();
      H.clearKartMotion();
      for (let i = 0; i < 250 && H.lapLog().length < 2; i++) {
        H.drive(1, () => H.autoSteer(), () => H.autoThrottle());
      }
      return {slug: H.districts().current, log: H.lapLog(), best: H.lapTimes().best};
    });
    await page.reload({waitUntil: 'load'});
    await page.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready());
    const bookAfter = await page.evaluate(() => {
      const H = window.__henrycraft;
      return {slug: H.districts().current, log: H.lapLog(), best: H.lapTimes().best};
    });
    check('the book is still there after closing the game',
          bookAfter.slug === bookSaved.slug &&
          JSON.stringify(bookAfter.log) === JSON.stringify(bookSaved.log) &&
          bookAfter.best === bookSaved.best,
          JSON.stringify({before: bookSaved, after: bookAfter}));
    note(`${bookSaved.log.length} laps and a best of ${bookSaved.best}s survived a reload`);

    // ---- 9: a bigger world, and only where it was asked for -----------------
    console.log('\n9. a racing district is bigger, and nothing else changed size');
    const sizes = await page.evaluate(() => {
      const H = window.__henrycraft, out = {};
      /* Switch back and forth, so the second visit to each theme proves the world is
         resized both ways rather than only growing once. */
      ['meadow', 'racing', 'snowy', 'racing', 'island', 'mushroom', 'desert', 'racing']
        .forEach(k => {
          H.loadThemeSeed(k, 7000);
          const d = H.dims();
          out[k] = {WX: d.WX, WZ: d.WZ, WY: d.WY, chunks: H.chunkCount(),
                    /* the block at the far corner has to exist, which it cannot if the
                       array was not reallocated with the world */
                    corner: H.getBlock(d.WX - 1, 0, d.WZ - 1)};
        });
      return out;
    });
    check('a racing district is 128 blocks across',
          sizes.racing.WX === 128 && sizes.racing.WZ === 128,
          JSON.stringify(sizes.racing));
    check('and every other theme is still exactly 64, as its saves expect',
          ['meadow', 'snowy', 'island', 'mushroom', 'desert']
            .every(k => sizes[k].WX === 64 && sizes[k].WZ === 64),
          JSON.stringify(sizes));
    check('the height of the world never changes, whatever the theme',
          Object.keys(sizes).every(k => sizes[k].WY === sizes.meadow.WY),
          JSON.stringify(sizes));
    /* Bedrock at the far corner. If the block array had not been reallocated to the new
       size, reading there would fall off the end and come back as air or undefined - which
       is exactly the bug that would corrupt a world quietly rather than loudly. */
    check('the far corner of every world is real ground, not off the end of the array',
          Object.keys(sizes).every(k => sizes[k].corner > 0),
          JSON.stringify(sizes));
    check('and the chunk grid is rebuilt to match, both growing and shrinking',
          sizes.racing.chunks === 64 && sizes.meadow.chunks === 16 &&
          sizes.snowy.chunks === 16,
          JSON.stringify(sizes));
    note(`racing ${sizes.racing.WX}x${sizes.racing.WZ} in ${sizes.racing.chunks} chunks; ` +
         `every other theme ${sizes.meadow.WX}x${sizes.meadow.WZ} in ` +
         `${sizes.meadow.chunks}`);

    /* What the bigger world costs on the device that matters, which is his tablet.

       I expected to have to earn this back with distance culling and wrote some, and
       measuring said it saved nothing: the fog reaches 118 blocks and a racing district is
       128 across, so the whole world is inside the fog wherever he stands. Measuring also
       said the culling was not needed, because a racing district is *cheaper* to draw than
       a meadow - a flat road shows far fewer faces than a hillside does. So the check is
       the honest version of what I set out to prove: driving round a circuit must not cost
       more than standing in an ordinary district already does. */
    const cost = await page.evaluate(async () => {
      const H = window.__henrycraft;
      const out = {};
      const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (const k of ['meadow', 'racing']) {
        const t0 = performance.now();
        H.loadThemeSeed(k, 4242);
        const genMs = performance.now() - t0;
        H.groundLevelFog();
        document.getElementById('playBtn') && document.getElementById('playBtn').click();
        if (k === 'racing' && !H.kart()) H.toggleKart();
        /* Mid-circuit and pointing along the road, which is where he spends the lap -
           measuring from the spawn point at the edge would flatter it. */
        if (k === 'racing') H.drive(6, () => H.autoSteer(), () => H.autoThrottle());
        H.lookAt();
        await frame();
        out[k] = Object.assign({genMs: Math.round(genMs)}, H.renderCost());
      }
      return out;
    });
    check('a racing district is no more expensive to draw than an ordinary one',
          cost.racing.calls <= cost.meadow.calls &&
          cost.racing.drawnTriangles <= cost.meadow.drawnTriangles,
          JSON.stringify(cost));
    /* Generating four times the terrain does cost four times as much, and that is the part
       he can actually feel - once, on the loading screen. A second is the ceiling; over
       that and a five-year-old thinks it is broken and taps something else. */
    check('and building one takes well under a second, even at four times the ground',
          cost.racing.genMs < 1000, JSON.stringify(cost));
    note(`from the driving seat a circuit costs ${cost.racing.calls} draw calls and ` +
         `${cost.racing.drawnTriangles} triangles, against ${cost.meadow.calls} and ` +
         `${cost.meadow.drawnTriangles} standing in a meadow`);
    note(`generating one takes ${cost.racing.genMs}ms against ${cost.meadow.genMs}ms ` +
         `for a district a quarter the size`);

    /* The one that would be unforgivable to get wrong.

       He already has racing districts, saved when one was 64 blocks across. A record holds
       its theme, its seed and the blocks he changed keyed by "x,y,z" - so growing the world
       has to leave every one of those blocks exactly where he put it. The circuit under
       them moves, because it is generated and the district is now four times the size; his
       diamond tower does not.

       This plants a record the way the old build would have left it and opens it through
       the ordinary switchDistrict path, which reads it back out of storage. The blocks are
       at 6,14,6 and 30,20,30 and 62,14,62 - the last one near the far corner of what used
       to be the whole world. */
    const BUILT = {'6,14,6': 11, '7,14,6': 11, '6,15,6': 11, '30,20,30': 10, '62,14,62': 8};
    const oldSave = await page.evaluate(async built => {
      const H = window.__henrycraft;
      await H.plantDistrict({name: 'Old Circuit', slug: 'old-circuit', theme: 'racing',
                             seed: 12345, starSeed: 12345, edits: built,
                             p: null, stars: null, sel: null, v: 2, portals: [],
                             created: '2026-08-01T00:00:00.000Z',
                             lastPlayed: '2026-08-01T00:00:00.000Z'});
      await H.switchDistrict('old-circuit');
      const kept = {};
      Object.keys(built).forEach(k => {
        const [x, y, z] = k.split(',').map(Number);
        kept[k] = H.getBlock(x, y, z);
      });
      return {wanted: built, kept, dims: H.dims(), slug: H.districts().current,
              hasTrack: !!H.track(), editsNow: Object.keys(H.editMap()).length};
    }, BUILT);
    check('a racing district saved when the world was 64 blocks still opens',
          oldSave.slug === 'old-circuit' && oldSave.hasTrack === true,
          JSON.stringify(oldSave));
    check('and it opens at the new size, without losing a single block he built',
          oldSave.dims.WX === 128 &&
          Object.keys(oldSave.wanted).every(k => oldSave.kept[k] === oldSave.wanted[k]),
          JSON.stringify(oldSave));
    note(`an old 64-block racing save opened at ${oldSave.dims.WX} blocks with all ` +
         `${oldSave.editsNow} of its built blocks where he left them`);

    check('no page errors anywhere in the run', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    try { await ctx.close(); } catch (_) {}
    try { await browser.close(); } catch (_) {}
    srv.close();
  }

  console.log(`\npassed ${passed}, failed ${failed}`);
  console.log('\nReported numbers');
  notes.forEach(n => console.log('  - ' + n));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
