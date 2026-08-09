# Henrycraft

Henry's blocky world — a gentle voxel sandbox. No monsters, no falling damage,
no night. Walk, dig, build, fly, and find 10 hidden stars.

## Play it

**https://flashtechusa.github.io/Henrycraft/**

That's the link to send to Henry. It works on any computer or tablet with a
browser — nothing to install.

## One-time setup (do this once)

The link above only works after GitHub Pages is switched on. It takes one click,
and only the repo owner can do it:

1. Go to **Settings** → **Pages** (left sidebar).
2. Under **Build and deployment** → **Source**, choose **Deploy from a branch**.
3. Set **Branch** to `main` and the folder to `/ (root)`, then click **Save**.

Wait a minute or two, then open the play link. After this it stays on for good.

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

The game exposes `window.__henrycraft` purely for that harness — read-only
accessors plus a couple of helpers for setting up a scenario. Nothing in the game
reads it, so deleting it changes no behaviour; it only blinds the tests.
