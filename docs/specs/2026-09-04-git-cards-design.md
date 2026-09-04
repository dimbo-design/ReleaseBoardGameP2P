# Git cards on the board — three choreographies, and the two engines they were waiting for

**Date:** 2026-09-04
**Project:** ReleaseBoardGameP2P ("Release любой ценой")
**Issue:** [#108](https://github.com/MythHand/ReleaseBoardGameP2P/issues/108) (Wave 7 of
[#88](https://github.com/MythHand/ReleaseBoardGameP2P/issues/88)), plus the remainder of
[#61](https://github.com/MythHand/ReleaseBoardGameP2P/issues/61)
**Scope:** Git Cherry-pick, Git Rebase and System Upgrade on the real board. Cherry-pick needs a
board surface and one engine correction; Rebase and System Upgrade have no engine at all yet, so
this task closes out #61 as well. The visual source of truth is `/playground/git-cards`
(`apps/playground/stories/interactive/GitCards/`) and, where a story and the written spec disagree,
the story.

> Builds on everything waves 0–6 put on the board: the beat queue (`planBeats`/`useBeats`), the
> flight steps (`useFlyer`/`useHandArrival`/`useDiscardExit`), `BoardAnchors`, the pile movements in
> `features/board-beats/deckBeat.tsx`, and the staging-hook seam — `_useDefenseStaging.tsx` (#101),
> `_useNeutralizeStaging.tsx` (#102), `_useHandLimit.tsx` (#104), `_useRequestStaging.tsx` (#105),
> `_useInsideStaging.tsx` (#106). Nothing here rebuilds any of them.
>
> Rules answers used by slices B and C are in
> [`2026-09-04-git-cards-rules-decisions.md`](./2026-09-04-git-cards-rules-decisions.md); the earlier
> Git set is in [`2026-08-02-git-operations-rules-decisions.md`](./2026-08-02-git-operations-rules-decisions.md).

## The goal

Three cards that reach past a player's own hand — into the discard, into the top of the deck, into
everybody else's hand at once — and none of them is playable on the board today. Two are not even
in the engine's card table. What makes this wave different from the six before it is that it is not
only choreography: for Rebase and System Upgrade the effect itself has to be written first, and one
of them changes what a `Pending` is allowed to mean.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Order of work | **A: Cherry-pick (engine fix + board) → B: Rebase engine → C: System Upgrade engine → D: their board surfaces.** A is unblocked today and depends on nothing below it; D cannot be written before C settles. |
| 2 | Cherry-pick's surface | **Its own hook, `_useCherryPickStaging.tsx`,** beside `_useInsideStaging` rather than inside it. Same pending kind, different question — see "Two hooks, one pending kind". |
| 3 | A trigger reaching a hand | **The engine forbids it,** not just the board. `openPickFromDiscard` withholds triggers from the base offer, and `onPickFromDiscard` rejects a trigger as `toHand`. This is a live rules violation on `main`, not new-feature work. |
| 4 | Rebase's pile | **`Target { kind: 'pile' }`, the variant Git Branch already added.** Rules answer 1. Sudo names no pile: it reaches all of them. |
| 5 | Rebase's visibility to other peers | **The card's own public flight, and nothing else.** No new event type. The order is exactly what the rules say nobody else sees, and inventing a public event to animate would be inventing a leak. |
| 6 | The System Upgrade pending's shape | **A `Pending` variant carrying a roster** — `owed: PlayerId[]`, `thrown`, `phase` — rather than a list of pendings or a block beside `pending`. It is a pending because the effect suspends play, and suspension, the absent-seat drain, the progress guard and the board's waiting plumbing all already hang off `Pending`. |
| 7 | That variant's `player` field | **It has none, deliberately.** Every other variant carries `player`, so union-wide reads compile today; dropping it makes `tsc` enumerate the three that must now decide something instead of silently picking one seat. |
| 8 | Sudo System Upgrade's pick | **`phase: 'picking'` on the same pending,** not a second one. The thrown cards are held on that object; a second pending would need to hold them again or put them somewhere they do not belong. |
| 9 | The standing cards at the centre | **The projection renders them; the beats animate only arrivals.** `pending.thrown` is public, so the centre survives between batches with no beat holding it — #106's precedent, where `_Board.tsx` renders `cardById(pending.requested)` while the engine waits. |
| 10 | Several throws in one batch | **One beat representing several events,** the way `planBeats` already folds a run of consecutive `discarded` into one discard run. The queue does not become concurrent. |
| 11 | The owed player's own gesture | **`playToCenter`, the step `_useHandLimit` already uses** — not that hook, whose grid and limit arithmetic are irrelevant here. #88's standing rule: a movement in two scenes is a module, not a copy. |

## What the issue asks for, and what the code actually says

Four corrections. Three of them shrink the work; one adds to it.

### `reorderTop` and `discardOne` do not exist

The issue says the pendings Rebase and System Upgrade need "exist in the contract but are
unreachable." They do not exist. `Pending` in `state.ts:76` has eight variants and none of them
is either one, and `Choice` has no matching resolutions. `cards.test.ts:32` pins both card ids as
absent from `CARD_RULES` on purpose, naming the reasons — "Rebase needs private deck knowledge and
System Upgrade a pending owed to several players at once, so both are still ahead." So slices B and
C write these contracts rather than reach them.

### Cherry-pick's engine is already here

Conversely, Cherry-pick is not blocked at all. `CARD_RULES` carries
`'operation-git-cherry-pick': { kind: 'operation', sudo: true }`, `FAKE_DECK` carries it at qty 3,
and `fake/discard.ts` implements the whole effect — `discardOptions(state, false)` offers the whole
pile, `picks` is `min(combo ? 2 : 1, options.length)`, and `onPickFromDiscard` resolves `toDeck`
onto pile 0 with `visibleTo: [player]` on its event. What Cherry-pick lacks is a board surface: it
currently falls through to `PendingPrompt`'s generic `pickFromDiscard` panel, because
`_useInsideStaging` gates on `source === 'ai-inside'` and `_Board.tsx:1718` suppresses the panel for
that source alone. Commit `bdf1b49` put it there on purpose, for this wave to take it back.

### Git Branch and Git Merge are finished

`deckBeat.tsx:13` says "the card that CAUSES a split or a merge is Git Branch / Git Merge and belongs
to #108." That was true when it was written and stopped being true when #61 slice B landed both
cards in the engine. `classifyPiles` (`planBeats.ts:415`) already derives `split` / `merge` /
`fromDiscard` positionally from `pilesChanged` — including sudo Git Branch's appended discard — and
`deckBeat` plays all three. The card's own flight to the discard rides the ordinary `discarded` run.
Nothing is owed here but the correction of that comment.

### A trigger can be cherry-picked into a hand today

`docs/rules/cards.md` says of Error 503 and the AI trigger: "Обе карты **нельзя держать в руке**."
`discardOptions(state, false)` returns the whole discard, triggers included — and both trigger types
reach the discard in the ordinary course of play, because that is where `fireTrigger` banks them.
`onPickFromDiscard` then pushes the chosen card into `player.hand` with no check of its kind. So a
peer can put an Error 503 into a hand with a legal `RESOLVE`, and the engine will commit it.

The playground story enforces the rule (`isTrigger` blocks a base pick, and under sudo a trigger can
only take the deck slot). `ai-inside` escapes it because `discardOptions(state, true)` filters to
Releases. Cherry-pick is the exposure, and the board is the wrong place to fix it: the engine is the
authority, and a hand-rolled `RESOLVE` never passes through the board at all.

## Architecture

### Slice A — the engine correction

`fake/discard.ts` gains one predicate and two guards:

- `openPickFromDiscard` computes the offer as before, then, when the effect is Cherry-pick, withholds
  triggers **unless the pick is a sudo one**. Under sudo a trigger is legal — as the card that goes
  onto the deck, never as the one that goes to the hand — so it stays on offer and the second guard
  does the work.
- `onPickFromDiscard` rejects a trigger named as `choice.card`, with the same `reject` shape the file
  already uses for a card that is not on offer.
- `picks` keeps its meaning, but its ceiling is now the number of options that could take the hand
  slot: a sudo pick over a discard holding one trigger and nothing else is `picks: 1`, not `2`, and
  by rules answer 11 that is a legal, wasteful play rather than a rejection.

### Slice A — the board

`_useCherryPickStaging.tsx`, gated on an ours-`pickFromDiscard` whose `source` is
`operation-git-cherry-pick`. It carries the story's grid, in the story's values: the deal out of the
pile at `DEAL_DUR` 360 / `DEAL_STEP` 16 capped at `STAGGER_CAP` 40; the pick to the centre at
`REVEAL_W` 220 / `REVEAL_DUR` 460, held `REVEAL_HOLD` 560, then `useHandArrival` into the fan; the
sudo card `flipCard` (420) in place then `returnToDeck` (480) with `DECK_HOLD` 360; the unpicked back
through `useDiscardExit` at `RETURN_DUR` 420 / `RETURN_STEP` 14, each landing on **its own**
`scatterAt` value so the heap it hands over to is the frame it ended on (I7).

Two things the story does that the board must do differently. The story lifts its candidates out of
the heap while they are being chosen from, because its discard is local state; ours is the
projection, and `openPickFromDiscard` leaves them in `decks.discard` until the pick resolves — the
same honesty `_useInsideStaging` already keeps, and the reason the grid is drawn over an unchanged
pile. And the story assigns the two sudo roles by rule from the click order; on the board that rule
now lives in the engine (slice A above), so the hook reads the offer rather than re-deriving it.

**Two hooks, one pending kind.** Inside's row is two to four Releases with no roles and no locks;
Cherry-pick is the whole discard — the story exercises 54 cards, scrolling — with per-cell role tags,
trigger locks and a two-slot selection. A single hook would be mostly branches. What they genuinely
share, they already share by both reading the same `mine`-gated pending: the options, the confirm
bar, and the rule that one candidate is not a choice and answers itself.

### Slice B — Rebase in the engine

```ts
// state.ts — Pending
| {
    kind: 'reorderTop'
    player: PlayerId
    // One entry per pile the effect reaches: base = the pile the player named,
    // sudo = every pile. Cards top-first.
    piles: { pile: number; cards: CardInstance[] }[]
    source: CardId
  }
```

`pendingView` projects `piles` behind `mine` — `[]` for everyone else, the gate `pickFromDiscard`
already uses, and the whole of what "не показывая другим" needs. `Choice` gains
`{ kind: 'reorderTop'; order: { pile: number; cards: CardUid[] }[] }`, validated as an exact
permutation of what *this* pending offered and then re-checked against the live pile — the two-step
discipline `onPickFromDiscard` already keeps against a stale snapshot.

`PLAY` carries `Target { kind: 'pile' }` for base Rebase (rules answer 1) and none for sudo. By rules
answer 2 there is no illegal case: a pile of one or two is reordered as far as it goes, and with no
pile at all the card is spent for nothing. So `onPlay` needs no "not enough cards" rejection.

**No new event type.** The public half of Rebase is the card itself, reaching the discard through the
`discarded`/`reason: 'effect'` path `planBeats` already animates. The private half is staged from the
pending's own `piles`, the way Inside's row is built from `options` — an event would add nothing the
actor does not already have and would hand every other peer a fact the rules withhold.

### Slice C — System Upgrade in the engine

```ts
| {
    kind: 'systemUpgrade'
    actor: PlayerId
    // Still owed; drains as each answers. Never the actor, never an eliminated
    // seat, never an empty-handed one (rules answer 3).
    owed: PlayerId[]
    // Face up in the centre per the rules — public, ungated in pendingView.
    thrown: { player: PlayerId; card: CardInstance }[]
    sudo: boolean
    phase: 'discarding' | 'picking'
    source: CardId
  }
```

Two choices, dispatched by `onResolve` like every other: `{ kind: 'upgradeDiscard'; card }` from a
seat in `owed`, and `{ kind: 'upgradeTake'; card }` from the actor once `phase` is `'picking'`. The
flip happens on the last answer and only when `sudo && thrown.length > 0`; otherwise everything banks
to the discard and the pending clears. An empty roster at open time — every opponent empty-handed —
means the card is played and nothing happens, which by rules answer 3 is ordinary rather than an
error.

The variant carries **no `player`**. Three reads are union-wide today and each has to decide
something once several seats can owe one pending:

| Site | Today | After |
|---|---|---|
| `fake/bots.ts:38` | `pending.player === me` | does this pending owe *me* |
| `fake/bots.ts:162` | `pending?.player ?? turn.player` | iterate the owed |
| `conformance.ts:973` | `pending?.player ?? turn.player` | same |

Everything else in the engine reads `pending.player` inside a narrowed `case` and is untouched.

**The census must learn about `thrown`.** `realCardUids` (`conformance.ts:368`) already carries
hand-written mid-air branches for `defend.attack` and `neutralize503.card` — cards out of a hand and
not yet anywhere else. Thrown cards are in exactly that state and need a third branch, or a fuzz
stream that ends mid-upgrade reads as a lost card.

> **Adjacent, and to be settled by mutation rather than by reading.** `defend.combo` is a
> `CardInstance` held on the pending for the same reason, and does not appear in `realCardUids`. The
> conservation property compares one seeded start against one seeded end, so a stream that never
> ends on an open sudo defence never exposes it. Slice C is already editing that function: confirm
> the gap by making it go red before deciding whether it is one.

**The keeper needs nothing new.** `referee.ts:195` already scans *every* expired-absent seat and
calls `botAction` per seat, so once `bots.ts:38` asks whether the pending owes that seat, a
walked-away opponent drains on its own. `stampTurnClock`'s `idle` is false while any pending is open,
so the actor's turn clock stops while they wait — which is correct, and free.

### Slice D — the two board surfaces

**Rebase.** `_useRebaseStaging.tsx` for the actor: the cards fly out of the named pile into the
numbered row (`DEAL_DUR` 520 / `DEAL_STEP` 80, `DEAL_HOLD` 200), drag to reorder, `ConfirmAction`,
then `flipCard` 420 with `FLIP_HOLD` 260 and `returnToDeck` at `BACK_DUR` 600 / `BACK_STEP` 90 in the
chosen order. Sudo lays one row per pile sharing a single 1-2-3 numbering, as the story does. The
pending resolves when the return flights land — or immediately under reduced motion, per
`_useInsideStaging`'s rule that a game action must never wait on an animation nobody plays. Every
other peer sees the card's public flight and nothing more (Decision 5).

**System Upgrade.** The standing cards at the centre come from the projection (Decision 9), so no
beat has to hold them and none of them is lost between batches. The beats animate arrivals:

- `upgradeThrown` → the card flies from that seat to the centre at `THROW_DUR` 460, growing from
  `THROW_SCALE` 0.42 to full, and stays. Consecutive throws inside one batch are absorbed into a
  single staggered beat at `THROW_STEP`; throws in separate batches — the ordinary case, since each
  peer answers on its own clock — are separate short beats over a centre that persists (Decision 10).
- Base: after `HOLD_MS` the bank to the discard, which is the ordinary `discarded` run with
  `centerToDiscard` at `CLEAR_STEP` 90.
- Sudo: `phase: 'picking'` raises `_useUpgradeStaging.tsx` over the standing cards; `upgradeTaken`
  then plays reveal (`REVEAL_W` 220 / `REVEAL_DUR` 460 / `REVEAL_HOLD` 560) and `useHandArrival`,
  with the rest going out on the same `discarded` run.

The owed player's own side — pull one card out of your fan and throw it — is `playToCenter`, the step
`_useHandLimit` performs with its excess of one (Decision 11).

## Data flow

```
PLAY operation-git-cherry-pick [+ sudo]
  └─ openPickFromDiscard → pending pickFromDiscard { options (mine), picks, source }
       └─ _useCherryPickStaging: grid → pick → RESOLVE { card, toDeck? }
            └─ takenFromDiscard (to:'hand', public) + takenFromDiscard (to:'deck', visibleTo:[player])

PLAY operation-git-rebase (target: pile) [+ sudo → every pile]
  └─ pending reorderTop { piles (mine), source }
       └─ _useRebaseStaging: row → reorder → RESOLVE { order }
            └─ (no event; the card's own `discarded` is the whole public story)

PLAY operation-system-upgrade [+ sudo]
  └─ pending systemUpgrade { owed, thrown: [], sudo, phase:'discarding' }
       ├─ each owed seat: RESOLVE upgradeDiscard → upgradeThrown (public)   ← drains `owed`
       ├─ base, or sudo with nothing thrown: bank → discarded ×N, pending null
       └─ sudo: phase 'picking' → RESOLVE upgradeTake → upgradeTaken + discarded ×N-1
```

## Error handling

A pending that cannot be answered is the failure mode this whole area has already been bitten by, so
each new one states its escape:

- **Cherry-pick with nothing takeable.** Already handled: an empty offer raises no pending at all and
  the card is spent (rules answer 11). Slice A's trigger rule makes "nothing takeable" reachable in a
  new way — a discard of nothing but triggers, under a base pick — and it takes the same road.
- **Rebase with no pile.** No pending; the card is spent (rules answer 2).
- **System Upgrade with an empty roster.** No pending; the card is spent (rules answer 3).
- **An owed seat that walks away.** `referee.ts`'s absent-seat scan plus `botAction`, per seat.
- **A stale or hostile `RESOLVE`.** Every new resolution validates membership in *this* pending's
  offer and then against live state, the pair of checks `onPickFromDiscard` already carries.

## Tests

Engine tests are **verified by mutation, not by reasoning** — #61's own standing instruction, written
after nine tests shipped green while asserting nothing. Every new test is confirmed by breaking the
code it names and watching it go red.

- `packages/engine/src/fake/discard.test.ts` — a trigger is not offered for a base Cherry-pick; is
  offered under sudo; is rejected as `toHand`; `picks` drops to 1 when only triggers could fill the
  hand slot.
- `packages/engine/src/fake/rebase.test.ts` (new) — the permutation guard, the live-pile re-check,
  a two-card and a one-card pile, no pile at all, sudo over several piles, and `piles` empty in
  another viewer's projection.
- `packages/engine/src/fake/upgrade.test.ts` (new) — the roster excludes the actor, the eliminated
  and the empty-handed; `owed` drains; an unowed seat is rejected; the base bank; the sudo flip; the
  empty-roster fizzle.
- `conformance.ts` — a `resolvePendingAction` case for each new kind, or the `progress` property goes
  red by design; the `thrown` census branch; and a rules invariant that a resolved `reorderTop`
  leaves the pile's multiset and count identical.
- Board: `__tests__/boardCherryPick.test.tsx`, `boardRebase.test.tsx`, `boardUpgrade.test.tsx` for the
  hooks, `features/board-beats/upgradeBeat.test.tsx` for the beat — including the two arrival
  timings, one batch and several.

## Documentation

- The audit page (`apps/playground/stories/AnimationAuditStory`): the three entries lose "prototype"
  and "rules-complete deferred (#61)", and gain their `board:` lines like every scene before them.
- `docs/animations/recipes.md` and `reference.md` — the new sequences; a preset without a
  `reference.md` row fails `apps/ui/src/animations/docs.test.ts`.
- `docs/rules/cards.md` — done: the three answers are folded into the Rebase and System Upgrade
  entries, pointing at the decisions file.
- `deckBeat.tsx:13` — the claim that Git Branch/Merge belong to #108, corrected.
- Anything found on the way goes to the audit register **and** `docs/animations/backlog.md`.

## Out of scope

- **Git Branch and Git Merge.** Finished; only the stale comment is touched.
- **Private deck knowledge.** Rules answer 9 of the 2026-08-02 set: not modelled, on purpose. The
  card a Rebase or a sudo Cherry-pick puts on top is remembered by the player, as at a table.
- **The cross-cutting timings pass** — #84, once every scene is on the board.
- **`prefers-reduced-motion`** is not re-decided here: `useBeats` owns the policy, and the two new
  staging hooks follow `_useInsideStaging`'s rule of resolving at once when nothing will be played.
