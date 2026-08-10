#!/usr/bin/env node
/*
 * Phase A tests: districts, migration and themes.
 *
 *   node tools/test-districts.js
 *
 * Test 1 is the one that matters most. The child has built things in the single
 * save that existed before districts, and losing them is a failure of the whole
 * job, so it is written first and asserts on the exact edit map rather than on a
 * count.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SEEDS = 20;
const LEGACY_KEY = 'henrycraft-world-v1';
const INDEX_KEY = 'henrycraft-districts';

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

/* sRGB hex -> CIE Lab, then CIE76 dE. The brief asked for "the same colour
   distance check used in colours.py"; there is no colours.py in this repo, so
   this is a plain CIE76 dE76 on D65. Two colours under ~12 read as the same
   colour at a glance, which is the bar the themes have to clear. */
function lab(hex) {
  let [r, g, b] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => v / 255);
  [r, g, b] = [r, g, b].map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const Y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function dE(a, b) {
  const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

(async () => {
  const {chromium} = loadPlaywright();
  const {srv, port} = await serve();
  const url = `http://127.0.0.1:${port}/index.html`;
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  console.log('Henrycraft district tests\n');

  /* Fresh browser profile each time, so one test's storage cannot leak into the
     next. Optionally seeds localStorage before the page's first script runs. */
  async function open(preSeed) {
    const ctx = await browser.newContext({
      viewport: {width: 1024, height: 700}, hasTouch: true, isMobile: true,
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    if (preSeed) await page.addInitScript(preSeed);
    await page.goto(url, {waitUntil: 'load'});
    await page.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready(),
                               {timeout: 60000});
    return {ctx, page, errs};
  }

  // ---- 1: the legacy save migrates with every edit intact --------------------
  console.log('1. the old single save migrates to a district, keeping every edit');
  // A legacy save with a known, awkward edit map: negative-ish coords at the
  // edges, several block types, and a couple of AIR entries standing for holes
  // he dug. Written in the exact shape snapshot() used to produce.
  const legacyEdits = {};
  const want = [
    [10, 12, 10, 1], [10, 13, 10, 8], [11, 12, 10, 0], [32, 5, 32, 11],
    [63, 20, 63, 9], [0, 1, 0, 3], [20, 2, 44, 19], [21, 2, 44, 0],
    [45, 9, 12, 7], [46, 9, 12, 12], [47, 9, 12, 21],
  ];
  for (const [x, y, z, b] of want) legacyEdits[`${x},${y},${z}`] = b;
  const legacy = {
    seed: 123456789, starSeed: 987654321, edits: legacyEdits,
    p: [30.25, 14.5, 31.75, 1.234], stars: [1, 0, 1, 0, 0, 0, 0, 0, 0, 0], sel: 8,
  };

  {
    const {ctx, page, errs} = await open(`
      localStorage.setItem(${JSON.stringify(LEGACY_KEY)}, ${JSON.stringify(JSON.stringify(legacy))});
    `);
    const r = await page.evaluate(({INDEX_KEY, LEGACY_KEY}) => {
      const H = window.__henrycraft;
      const idx = JSON.parse(localStorage.getItem(INDEX_KEY) || 'null');
      const cur = H.districts ? H.districts() : null;
      const rec = idx && idx.list && idx.list.length
        ? JSON.parse(localStorage.getItem('henrycraft-district-' + idx.list[0].slug))
        : null;
      return {idx, cur, rec, legacyStillThere: !!localStorage.getItem(LEGACY_KEY),
              keys: Object.keys(localStorage).sort()};
    }, {INDEX_KEY, LEGACY_KEY});

    const rec = r.rec;
    check('a district was created from the legacy save',
          !!rec, 'no district record found; index=' + JSON.stringify(r.idx));
    if (rec) {
      check('it is named Home', rec.name === 'Home', 'name=' + rec.name);
      check('seed and starSeed carried over',
            rec.seed === legacy.seed && rec.starSeed === legacy.starSeed,
            `seed=${rec.seed} starSeed=${rec.starSeed}`);
      // The whole point of the test: the edit map, key for key, value for value.
      const got = rec.edits || {};
      const missing = Object.keys(legacyEdits).filter(k => got[k] !== legacyEdits[k]);
      const extra = Object.keys(got).filter(k => !(k in legacyEdits));
      check(`all ${Object.keys(legacyEdits).length} block edits survived exactly`,
            missing.length === 0 && extra.length === 0,
            `missing/changed: ${JSON.stringify(missing)} unexpected: ${JSON.stringify(extra)}`);
      check('player position and stars carried over',
            JSON.stringify(rec.p) === JSON.stringify(legacy.p) &&
            JSON.stringify(rec.stars) === JSON.stringify(legacy.stars),
            `p=${JSON.stringify(rec.p)} stars=${JSON.stringify(rec.stars)}`);
      check('the migrated district has a theme', !!rec.theme, 'theme=' + rec.theme);
    }
    check('no page errors during migration', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // ---- 2 + 3 + 7: isolation, round trip, delete -----------------------------
  console.log('2. creating a district leaves other districts\' edits alone');
  {
    const {ctx, page, errs} = await open(`
      localStorage.setItem(${JSON.stringify(LEGACY_KEY)}, ${JSON.stringify(JSON.stringify(legacy))});
    `);
    const r = await page.evaluate(async () => {
      const H = window.__henrycraft;
      const home = H.districts().current;
      // put a distinctive edit in Home and save it
      H.setBlock(12, 14, 12, H.ids.RAINBOW);
      await H.saveNow();
      const homeBefore = JSON.parse(localStorage.getItem('henrycraft-district-' + home)).edits;

      const made = await H.createDistrict('Test Isle', 'island');
      const homeAfter = JSON.parse(localStorage.getItem('henrycraft-district-' + home)).edits;

      // and the new district starts empty rather than inheriting
      const newRec = JSON.parse(localStorage.getItem('henrycraft-district-' + made));
      return {
        home, made,
        same: JSON.stringify(homeBefore) === JSON.stringify(homeAfter),
        homeCount: Object.keys(homeBefore).length,
        newCount: Object.keys(newRec.edits || {}).length,
        newTheme: newRec.theme,
        list: H.districts().list.map(d => d.slug),
      };
    });
    check('the other district\'s edit map is byte-identical afterwards', r.same,
          `home had ${r.homeCount} edits`);
    check('the new district starts with no edits', r.newCount === 0, `${r.newCount} edits`);
    check('the new district kept the theme it was created with', r.newTheme === 'island',
          'theme=' + r.newTheme);
    note(`districts after creation: ${r.list.join(', ')}`);

    console.log('3. switching districts and back restores edits, position and stars');
    const rt = await page.evaluate(async () => {
      const H = window.__henrycraft;
      const here = H.districts().current;
      const other = H.districts().list.map(d => d.slug).find(s => s !== here);

      // leave a fingerprint in Home
      H.setBlock(15, 15, 15, H.ids.EMERALD);
      H.setBlock(16, 15, 15, H.ids.OBSIDIAN);
      // Stand him somewhere genuinely free. A hard-coded point sometimes lands
      // inside terrain, and enterDistrict rightly calls findSpawn() rather than
      // restoring a player into rock - which moved the position and failed this
      // test on roughly one seed in five.
      let placed = false;
      const d = H.dims();
      for (let i = 0; i < 4000 && !placed; i++) {
        const x = 4 + Math.floor(Math.random() * (d.WX - 8));
        const z = 4 + Math.floor(Math.random() * (d.WZ - 8));
        const gy = H.surfaceY(x, z);
        if (gy <= d.waterLevel + 1 || gy > d.WY - 6) continue;
        H.movePlayer(x + 0.5, gy + 0.05, z + 0.5);
        if (H.spawnIsDry()) placed = true;
      }
      if (!placed) throw new Error('could not find a free spot to stand on');
      await H.saveNow();
      const before = {
        edits: JSON.parse(localStorage.getItem('henrycraft-district-' + here)).edits,
        p: H.player(),
        stars: H.starState(),
      };

      await H.switchDistrict(other);
      const awayEdits = Object.keys(H.editsNow()).length;
      const awaySlug = other;
      await H.switchDistrict(here);

      const after = {
        edits: H.editsNow(),
        p: H.player(),
        stars: H.starState(),
        b1: H.getBlock(15, 15, 15), b2: H.getBlock(16, 15, 15),
      };
      return {before, after, awayEdits, awaySlug, here, placed,
              ids: {EMERALD: H.ids.EMERALD, OBSIDIAN: H.ids.OBSIDIAN}};
    });
    const sameEdits = JSON.stringify(rt.before.edits) === JSON.stringify(rt.after.edits);
    check('the edit map comes back identical', sameEdits,
          `${Object.keys(rt.before.edits).length} vs ${Object.keys(rt.after.edits).length}`);
    check('the blocks are actually in the world again',
          rt.after.b1 === rt.ids.EMERALD && rt.after.b2 === rt.ids.OBSIDIAN,
          `got ${rt.after.b1}, ${rt.after.b2}`);
    check('position restored',
          Math.abs(rt.after.p.x - rt.before.p.x) < 0.02 &&
          Math.abs(rt.after.p.y - rt.before.p.y) < 0.02 &&
          Math.abs(rt.after.p.z - rt.before.p.z) < 0.02,
          `${JSON.stringify(rt.before.p)} -> ${JSON.stringify(rt.after.p)}`);
    check('stars restored',
          JSON.stringify(rt.before.stars) === JSON.stringify(rt.after.stars),
          `${JSON.stringify(rt.before.stars)} -> ${JSON.stringify(rt.after.stars)}`);
    note(`round trip ${rt.here} -> ${rt.awaySlug} -> ${rt.here}; ` +
         `${Object.keys(rt.before.edits).length} edits preserved`);

    console.log('7. deleting a district removes only its own key');
    const del = await page.evaluate(async () => {
      const H = window.__henrycraft;
      const before = Object.keys(localStorage).filter(k => k.startsWith('henrycraft-')).sort();
      const victim = H.districts().list.map(d => d.slug).find(s => s !== H.districts().current);
      await H.deleteDistrict(victim);
      const after = Object.keys(localStorage).filter(k => k.startsWith('henrycraft-')).sort();
      return {victim, before, after,
              removed: before.filter(k => !after.includes(k)),
              added: after.filter(k => !before.includes(k)),
              stillListed: H.districts().list.some(d => d.slug === victim)};
    });
    check('exactly one key removed, and it is the victim\'s',
          del.removed.length === 1 && del.removed[0] === 'henrycraft-district-' + del.victim,
          'removed: ' + JSON.stringify(del.removed));
    check('no other key added or lost', del.added.length === 0,
          'added: ' + JSON.stringify(del.added));
    check('it is gone from the index', !del.stillListed);

    // The path check 7 above never covered: deleting the district you are
    // standing in. switchDistrict starts by saving where you are, so with the
    // live record still pointing at the doomed district this wrote its key back
    // out and re-added it to the index - the delete undid itself.
    const delSelf = await page.evaluate(async () => {
      const H = window.__henrycraft;
      const extra = await H.createDistrict('Standing Here', 'snowy');
      const beforeCount = H.districts().list.length;
      const beforeKeys = Object.keys(localStorage).filter(k => k.startsWith('henrycraft-district-')).sort();
      await H.deleteDistrict(extra);           // deleting the current one
      // give any pending autosave a chance to resurrect it
      await new Promise(r => setTimeout(r, 250));
      await H.saveNow();
      const afterKeys = Object.keys(localStorage).filter(k => k.startsWith('henrycraft-district-')).sort();
      return {extra, beforeCount, afterCount: H.districts().list.length,
              stillListed: H.districts().list.some(d => d.slug === extra),
              keyBack: afterKeys.includes('henrycraft-district-' + extra),
              beforeKeys, afterKeys, nowIn: H.districts().current};
    });
    check('deleting the district you are standing in does not recreate it',
          !delSelf.stillListed && !delSelf.keyBack &&
          delSelf.afterCount === delSelf.beforeCount - 1,
          JSON.stringify(delSelf));
    check('and it moves you to a surviving district',
          !!delSelf.nowIn && delSelf.nowIn !== delSelf.extra, 'now in ' + delSelf.nowIn);

    check('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // ---- 4 + 5: every theme generates a playable world -------------------------
  console.log(`4. all themes generate playable worlds (${SEEDS} seeds each)`);
  const {ctx, page, errs} = await open();
  const themes = await page.evaluate(() => window.__henrycraft.themes().map(t => t.key));

  const surf = {};
  const themeFails = [];
  for (const t of themes) {
    const r = await page.evaluate(async ({t, SEEDS}) => {
      const H = window.__henrycraft, d = H.dims();
      const bad = [];
      const tally = {};
      let water = 0, stars = 0, animals = 0, fish = 0, surfaceTotal = 0;
      for (let s = 0; s < SEEDS; s++) {
        H.loadThemeSeed(t, 5000 + s * 7919);
        const dim = H.dims();
        const st = H.starState();
        if (st.length !== 10) bad.push(`seed ${s}: ${st.length} stars`);
        if (H.animals() < 1) bad.push(`seed ${s}: no animals`);
        // a dry spawn Henry can stand on
        const sp = H.player();
        const ground = H.surfaceY(Math.floor(sp.x), Math.floor(sp.z));
        if (ground <= dim.waterLevel) bad.push(`seed ${s}: spawn at/below water`);
        if (!H.spawnIsDry()) bad.push(`seed ${s}: spawn not dry`);
        const c = H.census();
        let w = 0;
        for (const id of Object.keys(c)) {
          if (+id === H.ids.WATER) w += c[id].count;
        }
        if (w === 0) bad.push(`seed ${s}: no water at all`);
        water += w;
        stars += st.length; animals += H.animals(); fish += H.fish().length;
        // surface composition: the top solid block of every column
        const top = H.surfaceCensus();
        for (const k of Object.keys(top)) { tally[k] = (tally[k] || 0) + top[k]; surfaceTotal += top[k]; }
      }
      return {bad, tally, surfaceTotal, water: water / SEEDS,
              stars: stars / SEEDS, animals: animals / SEEDS, fish: fish / SEEDS};
    }, {t, SEEDS});

    if (r.bad.length) themeFails.push(`${t}: ${r.bad.slice(0, 3).join('; ')}`);
    surf[t] = {tally: r.tally, total: r.surfaceTotal, water: r.water, fish: r.fish};
    check(`${t.padEnd(9)} ${SEEDS} seeds: dry spawn, water, 10 stars, ${r.animals.toFixed(0)} animals, ${r.fish.toFixed(1)} fish`,
          r.bad.length === 0, r.bad.slice(0, 3).join('; '));
  }

  console.log('5. each theme\'s surface composition is measurably distinct');
  const names = await page.evaluate(() => {
    const H = window.__henrycraft, out = {};
    for (const id of Object.keys(H.DEFS)) out[id] = H.DEFS[id].name;
    return {names: out, ids: H.ids};
  });
  function pct(theme, blockName) {
    const s = surf[theme];
    let n = 0;
    for (const id of Object.keys(s.tally)) if (names.names[id] === blockName) n += s.tally[id];
    return 100 * n / s.total;
  }
  const dSand = pct('desert', 'Sand'), dSnow = pct('snowy', 'Snow');
  const mGrass = pct('meadow', 'Grass'), iSand = pct('island', 'Sand');
  check(`desert surface is predominantly sand (${dSand.toFixed(1)}%)`, dSand > 60);
  check(`snowy surface is predominantly snow (${dSnow.toFixed(1)}%)`, dSnow > 60);
  check(`meadow surface is predominantly grass (${mGrass.toFixed(1)}%)`, mGrass > 50);
  check(`island has substantially more water than meadow ` +
        `(${surf.island.water.toFixed(0)} vs ${surf.meadow.water.toFixed(0)} blocks)`,
        surf.island.water > surf.meadow.water * 1.5);
  note('surface mix per theme: ' + themes.map(t => {
    const s = surf[t];
    const top = Object.entries(s.tally).sort((a, b) => b[1] - a[1])[0];
    return `${t} ${names.names[top[0]]} ${(100 * top[1] / s.total).toFixed(0)}%`;
  }).join(', '));
  note('mean water blocks per world: ' +
       themes.map(t => `${t} ${surf[t].water.toFixed(0)}`).join(', '));

  // ---- 6: theme colours are visibly different -------------------------------
  console.log('6. theme sky, fog and water colours are visibly different');
  const cols = await page.evaluate(() => window.__henrycraft.themes().map(t => ({
    key: t.key, sky: t.skyTop, fog: t.fog, water: t.waterTint, hemi: t.hemiSky,
  })));
  const THRESH = 12;   // CIE76 dE; below this two colours read as the same hue
  for (const field of ['sky', 'fog', 'water']) {
    let worst = Infinity, pair = '';
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        const d = dE(cols[i][field], cols[j][field]);
        if (d < worst) { worst = d; pair = `${cols[i].key}/${cols[j].key}`; }
      }
    }
    check(`${field}: closest pair ${pair} is dE ${worst.toFixed(1)} (>${THRESH} required)`,
          worst > THRESH);
  }
  note('sky colours: ' + cols.map(c => `${c.key} #${c.sky.toString(16).padStart(6, '0')}`).join(', '));
  note('water tints: ' + cols.map(c => `${c.key} #${c.water.toString(16).padStart(6, '0')}`).join(', '));

  // ---- names have to suit the place -----------------------------------------
  console.log('\nNames match the theme they belong to');
  const naming = await page.evaluate(() => {
    const H = window.__henrycraft;
    /* Words that would contradict the place. A sand portal announcing "Snowy
       Island" is what sent this back. */
    const wrong = {
      meadow:  [/snow/i, /frost/i, /dune/i, /sand/i, /reef/i, /lagoon/i],
      snowy:   [/dune/i, /sand/i, /reef/i, /lagoon/i, /coral/i],
      desert:  [/snow/i, /frost/i, /reef/i, /lagoon/i, /marsh/i, /coral/i],
      island:  [/snow/i, /frost/i, /dune/i, /peak/i],
      mushroom:[/snow/i, /frost/i, /dune/i, /sand/i, /reef/i, /coral/i]
    };
    const out = {bad: [], samples: {}, count: 0};
    for (const theme of Object.keys(wrong)) {
      const seen = new Set();
      for (let i = 0; i < 300; i++) {
        const n = H.randomName(theme);
        seen.add(n);
        out.count++;
        for (const re of wrong[theme]) {
          if (re.test(n)) { out.bad.push({theme, name: n, re: String(re)}); break; }
        }
      }
      out.samples[theme] = Array.from(seen).slice(0, 3).join(', ');
      out.variety = Math.max(out.variety || 0, 0);
      if (seen.size < 20) out.bad.push({theme, name: 'too few distinct names: ' + seen.size});
    }
    return out;
  });
  check(`${naming.count} generated names, none contradicting its own theme`,
        naming.bad.length === 0, JSON.stringify(naming.bad.slice(0, 4)));
  Object.keys(naming.samples).forEach(t => note(`${t} names: ${naming.samples[t]}`));

  check('no page errors across the theme sweep', errs.length === 0, errs.join(' | '));
  await ctx.close();
  await browser.close();
  srv.close();

  console.log(`\npassed ${passed}, failed ${failed}`);
  console.log('\nReported numbers');
  notes.forEach(n => console.log('  - ' + n));
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
