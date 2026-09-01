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
const PORTAL_CAP = 64;           // per district; more than anyone will build
const PORTAL_MAX_SIDE = 21;      // matches PORTAL_MAX in the game
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
  'Henry', null, 'JuJu', null, null, 'Papa', null, null,
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
/* A district name, structurally. The real guarantee is on the receiving client, which
   checks it against the word lists a name is built from - but nothing arbitrary is
   stored here either, so there is no field on this server a grown-up could type into
   and have a child read. */
function safeDistrictName(raw) {
  if (typeof raw !== 'string') return null;
  return /^[A-Z][a-z]{1,11} [A-Z][a-z]{1,11}$/.test(raw) ? raw : null;
}

/* Where the animals are: two lists of [x, y, z, facing], one per animal and one
   per crab, in the order the client's own lists are built. Four numbers and
   nothing else - no names, no text, no ids of any kind, so there is no way to
   smuggle anything a child would read through the herd.

   Bounded on both counts and on every number. A district is at most 128 blocks
   across and 40 tall, so anything outside that is a client that has gone wrong or
   is lying, and either way it is dropped rather than stored and handed on. */
const ZOO_MAX = 32;
function safeZooRow(r) {
  if (!Array.isArray(r) || r.length < 3) return null;
  const x = num(r[0]), y = num(r[1]), z = num(r[2]), f = num(r[3]);
  if (x === null || y === null || z === null) return null;
  if (x < -1 || x > 129 || z < -1 || z > 129 || y < -1 || y > 41) return null;
  return [x, y, z, f === null ? 0 : f];
}
function safeZooList(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const r of v.slice(0, ZOO_MAX)) {
    const row = safeZooRow(r);
    if (!row) return null;                 // one bad row spoils the message
    out.push(row);
  }
  return out;
}
function safeZoo(msg) {
  const a = safeZooList(msg.a), c = safeZooList(msg.c);
  if (a === null || c === null) return null;
  if (!a.length && !c.length) return null;
  return {a, c};
}

/* ---------------- portals ----------------

   A portal is the only thing in this game that moves somebody from one district
   to another, which makes it the only thing that has to be agreed on rather than
   merely copied. Two players who light the same frame must end up bound to the
   same place, or they walk through the same doorway into different worlds - which
   is exactly what happened before this existed.

   So the destination is minted here, once, by whoever asks first, and everybody
   else is told the answer. The frame's own position is the identity: two clients
   lighting the same frame ask the same question and get the same record back,
   whether they ask a millisecond or a week apart. */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no lookalikes: same list the game uses
function mintCode() {
  const r = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[r[i] % CODE_CHARS.length];
  return s;
}
function int(v) { return Number.isInteger(v) ? v : null; }
/* The frame, as the game describes one: a plane, the coordinate it sits at, and
   the rectangle of its opening. Everything is bounds-checked, because this is
   stored and handed to other clients. */
function safeFrame(f) {
  if (!f || typeof f !== 'object') return null;
  if (f.plane !== 'x' && f.plane !== 'z') return null;
  const fixed = int(f.fixed), a0 = int(f.a0), a1 = int(f.a1);
  const y0 = int(f.y0), y1 = int(f.y1), fill = int(f.fill);
  if (fixed === null || a0 === null || a1 === null || y0 === null || y1 === null) return null;
  if (fill === null || fill < 0 || fill > 255) return null;
  for (const v of [fixed, a0, a1, y0, y1]) if (v < -1024 || v > 1024) return null;
  const w = a1 - a0 + 1, h = y1 - y0 + 1;
  if (w < 1 || h < 1 || w > PORTAL_MAX_SIDE || h > PORTAL_MAX_SIDE) return null;
  return {plane: f.plane, fixed, a0, a1, y0, y1, fill, w, h};
}
function frameKey(f) {
  return f.plane + ':' + f.fixed + ':' + f.a0 + ':' + f.a1 + ':' + f.y0 + ':' + f.y1;
}
/* A destination a client asked for by name, used only for return portals - the way
   back has to lead to the district they actually came from, and only they know
   which that was. Validated exactly as hard as a minted one. */
function safeDest(d) {
  if (!d || typeof d !== 'object') return null;
  if (typeof d.code !== 'string' || !CODE_RE.test(d.code)) return null;
  const seed = int(d.seed), starSeed = int(d.starSeed);
  if (seed === null || starSeed === null) return null;
  if (seed < 0 || starSeed < 0 || seed > 0xffffffff || starSeed > 0xffffffff) return null;
  if (typeof d.theme !== 'string' || !/^[a-z]{1,16}$/.test(d.theme)) return null;
  return {code: d.code, seed, starSeed, theme: d.theme};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      /* Says what it can do, not just that it is alive. Two versions of this Worker
         are now possible in the wild, and the difference is invisible from the game:
         an older one drops the character number, and every player is drawn as
         character 0 - which is Henry, so a room of four looks like four Henrys.
         `curl https://sync.henrysgame.com/health` tells you which one is deployed. */
      /* And which commit it was built from. The deploy workflow passes the pushed
         SHA in with `--var COMMIT:...`, so this answers "did my change actually go
         live" with a yes or a no rather than "something is up". `dev` is what you
         see under `wrangler dev`, where there is no commit to name. */
      const commit = typeof env.COMMIT === 'string' && env.COMMIT ? env.COMMIT : 'dev';
      return new Response('ok look=1 characters=' + CHARACTER_NAMES.length +
                          ' portals=1 standings=1 karts=1 reask=1 zoo=1' +
                          ' commit=' + commit.slice(0, 40),
                          {headers: {'content-type': 'text/plain'}});
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
    this.portals = null;       // Map<frameKey, {…frame, dest:{code,seed,starSeed,theme}}>
    /* Where the animals are: {a:[[x,y,z,yaw],…], c:[…]} or null for "never told".
       Held here rather than worked out, because nothing on this side simulates
       anything - one of the connected players does the walking and the rest of us,
       this object included, are told where they got to. See the keeper below. */
    this.zoo = null;
    /* Who was last told they were the keeper, and who has claimed it by picking an
       animal up. Both are plain fields: this object can be evicted between
       messages, and losing either one only costs a repeated announcement or a
       fall back to connection order, both of which are correct. */
    this.lastKeeper = null;
    this.keeperClaim = null;
    this.persistTimer = null;
    this.nextId = 1;
  }

  /* Whose animals are the real ones.

     Every device used to walk its own copy of the animals about, and each copy
     walked towards the player sitting in front of it - so Henry penned three
     sheep, his dad came over, and the pen was empty. They were his dad's sheep,
     out in the field where his dad's game had walked them.

     So exactly one connected player moves them and tells everybody else: the
     keeper. It is the longest-standing connection, which needs no election and no
     agreement - the roster is in connection order and the first entry wins - and
     it moves on by itself when that player leaves. Picking an animal up also
     claims it, because the person carrying a pig somewhere is obviously the person
     who should be deciding where the pig is. */
  keeperId(except) {
    const r = this.roster(except);
    /* A claim only counts while the claimant is still here. Checked against the
       live roster rather than trusted, so a player who picked a pig up and then
       closed the lid cannot leave the animals belonging to nobody. */
    if (this.keeperClaim && r.some(p => p.id === this.keeperClaim)) return this.keeperClaim;
    return r.length ? r[0].id : null;
  }
  /* Says who it is, but only when that has actually changed - this is called on
     every arrival and departure, and an unchanged keeper is not news. */
  announceKeeper(except) {
    const id = this.keeperId(except);
    if (id === this.lastKeeper) return;
    this.lastKeeper = id;
    this.broadcast({type: 'keeper', id}, except);
  }

  async load() {
    if (this.edits) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.edits) return;
      const [meta, edits, portals, zoo] = await Promise.all([
        this.ctx.storage.get('meta'),
        this.ctx.storage.get('edits'),
        this.ctx.storage.get('portals'),
        this.ctx.storage.get('zoo'),
      ]);
      this.meta = meta || null;
      this.edits = new Map(Object.entries(edits || {}));
      this.portals = new Map(Object.entries(portals || {}));
      this.zoo = zoo || null;
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
    await this.ctx.storage.put('portals', Object.fromEntries(this.portals));
    /* So an empty room still knows where the animals were left. Without it the
       first person back in the morning would be the keeper of a herd that had
       gone back to wherever the seed first put them. */
    if (this.zoo) await this.ctx.storage.put('zoo', this.zoo);
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
  /* `except` is the socket that is on its way out. webSocketClose still sees it in
     getWebSockets(), so without this the departing keeper would be re-elected as
     the keeper and the animals would stand still for ever. */
  roster(except) {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
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
          /* What the place is called, so two players do not end up calling one world
             two different things. Only ever a name the game generated: the client
             refuses to send anything else, and the client that receives it checks it
             against its own word lists before drawing it. This is structural belt to
             that braces - two capitalised words and nothing else gets stored. */
          name: safeDistrictName(offer.name),
        };
        /* An older client puts its whole edit map in the offer. Still accepted, because
           an older copy of the game may be open on a tablet somewhere - but the current
           one deliberately does not: a join carrying a real world is bigger than
           MAX_MSG_BYTES and gets dropped on the floor above, which left the game saying
           "Connecting..." for ever. Blocks arrive as ordinary edits instead. */
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
        name: this.meta.name || null,
        edits: Object.fromEntries(this.edits),
        /* Always an array, even when empty. The game uses its presence to tell a
           server that can share portals from one that cannot: an older Worker sends
           no such field, and the game then holds portals back rather than letting
           two players walk into different worlds. */
        portals: [...this.portals.values()],
        players: this.roster().filter(p => p.id !== id),
        max: MAX_PLAYERS,
        /* Who is moving the animals, and where they are. A client that gets
           neither field is talking to an older Worker and falls back to walking
           its own copy about, which is what every client did until today. */
        keeper: this.keeperId(),
        zoo: this.zoo,
      }));
      this.broadcast({type: 'joined', player: {id, name, colour, look}}, ws);
      /* The joiner may be the first in, and so the keeper. Announced to everyone
         including them, because "you are the keeper" is exactly what a lone first
         arrival needs to hear. */
      this.announceKeeper();
      return;
    }

    if (!att.id) return;                        // nothing else before join

    if (msg.type === 'move') {
      const x = num(msg.x), y = num(msg.y), z = num(msg.z), yaw = num(msg.yaw);
      if (x === null || y === null || z === null) return;
      // How far round a racing circuit they have got: which lap, and how far through it as
      // a fraction. Both are only used to work out who is in front, and both are clamped
      // to something sane here so a bad or hostile client cannot claim to be on lap 900.
      const lapRaw = num(msg.lap), progRaw = num(msg.prog);
      const lap = lapRaw === null ? null : Math.max(0, Math.min(999, Math.floor(lapRaw)));
      const prog = progRaw === null ? null : Math.max(0, Math.min(1, progRaw));
      // Whether they are in a kart, so the other screens draw them driving one rather than
      // sprinting along the track at fifteen blocks a second. A flag and nothing else.
      const kart = msg.kart === true;
      // Advisory only. Broadcast for drawing and for the standings; never applied to
      // anyone's physics, so a remote player cannot push, trap or move anybody.
      this.broadcast({type: 'moved', id: att.id, x, y, z, yaw: yaw ?? 0, lap, prog, kart}, ws);
      return;
    }

    /* Where the animals got to, from the one player who moves them. Anyone else
       sending this is ignored rather than merged: two clients writing positions
       for the same pig is exactly the disagreement the keeper exists to end.

       Advisory, like a move: it is drawn, and it is remembered so the next person
       through the door starts with the animals where they were left. Nothing here
       touches anybody's blocks or anybody's physics. */
    if (msg.type === 'zoo') {
      if (att.id !== this.keeperId()) return;
      const zoo = safeZoo(msg);
      if (!zoo) return;
      this.zoo = zoo;
      this.schedulePersist();
      this.broadcast({type: 'zoo', a: zoo.a, c: zoo.c}, ws);
      return;
    }

    /* "I have just picked an animal up, so let me be the one saying where the
       animals are." Nothing else about it: it does not name the animal, and it
       cannot move anything on its own. */
    if (msg.type === 'keep') {
      this.keeperClaim = att.id;
      this.announceKeeper();
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

    /* "Tell me again what doorways this room has."

       The welcome already carries them, and this is the second chance. There was no second
       chance before: the list went out once, and a client that ended up without it - for any
       reason at all - had no way to ask, so the doorway stayed invisible to that player until
       they left the room and came back. One player being unable to see a portal everybody
       else can see is exactly the shape of thing that ruins an evening.

       Answered to the asker alone, and it is only ever a read. */
    if (msg.type === 'portals') {
      try {
        ws.send(JSON.stringify({type: 'portalsAll', portals: [...this.portals.values()]}));
      } catch (e) {}
      return;
    }

    /* Light a portal. The frame is the question; the destination is the answer, and
       there is only ever one answer per frame.

       Two clients lighting the same frame at the same moment both land here, and
       the second one finds the record already made and is told about it - so they
       cannot end up bound to different districts. Which is the whole reason this
       message exists rather than each client deciding for itself. */
    if (msg.type === 'portal') {
      const frame = safeFrame(msg.frame);
      if (!frame) return;
      const key = frameKey(frame);
      let rec = this.portals.get(key);
      if (!rec) {
        if (this.portals.size >= PORTAL_CAP) return;
        /* A destination the client named is a way back to where it came from, and
           only it knows where that was. Anything else is minted here. */
        const asked = safeDest(msg.dest);
        rec = Object.assign({key}, frame, {
          isReturn: !!msg.isReturn,
          dest: asked || {
            code: mintCode(),
            seed: Math.floor(Math.random() * 0xffffffff),
            starSeed: Math.floor(Math.random() * 0xffffffff),
            theme: typeof msg.theme === 'string' && /^[a-z]{1,16}$/.test(msg.theme)
                   ? msg.theme : 'meadow',
          },
        });
        this.portals.set(key, rec);
        this.schedulePersist();
      }
      /* To everybody, the asker included: the asker is waiting to be told what it
         is bound to, and everybody else has a frame to light. */
      const out = JSON.stringify({type: 'portal', portal: rec});
      for (const peer of this.ctx.getWebSockets()) {
        try { peer.send(out); } catch (e) {}
      }
      return;
    }

    /* A frame broken, or a duplicate return portal tidied away. Without this one
       player sees a lit portal the other does not. */
    if (msg.type === 'portalOut') {
      if (typeof msg.key !== 'string' || !this.portals.has(msg.key)) return;
      this.portals.delete(msg.key);
      this.schedulePersist();
      this.broadcast({type: 'portalOut', key: msg.key}, ws);
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

  /* The client started closing - a phone going to sleep, a tab going away, a walk
     out of wifi range. With WebSocket Hibernation the runtime does NOT echo the
     close frame for us, so if this handler does not close its end the socket sits in
     CLOSING on the other side: the browser never fires onclose, the game never knows
     it has been disconnected, and it never tries to come back. Measured at ten
     seconds on a local network before the client noticed; over a phone network it can
     be indefinite.

     That is "a person gets kicked out very easy, like if they put their phone down" -
     except that they were not kicked out, they were left believing they were still
     playing together while nothing arrived. */
  async webSocketClose(ws, code, reason) {
    this.departed(ws);
    /* 1005 and 1006 must never be sent, and neither may anything outside the
       permitted ranges - sending one throws and leaves the handshake incomplete,
       which is the very thing being fixed. */
    const out = (Number.isInteger(code) && code >= 3000 && code <= 4999) ? code : 1000;
    try { ws.close(out, typeof reason === 'string' ? reason.slice(0, 100) : 'bye'); }
    catch (e) { /* already gone; nothing left to complete */ }
  }
  async webSocketError(ws) { this.departed(ws); }

  departed(ws) {
    let att = null;
    try { att = ws.deserializeAttachment(); } catch (e) {}
    if (att && att.id) this.broadcast({type: 'left', id: att.id}, ws);
    /* If the keeper has gone, somebody else has to start walking the animals or
       they stand still for ever. The claim goes with them, so the fallback rule -
       longest-standing connection - takes over again. */
    if (att && att.id === this.keeperClaim) this.keeperClaim = null;
    this.announceKeeper(ws);
    this.ctx.waitUntil(this.persist());
  }
}
