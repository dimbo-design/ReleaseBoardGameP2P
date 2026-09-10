# Hand limit on the board — the grid you fill yourself

**Date:** 2026-08-28
**Project:** ReleaseBoardGameP2P ("Release любой ценой")
**Issue:** [#104](https://github.com/MythHand/ReleaseBoardGameP2P/issues/104) (Wave 5 of
[#88](https://github.com/MythHand/ReleaseBoardGameP2P/issues/88))
**Scope:** The playground's `HandLimitStory` brought to the real board, driven by engine events: a
hand over the limit is emptied by pulling cards out of the fan, the excess builds an open grid at
the centre instead of trickling into the heap, the grid is held for the table to read and then
leaves as one staggered movement. The other half is input: the fan accepts a pull only while cards
are still owed, refuses it at the limit, and is **never** blocked by a flight. The visual source of
truth is the recipe "Hand limit — discard the hand down to the limit" (`docs/animations/recipes.md`)
and the story itself.

> Builds on three landed waves and takes nothing apart: the beat queue and its shadow rules
> ([2026-08-13-board-animation-layer-design.md](./2026-08-13-board-animation-layer-design.md)), the
> staging→beat handoff and the sibling gesture hooks
> ([2026-08-18-defense-release-board-design.md](./2026-08-18-defense-release-board-design.md)), and
> the gather→hold→scatter leg
> ([2026-08-21-error-503-board-design.md](./2026-08-21-error-503-board-design.md)), whose
> `GATHER_HOLD` says in its own comment that #104 reuses it. Centre geometry follows the single
> source #127 established (`apps/ui/src/table/TableCentre/centre.ts`).

## The goal

A turn that ends over the hand limit is paid for with a gesture, not a checkbox list. You pull the
excess out of the fan, card by card, as fast as you care to; each one takes its own cell in a grid
that was sized before the first card moved; the finished grid stands open long enough for the table
to read what the turn cost you, and then goes to the discard as one staggered movement. Until the
last cell fills, nothing is final — a card in the grid can be carried back into the hand.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Who picks the cards | **The fan.** `PendingPrompt` is suppressed for `handLimit`, exactly as Wave 3 suppressed it for `discardForRelease` and Wave 4's design did for `neutralize503`. The cards on the table already ask the question. |
| 2 | The keyboard | **The known gap, made worse and written down.** The fan has no keyboard door (`Hand.tsx`: "pointer-only … no keyboard affordance implied"), and unlike `defend` this pending carries **no deadline** (`network/session/referee.ts:386`), so a stalled pick has no timeout behind it. `docs/animations/backlog.md`'s existing entry gains this case rather than a second entry. |
| 3 | Carry-back out of the grid | **In scope.** Nothing is dispatched until the last cell fills, so a card in the grid is a decision in progress. Without it a misdrop costs a real card with no undo. |
| 4 | When the RESOLVE goes out | **When the last card LANDS**, not when it is dropped. At that instant the grid is provably complete and the carry-back window is closed by the same event — no race between a dispatch and a card coming back out. |
| 5 | Pull only, no click-to-discard | The scene is pull-only, and a stray click costing a card is the wrong failure. A click in the fan stays what it is everywhere else. |
| 6 | Where the choreography splits | **The gesture flies the cards in; the beat holds and takes them out.** The pull flights are not beats at all, which is what makes "the hand is never blocked by a flight" structural rather than promised. |
| 7 | Its own plan kind and runner | **`handLimit`, not a flag on `discard`.** Two reasons the sweep's `gather?: true` does not stretch to cover it: the local actor's cards are **not in the fan** when the events arrive, and the runner needs the page's handoff, which `useDiscardBeat` has no business knowing about. What is genuinely shared is shared: `GATHER_HOLD`, `useDiscardExit`, and `withoutFlown` (extracted). |
| 8 | Where the grid's geometry lives | **`@release/ui`'s `TableCentre`**, beside `centre.ts`, per #127's rule that centre geometry lives in TS and is read rather than re-typed. One function answers both readers — the page's cells and the beat's boxes — so they cannot drift. |
| 9 | The story adopts the shared geometry | Its two local TS constants (`gridOf`, `GRID_CARD_W`) become imports, so the shapes and widths exist once. Its rendering and behaviour are untouched, which leaves `GRID_TOP` / `GRID_GAP` living in the story's CSS and **quoted** into the module — the same relationship `poses.ts` already has with `DefenseReleaseStory`, and the most the shared home can take without restyling an approved scene. |

## What the issue asks for, and what the code actually says

### The pending resolves in one action, so the picking is entirely local

`onHandLimit` (`packages/engine/src/fake/reduce.ts:183`) takes **all** `excess` uids in one
`RESOLVE`, rejects any other count outright, emits one `discarded(reason: 'handLimit')` per card and
then ends the turn. There is no per-card action to send. So every card the player pulls is a purely
local fact until the last one, and the grid the player builds is theirs alone until the engine
answers — which is precisely what makes the carry-back possible and the local flights free of the
network.

`pending.options` (`fake/attacks.ts:435`) is every uid in the owner's hand, `[]` for everybody else.
Legality is the projection's answer here as everywhere: nothing re-derives which cards may go.

The pending has a second producer, and it is not an edge case: Bad Vibe-Coding raises the same
`handLimit` with `excess: 1` and `endsTurn: false` (`fake/triggers.ts:330`) — a card off the hand
mid-turn rather than a turn ending. Same pending, same gesture, same beat; only the events behind it
differ, and nothing in this design branches on it. It is written down because it is the case a
`turnEnded`-shaped assumption would quietly break.

### The gather leg exists — and it lays a heap, not a grid

#102 landed the sweep inside `discardBeat.tsx`: cards fly to the centre, take a `scatterAt` pose,
hold for `GATHER_HOLD`, and the boxes they occupy are handed to `useDiscardExit`. The hand limit is
the same three-part shape with two differences, and both are the point of the scene: the layout is a
**grid of cells chosen upfront from the known excess**, not a heap, and on the local actor's board
the cards are already standing in it before the beat exists.

Worth stating because it removes work the first cut of this design carried: the sweep proves a
gathered card needs **no DOM cell**. It flies to a computed box and stands there as a flyer. So only
one grid is ever React-rendered — the page's interactive one — and the beat's build path renders
nothing but its own carriers.

### The board's only hand-limit affordance today is the panel

`state.pending.kind === 'handLimit'` currently falls through to `PendingPrompt`
(`_Board.tsx:1449`), which lists the hand as `CardOption` buttons and confirms with a Discard
button. That panel is `inset: 0` at z 92 with an opaque surface: it would cover the very grid the
player is filling, and it asks a second time what the fan is already asking. It goes, for the same
reasons #101 and #102 removed it for their pendings.

### The rejection is already written

`Hand.tsx:369` — a drop the consumer refuses settles the card back into its own slot, "the same
glide a rejected play takes". The issue asks for exactly this, so the limit is enforced by returning
`false` from `onHandPlay` and nothing else is written for it.

### A grid is not a set of named places

`centre.ts`'s model is named slots with a fixed `dx` and width, gathered into sets per situation, and
its header is explicit that a new situation adds its own set. A grid does not fit that model: its
cells are a function of a count, not names anyone can list. So the grid goes in a sibling module in
the same folder, under the same rule (geometry in TS, read by everyone) and with the same
attribution to the scene it came from — and `CENTRE_SETS` is left alone rather than bent.

### The local actor's cards are not where a discard beat would look for them

`sourceOf` finds a discarded card by matching its id against the hand still on screen. For every
other peer that is right. For the actor it is not: by the time the events arrive, those cards have
been standing in the grid for as long as the player took to fill it. This is the fact that makes the
handoff necessary and a flag on `discard` insufficient.

## Architecture

### Geometry — `apps/ui/src/table/TableCentre/discardGrid.ts` (new)

Quoted verbatim from `HandLimitStory`, exported from `@release/ui`:

- `gridOf(n) → { cols, rows }` — 1–4 one row; 5–6 two rows of 3; 7–8 two rows of 4; 9–10 two rows of
  5; past 10 three rows (`cols = ceil(n / 3)`).
- `GRID_CARD_W = [150, 132, 116]` by row count — the taller the grid, the smaller the card. The
  one-row width is `CENTRE_CARD_W` already, so the board needs no rescaling.
- `GRID_TOP = 44` and `GRID_GAP = 12`. The grid's own row sits 2% below the centre row
  (`CENTRE_TOP` is 42) — the scene's value, carried verbatim rather than aligned by inference, and
  it is the scene's because a block of up to three rows is not a card box.
- `gridCells(n) → { dx, dy, w, h }[]` — one entry per slot, **offsets from the grid's centre point**,
  the shape `centreTransform` already speaks in. Cell height is `w * CARD_RATIO`
  (`@release/ui`'s own, so nothing re-types the card's proportion). The page positions its cells with
  these offsets rather than a CSS grid, so the numbers it renders are the numbers the beat flies to —
  one function, two readers, no second layout to keep in step.

The beat reads the table's own rect from `anchors.bg` (the ambience layer, `inset: 0` of the table)
to turn `GRID_TOP` into a viewport point. The page needs no such measurement: it renders inside that
same box.

`CLEAR_STEP = 90` (the grid's exit stagger) joins `GATHER_HOLD` in
`entities/game/board/poses.ts` — a board timing, beside the holds already there.

### The gesture — `_useHandLimit.tsx` (new page hook)

A third sibling to `_useBoardStaging.ts` and `_useDefenseStaging.tsx`, live only while
`pending.kind === 'handLimit' && pending.player === selfId`. It owns:

- **The gate.** A pull is accepted while the hook is enabled (`!(deal.active || beats.exclusive)`),
  the uid is in `pending.options`, fewer than `excess` cards are claimed, and nothing has been
  dispatched. Otherwise `false`, and the kit glides the card home.
- **Concurrent flights.** One flyer key per card. The single-flight guard its sibling keeps
  (`if (stagedRef.current) return false`) is deliberately absent — that guard is the thing the issue
  forbids. Each flight carries its own card, slot and source rect as arguments (**I8**) and mounts on
  its source rect (**I10**).
- **The grid.** `cells` is fixed at `excess` on the first pull and never grows. Claimed slots are a
  **set**, not a count, so a card carried back frees the cell it left rather than the last one.
- **The carry-back.** A press on a placed card frees its cell and puts the card on a cursor-riding
  flyer; `Hand` is told `carrying` and given a `gapAt` read from the pointer (`BAND_PAD` 32, the
  hand's own tolerance). Released over the band → `useHandArrival.arrive(...)` into the slot the
  pointer named, then un-pick and `handOrder.commit` so the fan keeps it there. Released anywhere
  else → `playToCenter` home to its own cell, because snapping reads as the drag having failed.
- **The dispatch.** When the last flight lands: one `onResolve({ kind: 'handLimit', cards })` with
  exactly `excess` uids, and the grid locks — no further pull, no further carry-back.
- **The handoff**, kept current in a ref for the queue.
- **The catch-up.** Picks are dropped when the projection stops holding those cards, the same
  lifecycle its siblings keep — and the only clearing path under reduced motion, where no beat ever
  runs to release the grid.

Fan lighting follows the scene: while cards are owed, every option reads `playable` with a single
`var(--danger-accent)` — one hue, not the per-category accent, because this pick *costs* a card.
Nothing lights once the grid is full.

### The handoff — `HandLimitHandoff` in `entities/game/board/types.ts`

```ts
export interface HandLimitHandoff {
  player: string
  cards: { uid: string; card: CardData; slot: number }[]
  cellAt: (slot: number) => HTMLElement | null
  release: () => void
}
```

A ref, sampled by the runner into axis-aligned viewport `from` rectangles, for the same reason
`StagedHandoff` is one. The runner does not retain or hand a live cell node to the exit. It lives in `entities`
because the page produces it and a feature consumes it.

### The board — `_Board.tsx`

- `discarding` joins `answering` as a derived constant, and the `Hand` call sites become a three-way
  pick (defence hook / hand-limit hook / turn hook). The three can never overlap: `state.pending` is
  one slot.
- The grid renders while the hook holds cells: one absolutely-positioned cell per slot at its
  `gridCells` offset, each filled cell carrying a `<Card>` and the carry-back's `onMouseDown`. An
  empty cell takes no pointer events — the same rule `.centre:empty` keeps for the slot underneath,
  which the grid sits over while it exists.
- `PendingPrompt` gains `handLimit` to its suppression list.
- The ask line gains `askHandLimit`, shown while cards are still owed — a new key in **both**
  catalogs, count-free because `copy.table` arrives pre-translated with no interpolation.

### The plan — `planBeats.ts`

`discarded` with `reason === 'handLimit'` opens its own run instead of feeding the generic one:

```ts
| { kind: 'handLimit'; key: string; player: string; cards: DiscardCard[] }
```

It coalesces like every other run and `flush()` closes it, which is what makes an excess of three
read as one gesture. `sourceOf` still resolves each card, because the shadow has to subtract them;
the runner reads those sources only on its fallback path.

### The beat — `handLimitBeat.tsx` (new runner)

`await nextFrames()` first, for the same reason `discardBeat` waits: the queue starts a beat inside
a layout effect, when the arrived projection is committed and its shadow is a commit away, and
measuring before that yields the wrong slot (**I1**). Then `ctx.publish(withoutFlown(base, cards))`
— the cards are gone from fan and seat counts, the heap stays the projection's until they land.

Then one of two ways into the grid:

1. **Adopt** — the plan's player is us and the handoff names that same player. The runner measures
   every handed-off cell into an axis-aligned viewport `from` rectangle. Nothing flies in; the grid
   is already standing where the player put it.
2. **Build** — every other peer, and ourselves with no handoff. Cell boxes come from `gridCells`
   against the grid's centre point (`GRID_TOP` of the table rect read from `anchors.bg`); one flyer
   per card is raised at its source (the actor's seat box, or a hand slot on the self-fallback) and
   flown `playToCenter` into its box, all concurrently.

And one tail either way: `wait(GATHER_HOLD)` → `handoff?.release()` in the same synchronous burst as
the send, so the page's grid lets go in the commit the carriers go up in → `send()` through
`useDiscardExit` with measured axis-aligned `from` rectangles in both paths, `layer` = the slot,
`delay` = `slot ×
CLEAR_STEP`, and `scatter: scatterAt(eventId)` so each card ends on the pose the heap already holds
for it (**I7**). `reset()` drops the carriers on a match boundary, like every sibling runner.

`useBeats` registers the kind and threads a `handLimit` handoff ref beside `staging`.

### One extraction

`withoutFlown` moves out of `discardBeat.tsx` into its own module under `features/board-beats/`.
Two runners now need one answer to "these cards have left and the heap has not got them yet", and a
second copy of it is a second source for one heap.

## Data flow

**The actor.** `handLimit` pending arrives → the fan lights → each pull claims a cell, leaves the
fan at once, and flies (several at a time) → the last landing dispatches the RESOLVE and locks the
grid → the engine's discards come back as one batch → the beat adopts the standing grid, publishes
the subtraction, holds `GATHER_HOLD`, releases the page's grid and flies every card to the heap on
its own scatter → the queue drains and the projection — which already holds those cards in the heap
— takes over with nothing moving on the handover.

**Everybody else.** The same batch, no handoff: the beat computes the cells, flies the cards out of
the actor's seat box into them, and continues into the identical tail.

**Reduced motion.** No beat runs at all — the queue's one policy. The gesture still works: cards
take their cells with no flight, the RESOLVE still goes at the last pick, and the grid is cleared by
the hook's own catch-up when the pending clears. The same shape `clearPaidCost` already has for the
case where no beat exists to call it.

## Error handling

- **A refused pull** never touches state, and the card glides home (the kit's own settle-back).
- **A rejected RESOLVE** — the hook watches the feed for `rejected` after dispatch, as both staging
  hooks do, unlocks, and returns the cards to the fan through the ordinary return flight.
- **A missing rect** on the build path drops that card from the flight and leaves it to the
  projection, exactly as `toLeaving` already does — nothing is invented, and the heap is right
  either way.
- **A thrown run** costs the animation and never the state: the queue drops the shadow in its
  `finally`, and the projection already holds the discards.
- **A match boundary** wipes the hook (`matchKey`) and resets the runner — with the standing note
  that this key is inert until #19 mints a per-match id.
- **A rejoin mid-pending** finds nothing dispatched: the hook starts fresh against the re-projected
  `excess` and `options`.

## Tests

- `apps/ui/src/table/TableCentre/discardGrid.test.ts` — the shapes at each threshold, the width
  falling with the row count, cells centred on the centre point and never overlapping.
- `planBeats.test.ts` — a `handLimit` run plans its own kind and keeps its event ids; it does not
  coalesce with a discard of another reason; a batch carrying `turnEnded` behind it still yields one
  run.
- `handLimitBeat.test.tsx` — the adopt path flies nothing in and leaves from the handed cells; the
  build path raises one carrier per card; the published shadow subtracts the cards and leaves the
  heap alone; `release()` lands in the same commit as the exit; a reset stops a run mid-flight.
- `useBeats.test.tsx` — the new kind reaches its runner and the queue drains it.
- `__tests__/boardHandLimit.test.tsx` — a pull under the limit is accepted and one at the limit is
  refused (the card stays in the fan); a second pull is accepted while the first flight is still
  unresolved; `onResolve` fires once with exactly `excess` uids; a carry-back returns the card to the
  fan and frees its own cell; a `handLimit` raised with `endsTurn: false` (Bad Vibe-Coding) plays the
  identical gesture; no `PendingPrompt` renders for this pending; the ask line shows while cards are
  owed; under reduced motion the grid still fills, still resolves, and is cleared when the pending
  goes — the one path with no beat behind it.

Reduced motion is mocked per suite rather than globally (five of the board suites do it today): on
for the assertions that are about the projection, off where the gesture's own flights are the
subject.

## Documentation

- `docs/animations/recipes.md` — the Hand limit recipe gains the board's split: what the gesture
  owns, what the beat owns, and the two ways into the grid.
- `docs/animations/glossary.md` — `GATHER_HOLD` gains the board as a reader; `CLEAR_STEP` is
  recorded with its own.
- `docs/animations/backlog.md` — the keyboard entry gains `handLimit` as the harsher case: no
  deadline, so the stall has no timeout behind it.
- `apps/playground/stories/AnimationAuditStory` — the Hand limit scenario's status, and the register
  line matching the backlog note.

## Out of scope

- Click-to-discard and any keyboard path into the fan (Decision 2 — recorded, not filled).
- Retuning `GATHER_HOLD`, `CLEAR_STEP` or the grid widths. The values are the scene's.
- Porting the board's existing centre slots onto `centre.ts`. #127 built the source; the migration
  of the four slots already written in `_Board.module.css` is its own task, and this one only
  declines to add a fifth copy.
- `crush` and every other pending that asks for cards. This is the hand limit alone.
