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

  /* ---- 0b: the numbers behind the blocks ----------------------------------
     A district is saved as a map of coordinates to block ids, so an id IS the save
     format. Renumbering one - by inserting into the middle of the list rather than
     appending, or by reordering it - silently turns every diamond in his world into
     something else, with no error anywhere and no way back. Written out here so that
     it is a decision somebody has to make on purpose. New blocks get new numbers on
     the end and this list grows; nothing in it ever changes. */
  console.log('0b. every block id is the number it has always been');
  const ID_TABLE = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WOOD: 5, LEAVES: 6, PLANKS: 7,
    BRICK: 8, GLASS: 9, GOLD: 10, DIAMOND: 11, RAINBOW: 12, WATER: 13, BEDROCK: 14,
    COAL: 15, COPPER: 16, LAPIS: 17, EMERALD: 18, OBSIDIAN: 19, ENCHANT: 20, FIRE: 21,
    SNOW: 22, ICE: 23, SANDSTONE: 24, CACTUS: 25, PINE: 26, MUSHCAP: 27, MUSHCAP2: 28,
    MUSHSTEM: 29, PORTAL: 30, ROAD: 31, KERB: 32, ROADLINE: 33, GRID: 34,
    FURNACE: 35, BED: 36, BEDHEAD: 37,
    TABLE: 38, CHAIR: 39, CHAIR1: 40, CHAIR2: 41, CHAIR3: 42, LAMP: 43, RUG: 44,
  };
  const ids = await page.evaluate(() => window.__henrycraft.ids);
  const moved = Object.keys(ID_TABLE).filter(k => ids[k] !== ID_TABLE[k])
    .map(k => `${k} is ${ids[k]}, was ${ID_TABLE[k]}`);
  check(`all ${Object.keys(ID_TABLE).length} block ids are unchanged`, moved.length === 0,
        moved.join('; '));

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
      /* A thing with a front is four ids for one object - four chairs, one picture -
         so the set counts once. Keyed by family rather than skipped, so a genuine
         clash between two different families is still caught. */
      const key = def.family || def.name;
      const side = def.tiles[2];
      if (sides[side] !== undefined && sides[side] !== key) {
        dupes.push(`${key} and ${sides[side]} share tile ${side}`);
      }
      sides[side] = key;
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

  /* ---- 2b: the second drawer ------------------------------------------------
     Henry wanted a furnace and a bed for the houses he builds, and his dad asked
     that the row of blocks stop growing to hold them. So they live behind a tab
     instead. The point of these checks is that the blocks drawer is exactly as
     big as it was, that one tap reaches the furniture, and that a furnace put in
     a wall is still there tomorrow. */
  console.log('2b. furniture lives in its own drawer and the blocks drawer has not grown');
  const drawers = await page.evaluate(async () => {
    const H = window.__henrycraft;
    const grid = () => [...document.querySelectorAll('#pickerGrid .slot')].map(s => +s.dataset.id);
    const palSlots = () => [...document.querySelectorAll('#palette .slot')].map(s => +s.dataset.id);
    const tabs = id => [...document.querySelectorAll('#' + id + ' .gtab')]
      .map(t => ({key: t.dataset.group, on: t.classList.contains('on')}));

    H.selectBlock(H.ids.GRASS);                 // known starting point: blocks drawer
    const g0 = H.groups();
    const blocksGrid = grid(), blocksPal = palSlots();

    // one tap on the furniture tab, exactly as a finger would do it
    const tab = document.querySelectorAll('#pickTabs .gtab')[1];
    tab.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
    const g1 = H.groups();
    const furnGrid = grid(), furnPal = palSlots();

    // pick the bed from the drawer, and build with it
    const bedSlot = [...document.querySelectorAll('#pickerGrid .slot')]
      .find(s => +s.dataset.id === H.ids.BED);
    bedSlot.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
    const pickedBed = H.selected();
    const closed = document.getElementById('picker').classList.contains('hide');

    H.setBlock(20, 18, 20, H.ids.BED);
    H.setBlock(21, 18, 20, H.ids.FURNACE);
    const placed = [H.getBlock(20, 18, 20), H.getBlock(21, 18, 20)];

    // and back again, without the blocks having changed underneath him
    document.querySelectorAll('#pickTabs .gtab')[0]
      .dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
    const backGrid = grid();

    /* Selecting something from the other drawer has to open that drawer, or the
       highlight ends up somewhere he cannot see. This is what happens when a
       saved district is restored having last been left on a bed. */
    H.selectBlock(H.ids.FURNACE);
    const followed = H.groups().open;

    // a furnace in a wall survives leaving the district and coming back
    await H.saveNow();
    const other = await H.createDistrict('Furniture Test', 'meadow');
    const here = H.districts().list.map(d => d.slug).find(s => s !== other);
    await H.switchDistrict(other);
    await H.switchDistrict(here);

    return {
      open0: g0.open, open1: g1.open,
      keys: g0.list.map(g => g.key),
      blocksGrid, blocksPal, furnGrid, furnPal, backGrid,
      pickTabs: tabs('pickTabs'), palTabs: tabs('palTabs'),
      pickedBed, bed: H.ids.BED, furnace: H.ids.FURNACE, closed, placed, followed,
      /* named one by one rather than read back off FURNITURE, which would only
         prove the drawer renders whatever it is handed */
      wantFurniture: [H.ids.FURNACE, H.ids.BED, H.ids.TABLE, H.ids.CHAIR,
                      H.ids.LAMP, H.ids.RUG],
      names: [H.DEFS[H.ids.FURNACE].name, H.DEFS[H.ids.BED].name],
      inPalette: [H.PALETTE.indexOf(H.ids.FURNACE), H.PALETTE.indexOf(H.ids.BED)],
      survived: [H.getBlock(20, 18, 20), H.getBlock(21, 18, 20)],
      selAfter: H.selected(), openAfter: H.groups().open,
    };
  });
  check('there are two drawers, blocks and furniture',
        drawers.keys.join(',') === 'blocks,furniture', drawers.keys.join(','));
  check('both the palette and the picker carry the tabs',
        drawers.palTabs.length === 2 && drawers.pickTabs.length === 2,
        `palette ${drawers.palTabs.length}, picker ${drawers.pickTabs.length}`);
  /* Nineteen, written out rather than read back from PALETTE. Comparing the grid
     against PALETTE.length only proves the palette renders what it is given - it
     passed happily at twenty. The number is the requirement: the blocks row stops
     growing, and anything new goes in a drawer. Changing this line is a decision,
     which is the point of it being here. */
  check(`the blocks drawer still holds 19 and no more`,
        sel.size === 19 && drawers.blocksGrid.length === 19 && drawers.blocksPal.length === 19,
        `PALETTE ${sel.size}, picker ${drawers.blocksGrid.length}, palette ${drawers.blocksPal.length}`);
  check('the furniture is not in the blocks drawer',
        drawers.inPalette[0] < 0 && drawers.inPalette[1] < 0,
        'PALETTE indexes: ' + drawers.inPalette.join(', '));
  check('one tap opens the furniture drawer',
        drawers.open0 === 0 && drawers.open1 === 1,
        `open went ${drawers.open0} -> ${drawers.open1}`);
  check('the furniture drawer shows the furnace, bed, table, chair, lamp and rug',
        drawers.furnGrid.join(',') === drawers.wantFurniture.join(',') &&
        drawers.furnPal.join(',') === drawers.wantFurniture.join(','),
        `picker [${drawers.furnGrid}], palette [${drawers.furnPal}], ` +
        `wanted [${drawers.wantFurniture}]`);
  check('picking the bed selects it and shuts the picker',
        drawers.pickedBed === drawers.bed && drawers.closed,
        `selected=${drawers.pickedBed} closed=${drawers.closed}`);
  check('the blocks come back unchanged when the first tab is tapped',
        drawers.backGrid.join(',') === drawers.blocksGrid.join(','),
        `${drawers.backGrid.length} slots`);
  check('selecting furniture by id opens the furniture drawer', drawers.followed === 1,
        'drawer ' + drawers.followed);
  check('a furnace and a bed can be placed',
        drawers.placed[0] === drawers.bed && drawers.placed[1] === drawers.furnace,
        JSON.stringify(drawers.placed));
  check('they are still there after leaving the district and coming back',
        drawers.survived[0] === drawers.bed && drawers.survived[1] === drawers.furnace,
        JSON.stringify(drawers.survived));
  note('furniture: ' + drawers.names.join(', ') +
       `; drawer after the round trip: ${drawers.openAfter}`);

  /* ---- 2c: the bed is a bed ------------------------------------------------
     The first version was one cube with a red top, and it read as a cake. A bed
     in Minecraft is two blocks laid end to end and shorter than a block, with a
     frame, legs, a pillow and a headboard. This one is the same, built out of
     twelve little boxes rather than two cubes - and which way it points is worked
     out from where its other half is, so nothing is stored per direction. */
  console.log('2c. a bed is two blocks, points the way he is facing, and is not a cube');
  const bed = await page.evaluate(() => {
    const H = window.__henrycraft, ids = H.ids;
    H.loadThemeSeed('meadow', 77);
    const gy = 24, out = {};
    for (let x = 20; x <= 60; x++) for (let z = 20; z <= 60; z++) {
      for (let y = gy; y < gy + 6; y++) H.setBlock(x, y, z, ids.AIR);
      H.setBlock(x, gy - 1, z, ids.PLANKS);
    }
    H.selectBlock(ids.BED);

    // yaw 0 looks along +Z here: forward is (sin yaw, cos yaw)
    out.placed = [[0, '+Z', [0, 1]], [Math.PI / 2, '+X', [1, 0]],
                  [Math.PI, '-Z', [0, -1]], [-Math.PI / 2, '-X', [-1, 0]]]
      .map(([ang, label, want], i) => {
        const x = 26 + i * 4, z = 30;
        H.movePlayer(x + 0.5, gy + 0.05, z - 2.5);
        H.setYaw(ang);
        H.placeBed({x, y: gy, z});
        const head = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .find(d => H.getBlock(x + d[0], gy, z + d[1]) === ids.BEDHEAD);
        return {label, want,
                foot: H.getBlock(x, gy, z) === ids.BED,
                head: head || null,
                facing: H.bedFacing(x, gy, z, ids.BED)};
      });

    // digging either half takes the other with it
    H.setBlock(40, gy, 40, ids.BED); H.setBlock(41, gy, 40, ids.BEDHEAD);
    H.breakAt(40, gy, 40);
    out.digFoot = [H.getBlock(40, gy, 40), H.getBlock(41, gy, 40)];
    H.setBlock(40, gy, 42, ids.BED); H.setBlock(41, gy, 42, ids.BEDHEAD);
    H.breakAt(41, gy, 42);
    out.digHead = [H.getBlock(40, gy, 42), H.getBlock(41, gy, 42)];

    // nowhere to put the other half: nothing goes down, and he is told
    const bx = 45, bz = 45;
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => H.setBlock(bx + d[0], gy, bz + d[1], ids.STONE));
    H.movePlayer(bx + 0.5, gy + 0.05, bz + 3.5);
    H.placeBed({x: bx, y: gy, z: bz});
    out.noRoom = {cell: H.getBlock(bx, gy, bz),
                  said: document.getElementById('toast').textContent};

    /* Two beds pushed end to end must not pair across the join. Both arrangements:
       foot-head-foot-head, and head-foot-foot-head. */
    H.setBlock(50, gy, 55, ids.BED);     H.setBlock(51, gy, 55, ids.BEDHEAD);
    H.setBlock(52, gy, 55, ids.BED);     H.setBlock(53, gy, 55, ids.BEDHEAD);
    out.inLine = [H.bedFacing(50, gy, 55, ids.BED), H.bedFacing(51, gy, 55, ids.BEDHEAD),
                  H.bedFacing(52, gy, 55, ids.BED), H.bedFacing(53, gy, 55, ids.BEDHEAD)];
    H.setBlock(50, gy, 58, ids.BEDHEAD); H.setBlock(51, gy, 58, ids.BED);
    H.setBlock(52, gy, 58, ids.BED);     H.setBlock(53, gy, 58, ids.BEDHEAD);
    out.headOut = [H.bedFacing(50, gy, 58, ids.BEDHEAD), H.bedFacing(51, gy, 58, ids.BED),
                   H.bedFacing(52, gy, 58, ids.BED), H.bedFacing(53, gy, 58, ids.BEDHEAD)];

    // across a chunk boundary - CHUNK is 16, so 31 and 32 are in different chunks
    H.setBlock(31, gy, 50, ids.BED); H.setBlock(32, gy, 50, ids.BEDHEAD);
    out.chunkEdge = [H.bedFacing(31, gy, 50, ids.BED), H.bedFacing(32, gy, 50, ids.BEDHEAD)];

    // a half on its own, which is how a bed built before today loads
    H.setBlock(56, gy, 58, ids.BED);
    out.lone = H.bedFacing(56, gy, 58, ids.BED);

    /* Shape. A bed is twelve boxes - five in the foot, seven in the head - and six
       faces each, so 144 triangles. Measured as a difference against the same world
       without it, twice: once in the open, and once with the bed pushed against a
       wall. The two must come to the same number. If a prop were treated as a solid
       cube for face culling, the wall would lose the face behind the bed and the
       second figure would come out smaller - which is the bug this catches, and it
       is invisible from the front. */
    const wipe = (x, z) => { H.setBlock(x, gy, z, ids.AIR); H.setBlock(x + 1, gy, z, ids.AIR); };
    wipe(24, 24);
    const base = H.chunkTriangles();
    H.setBlock(24, gy, 24, ids.BED); H.setBlock(25, gy, 24, ids.BEDHEAD);
    out.openTris = H.chunkTriangles() - base;
    wipe(24, 24);

    for (let y = gy; y < gy + 3; y++) H.setBlock(26, y, 24, ids.BRICK);   // a wall
    const walled = H.chunkTriangles();
    H.setBlock(24, gy, 24, ids.BED); H.setBlock(25, gy, 24, ids.BEDHEAD); // head against it
    out.wallTris = H.chunkTriangles() - walled;

    return out;
  });
  const dirEq = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
  check('a bed is two blocks, a foot and a head',
        bed.placed.every(t => t.foot && t.head),
        JSON.stringify(bed.placed.map(t => ({d: t.label, foot: t.foot, head: t.head}))));
  check('it lies the way he is facing, all four ways round',
        bed.placed.every(t => dirEq(t.head, t.want) && dirEq(t.facing, t.want)),
        JSON.stringify(bed.placed));
  check('digging either half takes the other with it',
        bed.digFoot[0] === 0 && bed.digFoot[1] === 0 &&
        bed.digHead[0] === 0 && bed.digHead[1] === 0,
        `foot dug ${bed.digFoot}, head dug ${bed.digHead}`);
  check('with no room for the second half nothing is placed, and he is told',
        bed.noRoom.cell === 0 && /two blocks of room/.test(bed.noRoom.said),
        JSON.stringify(bed.noRoom));
  check('two beds end to end each pair with their own other half',
        bed.inLine.every(f => dirEq(f, [1, 0])) &&
        dirEq(bed.headOut[0], [-1, 0]) && dirEq(bed.headOut[1], [-1, 0]) &&
        dirEq(bed.headOut[2], [1, 0])  && dirEq(bed.headOut[3], [1, 0]),
        `in line ${JSON.stringify(bed.inLine)}, head to head ${JSON.stringify(bed.headOut)}`);
  check('a bed spanning two chunks agrees with itself',
        dirEq(bed.chunkEdge[0], [1, 0]) && dirEq(bed.chunkEdge[1], [1, 0]),
        JSON.stringify(bed.chunkEdge));
  check('a half on its own still lies down as a bed', dirEq(bed.lone, [1, 0]),
        JSON.stringify(bed.lone));
  check(`a bed is 12 boxes, not 2 cubes (${bed.openTris} triangles)`,
        bed.openTris === 144, `${bed.openTris} triangles, expected 144`);
  check('and it does not punch a hole in the wall behind it',
        bed.wallTris === bed.openTris,
        `${bed.wallTris} against a wall, ${bed.openTris} in the open`);

  /* ---- 2e: the rest of the furniture ---------------------------------------
     A table, a chair, a lamp and a rug. Three things they needed that the bed did
     not: a prop with a front, a prop that glows, and a prop you walk straight over. */
  console.log('2e. a table, a chair that faces him, a lamp that glows and a rug he can walk on');
  const room = await page.evaluate(() => {
    const H = window.__henrycraft, ids = H.ids;
    H.loadThemeSeed('meadow', 91);
    const gy = 24, out = {};
    for (let x = 20; x <= 50; x++) for (let z = 20; z <= 50; z++) {
      for (let y = gy; y < gy + 6; y++) H.setBlock(x, y, z, ids.AIR);
      H.setBlock(x, gy - 1, z, ids.PLANKS);
    }

    /* A chair should end up looking at him, so a chair pushed against a wall has
       its back to the wall. Placed through the same call build() uses. */
    H.selectBlock(ids.CHAIR);
    out.chairs = [[0, '+Z', [0, -1]], [Math.PI / 2, '+X', [-1, 0]],
                  [Math.PI, '-Z', [0, 1]], [-Math.PI / 2, '-X', [1, 0]]]
      .map(([ang, looking, want], i) => {
        const x = 24 + i * 3, z = 30;
        H.setYaw(ang);
        const id = H.facingId(ids.CHAIR);
        H.setBlock(x, gy, z, id);
        return {looking, want, id, facing: H.propFacing(x, gy, z, id),
                inFamily: H.FAMILY.chair.indexOf(id)};
      });

    // only the first of the four is offered; the other three are in no drawer
    const g = H.groups();
    out.drawer = {
      furniture: g.list[1].ids.slice(),
      spares: H.FAMILY.chair.slice(1).filter(id => g.list.some(x => x.ids.indexOf(id) >= 0)),
      blocks: g.list[0].ids.length,
    };

    /* Shapes, measured the same way the bed's was. A table is 5 boxes, a chair 6,
       a lamp 3 and a rug 1 - times 12 triangles each. The lamp's shade is the only
       box in the game that is self-lit and not a whole cube, so it is counted in
       the glow group on its own. */
    const clear = (x, z) => H.setBlock(x, gy, z, ids.AIR);
    const delta = (x, z, id, group) => {
      clear(x, z);
      const before = H.chunkTriangles(group);
      H.setBlock(x, gy, z, id);
      const d = H.chunkTriangles(group) - before;
      clear(x, z);
      return d;
    };
    out.tris = {
      table: delta(40, 40, ids.TABLE),
      chair: delta(40, 42, ids.CHAIR),
      lamp: delta(40, 44, ids.LAMP),
      rug: delta(40, 46, ids.RUG),
      lampGlow: delta(40, 44, ids.LAMP, 'glow'),
      tableGlow: delta(40, 40, ids.TABLE, 'glow'),
    };

    /* A rug is walked over, not into. Everything else here is walked into. */
    H.setBlock(35, gy, 35, ids.RUG);
    H.setBlock(36, gy, 35, ids.TABLE);
    out.solid = {rug: H.isSolidAt(35, gy, 35), table: H.isSolidAt(36, gy, 35)};
    out.canStand = {onRug: H.boxFree(35.5, gy, 35.5), onTable: H.boxFree(36.5, gy, 35.5)};
    return out;
  });
  const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
  check('a chair turns to face him, all four ways round',
        room.chairs.every(c => same(c.facing, c.want) && c.inFamily >= 0),
        JSON.stringify(room.chairs));
  check('the four chairs are four different ids',
        new Set(room.chairs.map(c => c.id)).size === 4,
        'ids: ' + room.chairs.map(c => c.id).join(', '));
  check('only one chair is offered in the drawer, and the blocks row is untouched',
        room.drawer.spares.length === 0 && room.drawer.furniture.length === 6 &&
        room.drawer.blocks === 19,
        `spares in a drawer: [${room.drawer.spares}], furniture ${room.drawer.furniture.length}, ` +
        `blocks ${room.drawer.blocks}`);
  check(`table 5 boxes, chair 6, lamp 3, rug 1 ` +
        `(${room.tris.table}/${room.tris.chair}/${room.tris.lamp}/${room.tris.rug} triangles)`,
        room.tris.table === 60 && room.tris.chair === 72 &&
        room.tris.lamp === 36 && room.tris.rug === 12,
        JSON.stringify(room.tris));
  check('the lampshade alone is self-lit, and nothing else is',
        room.tris.lampGlow === 12 && room.tris.tableGlow === 0,
        `lamp puts ${room.tris.lampGlow} triangles in the glow group, table ${room.tris.tableGlow}`);
  check('a rug is walked over and a table is walked into',
        room.solid.rug === false && room.solid.table === true &&
        room.canStand.onRug === true && room.canStand.onTable === false,
        JSON.stringify({solid: room.solid, stand: room.canStand}));

  /* ---- 2d: the furnace fire moves -----------------------------------------
     Same trick as Flint & Steel: one tile of the atlas is repainted on a timer and
     the texture re-uploaded, so nothing is re-meshed. Read off the atlas rather
     than the screen - a screenshot cannot tell a flame that moved from one the
     renderer happened to shade differently.

     The animation is stepped by hand with a known dt, and separately checked to be
     wired into the render loop at all. Waiting and watching measures both at once,
     and under a software rasteriser the frame rate is the smaller number: the first
     version of this saw two pictures in a second and a half and called the flame
     broken, when what it had measured was three frames a second. */
  console.log('2d. the fire in the furnace moves, and idles when there is none');
  const flame = await page.evaluate(async () => {
    const H = window.__henrycraft, ids = H.ids;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    H.loadThemeSeed('meadow', 5);

    const idle = [];
    for (let i = 0; i < 20; i++) { H.tickFire(0.12); idle.push(H.atlasTile(40)); }

    const gy = H.surfaceY(30, 30);
    H.setBlock(30, gy, 30, ids.FURNACE);
    const lit = [];
    for (let i = 0; i < 40; i++) { H.tickFire(0.12); lit.push(H.atlasTile(40)); }
    const counts = H.fireCounts();

    // and it really is on the render loop, not just callable
    const before = H.atlasTile(40);
    let moved = false;
    for (let i = 0; i < 25 && !moved; i++) { await wait(120); moved = H.atlasTile(40) !== before; }

    H.setBlock(30, gy, 30, ids.AIR);
    const after = H.fireCounts();
    const stillNow = H.atlasTile(40);
    for (let i = 0; i < 20; i++) H.tickFire(0.12);
    return {counts, after, moved,
            idleFrames: new Set(idle).size,
            litFrames: new Set(lit).size,
            stopped: H.atlasTile(40) === stillNow};
  });
  check('with no furnace in the world the tile is never touched',
        flame.idleFrames === 1, `${flame.idleFrames} different pictures while idle`);
  check(`a lit furnace cycles eight pictures (${flame.litFrames} seen)`,
        flame.litFrames === 8, `${flame.litFrames} distinct frames over 40 ticks`);
  check('and the render loop is really driving it', flame.moved,
        'the tile never changed on its own in 3 seconds');
  check('digging the furnace out stops the repainting again', flame.stopped,
        'the tile kept changing with no furnace left');
  check('the furnace count follows placing and digging one',
        flame.counts.furnace === 1 && flame.after.furnace === 0,
        `${flame.counts.furnace} lit, ${flame.after.furnace} after digging`);

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

  /* `hide` has to mean hidden. There were rules for `#picker.hide` and `.overlay.hide` and
     nothing else, so every chip carrying the class sat on screen permanently: the lap counter
     while walking, and "who is here: 1" while playing alone, which the markup next to it says
     explicitly must not happen. Nothing in the game said so, because nothing asked. Checked
     on the class in general rather than on those two chips, so whatever is given the class
     next inherits the answer. */
  console.log('\n9. hidden means hidden');
  const hidden = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'hide';
    probe.textContent = 'x';
    document.getElementById('ui').appendChild(probe);
    const generic = getComputedStyle(probe).display;
    probe.className = 'chip hide';
    const asChip = getComputedStyle(probe).display;
    probe.remove();
    /* And the real ones, in the state where they must not show: alone, on foot, in a
       district with no circuit in it. */
    const H = window.__henrycraft;
    H.loadThemeSeed('meadow', 11);
    const off = {};
    ['peopleChip', 'lapChip', 'timeChip', 'kartBtn', 'picker']
      .forEach(id => { off[id] = getComputedStyle(document.getElementById(id)).display; });
    return {generic, asChip, off};
  });
  check('an element with the hide class is not displayed',
        hidden.generic === 'none', `display was ${hidden.generic}`);
  /* A chip sets display:flex with the same specificity, so where the rule sits in the sheet
     is the only thing making this work - exactly the sort of thing that breaks in silence. */
  check('and a chip with the hide class is not displayed either',
        hidden.asChip === 'none', `display was ${hidden.asChip}`);
  check('nothing that should be out of sight in a plain district is on screen',
        Object.keys(hidden.off).every(k => hidden.off[k] === 'none'),
        JSON.stringify(hidden.off));
  note(`the hide class resolves to display:none on a bare div and on a chip; ` +
       `${Object.keys(hidden.off).length} chips checked off in a meadow`);

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

  /* The ideas page is taller than a phone held sideways, and always was. It was
     centred with justify-content, which clips the top off a card that does not fit
     and gives no way to scroll back up to it: the heading was unreachable at 390px
     and the Got it button sat below the fold. Checked at both ends rather than by
     measuring the card, because what matters is whether he can read the first line
     and press the button, not how tall it is. */
  console.log('8c. the ideas page can be read top to bottom and closed');
  for (const v of [{w: 844, h: 390}, {w: 853, h: 477}, {w: 1280, h: 800}]) {
    const c4 = await browser.newContext({viewport: {width: v.w, height: v.h}});
    const p4 = await c4.newPage();
    const errs4 = [];
    p4.on('pageerror', e => errs4.push(e.message));
    await p4.goto(url, {waitUntil: 'load'});
    await p4.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready(),
                             {timeout: 60000});
    await p4.click('#playBtn');
    await p4.waitForTimeout(400);
    const r = await p4.evaluate(() => {
      document.getElementById('mIdeas').click();
      const ov = document.getElementById('ideas');
      ov.scrollTop = 0;
      const head = document.querySelector('#ideas h2').getBoundingClientRect();
      ov.scrollTop = ov.scrollHeight;
      const btn = document.getElementById('ideasDone').getBoundingClientRect();
      const furn = document.getElementById('ideasFurn');
      const panel = getComputedStyle(document.querySelector('#ideas .card')).backgroundColor;
      return {headTop: Math.round(head.top), btnBottom: Math.round(btn.bottom),
              vh: window.innerHeight, furnW: furn.width, furnH: furn.height, panel};
    });
    const fails = [];
    if (r.headTop < 0) fails.push(`heading ${-r.headTop}px above the top when scrolled up`);
    if (r.btnBottom > r.vh) fails.push(`Got it ${r.btnBottom - r.vh}px below the fold when scrolled down`);
    if (!(r.furnW > 0 && r.furnH > 0)) fails.push('the furniture swatches were not drawn');
    if (/rgba?\(0, 0, 0, 0\)/.test(r.panel)) fails.push('the card has no background to read against');
    if (errs4.length) fails.push('page errors: ' + errs4.join(' | '));
    check(`${v.w}x${v.h}  heading at ${r.headTop}, Got it ends at ${r.btnBottom} of ${r.vh}`,
          fails.length === 0, fails.join('; '));
    await c4.close();
  }

  check('no page errors during the whole run', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  srv.close();

  console.log(`\npassed ${passed}, failed ${failed}`);
  console.log('\nReported numbers');
  notes.forEach(n => console.log('  - ' + n));
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
