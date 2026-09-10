# AI cards on the board — one scene, seven endings

**Date:** 2026-09-03
**Project:** ReleaseBoardGameP2P ("Release любой ценой")
**Issue:** [#106](https://github.com/MythHand/ReleaseBoardGameP2P/issues/106) (Wave 6 of
[#88](https://github.com/MythHand/ReleaseBoardGameP2P/issues/88))
**Scope:** The AI trigger and the event card it pulls, brought to the real board and driven by
engine events: the trigger comes off a draw pile, the named AI card comes off the events deck, and
then it resolves seven different ways. The visual source of truth is `AiCardsStory`
(`/playground/ai-cards`) and, where it and the written spec disagree, the story.

> Builds on the beat queue and the staging seam already on the board: `planBeats`/`useBeats`,
> `useFlyer`/`useHandArrival`/`useDiscardExit`, `BoardAnchors`, the centre geometry in
> `apps/ui/src/table/TableCentre/centre.ts`, and the sibling staging hooks `_useDefenseStaging.tsx`
> (#101), `_useNeutralizeStaging.tsx` (#102), `_useRequestStaging.tsx` (#105) and `_useHandLimit.tsx`
> (#104). Nothing here rebuilds any of them. Branched from `feat/104-hand-limit`, because Bad
> Vibe-Coding resolves through the `handLimit` pending and that surface lives in open PR #131.

## The goal

An AI trigger is one scene with seven endings — seven card effects, which the board resolves through
six tail kinds, because Release and Monitoring end the same way — and the table reads it as one: a card comes off the
pile and stands at the left as the cause, the events deck gives up the card that explains it, both
are held long enough to be read, and only then does the effect happen. The seven endings differ in
where the cards go afterwards — and the card economy is the part to get exactly right, because #71
exists precisely because it broke once.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Who owns the trigger's flight | **One `aiEvent` beat owns the whole scene.** `planBeats` claims the card-less `drawn` and its `aiRevealed` together and emits one plan; the draw plan never sees them. A card's life stays inside one beat, which is the invariant `drawBeat`'s own header comment defends. The pile→slot flight is packaged as a shared step rather than written a second time. |
| 2 | How the board tells "went home" from "went to the heap" | **`ReleasedView.event?: CardId`.** One optional field, one projection line. The board reads it off the pre-batch projection (I1), which is where a standing release lives — so no event needs to carry it, and every caller is answered at once. |
| 3 | How the AI card survives a batch gap | **`source?: CardId` on `crush`, `neutralize503` and `handLimit`.** Not a new idea: `pickFromDiscard.source` already exists with exactly this meaning, and `ai-inside` already rides it. |
| 4 | Where the effect is read from | **The following events, never the AI card's id.** `planBeats`' own principle, stated in its DDoS comment: "read off the batch rather than off a card id… the batch is where that fact actually lives". |
| 5 | The trigger, when a pending is owed | **It leaves at the end of the reveal hold, and the AI card stands alone.** The engine banks it immediately, so holding it across the gap would contradict a projection that already has it in the heap. Recorded, not fixed — see below. |
| 6 | Bad Vibe's given-up card | **The `picked` place, not the hand limit's grid.** `gridCells(1)` puts its one cell at `dx: 0, w: 150`, underneath the `effect` slot at `dx: 82, w: 200`. `source` is what tells `_useHandLimit` which shape to build — and, carried onto the plan as `handLimit.picked`, what tells `handLimitBeat`'s BUILD path the same thing, since every peer who is not the discarder has no grid of the page's to adopt. |
| 7 | `ai-inside`'s choice surface | **A staging hook, not a beat** — the options are the owner's alone. The outcome is a beat, because `takenFromDiscard` is public. |
| 8 | `ai-inside` with one candidate | **Auto-resolved.** #105's Decision 2 precedent: a choice carrying no information is not a choice. |
| 9 | The three new centre slots | **Positioned from `centrePlaceStyle`,** the declared single source — not by new literals in the board's CSS module. |
| 10 | The AI card's road home, when a prompt was owed | **A leg on the plan the ANSWERING batch already makes,** selected by `base.pending?.source`. The card stands through the prompt and travels when the prompt is answered — the projection's events-deck count carries it in the meantime, and a count contradicts nothing on screen. |
| 11 | Telling "a prompt is owed" from "nothing happened" | **`planBeats` gains an `owed` argument.** Raising a pending emits no event, so a crush over an empty slot and a crush that will be answered produce identical, empty batches. This is the one fact a batch cannot report about itself. |

## What the issue asks for, and what the code actually says

### `ai-inside` is not blocked any more

The issue says `ai-inside` "is the one AI event the fake omits — it is blocked on the discard picker,
which is #61." That was true when the issue was written and is not true now. `cards.ts:70` carries
`'ai-inside': { kind: 'ai' }`, and `resolveAiEvent` implements it: `discardOptions(state, true)`
filters the discard to releases and raises a `pickFromDiscard` pending with `picks: 1` and
`source: event.id`. `openPickFromDiscard`/`onPickFromDiscard` in `fake/discard.ts` resolve it.

What is missing is only the **board** surface. `PendingPrompt` does render a `pickFromDiscard`
case (`PendingPrompt.tsx:405`) — an earlier task added it, and the comment above the copy contract
still claiming "No case in the switch below yet renders it" is stale. The board suppresses that
panel anyway, in favour of the row (Decision 7): the panel is a generic list, while the scene puts
the candidates open at the centre, and a panel that unmounts when the pending clears cannot hold a
flight. #61 stays open for the five Git operations and System Upgrade; none of them is touched here.

> Corrected during implementation. The original text said the kit had no case at all and cited that
> comment as evidence — the comment was the stale part, not the code.

### The board cannot see where a destroyed card goes, and this is not hypothetical

`bankToDiscard` (`fake/core.ts`) checks `c.event`: a card carrying it goes back to `state.decks.events`
rather than to the common discard. But the `discarded` event that reports the banking always names
the discard, and a standing AI release wears the plain `release-<slot>` id on purpose — so that a
DDoS bounce reads it as an ordinary release. `ReleasedView` (`view.ts:15`) then drops `event`
entirely in `releasedView` (`project.ts:11`).

Together that leaves the board with no way at all to tell one case from the other: not from the
event, which is silent, and not from the card, which is disguised. `docs/animations/backlog.md:1062`
records it, and names the failure already on the board today: `defenseBeat.runNeutralized` flies a
sacrificed AI release into the discard heap, where it never really lands, because the events deck
has already taken it.

**Fixed here, in the engine.** `ReleasedView` gains `event?: CardId`. The board reads it off the
pre-batch projection rather than off any event, because that is where a standing release is. One
field is *capable* of answering every caller — `ai-crush`, `monitoringDestroyed`, elimination spoils,
and the sacrifice flight that is wrong today — but only two are wired to it in this task: the crush
ending and the sacrifice flight. Left unfixed, this task would have had to guess, and guessing on the
rules is exactly what `CLAUDE.md` forbids.

> Corrected after the whole-branch review, which found the original sentence claimed all four.
> `discardBeat` never consults `releaseEvent`, so an AI release swept up by an elimination
> (`eliminate`'s `discarded(reason:'destroyed')`) and an AI Monitoring destroyed by
> `handAttacks.ts:103` still fly into a heap they never reach. That is the #71 class, still open —
> the backlog entry's own closing text is honestly narrower than this paragraph was, and the entry
> is right. Wiring `discardBeat` is the remaining half.

### Three prompts have nothing on the table explaining them

`crush`, `neutralize503` (the `ai-error-503` mimic) and `handLimit` (Bad Vibe) all raise a pending in
the batch that reveals the AI card, so the answer arrives in a *later* batch and no beat overlay can
span the gap. The AI card is what explains the prompt, and its identity does not survive: `crush`
carries only a slot, the mimic's `card` is `null` by design (`bankAlarm` reads it to decide what to
bank, and the mimic's card is already home in the events deck), and `handLimit` carries no source at
all.

`pickFromDiscard` already solves this, publicly and unconditionally, with `source: CardId`. The same
field goes on the other three. It is public on all of them — the whole table watched the card be
revealed — while `handLimit.options` stays gated behind `mine` as it is today.

### The rules leave everything at once; the engine banks the trigger first

The issue's Bad Vibe text says "everything leaves at once: trigger to the discard, AI card back to
its deck, the given-up card to the discard." `fireTrigger` logs `discarded(trigger-ai)` immediately
after `aiRevealed`, before `resolveAiEvent` runs — so by the time a prompt is owed and the board is
across a batch gap, the projection has already filed the trigger.

Standing it anyway is precisely what `drawBeat`'s header forbids: "a card left standing at the centre
would contradict a projection that has already put it in the heap." So for the three effects that
raise a pending the trigger leaves at the end of the reveal hold and the AI card stands alone; for
the four that do not, both leave together exactly as the scene shows, because there is no gap to be
honest about.

**Recorded, not fixed** — the same treatment `backlog.md:1135` already gives the Security Bug's
identical ordering problem, and the same call #105 made about it. Moving the banking is an engine
behaviour change with its own conformance surface.

### The trigger's hold has an answer already, and it was waiting for this task

`drawBeat.tsx:30` holds a revealed trigger for `REVEAL_HOLD = 900`, a number that task invented. The
register's owner answer settles it: the value comes from the example scene, the scene is `AI cards`
because the behaviour of AI cards at the centre is its subject, and the found value is
`TABLE_HOLD = 2600` (twice that for Hallucination). There is no separate "plain reveal" hold in any
scene, because a trigger's stand *is* part of reading the AI card. The remaining board edit is made
here, and `backlog.md:299` closes.

## Architecture

### The engine — two additive facts

```ts
// view.ts — ReleasedView
export interface ReleasedView {
  uid: CardUid
  card: CardId
  codeReview?: CardId
  /** the events-deck id this instance goes home as when it leaves the table */
  event?: CardId
}

// view.ts — PendingView, three variants
| { kind: 'crush';          player; slot; methods; source?: CardId }
| { kind: 'neutralize503';  player; card; methods; source?: CardId }
| { kind: 'handLimit';      player; excess; options; source?: CardId }
```

No `GameState` shape changes: `event` is already on `CardInstance`, and the three pendings already
hold what `source` reports. `pending` passes through `toBoardState.ts:239` untouched and
`contract.test-d.ts` asserts `TablePending ≡ PendingView`, so one change lands on both sides and the
type test refuses to let them drift.

`conformance.ts` needs nothing. #71's fix list asked for a card-conservation invariant, and unlike
the field above it **was** delivered: "never creates or loses a card across a long stream" compares
`realCardUids` before and after a 300-step drive, and "never lets a card from the events deck reach
the discard" guards §6.4 directly. Both already pass. So the engine half of this task is the two
fields and their projection tests, and nothing in the fuzz surface moves.

### The plan — `features/board-beats/planBeats.ts`

```ts
| { kind: 'aiEvent'; key: string; eventId: number
    player: string; pile: number
    trigger: string; triggerDiscardId: number
    eventCard: string
    tail: AiTail }

type AiTail =
  | { kind: 'zone'; slot: string; card: string }            // released | placed
  | { kind: 'crush'; slot: string; card: string
      destination: 'events' | 'discard' }                   // releaseDestroyed
  | { kind: 'turnEnded' }                                   // turnEnded
  | { kind: 'alarm' }                                       // revealed(ai-error-503), then eliminated
  | { kind: 'standing'; alarm?: true }                      // a prompt is owed: the card stays
  | { kind: 'none' }                                        // nothing happened, nothing is owed
```

The walk claims the card-less `drawn` at `i` when `events[i+1]` is `aiRevealed`, takes its
`discarded` at `i+2`, and reads the tail from what follows. `revealAfter`'s existing `aiRevealed`
branch is removed — the draw plan no longer sees an AI trigger at all.

Every tail is read off the batch and never off `eventCard`'s id. That is `planBeats`' own stated
principle, and here it earns its keep twice over: `released`/`placed` following is what says the
event card *stayed on the table* instead of going home (the engine's own `standsOnTable` test, seen
from the outside), and `revealed` followed by `eliminated` is what separates a defenceless 503 from
one that will be answered.

Two tail facts are read from a projection rather than from the batch, and both are named here
because a plan that reads outside its batch has to say so:

- **`destination`** — `base.release[slot]?.event !== undefined` → the card goes home. `base`, not
  live: the release is gone from the live projection by the time the batch is planned (I1).
- **`standing` versus `none`** — raising a pending emits no event, so this is the one fact a batch
  genuinely cannot report about itself. A crush over an empty slot and a crush that will be answered
  produce byte-identical batches (both empty), and they are opposite scenes. So `planBeats` gains an
  `owed` argument — the pending the batch LEFT standing, which `useBeats` already holds as `live` —
  and the test is exact rather than heuristic: `owed?.source === eventCard`. `alarm` rides along on
  `standing` when the AI card is the 503 mimic, because the glow is owed for as long as the prompt is.

### The beat — `features/board-beats/aiBeat.tsx` (new)

`useAiBeat(anchors)`, one `useFlyer`, one `useHandArrival`, one `useDiscardExit`, in the shape
`defenseBeat` and `transferBeat` have. `exclusive: false` throughout — an AI card is read, not
obeyed, and nothing about it needs input dead. `alarm` is true for the `alarm` tail and for a
`standing` one carrying it, which is how the glow lights for a 503 the projection raises no pending
for — the same field, and the same reason, `draw`'s own `neutralized` case uses.

The opening is common to all seven:

1. pile → `cause` on `drawToCenter`, `flipCard` face-up — the shared step, below;
2. events deck → `effect` on `drawToCenter`, `flipCard` face-up;
3. `wait(eventCard === 'ai-hallucination' ? HALLUCINATION_HOLD : TABLE_HOLD)`.

Then the tail. In every branch the trigger leaves for the discard on `scatterAt(triggerDiscardId)` —
one value, two readers (I7) — so the heap rests it exactly where the flight put it.

| Tail | What the AI card does |
|---|---|
| `zone` | `playToReleaseZone` into `anchors.releaseSlot(player, slot)`, and it stays. No return home |
| `crush` | the destroyed card is raised from its slot and takes its own road: `returnToDeck` to the events deck for `destination: 'events'`, the discard exit for `'discard'`. The AI card itself goes home |
| `turnEnded` | `returnToDeck` |
| `alarm` | `returnToDeck`, and the glow lights; `eliminated` follows in the same batch and the elimination beat takes the table |
| `none` | `returnToDeck` — a crush over an empty slot is a card that arrived and did nothing, and it leaves as one |
| `standing` | the trigger leaves alone; the AI card is **dropped where it stands**, into the `effect` slot the projection now renders from `pending.source`, and the beat ends |

### The road home, when a prompt was owed

For the four effects that raise a pending — `crush`, the 503 mimic, Bad Vibe, Inside — the AI card
does not fly home inside this beat. It stands until the prompt is answered, and its journey home
belongs to the beat of the batch that answers it: a leg added to the `neutralized`, `handLimit` or
`takenFromDiscard` plan that batch already produces.

Which of those legs to add is selected the way #105 selected `named` — off the pre-batch projection,
with a plain equality rather than a rule reconstructed from card ids: `base.pending?.source` names
the card, and `base` is by definition the projection that still had the prompt open (I1).

This is also where the engine's own bookkeeping and the table's picture legitimately differ, and it
is worth being explicit about why it is not the trigger's problem repeated. `fireTrigger` returns the
event card to `decks.events` as soon as `resolveAiEvent` returns, so for all four of these the
projection has it home while the rules have it standing. But `decks.events` is projected as a
**count**, not as identified cards: standing the card costs the deck's counter one, and nothing on
screen contradicts anything. The trigger's case is not like that — the discard is rendered as actual
cards on an actual heap, which is why that one is honest to the projection and this one is not
obliged to be.

### The shared step — `features/board-beats/toCentre.ts` (extracted)

`drawBeat`'s `toCentre` becomes a module both runners call: raise a card at a pile's box, fly it on
`drawToCenter` to a named target, pin it there (I4). It takes the target rect rather than reading
`anchors.centre` itself, which is the whole of the change — `drawBeat` passes `centre`, `aiBeat`
passes `cause` and then `eventsBox → effect`. Written twice it would have been the second copy of a
movement, which is the thing `#88`'s standing rules name outright.

### The board — `pages/board/[gameId]/_Board.tsx`

`BoardAnchors` gains `cause`, `effect`, `picked` and `eventsBox`; the events `Pile` at `_Board.tsx:1065`
gets the `boxRef` the discard pile already has.

The three slots are positioned by `centrePlaceStyle('ai', 'cause' | 'effect')` and
`centrePlaceStyle('aiPick', 'picked')` from `@release/ui`, not by new literals in the module CSS.
The board's four *existing* centre slots do duplicate `centre.ts`'s numbers as literals
(`_Board.module.css:74-102`: `-92px`, `+92px`, `-180px`, `42%`). That drift is recorded rather than
expanded — migrating four shipped, approved slots is not this task's business, and adding three more
copies to keep them company is how the duplication would become the convention.

While a `crush`, `neutralize503` or `handLimit` pending carries a `source`, the `effect` slot stands
`cardById(pending.source)` for **every** peer. That is the render that carries the AI card across
the batch gap, and the reason the `standing` tail is only an entrance.

### Bad Vibe — `pages/board/[gameId]/_useHandLimit.tsx`

One branch, on `pending.source`. An ordinary hand limit builds `gridCells(excess)` as it does today.
A `source`-bearing one — Bad Vibe, always `excess: 1` — uses the `picked` place from the `aiPick` set
instead, and the card pulled out of the fan flies there on `playToCenter`, stands open for
`PICK_HOLD`, and leaves for the discard when the pending resolves. `endsTurn: false` on the engine's
side already keeps the seat with its owner; nothing on the board needs to know that.

### `ai-inside` — `pages/board/[gameId]/_useInsideStaging.tsx` (new)

Sibling to `_useRequestStaging`, active only while a `pickFromDiscard` pending is ours. It owns the
choice and no animation.

**The row.** The candidates are raised from the discard's card box and stand in an open row at the
centre, at hand-card size, selected one at a time, confirmed through the shared `ConfirmAction` —
naming a card is irreversible. On confirm the unchosen slide back down and the row unmounts.

The row stands *over* an unchanged heap. The story removes its candidates from the discard while
they are out, because its heap is local state; the board's is the projection, and
`openPickFromDiscard` leaves them in `decks.discard` until the pick resolves. Honest rather than
clever, and translated rather than transcribed — the same reasoning #105 applied to two scenes whose
geometry belonged to a stage with no seats in it.

**One candidate auto-resolves.** `onResolve({ kind: 'pickFromDiscard', card: uid })` fires
immediately, guarded on the pending's identity rather than on the mount — a latch that outlives what
it latches is a bug `useBeats` has been bitten by twice in its own comments. It fires here rather
than in a beat because `prefers-reduced-motion` collapses every beat and the pick is a game action,
not choreography.

**The outcome is a beat.** `takenFromDiscard` is public and carries the card, so a new `takenFromDiscard`
plan flies it for everyone: discard box → `centre` on `drawToCenter`, `wait(SHOW_HOLD)`, then
`useHandArrival` into the taker's own fan, or `dealToSeat` into their seat for anyone watching. One
path, two audiences, branched on `player === selfId` the way `PlannedDraw.mine` already is.

## Data flow

```
engine event ─▶ planBeats(fresh, before, owed)
                 ├─ drawn(card-less) + aiRevealed + discarded  → aiEvent
                 │     tail  ← what FOLLOWS, never eventCard's id
                 │     destination ← before.release[slot].event
                 │     standing vs none ← owed.source === eventCard
                 └─ takenFromDiscard                            → the Inside flight

                 …and on the batch that ANSWERS a prompt, the AI card's road home
                 rides the plan that batch already makes, selected by before.pending.source

pending.source ─▶ _Board.tsx effect slot   (crush | neutralize503 | handLimit | pickFromDiscard)
               └▶ _useHandLimit.tsx        (picked place instead of gridCells(1))

pending.options ─▶ _useInsideStaging.tsx   (pickFromDiscard, ours only)
```

## Error handling

Unchanged from every runner before it: a beat that throws costs the animation and never the state,
because `drain()` drops the shadow in its `finally` and the live projection wins whatever happened
inside the run. A missing rect — an events pile that is not mounted, a release slot that is not there
— ends the leg early and lets the projection stand. `arrive()` answers whether it took the flight,
and the Inside leg puts the card back if it refuses. Under `prefers-reduced-motion` no beat runs at
all and the board holds the projection, while the Inside auto-resolve still fires.

## Tests

- **`planBeats.test.ts`** — the `drawn`+`aiRevealed` pair yields an `aiEvent` and **no** draw plan;
  each tail is read off the following events; and two pairs that prove the reads outside the batch
  are load-bearing rather than decorative. A crush destroying an event-carrying release plans
  `destination: 'events'` while the same crush over an ordinary release plans `'discard'`, the two
  batches being identical apart from the projection. And a crush over an empty slot plans `none`
  while a crush that will be answered plans `standing`, those two batches being identical **and
  empty** — separable only by `owed`.
- **`aiBeat.test.tsx`** — the pair leaves together on a non-pending tail and the trigger leaves alone
  on `standing`, with the AI card's node still in the `effect` slot when the beat resolves; a `zone`
  tail never returns the AI card to the events deck; a `crush` with `destination: 'events'` calls
  `returnToDeck` and **never** the discard exit, asserted explicitly, because that is the whole of
  #71 and exactly what a later refactor unifies by accident.
- **The road home** — the batch that answers each of the four prompts adds the return leg, and a
  batch whose `base.pending` carried no `source` adds none. Asserted on `neutralized`, `handLimit`
  and `takenFromDiscard` alike, since one mechanism serves all three.
- **`boardAi.test.tsx`** — the three standing prompts render the AI card at `effect` from
  `pending.source`, including for a peer who is not the one answering; Bad Vibe stands its card at
  `picked` and not at `gridCells(1)`'s cell; a `pickFromDiscard` that is ours renders the row and not
  `pending-prompt`; a single candidate resolves once, and again for a second distinct pending; under
  reduced motion the resolve still fires while the beats collapse.
- **Engine** — in `fake/project.test.ts`: `ReleasedView.event` survives projection for an AI release
  and is absent for an ordinary one, and each of the three pendings reports `source` (publicly, for a
  viewer who is not the one being asked). Verified by mutation, not by reasoning — #61's standing
  warning, and the nine green tests that asserted nothing during the engine's own implementation.
  `conformance.ts` is untouched: its two relevant properties already exist and already pass.

## Documentation

- `docs/animations/reference.md` — an `ai` row in the beat registry beside `draw`, `transfer` and
  `reshuffle`. No preset row: all seven movements already exist, so `docs.test.ts` has nothing new
  to enforce.
- `docs/animations/recipes.md` — the board recipe for the AI scene and its seven endings, beside the
  playground one that already describes the story.
- `docs/animations/backlog.md` — `:1062` (the events-deck blind spot) and `:299` (the trigger's hold)
  both **close**. Two new entries open: the trigger's early banking, and the board's four centre
  slots duplicating `centre.ts`.
- `AnimationAuditStory` — `board:` pointers on the AI entries, the two closures, and the two new
  findings in the register.

## Out of scope

- **The engine's banking order** for the AI trigger. Recorded, not fixed, for the same reason #105
  left the Security Bug's identical problem alone.
- **Migrating the board's four existing centre slots** to `centrePlaceStyle`. Recorded.
- **The rest of #61** — the five Git operations and System Upgrade, and with them **#108**.
- **#84's cross-cutting timings pass.** Every value here comes from `AiCardsStory`; none is chosen,
  and none is re-argued.
