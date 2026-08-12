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
        for (let k = 0; k < t.pts.length; k++) {
          const p = t.pts[k], q = t.pts[(k + 1) % t.pts.length];
          const r = Math.hypot(p.x - t.cx, p.z - t.cz);
          minR = Math.min(minR, r); maxR = Math.max(maxR, r);
          if (p.x < t.half + 2 || p.z < t.half + 2 ||
              p.x > 64 - t.half - 2 || p.z > 64 - t.half - 2) offWorld++;
          biggestStep = Math.max(biggestStep, Math.hypot(p.x - q.x, p.z - q.z));
          /* Height changes have to be gentle, or the road is a staircase. */
          worst = Math.max(worst, Math.abs(p.y - q.y));
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
                  biggestStep: +biggestStep.toFixed(2), pinch: +pinch.toFixed(1)});
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
    check('the road never steps up more than a block at a time',
          shapes.every(s => s.worstStep <= 1),
          JSON.stringify(shapes.filter(s => s.worstStep > 1)));
    const rs = shapes.filter(s => !s.missing);
    note(`lap radius ranges ${Math.min(...rs.map(s => s.minR))} to ` +
         `${Math.max(...rs.map(s => s.maxR))} blocks across ${rs.length} seeds`);

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
          /* Find the column's real driving surface first, then look up from it. The
             column takes its height from whichever sample is nearest, which at a change
             of gradient is the sample before or after this one - so the road can be a
             block above the height sampled here. Measuring clearance from the sampled
             height instead reported the road surface itself as an obstruction standing
             in the road, which is a fine example of a test being confidently wrong. */
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
        const samples = Math.ceil(t.pts.length / 7);
        out.push({seed: 3000 + i * 37, samples, road, wet, blocked, kerbs});
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
    check('the road is kerbed rather than just ending',
          built.every(b => b.kerbs > b.samples * 0.8),
          JSON.stringify(built.map(b => ({seed: b.seed, kerbs: b.kerbs, of: b.samples}))));
    note(`checked ${built[0].samples} points round each of ${SEEDS} circuits`);

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
        /* Forty seconds of driving, steering for the centre line the way a person
           does. One lap is about 140 blocks; at kart pace that is well inside it. */
        const r = H.drive(40, () => H.autoSteer());
        out.push({seed: 3000 + i * 37, turned: r.turned, laps: r.laps,
                  offRoad: r.offRoadFrames, frames: r.frames,
                  maxSpeed: r.maxSpeed, minY: r.minY});
        if (H.kart()) H.toggleKart();
      }
      return out;
    }, SEEDS);
    check(`a full lap is driveable on all ${SEEDS} seeds`,
          laps.every(l => l.turned >= 1),
          JSON.stringify(laps.filter(l => l.turned < 1)
                             .map(l => ({seed: l.seed, turned: l.turned}))));
    check('and the lap counter notices',
          laps.every(l => l.laps >= 1),
          JSON.stringify(laps.filter(l => l.laps < 1).map(l => ({seed: l.seed, laps: l.laps}))));
    check('the kart stays on the road nearly all the way round',
          laps.every(l => l.offRoad / l.frames < 0.25),
          JSON.stringify(laps.map(l => ({seed: l.seed,
                                         off: +(l.offRoad / l.frames).toFixed(2) }))));
    check('and never falls out of the world',
          laps.every(l => l.minY > 0), JSON.stringify(laps.filter(l => l.minY <= 0)));
    const turns = laps.map(l => l.turned);
    note(`laps driven per 40s: ${Math.min(...turns).toFixed(2)} to ` +
         `${Math.max(...turns).toFixed(2)}; top speed ` +
         `${Math.max(...laps.map(l => l.maxSpeed)).toFixed(1)} blocks a second`);

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
      const r = H.drive(45, () => H.autoSteer());
      return {before, after: H.starsFound(), total: H.stars().length, turned: r.turned};
    });
    check('driving round collects the stars he drives through',
          collected.after > collected.before, JSON.stringify(collected));
    note(`one lap and a bit collected ${collected.after} of ${collected.total} stars`);

    // ---- 6: nothing here can hurt him --------------------------------------
    console.log('\n6. nothing about racing can hurt, trap or end anything');
    const safe = await page.evaluate(async () => {
      const H = window.__henrycraft, ids = H.ids;
      H.loadThemeSeed('racing', 4242);
      if (!H.kart()) H.toggleKart();
      /* Drive straight off the track and keep going, into whatever is out there. */
      const off = H.drive(12, () => 0.85);
      const stillDriving = H.kart();
      const p = H.player();
      /* Off the road is slower and nothing else: no stop, no damage, no reset. */
      const offRoadSpeed = Math.hypot(p.vx, p.vz);
      /* And he can always get out, wherever he is. */
      H.toggleKart();
      const outNow = !H.kart();
      const p2 = H.player();
      return {off, stillDriving, outNow, offRoadSpeed: +offRoadSpeed.toFixed(2),
              inWorld: p2.x > 0 && p2.x < 64 && p2.z > 0 && p2.z < 64 && p2.y > 0,
              stars: H.stars().length, laps: H.laps()};
    });
    check('driving off the circuit does not stop him or take anything away',
          safe.stillDriving === true && safe.off.minY > 0, JSON.stringify(safe));
    check('he can get out of the kart wherever he happens to be',
          safe.outNow === true && safe.inWorld === true, JSON.stringify(safe));
    check('and the lap count never goes backwards or below zero',
          safe.laps >= 0, JSON.stringify(safe));
    note(`off the road he still rolls at ${safe.offRoadSpeed} blocks a second, ` +
         `and nothing stops him`);

    /* Reversing round the lap must not count laps - being given a lap for going
       backwards is confusing, and taking one away would be worse. */
    const backwards = await page.evaluate(() => {
      const H = window.__henrycraft;
      H.loadThemeSeed('racing', 4242);
      if (!H.kart()) H.toggleKart();
      const forwards = H.drive(20, () => H.autoSteer());
      const after = H.laps();
      /* Now spin round and go back the way he came. */
      H.turn(Math.PI);
      const back = H.drive(20, () => -H.autoSteer());
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
