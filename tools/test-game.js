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
    TV: 45, TV1: 46, TV2: 47, TV3: 48,
    BATH: 49, BATH1: 50, BATH2: 51, BATH3: 52,
    SINK: 53, SINK1: 54, SINK2: 55, SINK3: 56,
    TOILET: 57, TOILET1: 58, TOILET2: 59, TOILET3: 60,
    TILES: 61,
    DOOR: 62, DOOR1: 63, DOOR2: 64, DOOR3: 65,
    DOOROPEN: 66, DOOROPEN1: 67, DOOROPEN2: 68, DOOROPEN3: 69,
    DOORTOP: 70,
    PLATE: 71, PLATE1: 72, PLATE2: 73, PLATE3: 74,
    DINNER: 75, DINNER1: 76, DINNER2: 77, DINNER3: 78,
    CAKE: 79, CUP: 80,
    FENCE: 81,
    GATE: 82, GATE1: 83, GATE2: 84, GATE3: 85,
    GATEOPEN: 86, GATEOPEN1: 87, GATEOPEN2: 88, GATEOPEN3: 89,
    HAY: 90, TROUGH: 91,
    SHELF: 92, SHELF1: 93, SHELF2: 94, SHELF3: 95,
    REGISTER: 96, REGISTER1: 97, REGISTER2: 98, REGISTER3: 99,
    BREAD: 100, APPLES: 101, MILK: 102,
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
      /* Keyed by the name a player would use. Four chairs are one chair, and a door
         open and a door shut are one door - both are several ids for one object and
         share its picture. A clash between two things he would call by different
         names is still caught, which is what this is for. */
      const key = def.name;
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
                      H.ids.LAMP, H.ids.RUG, H.ids.TV, H.ids.BATH, H.ids.SINK,
                      H.ids.TOILET, H.ids.TILES, H.ids.DOOR,
                      H.ids.PLATE, H.ids.DINNER, H.ids.CAKE, H.ids.CUP],
      names: [H.DEFS[H.ids.FURNACE].name, H.DEFS[H.ids.BED].name],
      inPalette: [H.PALETTE.indexOf(H.ids.FURNACE), H.PALETTE.indexOf(H.ids.BED)],
      survived: [H.getBlock(20, 18, 20), H.getBlock(21, 18, 20)],
      selAfter: H.selected(), openAfter: H.groups().open,
    };
  });
  check('there are four drawers: blocks, furniture, the zoo and the shop',
        drawers.keys.join(',') === 'blocks,furniture,zoo,shop', drawers.keys.join(','));
  check('both the palette and the picker carry the tabs',
        drawers.palTabs.length === 4 && drawers.pickTabs.length === 4,
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
  check('the furniture drawer shows all sixteen pieces, in order',
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

    // forward is (-sin yaw, -cos yaw), the same as rayHit: yaw 0 looks along -Z
    out.placed = [[0, '-Z', [0, -1]], [Math.PI / 2, '-X', [-1, 0]],
                  [Math.PI, '+Z', [0, 1]], [-Math.PI / 2, '+X', [1, 0]]]
      .map(([ang, label, want], i) => {
        const x = 26 + i * 4, z = 30;
        H.movePlayer(x + 0.5 - want[0] * 2.5, gy + 0.05, z + 0.5 - want[1] * 2.5);
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
    out.chairs = [[0, 'he looks -Z', [0, 1]], [Math.PI / 2, 'he looks -X', [1, 0]],
                  [Math.PI, 'he looks +Z', [0, -1]], [-Math.PI / 2, 'he looks +X', [-1, 0]]]
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
        room.drawer.spares.length === 0 && room.drawer.furniture.length === 16 &&
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

  /* ---- 2g: the headboard goes against the wall, and things can be turned ----
     He built a bed in a corner and the headboard ended up pointing into the room.
     It was doing what it was told: the head went one step the way he was looking,
     and when that cell was the wall it fell through to "+X, +Z, -X, -Z, take the
     first free one" - an order with nothing to do with where the wall is. Now all
     eight arrangements are scored, and something solid behind the headboard is
     worth more than everything else put together. */
  console.log('2g. a bed puts its headboard against the wall, and furniture turns');
  const walls = await page.evaluate(() => {
    const H = window.__henrycraft, ids = H.ids;
    H.loadThemeSeed('meadow', 12);
    const gy = 24, out = {};
    const room = (x0, z0, x1, z1) => {
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        for (let y = gy; y < gy + 6; y++) H.setBlock(x, y, z, ids.AIR);
        H.setBlock(x, gy - 1, z, ids.PLANKS);
      }
    };
    room(20, 20, 60, 60);
    const headOf = (fx, fz) => {
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (H.getBlock(fx + d[0], gy, fz + d[1]) === ids.BEDHEAD) return d;
      return null;
    };
    const wipe = (x, z) => { for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++)
      { const b = H.getBlock(x + dx, gy, z + dz); if (b === ids.BED || b === ids.BEDHEAD)
        H.setBlock(x + dx, gy, z + dz, ids.AIR); } };

    /* A flat wall along -Z, him standing in the room looking at it, aiming at the
       floor cell right beside it. The head has to end up in that cell with the
       headboard against the wall - not one step further into the wall, and not
       spun round into the room. */
    for (let x = 28; x <= 36; x++) for (let y = gy; y < gy + 4; y++) H.setBlock(x, y, 30, ids.BRICK);
    H.movePlayer(32.5, gy + 0.05, 34.5);
    H.setYaw(0);                                  // looking along -Z, at the wall
    H.placeBed({x: 32, y: gy, z: 31});            // the floor cell beside it
    out.flatWall = {head: H.getBlock(32, gy, 31) === ids.BEDHEAD,
                    foot: H.getBlock(32, gy, 32) === ids.BED,
                    behind: H.getBlock(32, gy, 30) === ids.BRICK};
    wipe(32, 31);

    /* A corner: walls along -Z and -X meeting at (40,40). He aims at the cell in
       the corner. The headboard has to be against one of the two walls. */
    for (let x = 40; x <= 46; x++) for (let y = gy; y < gy + 4; y++) H.setBlock(x, y, 40, ids.BRICK);
    for (let z = 40; z <= 46; z++) for (let y = gy; y < gy + 4; y++) H.setBlock(40, y, z, ids.BRICK);
    H.movePlayer(43.5, gy + 0.05, 43.5);
    H.setYaw(0);                                  // looking along -Z, into the corner
    H.placeBed({x: 41, y: gy, z: 41});
    const cornerHead = H.getBlock(41, gy, 41) === ids.BEDHEAD ? [41, 41]
                     : (H.getBlock(41, gy, 41) === ids.BED ? headOf(41, 41) : null);
    out.corner = {
      inCorner: H.getBlock(41, gy, 41) === ids.BEDHEAD,
      /* whichever way it lies, the cell beyond the head must be a wall */
      backedOnWall: (() => {
        for (let x = 39; x <= 44; x++) for (let z = 39; z <= 44; z++) {
          if (H.getBlock(x, gy, z) !== ids.BEDHEAD) continue;
          const f = H.propFacing(x, gy, z, ids.BEDHEAD);
          return H.getBlock(x + f[0], gy, z + f[1]) === ids.BRICK;
        }
        return false;
      })(),
    };
    wipe(41, 41);

    /* And in the open, with no wall anywhere, it still lies away from him. */
    H.movePlayer(50.5, gy + 0.05, 52.5);
    H.setYaw(0);                                  // looking along -Z
    H.placeBed({x: 50, y: gy, z: 51});
    out.open = {foot: H.getBlock(50, gy, 51) === ids.BED, head: headOf(50, 51)};
    wipe(50, 51);

    /* Turning. Four presses on a chair bring it back to where it started. */
    H.setYaw(0);
    const chair0 = H.facingId(ids.CHAIR);
    H.setBlock(55, gy, 55, chair0);
    const spin = [];
    for (let i = 0; i < 4; i++) { H.turnFurniture(55, gy, 55); spin.push(H.getBlock(55, gy, 55)); }
    out.spin = {ids: spin, distinct: new Set(spin).size, backToStart: spin[3] === chair0};

    /* Turning a bed moves the head and leaves the foot where it is. */
    H.setBlock(50, gy, 45, ids.BED); H.setBlock(51, gy, 45, ids.BEDHEAD);
    H.turnFurniture(50, gy, 45);
    out.turnBed = {footStayed: H.getBlock(50, gy, 45) === ids.BED,
                   oldHeadGone: H.getBlock(51, gy, 45) !== ids.BEDHEAD,
                   newHead: headOf(50, 45)};
    wipe(50, 45);

    /* Nothing without a front answers to it, so building a house around the
       furniture still builds. */
    H.setBlock(46, gy, 50, ids.TABLE);
    H.setBlock(46, gy, 52, ids.BRICK);
    H.setBlock(46, gy, 54, ids.RUG);
    out.notTurned = {table: H.turnFurniture(46, gy, 50), brick: H.turnFurniture(46, gy, 52),
                     rug: H.turnFurniture(46, gy, 54), air: H.turnFurniture(46, gy + 3, 50)};

    /* The same bed whichever way he faces. Two arrangements lay the right way and
       scored the same, so the tie fell whichever way the candidate list happened to
       be built: looking along +X or +Z left the bed where he pointed, and along -X
       or -Z shifted it one cell back over the ground he was standing on. */
    out.sameEitherWay = [[0, '-Z', [0, -1]], [Math.PI / 2, '-X', [-1, 0]],
                         [Math.PI, '+Z', [0, 1]], [-Math.PI / 2, '+X', [1, 0]]]
      .map(([ang, label, look], i) => {
        const x = 24 + i * 4, z = 58;
        // stand two and a half blocks back along the way he is looking
        H.movePlayer(x + 0.5 - look[0] * 2.5, gy + 0.05, z + 0.5 - look[1] * 2.5);
        H.setYaw(ang);
        H.placeBed({x, y: gy, z});
        return {label, footAtAimed: H.getBlock(x, gy, z) === ids.BED,
                head: headOf(x, z)};
      });

    /* Something put on a rug should stand on the floor he pointed at, not a block
       above it. A rug is a sixteenth of a block thick, so "on top of it" used to
       mean the cell above - a table hovering with daylight under its legs. */
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
      H.setBlock(36 + dx, gy, 48 + dz, ids.RUG);
    H.movePlayer(36.5, gy + 0.05, 51.5);
    H.setYaw(0);                                  // looking along -Z, at the carpet
    H.setPitch(-0.55);
    H.selectBlock(ids.TABLE);
    H.build();
    let carpetLeft = 0, tableCell = null;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (H.getBlock(36 + dx, gy, 48 + dz) === ids.RUG) carpetLeft++;
      if (H.getBlock(36 + dx, gy, 48 + dz) === ids.TABLE) tableCell = [36 + dx, 48 + dz];
    }
    let floating = false;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
      if (H.getBlock(36 + dx, gy + 1, 48 + dz) === ids.TABLE) floating = true;
    out.onRug = {inRugCell: !!tableCell, tableCell, floating, carpetLeft};
    return out;
  });
  check('a bed built at a wall puts its head in the cell beside it, headboard to the wall',
        walls.flatWall.head && walls.flatWall.foot && walls.flatWall.behind,
        JSON.stringify(walls.flatWall));
  check('a bed built in a corner backs its headboard onto one of the two walls',
        walls.corner.backedOnWall, JSON.stringify(walls.corner));
  check('in the open it still lies away from him, as it did',
        walls.open.foot && !!walls.open.head &&
        walls.open.head[0] === 0 && walls.open.head[1] === -1,
        JSON.stringify(walls.open));
  check('four presses turn a chair right round and back',
        walls.spin.distinct === 4 && walls.spin.backToStart,
        JSON.stringify(walls.spin));
  check('turning a bed moves the head and leaves the foot where it is',
        walls.turnBed.footStayed && walls.turnBed.oldHeadGone && !!walls.turnBed.newHead,
        JSON.stringify(walls.turnBed));
  check('the same bed however he is facing: the cell he pointed at is the foot',
        walls.sameEitherWay.every(t => t.footAtAimed),
        JSON.stringify(walls.sameEitherWay));
  check('a table goes on the rug he pointed at, not a block above it',
        walls.onRug.inRugCell && !walls.onRug.floating,
        JSON.stringify(walls.onRug));
  check('and the rest of the carpet is still there',
        walls.onRug.carpetLeft === 8, `${walls.onRug.carpetLeft} of 8 squares left`);
  check('a table, a brick, a rug and thin air do not turn',
        !walls.notTurned.table && !walls.notTurned.brick &&
        !walls.notTurned.rug && !walls.notTurned.air,
        JSON.stringify(walls.notTurned));

  /* ---- 2f: the telly and the bathroom --------------------------------------
     Four more things with a front, so the four-ids-per-family machinery is
     exercised by five families rather than one, and a screen that moves - the third
     animated tile, which is what turned two variables into a table. */
  console.log('2f. a telly that faces him and plays, and a bath, sink and toilet');
  const bathroom = await page.evaluate(async () => {
    const H = window.__henrycraft, ids = H.ids;
    H.loadThemeSeed('meadow', 33);
    const gy = 24, out = {};
    for (let x = 20; x <= 50; x++) for (let z = 20; z <= 50; z++) {
      for (let y = gy; y < gy + 6; y++) H.setBlock(x, y, z, ids.AIR);
      H.setBlock(x, gy - 1, z, ids.PLANKS);
    }

    /* Every family turns to face him, and every family is four different ids. */
    out.families = ['tv', 'bath', 'sink', 'toilet', 'chair'].map(key => {
      const ids4 = H.FAMILY[key];
      const placed = [[0, [0, 1]], [Math.PI / 2, [1, 0]],
                      [Math.PI, [0, -1]], [-Math.PI / 2, [-1, 0]]]
        .map(([ang, want], i) => {
          H.setYaw(ang);
          const id = H.facingId(ids4[0]);
          const x = 25 + i, z = 25 + ids4[0] % 7;
          H.setBlock(x, gy, z, id);
          const f = H.propFacing(x, gy, z, id);
          return {id, ok: f[0] === want[0] && f[1] === want[1]};
        });
      return {key, distinct: new Set(placed.map(p => p.id)).size, count: ids4.length,
              allFace: placed.every(p => p.ok)};
    });

    // shapes: tv 3 boxes, bath 7, sink 4, toilet 5, and tiles is an ordinary cube
    const delta = (id, group) => {
      H.setBlock(44, gy, 44, ids.AIR);
      const before = H.chunkTriangles(group);
      H.setBlock(44, gy, 44, id);
      const d = H.chunkTriangles(group) - before;
      H.setBlock(44, gy, 44, ids.AIR);
      return d;
    };
    out.tris = {tv: delta(ids.TV), bath: delta(ids.BATH), sink: delta(ids.SINK),
                toilet: delta(ids.TOILET), tvGlow: delta(ids.TV, 'glow'),
                bathGlow: delta(ids.BATH, 'glow')};
    H.setBlock(44, gy, 44, ids.BATH);
    const bathSolid = H.isSolidAt(44, gy, 44);
    H.setBlock(44, gy, 44, ids.TILES);
    out.solid = {bath: bathSolid, tiles: H.isSolidAt(44, gy, 44)};
    H.setBlock(44, gy, 44, ids.AIR);

    /* A fresh world before the animation, because the placing above left four
       tellies standing in the last one - and "no telly anywhere" is exactly the
       claim the idle check is making. The first version of this measured its own
       leftovers and reported nine pictures where the answer had to be one. */
    H.loadThemeSeed('meadow', 34);
    const gy2 = H.surfaceY(30, 30);
    const idle = [];
    for (let i = 0; i < 30; i++) { H.tickFire(0.12); idle.push(H.atlasTile(54)); }

    /* The screen, stepped by hand at a known rate. Counted the same way the
       furnace's was, and for the same reason - waiting and watching measures the
       frame rate rather than the picture.

       Only samples that follow an actual repaint count, and each frame number is
       checked to draw the same picture every time round. Counting every sample
       reported nine pictures for eight frames: the ninth was what buildAtlas left
       on the tile, which differs from the animation's own frame 0 by exactly one
       unit of green on the scanline rows. Canvas rounds an alpha fill differently
       over transparent than over existing pixels, and the screen is the only tile
       here drawn with an alpha pass. 1/255 of green - not visible, not worth
       chasing, and not a ninth frame. */
    H.setBlock(30, gy2, 30, ids.TV);
    const seen = {}, clash = [];
    let last = H.fireCounts().frames[2];
    for (let i = 0; i < 90; i++) {
      H.tickFire(0.12);
      const f = H.fireCounts().frames[2];
      if (f === last) continue;                    // nothing was repainted
      last = f;
      const pic = H.atlasTile(54);
      if (seen[f] === undefined) seen[f] = pic;
      else if (seen[f] !== pic) clash.push(f);
    }
    out.screen = {idleFrames: new Set(idle).size,
                  litFrames: Object.keys(seen).length,
                  distinct: new Set(Object.values(seen)).size,
                  clash};

    /* And it runs slower than an open fire on purpose, so a room with both in it
       is not two things flashing. Over the same ticks, from the same standing
       start, the fire should get through three times as many pictures. */
    H.loadThemeSeed('meadow', 34);
    H.setBlock(30, gy2, 30, ids.TV);
    H.setBlock(31, gy2, 30, ids.FIRE);
    let fireChanges = 0, tvChanges = 0;
    let lastFire = H.atlasTile(23), lastTv = H.atlasTile(54);
    for (let i = 0; i < 90; i++) {
      H.tickFire(0.12);
      const f = H.atlasTile(23), t = H.atlasTile(54);
      if (f !== lastFire) { fireChanges++; lastFire = f; }
      if (t !== lastTv) { tvChanges++; lastTv = t; }
    }
    out.rate = {fireChanges, tvChanges};
    out.counts = H.fireCounts();
    return out;
  });
  check('all five families are four ids each, and all four turn to face him',
        bathroom.families.every(f => f.count === 4 && f.distinct === 4 && f.allFace),
        JSON.stringify(bathroom.families));
  check(`tv 3 boxes, bath 7, sink 4, toilet 5 ` +
        `(${bathroom.tris.tv}/${bathroom.tris.bath}/${bathroom.tris.sink}/${bathroom.tris.toilet})`,
        bathroom.tris.tv === 36 && bathroom.tris.bath === 84 &&
        bathroom.tris.sink === 48 && bathroom.tris.toilet === 60,
        JSON.stringify(bathroom.tris));
  check('the screen alone is self-lit, and the bath is not',
        bathroom.tris.tvGlow === 12 && bathroom.tris.bathGlow === 0,
        `tv ${bathroom.tris.tvGlow} glow triangles, bath ${bathroom.tris.bathGlow}`);
  check('a bath and a tiled floor are both walked into',
        bathroom.solid.bath === true && bathroom.solid.tiles === true,
        JSON.stringify(bathroom.solid));
  check('with no telly in the world its tile is never touched',
        bathroom.screen.idleFrames === 1,
        `${bathroom.screen.idleFrames} different pictures while idle`);
  check(`a telly plays eight pictures, and the same one each time round ` +
        `(${bathroom.screen.litFrames} frames, ${bathroom.screen.distinct} pictures)`,
        bathroom.screen.litFrames === 8 && bathroom.screen.distinct === 8 &&
        bathroom.screen.clash.length === 0,
        JSON.stringify(bathroom.screen));
  check(`a fire gets through three pictures to the telly's one ` +
        `(${bathroom.rate.fireChanges} against ${bathroom.rate.tvChanges})`,
        bathroom.rate.tvChanges > 0 &&
        bathroom.rate.fireChanges === bathroom.rate.tvChanges * 3,
        JSON.stringify(bathroom.rate));
  check('the counts follow what is in the world', bathroom.counts.tv === 1 &&
        bathroom.counts.fire === 1 && bathroom.counts.furnace === 0,
        JSON.stringify(bathroom.counts));

  /* ---- 2h: the door ---------------------------------------------------------
     The one piece of furniture with state. Two blocks tall because he has to walk
     through it, and the top half is a single id that reads which way it faces and
     whether it is open off the half underneath - so opening one changes one block
     and the two can never disagree.

     The check that matters most is that it cannot trap him. A door is the only
     decorative thing in the game that can turn a cell he is standing in from empty
     into solid, and this game does not do stuck. */
  console.log('2h. a door opens, shuts, and will not shut on him');
  const door = await page.evaluate(() => {
    const H = window.__henrycraft, ids = H.ids;
    H.loadThemeSeed('meadow', 51);
    const gy = 24, out = {};
    for (let x = 20; x <= 52; x++) for (let z = 20; z <= 52; z++) {
      for (let y = gy; y < gy + 8; y++) H.setBlock(x, y, z, ids.AIR);
      H.setBlock(x, gy - 1, z, ids.PLANKS);
    }
    // a wall along z=34 with a gap at x=34
    for (let x = 28; x <= 40; x++) for (let y = gy; y < gy + 3; y++)
      if (x !== 34) H.setBlock(x, y, 34, ids.BRICK);

    const openIds = [ids.DOOROPEN, ids.DOOROPEN1, ids.DOOROPEN2, ids.DOOROPEN3];
    const shutIds = [ids.DOOR, ids.DOOR1, ids.DOOR2, ids.DOOR3];
    const isOpen = () => openIds.indexOf(H.getBlock(34, gy, 34)) >= 0;

    H.selectBlock(ids.DOOR);
    H.movePlayer(34.5, gy + 0.05, 37.5);
    H.setYaw(0);                                  // looking -Z, at the gap
    H.placeDoor({x: 34, y: gy, z: 34});
    out.placed = {bottom: shutIds.indexOf(H.getBlock(34, gy, 34)) >= 0,
                  top: H.getBlock(34, gy + 1, 34) === ids.DOORTOP,
                  facing: H.propFacing(34, gy, 34, H.getBlock(34, gy, 34))};
    out.shut = {low: H.isSolidAt(34, gy, 34), high: H.isSolidAt(34, gy + 1, 34),
                canPass: H.boxFree(34.5, gy, 34.5)};

    /* Open it, and check the TOP half went soft too - it has no state of its own,
       so if it did not follow the bottom he would walk into an invisible lintel. */
    H.movePlayer(34.5, gy + 0.05, 36.5);
    H.toggleDoor(34, gy, 34);
    out.open = {isOpen: isOpen(), top: H.getBlock(34, gy + 1, 34) === ids.DOORTOP,
                low: H.isSolidAt(34, gy, 34), high: H.isSolidAt(34, gy + 1, 34),
                canPass: H.boxFree(34.5, gy, 34.5)};

    // it cannot be shut on him, and it can still be opened from inside
    H.movePlayer(34.5, gy + 0.05, 34.5);
    const refused = H.toggleDoor(34, gy, 34);
    out.onSelf = {handled: refused, stillOpen: isOpen(),
                  said: document.getElementById('toast').textContent};

    // step out, shut it, and it is a wall again
    H.movePlayer(34.5, gy + 0.05, 36.5);
    H.toggleDoor(34, gy, 34);
    out.shutAgain = {isShut: !isOpen(), low: H.isSolidAt(34, gy, 34),
                     high: H.isSolidAt(34, gy + 1, 34)};

    /* An open door must not be built into. It is passable, and passable and
       replaceable are two different ideas: a rug is both, a doorway is only the
       first, and getting that wrong would delete the door when he builds a wall. */
    H.toggleDoor(34, gy, 34);
    H.selectBlock(ids.BRICK);
    out.notReplaced = {before: isOpen(),
                       cellFree: H.boxFree(34.5, gy, 34.5)};
    H.setBlock(34, gy, 34, H.getBlock(34, gy, 34));   // no-op, keeps the door
    out.notReplaced.after = isOpen();

    // shape: two boxes per half, both halves, open or shut
    const wipe = () => { H.setBlock(34, gy, 34, ids.AIR); H.setBlock(34, gy + 1, 34, ids.AIR); };
    wipe();
    const base = H.chunkTriangles();
    H.placeDoor({x: 34, y: gy, z: 34});
    out.trisShut = H.chunkTriangles() - base;
    H.toggleDoor(34, gy, 34);
    out.trisOpen = H.chunkTriangles() - base;

    // digging either half takes the other
    H.breakAt(34, gy + 1, 34);
    out.dugTop = [H.getBlock(34, gy, 34), H.getBlock(34, gy + 1, 34)];
    H.placeDoor({x: 34, y: gy, z: 34});
    H.breakAt(34, gy, 34);
    out.dugBottom = [H.getBlock(34, gy, 34), H.getBlock(34, gy + 1, 34)];

    // a top half with nothing under it draws nothing rather than guessing
    wipe();
    const bare = H.chunkTriangles();
    H.setBlock(34, gy + 1, 34, ids.DOORTOP);
    out.orphanTop = H.chunkTriangles() - bare;
    H.setBlock(34, gy + 1, 34, ids.AIR);

    // no headroom
    H.setBlock(30, gy + 1, 30, ids.BRICK);
    H.movePlayer(30.5, gy + 0.05, 32.5);
    out.noRoom = {placed: H.placeDoor({x: 30, y: gy, z: 30}),
                  cell: H.getBlock(30, gy, 30),
                  said: document.getElementById('toast').textContent};
    return out;
  });
  check('a door is two blocks, and it faces him',
        door.placed.bottom && door.placed.top &&
        door.placed.facing[0] === 0 && door.placed.facing[1] === 1,
        JSON.stringify(door.placed));
  check('shut, it is a wall - both halves, and he cannot walk through',
        door.shut.low && door.shut.high && !door.shut.canPass,
        JSON.stringify(door.shut));
  check('open, both halves go soft and he walks through',
        door.open.isOpen && door.open.top && !door.open.low && !door.open.high &&
        door.open.canPass, JSON.stringify(door.open));
  check('it will not shut on him while he is in the doorway',
        door.onSelf.handled && door.onSelf.stillOpen &&
        /doorway/.test(door.onSelf.said), JSON.stringify(door.onSelf));
  check('and shut again it is a wall again',
        door.shutAgain.isShut && door.shutAgain.low && door.shutAgain.high,
        JSON.stringify(door.shutAgain));
  check('an open doorway is walked through, not built into',
        door.notReplaced.before && door.notReplaced.after && door.notReplaced.cellFree,
        JSON.stringify(door.notReplaced));
  /* Six boxes now rather than four: the handle used to be one bar driven straight
     through the panel, which is two boxes sharing a volume, and it is a knob on
     each face instead. Three boxes a half, both halves, open or shut. */
  check(`a door is 6 boxes open or shut (${door.trisShut}/${door.trisOpen} triangles)`,
        door.trisShut === 72 && door.trisOpen === 72,
        `${door.trisShut} shut, ${door.trisOpen} open`);
  check('digging either half takes the other with it',
        door.dugTop[0] === 0 && door.dugTop[1] === 0 &&
        door.dugBottom[0] === 0 && door.dugBottom[1] === 0,
        `top dug ${door.dugTop}, bottom dug ${door.dugBottom}`);
  check('a top half with nothing under it draws nothing', door.orphanTop === 0,
        `${door.orphanTop} triangles`);
  check('with no headroom nothing is placed, and he is told',
        !door.noRoom.placed && door.noRoom.cell === 0 &&
        /two blocks of room/.test(door.noRoom.said), JSON.stringify(door.noRoom));

  /* ---- 2i: dinner on the table, and sitting down at it ----------------------
     He asked for food and plates and knives and forks so there could be dinner on
     the table, and to be able to sit down at a table or on the toilet. */
  console.log('2i. dinner goes on the table, and he can sit down at it');
  const dinner = await page.evaluate(() => {
    const H = window.__henrycraft, ids = H.ids;
    H.loadThemeSeed('meadow', 63);
    const gy = 24, out = {};
    for (let x = 20; x <= 52; x++) for (let z = 20; z <= 52; z++) {
      for (let y = gy; y < gy + 6; y++) H.setBlock(x, y, z, ids.AIR);
      H.setBlock(x, gy - 1, z, ids.PLANKS);
    }

    /* A plate goes ON the table - the cell above it - rather than a block higher
       or in place of the table. Placed by aiming at the table and pressing build,
       which is what he does. */
    H.setBlock(30, gy, 30, ids.TABLE);
    H.selectBlock(ids.PLATE);
    /* Close enough and steep enough to catch the TOP of the table rather than its
       near side or the floor in front of it - the aimed cell is asserted below, so
       a stance that misses says so instead of looking like a placement bug. */
    H.movePlayer(30.5, gy + 0.05, 31.5);
    H.setYaw(0); H.setPitch(-0.62);
    const aimedAt = H.aimAt();          // before building: afterwards it hits the plate
    H.build();
    out.onTable = {aimed: aimedAt,
                   above: H.getBlock(30, gy + 1, 30),
                   isPlate: H.FAMILY.plate.indexOf(H.getBlock(30, gy + 1, 30)) >= 0,
                   table: H.getBlock(30, gy, 30) === ids.TABLE,
                   higher: H.getBlock(30, gy + 2, 30)};

    /* Dinner is walked through, not into - it is a sixteenth of a block of china -
       but it is not swept away by building next to it. */
    H.setBlock(40, gy, 40, ids.DINNER);
    out.food = {passable: H.isSolidAt(40, gy, 40) === false,
                notReplaced: (() => {
                  const before = H.getBlock(40, gy, 40);
                  H.setBlock(41, gy, 40, ids.BRICK);        // a neighbour, not the cell
                  return H.getBlock(40, gy, 40) === before;
                })()};

    const delta = (id) => {
      H.setBlock(44, gy, 44, ids.AIR);
      const before = H.chunkTriangles();
      H.setBlock(44, gy, 44, id);
      const d = H.chunkTriangles() - before;
      H.setBlock(44, gy, 44, ids.AIR);
      return d;
    };
    out.tris = {plate: delta(ids.PLATE), dinner: delta(ids.DINNER),
                cake: delta(ids.CAKE), cup: delta(ids.CUP)};

    /* Sitting. A chair, a toilet and a bath all have a seat height; a table and a
       telly do not, so he cannot sit on those. */
    out.seats = ['CHAIR', 'TOILET', 'BATH'].map(k => {
      H.setBlock(35, gy, 35, ids[k]);
      const s = H.seatAtFor(35, gy, 35);
      return {k, seat: s !== null};
    });
    H.setBlock(35, gy, 35, ids.TABLE);
    out.notSeats = {table: H.seatAtFor(35, gy, 35) === null,
                    tv: (H.setBlock(35, gy, 35, ids.TV), H.seatAtFor(35, gy, 35) === null)};

    /* Sit on a chair: he ends up on the seat, facing the way the chair does, and
       the chip changes to standing up. */
    H.setBlock(30, gy, 34, ids.CHAIR);          // dir 0, looking +X
    H.movePlayer(30.5, gy + 0.05, 35.5);
    out.near = H.seatNear();
    H.toggleSit();
    out.sat = {seat: H.sitting(), p: H.player(),
               chip: !document.getElementById('sitBtn').classList.contains('hide'),
               label: document.getElementById('sitBtn').textContent};

    /* The avatar and the camera have to keep following him while he is sitting.
       The first version returned out of updatePlayer before the code that moves
       them, so he sat down and the picture stayed where he had been standing -
       invisible to anything that only reads player(). */
    const camBefore = H.avatarAt().cam;
    H.step(0.05); H.step(0.05);
    const av = H.avatarAt();
    out.drawn = {avatarOnSeat: Math.abs(av.x - 30.5) < 0.01 && Math.abs(av.z - 34.5) < 0.01 &&
                               Math.abs(av.y - (gy + 0.56)) < 0.01,
                 kneesUp: av.legs < -1.0,
                 camMoved: Math.abs(av.cam.x - camBefore.x) > 0.001 ||
                           Math.abs(av.cam.z - camBefore.z) > 0.001 ||
                           Math.abs(av.cam.y - camBefore.y) > 0.001};

    // pushing the stick gets him up
    H.setInput({fwd: 1});
    H.step(0.05);
    H.setInput({fwd: 0});
    out.stoodByMoving = {seat: H.sitting(), free: H.boxFree(H.player().x, H.player().y, H.player().z)};

    // digging the chair out from under him gets him up too
    H.movePlayer(30.5, gy + 0.05, 35.5);
    H.toggleSit();
    const satAgain = !!H.sitting();
    H.setBlock(30, gy, 34, ids.AIR);
    H.step(0.05);
    out.dugOut = {satAgain, seat: H.sitting()};

    // and the toilet, since that is what he asked for by name
    H.setBlock(38, gy, 38, ids.TOILET);
    H.movePlayer(38.5, gy + 0.05, 39.5);
    H.toggleSit();
    out.toilet = {seat: H.sitting(), y: +H.player().y.toFixed(2), want: +(gy + 0.62).toFixed(2)};
    H.standUp();
    out.stoodUp = {seat: H.sitting(),
                   free: H.boxFree(H.player().x, H.player().y, H.player().z)};
    return out;
  });
  check('a plate goes on the table he pointed at, not a block above it',
        !!dinner.onTable.aimed && dinner.onTable.aimed.x === 30 &&
        dinner.onTable.aimed.y === 24 && dinner.onTable.aimed.z === 30 &&
        dinner.onTable.isPlate && dinner.onTable.table && dinner.onTable.higher === 0,
        JSON.stringify(dinner.onTable));
  check('dinner is walked through, and not swept off by building beside it',
        dinner.food.passable && dinner.food.notReplaced, JSON.stringify(dinner.food));
  check(`plate 3 boxes, dinner 3, cake 3, cup 2 ` +
        `(${dinner.tris.plate}/${dinner.tris.dinner}/${dinner.tris.cake}/${dinner.tris.cup})`,
        dinner.tris.plate === 36 && dinner.tris.dinner === 36 &&
        dinner.tris.cake === 36 && dinner.tris.cup === 24, JSON.stringify(dinner.tris));
  check('a chair, a toilet and a bath can be sat on; a table and a telly cannot',
        dinner.seats.every(s => s.seat) && dinner.notSeats.table && dinner.notSeats.tv,
        JSON.stringify({seats: dinner.seats, not: dinner.notSeats}));
  check('sitting puts him on the seat, and the chip offers standing up',
        !!dinner.sat.seat && Math.abs(dinner.sat.p.y - 24.56) < 0.01 &&
        dinner.sat.chip && dinner.sat.label === '🧍',
        JSON.stringify(dinner.sat));
  check('the avatar and the camera keep following him while he sits',
        dinner.drawn.avatarOnSeat && dinner.drawn.kneesUp,
        JSON.stringify(dinner.drawn));
  check('pushing the stick stands him up, somewhere he fits',
        dinner.stoodByMoving.seat === null && dinner.stoodByMoving.free,
        JSON.stringify(dinner.stoodByMoving));
  check('digging the seat out from under him stands him up',
        dinner.dugOut.satAgain && dinner.dugOut.seat === null,
        JSON.stringify(dinner.dugOut));
  check('and he can sit on the toilet, which is what he asked for by name',
        !!dinner.toilet.seat && Math.abs(dinner.toilet.y - dinner.toilet.want) < 0.01,
        JSON.stringify(dinner.toilet));
  check('standing up leaves him somewhere he fits',
        dinner.stoodUp.seat === null && dinner.stoodUp.free,
        JSON.stringify(dinner.stoodUp));

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

  // ---- 6b: turtles, mermaids and crabs -------------------------------------
  // Henry asked for these three. The shark's promise now has to cover them, and
  // the crabs have a promise of their own: a crab is the only creature in the
  // game that walks on the line between land and water, so it is the only one
  // that can end up in the wrong one.
  console.log('6b. turtles, mermaids and crabs');
  const zoo = [];
  for (let s = 0; s < SEEDS; s++) {
    const seed = 1000 + s * 7919;
    zoo.push(await page.evaluate(({seed}) => {
      const H = window.__henrycraft;
      H.loadSeed(seed);
      const kinds = {};
      H.fish().forEach(f => { kinds[f.kind] = (kinds[f.kind] || 0) + 1; });
      const crabs = H.crabs();
      // 90 seconds of pottering, which is long enough for a crab to walk the
      // length of a beach and meet both ends of it.
      const sim = H.simulate(90);
      const after = H.crabs();
      return {seed, kinds, crabs: crabs.length,
              // Ground covered, not distance from the start: a crab that shuffles
              // up the beach and back finishes where it began. Without this every
              // check below would pass on six crabs that never moved.
              moved: sim.crabWalk,
              // the shoreline rule, measured after the walking rather than at spawn
              toWater: after.map(c => c.toWater),
              onWater: after.filter(c => c.standingOn === 0 || c.standingIn !== 0).length,
              violations: sim.violationCount,
              first: sim.violations[0] || null};
    }, {seed}));
  }
  const kindTotal = k => zoo.reduce((a, r) => a + (r.kinds[k] || 0), 0);
  const worldsWith = k => zoo.filter(r => (r.kinds[k] || 0) > 0).length;
  check(`turtles swim in all ${SEEDS} worlds`,
        worldsWith('turtle') === SEEDS,
        `${worldsWith('turtle')}/${SEEDS} worlds, ${kindTotal('turtle')} turtles`);
  check(`mermaids swim in all ${SEEDS} worlds`,
        worldsWith('mermaid') === SEEDS,
        `${worldsWith('mermaid')}/${SEEDS} worlds, ${kindTotal('mermaid')} mermaids`);
  check('the axolotls and sharks that were there before still are',
        worldsWith('axolotl') === SEEDS && kindTotal('shark') > 0,
        `${worldsWith('axolotl')}/${SEEDS} with axolotls, ${kindTotal('shark')} sharks`);
  const crabTotal = zoo.reduce((a, r) => a + r.crabs, 0);
  check(`crabs walk the shore in all ${SEEDS} worlds`,
        zoo.every(r => r.crabs > 0), `crab counts ${zoo.map(r => r.crabs).join(',')}`);
  // Without this the two checks below would pass on six crabs stood still.
  const allMoved = zoo.flatMap(r => r.moved);
  check('and they actually walk - every crab covered ground over the 90 seconds',
        allMoved.every(d => d > 2),
        `shortest walk ${Math.min(...allMoved).toFixed(2)} blocks`);
  check('no crab ever stood in water or on it, at any step',
        zoo.every(r => r.violations === 0 && r.onWater === 0),
        JSON.stringify(zoo.find(r => r.violations || r.onWater)?.first || null));
  const farthest = Math.max(...zoo.flatMap(r => r.toWater));
  check('and none of them wandered inland away from the sea',
        farthest <= 4, `farthest from water after 90s: ${farthest} blocks`);
  note(`${kindTotal('turtle')} turtles, ${kindTotal('mermaid')} mermaids, ` +
       `${kindTotal('axolotl')} axolotls, ${kindTotal('shark')} sharks and ${crabTotal} crabs ` +
       `across ${SEEDS} worlds; crabs walked ${Math.min(...allMoved).toFixed(1)}-` +
       `${Math.max(...allMoved).toFixed(1)} blocks and stayed within ${farthest} of water`);

  // The promise that matters, extended to the whole cast. It used to cover the
  // shark alone, because the shark was the only one whose path could be
  // reproduced - the others wandered on Math.random() and so no two runs could
  // be compared. Every creature carries a seeded stream now, so the strongest
  // check in this file applies to all of them: put Henry somewhere completely
  // different and not one of the fish, turtles, mermaids or crabs moves an inch
  // differently.
  const allIndep = await page.evaluate(({secs}) => {
    const H = window.__henrycraft;
    function run(x, y, z) {
      H.loadSeed(555001);
      H.movePlayer(x, y, z);
      const sim = H.simulate(secs);
      return {path: sim.path, n: sim.fish + sim.crabs};
    }
    const a = run(8, 20, 8), b = run(56, 34, 56);
    return {ok: a.path.length > 0 && a.path === b.path, n: a.n, len: a.path.length};
  }, {secs: 30});
  check('no creature in the game moves differently when Henry moves',
        allIndep.ok && allIndep.n > 0,
        `${allIndep.n} creatures, ${allIndep.len} chars of path`);
  note(`${allIndep.n} creatures traced byte-identically over 30s from two ` +
       `positions 68 blocks apart`);

  // ---- 6c: a zoo -----------------------------------------------------------
  // Henry wants to build a pen and keep animals in it, so the thing to prove is
  // that a pen holds. Every check below runs with Henry stood just outside the
  // wall, because animals walk towards him when he is near: that is the hardest
  // the pen ever gets pushed, and standing him far away would have made all of
  // this pass on animals that never went near a fence.
  console.log('6c. a pen keeps the animals in it');
  const PEN = 9;                       // outside measurement, so 7x7 of room inside
  const pen = await page.evaluate(async ({PEN}) => {
    const H = window.__henrycraft;
    const ids = H.ids;
    /* Flatten a patch first. Henry does this with the dig buttons; there is no
       flat 9x9 anywhere in a hilly world to find, and a pen built across a slope
       would be testing the height rule rather than the fence. */
    function clearing(px, pz, y, n) {
      for (let a = -3; a < n + 3; a++) for (let b = -3; b < n + 3; b++) {
        for (let yy = y - 4; yy < y; yy++) H.setBlock(px + a, yy, pz + b, yy === y - 1 ? ids.GRASS : ids.DIRT);
        for (let yy = y; yy < y + 6; yy++) H.setBlock(px + a, yy, pz + b, ids.AIR);
      }
    }
    /* One run: build a wall out of `wall` (as many blocks high as `high`), stand
       an animal in the middle, put Henry outside, and run the clock. */
    function run(opts) {
      H.loadSeed(4242);
      const px = 20, pz = 20, y = 14, n = opts.n || PEN;
      clearing(px, pz, y, n);
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
        if (!(a === 0 || a === n - 1 || b === 0 || b === n - 1)) continue;
        if (opts.gapAt && opts.gapAt[0] === a && opts.gapAt[1] === b) continue;
        const id = (opts.gateAt && opts.gateAt[0] === a && opts.gateAt[1] === b)
          ? opts.gateId : opts.wall;
        for (let h = 0; h < (opts.high || 1); h++) H.setBlock(px + a, y + h, pz + b, id);
      }
      H.moveAnimal(0, px + n / 2, pz + n / 2);
      /* Just outside the wall he is nearest, well within the 7 blocks at which
         they start walking over. */
      H.movePlayer(px + n + 1.5, y, pz + n / 2);
      const sim = H.simulate(opts.secs || 300);
      const b = sim.animalBox[0];
      /* Compared by column, and by columns the simulation itself recorded: an
         animal pressed against the inside of the fence sits at x = 27.9996, which
         rounds to the fence's own number on the way out. The question is which
         block it is standing on, so that is what is counted. */
      return {
        px, pz, y, n,
        minCol: [b.minCX - px, b.minCZ - pz],
        maxCol: [b.maxCX - px, b.maxCZ - pz],
        inside: b.minCX >= px + 1 && b.maxCX <= px + n - 2 &&
                b.minCZ >= pz + 1 && b.maxCZ <= pz + n - 2,
        roamed: +Math.max(b.maxX - b.minX, b.maxZ - b.minZ).toFixed(2),
      };
    }
    return {
      fence:      run({wall: ids.FENCE}),
      gap:        run({wall: ids.FENCE, gapAt: [4, 0]}),
      gateShut:   run({wall: ids.FENCE, gateAt: [4, 0], gateId: ids.GATE}),
      gateOpen:   run({wall: ids.FENCE, gateAt: [4, 0], gateId: ids.GATEOPEN}),
      stone2:     run({wall: ids.STONE, high: 2}),
      stone1:     run({wall: ids.STONE, high: 1}),
      big:        run({wall: ids.FENCE, n: 17, secs: 600}),
    };
  }, {PEN});
  check('a fence pen holds an animal for five minutes with Henry stood outside it',
        pen.fence.inside,
        `reached columns ${pen.fence.minCol} to ${pen.fence.maxCol} of a ${pen.fence.n}-wide pen`);
  /* The control. Without it every check here would pass on an animal that never
     walked far enough to test anything, and I would not know. */
  check('and one fence block missing lets it straight out, so the check above can see an escape',
        !pen.gap.inside,
        `with a gap it still reached only ${pen.gap.minCol} to ${pen.gap.maxCol}`);
  check('it uses the whole pen rather than standing in the middle of it',
        pen.fence.roamed > 4, `roamed ${pen.fence.roamed} blocks across a 7-block yard`);
  check('a shut gate in the wall holds it too', pen.gateShut.inside,
        `reached ${pen.gateShut.minCol} to ${pen.gateShut.maxCol}`);
  /* A gate swings so Henry can walk through it, not so the animals can. If an
     open gate were a hole, the first thing he did with his own zoo would empty it.
   */
  check('and so does an open one - a gate is for Henry, not for the animals',
        pen.gateOpen.inside, `reached ${pen.gateOpen.minCol} to ${pen.gateOpen.maxCol}`);
  check('a wall two blocks high still holds, the way it always did',
        pen.stone2.inside, `reached ${pen.stone2.minCol} to ${pen.stone2.maxCol}`);
  /* And the reason the fence needed a flag of its own rather than a height: one
     block of anything else is a step, not a wall. */
  check('a wall one block high does not, which is why a fence is a flag and not a height',
        !pen.stone1.inside, 'a one-block stone wall held it in, so the fence flag is doing nothing');
  check('a seventeen-wide pen holds for ten minutes', pen.big.inside,
        `reached ${pen.big.minCol} to ${pen.big.maxCol}, roamed ${pen.big.roamed}`);
  note(`fence pen: roamed ${pen.fence.roamed} blocks over 5 minutes and never left ` +
       `columns ${pen.fence.minCol}-${pen.fence.maxCol}; with a one-block gap it reached ` +
       `${pen.gap.minCol} to ${pen.gap.maxCol}`);

  /* The gate is the door's machinery on a one-block block, so the things that
     went wrong with the door are the things to check here: that it is one block
     and not two, that opening really clears the way, and that the guard which
     stops a door being shut on him came along with it. */
  const gate = await page.evaluate(() => {
    const H = window.__henrycraft, ids = H.ids, out = {};
    H.loadThemeSeed('meadow', 51);
    const gy = 24;
    for (let x = 28; x <= 40; x++) for (let z = 28; z <= 40; z++) {
      for (let y = gy; y < gy + 6; y++) H.setBlock(x, y, z, ids.AIR);
      H.setBlock(x, gy - 1, z, ids.PLANKS);
    }
    const openIds = [ids.GATEOPEN, ids.GATEOPEN1, ids.GATEOPEN2, ids.GATEOPEN3];
    const shutIds = [ids.GATE, ids.GATE1, ids.GATE2, ids.GATE3];
    const isOpen = () => openIds.indexOf(H.getBlock(34, gy, 34)) >= 0;

    H.movePlayer(34.5, gy + 0.05, 36.5);
    H.setYaw(0);                                     // looking -Z, at the gate
    H.selectBlock(ids.GATE);
    H.setBlock(34, gy, 34, H.facingId(ids.GATE));
    out.placed = {one: shutIds.indexOf(H.getBlock(34, gy, 34)) >= 0,
                  nothingAbove: H.getBlock(34, gy + 1, 34) === ids.AIR,
                  facing: H.propFacing(34, gy, 34, H.getBlock(34, gy, 34))};
    out.shut = {solid: H.isSolidAt(34, gy, 34), canPass: H.boxFree(34.5, gy, 34.5)};

    H.toggleDoor(34, gy, 34);
    out.open = {isOpen: isOpen(), solid: H.isSolidAt(34, gy, 34),
                canPass: H.boxFree(34.5, gy, 34.5)};

    H.movePlayer(34.5, gy + 0.05, 34.5);
    const refused = H.toggleDoor(34, gy, 34);
    out.onSelf = {handled: refused, stillOpen: isOpen(),
                  said: document.getElementById('toast').textContent};

    H.movePlayer(34.5, gy + 0.05, 36.5);
    H.toggleDoor(34, gy, 34);
    out.shutAgain = {isShut: !isOpen(), solid: H.isSolidAt(34, gy, 34)};

    /* Digging a gate takes the gate. The door clears two cells, and a gate going
       through the same toggle must not have picked that up as well - it would
       take a bite out of whatever is above it. */
    H.setBlock(34, gy + 1, 34, ids.BRICK);
    H.breakAt(34, gy, 34);
    out.dug = {gate: H.getBlock(34, gy, 34), above: H.getBlock(34, gy + 1, 34),
               wantAbove: ids.BRICK};

    /* Open or shut, an animal treats it as fence. This is the flag rather than the
       walking, which the pen runs above cover. */
    H.setBlock(34, gy, 34, ids.GATE);
    out.pennedShut = H.penned(34.5, gy + 1, 34.5);
    H.setBlock(34, gy, 34, ids.GATEOPEN);
    out.pennedOpen = H.penned(34.5, gy + 1, 34.5);
    H.setBlock(34, gy, 34, ids.FENCE);
    out.pennedFence = H.penned(34.5, gy + 1, 34.5);
    H.setBlock(34, gy, 34, ids.PLANKS);
    out.pennedPlanks = H.penned(34.5, gy + 1, 34.5);

    /* A fence reaches out to what it stands next to, so a run of them is a run
       and not a row of posts. Counted in triangles rather than read off a flag,
       because what is drawn is the whole question - the first version had rails
       fixed along Z, which looked right along one wall of a pen and like separate
       panels along the other two. A post is one box; each side that joins adds
       two rails. */
    const wipe = () => {
      for (let x = 30; x <= 38; x++) for (let z = 30; z <= 38; z++)
        H.setBlock(x, gy, z, ids.AIR);
    };
    wipe();
    const bare = H.chunkTriangles();
    H.setBlock(34, gy, 34, ids.FENCE);
    out.lone = H.chunkTriangles() - bare;
    H.setBlock(35, gy, 34, ids.FENCE);
    out.pairX = H.chunkTriangles() - bare;
    wipe();
    for (let x = 32; x <= 36; x++) H.setBlock(x, gy, 34, ids.FENCE);
    out.runX = H.chunkTriangles() - bare;
    wipe();
    for (let z = 32; z <= 36; z++) H.setBlock(34, gy, z, ids.FENCE);
    out.runZ = H.chunkTriangles() - bare;
    wipe();
    /* One fence with a wall on one side and a rug on the other: it should meet
       the wall and ignore the rug, which has nothing at the edge of its cell for
       a rail to reach. The neighbour's own geometry is measured first and taken
       off - counting it as part of the fence is what made the first version of
       this check read 44 triangles for a post and two rails. */
    H.setBlock(35, gy, 34, ids.PLANKS);
    const wallOnly = H.chunkTriangles() - bare;
    H.setBlock(34, gy, 34, ids.FENCE);
    out.toWall = H.chunkTriangles() - bare - wallOnly;
    wipe();
    H.setBlock(33, gy, 34, ids.RUG);
    const rugOnly = H.chunkTriangles() - bare;
    H.setBlock(34, gy, 34, ids.FENCE);
    out.toRug = H.chunkTriangles() - bare - rugOnly;
    wipe();
    return out;
  });
  check('a gate is one block, not two, and it faces him',
        gate.placed.one && gate.placed.nothingAbove &&
        gate.placed.facing[0] === 0 && gate.placed.facing[1] === 1,
        JSON.stringify(gate.placed));
  check('shut, he cannot walk through it',
        gate.shut.solid && !gate.shut.canPass, JSON.stringify(gate.shut));
  check('open, he can', gate.open.isOpen && !gate.open.solid && gate.open.canPass,
        JSON.stringify(gate.open));
  check('and it will not shut on him while he is standing in it',
        gate.onSelf.handled && gate.onSelf.stillOpen &&
        /gateway/i.test(gate.onSelf.said), JSON.stringify(gate.onSelf));
  check('it shuts again behind him', gate.shutAgain.isShut && gate.shutAgain.solid,
        JSON.stringify(gate.shutAgain));
  check('digging a gate takes the gate and nothing above it',
        gate.dug.gate === 0 && gate.dug.above === gate.dug.wantAbove,
        JSON.stringify(gate.dug));
  check('a fence and a gate are pens, open or shut; planks are not',
        gate.pennedShut && gate.pennedOpen && gate.pennedFence && !gate.pennedPlanks,
        JSON.stringify({shut: gate.pennedShut, open: gate.pennedOpen,
                        fence: gate.pennedFence, planks: gate.pennedPlanks}));
  /* A post is 12 triangles; each side that joins adds two rails, so 24 more. */
  check('a fence on its own is a post', gate.lone === 12, `${gate.lone} triangles`);
  check('two side by side reach out to each other', gate.pairX === 12 * 2 + 24 * 2,
        `${gate.pairX} triangles, wanted ${12 * 2 + 24 * 2}`);
  /* Five in a row: two ends with one arm each, three middles with two - and the
     same answer along X and along Z, which is the thing the first version got
     wrong. */
  check('a run of five joins up, and the same along either axis',
        gate.runX === 5 * 12 + 8 * 24 && gate.runZ === gate.runX,
        `along X ${gate.runX}, along Z ${gate.runZ}, wanted ${5 * 12 + 8 * 24}`);
  check('it meets a wall but not a rug',
        gate.toWall === 12 + 24 && gate.toRug === 12,
        `to a wall ${gate.toWall}, to a rug ${gate.toRug}`);

  // ---- 6d: carrying an animal to the pen -----------------------------------
  console.log('6d. picking an animal up and carrying it');
  const carry = await page.evaluate(() => {
    const H = window.__henrycraft, ids = H.ids;
    H.loadSeed(4242);
    const px = 20, pz = 20, y = 14;
    for (let a = -3; a < 14; a++) for (let b = -3; b < 14; b++) {
      for (let yy = y - 4; yy < y; yy++) H.setBlock(px + a, yy, pz + b, yy === y - 1 ? ids.GRASS : ids.DIRT);
      for (let yy = y; yy < y + 6; yy++) H.setBlock(px + a, yy, pz + b, ids.AIR);
    }
    H.moveAnimal(0, px + 1.5, pz + 1.5);
    /* Out of reach first: the button must not offer to pick up an animal on the
       other side of the field. */
    H.movePlayer(px + 8.5, y, pz + 8.5);
    const farOff = H.pickUp();
    /* Now next to it. */
    H.movePlayer(px + 2.2, y, pz + 1.5);
    const gotIt = H.pickUp();
    const held = H.carrying();
    const listedHeld = H.animalList()[0].held;
    /* Carry it right across the clearing. Ten seconds of simulation while it is
       held: it must not walk out of his arms. */
    H.movePlayer(px + 10.5, y, pz + 10.5);
    H.setYaw(0);                                  /* looking down -Z */
    H.simulate(10);
    const stillHeld = H.carrying();
    const wentWalking = Math.hypot(stillHeld.x - (px + 10.5), stillHeld.z - (pz + 10.5)) > 2;
    /* Put it down in the cell he is looking at, which at yaw 0 is one to -Z. */
    const putIt = H.putDown();
    const after = H.animalList()[0];
    const landed = Math.hypot(after.x - (px + 10.5), after.z - (pz + 9.5)) < 1.2;
    /* And it is an animal again: not held, back to full size, and walking. */
    /* Step away first. An animal stands still while he is within a couple of
       blocks of it - it has come over to see him - so simulating with Henry stood
       on top of it would have measured that rather than whether it can walk. */
    H.movePlayer(px + 1.5, y, pz + 1.5);
    const before = {x: after.x, z: after.z};
    H.simulate(30);
    const now = H.animalList()[0];
    const walking = Math.hypot(now.x - before.x, now.z - before.z) > 0.5;
    return {farOff, gotIt, held, listedHeld, stillHeld, wentWalking, putIt,
            after, landed, walking, scale: after.held};
  });
  check('an animal across the field cannot be picked up', carry.farOff === false);
  check('one at arm\'s length can be, and it goes into his arms',
        carry.gotIt === true && carry.held !== null && carry.listedHeld === true,
        JSON.stringify(carry.held));
  check('it stays in his arms while he walks - it does not go back to wandering',
        carry.stillHeld !== null && carry.wentWalking === false,
        JSON.stringify(carry.stillHeld));
  check('putting it down leaves it in front of him, on the ground',
        carry.putIt === true && carry.landed === true,
        JSON.stringify(carry.after));
  check('and it walks about again afterwards, at its own size',
        carry.walking === true && carry.after.held === false,
        JSON.stringify(carry.after));

  const refuse = await page.evaluate(() => {
    const H = window.__henrycraft, ids = H.ids;
    H.loadSeed(4242);
    const px = 20, pz = 20, y = 14;
    for (let a = -3; a < 10; a++) for (let b = -3; b < 10; b++) {
      for (let yy = y - 4; yy < y; yy++) H.setBlock(px + a, yy, pz + b, yy === y - 1 ? ids.GRASS : ids.DIRT);
      for (let yy = y; yy < y + 6; yy++) H.setBlock(px + a, yy, pz + b, ids.AIR);
    }
    H.moveAnimal(0, px + 2.5, pz + 2.5);
    H.movePlayer(px + 3.2, y, pz + 2.5);
    H.pickUp();
    const got = H.carrying() !== null;
    /* A wall right in front of him. There is nowhere to put an animal down, and
       forcing it would push a cow into a stone block. */
    H.setYaw(0);
    for (let h = 0; h < 3; h++) H.setBlock(px + 3, y + h, pz + 1, ids.STONE);
    const intoWall = H.putDown();
    const stillHolding = H.carrying() !== null;
    /* And over water. Same answer, different reason - an animal cannot swim. */
    for (let h = 0; h < 3; h++) H.setBlock(px + 3, y + h, pz + 1, ids.AIR);
    for (let yy = y - 4; yy < y; yy++) H.setBlock(px + 3, yy, pz + 1, ids.WATER);
    const intoWater = H.putDown();
    const stillHolding2 = H.carrying() !== null;
    /* Somewhere with room, and it goes down. */
    for (let yy = y - 4; yy < y; yy++) H.setBlock(px + 3, yy, pz + 1, yy === y - 1 ? ids.GRASS : ids.DIRT);
    const ok = H.putDown();
    return {got, intoWall, stillHolding, intoWater, stillHolding2, ok,
            free: H.carrying() === null};
  });
  check('putting one down into a wall is refused, and he keeps hold of it',
        refuse.got && refuse.intoWall === true && refuse.stillHolding === true);
  check('and into the water, for the same reason',
        refuse.intoWater === true && refuse.stillHolding2 === true);
  check('somewhere with room, it goes down', refuse.ok === true && refuse.free === true);

  /* The bug this feature introduced. A crab keeps to the shore by refusing every
     step that takes it away from water - which, carried into a pen in the middle
     of a field, refused every step there was, and the crab stood still for ever.
     It potters instead when there is no shore to keep to. */
  const inlandCrab = await page.evaluate(() => {
    const H = window.__henrycraft, ids = H.ids;
    H.loadSeed(4242);
    const px = 20, pz = 20, y = 20;             // high and dry, far above the sea
    /* Wide enough that the whole of the crab's own eight-block search for water
       lands on the plateau. A narrower one would leave the sea just in reach and
       the crab would still have a shore to keep to, which is not this test. */
    for (let a = -14; a < 24; a++) for (let b = -14; b < 24; b++) {
      for (let yy = y - 6; yy < y; yy++) H.setBlock(px + a, yy, pz + b, yy === y - 1 ? ids.GRASS : ids.DIRT);
      for (let yy = y; yy < y + 6; yy++) H.setBlock(px + a, yy, pz + b, ids.AIR);
    }
    const before = H.crabs()[0];
    if (!before) return null;
    H.movePlayer(px + 4.5, y, pz + 4.5);
    /* Stand the crab on the plateau by hand - the same thing carrying it there
       and putting it down amounts to. */
    H.moveCrab(0, px + 4.5, pz + 4.5);
    const placed = H.crabs()[0];
    const sim = H.simulate(60);
    return {toWater: placed.toWater, walked: sim.crabWalk[0], after: H.crabs()[0]};
  });
  check('a crab carried away from the sea still walks about instead of freezing',
        inlandCrab !== null && inlandCrab.toWater > 4 && inlandCrab.walked > 5,
        JSON.stringify(inlandCrab));
  note(`crab ${inlandCrab.toWater} blocks from any water covered ` +
       `${inlandCrab.walked} blocks in a minute`);

  // ---- 6e: the zoo is still there tomorrow ---------------------------------
  /* The animals used to be spawned from the world seed on every load, so a pen
     Henry filled in the evening came back in the morning with the fence still
     standing and the pigs back out in the field. Their positions go in the
     district record now. Checked by leaving the district and coming back, which
     is the same code path as closing the tab and opening it again. */
  console.log('6e. a pen he filled still has the animals in it tomorrow');
  const kept = await page.evaluate(async () => {
    const H = window.__henrycraft, ids = H.ids;
    H.loadSeed(4242);
    const px = 20, pz = 20, y = 14, n = 9;
    for (let a = -3; a < n + 3; a++) for (let b = -3; b < n + 3; b++) {
      for (let yy = y - 4; yy < y; yy++) H.setBlock(px + a, yy, pz + b, yy === y - 1 ? ids.GRASS : ids.DIRT);
      for (let yy = y; yy < y + 6; yy++) H.setBlock(px + a, yy, pz + b, ids.AIR);
    }
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++)
      if (a === 0 || a === n - 1 || b === 0 || b === n - 1) H.setBlock(px + a, y, pz + b, ids.FENCE);
    /* Three of them penned, and one crab, so both lists are covered. */
    H.moveAnimal(0, px + 3.5, pz + 3.5);
    H.moveAnimal(1, px + 5.5, pz + 4.5);
    H.moveAnimal(2, px + 4.5, pz + 6.5);
    H.moveCrab(0, px + 6.5, pz + 6.5);
    const before = {a: H.animalList().slice(0, 3).map(a => [a.x, a.z]),
                    c: H.crabs().slice(0, 1).map(c => [c.x, c.z])};
    await H.saveNow();

    /* Out of the district and back, which is what a reload does to a world. */
    const other = await H.createDistrict('Zoo Test', 'meadow');
    const here = H.districts().list.map(d => d.slug).find(s => s !== other);
    await H.switchDistrict(other);
    await H.switchDistrict(here);

    const after = {a: H.animalList().slice(0, 3).map(a => [a.x, a.z]),
                   c: H.crabs().slice(0, 1).map(c => [c.x, c.z])};
    const inPen = after.a.every(p => p[0] > px && p[0] < px + n - 1 &&
                                     p[1] > pz && p[1] < pz + n - 1) &&
                  after.c.every(p => p[0] > px && p[0] < px + n - 1 &&
                                     p[1] > pz && p[1] < pz + n - 1);
    const moved = after.a.map((p, i) => Math.hypot(p[0] - before.a[i][0], p[1] - before.a[i][1]));
    /* And the fence is still standing, so "in the pen" means something. */
    const fence = H.getBlock(px, y, pz + 4) === ids.FENCE;
    return {before, after, inPen, moved: Math.max(...moved), fence};
  });
  check('the animals come back where they were left, not where the seed put them',
        kept.inPen && kept.moved < 0.2 && kept.fence,
        JSON.stringify(kept));
  note(`three animals and a crab came back within ${kept.moved.toFixed(3)} blocks ` +
       `of where they were penned`);

  /* The control: a record with no zoo field is every district saved before today,
     and it has to load rather than come up empty. */
  const oldRec = await page.evaluate(async () => {
    const H = window.__henrycraft;
    H.loadSeed(4242);
    const seeded = H.animalList().map(a => [a.x, a.z]);
    /* Ask the loader to place from a record that has no zoo in it at all. */
    H.zooFromSave(undefined);
    const same = H.animalList().every((a, i) =>
      Math.abs(a.x - seeded[i][0]) < 1e-9 && Math.abs(a.z - seeded[i][1]) < 1e-9);
    /* And one that is nonsense, which must be ignored rather than believed. */
    H.zooFromSave({a: [['x', null, {}], [1]], c: 'nope'});
    const stillSame = H.animalList().every((a, i) =>
      Math.abs(a.x - seeded[i][0]) < 1e-9 && Math.abs(a.z - seeded[i][1]) < 1e-9);
    return {n: seeded.length, same, stillSame};
  });
  check('a district saved before today loads with its animals where the seed put them',
        oldRec.n > 0 && oldRec.same && oldRec.stillSame, JSON.stringify(oldRec));

  // ---- 6e2: no prop has two boxes in the same place ------------------------
  /* Henry could see the shelf flickering. The cause was two boxes sharing a
     volume - the uprights ran the full height of the block and every board passed
     through them - and worse, an upright's top face and the top board's top face
     were both on y=16 over the same patch. Two faces on one plane pointing the
     same way is what z-fighting is.

     Back to back is fine and must not be flagged, or every prop that stands one
     box on another fails: the lower box's top points up, the upper box's bottom
     points down, and the one you cannot see is culled. Same-side is the fault.

     Written as a sweep over every prop rather than a check on the shelf, because
     the shelf was not the only one. It found nine: the bed's headboard driven
     through its frame, water sunk into the sink and the toilet sharing their rims,
     a door handle passing through the door, another sitting wholly inside the open
     one where nobody could see it, both gates' rails running through their stiles,
     and the shelf and the register. */
  console.log('6e2. no prop has two boxes in the same place');
  const geom = await page.evaluate(() => {
    const shapes = window.__henrycraft.propShapes();
    const AX = ['x', 'y', 'z'];
    const faults = [];
    let props = 0, boxes = 0, pairs = 0;
    for (const name of Object.keys(shapes)) {
      const bs = shapes[name].map(b => ({lo: [b[0], b[1], b[2]], hi: [b[3], b[4], b[5]]}));
      props++; boxes += bs.length;
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        pairs++;
        const A = bs[i], B = bs[j];
        const ov = [0, 1, 2].map(k => Math.min(A.hi[k], B.hi[k]) - Math.max(A.lo[k], B.lo[k]));
        if (ov[0] > 1e-9 && ov[1] > 1e-9 && ov[2] > 1e-9) {
          faults.push(`${name}: boxes ${i} and ${j} interpenetrate by ` +
                      ov.map(v => v.toFixed(2)).join('x'));
          continue;
        }
        for (let k = 0; k < 3; k++) {
          if (!(ov[(k + 1) % 3] > 1e-9 && ov[(k + 2) % 3] > 1e-9)) continue;
          if (Math.abs(A.lo[k] - B.lo[k]) < 1e-9)
            faults.push(`${name}: boxes ${i} and ${j} share a ${AX[k]}-low face at ${A.lo[k]}`);
          if (Math.abs(A.hi[k] - B.hi[k]) < 1e-9)
            faults.push(`${name}: boxes ${i} and ${j} share a ${AX[k]}-high face at ${A.hi[k]}`);
        }
      }
    }
    return {faults, props, boxes, pairs};
  });
  check(`no two boxes in any of ${geom.props} props overlap or share a face plane`,
        geom.faults.length === 0, geom.faults.slice(0, 5).join(' | '));
  note(`${geom.pairs} pairs of boxes across ${geom.props} props, ${geom.boxes} boxes in all`);

  // ---- 6f: the shop -------------------------------------------------------
  // Henry has been building grocery stores and asked for a cash register, money,
  // shelves with food on them, and a basket to fill and take to the till.
  console.log('6f. filling a basket and ringing it up');
  const shopSetup = () => ({});
  const shop = await page.evaluate(async () => {
    const H = window.__henrycraft, ids = H.ids, out = {};
    H.loadSeed(4242);
    const px = 24, pz = 24, y = 16;
    for (let a = -2; a < 12; a++) for (let b = -2; b < 12; b++) {
      for (let yy = y - 3; yy < y; yy++) H.setBlock(px + a, yy, pz + b, yy === y - 1 ? ids.TILES : ids.STONE);
      for (let yy = y; yy < y + 7; yy++) H.setBlock(px + a, yy, pz + b, ids.AIR);
    }
    /* A run of shelving with one of each thing on it, and a till at the end. */
    const goods = [ids.BREAD, ids.APPLES, ids.MILK, ids.CAKE, ids.CUP];
    for (let b = 0; b < goods.length; b++) {
      H.setBlock(px + 1, y, pz + b, ids.SHELF);
      H.setBlock(px + 1, y + 1, pz + b, goods[b]);
    }
    H.setBlock(px + 5, y, pz + 2, ids.REGISTER2);
    H.emptyBasket();
    H.movePlayer(px + 20, y, pz + 20);

    out.wanted = goods.slice();
    out.prices = goods.map(g => H.price(g));
    /* Away from the shop there is nothing to press. */
    out.awayFromShop = H.shop().action;

    /* At each shelf in turn: the button offers to take, and taking fills the
       basket without touching the shelf. Edits counted either side, because
       "the shelf never changes" is also what makes shopping need no server. */
    const editsBefore = Object.keys(H.edits()).length;
    const shelfBefore = goods.map((_, b) => H.getBlock(px + 1, y + 1, pz + b));
    const actions = [];
    for (let b = 0; b < goods.length; b++) {
      H.movePlayer(px + 2.5, y, pz + b + 0.5);
      const st = H.shop();
      actions.push(st.action);
      H.doShop();
    }
    out.actions = actions;
    out.basket = H.shop().basket;
    out.total = H.shop().total;
    out.shelfAfter = goods.map((_, b) => H.getBlock(px + 1, y + 1, pz + b));
    out.editsUnchanged = Object.keys(H.edits()).length === editsBefore;
    out.shelfUnchanged = shelfBefore.join(',') === out.shelfAfter.join(',');

    /* The bar shows one picture per thing in the basket. */
    out.strip = H.shop().strip;
    out.barShown = H.shop().barShown;

    /* At the till it becomes a checkout rather than another shelf, even though
       there is a bag of apples on the counter beside it. */
    H.setBlock(px + 5, y + 1, pz + 2, ids.APPLES);
    H.movePlayer(px + 4.2, y, pz + 2.5);
    const atTill = H.shop();
    out.atTill = {action: atTill.action, icon: atTill.icon, shown: atTill.shown};

    /* Ring it up, and wait for it to finish rather than for a stopwatch: the
       beeps are on timers, and this page draws well under a frame a second, so
       a fixed sleep reads a till that is still going and calls it broken. */
    const coinsBefore = H.coins();
    const expected = H.shop().total;
    H.doShop();
    for (let i = 0; i < 200 && H.shop().ringing; i++) {
      await new Promise(r => setTimeout(r, 50));
    }
    out.paid = H.coins() - coinsBefore;
    out.expected = expected;
    out.emptyAfter = H.shop().basket.length === 0;
    out.barGone = H.shop().barShown === false;

    /* The basket has a top. Twenty presses on one shelf is what a five-year-old
       does, and it must fill up and say so rather than growing for ever. */
    H.emptyBasket();
    H.movePlayer(px + 2.5, y, pz + 0.5);
    for (let i = 0; i < 25; i++) H.doShop();
    out.capped = H.shop().basket.length;
    out.cappedSaid = document.getElementById('toast').textContent;
    H.emptyBasket();
    return out;
  });
  check('away from a shop the button offers nothing',
        shop.awayFromShop === null, JSON.stringify(shop.awayFromShop));
  check('at a shelf it offers to put the thing in the basket',
        shop.actions.every(a => a === 'take'), JSON.stringify(shop.actions));
  check('the basket fills with what was on the shelves, in order',
        shop.basket.join(',') === shop.wanted.join(','),
        `got [${shop.basket}], wanted [${shop.wanted}]`);
  /* The prices are the point of the total, so they are checked as numbers rather
     than trusted: bread 2, apples 3, milk 2, cake 4, cup 1 comes to twelve. */
  check('and the total is the prices added up',
        shop.total === shop.prices.reduce((a, b) => a + b, 0),
        `total ${shop.total}, prices [${shop.prices}]`);
  /* Taking something does not empty the shelf. A shop that runs out is a shop a
     five-year-old cannot play in, and an unchanged block is also why none of
     this has to travel to anybody else. */
  check('the shelves still have their stock, and no block changed',
        shop.shelfUnchanged && shop.editsUnchanged,
        JSON.stringify({shelf: shop.shelfAfter, editsUnchanged: shop.editsUnchanged}));
  check('the basket bar shows one picture per thing in it',
        shop.barShown === true && shop.strip === shop.wanted.length,
        `${shop.strip} pictures for ${shop.wanted.length} things`);
  check('at the till the button becomes a checkout, not another shelf',
        shop.atTill.action === 'ring' && shop.atTill.shown === true,
        JSON.stringify(shop.atTill));
  check('ringing up pays exactly what the basket came to',
        shop.paid === shop.expected && shop.expected > 0,
        `paid ${shop.paid}, basket came to ${shop.expected}`);
  check('and leaves the basket empty and the bar gone',
        shop.emptyAfter && shop.barGone,
        JSON.stringify({empty: shop.emptyAfter, barGone: shop.barGone}));
  check('the basket fills up and says so rather than growing for ever',
        shop.capped === 12 && /full/i.test(shop.cappedSaid),
        `${shop.capped} things, said "${shop.cappedSaid}"`);
  note(`a basket of ${shop.wanted.length} came to ${shop.expected} coins ` +
       `(${shop.prices.join('+')}) and paid ${shop.paid}`);

  // ---- 6f2: a shelf holds its own goods -----------------------------------
  /* It looked like three shelves and behaved like one. Goods were ordinary blocks
     put in the cell ABOVE a shelf, so only the top of a stack could ever hold
     anything and the tiers below it were decoration - which is exactly what he
     meant when he said it was broken. A shelf holds its own now: one tier and one
     thing per block, stacked as high as he likes. */
  console.log('6f2. a shelf holds its own goods');
  const shelf = await page.evaluate(async () => {
    const H = window.__henrycraft, ids = H.ids, out = {};
    H.loadSeed(4242);
    const px = 40, pz = 40, y = 16;
    for (let a = -2; a < 8; a++) for (let b = -2; b < 8; b++) {
      for (let yy = y - 3; yy < y; yy++) H.setBlock(px + a, yy, pz + b, ids.STONE);
      for (let yy = y; yy < y + 8; yy++) H.setBlock(px + a, yy, pz + b, ids.AIR);
    }
    H.emptyBasket();
    /* Three shelves stacked, no gaps between them. */
    const goods = [ids.BREAD, ids.APPLES, ids.MILK];
    for (let t = 0; t < 3; t++) H.setBlock(px, y + t, pz, ids.SHELF);

    /* Stocked by aiming at each one with the food selected, which is what he
       does - not by writing the map from outside. */
    out.placed = [];
    for (let t = 0; t < 3; t++) {
      H.selectBlock(goods[t]);
      H.movePlayer(px + 1.6, y + t, pz + 0.5);
      H.setYaw(Math.PI / 2);                       // looking down -X, at the shelf
      const aimed = H.aiming();
      H.build();
      out.placed.push({t, aim: aimed.target, stock: H.stockAt(px, y + t, pz),
                       above: H.getBlock(px, y + t + 1, pz)});
    }
    out.wanted = goods.slice();
    /* Every tier holds something, and nothing was put in the cell above - which is
       where it all used to go. */
    out.everyTier = out.placed.every((p, i) => p.stock === goods[i]);
    out.stillShelves = [0, 1, 2].every(t => H.getBlock(px, y + t, pz) === ids.SHELF);

    /* Each one is shoppable from where he stands beside it. */
    out.shopped = [];
    for (let t = 0; t < 3; t++) {
      H.emptyBasket();
      H.movePlayer(px + 1.4, y + t, pz + 0.5);
      const st = H.shop();
      H.doShop();
      out.shopped.push({action: st.action, got: H.shop().basket[0] || 0,
                        stillStocked: H.stockAt(px, y + t, pz)});
    }
    /* Putting something else on swaps it rather than refusing. */
    H.selectBlock(ids.CAKE);
    H.movePlayer(px + 1.6, y, pz + 0.5);
    H.build();
    out.swapped = H.stockAt(px, y, pz);

    /* Digging the shelf takes what was on it. An invisible tin of beans left at a
       coordinate would come back the moment another shelf was built there. */
    H.breakAt(px, y, pz);
    out.dug = {block: H.getBlock(px, y, pz), stock: H.stockAt(px, y, pz)};

    /* And it survives leaving the district and coming back. */
    H.setBlock(px, y, pz, ids.SHELF);
    H.setStock(px, y, pz, ids.MILK);
    await H.saveNow();
    const other = await H.createDistrict('Shelf Test', 'meadow');
    const here = H.districts().list.map(d => d.slug).find(s => s !== other);
    await H.switchDistrict(other);
    await H.switchDistrict(here);
    out.afterSwitch = [0, 1, 2].map(t => H.stockAt(px, y + t, pz));
    H.emptyBasket();
    return out;
  });
  check('aiming at a shelf with food selected puts it on the shelf',
        shelf.everyTier && shelf.stillShelves,
        JSON.stringify(shelf.placed));
  /* The bug in one line: nothing goes in the cell above any more, so a stack of
     shelves has no dead tiers in it. */
  /* Nothing edible went into the cell above. In a stack that cell is the next
     shelf up, which is the whole point - it used to be the only place goods could
     go, so only the top of a stack could hold anything. */
  check('and no food goes in the block above, so every tier of a stack holds something',
        shelf.placed.every(p => p.above === 0 || p.above === 92),
        JSON.stringify(shelf.placed.map(p => p.above)));
  check('every tier can be shopped from', 
        shelf.shopped.every((p, i) => p.action === 'take' && p.got === shelf.wanted[i]),
        JSON.stringify(shelf.shopped));
  /* Still endless: taking from a shelf must not empty it. */
  check('and taking from a shelf still does not empty it',
        shelf.shopped.every((p, i) => p.stillStocked === shelf.wanted[i]),
        JSON.stringify(shelf.shopped.map(p => p.stillStocked)));
  check('putting something else on a shelf swaps it',
        shelf.swapped === 79, `stock is ${shelf.swapped}`);
  check('digging a shelf takes what was on it',
        shelf.dug.block === 0 && shelf.dug.stock === 0, JSON.stringify(shelf.dug));
  check('what is on the shelves is still there after leaving and coming back',
        shelf.afterSwitch[0] === 102 && shelf.afterSwitch[1] === shelf.wanted[1] &&
        shelf.afterSwitch[2] === shelf.wanted[2],
        JSON.stringify(shelf.afterSwitch));

  /* The save is v3 now, and a v2 record is one with bare shelves - which is right,
     because before today a shelf could not hold anything. */
  const migrate = await page.evaluate(async () => {
    const H = window.__henrycraft;
    const now = H.snapshot();
    /* A record as it would have been written yesterday. */
    const old = JSON.parse(JSON.stringify(now));
    old.v = 2; delete old.stock;
    return {v: now.v, hasStock: typeof now.stock === 'object',
            oldLoads: H.stockFromSave(old.stock) === undefined,
            afterOld: Object.keys(H.stock()).length};
  });
  check('the save says v3 and carries what is on the shelves',
        migrate.v === 3 && migrate.hasStock, JSON.stringify(migrate));
  check('and a record from before today loads with its shelves bare',
        migrate.afterOld === 0, JSON.stringify(migrate));

  // ---- 6g: the money ------------------------------------------------------
  console.log('6g. coins, and where they come from');
  const money = await page.evaluate(async () => {
    const H = window.__henrycraft, out = {};
    H.loadSeed(4242);
    const before = H.coins();
    /* A star is worth coins. His dad's suggestion, and the reason there are any
       in his pocket before he has built a shop. */
    const s = H.stars().find(v => !v.done);
    H.movePlayer(s.x, s.y, s.z);
    for (let i = 0; i < 60 && H.starsFound() === 0; i++) {
      await new Promise(r => requestAnimationFrame(r));
    }
    out.found = H.starsFound();
    out.perStar = H.coins() - before;
    /* Nothing in the game takes coins away, which is what stops him ending up
       at nothing with a full basket and no way forward. */
    const held = H.coins();
    H.addCoins(-50);
    out.cannotGoDown = H.coins() === held;
    H.addCoins(7);
    out.wentUp = H.coins() === held + 7;
    return out;
  });
  check('a star pays coins', money.found === 1 && money.perStar === 5,
        JSON.stringify(money));
  check('and nothing can take coins off him',
        money.cannotGoDown && money.wentUp, JSON.stringify(money));

  /* Coins are his, not one district's: he finds a star here and the money is
     still in his pocket over there. Checked across a real district switch and a
     save, which is the whole reason they live beside his character rather than
     inside a world record. */
  const purse = await page.evaluate(async () => {
    const H = window.__henrycraft;
    H.addCoins(31);
    const before = H.coins();
    await H.saveNow();
    const other = await H.createDistrict('Shop Test', 'meadow');
    const here = H.districts().list.map(d => d.slug).find(s => s !== other);
    await H.switchDistrict(other);
    const away = H.coins();
    await H.switchDistrict(here);
    return {before, away, back: H.coins(),
            stored: JSON.parse(localStorage.getItem('henrycraft-wallet') || 'null')};
  });
  check('his coins follow him into another district and back',
        purse.away === purse.before && purse.back === purse.before && purse.before > 0,
        JSON.stringify(purse));
  check('and they are written down under their own key',
        purse.stored && purse.stored.coins === purse.before, JSON.stringify(purse.stored));
  /* Carried to the reload check at the very end of this file. Switching district
     only proves a variable survived a function call - the money still being there
     tomorrow needs the page to have actually been shut and opened, and doing that
     here would reset every section after it. */
  const purseBefore = purse.before;

  /* ---- 6h: his money is still there tomorrow ------------------------------
     A reload really is the check here. An earlier version asked only whether the
     coins survived a district switch, which they do whether or not they were
     ever written down - it passed happily with the wallet never being read at
     start-up at all, which is the one bug it was supposed to be watching for.

     Every section after this one builds its own world from a seed, so pulling
     the page out from under them costs nothing; putting it at the end of the
     file did not work, because by then the page has been closed. */
  console.log('\n6h. his money is still there when he comes back tomorrow');
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => window.__henrycraft && window.__henrycraft.ready(),
                             {timeout: 150000});
  await page.waitForTimeout(1200);
  const tomorrow = await page.evaluate(() => ({
    coins: window.__henrycraft.coins(),
    chip: document.getElementById('coinNum').textContent,
  }));
  check('the coins he earned are in his pocket after closing the game and opening it',
        tomorrow.coins === purseBefore && tomorrow.chip === String(purseBefore),
        `had ${purseBefore}, came back to ${tomorrow.coins} (chip says "${tomorrow.chip}")`);
  note(`${purseBefore} coins survived a full page reload`);


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
