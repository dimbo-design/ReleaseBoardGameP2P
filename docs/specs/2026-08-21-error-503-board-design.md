# Error 503 on the board — the alarm, and one shape for every answer

**Date:** 2026-08-21
**Project:** ReleaseBoardGameP2P ("Release любой ценой")
**Issue:** [#102](https://github.com/MythHand/ReleaseBoardGameP2P/issues/102) (Wave 4 of
[#88](https://github.com/MythHand/ReleaseBoardGameP2P/issues/88))
**Scope:** The playground's `Error503Story` brought to the real board, driven by engine events: the
alarm's edge glow, the 503 standing at the centre until it is answered, the three answers as three
card gestures, the exchange that takes the alarm and its answer away together, and the sweep that
empties a defenceless player's table. The engine stops banking the 503 at reveal, which is what the
rules text has said all along. The visual source of truth is the recipe "Error 503 (player turn)"
(`docs/animations/recipes.md`) and the story itself.

> Builds directly on the release/defence design
> ([2026-08-18-defense-release-board-design.md](./2026-08-18-defense-release-board-design.md)):
> the centre slot family, `COVER_POSE`/`ATTACK_POSE`/`SHOW_HOLD`, `planBeats`/`useBeats`,
> `defenseBeat`'s exchange exit and `_useDefenseStaging`'s pull-and-cover cycle are reused, not
> rebuilt. Branched on `feat/101-defense-release` while
> [#121](https://github.com/MythHand/ReleaseBoardGameP2P/pull/121) is open, rebased onto `main`
> when it merges — the same stacking Wave 3 itself used behind #117.

## The goal

An Error 503 turned up on the board reads as an alarm and is answered by a gesture, not by a text
menu. Whatever the answer is — a Debugger out of the fan, a Release sacrificed out of the zone, a
standing Monitoring — the movement is one movement: the answer comes to the centre, covers the
alarm nudged aside so both stay readable, both stand open, and both leave as one exchange. With no
answer at all the table empties: hand and zone gather at the centre, hold, and scatter into the
discard.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | When the 503 is discarded | **Engine fix, this PR.** The pending carries the card; its `discarded` moves to the resolution, beside the card that answered it. This is what `resolution.md`'s own table says and the code did not. |
| 2 | How an answer is chosen | **Three card gestures**, one per method — the card that performs the answer is the card you touch. The generic `PendingDecision` panel is suppressed for this pending, exactly as Wave 3's Decision 4 suppressed it for `discardForRelease`. |
| 3 | Monitoring's gesture | **A click, and a recorded gap.** Monitoring never leaves the zone, so nothing may fly; the approved source auto-fired it and so supplies no gesture to port. The click ships and the gap is written down rather than filled by invention. |
| 4 | The "no answer" half | **The sweep only.** The gather-hold-scatter of a defenceless player's table. The video and the eliminated state are #103; a deadline for the pending and a way to decline are neither shipped nor guessed at. |
| 5 | `crush` | **Out of scope, but unbroken.** The gesture is written against the 503; #106 inherits it. `PendingPrompt`'s sacrifice option gains the `card` the engine demands, so crush stops being rejected outright. |
| 6 | Where the machinery lives | **Three modules**: a third sibling staging hook, the one narrow extraction Wave 3's design promised and did not land, and the zone pull — a source nothing on the board has ever taken a card from. |

## What the issue asks for, and what the code actually says

### The engine banks the 503 before anyone can answer it

`fireTrigger` (`packages/engine/src/fake/triggers.ts:121-132`) emits `revealed`, then
`discarded(reason: 'trigger')`, and only then raises `pending: neutralize503`. So by the projection
the alarm card is already in the heap while the player is still choosing. The scene needs it
**standing at the centre to be covered** — that is the whole point the issue makes.

The rules text settles it without inference. `docs/rules/resolution.md`'s destinations table:
`trigger-error-503` **после нейтрализации** → «сброс (вместе с картой, которой нейтрализовали)».
One moment, both cards. The code disagrees with the text, and by the project's own rule the text
wins.

Fixing it also makes the pending a structural twin of `defend`, which already parks its thrown
attack card on the pending and is already counted there by the conservation invariant
(`packages/engine/src/conformance.ts:388`). The board then renders the alarm from the
projection through the same static centre block a pending attack uses, and the exchange leaves
through the same `useDiscardExit` send.

### The story auto-fires Monitoring; the engine and the rules do not

`Error503Story` neutralises with Monitoring automatically, with no glow and no player input. The
engine publishes `monitoring` as one of `pending.methods` and requires a `RESOLVE`
(`triggers.ts:198-203`), and `resolution.md` §7.2 says «порядок способов не задан, **выбор за
игроком**». So the story simplified and the board cannot.

That leaves a real hole: **there is no approved gesture for an answer that does not leave the
table.** Monitoring stays in the zone, so it must not fly to the centre and back — that would be a
lie about what happened. The board ships the smallest non-inventing thing, a click on the standing
card, and the hole goes to the audit register and `docs/animations/backlog.md` with what would
close it: a designed movement for an answer given from where it stands.

The same finding retires the story's "no glow when Monitoring is present": with a decision to make,
the alarm is on until it is answered.

### The sacrifice method is rejected by the engine today

`PendingPrompt.tsx:296-315` resolves both `neutralize503` and `crush` with `{ method }` and never a
`card`. `triggers.ts:207` rejects that: "sacrifice needs a release card". So sacrificing a release
has never worked through the panel, for either pending kind. The 503's drag supplies the uid by
construction. Crush keeps the panel and gains a release picker, because leaving a live rejection in
place until Wave 6 is not a scope decision, it is a bug left standing.

### The board cannot name the release it burns

`ReleaseView`'s slots carry `uid` and card id, but `toBoardState.ts:32-38` keeps only the card data
— the kit's `ReleaseSlots` is deliberately i18n- and domain-free. So `BoardState.you.release` has
no uid to put in the choice. The adapter stops throwing them away.

### A revealed trigger currently implies its own discard

`revealAfter` (`planBeats.ts:219-231`) reads a trigger's reveal only when the `discarded` sits at
`events[i + 2]`. Once the 503 is held on the pending it is not there, and the plan would carry
neither `card` nor `reveal` — the draw would fall through to the opponent branch and fly a
face-down card at a seat. The reveal has to be able to say "and it stands".

### The stalled pending is real, general, and not this task's

`referee.ts:402` expires only `defend` pendings, and `:422` suspends the turn clock while any
pending is open. A connected player who simply never answers a `neutralize503` stalls the match
for good — and the same is true of `handLimit`, `discardForRelease`, `pickFromDiscard`,
`requestCard`, `giveCard` and `crush`. Fixing one of seven here would invite the same patch six
more times, so it becomes an issue of its own rather than a rider on an animation PR.

### Whether a player may decline is not settled

The story has a PASS; the engine has no way to refuse a 503 you can answer. `resolution.md` §7 says
«Игрок выбывает, если не нейтрализует карту одним из трёх способов» — which does not say whether
declining is a legal choice or an impossibility. That is a question, not a gap to fill: it goes to
`docs/rules/backlog.md` with a `> ❓ **Не из правил.**` marker at the paragraph it came from.

### An event card sacrificed goes home, but is announced as a discard

`bankToDiscard` (`core.ts:157-167`) already routes a card with an `event` field back to the events
deck, so sacrificing an `ai-release-*` obeys `cards.md`'s «обратно в колоду событий». But the
engine announces it as `discarded`, and the placed card deliberately carries the plain
`release-<slot>` id (`triggers.ts:258-265`) so it reads as an ordinary release — so **the board
cannot tell that card went home rather than to the heap, and will fly it to the heap.**
Pre-existing and general (`discardBeat` has it for every event card), but this scene's plan claims
one such discard, so it is recorded with what would close it: a destination on `discarded`, or an
event of its own.

## Architecture

### The engine: the 503 stands until it is answered

**`state.ts`** — the pending carries the card, as `defend` carries the attack:
`{ kind: 'neutralize503'; player; card: CardInstance; methods }`. `view.ts` and the kit's
`TablePending` (`apps/ui/src/table/Table/intents.ts`) gain `card: CardId`, **public**: the rules
make the reveal mandatory (`cards.md`, «немедленно, с показом всем»), so there is no redaction
question. `conformance.ts:388` gains the matching line beside `defend`'s.

**`fireTrigger`** splits on whether there is a decision to make:

- `methods.length === 0` → **unchanged**: `revealed`, `discarded(trigger)`, `eliminate()`, one
  batch, exactly as today.
- otherwise → `revealed`, and the card goes onto the pending instead of into the heap.

**`onNeutralize`** — every branch banks the 503 as well, parented to its own `neutralized` event,
**503 first, answer second**, so the discard event ids give the exchange its layering and each
card's `scatterAt(eventId)` matches the order it flew (I7). The reason stays `'trigger'`: it is
still why the card is in the heap, and `tally.ts` and the history labels do not move.

| Method | Batch |
|---|---|
| debugger | `neutralized(debugger)`, `discarded(503, trigger)`, `discarded(debugger, neutralized)` |
| monitoring | `neutralized(monitoring)`, `discarded(503, trigger)` — Monitoring stays in the zone |
| sacrifice | `neutralized(sacrifice)`, `discarded(503, trigger)`, `releaseDestroyed`, `discarded(release + CR, neutralized)` |

### The alarm

`EdgeGlow` at `inset: 0` inside `kit.table`, which is already
`position: relative; overflow: hidden; isolation: isolate` (`Table.module.css:1-18`) — the layout
gives the bounds and there is nothing to measure. The playground's `.glowBounds` and its hardcoded
tech-bar offsets stay in the playground; that story is explicitly not the reference for this part
(Page Shell Rule, `apps/playground/CLAUDE.md`).

**Two mount points, because DOM order is the rule.** `strong` before `<div className={kit.you}>`
(under the hand) while the open `neutralize503` is ours; `weak` after it (over the hand) while it
is an opponent's. The `pointer-events: none` the issue asks for is already on the primitive
(`EdgeGlow.module.css:5`) for both intensities, so DOM position is the only thing the board must
get right.

**Two fixes to the primitive**, the board being its first non-playground consumer: the default
`color = '#ff3344'` (`EdgeGlow.tsx:20`) becomes a token in `tokens.css`, per the Styling Rule; and
`.glow`'s opacity transition gains a `prefers-reduced-motion: reduce` branch — nothing global
covers it (`app/index.css:24` resets view transitions only). Under `reduce` the alarm still
**appears**: it is information, not decoration. It simply stops fading.

**The card.** `_Board.tsx` renders the 503 at `anchors.centre` off `state.pending`, in the static
block a pending attack already uses (`_Board.tsx:1025-1059`) — same slot, same inner `.pose` child
so the slot rect stays the true card box (I6), resting at `ATTACK_POSE`. It is the thing being
answered, and the cover's contrasting tilt is what makes the two read as two plays.

**The defenceless path has no pending to glow off**: with `methods` empty the engine eliminates in
the same batch, so there is never a pending on the table. The glow is therefore driven by *either*
an open `neutralize503` *or* a running sweep — the alarm is why that sweep is happening, and
without it the hand flies away unexplained. `Beats` grows one boolean, `alarm`, raised while a
gathered discard beat runs, read by `_Board.tsx` beside the pending. One field, in the same shape
as the `exclusive` and `gapAt` it already publishes; no beat identity leaks out of the queue.

### The answer gesture — `_useNeutralizeStaging.tsx` (new)

Live only while the open `neutralize503` is ours and no exclusive beat holds the table — the same
`enabled` / `matchKey` options `_useDefenseStaging` takes, and the same guarantee that one staging
hook owns the fan at a time. `_Board.tsx` already chooses between two; this makes it three.

Legality is `pending.methods`, never re-derived:

| Method | Source | Gesture | Dispatch |
|---|---|---|---|
| `debugger` | the fan | pull out, drop on the table | `{ method: 'debugger' }` — the engine finds the card itself (`triggers.ts:181`), so no uid travels |
| `sacrifice` | a release slot | drag out, with its Code Review as a `CardPair` | `{ method: 'sacrifice', card: <release uid> }` |
| `monitoring` | the Monitoring slot | click | `{ method: 'monitoring' }` |

The fan dims to `disabled` on everything that is not a Debugger and lights `playable` on those that
are, through `Hand`'s own transitioned dim (`stateAt`). The zone lights the answerable slots through
`accentAt` and hands the grab back through `onSlotDown`, so what lights is exactly what can be
taken. `ReleaseZone` already exposes all four props the story uses (`slotRef`, `accentAt`,
`liftedAt`, `onSlotDown`) — the kit needs nothing.

**The drop rule.** "The whole table accepts the drop; only your own area (zone + hand) gives the
card back." `HandPlayDrop` already carries `x, y`, so the fan pull tests against `anchors.zone` and
`anchors.hand` and rejects there. Wave 3's `onHandPlay` tests position not at all; this is the
first board gesture that does, and it stays local to this hook rather than being retrofitted onto
the defence.

**Three modules, and why each is one:**

- **`_useNeutralizeStaging.tsx`** — which sources are answerable, what the gesture commits, and the
  staged render `_Board.tsx` draws from.
- **`_useCoverFlight.ts`** — the extraction. `commitAndFly` (`_useDefenseStaging.tsx:318-361`) is
  already "stand a card at a centre slot at a pose, gate the static render on `landed` with its
  `finally`, watch the feed past a dispatch watermark for `rejected`". Both hooks need that
  identically; the *home* flight differs (fan vs zone) and stays a callback the caller supplies.
  This is the module Wave 3's design promised ("shared flight primitives … extracted to a module
  both staging hooks import, rather than copied") and did not land — kept narrow, and done as its
  own early commit so a review change on #121 rebases cleanly.
- **`_useZonePull.ts`** — the cursor drag ported from the story: pick up at the grab fraction, ease
  `startW → CARD_W` in one rAF loop so the grabbed point stays under the cursor, report where the
  pointer let go. No domain knowledge; the zone is a source nothing on the board has ever pulled
  from, and #105/#106 will want it.

**One adapter change:** `toBoardState` keeps the release uids —
`you.releaseUid: Partial<Record<slot, string>>` beside the existing slots, so sacrifice can name
what it burns. The kit's `ReleaseSlots` is untouched.

### The beats

**`planBeats` — one fix, one new plan, one flag.**

1. **The reveal stops implying a discard.** `PlannedDraw.reveal` becomes
   `{ card: string; discardId?: number }` — present means the trigger leaves from the centre,
   absent means it **stands** there. `drawBeat`'s reveal branch splits on the same field: flip up,
   hold `REVEAL_HOLD`, then either the existing exit, or hand the card over to the static render
   and drop the flyer in the same commit — the handoff ordering the cover slot uses, at the cost of
   one `publish`.

   What it publishes is `{ ...base, pending: { kind: 'neutralize503', player, card, methods: [] } }`.
   The board renders its shadow while a beat runs (`_Board.tsx:250`), so this is what keeps the
   alarm on screen across the handoff frame — and the beat cannot know `methods`, which live only
   on the projection. Empty is the honest value and a safe one: it offers no answer, so the staging
   hook stays inert, and the queue drains onto the live pending on the next tick (a raised pending
   ends the batch — `fireTrigger` returns there). It is a shadow of the projection for a frame, not
   a claim about the game.
2. **New plan `neutralized`**, from the `neutralized` event: `player`, `method`, the slot when it is
   a sacrifice, the 503's own `{ eventId, card }`, and the answer's spent cards — claimed as the
   contiguous run of `discarded` after the event, exactly how `covered` claims its `spent`. They go
   into `owned` so `discardBeat` does not fly them twice. `FROM_RELEASE` already lists
   `'neutralized'`, and `planBeats.ts:130-137` already names the Debugger-from-hand case as the
   fall-through this plan now claims.
3. **`discard` gains `gather: true`**, opened when the walk sees `eliminated` and claiming that
   player's following discards. Nothing else changes: `discardBeat` already resolves hand slots,
   release slots and seat boxes (`discardBeat.tsx:82-94`), so a table watching someone else go out
   sees the same sweep.

**`defenseBeat.runNeutralized`** — `runCovered` with different inputs, sharing its exit builder
rather than restating it:

`nextFrames()` (I2) → read the handoff before the first await (same race, same fix) → fly the
answer to `anchors.cover` at `COVER_POSE`, skipped when it is ours and already staged
(`!(mine && handoff)`) and skipped entirely for `monitoring`, which has no card; a remote answer
leaves from the actor's seat box, or from `anchors.releaseSlot(player, slot)` for a sacrifice →
`wait(SHOW_HOLD)` → `handoff.release()` immediately before the exit, the ordering `runCovered` had
to be fixed into → **one** `useDiscardExit` send: the 503 at `layer: 0` from `anchors.centre` at
`ATTACK_POSE`, the answer at `layer: 1` from `anchors.cover` at `COVER_POSE` with its Code Review
as `aux`, each landing on its own `discarded` event's `scatterAt` (I7, I9). Monitoring sends the
503 alone — the alarm stands, holds, and goes.

**`discardBeat`'s gather leg** — the story's `sweep(gather: true)`, ported: raise every card at its
source, glide each to its own `scatterAt(i)` place around the centre so the pile reads as a heap
and not a stack, `wait(GATHER_HOLD)`, then hand the **boxes** — not the tilted nodes (I6) — to
`useDiscardExit`, which unwinds the tilt in flight. `GATHER_HOLD = 1500` joins `SHOW_HOLD` in
`entities/game/board/poses.ts`, where #104's hand limit will find it.

### Data flow

Actor: gesture → dispatch → engine events → `planBeats` against the *before* projection (I1) → the
beat adopts the staged node through `StagedHandoff` → last frame equals the projection. Everyone
else: the same events → the same plans → flights from seats and zones. One pending at a time
(engine invariant), so `neutralized` never overlaps itself, and it cannot overlap `covered` either
— a `defend` and a `neutralize503` cannot both be open.

### Error handling

Every dispatch keeps the discipline Waves 2 and 3 established: a rejection cannot outlive its
dispatch (the watermark), a rejected answer returns home through the same flight a cancel uses —
into the fan for a Debugger, back to its slot for a release — and a beat that cannot measure a
source or a target plays nothing and lets the projection resolve. `prefers-reduced-motion` is
honoured through the Wave 0 layer's policy for every JS flight, and through the new media query for
the glow's CSS transition.

## Tests

- **Engine** (`triggers.test.ts`): the 503 sits on the pending and not in the discard while a
  decision is open; each method banks 503-then-answer in one batch in that order; the defenceless
  path unchanged; conformance conservation with an open `neutralize503`.
- **Adapter** (`toBoardState.test.ts`): the release uids survive.
- **Plans** (`planBeats.test.ts`): a reveal with no following discard yields `reveal` without
  `discardId`; `neutralized` per method with its claims; `eliminated` opens a gathered run.
- **Runners**: `defenseBeat.test.tsx` in the established pattern — what `send` actually received
  (layers, poses, scatters) per method, one card for monitoring, handoff adoption for the local
  answerer; `drawBeat` publishing the standing-trigger shadow and dropping its flyer behind it,
  rather than exiting to the heap; `discardBeat` for the gather leg, and `useBeats` raising `alarm`
  only while one runs.
- **Staging**: the three gestures; the drop rule giving the card back over your own area; a
  rejection returning it home from fan **and** zone; the fan and zone lighting exactly
  `pending.methods`.
- **Board**: both glow mount points and their DOM order around `kit.you`; the glow raised by a
  running sweep as well as by an open pending; the alarm rendering at the centre from the pending.
- **Kit**: `PendingPrompt` sends a `card` for crush's sacrifice.

## Documentation

Same PR as the code. `recipes.md`'s Error 503 recipe gets the board's reality — it currently
documents the story's older shape (`DROP_PAD = 48`, a 750 ms Monitoring hold) that the story itself
no longer has. The audit page's Error503 scenario status and its register, plus
`docs/animations/backlog.md`, take three findings:

1. no designed gesture for an answer that does not leave the table (Monitoring);
2. an event card banked home is announced as `discarded`, so the board flies it to the wrong pile;
3. a pending with no deadline stalls the match — filed as its own issue, since it belongs to all
   seven pending kinds.

`docs/rules/backlog.md` plus a `> ❓ **Не из правил.**` marker takes the question of whether a
player who *can* answer may decline. New user-visible copy goes through `@release/translation`,
keys in **both** `en` and `ru`. A new preset, if any, gets its `reference.md` line or
`apps/ui/src/animations/docs.test.ts` goes red. The PR closes #102.

## Out of scope

- The elimination video and the "you are out" state — #103. This ships the sweep and stops.
- Crush's own scene — #106. Only its sacrifice bug is fixed here.
- The hand limit — #104, which will reuse this gather leg.
- A deadline for `neutralize503`, and any way to decline one.
- Any choreography for `tookHit`, `passed`, `monitoringDestroyed` beyond what the projection and
  the existing beats already show (Wave 3's Decision 9 stands).
