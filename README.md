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

Each district has one of six themes, fixed when it is created:

| Theme | What it looks like |
| --- | --- |
| **Meadow** | rolling green hills, oak trees, blue lakes |
| **Snowy Peaks** | tall white mountains, pine forest, ice at the water's edge |
| **Desert Dunes** | low sand dunes, cacti, a few small oases |
| **Island Bay** | turquoise sea broken into islands, palms on the sand |
| **Mushroom Hollow** | lilac sky, dark soil, giant red and purple mushrooms |
| **Racing Circuit** | green country with a flat kart track cut through it, and four times the size &mdash; see below |

New districts arrive already named &mdash; two friendly words like *Otter Bay* &mdash;
with a dice button to re-roll. The name can be typed over, but typing is never
required. Deleting one is a small button in the corner of its card followed by a
confirm, so a mis-tap cannot wipe a build.

## The racing circuit

A sixth kind of district: a **Racing Circuit**, with a go-kart and a track to drive it
round. Make one from the district picker &mdash; ✚, then the 🏁 card.

**A racing district is 128 blocks across**, twice everywhere else and four times the
ground. That is not decoration: he asked for a lap that takes half a minute to a minute
to drive, which at kart speed is 350 to 700 blocks of road, and a 64-block district cannot
hold a quarter of it. The size comes from the theme, never from the save file &mdash; a
district record holds its theme, its seed and the blocks he has changed keyed by
`"x,y,z"`, so a racing district saved when they were 64 across still opens, with
everything he built still at the coordinates he built it at. There is a test that plants
exactly such a record and checks every block survives.

The circuit is generated, not drawn by hand, so every one is different, and it is a proper
circuit rather than a ring road: **a lap is 535 to 615 blocks and takes 45 to 53 seconds
to get round**, with long straights round the outside and a run of switchbacks and
hairpins reaching into the middle. It is grown the way a random maze is grown &mdash; take
the ring of cells round the edge of a coarse grid, then push sides of it inwards, each push
replacing a straight edge with a three-sided detour. Each detour is pushed two to four
cells deep rather than once, which is what makes it a finger reaching into the middle
instead of a dent in the edge; single pushes were the first attempt and gave a perimeter
road with a wavy edge and an empty field inside, which is the same complaint he made about
the circle wearing a different shape.

Corners are then rounded off twice and the whole thing resampled as a closed spline, and
the result is checked before it is built: the right length, at least four detours, inside
the world, no two corridors closer together than the road is wide, and no corner tighter
than a kart can take at speed. A layout that fails any of those is thrown away and another
grown &mdash; up to sixty times.

Nine blocks of road, red-and-white kerbs down both sides, a dashed line down the middle,
and a chequered start line under a brick arch he drives through. Road and kerbs come to
about 38% of the district, which leaves grass, trees and ponds between the corridors; at
64 blocks across the same idea paved 60% and looked like a car park from the air.

**It costs less to draw than an ordinary district, which was a surprise.** I expected to
have to earn the bigger world back and wrote distance culling for chunks the fog had
already swallowed; measuring said it switched off nothing at all, because the fog reaches
118 blocks and a district is 128 across. Measuring also said the culling was not needed:
from the driving seat a circuit is **67 draw calls and 19,900 triangles against a meadow's
156 and 46,300**, because a flat road has far fewer faces showing than a hillside. So the
culling was deleted rather than kept as decoration. The real cost is building one &mdash;
four times the terrain to generate and mesh, which measures 106ms against 53ms, once, on
the loading screen.

**The road is dead flat** &mdash; one height for the whole circuit, chosen from the middle
of the ground it crosses and always above the water. The country either side is feathered
up or down to meet it over three blocks, so the track sits in the landscape rather than on
a bridge across it: nothing is suspended and there is nothing to fall off. Flat is not a
shortcut, it is the point &mdash; the first version followed the ground, and a road that
climbs a block at a time looks bumpy from the seat however smooth the numbers say it is.
He said so, and he was right.

**Getting in and out is one button**, the 🏎️ beside the camera, and it only appears in a
racing district. The stick steers instead of strafing while driving, and turns more the
faster you are going, so a kart cannot spin on the spot. Tarmac is quicker than grass -
about twelve blocks a second against five and a half - but the grass is a reason to enjoy
the road rather than a punishment: nothing about being off the track stops him, hurts him
or takes anything away.

**Driving is not building.** From the driving seat the wireframe box that shows where a
block would go is gone, and so are the block picker, the keyboard crib, and on a tablet **all
seven action buttons** &mdash; Dig, Build, Dig Down, Dig Up, Fly, Jump and Fly Lower. Four of
them do nothing while driving and the other three are not what a kart is for. What is left is
the stick, which steers, and the four chips along the top, one of which is the way out. All
seven come back the instant he steps out.

The white cross in the middle of the screen goes with them. It is the aiming mark for digging
and building, and from the driving seat there is nothing to aim at &mdash; the wireframe box it
aims with was already gone. I missed it the first time round, and because everything else had
been taken away it ended up the only thing left on an empty track, which is exactly how it got
noticed. The check for it reads the computed style rather than the class name, for the reason
the block button gives below.

Climbing into a kart also lands him if he was flying, because the Fly Lower button goes with
the rest &mdash; without that he could end up airborne with nothing on screen to bring him
down. Nothing can be dug or placed at all. Hiding the box while leaving digging switched on would have
been worse than leaving the box: an invisible cursor quietly taking a bite out of the road
at eleven blocks a second. A row of blocks that does nothing when tapped is the same
mistake in a different place. It is one predicate, `canBuild()`, read by everything that
decides what he would act on, so all of it stops together; getting out gives all of it
straight back.

## Powerslides, item boxes, and what is deliberately missing

**Drifting has no button.** Every kart game puts it on a shoulder button held through the
corner, which is a two-handed job: steer with one thumb, hold with the other, release on the
exit. He is five and he steers with one thumb. So *a hard turn at speed is the drift* &mdash;
lean on the stick and the kart slides and starts charging, straighten up and it fires. Blue,
orange then gold sparks, the colours the genre taught everyone, on a chip beside the lap
clock. Nothing to learn and nothing to miss: not drifting simply means no boost.

Two numbers had to be measured rather than guessed, and both were wrong first time:

- **The speed floor was above the speed of grass.** A slide needed 6 blocks a second to
  survive and a kart does 5.5 on grass, so running wide out of a corner killed the drift at
  exactly the moment a drift is worth having. A skid pad measured one slide breaking and
  restarting eleven times in three seconds.
- **The spark thresholds did not fit the corners.** Gold was set at 1.9 seconds of sliding;
  over four circuits and six minutes of committed driving, the longest single slide is 1.8 to
  2.4 seconds, so seventy seconds of driving never once reached gold. A tier nobody reaches
  is not a tier. They are 0.35, 0.75 and 1.35 now, scaled to what the corners actually give.

There is also **hysteresis**, which is the difference between a mechanic and a rumour: it
takes less to hold a slide than to start one, and easing off for a fifth of a second does not
throw the charge away. Nobody holds a stick at a constant angle &mdash; a real thumb wanders
and a correction crosses back over the threshold several times a second. Without it, a
two-minute drive started 38 slides and not one of them lived long enough to earn a spark.

**Item boxes** sit round the circuit and come back a few seconds after he drives through one,
so a lap is never used up. A box gives its item straight away rather than holding it in a
slot: holding one and choosing the moment is most of the tactics in a kart game and all of
the button-work, and he drives with one thumb. Drive through the box, go fast.

**Every item works on the kart that collected it and on nothing else.** That is the part
worth being explicit about, because it is where this game parts company with the genre it is
borrowing from. There are no shells, no lightning and no bananas, and the catch-up mechanic
pays out in the *trailing* driver's favour instead of punishing the leader:

| | in front | a long way behind |
| --- | --- | --- |
| 🍄 Mushroom, 1.3s of boost | 67% | 8% |
| 🍄🍄🍄 Three mushrooms, 2.8s | | |
| ✨ Golden mushroom, 5s | | 64% golden or star |
| 🌟 Star, 4s &mdash; and grass is as quick as tarmac | 3% | |

The star is the best thing in the box and it still hurts nobody: for four seconds the whole
district is a track, so cutting the corner becomes the fun rather than the mistake. "How far
behind" is measured two ways and the more urgent wins &mdash; behind another player round the
lap, which is the one that exists while he is racing his dad, and off his own best pace,
which works when he is on his own. Neither takes anything from anybody; it only decides how
good the next box is.

A test in the multiplayer suite has one player hoover up 13 boxes in a row and then checks the
other player was not moved, slowed, sped up or emptied, and still has all 12 of his own boxes
waiting. Boxes are per-player: a five-year-old cannot have one taken off him.

**And he cannot get stuck.** With a boost he does 16 blocks a second, and a corner taken too
fast puts him in the trees; held against a hillside with the throttle down, he has no idea
that reverse exists. So a kart pressed against something and going nowhere *while he is asking
it to go* is lifted back to the nearest point of the road after a second and a half, pointed
the way the lap goes, and set down. No damage, no penalty, no fuss. Parking up with the
throttle off leaves him exactly where he parked &mdash; looking at the view is not the same as
being stuck.

That one is not a nicety, it is what made the racing tests stop being flaky. The same twenty
seeds passed one run and failed six checks the next, because which item a box gives is random
and a lucky golden mushroom into a hairpin is a kart in the scenery. Tuning the boost down
until the dice usually landed well would have hidden that rather than fixed it.

One more number that had to be measured: **`KART_TURN` has to be enough for a *boosted* kart
to take the tightest corner the generator makes.** The tightest takeable radius is speed over
turn rate; at 17.25 blocks a second and 4.2 radians that is 4.1 against a 4.5-block corner,
and two seeds out of twenty became undriveable &mdash; the test driver spent 60% of one of
them wedged off the outside of a hairpin. The turn rate is 4.6 and the boost 1.38× now, which
puts it at 3.5.

**Not built, and why:** vertical loops, because the physics has gravity and no upside-down
driving and faking it would be a lie. Jump ramps, because they fight the flat road that was
asked for two requests ago. And weapons, which are covered above.

**The ten stars go round the circuit** rather than being hidden, floating at kart height
along the racing line, and collecting them is driving through them. The reach grows with
speed, because at kart pace on a slow tablet a fixed radius can be driven clean through -
which reads as a broken star rather than a near miss.

**Laps are counted and timed.** A 🏁 chip counts them upwards and a ⏱ chip beside it shows
the clock for the lap he is on and the best he has ever done round this circuit &mdash; two
numbers, on their own row under the rest of the HUD. Finishing a lap says its time out
loud (*"🏁 Lap 3 &mdash; 48.6s"*, or *"🏆 Best lap!"*), which is when he cares about it, so
the chip does not carry it as well.

The clock counts driving seconds, not wall-clock ones: pausing, putting the tablet down or
getting out to look at something does not run it on. Getting out abandons the lap in
progress rather than pricing it &mdash; the lap counter already restarts from wherever he
sets off, so climbing back in genuinely starts a fresh one. Flying is still allowed in a
kart, because it is how he gets himself out of anywhere, but a lap with flying in it is
shown and never becomes his best: he was not driving it. The best time is saved with the
district, so it is still there tomorrow.

**Every lap is written down.** Tapping the ⏱ chip opens *Your laps*: a numbered list of
every lap he has driven round this circuit, the quickest clean one marked 🏆, and a lap he
was rescued through marked 🛟 *helped* so the list never quietly flatters him. It is saved
with the district, capped at twenty, and still there tomorrow. That answers a question the
first version couldn't: the running clock told you the lap you were on and the toast told you
the one you'd just done, but nothing kept the rest.

**Two people see each other driving.** The kart flag travels with the position, so a driver
is drawn in his own kart, seated, on the other screen. Without it only the position and
heading ever crossed the wire and the kart was drawn from local state &mdash; so the other
person saw somebody *sprinting* down the straight at fifteen blocks a second with his legs
pumping, which is exactly what he reported after an evening of playing it. The kart is built
per player in their own colour, thrown away when they leave, and it goes the moment they step
out of it.

**Messages get out of the way while driving.** The big 46-pixel line across the middle of the
screen is right for a five-year-old pottering about &mdash; it is the whole picture and there
is nothing to miss behind it. At fifteen blocks a second it is a blindfold: *"Golden
mushroom!"* over the corner he is trying to take. In a kart every message goes to a small chip
under the lap clock instead. One function routes them by where he is rather than by what they
say, so nothing has to remember which to call.

**Racing somebody shows who is in front.** A 🥇/🥈 chip while sharing a circuit, and the
Playing-together panel becomes a live scoreboard — medals, names, and the lap each driver is
on, refreshed twice a second while it's open.

Position alone cannot answer "who is in front": it cannot tell the leader from somebody a
whole lap behind. So the lap number and how far through it now travel with the move message
and the Worker relays them, clamped server-side so no client can claim to be on lap 900.
**Both of these need the Worker deployed** — which now happens on its own when `server/`
changes on `main` (see *Deploying the server*). Until it is, the game says it does not know
rather than guessing, and the chip stays hidden. `curl https://sync.henrysgame.com/health`
reports `standings=1` when it's live. Being shown 1st while losing is exactly the kind of unfairness
this game does not do, so a missing answer is better than a wrong one.

The standings also feed the item weighting, which now measures "behind" in whole laps rather
than by position round the current one.

There is still **no position limit, no lap limit, no target time and no way to lose.** A slow lap
is a number and nothing else; the best time only ever moves the way he wants it to. Going
round the other way un-does progress rather than taking a lap away. Laps are counted as **distance travelled
along the road**, not by driving over a line and not as an angle about the middle: a line
can be missed at the edge of the road, and an angle only works on a circle. On a circuit
that doubles back on itself the angle sweeps forward and backward round the lap, so a lap
he had genuinely just finished counted as half of one. Being told you have not finished a
lap you have just finished is exactly the sort of unfairness this game does not have.
Teleporting across the circuit does not earn a lap either, because a jump longer than a
kart could have driven is not credited.

Everything else about a racing district is an ordinary district: he can dig it, build in
it, fly over it, put portals in it and share it. **Two people share the same circuit**
without anything being said about its size, because the size comes from the theme and the
theme travels with the join &mdash; there is a test that puts two players on one circuit
and checks they get the same 607-block lap, the same start line, and blocks built out past
where the old 64-block world ended.

**A room's doorways can be asked for twice.** The list of portals rides in the welcome, and
it used to ride there exactly once &mdash; a client that ended up without it had no way to
ask, so the doorway stayed invisible to that player until they left the room and came back.
One player unable to see a portal everybody else can see is the shape of thing that ruins an
evening. Three seconds after settling into a room the game now asks the room what it has,
every time, and takes whatever it did not already have.

The asking is deliberately not silent. It counts what turns up that way, and the tests
insist that number stays **zero** in the ordinary case &mdash; because a self-healing
mechanism that hides the fault it is healing is how a bug lives for a year. There is a test
that strips the portal list out of the welcome on the way in, exactly as if it had never
arrived, and checks the game notices and asks.

That went in while chasing an intermittent failure I have seen three times: the joining
player receives no portals at all. I have not root-caused it, and I am not claiming the
second chance is the fix &mdash; it is the thing that means Henry can still walk through the
door while I find out. Two theories were tested and killed on the way: that the Worker's
one-second write debounce was losing portal records (a portal survives the Worker being
`SIGKILL`ed 150ms after it is minted), and that the joiner never connected at all (that was
my own reproducer inventing invalid join codes, which the Worker refuses with a 400).

The one way that could go wrong is one device running an older game: same seed, same
theme, a smaller world, and blocks arriving with coordinates it has no room for. Dropping
those in silence is exactly how *"I could see him but he could not see me"* happens, so
they are counted instead, and the panel says **"this game is out of date and is showing a
smaller world than theirs — reload this page to see the same place."** Said from the
reader's point of view, because the reader is the one who has to reload. It clears when
sharing is switched off rather than latching, which is the mistake the first version of
the out-of-date banner made.

`node tools/test-racing.js` covers it in 105 checks, and the ones that matter drive rather
than look: a lap and a half on each of twenty seeds, with the real stick input through the
real physics, timed &mdash; **45 to 53 seconds a lap**, which is the thing he actually
asked for. It measures the circuit rather than trusting it: every seed's lap length,
tightest corner, detour count, paved fraction, and the biggest height step anywhere on the
road, which has to be zero. It drives laps to check the clock and the best time behave,
tries all three ways of digging from the driving seat and finds none of them work, and
measures the HUD at five window sizes down to a 390-wide phone.

Three bugs it caught are worth writing down, because each was invisible to the check that
came before it:

- **The start arch was built across the road instead of beside it**, because the "across"
  and "along" vectors were the same one, so on several seeds the first thing a kart did was
  drive into its own start line and stop. Driving found it; a test that checked the road
  existed did not.
- **A 500-block lap that was a plain rectangle.** Every length and corner check passed and
  the shape was a ring road round the edge with an empty field inside. Length does not make
  a circuit; the detours pushed through the middle do, so now they are counted and at least
  four are required.
- **Three of my own checks that measured nothing.** The kerb bar had been relaxed to 70% on
  the strength of a merged corridor the layout no longer produced (it measures 97%, so the
  bar is 90%); the "drive off the track" fixture held the stick over for twelve seconds,
  which drives in circles &mdash; it reported whatever speed the kart happened to stop at
  and called it the speed of grass; and the lap-clock check read the chip's text without the
  game running, so it passed against a stale `0.0s` written on the previous lap boundary.

The lap clock also turned up a bug that had nothing to do with racing. **`hide` did not
mean hidden**: the stylesheet had rules for `#picker.hide` and `.overlay.hide` and nothing
else, so every chip carrying the class had been on screen permanently &mdash; the lap
counter while walking, the kart button in a meadow, and *"who is here: 1"* while playing
alone, which the comment beside it says explicitly must not happen. It is visible in a
screenshot he sent me about something else entirely. One rule at the end of the sheet fixes
it, and `test-game.js` now asserts the class resolves to `display:none` on a bare div and on
a chip &mdash; a chip sets `display:flex` at the same specificity, so where the rule sits in
the sheet is the only thing making it work.

Two layouts of the lap chips were wrong before this one, and only measuring found either.
Letting the top row of the HUD wrap put five chips down the left side of a 390-wide phone as
a column, across the buttons on the right. Pinning the new row 62px down instead was wrong
the moment the row above it grew. It is two stacked rows now, measured at five sizes &mdash;
and where the row above already reaches the buttons on a narrow phone, which it did before
there was a lap clock, that is reported rather than blamed on the clock.

Adding the furniture section to *Things you can build* turned up two more of the same kind,
both older than the change. The page has **no panel behind it** &mdash; there is no shared
`.card` rule, only `#menu .card` &mdash; so the palette and the keyboard crib had always been
showing through the middle of the portal recipe; nobody saw it while the card was short enough
to sit in the empty middle of the screen. And the overlay centres its card with
`justify-content`, which **clips the top off anything taller than the window with no way to
scroll back up to it**: on a phone held sideways at 390px the heading was already unreachable
before I made the card longer. Auto margins centre it identically while there is room and
collapse to nothing when there is not. `test-game.js` now scrolls the page to each end at
three sizes and checks that the heading and the *Got it* button can both actually be reached,
because that is the thing that matters &mdash; not how tall the card is.

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

**A broken doorway is still a doorway.** Henry dug a block out of the way home in a
district he had travelled to and could not get back &mdash; the obsidian was still
standing, but the game had forgotten what the frame was for, so lighting it again would
have bound it somewhere new. Which is worse than not working, because it looks like it
worked.

A frame now remembers where it led. Strike any part of it with Flint & Steel &mdash; the
opening or the obsidian, it makes no difference &mdash; and it goes back to leading
exactly where it led before: no new district, no new place on the server, and in a shared
session the room is told the destination rather than asked for one. If a block really is
missing it says so, with the picture of a gap, instead of the silence he used to get:
with the opening emptied there is nothing for the frame checker to look at, so tapping it
did nothing at all and gave no reason. The memory is saved with the district and survives
the game being closed, bounded at 32 frames so a save cannot grow for ever.

**A lit portal is never painted over.** The filling a frame is built with is an ordinary
block and is shared; the portal that replaces it is not, because each device fills its
own opening in from the record. So the room still remembers sand, or grass, or a rainbow
for those cells &mdash; and replaying them on arrival painted the inside of the doorway
back to blocks. The portal kept working, which is how it went unnoticed: it simply
stopped looking like one. Those cells now belong to the portal for as long as it is lit,
and go back to being ordinary blocks the moment it is put out.

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
`server/`. **It deploys itself** from `.github/workflows/deploy-worker.yml` on any
push to `main` that touches `server/`, and no account id or token is stored in this
repository &mdash; the workflow reads two GitHub secrets.

On a push rather than on a timer: a timer would redeploy identical code all week
and still be hours late on the one push that mattered. The path filter is the
point of it &mdash; a change to `index.html` alone never restarts the live server,
so a room of people playing is left alone.

The workflow runs `tools/test-multiplayer.js` against the build **before**
deploying it, and afterwards refuses to call the deploy done until
`sync.henrysgame.com` reports back the exact commit that was pushed. A stale
Worker answers `ok` just as cheerfully as a new one, so "it responded" is not
proof; `commit=` is.

**One-time setup.** In Cloudflare, *My Profile &rarr; API Tokens &rarr; Create Token*,
from the **Edit Cloudflare Workers** template. Then in GitHub, *Settings &rarr;
Secrets and variables &rarr; Actions &rarr; New repository secret*, twice:

| secret | where it comes from |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the token you just created |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard &rarr; Workers &amp; Pages, in the right-hand sidebar |

If either is missing the workflow stops on its first step and says which one, rather
than failing somewhere inside wrangler. Neither value is ever printed in the log.

**By hand**, if you ever want to, or to publish the very first version before the
secrets exist:

```
cd server
npm install
npx wrangler login     # opens a browser once
npx wrangler deploy
```

A hand deploy reports `commit=dev`, because only the workflow knows the SHA.

Either way it publishes to `sync.henrysgame.com` and creates the DNS record. The
free plan covers a family many times over: 100,000 requests a day, incoming
WebSocket messages billed at 20:1, outgoing free.

Until it is deployed, pressing *Playing together* does no harm &mdash; the game
keeps trying quietly in the background and stays playable. There is a test for
exactly that.

**Check which version is deployed:**

```
curl https://sync.henrysgame.com/health
```

Current is `ok look=1 characters=14 portals=1 standings=1 karts=1 reask=1` followed by
`commit=` and the SHA it was built from (`commit=dev` after a hand deploy). Anything
shorter is an older Worker, and each missing marker costs a feature:

| missing from `/health` | what you see |
| --- | --- |
| `karts=1` | somebody driving looks like they are running alongside you |
| `standings=1` | no positions while racing together |
| `reask=1` | a shared portal occasionally never turns up for the person joining |
| `portals=1` | portals refuse during shared play, with a picture saying why |
| `characters=14` | strangers with strangers' names |

To see whether a particular change is live, compare the `commit=` to the SHA of the
commit you expect &mdash; the deploy workflow does exactly that before it will go
green.

Plain `ok` is an older Worker that drops the
character number, and the symptom is subtle rather than obvious: every player gets
drawn from a guess, and the guess used to be character 0 &mdash; which is Henry, so
a room of four looked like four Henrys. The game now falls back to the shirt colour
instead, keeps people distinct, and says so in the Playing-together panel with a red
banner naming the fix. If somebody appears as a stranger with a stranger's name
&mdash; *Silver Otter* instead of *Dad* &mdash; that banner is the whole answer.
Any change under `server/` redeploys itself on push, so this table is a diagnosis
tool for a deploy that failed rather than a chore to remember.

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

**Furniture, in a second drawer.** Henry asked for a furnace and a bed to put
inside the houses he builds. Rather than make the row of blocks longer again, the
picker grew two tabs — 🧱 **Blocks** and 🛏️ **For a house** — and the furniture
lives behind the second one. The blocks row is pinned at nineteen by a test that
writes the number out rather than reading it back, so the next thing he asks for
goes in a drawer too.

**The bed is a bed.** The first one was a single cube with a red top, and it read
as a cake — he said so. So it is built the way Minecraft's is: **two blocks laid
end to end**, and shorter than a block, with a wooden frame on four legs, a
mattress, a blanket over that, a pillow and a headboard. It goes down in one press
and lies the way he is looking, pillow end furthest from him, so a bed built facing
a wall ends up with its headboard at the wall. Digging either half takes the other
with it. Two side by side make a double.

Which way a bed points is **not stored anywhere** — each half reads it off the fact
that its other half is next door. Two block ids instead of eight, nothing extra in
the save file, and the single-block beds he built before this change still load: they
come up as a lone foot, which is a bed frame with a mattress on it and nothing to
fix. The two halves scan their neighbours in opposite orders, which is what stops two
beds pushed end to end from pairing across the join.

A bed is the first thing in the game that is **not a cube**. `buildChunk` builds it
out of the twelve little boxes listed in `PROP_SHAPE`, written in sixteenths of a
block the way Minecraft's own models are, and a quarter turn at a time covers the
other three directions. It is still solid to walk into and stand on, so there is a
quarter of a block of daylight under his feet on top of one — the alternative is
teaching the collision code about part-height blocks, and that is physics.

**The furnace burns.** Its mouth is repainted on a timer, the same way Flint &
Steel's flame is: one tile of the atlas redrawn and re-uploaded, nothing re-meshed,
and nothing at all happening in a world with no furnace in it. Half the rate of an
open fire, with its own eight-frame counter, so a stove in a bedroom is not the
busiest thing on screen. Both are ordinary blocks otherwise: nothing cooks, nobody
sleeps, and both dig away like anything else.

**A table, a chair, a lamp and a rug** came next, and each needed something the bed
had not.

A **chair has a front**, and there is nowhere to keep which way it points except the
id itself — the world is one byte per cell and the save file is those bytes. So a
thing with a front costs four ids, one per quarter turn, with one entry in the
drawer; Minecraft does the same and calls it a block state. A chair turns to face
*him*, which is also what puts its back to the wall rather than its seat when he
pushes one against one.

A **lamp glows**. Its shade goes to the self-lit buffer — the one fire and portals
already use — so it gives off light instead of being lit by the sun. It is the only
box in the game that is self-lit and not a whole cube, which is why the mesher picks
a buffer per box rather than per block.

A **rug is walked over**, not into. `isSolid` already knew how to make something
see-through to the player, because that is how water and a lit portal work, so this
cost no physics. Its pattern also had to carry across the join: the first one had a
woven border, and five blocks by five came out as twenty-five little mats instead of
one carpet.

The atlas is **8 across by 16 down** now rather than 8 by 8. The furniture ran out of
tiles at 64, and a tile's position is derived from its index everywhere it is used —
so adding rows reflows the sheet on its own and every existing tile number stays
correct. The *columns* must never change: it is dividing by the column count that
turns an index into a row.

**A telly and a bathroom** followed: a television with something moving on it, a
bath, a sink, a toilet and bathroom tiles. With the door that brings the drawer to
twelve over two rows, and means the four-ids-per-front machinery is exercised by five families
rather than one. The screen is self-lit like a screen in a dark room, and what is
on it is deliberately abstract — bands of colour with a shape bouncing over them.
Nothing to read, nothing that could startle him, nothing that ever stops.

Three moving tiles was one too many for a pair of variables, so the animation is a
**table**: one atlas tile each, how many of that thing are in the world, and how
many ticks between pictures. Fire every tick, furnace every second, telly every
third — a room with all three in it should not flicker. A district with none of
them does no work at all.

**The headboard goes against the wall**, including in a corner. A bed is two blocks
and the cell he aims at is one of them, so there are eight arrangements; they are
scored rather than tried in a fixed order, and something solid behind the headboard
is worth more than everything else put together. The edge of the world counts as a
wall. In an open room nothing scores, so it lies away from him as it always did.

**Press BUILD on a piece of furniture to turn it** a quarter turn — bed, chair,
telly, bath, sink or toilet. No new button on an already crowded pad, and it is the
press he already knows. Turning a bed keeps the foot still and swings the head
round, and says so when there is no room. A wall, a floor, a table or a rug does not
answer to it, so building the house around the furniture is unaffected.

**Forward was backwards.** `rayHit` and `groundAhead` have always taken forward as
*minus* sin and *minus* cos of yaw. The direction helper the furniture used took
plus, copied from `faceOpenGround` — which uses plus because it is asking where
there is room *behind* him for the trailing camera to sit, the opposite question.
So every direction it produced pointed the wrong way: a bed's headboard went to the
wall behind him, and a chair turned its back on him. **The tests agreed**, because
they were written from the same misreading, which is exactly why they passed while
the game was wrong in his hands. Worth remembering as the failure mode a test
cannot catch: one that shares an assumption with the code it is checking.

**Things stand on rugs.** A rug is a sixteenth of a block thick but filled its cell
for placement, so "on top of it" meant the cell above — a table hovering a block up
with daylight under its legs. Rugs are **replaceable** now, the way water always
was: the block goes in the rug's own cell and stands on the floor he pointed at,
costing the one square of carpet it is standing on.

**A door that opens.** Two blocks tall, because he has to walk through it. The
bottom half carries both facts — which way it faces and whether it is open — so
that is four ids shut and four open; the top half is **one id** that reads both off
the block underneath, the same trick the bed's two halves use on each other.
Opening a door changes one block, the halves cannot disagree, and nothing new goes
into the save file. Pressing BUILD swings it: the panel is a slab filling the
doorway, and open it is that same panel swung a quarter turn about its hinge to lie
against the side, so the way through is really clear rather than merely marked
passable.

**It cannot trap him.** A door is the only decorative block in the game that can
turn a cell he is standing in from empty into solid, so shutting one on him is
refused — *"Step out of the doorway first!"* — while opening one from inside always
works. The guard was inverted the first time, written on the state the door is in
rather than the state it is moving to, so it refused to *open* a door he stood in
and shut one on him quite happily.

That door also forced one idea to become two. A single flag was doing both "he
walks through it" and "a new block goes into this cell". A rug needs both; an open
door needs only the first, because otherwise building a wall beside a doorway
**deletes the door**. They are `passable` and `replaceable` now.

**Dinner on the table.** A plate with a knife and fork, the same setting with food
on it, a cake and a cup. They go **on** the table rather than a block above it: a
place setting is a sixteenth of a block of china, so it lies on the table top where
he pointed. Passable, because a knife and fork are not something to bump into, but
not replaceable, so building beside the table does not sweep the dinner off it. The
settings turn to face whoever is sitting there, like the chairs do.

**Sitting down** is a 🪑 chip that appears whenever a seat is within reach and goes
when he walks away — the same way the 🏎️ kart button only exists on a circuit.
Deliberately *not* BUILD: BUILD on a chair turns it, and a five-year-old who wants
to sit down should not find out that way that his chair is now facing the wall. A
chair, a toilet and a bath have a seat height; a table and a telly do not.

Nothing about it can strand him. Pushing the stick stands him up, so the control he
already knows is always the way out; digging the seat out from under him stands him
up; getting into a kart stands him up; and standing up looks for somewhere clear
rather than assuming there is one.

The seated branch returned early out of `updatePlayer` at first. That correctly
skipped the physics — he is sitting inside a solid cell, which physics would shove
him straight out of — and *also* skipped the code that moves the avatar and the
camera, so he sat down and the picture stayed where he had been standing. Nothing
that reads `player()` could see it; only the screenshot did. The pose and the camera
are their own function now, called from both paths, and `avatarAt()` reports where
they really are so a check can hold them to it.

**Block ids are pinned by a test.** A district is saved as coordinates to block ids,
so an id *is* the save format — inserting into the middle of the list rather than
appending would turn every diamond in his world into something else, silently, with
no way back. All 81 numbers are written out longhand in `tools/test-game.js`, so
renumbering has to be a deliberate act.

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

**Animals.** Pigs, sheep and cows wander the land. Axolotls, turtles, mermaids
and sharks swim in any water at least three blocks deep, and crabs scuttle
sideways along the sand where the water meets the beach. Nothing in this game can
hurt Henry, and nothing chases him — the shark in particular swims a fixed circuit
worked out when it spawns and never reads his position at all.

Turtles, mermaids and crabs are Henry's own request. A turtle paddles slowly with
four flippers under a stepped, domed shell — flat, it read as a floor tile with a
head on it from the side, which is the angle he mostly swims up from. A mermaid
drifts upright with her tail trailing under her, which is how they are drawn in
every book he owns, and the reason she is not built lying flat like the fish. A
crab faces the sea and walks sideways past it: sideways is the whole point of a
crab and the reason it could not borrow the land animals' movement, because those
turn to face wherever they are going. Which way it faces is worked out from the
shape of the shoreline, which way it shuffles flips on its own timer, and it never
goes more than four blocks from the water.

**A zoo.** A third drawer, **For a zoo**, holds a fence, a gate, a hay bale and a
water trough. The fence is one block high — Henry can see over it and hop it —
and no animal will cross it. That is not a height rule: a one-block wall of
anything else is a step an animal takes without noticing, so the fence carries a
`pen` flag and an animal simply refuses to stand on one. Two-block walls still
hold them the way they always did, and both facts are checked, including the one
that says a one-block stone wall does *not* hold, which is the whole reason the
flag exists.

The gate is the fence with a hinge. It costs four ids shut and four open, the
same arithmetic as the door and for the same reason, and it borrows the door's
machinery — including the guard that will not let it shut on him while he is
standing in it. It swings so Henry can walk through, not so the animals can: a
gate is a pen open or shut, because the first thing he would do with his own zoo
is open the gate to go in, and a gate that emptied the pen would be a cruel joke.

A fence reaches out to whatever it stands beside, so a run of them is a run
rather than a row of posts. The shape is picked from the neighbours when the
chunk is meshed — the same trick the top half of a door uses — so nothing about
which way a fence joins goes into the save, a wall built beside one afterwards
joins to it, and digging that wall out lets it go again. Written the obvious way
first, with the rails fixed along one axis, which looked right along one wall of
a square pen and like separate panels along the other two.

**Carrying an animal.** A pen needs a way to get an animal into it. Leading one
works — they walk towards him when he is close — but a pig that loses interest
halfway across a field is an afternoon gone, so he can pick one up instead. Walk
up to a pig, a sheep, a cow or a crab, and a 🫳 button appears (`G` on a
keyboard); press it and the animal rides in his arms at two-thirds size until he
puts it down in the cell he is looking at. One at a time. It stays the same animal
throughout — the same entry in the same list with the same mesh, flagged `held` so
its own update leaves it alone — so there is no way to lose one by picking it up.
Putting one down into a wall or into the water is refused rather than forced, and
he keeps hold of it.

That last part turned up a bug in the crabs. A crab keeps to the shore by refusing
any step that takes it away from the water, which — carried into a pen in the
middle of a field — refused every step there was, and the crab stood still for
ever. Worse, the check for "is there water near me" looked down whole columns, so
a crab standing on a cliff twelve blocks above the sea found water one block away
and froze in exactly the same way. A shore is where the land meets the water, not
anywhere with a view of it: the search now ignores water more than three blocks
below, and with no shore to keep to a crab simply potters about.

**A zoo has to still be a zoo when you come back to it, and on the other screen.**
Both of those were broken the day the pen was built, and neither showed up in any
test, because both tests and pen lived on one device in one sitting.

The first: the animals were spawned from the world seed on every load and were
saved nowhere, so a pen Henry filled in the evening came back in the morning with
the fence still standing and the pigs back out in the field. Their positions are
part of the district record now — animals and crabs, the two kinds he can pick up,
and not the fish, since a shark swims a circuit worked out at spawn and putting one
back at a saved coordinate would drop it off its own lap. A record written before
today has no such field, which reads as "spawn them from the seed" — exactly what
used to happen, so nothing he has already built loads any differently.

The second was his dad's, in his own words: *"when Henry traps some animals in
blocks he can only see them. If I go over to the area they are not there."* Every
device walked its own copy of the animals about, and each copy walked towards the
player sitting in front of it. Same seed, same spawn, and then straight apart:
Henry penned three sheep and they were **his** sheep, while his dad's copies were
out in a field being followed by his dad.

So exactly one connected player moves them and tells everybody else — the keeper.
It is the longest-standing connection, which needs no election and no agreement,
and it moves on by itself when that player leaves. Picking an animal up also claims
the job, because whoever is carrying a pig across a field is obviously the person
who should be saying where the pig is. Everyone else glides their bodies to the
positions they are told about, four times a second, the same way the other players
glide. The room remembers the last set, so the first person in tomorrow starts with
the herd where it was left rather than where the seed first put it.

None of that changes playing alone, and nothing new is trusted: the positions are
four numbers each, bounded to the size of a district, with no names, no text and no
ids in them. Against an older Worker the game gets no keeper at all and falls back
to every client walking its own copy — worse, but no worse than it was, and better
than nothing moving.

The check for it is written the way the bug was found: two real browsers in one
district, one builds a pen and puts three animals and a crab in it, and the other
is asked what it can see. Turning the sharing off again puts the other screen's
animals at (7.9, 49), (13.9, 28.6) and (26.6, 55.1) — a pen at 20 to 29 with
nothing in it, which is the report exactly.

**Two more, reported the next day, and both my fault in the same way: everything
above was tested inside one continuous session on one device.**

*"If he picks up an animal I do not see him holding the animal."* The code that
keeps a carried animal in his arms sat in the input half of the render loop,
beside the button that puts it there. It ran — but only on a screen actively
being played, and after the position had already gone out over the wire. So what
the room was told, four times a second, was always the spot he lifted it from. It
lives with the other animal updates now, and before the two things that read where
they all are.

*"If we make a zoo and leave and come back later all the animals are gone."*
Rejoining takes different paths depending on what you have of your own. The person
who owns the district resyncs, which was fine. The person who joins by the code
has nothing, so the room's copy replaces their world outright — and that path
rebuilt the world and stood every animal back where the seed first put it. Worse,
if that person then turned out to be the keeper, those seeded positions went
straight back up to the room and emptied the pen for everybody. The rebuild now
puts the animals back: the room's word first, this device's last memory of the
same world second, the seed only if there is neither.

My first attempt to reproduce that one **passed**, which is how I found out the
test was wrong rather than the code being right: it used one player who owned the
district, and the bug needs a second player arriving with nothing. The check now
has one.

Two of these checks also had to stop watching the clock. Everything about the
animals travels four times a second in a real game, but a test page is a
software-rasterised voxel world drawing well under a frame a second, and that
update rides the render loop — so on the test machine it goes out about once every
two seconds. Fixed sleeps raced it: the same check passed one run and failed the
next, and the run where it "failed" had a perfectly correct animal that simply had
not been told about yet. They wait for the state now, like the avatar glide check
that fell into the identical trap. And one of them was passing for the wrong
reason as well — it measured only how *close* the animal was, and he was standing
right next to it, so it passed on an animal that had not moved at all. It checks
the animal is off the ground now.

## The shop

Henry has been building grocery stores, and asked for a cash register, money,
shelves with food on them to sell, a basket to fill, and a way to check out. A
fourth drawer, **For a shop**, holds a shelf unit, a register, and bread, apples
and milk. The cake and the cups stay in **For a house**, where he already knows
to find them &mdash; they belong on a table as much as on a shelf.

**A shelf holds its own goods.** Pick some food and press **BUILD** on a shelf to
put it on — one thing per shelf, changeable at any time. Shelves stack directly,
and every shelf in a stack holds its own thing, which is how he gets a tall one.

That was not the first attempt, and the first attempt was the thing he was
complaining about. Goods were ordinary blocks placed in the cell *above* a shelf,
and a shelf block drew three boards — so it looked like three shelves and behaved
like one, because only the top of a stack had a free cell above it and the two
lower boards could never hold anything. One tier a block fixes both halves of
that at once.

Stand at a shelf with something on it and a 🛒 button appears; press it and that
thing goes in the basket. The basket shows up as a chip in the corner with a
little picture of everything in it and what it comes to. Stand at the register
and the button becomes 🧾: press it and the till rings the basket through one
item at a time, beeping for each, and pays him the total.

**A price is what makes something shoppable.** The basket looks for any block that
has one, so the food that already existed &mdash; a cake, a cup, a place setting
&mdash; can go on a shelf and be rung up, without any of it needing to know that
shops exist. Bread 2, apples 3, milk 2, cup 1, cake 4, dinner 5. Small numbers on
purpose: a basket that comes to eleven is a number he can read out loud.

Two decisions in there are about him being five rather than about shops.

**Taking something off a shelf does not empty the shelf.** A shop he has to
restock is a shop that runs out, and a five-year-old filling a basket taps the
same thing twenty times &mdash; which should be twenty apples, not one apple and
then nineteen disappointments. The stock is endless, and a test asserts that a
whole shopping trip changes nothing in the world at all.

What is on the shelves is a map beside the block edits &mdash; same shape, saved
with the district at `v3`, sent to the room the same way, capped the same way. It
had to be: goods used to be ordinary blocks, which travelled and saved for free,
and anything that lives outside that map has to be taught to do both. Getting
that wrong is how a shop full of food comes up empty on the other screen, which is
a bug this project has already had twice with the animals. A v2 record simply has
no such field, which reads as bare shelves &mdash; and before today a shelf could
not hold anything, so that is the whole migration.

**And the register pays him.** He is the shopkeeper &mdash; that is who a child is
when they play shop &mdash; so the coins go up when he rings the basket through,
and up again for every star he finds. Nothing in this game takes coins off him,
which means there is no way to end up at nothing with a full basket and no way
forward, which would be a fail state in a game that is not allowed any. If he
would rather be the customer and pay, that is one sign flip and one message.

**Money is his, not a district's.** Coins live beside the character he plays as
rather than inside a world, so a star he finds in one district is still in his
pocket in the next &mdash; which is what a five-year-old means by *my money*. A
wallet per district would have had him standing in his own shop with nothing to
ring up because the stars were somewhere else. Five coins a star; ten stars a
district; and he can always make another district.

**The shelf was flickering, and the cause was two boxes in the same place.** The
uprights ran the full height of the block and all three boards passed through
them &mdash; and an upright's top face and the top board's top face were both on
`y=16` over the same three-by-three patch. Two faces on one plane pointing the
same way is what z-fighting is; back to back is fine, because the one you cannot
see is culled.

There is now a sweep over every prop in the game that fails on any two boxes that
overlap in volume or share a same-side face plane. It found **nine**: the bed's
headboard driven through its frame, water sunk into the rims of the sink and the
toilet, a door handle passing through the door, another sitting wholly inside the
open one where nobody could ever see it, both gates' rails running through their
stiles, and the shelf and the register. All nine are re-cut so the boxes butt
instead. 379 pairs across 42 props, checked every run.

**The register was carrying its own counter** &mdash; a box filling the bottom
seven sixteenths of its block &mdash; which is why it looked stubby on the ground
and why putting one on a table gave you a counter on a table. A register is a
register; what it stands on is whatever he stood it on. Redrawn as a dark body
with a drawer and handle across the front, a pale keypad stepped down towards the
customer, and the screen up on a short neck at the back, leaning forward and lit
by itself the way the telly's is.

The check on that one had to be a real page reload. An earlier version asked only
whether the coins survived a district switch, which they do whether or not they
were ever written down: it passed happily with the wallet never being read at
start-up at all, which was the one bug it existed to catch.

Those three sea creatures came with a change to how *nothing follows him* is
proved. The
wandering creatures used to potter about on `Math.random()`. That was safe — a
random number is not Henry's position — but it could only be argued, never shown,
because two runs never matched and so there was nothing to compare. Every creature
now carries its own stream of random numbers, drawn from the world seed so that
opening a district again gives the same creature the same life. A reproducible
wander turns the promise into a test: run the same world with Henry standing
sixty-eight blocks away and every fish, turtle, mermaid and crab traces a
byte-identical path. That check used to cover the shark alone. It covers all of
them now, and it fails on a crab given a drift towards him of one thousandth of a
radian.

## Controls

**Computer** — `W A S D` walk, mouse looks, click digs, right-click builds,
`Space` jumps, `Q` digs down, `E` digs up, `G` picks an animal up and puts it
down, `B` fills the basket and rings it up, `F` toggles flying (`Space` up,
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
other, that switching and returning restores everything, and that all six themes
generate playable worlds over 20 seeds each with measurably different terrain and
colours.

`node tools/test-game.js` drives the real `index.html` in headless Chromium and
asserts against the live world. It needs Playwright; set `PLAYWRIGHT_PATH` if it
is installed somewhere unusual. It covers the atlas and UV bounds, the palette,
the two picker drawers, ore generation and depth bands across 20 seeds, that no
fish ever leaves the water over a minute of simulation per seed, that every kind
of creature Henry asked for turns up in every world, that no crab ever stands in
the water or wanders inland, that no creature at all moves differently when Henry
moves, that a fenced pen holds an animal for ten minutes while a pen with one
block missing does not, that a gate holds open or shut, that an animal can be
picked up and carried and put down again, that a pen he filled still has the
animals in it after leaving the district and coming back, that a basket fills from
the shelves without emptying them and the till pays exactly what it came to, that
every tier of a stack of shelves holds its own thing and can be shopped from, that
no two boxes in any of the 42 props overlap or share a face plane, that his coins
survive a full page reload, that fire never spreads, and the control layout at
phone and desktop sizes.

`node tools/test-portals.js` covers portals: frame detection at every size from
1×2 to 21×21 in both vertical planes, a specific hint for each wrong shape, and
50 travel trials across all six themes checking arrival safety, the return
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
straight into the client to prove it never reaches the screen, one player building
a pen and putting animals in it while the other is asked what it can see, one
carrying an animal across a field while the other watches it travel, a zoo left
overnight and rejoined - by the person who built it and by somebody arriving on
the code with nothing - and the whole of
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
