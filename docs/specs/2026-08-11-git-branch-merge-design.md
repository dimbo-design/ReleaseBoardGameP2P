# Slice B — Git Branch and Git Merge — Design

Slice B of [#61](https://github.com/MythHand/ReleaseBoardGameP2P/issues/61): the two cards that change how many draw piles are on the table. Slice A made the draw run over every pile; this is what creates the piles it runs over.

Rules answers this implements: [`2026-08-02-git-operations-rules-decisions.md`](./2026-08-02-git-operations-rules-decisions.md), answers 3, 4, 5, 7 and 12. Card text: [rules :136–142](../rules-board-game.md).

## The two cards

Neither exists yet — slice C added `operation-git-cherry-pick` and nothing else. Both enter `CARD_RULES` as kind `operation` with `sudo: true`, and `FAKE_DECK` at the quantities answer 12 gives: **Git Branch 3, Git Merge 2**.

**Git Branch** — "Разделите одну колоду добора (зелёную) на две." Splits one pile into two. Sudo additionally flips the discard in as a further pile, **unshuffled** — the card says "не перемешивайте карты", and answer 5 confirms the two halves are independent: one pile plus a discard becomes three piles and an empty discard.

**Git Merge** — "Объедините все колоды добора в одну и перетасуйте их." Every pile becomes one, shuffled. Sudo adds the discard to it and shuffles that in too.

They are exact opposites, which is the point: Git Branch is how the multi-pile table slice A was built for comes to exist, and Git Merge is how it goes away.

## Git Branch carries a target

Answer 3: the player chooses which pile to split. One pile splits without a question; with two on the table the player picks, and it becomes three.

So `Action.PLAY`'s `Target` union gains `{ kind: 'pile'; pile: number }`. This is the first target that names something belonging to the table rather than to a player, which is why it takes a new variant rather than extending an existing one.

With exactly one pile there is nothing to choose, so the target may be omitted and pile 0 is understood. `legalTargets` returns one entry per pile, so a UI can offer the choice without knowing the rule.

## Splitting

Answer 4: exactly in half, and an odd pile leaves one side one card larger. The top half keeps its order and stays in place; the bottom half becomes the new pile, inserted directly after it, so a split is a local change and the indices of piles before it do not move.

**A pile of one card does not split.** Answer 4 is explicit: nothing happens and the Git Branch card goes to the discard. It is a legal play with no effect, not a rejection — the same shape as Cherry-pick against an empty discard (answer 11), and worth stating because "the card did nothing" and "the card was refused" look identical from a hand that just lost it.

Sudo's flipped discard is appended as the last pile, after the split, since answer 5 makes it an addition rather than a variation of the split.

## Merging

Every pile concatenates into one and is shuffled through `(seed, cursor)` like every other shuffle, with the advanced cursor written back — so each peer recomputes the same pile rather than agreeing over the wire. Sudo appends the discard before shuffling and leaves the discard empty.

Merging with one pile already on the table is still a shuffle of that pile, not a no-op: the card says "объедините… и перетасуйте", and shuffling the deck is worth something on its own.

## An emptied pile disappears

Answer 7's second case — one pile of several running out ceases to exist — becomes reachable here, because until Git Branch there was only ever one pile and running it out is answer 7's *first* case.

Slice A deferred this for a specific reason: `drawing.piles` holds indices, and removing a pile mid-sequence shifts every index behind it. So pruning happens **when a draw sequence finishes**, never during one. Within a single draw the pile list is stable, an emptied pile survives as an empty array until the last card of that draw is taken, and it is gone before anything else can look. Nothing can be played mid-draw, so no player can observe the difference.

The last pile is never pruned: with nothing left anywhere, answer 7's first case recycles the discard into it instead.

## What this does not settle

Slice A left a question the rules do not answer and this slice makes reachable: **under Base, if a player draws and then splits a pile, does the obligation re-open?** `drawObligationMet` currently says yes — the new pile has cards and has not been drawn from — which means splitting after drawing would owe another card.

That is an accident of the predicate, not a decision, and it is the kind of thing [`2026-08-11-rules-ambiguities-open-questions.md`](../rules/decisions/2026-08-11-rules-ambiguities-open-questions.md) exists for. Until it is answered, this slice keeps the predicate as it stands and states the consequence here rather than quietly picking the other reading.

## Definition of done

Git Branch splits a chosen pile in half, splits an odd pile with the larger part first, does nothing to a single-card pile while still being spent, and under sudo adds the unshuffled discard as a further pile. Git Merge collapses every pile into one shuffled pile, and under sudo takes the discard with it. A pile emptied by a draw is gone once that draw finishes, unless it is the only one.
