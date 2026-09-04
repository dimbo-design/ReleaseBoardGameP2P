# Recipes — animations by game situation

Each recipe is an **independent action**: an explicit trigger + guard, the exact ordered
sequence, the verbatim params/timings, the invariants that keep it stable, and the cleanup —
so it can be called at the right game moment and replay identically on repeat.

Read the shared model and the `I1…I10` invariants in [`README.md`](./README.md) first; recipes
reference those by number instead of repeating them.

**Where a movement has a step, the recipe names the step — it does not restate its mechanics.**
Three movements are shared and live in one place each ([`reference.md`](./reference.md#the-movement-steps-and-the-carrier-under-them)):
`useHandArrival` (cards arrive in the hand), `useDiscardExit` (cards leave the table for the
discard), and the carrier `useFlyer` under both. A recipe says *which step and what
it is passed*; the frame-by-frame — measuring, `nextFrames`, the scatter coupling, the layer order,
splitting a pair — lives inside the step and is described there, once.

**Recipe schema** (every recipe has these sections):

- **When to call** — the game event that triggers it + the guard/preconditions.
- **Visual result** — one line: what the player sees.
- **Elements / refs** — DOM nodes/slots/state the action needs (must pre-exist).
- **Sequence** — numbered, exact steps (set state / mount → measure → `nextFrames` → position →
  `play(...)` → `await` → branch → cleanup).
- **Params & timings** — the concrete numbers (durations, easing, offsets), verbatim.
- **Invariants** — the global `I#` it relies on + any local ones ("else it breaks …").
- **End state & cleanup** — final positions and state resets.
- **Building blocks** — links into [`reference.md`](./reference.md).
- **Live reference** — the playground story that is the visual source of truth.

---

## Playing a card — hand/opponent → center → discard

> **What the centre IS** (rules owner, 22.08.2026): nothing at rest. It is an ACTIVE area — the place
> cards are played through — not a place anything is fixed in. At the start of any player's turn it
> is empty, because everything played has gone where it belongs. A Monitoring lands at the centre
> FIRST and only then travels to its slot in the release zone; the closest thing to a live centre in
> the playground is `Defense Release`.
>
> **The engine does not emit this pair.** `placed` is a Monitoring protection landing in the
> release zone (`fake/release.ts:177`, `fake/triggers.ts:298`) and staying there, and a card spent
> on an attack reaches the discard through `bankToDiscard` with **no event at all**. There is no
> table centre in `PlayerView` either. This recipe stays as the description of the *movement*,
> which is real and shown in `CardPlayStory` — what it is **not** is a mapping from engine events.
> Both findings are in [`backlog.md`](./backlog.md); for the live board, see
> "A card leaves the hand for the discard" below.

The card is played to the table center (visible to everyone), rests there during its effect,
then leaves to the discard. Two independent triggers: **A** (to center) and **B** (to discard).

**When to call**
- **A — to center:** the player clicks a hand card, or the opponent plays one. Guard:
  `if (busy || center) return` — the center holds exactly one card; wait until it is cleared.
- **B — to discard:** the centered card resolves (in the showcase, a click on it). Guard:
  `if (busy || !center) return`.

**Visual result**
A card lifts from the hand (or from the opponent's seat), flies to the table center face up and
rests there; on resolution it flies to the discard on the right and lands rotated/offset among
the pile.

**Elements / refs**
- `handRefs[uid]` — the played hand card's slot (A source, player).
- `seatRef` — the opponent's seat (A source, opponent).
- `centerRef` — the one-card center slot (A target / B source).
- `discardRef` — the discard slot (B target).
- `flyerRef` — the **single** fixed flyer node that carries the card to the centre.
- State: `center: CardData | null`, `discard: DiscardEntry[]`, `flyer: { card, at } | null`, `busy`.
  The flyer's state carries **where it mounts** (`at`), not only which card — **[I10]**.
- The trip to the discard is not hand-rolled here: it is the shared step `useDiscardExit`.

**Sequence**

_Phase A — to center_ (trigger handler `playFromPlayer` / `playFromOpponent`, then `flyToCenter`):
1. Guard `busy || center`. Capture the **source rect** `from` and update the source — on the same
   tick, in this exact order (as in the code):
   - player → `setPlayerHand(remove the item)`, **then** `from = handEl.getBoundingClientRect()`.
     React defers the unmount, so measuring the still-mounted node on the same tick is valid.
   - opponent → pop the top of `oppDeck`, then `from = cardBoxIn(seatRect, CARD_W)` — a `Seat` is
     wider than a card and shows only a counter, so there is no card element to measure; the shared
     helper centres a card-sized box on the seat, at the width a card has on the table.
2. `flyToCenter(card, from)`: `setBusy(true)`; measure `to = centerRef.getBoundingClientRect()`.
3. `setFlyer({ card, at: from })` — the flyer is rendered with `style={{ left: at.left, top: at.top,
   inlineSize: at.width }}`, so its **first painted frame is already on the card** — **[I10]**.
4. `await nextFrames()` — **[I2]**, let it paint at `at` before it starts moving.
5. `const anim = play('playToCenter', flyer, { from, to })`; `if (anim) await anim.finished`.
6. `setCenter(card)`; `setFlyer(null)`; `setBusy(false)`. The card now rests in the center.

_Phase B — center → discard (separate trigger):_ this is the shared step, not a local flight.
1. Guard `busy || !center`; `setBusy(true)`; `const card = center`.
2. Measure `from = centerRef` rect — **[I1]**; `setCenter(null)`.
3. `await sendToDiscard([{ key: 'played', card, from }])` — `useDiscardExit`, wired once as
   `useDiscardExit(discardRef, (cards) => setDiscard(d => [...d, ...cards]))`. The step owns the
   scatter, the flight and the landing pose (**[I7]**), and hands back the entries to append.
4. `setBusy(false)`.

**Params & timings**

| Step | Preset | Duration | Easing | Extra |
|---|---|---|---|---|
| A: hand/seat → center | `playToCenter` | 480 ms | EASE | — |
| B: center → discard | `useDiscardExit` | `FLIGHT_MS = 420` | — | the step owns the preset and the scatter |
| opponent source box | — | — | — | `cardBoxIn(seat, CARD_W)` — a card-sized box centred on the seat |
| `jitter()` ranges | — | — | — | `rot ±14°`, `dx ±10px`, `dy ±8px` (inside the step) |

- Card height/width ratio = **1.4** (`CARD_RATIO`, shared from `@/primitives/Card`).
- Hold between A and B is **user-driven** (the card waits in the center until it resolves). For
  an auto-resolving variant, insert `await wait(ms)` between the phases (e.g. `CENTER_HOLD = 420`
  in Deck animations).

**Invariants**
- Global: **I1** (measure before mutate), **I2** (`nextFrames` before each flight), **I7**
  (`jitter()` once, passed into the preset **and** stored with the entry — inside the step here),
  **I10** (the flyer carries the rect it mounts at, or it flashes at the bottom of the page).
- Local — **the center is a one-card gate**: the `busy || center` guard makes the action safe to
  re-trigger; a card must leave the center (Phase B) before another can enter.
- The scene's own flyer carries the card only to the centre; the step raises its own for the trip
  to the discard. Commit to `center` / `discard` state only after the flight resolves, then drop it.

**End state & cleanup**
- After A: `center = card`, flyer gone, `busy = false`.
- After B: a new `DiscardEntry { card, rot, dx, dy }` appended; `center = null`; flyer gone;
  `busy = false`. State is clean for the next play.

**Building blocks**
[`playToCenter`](./reference.md#presets) (`move()` travel) · the step
[`useDiscardExit`](./reference.md#the-movement-steps-and-the-carrier-under-them) · [`cardBoxIn`](./reference.md#card-geometry-helpers) ·
[`nextFrames()`](./reference.md#travel-and-timing-helpers).

**Live reference**
`Card play` — `apps/playground/stories/interactive/CardPlayStory.tsx`.

---

## A card leaves the hand for the discard (live board)

The first choreography driven by real engine events rather than by a scene's own clicks. A
`discarded` event arrives off the wire; the card flies from wherever it stood into the discard heap
and stays there. This is the game-layer counterpart of the scene recipe above — same step, but the
trigger, the source and the timing all come from the projection.

**When to call**
Never directly. The board's queue (`useBeats`) plans it from the batch and runs it. What a caller
controls is `enabled` — the queue is armed only once the opening is over.

**Visual result**
The card lifts from its slot in the fan (or from an opponent's seat, or out of a release slot) and
settles into the discard at its own tilt and offset, among the cards already there.

**Elements / refs** — all from `BoardAnchors`, owned by `_Board.tsx`
- `handSlotAt(index)` — the player's own card, matched by card id against the hand **still on
  screen** (`discarded` carries a card id, not a uid).
- `seatBox(player)` — an opponent's, as a card-sized box centred on the seat (**I6**).
- `releaseSlot(player, slot)` — reasons `destroyed` / `neutralized` only; the card leaves the zone
  it stood in, and the slot is always looked up under its owner (every player has a `frontend`).
- `discardBox` — the target, trimmed to the card area by the step itself.

**Sequence**
1. A batch arrives. `planBeats(events, before)` folds every `discarded` in it into **one** beat —
   one by one but all at once, so a hand-limit discard of three reads as one gesture.
2. `before` is the projection the board is still showing, not the one that just arrived: `live`
   already has the card out of the hand, and its slot with it (**I1**).
3. The queue renders that projection as the `shadow` while the beat runs, so the source slot is
   there to measure.
4. Each card becomes a `Leaving { key, card, from, scatter: scatterAt(eventId) }`; a card whose
   source cannot be found is **not flown at all** (see the backlog — that rule is undecided).
5. `send(items)` — the shared step owns the flight, the tilt unwind and the landing pose.
6. The queue drains, the shadow is dropped, and the live projection takes over.

**Params & timings**

| Step | Preset | Duration | Extra |
|---|---|---|---|
| slot/seat/zone → discard | `useDiscardExit` | `FLIGHT_MS = 420` | the step owns the preset and the scatter |
| scatter key | — | — | `scatterAt(eventId)` — the event id is the stable integer, and the heap uses the same call |

**Invariants**
- **I1** — planned against the projection still on screen, never the one that just arrived.
- **I6** — a seat and a pile are both wider than a card; both are trimmed to a card box.
- **I7** — the flight's scatter and the heap's resting scatter are one value read twice, so the
  handover from shadow to projection changes nothing on screen. This is the property the whole
  design turns on, and it holds across a boundary neither side can see.

**End state & cleanup**
The queue drains, `shadow` goes null, and the board renders the projection — which already contains
the card in `decks.discardHeap`, at the pose it just landed on. Nothing to clean up: the beat owns
no state that outlives it.

**Gating**
None. A discard is a thing that *happened*, not a thing being decided, so the fan stays live
(README, "Gating the hand", approach 3). Only the opening is `exclusive`.

**Under `prefers-reduced-motion`**
The beat is never planned and never runs; the board renders the projection it already holds. One
check, in `useBeats`, because `play()` does not make it.

**Building blocks**
[`useDiscardExit`](./reference.md#the-movement-steps-and-the-carrier-under-them) ·
[`planBeats` / `useBeats` / `BoardAnchors`](./reference.md#the-boards-layer--anchors-and-the-beat-queue) ·
[`scatterAt`](./reference.md#discard-scatter).

**Live reference**
Not a playground scene — this one runs on the real board (`apps/frontend/src/features/board-beats/`).
The movement's own showcase is `Card play`, part B.

---

## A card is drawn (live board)

Driven by `drawn`, planned by `planBeats` and run by `drawBeat` (`useDrawBeat`). One flight to the
centre for every draw in the batch, then a branch on who drew it and what it turned out to be — the
scene is `DrawCardStory`, the trigger here is a real engine event instead of a click on a deck.

**When to call**
Never directly. `useBeats` plans a `draw` beat from every `drawn` in an arriving batch and runs it
through `drawBeat.run`.

**Visual result**
A face-down card lifts from the pile the event names and flies to the table centre. Then: the
drawer's own card flips and settles into their fan; an opponent's stays closed and sinks into their
seat as a back; a trigger flips face up, stands revealed at the centre for a hold, then leaves for
the discard on its own.

**Elements / refs** — all from `BoardAnchors`
- `pileBox(d.pile)` — the source, the pile the event names (not "the deck": `pileBox` is keyed by
  the index `drawn.pile` carries).
- `centre` — where every draw stages, mounted for the whole match (not only during the deal).
- `hand` — the drawer's own fan, via the shared step `useHandArrival`.
- `seatBox(player)` — an opponent's seat, trimmed to a card box (**I6**).
- `discardBox` — the trigger's own exit, via the shared step `useDiscardExit`.

**Sequence** (`toCentre(d)`, then a branch per `PlannedDraw`)
1. `toCentre`: measure the source cell (`cardAreaOf(pileBox(d.pile))`) and the centre; raise a flyer
   face down — its face is `d.card ?? d.reveal?.card` when known, else a generic cover (an opponent's
   closed card carries no identity to guess at); `play('drawToCenter', …)`; `pin('draw', centre)` —
   **[I4]**, so every branch below starts from where the card visibly stands.
2. Branch decided by what the `PlannedDraw` carries, not by any extra lookup — **the card's
   presence, and the reveal that follows it**:
   - **`d.card` present, `d.mine`** → the drawer's own card. `wait(BEFORE_FLIP)` → `patch('draw', {
     faceDown: false })` (the `Card` plays its own `flipCard`) → `wait(AFTER_FLIP)` → measure the
     flyer, `drop('draw')`, `arrive([...], grown)` — `useHandArrival`, where `grown` is read off
     `ctx.current.base.you.hand.length`, the fan **this beat has grown so far** (**I8**).
   - **`d.card` absent, no `d.reveal`** → somebody else's, closed. Straight from the centre:
     `play('dealToSeat', { from: centre, to: cardBoxIn(seatBox(d.player), CARD_W * SEAT_SHRINK) })`,
     no flip, `drop('draw')`, and the shadow's `handCount` for that opponent is bumped and published.
   - **`d.reveal` present** → a trigger, turned up for the whole table (an AI trigger is claimed
     whole by its own beat and never reaches this branch — see the AI recipe below). `wait(BEFORE_FLIP)`
     → `patch('draw', { faceDown: false })` → `wait(AFTER_FLIP)` → `wait(TABLE_HOLD)` → the flyer
     itself (not a copy) is handed to `useDiscardExit.send`, with `node: elOf('draw')` and
     `scatter: scatterAt(d.reveal.discardId)` — the same scatter the heap rests the card on (**I7**)
     — then `drop('draw')`.
3. The loop is serial, one `PlannedDraw` after another; each fully resolves (including a trigger's
   reveal and exit) before the next card starts its own flight to the centre.

**Params & timings**
| Step | Preset / wait | Duration |
|---|---|---|
| pile → centre | `drawToCenter` | 480 ms |
| stand before flipping | `wait(BEFORE_FLIP)` | 220 ms |
| flip settle | `wait(AFTER_FLIP)` | 560 ms |
| a trigger's stand at the centre | `wait(TABLE_HOLD)` | 2600 ms — imported from `features/board-beats/toCentre.ts`, the same constant the AI recipe below holds its own pair on (there doubled, `HALLUCINATION_HOLD`, for `ai-hallucination`; this branch never sees that card, so it never doubles) |
| own card → hand | `useHandArrival` | `FLIGHT_MS = 480` |
| trigger → discard | `useDiscardExit` | `FLIGHT_MS = 420`, on `scatterAt(discardId)` |
| opponent's card → seat | `dealToSeat` | 460 ms, `to = cardBoxIn(seat, CARD_W * 0.7)` |

**Invariants**
- **I1** — `planBeats` reads `before`, the projection still on screen, so the source pile's slot is
  there to measure.
- **I2** — the carrier paints the flyer at its source before the flight starts.
- **I4** — the flyer is pinned at the centre after `drawToCenter`; every branch (flip, hold, seat
  flight, discard exit) leaves from where it visibly stands rather than from a re-measured rect.
- **I7** — the trigger's exit uses `scatterAt(discardId)`, the same call the heap rests the card on:
  the handover from flyer to heap changes nothing on screen.
- **I8** — the fan grows inside the batch. `useHandArrival`'s `onLanded` callback writes the new hand
  back into `ctx.base` and publishes it, so the next card in the same batch aims at the fan the
  previous one actually grew, not the one the batch started with.

**End state & cleanup**
Own card: spliced into the hand at the arrival gap. Opponent's: `handCount + 1`, published. Trigger:
gone from the centre, resting in the discard heap at `scatterAt(discardId)`. The flyer is dropped in
every branch; nothing outlives the beat.

**Gating**
None beyond the queue's own exclusivity. A draw is not a decision waiting on the player — the fan
stays live and the beat simply runs its course.

**Under `prefers-reduced-motion`**
The beat is never planned and never runs; `useBeats` renders the projection it already holds.

**Building blocks**
[`drawToCenter`](./reference.md#presets) · [`dealToSeat`](./reference.md#presets) · `flipCard` (auto,
via `Card`) · [`useHandArrival`](./reference.md#hand-arrival--cards-arrive-in-the-hand) ·
[`useDiscardExit`](./reference.md#the-movement-steps-and-the-carrier-under-them) ·
[`useFlyer`](./reference.md#the-movement-steps-and-the-carrier-under-them) ·
[`cardAreaOf`/`cardBoxIn`](./reference.md#card-geometry-helpers) · [`scatterAt`](./reference.md#discard-scatter).

**Live reference**
`Draw card` — `apps/playground/stories/interactive/DrawCardStory.tsx`. Not a playground scene itself
— this beat runs on the real board (`apps/frontend/src/features/board-beats/drawBeat.tsx`).

---

## The deck is rebuilt, split, merged (live board)

Driven by `deckReshuffled` and `pilesChanged`, planned by `planBeats` and run by `deckBeat`
(`useDeckBeat`). What happens to the draw piles themselves — none of it carries a card whose face
anybody sees, because a pile is face down before and after: what moves is the pile.

**When to call**
Never directly. `useBeats` plans a `reshuffle` beat from a `deckReshuffled` event, and a `piles` beat
carrying a list of `PileStep`s from the `pilesChanged` events in a batch — Git Branch + Sudo emits
**two** in one batch, and each is classified against the pile counts as they stand after the previous
one, not against `before`.

**Visual result**
The scattered discard gathers into a pile and flies onto a draw pile, flipping face down on landing
(`deckReshuffled`, and the discard-becomes-a-pile half of Git Branch + Sudo). A pile splits — a new
pile slides out from the source pile's spot to its own place (`flyFrom` FLIP). Piles merge — every
pile but the survivor (and, with Sudo, the gathered discard) flies into it and dissolves
(`absorbToDeck`).

**Elements / refs** — all from `BoardAnchors`
- `pileBox(index)` — a draw pile's card box, both as a flight's source and its target.
- `discardBox` — the discard's own spot, source of the reshuffle/fromDiscard movement.

**Sequence**
1. **`deckReshuffled` → `runReshuffle`**: `discardOntoPile(0, ctx.base.decks.discard)` — the recycled
   discard always lands on pile 0 (`refillFromDiscard` only runs when every pile is empty and
   replaces `main` with a single one). Raise a flyer at the discard's top card, `wait(GATHER_MS)`,
   `play('gatherToDeck', …, { duration: 560 })` to the pile, `wait(STEP_HOLD)`, `patch('pile', {
   faceDown: true })`, `wait(TURN_MS)`, `drop('pile')`.
2. **`pilesChanged` → `runPiles`**: for each `PileStep` in order, run `step(s, ctx)` then
   `wait(STEP_HOLD)` before the next.
   - **`merge`**: measure the survivor's rect (`pileBox(0)`) once; every other pile in
     `ctx.base.decks.main`, and the discard if `s.withDiscard`, plays `absorbToDeck` in parallel from
     its own rect into the survivor's; `await Promise.all(…)`; **then** `advance(ctx, s.piles)` —
     the shadow only updates once the flights have actually landed.
   - **`split`**: measure the source pile's rect (`pileBox(s.at)`) **before** anything moves;
     `advance(ctx, s.piles)` publishes the grown row immediately (I1 — mount before measure-from);
     `await nextFrames()`; `play('flyFrom', pileBox(s.at + 1), { from, duration: SPLIT_MS })` — the
     new pile is already in its final DOM place and animates *from* the source's old rect.
   - **`fromDiscard`**: read the discard's top card **before** publishing (`ctx.base.decks.discard`);
     `advance(ctx, s.piles)`; `await nextFrames()`; `discardOntoPile(s.at, top)` — the same movement
     `deckReshuffled` uses, aimed at the new pile's index instead of 0.

**What the classification derives** (`classifyPiles`, `planBeats.ts` — the engine's own event names
none of this; see `docs/animations/backlog.md`):

| before → after | operation | movement |
|---|---|---|
| `before[i] === after[i] + after[i+1]`, length +1 | split at `i` | `flyFrom` FLIP: the new pile is already in its DOM place and animates *from* the source pile's rect |
| `after.length === 1`, sum preserved | merge | every other pile runs `absorbToDeck` in parallel into the survivor's rect, measured once |
| a pile appended at the end, discard emptied | Git Branch + Sudo's second step | the reshuffle movement, into the new pile's spot |
| `after` is `before` minus its zeros | prune | nothing plays — an empty pile ceasing to exist has nothing to move |

**The implemented classifier never returns a `prune` step.** `classifyPiles` returns `null` for that
row — a pile that ran out has nothing on screen to animate away, so there is no `PileStep` variant
for it at all; the running pile count still advances past it (`planBeats` keeps classifying the
*next* `pilesChanged` against the table as it now stands), but nothing is queued to play. This is a
design choice made in code, not a gap: the table above documents the shape of the derivation, the
implementation only emits a `PileStep` where there is something to fly.

**`advance()`'s write-back is load-bearing only for `merge`.** It sets `ctx.base.decks.main` and
publishes it, and the `merge` branch reads `ctx.base.decks.main.length` back out to know how many
piles to absorb. For `split` and `fromDiscard` the `PileStep` already carries its own resolved
`piles`/`at` — `classifyPiles` did that work up front in `planBeats`, against its own running
counter, independent of what `deckBeat` publishes — so the write-back there only drives what renders
on screen, never what the next step does.

**Params & timings**
| Step | Preset / wait | Duration |
|---|---|---|
| gather the scatter | `wait(GATHER_MS)` | 360 ms |
| discard → pile (reshuffle / fromDiscard) | `gatherToDeck` | 560 ms (explicit) |
| flip back-up on landing | `wait(TURN_MS)` | 460 ms |
| new pile fly-out (split) | `flyFrom` | `SPLIT_MS = 520` |
| every pile → survivor (merge) | `absorbToDeck` | `MERGE_MS = 520` |
| between deck steps | `wait(STEP_HOLD)` | 360 ms |

**Invariants**
- **I1** — `split` measures the source pile's rect before `advance()` publishes the grown row, and
  only flies `flyFrom` after `nextFrames()` lets the new pile paint at its final place.
- **I2** — `nextFrames()` before both `split`'s and `fromDiscard`'s flights, so the newly published
  pile has a frame to exist in before anything measures or animates it.
- Local — a `piles` beat can carry more than one step (Git Branch + Sudo): each is run and settled
  (`wait(STEP_HOLD)`) before the next, against the table the previous one actually left.

**End state & cleanup**
The published `decks.main` matches `e.piles` for every step that ran; the discard is emptied by
whichever movement carried it. No state outlives the beat — every flyer is dropped inside the step
that raised it.

**Gating**
None. Like a discard, a deck change is a thing that *happened* on the projection already; only the
opening is `exclusive`.

**Under `prefers-reduced-motion`**
The beat is never planned and never runs; `useBeats` renders the projection it already holds.

**Building blocks**
[`gatherToDeck`](./reference.md#presets) · [`flyFrom`](./reference.md#presets) ·
[`absorbToDeck`](./reference.md#presets) · [`useFlyer`](./reference.md#the-movement-steps-and-the-carrier-under-them) ·
[`nextFrames`/`wait`](./reference.md#travel-and-timing-helpers).

**Live reference**
`Deck animations` — `apps/playground/stories/interactive/DeckAnimationsStory.tsx`. Not a playground
scene itself — this beat runs on the real board (`apps/frontend/src/features/board-beats/deckBeat.tsx`).

---

## Playing a combo (pair) — support pulled, partner folds in, then the board's own beat

> **Shipped shape (#100).** The gesture below is the ported, engine-fed form of ComboStory's own
> `pickPartner`/`cancelStage` (`_useBoardStaging.ts`) — `state.comboOptions` (the projection's
> `PlayerView.self.combos`) stands in for ComboStory's mocked `validComboTarget`, and the fan's own
> geometry stands in for its local `refs`. The **beat** ("The beat", below) is new: a separate,
> event-driven runner (`features/board-beats/comboBeat.tsx`) that plays the same fold for an
> opponent's combo, and splits the pending pair back to the discard at resolution.

**When to call**
- **Pull** (`onHandPlay`, guard `if (!enabled || staged) return false`): a card with a target of its
  own stages a plain aim (see "Targeted arrow attack") — a card with NO target of its own but a
  non-empty `state.comboOptions[uid]` stages the pair's first half instead: `support` set, `phase:
  'partner'`, the arrow armed from the centre exactly as a plain aim's is (`aimFromCentre`), and
  every partner still in the fan lit in the support's own category colour (`accentAt` — ComboStory's
  "the TYPE is the message").
- **Pick a partner** (`onCardClick`, guard `phase === 'partner'`, refused while a cancel or a fold is
  already in flight): not in `state.comboOptions[support.uid]` → `cancel()`, the whole staging
  returns to the fan. A hit commits the fold (`merged: true`) and sets `foldingRef.current = true` —
  irrevocable from here (ComboStory's own `playing`): neither `cancel()` nor a second click on
  another candidate is honoured again until the fold's own `finish()` (or one of its early bails)
  clears the flag.
- **After the fold** (`finish()`), by partner kind: a window already covers it →
  `onAttack(main.uid, support.uid)` at once; the partner still needs a target → `phase: 'target'`,
  re-aim; else (a release) → `onPlay(main.uid, undefined, support.uid)`.

**Visual result**
Pulling the support stands it alone at the centre and arms the arrow; every legal partner lights in
the support's own category colour. Clicking one folds the two together — the partner travels in
from its own fan slot, the support stays put — and the merged pair immediately either dispatches
into an open window, aims for a target, or plays straight through to a release slot. From there the
beat takes the pair the rest of the way: resting as the pending exchange at the centre, or settling
into the release zone.

**Elements / refs**
- `anchors.centre` — the merge target, the same node the plain-aim recipe stages onto.
- `state.comboOptions[uid]` — the engine's own legal-partner list (`PlayerView.self.combos`, keyed
  support-first), replacing ComboStory's mocked `validComboTarget` (`mockLegality.ts`, its functions
  retired from the board, kept only to run the playground story).
- `slotBox(index, total)` — the partner's own FAN geometry, not a slot's rotated bounding rect
  (**I6**) — `anchors.hand`'s rect + `slotPlacement`, standing in for ComboStory's `refs[uid]`.
- `pairRef` — the persistent pair-flyer node `_Board.tsx` mounts (`data-testid="board-pair-staged"`);
  `CardPair` renders inside it only once `staged.merged`, painted frame by frame on its
  `[data-main]` / `[data-aux]` children — the same idiom as ComboStory's own `flyRef`.
- `foldingRef` — true from the click that commits the fold until `finish()` (or an early bail)
  clears it in a `finally`; `cancel()` and a second `onCardClick` both refuse while it holds.
- `StagedHandoff` (`entities/game/board/types.ts`) — the seam to the beat: `mainUid`, `supportUid?`,
  the DOM node the staged play already stands on (`pairRef` once merged, else the solo staged node),
  and `release()` — the hook's own no-flight clear.

**Sequence** (`onCardClick`, once a support already stands at the centre)
1. Validate the click against `state.comboOptions[support.uid]`; a miss calls `cancel()` and stops.
2. Measure — **[I1]**: `mainHand = slotBox(index, handItems.length)`, `cRect = anchors.centre`.
3. `arrowCtl.stop()` — the choice is made; commit `{ support, main, phase: 'partner', merged: true }`;
   `foldingRef.current = true`.
4. Reduced motion (or no fan geometry to fold from): pin `pairRef`'s `left/top/width/opacity` to
   `cRect` directly and call `finish()` at once — `CardPair`'s own inline pose (main identity, aux
   `PAIR_AUX_POSE`) already IS the pair at rest, nothing to paint frame by frame.
5. Otherwise: `await nextFrames()` — **[I2]**, the just-mounted `CardPair` has painted. Cancel
   leftover animations on `pairRef` (`getAnimations({ subtree: true })`) — **[I3]**. Pin `pairRef` to
   `cRect`; paint the first frame with `enterPose(mainHand, cRect)` on `[data-main]` and
   `enterPose(cRect, cRect)` on `[data-aux]` — the support's own entry pose is the degenerate
   identity case (it is already at the centre), no separate branch. `await nextFrames()` again.
6. **The fold** — `play('foldIntoPair', mainEl, { from: mainHand, box: cRect, dur: 620 })` and
   `play('foldIntoPair', auxEl, { from: cRect, box: cRect, pose: PAIR_AUX_POSE, dur: 620, snap: true })`
   in parallel; `await Promise.all([a1?.finished, a2?.finished])`.

   > **Steps 5–6 are now a step of their own: `usePairFold`.** The scenes call it (Combo, Defense
   > Release); the board still carries this hand-written version in three places, and replacing them
   > is a call, not a rewrite. The step also mounts the pair invisible and reveals it in the same
   > tick the entry poses are set, which is what the flyer form cannot do — `raise` waits for a paint
   > before it hands the node back, so the pair shows up already folded for a frame or two.
7. `finish()` — wrapped in `try`/`finally` so every exit clears `foldingRef`, not only this one —
   branches on the partner: a window names it → `phase: 'dispatched'`, `onAttack(main.uid,
   support.uid)`; it still has its own targets → `phase: 'target'`, re-aim from the centre; else (a
   release) → `phase: 'dispatched'`, `onPlay(main.uid, undefined, support.uid)`.

Staging's own job ends here — there is no `PAIR_HOLD`-style wait the way ComboStory holds the
assembled pair for 2100 ms; the beat owns everything from the dispatch onward.

**Cancel, at any stage before the fold commits**
A lone support (`phase: 'partner'`, not yet merged) returns the single-card way the plain-aim recipe
already does. A committed pair returns as ComboStory's `cancelStage` does: both halves fly off
`pairRef` in one `useHandArrival.arrive` call (`anchor: 'aux' | 'main'`), landing at the support's
own pull-time index sized for both — one group, the fan settling to projection order once `staged`
clears.

**The beat — `attacked` / `released(codeReview)` / the resolution split (`features/board-beats/comboBeat.tsx`)**
What happens once the engine answers is a separate, event-driven beat — it also plays an opponent's
combo, or a local window attack that staged nothing at all.
- **`attackPlaced`**, planned from every `attacked` (sudo or not — a plain attack is this same
  runner's aux-less degenerate case, no separate branch): `runAttack` reads the staging→beat handoff
  SYNCHRONOUSLY, before its first `await` — the actor's OWN play is already standing exactly where
  the pending render takes over, so nothing moves; it calls `handoff.release()` and hands the table
  back. Anyone else's attack folds the pair in fresh via `foldIn` — a second, beat-side
  implementation of the same steps as the gesture's own fold above (raise a carrier at the centre via
  `useFlyer`, paint both halves at their source with `enterPose`, `await nextFrames()` — **I2** —
  then `foldIntoPair` per half from the actor's seat or the hand slot a local thrower's card left) —
  and settles at the centre pending, `[data-pending-play]`, upgraded from a lone card to a `CardPair`
  under `pending.sudo`.

  Letting go of whatever held the attack is safe only because that static render takes the card over
  on the same commit. When the throw and its answer arrive in ONE sync flush, `base` predates the
  batch and carries no pending, so there is nothing to take over — so the beat **publishes** the
  table it just made (`pending: defend`), which `useBeats` renders as the shadow and hands on as the
  next beat's base. One publish for every seat, before the carrier lets go, and that includes the
  actor's own arm above: on a slow link, a rejoin or a replay the ATTACKER gets both events in one
  batch too, and Fix C's version returned from that arm before ever reaching the publish, so their
  own attack blinked out (#101, Fix D). Never published when the answer is ours to give: `options`
  is redacted for everyone but the owner, so an empty one would tell our own board a defence is owed
  with no legal card to give it. And never over a pending already standing, of any kind — the
  publish spreads `base`, so a narrower guard would replace a real pending with a fabricated one.
  **The defender's corner is settled by an answer, and the answer is that there is no corner** (rules
  owner, 22.08.2026): when someone attacks someone, the cards played to the centre are seen by
  EVERYONE — it is a public action, and there is nothing to defend with against a card you cannot
  see. The hiding was never intended; it fell out of the SHAPE, because the shadow is published as a
  PENDING and a pending carries the legal-card list the engine redacts per viewer. What closes it is
  splitting the two meanings: "a card lies on the table" — public, identical for everyone, read only
  by the centre render; "a decision is owed by you" — private, with its options and its clock, read
  by the dock and the gestures. The fabricated `0s` clock goes with it: a shape that carries no clock
  cannot publish a false one. In [`backlog.md`](./backlog.md) and the register.
- **`releasePlaced`**, planned from every `released` event — widened from `codeReview`-only (Task 11,
  #101): a plain release now runs the same beat, and the beat also carries the release's own cost leg
  (see "Defending a release" below for the cost, board-side). Three origins, because a release has
  three places it can be standing when the engine answers:
  - the actor's own **Code Review combo** — the merged pair is at the **centre**, on the staging
    gesture's own persistent pair flyer. `runRelease` reads the handoff SYNCHRONOUSLY (same race,
    same fix as `runAttack`) and flies **that node** `playToReleaseZone` from the centre to the slot.
  - the actor's own **plain release** — it has been standing at the **stage slot** since it was
    pulled, all through its own cost step. The beat measures `anchors.stage`, raises a carrier there
    and flies it home; there is nothing to fold. Not through the handoff: a plain release never
    merges, so it never gets the pair flyer's node, and `_Board.tsx`'s `soloStaged` excludes a
    release from the centre render on purpose — `handoff.el` is null for it, and the catch-up effect
    clears the handoff outright once the cost pending echoes back. Not through `foldIn` either: the
    release is still in `you.hand` while that pending is open (the engine's release path emits
    nothing and touches no hand) but the fan does **not** render it, so a hand-index lookup aims at
    another card's slot — or, when the release was last in hand, at no slot at all (`seatBox` is
    null for the local player). Fixed in #101, Fix A.
  - **anyone else's** — folds in from their seat via `foldIn` first, then flies.

  The static stage-slot render is released in the **same commit** the carrier goes up
  (`takeStagedRelease` → `_useBoardStaging.ts`'s `StageState`, which moves from `standing` to
  `leaving`): the `before` projection the beat renders still carries the cost pending, so without it
  the card would be on screen twice for the whole flight. The landing pose is `ReleaseZone`'s own
  static render — the beat's last frame IS the projection.

- **`pairToDiscard`**, planned from the resolution's `discarded` pair. What "the pending exchange"
  MEANS to the planner is the attack as the WALK sees it, not as the board saw it before the batch:
  `planBeats` carries an `openAttack` that starts at `before.pending` and that every `attacked` moves
  on — the same shape `piles` has always had for the deck counts. Without it a one-flush batch built
  no `covered` and no `pairToDiscard` at all, and the exchange's cards fell through to the ordinary
  discard routing, flying out of the attacker's SEAT instead of off the centre. In a star topology
  that batch is the ordinary case for every watching peer.

  On that exchange `planBeats` matches its two halves — sudo-first, since a sudo Rollback banks only
  the sudo half — ahead
  of the ordinary discard routing (the centre is in no hand and no zone, so `sourceOf` would never
  find it there). `runPairOut` measures `[data-pending-play]` and hands `useDiscardExit` one
  `Leaving` with `aux` set: the pair splits into two singles, the aux riding its own `auxScatter`
  (`scatterAt` of its own `discarded` event — **I7** — the main's `scatter` alone only ever reached
  the main card; without this the aux would fly to a random `jitter()` and snap to its true rest the
  instant the heap took over).

**Params & timings**
| Step | Preset / animation | Duration | Easing |
|---|---|---|---|
| fold — main half | `foldIntoPair` | 620 ms | EASE → its `enterPose` origin to identity |
| fold — aux half | `foldIntoPair` (`snap`) | 620 ms | LAND → `PAIR_AUX_POSE` |
| release → zone | `playToReleaseZone` | 480 ms | LAND |
| discard (per half) | `useDiscardExit` | 420 ms | EASE + `scatterAt` / `auxScatter` |

**Invariants**
- **I1** measure the fan slot and the centre before mutating anything, in both the gesture's fold and
  the beat's `foldIn`. **I2** `nextFrames()` after mounting/painting the pair's first frame, in both
  places too. **I3** cancel subtree animations on the reused `pairRef` node before repositioning it.
  **I6** the partner's box comes from the fan's own geometry (`slotBox`), not a rotated slot rect.
  **I7** the aux half's discard flight and the heap's own rest for it share one scatter
  (`auxScatter`), never a fresh `jitter()`. **I8** the staging→beat handoff is read synchronously,
  before the beat's first `await` — reading it one line later, after `nextFrames()`, loses a race
  against `_useBoardStaging`'s own passive hand-watching effect, which would otherwise fold the
  actor's own play in a SECOND time from a hand slot it already left (found empirically; pinned by
  `comboHandoff.test.tsx`).
- The pair flyer (`pairRef`) is a **persistent** node, opacity/position toggled rather than remounted
  per fold — the same reason `foldIntoPair` is a per-half call, not a move of the whole pair. Since
  the fold became the `usePairFold` step, this hand-written form is one of the three copies the board
  still carries: the step mounts its own node and reveals it in the tick the entry poses are set,
  which is exactly what the persistent node was buying here.
- The discard holds **singles**: the pending pair reaches it as **two** entries, split by
  `runPairOut`.

**End state & cleanup**
Dispatched and adopted by the board: `staged` clears via `handoff.release()`, no flight at all.
Folded in from elsewhere: the pair rests at `[data-pending-play]` (an attack) or in the
`ReleaseZone`'s support slot (a release) — the beat's last frame is the projection either way.
Resolved: two `DiscardEntry`s land in the heap; `[data-pending-play]` is gone.

**Under `prefers-reduced-motion`**
The gesture places the standing card(s) instantly (step 4 above). The beat is never planned and
never runs (`useBeats`'s own blanket `if (reduced) return`); the board renders the projection it
already holds.

**Recorded and since closed**
A cancelled pair returning both halves through one fan gap was filed as a finding. It is not one:
the rules owner settled that **there is no cancel-a-folded-pair case at all** — the moment the second
card is taken for a combo, the pair is played. What the finding was reaching for — two cards going
into the hand each into its own slot — is a different movement, and it already works: `useHandArrival`
opens `gapSize` gaps and flies each card to `slotPlacement(gap + i, total)`, its own slot with its own
angle. The showcase is the `Card to Hand` page, and it was checked there. See
[`backlog.md`](./backlog.md).

(The sudo-Rollback return this section used to flag as having no movement on the board at all — Wave
3, #101 — is now built: see "Defending a release" below for the exchange itself, and `backlog.md` for
the one gap that survives it — the return's recipient is derived rather than read off an event.)

**Building blocks**
[`foldIntoPair`](./reference.md#presets) · [`playToReleaseZone`](./reference.md#presets) ·
[`enterPose`](./reference.md#presets) ·
[`useDiscardExit`](./reference.md#the-movement-steps-and-the-carrier-under-them) ·
[`scatterAt`](./reference.md#discard-scatter) ·
[`planBeats`/`useBeats`/`BoardAnchors`](./reference.md#the-boards-layer--anchors-and-the-beat-queue) ·
[`nextFrames()`](./reference.md#travel-and-timing-helpers) ·
[`useArrow`/`centerOf`](./reference.md#arrow-toolkit) · `CardPair`, `PAIR_AUX_POSE`.

**Live reference**
`Combo` — `apps/playground/stories/ComboStory/ComboStory.tsx`, the design-exploration scene the fold
was ported from verbatim — no engine behind it. The shipped gesture and beat run on the real board:
`apps/frontend/src/pages/board/[gameId]/_useBoardStaging.ts` (the pull/fold) and
`apps/frontend/src/features/board-beats/comboBeat.tsx` (the beat).

---

## Targeted arrow attack — aim from a card, track the cursor, light the target

**When to call**
The player arms a targeting arrow by clicking a source card (`arm`): `aim(centerOf(el), { x: e.clientX, y: e.clientY })`,
`setArmed(card)`. Used when a card needs a target (an attack, or the combo `target` phase). Cancel:
a `window` mousedown while `active` → `setArmed(null)`, `setHovered(null)`, `stop()`.

**Visual result**
A quadratic-Bézier arrow in the card's category color springs from the card's center and follows
the cursor; hovering a target zone lights it in the same color; clicking empty space cancels.

**Elements / refs**
- `refs[card.id]` — the source card spot (arrow origin via `centerOf`).
- `useArrow()` → `{ from, to, active, aim, stop }` — holds endpoints, tracks the cursor while active.
- Target zones: `lit = active && hovered === id`, highlighted via `--hl: color`.

**Sequence**
1. `arm(e, card)`: `aim(centerOf(refs[card.id]), { x: e.clientX, y: e.clientY })` — sets `from`, seeds
   `to` at the cursor, `active = true`; `setArmed(card)`.
2. While `active`, `useArrow` adds a `mousemove` listener that sets `to = { clientX, clientY }` each
   move — the arrow tail follows the cursor.
3. Target zone `onMouseEnter` (only if `active`) → `setHovered(id)`; `onMouseLeave` clears it. A `lit`
   zone gets `--hl: color`.
4. Confirm/cancel is the **consumer's** call: here a `window` mousedown cancels; in `ComboStory` the
   target click runs `runPlay`. `stop()` clears `from/to/active`.

**Params & timings**
- No timed flight — a live-tracked SVG overlay. `color = var(--cat-${armed.category})` (else `--brand-green`).
- Arrow geometry (in `Arrow`): quadratic Bézier, control point offset `min(len * 0.2, 130)` on the
  perpendicular, always bowing upward; arrowhead angled to the curve tangent.

**Invariants**
- None of I1–I8 apply (no flyer/flight). Local: endpoints are **viewport** coords (`clientX/Y`), the
  same space as `centerOf`.

**End state & cleanup**
- On `stop()`: `from = to = null`, `active = false`; the `Arrow` unmounts (`{active && <Arrow … />}`).

**Building blocks**
[`useArrow` / `centerOf`](./reference.md#arrow-toolkit) · [`Arrow`](./reference.md#arrow-toolkit).

**Live reference**
`Arrow` — `apps/playground/stories/ArrowStory/ArrowStory.tsx` (and the `target` phase of `ComboStory`).

---

## Cards arrive in the hand (`useHandArrival`)

**When to call**
Wherever a card ends up in the player's hand — a draw, a card taken from an opponent, a card pulled
out of the discard, a play taken back. Standalone trigger (showcase, the `Card to Hand` page): click
a source card, or the pair example, → `arrive(items, hand.length)`.

**Visual result**
The fan opens a gap in its MIDDLE — as wide as the number of arriving cards; they fly from their
source spots into that gap, scaling to the hand-card size and rotating to their slots' angles; they
ride above the fan briefly, then tuck under it and land at their slots' bottom-centre.

**Elements / refs**
- `handRef` — the `Hand` fan container (the step measures it and reads `@/table/Hand/fan` geometry).
- the source spots (the flight origins), whichever they are.
- `useHandArrival(handRef, onLanded)` → `{ overlay, gapAt, gapSize, arrive, reset, busy, FLIGHT_MS }`.
- `Hand` gets BOTH `gapAt` and `gapSize` — a gap of one is the default, and a two-card arrival into a
  gap of one lands two cards on the same slot.

**Sequence** (`arrive(items, handLength, at?)`, inside the step)
1. Guard `if (flights.length) return`. `gap = at ?? round(handLength / 2)`, clamped to the hand;
   `total = handLength + items.length`; card `i` aims at `slotPlacement(gap + i, total)`.
   **The middle is for an ARRIVAL, `at` is for a PLACEMENT.** A draw has no place of its own, so the
   middle is honest and a draw and an undo read as one event. A card the player DRAGGED into the fan
   has a place — the slot the pointer named — and landing it in the middle throws that away.
2. Measure the hand rect `hr` — **[I1]**. Each card's source is resolved in one of three ways: its
   `from` rect; the element it IS (`el` — measured, then taken off screen for the flight); or one half
   of a pair (`el` + `anchor`, whose tilted bbox is trimmed with `cardBoxIn` — **[I6]**).
3. A source resting at a tilt (`rot`) is mounted with the pivot difference compensated: the slot
   pivots on its bottom centre, a tilted card rests on its own centre, and without the shift the very
   first frame jumps by ~`h/2·sin(rot)`.
4. The flight is built from `insertPath(fromPt, toPt, gap + i, total)` (reference) — the fan's own rule
   for being entered, so a card drawn from the deck and a card carried back off the table come into
   the fan the same way. Both points are the card's **bottom centre** (the pivot it turns and scales
   about); each position becomes a pose — translate along the path, `rot → place.rotate`, `scale 1 →
   CARD_W / source.width`.
5. `setFlights(list)`; `setGapAt(gap)` — the fan starts opening WHILE the cards travel; **double-rAF**
   — **[I2]** → the poses are played on each flyer node (`FLIGHT_MS`, `FLIGHT_EASE`, `fill: forwards`);
   a `START_HIGH_MS` timer → `tucked = true`, and each overlay div's
   `zIndex = tucked ? place.z : 'var(--z-flight)'`.
6. After `FLIGHT_MS`: `onLanded(gap, landed)` — the step hands back WHAT arrived (each entry's `key`
   is the card's uid), the scene splices its own items at `gap` — then `reset()`. Closing the gap and
   adding the cards is the same layout, so nothing shifts on the last frame.

**Params & timings**
| Aspect | Value |
|---|---|
| flight | the `insertPath` positions played on the flyer node, `FLIGHT_MS = 480` at `FLIGHT_EASE` (= `--ease-soft`) |
| travel-layer hold | `START_HIGH_MS = 140` (then z drops from `var(--z-flight)` to the slot's z) |
| target size | `scale = CARD_W / source.width` (`CARD_W = 150`, the fan's card width) |
| slot | `slotPlacement(gap + i, handLength + items.length)` from `@/table/Hand/fan` |

**Invariants**
- **I1** measure the hand rect (and the sources) before starting. **I2** double-rAF before flipping
  `started`, or the overlay jumps from its origin. **I6** a tilted half is trimmed to a card box.
- **I8** do not read the scene's staging on landing — it is cleared the moment the flight starts (or
  the cards would be drawn twice); that is why the step hands back what arrived.
- Local: this is **not a `play()` preset** — the flight is WAAPI keyframes built from `insertPath`,
  because a curve is not something a transition can draw. The gap and the flight are one coordinated
  move — the fan must render `handLength + items.length` slots so the landing slots exist.
- A card enters the fan **by the fan's rule**, not by this step's own: being inserted between two
  cards is one situation, whether the card came off the deck or out of the player's hand.

**End state & cleanup**
- `onLanded` splices the cards into `hand` at `gap`; the step resets (`gapAt = null`, flights cleared).
  The fan is whole again with the new cards.

**Building blocks**
[`useHandArrival`](./reference.md#hand-arrival--cards-arrive-in-the-hand) (**playground-local** — see
the README "Current state" note) · `@/table/Hand/fan` (`slotPlacement`, `insertPath`, `CARD_W`) ·
`Hand` (renders `gapAt` + `gapSize`).

**Live reference.** `Card to Hand` — a single card, and a Release with the Code Review laid with it
arriving together.

---

## Drawing a card (single) — deck → center (back-up) → player / opponent / trigger

**When to call**
Player clicks a draw deck → `draw(deckIndex)`. Guard `if (busy || !nextCard) return`; `setBusy(true)`;
clear `centerCard/aiCard/alert`; `await drawOne(nextCard, deckIndex)`; `setBusy(false)`. `nextCard` is
the forced selection (`resolveForced(forced)`).

**Visual result**
A back-up card lifts from the clicked deck to the staging spot (the center, or the left "cause" slot
for an AI trigger), flips face up, then: a player's card flips and settles into the hand; an
opponent's sinks back-up into their seat; a trigger stays revealed at the center.

**Elements / refs**
- `deckRefs[i]` — draw-deck cells (source). `centerRef` — staging; `causeRef` — AI-trigger staging (left).
- `seatRefs[oppId]` — opponent seats. `handRef` — the player fan (via `useHandArrival`). `discardRef`, `aiRef`.
- `flyerRef` — the flyer, **keyed by `seq`** (`flightSeq`). State: `flyer {card, faceDown, seq}`, `centerCard`, `busy`.

**Sequence** (`drawOne(card, deckIndex)` → `boolean` "can continue")
1. `isAi = card.id === AI_TRIGGER`; `deckCell = deckRefs[deckIndex]`; `stageRect = (isAi ? causeRef : centerRef)` rect.
2. `setFlyer({ card, faceDown: true, seq: ++flightSeq })` — **[I5]**; `await nextFrames()` — **[I2]**.
3. `from = cardAreaOf(deckCell)` — **[I6]**; position the flyer at `from`; `play('drawToCenter', el, { from, to: stageRect })`;
   await. Then **cancel + pin** to `stageRect` (identity) — **[I3][I4]** so the next flight starts here.
4. Branch on `card.category`:
   - **trigger** → `await revealForAll(card)`: `wait(220)` → `setFlyer(faceDown:false)` (the `Card` plays
     `flipCard`) → `wait(560)` (let the 420 flip play) → `setCenterCard(card)`; `setFlyer(null)`. Then AI
     vs Error 503 (separate recipes below).
   - **non-trigger, player** → `toPlayerHand(card)`: `wait(220)` → flip (`faceDown:false`) → `wait(560)` →
     measure the flyer rect → `setFlyer(null)` → `arrive([{ key: uid, card, from: rect }], hand.length)` (`useHandArrival`). returns `true`.
   - **non-trigger, opponent** → `toOpponent(drawer)`: `wait(160)` → `to = cardBoxIn(seatRect, fromRect.width * 0.7)` →
     `play('dealToSeat', el, { from: fromRect, to })` (fades in) → bump `handCount` → `setFlyer(null)`. returns `true`.

**Params & timings**
| Step | Preset | Duration | Note |
|---|---|---|---|
| deck → staging | `drawToCenter` | 480 ms | back-up; `from = cardAreaOf(deckCell)` |
| flip reveal | `flipCard` (auto, on `faceDown` change) | 420 ms | JS waits `220 + 560` around it |
| player → hand | `useHandArrival` | `FLIGHT_MS = 480` | see the hand-insert reference entry |
| opponent → seat | `dealToSeat` | 460 ms | +fade; `to = cardBoxIn(seat, w*0.7)` |

**Invariants**
- **I2** `nextFrames` before the flight. **I3/I4** cancel + pin the flyer after `drawToCenter` (identity)
  so the next leg starts from where it visually is. **I5** `key={seq}` on the flyer — a new flight is a
  fresh `Card`, so the `faceDown` flip doesn't spin mid-flight on a reused node. **I6** aim at the deck's
  card area. **I8** the card travels as an argument through the async chain.
- Local: `revealForAll`/`toPlayerHand` **wait out the flip** (`220`/`560`) — a deliberate cascade around
  the `Card`'s auto-`flipCard`.

**End state & cleanup**
- Player: card inserted at `gap` (via the `onLanded` splice); flyer gone. Opponent: `handCount+1`; flyer gone.
  Trigger: `centerCard = card` stays; flyer gone.

**Building blocks**
[`drawToCenter`](./reference.md#presets) · [`dealToSeat`](./reference.md#presets) · `flipCard` (auto) ·
[`useHandArrival`](./reference.md#hand-arrival--cards-arrive-in-the-hand) · [`cardAreaOf`/`cardBoxIn`](./reference.md#card-geometry-helpers) ·
[`nextFrames`/`wait`](./reference.md#travel-and-timing-helpers).

**Live reference**
`Draw card` — `apps/playground/stories/interactive/DrawCardStory.tsx`.

---

## Multi-draw — one card per deck, in turn; a trigger can stop the batch

**When to call**
The "draw" button → `drawBatch()`. Guard `if (busy) return`; `setBusy(true)`; clear `centerCard/aiCard/alert`.

**Visual result**
For N decks, cards are drawn one per deck in sequence (each through the single-draw scenario). The forced
card appears at the chosen "queue" position; the rest are random non-trigger cards. An unresolved trigger
(Error 503) stops the run.

**Sequence**
1. Build `seq: CardType[]` of length `deckCount`: position `i+1 === forcedAt` → `forcedCard ?? randomNonTrigger()`,
   else `randomNonTrigger()`.
2. `for (i in seq)`: `canContinue = await drawOne(seq[i], i)`; `if (!canContinue) break`.
3. `setBusy(false)`.

**Params & timings** — none of its own; each item runs the single-draw recipe. **Serial** (`await` per card), not parallel.

**Invariants**
- Inherits the single-draw invariants per card. **I8**: each `drawOne` gets its card + deck index as args — no state read mid-loop.
- Local: the loop is **serial** and **short-circuits** when `drawOne` returns `false` (an Error 503 trigger).
  An AI trigger returns `true` (it plays out), so the batch continues.

**End state & cleanup**
- Hands/opponents/discard updated per drawn card; on an Error 503 the remaining decks are **not** drawn. `busy = false`.

**Building blocks**
The single-draw recipe (above) + `drawOne`'s `boolean` return.

**Live reference**
`Draw card` — the "draw" button (`deckCount > 1`).

---

## AI resolution — trigger → discard, effect → deck (after a table hold)

**When to call**
Inside `drawOne`, when the drawn trigger is the AI trigger: after `revealForAll`, `const eff = await drawAiEffect()`,
then `if (eff) await resolveAi(card, eff)`. `drawOne` returns `true` (the batch may continue).

**Visual result**
The AI trigger rests on the left as the "cause"; a larger effect card is drawn from the events deck to the
center. After a hold, both leave at once — the trigger scatters to the discard, the effect flips back-up in
place and returns to the events deck (staggered by its flip).

**Elements / refs**
- `causeRef` (trigger, left), `effectRef` (effect, center, larger), `aiRef` (events deck), `discardRef`.
- `outRefs.trig` / `outRefs.eff` — the leaving-card flyers (from `outs` state).

**Sequence**
- `drawAiEffect()`: `ai = resolveAiCard()`; `setFlyer({ card: ai, faceDown: true, seq: ++ })`; `nextFrames`;
  `from = cardAreaOf(aiRef)`; position; `play('drawToCenter', el, { from, to: effectRef rect })` (arrives
  enlarged); await; **cancel + pin** to `toRect` — **[I3][I4]**; `wait(160)`; flip (`faceDown:false`);
  `wait(560)`; `setAiCard(ai)`; `setFlyer(null)`; return `ai`.
- `resolveAi(trig, eff)` — cards passed as **args** — **[I8]**:
  1. `await wait(AI_HOLD)` (4000 — table hold while the effect is read).
  2. Measure `causeRect`, `effectRect`, `discardRect`, `aiDeckRect` — **[I1]**.
  3. `setOuts([{ key:'trig', card:trig, faceDown:false }, { key:'eff', card:eff, faceDown:false }])` (the static
     cards become flyers in their places); `setCenterCard(null)`; `setAiCard(null)`; `await nextFrames()` — **[I2]**.
  4. Position `outRefs.trig` at `causeRect`, `outRefs.eff` at `effectRect`.
  5. `await Promise.all([leaveTrigger(causeRect, discardRect), leaveEffect(effectRect, aiDeckRect)])`:
     - `leaveTrigger` → `play('centerToDiscard', outRefs.trig, { from, to: cardAreaOf(discardRect) })` — **no jitter** (the discard is a `Pile`, not a scatter).
     - `leaveEffect` → `setOuts(eff → faceDown:true)` (flip back-up in place) → `await wait(FLIP_MS)` (420, staggers it) → `play('returnToDeck', outRefs.eff, { from, to: cardAreaOf(aiDeckRect) })`.
  6. `setOuts([])`; `setDiscard({ top: trig, count+1 })`.

**Params & timings**
| Step | Preset | Duration |
|---|---|---|
| effect draw (enlarged) | `drawToCenter` | 480 ms |
| table hold | `wait(AI_HOLD)` | 4000 ms |
| trigger → discard | `centerToDiscard` | 420 ms |
| effect flip-in-place, then | `flipCard` + `wait(FLIP_MS)` | 420 ms |
| effect → events deck | `returnToDeck` | 480 ms |

**Invariants**
- **I1** measure all four rects up front. **I2** `nextFrames` after mounting the `outs` flyers. **I3/I4** pin
  the effect flyer after `drawToCenter`. **I8** `trig`/`eff` + rects passed as args, never read from state
  after the awaits.
- Local: both leave at once (`Promise.all`), the effect **staggered** by its `wait(FLIP_MS)` so the
  trajectories separate.

**End state & cleanup**
- `outs = []`; discard top = trigger, count+1; the effect is back in the events deck (visually). `drawOne` returns `true`.

**Building blocks**
[`drawToCenter`](./reference.md#presets) · [`centerToDiscard`](./reference.md#presets) ·
[`returnToDeck`](./reference.md#presets) · `flipCard` (auto) · [`cardAreaOf`](./reference.md#card-geometry-helpers) ·
[`wait`/`nextFrames`](./reference.md#travel-and-timing-helpers).

**Live reference**
`Draw card` — draw the AI trigger.

---

## Error 503 alarm — edge glow in the table zone

**When to call**
In `drawOne`, when the revealed trigger is Error 503 (a non-AI trigger): `setAlert(drawer === 'you' ? 'self' : 'other')`;
`return false` (resolution is game logic — no fixed scenario, so the batch stops).

**Visual result**
A red glow along the table edges. You drew → a **strong** glow **under** the hand; an opponent drew → a
**weak** glow **over** the hand (non-blocking). The glow is confined to the table zone (below the tech bar),
not the whole screen.

**Elements / refs**
- `EdgeGlow` inside `glowBounds` with `insetBlockStart: barH` (`barH = barRef.offsetHeight`, measured in `useLayoutEffect`).
- **DOM order matters:** the `strong` glow is placed **before** `<Hand>` (renders under it); the `weak` glow
  **after** `<Hand>` (over it, `pointer-events: none`).
- State: `alert: 'self' | 'other' | null`.

**Sequence**
1. The trigger reveal (see single-draw) leaves the Error 503 card at the center.
2. `setAlert('self' | 'other')`; `drawOne` returns `false`.
3. Render: `<EdgeGlow visible={alert==='self'} intensity="strong" />` (before Hand) and
   `<EdgeGlow visible={alert==='other'} intensity="weak" />` (after Hand).
4. Cleared on the next `draw` / `drawBatch` / `reset` (`setAlert(null)`).

**Params & timings** — no flight; `EdgeGlow` owns its own fade. `intensity`: `strong` (self) / `weak` (other).

**Invariants**
- None of I1–I8 (no flyer). Local: **DOM order = stacking** (strong under the hand, weak over it); the glow
  is scoped to the **table zone** via `glowBounds` + `barH`, not the viewport.

**End state & cleanup**
- `alert` stays until the next draw/reset; the batch does not continue past Error 503.

**Building blocks**
`EdgeGlow` (primitive) · `barH` layout measure.

**Live reference**
`Draw card` — set "will draw" = Error 503.

---

## Deck ops — the shared wrapper (`playSequence`)

The three deck operations below (split, merge, discard→deck) are the **effect** run inside one
wrapper: `playSequence(played, fromRect, effect)` — guard `busy`; `setBusy(true)`;
`setHand(remove played uids)`; `await flyHandToCenter(cards, fromRect)` (the `playToCenter` flight,
a single `Card` or a `CardPair` for a Sudo combo); `await effect()`; `await wait(CENTER_HOLD = 420)`;
`await sendToDiscard(cards)` — the shared step (each card a separate single, landing as its
own discard entry); `setBusy(false)`. The card is picked from the `Hand` fan; a deck target (Branch)
is chosen with a `useArrow` arrow. Only the **effect** differs per recipe.

---

## Splitting the deck (Git Branch) — new deck flies out via FLIP

**When to call**
Play a Git Branch card. If `decks.length <= 1` → `playSequence([item], rect, () => splitEffect(deckId))`
directly; otherwise arm `'branch'`, aim, and `pickDeck` runs `playSequence([branch], rect, () => splitEffect(id))`.
(Branch + Sudo → `enhancedBranchEffect`, see "Discard → new deck".)

**Visual result**
The played card flies hand → center and rests; the chosen deck splits — a new deck **slides out from
the source deck's spot** to its own place; then the card scatters to the discard.

**Elements / refs**
- `pileRefs[id]` — deck cells. `flip` ref — `{ id, from: DOMRect }` staged for the FLIP. Wrapper refs: `centerRef`, `discardRef`, `playFlyerRef`.

**Sequence**
- **Effect** `splitEffect(deckId)` → `split(deckId)`, then `await wait(SPLIT_MS + 150)`.
- **`split(id)`**: `half = floor(count/2)`; measure the source `el.getBoundingClientRect()` — **[I1]**; stage
  `flip.current = { id: newId, from: sourceRect }`; `setDecks` (source count − half; append `{ id: newId, count: half }`).
- **FLIP** (`useLayoutEffect` after the deck mounts): read `flip.current`, clear it,
  `play('flyFrom', pileRefs[newId], { from: sourceRect, duration: SPLIT_MS = 520 })` — the new deck
  (already at its final spot) animates **from** the source's old rect to identity.

**Params & timings**
| Step | Preset | Duration |
|---|---|---|
| card hand → center | `playToCenter` | 480 ms |
| new deck fly-out (FLIP) | `flyFrom` | `SPLIT_MS = 520` |
| effect settle | `wait(SPLIT_MS + 150)` | 670 ms |
| card center → discard | `centerToDiscard` | 420 ms + `jitter()` |

**Invariants**
- **I1** measure the source deck rect **before** `setDecks` (in `split`). The FLIP relies on that captured rect.
- Local: **FLIP pattern** — the new deck renders at its final DOM place first; `flyFrom` animates it *from*
  the previous rect. Measure→mount→animate is split across `split()` and the `useLayoutEffect` (runs before
  paint, so no flash).

**End state & cleanup**
- Two decks (source − half, new = half); the played card scattered into the discard; `busy = false`.

**Building blocks**
[`flyFrom`](./reference.md#presets) · [`playToCenter`](./reference.md#presets) ·
[`centerToDiscard`](./reference.md#presets) · [`jitter`/`nextFrames`/`wait`](./reference.md#travel-and-timing-helpers).

**Live reference**
`Deck animations` — play Git Branch.

---

## Merging decks (+ discard) — all decks absorb into the first

**When to call**
Play Git Merge with `decks.length >= 2` → `playSequence([item], rect, () => mergeEffect(false))`. Sudo + Git
Merge → `mergeEffect(true)` (the discard flows in too).

**Visual result**
The played card flies to the center; then every other deck (and, with Sudo, the gathered discard) flies
into the **first** deck and dissolves; the decks collapse into one; the card goes to the discard.

**Elements / refs**
- `pileRefs[id]` — deck cells (`decks[0]` = target). `discardRef`, `flyerRef` (the discard flyer, when `withDiscard`).

**Sequence** `mergeEffect(withDiscard)`
1. `target = decks[0]`.
2. If `withDiscard`: `discardFrom = await gatherDiscardToFlyer()` (gather + a face-up flyer at the discard
   spot), then `setFlyer(faceDown:true)`, `await wait(TURN_MS = 460)`, `await wait(STEP_HOLD)` — flip it
   back-up before it flies in.
3. Measure `tRect = pileRefs[target.id]` — **[I1]**. For each `d of decks.slice(1)`: measure its rect once,
   `play('absorbToDeck', el, { from: r, to: tRect, duration: MERGE_MS = 520 })` (move + **fade**); collect `.finished`.
4. If `withDiscard`: `play('absorbToDeck', flyerRef, { from: discardFrom, to: tRect, duration: MERGE_MS })`; collect.
5. `await Promise.all(flights)`.
6. `total = sum(decks.count) + discardCount`; `setDecks([{ id: target.id, count: total }])`; `setFlyer(null)`.

**Params & timings**
| Step | Preset | Duration |
|---|---|---|
| card hand → center (wrapper) | `playToCenter` | 480 ms |
| discard prep flip (if Sudo) | `wait(TURN_MS)` | 460 ms |
| each deck (+ discard) → target | `absorbToDeck` | `MERGE_MS = 520` (+fade) |
| card center → discard (wrapper) | `centerToDiscard` | 420 ms + `jitter()` |

**Invariants**
- **I1** measure the target rect (and each source rect) once, before the flights. All source flights start together (`Promise.all`).
- Local: `absorbToDeck` fades opacity → the flying decks dissolve into the target.

**End state & cleanup**
- One deck with `total` count; discard emptied (if merged in); played card in the discard; `busy = false`.

**Building blocks**
[`absorbToDeck`](./reference.md#presets) · [`playToCenter`](./reference.md#presets) ·
[`centerToDiscard`](./reference.md#presets) · [`nextFrames`/`wait`](./reference.md#travel-and-timing-helpers).

**Live reference**
`Deck animations` — play Git Merge (with 2+ decks).

---

## Discard → new deck (Git Branch + Sudo) — gather, fly, flip back-up

**When to call**
Inside `enhancedBranchEffect(deckId)`: `split(deckId)` → `await wait(SPLIT_HOLD = 600)` → `await flipDiscardToNewDeck()`.

**Visual result**
After the split, the scattered discard gathers into a neat pile, flies as a face-up card to a new deck
spot, flips back-up, and the new deck appears there.

**Elements / refs**
- `discardRef` — discard spot (source). `pileRefs[newId]` — the new (initially `hidden`) deck. `flyerRef` — the single face-up → back-up flyer.

**Sequence**
1. `flipDiscardToNewDeck()`: append `{ id: newId, count, hidden: true }` (opacity 0); `await nextFrames()`;
   measure `toRect = pileRefs[newId]` rect (fallback: unhide + clear discard if missing); `await runDiscardFlight(toRect)`;
   unhide the new deck.
2. `runDiscardFlight(toRect)`:
   - `fromRect = await gatherDiscardToFlyer()`: `setDiscard(showCount:false, gathered:true)` (cards stack to
     `translate(0,0) rotate(0)`); `await wait(GATHER_MS = 360)`; `await wait(STEP_HOLD)`; measure `discardRef`
     rect; `setFlyer({ card: top, faceDown: false, at: discardRect })` — the flyer's state carries the rect it
     mounts at, so it paints on the pile from the first frame (**[I10]**); `setDiscard(cards:[])`;
     `await nextFrames()` (**[I2]**); return the rect.
   - Aim at the card area: `aspect = fromRect.height / fromRect.width`; `cardTo = { left, top, width: toRect.width,
     height: toRect.width * aspect }` — **[I6]**, inline via the measured aspect (not the shared `cardAreaOf`).
   - `play('gatherToDeck', flyerRef, { from: fromRect, to: cardTo, duration: 560 })`; await.
   - `await wait(STEP_HOLD)`; `setFlyer(faceDown:true)` (flip back-up); `await wait(TURN_MS = 460)`; `await wait(STEP_HOLD)`; `setFlyer(null)`.

**Params & timings**
| Step | Preset | Duration |
|---|---|---|
| gather the scatter | `wait(GATHER_MS)` | 360 ms |
| discard → new deck | `gatherToDeck` | 560 ms (explicit) |
| flip back-up | `wait(TURN_MS)` | 460 ms |

**Invariants**
- **I6** aim at the target's card box (here inline via the measured `aspect`, since the discard flyer's rect is known).
- Local: the new deck is mounted **hidden** (opacity 0) so its slot exists to measure/land into; unhidden only
  after the flight. `gathered:true` collapses the scatter before the flyer takes over.

**End state & cleanup**
- Discard emptied; a new draw deck (`count` = former discard size) visible at its spot; `flyer` gone.

**Building blocks**
[`gatherToDeck`](./reference.md#presets) · [`nextFrames`/`wait`](./reference.md#travel-and-timing-helpers).

**Live reference**
`Deck animations` — play Git Branch + Sudo.

---

## Taking an opponent's card at random — their fan comes down, one back turns over, into your hand

**When to call**
Player triggers "take a random opponent card" → `deal()`. Phases `idle → present → reveal`.

**Visual result**
The opponent's hand — the same `Hand`, backs up, turned 180° so its arc bows toward you — slides down
from the top of the stage and is held out. Clicking a back sends the rest of the fan back up off the
top while that card travels to the centre, turning upright on the way; there it flips face up, stands
for a hold, and drops into your own fan.

**Elements / refs**
- `.topHand` — the offered fan's wrapper, which owns the slide; `.topHandInner` inside it owns the
  `rotate(180deg)`. The fan itself is `<Hand items={oppHand} faceDown onCardClick={pickCard}>`, so the
  slots are `Hand`'s own children and the scene keeps no slot registry of its own.
- `revealRef` — the flying card (`position: fixed`). `handRef` — your fan (`useHandArrival`).
- State: `phase`, `oppHand: PoolCard[]`, `handIn` (the slide toggle), `chosen: string | null` (a uid),
  `reveal: { card, from, to } | null`, `centered`, `flipped`, `hand`.

**Sequence**
1. `deal()`: `setOppHand(sampleBase(count)…)`; `setPhase('present')`; `handIn = false` → **double-rAF**
   → `handIn = true`. `.topHand` transitions from `translateY(-160%)` to `0`: the fan is mounted off
   the top edge and paints there before it is asked to come down (like **I2**, and for its reason).
2. `pickCard(i, el)` (only in `present`, `chosen === null`): measure the clicked slot; compute the
   delta to the **viewport** centre (`window.innerWidth / 2` — this scene has no stage inset to
   correct for, unlike its two siblings); `setChosen(uid)`; `setPhase('reveal')`; `handIn = false` (the
   rest of the fan slides back up and off); build `reveal` with the slot's rect as `from` and, as `to`,
   `translate(dx, dy) scale(REVEAL_W / r.width) rotate(0deg)`; **double-rAF** → `centered = true`.
   The chosen slot's `renderFace` returns `null` from here on, so the card is never on screen twice.
3. The flyer starts at `rotate(180deg)` — the orientation it had inside the opponent's fan — and the
   CSS transition on `.reveal` carries it all the way to `to`, so it turns upright over the flight
   rather than snapping at either end.
4. `onRevealEnd` (transform end, `centered && !flipped`): `flipped = true`, so `Card` plays its own
   `flipCard`; then `setTimeout(fall, REVEAL_HOLD)`.
5. `fall()`: measure the reveal node; `arrive([{ key: nextHandUid(), card, from: rect }], hand.length)`
   — the shared `useHandArrival` flies it into your fan; `setReveal(null)`.
6. `onLanded(gap, landed)`: splice into `hand` at `gap`, then clear the round — `phase` to `idle`, and
   `oppHand` / `chosen` / `reveal` / `centered` / `flipped` / `handIn` reset.

**Params & timings**
| Step | Mechanism | Value |
|---|---|---|
| the fan comes down / goes back up | CSS transition on `.topHand` (`transform`), `--ease-soft` | 520 ms |
| slot → centre | CSS transition on `.reveal` (`transform`), `--ease-soft` | 460 ms |
| flip the pick | `Card`'s own `flipCard` on the `faceDown` change | 420 ms |
| centre hold before the drop | `setTimeout(REVEAL_HOLD)` | 820 ms |
| chosen → hand | `useHandArrival` | `FLIGHT_MS = 480` |
| the width it reaches at the centre | `REVEAL_W` | 220 px |
| how big a hand is offered / your own | `count` (slider) / `INITIAL_HAND` | 2…16, default 8 / 5 |

**Invariants**
- The slide, the flight and the return are **CSS transitions** on nodes the scene owns; the flip is
  the `Card`'s own `flipCard`. Only the final hand insert is a module (`useHandArrival`).
- The chosen slot renders `null` while the flyer carries the card — one card, one node.
- Local: the double-rAF (like **I2**) is used twice, once so the fan paints off the top edge before it
  comes down, once so the flyer paints at its slot rect before it leaves it.
- Nothing here decides WHICH card is taken — the player clicks a back and learns what it was only at
  the centre. The pick is a **reveal**, and that is the half of this scene the board keeps when the
  engine's RNG does the choosing (see the board recipe below).

**End state & cleanup**
The chosen card is spliced into your hand at `gap`, `oppHand` is cleared and `phase` is back to `idle`
— all of it from the hook's `onLanded`. `restart` clears the hold timer, resets the arrival and
rebuilds your hand.

**Building blocks**
[`useHandArrival`](./reference.md#hand-arrival--cards-arrive-in-the-hand) · `Hand` (`faceDown`,
`onCardClick`, `renderFace`) · `Card` `flipCard` (auto) · CSS transitions on `.topHand` / `.reveal`.

**Live reference**
`Random opponent card` — `apps/playground/stories/interactive/PickOpponentCardStory.tsx`.

---

## Canonical hand — pick up a card and drag it (play / reorder), with a hover zoom

**When to call**
The hand is interactive when `onPlay` or `onReorder` is supplied (`dragEnabled`). A press arms the gesture:
movement past the threshold turns it into a drag, a release before it is a click (`onCardClick`, so
click-to-play arrow flows coexist with drag).

**Visual result**
The pressed card lifts onto a flyer that follows the cursor. Dragged inside the hand band it reorders
(neighbours open a gap); dragged out onto the table it plays (the consumer accepts, or the card glides back).
Hovering (not dragging) lifts the card and parts its neighbours, and a separate enlarged preview rises above
the hand.

**Elements / refs**
- `handRef` — the fan container. `flyerRef` — the single fixed drag flyer. `grab` ref `{fracX, fracY}`,
  `cursor` ref.
- State: `hoveredUid`, `drag: {uid, card} | null`, `preview: number | null` (reorder slot), `zoomView`,
  `zoomShown`.
- Geometry from `table/Hand/fan` (`slotPlacement`, `handStep`, `CARD_W`).

**Sequence**
1. `onSlotDown(i, el, e)`: without `dragEnabled` → `onCardClick` immediately. Else `e.preventDefault()` and arm
   window `mousemove`/`mouseup`: move past `DRAG_THRESHOLD` → `beginDrag(i, downX, downY)`; release before →
   `onCardClick` (a click).
2. `beginDrag`: grab point from where the card is **drawn**, not from its base slot — `slotPlacement(i, n)` less
   `HOVER_LIFT`, since the card under the cursor is the hovered one and hover draws it that much higher.
   Measured from the base, the card drops by exactly that the instant it leaves the fan. The grab fractions
   double as the deflection the tilt engine was running on (`frac − 0.5`: the same cursor over the same card
   box, one expressed as `0…1` and the other as `−0.5…0.5`), so they go into `drag.tiltFrom` and the flyer's
   face straightens out of the tilt it had instead of being born flat. Then `setHoveredUid(null)`; `setDrag`;
   `setPreview(inBand(downY) ? i : null)`.
3. Drag effect (a **layout** effect keyed on `drag` — **I10**: the flyer mounts with no `left/top` of its own,
   and a passive effect would place it only after the browser was free to paint that frame): `place()` sets the
   flyer `left/top` to `cursor - frac*CARD_W/H` on each `mousemove`; `preview = inBand ? slotUnderCursor(x) :
   null`. The lifted card renders `null` in the fan; the rest lay out with a gap at `preview`.
4. On `mouseup`: inBand → `settleInto(slotUnderCursor(x), () => onReorder(uid, to))`; out of band →
   `onPlay(uid, {x, y, rect})` — `true` = played (gone), else `settleInto(originalIndex)` (never vanishes).
5. `settleInto(target, commit?)`: hold the gap at `target`; take the shape of the landing from the fan —
   `insertPath(from, to, target, n)` (reference), the card coming into its slot **round from the left** along
   one curve with no corner in it. Play those positions as WAAPI keyframes over `SETTLE_MS` at `SETTLE_EASE`,
   turning to `rotate(base.rotate)` along the way, `fill: 'forwards'`. At `SWITCH_AT` of that clock — the apex
   of the sweep — drop the flyer's `zIndex` to the slot's `base.z`, so it goes UNDER its right neighbour where
   the two overlap least and while it is moving. After `SETTLE_MS` run `commit`, clear `drag`/`preview`.
6. Hover (no drag, `gapAt == null`): hovered slot `rotate → 0`, `y -= HOVER_LIFT`; neighbours `x += dir *
   NEIGHBOR_PUSH / distance`. No in-place scale, no top-layer jump.
7. Zoom preview (layout effect on `hoveredUid`): skipped when `faceDown || drag || !hoveredUid`. Else size a card
   to the free band above the hand (`h = clamp(handTop - ZOOM_TOP_AIR - ZOOM_GAP, ZOOM_MIN_H, ZOOM_MAX_H)`,
   `w = h * CARD_WH`), center it, `top = handTop - ZOOM_GAP - h`; one `requestAnimationFrame` → `zoomShown = true`.

**Params & timings**
| Thing | Value |
|---|---|
| drag threshold | `DRAG_THRESHOLD = 6` px |
| hover lift / neighbour push | `HOVER_LIFT = 28` / `NEIGHBOR_PUSH = 36` px |
| reorder / return landing | `SETTLE_MS = 460` ms at `SETTLE_EASE` (= `--ease-soft`), along `insertPath`; layer switch at `SWITCH_AT = 0.35` |
| band tolerance above hand | `BAND_PAD = 32` px |
| card width | `CARD_W = 150` (`CARD_WH = 368 / 515`) |
| zoom clamp / air / gap | `ZOOM_MIN_H = 240` … `ZOOM_MAX_H = 460`; `ZOOM_TOP_AIR = 32`, `ZOOM_GAP = 44` |
| zoom fade / rise | opacity 260 ms; `@keyframes zoom-rise` 260 ms (appear only) |
| disabled dim | `.faceWrap` filter 380 ms (`grayscale(0.7) brightness(0.55)`) |
| z-index | flyer 1200, zoom 1100 |

**Invariants**
- **The flyer's `transform-origin` is `bottom center`, matching `.slot`** — the settle rotation pivots exactly
  where the resting card does; otherwise the card micro-jumps on the last frame (worst off-centre).
- Hover keyed by **uid**, not index — a removed card does not hand its hover to whatever slid into its index.
- Pick-up geometry comes from where the card is **drawn** (hover lift included), so it does not move on being
  grabbed; the tilt it carried goes with it and eases out, because the flyer's face is a NEW instance and a new
  instance is born flat.
- A card enters the fan **from the left** and changes layer at the apex of that sweep — see `insertPath`
  (reference) for why an instant switch reads as a jump.
- A rejected play returns via `settleInto` — the card never disappears into nothing.

**End state & cleanup**
- Reorder → `onReorder(uid, toIndex)` (local, never networked). Play → the consumer owns the card. Rejected →
  back in its original slot. `drag`/`preview` cleared; hover suppressed during drag.

**Building blocks**
`table/Hand/fan` (`slotPlacement`, `handStep`, `insertPath`) · `useCardTilt`'s `from` (the tilt handover onto the
flyer's face) · `@keyframes zoom-rise` (Hand.module.css). No `play()` preset — the landing is WAAPI keyframes
built from `insertPath`, and the drag itself is inline `left/top` on the flyer.

**Live reference**
`Hand` — `apps/playground/stories/HandStory/HandStory.tsx` (and every interactive story that renders a hand).

---

## Error 503 (player turn) — draw, alarm, defend by drag, or be eliminated

**When to call**
From TurnDock `'draw'` → `drawFlow()`. Guard `if (busy || centerCard || eliminated) return`. The branch is
decided by which cards sit where (tech-bar toggles: Debugger in hand; Release / Release+Code Review / Monitoring
in the zone) — not by hard-coded per-flow cases.

**Visual result**
Error 503 flies from the deck to the centre and flips up for everyone, with a red edge glow from the table
edges. Then either Monitoring auto-neutralises it (brief centre → discard, no glow); or the player drags the
Debugger (hand) or a Release + its Code Review (zone) onto the 503 to cover it, and both go to the discard; or,
with no defence / a PASS, the hand (and on a PASS the zone too) sweeps to the centre and to the discard, the
player is out, and a full-screen elimination video plays for everyone.

**Elements / refs**
- `deckRef`, `centerRef`, `discardRef`, `flyerRef` (draw flyer), `dragRef` (defence flyer), `handWrapRef`,
  `relSlotRefs[key]`, `outRefs[key]` (discard-bound flyers), `barRef`.
- State: `handItems`, `rel: Partial<Record<SlotKey, {main, aux?}>>`, `centerCard`, `flyer`, `outs`, `discard`,
  `drag`, `alert`, `pending`, `eliminated`, `gif/gifOut`, `dock`, `busy`.

**Sequence**
1. `drawFlow()`: `setFlyer(503, faceDown)`, `nextFrames`, position at `cardAreaOf(deckRect)` →
   `play('drawToCenter', {from, to: centerRect})`; on finish cancel + pin (**I3/I4**); `wait(180)` → flip up;
   `wait(560)` → `setCenterCard(503)`, clear flyer.
2. **Monitoring present** → `setDock('push')`, `wait(COVER_HOLD)`, `setCenterCard(null)`, `sweep([503],
   gather=false)`; no glow, Monitoring stays. Held for the SAME `COVER_HOLD` every other answer stands open for
   — not a shorter beat of its own.
3. **No Monitoring** → `setAlert(true)`, `setPending(true)`, `setDock('reaction')`. `canDefend = Debugger in hand
   || rel.frontend || rel.backend`. If not → `wait(2500)` → `eliminate(false)`. Else hand off to the player.
4. **Defence drag** (`beginDrag`): capture the grab fraction, source centre and `startW`; one rAF loop eases
   `startW → CARD_W` over `ResizeMs = 200` while keeping the grab point under the cursor. On `mouseup`,
   `onTable(x, y)`: the WHOLE table accepts the drop; only the player's own area (the release zone + the fan,
   measured via `youRef`) gives it back — inside → `resolveDefense`, outside (over `you`) → `returnDrag`. There
   is no drop-target hint and no radius around the 503 itself; hitting "the table" is hitting anywhere that is
   not your own area. The Debugger uses the canonical `Hand.onPlay` (`handPlay`), accepted only for the Debugger
   dropped on the 503.
5. `resolveDefense`: cover the 503 (transition `left/top/width` 240 ms to `centerRect`/`CARD_W`), `wait(300)`;
   `wait(COVER_HOLD)`; read each card's actual rect via `[data-main]`/`[data-aux]` anchors (nothing rotated →
   bbox = card, **no teleport**); remove the played card from its source; `sweep(items, gather=false)` in stack
   order **503, Code Review, Release**; `setDock('push')`.
6. `returnDrag`: transition back to the source slot (240 ms), shrink to `startW`, `wait(260)`, clear drag.
7. `eliminate(includeRelease)`: collect the hand's per-slot rects (`handSlotRects()`) + (on PASS) the release
   slots; clear hand/zone/centre; `sweep(items, gather=true)`; `setEliminated(true)`, `setDock('waiting')`;
   `playEliminationGif()`.
8. `sweep(items, gather)`: mount `outs`, position at source rects; if `gather` glide all to `centerRect` (300 ms)
   + `wait(GATHER_HOLD)`; then per card `play('centerToDiscard', toDiscardParams(from, cardAreaOf(discardRect),
   jitter()))` (**I7**), append to `discard` with the same scatter.
9. Elimination video: `playEliminationGif` picks a random bundled `./eliminate/*.mp4` and loops; `onGifEnded`
   replays until `ELIM_MIN_MS`, then fades out (360 ms) and resolves.

**Params & timings**
| Step | Duration |
|---|---|
| draw flip / hold | `wait(180)`, then `wait(560)` |
| every answer's open hold (Monitoring included) | `wait(COVER_HOLD)` = `1200` |
| defenceless beat before KO | `wait(2500)` |
| drag resize ease | `ResizeMs = 200` (cubic) |
| cover glide (drop) | 240 ms + `wait(300)` + `wait(COVER_HOLD)` |
| return glide (off-target) | 240 ms + `wait(260)` |
| gather hold (elimination) | glide 300 ms + `wait(GATHER_HOLD)` = `1500` |
| discard flight | `play('centerToDiscard')` (move 420) |
| elimination video | ≥ `ELIM_MIN_MS = 5000`, fade 360 ms |
| the cover's own offset | `COVER_DX = 16`, `COVER_DY = -12` (so alarm and answer both read) |
| GIF entrance beat | `GIF_DELAY = 400`, after the table has emptied |

**Invariants**
- **Nothing rotates at the centre** (flat cover, flat `RelStack`): a rotated pair's bbox ≠ the card, which
  teleports the cards on the discard hand-off. Flat → bbox = card → the flight continues from where they lie.
- Defence is a **drag accepted by the whole table**, refused only by the player's own area (`onTable`) — no
  drop-target hints, no radius carved around the 503 — never a click/arrow.
- A Release drags **with its attached Code Review** (bound by position via `[data-main]`/`[data-aux]`, not
  "grouped").
- The edge glow lives in `.glowBounds`, offset by the measured tech-bar height (screen edge ≠ table edge).
- **I3/I4** on the draw flyer; **I7** for every scattered card.

**End state & cleanup**
- Defended → 503 + defence in the discard (order 503, CR, Release), `dock: push`. Eliminated → hand/zone in the
  discard, `eliminated: true`, `dock: waiting`, video played for all. `reset`/toggle → `applyScene`.

**Building blocks**
[`play('drawToCenter')`](./reference.md) · [`play('centerToDiscard')`](./reference.md) ·
`jitter`/`toDiscardParams`/`restTransform` · `EdgeGlow` · canonical `Hand` (`onPlay`).

**Live reference**
`Error 503` — `apps/playground/stories/interactive/Error503Story.tsx`.

---

## Error 503 on the board — the alarm from `pending`, three gestures, one exchange

**When it fires**
There is no `drawFlow()` on the board — the 503 is not staged by a click. `neutralize503` is a
projected `pending`: the moment the engine raises it, the alarm stands at the centre and the
answering player's own hand-off (`_useNeutralizeStaging.tsx`) and the beat runner
(`defenseBeat.runNeutralized`) both key off it. The three gestures are read live off
`pending.methods` — a method not named there simply does not light up; nothing here re-derives
legality.

**The glow — two mount points, and DOM order is the rule**
`_Board.tsx` mounts `EdgeGlow` **twice**, never once, because "your own alarm" and "someone else's"
read differently and the DOM position is what makes that true rather than a z-index guess:
- **Ours** — `intensity="strong"`, mounted **BEFORE** the hand, so it glows *under* it. `glowStrong =
  (pendingAlarm && alarmMine) || beats.alarm` — the second half is the defenceless sweep's own
  alarm, which raises no `pending` at all (the elimination lands in the same batch), so the running
  beat's own `alarm` flag is what keeps the glow lit through it.
- **Someone else's** — `intensity="weak"`, mounted **AFTER** the hand, so it lies *over* it.
  `EdgeGlow` is already `pointer-events: none` at both intensities, so the fan's hover keeps working
  underneath.

Neither reaches for the playground's `.glowBounds` offset math — the table's own zone is already
`position: relative; overflow: hidden; isolation: isolate`, so it supplies its own bounds and there
is nothing to measure (the playground's story is deliberately not the reference here, Page Shell
Rule).

**The three gestures**
All three read `pending.methods`; a slot or fan card the method set does not name never lights.
- **Debugger** (`onHandPlay`) — pulled from the fan like any other hand play, accepted only when
  `methods.includes('debugger')` and the card is the Debugger, dropped on the table (`onTable`: the
  zone + fan is the player's own area, everywhere else on screen is the table — same rule the
  playground story's `onTable` uses, measured off `anchors.zone`/`anchors.hand` rather than one
  `youRef`).
- **Sacrifice** (`onSlotDown` → `useZonePull`) — a release is dragged out of its slot (`_useZonePull`
  owns the drag state and knows nothing about the game; `accepts: onTable`, `onDrop` commits the
  choice); its own Code Review, if any, travels with it by position, not by "grouping".
- **Monitoring** — a **press**, not a drag: `onSlotDown` dispatches `RESOLVE` straight from the
  handler when the key is `monitoring`. Nothing is staged, nothing flies — the finding this leaves
  open (no designed movement for an answer that does not leave the table) is recorded in
  `backlog.md` and the audit register, not re-invented here.

**The exchange**
`commit()` sends the `RESOLVE` synchronously, in the same commit that hands the card to the flyer
(the no-duplicate rule `_useDefenseStaging` also keeps) — never the other order. `runNeutralized`
plays the answer's cover exactly the way `runCovered` plays a defence: `play('playToCenter')` to the
cover slot at `COVER_POSE` (`{ rot: 6, dx: 16, dy: -12 }`), skipped entirely for Monitoring (no card)
and for the answering player's OWN play (`!(mine && handoff)` — the gesture has already delivered it,
asking whether the play was *staged* rather than whether its node exists yet is what keeps a second
copy from flying in). Both stand open for `SHOW_HOLD = 1200`ms, then leave as **one send**: the alarm
(layer 0) and the answer plus its aux (layer 1) — `useDiscardExit`'s `Leaving[]`, each card carrying
its own `scatter` off its own `discarded` event id (**I7**, **I9**).

**The gather leg — a defenceless player's whole table**
When nobody answers, the sweep is `discardBeat`'s `plan.gather` branch (ported from the playground's
own `sweep(items, gather)`), not a separate module: every card the eliminated player owned is raised
at its own rect, glided to a scattered heap at the centre (the same `scatterAt` model the discard
uses), held open for `GATHER_HOLD = 1500`ms so the table can read what happened, then handed to the
discard exit with the heap's own boxes and poses. `Beat.alarm` (the running beat's own field, not a
plan field — see Task 10) is what keeps the strong glow lit for the length of this sweep, since no
`pending` stands to key `glowStrong` off.

**Params & timings (board)**
| Step | Value |
|---|---|
| answer's open hold before the exchange leaves | `SHOW_HOLD = 1200` |
| the cover's own offset | `COVER_POSE = { rot: 6, dx: 16, dy: -12 }` |
| the alarm's own rest tilt | `ATTACK_POSE = { rot: -4, dx: 0, dy: 0 }` |
| gather hold before the defenceless sweep scatters | `GATHER_HOLD = 1500` |

**Building blocks**
[`play('playToCenter')`](./reference.md) · `useDiscardExit` (`Leaving[]`, `scatterAt`) · `useFlyer` ·
`useZonePull` (`_useZonePull.ts`) · `EdgeGlow` (two mounts) · `Beat.alarm` (`useBeats.ts`).

**Live reference**
`apps/frontend/src/pages/board/[gameId]/_Board.tsx`, `_useNeutralizeStaging.tsx`,
`features/board-beats/defenseBeat.tsx` (`runNeutralized`), `features/board-beats/discardBeat.tsx`
(the `gather` branch), `features/board-beats/planBeats.ts` (the `neutralized` plan).

---

## Elimination on the board — the clip over a table that has already settled

**When it fires**
On the engine's own `eliminated` event, and on nothing else. It is NOT a leg of the sweep: the
sweep is a `discard` plan with `gather`, and elimination is reachable with nothing to sweep at all
(`lastStanding` is a win condition), where that plan is dropped for having no cards. So `planBeats`
gives the elimination a plan of its own — pushed inside `flush()`, **after** the discard run it
opened, because the `eliminated` event arrives BEFORE the discards it marks and the clip has to
play over an emptied table rather than under one.

**Visual result**
The board settles into its eliminated state — the seat zeroed, the local player's zone and fan
replaced by the "you are out" badge — and the clip comes up over the whole stage a beat later. It
loops until `ELIM_MIN_MS`, finishes the loop it is in, and is gone at once. What it uncovers is the
state that was already there.

**The state under it is the projection's, not the beat's**
The beat **publishes nothing**. `eliminated` is folded by the engine's own projection
(`fake/project.ts` → `toBoardState`), so the seat, the hand and the zone read as out because the
board says so — which is what keeps them out for the rest of the match once the clip has gone. The
beat is `exclusive`, and that is load-bearing twice over: input is dead under a full-screen video,
and an exclusive beat publishes no shadow, so what lies under the clip is the LIVE board. A
non-exclusive beat here would hold the pre-batch shadow up instead and empty the table at the
moment the clip lifted — the video would be covering the elimination rather than following it.

**One clip for the whole table**
`ELIMINATION_CLIPS[plan.eventId % ELIMINATION_CLIPS.length]` — derived, never `Math.random()`.
Every peer already holds the elimination's event id, so one elimination is one clip on every
screen, at no cost on the wire and with no new event field. The list is globbed from
`./eliminate/*.mp4` and **sorted by path**: the pick is an index, and glob order is Vite's to
change.

**Bundled, not fetched**
The clips are imported (`import.meta.glob`, `query: '?url'`), so Vite emits each as its own hashed
asset — they are not in the JS bundle and nothing is fetched until the overlay mounts. There is no
backend and no CDN to fetch them from (Architecture Rule), and a build-time import means a renamed
clip breaks the build instead of 404-ing on somebody's board.

**Fetched before anybody needs one**
`useEliminationPreload` fetches all four at browser idle, once the match is running — mounted from
`_Board.tsx` on `!deal.active`. Not at app start: initial load does not pay for these today, and a
clip that may never be needed should not change that. All four, because which one comes up is known
only at the elimination itself. Nothing is kept — the point is the HTTP cache, so `<video>` starts
from it instead of from the network.

**The guard is the clip's own time, not a blanket ceiling**
A single ceiling for every clip is wrong for all of them at once: too generous for a short clip (the
board sits dead past its end) and a real risk of cutting a long one. So each clip is guarded with
its own number, derived from the rule the beat already plays by — loop to the floor, then let the
pass you are in finish. That is `idealEndMsFor`: `ceil(ELIM_MIN_MS / duration) * duration`, the
first whole loop at or past the floor, which is what a healthy clip takes IN THE IDEAL.

**…plus room for the seams that end really contains.** Real playback runs a little longer than the
ideal: `ended` fires, the handler rewinds to 0, `play()` is called and a frame decodes, every time
round. Armed on the ideal number exactly, the timer beats the last `ended` to the exit on every clip
that loops — and the beat goes back to ending on a number instead of on a loop boundary, which is
the thing the per-clip guard exists to stop. Worse, it never surfaces as a failure, only as a clip
that ends a few frames early. So `guardMsFor` adds `ELIM_GUARD_SLACK_MS` **per loop** — what varies
between clips is the number of seams, not a fixed overhead, and these clips are expected to be
replaced, so the shape has to survive a shorter one arriving. The guard is there for a stalled
stream: it should fire well after any honest end, and a stall waiting a few hundred ms longer costs
nothing.

Two conditions make that number honest, and both are pinned:
- **the count starts at real playback (`playing`), not at mount** — otherwise loading spends the
  clip's own budget and a slow connection reproduces the same cut with a different number. Only the
  first `playing` counts; a stall that resumes must not hand the clip a fresh budget.
- **the lengths live beside the clip list** (`CLIP_MS`), and `eliminateClips.test.ts` reads each
  file's real duration out of its own `moov/mvhd` box and fails if the table disagrees or a clip
  ships without an entry. That matters here specifically: the clips ship with unconfirmed rights and
  are expected to be replaced, so a swap has to fail loudly rather than quietly mis-time the beat.

`performance.now()`, as in the source.

**Four ways it ends, one way out**
`finish()` is the single exit — the overlay goes, whichever guard is armed is disarmed, the beat's
promise resolves once — and four things reach it:
- `ended` past `ELIM_MIN_MS`. Before the floor, `ended` replays the clip instead.
- `error` — a missing file, a refused codec. Nothing is put in its place: the board is already in
  its eliminated state, which is what carries the news; the clip was the punctuation, not the
  sentence.
- a rejected `play()` — autoplay refused. It fires no event at all, so without catching the promise
  the beat would wait on a clip that was never going to play.
- a guard: the clip's own time once playback has started, and `ELIM_START_MS` before it has. The
  second is a LOADING guard, not a clip one — it covers the only case the per-clip number cannot,
  a clip that never begins at all, which would otherwise hold the board for the rest of the match.

**The winner waits for it**
The engine settles the elimination and the win it caused in ONE reduction (`fake/triggers.ts`:
`eliminated`, its discards, then `gameOver`), so `view.over` is true the instant the batch lands —
while the sweep and the clip are still queued. `over` also rides BESIDE the projection
(`toBoardOver` hangs it off the props, not off `BoardState`), so the shadow that holds every other
visible fact back does not cover it. `useBeats` therefore publishes one plain fact, `running` — the
queue is still working, held for the whole drain rather than per beat — and `_Board` renders
`GameOver` only when it is false. Without it the winner panel is announced over the top of the clip
that explains why they won.

**Under `prefers-reduced-motion` there is no clip at all**
Decided, not emergent: a full-screen autoplaying video is exactly what the preference is about.
`useBeats` queues no beat under the preference, so the board goes straight to its eliminated state
— the same policy, in the same one place, that every other beat obeys.

**Params & timings**
| Step | Value |
|---|---|
| the emptied table holds before the clip covers it | `ELIM_DELAY = 400` |
| the clip loops at least | `ELIM_MIN_MS = 5000` |
| its ideal end, the first whole loop past that | 6.10 / 6.53 / 6.47 / 9.40s for the current four |
| the guard, which is that plus room per seam | `+ ELIM_GUARD_SLACK_MS = 250` per loop |
| a clip that never starts playing at all | `ELIM_START_MS = 10000` (a loading guard, not a clip one) |
| fade in | 260ms, over a clip that is ALREADY playing — the fade does not hold it back |
| fade out | none: the turn is over, there is nothing left to watch out of |

**Invariants**
- The overlay is `inset: 0` of the **stage**, not of the viewport — `.table` is already
  `position: relative`, so it supplies its own bounds (the same reason the board's `EdgeGlow`
  measures nothing).
- **I5** on the clip: a media element does not re-fetch when `src` changes, so the `<video>` is
  keyed by its source — a different clip is a different element.

**Building blocks**
`wait` · `Beat.exclusive` / `Beats.running` (`useBeats.ts`) · the `eliminated` plan
(`planBeats.ts`).

**Live reference**
`apps/frontend/src/features/board-beats/eliminateBeat.tsx`, `features/board-beats/planBeats.ts`
(the `eliminated` plan), `features/board-beats/useBeats.ts` (`beatOf`). The playground's own tail is
`Error 503`'s `eliminate()` — the source this was ported from.

---

## AI effects — trigger, pull the event, resolve by effect

**When to call**
The base deck is clicked (or the draw button) → `start()`. Guard `if (busy) return`. The chosen AI card (tech-bar
selector) and the zone/discard seeding decide the branch.

**Visual result**
The AI trigger flies from the base deck to a cause slot left of centre and flips up; the chosen AI card is pulled
from the events deck to the centre (larger) and flips up; after a table hold it resolves by effect — into the
release zone, back to the AI deck, to the discard, into the hand, or a full sub-scene (Inside choice, Good/Bad
Vibe).

**Elements / refs**
- `baseDeckRef`, `aiDeckRef`, `causeRef`, `effectRef` (centre), `discardRef`, `flyerRef`, `outRefs[key]`,
  `releaseSlotRefs[key]` (via `ReleaseZone.slotRef`), `handRef`.
- State: `release`, `hand`, `flyer`, `trigger`, `aiCard`, `outs`, `discard`, `alert`,
  `insideCandidates/insidePickIdx/insideRevealed`, `handPickMode`, `busy`. Refs: `turnInterrupted`, `halted`,
  Inside/hand-pick resolvers.

**Sequence**
1. `pullTo(card, fromRef, toRef)`: `setFlyer(faceDown)`, `nextFrames`, position at `cardAreaOf(fromCell)` →
   `play('drawToCenter', {from, to})`, pin (**I3/I4**); `wait(160)` → flip up; `wait(FLIP_MS + 140)`.
2. `start`: `pullTo(trigger → cause)` → `setTrigger`; `pullTo(chosen → effect)` → `setAiCard`; `dispatch`; if not
   `halted` → `setBusy(false)`.
3. `dispatch`: `ai-error-503` → `raise503()` (glow + halt); `ai-bad-vibe-coding` → `badVibe`;
   `ai-good-vibe-coding` → `goodVibe`; else `resolveEvent`.
4. `resolveEvent`: `wait(Hallucination ? HALLUCINATION_HOLD : TABLE_HOLD)`; Hallucination sets `turnInterrupted`;
   `resolveGeneric`.
5. `resolveGeneric`: compute placeable (Release/Monitoring into an empty matching slot), crush (matching release
   present), Inside releases (captured before the trigger lands); mount `outs` (trig, eff, +crushed) at their
   rects; in parallel — `triggerToDiscard` (`centerToDiscard` + `jitter`), and either `placeIntoSlot`
   (`playToReleaseZone`, card stays) or `returnAiToDeck` (flip back-up + `returnToDeck`), plus `destroyRelease`
   for a crush (AI release → flip + `returnToDeck`; ordinary release → `centerToDiscard`); append the trigger to
   the discard. Then Inside: single → `insideGrab` (discard → centre → hand); several → `insideChoose`.
6. `insideChoose`: remove candidates from the discard; render a hidden pick row; fly each from the discard to its
   row cell (`drawToCenter`, scaling up to hand-card width); reveal the row; await `ConfirmAction`; chosen →
   `useHandArrival` into the hand; the rest fly back to the discard (`centerToDiscard`, own scatter).
7. `goodVibe`: `resolveEvent` (Good Vibe → AI deck, trigger → discard); reset `turnInterrupted`; draw 2 per the
   makeup selector — plain card via `drawToHand` (`pullTo` → `useHandArrival`), AI trigger via
   `runAiTrigger(Hallucination)` (sets `turnInterrupted`), 503 via `draw503ToHalt`; break on `turnInterrupted ||
   halted` (Hallucination's interrupt skips the 2nd draw).
8. `badVibe`: `setHandPickMode(true)` and await a hand click (`Hand.onCardClick`); `resolveGeneric` (Bad Vibe →
   AI deck, trigger → discard, **no extra hold** — the pick wait already held it); the chosen card flies from its
   slot to the centre (`drawToCenter`), holds `SHOW_HOLD`, then to the discard (`centerToDiscard`).

**Params & timings**
| Thing | Value |
|---|---|
| flip | `FLIP_MS = 420` ms |
| table hold | `TABLE_HOLD = 2600` ms |
| Hallucination hold | `HALLUCINATION_HOLD = 5200` ms (×2) |
| shown-to-all hold | `SHOW_HOLD = 1500` ms |
| flights | `drawToCenter`, `playToReleaseZone`, `returnToDeck`, `centerToDiscard` |

**Invariants**
- **An AI event card never reaches the common discard** — it returns to the AI deck (`returnToDeck`). Only the
  trigger and a destroyed **ordinary** release go to the common discard.
- Hallucination raises a **real turn-interrupt flag** (`turnInterrupted`) that skips Good Vibe's second draw —
  not just a comment.
- Hand hover is muted during animations (`pointerEvents: busy && !handPickMode ? 'none'`), like the Git-card
  stories.
- **I3/I4** on every flyer; **I7** for scattered discards; Inside removes/returns candidates **by reference** so
  the trigger append does not shift them.

**End state & cleanup**
- Placed → the card stays in the zone slot. Crush → slot cleared, card to the AI deck / discard. Inside → release
  in the hand, the rest back in the discard. 503 → glow + `halted` (reset to continue). `reset` rebuilds from the
  toggles.

**Building blocks**
[`play('drawToCenter' / 'playToReleaseZone' / 'returnToDeck' / 'centerToDiscard')`](./reference.md) ·
`useHandArrival` · `ConfirmAction` · `ReleaseZone.slotRef` · `jitter`/`toDiscardParams`.

**Live reference**
`AI cards` — `apps/playground/stories/interactive/AiCardsStory.tsx`.

---

## An AI trigger resolves (live board) — cause, effect, one of six endings

Driven by `aiRevealed` and `takenFromDiscard`, planned by `planBeats` (`aiTailAfter`) and run by
`aiBeat` (`useAiBeat`). The playground recipe above is its original; the board keeps the shared
opening and the vocabulary of endings, and translates the rest — there is no fan of Inside
candidates here, an opponent is a seat and a count, and a prompt an effect raises can outlive the
batch that revealed it.

**When to call**
Never directly. `useBeats` plans an `aiEvent` beat from `aiRevealed` — paired with the `discarded`
that banks the trigger in the same reduction — and runs it through `run`; a `takenFromDiscard` event
with `to: 'hand'` plans its own beat and runs through `runTaken`. Neither is `exclusive`: an AI card
is read, not obeyed, and nothing about it needs input dead.

**Visual result**
One shared opening for every ending: the trigger comes off its pile and stands at `cause`, left of
centre; the events deck gives up the card that explains it to `effect`, wider and to the right; both
flip face up and hold — `TABLE_HOLD`, doubled for Hallucination. Only then do the endings differ,
each one read off what the plan already decided rather than re-derived from the card's own id:

| Ending | What the table sees |
|---|---|
| `zone` | the effect card settles into an empty release/monitoring slot (`playToReleaseZone`) and STAYS — a card standing in a zone slot is what the batch's own `released`/`placed` looks like from outside this beat. |
| `crush` | the destroyed release rises as its own flyer at its own slot, in the same commit the zone lets go of it, and takes its own road — the events deck (`returnToDeck`) or the discard (the discard-exit step), whichever the plan's `destination` says (read off `releaseEventsOf`, never guessed from the card's id); the effect card goes home once the trigger and the destroyed release have left. |
| `turnEnded` | the turn simply ends; the effect goes home. |
| `alarm` | the effect mimics an Error 503 that resolved with nobody able to answer it (no pending raised); the effect goes home. |
| `none` | nothing else followed in the batch; the effect goes home. |
| `standing` | a prompt is now owed — `crush`, `neutralize503`'s mimic, `handLimit` (Bad Vibe) or `pickFromDiscard` (Inside) — and the effect card is dropped exactly where it stands rather than sent home. |

"Goes home" is one leg, `goHome`, shared by every ending but `zone` and `standing`: the card flips
face down where it stands and shrinks back into the events deck (`returnToDeck`).

> **The trigger never gets the `standing` treatment, and that is not a stylistic choice.** The
> engine banks it — `discarded(trigger-ai)` in `fireTrigger` — in the very reduction that reveals
> it, before `resolveAiEvent` ever runs; by the time this beat plans, the projection already has the
> trigger in the discard heap. Holding it on screen would contradict a projection that has already
> moved it. The effect card CAN stand, because `decks.events` is projected only as a count — one
> fewer, and nothing on screen disagrees with the card still standing at `effect`. Do not "fix" this
> into a matching pair: the asymmetry is downstream of an open backlog entry on the engine banking
> the trigger before its own effect resolves, not a gap in this beat (`docs/animations/backlog.md`).

**Elements / refs** — all from `BoardAnchors`
- `pileBox(index)` — the pile the trigger drew off.
- `cause` / `effect` — the AI pair's own centre places, from `centrePlaceStyle('ai', …)`
  (`TableCentre/centre.ts`).
- `eventsBox` — the events deck: both ends of the effect card's trip home.
- `releaseSlot(player, slot)` — a `zone` ending's destination, and a `crush`'s victim.
- `discardBox` / the discard-exit step — the trigger's own road, and an ordinary `crush`
  destination's.

**Sequence — `run` (`aiEvent`)**
1. `toSlot({ key: TRIG, card: trigger, from: cardAreaOf(pileBox(plan.pile)), to: cause })`; flip
   after `BEFORE_FLIP`; hold `AFTER_FLIP`.
2. `toSlot({ key: EFF, card: event, from: cardAreaOf(eventsBox), to: effect })`; flip; hold.
3. `wait(plan.eventCard === 'ai-hallucination' ? HALLUCINATION_HOLD : TABLE_HOLD)` — the one place
   this runner reads the card's own id, and only to size the READING; `plan.tail` alone still
   decides what the effect DOES.
4. A `crush` raises the destroyed release as its own flyer, at its own slot, in the same commit the
   zone lets go of it.
5. Three legs run together (`Promise.all`): the trigger to the discard on
   `scatterAt(plan.triggerDiscardId)` (**I7**); the effect down its ending's road; a `crush`'s
   destroyed release down `plan.tail.destination`'s road.

**Sequence — `runTaken` (`takenFromDiscard`)**
`ai-inside`'s own answer, resolved. One path, two audiences:
1. `toSlot({ key: EFF, card, from: cardAreaOf(discardBox), to: effect, faceDown: false })`; hold
   `SHOW_HOLD` — open at the centre for the WHOLE table, the same way `AiCardsStory`'s own
   `insideGrab` holds it, regardless of who it belongs to.
2. **Mine** — `useHandArrival` into the fan.
3. **Someone else's** — `dealToSeat` into their seat; their `handCount` is bumped in the same step
   the flight lands, so the hand-over to `live` does not pop their fan by one the instant the queue
   drains.
4. If this batch also answers a standing prompt (`plan.homeward`), the AI card that has been
   standing at `effect` since the batch that raised it goes home now: a no-travel raise at the place
   it already occupies, flip, `returnToDeck`. Written out here rather than shared with
   `handLimitBeat.tsx`'s or `defenseBeat.tsx`'s own `sendHomeward` — a carrier passed between hooks
   is how this codebase has already grown two latch bugs of that family.

**Params & timings**
| Step | Preset / wait | Value |
|---|---|---|
| pile → `cause`, events deck → `effect` | `drawToCenter` (via `toSlot`) | 480 ms each |
| flip, before / after | `wait(BEFORE_FLIP)` / `wait(AFTER_FLIP)` | 220 ms / 560 ms |
| table hold | `wait(TABLE_HOLD)` | 2600 ms (`HALLUCINATION_HOLD` = 5200 ms) |
| effect home | `returnToDeck` | 480 ms |
| trigger / an ordinary crush → discard | the discard-exit step | — |
| Inside, shown to the table | `wait(SHOW_HOLD)` | 1500 ms |

**Invariants**
- **I2** — the `standing` leg waits a frame before dropping its carrier, so the projection's own
  `aiStanding` render (`_Board.tsx`, off `pending.source`) is up before the flyer lets go.
- **I4** — `toSlot` pins after every arrival, so the flip and the next leg start from where the card
  visibly stands.
- **I7** — the trigger's discard-exit reads `scatterAt(plan.triggerDiscardId)`, the same call the
  heap rests it on.
- Local: what an ending DOES is never re-derived from `eventCard`'s id — only the Hallucination
  hold's length is, and that is a presentation question, not a mechanic one.

**End state & cleanup**
`zone` — the card stays in its slot. `crush` — the slot is empty; the destroyed release and the
effect card have each taken their own road. `standing` — the effect card is left exactly where it
stands; its trip home belongs to whichever batch answers the prompt. Every other ending — the effect
is back in the events deck. The trigger is always in the discard.

**Building blocks**
[`drawToCenter`/`playToReleaseZone`/`returnToDeck`](./reference.md#presets) · `flipCard` (auto, via
`Card`) · [`useHandArrival`](./reference.md#hand-arrival--cards-arrive-in-the-hand) ·
[`useDiscardExit`](./reference.md#discard-exit--cards-leave-the-table-for-the-discard) ·
[`useToCentre`/`toSlot`](./reference.md#the-movement-steps-and-the-carrier-under-them) ·
[`cardAreaOf`](./reference.md#card-geometry-helpers) ·
[`centrePlaceStyle`](./reference.md#centre-of-the-table--the-places-a-card-lands-in).

**Live reference**
Not a playground scene — this beat runs on the real board:
`apps/frontend/src/features/board-beats/aiBeat.tsx`, with the plans in
`features/board-beats/planBeats.ts` (`aiTailAfter`) and the standing render in
`pages/board/[gameId]/_Board.tsx`. The playground original is the recipe above.

---

## Take a specific card — name it, then it flies out of the opponent's hand

**When to call**
The player names a card to demand from an opponent (`requestCard`) → `start()`, then `pickWanted(card)` to arm the
choice and `confirmWanted()` to commit it. Phases `idle → choose → picked → (reveal | miss)`. The outcome is
forced in the showcase by the `inHand` toggle.

**Visual result**
A `CardCatalog` (base cards, no triggers, face-up) appears in the middle band and the opponent's face-down fan
slides in from the top. Clicking a cell arms it — the card lights in the selection colour — and the confirm bar
commits it, after which the named card holds enlarged while the rest of the catalog slides away; then either that
card flies out of the opponent fan to the centre, flips face up and drops into your hand (hit), or the fan
flinches in place with a "not in hand" note and leaves (miss).

**Elements / refs**
- `rootRef` (stage — the centre is measured against it, not `window`: the playground has a sidebar), `handRef`
  (your fan), `topHandRef` (the opponent fan's slide wrapper — the node that flinches on a miss), `fanRef`
  (the fan inside it — slots are its inner children), `revealRef` (the flying card).
- `CardCatalog` (`open` / `selected` / `chosen`, `width = GRID_W`) and `ConfirmAction` under it.
- State: `phase`, `wanted`, `oppHand: PoolCard[]`, `handIn` (fan slide toggle), `chosenUid`, `reveal`,
  `centered`, `flipped`, `hand`.

**Sequence**
1. `start()`: `setOppHand(sampleBase(OPP_HAND))`; `setPhase('choose')`; `handIn=false` → double-rAF → `handIn=true`
   (the fan slides in). The catalog opens with it.
2. `pickWanted(card)` (only in `choose`) only **arms** the pick: `setWanted`, and the cell goes `selected`. Naming
   a card is irreversible, so the commit is the shared `ConfirmAction` bar — `confirmWanted()` (guarded on
   `phase === 'choose' && wanted`) does `setPhase('picked')`, which flips the catalog to `open={false}` with
   `chosen={wanted.id}` — the named cell holds enlarged while the rest leave — and `later(() => resolve(wanted),
   PICK_BEAT)`.
3. `resolve(card)`: **miss** (`!inHand`) → `setPhase('miss')`, `play('shake', topHandRef.current, { amp:
   MISS_SHAKE, dur: MISS_SHAKE_MS, shape: 'spring' })` — the fan flinches whole, in place —
   `later(setHandIn(false), MISS_HOLD)`, `later(backToIdle, MISS_HOLD + 560)`. **hit** → plant the wanted card
   into a random opponent slot; read that slot's rect (**I1**); compute the delta to the **stage centre**
   (`cx/cy` from `rootRef`, not `window`); `chosenUid = that slot` (its face renders `null`, so only the flyer
   shows the card); `handIn=false` (the rest of the fan slides up and off); build `reveal` (`from` rect + `to` transform: translate to centre,
   `scale(REVEAL_W / r.width)`, `rotate(0)`); double-rAF → `centered=true` (a CSS transition drives the flight).
4. `onRevealEnd` (transform end, `centered && !flipped`): `flipped=true` (flip face up), `later(fall,
   REVEAL_HOLD)`.
5. `fall()`: measure the reveal rect; `arrive([{ key: uid, card, from: rect }], hand.length)` — the shared `useHandArrival` flies it into
   the fan; `onLanded` splices it into `hand` and `backToIdle()`.

**Params & timings**
| Step | Value |
|---|---|
| chosen holds / others leave | `PICK_BEAT = 620` ms |
| reveal centre width | `REVEAL_W = 220` px |
| centre hold before the drop | `REVEAL_HOLD = 820` ms |
| miss shake + note | `MISS_HOLD = 1620` ms (+560 to idle) |
| the flinch itself | `play('shake')`, `MISS_SHAKE = 9` / `MISS_SHAKE_MS = 460` / `shape: 'spring'` — a whole fan, not the 7px `settle` sized for an input |
| opponent fan / catalog cell width | `OPP_HAND = 6`, `GRID_W = 100` |
| final drop | `useHandArrival` (`FLIGHT_MS = 480`) |

**Invariants**
- The centre is measured against the **stage** (`rootRef`), not `window` — the playground sidebar offsets the
  viewport centre.
- The chosen slot's face renders `null` while the flyer carries it, so the card is never shown twice.
- The flight is a **CSS transition** on the reveal node (not a `play()` preset); only the final hand-insert is a
  module.

**End state & cleanup**
- Hit → the card is in your hand, scene back to `idle`. Miss → nothing taken, back to `idle`. `restart` rebuilds
  the hand.

**Building blocks**
`useHandArrival` · `CardCatalog` (`open` / `selected` / `chosen`) · `ConfirmAction` ·
[`play('shake')`](./reference.md#presets) · `Hand` (`faceDown`, `renderFace`) · CSS transitions on `.reveal` /
`.topHand`.

**Live reference**
`Specific opponent card` — `apps/playground/stories/interactive/PickSpecificCardStory.tsx`. The board's version
of this scene is the `requested` half of
[A card changes hands](./recipes.md#a-card-changes-hands-live-board--taker-victim-watcher-and-the-ask-before-them).

---

## Opponent takes your card — the victim's view (a card leaves your hand for a seat)

**When to call**
Mirror of "Take a specific card", from the target's side (`giveCard`): the opponent names a card and it
leaves YOUR hand. `start()` → `pickWanted(card)` → `confirmWanted()`. Phases
`idle → choose → picked → (take | miss)`; stages `from → center → up`.

**Visual result**
The opponent's catalog stands in the middle band — the same `CardCatalog` the taker picks from,
broadcast, so you watch them choose. The named card holds enlarged while the rest of the catalog slides
away; then, if you hold that card, it lifts out of your fan, flies to the stage centre, flips
**face-down** (it is theirs now) and sinks into the taker's **seat**, shrinking into a card-sized box
inside it and dissolving as their hand counter goes up. Else a "you don't have that card" note shows
and nothing leaves.

**Elements / refs**
- `rootRef` (stage — the centre is measured against it, not `window`: the playground has a sidebar),
  `handRef` (your fan — the slots are its inner children), `seatRefs[id]` (the opponents' `Seat` nodes;
  the take lands in `TAKER`'s).
- The opponents are **`Seat`s**, exactly as on the table: their hands are hidden there and the counter
  IS the hand. There is no opponent fan in this scene to fly into or tuck behind.
- State: `phase`, `wanted`, `hand`, `taken` (what the taker has gained this run), `take: { card, from,
  center, up }`, `stage`, `flipped`.

**Sequence**
1. `start()`: `setPhase('choose')` — `CardCatalog` opens across `.grid` (base deck, no triggers, cells
   at `GRID_W`) with `ConfirmAction` under it. Naming a card is irreversible, so a click only ARMS the
   pick (`pickWanted` → `wanted`; the cell lights in the shared selection colour) and the bar commits
   it.
2. `confirmWanted()`: `setPhase('picked')` — the catalog goes `open={false}` with `chosen={wanted.id}`,
   which is what holds the named card enlarged while the rest slide away — and
   `later(() => resolve(wanted), PICK_BEAT)`. From here your fan is `pointer-events: none` for the whole
   sequence, the same guard Combo, AI cards and Cherry-pick take while they resolve.
3. `resolve(card)`: find the card in YOUR hand by id. **miss** (`index < 0`) → `setPhase('miss')`, the
   `.miss` note, `later(backToIdle, MISS_HOLD)`; nothing leaves and nothing flinches. **hit** → read the
   source slot's rect; compute two transforms — `center` (to the stage centre from `rootRef`,
   `scale(REVEAL_W / r.width)`, `rotate(0deg)`) and `up` (to the centre of
   `cardBoxIn(seatRect, r.width * SEAT_SHRINK)`, scaled to that box, `rotate(0deg)`); drop the card from
   `hand` so your fan closes the gap; `stage = 'from'` → **double-rAF** → `stage = 'center'`.
4. `onTakeEnd` (transform end): `center && !flipped` → `flipped = true` (`Card faceDown={flipped}` — it
   turns **face-down**, it is the opponent's hidden card from here), then `later(setStage('up'),
   CENTER_HOLD)`. `stage === 'up'` → `setTaken(n + 1)` (the taker's `handCount` now carries it),
   `setTake(null)`, `later(backToIdle, 620)`.

**Params & timings**
| Step | Value |
|---|---|
| chosen holds / others leave | `PICK_BEAT = 620` ms |
| each hop | CSS transition on `.take` (`transform` + `opacity`), `--ease-soft`, 460 ms |
| centre width | `REVEAL_W = 220` px |
| centre hold before it sinks into the seat | `CENTER_HOLD = 820` ms |
| how small it gets inside the seat | `SEAT_SHRINK = 0.7` of the source slot's width |
| miss note | `MISS_HOLD = 1620` ms |
| back to idle once it has landed | `later(…, 620)` ms |
| your hand / catalog cell | `INITIAL_HAND = 6` · `GRID_W = 100` |

**Invariants**
- The card ends **face-down inside a seat**, not in a fan. It aims at
  `cardBoxIn(seat, width * SEAT_SHRINK)` and never at the seat's own rect (**I6** — a seat is far wider
  than a card, and a card told to fill it would inflate), shrinks into that box and fades. This is the
  `dealToSeat` movement, the same one `Draw card` uses for a card going to a hidden hand — expressed
  here as a CSS transition rather than the preset, because the whole two-hop flight is one
  transitioning node.
- The centre is measured against the **stage** (`rootRef`), not `window` (**I1** + the sidebar).
- Two hops (`from → center → up`) on one node at a constant `zIndex: 55`. There is nothing to tuck
  under: the destination is a seat, and a seat is not a stack of cards.
- **No `useHandArrival`** — the card leaves a hand, it does not settle into one. That is the one thing
  separating this from its mirror, and the thing a later refactor unifies by accident.

**End state & cleanup**
Hit → the card is gone from your hand and the taker's counter is one higher; back to `idle`. Miss →
nothing leaves. `restart` clears the timers, rebuilds your hand and zeroes `taken`.

**Building blocks**
`CardCatalog` (`open` / `selected` / `chosen`) · `ConfirmAction` · `Seat` ·
[`cardBoxIn`](./reference.md#card-geometry-helpers) · `Hand` · CSS transitions on `.take`.

**Live reference**
`Opponent takes your card` — `apps/playground/stories/interactive/OpponentTakesCardStory.tsx`.

---

## A card changes hands (live board) — taker, victim, watcher, and the ask before them

Driven by `requested` and `handTransfer`, planned by `planBeats` and run by `transferBeat`
(`useTransferBeat`). The two recipes above are its playground originals, and the board **translates**
them rather than transcribing them: there is no opponent fan here — an opponent's hand is a `Seat` and
a count — so the named steal and the random one both come out of the donor's seat. The gesture
survives; the geometry belonged to a stage with no seats in it.

**When to call**
Never directly. `useBeats` plans a `requested` beat from the engine's `requested` event and a
`handTransfer` beat from `handTransfer`, and runs them through `runRequested` / `runTransfer`. Neither
is `exclusive` and neither raises `alarm`: a card changing hands does not own the table, and nothing
about it needs input dead.

**Visual result**
Three of them, and which one you get is decided by what the event carried rather than by a rule the
board re-derives.
- **Taker** — the card comes out of the donor's seat, turns face-up at the centre, stands, and settles
  into your fan. If the steal was random rather than named, the donor's backs fan out of their seat
  first, hold, and go back.
- **Victim** — the mirror: the card leaves your own fan, flies to the centre, turns face-**down**, and
  sinks into the taker's seat.
- **Watcher** — a closed card crosses the table from one seat to the other; nothing turns over and the
  two counts are all that changes.

And before any of them, when the card was demanded by name: the named card stands at the centre for the
whole table, then either hands over to the projection (hit) or is followed by the flinch and the note
(miss).

**Elements / refs** — all from `BoardAnchors`
- `centre` — the attack slot; every leg of every branch stages there.
- `seatBox(player)` — a card-sized box centred on a seat (**I6**), shrunk again to
  `CARD_W * SEAT_SHRINK` for the size a card is while it is inside a hidden hand: the exact box
  `dealToSeat` sinks into and `takeFromSeat` comes out of.
- `seatOf(player)` — the seat NODE, for the miss flinch.
- `hand` — your own fan. `useHandArrival` for the taker, `handSlotAt(index)` for the victim's source
  slot, and the flinch target when the miss is aimed at you.

**Sequence — `runRequested` (the ask)**
1. Raise the named card face-up at the centre and `play('popIn')` — on EVERY peer, the asker included.
   `requested` carries no `visibleTo` and its `hit` field reaches everybody, because the rules make the
   request public on a hit and a miss alike (`docs/rules/cards.md:125`). It **appears** rather than
   travels: the one candidate origin is the catalog cell the asker named it in, and that cell belongs
   to a staging hook this beat can neither see nor measure — so no peer gets a flight, rather than one
   peer getting a different scene from the rest of the table.
2. **Hit** — publish the `giveCard` pending into the beat's own shadow, `await nextFrames()` so the
   publish has committed (**I2**), then `drop`. The beat is only the entrance: `requested` and
   `handTransfer` arrive in **different batches**, so no overlay can span the gap. What carries the card
   across it is `_Board.tsx`'s own centre render of `cardById(pending.requested)`, public to every peer
   (`fake/attacks.ts:444` projects `giveCard` with no `mine` gate). Publish first and drop second, so
   the static render is standing before the carrier lets go and the slot is never blank for a frame —
   the same ordering, for the same reason, as `drawBeat`'s standing trigger.
3. **Miss** — the pending clears outright, so nothing in the projection survives it and the beat has to
   carry the whole scene or the table never learns the outcome. `wait(REQUEST_HOLD)` with the named card
   standing, `play('shake', …, SHAKE)` on the target, the note, `wait(MISS_HOLD)`, `drop`. The target is
   flinched **as they are rendered**: `seatOf(target)` to everyone watching, and `anchors.hand` — their
   own fan — when the miss is aimed at you, because you have no seat. One gesture, two renderings: the
   fan flinch is the playground's original and the seat flinch is its translation.

**Sequence — `runTransfer` (the card)**
One branch, on `plan.role`.
- **taker** — `takeFromSeat` from the donor's seat box to the centre; `pin` (**I4**); the donor's count
  drops and is published as its own step; `patch({ faceDown: false })`, so the `Card` plays its own
  `flipCard`; `wait(REVEAL_HOLD)`; measure the flyer, `drop`, then `arrive(…, grown, grown)` into the
  fan at its **end** — `grown` is read off `ctx.base.you.hand.length`, the fan this beat has grown so
  far (**I8**), and the end is not a choice: the engine appends what a hand gains and `toBoardState`
  passes that order through untouched, so any other slot makes the beat's last frame disagree with the
  projection it hands over to.
- **the offer — the taker's leg only, and only when `plan.named` is false** — before the flight,
  `plan.donorHand` backs (capped at `OFFER_MAX`) rise out of the donor's seat box on `takeFromSeat`,
  staggered `OFFER_STEP` apart, into the shallow arc `offerPoses` lays across the centre; they hold
  `OFFER_HOLD` and return on `dealToSeat`. The taken card is **not** among them — it flies on its own,
  out of the same seat, so the offer clears whole rather than one card short. Nobody picks and nothing
  waits for input: `stealRandom` has already chosen, with the seeded RNG. The offered hand is the only
  thing that makes "a card at random" read differently from "the card I named", which otherwise share
  one flight.
- **victim** — out of `handSlotAt(index)`, the index resolved here against the hand this beat planned
  against (the registry indexes rather than looks up by uid, deliberately, so it need not know the
  hand); your fan closes the gap while the card is in the air; `playToCenter`; `pin`;
  `patch({ faceDown: true })` — it turns **face-down**, and that is the beat, because from here it is
  theirs and a hidden hand is where it is going; `wait(CENTER_HOLD)`; `dealToSeat` into the taker's seat
  box; `drop`; their count goes up. **No `useHandArrival`** — the card leaves a hand, it does not settle
  into one.
- **watcher** — `plan.card` is absent, so there is nothing to turn over and nothing to hold at the
  centre to be read. `takeFromSeat` out of the donor's seat box to the centre on a `COVER` stand-in that
  carries no identity, `pin`, the donor's count drops, `dealToSeat` into the taker's seat box, `drop`,
  the taker's count goes up. Face-down for every frame.

**What selects the closed flight**
`plan.card`, and nothing else. Present means the engine put this peer in the event's audience; absent
means it did not, and nothing here widens it — re-deriving who may see what is how a hand leaks. The
three derived facts are all read off the **pre-batch** projection (**I1**): `role` off `selfId`,
`named` as `base.pending?.kind === 'giveCard'` (a plain equality against a public pending — the
transfer's own batch says nothing about whether it was demanded, because `requested{hit:true}` opened
that pending in an earlier reduction), and `donorHand` as the donor's count while it still stands on
screen, since `live` has already taken the card out.

> The watcher leg is currently **unreachable in production**: the engine tags every `handTransfer` with
> `visibleTo: [from, to]` and `forViewer` drops the whole event for anyone else, so a bystander sees no
> transfer at all. The leg ships because it expresses the "never widen a redacted event" property, and
> it stays correct the day `handTransfer` becomes public with `card` redacted the way `drawn` already
> is. Recorded in [`backlog.md`](./backlog.md) and in the audit register.

**Params & timings**
| Step | Preset / wait | Value |
|---|---|---|
| the named card appears at the centre | `popIn` | 260 ms |
| it stands before the outcome | `wait(REQUEST_HOLD)` | 820 ms |
| the flinch | `play('shake', …, SHAKE)` | `{ amp: 9, dur: 460, shape: 'spring' }` — a whole seat or a whole fan flinching, not the 7px `settle` sized for an input |
| the note, before the scene clears | `wait(MISS_HOLD)` | 1620 ms |
| seat → centre | `takeFromSeat` | 460 ms |
| centre → seat | `dealToSeat` | 460 ms |
| hand slot → centre | `playToCenter` | 480 ms |
| face-up at the centre (taker) | `wait(REVEAL_HOLD)` | 820 ms |
| face-down at the centre (victim) | `wait(CENTER_HOLD)` | 820 ms |
| into the fan | `useHandArrival` | `FLIGHT_MS = 480` |
| a card's size inside a seat | `SEAT_SHRINK` | 0.7 of `CARD_W` (`drawBeat`'s own value) |
| the offer: stagger · hold · spread · cap | `OFFER_STEP` · `OFFER_HOLD` · `OFFER_SPREAD` · `OFFER_MAX` | 45 ms · 620 ms · 0.62 of the centre's width · 9 backs |

Every hold above is the stories' own number, carried over rather than chosen here. `PICK_BEAT = 620` is
the one that did not come with them, and the board has no equivalent constant: `CardCatalog`'s `chosen`
cell holds by CSS alone (`scale(1.7)` while its neighbours leave over 220 ms) and the band unmounts the
moment the pending stops being a `requestCard`. So the ask is paced by the engine's own round trip, and
the readable pause belongs to `runRequested` — `popIn` and, on a miss, `REQUEST_HOLD`.

**Invariants**
- **I1** — the plan reads the projection still on screen, so the donor's count is the one the table can
  see and the victim's own hand is the one their fan is rendering.
- **I2** — `nextFrames()` between publishing the `giveCard` shadow and dropping the carrier, so the
  static render has committed before the flyer lets go.
- **I4** — the carrier is pinned at the centre after each arrival there, so the flip, the hold and the
  onward flight all leave from where the card visibly stands.
- **I6** — every seat end of every flight is `cardBoxIn(seatBox(player), CARD_W * SEAT_SHRINK)`, never
  the seat's own rect.
- **I8** — the taker's `grown` is read off `ctx.base`, the hand this beat has already grown, not off
  the hand the batch started with.
- Local: `plan.card`'s absence, not `role`, is what selects the closed flight; and the last frame of the
  hit entrance is the projection's own centre render, so the handover changes nothing on screen.

**End state & cleanup**
Taker: the card spliced into your fan at its end, the donor one count lighter. Victim: the card gone
from your hand, the taker one count heavier. Watcher: both counts moved, nothing else. The carrier is
dropped on every path, the offer's backs are dropped by key, and the miss note is cleared before the
beat returns. A beat that throws costs the animation and never the state — `drain()` drops the shadow in
its `finally` and the live projection wins. A missing rect (a seat that is not mounted, a hand slot that
is not there) ends the leg early and lets the projection stand, the contract every runner keeps. A new
match calls `reset()`: the carrier goes and so does a parked arrival, which would otherwise land a dead
match's card in the new one's fan.

**Gating**
The ask is answered in the middle band, not in the panel. `_useRequestStaging.tsx` stands a
`CardCatalog` there while a `requestCard` pending is ours — `open` while unconfirmed, `selected` for the
armed pick, `chosen` after `ConfirmAction` commits it, because naming a card is irreversible — and
`_Board.tsx` suppresses `PendingPrompt` for `requestCard` and `giveCard` the way it already does for
`defend`, `discardForRelease` and `neutralize503`. What the catalog offers is the base deck without
triggers (`docs/rules/cards.md:320`, `:339`) and without the events deck
(`docs/rules/general.md:189`) — every card that can actually BE in a hand, both exclusions cited; the
`confirm` handler re-checks membership against that same list, so a stale selection cannot resolve a
card that is no longer on offer. `giveCard` gets no panel at all: the engine asks the victim which COPY
to surrender, the copies differ only by uid and `onGiveCard` matches on `card.id`, so the choice carries
no information and the hook auto-resolves it — once per pending, latched on the pending's own identity
rather than on the mount, because a second Security Bug in one match is an ordinary thing.

**Under `prefers-reduced-motion`**
No beat is planned and none runs; the board holds the projection it already has. The `giveCard`
auto-resolve still fires — it lives in the staging hook and not in a beat for exactly this reason: it is
a game action, and an engine left waiting on an animation nobody plays is a stalled match.

**Building blocks**
[`takeFromSeat`](./reference.md#presets) · [`dealToSeat`](./reference.md#presets) ·
[`playToCenter`](./reference.md#presets) · [`popIn`](./reference.md#presets) ·
[`shake`](./reference.md#presets) · `flipCard` (auto, via `Card`) ·
[`useHandArrival`](./reference.md#hand-arrival--cards-arrive-in-the-hand) ·
[`useFlyer`](./reference.md#the-movement-steps-and-the-carrier-under-them) ·
[`cardBoxIn`](./reference.md#card-geometry-helpers) · `CardCatalog` · `ConfirmAction`.

**Live reference**
Not a playground scene — this beat runs on the real board:
`apps/frontend/src/features/board-beats/transferBeat.tsx`, with the plans in
`features/board-beats/planBeats.ts`, the ask in `pages/board/[gameId]/_useRequestStaging.tsx` and the
public centre card in `pages/board/[gameId]/_Board.tsx`. The playground originals are the two recipes
above plus `Specific opponent card`.

---

## Git Cherry-pick — choose a card out of the whole discard

> **Status: prototype.** The rules-complete resolution is pending the #61 open-questions rework (deck splitting,
> sudo-to-top-of-deck, empty-discard handling). This recipe transcribes the current showcase.

**When to call**
Play Cherry-pick → `deal()`. Phases `idle → deal → choose → resolve → done`. base: 1 card → hand; sudo: 2 cards →
one to hand, the other onto the top of the draw deck (face-down; the first deck if several). Triggers are
unpickable in base; in sudo a trigger can only be the deck card (a non-trigger always takes the hand slot).

**Visual result**
The discard deals out of its pile into a large, readable selection grid (staggered); you click your pick(s). The
chosen card flies to the centre, enlarges, holds, then drops into your hand; a sudo second card flips face-down
and flies onto the draw deck; the unpicked cards return to the pile in their original order (no reshuffle).

**Elements / refs**
- `pileRef` (discard), `deckRef` (draw deck), grid slot refs, `handRef` (`useHandArrival`).
- State: `phase`, the discard pool, picks, `deckCount`, the size toggle `SIZES = [8, 54]` (no-scroll vs scroll).

**Sequence**
1. `deal()`: measure the pile rect (**I1**); `setPhase('deal')`; deal each discard card to its grid slot, staggered
   `DEAL_STEP` (capped at `STAGGER_CAP`), `DEAL_DUR` each; → `setPhase('choose')`.
2. Pick (base 1 / sudo 2) under the trigger rule above.
3. `resolve` (`setPhase('resolve')`): the hand card flies to the centre (`REVEAL_W`, `REVEAL_DUR`), holds
   `REVEAL_HOLD`, then `useHandArrival` into the fan; a sudo deck card `flipCard` face-down (`FLIP_DUR`), holds
   `DECK_HOLD`, then `play('returnToDeck', {from, to: deckRect})` (`DECK_DUR`); the rest return to the pile via
   `play('centerToDiscard', toDiscardParams(from, pileRect, scatterAt(...), !visible))`, staggered `RETURN_STEP`
   (`RETURN_DUR`), keeping order. → `setPhase('done')`.

**Params & timings**
| Step | Value |
|---|---|
| deal out / stagger | `DEAL_DUR = 360`, `DEAL_STEP = 16` (cap `STAGGER_CAP = 40`) |
| return to pile / stagger | `RETURN_DUR = 420`, `RETURN_STEP = 14` |
| flip before deck flight / hold | `FLIP_DUR = 420`, `DECK_HOLD = 360` |
| deck flight | `DECK_DUR = 480` (`returnToDeck`) |
| reveal → hand | `REVEAL_W = 220`, `REVEAL_DUR = 460`, `REVEAL_HOLD = 560` |
| grid / pile width | `GRID_W = 150`, `PILE_W = 132` |

**Invariants**
- Extracting cards **must not reshuffle** the discard — the rest keep their order (`scatterAt` is deterministic by
  card key, **I7**); `HEAP_SHOW` bounds how many pile cards render.
- **I1 / I3 / I4** on every flight.

**Building blocks**
`play('returnToDeck' / 'centerToDiscard')` · `scatterAt` / `restTransform` / `toDiscardParams` / `HEAP_SHOW` ·
`useHandArrival` · `Card` `flipCard`.

**Live reference**
`Git cards` → Cherry-pick — `apps/playground/stories/interactive/GitCards/CherryPick.tsx`.

---

## Git Rebase — look at the top 3 of a deck and reorder them secretly

> **Status: prototype.** Pending the #61 rework (per-player deck knowledge, open question 9).

**When to call**
Play Rebase → phases `idle → pick → deal → order → resolve → done`. base: one deck (with several, first `pick`
which). sudo: every draw deck at once (one row of 3 per deck, sharing one 1-2-3 numbering; 1 = the new top).

**Visual result**
The top 3 cards fly out of the deck into a numbered reorder row; you reorder them (full size — the area scrolls
rather than shrinking); then they flip face-down and fly back onto the deck in the chosen order.

**Elements / refs**
- Deck pile refs, reorder-row slot refs. State: `phase`, per-deck rows, the chosen order, `deckCount`.

**Sequence**
1. `pick` (only with several decks) → choose the deck. `deal`: cards fly out `DEAL_DUR`, staggered `DEAL_STEP`,
   settle `DEAL_HOLD` → `order` (interactive).
2. `order`: reorder the row (rows numbered 1-3 on top).
3. `resolve`: `flipCard` face-down (`FLIP_DUR`), hold `FLIP_HOLD`, then `play('returnToDeck', {from, to:
   deckCenter, duration: BACK_DUR})`, staggered `BACK_STEP` → `done`.

**Params & timings**
| Step | Value |
|---|---|
| deal out / stagger / settle | `DEAL_DUR = 520`, `DEAL_STEP = 80`, `DEAL_HOLD = 200` |
| flip before flying back / hold | `FLIP_DUR = 420`, `FLIP_HOLD = 260` |
| back to deck / stagger | `BACK_DUR = 600`, `BACK_STEP = 90` |
| geometry | `REORDER_W = 150`, `GAP = 30`, `ROWS_GAP = 24`, `CARD_RATIO = 1.4` |

**Invariants**
- The reorder is **secret** (deck knowledge is not modelled — #61 open question 9); the cards fly back face-down.
- **I1 / I3 / I4** on every flight.

**Building blocks**
`play('returnToDeck')` · `Card` `flipCard` · a CSS-transition reorder row.

**Live reference**
`Git cards` → Rebase — `apps/playground/stories/interactive/GitCards/Rebase.tsx`.

---

## System Upgrade — every other player discards one card to the centre

> **Status: prototype.** Pending the #61 rework.

**When to call**
Play System Upgrade → phases `idle → throw → (hold | choose) → resolve → done`. base: the thrown cards go to the
discard. sudo: the player first takes one thrown card into their hand, the rest go to the discard.

**Visual result**
Each opponent throws one card from their seat to the centre (staggered, growing from small to full size). base:
after a hold they all sweep to the discard. sudo: the player picks one — it reveals at the centre, enlarges,
holds, drops into the hand — and the rest go to the discard.

**Elements / refs**
- Seat refs (throw sources), `centerRef`, `pileRef` (discard), `handRef` (`useHandArrival`).
- State: `phase`, opponent count `OPP_COUNTS`, the thrown cards, `sudo`.

**Sequence**
1. `throw`: each opponent's card flies seat → centre, `THROW_DUR`, staggered `THROW_STEP`, scaling `THROW_SCALE →
   1`.
2. base → `hold` (`HOLD_MS`); sudo → `choose`.
3. `resolve`: a sudo pick reveals to the centre (`REVEAL_W`, `REVEAL_DUR`), holds `REVEAL_HOLD`, `useHandArrival`
   into the fan; the rest go to the discard via `play('centerToDiscard', toDiscardParams(from, to, scatterAt(...),
   !visible))`, staggered `CLEAR_STEP` (`RETURN_DUR`) → `done`.

**Params & timings**
| Step | Value |
|---|---|
| throw to centre / stagger / scale | `THROW_DUR = 460`, `THROW_STEP = 260`, `THROW_SCALE = 0.42` |
| base hold before discard | `HOLD_MS = 2500` |
| centre → discard / stagger | `RETURN_DUR = 420`, `CLEAR_STEP = 90` |
| sudo reveal → hand | `REVEAL_W = 220`, `REVEAL_DUR = 460`, `REVEAL_HOLD = 560` |
| widths | `CENTER_W = 150`, `PILE_W = 132` |

**Invariants**
- **I1 / I3 / I4** on every flight; `scatterAt` / `HEAP_SHOW` for the discard (**I7**).

**Building blocks**
`play('centerToDiscard')` · `scatterAt` / `restTransform` / `toDiscardParams` / `HEAP_SHOW` · `useHandArrival`.

**Live reference**
`Git cards` → System Upgrade — `apps/playground/stories/interactive/GitCards/SystemUpgrade.tsx`.

---

## Hand limit — discard the hand down to the limit

**When to call.** End of turn, the hand is over the limit. Guard: a pull-out is accepted only while
`hand.length > limit`; at or under it `Hand` rejects the drop and glides the card back.

**Visual result.** Discarded cards do **not** trickle into the heap one at a time. They build an open
**grid** at the centre — everyone reads the whole cost of the turn — and only when the last excess card
lands does the finished grid leave for the discard.

**Elements / refs.** The `Hand` fan; a grid of cells at the centre (`cellRefs`); the `Pile` discard
(`boxRef`); a flight overlay per card in transit.

**Sequence.**
1. The excess is known before anything moves (`hand.length − limit`), so the **grid shape is chosen
   upfront** — 1–4 one row, 5–6 two rows of 3, 7–8 two rows of 4, 9–10 two rows of 5, past 10 three
   rows. Every card therefore flies straight to **its own cell**, never to a growing pile.
2. Each pull-out: claim the next free cell, remove the card from the hand, `playToCenter` from the fan
   slot's card box into that cell. The flight entry carries the source rect (`at`) so the flyer paints
   on the card from its first frame — **[I10]**. Several run **concurrently** — a flight must never
   gate the next drag (discarding is "think, then dump fast").
3. **A card laid out is not yet discarded — it can be carried back.** Press one in the grid and it
   comes off onto a flyer at the cursor: the cell is released back into the free set and the card
   leaves `placed`, so the grid does not hold a hole where it was. While it travels the hand parts
   **at the pointer** — `gapAt` driven from `slotAt(clientX)` whenever the cursor is over the band
   (`BAND_PAD` above the fan, the same tolerance the hand itself uses), `gapSize` 1 — and the hand
   is told `carrying`, so it offers nothing else: no lift, no zoom preview.
   - Released over the band → `arrive([…], hand.length, slot)` with the slot the pointer named
     (**not** the middle — see the arrivals recipe). Handing the gap from the scene to the step is
     the same slot, so nothing shifts as one takes over from the other.
   - Released anywhere else → `playToCenter` back into the cell it came from. It goes home rather
     than snapping, because snapping reads as the drag having failed.
4. The grid is held open (`GRID_HOLD`).
5. The whole grid leaves through **`useDiscardExit`**: one entry per placed card, `node` = its cell
   element, `layer` = its slot, `delay` = `slot × CLEAR_STEP` — one by one, but as one movement.

**Params & timings.** grid card width 150 / 132 / 116 px by row count · `GRID_HOLD` 1500 ms ·
`CLEAR_STEP` 90 ms · flights `playToCenter` 480 ms · carry-back band `BAND_PAD` 32 px.

**Invariants.** **I1** measure the cell before it unmounts · **I8** the card, its slot and its source
rect come in as arguments (the sequence spans several awaits) — and the carry-back's drop slot is read
through a **ref**, since its handlers are the closure they began with · **I10** every concurrent flyer
carries its own mount rect · a `runId` guard drops flights from a previous deal.

**End state & cleanup.** Cells released, `placed` cleared, grid size back to 0, the cards lie in the
heap. A carried-back card is in the hand again and its cell is free — the cells are tracked as a
claimed SET rather than a count, or a card returning to the grid would take the next free cell instead
of the one it left.

**On the board (#104).** The scene is split across the two halves of the board's own machinery, and
the split is what keeps the promise "the hand is never blocked by a flight":

- **The gesture** (`pages/board/[gameId]/_useHandLimit.tsx`) owns everything before the engine
  answers: the pull gate (`pending.options` for legality, `excess` for the limit), one carrier per
  card — no single-flight guard, unlike its three sibling hooks — the grid's claimed cells, the
  carry-back, and the single `RESOLVE` fired when the last card LANDS.
- **The beat** (`features/board-beats/handLimitBeat.tsx`) owns everything after: it adopts the grid
  the local player built (through `HandLimitHandoff`) or builds the same one from the actor's seat
  for every other peer, holds `GATHER_HOLD`, and sends every card out with `layer` = its slot and
  `delay` = `slot × CLEAR_STEP`.

The geometry both halves read is `@release/ui`'s `TableCentre/discardGrid.ts` — the shapes, the
widths and the cell offsets, quoted from this scene.

**Live reference.** `Hand limit` (Cards group).

---

## Defending a release — the whole turn, play through defence

**When to call.** Turn start with a Release in hand. The turn is a chain: play → cost → attack window
→ answer.

**Visual result.** A Release pulled from the fan stands at the centre and does **not** land — by the
rules it costs one card, and the cost is shown open beside it. Only then does the Release settle into
its zone slot and the opponents' attack window opens.

**Where the places come from.** The five slots are not the scene's own numbers any more: their
height, offset, width and layer come from `CENTRE_SLOTS` / `CENTRE_SETS` (`table/TableCentre/centre.ts`),
which is also what the board reads — see [`reference.md`](./reference.md#centre-of-the-table--the-places-a-card-lands-in).
The line asking for the cost is the `AskLine` component, hanging off the centre's own height. And the
defence folding with your own sudo goes through the `usePairFold` step rather than a hand-written
sequence.

**Elements / refs.** Stage / cost / centre / sudo / cover slots around the table centre (each
axis-aligned, the tilt on an inner `.pose` element so the slot rect stays the true card box); the
`ReleaseZone` (`slotRef`); opponent `Seat`s; the `Pile` discard; the `Hand`.

**Sequence.**
1. **Play** — the Release flies to the stage slot and waits. A press on nothing valid takes it back
   (see *cancel* below).
2. **Cost** — any hand card pays: it flies to the cost slot, is held open, then leaves via
   **`useDiscardExit`**. Only now does the Release fly into its zone slot (`playToReleaseZone`, LAND).

   **On the board** this is the acting player's own view — the cost is picked out of the fan by a
   click, never a bar control (`_useBoardStaging.ts`'s `onCostPick`), and stays held open as the
   static `paidCost` render until the same runner that places the Release flies it out. Anyone else
   at the table sees it differently, because the engine pays the cost and places the Release in
   **one** reduction and emits nothing in between — no `released` preceded by a cost event of its
   own: the cost card flies in from the actor's own seat, holds (`SHOW_HOLD`), and leaves; only then
   does the Release itself fold in from that same seat and fly on into its zone slot. One runner
   behind both views — `comboBeat.tsx`'s `runRelease` — and, since Task 11 widened it, behind every
   Release's cost leg, not only a Code-Review-paired one's.
3. **Attack** — thrown from a seat: aimed with `cardBoxIn` at a card-sized box inside the seat, not at
   the whole cell (**I6**), landing already at its table tilt (**I7**). A sudo-backed attack travels as
   one `CardPair`.

   **On the board** the arrival is `foldIn`/`foldIntoPair` (620 ms, translate + scale only) rather
   than the scene's `playToCenter` (480 ms, which carries `rotate`) — one runner serves a lone
   attack and a sudo pair alike. So the landing does **not** carry the tilt, and the card's REST
   pose supplies it instead: the pending centre render sits in an inner `.pose` element at
   `restTransform(ATTACK_POSE)`, exactly as the cover and sudo slots do. That rest pose is also what
   the exit starts from (`useDiscardExit`'s `pose` — "the table tilt it starts from"), so without it
   the attack popped from 0° to −4° on the exit's first frame (#101, Fix A, Defect 2). The step that
   ends this is now in the vocabulary — **`landInPose`** carries the tilt with the card and lands it
   already wearing it (**I11**) — and the board's single-attack path is what has to call it; the pair
   path stays on `foldIntoPair`. The gap
   between the two arrivals is in [`backlog.md`](./backlog.md) and the audit page's register.
4. **Answer** — a defence covers the attack; both leave as **one exchange** through `useDiscardExit`,
   each carrying its table layer so the heap keeps the order they lay in (**I9**). The cover's own
   source is resolved in the order `foldIn` resolves one — the fan slot the card left, then the
   defender's seat — with the cover slot itself as the last resort: `seatBox` is null for the LOCAL
   player, so our own defence on a REJOIN (no handoff to inherit) used to neither fly nor stand, and
   the exit then started from an empty box.
   - The player's own **Sudo** takes its **own** slot with an arrow pointing out of it, then folds with
     the chosen defence into a pair — a frame-by-frame merge of the two elements already on screen, no
     duplicate and no teleport.
   - **Security Bug** does not burn the release: it crosses into the attacker's zone and morphs into
     its LOD reading **in flight** (opponents' cards read at a glance, not in full).
   - **Rollback** sends the attack back — plain to the thrower's hand, under Sudo into your own via
     `useHandArrival`; the sudo that backed it is spent and leaves normally.
5. **Cancel** — a press on nothing valid takes back whatever is staged (the Release awaiting its cost,
   or the Sudo awaiting its defence) through `useHandArrival`, into the middle of the fan. **On the
   board**, taking back a Release still waiting on its cost is not a local undo: `_useBoardStaging.ts`'s
   `cancel` dispatches the engine's own `cancelRelease` choice, and — in the same call, no `await` in
   between — the card flies home right away, optimistically: a rejection cannot strand it, since the
   projection puts the card back in the fan either way, whether the pending clears or not. **From
   where it actually stands**: a solo Release from the stage slot, a Code-Review pair from the
   CENTRE, both halves off the pair flyer (#101, Fix C). The press lands on the table root rather
   than on `window`, so nothing portalled above the board can cancel a card the player never touched.
   And the return **reports whether it was taken**: `useHandArrival.arrive` refuses in silence when
   there is no fan to measure or another arrival is already in the air, and every cancel here is
   written on the assumption that the flight's own landing is what puts the gesture back. Refused
   with something else airborne, that one lands and does the clearing; refused with nothing flying at
   all — the local player eliminated mid-step is the live route — the gesture puts itself back by
   hand, or the pair stays invisible and the fan closes over it for the rest of the match (#101,
   Fix D).

**A COMBO Release's cost step is the same step, with one difference the board has to respect.** The
engine raises the identical `discardForRelease` pending (`codeReview` merely rides along), but
`PendingView` carries `release` and NOT `codeReview` — so `staged` is the only thing that knows the
pair, and unlike a solo Release it is deliberately not cleared when the pending echoes back. The
pair therefore stays `merged` for the whole step, and the fan's merged-pair pointer guard has to
yield to it: the fan is that step's only picker (the panel is suppressed for this pending, and
`Hand` has no keyboard path), so an inert fan made the cost unpayable by any input at all. What the
yield costs is the occlusion the guard existed for: the hover preview stands over the pair again for
the whole step, and since it is transparent to the pointer a press on it falls through and the
table's own miss listener cancels the release — reading a card can undo the play. **Both halves are
now closed by an answer rather than by code** (rules owner, 22.08.2026): the preview case does not
exist — a preview is summoned by HOVERING, so it cannot be held while you click what it covers, and
it leaves the moment the mouse does; and the keyboard was never planned — the game is built for the
mouse, so bringing an island back for one step is not the answer. Both entries are closed in
`backlog.md` and the register.

**A Release reaches the stage slot by two roads, and they are one road in the code.** It is
`playable` with nothing to aim at and no partner to fold with, so the fan turns a plain press on it
into a click as readily as into a pull — and the click used to go to the click gesture, which
dispatches the play and tells the stage machine nothing, so the card was hidden from the fan by the
pending that named it and drawn nowhere else (#101, Fix D). Both roads now stage through the same
`stageSoloRelease`; the only difference is where the flight starts, since a click has no drop rect —
the card's own fan slot, measured off the fan's geometry (**I6**). Which road a click is, is the
staging gesture's own question: it takes the click and says so, or declines and the plain gesture —
which owns the window's attack affordance — gets it.

**Params & timings.** `SHOW_HOLD` 1200 ms · `LAND_HOLD` 700 ms · `MERGE_MS` 620 ms · poses: attack
`rot −4`, cover `rot 6, dx 16, dy −12`, sudo `rot −7`.

**Invariants.** **I1** measure every slot before the state clears · **I6** aim at card boxes, never at
rotated slot rects · **I8** the sequences span many awaits — refs, not closures · **I9** each card
carries its layer into the heap.

**Across a match.** `<Board>` is not remounted for a rematch (`_layout.tsx` gives it no `key`), so
both gestures take a `matchKey` and wipe themselves on it — the same boundary `useBeats` already
resets on. **There is no rematch to boundary, and that is the answer, not a gap** (rules owner,
22.08.2026): a new match is a NEW match — the whole path starts again from the lobby, and a rematch
button was never planned. The single entry into a match therefore remounts the board and the state
dies with the instance. The wipe stays as cheap insurance; the key it hangs on (`intro.gameId`, the
HOST PEER ID — identical for every match in one room) never changes, and now nothing needs it to.
Recorded closed in [`backlog.md`](./backlog.md). Within a match, where the actor's own Release
is relative to the stage slot is ONE `StageState` (`none` / `flying` / `standing` / `leaving`) that
every play sets, rather than three booleans a play could inherit from the one before it.

**Rules encoded.** Two Releases are playable, one per zone slot, and the next waits for the current
one's attack window to close — the dock's green state is that moment. The attack always answers the
Release played **this** turn. The player's Sudo is only offered when the hand actually holds a defence
it can enhance that also works against this attack — under a sudo-backed attack it can enhance nothing.

**Live reference.** `Defense Release` (interactive group). On the board: `_useBoardStaging.ts` and
`_useDefenseStaging.tsx` (`apps/frontend/src/pages/board/[gameId]/`) for the two gestures — playing,
costing and cancelling a Release, and answering an attack — and `features/board-beats/comboBeat.tsx`
(`runRelease`) with `features/board-beats/defenseBeat.tsx` (`runCovered` for the exchange itself,
`runStolen` for Security Bug's crossing and its in-flight LOD morph) for what runs once the engine
has answered.

---

## Entering a game — the interface arrives, then the table is dealt

**When to call.** The game screen opens: the deal is the first thing that happens in a match, and it
is two choreographies in a row, not one. Guard: the whole sequence is armed by a `started` ref —
StrictMode mounts twice and the intro must play once.

**Visual result.** The screen assembles itself in a readable order — navigation, the table's own
ambience, the piles, the players — and only then cards start leaving the deck. The player's five
gather in an open heap at the centre while each opponent's card sinks straight into their seat; the
whole heap goes into the fan closed, turns over, and only after that does the player's release zone
appear.

**Elements / refs.** The page rail; the HUD background layer; the two decks and the discard
(`Pile`); the opponent seats (`Seat`, one ref each); the turn dock; the release zone; the centre
(where the heap gathers); the hand. A `useFlyer` for the cards leaving the deck, a `useHandArrival`
for the heap going into the fan.

**Sequence — 1. the interface arrives.** Every beat is one `play('hudIn', el, …)`, separated by
`BEAT`. Nothing here measures anything: the blocks are in place, they only fade and shift in.
1. The rail slides in from its own edge (`dx: 44`, `RAIL_MS`).
2. The table layer with its grid — a plain fade (`dx/dy: 0`, `BG_MS`). No movement on purpose: the
   ambience does not arrive from a direction, it is switched on.
3. The decks from the left (`dx: -34`) and the discard from the right (`dx: 34`), the second one
   `PILE_STAGGER` behind — they come one after the other, not together.
4. The seats drop in from above (`dy: -28`), each `SEAT_STAGGER` after the previous, and the dock
   rises from below (`dy: 30`, `DOCK_DELAY`) in the same beat. The dock stands in its
   "opponent's turn" state, reading *game start*.

The release zone is **not** in this order — it is the last thing in the whole scene, and only the
player has one.

**Sequence — 2. the deal.** Round by round, the player first, `DEAL_STEP` between cards and
`ROUND_GAP` between rounds.
1. A player's card: `drawToCenter` from the deck's card box to the centre, landing on its own
   `scatterAt(round)` — and it **stays** there. One scatter drives both the flight and the rest, so
   the card lies exactly where it landed (the discard heap's own coupling, **I7**).
2. An opponent's card: `dealToSeat` into `cardBoxIn(seat, from.width * 0.7)` — a card-sized box
   INSIDE the seat (**I6**; the seat's rect is far wider than a card and the card would inflate to
   it) — and dissolves into the seat's counter, which IS their hidden hand.
3. The first round is the Debugger and is dealt **open**; everything after it travels face down.
4. What landed at the centre is collected into a **local array**, never read back off state: this
   closure never re-runs, so its `staged` would still be the empty array it was at mount (**I8**).
5. When all five have landed: `HEAP_HOLD`, then the centre is emptied **in the same commit** that
   starts the flight, and the whole heap goes into the fan with ONE `useHandArrival` call — each
   card handed its place in the heap as `from` and its own tilt as `rot`, all still `faceDown`.
6. `FLIP_HOLD`, then the hand turns over — the `Card`s play `flipCard` themselves off the prop.
7. `REVEAL_HOLD`, and only now `hudIn` brings in the release zone (`dy: 22`).

**Params & timings.** All in the glossary (§4, "The two ends of a match"): `RAIL_MS` 640 · `BG_MS`
900 · `PILE_MS` 620 / `PILE_STAGGER` 180 · `SEAT_MS` 560 / `SEAT_STAGGER` 140 / `DOCK_DELAY` 320 ·
`ZONE_MS` 620 · `BEAT` 320 · `DEAL_LEAD` 420 · `DEAL_STEP` 230 · `ROUND_GAP` 160 · `HEAP_HOLD` 640 ·
`FLIP_HOLD` 380 · `REVEAL_HOLD` 620.

**Invariants.** **I6** aim inside the seat, not at it · **I7** one scatter for the flight and the
rest · **I8** the heap is accumulated locally, not read from state after an await · **I10** each
flyer is raised at the deck's rect and paints there. Plus one local: a `cancelled` flag checked
after every `wait`, so restarting mid-deal does not leave a half-sequence running.

**End state & cleanup.** Five cards face up in the fan, the counters on the seats carry the
opponents' hands, the deck is down by what was dealt, the zone is on screen. Restart clears the
`started` ref, drops every flyer and re-runs the scene by `key`.

**Live reference.** `Game Deal` (interactive group).

---

## Ending a match — the winning release, the poppers, the window

**When to call.** On every engine `gameOver` event whose condition is `release`. The event is the
guard, rather than `released`: a direct play, a Security Bug steal and an AI Release can all finish
the same three-slot condition, after their own placement / window choreography has settled.

**Visual result.** The last release settles into the zone, the poppers go off in code symbols out
of both bottom corners, and the game-over window comes up **while the confetti is still in the
air** — the celebration is not a screen that replaces the table, it happens over it.

**Elements / refs.** The release zone (`slotRef` per slot); the hand; a `useFlyer` for the card
leaving the fan; a layer for the volleys; the `GameOver` window.

**Sequence.**
1. The release is pulled out of the fan and flown into its slot with `playToReleaseZone` (LAND —
   every release lands the same way). The zone is now closed.
2. Three volleys are scheduled at `POPPERS` — `[0, 620, 1450]`ms, powers `[1, 0.7, 1.25]`. Each is
   its **own component**, mounted with its own pieces: the pieces are made once and started once in
   a **mount effect**. Starting them from a render-time ref callback is what killed the pieces
   already in the air — the callback re-fires on every render and `play` stacks a second animation
   on a node mid-flight.
3. A piece is a code glyph with its own colour token and step of the mono scale, thrown from one of
   the two bottom corners inward and up; its arc is `play('confettiFly', node, { dx, dy, peak, spin,
   dur })`. Power drives the count, the reach and the time in the air — that is what makes three
   volleys three events instead of one repeated.
4. At `OVER_AT` the `GameOver` window appears over the table, and the confetti keeps flying **over
   the window**.
5. The complete confetti layer is taken down `CONFETTI_MS` after the first volley went off, by
   which time every piece from all three volleys has flown its arc out.

**Params & timings.** `POPPERS` `[0, 1] [620, 0.7] [1450, 1.25]` · `POP_PER_SIDE` 33 · `OVER_AT`
2400 · `CONFETTI_MS` 8500 · piece spread/reach/spin randomised per volley (see the glossary).

**Invariants.** **I5** a fresh node per flight · a local one that cost real time: **a volley must
be started from a mount effect, never from a ref callback** — otherwise every new volley kills the
previous one.

**Layer bounds.** Both layers — the confetti and the window — are `inset: 0` of their stage. In the
playground that stage begins **below** the technical line; on the live board it is the whole table.
The confetti layer is above `GameOver` and does not catch pointer events.

**Live reference.** `Game End` (interactive group); the production runner is
`apps/frontend/src/features/board-beats/gameEndBeat.tsx`, planned by `planBeats.ts` from
`gameOver(condition: 'release')`. A `lastStanding` ending deliberately keeps the existing
elimination-to-window path: no victory scene for that condition has been designed yet, and the gap
is recorded in the animation backlog rather than filled by guesswork.

---

## Turn dock — the state of the turn changes without the dock moving

**When to call.** The turn passes, the phase changes, a player draws — anything that changes what
the dock says. It is the one piece of the table that is always on screen, so it is also the one that
must never twitch.

**Visual result.** The frame stands still. Slots keep their size and place; only what is inside
them changes, by a plain fade. The key/name slot has **one fixed width** (≈ the widest key plus 18px
each side), so a longer nickname never resizes it and nothing beside it shifts.

**Sequence.**
1. Text — phase, key label, nickname — swaps through the `Swap` component: the live layer sits in
   flow, the outgoing one is absolutely overlaid on top of it, and the two are driven by
   `play('rollOut')` → `play('rollIn', el, { delay })`. The `delay` is what makes it sequential: the
   incoming text is held invisible (`fill: 'both'`) until the outgoing one has cleared, so the two
   never cross-fade into a blur.
2. **No movement anywhere** — that is the whole point of the pair. The slot is fixed, so the content
   has nowhere to travel to; a slide here would read as the dock itself moving.
3. The "drawn" badge appears and leaves through `Reveal`: `play('popIn')` / `play('popOut')`, fade
   plus scale in reserved space, so its neighbours do not shift when it comes and goes.
4. The button keeps its frame; only the label swaps (through `Swap`) and the accent morphs by a CSS
   transition. The ring and the dot stay put — the accent transitions on `stroke` / `--dot`, and the
   ring fills back to full on a phase change.
5. **A window over somebody's release is two more phases, and the frame still does not move.**
   `attack` — the window is somebody else's and you may hit it: the key LIGHTS UP rather than
   changing shape (the same ledge, same border and glow, stepped up — a flat fill would read as a
   different control), and dots stand beside it, one per seat that may still hit, going out with each
   pass. `exposed` — the window hangs over YOUR release: the turn colour stays yours, the clock shown
   is the window's, and the key slot holds those same dots, because there is nothing to press.
6. **No warning in the last seconds, and no extending the clock.** Neither was wanted (rules owner):
   an extra accent over the dock's coral is redundant, and in a turn-based game the time for a turn
   is fixed regardless of what the player is busy with — walking off for coffee must not stretch it.
   The timer is its own layer of logic, and this is the direction it is built along.
7. **A watcher never sees somebody else's countdown.** While the table waits on another player, the
   dock names whose decision it is and shows a full, figureless ring: their time is not yours to
   spend, and a number you cannot act on only twitches in front of you. Off entirely (the host's
   table setting), every ring that could carry a clock reads full and numberless — not empty, which
   is a finished countdown, and not zero, which is an expired one.

**Params & timings.** `rollOut` 220 ms · `rollIn` 300 ms with the delay that waits it out · `popIn`
260 ms (SNAP) · `popOut` 200 ms.

**Building blocks.** `TurnDock` (`Swap`, `Reveal`), `RingTimer`, `StatusDot` — see
[`reference.md`](./reference.md#self-animating-components).

**Live reference.** `Table` (the dock on the table screen); every interactive scene that carries a
dock shows it in context.

---

## Chat toasts — a reply surfaces in the corner, the column moves up

**When to call.** Somebody else says something while the chat panel is closed. Your own sends never
toast (you just wrote them) and neither do the feed's technical notes (their place is the history).
While the chat panel is open there are no toasts at all — the log is already in front of you.

**Visual result.** A plate appears at the bottom of the right-hand corner, lifting the plates
already there. Up to four stand at once; a fifth pushes the oldest out of the top. Each holds for
six seconds unless a pointer is over the stack, in which case nothing expires. Plates are of
different heights — the reply inside is shown whole, never clipped.

**Sequence.**
1. Arrival — `play('hudIn', el, { dy: 18, dur: 260 })` on mount. The same "a block arrives at its
   place", only short and from below.
2. Departure — `play('popOut')`, and **the plate takes itself off the stage**: the queue only marks
   it `leaving`, the plate awaits `anim.finished` and calls back. Dropping it on the timer instead
   would cut the animation in half.
3. Neighbours shift — FLIP through `play('flyFrom', el, { from: previousRect, duration: 240 })`. The
   plates have no common step to travel by, so their boxes are measured before and after the commit
   in `useLayoutEffect` and each moves by its own delta. A plate that has just arrived is skipped
   here: it has no previous place, it has its own arrival.
4. The column is pinned to its bottom edge, so the geometry falls out by itself — the oldest leaving
   from the top moves nobody, a middle one leaving lowers those above it.

**Params & timings.** `hudIn` 260 ms (dy 18) · `popOut` 200 ms · the shift 240 ms · the hold 6000 ms
· at most 4 plates · the column 280px wide.

**Building blocks.** `blocks/Toast` — the plate with its own arrival and departure, and `ToastStack`,
the queue that owns what is shown, for how long and in what order. The plate never knows what is
inside it: the reply is rendered by `Message` and handed in.

**Live reference.** The `Toast` page in Blocks (a live stack in its own corner), and the
`Table + chat` screen — the `incoming` button in the technical bar.

---

## What is missing goes to the backlog, not into a recipe

Recipes describe real code, never a plan. **Every animated moment in the playground has a recipe
above** — so a situation you cannot find here is one of two things, and both have the same address:

- it is **not built**, and a recipe would be a guess dressed as documentation;
- it is built but something about it is **unresolved** — no module for a movement you need, a value
  you cannot reach, a rule nobody has decided.

Either way: **do not invent a local solution and move on** — that is how one movement ends up
written three times in three scenes. Write it into [`backlog.md`](./backlog.md) with what it costs,
and raise it. A gap that is not written down is indistinguishable from a gap nobody noticed.

The one caveat standing: the Git cards (Cherry-pick / Rebase / System Upgrade) have **prototype**
recipes — the movements are real and transcribed, only their rules-complete resolution
([#61](https://github.com/MythHand/ReleaseBoardGameP2P/issues/61)) is pending. That is a rules
question, not an animation one.

> This file no longer runs on memory. `apps/playground/stories/docs.test.ts` reads the playground
> navigation and requires every scene in the **Cards** and **Interactive** groups to be named here
> as a live reference, in backticks — the convention every recipe already ends with. Add a scene
> and the test goes red until it has one. Two scenes are exempt by name, each with its reason next
> to it: the audit page describes the modules rather than being one, and the `Animations` catalogue
> is a preset per form, not a game moment.
