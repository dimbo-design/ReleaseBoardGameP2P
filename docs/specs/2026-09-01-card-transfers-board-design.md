# Card transfers on the board — one surface, three sides

**Date:** 2026-09-01
**Project:** ReleaseBoardGameP2P ("Release любой ценой")
**Issue:** [#105](https://github.com/MythHand/ReleaseBoardGameP2P/issues/105) (Wave 5 of
[#88](https://github.com/MythHand/ReleaseBoardGameP2P/issues/88))
**Scope:** Cards changing hands, brought to the real board and driven by engine events: you name a
card and take it, you take one at random, and somebody takes one of yours. The pick catalog is
shared and the victim's scene is the mirror of the taker's, so the three land together rather than
as three passes over one component. The visual source of truth is the three stories —
`PickSpecificCardStory`, `PickOpponentCardStory`, `OpponentTakesCardStory` — and, where they and the
written spec disagree, the stories.

> Builds on the beat queue and the staging seam already on the board: `planBeats`/`useBeats`,
> `useFlyer`/`useHandArrival`/`useDiscardExit`, `BoardAnchors`, and the sibling staging hooks
> `_useDefenseStaging.tsx` (#101) and `_useNeutralizeStaging.tsx` (#102). Nothing here rebuilds any
> of them. Branched fresh from `main` at `9767a08`.

## The goal

A card leaving one hand for another reads as one movement seen from whichever seat you occupy. The
player who takes it watches it come out of a seat, turn over at the centre and settle into their
fan. The player who loses it watches the same card leave their own fan, turn face-down at the
centre and sink into the taker's seat. Everybody else watches a closed card cross the table between
two seats and learns nothing from it. One code path, three audiences, and the branch is on what the
event carried rather than on a rule the board re-derives.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Where `requestCard` is answered | **The `CardCatalog` band, not the panel.** `PendingPrompt` is suppressed for it, exactly as it already is for `defend`, `discardForRelease` and `neutralize503`. The `PICK_BEAT` hold is the first beat of the transfer, and a panel that unmounts when the pending clears cannot hold it. |
| 2 | The `giveCard` step | **Auto-resolved, immediately.** The engine makes the victim pick which copy to surrender; the copies are one card id and differ only by uid, so the choice carries no information. The victim watches the scene instead of a panel. |
| 3 | The miss | **Built, and public to the whole table.** `cards.md:125` makes the request public on a hit and a miss alike, and `requested` carries `hit` to every peer. The refusal is the story's flinch, rendered as the target is: their **seat** to everyone watching, their own **fan** to the target. |
| 4 | The random steal | **The donor's backs fan out of their seat.** Nobody picks — `stealRandom` uses the seeded RNG — but the offered hand is the only thing that makes "a card at random" read differently from "the card I named", which otherwise share one flight. The story's gesture translated, not its geometry: it fans from the top because a playground stage has no seats. |
| 5 | Where the machinery lives | **One staging hook and one beat runner.** A per-scene runner would copy the flight twice and the closed flight three times; folding it into `drawBeat` would put "taken out of a hand" inside the runner for "off a pile". |
| 6 | The seat → centre movement | **A new preset, `takeFromSeat`,** the pair `dealToSeat` has never had. Geometrically it is `drawToCenter`, but that preset's name says it leaves the draw deck; the vocabulary already names movements by meaning over geometry (`returnToDeck` is documented as the pair of `drawToCenter`). |
| 7 | What holds the named card between batches | **The projection.** `requested` and `handTransfer` arrive in different batches, so no beat overlay can span the gap — but `giveCard` is projected unredacted to every peer (`attacks.ts:444`, no `mine` gate unlike `handLimit`), so `pending.requested` is a public render. |
| 8 | `PendingPrompt`'s guess space | **Fixed in the kit, in this task.** The panel offered all 37 catalogue entries, 14 of which can never be in a hand. Narrowed to `HOLDABLE` — the base deck without triggers — with both exclusions cited to the rules text. |

## What the issue asks for, and what the code actually says

### The written spec is stale for two of the three scenes

The issue says the taken card "travels to their fan centre with `rotate(180)`, `zIndex` dropping to
30 on the way up so it tucks behind the fan." `OpponentTakesCardStory` does not do that. Opponents
there are **Seats**, and the card aims at `cardBoxIn(seat, width * SEAT_SHRINK)`, shrinks into it and
fades — the `dealToSeat` movement, the same one `DrawCardStory` uses for a card going to a hidden
hand.

The issue text was copied from `docs/animations/recipes.md`'s "Opponent takes your card" recipe and
from the matching `AnimationAuditStory` entry. **Both are stale**: they were written at `440bc56`
against an older iteration of a story that, at that same commit, already imported `Seat` and already
aimed at a seat box. So the drift is not recent and not the story's fault — the written pair was
never in step with it.

The same is true of the random steal, and worse. `recipes.md`'s "Taking an opponent's card — deal
grid, flip the pick, settle into the hand" names `PickOpponentCardStory` as its live reference and
describes a centred grid built from `gridPositions`, `ORIGIN`, `COLS_MAX`, `DEAL_CARD_W` and
`slotRefs`. That story renders `<Hand faceDown>` sliding down from the top — a fan. Repo-wide those
five names appear only in `GameEndStory`, `ComboStory` and the docs; there is no grid in the scene
the recipe claims to transcribe, and there never was. The audit entry repeats it, and so does the
issue.

The board settles all of it anyway, because the board has no top fan: opponent hands are Seats and
their counts. So both older scenes are **translated** rather than transcribed — the specific hit and
the random steal alike come out of the donor's seat, which is where a hidden hand lives here. The
gesture survives; the geometry belongs to a stage with no seats in it. The stories are right about
what happens, the two spec surfaces are wrong about how, and syncing them is part of this task
rather than a follow-up.

### Triggers cannot be in a hand, and the panel offers them anyway

`PendingPrompt`'s `requestCard` branch (`apps/ui/src/table/Table/PendingPrompt/PendingPrompt.tsx:365`)
builds its options from the whole catalogue — all 37 definitions. The rules text is explicit that two
of them can never be demanded: `cards.md:320` — «Обе карты **нельзя держать в руке**» — and
`cards.md:339` — «В руку триггер не попадает ни на мгновение».

The events deck is excluded by the rules just as plainly: `general.md:189` — «общее число её карт в
игре — 21: каждая **либо в колоде, либо на столе**». Neither exclusion is inferred.

So the story's filter (`deck === 'base' && category !== 'trigger'`) is rules-backed on both halves,
and the panel offered 37 entries where only 23 can be held. **Fixed here**, in the kit rather than
only on the board: `PendingPrompt` now builds its options from a `HOLDABLE` constant carrying both
citations, and both the `complete` guard and the `confirm` membership check read it, so a stale
selection cannot resolve a card that is no longer on offer. The board uses the same filter. Left
unfixed, the panel made a guess that cannot possibly hit look like a legal one — worse than a
missing option, because nothing rejects it and the request simply always misses.

### The rules stand the Security Bug at the centre; the engine has already banked it

`cards.md:126` says the attack card lies at the centre for the whole table while the attacker
chooses — that is the table's evidence it was played. `onHandDefend` (`attacks.ts:191-208`) banks it
with `bankSpent(..., 'attackSpent')` in the **same reduction** that raises `pending: requestCard`, so
by the time the asker is choosing the projection already has it in the discard.

The board cannot stand a card at the centre that the projection says is in the heap. During
`requestCard`, non-askers therefore get the dock line and an empty centre. This is a rules-versus-
engine gap, not a visual one, and it is recorded with the engine ordering named as what would close
it — the same treatment the `handTransfer`-inference entry already has in the register.

### The two halves of a Security Bug arrive in different batches

`requested{hit:true}` sets `pending: giveCard` and returns. The `handTransfer` comes from a separate
`RESOLVE` by the victim — a different reduction, therefore a different batch. Nothing in the second
batch says the transfer was a named one.

It is derivable without inference, from the projection the batch animates away from: while a
`giveCard` is open, `base.pending.kind === 'giveCard'`. That is a plain equality check against a
public pending, not a rule reconstructed from card ids, and `settled` in `useBeats` is exactly the
state to ask (I1).

### The random steal has no decision in it

`stealRandom` (`handAttacks.ts:43-70`) takes `hand[floor(randomAt(seed, rngCursor) * len)]`, logs one
`handTransfer` and raises no pending. `PickOpponentCardStory` presents a fan and lets the player
click a back; the board must not, because there is nothing to choose. The grid ports as a **reveal**:
it deals, holds, flips the card the engine already picked, and returns the rest.

## Architecture

### The plans — `features/board-beats/planBeats.ts`

Two kinds, both pure folds over a batch as everything there is.

```ts
| { kind: 'requested'; key: string; eventId: number
    attacker: string; target: string; card: string; hit: boolean }
| { kind: 'handTransfer'; key: string; eventId: number
    from: string; to: string; card?: string
    role: 'taker' | 'victim' | 'watcher'; named: boolean; donorHand: number }
```

`requested` passes through whole; it is public, so every peer plans it identically. `attacker` and
`target` come off the event rather than off the turn, because a `reflect` (Works on my Machine,
`attacks.ts:260-269`) swaps the roles and the event is the only thing that already knows.

`handTransfer` carries three derived facts, all read off the pre-batch projection:

- `role` — `from === selfId` → victim, `to === selfId` → taker, otherwise watcher. Computed in the
  plan the way `PlannedDraw.mine` already is.
- `named` — `base.pending?.kind === 'giveCard'`, per the section above.
- `donorHand` — the donor's `handCount` on `base`, which is how many backs the grid deals. Read at
  plan time because the live projection has already taken the card out (I1).

`card` is whatever the event carried, and nothing widens it. Absent means this peer is not entitled
to the identity, and that single absence is what selects the closed flight.

### The beat runner — `features/board-beats/transferBeat.tsx` (new)

`useTransferBeat(anchors)`, one `useFlyer` and one `useHandArrival`, in the shape `defenseBeat` has.
Every plan is `exclusive: false` and `alarm: false` — a transfer does not own the table.

**`runRequested`** is two jobs, because the projection survives one outcome and not the other.

On a **hit** the projection holds the card: the pending flips `requestCard → giveCard`, and
`pending.requested` is public, so every peer renders the named card at the centre. The beat is only
the entrance — and it shipped as the SAME entrance for every peer, asker included: a `popIn` at the
centre, with no origin cell for anyone. The asker-specific origin this section originally called for —
the catalog's `chosen` cell holding `PICK_BEAT`, then that cell's card flying to the centre — did not
survive implementation: the beat runs in `transferBeat.tsx`, the `chosen` cell lives in
`_useRequestStaging.tsx`, and a beat cannot measure a DOM node owned by a hook that renders elsewhere
(Task 8). `landInPose` was dropped for an independent, second reason — with `from` and `box` identical
(there is nowhere else to travel from once the origin is gone), it resolves to an identity transform
and animates nothing, so `popIn` took its place. The last frame is still the projection's own render,
so the handover changes nothing on screen (I7).

On a **miss** the pending clears outright and there is nothing to hand to, so the beat carries the
whole scene: the named card raised at the centre, `REQUEST_HOLD`, the refusal, the note, and the
card fading. The refusal has two forms, because the target is not rendered the same way to
everybody. To the asker and to spectators the target is a Seat, so their seat flinches —
`play('shake', anchors.seatOf(target), SHAKE)`. To the target themselves there is no seat; they are
`you`, and what they own is the fan — so their own **hand** flinches, `anchors.hand`. That is not a
special case bolted on: it is the story's original gesture exactly, and the seat flinch is its
translation for everyone who sees the target as a seat instead of a fan. `SHAKE` is one constant —
`{ amp: 9, dur: 460, shape: 'spring' }`, the story's values, a large element flinching whole rather
than the 7px `settle` sized for an input.

**`runTransfer`** branches once, on `plan.role`:

- **taker** — `takeFromSeat` from `anchors.seatBox(from)` to the centre, `flipCard` face-up,
  `REVEAL_HOLD`, then `arrive()` into the fan. With `named: false` the offer leg runs first:
  `donorHand` backs fan out of the donor's seat toward the centre and hold, the engine's card flips
  face-up, and the rest slide back into the seat.
- **victim** — the mirror: out of `anchors.handSlotAt(index)` — `plan.card` is present for a party
  to the transfer, so the index comes from `base.you.hand`, which is the registry's own contract
  (it indexes rather than looks up by uid precisely so it need not know the hand) — to the centre,
  `flipCard` **face-down**
  (it is theirs now), `CENTER_HOLD`, then `dealToSeat` into `anchors.seatBox(to)` at `SEAT_SHRINK`,
  dissolving. **No `useHandArrival`** — the card leaves a hand, it does not settle into one.
- **watcher** — `plan.card` is absent, so there is nothing to flip and nothing to reveal. Seat to
  seat, face-down throughout, on `drawBeat`'s `COVER` card.

### Timings

All of them come from the stories rather than being chosen here; the names are the stories' own.

| Constant | Value | Where |
|---|---|---|
| `PICK_BEAT` | — | never shipped to a board file — it lives only in the playground stories (`OpponentTakesCardStory`, `PickSpecificCardStory`), which resolve their own local promise on it. The board's actual hold comes from `CardCatalog`'s own CSS transition, and the band unmounts outright — no timer — the instant `_useRequestStaging`'s `pending` stops being `requestCard` (a hit flips it straight to `giveCard`). |
| `REQUEST_HOLD` | 820 ms | the named card stands at the centre before the outcome (`REVEAL_HOLD` in the stories) |
| `REVEAL_HOLD` | 820 ms | face-up at the centre before it drops into the fan (taker) |
| `CENTER_HOLD` | 820 ms | face-down at the centre before it sinks into the seat (victim) |
| `MISS_HOLD` | 1620 ms | the flinch and the note, before the scene clears |
| `SHAKE` | `amp 9 / 460 ms / spring` | the refusal, on a seat or on the fan |
| `REVEAL_W` | 220 px | the width a card reaches at the centre |
| `SEAT_SHRINK` | 0.7 | how small a card gets sinking into a seat (`drawBeat`'s own value) |
| fan stagger | 45 ms | between neighbouring backs in the random-steal offer |

### The ask surface — `pages/board/[gameId]/_useRequestStaging.tsx` (new)

Sibling to `_useDefenseStaging` and `_useNeutralizeStaging`, active only while a `requestCard` or
`giveCard` pending is ours. It owns two things and no animation.

**The catalog band.** `CardCatalog` across the middle band: `open` while the pending is ours and
unconfirmed, `selected` for the armed pick, `chosen` after confirm — the component's own three
states, driven by its own two props. Cards are the base deck without triggers. Confirm goes through
the shared `ConfirmAction`, because naming a card is irreversible.

**The `giveCard` auto-resolve.** With the pending ours, dispatch
`onResolve({ kind: 'giveCard', card })` for the first hand copy of `pending.requested`, once, guarded
on the pending's identity rather than on the mount — a latch that outlives what it latches is a bug
`useBeats` has been bitten by twice in its own comments. It fires **immediately** rather than on a
timer: the beat queue already serialises, so the transfer cannot start before the entrance beat has
drained, and the readable pause belongs to `runTransfer`'s own opening hold. One place owns pacing.
It also has to live here rather than in a beat, because `prefers-reduced-motion` collapses every beat
and the hand-over is a game action, not choreography.

### `_Board.tsx`

Three small changes. `requestCard` and `giveCard` join the `PendingPrompt` exclusion list beside
`defend`, `discardForRelease` and `neutralize503`. The staging hook's band and overlay mount beside
its two siblings. And while `pending.kind === 'giveCard'`, the centre slot stands
`cardById(pending.requested)` for every peer — the render that carries the named card across the
batch gap, and the reason the hit leg is only an entrance.

### The preset — `apps/ui/src/animations/presets.ts`

`takeFromSeat`: `move(el, { from, to }, duration ?? 460, EASE)`, no fade — the pair of `dealToSeat`,
which fades because it is dissolving into a hidden hand while this one is coming out of it. Its row
in `reference.md` is not optional: `apps/ui/src/animations/docs.test.ts` fails without it.

## Data flow

```
engine event ─▶ planBeats (pure, against the pre-batch projection)
                 ├─ requested     → entrance (hit) │ whole scene (miss)
                 └─ handTransfer  → taker │ victim │ watcher
                       ▲
                       └── named: base.pending?.kind === 'giveCard'
                           card?: whatever the event carried — nothing widens it

pending ─▶ _useRequestStaging ─▶ CardCatalog band  (requestCard, ours)
                              └▶ onResolve         (giveCard, ours, once)
        └▶ _Board.tsx centre slot                  (giveCard, everyone)
```

## Error handling

A beat that throws costs the animation and never the state: `drain()` drops the shadow in its
`finally`, so the live projection wins whatever happened inside the run. A missing rect — a seat that
is not mounted, a hand slot that is not there — ends the leg early and lets the projection stand,
which is the existing contract every runner keeps. `arrive()` answers whether it took the flight, and
the taker leg puts the card back if it refuses. Under `prefers-reduced-motion` no beat runs at all
and the board simply holds the projection, while the `giveCard` resolve still fires.

## Tests

- **`planBeats.test.ts`** — `named` off `base.pending`; `role` off `selfId`; `donorHand` off the
  pre-batch projection rather than the live one; and the one the issue calls a correctness matter:
  **a `handTransfer` with no `card` yields a plan with no `card`**, so the closed flight is selected
  by the event's own redaction.
- **`transferBeat.test.tsx`** — the taker calls `arrive()` once and splices the fan; the victim calls
  it **never**, asserted explicitly, because that is the one thing separating the mirror from the
  original and exactly what a later refactor unifies by accident. The watcher run asserts the flyer's
  `Card` is `faceDown` for every frame and that the card's id appears nowhere in the DOM. The miss
  asserts `play('shake')` on the target's seat with `amp 9` / `spring`, and that no transfer follows.
- **`boardTransfer.test.tsx`** — a `requestCard` that is ours renders the band and not
  `pending-prompt`; a `giveCard` that is ours fires `onResolve` once with a uid from our own hand,
  and fires **again for a second, distinct pending**; a `giveCard` that is not ours still stands the
  named card at the centre; under reduced motion the resolve still fires while the beats collapse.
- **`apps/ui/src/animations/docs.test.ts`** enforces the `takeFromSeat` row for free.

## Documentation

- `docs/animations/reference.md` — the `takeFromSeat` row (test-enforced) and a `transfer` row in the
  beat registry beside `draw` and `reshuffle`.
- `docs/animations/recipes.md` — rewrite **two** stale recipes: "Opponent takes your card"
  (describes a flight the story abandoned) and "Taking an opponent's card" (describes a grid that
  exists in no story at all). Add the board recipe with its three audiences.
- `AnimationAuditStory` — the same stale entry corrected, `board:` pointers on all three scene
  entries, and the open Security Bug miss finding updated to what shipped.
- New finding, register and `docs/animations/backlog.md`: the rules stand the Security Bug at the
  centre while the asker chooses, but the engine banks it in the same reduction that opens the
  pending. (The panel's over-broad guess space was the other finding; it is fixed in this task
  instead, so it is recorded as history rather than left open.)

## Out of scope

- **The engine's banking order** for the Security Bug. Recorded, not fixed — it is an engine
  behaviour change with its own conformance surface, and this task is the board.
- **AI cards (#106)**, which reuse this catalog and `ConfirmAction`, and **git cards (#108)**, still
  blocked on #61.
- **A deadline or a decline for `requestCard`.** Neither is settled in the rules, and neither is
  invented here.
