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

**Saving.** The world saves itself every 4 seconds into the browser's
`localStorage`, under the key `henrycraft-world-v1`. Only the seed and Henry's
own block changes are stored, not the whole world, so a save stays tiny — a
couple of hundred bytes.

The save is per-browser and per-device. Henry's world on the iPad is not the
same world as on the laptop, and clearing the browser's site data wipes it.
There is no server, so nothing is shared between devices.

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

Run `bash tools/check.sh` to verify the whole setup. Two of its checks need a
real Android build, so they only pass in CI.
