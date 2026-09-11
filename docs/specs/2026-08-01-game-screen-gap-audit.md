# Game screen — gap audit

What stands between `game-page-wiring` ([#65](https://github.com/MythHand/ReleaseBoardGameP2P/pull/65)) and a finished game screen. Written against the branch as merged-to-be, excluding [#61](https://github.com/MythHand/ReleaseBoardGameP2P/issues/61)'s card effects, which are tracked separately in [`2026-08-01-git-operations-open-questions.md`](../rules/decisions/2026-08-01-git-operations-open-questions.md).

The task this compares against is [#18](https://github.com/MythHand/ReleaseBoardGameP2P/issues/18) — engine contract, fake reducer, page wiring — and the two plans that implement it: [`2026-07-31-table-interaction-plan.md`](./2026-07-31-table-interaction-plan.md) (tasks 1–17) and [`2026-08-01-game-page-wiring-plan.md`](./2026-08-01-game-page-wiring-plan.md), which supersedes its tasks 13–17.

## Blocking — the screen cannot play a game to completion

### 1. No pending prompt can render, so the game deadlocks on the first Release play

`Table.tsx:349` gates the pending prompt on `copy.pending`, and `Table.tsx:340` gates the reaction window's unpass control on `copy.window`. **Neither key exists in either translation catalog** — `grep -c '"pending"\|"window"'` returns 0 against both `packages/translation/src/locales/en/common.json` and `.../ru/common.json`.

Task 15 of the interaction plan and task 5 of the wiring plan both specify these keys, and #65's description claims they landed. `historyLabels` and the expanded `moveHistory` did; `pending` and `window` did not.

The consequence is not cosmetic. Playing a Release opens a `discardForRelease` pending — the discard-a-card cost, which every Release play incurs. The prompt does not render, so the pending never resolves, and from that moment `onDraw` and every other action reject with `a decision is pending` (`reduce.ts:35`). The same holds for `defend`: **an attacked player cannot defend**. This is consistent with #65's browser verification, which reached a draw and no further.

Both `PendingPrompt` itself (`apps/ui/src/table/Table/PendingPrompt/`, 355 lines, 160 lines of tests) and the copy types are complete. Only the catalog entries and the page's `copy` bindings are missing.

### 2. A game cannot visibly end

`toTableState` never maps `PlayerView.over`, and the board page never passes `over` to `Table`. `actions.onOverContinue` (`Table.tsx:462`) has no producer either, so nothing routes onward after a win — [#19](https://github.com/MythHand/ReleaseBoardGameP2P/issues/19)'s Stats screen has no entry point from a finished game.

The engine computes the winner on both conditions (`fake/release.ts:25`, `fake/triggers.ts:66`) and `GameOver` is a complete component. Nothing joins them.

### 3. The clock is frozen at zero

`Table.tsx:122` holds `const nowRef = useRef(0)`, with a comment stating the deadline interval belongs to the consumer. Task 9 was to replace it; `TableProps` exposes no `now` prop at all, so the turn ring and both countdowns render against `now = 0`.

The deadlines themselves are enforced — `tick` is genuinely driven by the ticker in `network/session/link.ts:101` and `remoteLink.ts:145`. So a reaction window expires correctly but with no visible countdown: it simply vanishes.

## Functional gaps

4. **A Code Review-protected release is indistinguishable from a bare one.** `toTableState.ts:30` drops `codeReview` because the kit's release zone has no slot for it. Code Review makes a release invulnerable to all four release attacks; that fact is currently invisible to every player including its owner.
5. **Rejected actions are silent.** `useGame` exposes no error and the page renders no banner. A `rejected` event reaches the move history and nothing else.
6. **`room.connection`, `room.disconnected`, `room.spectatorLimit` have no producer** — carried forward from #64 unchanged.
7. **`panel` is not bound to `?panel=`.** Task 2 built the controlled prop for exactly this; the page passes neither `panel` nor `onPanelChange`, so the drawer falls back to uncontrolled.
8. **A sudo-boosted attack cannot be thrown into a reaction window** — `Action.ATTACK` carries `combo?`, the window path offers none.
9. **The adapter collapses split draw piles into one total** (`toTableState.ts:139`). Blocked on #61's Git Branch answers.

## Session lifecycle — [#58](https://github.com/MythHand/ReleaseBoardGameP2P/issues/58)

10. **A reload ends the game.** Session state is in memory; `rebind` and `adoptSession` exist with nothing driving them.
11. **Keeper handover is unwired.** `handover()` has no caller, so the game stops if the host leaves.
12. **Spectators hold no `GameLink`** and see the empty table indefinitely.

## Polish

13. **Animations** — milestone 4 and [#23](https://github.com/MythHand/ReleaseBoardGameP2P/issues/23). Also blocked by `ReleasedView.uid` being dropped in `toReleaseSlots`, which is the stable FLIP key the engine projects specifically for this.

## Note on the remaining planned task

Task 12 of the interaction plan — the engine-driven `TableStory` with a `live` toggle — is the only one of the 17 never implemented and never superseded. Verified absent: no `useFakeGame.ts`, no engine dependency or alias in `apps/playground`. It was milestone 2's acceptance gate, and items 1–3 above are precisely the class of defect it existed to catch.
