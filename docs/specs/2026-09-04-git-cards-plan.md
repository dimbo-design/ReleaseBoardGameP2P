# Git cards on the board — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Git Cherry-pick, Git Rebase and System Upgrade playable on the real board — writing
the two engine effects that do not exist yet, correcting one that does, and giving all three the
choreographies the playground already approves.

**Architecture:** Four sequential slices. **A** corrects `fake/discard.ts` so a trigger can never be
cherry-picked into a hand, then gives Cherry-pick its own staging hook beside `_useInsideStaging`.
**B** and **C** add the `reorderTop` and `systemUpgrade` pendings to the engine contract — the second
of which is the first pending owed to several seats at once, carrying `owed: PlayerId[]` and no
`player` field, so the compiler enumerates every union-wide read that must now decide something. **D**
puts both on the board: Rebase as a private staging hook, System Upgrade as a centre rendered from
the projection with beats that animate only arrivals.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, React 19, CSS Modules. Engine:
`packages/engine` (pure reducer + `PendingView` projection). Board: `apps/frontend`
(`features/board-beats` queue, `pages/board/[gameId]/_use*Staging` hooks). Kit: `apps/ui`
(`TablePending`, `PendingPrompt`, `@release/ui/animations`).

**Spec:** [`docs/specs/2026-09-04-git-cards-design.md`](./2026-09-04-git-cards-design.md)
**Rules answers:** [`docs/specs/2026-09-04-git-cards-rules-decisions.md`](./2026-09-04-git-cards-rules-decisions.md)

## Global Constraints

- **Verify every new test by mutation, not by reasoning.** Break the code the test names, watch it go
  red, restore. #61's standing instruction, written after nine tests shipped green asserting nothing.
- **Never guess a rule.** Anything not settled by `docs/rules/` or the two decisions files becomes an
  entry in `docs/rules/backlog.md` **and** a `> ❓ **Не из правил.**` marker at the paragraph it came
  from. Do not write code from an inference.
- **Code comments in English.** (`CLAUDE.md`.) `docs/rules/` is Russian; everything else in English.
- **No string literals in `.tsx`.** All user-visible text through `t()` / translation keys, and a key
  must exist in **both** `packages/translation/src/locales/en/common.json` and `…/ru/common.json`.
- **CSS Modules + design tokens only.** No hardcoded colours — add a token to
  `apps/ui/src/design/tokens.css` first. Logical properties (`inset-block-start`, `padding-inline`).
  No Tailwind.
- **`prefers-reduced-motion` is honoured everywhere.** `play()` does not check it. `useBeats` owns the
  policy for beats; a staging hook that would wait on a flight must resolve immediately instead —
  `_useInsideStaging.tsx`'s rule, because an engine left waiting on an animation nobody plays is a
  stalled match.
- **A movement found in two scenes is a module, not a copy.** Port it into
  `apps/ui/src/animations/`; record the gap on the audit page **and** `docs/animations/backlog.md`.
- Commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`. A single engine file:
  `pnpm --filter @release/engine test src/fake/rebase.test.ts`.
- Commit scopes used in this repo: `feat(engine)`, `fix(web)`, `test(web)`, `docs(specs)`,
  `docs(animations)`. Every commit references `(#108)`, and engine work also `(#61)`.

---

## File Structure

**Engine — `packages/engine/src/`**

| File | Responsibility | Slice |
|---|---|---|
| `cards.ts` | `CARD_RULES` gains `operation-git-rebase`, `operation-system-upgrade` | B, C |
| `state.ts` | `Pending` gains `reorderTop`, `systemUpgrade` | B, C |
| `view.ts` | `PendingView` mirrors both, `mine`-gated where the design says | B, C |
| `actions.ts` | `Choice` gains `reorderTop`, `upgradeDiscard`, `upgradeTake` | B, C |
| `fake/discard.ts` | the trigger rule for Cherry-pick | A |
| `fake/rebase.ts` *(new)* | open + resolve `reorderTop` | B |
| `fake/upgrade.ts` *(new)* | open + resolve `systemUpgrade`, both phases | C |
| `fake/release.ts` | `onPlay`'s operation dispatch gains two ids | B, C |
| `fake/reduce.ts` | `onResolve` dispatch gains three choice kinds | B, C |
| `fake/attacks.ts` | `pendingView` gains two cases | B, C |
| `fake/bots.ts` | "does this pending owe me", and `runUntilIdle`'s seat pick | C |
| `fake/index.ts` | `FAKE_DECK` gains both ids | B, C |
| `conformance.ts` | two `resolvePendingAction` cases, the `thrown` census branch, the reorder invariant | B, C |

**Kit — `apps/ui/src/table/Table/`**: `intents.ts` (`TablePending` mirrors the engine),
`dock.ts` + `Table.tsx` + `PendingPrompt/PendingPrompt.tsx` (the five union-wide `player` reads).

**Board — `apps/frontend/src/`**

| File | Responsibility | Slice |
|---|---|---|
| `pages/board/[gameId]/_useCherryPickStaging.tsx` *(new)* + `.module.css` | the whole-discard grid | A |
| `pages/board/[gameId]/_useRebaseStaging.tsx` *(new)* + `.module.css` | the private numbered row | D |
| `pages/board/[gameId]/_useUpgradeStaging.tsx` *(new)* + `.module.css` | the owed seat's throw, and sudo's pick | D |
| `pages/board/[gameId]/_Board.tsx` | wiring, panel suppression, the centre render of `thrown` | A, D |
| `features/board-beats/upgradeBeat.tsx` *(new)* | the arrival beat | D |
| `features/board-beats/planBeats.ts` | the `upgrade` plan kind and its run-folding | D |
| `features/board-beats/useBeats.ts` | registers the new runner | D |
| `entities/game/board/contract.test-d.ts` | the `Exact<>` assertions covering both new variants | B, C |

---

## Phase A — Cherry-pick

### Task A1: A trigger is not offered to a base Cherry-pick

**Files:**
- Modify: `packages/engine/src/fake/discard.ts:9-12` (`discardOptions`), `:23-46`
  (`openPickFromDiscard`)
- Test: `packages/engine/src/fake/discard.test.ts`

**Interfaces:**
- Consumes: `discardOptions(state, releasesOnly)`, `openPickFromDiscard(state, log, player, card, combo, releasesOnly)`, `rulesFor` from `../cards`.
- Produces: `discardOptions(state: GameState, releasesOnly: boolean, sudo?: boolean)` — the third
  argument is what lets a trigger stay on offer for the deck slot. Task A2 relies on this signature.

- [ ] **Step 1: Write the failing tests**

Add to `packages/engine/src/fake/discard.test.ts`, inside `describe('Git Cherry-pick', ...)`. The
`gameWith` helper already at the top of that file builds the state.

```ts
  // "Обе карты нельзя держать в руке" (docs/rules/cards.md, the trigger
  // section). Both trigger types reach the discard in ordinary play, because
  // that is where fireTrigger banks them.
  it('does not offer a trigger to a base pick — it could only go to the hand', () => {
    const state = gameWith(['trigger-error-503', 'attack-bug'], [CHERRY])
    const { state: next } = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      at: 1,
    })
    const pending = next.pending as { options: { id: string }[]; picks: number }
    expect(pending.options.map((o) => o.id)).toEqual(['attack-bug'])
    expect(pending.picks).toBe(1)
  })

  it('raises no pending at all when the discard holds nothing but triggers', () => {
    const state = gameWith(['trigger-error-503', 'trigger-ai'], [CHERRY])
    const { state: next } = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      at: 1,
    })
    // Rules answer 11: a play with nothing to take is the player's own blunder,
    // not a rejected action — the card is spent and the turn goes on.
    expect(next.pending).toBeNull()
    expect(next.decks.discard.map((c) => c.id)).toContain('operation-git-cherry-pick')
  })

  it('keeps offering triggers under sudo, where one may take the deck slot', () => {
    const state = gameWith(['trigger-error-503', 'attack-bug'], [CHERRY, 'support-sudo'])
    const { state: next } = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      combo: 'support-sudo#h1',
      at: 1,
    })
    const pending = next.pending as { options: { id: string }[]; picks: number }
    expect(pending.options.map((o) => o.id)).toEqual(['trigger-error-503', 'attack-bug'])
    expect(pending.picks).toBe(2)
  })
```

- [ ] **Step 2: Run them and watch all three fail**

```bash
pnpm --filter @release/engine test src/fake/discard.test.ts
```

Expected: the first two fail (`options` still holds `trigger-error-503`; the second raises a pending
instead of `null`); the third passes already and is the regression guard for step 3.

- [ ] **Step 3: Implement**

In `packages/engine/src/fake/discard.ts`, replace `discardOptions` and the offer computation:

```ts
// Cherry-pick offers the whole pile; Inside offers only Releases. Everything
// else about the two effects is identical, which is why they share a pending.
//
// A trigger is the one card the pile may hold that a hand may not: "обе карты
// нельзя держать в руке" (docs/rules/cards.md). Under sudo it stays on offer —
// the rules let a trigger be the card that goes onto the DECK — and
// onPickFromDiscard is what refuses it the hand slot. Without sudo there is no
// slot it could legally fill, so it is not offered at all.
export function discardOptions(
  state: GameState,
  releasesOnly: boolean,
  sudo = false,
): CardInstance[] {
  if (releasesOnly) return state.decks.discard.filter((c) => rulesFor(c.id)?.kind === 'release')
  if (sudo) return state.decks.discard
  return state.decks.discard.filter((c) => rulesFor(c.id)?.kind !== 'trigger')
}
```

and, inside `openPickFromDiscard`, change the first line of the body:

```ts
  const options = discardOptions(state, releasesOnly, combo !== undefined)
```

- [ ] **Step 4: Run the file and the whole engine suite**

```bash
pnpm --filter @release/engine test
```

Expected: PASS. `ai-inside` is untouched — it passes `releasesOnly: true`, which returns before the
new branch.

- [ ] **Step 5: Verify by mutation**

Change `!== 'trigger'` to `!== 'attack'` and confirm the first test goes red naming
`trigger-error-503`; drop the `sudo` argument at the call site and confirm the third goes red. Restore
both.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/fake/discard.ts packages/engine/src/fake/discard.test.ts
git commit -m "fix(engine): a base cherry-pick is not offered the one card a hand may not hold (#108, #61)"
```

### Task A2: A trigger is refused the hand slot under sudo

**Files:**
- Modify: `packages/engine/src/fake/discard.ts` (`onPickFromDiscard`, after the `offered` guards)
- Test: `packages/engine/src/fake/discard.test.ts`

**Interfaces:**
- Consumes: `discardOptions(state, releasesOnly, sudo)` from Task A1.
- Produces: nothing new; `onPickFromDiscard` gains one rejection reason,
  `'that card cannot go to a hand'`.

- [ ] **Step 1: Write the failing tests**

```ts
  it('refuses a trigger as the card taken to hand, even under sudo', () => {
    const state = gameWith(['trigger-error-503', 'attack-bug'], [CHERRY, 'support-sudo'])
    const played = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      combo: 'support-sudo#h1',
      at: 1,
    }).state
    const { state: next, events } = engine.reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: { kind: 'pickFromDiscard', card: 'trigger-error-503#d0', toDeck: 'attack-bug#d1' },
      at: 2,
    })
    expect(next).toBe(played)
    expect(events.map((e) => e.type)).toEqual(['rejected'])
    expect(next.players.p1.hand.map((c) => c.id)).not.toContain('trigger-error-503')
  })

  it('lets a trigger be the sudo card that goes onto the deck', () => {
    const state = gameWith(['trigger-error-503', 'attack-bug'], [CHERRY, 'support-sudo'])
    const played = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      combo: 'support-sudo#h1',
      at: 1,
    }).state
    const { state: next } = engine.reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: { kind: 'pickFromDiscard', card: 'attack-bug#d1', toDeck: 'trigger-error-503#d0' },
      at: 2,
    })
    expect(next.players.p1.hand.map((c) => c.id)).toContain('attack-bug')
    expect(next.decks.main[0][0].id).toBe('trigger-error-503')
  })
```

- [ ] **Step 2: Run and watch the first fail**

```bash
pnpm --filter @release/engine test src/fake/discard.test.ts
```

Expected: the first FAILS (the trigger reaches the hand); the second passes and guards step 3.

- [ ] **Step 3: Implement**

In `onPickFromDiscard`, directly after the existing `if (!toHand) return reject(...)` line:

```ts
  // The offer may legitimately contain a trigger (a sudo pick can put one on
  // the deck), so the hand slot is guarded here rather than by withholding it.
  // A hostile or stale RESOLVE never passes through the board, which is why
  // this cannot live in the UI.
  if (rulesFor(toHand.id)?.kind === 'trigger') {
    return reject(state, action, 'that card cannot go to a hand')
  }
```

- [ ] **Step 4: Run the engine suite**

```bash
pnpm --filter @release/engine test
```

Expected: PASS.

- [ ] **Step 5: Verify by mutation**

Invert the guard to `!== 'trigger'` and confirm the *second* test goes red (a legal deck placement
refused); delete the guard and confirm the first goes red. Restore.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/fake/discard.ts packages/engine/src/fake/discard.test.ts
git commit -m "fix(engine): the sudo cherry-pick's trigger goes on the deck, never into the hand (#108, #61)"
```

### Task A3: Cherry-pick's own surface on the board — selection

**Files:**
- Create: `apps/frontend/src/pages/board/[gameId]/_useCherryPickStaging.tsx`
- Create: `apps/frontend/src/pages/board/[gameId]/_useCherryPickStaging.module.css`
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx:1718` (panel suppression) and the hook
  wiring beside `useInsideStaging` (`:449`)
- Modify: `packages/translation/src/locales/en/common.json`, `…/ru/common.json`
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/boardCherryPick.test.tsx` *(new)*

**Interfaces:**
- Consumes: `BoardState['pending']` narrowed to `pickFromDiscard`; `TableActions['onResolve']`;
  `Card`, `ConfirmAction`, `cardById` from `@release/ui`.
- Produces: `useCherryPickStaging({ state, actions, copy, enabled }): { grid: ReactNode | null }`.
  Task A4 adds flights inside this same hook and does not change the signature.

- [ ] **Step 1: Add the copy, in both catalogues**

`packages/translation/src/locales/en/common.json`, beside `table.insidePrompt`:

```json
    "cherryPickPrompt": "choose a card to take to hand",
    "cherryPickSudoPrompt": "choose 2: one to hand, one onto the deck top",
    "cherryPickToHand": "→ hand",
    "cherryPickToDeck": "→ deck",
    "cherryPickNoHand": "no hand",
```

`packages/translation/src/locales/ru/common.json`, same keys:

```json
    "cherryPickPrompt": "выбери карту для добора в руку",
    "cherryPickSudoPrompt": "выбери 2: одна в руку, вторая на верх колоды",
    "cherryPickToHand": "→ в руку",
    "cherryPickToDeck": "→ на колоду",
    "cherryPickNoHand": "нельзя в руку",
```

- [ ] **Step 2: Write the failing test**

`apps/frontend/src/pages/board/[gameId]/__tests__/boardCherryPick.test.tsx`. Copy the harness from
`__tests__/boardAi.test.tsx` (its `cherryPending` helper at `:240` already builds this pending) —
read that file first and reuse its render helper verbatim rather than writing a second one.

```tsx
it('gives an operation-git-cherry-pick pending the grid, not the panel', async () => {
  const onResolve = vi.fn()
  renderBoard({
    pending: cherryPending([
      { uid: 'c1', id: 'attack-bug' },
      { uid: 'c2', id: 'release-frontend' },
    ]),
    actions: { onResolve },
  })
  expect(screen.getByTestId('board-cherry-grid')).toBeInTheDocument()
  expect(screen.queryByTestId('board-inside-row')).not.toBeInTheDocument()

  await userEvent.click(screen.getByTestId('cherry-cell-c2'))
  await userEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
  expect(onResolve).toHaveBeenCalledWith({ kind: 'pickFromDiscard', card: 'c2' })
})

it('names both roles under a sudo pick and sends toDeck', async () => {
  const onResolve = vi.fn()
  renderBoard({
    pending: cherryPending(
      [
        { uid: 'c1', id: 'attack-bug' },
        { uid: 'c2', id: 'release-frontend' },
      ],
      2,
    ),
    actions: { onResolve },
  })
  await userEvent.click(screen.getByTestId('cherry-cell-c1'))
  await userEvent.click(screen.getByTestId('cherry-cell-c2'))
  await userEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'pickFromDiscard',
    card: 'c1',
    toDeck: 'c2',
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm --filter @release/web test src/pages/board/\[gameId\]/__tests__/boardCherryPick.test.tsx
```

Expected: FAIL — no element with test id `board-cherry-grid`.

- [ ] **Step 4: Write the hook**

`_useCherryPickStaging.tsx`. Read `_useInsideStaging.tsx` first: the `ours` gate, the
"one candidate answers itself" latch and the "nothing armed survives its pending" effect are all
correct here and are copied deliberately, with `source` pointing at the other card.

```tsx
import type { TableActions } from '@release/ui'
import { Card, ConfirmAction, cardById } from '@release/ui'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { BoardState } from '~/entities/game/board'
import styles from './_useCherryPickStaging.module.css'

// Git Cherry-pick — the OTHER `pickFromDiscard` (see `_useInsideStaging.tsx`,
// which owns `ai-inside`). Two things make it a sibling rather than a widening
// of that row: the offer is the whole discard rather than its Releases, so it
// scrolls, and a sudo pick fills two slots whose roles are decided by rule
// rather than by click order.
//
// The two roles come from the ENGINE's own offer, not from a rule re-derived
// here: `openPickFromDiscard` withholds triggers from a base pick, and
// `onPickFromDiscard` refuses one the hand slot. So a trigger in `options` can
// only be the deck card, and that is the whole of the rule this hook needs.
//
// The grid stands OVER an unchanged heap: the engine leaves the candidates in
// `decks.discard` until the pick resolves, so nothing is lifted out of the
// projection while it is being chosen from.
const isTrigger = (id: string) => cardById(id)?.category === 'trigger'

export function useCherryPickStaging(args: {
  state: BoardState
  actions?: TableActions
  copy: { prompt: string; sudoPrompt: string; toHand: string; toDeck: string; noHand: string; confirm: string }
  enabled: boolean
}): { grid: ReactNode | null } {
  const { state, actions, copy, enabled } = args
  const pending = state.pending
  const ours =
    enabled &&
    pending?.kind === 'pickFromDiscard' &&
    pending.source === 'operation-git-cherry-pick' &&
    pending.player === state.selfId
      ? pending
      : null

  const [picks, setPicks] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false)

  // One candidate is not a choice — `_useInsideStaging`'s precedent, and
  // #105's Decision 2 before it. Latched on the pending rather than the mount,
  // so a second, distinct pending is free to fire again.
  const answered = useRef<string | null>(null)
  useEffect(() => {
    if (!ours) {
      answered.current = null
      return
    }
    if (ours.picks !== 1 || ours.options.length !== 1) return
    const only = ours.options[0]
    const key = `${ours.player}:${ours.source}:${only.uid}`
    if (answered.current === key) return
    answered.current = key
    actions?.onResolve?.({ kind: 'pickFromDiscard', card: only.uid })
  }, [ours, actions])

  useEffect(() => {
    if (!ours) {
      setPicks([])
      setConfirmed(false)
    }
  }, [ours])

  if (!ours || confirmed) return { grid: null }
  if (ours.picks === 1 && ours.options.length < 2) return { grid: null }

  const sudo = ours.picks === 2
  // A trigger can only be the deck card, so it never takes the hand slot: with
  // one chosen, the other role is whatever is left.
  const roles = (() => {
    if (!sudo) return { hand: picks[0] ?? null, deck: null as string | null }
    const [a, b] = picks
    const idOf = (uid?: string) => ours.options.find((o) => o.uid === uid)?.id
    if (picks.length === 1) {
      const id = idOf(a)
      return id && isTrigger(id)
        ? { hand: null as string | null, deck: a }
        : { hand: a, deck: null as string | null }
    }
    const idA = idOf(a)
    if (idA && isTrigger(idA)) return { hand: b, deck: a }
    return { hand: a, deck: b }
  })()

  const canSelect = (uid: string, id: string) => {
    if (picks.includes(uid)) return true
    if (picks.length >= ours.picks) return false
    if (!isTrigger(id)) return true
    // Only one trigger may be held, and only for the single deck slot.
    return sudo && !picks.some((u) => isTrigger(idOfOption(ours.options, u)))
  }

  const ready = picks.length === ours.picks

  return {
    grid: (
      <div className={styles.grid} data-testid="board-cherry-grid">
        {ours.options.map((o) => {
          const data = cardById(o.id)
          if (!data) return null
          const handRole = roles.hand === o.uid
          const deckRole = roles.deck === o.uid
          const selected = handRole || deckRole
          const blocked = !selected && !canSelect(o.uid, o.id)
          return (
            <button
              key={o.uid}
              type="button"
              data-testid={`cherry-cell-${o.uid}`}
              className={`${styles.cell} ${blocked ? styles.blocked : ''}`}
              onClick={() =>
                setPicks((p) =>
                  p.includes(o.uid)
                    ? p.filter((u) => u !== o.uid)
                    : canSelect(o.uid, o.id)
                      ? [...p, o.uid]
                      : p,
                )
              }
            >
              <Card
                card={data}
                interactive={false}
                width="100%"
                state={selected ? 'selected' : 'idle'}
                // one out of a set — the uniform selection colour, never the
                // per-category accent
                accent="var(--select-accent)"
              />
              {handRole && <span className={styles.roleTag}>{copy.toHand}</span>}
              {deckRole && <span className={styles.roleTag}>{copy.toDeck}</span>}
              {!sudo && isTrigger(o.id) && <span className={styles.lockTag}>{copy.noHand}</span>}
            </button>
          )
        })}
        <ConfirmAction
          open
          label={copy.confirm}
          caption={sudo ? copy.sudoPrompt : copy.prompt}
          disabled={!ready}
          onConfirm={() => {
            // re-checked against THIS render's offer, the discipline every
            // branch of the kit's own panel keeps
            const hand = roles.hand
            if (!hand || !ours.options.some((o) => o.uid === hand)) return
            const deck = roles.deck
            setConfirmed(true)
            actions?.onResolve?.({
              kind: 'pickFromDiscard',
              card: hand,
              ...(deck ? { toDeck: deck } : {}),
            })
          }}
        />
      </div>
    ),
  }
}

const idOfOption = (options: { uid: string; id: string }[], uid: string) =>
  options.find((o) => o.uid === uid)?.id ?? ''
```

- [ ] **Step 5: Write the module CSS**

`_useCherryPickStaging.module.css`. Read `_useInsideStaging.module.css` for the band's placement and
`_useHandLimit.module.css` for a scrolling centre surface; the grid is wider than either row, so it
wraps and scrolls in its own container rather than the page scrolling.

```css
/* The whole discard, face up, over the heap it still belongs to (#108). Wider
   than Inside's row (`_useInsideStaging.module.css`), because Cherry-pick
   offers the pile rather than its Releases — so it wraps and scrolls in its own
   box instead of pushing the table around. */
.grid {
  position: absolute;
  inset-block-start: 18%;
  inset-inline: 0;
  z-index: 40;
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  align-items: flex-end;
  justify-content: center;
  max-block-size: 56vh;
  overflow-y: auto;
  padding-inline: 40px;
  transform: translateY(-50%);
}

.cell {
  position: relative;
  inline-size: 150px;
  padding: 0;
  cursor: pointer;
  background: none;
  border: 0;
}

.blocked {
  cursor: not-allowed;
  opacity: 0.45;
}

.roleTag,
.lockTag {
  position: absolute;
  inset-block-end: -22px;
  inset-inline: 0;
  text-align: center;
}
```

- [ ] **Step 6: Wire it into the board**

In `_Board.tsx`, beside the `useInsideStaging` call (currently at `:449`):

```tsx
  // Git Cherry-pick's own grid (#108) — the OTHER `pickFromDiscard`. Gated on
  // `source` for the same reason Inside is: the two effects share a pending
  // kind and nothing else.
  const cherry = useCherryPickStaging({
    state,
    actions,
    copy: {
      prompt: copy.table.cherryPickPrompt,
      sudoPrompt: copy.table.cherryPickSudoPrompt,
      toHand: copy.table.cherryPickToHand,
      toDeck: copy.table.cherryPickToDeck,
      noHand: copy.table.cherryPickNoHand,
      confirm: copy.pending.confirm,
    },
    enabled: !(deal.active || beats.exclusive),
  })
```

Render `{cherry.grid}` immediately after `{inside.row}`, and widen the panel suppression at `:1718`
so it covers both surfaces:

```tsx
        // Both `pickFromDiscard` surfaces replace the generic panel: Inside's
        // row (#106) and Cherry-pick's grid (#108). A panel that unmounts when
        // the pending clears cannot hold a flight, which is what the grid is
        // about to do.
        !(state.pending.kind === 'pickFromDiscard' &&
          (state.pending.source === 'ai-inside' ||
            state.pending.source === 'operation-git-cherry-pick')) && (
```

Add `cherryPickPrompt`, `cherryPickSudoPrompt`, `cherryPickToHand`, `cherryPickToDeck` and
`cherryPickNoHand` to the board's copy bundle where `insidePrompt` is assembled.

- [ ] **Step 7: Run the new test, then the whole board suite**

```bash
pnpm --filter @release/web test src/pages/board
```

Expected: PASS, including `__tests__/boardAi.test.tsx:234`'s existing assertion that Cherry-pick does
**not** get Inside's row — that test now also proves the grid took it instead, so read it and update
its comment to say so.

- [ ] **Step 8: Verify by mutation**

Change the `source` gate to `'ai-inside'` and confirm the first test goes red on a missing grid.
Delete the `toDeck` spread in `onConfirm` and confirm the second goes red. Restore.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/pages/board packages/translation/src/locales
git commit -m "feat(web): cherry-pick asks its question over the pile it is reaching into (#108)"
```

### Task A4: Cherry-pick's flights

**Files:**
- Modify: `apps/frontend/src/pages/board/[gameId]/_useCherryPickStaging.tsx`
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/boardCherryPick.test.tsx`

**Interfaces:**
- Consumes: `useHandArrival`, `useDiscardExit`, `play`, `scatterAt`, `HEAP_SHOW` from
  `@release/ui/animations`; `BoardAnchors` (`discardBox`, `pileBox(0)`, `hand`, `centre`).
- Produces: the hook's return grows to `{ grid, overlay }` — `_Board.tsx` renders `overlay` beside
  the other staging overlays.

- [ ] **Step 1: Extract the reduced-motion test helper, then write the failing test**

Three board tests already inline the same nine-line `matchMedia` spy
(`__tests__/boardStaging.test.tsx:258`, `boardDefense.test.tsx`, `boardRelease.test.tsx`). Writing a
fourth copy is the moment to package it. Create
`apps/frontend/src/test/reducedMotion.ts`:

```ts
import { vi } from 'vitest'

// jsdom implements no matchMedia, and `test-setup.ts`'s stub answers `false` to
// everything — which is the right default, since almost every test wants the
// animated path. This is the opposite switch, inlined in three board tests
// before it was worth a module.
export function mockReducedMotion(reduce: boolean) {
  return vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
}
```

Leave the three existing copies alone in this task — replacing them is a separate, mechanical change
that would bury this one's diff.

Reduced motion is the contract that must not regress, so pin it first:

```tsx
it('resolves at once under reduced motion, with nothing left flying', async () => {
  mockReducedMotion(true)
  const onResolve = vi.fn()
  renderBoard({
    pending: cherryPending([
      { uid: 'c1', id: 'attack-bug' },
      { uid: 'c2', id: 'release-frontend' },
    ]),
    actions: { onResolve },
  })
  await userEvent.click(screen.getByTestId('cherry-cell-c2'))
  await userEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
  expect(onResolve).toHaveBeenCalledWith({ kind: 'pickFromDiscard', card: 'c2' })
  expect(screen.queryByTestId('board-cherry-grid')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @release/web test src/pages/board/\[gameId\]/__tests__/boardCherryPick.test.tsx
```

Expected: FAIL if the confirm path has begun waiting on a flight; PASS while Task A3's immediate
resolve is still in place — which is exactly the line Step 3 must not cross.

- [ ] **Step 3: Add the flights**

Follow the story `apps/playground/stories/interactive/GitCards/CherryPick.tsx` — read
`confirmPick()` there and port it, keeping its two-pass rect capture verbatim (read every cell's rect
BEFORE pinning any of them; pinning one reflows the rest and every later card would start its flight
from the wrong place). The values, all from the story:

| Leg | Preset / step | Values |
|---|---|---|
| deal out of the pile | CSS transition from the pile rect | `DEAL_DUR` 360, `DEAL_STEP` 16, `STAGGER_CAP` 40 |
| pick → centre | CSS transition, then `useHandArrival` | `REVEAL_W` 220, `REVEAL_DUR` 460, `REVEAL_HOLD` 560 |
| sudo card | `play('flipCard', …)` then `play('returnToDeck', el, { from, to })` | `FLIP_DUR` 420, `DECK_DUR` 480, `DECK_HOLD` 360 |
| the unpicked | `useDiscardExit(anchors.discardBox).send([...])` | `RETURN_DUR` 420, `RETURN_STEP` 14, `fade` below `HEAP_SHOW` |

Two board-specific rules the story cannot express:

```tsx
  // The unpicked land on their OWN scatter, the value the resting heap will
  // render (I7) — so the last frame of the flight IS the projection it hands
  // over to, with no re-layout when the animation ends.
  scatter: scatterAt(i, PILE_W),
```

```tsx
  // A game action must never wait on an animation nobody plays
  // (`_useInsideStaging`'s rule). Under reduced motion the RESOLVE goes now and
  // the grid simply unmounts.
  if (reduced) {
    actions?.onResolve?.(choice)
    return
  }
```

- [ ] **Step 4: Run the board suite**

```bash
pnpm --filter @release/web test src/pages/board
```

Expected: PASS.

- [ ] **Step 5: Verify by mutation**

Force `reduced` to `false` and confirm the reduced-motion test goes red (the grid is still mounted, or
the resolve is late). Restore.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/pages/board
git commit -m "feat(web): the cherry-picked card takes the road the story gives it (#108)"
```

---

## Phase B — Git Rebase in the engine

### Task B1: The `reorderTop` contract

**Files:**
- Modify: `packages/engine/src/cards.ts:25-27` (the comment) and `:52-54` (`CARD_RULES`)
- Modify: `packages/engine/src/fake/index.ts:11-15` (the comment) and `FAKE_DECK`
- Modify: `packages/engine/src/state.ts` (`Pending`), `view.ts` (`PendingView`), `actions.ts` (`Choice`)
- Modify: `apps/ui/src/table/Table/intents.ts:35-84` (`TablePending`)
- Test: `packages/engine/src/cards.test.ts:32`, `apps/frontend/src/entities/game/board/contract.test-d.ts`

**Interfaces:**
- Produces, and every later task in this phase depends on these exact names:
  - `Pending`: `{ kind: 'reorderTop'; player: PlayerId; piles: { pile: number; cards: CardInstance[] }[]; source: CardId }`
  - `PendingView` / kit `TablePending`: the same, with `cards: CardInstance[]` (engine) /
    `{ uid: string; id: string }[]` (kit), `[]` for a viewer who is not the owner.
  - `Choice`: `{ kind: 'reorderTop'; order: { pile: number; cards: CardUid[] }[] }`

- [ ] **Step 1: Write the failing test**

In `packages/engine/src/cards.test.ts`, narrow the deferred list — Rebase is leaving it:

```ts
it('omits the deferred cards', () => {
  // Git Branch and Git Merge left this list with #61 slice B, Git Rebase with
  // #108. System Upgrade needs a pending owed to several players at once and is
  // still ahead.
  expect(rulesFor('operation-system-upgrade')).toBeUndefined()
})

it('implements Git Rebase as a sudo-capable operation', () => {
  expect(rulesFor('operation-git-rebase')).toEqual({ kind: 'operation', sudo: true })
})
```

- [ ] **Step 2: Run and watch the second fail**

```bash
pnpm --filter @release/engine test src/cards.test.ts
```

Expected: FAIL — `rulesFor('operation-git-rebase')` is `undefined`.

- [ ] **Step 3: Add the id, the quantity and the three type variants**

`packages/engine/src/cards.ts`, in `CARD_RULES` beside the other operations:

```ts
  'operation-git-rebase': { kind: 'operation', sudo: true },
```

and correct the comment above `CARD_RULES` — only System Upgrade is deferred now.

`packages/engine/src/fake/index.ts`, in `FAKE_DECK` (quantity from rules decision 12):

```ts
  { id: 'operation-git-rebase', qty: 3 },
```

`packages/engine/src/state.ts`, appended to the `Pending` union:

```ts
  // Git Rebase. The offered cards are private to the player using it — "не
  // показывая другим" — so pendingView gates `piles` behind `mine` exactly as
  // it gates `pickFromDiscard.options`. One entry per pile the effect reaches:
  // base = the pile the player named (rules decisions 2026-09-04 answer 1),
  // sudo = every pile. `cards` is top-first, so index 0 is the next card drawn.
  | {
      kind: 'reorderTop'
      player: PlayerId
      piles: { pile: number; cards: CardInstance[] }[]
      source: CardId
    }
```

`packages/engine/src/view.ts`, appended to `PendingView`:

```ts
  // Full card identity, gated behind `mine` in pendingView (attacks.ts) — the
  // whole of what "не показывая другим" needs, since a deck's contents are
  // never projected to anyone.
  | {
      kind: 'reorderTop'
      player: PlayerId
      piles: { pile: number; cards: CardInstance[] }[]
      source: CardId
    }
```

`packages/engine/src/actions.ts`, appended to `Choice`:

```ts
  // The order the player committed, per pile: index 0 becomes the new top.
  // Validated as an exact permutation of what the pending offered.
  | { kind: 'reorderTop'; order: { pile: number; cards: CardUid[] }[] }
```

`apps/ui/src/table/Table/intents.ts`, appended to `TablePending` — the kit mirrors the engine and
`contract.test-d.ts`'s `Exact<>` assertions fail if it does not:

```ts
  | {
      kind: 'reorderTop'
      player: string
      piles: { pile: number; cards: { uid: string; id: string }[] }[]
      source: string
    }
```

- [ ] **Step 4: Add the `pendingView` case**

`packages/engine/src/fake/attacks.ts`, in the `switch` that ends at the `pickFromDiscard` case:

```ts
    case 'reorderTop':
      // A deck's contents are never public, so this is `mine` or nothing —
      // the same gate `pickFromDiscard` uses, for the same reason.
      return {
        kind: 'reorderTop',
        player: p.player,
        piles: mine ? p.piles.map((e) => ({ pile: e.pile, cards: [...e.cards] })) : [],
        source: p.source,
      }
```

- [ ] **Step 5: Type-check and run**

```bash
pnpm typecheck && pnpm --filter @release/engine test src/cards.test.ts
```

Expected: both PASS. If `contract.test-d.ts` complains, the kit's variant and the engine's differ —
make them identical rather than casting.

- [ ] **Step 6: Verify by mutation**

Remove the `mine ?` guard in the new `pendingView` case and confirm you can write a two-line test that
goes red (an opponent's projection carrying the cards); restore the guard and keep that test — it
belongs in Task B3's file.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src apps/ui/src/table/Table/intents.ts
git commit -m "feat(engine): the contract for a private look at the top of a pile (#108, #61)"
```

### Task B2: Playing Git Rebase opens the pending

**Files:**
- Create: `packages/engine/src/fake/rebase.ts`
- Modify: `packages/engine/src/fake/release.ts:126-153` (the operation dispatch)
- Test: `packages/engine/src/fake/rebase.test.ts` *(new)*

**Interfaces:**
- Consumes: `createLog`, `Log`, `reject`, `bankToDiscard` from `./core`; the `Pending` variant from B1.
- Produces: `openReorderTop(state: GameState, log: Log, player: PlayerId, card: CardInstance, combo: CardInstance | undefined, pile: number): GameState` — B3 and B4 call nothing from this file except
  `onReorderTop`, added there.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/fake/rebase.test.ts`. Build the state with the `table()` helper pattern from
`gitPiles.test.ts` — read that file and reuse its `config`, `pile()` and `table()` verbatim.

```ts
const REBASE: CardInstance = { uid: 'operation-git-rebase#0', id: 'operation-git-rebase' }
const SUDO: CardInstance = { uid: 'support-sudo#0', id: 'support-sudo' }

describe('Git Rebase', () => {
  it('offers the top three of the pile the player named', () => {
    const state = table([REBASE], [pile('a', 5), pile('b', 5)])
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 1 },
      at: 1,
    })
    expect(next.pending).toMatchObject({ kind: 'reorderTop', player: 'p1' })
    const p = next.pending as { piles: { pile: number; cards: CardInstance[] }[] }
    expect(p.piles).toHaveLength(1)
    expect(p.piles[0].pile).toBe(1)
    expect(p.piles[0].cards.map((c) => c.uid)).toEqual(['attack-bug#b0', 'attack-bug#b1', 'attack-bug#b2'])
  })

  it('reaches every pile under sudo, and names none', () => {
    const state = table([REBASE, SUDO], [pile('a', 5), pile('b', 4)])
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      combo: SUDO.uid,
      at: 1,
    })
    const p = next.pending as { piles: { pile: number; cards: CardInstance[] }[] }
    expect(p.piles.map((e) => e.pile)).toEqual([0, 1])
  })

  it('offers what a short pile has, rather than refusing the play', () => {
    // Rules decisions 2026-09-04 answer 2.
    const state = table([REBASE], [pile('a', 2)])
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 0 },
      at: 1,
    })
    const p = next.pending as { piles: { cards: CardInstance[] }[] }
    expect(p.piles[0].cards).toHaveLength(2)
  })

  it('spends the card for nothing when there is no pile at all', () => {
    const state = table([REBASE], [])
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      at: 1,
    })
    expect(next.pending).toBeNull()
    expect(next.decks.discard.map((c) => c.id)).toContain('operation-git-rebase')
    expect(next.players.p1.hand).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @release/engine test src/fake/rebase.test.ts
```

Expected: FAIL — `onPlay` still falls through to `openPickFromDiscard` for any operation that is not
Branch or Merge, so `pending.kind` is `pickFromDiscard`.

- [ ] **Step 3: Write `fake/rebase.ts`**

```ts
import type { CardInstance, CardUid, GameState, PlayerId } from '../state'
import { bankToDiscard, type Log } from './core'

// Git Rebase — look at the top three of a draw pile and reorder them, showing
// nobody. The privacy is the pendingView gate (attacks.ts), not anything here:
// this file only decides WHICH cards are offered.
const TOP = 3

// Base names one pile (rules decisions 2026-09-04 answer 1); sudo reaches every
// pile and names none. A pile shorter than three offers what it has, and no
// pile at all offers nothing — both legal plays that spend the card
// (answer 2), which is why this returns a state with no pending rather than a
// rejection.
export function openReorderTop(
  state: GameState,
  log: Log,
  player: PlayerId,
  card: CardInstance,
  combo: CardInstance | undefined,
  pile: number,
): GameState {
  const spent = combo ? [card, combo] : [card]
  for (const c of spent) log.add({ type: 'discarded', player, card: c.id, reason: 'effect' })
  const spentState = bankToDiscard(state, spent)

  const indices = combo ? state.decks.main.map((_, i) => i) : [pile]
  const piles = indices
    .filter((i) => (state.decks.main[i]?.length ?? 0) > 0)
    .map((i) => ({ pile: i, cards: state.decks.main[i].slice(0, TOP) }))

  if (piles.length === 0) return { ...spentState, eventSeq: log.seq }
  return {
    ...spentState,
    pending: { kind: 'reorderTop', player, piles, source: card.id },
    eventSeq: log.seq,
  }
}
```

- [ ] **Step 4: Dispatch it from `onPlay`**

`packages/engine/src/fake/release.ts`, in the `rules.kind === 'operation'` block, after the Git Merge
branch and before the Cherry-pick fallthrough:

```ts
    if (card.id === 'operation-git-rebase') {
      // With one pile there is nothing to choose, so an absent target means it
      // — the same reading Git Branch above gives an absent target.
      const chosen = action.target?.kind === 'pile' ? action.target.pile : 0
      return {
        state: openReorderTop(withoutCards, log, action.player, card, sudoCombo, chosen),
        events: log.events,
      }
    }
```

`openReorderTop` banks the spent cards itself, exactly as `openPickFromDiscard` does, so this branch
does not wrap it in `discard(...)` the way the Branch and Merge branches do.

- [ ] **Step 5: Run**

```bash
pnpm --filter @release/engine test
```

Expected: PASS.

- [ ] **Step 6: Verify by mutation**

Change `TOP` to 2 and confirm the first test goes red; drop the `.filter` on empty piles and confirm
the fourth goes red with a pending over an empty offer. Restore.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/fake
git commit -m "feat(engine): Git Rebase asks its private question, and asks nothing when there is no pile (#108, #61)"
```

### Task B3: Resolving a reorder

**Files:**
- Modify: `packages/engine/src/fake/rebase.ts`
- Modify: `packages/engine/src/fake/reduce.ts:279-306` (`onResolve`)
- Test: `packages/engine/src/fake/rebase.test.ts`

**Interfaces:**
- Produces: `onReorderTop(state: GameState, action: Action & { type: 'RESOLVE' }): Reduction`.

- [ ] **Step 1: Write the failing tests**

```ts
  it('puts the pile back in the order the player committed', () => {
    const played = reduce(table([REBASE], [pile('a', 5)]), {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 0 },
      at: 1,
    }).state
    const { state: next } = reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: {
        kind: 'reorderTop',
        order: [{ pile: 0, cards: ['attack-bug#a2', 'attack-bug#a0', 'attack-bug#a1'] }],
      },
      at: 2,
    })
    expect(next.pending).toBeNull()
    expect(next.decks.main[0].map((c) => c.uid)).toEqual([
      'attack-bug#a2',
      'attack-bug#a0',
      'attack-bug#a1',
      'attack-bug#a3',
      'attack-bug#a4',
    ])
  })

  it('rejects an order that is not a permutation of what was offered', () => {
    const played = reduce(table([REBASE], [pile('a', 5)]), {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 0 },
      at: 1,
    }).state
    const { state: next, events } = reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: {
        kind: 'reorderTop',
        // #a3 was never on offer — it is the fourth card down.
        order: [{ pile: 0, cards: ['attack-bug#a0', 'attack-bug#a1', 'attack-bug#a3'] }],
      },
      at: 2,
    })
    expect(next).toBe(played)
    expect(events.map((e) => e.type)).toEqual(['rejected'])
  })

  it('rejects a reorder from somebody else', () => {
    const played = reduce(table([REBASE], [pile('a', 5)]), {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 0 },
      at: 1,
    }).state
    const { events } = reduce(played, {
      type: 'RESOLVE',
      player: 'p2',
      choice: {
        kind: 'reorderTop',
        order: [{ pile: 0, cards: ['attack-bug#a0', 'attack-bug#a1', 'attack-bug#a2'] }],
      },
      at: 2,
    })
    expect(events.map((e) => e.type)).toEqual(['rejected'])
  })

  it('shows an opponent projection nothing of the offer', () => {
    const played = reduce(table([REBASE], [pile('a', 5)]), {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 0 },
      at: 1,
    }).state
    const view = engine.project(played, 'p2')
    expect(view.pending).toMatchObject({ kind: 'reorderTop', player: 'p1', piles: [] })
  })
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @release/engine test src/fake/rebase.test.ts
```

Expected: FAIL — `onResolve` has no `reorderTop` case, so every one of these is rejected as
"unsupported choice".

- [ ] **Step 3: Implement `onReorderTop`**

Appended to `packages/engine/src/fake/rebase.ts`:

```ts
export function onReorderTop(
  state: GameState,
  action: Action & { type: 'RESOLVE' },
): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'reorderTop') return reject(state, action, 'no reorder is pending')
  if (pending.player !== action.player) return reject(state, action, 'not your decision')
  const choice = action.choice
  if (choice.kind !== 'reorderTop') return reject(state, action, 'wrong choice for pending')

  // Every offered pile must be answered, exactly once each.
  if (choice.order.length !== pending.piles.length) {
    return reject(state, action, 'that is not the offer')
  }

  const main = [...state.decks.main]
  for (const entry of pending.piles) {
    const answer = choice.order.find((o) => o.pile === entry.pile)
    if (!answer) return reject(state, action, 'that is not the offer')
    const offered = entry.cards.map((c) => c.uid)
    // A permutation, not merely a subset: same length, same members, no repeats.
    if (answer.cards.length !== offered.length) return reject(state, action, 'that is not the offer')
    const seen = new Set<CardUid>()
    for (const uid of answer.cards) {
      if (!offered.includes(uid) || seen.has(uid)) {
        return reject(state, action, 'that card was not on offer')
      }
      seen.add(uid)
    }
    // The pending's cards are a snapshot; nothing changes a pile while a
    // pending stands, but trusting the snapshot over live state would
    // duplicate a card the moment that stops being true —
    // `onPickFromDiscard`'s own guard, and for the same reason.
    const live = main[entry.pile] ?? []
    if (offered.some((uid, i) => live[i]?.uid !== uid)) {
      return reject(state, action, 'that pile has moved')
    }
    const byUid = new Map(entry.cards.map((c) => [c.uid, c]))
    main[entry.pile] = [
      ...answer.cards.map((uid) => byUid.get(uid) as CardInstance),
      ...live.slice(offered.length),
    ]
  }

  // No event: the order is exactly what the rules say nobody else sees, and the
  // card's own `discarded` (openReorderTop) is the whole public story.
  return {
    state: { ...state, decks: { ...state.decks, main }, pending: null },
    events: [],
  }
}
```

Import `reject` and the `Action`/`Reduction`/`CardUid` types at the top of the file.

- [ ] **Step 4: Dispatch it**

`packages/engine/src/fake/reduce.ts`, in `onResolve`'s switch:

```ts
    case 'reorderTop':
      return onReorderTop(state, action)
```

- [ ] **Step 5: Run**

```bash
pnpm --filter @release/engine test
```

Expected: PASS.

- [ ] **Step 6: Verify by mutation**

Delete the `seen` repeat check and confirm you can make the permutation test go red by answering
`['#a0','#a0','#a0']`; add that case to the test file permanently. Delete the live-pile guard and
confirm the "that pile has moved" path is unreachable — if no test covers it, write one that mutates
`main` between PLAY and RESOLVE. Restore.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/fake
git commit -m "feat(engine): a committed reorder lands on the pile, and only a real permutation does (#108, #61)"
```

### Task B4: Rebase in conformance and in the bot

**Files:**
- Modify: `packages/engine/src/conformance.ts:60-176` (`resolvePendingAction`) and the invariants block
- Modify: `packages/engine/src/fake/bots.ts:38-88`
- Test: `packages/engine/src/conformance.ts` (the shared suite runs for the fake via `describeEngine`)

**Interfaces:**
- Consumes: `Choice['reorderTop']` from B1, `PendingView['reorderTop']` from B1.
- Produces: nothing importable; the `progress` property stops going red.

- [ ] **Step 1: Write the failing invariant**

In `conformance.ts`, beside the existing card-conservation property:

```ts
      it('never changes what a pile holds when its top is reordered', () => {
        const engine = make()
        const start = engine.createGame(configFor(options, 71))
        const { state } = drive(engine, start, 29, 400)
        // A reorder moves cards WITHIN a pile: the counts and the membership
        // are invariants, only the order is not.
        const before = realCardUids(start)
        expect(realCardUids(state)).toEqual(before)
        expect(state.decks.main.every((p) => p.length >= 0)).toBe(true)
      })
```

- [ ] **Step 2: Run the conformance suite and watch `progress` fail**

```bash
pnpm --filter @release/engine test src/fake/fake.test.ts
```

Expected: the `progress` property FAILS — the fuzz now reaches `operation-git-rebase` (it is in
`FAKE_DECK` since B1), raises a `reorderTop` pending, and `resolvePendingAction` has no case, so the
pending stands for more than three consecutive steps. This failure is the guard working as designed.

- [ ] **Step 3: Add the `resolvePendingAction` case**

```ts
    case 'reorderTop': {
      // The identity permutation is always valid, which is what makes this a
      // progress-only answer rather than a strategy.
      const order = pending.piles.map((e) => ({
        pile: e.pile,
        cards: e.cards.map((c) => c.uid),
      }))
      return { type: 'RESOLVE', player: pending.player, choice: { kind: 'reorderTop', order }, at }
    }
```

- [ ] **Step 4: Add the bot case**

`packages/engine/src/fake/bots.ts`, in `botAction`'s pending switch:

```ts
      case 'reorderTop': {
        // A bot has no opinion about deck order; leaving it alone is a legal
        // answer and keeps the seat from stalling the table.
        const order = pending.piles.map((e) => ({
          pile: e.pile,
          cards: e.cards.map((c) => c.uid),
        }))
        return { type: 'RESOLVE', player: me, choice: { kind: 'reorderTop', order }, at }
      }
```

- [ ] **Step 5: Run the whole engine suite**

```bash
pnpm --filter @release/engine test && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Verify by mutation**

Remove the `resolvePendingAction` case again and confirm `progress` goes red naming `reorderTop`;
restore. Then reverse the identity order in the bot case and confirm the suite still passes — proving
the invariant is about membership, not order, which is what it claims.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src
git commit -m "feat(engine): a rebase the fuzz can answer, and a pile that keeps every card it had (#108, #61)"
```

---

## Phase C — System Upgrade in the engine

> The one slice that changes what a `Pending` is allowed to mean. Task C1 is deliberately large: the
> new variant has no `player` field, so adding it breaks nine union-wide reads at once, and a
> half-fixed compile is not a reviewable state.

### Task C1: The `systemUpgrade` contract, and the nine reads it breaks

**Files:**
- Modify: `packages/engine/src/cards.ts`, `fake/index.ts`, `state.ts`, `view.ts`, `actions.ts`
- Modify: `packages/engine/src/fake/attacks.ts` (`pendingView`), `fake/bots.ts:38`, `:162`,
  `conformance.ts:973`
- Modify: `apps/ui/src/table/Table/intents.ts`, `dock.ts:57`, `:125`, `:155`,
  `PendingPrompt/PendingPrompt.tsx:210`, `Table.tsx:414`
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx:1698`
- Test: `packages/engine/src/cards.test.ts`

**Interfaces:**
- Produces, and C2–C5 and Phase D all depend on these exact names:
  - `Pending` / `PendingView` / kit `TablePending`:
    `{ kind: 'systemUpgrade'; actor: PlayerId; owed: PlayerId[]; thrown: { player: PlayerId; card: CardInstance }[]; sudo: boolean; phase: 'discarding' | 'picking'; source: CardId }`
  - `Choice`: `{ kind: 'upgradeDiscard'; card: CardUid }` and `{ kind: 'upgradeTake'; card: CardUid }`
  - Helper, exported from `packages/engine/src/state.ts` so every consumer asks the same way:
    `pendingOwes(pending: Pending | null, player: PlayerId): boolean`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/cards.test.ts` — the deferred list is now empty and the test that guarded it goes
away, replaced by its opposite:

```ts
it('implements System Upgrade as a sudo-capable operation', () => {
  expect(rulesFor('operation-system-upgrade')).toEqual({ kind: 'operation', sudo: true })
})
```

Delete `it('omits the deferred cards', …)` entirely: nothing is deferred any more, and a test
asserting an empty set would assert nothing.

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @release/engine test src/cards.test.ts
```

Expected: FAIL — `undefined` is not `{ kind: 'operation', sudo: true }`.

- [ ] **Step 3: Add the id, the quantity and the variant**

`cards.ts`:

```ts
  'operation-system-upgrade': { kind: 'operation', sudo: true },
```

`fake/index.ts` (rules decision 12), and correct the file's header comment — nothing is deferred now:

```ts
  { id: 'operation-system-upgrade', qty: 2 },
```

`state.ts`, appended to `Pending`:

```ts
  // System Upgrade — the first pending owed to SEVERAL seats at once. It
  // carries no `player`, deliberately: every other variant has one, so the
  // union-wide reads compile today, and dropping it here makes the compiler
  // enumerate each place that must now decide whether it means the actor, the
  // seats still owing, or something else. `pendingOwes` below is the answer
  // most of them want.
  //
  // `thrown` holds the cards face up at the centre — out of every hand and in
  // no pile, the same mid-air state a `defend`'s attack card is in, and it must
  // be counted by conformance's census for the same reason.
  | {
      kind: 'systemUpgrade'
      actor: PlayerId
      // Drains as each answers. Never the actor, never an eliminated seat,
      // never an empty-handed one (rules decisions 2026-09-04 answer 3).
      owed: PlayerId[]
      thrown: { player: PlayerId; card: CardInstance }[]
      sudo: boolean
      // 'picking' is reachable only under sudo and only with something thrown.
      phase: 'discarding' | 'picking'
      source: CardId
    }
```

and, at the end of the same file:

```ts
// Who a pending is waiting on. Every variant but `systemUpgrade` waits on one
// seat; that one waits on its roster while it is discarding, and on the actor
// once it is picking. One predicate, so the keeper, the bot and the board
// cannot disagree about whose move it is.
export function pendingOwes(pending: Pending | null | undefined, player: PlayerId): boolean {
  if (!pending) return false
  if (pending.kind !== 'systemUpgrade') return pending.player === player
  return pending.phase === 'picking'
    ? pending.actor === player
    : pending.owed.includes(player)
}

// The seat a headless driver should act as next. Undefined when nothing is
// pending, so callers fall back to the player on turn — which is what both of
// them did before a pending could owe more than one seat.
export function seatOwing(pending: Pending | null | undefined): PlayerId | undefined {
  if (!pending) return undefined
  if (pending.kind !== 'systemUpgrade') return pending.player
  return pending.phase === 'picking' ? pending.actor : pending.owed[0]
}
```

`view.ts` mirrors the variant exactly (the projection carries the same fields — none of them is
private: the rules put the cards face up, and who has yet to throw is plain to the table).

`actions.ts`, appended to `Choice`:

```ts
  // System Upgrade. `upgradeDiscard` comes from a seat on the roster;
  // `upgradeTake` from the actor, once every seat has answered and sudo gives
  // them the pick.
  | { kind: 'upgradeDiscard'; card: CardUid }
  | { kind: 'upgradeTake'; card: CardUid }
```

`apps/ui/src/table/Table/intents.ts` gains the mirror, with `string` for the ids and
`{ uid: string; id: string }` for the card, as its other variants do.

- [ ] **Step 4: Fix the nine reads the compiler now flags**

Run `pnpm typecheck` and work the list. Each is a decision, not a mechanical rename:

| Site | Becomes |
|---|---|
| `engine/fake/bots.ts:38` | `if (pending && pendingOwes(pending, me))` — the projected pending; import `pendingOwes` |
| `engine/fake/bots.ts:162` | `const seat = seatOwing(current.pending) ?? current.turn.player` — the second helper below |
| `engine/conformance.ts:973` | `seatOwing(state.pending) ?? state.turn.player`, the same helper. `conformance.ts` must not import from `fake/`, so it lives in `state.ts` beside `pendingOwes` where both can reach it |
| `ui/dock.ts:57` | `pendingOwes`-shaped: `state.pending.kind !== 'systemUpgrade' && state.pending.player === selfId && 'deadline' in state.pending` — a `systemUpgrade` never carries a deadline |
| `ui/dock.ts:125` | `pending.kind !== 'discardForRelease' && owesSelf` |
| `ui/dock.ts:155` | the name shown is the seat the table is waiting on: for `systemUpgrade`, the first of `owed` (or `actor` while picking) |
| `ui/PendingPrompt.tsx:210` | the fingerprint becomes `${pending.kind}:${ownerOf(pending)}` |
| `ui/Table.tsx:414` | gate on the same "is it mine" predicate rather than `pending.player === selfId` |
| `web/_Board.tsx:1698` | same |

The kit cannot import from the engine, so give it its own two-line `pendingOwesSelf` in
`apps/ui/src/table/Table/intents.ts` beside `TablePending`, and use it at all five kit sites.

- [ ] **Step 5: Add the `pendingView` case**

`fake/attacks.ts`:

```ts
    case 'systemUpgrade':
      // Nothing here is private: the rules put the thrown cards face up at the
      // centre, and who has yet to answer is plain to everyone watching.
      return {
        kind: 'systemUpgrade',
        actor: p.actor,
        owed: [...p.owed],
        thrown: p.thrown.map((t) => ({ player: t.player, card: { ...t.card } })),
        sudo: p.sudo,
        phase: p.phase,
        source: p.source,
      }
```

- [ ] **Step 6: Type-check and run everything**

```bash
pnpm typecheck && pnpm test
```

Expected: PASS. The fuzz will not yet reach the card in a way that stalls, because `onPlay` has no
branch for it — that is C2, and the `progress` guard is C5.

- [ ] **Step 7: Verify by mutation**

Add `player: PlayerId` to the new variant and confirm `pnpm typecheck` goes quiet at all nine sites —
proving the omission is what forced the review, not the compiler being incidentally strict. Remove it
again.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src apps/ui/src apps/frontend/src
git commit -m "feat(engine): a pending may now owe several seats at once, and every reader had to say what it meant (#108, #61)"
```

### Task C2: Playing System Upgrade opens the roster

**Files:**
- Create: `packages/engine/src/fake/upgrade.ts`
- Modify: `packages/engine/src/fake/release.ts` (the operation dispatch)
- Test: `packages/engine/src/fake/upgrade.test.ts` *(new)*

**Interfaces:**
- Produces: `openSystemUpgrade(state, log, player, card, combo): GameState`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/fake/upgrade.test.ts`, built on `gitPiles.test.ts`'s `config`/`table` pattern but
with three seats — read that file first, then widen `config.players` to `p1`, `p2`, `p3`.

```ts
const UPGRADE: CardInstance = { uid: 'operation-system-upgrade#0', id: 'operation-system-upgrade' }
const SUDO: CardInstance = { uid: 'support-sudo#0', id: 'support-sudo' }
const card = (tag: string) => ({ uid: `attack-bug#${tag}`, id: 'attack-bug' })

describe('System Upgrade', () => {
  it('owes every other seat, and never the actor', () => {
    const state = seats({ p1: [UPGRADE], p2: [card('b')], p3: [card('c')] })
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    })
    expect(next.pending).toMatchObject({
      kind: 'systemUpgrade',
      actor: 'p1',
      owed: ['p2', 'p3'],
      thrown: [],
      sudo: false,
      phase: 'discarding',
    })
  })

  it('does not ask a seat with an empty hand', () => {
    // Rules decisions 2026-09-04 answer 3.
    const state = seats({ p1: [UPGRADE], p2: [], p3: [card('c')] })
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    })
    expect((next.pending as { owed: string[] }).owed).toEqual(['p3'])
  })

  it('does not ask an eliminated seat', () => {
    const base = seats({ p1: [UPGRADE], p2: [card('b')], p3: [card('c')] })
    const state = { ...base, eliminated: ['p2'] }
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    })
    expect((next.pending as { owed: string[] }).owed).toEqual(['p3'])
  })

  it('spends the card for nothing when nobody can discard', () => {
    const state = seats({ p1: [UPGRADE], p2: [], p3: [] })
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    })
    expect(next.pending).toBeNull()
    expect(next.decks.discard.map((c) => c.id)).toContain('operation-system-upgrade')
  })
})
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @release/engine test src/fake/upgrade.test.ts
```

Expected: FAIL — `onPlay` still falls through to `openPickFromDiscard`.

- [ ] **Step 3: Write `fake/upgrade.ts`'s opener**

```ts
import type { CardInstance, GameState, PlayerId } from '../state'
import { bankToDiscard, type Log } from './core'

// System Upgrade — "все остальные игроки сбрасывают по одной карте", each for
// themselves and simultaneously, so the pending owes a roster rather than a
// seat. Who is on it is computed here and never assumed later: everyone but
// the actor, minus the eliminated, minus the empty-handed (rules decisions
// 2026-09-04 answer 3). An empty roster is an ordinary outcome — the card is
// played and nothing happens — not an error.
export function openSystemUpgrade(
  state: GameState,
  log: Log,
  player: PlayerId,
  card: CardInstance,
  combo: CardInstance | undefined,
): GameState {
  const spent = combo ? [card, combo] : [card]
  for (const c of spent) log.add({ type: 'discarded', player, card: c.id, reason: 'effect' })
  const spentState = bankToDiscard(state, spent)

  const owed = state.seating.filter(
    (id) =>
      id !== player &&
      !state.eliminated.includes(id) &&
      state.players[id].hand.length > 0,
  )
  if (owed.length === 0) return { ...spentState, eventSeq: log.seq }

  return {
    ...spentState,
    pending: {
      kind: 'systemUpgrade',
      actor: player,
      owed,
      thrown: [],
      sudo: combo !== undefined,
      phase: 'discarding',
      source: card.id,
    },
    eventSeq: log.seq,
  }
}
```

- [ ] **Step 4: Dispatch from `onPlay`**

`fake/release.ts`, beside the Rebase branch from B2:

```ts
    if (card.id === 'operation-system-upgrade') {
      return {
        state: openSystemUpgrade(withoutCards, log, action.player, card, sudoCombo),
        events: log.events,
      }
    }
```

- [ ] **Step 5: Run**

```bash
pnpm --filter @release/engine test src/fake/upgrade.test.ts
```

Expected: the four PASS. The full suite will now show `progress` failing — expected, and closed in C5.

- [ ] **Step 6: Verify by mutation**

Drop the `hand.length > 0` filter and confirm the empty-hand test goes red; drop the `id !== player`
filter and confirm the first goes red with `p1` on its own roster. Restore.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/fake
git commit -m "feat(engine): System Upgrade asks everyone who can answer, and nobody who cannot (#108, #61)"
```

### Task C3: A seat answers, and the roster drains

**Files:**
- Modify: `packages/engine/src/fake/upgrade.ts`, `packages/engine/src/fake/reduce.ts` (`onResolve`)
- Modify: `packages/engine/src/events.ts` (the `upgradeThrown` event)
- Test: `packages/engine/src/fake/upgrade.test.ts`

**Interfaces:**
- Produces: `onUpgradeDiscard(state, action): Reduction`; the event
  `{ type: 'upgradeThrown'; player: PlayerId; card: CardId }`.

- [ ] **Step 1: Write the failing tests**

```ts
  it('takes the card out of that hand and holds it at the centre', () => {
    const played = reduce(seats({ p1: [UPGRADE], p2: [card('b')], p3: [card('c')] }), {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    }).state
    const { state: next, events } = reduce(played, {
      type: 'RESOLVE',
      player: 'p2',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#b' },
      at: 2,
    })
    expect(next.players.p2.hand).toHaveLength(0)
    // Held on the pending, not banked: the cards lie face up at the centre
    // until everyone has answered.
    expect(next.decks.discard.some((c) => c.uid === 'attack-bug#b')).toBe(false)
    expect(next.pending).toMatchObject({ owed: ['p3'], thrown: [{ player: 'p2' }] })
    expect(events.map((e) => e.type)).toEqual(['upgradeThrown'])
  })

  it('rejects a seat that is not on the roster', () => {
    const played = reduce(seats({ p1: [UPGRADE], p2: [card('b')], p3: [card('c')] }), {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    }).state
    const { state: next, events } = reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#b' },
      at: 2,
    })
    expect(next).toBe(played)
    expect(events.map((e) => e.type)).toEqual(['rejected'])
  })

  it('banks everything to the discard when the last seat answers, without sudo', () => {
    let s = reduce(seats({ p1: [UPGRADE], p2: [card('b')], p3: [card('c')] }), {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    }).state
    s = reduce(s, {
      type: 'RESOLVE',
      player: 'p2',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#b' },
      at: 2,
    }).state
    const { state: next, events } = reduce(s, {
      type: 'RESOLVE',
      player: 'p3',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#c' },
      at: 3,
    })
    expect(next.pending).toBeNull()
    expect(next.decks.discard.map((c) => c.uid)).toEqual(
      expect.arrayContaining(['attack-bug#b', 'attack-bug#c']),
    )
    expect(events.map((e) => e.type)).toEqual(['upgradeThrown', 'discarded', 'discarded'])
  })

  it('opens the pick instead of banking, under sudo', () => {
    let s = reduce(seats({ p1: [UPGRADE, SUDO], p2: [card('b')], p3: [card('c')] }), {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      combo: SUDO.uid,
      at: 1,
    }).state
    s = reduce(s, {
      type: 'RESOLVE',
      player: 'p2',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#b' },
      at: 2,
    }).state
    const { state: next } = reduce(s, {
      type: 'RESOLVE',
      player: 'p3',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#c' },
      at: 3,
    })
    expect(next.pending).toMatchObject({ phase: 'picking', owed: [], actor: 'p1' })
  })
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @release/engine test src/fake/upgrade.test.ts
```

Expected: FAIL — no `upgradeDiscard` case in `onResolve`.

- [ ] **Step 3: Add the event**

`packages/engine/src/events.ts`, beside `takenFromDiscard`:

```ts
    // System Upgrade: a seat's answer, landing face up at the centre. Public,
    // because the rules put it there face up — and because the board animates
    // each arrival as it happens rather than the whole roster at the end.
    | { type: 'upgradeThrown'; player: PlayerId; card: CardId }
```

- [ ] **Step 4: Implement `onUpgradeDiscard`**

```ts
export function onUpgradeDiscard(state: GameState, action: Action & { type: 'RESOLVE' }): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'systemUpgrade') return reject(state, action, 'no upgrade is pending')
  if (pending.phase !== 'discarding') return reject(state, action, 'that phase is over')
  if (!pending.owed.includes(action.player)) return reject(state, action, 'not your decision')
  const choice = action.choice
  if (choice.kind !== 'upgradeDiscard') return reject(state, action, 'wrong choice for pending')

  const hand = state.players[action.player].hand
  const given = hand.find((c) => c.uid === choice.card)
  if (!given) return reject(state, action, 'you do not hold that card')

  const log = createLog(state.eventSeq)
  log.add({ type: 'upgradeThrown', player: action.player, card: given.id })

  const owed = pending.owed.filter((id) => id !== action.player)
  const thrown = [...pending.thrown, { player: action.player, card: given }]
  const withHand = setHand(
    state,
    action.player,
    hand.filter((c) => c.uid !== choice.card),
  )

  // Still owed by somebody: hold everything at the centre and wait.
  if (owed.length > 0) {
    return {
      state: { ...withHand, pending: { ...pending, owed, thrown }, eventSeq: log.seq },
      events: log.events,
    }
  }
  // The last answer. Sudo hands the actor a pick; otherwise it all goes now.
  if (pending.sudo) {
    return {
      state: {
        ...withHand,
        pending: { ...pending, owed: [], thrown, phase: 'picking' },
        eventSeq: log.seq,
      },
      events: log.events,
    }
  }
  for (const t of thrown) {
    log.add({ type: 'discarded', player: t.player, card: t.card.id, reason: 'effect' })
  }
  const banked = bankToDiscard(withHand, thrown.map((t) => t.card))
  return { state: { ...banked, pending: null, eventSeq: log.seq }, events: log.events }
}
```

- [ ] **Step 5: Dispatch it**

`fake/reduce.ts`, in `onResolve`:

```ts
    case 'upgradeDiscard':
      return onUpgradeDiscard(state, action)
```

- [ ] **Step 6: Run**

```bash
pnpm --filter @release/engine test src/fake/upgrade.test.ts
```

Expected: the four PASS.

- [ ] **Step 7: Verify by mutation**

Bank on every answer rather than only the last, and confirm the "holds it at the centre" test goes
red. Drop the `owed.includes` guard and confirm the roster test goes red. Restore.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src
git commit -m "feat(engine): the roster drains as each seat answers, and the cards wait at the centre until it does (#108, #61)"
```

### Task C4: The sudo pick

**Files:**
- Modify: `packages/engine/src/fake/upgrade.ts`, `fake/reduce.ts`, `events.ts`
- Test: `packages/engine/src/fake/upgrade.test.ts`

**Interfaces:**
- Produces: `onUpgradeTake(state, action): Reduction`; the event
  `{ type: 'upgradeTaken'; player: PlayerId; card: CardId }`.

- [ ] **Step 1: Write the failing tests**

```ts
  // The three reductions C3's sudo test already drives, as a named state the
  // pick tests share. Local to this file: it is a fixture, not machinery.
  const sudoUpToPicking = (): GameState => {
    let s = reduce(seats({ p1: [UPGRADE, SUDO], p2: [card('b')], p3: [card('c')] }), {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      combo: SUDO.uid,
      at: 1,
    }).state
    s = reduce(s, {
      type: 'RESOLVE',
      player: 'p2',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#b' },
      at: 2,
    }).state
    return reduce(s, {
      type: 'RESOLVE',
      player: 'p3',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#c' },
      at: 3,
    }).state
  }

  it('gives the actor the card they picked and discards the rest', () => {
    const picking = sudoUpToPicking()
    const { state: next, events } = reduce(picking, {
      type: 'RESOLVE',
      player: 'p1',
      choice: { kind: 'upgradeTake', card: 'attack-bug#c' },
      at: 4,
    })
    expect(next.players.p1.hand.map((c) => c.uid)).toContain('attack-bug#c')
    expect(next.decks.discard.map((c) => c.uid)).toContain('attack-bug#b')
    expect(next.decks.discard.map((c) => c.uid)).not.toContain('attack-bug#c')
    expect(next.pending).toBeNull()
    expect(events.map((e) => e.type)).toEqual(['upgradeTaken', 'discarded'])
  })

  it('refuses a card that was not thrown this time', () => {
    const picking = sudoUpToPicking()
    const { state: next, events } = reduce(picking, {
      type: 'RESOLVE',
      player: 'p1',
      // In the discard, but not in `thrown` — "выбор из того, что сброшено в
      // этот раз, а не из всего сброса".
      choice: { kind: 'upgradeTake', card: 'operation-system-upgrade#0' },
      at: 4,
    })
    expect(next).toBe(picking)
    expect(events.map((e) => e.type)).toEqual(['rejected'])
  })

  it('refuses a take from anyone but the actor', () => {
    const picking = sudoUpToPicking()
    const { events } = reduce(picking, {
      type: 'RESOLVE',
      player: 'p2',
      choice: { kind: 'upgradeTake', card: 'attack-bug#c' },
      at: 4,
    })
    expect(events.map((e) => e.type)).toEqual(['rejected'])
  })
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @release/engine test src/fake/upgrade.test.ts
```

Expected: FAIL — no `upgradeTake` case.

- [ ] **Step 3: Add the event and the handler**

`events.ts`:

```ts
    // Sudo System Upgrade: the actor takes one of the open cards at the centre.
    | { type: 'upgradeTaken'; player: PlayerId; card: CardId }
```

`fake/upgrade.ts`:

```ts
export function onUpgradeTake(state: GameState, action: Action & { type: 'RESOLVE' }): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'systemUpgrade') return reject(state, action, 'no upgrade is pending')
  if (pending.phase !== 'picking') return reject(state, action, 'nothing to pick yet')
  if (pending.actor !== action.player) return reject(state, action, 'not your decision')
  const choice = action.choice
  if (choice.kind !== 'upgradeTake') return reject(state, action, 'wrong choice for pending')

  // "Выбор — из того, что сброшено в этот раз, а не из всего сброса": the
  // offer is `thrown`, never the pile it is about to join.
  const taken = pending.thrown.find((t) => t.card.uid === choice.card)
  if (!taken) return reject(state, action, 'that card is not on offer')

  const log = createLog(state.eventSeq)
  log.add({ type: 'upgradeTaken', player: action.player, card: taken.card.id })
  const rest = pending.thrown.filter((t) => t.card.uid !== choice.card)
  for (const t of rest) {
    log.add({ type: 'discarded', player: t.player, card: t.card.id, reason: 'effect' })
  }
  const banked = bankToDiscard(state, rest.map((t) => t.card))
  const actor = banked.players[action.player]
  return {
    state: {
      ...banked,
      players: {
        ...banked.players,
        [action.player]: { ...actor, hand: [...actor.hand, taken.card] },
      },
      pending: null,
      eventSeq: log.seq,
    },
    events: log.events,
  }
}
```

`fake/reduce.ts`:

```ts
    case 'upgradeTake':
      return onUpgradeTake(state, action)
```

- [ ] **Step 4: Run**

```bash
pnpm --filter @release/engine test src/fake/upgrade.test.ts
```

Expected: PASS.

- [ ] **Step 5: Verify by mutation**

Search the whole discard instead of `thrown` for the offer, and confirm the second test goes red.
Restore.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src
git commit -m "feat(engine): sudo takes one of the open cards, and only one of those (#108, #61)"
```

### Task C5: System Upgrade in conformance, the census and the keeper

**Files:**
- Modify: `packages/engine/src/conformance.ts` (`resolvePendingAction`, `realCardUids:368`)
- Modify: `packages/engine/src/fake/bots.ts` (the pending switch)
- Test: `packages/engine/src/conformance.ts`, run through `fake.test.ts`

- [ ] **Step 1: Run the suite and watch `progress` fail**

```bash
pnpm --filter @release/engine test src/fake/fake.test.ts
```

Expected: FAIL — the fuzz reaches `operation-system-upgrade`, raises the pending, and nothing answers
it, so it stands for more than three consecutive steps. The card-conservation property may also fail,
depending on where the seeded stream stops.

- [ ] **Step 2: Add the census branch**

`conformance.ts`, in `realCardUids`, beside the `defend` and `neutralize503` branches:

```ts
  // The cards thrown to the centre while a System Upgrade drains — out of their
  // hands and in no pile, exactly the mid-air state the two branches above
  // describe. A stream that ends here must not read as a loss.
  if (state.pending?.kind === 'systemUpgrade') {
    uids.push(...state.pending.thrown.map((t) => t.card.uid))
  }
```

- [ ] **Step 3: Settle the `defend.combo` question by mutation**

The spec flags this as suspected, not proven. Establish it now, while this function is open:

1. Write a throwaway test that reduces to a state holding an open sudo `defend` (an ATTACK with a
   `combo`), then asserts `realCardUids` contains the Sudo's uid.
2. If it fails, the gap is real: add `if (state.pending?.kind === 'defend' && state.pending.combo)
   uids.push(state.pending.combo.uid)` with a comment naming the same mid-air reasoning, and keep the
   test.
3. If it passes, delete the throwaway test and add one line to `docs/animations/backlog.md`… **no** —
   this is an engine fact, not an animation one: record it instead as a comment on `realCardUids`
   saying where the combo is counted, so the next reader does not re-ask.

- [ ] **Step 4: Add the `resolvePendingAction` cases**

```ts
    case 'systemUpgrade': {
      if (pending.phase === 'picking') {
        const card = pending.thrown[0]?.card.uid
        if (!card) return null
        return {
          type: 'RESOLVE',
          player: pending.actor,
          choice: { kind: 'upgradeTake', card },
          at,
        }
      }
      // One seat per step: the property only requires that SOMETHING advances,
      // and answering the whole roster in one action is not a move the game has.
      const seat = pending.owed[0]
      if (!seat) return null
      const card = state.players[seat].hand[0]?.uid
      if (!card) return null
      return { type: 'RESOLVE', player: seat, choice: { kind: 'upgradeDiscard', card }, at }
    }
```

Confirm the `progress` property's window is wide enough: it asserts no pending stands for more than
three consecutive steps, and a roster of four seats needs four answers. If it goes red for that
reason, the fix is in the property — a `systemUpgrade` may legitimately stand for `owed.length` steps
— and the comment there must say so.

- [ ] **Step 5: Add the bot cases**

`fake/bots.ts`:

```ts
      case 'systemUpgrade': {
        if (pending.phase === 'picking') {
          const card = pending.thrown[0]?.card.uid ?? ''
          return { type: 'RESOLVE', player: me, choice: { kind: 'upgradeTake', card }, at }
        }
        const card = view.self.hand[0]?.uid ?? ''
        return { type: 'RESOLVE', player: me, choice: { kind: 'upgradeDiscard', card }, at }
      }
```

This is what makes the keeper's absent-seat fallback work: `referee.ts:195` already scans every
expired-absent seat and calls `botAction` for each, so with `pendingOwes` in place at `bots.ts:38` a
walked-away opponent drains on its own and cannot freeze the table.

- [ ] **Step 6: Run everything**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Expected: PASS.

- [ ] **Step 7: Write the keeper test**

`apps/frontend/src/network/session/referee.test.ts` — read the existing absent-seat test and mirror
it:

```ts
it('drains a System Upgrade roster past a seat that walked away', () => {
  // …build a session whose state holds a systemUpgrade pending owing p2 and p3,
  // disconnect p2, advance past ABSENT_GRACE_MS, and assert the pending's
  // `owed` no longer contains p2 while p3 is still owed.
})
```

- [ ] **Step 8: Verify by mutation**

Remove the census branch and confirm a conservation failure is reachable (drive a stream that ends
mid-upgrade). Remove the `resolvePendingAction` case and confirm `progress` goes red. Restore both.

- [ ] **Step 9: Commit**

```bash
git add packages/engine/src apps/frontend/src/network
git commit -m "feat(engine): the fuzz can answer an upgrade, the census can count it, and an empty seat cannot hold it (#108, #61)"
```

---

## Phase D — the two board surfaces

### Task D1: Rebase's private row

**Files:**
- Create: `apps/frontend/src/pages/board/[gameId]/_useRebaseStaging.tsx` + `.module.css`
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx` (wiring, beside `cherry`)
- Modify: `packages/translation/src/locales/{en,ru}/common.json`
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/boardRebase.test.tsx` *(new)*

**Interfaces:**
- Consumes: the `reorderTop` `TablePending` from B1; `TableActions['onResolve']`.
- Produces: `useRebaseStaging({ state, actions, copy, enabled }): { row: ReactNode | null }`.
  Task D2 adds flights and grows the return to `{ row, overlay }`.

- [ ] **Step 1: Add the copy, in both catalogues**

en:

```json
    "rebasePrompt": "set the order of the top cards — 1 is drawn next",
    "rebasePosition": "position",
```

ru:

```json
    "rebasePrompt": "задай порядок верхних карт — 1 берётся следующей",
    "rebasePosition": "позиция",
```

- [ ] **Step 2: Write the failing test**

```tsx
const rebasePending = (cards: { uid: string; id: string }[]) => ({
  kind: 'reorderTop' as const,
  player: 'you',
  piles: [{ pile: 0, cards }],
  source: 'operation-git-rebase',
})

it('shows the offered cards in a numbered row and commits the order', async () => {
  const onResolve = vi.fn()
  renderBoard({
    pending: rebasePending([
      { uid: 'r0', id: 'attack-bug' },
      { uid: 'r1', id: 'release-frontend' },
      { uid: 'r2', id: 'defense-hotfix' },
    ]),
    actions: { onResolve },
  })
  expect(screen.getByTestId('board-rebase-row')).toBeInTheDocument()
  // Move the third card to the front, then commit.
  await userEvent.click(screen.getByTestId('rebase-up-r2'))
  await userEvent.click(screen.getByTestId('rebase-up-r2'))
  await userEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'reorderTop',
    order: [{ pile: 0, cards: ['r2', 'r0', 'r1'] }],
  })
})

it('shows nothing to a peer whose projection carries no cards', () => {
  renderBoard({ pending: { ...rebasePending([]), player: 'p2' } })
  expect(screen.queryByTestId('board-rebase-row')).not.toBeInTheDocument()
})
```

Pointer buttons rather than drag: the story uses a pointer drag, but a keyboard- and test-reachable
control is what the board needs, and the drag can be layered on top of the same state later. Record
that difference on the audit page in Task E1.

- [ ] **Step 3: Run and watch it fail**

```bash
pnpm --filter @release/web test src/pages/board/\[gameId\]/__tests__/boardRebase.test.tsx
```

Expected: FAIL — no `board-rebase-row`.

- [ ] **Step 4: Write the hook**

Read `_useCherryPickStaging.tsx` (Task A3) first — the `ours` gate, the "nothing armed survives its
pending" effect and the confirm re-check are the same and are deliberately mirrored.

```tsx
import type { TableActions } from '@release/ui'
import { Card, ConfirmAction, cardById } from '@release/ui'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { BoardState } from '~/entities/game/board'
import styles from './_useRebaseStaging.module.css'

// Git Rebase — the top of a pile, shown to its owner and to nobody else. The
// privacy is not enforced here: `pendingView` hands every other peer an empty
// `piles`, so there is nothing for this hook to hide. What the table sees is
// the card's own flight to the discard, which the ordinary discard run plays.
//
// Sudo lays one row per pile, sharing a single 1-2-3 numbering across them, as
// the story does — the numbers name positions in a pile, and every pile has the
// same three positions.
type Order = Record<number, string[]>

export function useRebaseStaging(args: {
  state: BoardState
  actions?: TableActions
  copy: { prompt: string; position: string; confirm: string }
  enabled: boolean
}): { row: ReactNode | null } {
  const { state, actions, copy, enabled } = args
  const pending = state.pending
  const ours =
    enabled &&
    pending?.kind === 'reorderTop' &&
    pending.player === state.selfId &&
    pending.piles.length > 0
      ? pending
      : null

  const [order, setOrder] = useState<Order>({})
  const [confirmed, setConfirmed] = useState(false)

  // Seeded from the offer, and re-seeded when a different pending opens. Keyed
  // on the pending rather than the mount, the discipline `_useInsideStaging`
  // states: a latch that outlives what it latches is a bug.
  useEffect(() => {
    if (!ours) {
      setOrder({})
      setConfirmed(false)
      return
    }
    setOrder(Object.fromEntries(ours.piles.map((e) => [e.pile, e.cards.map((c) => c.uid)])))
  }, [ours])

  if (!ours || confirmed) return { row: null }

  const move = (pile: number, uid: string, delta: number) =>
    setOrder((o) => {
      const cards = [...(o[pile] ?? [])]
      const from = cards.indexOf(uid)
      const to = from + delta
      if (from < 0 || to < 0 || to >= cards.length) return o
      cards.splice(to, 0, ...cards.splice(from, 1))
      return { ...o, [pile]: cards }
    })

  return {
    row: (
      <div className={styles.rows} data-testid="board-rebase-row">
        {ours.piles.map((entry) => (
          <div key={entry.pile} className={styles.row}>
            {(order[entry.pile] ?? []).map((uid, i) => {
              const offered = entry.cards.find((c) => c.uid === uid)
              const data = offered ? cardById(offered.id) : null
              if (!data) return null
              return (
                <div key={uid} className={styles.slot}>
                  <span className={styles.position}>{i + 1}</span>
                  <Card card={data} interactive={false} width="100%" />
                  <button
                    type="button"
                    data-testid={`rebase-up-${uid}`}
                    className={styles.move}
                    aria-label={`${copy.position} ${i}`}
                    onClick={() => move(entry.pile, uid, -1)}
                  />
                </div>
              )
            })}
          </div>
        ))}
        <ConfirmAction
          open
          label={copy.confirm}
          caption={copy.prompt}
          onConfirm={() => {
            // Committed against THIS render's offer: every offered pile,
            // answered exactly once, or the engine rejects it.
            const committed = ours.piles.map((e) => ({
              pile: e.pile,
              cards: order[e.pile] ?? e.cards.map((c) => c.uid),
            }))
            setConfirmed(true)
            actions?.onResolve?.({ kind: 'reorderTop', order: committed })
          }}
        />
      </div>
    ),
  }
}
```

- [ ] **Step 5: Write the module CSS and wire it in**

`_useRebaseStaging.module.css`:

```css
/* The top of a pile, laid out for its owner only (#108). One row per pile
   under sudo, sharing the single 1-2-3 numbering — the numbers name positions,
   and every pile has the same three. Placed on the same band as Cherry-pick's
   grid (`_useCherryPickStaging.module.css`), because both are the same kind of
   question asked over the same table. */
.rows {
  position: absolute;
  inset-block-start: 18%;
  inset-inline: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 24px;
  align-items: center;
  transform: translateY(-50%);
}

.row {
  display: flex;
  gap: 30px;
  align-items: flex-end;
}

.slot {
  position: relative;
  inline-size: 150px;
}

.position {
  position: absolute;
  inset-block-start: -26px;
  inset-inline: 0;
  text-align: center;
}

.move {
  position: absolute;
  inset-block-end: -26px;
  inset-inline: 0;
  cursor: pointer;
  background: none;
  border: 0;
}
```

The `1`, `2`, `3` and the button label go through `<Typography>` in the hook, never a font
declaration here — `apps/ui/CLAUDE.md`'s typography rule.

In `_Board.tsx`, call `useRebaseStaging` beside `cherry` with the same `enabled` gate, and render
`{rebase.row}` beside `{cherry.grid}`.

- [ ] **Step 6: Run the board suite**

```bash
pnpm --filter @release/web test src/pages/board
```

Expected: PASS.

- [ ] **Step 7: Verify by mutation**

Seed `order` from `[]` instead of the offer and confirm the commit test goes red. Drop the
`pending.piles.length > 0` gate and confirm the peer test goes red (an empty row rendered for
somebody who was shown nothing). Restore.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/pages/board packages/translation/src/locales
git commit -m "feat(web): the top of the pile, shown to the one player entitled to see it (#108)"
```

### Task D2: Rebase's flights

**Files:**
- Modify: `apps/frontend/src/pages/board/[gameId]/_useRebaseStaging.tsx`
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/boardRebase.test.tsx`

- [ ] **Step 1: Write the failing reduced-motion test**

```tsx
it('commits at once under reduced motion, with nothing left flying', async () => {
  mockReducedMotion(true) // apps/frontend/src/test/reducedMotion.ts, added in Task A4
  const onResolve = vi.fn()
  renderBoard({
    pending: rebasePending([
      { uid: 'r0', id: 'attack-bug' },
      { uid: 'r1', id: 'release-frontend' },
    ]),
    actions: { onResolve },
  })
  await userEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
  expect(onResolve).toHaveBeenCalled()
  expect(screen.queryByTestId('board-rebase-row')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run and watch it hold**

```bash
pnpm --filter @release/web test src/pages/board/\[gameId\]/__tests__/boardRebase.test.tsx
```

Expected: PASS while D1's immediate resolve stands — this is the line Step 3 must not cross.

- [ ] **Step 3: Add the flights**

Port from `apps/playground/stories/interactive/GitCards/Rebase.tsx`, values and all:

| Leg | Step | Values |
|---|---|---|
| out of the pile into the row | CSS transition from `anchors.pileBox(entry.pile)` | `DEAL_DUR` 520, `DEAL_STEP` 80, `DEAL_HOLD` 200 |
| back onto the deck | `play('flipCard', …)` then `play('returnToDeck', el, { from, to })` | `FLIP_DUR` 420, `FLIP_HOLD` 260, `BACK_DUR` 600, `BACK_STEP` 90 |

The return flight goes in the **committed** order, and the `RESOLVE` fires when the last one lands —
or immediately under reduced motion:

```tsx
  // A game action must never wait on an animation nobody plays
  // (`_useInsideStaging`'s rule). The engine gets its answer either way; only
  // the moment differs.
  if (reduced) {
    actions?.onResolve?.({ kind: 'reorderTop', order: committed })
    return
  }
```

- [ ] **Step 4: Run**

```bash
pnpm --filter @release/web test src/pages/board
```

Expected: PASS.

- [ ] **Step 5: Verify by mutation**

Force `reduced` false and confirm the reduced-motion test goes red. Restore.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/pages/board
git commit -m "feat(web): the three cards leave the pile and go back in the order chosen (#108)"
```

### Task D3: The centre a System Upgrade fills, and the seat that fills it

**Files:**
- Create: `apps/frontend/src/pages/board/[gameId]/_useUpgradeStaging.tsx` + `.module.css`
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx` (the standing render of `thrown`)
- Modify: `packages/translation/src/locales/{en,ru}/common.json`
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/boardUpgrade.test.tsx` *(new)*

**Interfaces:**
- Consumes: the `systemUpgrade` `TablePending` from C1.
- Produces: `useUpgradeStaging({ state, actions, copy, anchors, enabled }): { surface: ReactNode | null }` —
  it owns both sides: the throw while this seat is owed, and the pick while `phase === 'picking'` and
  this seat is the actor.

- [ ] **Step 1: Add the copy, in both catalogues**

en:

```json
    "upgradePrompt": "discard one card",
    "upgradeWaiting": "waiting for the others",
    "upgradeTakePrompt": "take one of the discarded cards",
```

ru:

```json
    "upgradePrompt": "сбрось одну карту",
    "upgradeWaiting": "ждём остальных",
    "upgradeTakePrompt": "возьми одну из сброшенных карт",
```

- [ ] **Step 2: Write the failing tests**

```tsx
const upgradePending = (over: Partial<TablePendingUpgrade> = {}) => ({
  kind: 'systemUpgrade' as const,
  actor: 'p2',
  owed: ['you'],
  thrown: [],
  sudo: false,
  phase: 'discarding' as const,
  source: 'operation-system-upgrade',
  ...over,
})

it('asks this seat for a card while it is owed', async () => {
  const onResolve = vi.fn()
  renderBoard({ pending: upgradePending(), hand: [{ uid: 'h1', card: 'attack-bug' }], actions: { onResolve } })
  await userEvent.click(screen.getByTestId('hand-card-h1'))
  await userEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
  expect(onResolve).toHaveBeenCalledWith({ kind: 'upgradeDiscard', card: 'h1' })
})

it('asks this seat for nothing once it has answered', () => {
  renderBoard({
    pending: upgradePending({ owed: ['p3'], thrown: [{ player: 'you', card: { uid: 'h1', id: 'attack-bug' } }] }),
  })
  expect(screen.queryByTestId('board-upgrade-ask')).not.toBeInTheDocument()
  // The thrown card stands at the centre for everyone, from the projection —
  // no beat is holding it.
  expect(screen.getByTestId('upgrade-thrown-h1')).toBeInTheDocument()
})

it('offers the actor a pick, and only the thrown cards', async () => {
  const onResolve = vi.fn()
  renderBoard({
    selfId: 'you',
    pending: upgradePending({
      actor: 'you',
      owed: [],
      sudo: true,
      phase: 'picking',
      thrown: [
        { player: 'p2', card: { uid: 't1', id: 'attack-bug' } },
        { player: 'p3', card: { uid: 't2', id: 'defense-hotfix' } },
      ],
    }),
    actions: { onResolve },
  })
  await userEvent.click(screen.getByTestId('upgrade-thrown-t2'))
  await userEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
  expect(onResolve).toHaveBeenCalledWith({ kind: 'upgradeTake', card: 't2' })
})
```

- [ ] **Step 3: Run and watch them fail**

```bash
pnpm --filter @release/web test src/pages/board/\[gameId\]/__tests__/boardUpgrade.test.tsx
```

Expected: FAIL on all three.

- [ ] **Step 4: Render the standing cards from the projection**

In `_Board.tsx`, beside the AI pair's standing render (`aiStanding`, `:405`), add the centre row. This
is the decision that keeps the beats simple — the cards persist between batches because the
**projection** holds them, exactly as `cardById(pending.requested)` persists for `requestCard`:

```tsx
  // System Upgrade's open cards at the centre (#108). Read off the projection,
  // not held by a beat: `thrown` is public and survives every batch boundary,
  // so a beat only ever animates an ARRIVAL and hands over to this.
  const upgrade = state.pending?.kind === 'systemUpgrade' ? state.pending : null
```

- [ ] **Step 5: Write the hook**

`_useUpgradeStaging.tsx` owns both questions and renders the standing cards for everybody — three
modes over one element, so the projection render and the picker are never two different cards:

```tsx
import type { TableActions } from '@release/ui'
import { Card, ConfirmAction, cardById } from '@release/ui'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { BoardState } from '~/entities/game/board'
import styles from './_useUpgradeStaging.module.css'

// System Upgrade — the one pending that owes several seats at once. Three
// modes, and which one this seat is in comes from the pending itself:
//
//   owed, discarding  → this seat is being asked; pull one card and commit
//   picking, actor    → the open cards become a choice
//   anything else     → the open cards stand, read-only, and the caption says
//                       what the table is still waiting for
//
// The standing cards come from `pending.thrown`, which is public and survives
// every batch boundary — so no beat has to hold them, and `upgradeBeat` only
// ever animates an arrival and hands over to this (I7).
export function useUpgradeStaging(args: {
  state: BoardState
  actions?: TableActions
  copy: { prompt: string; waiting: string; takePrompt: string; confirm: string }
  enabled: boolean
}): { surface: ReactNode | null } {
  const { state, actions, copy, enabled } = args
  const pending = state.pending?.kind === 'systemUpgrade' ? state.pending : null

  const asked = Boolean(pending) && pending?.phase === 'discarding' && pending.owed.includes(state.selfId)
  const picking = Boolean(pending) && pending?.phase === 'picking' && pending.actor === state.selfId

  const [given, setGiven] = useState<string | null>(null)
  const [taken, setTaken] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  // Nothing armed survives the pending it was armed for — the discipline every
  // sibling staging hook keeps, latched on the pending and not on the mount.
  useEffect(() => {
    if (!pending) {
      setGiven(null)
      setTaken(null)
      setConfirmed(false)
    }
  }, [pending])

  if (!pending || !enabled) return { surface: null }

  const centre = (
    <div className={styles.centre}>
      {pending.thrown.map((t) => {
        const data = cardById(t.card.id)
        if (!data) return null
        return (
          <button
            key={t.card.uid}
            type="button"
            data-testid={`upgrade-thrown-${t.card.uid}`}
            className={styles.thrown}
            disabled={!picking}
            onClick={() => picking && setTaken(t.card.uid)}
          >
            <Card
              card={data}
              interactive={false}
              width="100%"
              state={taken === t.card.uid ? 'selected' : 'idle'}
              // one out of a set — the uniform selection colour
              accent="var(--select-accent)"
            />
          </button>
        )
      })}
    </div>
  )

  if (confirmed) return { surface: centre }

  if (asked) {
    return {
      surface: (
        <div className={styles.surface} data-testid="board-upgrade-ask">
          {centre}
          <div className={styles.hand}>
            {state.you.hand.map((h) => (
              <button
                key={h.uid}
                type="button"
                data-testid={`hand-card-${h.uid}`}
                className={styles.cell}
                onClick={() => setGiven(h.uid)}
              >
                <Card
                  // `HandItem.card` is already the card object (Hand.tsx:53) —
                  // no lookup, and no cast.
                  card={h.card}
                  interactive={false}
                  width="100%"
                  state={given === h.uid ? 'selected' : 'idle'}
                  accent="var(--select-accent)"
                />
              </button>
            ))}
          </div>
          <ConfirmAction
            open
            label={copy.confirm}
            caption={copy.prompt}
            disabled={given == null}
            onConfirm={() => {
              // re-checked against THIS render's hand, the discipline the
              // kit's own panel keeps on every branch
              if (!given || !state.you.hand.some((h) => h.uid === given)) return
              setConfirmed(true)
              actions?.onResolve?.({ kind: 'upgradeDiscard', card: given })
            }}
          />
        </div>
      ),
    }
  }

  if (picking) {
    return {
      surface: (
        <div className={styles.surface}>
          {centre}
          <ConfirmAction
            open
            label={copy.confirm}
            caption={copy.takePrompt}
            disabled={taken == null}
            onConfirm={() => {
              if (!taken || !pending.thrown.some((t) => t.card.uid === taken)) return
              setConfirmed(true)
              actions?.onResolve?.({ kind: 'upgradeTake', card: taken })
            }}
          />
        </div>
      ),
    }
  }

  // Answered, or never asked: the cards stand and the caption says why nothing
  // is being asked of this seat.
  return {
    surface: (
      <div className={styles.surface}>
        {centre}
        <ConfirmAction open={false} label={copy.confirm} caption={copy.waiting} disabled />
      </div>
    ),
  }
}
```

The pull-out-of-the-fan flight is added in Task D4 alongside the beat, and it is
`play('playToCenter', el, { from, to })` — the same preset `_useHandLimit.tsx:242` uses. Do not
write a second one.

`_useUpgradeStaging.module.css`:

```css
/* Everyone's answers, open at the centre (#108). The band the AI pair uses
   (`centre.ts`'s CENTRE_TOP, 42%), because these cards ARE the centre of the
   table for as long as the effect runs — not a question hovering over it. */
.surface {
  position: absolute;
  inset: 0;
  z-index: 40;
  pointer-events: none;
}

.centre {
  position: absolute;
  inset-block-start: 42%;
  inset-inline: 0;
  display: flex;
  gap: 24px;
  align-items: flex-end;
  justify-content: center;
  transform: translateY(-50%);
}

.thrown,
.cell {
  inline-size: 150px;
  padding: 0;
  cursor: pointer;
  pointer-events: auto;
  background: none;
  border: 0;
}

.thrown:disabled {
  cursor: default;
}

.hand {
  position: absolute;
  inset-block-end: 22%;
  inset-inline: 0;
  display: flex;
  gap: 16px;
  justify-content: center;
}
```

- [ ] **Step 6: Run**

```bash
pnpm --filter @release/web test src/pages/board
```

Expected: PASS.

- [ ] **Step 7: Verify by mutation**

Render the standing cards only while picking, and confirm the second test goes red. Offer the whole
discard to the picker instead of `thrown`, and confirm the third goes red. Restore.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/pages/board packages/translation/src/locales
git commit -m "feat(web): everyone answers at once, and the table sees each answer land (#108)"
```

### Task D4: The arrival beat

**Files:**
- Create: `apps/frontend/src/features/board-beats/upgradeBeat.tsx` + `.test.tsx`
- Modify: `apps/frontend/src/features/board-beats/planBeats.ts` (the `upgrade` plan kind and its
  run-folding), `useBeats.ts` (registration), `index.ts`

**Interfaces:**
- Consumes: the `upgradeThrown` / `upgradeTaken` events from C3 and C4; `BoardAnchors.seatBox`,
  `.centre`; `useFlyer`, `play`, `wait` from `@release/ui/animations`.
- Produces: `BeatPlan` gains
  `{ kind: 'upgrade'; key: string; throws: { eventId: number; player: string; card: string }[] }`, and
  `useUpgradeBeat(anchors)` returning the standard `{ overlay, run }` pair every other beat returns.

- [ ] **Step 1: Write the failing plan test**

`apps/frontend/src/features/board-beats/planBeats.test.ts`:

```ts
it('folds consecutive upgrade throws into one beat, and splits them across batches', () => {
  const plans = planBeats(before, [
    { id: 1, type: 'upgradeThrown', player: 'p2', card: 'attack-bug' },
    { id: 2, type: 'upgradeThrown', player: 'p3', card: 'defense-hotfix' },
  ] as Event[])
  expect(plans).toHaveLength(1)
  expect(plans[0]).toMatchObject({ kind: 'upgrade' })
  expect((plans[0] as { throws: unknown[] }).throws).toHaveLength(2)
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @release/web test src/features/board-beats/planBeats.test.ts
```

Expected: FAIL — `upgradeThrown` currently falls into the "everything else breaks a run and plays
nothing" default at the end of the event loop.

- [ ] **Step 3: Add the plan kind and the fold**

`planBeats.ts` — model it on the `discard` run that is already there (`discard.cards.push(...)` plus
`flush()`), because the shape is identical: several events, one beat, a stagger inside it.

```ts
    if (e.type === 'upgradeThrown') {
      // Several seats answering inside ONE batch become one staggered beat;
      // seats answering in separate batches become separate short beats over a
      // centre that persists on its own (the projection holds `thrown`). Same
      // folding the `discarded` run above does, for the same reason.
      if (!upgradeRun) flush()
      upgradeRun ??= { kind: 'upgrade', key: `upgrade:${e.id}`, throws: [] }
      upgradeRun.throws.push({ eventId: e.id, player: e.player, card: e.card })
      continue
    }
```

with `upgradeRun` declared and flushed alongside `pileRun` and the discard run.

- [ ] **Step 4: Write the beat**

`upgradeBeat.tsx`. Read `transferBeat.tsx:347` first — its seat-to-centre leg already flies a card out
of a seat with `play('playToCenter', …)`, and `anchors.seatBox` is how a seat is aimed at (I6: a seat
is far wider than a card, so the flight starts at a card-sized box inside it, not at the seat's rect).

```tsx
import { cardById } from '@release/ui'
import type { Rect } from '@release/ui/animations'
import { play, useFlyer, wait } from '@release/ui/animations'
import { useCallback, useRef } from 'react'
import type { BeatRun, BoardAnchors } from '~/entities/game/board'
import type { BeatPlan } from './planBeats'

// System Upgrade's arrivals, and ONLY the arrivals. The cards that have already
// landed are rendered by the projection (`_useUpgradeStaging`), because
// `pending.thrown` is public and survives a batch boundary — so this beat never
// has to hold the centre, and the last frame it plays is the pose the
// projection renders (I7).
const THROW_DUR = 460 // a card flies from a seat to the centre
const THROW_STEP = 260 // stagger, when several land in one batch
const THROW_SCALE = 0.42 // it starts small at the seat and grows to full

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export function useUpgradeBeat(anchors: BoardAnchors) {
  const { overlay, raise, drop } = useFlyer()
  const latest = useRef({ anchors })
  latest.current = { anchors }

  const run = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'upgrade' }>, _beat: BeatRun) => {
      const a = latest.current.anchors
      const centre = rectOf(a.centre.current)
      if (!centre) return
      await Promise.all(
        plan.throws.map(async (t, i) => {
          // Several answers inside ONE batch are staggered; answers that
          // arrived in separate batches are separate beats and this loop runs
          // once. Both are the same code, which is the point of folding a run.
          await wait(i * THROW_STEP)
          const seat = a.seatBox(t.player)
          const card = cardById(t.card)
          if (!seat || !card) return
          const from = {
            left: seat.left + (seat.width - centre.width * THROW_SCALE) / 2,
            top: seat.top + (seat.height - centre.height * THROW_SCALE) / 2,
            width: centre.width * THROW_SCALE,
            height: centre.height * THROW_SCALE,
          }
          const key = `upgrade:${t.eventId}`
          const [el] = await raise([{ key, card, at: from }])
          if (el) {
            const anim = play('playToCenter', el, { from, to: centre, duration: THROW_DUR })
            if (anim) await anim.finished
          }
          drop(key)
        }),
      )
    },
    [raise, drop],
  )

  return { overlay, run }
}
```

`drop(key)` at the end is what makes the handover exact: the flyer lets go in the same commit the
projection's own render of that card takes over, so it is never on screen twice — the rule #101's
Fix A had to learn the hard way.

- [ ] **Step 5: Register the runner**

`useBeats.ts`: import `useUpgradeBeat`, add it to the runner table beside `useTransferBeat`, and give
the `upgrade` plan kind its `exclusive: false` — a throw does not own the table, and other beats may
follow it in the same batch.

- [ ] **Step 6: Write the beat test**

`upgradeBeat.test.tsx`, mirroring `handLimitBeat.test.tsx`'s structure: one throw, then two in one
batch, asserting the second starts `THROW_STEP` after the first and that both end at the centre.

- [ ] **Step 7: Run**

```bash
pnpm --filter @release/web test src/features/board-beats && pnpm test
```

Expected: PASS.

- [ ] **Step 8: Verify by mutation**

Remove the `if (!upgradeRun) flush()` line and confirm the plan test goes red (two beats instead of
one). Set `THROW_STEP` to 0 and confirm the beat test goes red on the second card's start. Restore.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/features/board-beats
git commit -m "feat(web): each answer flies in as it arrives, however they reach this peer (#108)"
```

---

## Phase E — the paper trail

### Task E1: The audit page, the animation docs, and one stale comment

**Files:**
- Modify: `apps/playground/stories/AnimationAuditStory/AnimationAuditStory.tsx:648-671`
- Modify: `docs/animations/recipes.md`, `docs/animations/reference.md`,
  `docs/animations/backlog.md`
- Modify: `apps/frontend/src/features/board-beats/deckBeat.tsx:13-14`
- Test: `apps/ui/src/animations/docs.test.ts`

- [ ] **Step 1: Correct the stale comment**

`deckBeat.tsx:13-14` claims Git Branch and Git Merge belong to #108. They landed with #61 slice B and
`classifyPiles` already drives them:

```tsx
// The cards that CAUSE a split or a merge — Git Branch and Git Merge — landed
// with #61 slice B, and `classifyPiles` (planBeats.ts) derives which movement
// ran from `pilesChanged` alone. These are the movements they drive.
```

- [ ] **Step 2: Update the three audit entries**

Each of `GitCards/CherryPick`, `GitCards/Rebase` and `GitCards/SystemUpgrade` loses "(прототип)" /
"(prototype)" from its name and "Rules-complete отложен (#61)" / "Rules-complete deferred (#61)" from
its description, and gains a `board:` line naming the files that now play it — the shape every scene
before it uses:

```ts
    board:
      'pages/board/[gameId]/_useCherryPickStaging.tsx, pages/board/[gameId]/_Board.tsx',
```

Both `ru` and `en` for every entry — a description present in one language only is the failure this
page has had before.

- [ ] **Step 3: Record the two differences from the stories**

In the audit page's findings register **and** `docs/animations/backlog.md`:

1. **Rebase reorders by buttons on the board, by pointer drag in the story.** Why it matters: the
   movement exists twice in two shapes, and one of them is not keyboard-reachable. What would close
   it: a shared reorder control in `apps/ui`, used by both.
2. **The board's Cherry-pick grid scrolls where the story's does too, but over a live heap.** Why it
   matters: the story lifts its candidates out of the pile and the board cannot; anyone porting a
   third discard surface will hit the same fork.

- [ ] **Step 4: Add the recipes and reference rows**

`docs/animations/recipes.md` gains a sequence per card, in the file's existing shape. Any preset the
new code calls must have a row in `docs/animations/reference.md` — `apps/ui/src/animations/docs.test.ts`
fails otherwise, which is the machine half of keeping the page and the spec in step.

- [ ] **Step 5: Run everything**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/playground docs/animations apps/frontend/src/features/board-beats/deckBeat.tsx
git commit -m "docs(animations): the three git scenes as the board plays them, and a comment that outlived its fact (#108)"
```

---

## Verification before the PR

- [ ] `pnpm test` — the whole workspace
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] Play all three cards against the fake in the browser: base and sudo for each, plus the three
      fizzle paths (a discard of nothing but triggers, an exhausted deck, a table where nobody can
      discard).
- [ ] `prefers-reduced-motion: reduce` set in the browser: every one of the three resolves, and no
      surface is left standing after its pending clears.
- [ ] Close #61 with the PR, and say in the description which of its five cards each slice delivered.
