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
remember. A code looks like `green-meadow-K7Q4XM2P9T`: the district's name plus
ten random characters, which is what stops a stranger finding a child's world by
guessing likely names. I, O, 0 and 1 are left out so nothing is misheard when it
is read aloud.

Up to **eight** people at once. A ninth is turned away politely and simply keeps
playing in their own copy.

**There is no chat, and no field anyone can type into that another player would
read.** That is deliberate and not a shortcut. Player names are generated from a
fixed word list &mdash; *Jolly Otter*, *Frosty Badger* &mdash; validated against
that same list before they are drawn, and written with `textContent`. No text from
another player can reach the screen, and a test asserts it by feeding the client
a hostile name directly.

Nobody can affect anybody else. Positions are advisory: they move a mesh and are
never fed into physics, so a remote player cannot push, trap or startle Henry.
There is no message that damages anybody, because there is no damage.

**Whose copy wins.** The first person to share a district uploads theirs, and it
becomes the shared one. If the server already has that district, the game says so
on screen and waits &mdash; and if you accept, your own version is kept
side-by-side as *&lt;name&gt; (mine)* rather than overwritten. Nothing is ever
merged silently.

**If the connection drops** the world carries on alone and reconnects in the
background. A child is never shown an error dialog. When it comes back, the
server's blocks arrive and anything built in the meantime is pushed up, so neither
side loses work.

**Portals stay a solo feature.** The protocol carries blocks, not portal records,
so a lit portal is filtered out of what is shared in both directions: your portals
work for you, and everyone else sees the obsidian frame with air inside. Better
than a portal that leads nowhere. Going through one leaves the shared session,
since a join code belongs to one district.

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
always built on the other side so he can never be stranded.

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
mid-session and reconnecting without losing a block, and a hostile name fed
straight into the client to prove it never reaches the screen. It needs
`npm ci` in `server/` first.

The game exposes `window.__henrycraft` purely for that harness — read-only
accessors plus a couple of helpers for setting up a scenario. Nothing in the game
reads it, so deleting it changes no behaviour; it only blinds the tests.
