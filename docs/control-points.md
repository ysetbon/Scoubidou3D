# Control points, the OpenStrand Studio way

Scoubidou3D already had OSS's curve *maths* (`src/geometry/bezier.ts`, a port of
`strand.py`'s profile builder). What it did not have was OSS's control-point
**UX**: what a strand offers you to grab, what each handle looks like, and what
grabbing one does to the others. This is that half, read out of the desktop app
and reimplemented in `src/model/controlPoints.ts`.

![the three marks and when they appear](control-points-marks.svg)

## What OSS actually does

Sources: `move_mode.py` (`try_move_control_points`, `update_strand_position`,
`mouseReleaseEvent`), `strand.py` (`update_shape`, the `start` setter) and
`strand_drawing_canvas.py` (`_draw_control_points_impl`).

**The marks.** Three shapes, all green with a black rim and a core in the
strand's own colour, at a radius of `11 × 1.333` canvas units:

| mark | what it is | OSS field |
| --- | --- | --- |
| triangle, apex up | control point 1 | `control_point1` |
| circle | control point 2 | `control_point2` |
| square, 0.7× size | the centre | `control_point_center` |

They are wired up with a **dashed green rig**: start→triangle, end→circle — or
start→circle while the circle is still parked on the start — plus centre→triangle
and centre→circle.

**A new strand carries all its control points on its start.** That is what makes
it straight (`buildProfile` reads "both control points at the start" as line
mode), and it is why the staging below exists at all: with everything stacked in
one spot, showing three marks would say nothing.

That is the state of an *unbent* strand, and only that. The moment the triangle is
grabbed the strand is no longer straight, and an unclaimed circle takes up its
real home — the end — in the same breath, before the curve is rebuilt. A circle
left behind on the start while the strand is already bent gets it wrong twice
over: the profile's waist is the midpoint of the two control points, so it lands a
few pixels off the head and the strand pivots around its own start instead of
bulging toward the handle you are pulling; and then the first nudge of the far end
teleports the circle out to it, reshaping a strand nobody asked to reshape. Both
were plain to see on an attached arm, where the start is a joint and the abandoned
circle sat buried under it.

**The staged reveal.** An untouched strand offers only the triangle. Grabbing it
sets `triangle_has_moved`, and *that* is what brings out the circle and the
square. Put every mark back on the start and the set folds away again.

**The circle is passive until claimed.** While `control_point2_activated` is
false the circle simply rides with the strand's end, so dragging the end keeps a
straight strand straight. Pull the circle off the end and it becomes independent;
drop it back on the end and it goes passive again.

**The centre locks by being touched.** Unlocked, it just tracks the midpoint of
the other two — moving an end control point carries it along and explicitly does
*not* lock it. Dragging it sets `control_point_center_locked`, and from then on
the curve runs through it as two segments. Drop it back within half a pixel of
that midpoint and it quietly unlocks itself: the undo is the gesture.

**Control points outrank endpoints.** OSS tests its control-point rectangles
(50×50) before its endpoint areas (120×120), so where a mark and an endpoint
overlap — which is every mark on a fresh strand — the mark wins the click.

**Endpoints carry their control points.** The `start` setter moves any control
point sitting exactly on the old start, so a straight strand stays straight while
you drag its head around.

**The third mark is optional.** `enable_third_control_point` gates the square,
and the curve checks it too: with the setting off, a centre already locked by
hand is ignored rather than lost.

## What Scoubidou3D does with it

All of the above, in Move mode, with the marks as flat 3D chips lying in the
drawing plane so they read as OSS's triangle / circle / square from the top-down
view and still make sense once you orbit. The radius is OSS's own, converted
through the scene scale, so the marks sit the same size against a strand's width
as they do on the desktop canvas. The **Middle handle** toggle is
`enable_third_control_point`.

It is checked by pressing it: `npm run qa:controls` drives the real handles in a
real browser — attach `1_2` to `1_1`, bend it, walk the pile on the joint, nudge
the far end, put it back — against a running `npm run dev`. The case only exists
once two strands are attached, and only a real press can say which of the marks
stacked on their joint the app hands you.

`triangleHasMoved` and `cp2Activated` are part of the strand and are saved with
the scene. An imported OSS file brings its own flags across; when a file predates
them, OSS's fallback applies — a strand counts as touched when its triangle sits
off the start.

### Getting back to the default

Parking the handles back on the start by hand is fiddly at the best of times and
worse once a strand has been bent in three places, so the panel does it for you.
Press a strand's row to open its inspector and it carries **Straighten**, which
puts that one strand back on the control points it was born with — both on the
start, no centre, nothing flagged as touched. It is greyed out, not hidden, on a
strand already there, so the inspector keeps the same controls in the same places
whatever state the strand is in.

The **Scene** card in the dock carries the same thing for the whole scene:
**Straighten all** straightens every strand at once. Undo takes it back — but a
press that silently rebuilds forty strands still deserves to be asked about, so it
takes two — the first arms it and names the count (`Straighten 4? Press again`),
the second does it, and the arming lapses on its own after four seconds. (A `confirm()` would be the obvious guard, but modal dialogs are refused
in a sandboxed frame, which is where the published page runs.)

Both go through `resetControlPoints` in `src/model/controlPoints.ts` — the same
function that normalises a straight strand on load, so a reset strand is
indistinguishable from a freshly drawn one, in the panel and in the saved file
alike.

Putting the handles back by hand ends in the same place. Dropping the triangle
back on the start, with the circle either back there too or still passive out on
the end, folds the set away as a full reset rather than by clearing a flag —
otherwise the strand goes on carrying whatever the gesture left behind (a circle
within a pixel of the start rather than on it, a `cp2Activated` still set from
having dropped the circle *on* the start, a centre nulled by the flag but not by
the record), every one of which keeps `controlsAtDefault` false. **Straighten**
stayed lit on a strand with nothing left to straighten, and the saved file carried
a bend it no longer had.

### Where the handles land on each other

An attachment glues a strand's start to another strand's endpoint, and both
strands keep their own marks there. On a plain `1_1` with `1_2` grown off its
end, that one point carries four of them: `1_2`'s triangle (born on its start),
`1_1`'s passive circle (riding the end it belongs to), and the two endpoint dots.
Control marks all draw in the same plane, so two of them on one point draw on the
very same pixel; the endpoint dots ride the woven height of the lace instead, so
they separate from the marks as soon as you orbit.

Two rules cover it, and both exist because OSS's flat canvas never had to answer
the question.

**A tie goes to the mark on top.** Where two control marks land on one pixel, the
press takes the one drawn nearest the viewer — the higher layer, which is the one
you are actually looking at. The old pass kept whichever it met first, which was
always the *lower* layer, so on `1_1` + `1_2` the arm's own triangle could not be
grabbed at all: the parent answered every press on the joint.

**Pressing the same spot again takes the mark underneath.** That is the whole
escape hatch for a pile: press to walk down it, drag when you reach the one you
want. Taking the pointer away puts the pile back to its top mark, and so does a
drag — leaving the spot is what ends the walk, so the press that finally moves
something is never read as one more request for the mark beneath it.

**And the pass order gives way to the aim.** OSS hands every press to a control
mark before an endpoint, which costs nothing when the two are the same pixel.
Here they come apart, and once the endpoint is clearly the nearer of the two it
wins — otherwise a bent strand could not be moved at all, because its own passive
circle sits on the end it rides and would answer every press meant for the end.
Where they really are on top of each other (a top-down view), the pass order takes
over again, and the pile is still walkable.

### One deliberate difference

OSS's fold-away check on release looks at the circle and the centre but **not**
the triangle. So bending only the triangle and letting go folds the set away
again — and because the desktop app gates *drawing* on `triangle_has_moved` but
*selecting* on a separate `control_point2_shown` flag that survives the release,
the circle stays clickable while invisible, parked under the start point.

A handle you can grab but cannot see is a bad trade in a view you can orbit, so
Scoubidou3D includes the triangle in the test. The set folds away when the strand
is genuinely back to untouched, and never before. Everything else — the shapes,
the staging, the passive circle, the self-unlocking centre, the pick order — is
the desktop behaviour as written.
