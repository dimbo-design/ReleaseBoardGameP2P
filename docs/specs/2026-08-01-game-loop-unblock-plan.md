# Unblocking the Game Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A game started from the lobby can be played to a winner — pendings answered, attacks defended against a visible countdown, and a result shown.

**Architecture:** Three independent joins between subsystems that are each already complete. `PendingPrompt` exists and never renders because its copy block is absent from the translation catalogs and optional in the kit's prop types. `GameOver` exists and never renders because nothing maps the engine's `over` across the adapter seam. The countdown ring is frozen because the kit deliberately owns no clock and no consumer ever supplied one. Each task adds the missing join and the test that would have caught its absence.

**Tech Stack:** TypeScript, React 19, CSS Modules, Vitest + @testing-library/react, pnpm workspaces, Vite source aliases.

**Spec:** [`2026-08-01-game-loop-unblock-design.md`](./2026-08-01-game-loop-unblock-design.md)
**Audit:** [`2026-08-01-game-screen-gap-audit.md`](./2026-08-01-game-screen-gap-audit.md)

## Global Constraints

- **No string literals in `.tsx`.** All user-visible text goes through `t()` in `@release/web`, or arrives as a `copy` prop in `@release/ui`. `@release/ui` never imports i18next.
- **`@release/ui` imports nothing from `@release/engine`.** Action types are mirrored structurally; the seam is proven at compile time in `packages/table-adapter/src/contract.test-d.ts`.
- **`@release/ui` never calls `Date.now()` or `Math.random()`.** Time arrives as a prop.
- **All text through `<Typography>`** (semantic `variant`, or raw `base` + `tk`).
- **Colors from design tokens only** — `var(--*)` from `apps/ui/src/design/tokens.css`.
- **Spacing uses logical properties** (`padding-inline`, `margin-block-start`) — stylelint enforces this.
- **Code comments in English.** Existing Russian comments are legacy; do not add new ones.
- **Translation keys must exist in both `en` and `ru`** (`packages/translation/src/locales/*/common.json`). A key present in one only silently falls back — which is the class of defect this plan exists to fix.
- **Page tests live in `__tests__/`**, never beside the page — generouted eagerly imports every non-`_` module under `pages/`.
- **Every new test is verified by mutation.** Break the code the test names, confirm it goes red, restore. `PendingPrompt` ships 160 lines of green tests for a component that has never once rendered in the application; a test that passes against broken code is a plan failure, not a passing test.

**Verification commands** (from the repo root):

```bash
pnpm typecheck && pnpm lint && pnpm test
```

**Branch:** `game-logic-git-operations`, cut from `game-page-wiring`. A merge train is expected; do not rebase onto `main`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/translation/src/locales/en/common.json` | `pending` + `window` copy blocks, EN | 1 |
| `packages/translation/src/locales/ru/common.json` | `pending` + `window` copy blocks, RU | 1 |
| `apps/ui/src/table/Table/types.ts` | `pending`/`window` required on `TableCopyBundle`; `now` on `TableProps` | 1, 3 |
| `apps/ui/src/table/Table/Table.tsx` | drop the `copy.pending`/`copy.window` render guards; drop `nowRef` for the `now` prop | 1, 3 |
| `apps/ui/src/table/Table/testFixture.ts` | fixture supplies the two new copy blocks | 1 |
| `apps/playground/stories/TableStory/TableStory.tsx` | supplies the two new copy blocks and a real clock | 1, 3 |
| `apps/frontend/src/pages/board/[gameId]/_layout.tsx` | binds `copy.pending`/`copy.window`, `over`, `onOverContinue`, `now` | 1, 2, 3 |
| `packages/table-adapter/src/toTableOver.ts` | maps `PlayerView['over']` to the kit's `TableOver` | 2 |
| `packages/table-adapter/src/index.ts` | exports `toTableOver` | 2 |
| `apps/frontend/src/features/play-game/useNow.ts` | consumer-owned clock, ticking only while a deadline is live | 3 |

---

### Task 1: Pending and window copy reach the table

**Files:**
- Modify: `packages/translation/src/locales/en/common.json`
- Modify: `packages/translation/src/locales/ru/common.json`
- Modify: `apps/ui/src/table/Table/types.ts:117-132`
- Modify: `apps/ui/src/table/Table/Table.tsx:340`, `:349`
- Modify: `apps/ui/src/table/Table/testFixture.ts`
- Modify: `apps/playground/stories/TableStory/TableStory.tsx:236-255`
- Modify: `apps/frontend/src/pages/board/[gameId]/_layout.tsx:71-82`
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/board.test.tsx`

**Interfaces:**
- Consumes: `PendingPromptCopy` and `WindowCopy` from `apps/ui/src/table/Table/PendingPrompt/PendingPrompt.tsx` — both already exported, neither changes.
- Produces: `copy.pending` and `copy.window` as **required** members of `TableCopyBundle`. Task 3 touches the same page `copy` block; it does not touch these keys.

- [ ] **Step 1: Write the failing test**

Append to `apps/frontend/src/pages/board/[gameId]/__tests__/board.test.tsx`. The projection is built by the real engine and the pending is then set on the view: what is under test is that the *page* renders the prompt against the *real catalogs*, not that the engine produces the pending — `packages/engine` already covers the latter, and driving a real game to a `discardForRelease` would make the test depend on which cards a seed happens to deal.

```tsx
it('renders the pending prompt from the real catalog when a decision is owed', async () => {
  const engine = createFakeEngine()
  const state = engine.createGame({
    gameId: 'g1',
    seed: 7,
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const projected = engine.project(state, 'p1')
  const view = {
    ...projected,
    pending: {
      kind: 'discardForRelease' as const,
      player: 'p1',
      options: projected.self.hand.map((c) => c.uid),
    },
  }
  sessionValue = { ...session(), gameSync: { view, events: [] } } as unknown as UseLobby

  renderBoard()

  // The prompt is gated on `copy.pending` being present. With the key absent
  // from the catalogs the whole branch is skipped silently — the game then
  // deadlocks, because a pending rejects every subsequent action.
  // Asserted on the heading, which PendingPrompt renders as plain text from
  // `kindCopy.prompt`; `copy.confirm` is a ConfirmAction label and reaching it
  // would test that component's affordance rather than this binding.
  const heading = await screen.findByText(
    /^(discard a card to ship this release|сбросьте карту, чтобы выложить релиз)$/i,
  )
  expect(heading).toBeTruthy()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @release/web test -- board.test`
Expected: FAIL — `findByText` times out, because `copy.pending` is `undefined` and `Table.tsx:349` skips the prompt.

- [ ] **Step 3: Add the copy blocks to both catalogs**

In `packages/translation/src/locales/en/common.json`, add two top-level keys alongside `turnDock`:

```json
  "pending": {
    "confirm": "confirm",
    "decline": "let it through",
    "discardForRelease": { "prompt": "discard a card to ship this release", "action": "discard" },
    "defend": { "prompt": "you are under attack", "action": "defend" },
    "neutralize503": { "prompt": "error 503 — neutralize it or you are out", "action": "neutralize" },
    "crush": { "prompt": "your release is being crushed", "action": "neutralize" },
    "requestCard": { "prompt": "name the card you demand", "action": "demand" },
    "giveCard": { "prompt": "hand over the card", "action": "give" },
    "handLimit": { "prompt": "your hand is over the limit", "action": "discard" }
  },
  "window": {
    "unpass": "cancel pass"
  }
```

In `packages/translation/src/locales/ru/common.json`, the same shape:

```json
  "pending": {
    "confirm": "подтвердить",
    "decline": "пропустить",
    "discardForRelease": { "prompt": "сбросьте карту, чтобы выложить релиз", "action": "сбросить" },
    "defend": { "prompt": "вас атакуют", "action": "защититься" },
    "neutralize503": { "prompt": "error 503 — нейтрализуйте или выбываете", "action": "нейтрализовать" },
    "crush": { "prompt": "ваш релиз уничтожают", "action": "нейтрализовать" },
    "requestCard": { "prompt": "назовите нужную карту", "action": "запросить" },
    "giveCard": { "prompt": "отдайте карту", "action": "отдать" },
    "handLimit": { "prompt": "на руке слишком много карт", "action": "сбросить" }
  },
  "window": {
    "unpass": "отменить пас"
  }
```

- [ ] **Step 4: Bind both blocks on the board page**

In `apps/frontend/src/pages/board/[gameId]/_layout.tsx`, inside the `copy={{ … }}` prop, add two entries after `turnDock`:

```tsx
          pending: t('pending', { returnObjects: true }),
          window: t('window', { returnObjects: true }),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @release/web test -- board.test`
Expected: PASS.

- [ ] **Step 6: Verify the test by mutation**

Delete the `pending:` line added in Step 4, re-run the test, confirm it goes red, then restore it. A test that stays green here asserts nothing and must be rewritten before continuing.

- [ ] **Step 7: Make both blocks required so the omission cannot recur**

In `apps/ui/src/table/Table/types.ts`, change the last two members of `TableCopyBundle`:

```ts
  pause?: PauseGameCopy
  pending: PendingPromptCopy
  window: WindowCopy
}
```

In `apps/ui/src/table/Table/Table.tsx`, drop the now-dead guards. Line 340 becomes:

```tsx
        {state.window?.passed.includes(state.selfId) && (
```

and line 349 becomes:

```tsx
      {state.pending?.player === state.selfId && (
```

- [ ] **Step 8: Supply the new blocks at the kit's other two call sites**

`apps/ui/src/table/Table/testFixture.ts` — add to the `copy` object after `turnDock`:

```ts
      pending: enCommon.pending,
      window: enCommon.window,
```

`apps/playground/stories/TableStory/TableStory.tsx` — add to the `copy` prop after the `turnDock` line:

```tsx
            pending: pick(lang, { ru: ruCommon.pending, en: enCommon.pending }),
            window: pick(lang, { ru: ruCommon.window, en: enCommon.window }),
```

Note `makeTableProps` ends in `as TableProps`, so the cast would have hidden a missing required key from the typechecker. Adding the two entries is what makes the fixture honest; do not rely on the cast to carry it.

- [ ] **Step 9: Verify the whole workspace**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. `typecheck` is the point of Step 7 — a consumer that omits either block now fails to compile.

- [ ] **Step 10: Commit**

```bash
git add packages/translation apps/ui/src/table/Table apps/playground/stories/TableStory "apps/frontend/src/pages/board/[gameId]"
git commit -m "fix(web): a pending decision can finally be answered"
```

---

### Task 2: A finished game shows its winner

**Files:**
- Create: `packages/table-adapter/src/toTableOver.ts`
- Create: `packages/table-adapter/src/toTableOver.test.ts`
- Modify: `packages/table-adapter/src/index.ts`
- Modify: `apps/frontend/src/pages/board/[gameId]/_layout.tsx`
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/board.test.tsx`

**Interfaces:**
- Consumes: `PlayerView` from `@release/engine`; `TableOver` from `@release/ui`.
- Produces: `toTableOver(view: PlayerView): TableOver | null`, exported from `@release/table-adapter`.

`over` is a member of `TableProps`, not of `TableState` — so `toTableState` cannot carry it and is not modified by this task. The mapping still belongs in the adapter, which is the one package allowed to see both `@release/engine` and `@release/ui`.

- [ ] **Step 1: Write the failing adapter test**

Create `packages/table-adapter/src/toTableOver.test.ts`:

```ts
import type { PlayerView } from '@release/engine'
import { describe, expect, it } from 'vitest'
import { toTableOver } from './toTableOver'

const base = { over: null } as unknown as PlayerView

describe('toTableOver', () => {
  it('is null while the game is running', () => {
    expect(toTableOver(base)).toBeNull()
  })

  it('renames the engine winner to the kit winnerId and carries the condition', () => {
    const view = { ...base, over: { winner: 'p2', condition: 'release' as const } }
    expect(toTableOver(view)).toEqual({ winnerId: 'p2', condition: 'release' })
  })

  it('carries lastStanding as its own condition', () => {
    const view = { ...base, over: { winner: 'p1', condition: 'lastStanding' as const } }
    expect(toTableOver(view)).toEqual({ winnerId: 'p1', condition: 'lastStanding' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @release/table-adapter test`
Expected: FAIL — cannot resolve `./toTableOver`.

- [ ] **Step 3: Write the mapping**

Create `packages/table-adapter/src/toTableOver.ts`:

```ts
import type { PlayerView } from '@release/engine'
import type { TableOver } from '@release/ui'

// `over` hangs off TableProps rather than TableState, so this is a second
// entry point beside toTableState rather than a field inside it. The rename
// is the whole mapping: the engine names the seat `winner`, the kit resolves
// it against its own participants by `winnerId`.
export function toTableOver(view: PlayerView): TableOver | null {
  if (!view.over) return null
  return { winnerId: view.over.winner, condition: view.over.condition }
}
```

Add to `packages/table-adapter/src/index.ts`:

```ts
export { toTableOver } from './toTableOver'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @release/table-adapter test`
Expected: PASS, 3 new tests.

- [ ] **Step 5: Write the failing page test**

Append to `apps/frontend/src/pages/board/[gameId]/__tests__/board.test.tsx`:

```tsx
it('shows the winner overlay when the projection says the game is over', async () => {
  const engine = createFakeEngine()
  const state = engine.createGame({
    gameId: 'g1',
    seed: 7,
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const projected = engine.project(state, 'p1')
  const view = { ...projected, over: { winner: 'p2', condition: 'release' as const } }
  sessionValue = { ...session(), gameSync: { view, events: [] } } as unknown as UseLobby

  renderBoard()

  // The winner is resolved against the room roster by id, so the overlay
  // proves both the adapter's rename and the page's binding.
  expect(await screen.findByText(/^(winner|победитель)$/i)).toBeTruthy()
  expect(await screen.findByText(/^(3 releases shipped|Собраны 3 релиза)$/i)).toBeTruthy()
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @release/web test -- board.test`
Expected: FAIL — the page passes no `over`, so `GameOver` never mounts.

- [ ] **Step 7: Bind the overlay on the page**

In `apps/frontend/src/pages/board/[gameId]/_layout.tsx`, extend the adapter import:

```tsx
import { toTableOver, toTableState } from '@release/table-adapter'
```

Add `useNavigate` to the existing `react-router` import and call it in the component body, beside the existing hooks:

```tsx
  const navigate = useNavigate()
  const gameId = session.gameId
```

Add the `over` prop to `<Table>`, directly after `state={state}`:

```tsx
        over={game.view ? toTableOver(game.view) : null}
```

and add the continue action inside the existing `actions={{ … }}` block, after `onResolve`:

```tsx
          onOverContinue: () => navigate(`/board/${gameId}/stats`),
```

`/board/:gameId/stats` is already a child route of this layout's `Outlet`. `Stats` renders an empty result table until [#19](https://github.com/MythHand/ReleaseBoardGameP2P/issues/19) computes per-player statistics — that is expected and out of scope here.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @release/web test -- board.test`
Expected: PASS.

- [ ] **Step 9: Verify both tests by mutation**

In `toTableOver.ts`, return `null` unconditionally; confirm both the adapter tests and the page test go red; restore. Then remove the `over={…}` prop; confirm only the page test goes red; restore.

- [ ] **Step 10: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

```bash
git add packages/table-adapter "apps/frontend/src/pages/board/[gameId]"
git commit -m "feat(web): the game can end, and says who won"
```

---

### Task 3: The countdown actually counts

**Files:**
- Modify: `apps/ui/src/table/Table/types.ts`
- Modify: `apps/ui/src/table/Table/Table.tsx:116-123`
- Test: `apps/ui/src/table/Table/Table.test.tsx`
- Create: `apps/frontend/src/features/play-game/useNow.ts`
- Create: `apps/frontend/src/features/play-game/useNow.test.ts`
- Modify: `apps/frontend/src/pages/board/[gameId]/_layout.tsx`
- Modify: `apps/playground/stories/TableStory/TableStory.tsx`

**Interfaces:**
- Consumes: `deriveDock(state, selfId, now)` from `apps/ui/src/table/Table/dock.ts` — unchanged, it already takes `now`.
- Produces: `now?: number` on `TableProps`; `useNow(active: boolean, intervalMs?: number): number` in the frontend.

- [ ] **Step 1: Write the failing kit test**

Append to `apps/ui/src/table/Table/Table.test.tsx`:

```tsx
it('sweeps the countdown from the now it is given', () => {
  const base = makeTableProps()
  const props = makeTableProps({
    state: {
      ...base.state,
      window: {
        player: 'p2',
        slot: 'frontend',
        round: 1,
        openedAt: 1_000,
        deadline: 16_000,
        passed: [],
        canAttackWith: [base.state.you.hand[0]?.uid ?? 'x'],
      },
    },
    now: 6_000,
  })
  const { container } = render(<Table {...props} />)
  // 16000 - 6000 = 10s left. Frozen at now=0 the dock reads 16.
  expect(container.textContent).toContain('10')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @release/ui test -- Table.test`
Expected: FAIL — `now` is not a known prop, and the dock reads 16 seconds from the hardcoded `nowRef.current` of 0.

- [ ] **Step 3: Give the kit a `now` prop**

In `apps/ui/src/table/Table/types.ts`, add to `TableProps` after `dock`:

```ts
  // The consumer's clock. The kit never reads the system clock itself, so a
  // consumer that wants a live countdown ticks this; omitting it freezes the
  // sweep at the span's start rather than crashing.
  now?: number
```

In `apps/ui/src/table/Table/Table.tsx`, add `now = 0` to the destructured props beside `dock`, then replace lines 117-123 with:

```tsx
  const derived = deriveDock(state, state.selfId, now)
  const dockView = { ...derived, ...dock }
```

Remove the `useRef` import if nothing else in the file uses it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @release/ui test -- Table.test`
Expected: PASS.

- [ ] **Step 5: Write the failing hook test**

Create `apps/frontend/src/features/play-game/useNow.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useNow } from './useNow'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

it('advances while a deadline is live', () => {
  const { result } = renderHook(() => useNow(true, 100))
  const first = result.current
  act(() => {
    vi.advanceTimersByTime(300)
  })
  expect(result.current).toBeGreaterThan(first)
})

it('holds still when nothing is counting down', () => {
  const { result } = renderHook(() => useNow(false, 100))
  const first = result.current
  act(() => {
    vi.advanceTimersByTime(300)
  })
  // The whole table re-renders on every tick, so an unconditional interval
  // would run four times a second for an entire game to animate a ring that
  // is not on screen.
  expect(result.current).toBe(first)
})

it('stops its interval when the deadline closes', () => {
  const { result, rerender } = renderHook(({ active }) => useNow(active, 100), {
    initialProps: { active: true },
  })
  act(() => {
    vi.advanceTimersByTime(300)
  })
  rerender({ active: false })
  const settled = result.current
  act(() => {
    vi.advanceTimersByTime(300)
  })
  expect(result.current).toBe(settled)
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @release/web test -- useNow`
Expected: FAIL — cannot resolve `./useNow`.

- [ ] **Step 7: Write the hook**

Create `apps/frontend/src/features/play-game/useNow.ts`:

```ts
import { useEffect, useState } from 'react'

// The consumer's clock for the kit's countdown. It ticks only while something
// is actually counting down: `deriveDock` reads `now` for deadline arithmetic
// and nothing else, so a stale value between windows is never observed.
export function useNow(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [active, intervalMs])

  return now
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @release/web test -- useNow`
Expected: PASS, 3 tests.

- [ ] **Step 9: Drive the clock from the board page**

In `apps/frontend/src/pages/board/[gameId]/_layout.tsx`, import the hook:

```tsx
import { useNow } from '~/features/play-game/useNow'
```

Add, beside the other hook calls in the component body:

```tsx
  // A window is open, or a pending owes a timed decision — the only two states
  // that put a live deadline on screen.
  const counting =
    Boolean(game.view?.window) ||
    Boolean(game.view?.pending && 'deadline' in game.view.pending)
  const now = useNow(counting)
```

and pass it to `<Table>`, directly after the `over` prop:

```tsx
        now={now}
```

- [ ] **Step 10: Drive the clock in the playground**

In `apps/playground/stories/TableStory/TableStory.tsx`, the story owns its own clock the same way the page does. Add near the other story state:

```tsx
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
```

and pass `now={now}` to `<Table>` beside the existing `dock={…}` prop. The story's `dock` override still wins for the demo states, since `dockView` spreads `dock` over `derived`.

- [ ] **Step 11: Verify by mutation**

Hardcode `now` to `0` in the `deriveDock` call in `Table.tsx`; confirm the kit test goes red; restore. In `useNow`, remove the `if (!active) return` guard; confirm the second hook test goes red; restore.

- [ ] **Step 12: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

```bash
git add apps/ui/src/table/Table apps/frontend/src/features/play-game apps/playground/stories/TableStory "apps/frontend/src/pages/board/[gameId]"
git commit -m "feat(ui): the countdown ring sweeps against a real clock"
```

---

### Task 4: Play it

This is the acceptance gate. It is manual, it needs two browsers, and it is the step both prior plans specified and neither performed — every claim in #64 and #65 rests on jsdom, which is exactly how three dead code paths shipped green.

**Files:** none. This task changes nothing; it either passes or it sends you back to Tasks 1–3.

- [ ] **Step 1: Start the app and a signalling server**

Run: `pnpm dev`
Open two browser profiles (or one normal and one private window) so the two peers hold separate sessions.

- [ ] **Step 2: Start a game**

Host a lobby in the first window, join with the invite link in the second, and start. Expected: both land on `/board/:id`, both dealt 5 cards, deck and event counts identical on both.

- [ ] **Step 3: Play a Release and pay its cost**

As the player whose turn it is, draw, then play a Release card. Expected: the pending prompt appears with the discard text from the catalog; choosing a card resolves it; the release lands in the zone and the discarded card leaves the hand. **Before this plan, the prompt never appeared and the game stopped here permanently.**

- [ ] **Step 4: Attack, and defend against a visible countdown**

From the other seat, attack the fresh release. Expected: the reaction window opens on the owner's screen with a ring that visibly sweeps and a second count that decreases. Defend with a Cancel or Unicorn card if held, or let it expire.

- [ ] **Step 5: Reach a winner**

Play on until a seat ships three Releases or is last standing. Expected: the game-over overlay names the winner on **both** screens, and its action lands on the stats route.

- [ ] **Step 6: Record what happened**

If every step passed, note it on the PR description with the two-peer detail — that is the evidence the definition of done asks for. If a step failed, the gap is in Tasks 1–3 and belongs there, not in a follow-up issue.

---

## Not in this plan

The rest of the audit: the invisible Code Review protection, silent rejected actions, the unbound `?panel=` drawer, the sudo attack that cannot enter a reaction window, session lifecycle ([#58](https://github.com/MythHand/ReleaseBoardGameP2P/issues/58)), animations ([#23](https://github.com/MythHand/ReleaseBoardGameP2P/issues/23)), and [#61](https://github.com/MythHand/ReleaseBoardGameP2P/issues/61)'s card effects, which are blocked on the rules questions in [`2026-08-01-git-operations-open-questions.md`](../rules/decisions/2026-08-01-git-operations-open-questions.md).

Task 12 of [`2026-07-31-table-interaction-plan.md`](./2026-07-31-table-interaction-plan.md) — the solo-playable `TableStory` — stays open. Task 4 above is the two-peer version of the same gate.
