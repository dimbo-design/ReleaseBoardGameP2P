# Git operations — rules decisions

Answers from the game's owner to the twelve questions in [`2026-08-01-git-operations-open-questions.md`](../rules/decisions/2026-08-01-git-operations-open-questions.md), given on [GitHub/PR #77](https://github.com/MythHand/ReleaseBoardGameP2P/pull/77#issuecomment-5153415444). These supersede the questions and the recommendations in them; the questions file stays only as the record of what was asked.

Numbering matches the questions.

> **The rules file is not current.** Answer 1 states the rules were revised after [`docs/rules/rules-board-game.md`](../rules/rules-board-game.md) was written, and that file has not been touched since commit `1f30cfe`. Every quotation in the questions came from it. Treat it as stale for anything these answers touch, and as unverified elsewhere.

## The draw

**1. Base draws one top card from every draw pile. Strategic chooses which pile the card comes from.** Separate piles are separate draw sources.

The recommendation that reached this conclusion did so through a wrong reading of Git Branch — the card is not a tempo accelerator, and arguing from "otherwise Git Branch does nothing" was a misunderstanding of the rules, not a supporting argument. The mechanical answer stands; the reasoning behind the question does not.

**2 & 6. A draw is one triggered action that runs sequentially over every existing pile.** The player presses one control; the engine draws from each pile in turn. A drawn Error 503 pauses the sequence until it is answered, then the sequence resumes. **Playing cards from hand is impossible while a draw is in progress**, the same as in a normal phase.

This settles the sequencing question the plan raised: the draw is neither atomic nor a series of player-issued actions. It is one action carrying an interruptible internal sequence, which means the engine needs draw-in-progress state that survives a pending and resumes on its resolution.

Consequently **Git Merge mid-draw is not a case** — cards cannot be played during a draw, so the piles cannot change under a running sequence.

## Git Branch

**3. The player chooses which pile to split.** One pile on the table splits without a question. Two piles: the player picks one, and it becomes two, for three total. No engine-imposed limit — the game's own mechanics bound it.

So Git Branch carries a target: which pile.

**4. The split is exactly in half.** An odd pile leaves one side with one card more. **A pile of a single card cannot split: nothing happens and the Git Branch card goes to the discard.**

**5. sudo Git Branch does both, independently.** The split happens exactly as above, and the flipped discard is added as a further pile on top of that — not a variation of the split. One pile plus a discard becomes **three piles and an empty discard**.

## Git Merge and exhaustion

**7. Two distinct cases.**

- **No draw cards anywhere:** the discard is taken, shuffled, and becomes a single new draw pile.
- **One pile of several empties:** that pile ceases to exist. Three piles with the second exhausted leaves two.

## The discard

**8. The discard is open, but not browsable at will.** Cards lie face up, and a player cannot page through the pile during ordinary play. Card effects that reach into the discard bring their own viewing surface.

[GitHub/PR #78](https://github.com/MythHand/ReleaseBoardGameP2P/pull/78) already carries playground visualisations of the cards that work with the discard.

**9. The engine does not model private deck knowledge.** A card placed on top of the deck is known to the player who placed it and remembered by them, as at a table. This is intended, not a simplification.

**10. sudo Cherry-pick's second card goes on top of the first pile** when several exist.

**11. An impossible take from the discard is skipped, and the card is still playable.** Playing Cherry-pick or Inside against a discard that cannot satisfy it is a legal move with consequences for the player who blundered — not a rejected action.

## Deck composition

**12. Quantities exist and were not in question.** The catalogue carries them: System Upgrade 2, Git Merge 2, Git Branch 3, Git Rebase 3, Git Cherry-pick 3.

## What these answers change

1. **The draw is no longer a single-card action.** `DRAW` becomes a triggered sequence over every pile, resumable across a pending. `turn.hasDrawn` cannot stay a boolean, and the engine gains draw-in-progress state. This is a change to the game's core loop, not to the Git operations alone, and it lands in the same slice as Git Branch because Git Branch is what makes multiple piles reachable.
2. **Playing from hand is blocked during a draw** — a legality rule that does not exist today.
3. **Git Branch needs a pile target**, so `Action.PLAY`'s `Target` union gains a pile variant.
4. **The single-card pile is a real branch** — Git Branch on it is a legal play that discards the card and changes nothing.
5. **Nothing here needs private deck knowledge or a parallel pending**, so slices 1 and 2 stay clear of the shape changes System Upgrade will force.
