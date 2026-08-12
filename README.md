# Henry's Block Adventure

A gentle voxel sandbox. No monsters, no falling damage, no night. Walk, dig,
build, fly, and find 10 hidden stars.

The repository is still called `Henrycraft`, which was the working name, and so
are the APK file and the test scripts. The game itself says *Henry's Block
Adventure* everywhere a person can see it.

## Play it

**https://henrysgame.com**

That's the link to send to Henry. It works on any computer or tablet with a
browser — nothing to install.

## Hosting and the domain

The site is GitHub Pages, served from `main` at `/ (root)`, with the custom
domain set by the [`CNAME`](CNAME) file in this repo. The domain is registered at
Cloudflare, which is also its DNS.

DNS (Cloudflare → DNS → Records), both **DNS only**, grey cloud:

| Type | Name | Content |
| --- | --- | --- |
| CNAME | `henrysgame.com` | `flashtechusa.github.io` |
| CNAME | `www` | `flashtechusa.github.io` |

Cloudflare flattens the apex CNAME automatically, so there is no need for the
four A and four AAAA records GitHub's docs list.

**The records must stay on DNS only (grey cloud), not proxied.** With Cloudflare's
proxy in front, it answers the ACME challenge itself and GitHub can never issue
the certificate — the symptom is "certificate provisioning failed" sitting there
for hours with no other explanation.

Once the certificate exists, tick **Enforce HTTPS** in Settings → Pages.

`flashtechusa.github.io/Henrycraft/` keeps working and redirects, so any link
already sent out is fine.

## Districts

A **district** is one place. Henry can have as many as he likes, each saved on its
own, and switch between them from the title screen &mdash; making a new one never
touches an existing one. Districts are picked from cards with a painted
thumbnail of what that place looks like, so he can choose by looking rather than
reading.

Each district has one of five themes, fixed when it is created:

| Theme | What it looks like |
| --- | --- |
| **Meadow** | rolling green hills, oak trees, blue lakes |
| **Snowy Peaks** | tall white mountains, pine forest, ice at the water's edge |
| **Desert Dunes** | low sand dunes, cacti, a few small oases |
| **Island Bay** | turquoise sea broken into islands, palms on the sand |
| **Mushroom Hollow** | lilac sky, dark soil, giant red and purple mushrooms |

New districts arrive already named &mdash; two friendly words like *Otter Bay* &mdash;
with a dice button to re-roll. The name can be typed over, but typing is never
required. Deleting one is a small button in the corner of its card followed by a
confirm, so a mis-tap cannot wipe a build.

## Playing together

Everything below is off until somebody turns it on. Alone is the default, and
alone makes no network calls at all &mdash; that is what keeps the tablet working
in the car.

**To share a district:** pause, press **Playing alone**, and it flips to *Playing
together*. A panel shows the district's join code, big enough to read down a
phone, plus a **Copy the link** button. Turning it back off is a separate button
inside that panel rather than the same one, so a mis-tap cannot end a session
everybody else is still in.

**To join one:** *Join with a code* on the title screen, or open the shared link.
That is the whole of it &mdash; no account, no sign-in, no email, nothing to
remember. A code is **six characters**, like `K4TPUY`: a little over a billion of
them, which no one finds by hand, and short enough to read down a telephone. I, O,
0 and 1 are left out so nothing is misheard. The older, much longer
`green-meadow-K7Q4XM2P9T` form still works, so codes already shared with the family
keep working.

Joining with a code just joins &mdash; no question, no second button. The
whose-copy-wins panel only appears for somebody who has actually **built**
something in the district they are sharing **and has not shared it under this code
before**. That second condition was missing, and it filled the picker with six
districts called *Little Spring Mine (mine)*: once a shared district has been
adopted, the room's blocks live in the local save, so every rejoin looked like a
client turning up with a world of its own to protect &mdash; and protecting it meant
duplicating it. Coming back to your own room now resyncs instead, which loses nothing
and copies nothing.

A district that still carries one of the old long codes is given a short one the next
time it is shared, and **keeps the old code as an alias**. Portals are bound to codes
now, so shortening one without that would orphan a way home.

**One world, one name.** Whoever joins by code used to name the place for themselves,
so the same district was *Sunny Creek* on one screen and *Quiet Glen* on the other. The
name travels with the room now &mdash; and only a name the game itself could have
generated crosses the wire. It is checked against the very word lists a district name is
built from, on the way out and again on the way in, so a name typed over by hand is
never sent and never drawn. That is the same rule player names follow, for the same
reason: there must be no way for a grown-up to type something a child then reads.

A district called *Home* is the exception and keeps its own name: nearly everybody has
one already, so adopting it would land as *Home 2* and read as more confusing than a
different name.

A **👥 count** sits next to the star at the top while sharing; tap it for who is here.

Up to **eight** people at once. A ninth is turned away politely and simply keeps
playing in their own copy.

**There is no chat, and no field anyone can type into that another player would
read.** That is deliberate and not a shortcut. Player names are generated from a
fixed word list &mdash; *Jolly Otter*, *Frosty Badger* &mdash; validated against
that same list before they are drawn, and written with `textContent`. No text from
another player can reach the screen, and a test asserts it by feeding the client
a hostile name directly.

**Fourteen characters.** Eight anyones, plus six of the family: Pops, GiGi,
Jonathan, Dad, Mommy and Christian. Everybody turns up as their own person
&mdash; hair colour and length, bald heads, glasses, beards, skin tone, what they
wear &mdash; with their name over their head.

**Who are you?** in the pause menu picks one, by looking rather than reading: the
portraits are drawn from the very same face and palette the body is built from, so
a card and the person it promises cannot drift apart. Henry's own character is
picked already, so for him it is one tap on the face he has always had. The choice
sticks, and what he sees himself as is what the room sees &mdash; a test asserts
exactly that, because for a while it was not true: the local player was always
drawn as Henry while everybody else drew him as somebody else.

The names of the family are the **server's** to give. A client sends a number; the
server supplies the name from a fixed table. Nobody can arrive claiming to be
Christian, or claiming Christian is called something else, and a number outside the
list falls back rather than being honoured. There is still no free text anywhere in
this protocol.

No photographs are in this repository, and none ever were: the likenesses are a
palette and a handful of flags.

Nobody can affect anybody else. Positions are advisory: they move a mesh and are
never fed into physics, so a remote player cannot push, trap or startle Henry.
There is no message that damages anybody, because there is no damage.

**Whose copy wins.** The first person to share a district uploads theirs, and it
becomes the shared one. If the server already has that district, the game says so
on screen and waits &mdash; and if you accept, your own version is kept
side-by-side as *&lt;name&gt; (mine)* rather than overwritten. Nothing is ever
merged silently.

**The join describes the world; it does not contain it.** It used to carry the whole
edit map, and the server drops any message over 4,096 bytes &mdash; about 280 blocks. So
a district a child had actually built in produced a join that was silently thrown away:
no welcome, no error, *"Connecting…"* for ever. Six hundred blocks makes a 7,915-byte
join, and every test in the suite had used a handful, which is why none of them caught
it &mdash; and why starting a fresh world appeared to fix it. Blocks now go up after the
welcome, through the same bounded queue that carries every other edit.

A connect that is never answered also times out at 25 seconds now and starts again,
whatever the reason. Nothing recovered from a socket that opened and then went quiet.

**If the connection drops** the world carries on alone and reconnects in the
background. A child is never shown an error dialog. When it comes back, the
server's blocks arrive and anything built in the meantime is pushed up, so neither
side loses work.

**Putting a phone down used to look like being kicked out**, and the cause was on the
server. With WebSocket Hibernation the runtime does not echo the closing frame for
you: if `webSocketClose` does not close its own end, the browser's socket sits in
`CLOSING` for ever, `onclose` never fires, and the game goes on believing it is still
playing together while nothing arrives. Measured at **10,043 ms** on a local network;
over a phone network it can be indefinite.

Three things fix it, and the test measures the result rather than trusting it:

- The server completes the handshake in `webSocketClose`, guarding the close code
  (1005, 1006 and anything outside the permitted ranges throw if you try to send them,
  which would leave the handshake incomplete all over again).
- The game notices a socket that has stopped being `OPEN`, ten times a second, instead
  of waiting for an `onclose` that may never come. This is the guarantee, because it
  does not depend on which server version is deployed.
- Waking from a locked screen, a switched tab or a return to wifi reconnects
  immediately rather than sitting out the exponential backoff — a sleeping phone does
  not run timers, so the wait was often not even scheduled.

Each was measured separately: neither fix, 10,013 ms and the check fails; the client
guard alone, 302 ms; both, 51 ms — which is the test's polling interval, so
effectively at once.

### Travelling together

Walking through a portal takes everybody who follows you to the same place. This is
the part that took two attempts to get right, so it is worth saying how it works.

**A portal's destination is agreed, not decided.** Lighting a frame during a shared
session asks the server where it goes; the server mints the answer once — a join
code, a seed, a star seed and a theme — stores it against the frame's position, and
tells everybody. The frame's position is its identity, so two players striking the
same frame at the same instant ask the same question and get the same answer. That
one rule is what stopped the original bug: each client used to invent its own
destination, so the same doorway led two people into two different worlds.

**Travelling moves the session rather than ending it.** Going through switches the
socket from the district's code to the destination's, so the room follows him. Every
other way of arriving somewhere — the district picker, Go home, a new world — still
leaves the session, and that rule still lives in the one place every arrival passes
through (`enterDistrict`), with the portal case marked by a flag rather than
reimplemented.

**A destination is found by its code, never by its name.** Going through the same
portal twice used to mint a second world each time, because nothing tied where he
arrived to where he had already been: *Quiet Hill, Quiet Hill 2, Quiet Hill 3*. The
local district record now carries the room's code and is looked up by it.

**One way home, not one each.** The return portal is built at a spot derived from the
world itself rather than from where the player happens to be standing, so two players
arriving seconds apart build the identical frame — which the server recognises as one
portal. If they do diverge, the room's copy wins and the other is put out quietly,
leaving its obsidian standing.

**Worlds built alone become places you can both go.** Most of his portals were lit on
his own and lead to districts that exist on one tablet. Starting a session gives each
of those districts a join code and offers the portals to the room, so an evening's
building becomes somewhere to visit together — with what he built still in it. If
somebody else gets there first with an empty copy, his blocks go up when he follows,
by the same resync a reconnect uses. Nothing is merged and nothing is lost.

**A portal knows two ways to find where it goes**, and needs only one of them. Its join
code, which is what everybody in the room agrees on, and the local district it was bound
to before it was ever shared. Keeping the second one is what stopped *"Could not open
that place - try again"*: the destination's record knew its code but the index &mdash;
which is what travel searches &mdash; did not, and the local slug that would have saved
it was being discarded the moment the room confirmed the portal. Travel now falls back
to it and mends the index on the way through, so a portal never leads somewhere the game
cannot open, and never mints a second copy of a world he already has.

**When a doorway cannot take everybody it takes nobody**, and says why with a picture
of the frame crossed out. That happens if the sync server is older than this feature,
or if a portal could not be offered to the room (no storage left to write its code).
Walking into it walks him straight through the frame — no countdown ring appears,
because a ring that fills up and then refuses is a worse answer than never starting
one. Playing alone, that same portal works normally.

Covered end to end in `tools/test-multiplayer.js` against the real Worker: two
players lighting one frame, both travelling, arriving in one world with one way home,
a block placed there reaching the other player, four round trips leaving one district
at each end, travelling in the same instant, a simultaneous strike from two raw
sockets getting one destination, a world built alone becoming a shared room with its
diamond tower intact on both screens, and a portal built together still working alone
after a reload. Each of the four load-bearing rules above was checked by breaking it
on purpose: removing the session carry ends the session mid-walk, removing the
lookup-by-code reproduces *Quiet Hill 2* and *Quiet Hill 3* exactly, removing the
server's record reuse hands out two destinations, and removing the adoption leaves his
own portal invisible to the other player.

One path has no end-to-end test: the "made on its own" picture, which needs a
portals-capable server *and* a portal that could not be registered with it. The
picture itself is checked (section 2d of `tools/test-portals.js`), and its sibling
case — an out-of-date server — is covered in full by 12c and 12d.

### Deploying the server

The sync server is a Cloudflare Worker with one Durable Object per district, in
`server/`. It is not deployed automatically and no account id or token is stored
in this repository.

```
cd server
npm install
npx wrangler login     # opens a browser once
npx wrangler deploy
```

That publishes to `sync.henrysgame.com` and creates the DNS record for it. The
free plan covers a family many times over: 100,000 requests a day, incoming
WebSocket messages billed at 20:1, outgoing free.

Until it is deployed, pressing *Playing together* does no harm &mdash; the game
keeps trying quietly in the background and stays playable. There is a test for
exactly that.

**Check which version is deployed:**

```
curl https://sync.henrysgame.com/health
```

`ok look=1 characters=14 portals=1` is current. Anything shorter is an older Worker,
and each missing marker costs a feature:

| `/health` says | what is missing | what you see |
| --- | --- | --- |
| `ok look=1 characters=14 portals=1` | nothing | everything works |
| `ok look=1 characters=14` | `portals=1` | portals refuse during shared play, with a picture saying why |
| `ok` | both | strangers with strangers' names, and no shared portals |

Plain `ok` is an older Worker that drops the
character number, and the symptom is subtle rather than obvious: every player gets
drawn from a guess, and the guess used to be character 0 &mdash; which is Henry, so
a room of four looked like four Henrys. The game now falls back to the shirt colour
instead, keeps people distinct, and says so in the Playing-together panel with a red
banner naming the fix. If somebody appears as a stranger with a stranger's name
&mdash; *Silver Otter* instead of *Dad* &mdash; that banner is the whole answer.
**Redeploy after any change under `server/`.**

The banner distinguishes two cases, and getting that wrong wasted a trip to the
command line. A current server always sends a character number and advertises it by
supporting shared portals &mdash; so if the server is current and somebody still
arrives without one, it is **their game** that is out of date and reloading it is the
fix. Only a server that never mentions portals is told to redeploy.

It is also recomputed from who is in the room, never latched. One stale phone tab
joining for ten seconds used to leave the banner up for the rest of the evening,
reading *"Playing with 0, but somebody's game is out of date"* &mdash; and pointing at
a server that was already deployed.

## What's in a district

**19 blocks** to build with: grass, dirt, stone, sand, wood, leaves, planks,
brick, glass, gold, diamond, rainbow, coal, copper, lapis, emerald, obsidian, an
enchanting table, and Flint &amp; Steel.

**Ore to dig for.** Coal and copper are common in the upper rock, lapis sits
mid-depth, gold a bit deeper, and diamond, emerald and obsidian are down near the
bedrock — obsidian only in the bottom two layers. Digging straight down from a
random spot hits ore or a cave about 92% of the time.

**Flint &amp; Steel** places a flickering fire block. It is purely decorative: it
never spreads, never goes out, never hurts anything, and digs away like any other
block.

**Portals.** Build a frame out of obsidian, fill the middle with any block, then
light it with Flint &amp; Steel &mdash; pick it from the block picker and tap the
filling. Whatever you fill it with decides where it goes: snow to somewhere snowy,
sand to somewhere sandy, and the district you arrive in is named to suit. Anything
from 1&times;2 to 21&times;21 counts, corners optional, and a return portal is
built on the other side so he can never be stranded &mdash; once, not once per
visit: coming back to a district that already has a way home puts him out beside
the portal that is already standing there, and any spare return portals the game
built before that rule existed are put out on arrival (their obsidian frames stay,
because the frames are his).

A portal can only ever move him if he **walked into it himself**. Arriving somewhere
sets a grace that lasts until he is standing clear of every doorway, so however he
gets placed, he cannot be bounced straight back out again.

To travel, **just walk into it.** A lit portal slows whoever steps into it to a
crawl and holds them there while a ring fills, about eight tenths of a second
&mdash; so he cannot cross the doorway faster than the ring fills however hard he
pushes, and he does not have to learn to stop at the right moment. Standing
*outside* it does nothing at all, which is the part that stops him being taken
anywhere by accident.

If the tablet cannot save &mdash; no room left, most likely &mdash; the game says
so on screen and **refuses to travel**, because leaving a district that could not
be written down is how a build gets lost. `?fps=1` shows the dwell timer and any
save error, which is the quickest way to see what a portal is actually doing. Finishing a frame shows a picture of the
last step, and **Things you can build** in the pause menu shows all three.

**Every hint is a picture.** He cannot read, so a frame that will not light shows a
drawn diagram &mdash; the wrong shape crossed out beside the right one, with a red
cross on the exact block at fault &mdash; and it fades on its own rather than
waiting to be dismissed. The diagrams are drawn from the same texture atlas the
world is built from, so a block always looks the way it looks in his hands, and a
test asserts that by comparing the pixels in a diagram against the atlas.

**Animals.** Pigs, sheep and cows wander the land. Axolotls and sharks swim in
any water at least three blocks deep. Nothing in this game can hurt Henry, and
nothing chases him — the shark in particular swims a fixed circuit worked out
when it spawns and never reads his position at all.

## Controls

**Computer** — `W A S D` walk, mouse looks, click digs, right-click builds,
`Space` jumps, `Q` digs down, `E` digs up, `F` toggles flying (`Space` up,
`Shift` down), `1`–`9` pick a block, `V` swaps view, `M` mutes, `Esc` pauses.

**Tablet or phone** — left stick walks and turns, buttons on the right dig,
build, jump and fly. Turn the device sideways.

## Making changes

The whole game is one file: [`index.html`](index.html).

1. Click `index.html` above.
2. Click the pencil icon to edit.
3. Make the change, then click **Commit changes**.
4. Wait about a minute and refresh the play link.

Every commit to `main` republishes the site automatically. If the page looks
stale, hard-refresh: `Ctrl+Shift+R` on Windows, `Cmd+Shift+R` on a Mac.

## Notes for whoever edits this next

**Saving.** The current district saves itself every 4 seconds into the browser's
`localStorage`. Each district has its own key, `henrycraft-district-<slug>`, and
`henrycraft-districts` is the index listing them in last-played order. Only the
seed and Henry's own block changes are stored, not the whole world, so a district
stays tiny — usually a few hundred bytes.

The single pre-district save, `henrycraft-world-v1`, is migrated to a district
called *Home* the first time the new build loads, and is then left in place
untouched as a backup. `tools/test-districts.js` asserts that migration is
lossless down to the individual block edit.

Saves are per-browser and per-device. Henry's districts on the iPad are not the
same as on the laptop, and clearing the browser's site data wipes them. There is
no server, so nothing is shared between devices.

**3D engine.** three.js **r128** is bundled inside `index.html`, so the page
needs no network at all. It is pinned to r128 on purpose: the game uses
r128-era APIs and calls `THREE.Color.convertSRGBToLinear` on every material
colour. Do not upgrade it. The copy is npm `three@0.128.0`'s
`build/three.min.js`, unmodified.

This is why `index.html` is ~680KB. The only URL left in the file is
`http://www.w3.org/1999/xhtml`, an XML namespace string three.js passes to
`createElementNS` — not a network request.

## Install on a Fire tablet

Fire OS cannot add web apps to the home screen — there is no "Add to Home
Screen" in Silk, and Fire OS cannot run service workers — so the game ships as
a small WebView app in [`android/`](android). It needs **no network and no
permissions**.

1. On the tablet, open **Silk** and go to this repo's **Releases** page.
2. Download **`henrycraft.apk`**.
3. Tap the downloaded file. Fire OS will block it the first time.
4. Tap through to Settings and turn on **Allow from this source** for Silk.
   (Same switch lives at **Settings → Security & Privacy → Install Unknown
   Apps**.)
5. Tap the APK again to install. Henrycraft appears on the home screen.

**On a child profile**, the app must also be shared to it: **Amazon Kids →
Manage Content → Add content**, and tick Henrycraft. Installing it on the adult
profile alone will not make it show up for Henry.

The app is landscape-only, runs edge to edge with no browser toolbar, keeps the
screen awake, and needs two presses of Back to quit so it is not exited by
accident.

## Building the APK

There is no Android toolchain needed locally — GitHub builds it.
`.github/workflows/android.yml` runs on every push to `main` that touches
`index.html` or `android/`, and can be run by hand from the **Actions** tab
(**Run workflow**). It uploads `henrycraft.apk` as a build artifact; pushing a
`v*` tag or publishing a Release also attaches the APK to that Release.

`index.html` at the repo root is the single source of truth. The Gradle
`copyGameHtml` task copies it into `android/app/src/main/assets/` before every
build, so the app cannot drift from the web version. Nothing under
`android/app/src/main/assets/` is committed.

Run `bash tools/check.sh` to verify the packaging setup. Two of its checks need a
real Android build, so they only pass in CI.

## Testing the game itself

`node tools/test-districts.js` covers districts: that the pre-district save
migrates with every block edit intact, that districts stay isolated from each
other, that switching and returning restores everything, and that all five themes
generate playable worlds over 20 seeds each with measurably different terrain and
colours.

`node tools/test-game.js` drives the real `index.html` in headless Chromium and
asserts against the live world. It needs Playwright; set `PLAYWRIGHT_PATH` if it
is installed somewhere unusual. It covers the atlas and UV bounds, the palette,
ore generation and depth bands across 20 seeds, that no fish ever leaves the
water over a minute of simulation per seed, that the shark's path does not depend
on where Henry is, that fire never spreads, and the control layout at phone and
desktop sizes.

`node tools/test-portals.js` covers portals: frame detection at every size from
1×2 to 21×21 in both vertical planes, a specific hint for each wrong shape, and
50 travel trials across all five themes checking arrival safety, the return
portal and edit preservation. It also asserts the performance properties that
matter — that a 21×21 portal costs the same number of draw calls as a 1×2 one
(441 blocks and 1,764 triangles arrive as 2 merged meshes and 3 draw calls), and
that a lit portal rebuilds no geometry at all over 300 frames.

## Measuring the frame rate

Open the game with `?fps=1` — `henrysgame.com/?fps=1` — for a small readout in
the corner: current frame rate, worst seen, draw calls, triangles and the number
of portal blocks. It is off unless the URL asks for it, so it can never turn up
in front of Henry by accident.

Read it on the tablet, not in the test harness. The tests run on a software
rasteriser that manages well under one frame a second, so a frame rate measured
there is a fact about SwiftShader rather than about the game — which is why the
portal tests assert draw calls and mesh rebuilds instead. The readout counts
frames against `performance.now()` rather than the loop's `dt`, because `dt` is
clamped to 0.05s to stop a hitch throwing Henry through the floor, and counting
against a clamped clock would report 20 fps on a device actually managing 5.

`node tools/test-multiplayer.js` covers Phase B. It starts the real Worker with
`wrangler dev` on a throwaway state directory &mdash; the Durable Object under test
is the one that gets deployed &mdash; and drives real browser pages against it: two
clients exchanging edits, a third and fourth arriving to find everything already
built, eight filling a district and a ninth being turned away, a client dropping
mid-session and reconnecting without losing a block, a hostile name fed
straight into the client to prove it never reaches the screen, and the whole of
[travelling together](#travelling-together). It needs `npm ci` in `server/` first.

Two of those checks used to be timing-dependent and went red on a loaded CI runner
while passing on a quiet laptop, which is worse than either failing or passing
honestly. Both are now driven by state rather than by the clock: the eight-player
cap waits for eight welcomes instead of counting 120ms after the last connection,
and *"a remote player is interpolated rather than teleported"* drives the drawing
half of the avatar update with a dt the test chooses (`mp.glideProbe`) instead of
sleeping 400ms and sampling six animation frames &mdash; on a page drawing one frame
a second, that sampled after the glide had finished and read six identical numbers.
The wire is now a separate check of its own.

The game exposes `window.__henrycraft` purely for that harness — read-only
accessors plus a couple of helpers for setting up a scenario. Nothing in the game
reads it, so deleting it changes no behaviour; it only blinds the tests.
