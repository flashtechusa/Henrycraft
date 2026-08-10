/*
 * Henrycraft multiplayer sync.
 *
 * One Durable Object per district, addressed by its join code. The Worker does
 * nothing but validate the code and hand the socket to the right instance.
 *
 * Two rules run through the whole file, and both are safety rather than taste:
 *
 *   Nothing a player sends is ever shown to another player as text. Names are
 *   generated on the client from a fixed word list and validated here against
 *   that list; anything else is replaced. There is no chat, and there is no
 *   field a grown-up could type into that a child would read.
 *
 *   Nothing a player sends can affect another player's body. move is advisory -
 *   it is broadcast for drawing and never applied to anyone's physics - and
 *   there is no message that damages, pushes, teleports or blocks anyone.
 */

const MAX_PLAYERS = 8;
const MAX_MSG_BYTES = 4096;      // a move is ~60 bytes; an edit ~50
const EDIT_CAP = 200000;         // a district is 64x40x64, so this is generous
const PERSIST_DEBOUNCE_MS = 1000;

/* Join codes look like green-meadow-K7Q4XM2P9T: a district's slug plus ten
   random characters. The suffix is the only thing standing between a stranger
   and a child's game, so it is long enough that guessing is hopeless. Validated
   here so a malformed or over-long code cannot create junk Durable Objects. */
/* Two shapes accepted. New codes are six characters - a little over a billion of
   them, short enough to read down a telephone, and the random part was always the
   whole of the security. The long "slug-plus-ten" form stays valid because codes
   already shared with the family have to keep working. */
const CODE_RE = /^([a-z0-9]+(?:-[a-z0-9]+){0,4}-[A-Z0-9]{10}|[A-Z0-9]{6})$/;

/* The client builds names from these, and only these. Anything else that
   arrives is not shown - see safeName(). */
const NAME_FIRST = ['Red','Blue','Green','Gold','Silver','Purple','Orange','Pink',
                    'Teal','Lime','Coral','Sunny','Frosty','Brave','Jolly','Swift'];
const NAME_SECOND = ['Fox','Otter','Badger','Robin','Hare','Owl','Bear','Wolf',
                     'Newt','Finch','Moth','Crab','Deer','Mole','Wren','Seal'];
const COLOURS = ['#e4d7bb','#c0392b','#2f7fd6','#4fc04f','#f2c231','#9b59b6',
                 '#e67e22','#1abc9c'];

/* Which character somebody is playing as. 0-7 are the anonymous ones, whose name
   comes from the word lists above; 8 upwards are the family, and their names live
   here rather than being taken from the client.

   That is the point of putting them here: a name that belongs to a real person -
   a child among them - can only ever be spelled the way this table spells it. A
   client cannot arrive claiming to be Christian, or claiming that Christian is
   called something else. It sends a number; the server supplies the name. */
const CHARACTER_NAMES = [
  'Henry', null, null, null, null, null, null, null,
  'Pops', 'GiGi', 'Jonathan', 'Dad', 'Mommy', 'Christian',
];
function safeLook(v) {
  return Number.isInteger(v) && v >= 0 && v < CHARACTER_NAMES.length ? v : 0;
}
/* The name that goes with a look: fixed for the family, from the word list for
   everybody else. Never free text either way. */
function nameForLook(look, raw) {
  return CHARACTER_NAMES[look] || safeName(raw);
}

function safeName(raw) {
  if (typeof raw !== 'string') return 'Blue Fox';
  const parts = raw.split(' ');
  if (parts.length === 2 && NAME_FIRST.includes(parts[0]) && NAME_SECOND.includes(parts[1])) {
    return raw;
  }
  // Not from the list, so it is not shown. Deliberately silent: there is no
  // error path here that would surface a stranger's text to a child.
  return 'Blue Fox';
}
function safeColour(raw) {
  return COLOURS.includes(raw) ? raw : COLOURS[0];
}
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', {headers: {'content-type': 'text/plain'}});
    }

    // /district/<code>, WebSocket only.
    const m = url.pathname.match(/^\/district\/([^/]+)$/);
    if (!m) return new Response('not found', {status: 404});

    const code = decodeURIComponent(m[1]);
    if (!CODE_RE.test(code)) return new Response('bad district code', {status: 400});

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', {status: 426});
    }

    // idFromName is deterministic, so the same code always reaches the same
    // instance from anywhere in the world.
    const id = env.DISTRICT.idFromName(code);
    return env.DISTRICT.get(id).fetch(request);
  },
};

export class District {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.edits = null;         // Map<"x,y,z", blockId>, loaded lazily
    this.meta = null;          // {seed, starSeed, theme}
    this.persistTimer = null;
    this.nextId = 1;
  }

  async load() {
    if (this.edits) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.edits) return;
      const [meta, edits] = await Promise.all([
        this.ctx.storage.get('meta'),
        this.ctx.storage.get('edits'),
      ]);
      this.meta = meta || null;
      this.edits = new Map(Object.entries(edits || {}));
    });
  }

  /* Writes are debounced rather than immediate: a child placing a row of blocks
     produces a burst of edits, and one storage write per block is wasteful. The
     window is short enough that an eviction cannot lose meaningful work. */
  schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = true;
    this.ctx.waitUntil((async () => {
      await new Promise(r => setTimeout(r, PERSIST_DEBOUNCE_MS));
      this.persistTimer = null;
      await this.persist();
    })());
  }
  async persist() {
    if (!this.edits) return;
    await this.ctx.storage.put('edits', Object.fromEntries(this.edits));
    if (this.meta) await this.ctx.storage.put('meta', this.meta);
  }

  async fetch(request) {
    await this.load();

    // Hibernation: the runtime may evict this object between messages and
    // rebuild it on the next one, so per-socket state lives on the socket via
    // serializeAttachment rather than in a field here.
    const live = this.ctx.getWebSockets();
    if (live.length >= MAX_PLAYERS) {
      // Reject politely. The client shows "this district is full" and stays in
      // solo play; it never shows an error dialog.
      const pair = new WebSocketPair();
      pair[1].accept();
      pair[1].send(JSON.stringify({type: 'full', max: MAX_PLAYERS}));
      pair[1].close(4001, 'district full');
      return new Response(null, {status: 101, webSocket: pair[0]});
    }

    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({id: null, name: null, colour: null});
    return new Response(null, {status: 101, webSocket: pair[0]});
  }

  peers(except) {
    return this.ctx.getWebSockets().filter(ws => ws !== except);
  }
  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const ws of this.peers(except)) {
      try { ws.send(s); } catch (e) { /* a dead socket is closed below anyway */ }
    }
  }
  roster() {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.id) out.push({id: a.id, name: a.name, colour: a.colour,
                               look: safeLook(a.look)});
    }
    return out;
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MSG_BYTES) return;
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;

    await this.load();
    const att = ws.deserializeAttachment() || {};

    if (msg.type === 'join') {
      if (att.id) return;                       // already joined
      const id = 'p' + (this.nextId++) + '-' + Math.random().toString(36).slice(2, 7);
      const look = safeLook(msg.look);
      const name = nameForLook(look, msg.playerName);
      const colour = safeColour(msg.colour);
      ws.serializeAttachment({id, name, colour, look});

      /* Whose copy wins.

         If this district has never been seen here, the joiner's copy becomes the
         district - that is the natural "I turned sharing on" case. If the server
         already has one, the server's copy is authoritative and adopted is false,
         which tells the client to warn before replacing anything local. The
         brief is explicit that these must not be silently merged: a merge is how
         somebody loses a build without ever being told. */
      let adopted = false;
      if (!this.meta) {
        const offer = msg.offer || {};
        this.meta = {
          seed: num(offer.seed) ?? Math.floor(Math.random() * 1e9),
          starSeed: num(offer.starSeed) ?? Math.floor(Math.random() * 1e9),
          theme: typeof offer.theme === 'string' ? offer.theme : 'meadow',
        };
        if (offer.edits && typeof offer.edits === 'object') {
          for (const [k, v] of Object.entries(offer.edits)) {
            if (this.edits.size >= EDIT_CAP) break;
            if (/^\d+,\d+,\d+$/.test(k) && Number.isInteger(v) && v >= 0 && v < 256) {
              this.edits.set(k, v);
            }
          }
        }
        adopted = true;
        this.schedulePersist();
      }

      ws.send(JSON.stringify({
        type: 'welcome',
        you: id,
        adopted,                                // false => server copy wins
        seed: this.meta.seed,
        starSeed: this.meta.starSeed,
        theme: this.meta.theme,
        edits: Object.fromEntries(this.edits),
        players: this.roster().filter(p => p.id !== id),
        max: MAX_PLAYERS,
      }));
      this.broadcast({type: 'joined', player: {id, name, colour, look}}, ws);
      return;
    }

    if (!att.id) return;                        // nothing else before join

    if (msg.type === 'move') {
      const x = num(msg.x), y = num(msg.y), z = num(msg.z), yaw = num(msg.yaw);
      if (x === null || y === null || z === null) return;
      // Advisory only. Broadcast for drawing; never applied to anyone's physics,
      // so a remote player cannot push, trap or move anybody.
      this.broadcast({type: 'moved', id: att.id, x, y, z, yaw: yaw ?? 0}, ws);
      return;
    }

    if (msg.type === 'edit') {
      const x = msg.x, y = msg.y, z = msg.z, b = msg.block;
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return;
      if (!Number.isInteger(b) || b < 0 || b > 255) return;
      const k = x + ',' + y + ',' + z;
      if (!this.edits.has(k) && this.edits.size >= EDIT_CAP) return;
      this.edits.set(k, b);                     // last write wins, as specified
      this.schedulePersist();
      this.broadcast({type: 'edited', x, y, z, block: b, by: att.id}, ws);
      return;
    }

    if (msg.type === 'leave') {
      try { ws.close(1000, 'left'); } catch (e) {}
      return;
    }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({type: 'pong'}));
      return;
    }
    // Anything else is ignored. No echo, so an unknown message cannot be used
    // to bounce arbitrary content through the server to another player.
  }

  async webSocketClose(ws) { this.departed(ws); }
  async webSocketError(ws) { this.departed(ws); }

  departed(ws) {
    let att = null;
    try { att = ws.deserializeAttachment(); } catch (e) {}
    if (att && att.id) this.broadcast({type: 'left', id: att.id}, ws);
    this.ctx.waitUntil(this.persist());
  }
}
