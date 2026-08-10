#!/usr/bin/env node
/*
 * Henrycraft game tests.
 *
 *   node tools/test-game.js
 *
 * Drives the real index.html in headless Chromium and asserts against the live
 * world through window.__henrycraft. Needs Playwright and a Chromium; set
 * PLAYWRIGHT_PATH if it is not resolvable from here.
 *
 * Deliberately runs the shipped file rather than a copy, so a test can never
 * pass against something the tablet will not be running.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'index.html');
const SEEDS = 20;
const SIM_SECONDS = 60;
const VIEWPORTS = [
  {w: 853, h: 477},
  {w: 960, h: 544},
  {w: 800, h: 444},
];

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    'playwright',
    '/opt/node22/lib/node_modules/playwright',
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (_) { /* try the next one */ }
  }
  console.error('Could not load Playwright. Install it, or set PLAYWRIGHT_PATH.');
  process.exit(2);
}

/* A one-file static server. Serving over http rather than file:// keeps the page
   on a normal origin, the same as the WebView does via the asset loader. */
function serve() {
  const html = fs.readFileSync(PAGE);
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(html);
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
function note(line) { notes.push(line); console.log(`        ${line}`); }

/* Least-squares slope of d against t. Used to ask whether the shark's distance
   to Henry trends downward over time. */
function slope(pts) {
  const n = pts.length;
  if (n < 3) return 0;
  let st = 0, sd = 0;
  for (const p of pts) { st += p.t; sd += p.d; }
  const mt = st / n, md = sd / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.t - mt) * (p.d - md); den += (p.t - mt) ** 2; }
  return den === 0 ? 0 : num / den;
}

(async () => {
  const {chromium} = loadPlaywright();
  const {srv, port} = await serve();
  const url = `http://127.0.0.1:${port}/index.html`;

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext({
    viewport: {width: 1024, height: 700}, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto(url, {waitUntil: 'load'});
  await page.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready(),
                             {timeout: 60000});

  console.log('Henrycraft game tests\n');

  // ---- 1: atlas tiles unique, every UV inside the atlas ---------------------
  /* Henry himself must not drift as characters are added around him. Recorded
     before the avatar builder was parameterised, and again before it grew eight
     looks: 25 nodes, the same position hash, the same 22 material colours. */
  const henry = await page.evaluate(() => window.__henrycraft.avatarProbe());
  check(`Henry is built exactly as he was (${henry.nodes} nodes, hash ${henry.posHash})`,
        henry.nodes === 25 && henry.posHash === 5445.5 &&
        henry.colours === 'c5ad7e,8c0d0a,071a51,942307,942307,942307,942307,b8370a,' +
                          'b8370a,c5ad7e,dc8c54,c5ad7e,dc8c54,ffffff,dc8c54,36860b,' +
                          '36860b,ffffff,dc8c54,36860b,36860b,ffffff',
        JSON.stringify(henry));

  console.log('1. atlas tiles are unique and every UV lands inside the atlas');
  const atlas = await page.evaluate(() => {
    const H = window.__henrycraft, a = H.atlas(), slots = a.cols * a.rows;
    const bad = [], sides = {}, dupes = [];
    for (const id of Object.keys(H.DEFS)) {
      const def = H.DEFS[id];
      def.tiles.forEach((t, i) => {
        if (!Number.isInteger(t) || t < 0 || t >= slots) {
          bad.push({block: def.name, slot: i, tile: t});
          return;
        }
        // Same maths buildChunk uses, with its 0.03 tile inset.
        const PAD = 0.03, tx = t % a.cols, ty = Math.floor(t / a.cols);
        const u0 = (tx + PAD) / a.cols, u1 = (tx + 1 - PAD) / a.cols;
        const v0 = 1 - (ty + 1 - PAD) / a.rows, v1 = 1 - (ty + PAD) / a.rows;
        for (const v of [u0, u1, v0, v1]) {
          if (v < 0 || v > 1) bad.push({block: def.name, tile: t, uv: v});
        }
      });
      const side = def.tiles[2];
      if (sides[side] !== undefined) dupes.push(`${def.name} and ${sides[side]} share tile ${side}`);
      sides[side] = def.name;
    }
    return {slots, blocks: Object.keys(H.DEFS).length, bad, dupes, atlas: a};
  });
  check(`${atlas.blocks} blocks, all UVs inside the ${atlas.atlas.cols}x${atlas.atlas.rows} atlas`,
        atlas.bad.length === 0, JSON.stringify(atlas.bad.slice(0, 5)));
  check('every block has its own distinct side tile',
        atlas.dupes.length === 0, atlas.dupes.join('; '));

  // ---- 2: new blocks present and selectable --------------------------------
  console.log('2. the new blocks are in the palette and selectable');
  const sel = await page.evaluate(() => {
    const H = window.__henrycraft, want = ['COAL','COPPER','LAPIS','EMERALD','OBSIDIAN','ENCHANT','FIRE'];
    const missing = [], unselectable = [];
    for (const key of want) {
      const id = H.ids[key];
      if (H.PALETTE.indexOf(id) < 0) { missing.push(key); continue; }
      H.selectBlock(id);
      if (H.selected() !== id) unselectable.push(key);
    }
    return {missing, unselectable, size: H.PALETTE.length,
            slots: document.querySelectorAll('#pickerGrid .slot').length,
            names: want.map(k => H.DEFS[H.ids[k]].name)};
  });
  check(`palette holds ${sel.size} blocks including all 7 new ones`, sel.missing.length === 0,
        'missing: ' + sel.missing.join(', '));
  check('each new block can be selected', sel.unselectable.length === 0,
        'not selectable: ' + sel.unselectable.join(', '));
  check(`picker renders ${sel.slots} slots`, sel.slots === sel.size,
        `${sel.slots} slots for ${sel.size} palette entries`);
  note('new entries: ' + sel.names.join(', '));

  // ---- 3 + 4: ore across seeds, and the depth invariants -------------------
  console.log(`3. every world generates all the new ore (${SEEDS} seeds)`);
  const ORES = ['COAL','COPPER','LAPIS','EMERALD','OBSIDIAN','GOLD','DIAMOND'];
  const perSeed = [];
  for (let s = 0; s < SEEDS; s++) {
    const seed = 1000 + s * 7919;
    const r = await page.evaluate(({seed, ORES}) => {
      const H = window.__henrycraft;
      H.loadSeed(seed);
      const c = H.census(), out = {};
      for (const k of ORES) {
        const e = c[H.ids[k]];
        out[k] = e ? {count: e.count, minY: e.minY, maxY: e.maxY} : {count: 0};
      }
      // dig-down sampling from random dry surface columns
      const d = H.dims();
      let tried = 0, found = 0;
      for (let i = 0; i < 400; i++) {
        const x = 2 + Math.floor(Math.random() * (d.WX - 4));
        const z = 2 + Math.floor(Math.random() * (d.WZ - 4));
        if (H.surfaceY(x, z) <= d.waterLevel + 1) continue;
        tried++;
        const f = H.digDownFinds(x, z);
        if (f.ore !== null || f.cave) found++;
      }
      return {ore: out, dig: {tried, found}};
    }, {seed, ORES});
    perSeed.push({seed, ...r});
  }

  const worst = {};
  for (const k of ORES) worst[k] = Math.min(...perSeed.map(p => p.ore[k].count));
  const missingSeeds = perSeed.filter(p => ORES.some(k => p.ore[k].count === 0));
  check(`all ${SEEDS} seeds contain coal, copper, lapis, emerald and obsidian`,
        missingSeeds.length === 0,
        missingSeeds.map(p => p.seed).join(', '));
  note('worst-case blocks across seeds: ' +
       ORES.map(k => `${k.toLowerCase()} ${worst[k]}`).join(', '));

  const digTried = perSeed.reduce((a, p) => a + p.dig.tried, 0);
  const digFound = perSeed.reduce((a, p) => a + p.dig.found, 0);
  const digPct = (100 * digFound / digTried);
  const seedPct = perSeed.map(p => 100 * p.dig.found / p.dig.tried);
  check(`digging straight down finds ore or a cave ${digPct.toFixed(2)}% of the time (>90% required)`,
        digPct > 90, `${digFound}/${digTried}`);
  note(`per-seed range ${Math.min(...seedPct).toFixed(1)}% to ${Math.max(...seedPct).toFixed(1)}%`);

  console.log('4. obsidian and emerald stay inside their depth bands');
  const bands = await page.evaluate(() => {
    const H = window.__henrycraft, out = {};
    H.ORE_BANDS.forEach(b => { out[H.DEFS[b.id].name] = {minY: b.minY, maxY: b.maxY}; });
    return out;
  });
  const bandBreaks = [];
  for (const p of perSeed) {
    for (const k of ORES) {
      const e = p.ore[k];
      if (!e.count) continue;
      const nm = k.charAt(0) + k.slice(1).toLowerCase();
      const b = bands[nm === 'Obsidian' ? 'Obsidian' : nm];
      if (!b) continue;
      if (e.minY < b.minY || e.maxY > b.maxY) {
        bandBreaks.push(`seed ${p.seed} ${k} y${e.minY}..${e.maxY} outside ${b.minY}..${b.maxY}`);
      }
    }
  }
  check('every ore stays within its declared band on every seed',
        bandBreaks.length === 0, bandBreaks.slice(0, 4).join('; '));
  const obsMax = Math.max(...perSeed.filter(p => p.ore.OBSIDIAN.count).map(p => p.ore.OBSIDIAN.maxY));
  const emMax = Math.max(...perSeed.filter(p => p.ore.EMERALD.count).map(p => p.ore.EMERALD.maxY));
  note(`deepest-layer check: obsidian never above y=${obsMax} (band ${bands.Obsidian.minY}..${bands.Obsidian.maxY}), ` +
       `emerald never above y=${emMax} (band ${bands.Emerald.minY}..${bands.Emerald.maxY})`);

  // ---- 5 + 6: fish stay in water; the shark never closes in ----------------
  console.log(`5. aquatic animals never leave the water (${SEEDS} seeds)`);
  let totalViolations = 0, totalFish = 0, totalSteps = 0, minSecs = Infinity;
  const firstViolations = [];
  const lapDrifts = [];          // blocks per lap, per shark
  let sharkCount = 0, minSharkD = Infinity, worstLapMeanDrop = 0;

  for (let s = 0; s < SEEDS; s++) {
    const seed = 1000 + s * 7919;
    const r = await page.evaluate(({seed, minSecs}) => {
      const H = window.__henrycraft;
      H.loadSeed(seed);
      const sharks = H.fish().filter(f => f.kind === 'shark');
      // Park Henry a clear distance outside the circuit and leave him there, so
      // any change in distance can only be the shark moving.
      if (sharks.length) {
        const s0 = sharks[0];
        H.movePlayer(s0.x + (s0.radius || 4) + 8, s0.y + 2, s0.z + 4);
      }
      // Long enough for at least three full laps of the slowest shark, so
      // per-lap averages can be compared. Never shorter than the required 60s.
      const maxPeriod = sharks.reduce((a, f) => Math.max(a, f.period || 0), 0);
      const secs = Math.max(minSecs, Math.ceil(maxPeriod * 3));
      return {sim: H.simulate(secs), sharks: sharks.length};
    }, {seed, minSecs: SIM_SECONDS});

    totalViolations += r.sim.violationCount;
    totalFish += r.sim.fish;
    totalSteps += r.sim.steps;
    minSecs = Math.min(minSecs, r.sim.seconds);
    if (r.sim.violations.length && firstViolations.length < 4) {
      firstViolations.push(`seed ${seed}: ` + JSON.stringify(r.sim.violations[0]));
    }

    const byShark = {};
    for (const p of r.sim.sharkSamples) (byShark[p.i] = byShark[p.i] || []).push(p);
    for (const k of Object.keys(byShark)) {
      const pts = byShark[k];
      sharkCount++;
      minSharkD = Math.min(minSharkD, ...pts.map(p => p.d));

      // Mean distance per completed lap. Averaging over a whole lap removes the
      // circuit's own oscillation regardless of where in the lap sampling began,
      // which a regression on the raw distance cannot do: the least-squares
      // slope of a sinusoid over one period is -T*cos(phase)/omega, so it varies
      // with start phase even for a perfect circle that never approaches.
      const period = pts[0].period;
      if (!period) continue;
      const t0 = pts[0].t;
      const laps = [];
      for (let L = 0; ; L++) {
        const a = t0 + L * period, b = a + period;
        if (b > pts[pts.length - 1].t) break;
        const inLap = pts.filter(p => p.t >= a && p.t < b);
        if (inLap.length < 8) break;
        laps.push(inLap.reduce((acc, p) => acc + p.d, 0) / inLap.length);
      }
      if (laps.length < 2) continue;
      // slope of lap-mean distance against lap number: inward drift, in blocks
      // per lap. Zero for a fixed circuit; negative would mean closing in.
      lapDrifts.push(slope(laps.map((d, i) => ({t: i, d}))));
      worstLapMeanDrop = Math.min(worstLapMeanDrop, Math.min(...laps) - laps[0]);
    }
  }
  check(`no fish left the water in ${totalSteps.toLocaleString()} simulated steps`,
        totalViolations === 0, firstViolations.join(' | '));
  note(`${totalFish} fish across ${SEEDS} seeds, at least ${minSecs.toFixed(0)}s each, ` +
       `${totalSteps.toLocaleString()} steps, ${totalViolations} violations`);

  console.log('6. the shark never moves toward Henry');
  const worstDrift = Math.min(...lapDrifts);
  const meanDrift = lapDrifts.reduce((a, d) => a + d, 0) / lapDrifts.length;
  check(`mean distance to Henry does not fall lap on lap for any of ${sharkCount} sharks`,
        worstDrift >= -0.01,
        `worst inward drift ${worstDrift.toFixed(6)} blocks per lap`);
  // The decisive statistic. Residual per-shark drift is lap-averaging noise and
  // scatters either side of zero; a shark that were closing in would push every
  // shark negative and drag this mean well below zero with it.
  check('no systematic inward bias across all sharks',
        Math.abs(meanDrift) < 0.005,
        `mean drift ${meanDrift.toExponential(2)} blocks/lap`);
  note(`per-lap drift ranges ${Math.min(...lapDrifts).toExponential(2)} to ` +
       `${Math.max(...lapDrifts).toExponential(2)} blocks/lap over ${lapDrifts.length} sharks, ` +
       `mean ${meanDrift.toExponential(2)}; closest approach anywhere ${minSharkD.toFixed(2)} blocks`);

  // The real safety property, and much stronger than any trend line: the path
  // is byte-identical with Henry standing somewhere completely different, so it
  // cannot be reacting to him.
  const indep = await page.evaluate(({secs}) => {
    const H = window.__henrycraft;
    function run(offset) {
      H.loadSeed(555001);
      const sharks = H.fish().filter(f => f.kind === 'shark');
      if (!sharks.length) return null;
      const s0 = sharks[0];
      H.movePlayer(s0.x + offset, s0.y + offset / 3, s0.z - offset);
      return H.simulate(secs).sharkSamples.map(p => `${p.i}:${p.x},${p.y},${p.z}`).join('|');
    }
    const near = run(9), far = run(140);
    return {ok: near !== null && near === far, len: near ? near.length : 0};
  }, {secs: 20});
  check('the shark follows the same path wherever Henry stands (path is player-independent)',
        indep.ok, 'shark trajectory differed when the player moved');

  // ---- 7: fire never spreads ----------------------------------------------
  console.log('7. fire never spreads');
  const fire = await page.evaluate(({secs}) => {
    const H = window.__henrycraft, d = H.dims();
    H.loadSeed(4242);
    // Find dry ground and put a flame on top of it.
    let px = 0, pz = 0, sy = 0;
    for (let i = 0; i < 5000; i++) {
      const x = 6 + Math.floor(Math.random() * (d.WX - 12));
      const z = 6 + Math.floor(Math.random() * (d.WZ - 12));
      const y = H.surfaceY(x, z);
      if (y > d.waterLevel + 2 && y < d.WY - 6) { px = x; pz = z; sy = y; break; }
    }
    const R = 3;
    const before = [];
    for (let dy = -R; dy <= R; dy++)
      for (let dz = -R; dz <= R; dz++)
        for (let dx = -R; dx <= R; dx++)
          before.push(H.getBlock(px + dx, sy + dy, pz + dz));

    H.setBlock(px, sy, pz, H.ids.FIRE);
    const lit = H.getBlock(px, sy, pz) === H.ids.FIRE;
    const sim = H.simulate(secs);

    const after = [];
    for (let dy = -R; dy <= R; dy++)
      for (let dz = -R; dz <= R; dz++)
        for (let dx = -R; dx <= R; dx++)
          after.push(H.getBlock(px + dx, sy + dy, pz + dz));

    let changed = 0, centre = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i] === after[i]) continue;
      // the block we lit ourselves is the one legitimate change
      const n = 2 * R + 1;
      const dx = (i % n) - R, dz = (Math.floor(i / n) % n) - R, dy = Math.floor(i / (n * n)) - R;
      if (dx === 0 && dy === 0 && dz === 0) { centre++; continue; }
      changed++;
    }
    // and it can still be dug away like anything else
    H.setBlock(px, sy, pz, H.ids.AIR);
    const dug = H.getBlock(px, sy, pz) === H.ids.AIR;
    return {lit, changed, centre, cells: before.length, seconds: sim.seconds,
            dug, fireLeft: H.fireCount()};
  }, {secs: SIM_SECONDS});
  check('fire places and is the only block that changed', fire.lit && fire.centre === 1,
        `lit=${fire.lit} centre changes=${fire.centre}`);
  check(`no neighbour changed in ${fire.seconds}s (${fire.cells - 1} cells watched)`,
        fire.changed === 0, `${fire.changed} neighbours changed`);
  check('fire can be dug away again', fire.dug && fire.fireLeft === 0,
        `dug=${fire.dug} fireCount=${fire.fireLeft}`);

  await ctx.close();

  // ---- 8: layout at the three required sizes ------------------------------
  console.log('8. controls and picker clear the centre of the screen');
  const overlap = (a, b) =>
    !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);

  for (const v of VIEWPORTS) {
    const c2 = await browser.newContext({
      viewport: {width: v.w, height: v.h}, hasTouch: true, isMobile: true,
    });
    const p2 = await c2.newPage();
    const errs2 = [];
    p2.on('pageerror', e => errs2.push(e.message));
    await p2.goto(url, {waitUntil: 'load'});
    await p2.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready(),
                             {timeout: 60000});
    await p2.click('#playBtn');
    await p2.waitForTimeout(500);
    // open the picker, which is the tallest thing on screen
    await p2.evaluate(() => document.getElementById('blockBtn')
      .dispatchEvent(new PointerEvent('pointerdown', {bubbles: true})));
    await p2.waitForTimeout(250);

    const r = await p2.evaluate(() => {
      const g = id => {
        const b = document.getElementById(id).getBoundingClientRect();
        return {left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width, h: b.height};
      };
      // The middle of the screen is where Henry and the crosshair are; nothing
      // may cover it.
      const cw = Math.min(240, window.innerWidth * 0.3), chh = Math.min(200, window.innerHeight * 0.4);
      return {
        pads: g('pads'), stick: g('stick'), topLeft: g('topLeft'), topRight: g('topRight'),
        blockBtn: g('blockBtn'), card: document.querySelector('.pickcard').getBoundingClientRect(),
        rows: getComputedStyle(document.getElementById('pickerGrid')).gridTemplateRows.split(' ').length,
        cols: getComputedStyle(document.getElementById('pickerGrid')).gridTemplateColumns.split(' ').length,
        centre: {
          left: window.innerWidth / 2 - cw / 2, right: window.innerWidth / 2 + cw / 2,
          top: window.innerHeight / 2 - chh / 2, bottom: window.innerHeight / 2 + chh / 2,
        },
        vw: window.innerWidth, vh: window.innerHeight,
      };
    });

    const fails = [];
    if (overlap(r.pads, r.topRight)) fails.push('pads over top-right chips');
    if (overlap(r.pads, r.topLeft)) fails.push('pads over top-left chips');
    if (overlap(r.pads, r.stick)) fails.push('pads over stick');
    if (overlap(r.blockBtn, r.pads)) fails.push('block button over pads');
    if (overlap(r.blockBtn, r.stick)) fails.push('block button over stick');
    if (r.pads.top < 0) fails.push('pads off the top');
    if (overlap(r.pads, r.centre)) fails.push('pads over the centre of the screen');
    if (overlap(r.stick, r.centre)) fails.push('stick over the centre of the screen');
    // the picker is modal, so it is allowed over the centre, but must fit
    if (r.card.top < 0 || r.card.bottom > r.vh) fails.push('picker taller than the screen');
    if (r.card.left < 0 || r.card.right > r.vw) fails.push('picker wider than the screen');
    if (errs2.length) fails.push('page errors: ' + errs2.join(' | '));

    check(`${v.w}x${v.h}  picker ${r.cols}x${r.rows}, card ${Math.round(r.card.width)}x${Math.round(r.card.height)}`,
          fails.length === 0, fails.join('; '));
    await c2.close();
  }

  // The desktop palette wraps to a variable number of rows now that there are 19
  // blocks, so the hint line above it has to be measured into place. Checked at
  // several widths because the row count is what changes.
  console.log('8b. desktop palette and hint line do not collide');
  for (const v of [{w: 1440, h: 900}, {w: 1280, h: 800}, {w: 1024, h: 640}, {w: 800, h: 600}]) {
    const c3 = await browser.newContext({viewport: {width: v.w, height: v.h}});
    const p3 = await c3.newPage();
    await p3.goto(url, {waitUntil: 'load'});
    await p3.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready(),
                             {timeout: 60000});
    await p3.click('#playBtn');
    await p3.waitForTimeout(400);
    const r = await p3.evaluate(() => {
      const pal = document.getElementById('palette').getBoundingClientRect();
      const hint = document.getElementById('hint').getBoundingClientRect();
      const slots = [...document.querySelectorAll('#palette .slot')];
      return {
        overlap: !(pal.bottom <= hint.top || hint.bottom <= pal.top),
        palH: Math.round(pal.height), hintTop: Math.round(hint.top),
        offTop: pal.top < 0 || hint.top < 0,
        slots: slots.length,
        onScreen: slots.every(s => {
          const b = s.getBoundingClientRect();
          return b.left >= 0 && b.right <= window.innerWidth && b.bottom <= window.innerHeight;
        }),
      };
    });
    const fails = [];
    if (r.overlap) fails.push('palette overlaps the hint line');
    if (r.offTop) fails.push('palette or hint off the top of the window');
    if (!r.onScreen) fails.push('a palette slot is off screen');
    if (r.slots !== 19) fails.push(`${r.slots} slots, expected 19`);
    check(`${v.w}x${v.h}  palette ${r.palH}px tall, hint clear above it`,
          fails.length === 0, fails.join('; '));
    await c3.close();
  }

  check('no page errors during the whole run', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  srv.close();

  console.log(`\npassed ${passed}, failed ${failed}`);
  console.log('\nReported numbers');
  notes.forEach(n => console.log('  - ' + n));
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
