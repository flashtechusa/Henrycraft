#!/usr/bin/env node
/*
 * Portal tests.
 *
 *   node tools/test-portals.js
 *
 * Tests 5, 6 and 7 are the ones that matter: a missing return portal or an unsafe
 * arrival strands him, and a lost edit destroys something he built. Those three
 * run 50 trials across every theme rather than once.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html': 'text/html', '.png': 'image/png',
               '.webmanifest': 'application/manifest+json'};
const TRIALS = 50;

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
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(url, {waitUntil: 'load'});
  await page.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready(),
                             {timeout: 60000});

  console.log('Henrycraft portal tests\n');

  // The theme blocks were missing from the test hook's id map, so ids.SNOW was
  // undefined and several tests silently filled with grass instead. Check the
  // map covers every block before trusting anything below it.
  const idCover = await page.evaluate(() => {
    const H = window.__henrycraft, missing = [];
    for (const id of Object.keys(H.DEFS)) {
      if (!Object.values(H.ids).includes(+id)) missing.push(H.DEFS[id].name);
    }
    return {missing, count: Object.keys(H.ids).length};
  });
  check(`every block has an entry in the test id map (${idCover.count} ids)`,
        idCover.missing.length === 0, 'missing: ' + idCover.missing.join(', '));


  // ---- 1: frame detection, both planes, every size 1x2 .. 21x21 -------------
  console.log('1. frames are detected in both vertical planes at every size');
  const sizes = await page.evaluate(() => {
    const H = window.__henrycraft;
    const MAX = H.portalMax();
    const bad = [], seen = [];
    // Every extreme, plus a spread through the middle rather than only small ones.
    const cases = [];
    for (const [w, h] of [[1,2],[2,1],[1,MAX],[MAX,1],[2,3],[MAX,MAX],[MAX,MAX-1],[20,21]]) cases.push([w,h]);
    for (let i = 0; i < 14; i++) {
      cases.push([1 + Math.floor(Math.random() * MAX), 1 + Math.floor(Math.random() * MAX)]);
    }
    const dims = H.dims();
    for (const plane of ['x', 'z']) {
      for (const [w, h] of cases) {
        if (w * h < 2) continue;
        H.loadThemeSeed('meadow', 777);
        // High enough to clear the terrain, low enough that a 21-tall frame plus
        // its ring still fits under the world ceiling - at y=26 a 21-high frame
        // ran off the top and its ring could not be placed.
        const ay = Math.max(2, Math.min(26, dims.WY - h - 3));
        const b = H.buildFrame({plane, w, h, ax: 6, ay, fixed: 30, fill: H.ids.GRASS});
        const r = H.analyse(b.probe.x, b.probe.y, b.probe.z);
        seen.push(`${plane}${w}x${h}`);
        if (!r.ok || r.w !== w || r.h !== h || r.plane !== plane) {
          bad.push({plane, w, h, ay, got: r});
        }
      }
    }
    return {bad, count: seen.length, max: MAX};
  });
  check(`${sizes.count} frames from 1x2 to ${sizes.max}x${sizes.max}, both planes`,
        sizes.bad.length === 0, JSON.stringify(sizes.bad.slice(0, 3)));

  // ---- 2: corners optional, edges not ---------------------------------------
  console.log('2. corners may be omitted; a missing edge block may not');
  const corners = await page.evaluate(() => {
    const H = window.__henrycraft;
    H.loadThemeSeed('meadow', 778);
    const a = H.buildFrame({plane: 'x', w: 3, h: 4, ax: 8, ay: 26, fixed: 30,
                            fill: H.ids.GRASS, corners: false});
    const noCorners = H.analyse(a.probe.x, a.probe.y, a.probe.z);
    H.loadThemeSeed('meadow', 778);
    const b = H.buildFrame({plane: 'x', w: 3, h: 4, ax: 8, ay: 26, fixed: 30,
                            fill: H.ids.GRASS, gapAt: {x: 9, y: 25, z: 30}});
    const gap = H.analyse(b.probe.x, b.probe.y, b.probe.z);
    return {noCorners, gap};
  });
  check('frame with no corners is valid', corners.noCorners.ok, JSON.stringify(corners.noCorners));
  check('frame with a missing edge block is rejected as a gap',
        !corners.gap.ok && corners.gap.why === 'gap', JSON.stringify(corners.gap));

  // ---- 2c: every wrong shape gets its own answer ---------------------------
  console.log('2c. each wrong shape produces its own specific hint');
  const hints = await page.evaluate(() => {
    const H = window.__henrycraft, ids = H.ids;
    const out = {};
    // gap
    H.loadThemeSeed('meadow', 779);
    let b = H.buildFrame({plane: 'x', w: 2, h: 3, ax: 8, ay: 26, fixed: 30, gapAt: {x: 8, y: 25, z: 30}});
    out.gap = H.analyse(b.probe.x, b.probe.y, b.probe.z).why;
    // not obsidian
    H.loadThemeSeed('meadow', 779);
    b = H.buildFrame({plane: 'x', w: 2, h: 3, ax: 8, ay: 26, fixed: 30, wrongAt: {x: 8, y: 25, z: 30}});
    out.notObsidian = H.analyse(b.probe.x, b.probe.y, b.probe.z).why;
    // partly filled
    H.loadThemeSeed('meadow', 779);
    b = H.buildFrame({plane: 'x', w: 3, h: 3, ax: 8, ay: 26, fixed: 30, unfilled: 3});
    out.partial = H.analyse(b.probe.x, b.probe.y, b.probe.z).why;
    // too big
    H.loadThemeSeed('meadow', 779);
    b = H.buildFrame({plane: 'x', w: 22, h: 4, ax: 6, ay: 26, fixed: 30});
    out.tooBig = H.analyse(b.probe.x, b.probe.y, b.probe.z).why;
    // 1x1
    H.loadThemeSeed('meadow', 779);
    b = H.buildFrame({plane: 'x', w: 1, h: 1, ax: 8, ay: 26, fixed: 30});
    out.tooSmall = H.analyse(b.probe.x, b.probe.y, b.probe.z).why;
    // lying flat: an obsidian ring around a filled rectangle at one height
    H.loadThemeSeed('meadow', 779);
    const y = 26;
    // interior x 20..23, z 40..42; ring one block outside that on all four sides.
    // Fill last, and only over the interior - an earlier version filled z=43 too,
    // which overwrote that edge of the ring and made it read as a gap.
    for (let dx = -2; dx <= 5; dx++) for (let dz = -2; dz <= 5; dz++) H.setBlock(20 + dx, y, 40 + dz, ids.AIR);
    for (let dx = 0; dx <= 3; dx++) { H.setBlock(20 + dx, y, 39, ids.OBSIDIAN); H.setBlock(20 + dx, y, 43, ids.OBSIDIAN); }
    for (let dz = 0; dz <= 2; dz++) { H.setBlock(19, y, 40 + dz, ids.OBSIDIAN); H.setBlock(24, y, 40 + dz, ids.OBSIDIAN); }
    for (let dx = 0; dx <= 3; dx++) for (let dz = 0; dz <= 2; dz++) H.setBlock(20 + dx, y, 40 + dz, ids.GRASS);
    out.flat = H.analyse(21, y, 41).why;
    // L-shaped / stepped
    H.loadThemeSeed('meadow', 779);
    b = H.buildFrame({plane: 'x', w: 4, h: 4, ax: 8, ay: 26, fixed: 30});
    H.setBlock(11, 29, 30, ids.AIR); H.setBlock(10, 29, 30, ids.AIR);
    out.notRect = H.analyse(8, 26, 30).why;
    return out;
  });
  const wantHints = {gap: 'gap', notObsidian: 'notObsidian', partial: 'partial',
                     tooBig: 'tooBig', tooSmall: 'tooSmall', flat: 'flat', notRect: 'partial'};
  let hintFails = [];
  for (const k of Object.keys(wantHints)) {
    if (hints[k] !== wantHints[k]) hintFails.push(`${k}: got ${hints[k]}, want ${wantHints[k]}`);
  }
  check('all seven wrong-shape cases return a specific reason, none silent',
        hintFails.length === 0 && Object.values(hints).every(v => !!v),
        JSON.stringify(hints));
  note('hints: ' + Object.entries(hints).map(([k, v]) => `${k}->${v}`).join(', '));

  // ---- 2d: the hints are pictures, made of real blocks ---------------------
  console.log('2d. every hint is a picture drawn from the real block textures');
  const pics = await page.evaluate(() => {
    const H = window.__henrycraft;
    const cv = document.createElement('canvas');
    const out = {reasons: H.hintPics(), sizes: {}, ink: {}, words: {}};

    /* "Drawn from the real block textures" is the claim, so it gets checked
       against the atlas rather than taken on trust: the average colour of the
       first obsidian cell in the picture must match the average of obsidian's
       side tile in the atlas. Hand-drawn artwork would not. */
    function averageOf(list) {
      let r = 0, g = 0, b = 0;
      list.forEach(p => { r += p[0]; g += p[1]; b += p[2]; });
      return [r / list.length, g / list.length, b / list.length];
    }
    const obsTile = H.tiles(H.ids.OBSIDIAN)[2];
    const atlasAvg = averageOf(H.atlasTilePixels(obsTile, 256));

    for (const why of out.reasons) {
      H.paintHint(cv, why);
      out.sizes[why] = [cv.width, cv.height];
      const c = cv.getContext('2d');
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      let opaque = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 200) opaque++;
      out.ink[why] = opaque;
      out.words[why] = H.hintWords()[why] || null;
    }

    /* The top-left obsidian block of the good frame: cell 22px, the good grid
       starts after the bad one, so sample the bad picture's left edge column
       instead - row 1, column 0, which is obsidian in every case. */
    H.paintHint(cv, 'partial');
    const c = cv.getContext('2d');
    const cell = 22, x0 = 8, y0 = 26 + cell;      // row 1 of the bad grid
    const px = c.getImageData(x0 + 2, y0 + 2, cell - 4, cell - 4).data;
    const got = [];
    for (let i = 0; i < px.length; i += 4) got.push([px[i], px[i + 1], px[i + 2]]);
    out.cellAvg = averageOf(got);
    out.atlasAvg = atlasAvg;
    return out;
  });
  const dist = Math.hypot(pics.cellAvg[0] - pics.atlasAvg[0],
                          pics.cellAvg[1] - pics.atlasAvg[1],
                          pics.cellAvg[2] - pics.atlasAvg[2]);
  const MISSES = ['gap', 'notObsidian', 'partial', 'tooSmall', 'tooBig', 'flat', 'notRect'];
  check(`all ${pics.reasons.length} pictures draw something, and every near miss ` +
        `has one`,
        pics.reasons.length === 8 &&
        MISSES.every(w => pics.reasons.includes(w)) &&
        pics.reasons.includes('readyToLight') &&
        pics.reasons.every(w => pics.ink[w] > 400 && pics.sizes[w][0] > 80),
        JSON.stringify(pics.ink));
  check(`the blocks in a picture come from the atlas, not from artwork ` +
        `(colour distance ${dist.toFixed(1)})`,
        dist < 24, `picture ${pics.cellAvg.map(v => v.toFixed(0))} vs ` +
                   `atlas ${pics.atlasAvg.map(v => v.toFixed(0))}`);
  check('each picture still carries words for whoever is reading aloud',
        pics.reasons.every(w => typeof pics.words[w] === 'string' && pics.words[w].length > 8),
        JSON.stringify(pics.words));
  note('hint pictures: ' + pics.reasons.map(w => `${w} ${pics.sizes[w].join('x')}`).join(', '));

  // ---- 2e: a finished frame says so ----------------------------------------
  console.log('2e. finishing a frame prompts for the last step');
  const nudge = await page.evaluate(async () => {
    const H = window.__henrycraft, ids = H.ids;
    const out = {};
    H.loadThemeSeed('desert', 902);
    H.forgetPrompts();

    /* Exactly what he did: a thick obsidian frame with sand in the middle. The
       last block of the filling goes in last, which is the moment the prompt
       should appear. */
    const z = 30;
    for (let y = 20; y < 34; y++) for (let x = 4; x < 24; x++) for (let d = -2; d <= 2; d++) {
      H.setBlock(x, y, z + d, ids.AIR);
    }
    for (let y = 22; y <= 29; y++) for (let x = 8; x <= 17; x++) H.setBlock(x, y, z, ids.OBSIDIAN);
    for (let y = 24; y <= 26; y++) for (let x = 10; x <= 13; x++) H.setBlock(x, y, z, ids.SAND);

    /* one cell still empty: not finished, so no prompt */
    H.setBlock(13, 26, z, ids.AIR);
    H.promptCheck(13, 26, z);
    out.unfinished = H.hintPanel().on;

    /* fill it, and the prompt is the whole point */
    H.setBlock(13, 26, z, ids.SAND);
    H.promptCheck(13, 26, z);
    await new Promise(r => setTimeout(r, 60));
    const shown = H.hintPanel();
    out.finished = {on: shown.on, words: shown.words, w: shown.w};

    /* it must not nag: same frame again says nothing */
    document.getElementById('portalHelp').classList.remove('on');
    H.setBlock(12, 25, z, ids.SAND);
    H.promptCheck(12, 25, z);
    out.repeat = H.hintPanel().on;

    /* and once it is lit there is nothing left to prompt about */
    H.forgetPrompts();
    const lit = await H.light(11, 25, z);
    document.getElementById('portalHelp').classList.remove('on');
    H.promptCheck(11, 25, z);
    out.afterLit = H.hintPanel().on;
    out.lit = lit.ok;
    out.destTheme = lit.destTheme;
    return out;
  });
  check('a frame that is not finished yet prompts nothing', nudge.unfinished === false,
        JSON.stringify(nudge));
  check('finishing the filling says so, with the Flint & Steel picture',
        nudge.finished.on && /Flint & Steel/.test(nudge.finished.words),
        JSON.stringify(nudge.finished));
  check('and it says it once, not on every block after that', nudge.repeat === false,
        JSON.stringify(nudge));
  check('nothing is prompted once the portal is already lit',
        nudge.afterLit === false && nudge.lit === true, JSON.stringify(nudge));
  check(`a sand-filled portal binds to the desert (${nudge.destTheme})`,
        nudge.destTheme === 'desert', String(nudge.destTheme));
  note(`finished-frame prompt: "${nudge.finished.words}"`);

  // the wiring, not just the function: placing a block has to call it
  const src = await page.evaluate(() => fetch(location.pathname).then(r => r.text()));
  const buildFn = src.slice(src.indexOf('function build(){'), src.indexOf('function build(){') + 900);
  check('placing a block actually runs that check',
        /maybePromptToLight\(c\.x,c\.y,c\.z\)/.test(buildFn),
        buildFn.slice(0, 200));

  // the panel appears on a real near miss, and leaves on its own
  const panel = await page.evaluate(async () => {
    const H = window.__henrycraft;
    H.loadThemeSeed('meadow', 783);
    /* A frame with a hole in it, lit the way he would light it. */
    const b = H.buildFrame({plane: 'x', w: 2, h: 3, ax: 8, ay: 26, fixed: 30,
                            gapAt: {x: 8, y: 25, z: 30}});
    const analysed = H.analyse(b.probe.x, b.probe.y, b.probe.z);
    H.tryLight(b.probe.x, b.probe.y, b.probe.z);
    await new Promise(r => setTimeout(r, 120));
    const shown = H.hintPanel();
    return {why: analysed.why, shown};
  });
  check('a wrong frame puts the picture on screen rather than a line of emoji',
        panel.shown.on && panel.shown.w > 80 && /missing/i.test(panel.shown.words),
        JSON.stringify(panel));

  // the ideas page
  const ideas = await page.evaluate(() => {
    const H = window.__henrycraft;
    H.showIdeas();
    const cv = document.getElementById('ideasPic');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 200) opaque++;
    const open = !document.getElementById('ideas').classList.contains('hide');
    document.getElementById('ideasDone').click();
    return {open, closed: document.getElementById('ideas').classList.contains('hide'),
            size: [cv.width, cv.height], opaque};
  });
  check(`"Things you can build" shows a drawn portal recipe ` +
        `(${ideas.size.join('x')}, ${ideas.opaque} painted pixels)`,
        ideas.open && ideas.opaque > 2000 && ideas.closed, JSON.stringify(ideas));

  // ---- 2b: a 21x21 portal is one merged mesh -------------------------------
  console.log('2b. a 21x21 portal is part of the chunk mesh, not 441 objects');
  const big = await page.evaluate(async () => {
    const H = window.__henrycraft;
    /* Waits n frames. The obvious version (i++; i < n ? rAF : resolve) resolves
       frames(1) without waiting for a single frame, which made settle() below spin
       240 times inside one task: no frame ran, so no chunk was re-meshed, no spark
       expired, and the glow mesh was never built. Every number 2b reported was
       taken from a scene that had not been drawn yet. */
    function frames(n) {
      return new Promise(res => {
        let i = 0;
        (function step() { if (i++ >= n) return res(); requestAnimationFrame(step); })();
      });
    }
    /* Wait until nothing is still changing: ignition sparks are individual
       meshes, and each one is a draw call, so reading while they are still in the
       air measures fireworks rather than the portal. Chunk meshing is flushed by
       the loop, so the rebuild counter has to stop moving too. */
    const why = [];
    async function settle(maxFrames) {
      for (let i = 0; i < maxFrames; i++) {
        await frames(1);
        if (H.particleCount() === 0) {
          const r = H.renderStats().rebuilds;
          await frames(2);
          if (H.renderStats().rebuilds === r) return true;
        }
      }
      why.push({p: H.particleCount(), r: H.renderStats().rebuilds,
                g: H.portalMeshStats().glowMeshes});
      return false;
    }
    /* One fixed viewpoint, chosen so the whole 21x21 footprint is in frame, and
       used for every reading. Both portals sit in the same place in the same
       world, so the two numbers differ only by the portal itself. */
    const eye = {x: 16, y: 23, z: 62}, look = {x: 16, y: 23, z: 30};
    async function measure(w, h) {
      H.loadThemeSeed('meadow', 780);
      await settle(240);
      const b = H.buildFrame({plane: 'x', w, h, ax: 6, ay: 12, fixed: 30, fill: H.ids.GRASS});
      await settle(240);
      const before = H.renderProbe(eye, look);
      const beforeMeshes = H.portalMeshStats().sceneMeshes;
      const rebuildsBefore = H.renderStats().rebuilds;
      const lit = await H.light(b.probe.x, b.probe.y, b.probe.z);
      const sparks = H.particleCount();
      const quiet = await settle(240);
      const after = H.renderProbe(eye, look);
      const stats = H.portalMeshStats();
      return {w, h, area: w * h, lit, sparks, quiet,
              rebuildsOnLight: H.renderStats().rebuilds - rebuildsBefore,
              glowTris: stats.glowTris,
              triBefore: before.triangles, triAfter: after.triangles,
              meshesBefore: beforeMeshes, meshesAfter: stats.sceneMeshes,
              glowMeshesNow: stats.glowMeshes,
              callsBefore: before.calls, callsAfter: after.calls,
              callDelta: after.calls - before.calls,
              meshDelta: stats.sceneMeshes - beforeMeshes,
              glowMeshes: stats.glowMeshes, portalBlocks: stats.portalBlocks,
              interior: b.interior};
    }
    const small = await measure(1, 2);
    const huge = await measure(21, 21);

    // With a static lit portal, geometry must not be rebuilt at all - the shimmer
    // is a scrolling texture, not per-block work.
    const r0 = H.renderStats().rebuilds;
    await frames(300);
    const r1 = H.renderStats().rebuilds;

    return {small, huge, rebuildsOver300: r1 - r0, why};
  });
  const S = big.small, B = big.huge;
  check(`441-block portal lights (${B.interior} interior blocks)`, B.lit.ok, JSON.stringify(B.lit));

  /* Controls first: both readings have to have settled, and the rebuild counter
     has to actually move when a portal changes - otherwise "0 rebuilds over 300
     frames" below is true of a scene where nothing ever happened, which is the
     state a broken frame helper put this test in once already. */
  check('both readings were taken with nothing still moving',
        S.quiet && B.quiet,
        `settled: 1x2 ${S.quiet}, 21x21 ${B.quiet}; gave up at ${JSON.stringify(big.why)}`);
  check(`the rebuild counter moves when the portal changes ` +
        `(${B.rebuildsOnLight} on ignition)`,
        B.rebuildsOnLight > 0, `${B.rebuildsOnLight} rebuilds when lighting ${B.area} blocks`);

  /* What "cost does not scale with area" has to be measured on.

     Comparing the draw-call delta of a 1x2 against a 21x21 looked like the direct
     test and was not: each fixture carves its own clearance out of the hillside -
     5x5x3 against 25x25x3 - so the two measurements sit in different worlds with
     different chunk geometry, and their baselines differ by several calls before a
     portal is even lit. The difference of those two differences came out +5, +6,
     -3 and -9 across runs of unchanged code. An earlier version of this check
     passed on that noise.
     
     The invariant itself involves no camera at all: portal geometry is merged into
     the chunk mesh, so the number of meshes carrying it - and therefore the number
     of draw calls it can possibly cost - is bounded by the chunks it touches, not
     by its area. */
  check(`merged meshes do not scale with area: 2 blocks in ${S.glowMeshes}, ` +
        `${B.area} blocks in ${B.glowMeshes}`,
        B.glowMeshes - S.glowMeshes <= 1 && B.glowMeshes <= 4,
        `1x2 in ${S.glowMeshes} mesh(es), 21x21 in ${B.glowMeshes}`);
  check(`and ${B.area} blocks of portal cost at most a handful of draw calls ` +
        `(${B.callDelta})`,
        B.callDelta <= 6, `21x21 added ${B.callDelta} calls ` +
        `(${B.callsBefore}->${B.callsAfter})`);
  check(`nowhere near one draw call per block`,
        B.callDelta < B.area / 20, `${B.callDelta} calls for ${B.area} blocks`);
  check(`nor one merged mesh per block (${B.glowTris} triangles in ${B.glowMeshes})`,
        B.glowTris >= B.area && B.glowMeshes <= 4,
        `${B.glowTris} triangles across ${B.glowMeshes} meshes for ${B.area} blocks`);

  /* A naive version regenerating its 441 blocks every frame would still show two
     merged meshes while being unplayable, so the rebuild counter is checked
     directly. The shimmer is a scrolling texture; geometry must not move. */
  check(`a static lit portal rebuilt no geometry over 300 frames ` +
        `(${big.rebuildsOver300} rebuilds)`,
        big.rebuildsOver300 === 0, `${big.rebuildsOver300} chunk rebuilds`);

  check(`ignition sparks are capped by area, not per block (${B.sparks} for ${B.area} blocks)`,
        B.sparks <= 30, `${B.sparks} particles`);
  check('the interior is merged into chunk geometry, not one object per block',
        B.glowMeshes > 0 && B.glowMeshes <= 4 && B.meshDelta < B.area / 20,
        `${B.glowMeshes} glow chunk meshes, +${B.meshDelta} scene meshes for ${B.portalBlocks} blocks`);
  note(`${B.portalBlocks} blocks and ${B.glowTris} triangles in ${B.glowMeshes} ` +
       `merged mesh(es), against ${S.glowMeshes} for a 1x2 - area x` +
       `${(B.area / S.area).toFixed(0)}, meshes x${(B.glowMeshes / Math.max(1, S.glowMeshes)).toFixed(0)}; ` +
       `${big.rebuildsOver300} rebuilds over 300 static frames`);
  note(`draw calls added: 1x2 ${S.callDelta}, 21x21 ${B.callDelta} - reported rather ` +
       `than asserted on as a pair, since each fixture carves its own clearance ` +
       `and the baselines differ`);

  // ---- 3: fill chooses the theme ------------------------------------------
  console.log('3. the filling chooses the destination theme');
  const fills = await page.evaluate(async () => {
    const H = window.__henrycraft, ids = H.ids;
    const want = [[ids.GRASS, 'meadow'], [ids.SNOW, 'snowy'], [ids.SAND, 'desert'],
                  [ids.GLASS, 'island'], [ids.MUSHCAP, 'mushroom'],
                  [ids.MUSHSTEM, 'mushroom']];
    const out = [];
    for (const [fill, theme] of want) {
      H.loadThemeSeed('meadow', 781);
      const b = H.buildFrame({plane: 'x', w: 2, h: 3, ax: 8, ay: 26, fixed: 30, fill});
      const lit = await H.light(b.probe.x, b.probe.y, b.probe.z);
      out.push({fill, want: theme, got: lit.destTheme, ok: lit.ok});
    }
    // an unrecognised fill must still light, just somewhere random
    H.loadThemeSeed('meadow', 781);
    const b = H.buildFrame({plane: 'x', w: 2, h: 3, ax: 8, ay: 26, fixed: 30, fill: ids.BRICK});
    const odd = await H.light(b.probe.x, b.probe.y, b.probe.z);
    return {out, odd, mapped: H.themeForFill(ids.BRICK)};
  });
  const fillBad = fills.out.filter(r => !r.ok || r.got !== r.want);
  check('grass, snow, sand, glass and mushroom each bind to their theme',
        fillBad.length === 0, JSON.stringify(fillBad));
  check('an unrecognised fill still lights, bound to some theme',
        fills.odd.ok && !!fills.odd.destTheme && fills.mapped === null,
        JSON.stringify(fills.odd));

  // ---- 4: a portal always leads to the same place --------------------------
  console.log('4. a portal lit twice leads to the same district');
  const twice = await page.evaluate(async () => {
    const H = window.__henrycraft;
    H.loadThemeSeed('meadow', 782);
    const b = H.buildFrame({plane: 'z', w: 3, h: 4, ax: 20, ay: 26, fixed: 30, fill: H.ids.SNOW});
    const first = await H.light(b.probe.x, b.probe.y, b.probe.z);
    // put it out by breaking a frame block, rebuild, light again
    H.breakBlock(b.probe.x, b.probe.y - 1, b.probe.z);
    const b2 = H.buildFrame({plane: 'z', w: 3, h: 4, ax: 20, ay: 26, fixed: 30, fill: H.ids.SNOW});
    const second = await H.light(b2.probe.x, b2.probe.y, b2.probe.z);
    return {first, second};
  });
  check('same destination both times, and it is a real district',
        !!twice.first.dest && twice.first.dest === twice.second.dest,
        `${twice.first.dest} vs ${twice.second.dest}`);
  note(`relit portal bound to ${twice.second.dest} both times`);

  // ---- 5 + 6 + 7: the ones that strand him or lose a build -----------------
  console.log(`\n5, 6, 7. arrival safety, return portals and edit preservation ` +
              `(${TRIALS} trials)`);
  const trials = await page.evaluate(async ({TRIALS}) => {
    const H = window.__henrycraft, ids = H.ids;
    const themes = H.themes().map(t => t.key);
    const fillFor = {meadow: ids.GRASS, snowy: ids.SNOW, desert: ids.SAND,
                     island: ids.GLASS, mushroom: ids.MUSHCAP};
    const res = {trials: 0, noReturn: [], unsafe: [], lostEdits: [], byTheme: {}};

    for (let i = 0; i < TRIALS; i++) {
      const theme = themes[i % themes.length];
      res.byTheme[theme] = (res.byTheme[theme] || 0) + 1;

      // A fresh home district each trial, with a landmark block in it.
      const homeSlug = await H.createDistrict('Trial ' + i, 'meadow');
      const mark = {x: 30, y: H.surfaceY(30, 30) + 1, z: 30};
      H.setBlock(mark.x, mark.y, mark.z, ids.RAINBOW);
      const homeEdits = Object.keys(H.editsNow()).length;

      // Build and light a portal to the trial theme.
      const b = H.buildFrame({plane: i % 2 ? 'z' : 'x', w: 2 + (i % 3), h: 3 + (i % 2),
                              ax: 10, ay: 26, fixed: 34, fill: fillFor[theme]});
      const lit = await H.light(b.probe.x, b.probe.y, b.probe.z);
      if (!lit.ok) { res.unsafe.push({i, why: 'portal would not light', lit}); continue; }

      // Travel.
      const went = await H.travel(lit.id);
      if (!went) { res.unsafe.push({i, why: 'travel failed'}); continue; }
      res.trials++;

      // 6: where he landed must be solid dry ground with room to stand.
      const p = H.player();
      const fx = Math.floor(p.x), fy = Math.floor(p.y), fz = Math.floor(p.z);
      const at = H.getBlock(fx, fy, fz);
      const head = H.getBlock(fx, fy + 1, fz);
      const below = H.getBlock(fx, fy - 1, fz);
      const problems = [];
      if (at !== ids.AIR) problems.push('inside ' + at);
      if (head !== ids.AIR) problems.push('head in ' + head);
      if (below === ids.AIR) problems.push('airborne');
      if (below === ids.WATER || at === ids.WATER) problems.push('in water');
      if (problems.length) res.unsafe.push({i, theme, at: [fx, fy, fz], problems});

      // 5: a lit return portal bound back to where he came from.
      const back = H.portals().filter(q => q.lit && q.dest === homeSlug);
      if (!back.length) res.noReturn.push({i, theme, portals: H.portals().length});

      // 7: go back through it and check both districts kept their edits.
      if (back.length) {
        const destEdits = Object.keys(H.editsNow()).length;
        H.setBlock(mark.x, mark.y + 2, mark.z, ids.EMERALD);   // a mark on this side
        const destAfterMark = Object.keys(H.editsNow()).length;
        const home = await H.travel(back[0].id);
        if (!home) { res.lostEdits.push({i, why: 'return travel failed'}); continue; }
        const homeNow = Object.keys(H.editsNow()).length;
        const markBack = H.getBlock(mark.x, mark.y, mark.z);
        if (markBack !== ids.RAINBOW) res.lostEdits.push({i, why: 'landmark gone', got: markBack});
        if (homeNow < homeEdits) res.lostEdits.push({i, why: 'home edits shrank', homeEdits, homeNow});
        // and the far side still has its own
        await H.switchDistrict(back[0].dest === homeSlug ? lit.dest : homeSlug);
        const farNow = Object.keys(H.editsNow()).length;
        if (farNow < destAfterMark - 1) res.lostEdits.push({i, why: 'far edits shrank', destAfterMark, farNow});
        await H.switchDistrict(homeSlug);
      }
    }
    return res;
  }, {TRIALS});

  check(`5. every arrival produced a working return portal (${trials.trials} travels)`,
        trials.noReturn.length === 0,
        JSON.stringify(trials.noReturn.slice(0, 3)));
  check(`6. every arrival was solid dry ground with room to stand`,
        trials.unsafe.length === 0,
        JSON.stringify(trials.unsafe.slice(0, 3)));
  check(`7. travelling and returning preserved every block edit`,
        trials.lostEdits.length === 0,
        JSON.stringify(trials.lostEdits.slice(0, 3)));
  note(`${trials.trials} round trips across ` +
       Object.entries(trials.byTheme).map(([k, v]) => `${k} ${v}`).join(', '));

  // ---- 8 + 9 + 10 + 11 ----------------------------------------------------
  console.log('\n8, 9, 10, 11. breaking, deleted destinations, Go home, dwell');
  const rest = await page.evaluate(async () => {
    const H = window.__henrycraft, ids = H.ids;
    const out = {};

    // 8: breaking a frame block puts it out and clears the opening
    H.loadThemeSeed('meadow', 790);
    let b = H.buildFrame({plane: 'x', w: 3, h: 3, ax: 8, ay: 26, fixed: 30, fill: ids.GRASS});
    let lit = await H.light(b.probe.x, b.probe.y, b.probe.z);
    const wasPortal = H.getBlock(b.probe.x, b.probe.y, b.probe.z) === ids.PORTAL;
    H.breakBlock(b.probe.x, b.probe.y - 1, b.probe.z);        // a frame block
    out.broke = {wasPortal, litBefore: lit.ok,
                 interiorNow: H.getBlock(b.probe.x, b.probe.y, b.probe.z),
                 litPortals: H.portals().filter(p => p.lit).length,
                 air: ids.AIR};

    // 9: destination deleted -> dark, not a crash
    H.loadThemeSeed('meadow', 791);
    b = H.buildFrame({plane: 'x', w: 2, h: 3, ax: 8, ay: 26, fixed: 30, fill: ids.SAND});
    lit = await H.light(b.probe.x, b.probe.y, b.probe.z);
    await H.deleteDistrict(lit.dest);
    let crashed = false, travelled = null;
    try { travelled = await H.travel(lit.id); } catch (e) { crashed = true; }
    out.deleted = {crashed, travelled, stillHavePortalRecord: H.portals().length >= 0,
                   litNow: H.portals().filter(p => p.lit && p.id === lit.id).length};

    // 10: Go home from a district with no portals at all
    const away = await H.createDistrict('Far Away', 'snowy');
    out.beforeHome = {at: away, portals: H.portals().length};
    await H.goHome();
    out.afterHome = {at: H.districts().current, home: H.homeSlug()};

    // 11: walking through is not enough; standing is
    H.loadThemeSeed('meadow', 792);
    b = H.buildFrame({plane: 'x', w: 2, h: 3, ax: 8, ay: 26, fixed: 30, fill: ids.GRASS});
    lit = await H.light(b.probe.x, b.probe.y, b.probe.z);
    const brief = await H.standIn(lit.id, H.portalDwell() * 0.5);
    const held = await H.standIn(lit.id, H.portalDwell() + 0.3);
    out.dwell = {dwell: H.portalDwell(), brief, held};
    return out;
  });

  check('8. breaking a frame block extinguishes it and clears the interior to air',
        rest.broke.wasPortal && rest.broke.interiorNow === rest.broke.air &&
        rest.broke.litPortals === 0, JSON.stringify(rest.broke));
  check('9. a deleted destination leaves the portal dark instead of crashing',
        !rest.deleted.crashed && rest.deleted.travelled === false &&
        rest.deleted.litNow === 0, JSON.stringify(rest.deleted));
  check('10. Go home works from a district with no portals',
        rest.afterHome.at === rest.afterHome.home, JSON.stringify(rest));
  // ---- 11b: he has to be able to walk in, on his own legs ------------------
  console.log('\n11b. walking into a lit portal, using the real physics');
  const walk = await page.evaluate(async () => {
    const H = window.__henrycraft, ids = H.ids;
    H.loadThemeSeed('meadow', 795);
    /* Standing on the ground, as he builds them - not floating in the air. */
    const gy = H.surfaceY(30, 30);
    for (let y = gy; y < gy + 10; y++) for (let x = 24; x <= 36; x++) {
      for (let d = -4; d <= 4; d++) H.setBlock(x, y, 30 + d, ids.AIR);
    }
    const b = H.buildFrame({plane: 'x', w: 2, h: 3, ax: 29, ay: gy, fixed: 30,
                            fill: ids.SAND});
    /* A floor, laid after the frame: buildFrame clears a generous box around
       itself, which leaves a trench immediately in front of the opening. Without
       this he falls into it on the approach and the test fails for a reason that
       has nothing to do with portals. Only air is filled, so the frame's own ring
       is left alone. */
    for (let x = 24; x <= 36; x++) for (let d = -4; d <= 4; d++) {
      if (H.getBlock(x, gy - 1, 30 + d) === ids.AIR) H.setBlock(x, gy - 1, 30 + d, ids.STONE);
    }
    const lit = await H.light(b.probe.x, b.probe.y, b.probe.z);
    if (!lit.ok) return {error: 'would not light', lit};
    const enterable = H.canStandIn(lit.id);
    const walked = await H.walkInto(lit.id, H.portalDwell() + 1.2);
    return {lit, enterable, walked, destTheme: lit.destTheme};
  });
  check('a lit portal is something a body can occupy, not a wall',
        walk.enterable === true, JSON.stringify(walk));
  check('walking forwards into it actually gets him inside',
        walk.walked && walk.walked.reached === true, JSON.stringify(walk.walked));
  check('and standing there takes him through',
        walk.walked && walk.walked.travelled === true, JSON.stringify(walk.walked));
  note(`walked in unaided and arrived in ${walk.walked && walk.walked.now}`);

  check('11. half the dwell time does not travel; the full time does',
        rest.dwell.brief.travelled === false && rest.dwell.held.travelled === true,
        JSON.stringify(rest.dwell));
  note(`dwell is ${rest.dwell.dwell}s: ${(rest.dwell.dwell * 0.5).toFixed(2)}s stays put, ` +
       `${(rest.dwell.dwell + 0.3).toFixed(2)}s travels`);

  // ---- the ?fps=1 readout -------------------------------------------------
  console.log('\n12. the hidden fps readout appears only when asked for');
  const off = await page.evaluate(() => !!document.getElementById('fpsReadout'));
  const fpsPage = await ctx.newPage();
  await fpsPage.goto(url + '?fps=1', {waitUntil: 'load'});
  await fpsPage.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready(),
                                {timeout: 60000});
  /* Wait for a real number rather than a fixed sleep: under SwiftShader a frame
     can take a third of a second, and the readout only reports once it has half a
     second of frames to divide. */
  let on = null;
  try {
    await fpsPage.waitForFunction(() => {
      const e = document.getElementById('fpsReadout');
      return !!e && /\d+ fps/.test(e.textContent);
    }, {timeout: 30000});
  } catch (_) { /* leaves on === null below, and the check fails with the text */ }
  on = await fpsPage.evaluate(() => {
    const e = document.getElementById('fpsReadout');
    return e ? {text: e.textContent, visible: e.getBoundingClientRect().height > 0} : null;
  });
  await fpsPage.close();
  check('absent without ?fps=1', off === false);
  check('present and populated with ?fps=1',
        !!on && on.visible && /\d+ fps/.test(on.text) && /calls/.test(on.text),
        JSON.stringify(on));
  note('?fps=1 shows: ' + (on ? on.text : 'nothing'));

  check('no page errors across the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  await ctx.close();
  await browser.close();
  srv.close();
  console.log(`\npassed ${passed}, failed ${failed}`);
  console.log('\nReported numbers');
  notes.forEach(n => console.log('  - ' + n));
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
