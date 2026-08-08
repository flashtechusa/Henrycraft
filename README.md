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

**3D engine.** The page loads three.js r128 from cdnjs. It is the only thing
here that comes from outside this repo. If a network blocks cdnjs, the game
shows a "3D engine could not load" message instead of starting; downloading
`three.min.js` into this repo and pointing the `<script src>` at it would make
the game fully self-contained.
