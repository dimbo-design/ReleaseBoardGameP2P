# Git operations, slices 1–2 — open questions

**TODO: these are unanswered. The design for [#61](https://github.com/MythHand/ReleaseBoardGameP2P/issues/61)'s first two slices is blocked until they are.**

Scope of these two slices: **Git Cherry-pick**, **`ai-inside`**, **Git Branch**, **Git Merge**. Git Rebase and System Upgrade are later slices and are not covered here.

Each question carries a recommendation. Answering "recommendation" is a valid answer.

## Correction to #61

Issue #61 states that `Pending` already has `pickFromDiscard`, `reorderTop` and `discardOne` variants and that `Choice` has their matching resolutions. It does not. [`state.ts:57`](../../packages/engine/src/state.ts) has seven pending kinds — `discardForRelease`, `defend`, `neutralize503`, `crush`, `requestCard`, `giveCard`, `handLimit` — and [`actions.ts:9`](../../packages/engine/src/actions.ts)'s `Choice` and [`view.ts:37`](../../packages/engine/src/view.ts)'s `PendingView` mirror exactly those. Every new pending kind is a change across six layers: engine `Pending` → `Choice` → `PendingView` → `conformance.resolvePendingAction` → the kit's `TablePending`/`TableChoice` mirror → the adapter's `Exact<>` assertions, then the `PendingPrompt` surface and both translation catalogs.

What #61 says correctly: `decks.main` is already `CardInstance[][]`, and `DRAW` already carries `pile?` — honoured at [`reduce.ts:40`](../../packages/engine/src/fake/reduce.ts).

## Draw and piles

- [ ] **1. What does the Base mode's draw obligation mean once the deck is split?**

  [Rules :31](../rules/rules-board-game.md) — "Игрок обязан взять одну карту сверху основной колоды… При разделенной колоде добора карта берется из всех колод." [Rules :237-243](../rules/rules-board-game.md) defines Base as "Добор из всех колод" and Strategic as "Добор только из одной колоды". Today [`reduce.ts:40`](../../packages/engine/src/fake/reduce.ts) does `action.pile ?? 0` and ignores the mode entirely.

  1. One card off the top of *each* pile — Base draws N cards for N piles; Strategic draws one, drawer picks the pile.
  2. Piles are one source — Base lets the drawer pick freely, Strategic pins them to one pile. Draw arity never changes.

  **Recommendation: 1.** The mode table only carries meaning if Base draws from all — otherwise Strategic restates Base, and Git Branch does nothing in the mode the rules call canonical.

  **With the sequencing caveat below**, which is not optional if 1 is chosen.

- [ ] **2. If Base draws from every pile, is that one atomic `DRAW` or a per-pile obligation?**

  A drawn trigger fires immediately ([`reduce.ts:49`](../../packages/engine/src/fake/reduce.ts)) and can open `pending` — Error 503 opens `neutralize503`. `GameState.pending` is a single slot. An atomic multi-pile `DRAW` whose first card is a trigger would have to draw the second card behind an open pending, which needs a pending *queue* — the same shape change System Upgrade needs, pulled three slices early.

  1. Keep `DRAW` as one card from one pile. Move the change into the obligation: `turn.hasDrawn` stops being a boolean and records which piles have been drawn from this turn. Base is satisfied when every non-empty pile has been drawn from; Strategic when any one has. `PUSH` legality, the dock's "you still owe a draw" state, and `onDraw`'s `already drew this turn` rejection all derive from that.
  2. Atomic multi-card `DRAW`, and build the pending queue now.

  **Recommendation: 1.** Single pending stays intact, the `drawn` event already carries `pile` and needs no change, and a trigger mid-sequence just opens its pending normally. The cost is that `hasDrawn` is a visible shape change through `GameState` → `PlayerView.turn` → `TableState` → the adapter assertions — a contained, known ripple.

- [ ] **3. Does Git Branch split an already-split deck?**

  [Rules :138](../rules/rules-board-game.md) — "Разделите одну колоду добора (зелёную) на две." Played twice: 2 piles → 3? Unbounded? Capped?

  **Recommendation:** unbounded, N → N+1. It falls out of the rules text and `decks.main` is already an array.

- [ ] **4. Where does the split fall?**

  At a table a player cuts wherever they like. The engine has no input surface for a cut point and its randomness is seeded ([`rng.ts`](../../packages/engine/src/rng.ts)).

  1. Even halves, deterministic.
  2. Seeded random cut point.
  3. The player picks, which needs a new pending kind and a UI surface.

  **Recommendation: 1.** Deterministic, no new surface, and the strategic content of the card is the split itself rather than where it lands.

- [ ] **5. What does sudo Git Branch do?**

  [Rules :138](../rules/rules-board-game.md) — "sudo Git Branch: **и** переверните сброс — он будет использоваться как новая колода добора, не перемешивайте карты." The "и" reads as *in addition to* the split, giving N → N+2 (one from the cut, one from the flipped discard, order preserved and reversed, unshuffled). Confirm that against *instead of* the split.

- [ ] **6. Does Git Merge mid-turn reset a partly-satisfied draw obligation?**

  Only live if Q1 = 1 and Q2 = 1. A player draws from pile 0, then plays Git Merge; the piles collapse to one that they have already drawn from. Do they still owe a draw?

  **Recommendation:** no — the obligation is satisfied per pile drawn from, and the surviving merged pile inherits that. Needs stating either way, because it is exactly the kind of edge the conformance fuzz stream will find.

- [ ] **7. What happens when a pile is empty?**

  `onDraw` currently rejects with `that pile is empty` ([`reduce.ts:42`](../../packages/engine/src/fake/reduce.ts)). Under a per-pile obligation an empty pile must be skipped rather than block the turn. Separately: what happens when *every* pile is empty — is there a reshuffle-the-discard rule, and is Git Merge the only way back?

## Discard and information

- [ ] **8. Is the discard pile fully public?**

  `PlayerView.decks` projects `discardTop?: CardId` and `discardCount` ([`view.ts:76`](../../packages/engine/src/view.ts)) — the contents are not projected to anyone. Cherry-pick ([Rules :150](../rules/rules-board-game.md), "выберите одну карту из всего сброса") and `ai-inside` ([Rules :163](../rules/rules-board-game.md), "возьмите одну карту Release из сброса в руку") both need the whole pile visible to the picker.

  1. Project the full discard to everyone, always. It is face-up on a real table, so this is the physical truth.
  2. Project it only to the player holding the pending.

  **Recommendation: 1.** It matches the table, and option 2 hides information the rules never hid.

- [ ] **9. Does the engine model what a player knows about the deck?**

  Sudo Cherry-pick puts the second card on top of the draw deck "не показывая другим игрокам" ([Rules :150](../rules/rules-board-game.md)) — so that player knows the next card and nobody else does. Projection currently tells nobody anything about deck order. Git Rebase (a later slice) has the same problem, larger.

  1. Model it — per-player deck knowledge in the state, projected so the UI can show "you know what's on top".
  2. Don't. The card lands on top and the placer is trusted to remember, exactly as at a table.

  **Recommendation: 2 for this slice**, but the answer should be chosen with Git Rebase in mind, since Rebase makes the same demand and choosing 2 twice means the game never surfaces private deck knowledge at all.

- [ ] **10. Which pile does sudo Cherry-pick's second card go on top of?**

  Live only when Branch has split the deck. Pile 0, or the player's choice — the latter needs the choice carried on the resolution.

- [ ] **11. Cherry-pick or `ai-inside` with nothing eligible in the discard?**

  An empty discard, or — for `ai-inside`, which is restricted to Release cards — a discard holding no Release. Inert (the card is spent, nothing happens), or rejected as an illegal play?

## Reachability

- [ ] **12. Do these cards enter the deck in this slice, and at what quantity?**

  [`catalogue.ts:187-229`](../../apps/ui/src/cards/catalogue.ts) carries quantities: System Upgrade 2, Git Merge 2, Git Branch 3, Git Rebase 3, Git Cherry-pick 3. `FAKE_DECK` ([`fake/index.ts`](../../packages/engine/src/fake/index.ts)) omits all five, and `createGame` filters anything absent from `CARD_RULES`, so adding rules without adding deck entries leaves them unreachable. Cherry-pick, Branch and Merge land in this slice; Rebase and System Upgrade do not — do the two later cards stay out of the deck until their slice, or go in inert?

  Note `conformance.ts`'s `resolvePendingAction` must gain a case for every newly reachable pending kind — a `progress` property asserts the fuzz stream never holds a pending for more than three consecutive steps, so a missing case goes red by design.
