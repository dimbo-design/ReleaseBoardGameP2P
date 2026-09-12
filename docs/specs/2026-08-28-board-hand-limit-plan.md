# Hand Limit On The Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A turn that ends over the hand limit is paid for by pulling cards out of the fan into an open grid at the centre, which is held for the table to read and then leaves for the discard as one staggered movement.

**Architecture:** The gesture and the beat split the choreography. A new page hook (`_useHandLimit.tsx`, a fourth sibling to the three staging hooks) owns the pull gate, the concurrent flights into the grid, the carry-back and the single `RESOLVE`; the flights are not beats, so the fan is never blocked by one. The arriving `discarded(handLimit)` batch plans its own beat kind, whose runner either adopts the grid the local player built (through a handoff ref, the seam #100 established) or builds the same grid itself from the actor's seat for every other peer, and then holds `GATHER_HOLD` and sends the cards out through `useDiscardExit`.

**Tech Stack:** TypeScript, React 19, Vite, Vitest + @testing-library/react, CSS Modules + design tokens, pnpm workspaces. WAAPI choreography through `@release/ui/animations` (`play`, `useFlyer`, `useHandArrival`, `useDiscardExit`).

**Spec:** [docs/specs/2026-08-28-board-hand-limit-design.md](./2026-08-28-board-hand-limit-design.md) — read it before Task 1; every task argues from it.

**Issue:** [#104](https://github.com/MythHand/ReleaseBoardGameP2P/issues/104), Wave 5 of [#88](https://github.com/MythHand/ReleaseBoardGameP2P/issues/88). Branch: `feat/104-hand-limit`, merged with fresh `origin/main` after PR [#126](https://github.com/MythHand/ReleaseBoardGameP2P/pull/126) landed.

## Global Constraints

- **Comments in English.** Existing Russian comments are legacy; do not add new ones.
- **No string literals in `.tsx`.** All user-visible copy goes through `t()` / the `copy` props. A new key must exist in **both** `packages/translation/src/locales/en/common.json` and `.../ru/common.json`.
- **Colors are design tokens only** — `var(--danger-accent)`, `var(--white-12)`; never a hex, `rgb()` or a named color, in CSS or inline styles.
- **All text through `<Typography>`** from `@release/ui`; never a raw `<p>` / `<span>` with font CSS.
- **Feature-Sliced imports are one-way**: `pages/` → `features/` → `entities/` → `shared/`. A feature must never import from a page or from a sibling feature. Anything both the page and a beat need lives in `entities/game/board/`.
- **`prefers-reduced-motion` is honoured**: `play()` does not check it. The queue reads it once (`useBeats`), and the new gesture hook reads it through `~/shared/lib/useReducedMotion` and skips its flights.
- **Numbers are quoted, never invented**: `GATHER_HOLD` 1500, `CLEAR_STEP` 90, `GRID_TOP` 44, `GRID_GAP` 12, grid card widths `[150, 132, 116]`, `BAND_PAD` 32, `playToCenter` for every flight into a cell. All from `apps/playground/stories/HandLimitStory/` and its recipe.
- **Animation invariants** (`docs/animations/README.md`): **I1** measure before the source unmounts · **I2** paint at the source before moving · **I6** aim at a card BOX, never a tilted node's bounding rect · **I7** one scatter drives both flight and rest · **I8** a sequence spanning awaits takes its facts as arguments/refs, never from a stale render · **I10** every concurrent carrier mounts on its own rect.
- **PR #126 is the baseline, not work to revisit.** Preserve elimination's per-clip duration table, guard measured from the first `playing` event with `performance.now()` plus per-loop slack, idle preload after the opening, exclusive queue beat, and `beats.running` game-over gate. Start's iframe and elimination's local `<video>` do not share one playback policy; do not restore the rejected “two kinds of video” audit finding.
- **Commands.** Tests: `pnpm --filter @release/ui test <path>` and `pnpm --filter @release/web test <path>`. Whole repo: `pnpm test`, `pnpm typecheck`, `pnpm lint`. Never start a dev server with Bash.

---

### Task 1: The grid's geometry, in one place

The shapes, widths and cell offsets the grid is made of. It lives in `@release/ui` beside `centre.ts` because #127 made that the single source of centre geometry — a CSS module cannot be reused by a flight or asked about by a test — and because both readers (the page's cells, the beat's boxes) must compute the same layout or they drift apart.

**Files:**
- Create: `apps/ui/src/table/TableCentre/discardGrid.ts`
- Create: `apps/ui/src/table/TableCentre/discardGrid.test.ts`
- Modify: `apps/ui/src/index.ts` (barrel, beside the `centre.ts` export block at line 159)
- Modify: `apps/playground/stories/HandLimitStory/HandLimitStory.tsx` (adopt the shared constants)

**Interfaces:**
- Consumes: `CARD_RATIO` from `@/primitives/Card` (height / width = 1.4).
- Produces: `gridOf(n) → { cols, rows }`, `gridCardW(rows) → number`, `gridCells(n) → { dx, dy, w, h }[]`, `GRID_TOP = 44`, `GRID_GAP = 12`, `GRID_CARD_W = [150, 132, 116]`, types `GridShape` and `GridCell`. Tasks 4, 6 and 8 import all of these from `@release/ui`.

- [ ] **Step 1: Write the failing test**

Create `apps/ui/src/table/TableCentre/discardGrid.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { GRID_GAP, gridCardW, gridCells, gridOf } from './discardGrid'

// The grid's rules, which a stylesheet cannot be asked about — the same reason
// `centre.test.ts` exists next door. Values are the approved scene's
// (HandLimitStory); this file only pins that they are still true.
describe('the discard grid at the centre', () => {
  it('picks its shape from the count, not from the cards arriving', () => {
    expect(gridOf(1)).toEqual({ cols: 1, rows: 1 })
    expect(gridOf(4)).toEqual({ cols: 4, rows: 1 })
    expect(gridOf(6)).toEqual({ cols: 3, rows: 2 })
    expect(gridOf(8)).toEqual({ cols: 4, rows: 2 })
    expect(gridOf(10)).toEqual({ cols: 5, rows: 2 })
    expect(gridOf(15)).toEqual({ cols: 5, rows: 3 })
  })

  // an empty grid still has a box: `gridOf(0)` is asked before the first card
  it('never yields a grid of nothing', () => {
    expect(gridOf(0)).toEqual({ cols: 1, rows: 1 })
  })

  it('shrinks the card as the grid grows taller', () => {
    expect(gridCardW(1)).toBeGreaterThan(gridCardW(2))
    expect(gridCardW(2)).toBeGreaterThan(gridCardW(3))
  })

  it('centres the block on the grid point', () => {
    const cells = gridCells(4)
    const midX = cells.reduce((a, c) => a + c.dx, 0) / cells.length
    expect(Math.abs(midX)).toBeLessThan(0.001)
    // one row: every cell on the same line, and that line through the point
    expect(cells.every((c) => c.dy === 0)).toBe(true)
  })

  it('leaves exactly one gap between neighbours, across and down', () => {
    const cells = gridCells(6) // 3 x 2
    expect(cells[1].dx - cells[0].dx).toBeCloseTo(cells[0].w + GRID_GAP)
    expect(cells[3].dy - cells[0].dy).toBeCloseTo(cells[0].h + GRID_GAP)
  })

  it('never overlaps two cells', () => {
    const cells = gridCells(15)
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i]
        const b = cells[j]
        const apart =
          Math.abs(a.dx - b.dx) >= a.w - 0.001 || Math.abs(a.dy - b.dy) >= a.h - 0.001
        expect(apart).toBe(true)
      }
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @release/ui test src/table/TableCentre/discardGrid.test.ts`
Expected: FAIL — `Failed to resolve import "./discardGrid"`.

- [ ] **Step 3: Write the module**

Create `apps/ui/src/table/TableCentre/discardGrid.ts`:

```ts
// THE GRID THE HAND LIMIT'S EXCESS BUILDS AT THE CENTRE.
//
// Quoted verbatim from the playground's `HandLimitStory` — the approved visual
// source — and kept HERE for the same reason `centre.ts` keeps the named
// places: geometry written in a CSS module can be neither reused by a flight
// nor asked about by a test, which is exactly how one layout ends up written
// twice and equal by attention alone.
//
// It is NOT a `CentreSet`. A set is a handful of named places a scene declared;
// a grid's cells are a function of a count, and no one can list them. Same
// folder, same rule, different shape.
import { CARD_RATIO } from '@/primitives/Card'

export interface GridShape {
  cols: number
  rows: number
}

/** one cell, as an offset from the grid's own centre point */
export interface GridCell {
  dx: number
  dy: number
  w: number
  h: number
}

/**
 * The grid's row, in % of the table's height. Two below the centre row
 * (`CENTRE_TOP` is 42) — the scene's own value, carried rather than aligned by
 * inference: a block of up to three rows is not a card box, and the scene
 * placed it where it placed it.
 */
export const GRID_TOP = 44
/** between neighbouring cells, px */
export const GRID_GAP = 12
/**
 * Card width by row count: the taller the grid, the smaller the card — a wide
 * grid has to stay on screen without ever shrinking a small, readable one. The
 * one-row width is `CENTRE_CARD_W`, so nothing rescales for the board.
 */
export const GRID_CARD_W = [150, 132, 116]

/**
 * The shape for `n` cards, chosen UPFRONT from the known excess: 1–4 one row,
 * then two rows of 3 / 4 / 5, and three rows past ten. Ten cards to discard is
 * already anomalous for the game's mechanics, so 15 is ample headroom.
 */
export function gridOf(n: number): GridShape {
  if (n <= 4) return { cols: Math.max(n, 1), rows: 1 }
  if (n <= 6) return { cols: 3, rows: 2 }
  if (n <= 8) return { cols: 4, rows: 2 }
  if (n <= 10) return { cols: 5, rows: 2 }
  return { cols: Math.ceil(n / 3), rows: 3 }
}

export function gridCardW(rows: number): number {
  return GRID_CARD_W[rows - 1] ?? GRID_CARD_W[GRID_CARD_W.length - 1]
}

/**
 * Every cell of an `n`-card grid, as offsets from the grid's centre point. The
 * block is centred on that point, so a grid of any shape sits where the last
 * one did.
 *
 * Offsets rather than boxes, for the same reason `centreTransform` speaks in
 * `dx`: the page renders them as a transform inside the table, and a flight adds
 * them to a measured point in viewport space. One function, two readers.
 */
export function gridCells(n: number): GridCell[] {
  const { cols, rows } = gridOf(n)
  const w = gridCardW(rows)
  const h = w * CARD_RATIO
  const blockW = cols * w + (cols - 1) * GRID_GAP
  const blockH = rows * h + (rows - 1) * GRID_GAP
  const cells: GridCell[] = []
  for (let i = 0; i < n; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    cells.push({
      dx: col * (w + GRID_GAP) - blockW / 2 + w / 2,
      dy: row * (h + GRID_GAP) - blockH / 2 + h / 2,
      w,
      h,
    })
  }
  return cells
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @release/ui test src/table/TableCentre/discardGrid.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Export it from the barrel**

In `apps/ui/src/index.ts`, immediately after the existing `} from './table/TableCentre/centre'` block (line ~171), add:

```ts
export {
  GRID_CARD_W,
  GRID_GAP,
  GRID_TOP,
  type GridCell,
  type GridShape,
  gridCardW,
  gridCells,
  gridOf,
} from './table/TableCentre/discardGrid'
```

- [ ] **Step 6: The story reads the shared numbers instead of its own**

In `apps/playground/stories/HandLimitStory/HandLimitStory.tsx`:

Delete the local `gridOf` function and the `GRID_CARD_W` constant (the block under the comment "Grid shape by card count…" and the two lines under "the taller the grid, the smaller the card…"). Add to the imports, beside the other `@/` imports:

```tsx
import { gridCardW, gridOf } from '@/table/TableCentre/discardGrid'
```

Then change the one line that used the array:

```tsx
  const cardW = gridCardW(grid.rows)
```

Leave everything else in the story alone — its rendering, its CSS (`gap: 12px`, `44%`), `GRID_HOLD` and `CLEAR_STEP`. The scene stays the visual source; this only stops the shapes and widths existing twice.

- [ ] **Step 7: Verify the story still type-checks and the kit is green**

Run: `pnpm --filter @release/ui test && pnpm typecheck`
Expected: PASS both.

- [ ] **Step 8: Commit**

```bash
git add apps/ui/src/table/TableCentre/discardGrid.ts apps/ui/src/table/TableCentre/discardGrid.test.ts apps/ui/src/index.ts apps/playground/stories/HandLimitStory/HandLimitStory.tsx
git commit -m "feat(ui): the discard grid's geometry, where a flight can read it (#104)"
```

---

### Task 2: `withoutFlown` moves out of the discard beat

Two runners are about to need one answer to "these cards have left, and the heap has not got them yet". A second copy of it would be a second source for one heap, which is the very thing `discardBeat`'s header warns against.

**Files:**
- Create: `apps/frontend/src/features/board-beats/withoutFlown.ts`
- Modify: `apps/frontend/src/features/board-beats/discardBeat.tsx`

**Interfaces:**
- Consumes: `DiscardCard` from `./planBeats`, `BoardState` from `~/entities/game/board`.
- Produces: `withoutFlown(base: BoardState, flown: DiscardCard[]): BoardState`. Task 4's runner imports it.

- [ ] **Step 1: Establish the green baseline**

Run: `pnpm --filter @release/web test src/features/board-beats`
Expected: PASS. Note the number of tests — it must be identical after the move.

- [ ] **Step 2: Create the module with the function moved verbatim**

Create `apps/frontend/src/features/board-beats/withoutFlown.ts` and move the whole `withoutFlown` function out of `discardBeat.tsx`, header comment included, adding the imports it needs:

```ts
import type { ReleaseSlots } from '@release/ui'
import type { BoardState } from '~/entities/game/board'
import type { DiscardCard } from './planBeats'

// The shadow's lifetime scopes PER END, not per beat. The hand goes live the
// moment a card's slot has been measured — it leaves the fan as it takes off,
// which is what the playground's own drag-out does too — while the discard end
// keeps the pre-batch projection until the card actually lands, or the heap
// would show it before it arrives. A runner publishes exactly this: `ctx.base`
// with every flying card gone from wherever it stood, and `decks` untouched.
// Pure, so a beat only has to call it and hand the result to `ctx.publish`.
//
// It lives in its own module because two runners answer this same question —
// the ordinary discard and the hand limit's grid — and a second copy of it
// would be a second source for one heap.
export function withoutFlown(base: BoardState, flown: DiscardCard[]): BoardState {
  const handIndexes = new Set<number>()
  const clearedSlots = new Map<string, Set<keyof ReleaseSlots>>()
  const seatDrops = new Map<string, number>()

  for (const { source } of flown) {
    if (source.kind === 'hand') {
      handIndexes.add(source.index)
    } else if (source.kind === 'release') {
      const slots = clearedSlots.get(source.player) ?? new Set<keyof ReleaseSlots>()
      slots.add(source.slot as keyof ReleaseSlots)
      clearedSlots.set(source.player, slots)
    } else {
      seatDrops.set(source.player, (seatDrops.get(source.player) ?? 0) + 1)
    }
  }

  const withoutSlots = (release: ReleaseSlots, slots?: Set<keyof ReleaseSlots>): ReleaseSlots => {
    if (!slots) return release
    const next = { ...release }
    for (const slot of slots) next[slot] = null
    return next
  }

  return {
    ...base,
    you: {
      ...base.you,
      hand:
        handIndexes.size > 0 ? base.you.hand.filter((_, i) => !handIndexes.has(i)) : base.you.hand,
      release: withoutSlots(base.you.release, clearedSlots.get(base.selfId)),
    },
    opponents: base.opponents.map((o) => {
      const drop = seatDrops.get(o.id)
      const slots = clearedSlots.get(o.id)
      if (!drop && !slots) return o
      return {
        ...o,
        handCount: drop ? Math.max(0, o.handCount - drop) : o.handCount,
        release: withoutSlots(o.release, slots),
      }
    }),
  }
}
```

- [ ] **Step 3: Import it in the discard beat**

In `apps/frontend/src/features/board-beats/discardBeat.tsx`, delete the function and its comment block, delete the now-unused `ReleaseSlots` type import, and add beside the other local imports:

```ts
import { withoutFlown } from './withoutFlown'
```

- [ ] **Step 4: Run the suite to verify nothing changed**

Run: `pnpm --filter @release/web test src/features/board-beats && pnpm typecheck`
Expected: PASS with the same test count as Step 1.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/board-beats/withoutFlown.ts apps/frontend/src/features/board-beats/discardBeat.tsx
git commit -m "refactor(web): one answer to what a flying card has already left (#104)"
```

---

### Task 3: The hand limit gets its own plan

A hand-limit discard is not an ordinary one: on the actor's own board those cards are standing in the grid, not in the fan, and the runner needs a handoff the discard beat has no business knowing about. So it is its own kind, coalescing per player exactly as every other run does.

**Files:**
- Modify: `apps/frontend/src/features/board-beats/planBeats.ts`
- Modify: `apps/frontend/src/features/board-beats/planBeats.test.ts` (four existing tests use `reason: 'handLimit'` as a stand-in for an ordinary discard and must stop doing so: lines ~92, ~429, ~945, ~959)

**Interfaces:**
- Consumes: `DiscardCard`, `sourceOf` (already in the file).
- Produces: `{ kind: 'handLimit'; key: string; player: string; cards: DiscardCard[] }` on the `BeatPlan` union. Tasks 4 and 5 consume it.

- [ ] **Step 1: Write the failing tests**

In `apps/frontend/src/features/board-beats/planBeats.test.ts`, add inside the `describe('planBeats')` block, right after the existing `it('puts every discard of one batch in a single beat', …)`:

```ts
  // The excess leaves as one gesture, and NOT as an ordinary discard: on the
  // actor's own board those cards are standing in the grid at the centre, and
  // the grid is what the beat flies out (#104).
  it('gives a hand-limit discard its own beat, keyed by its first card', () => {
    const beats = planBeats(
      [
        discarded(4, { reason: 'handLimit' }),
        discarded(5, { card: 'protection-debugger', reason: 'handLimit' }),
      ],
      boardBefore(),
    )
    expect(beats).toHaveLength(1)
    const [beat] = beats
    expect(beat.kind).toBe('handLimit')
    expect(beat.key).toBe('handLimit:4')
    expect(beat.kind === 'handLimit' && beat.player).toBe('p1')
    expect(beat.kind === 'handLimit' && beat.cards.map((c) => c.key)).toEqual(['d4', 'd5'])
  })

  it('never folds a hand-limit discard together with an ordinary one', () => {
    const beats = planBeats(
      [
        discarded(4, { reason: 'effect' }),
        discarded(5, { card: 'protection-debugger', reason: 'handLimit' }),
      ],
      boardBefore(),
    )
    expect(beats.map((b) => b.kind)).toEqual(['discard', 'handLimit'])
  })

  // Two players over the limit in one relayed batch: one grid each, or the
  // second player's cards would fly into the first player's grid.
  it('closes the run when a second player pays the same price', () => {
    const beats = planBeats(
      [
        discarded(4, { reason: 'handLimit' }),
        discarded(5, { player: 'p2', card: 'attack-bug', reason: 'handLimit' }),
      ],
      boardBefore(),
    )
    expect(beats.map((b) => b.kind)).toEqual(['handLimit', 'handLimit'])
    expect(beats[1].kind === 'handLimit' && beats[1].player).toBe('p2')
  })

  // Bad Vibe-Coding raises the same pending mid-turn with `endsTurn: false`
  // (packages/engine/src/fake/triggers.ts) — one card, no turn boundary behind
  // it, and the identical beat.
  it('plans the mid-turn single-card case exactly the same way', () => {
    const beats = planBeats([discarded(9, { reason: 'handLimit' })], boardBefore())
    expect(beats.map((b) => b.kind)).toEqual(['handLimit'])
    expect(beats[0].kind === 'handLimit' && beats[0].cards).toHaveLength(1)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @release/web test src/features/board-beats/planBeats.test.ts`
Expected: FAIL — the four new tests report `expected 'discard' to be 'handLimit'` (and the two-player one yields a single beat).

- [ ] **Step 3: Add the plan kind**

In `apps/frontend/src/features/board-beats/planBeats.ts`, add to the `BeatPlan` union, directly after the `{ kind: 'discard'; … }` member:

```ts
  // The excess a turn's end (or a Bad Vibe-Coding) costs, leaving as ONE
  // gesture: a grid at the centre, sized upfront from the count, held open for
  // the table to read and only then sent to the heap. Its own kind rather than
  // a flag on `discard`, because on the ACTOR's own board these cards are
  // already standing in that grid — the page put them there card by card — and
  // the runner needs the page's handoff to find them.
  //
  // `player` is carried because the runner asks whether the grid is ours before
  // it decides to adopt one; a relayed batch can carry two players' discards.
  | { kind: 'handLimit'; key: string; player: string; cards: DiscardCard[] }
```

Declare the run local beside the other coalesced discard runs (after `let pairOut: … = null` and before the elimination locals):

```ts
  // The hand limit's own run — coalesced per PLAYER: two seats can pay the
  // price in one relayed batch, and each pays it into a grid of its own.
  let handLimit: Extract<BeatPlan, { kind: 'handLimit' }> | null = null
```

Push and clear it in `flush()`, but keep PR #126's elimination beat last. Insert the push immediately before the existing `// LAST:` comment and its `if (elimination)`:

```ts
    if (handLimit) plans.push(handLimit)
    // LAST: everything this run flew has to be off the table before the video
    // covers it.
    if (elimination) plans.push(elimination)
```

Reset it immediately before `elimination = null`:

```ts
    sweeping = null
    handLimit = null
    elimination = null
```

- [ ] **Step 4: Route the reason into it**

In the `if (e.type === 'discarded')` branch, immediately after the `if (e.reason === 'releaseCost') continue` line and before `const p = openAttack`, insert:

```ts
      // The hand limit's own gesture, claimed ahead of everything below: it is
      // never part of an exchange (no pending is open when a turn ends) and
      // never an ordinary discard. A run belongs to ONE player, so a second
      // seat's excess in the same batch closes the first's.
      if (e.reason === 'handLimit') {
        const source = sourceOf(e, before, claimed)
        // Not found anywhere the board can see: nothing is invented, and the
        // projection still puts the card in the heap. Same rule as below.
        if (!source) continue
        if (handLimit && handLimit.player !== e.player) flush()
        if (!handLimit) flush()
        handLimit ??= { kind: 'handLimit', key: `handLimit:${e.id}`, player: e.player, cards: [] }
        handLimit.cards.push({ key: `d${e.id}`, eventId: e.id, card: e.card, source })
        continue
      }
```

- [ ] **Step 5: Stop the four existing tests using `handLimit` as a stand-in**

These tests are about the *generic* run, the release's cost, and the sweep's flag; they used `handLimit` only as "some reason". Change each to an ordinary reason so it keeps testing what it names, except the release one, whose own comment says a hand-limit discard keeps its own beat — there, update the expectation instead.

In `planBeats.test.ts`:

1. `it('puts every discard of one batch in a single beat', …)` (~line 90) — change both events to `reason: 'effect'`:

```ts
    const events = [
      discarded(4, { reason: 'effect' }),
      discarded(5, { card: 'protection-debugger', reason: 'effect' }),
    ]
```

2. `it('does not claim an unrelated discard sitting before a release', …)` (~line 423) — keep the event as it is and update the expectation, which is what its own comment already promises:

```ts
    expect(plans.map((p) => p.kind)).toEqual(['handLimit', 'releasePlaced'])
```

3. `it('leaves an ordinary discard ungathered', …)` (~line 944) — an ordinary discard is not a hand-limit one:

```ts
    const plans = planBeats([discarded(21, { reason: 'effect' })], boardBefore())
```

4. `it('does not gather a later, unrelated discard after the sweep has closed', …)` (~line 959) — the trailing event must stay an ordinary discard, or it stops being one of the two `discard` plans the test asserts on:

```ts
        discarded(23, { card: 'protection-debugger', reason: 'effect' }),
```

- [ ] **Step 6: Run the whole plan suite**

Run: `pnpm --filter @release/web test src/features/board-beats/planBeats.test.ts`
Expected: PASS, including the four new tests and the four edited ones.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/features/board-beats/planBeats.ts apps/frontend/src/features/board-beats/planBeats.test.ts
git commit -m "feat(web): the excess leaves as its own gesture, not as an ordinary discard (#104)"
```

---

### Task 4: The beat — hold the grid, then send it out

The runner. Two ways into the grid — adopt the one the player built, or build it from the actor's seat — and one tail either way.

**Files:**
- Create: `apps/frontend/src/features/board-beats/handLimitBeat.tsx`
- Create: `apps/frontend/src/features/board-beats/handLimitBeat.test.tsx`
- Modify: `apps/frontend/src/entities/game/board/poses.ts` (add `CLEAR_STEP`)
- Modify: `apps/frontend/src/entities/game/board/types.ts` (add `HandLimitHandoff`)
- Modify: `apps/frontend/src/entities/game/board/index.ts` (export both)

**Interfaces:**
- Consumes: `gridCells` / `GRID_TOP` from `@release/ui` (Task 1), `withoutFlown` (Task 2), the `handLimit` plan (Task 3), `GATHER_HOLD` from `~/entities/game/board` (already there, added by #102).
- Produces: `useHandLimitBeat(anchors, handoff?) → { overlay, run, reset }`, `HandLimitHandoff`, `CLEAR_STEP = 90`. Task 5 registers the runner; Task 7 fills the handoff.

- [ ] **Step 1: Add the two shared facts**

In `apps/frontend/src/entities/game/board/poses.ts`, after the existing `GATHER_HOLD`:

```ts
/** the finished grid leaves card by card — this is the step between them */
export const CLEAR_STEP = 90
```

In `apps/frontend/src/entities/game/board/types.ts`, directly after the `StagedHandoff` interface:

```ts
/**
 * The hand limit's own handoff (#104). The local player builds the grid at the
 * centre themselves, card by card, long before the engine's `discarded` events
 * come back — so the beat that takes those cards to the heap must fly the cells
 * that are already standing rather than a hand the cards left minutes ago.
 *
 * A ref, read once at run start, for the same reason `StagedHandoff` is one. It
 * lives here because the page produces it and a feature consumes it.
 *
 * `release()` does NOT end the gesture: it drops the grid's own render, in the
 * same commit the exit's carriers go up. The picked cards stay hidden from the
 * fan until the pending itself clears — the same split `_useNeutralizeStaging`
 * keeps, and for the same reason (the board is still rendering the beat's
 * shadow, whose hand still holds them).
 */
export interface HandLimitHandoff {
  player: string
  cards: { uid: string; card: CardData; slot: number }[]
  cellAt: (slot: number) => HTMLElement | null
  release: () => void
}
```

In `apps/frontend/src/entities/game/board/index.ts`, extend the two export lines:

```ts
export { ATTACK_POSE, CLEAR_STEP, COVER_POSE, GATHER_HOLD, MERGE_MS, SHOW_HOLD, SUDO_POSE } from './poses'
```

and add `HandLimitHandoff` to the type export block (alphabetically, after `BoardState`):

```ts
  HandLimitHandoff,
```

- [ ] **Step 2: Write the failing test**

Create `apps/frontend/src/features/board-beats/handLimitBeat.test.tsx`:

```tsx
import { cardById } from '@release/ui'
import type { Leaving, Rect } from '@release/ui/animations'
import { scatterAt } from '@release/ui/animations'
import { act, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type {
  BeatRun,
  BoardAnchors,
  BoardState,
  HandLimitHandoff,
} from '~/entities/game/board'
import { useHandLimitBeat } from './handLimitBeat'
import type { BeatPlan } from './planBeats'

// Same stubbing idiom as `discardBeat.test.tsx`: `useFlyer` stays real with its
// `raise` recorded (that is what says whether cards were flown INTO the grid),
// and `useDiscardExit` is replaced at the leaf — its own `send` reaches `play`
// through a sibling import the barrel mock never sees.
const raises = vi.hoisted(() => ({ keys: [] as string[] }))
const exits = vi.hoisted(() => ({ items: [] as Leaving[] }))
const order = vi.hoisted(() => ({ calls: [] as string[] }))
const resets = vi.hoisted(() => ({ flyer: 0, exit: 0 }))
vi.mock('@release/ui/animations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@release/ui/animations')>()
  return {
    ...real,
    useFlyer: (...args: Parameters<typeof real.useFlyer>) => {
      const flyer = real.useFlyer(...args)
      return {
        ...flyer,
        raise: (items: Parameters<typeof flyer.raise>[0]) => {
          raises.keys.push(...items.map((i) => i.key))
          return flyer.raise(items)
        },
        drop: (key?: string) => {
          if (key == null) resets.flyer += 1
          flyer.drop(key)
        },
      }
    },
    useDiscardExit: () => ({
      overlay: [],
      send: (items: Leaving[]) => {
        order.calls.push('send')
        exits.items.push(...items)
        return Promise.resolve()
      },
      reset: () => {
        resets.exit += 1
      },
      FLIGHT_MS: 420,
    }),
  }
})

const node = () => document.createElement('div')

const base = {
  you: {
    name: 'You',
    hand: [
      { uid: 'u1', card: cardById('attack-bug') },
      { uid: 'u2', card: cardById('protection-debugger') },
    ],
    release: {},
  },
  opponents: [{ id: 'p2', name: 'Two', handCount: 3, release: {} }],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
} as unknown as BoardState

const plan = (player = 'p1'): Extract<BeatPlan, { kind: 'handLimit' }> => ({
  kind: 'handLimit',
  key: 'handLimit:4',
  player,
  cards: [
    { key: 'd4', eventId: 4, card: 'attack-bug', source: { kind: 'hand', index: 0 } },
    {
      key: 'd5',
      eventId: 5,
      card: 'protection-debugger',
      source: { kind: 'hand', index: 1 },
    },
  ],
})

// `defenseBeat.test.tsx`'s own driver: a runner spanning real `wait()` delays
// needs its timers advanced while React commits in between.
async function drive(run: () => Promise<void> | undefined) {
  vi.useFakeTimers()
  try {
    let done = false
    const finished = Promise.resolve(run()).then(() => {
      done = true
    })
    while (!done) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20)
      })
    }
    await finished
  } finally {
    vi.useRealTimers()
  }
}

function harness(
  handoff?: HandLimitHandoff | null,
  overrides: Partial<BoardAnchors> = {},
) {
  const anchors = {
    bg: { current: node() },
    centre: { current: node() },
    hand: { current: node() },
    discardBox: { current: node() },
    handSlotAt: () => node(),
    releaseSlot: () => node(),
    seatBox: () => ({ left: 0, top: 0, width: 150, height: 210 }) as Rect,
    ...overrides,
  } as unknown as BoardAnchors
  const ref = { current: handoff ?? null }
  const api: { beat?: ReturnType<typeof useHandLimitBeat> } = {}
  function Probe() {
    api.beat = useHandLimitBeat(anchors, ref)
    return <>{api.beat.overlay}</>
  }
  return { api, Probe }
}

// The grid the local player built is standing: the beat must fly THOSE cells
// out and never raise a carrier to put a second copy of the card into them.
it('adopts the grid the actor already filled', async () => {
  raises.keys.length = 0
  exits.items.length = 0
  order.calls.length = 0
  const cells = [node(), node()]
  const handoff: HandLimitHandoff = {
    player: 'p1',
    // biome-ignore lint/style/noNonNullAssertion: known catalogue entries
    cards: [
      { uid: 'u1', card: cardById('attack-bug')!, slot: 0 },
      { uid: 'u2', card: cardById('protection-debugger')!, slot: 1 },
    ],
    cellAt: (slot: number) => cells[slot] ?? null,
    release: vi.fn(() => order.calls.push('release')),
  }
  const { api, Probe } = harness(handoff)
  render(<Probe />)
  await drive(() => api.beat?.run(plan(), { base, publish: () => {} }))
  expect(raises.keys).toEqual([])
  expect(handoff.release).toHaveBeenCalledTimes(1)
  // each card leaves on its own event's scatter (I7), staggered by its slot
  expect(exits.items.map((i) => i.scatter)).toEqual([scatterAt(4), scatterAt(5)])
  expect(exits.items.map((i) => i.delay)).toEqual([0, 90])
  expect(exits.items.map((i) => i.layer)).toEqual([0, 1])
  // release and send are one handover: the static grid comes down immediately
  // before the exit carriers go up, with no awaited gap between them.
  expect(order.calls).toEqual(['release', 'send'])
})

// Everyone else has no grid: the beat builds one and flies the cards in from
// the actor's seat before the same hold and the same exit.
it('builds the grid itself for a discard that is not ours', async () => {
  raises.keys.length = 0
  exits.items.length = 0
  const { api, Probe } = harness(null)
  render(<Probe />)
  await drive(() => api.beat?.run(plan('p2'), { base, publish: () => {} }))
  expect(raises.keys).toHaveLength(2)
  expect(exits.items).toHaveLength(2)
})

// The shadow the beat publishes: the cards are gone from where they stood, and
// the heap is left to the projection that already holds them.
it('publishes the cards out of the hand and leaves the heap alone', async () => {
  raises.keys.length = 0
  exits.items.length = 0
  const published: BoardState[] = []
  const ctx: BeatRun = { base, publish: (s) => published.push(s) }
  const { api, Probe } = harness(null)
  render(<Probe />)
  await drive(() => api.beat?.run(plan(), ctx))
  expect(published).toHaveLength(1)
  expect(published[0].you.hand).toHaveLength(0)
  expect(published[0].decks.discardCount).toBe(base.decks.discardCount)
})

it('drops a card whose source rect is missing and leaves state to the projection', async () => {
  raises.keys.length = 0
  exits.items.length = 0
  const { api, Probe } = harness(null, { handSlotAt: () => null })
  render(<Probe />)
  await drive(() => api.beat?.run(plan(), { base, publish: () => {} }))
  expect(raises.keys).toEqual([])
  expect(exits.items).toEqual([])
})

it('resets both the grid carriers and the discard-exit carriers', () => {
  resets.flyer = 0
  resets.exit = 0
  const { api, Probe } = harness(null)
  render(<Probe />)
  act(() => api.beat?.reset())
  expect(resets.flyer).toBe(1)
  expect(resets.exit).toBe(1)
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @release/web test src/features/board-beats/handLimitBeat.test.tsx`
Expected: FAIL — `Failed to resolve import "./handLimitBeat"`.

- [ ] **Step 4: Write the runner**

Create `apps/frontend/src/features/board-beats/handLimitBeat.tsx`:

```tsx
import { cardById, GRID_TOP, gridCells } from '@release/ui'
import type { Leaving, Rect } from '@release/ui/animations'
import { nextFrames, play, scatterAt, useDiscardExit, useFlyer, wait } from '@release/ui/animations'
import { type RefObject, useCallback, useRef } from 'react'
import type {
  BeatRun,
  BoardAnchors,
  BoardState,
  HandLimitHandoff,
} from '~/entities/game/board'
import { CLEAR_STEP, GATHER_HOLD } from '~/entities/game/board'
import type { BeatPlan, DiscardCard } from './planBeats'
import { withoutFlown } from './withoutFlown'

// THE HAND LIMIT'S OWN EXIT (#104). The excess does not trickle into the heap
// one card at a time: it stands in a grid at the centre — sized upfront from
// the count, so every card goes straight to its own cell — the grid is held
// open long enough for the table to read what the turn cost, and only then does
// the whole of it leave, card by card but as one movement.
//
// Two ways in, one way out:
//   • ADOPT — the actor is us. The grid is already standing: the page's own
//     gesture (`_useHandLimit.tsx`) built it card by card while the player was
//     deciding, long before these events came back off the wire. Nothing flies
//     in, and a carrier here would put a second copy of every card on screen.
//   • BUILD — every other peer, and ourselves with no handoff (a rejoin). The
//     cells are computed rather than rendered: a gathered card needs no DOM cell
//     of its own, it flies to a box and stands there as a carrier — the same
//     thing #102's sweep does with its heap.
//
// The tail is shared, and so is `GATHER_HOLD` itself: the hold here IS the
// no-defence sweep's hold, one value with two readers rather than two tunings.

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

// The grid's cells in viewport coordinates. `gridCells` gives offsets from the
// grid's own point; the point itself is `GRID_TOP` of the table, measured off
// the ambience layer, which is `inset: 0` of the table (I6 — these are card
// boxes, never a tilted node's bounding rect).
function cellBoxes(n: number, table: Rect): Rect[] {
  const cx = table.left + table.width / 2
  const cy = table.top + (table.height * GRID_TOP) / 100
  return gridCells(n).map((c) => ({
    left: cx + c.dx - c.w / 2,
    top: cy + c.dy - c.h / 2,
    width: c.w,
    height: c.h,
  }))
}

export function useHandLimitBeat(
  anchors: BoardAnchors,
  handoff?: RefObject<HandLimitHandoff | null>,
) {
  const { overlay: exitOverlay, send, reset: resetExit } = useDiscardExit(anchors.discardBox)
  const flyer = useFlyer()
  const latest = useRef({ anchors, send, handoff })
  latest.current = { anchors, send, handoff }

  // where a card that has to be FLOWN in starts from — the same three sources
  // `discardBeat` knows, for the same reason it knows them
  const whereFrom = useCallback((c: DiscardCard): Rect | null => {
    const a = latest.current.anchors
    if (c.source.kind === 'hand') return rectOf(a.handSlotAt(c.source.index))
    if (c.source.kind === 'release') return rectOf(a.releaseSlot(c.source.player, c.source.slot))
    return a.seatBox(c.source.player)
  }, [])

  const run = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'handLimit' }>, ctx: BeatRun) => {
      // WAIT FOR THE SHADOW, THEN MEASURE — the queue starts this from inside a
      // layout effect, so at entry React has committed the projection that
      // ARRIVED and the shadow that puts the cards back is a commit away. Two
      // frames is how we get to the other side of it (I1, and the same reason
      // `discardBeat` waits).
      await nextFrames()
      const a = latest.current.anchors
      const held = latest.current.handoff?.current
      // Adopt only a grid that is REALLY ours and really complete: the same
      // player, and a cell for every card the engine banked. Anything else
      // falls through to the honest path — a flight from where the board can
      // actually see the card.
      const mine = plan.player === ctx.base.selfId
      const spare = held && mine && held.player === plan.player ? [...held.cards] : null

      // TAKEOFF: the cards are gone from wherever they stood — publish before
      // the movement, or the board shows each card twice for its whole flight.
      // The discard end stays `ctx.base`'s own (see `withoutFlown`).
      ctx.publish(withoutFlown(ctx.base, plan.cards))

      let items: Leaving[] = []

      if (spare) {
        // ADOPT. The grid is standing; each card leaves from the cell it has
        // been sitting in. Matched by card id with a claimed list, the same way
        // `sourceOf` claims a hand slot: two copies of one card are
        // interchangeable to look at, so the first unclaimed one is right.
        for (const c of plan.cards) {
          const at = spare.findIndex((p) => p.card.id === c.card)
          if (at < 0) continue
          const [placed] = spare.splice(at, 1)
          const box = rectOf(held?.cellAt(placed.slot) ?? null)
          if (!box) continue
          items.push({
            key: c.key,
            card: placed.card,
            from: box,
            layer: placed.slot,
            delay: placed.slot * CLEAR_STEP,
            scatter: scatterAt(c.eventId),
          })
        }
      } else {
        // BUILD. Cells are computed, not rendered — a gathered card stands on
        // its own carrier until the exit takes over.
        const table = rectOf(a.bg.current)
        const boxes = table ? cellBoxes(plan.cards.length, table) : []
        const flying: { key: string; card: DiscardCard; from: Rect; box: Rect }[] = []
        for (let i = 0; i < plan.cards.length; i++) {
          const from = whereFrom(plan.cards[i])
          const box = boxes[i]
          if (!from || !box) continue
          flying.push({ key: `hl${plan.cards[i].eventId}`, card: plan.cards[i], from, box })
        }
        if (flying.length > 0) {
          // I10 — every carrier mounts on its OWN rect, and they travel at once:
          // the grid fills as one gesture, not as a queue of arrivals.
          await flyer.raise(
            flying.map((f, i) => {
              const card = cardById(f.card.card)
              return { key: f.key, at: f.from, layer: i, ...(card ? { card } : {}) }
            }),
          )
          await Promise.all(
            flying.map(async (f) => {
              const el = flyer.elOf(f.key)
              if (el) await play('playToCenter', el, { from: f.from, to: f.box })?.finished
              // I4 — it IS at the cell now; pin it, or the next render puts the
              // carrier back where it was raised
              flyer.pin(f.key, f.box)
            }),
          )
        }
        items = flying.map((f) => {
          const card = cardById(f.card.card)
          const slot = plan.cards.indexOf(f.card)
          return {
            key: f.card.key,
            // a card the catalogue does not know cannot be flown at all, and
            // `flying` only ever holds ones it does
            card: card as NonNullable<ReturnType<typeof cardById>>,
            from: f.box,
            layer: slot,
            delay: slot * CLEAR_STEP,
            scatter: scatterAt(f.card.eventId),
          }
        })
      }

      if (items.length === 0) return

      // HELD OPEN — the same beat the no-defence sweep holds for, and the same
      // value: the table has to be able to read what the turn cost before any
      // of it moves.
      await wait(GATHER_HOLD)

      // Hand the grid back immediately ahead of the exit, never before the hold
      // (`defenseBeat`'s own ordering, and the bug it was written for): the
      // exit mounts its own carriers at these very boxes, so the page's render
      // and the flight swap inside one commit. `release()` drops the grid's
      // render only — the picked cards stay out of the fan until the pending
      // itself clears.
      if (spare) held?.release()
      flyer.drop()
      await latest.current.send(items)
    },
    [whereFrom, flyer.raise, flyer.elOf, flyer.pin, flyer.drop],
  )

  // A new match cancels what is in the air: both the exit step's flights and
  // this runner's own carriers belong here, not to the queue, and a card left
  // mid-flight would keep crossing the board of a match that no longer exists.
  const reset = useCallback(() => {
    resetExit()
    flyer.drop()
  }, [resetExit, flyer.drop])

  return { overlay: [...exitOverlay, ...flyer.overlay], run, reset }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @release/web test src/features/board-beats/handLimitBeat.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/features/board-beats/handLimitBeat.tsx apps/frontend/src/features/board-beats/handLimitBeat.test.tsx apps/frontend/src/entities/game/board/poses.ts apps/frontend/src/entities/game/board/types.ts apps/frontend/src/entities/game/board/index.ts
git commit -m "feat(web): the grid holds, then goes to the heap as one movement (#104)"
```

---

### Task 5: The queue runs it

**Files:**
- Modify: `apps/frontend/src/features/board-beats/useBeats.ts`
- Modify: `apps/frontend/src/features/board-beats/index.ts`
- Modify: `apps/frontend/src/features/board-beats/useBeats.test.tsx`

**Interfaces:**
- Consumes: `useHandLimitBeat` (Task 4), the `handLimit` plan (Task 3).
- Produces: `useBeats({ …, handLimit?: RefObject<HandLimitHandoff | null> })`. Task 7 passes the ref.

- [ ] **Step 1: Write the failing test**

In `apps/frontend/src/features/board-beats/useBeats.test.tsx`, add a test that a hand-limit batch reaches the queue and drains. The runner's build path needs the table box, so give this test its own anchors object rather than changing the shared stub:

```tsx
// The new kind is registered: a hand-limit batch produces a beat, the queue
// runs it, and the board is not left holding a shadow afterwards (#104).
it('runs a hand-limit discard and drains', async () => {
  motion.reduced = false
  sent.calls = []
  sent.hang = true
  const anchors = { ...stub, bg: { current: node() } } as BoardAnchors
  const event = {
    id: 4,
    type: 'discarded',
    player: 'p1',
    card: 'attack-bug',
    reason: 'handLimit',
  } as Event
  const utils = render(<Probe live={preDiscard} events={[]} anchors={anchors} />)
  utils.rerender(<Probe live={afterDiscard} events={[event]} anchors={anchors} />)

  // nextFrames + GATHER_HOLD (1500): by this point the registered runner has
  // built the grid and reached useDiscardExit, where the mock parks it.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1700))
  })
  expect(sent.calls).toHaveLength(1)

  // Let the exit land. The queue must drain back to the arrived projection.
  sent.hang = false
  await act(async () => {
    sent.release?.()
    await new Promise((r) => setTimeout(r, 80))
  })
  expect(utils.getByTestId('discardCount').textContent).toBe('1')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @release/web test src/features/board-beats/useBeats.test.tsx`
Expected: FAIL — `planBeats` produces the new plan, but `beatOf` has no `handLimit` branch, so the queue drops it (or TypeScript reports the unregistered kind).

- [ ] **Step 3: Register the runner**

In `apps/frontend/src/features/board-beats/useBeats.ts`:

Add the import beside the other runners:

```ts
import { useHandLimitBeat } from './handLimitBeat'
```

Add the option to the args type, after `staging`:

```ts
  // The hand limit's own handoff (#104): the grid the local player filled by
  // hand, read once at the start of a `handLimit` beat so the runner flies the
  // cells that are standing instead of a fan the cards left long ago.
  handLimit?: RefObject<HandLimitHandoff | null>
```

Destructure it (`const { live, events, anchors, enabled, intro, staging, clearPaidCost, takeStagedRelease, handLimit } = args`), import the type from `~/entities/game/board`, and instantiate the runner beside the others:

```ts
  const handLimits = useHandLimitBeat(anchors, handLimit)
```

Add the branch in `beatOf`, after the `discard` branch:

```ts
      if (plan.kind === 'handLimit') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: false,
          run: (ctx) => handLimits.run(plan, ctx),
        }
      }
```

`alarm: false` is required by the fresh-main `Beat` contract. Add `handLimits.run` to `beatOf`'s dependency array, `...handLimits.overlay` to the returned `overlays`, and `handLimits.reset()` to the match-boundary effect beside `discards.reset()`.

Do not replace or reorder PR #126's elimination wiring while touching these three lists: preserve `const elimination = useEliminateBeat()`, `elimination.run` in the dependency array, `elimination.reset()` at the match boundary, and `...elimination.overlay` in the returned overlays.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @release/web test src/features/board-beats && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/board-beats/useBeats.ts apps/frontend/src/features/board-beats/useBeats.test.tsx apps/frontend/src/features/board-beats/index.ts
git commit -m "feat(web): the queue knows the hand limit's beat (#104)"
```

---

### Task 6: The fan becomes the picker

The gesture, and the board wiring that makes it reachable. After this task a player over the limit pulls cards out of the fan into the grid and the engine gets one `RESOLVE`.

**Files:**
- Create: `apps/frontend/src/pages/board/[gameId]/_useHandLimit.tsx`
- Create: `apps/frontend/src/pages/board/[gameId]/__tests__/boardHandLimit.test.tsx`
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx`
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.module.css`
- Modify: `apps/frontend/src/entities/game/board/types.ts` (`askHandLimit` on `BoardChromeCopy`)
- Modify: `packages/translation/src/locales/en/common.json` and `.../ru/common.json`

**Interfaces:**
- Consumes: `gridCells`, `GRID_TOP` (Task 1); `useReducedMotion`; `useFlyer`, `useHandArrival`, `play` from `@release/ui/animations`.
- Produces: `useHandLimit(options) → HandLimitStaging` with fields `cells`, `placed`, `picked`, `handed`, `dispatched`, `overlay`, `handItems`, `stateAt`, `accentAt`, `onHandPlay`, `bindCell`, `cellAt`, `release`, `owed`. Tasks 7 and 8 extend and consume it.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/pages/board/[gameId]/__tests__/boardHandLimit.test.tsx`:

```tsx
// The hand limit on the board (#104): while the engine owes us the decision,
// the fan is the picker. A pull takes a cell in the grid; at the limit the fan
// refuses the drop and the kit glides the card home; the last card dispatches
// one RESOLVE carrying every uid.
//
// Reduced motion defaults ON here: most assertions are about what the board
// DID rather than about elapsed animation. The concurrency test turns it off
// and parks both carriers before landing, so the promise that one flight never
// blocks the next pull is tested directly.
import type { Event } from '@release/engine'
import type { CardData, TableActions } from '@release/ui'
import { cardById } from '@release/ui'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

const motion = vi.hoisted(() => ({ reduced: true }))
const flights = vi.hoisted(() => ({ release: [] as (() => void)[] }))

vi.mock('~/shared/lib/useReducedMotion', () => ({ useReducedMotion: () => motion.reduced }))
vi.mock('@release/ui/animations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@release/ui/animations')>()
  return {
    ...actual,
    useFlyer: () => ({
      overlay: [],
      raise: () =>
        new Promise<HTMLDivElement[]>((resolve) => {
          flights.release.push(() => resolve([document.createElement('div')]))
        }),
      elOf: () => null,
      pin: () => {},
      glide: () => Promise.resolve(),
      patch: () => {},
      drop: () => {},
    }),
  }
})

// biome-ignore lint/style/noNonNullAssertion: known catalogue entries
const bug = cardById('attack-bug')!
// biome-ignore lint/style/noNonNullAssertion: known catalogue entries
const debugger_ = cardById('protection-debugger')!
// biome-ignore lint/style/noNonNullAssertion: known catalogue entries
const hotfix = cardById('defense-hotfix')!

const HAND: { uid: string; card: CardData }[] = [
  { uid: 'attack-bug#0', card: bug },
  { uid: 'protection-debugger#0', card: debugger_ },
  { uid: 'defense-hotfix#0', card: hotfix },
]

function boardOverLimit(
  excess: number,
  actions: TableActions = {},
  events: Event[] = [],
  pending = true,
) {
  const base = makeBoardProps()
  return (
    <Board
      {...makeBoardProps({
        state: {
          ...base.state,
          you: { ...base.state.you, hand: HAND },
          turn: base.state.selfId,
          hasDrawn: true,
          pending: pending
            ? {
                kind: 'handLimit',
                player: base.state.selfId,
                excess,
                options: HAND.map((c) => c.uid),
              }
            : null,
        },
        actions,
        intro:
          events.length > 0
            ? { gameId: null, view: null, events, onDone: () => {} }
            : undefined,
      })}
    />
  )
}

// The same drag the kit's own contract expects: down on the slot, past Hand's
// 6px threshold, released well outside the hand's band.
async function pullCardFromFan(index: number) {
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 600))
  })
}

const fanSlots = () => document.querySelectorAll('[data-hand-slot]').length
const filledCells = () => document.querySelectorAll('[data-grid-card]').length

function rejectedHandLimit(cards: string[]): Event {
  return {
    id: 9,
    type: 'rejected',
    action: {
      type: 'RESOLVE',
      player: 'you',
      choice: { kind: 'handLimit', cards },
      at: 0,
    },
    reason: 'illegal',
  }
}

it('a pull under the limit takes a cell in the grid', async () => {
  render(boardOverLimit(2))
  await pullCardFromFan(0)
  expect(screen.getByTestId('board-discard-grid')).toBeTruthy()
  // the grid was sized for the WHOLE excess before the first card moved
  expect(document.querySelectorAll('[data-grid-cell]')).toHaveLength(2)
  expect(filledCells()).toBe(1)
  expect(fanSlots()).toBe(HAND.length - 1)
})

it('refuses the drop once the limit is met and the fan keeps the card', async () => {
  render(boardOverLimit(1))
  await pullCardFromFan(0)
  expect(fanSlots()).toBe(HAND.length - 1)
  // one card was owed and one is placed: this pull is refused, and the kit
  // settles the card back into its own slot (Hand.tsx's own glide)
  await pullCardFromFan(0)
  expect(fanSlots()).toBe(HAND.length - 1)
  expect(filledCells()).toBe(1)
})

it('dispatches one RESOLVE with exactly the excess when the last cell fills', async () => {
  const onResolve = vi.fn()
  render(boardOverLimit(2, { onResolve }))
  await pullCardFromFan(0)
  expect(onResolve).not.toHaveBeenCalled()
  await pullCardFromFan(0)
  expect(onResolve).toHaveBeenCalledTimes(1)
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'handLimit',
    cards: ['attack-bug#0', 'protection-debugger#0'],
  })
})

it('accepts another pull while the previous card is still in flight', async () => {
  motion.reduced = false
  flights.release = []
  const onResolve = vi.fn()
  render(boardOverLimit(2, { onResolve }))

  await pullCardFromFan(0)
  expect(flights.release).toHaveLength(1)
  await pullCardFromFan(0)

  // Both cards left the fan even though neither carrier has landed. A
  // single-flight guard would leave one card behind and one pending resolver.
  expect(flights.release).toHaveLength(2)
  expect(fanSlots()).toBe(HAND.length - 2)
  expect(onResolve).not.toHaveBeenCalled()

  await act(async () => {
    for (const land of flights.release.splice(0)) land()
    await new Promise((r) => setTimeout(r, 80))
  })
  expect(onResolve).toHaveBeenCalledTimes(1)
  motion.reduced = true
})

it('unlocks and returns the cards when the engine rejects the RESOLVE', async () => {
  const onResolve = vi.fn()
  const actions = { onResolve }
  const view = render(boardOverLimit(1, actions))
  await pullCardFromFan(0)
  expect(filledCells()).toBe(1)
  expect(fanSlots()).toBe(HAND.length - 1)

  view.rerender(
    boardOverLimit(1, actions, [rejectedHandLimit(['attack-bug#0'])]),
  )
  await act(async () => {})
  expect(filledCells()).toBe(0)
  expect(fanSlots()).toBe(HAND.length)
})

it('clears the local grid when reduced motion skips the beat', async () => {
  const view = render(boardOverLimit(1))
  await pullCardFromFan(0)
  expect(filledCells()).toBe(1)

  // The accepted projection clears the pending. With reduced motion the queue
  // runs no hand-limit beat, so the hook's own catch-up is the only release.
  view.rerender(boardOverLimit(1, {}, [], false))
  await act(async () => {})
  expect(screen.queryByTestId('board-discard-grid')).toBeNull()
  expect(fanSlots()).toBe(HAND.length)
})

// Bad Vibe-Coding's own case: one card, mid-turn, no turn ending behind it.
it('plays the same gesture for a mid-turn single card', async () => {
  const onResolve = vi.fn()
  render(boardOverLimit(1, { onResolve }))
  await pullCardFromFan(0)
  expect(onResolve).toHaveBeenCalledWith({ kind: 'handLimit', cards: ['attack-bug#0'] })
})

it('asks for the discard in the ask line and offers no panel', async () => {
  render(boardOverLimit(2))
  const copy = makeBoardProps().copy
  const ask = screen.getByTestId('board-ask')
  expect(ask.getAttribute('data-shown')).toBe('true')
  expect(ask.textContent).toBe(copy.table.askHandLimit)
  // the cards on the table are the question — a panel would ask it twice, and
  // would cover the grid it is asking about
  expect(screen.queryByText(copy.pending.handLimit.prompt)).toBeNull()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @release/web "test src/pages/board/[gameId]/__tests__/boardHandLimit.test.tsx"`
Expected: FAIL — no `board-discard-grid`, and the pull is refused by the turn hook.

- [ ] **Step 3: Write the gesture hook**

Create `apps/frontend/src/pages/board/[gameId]/_useHandLimit.tsx`:

```tsx
// DISCARDING DOWN TO THE HAND LIMIT (#104). While the engine owes us a
// `handLimit` decision, the fan is the picker: a card pulled out of it takes a
// cell in the grid at the centre, and when the last cell fills, ONE `RESOLVE`
// carries every uid at once — the engine takes them in a single action or not
// at all (`packages/engine/src/fake/reduce.ts`'s `onHandLimit`). So every pull
// before the last is a purely local fact, which is what makes the grid a
//
// THE RULE THIS HOOK EXISTS FOR: nothing here waits on a flight. Its three
// siblings stage one card at a time (`if (stagedRef.current) return false`);
// discarding is "think, then dump fast", so every pull gets its own carrier and
// the fan stays live for the next one while the last is still in the air. A
// gate here would read as lag, not as safety (docs/animations/README.md —
// "Gating the hand", approach 3).
import type { Event } from '@release/engine'
import type { CardData, HandCardState, HandItem, HandPlayDrop, TableActions } from '@release/ui'
import { play, type Rect, useFlyer, useHandArrival } from '@release/ui/animations'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { BoardAnchors, BoardState } from '~/entities/game/board'
import { useReducedMotion } from '~/shared/lib/useReducedMotion'

/** a card standing in the grid, in its own cell */
export interface GridCard {
  uid: string
  card: CardData
  slot: number
}

export interface HandLimitStaging {
  /** the cells this decision's grid was sized for — 0 until the first pull */
  cells: number
  placed: GridCard[]
  /** claimed uids, landed or still flying — what `handItems` hides */
  picked: string[]
  /** the beat has taken the grid over: stop rendering the cells */
  handed: boolean
  /** the RESOLVE is out — the grid is locked */
  dispatched: boolean
  /** how many cards are still owed; 0 outside the decision */
  owed: number
  overlay: ReactNode[]
  handItems: HandItem[]
  stateAt: (index: number) => HandCardState
  accentAt: (index: number) => string | undefined
  onHandPlay: (uid: string, drop: HandPlayDrop) => boolean
  bindCell: (slot: number, el: HTMLDivElement | null) => void
  cellAt: (slot: number) => HTMLElement | null
  /** the beat's own hand-over — drops the grid's render, keeps the fan filtered */
  release: () => void
}

export interface Options {
  state: BoardState
  anchors: BoardAnchors
  actions?: TableActions
  events: Event[] // the feed — watched for `rejected` after dispatch
  enabled: boolean // false while the deal or an exclusive beat owns the table
  /** the match this gesture belongs to — the same boundary its siblings keep */
  matchKey?: string | null
}

export function useHandLimit({
  state,
  anchors,
  actions,
  events,
  enabled,
  matchKey = null,
}: Options): HandLimitStaging {
  const reduced = useReducedMotion()
  const flyer = useFlyer()
  const [cells, setCells] = useState(0)
  const [placed, setPlaced] = useState<GridCard[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [handed, setHanded] = useState(false)
  const [dispatched, setDispatched] = useState(false)

  // Ours to answer, or nobody's. `options` is the projection's own answer to
  // which cards may go (every uid in the hand, `[]` for everyone else), and
  // nothing here re-derives it.
  const pending =
    state.pending?.kind === 'handLimit' && state.pending.player === state.selfId
      ? state.pending
      : null

  // A flight spans several awaits and must never read a stale render (I8), so
  // everything it needs is mirrored in a ref.
  const cellsRef = useRef(0)
  const pickedRef = useRef<string[]>([])
  const dispatchedRef = useRef(false)
  const claimed = useRef(new Set<number>())
  const landed = useRef(0)
  const cellEls = useRef<Record<number, HTMLElement | null>>({})
  const flightSeq = useRef(0)
  // bumped on a match wipe — a flight from a dead match stops committing
  const runId = useRef(0)
  // how much of the feed had arrived when we dispatched: the rejection watcher
  // reads only what came after, or a past rejection of the same decision would
  // cancel a fresh one
  const watermark = useRef(0)
  const latest = useRef({ actions, events, pending })
  latest.current = { actions, events, pending }
  cellsRef.current = cells
  pickedRef.current = picked
  dispatchedRef.current = dispatched

  const handItems = useMemo(
    () =>
      picked.length === 0
        ? state.you.hand
        : state.you.hand.filter((c) => !picked.includes(c.uid)),
    [state.you.hand, picked],
  )
  const handItemsRef = useRef(handItems)
  handItemsRef.current = handItems

  // the cards return to the fan on a rejection — the shared step, the same one
  // a draw and an undo use, so a refused decision reads as the event it undoes
  const arrival = useHandArrival(anchors.hand, () => {
    pickedRef.current = []
    setPicked([])
  })

  const bindCell = useCallback((slot: number, el: HTMLDivElement | null) => {
    if (el) cellEls.current[slot] = el
    else delete cellEls.current[slot]
  }, [])
  const cellAt = useCallback((slot: number) => cellEls.current[slot] ?? null, [])

  const wipe = useCallback(() => {
    claimed.current.clear()
    landed.current = 0
    cellEls.current = {}
    cellsRef.current = 0
    pickedRef.current = []
    dispatchedRef.current = false
    setCells(0)
    setPlaced([])
    setPicked([])
    setHanded(false)
    setDispatched(false)
  }, [])

  // The last cell filled: the decision is complete and goes out as ONE action.
  // Fired on the LANDING rather than on the drop, so the grid is provably whole
  // when it locks — and so a carry-back can never race the dispatch.
  const finish = useCallback(() => {
    if (dispatchedRef.current) return
    dispatchedRef.current = true
    setDispatched(true)
    watermark.current = latest.current.events.length
    latest.current.actions?.onResolve?.({ kind: 'handLimit', cards: pickedRef.current })
  }, [])

  // one card: the fan → its own cell. I8 — the card, its uid, its slot and its
  // source rect all come in as arguments.
  const flyToCell = useCallback(
    async (uid: string, card: CardData, slot: number, from?: Rect) => {
      const mine = runId.current
      const key = `hl${++flightSeq.current}`
      const commit = () => {
        if (runId.current !== mine) return
        setPlaced((p) => [...p, { uid, card, slot }])
        landed.current += 1
        if (landed.current === cellsRef.current) finish()
      }
      if (reduced || !from) {
        commit()
        return
      }
      // raising also lets the grid's cells mount before they are measured
      const [el] = await flyer.raise([{ key, card, at: from, layer: slot }])
      if (runId.current !== mine) return
      const to = cellEls.current[slot]?.getBoundingClientRect()
      if (el && to) await play('playToCenter', el, { from, to })?.finished
      if (runId.current !== mine) return
      // the real card takes over the cell as the carrier goes — one commit, no
      // gap for the eye to catch
      commit()
      flyer.drop(key)
    },
    [reduced, finish, flyer.raise, flyer.drop],
  )

  // the lowest cell nobody has claimed. A SEARCH, not a running count: a card
  // carried back out frees its own cell, and the next pull must be able to take
  // exactly that one back (Task 8).
  const freeSlot = () => {
    for (let i = 0; i < cellsRef.current; i += 1) if (!claimed.current.has(i)) return i
    return -1
  }

  const onHandPlay = useCallback(
    (uid: string, drop: HandPlayDrop): boolean => {
      const p = latest.current.pending
      if (!enabled || !p || dispatchedRef.current) return false
      if (!p.options.includes(uid)) return false
      // AT THE LIMIT: refused, and the kit glides the card home — the existing
      // settle-back (`Hand.tsx`), not a new animation.
      if (pickedRef.current.length >= p.excess) return false
      const item = state.you.hand.find((c) => c.uid === uid)
      if (!item) return false
      // the first pull fixes the grid: the excess is known before anything moves
      if (cellsRef.current === 0) {
        cellsRef.current = p.excess
        setCells(p.excess)
      }
      const slot = freeSlot()
      if (slot < 0) return false
      claimed.current.add(slot)
      pickedRef.current = [...pickedRef.current, uid]
      setPicked(pickedRef.current)
      void flyToCell(uid, item.card, slot, drop.rect)
      return true
    },
    [enabled, state.you.hand, flyToCell],
  )

  // Lit while cards are still owed, and only on the cards that answer — the
  // same rule every other hook keeps. One uniform hue rather than the
  // per-category accent: this pick COSTS a card, and the colour is the context
  // of the move, not the type of the card.
  const stateAt = useCallback(
    (index: number): HandCardState => {
      if (!enabled || !pending || dispatched) return 'idle'
      if (picked.length >= pending.excess) return 'idle'
      const item = handItems[index]
      if (!item) return 'idle'
      return pending.options.includes(item.uid) ? 'playable' : 'idle'
    },
    [enabled, pending, dispatched, picked.length, handItems],
  )

  const accentAt = useCallback(
    (index: number) => (stateAt(index) === 'playable' ? 'var(--danger-accent)' : undefined),
    [stateAt],
  )

  // Hand the grid to the beat WITHOUT ending the gesture: the board is still
  // rendering the beat's shadow, whose `you.hand` still holds these cards, so
  // clearing `picked` here would pop every one of them back into the fan beside
  // its own copy flying to the heap. Same split, same reason, as
  // `_useNeutralizeStaging`'s own `release`.
  const release = useCallback(() => setHanded(true), [])

  // The engine said no: the grid opens again and the cards go back to the fan.
  // Scoped to what arrived AFTER this dispatch, and matched on our own choice —
  // a rejected RESOLVE carries the whole original action, so the choice is
  // where the identity lives.
  useEffect(() => {
    if (!dispatched) return
    const rejectedOurs = events.slice(watermark.current).some((e) => {
      if (e.type !== 'rejected') return false
      const a = e.action
      return a.type === 'RESOLVE' && a.choice.kind === 'handLimit'
    })
    if (!rejectedOurs) return
    const back = placed
      .map((p) => {
        const box = cellEls.current[p.slot]?.getBoundingClientRect()
        return box ? { key: p.uid, card: p.card, from: box } : null
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
    claimed.current.clear()
    landed.current = 0
    dispatchedRef.current = false
    setDispatched(false)
    setPlaced([])
    setCells(0)
    cellsRef.current = 0
    if (reduced || back.length === 0) {
      pickedRef.current = []
      setPicked([])
      return
    }
    void arrival.arrive(back, handItemsRef.current.length)
  }, [dispatched, events, placed, reduced, arrival.arrive])

  // The pending is gone: the decision is closed and nothing here may outlive
  // it. While a beat runs, the board renders its shadow — which still carries
  // the pending — so this does not fire mid-beat; the beat's `release()` is
  // what drops the grid's render, and this is what finally clears the fan's
  // filter. Under reduced motion no beat ever runs, and this is the only path.
  useEffect(() => {
    if (pending || cellsRef.current === 0) return
    wipe()
  }, [pending, wipe])

  // A NEW MATCH wipes the gesture — the same boundary, idiom and (inert on this
  // branch, until #19 mints a per-match id) reasoning as its three siblings'.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `matchKey` is the boundary and the only dependency this may have — the resets below are plain functions recreated every render, so listing them would wipe the gesture on every render instead of once per match
  useLayoutEffect(() => {
    runId.current += 1
    wipe()
    flyer.drop()
    arrival.reset()
  }, [matchKey])

  return {
    cells,
    placed,
    picked,
    handed,
    dispatched,
    owed: pending ? Math.max(0, pending.excess - picked.length) : 0,
    overlay: [...flyer.overlay, ...arrival.overlay],
    handItems,
    stateAt,
    accentAt,
    onHandPlay,
    bindCell,
    cellAt,
    release,
  }
}
```

- [ ] **Step 4: Add the copy key**

In `apps/frontend/src/entities/game/board/types.ts`, in `BoardChromeCopy` beside `askNeutralize`:

```ts
  // The hand is over the limit and the fan is the picker (#104). Count-free on
  // interpolation to put a number into — and the grid's own empty cells already
  // show how many are owed.
  askHandLimit: string
```

In `packages/translation/src/locales/en/common.json`, in the `table` block beside `askNeutralize`:

```json
    "askHandLimit": "over the hand limit — pull the excess out of the hand",
```

In `packages/translation/src/locales/ru/common.json`, same place:

```json
    "askHandLimit": "перебор карт — вытащите лишние из руки",
```

- [ ] **Step 5: Wire the board**

In `apps/frontend/src/pages/board/[gameId]/_Board.tsx`:

This is a surgical addition to the fresh-main board. Preserve `useEliminationPreload(!deal.active)`, the `beats.running` game-over gate, and the existing elimination overlay path while adding the hand-limit gesture and handoff.

1. Import the hook and the geometry:

```tsx
import { GRID_TOP, gridCells } from '@release/ui'
import { useHandLimit } from './_useHandLimit'
```

2. After the `defenseStaging` construction (~line 340), add the derived constant and the hook:

```tsx
  // the hand limit owed to US means this hook owns the fan (#104) — a third
  // owner beside `answering` and the turn hook, and the three can never
  // overlap: `state.pending` is one slot.
  const discarding =
    state.pending?.kind === 'handLimit' && state.pending.player === state.selfId
  const handLimit = useHandLimit({
    state,
    anchors,
    actions,
    events: intro?.events ?? [],
    enabled: !(deal.active || beats.exclusive),
    matchKey: intro?.gameId ?? null,
  })
```

3. At the `<Hand>` call site (~line 1259), make each hook-picking prop three-way. `items`:

```tsx
                items={
                  discarding
                    ? handLimit.handItems
                    : answering
                      ? defenseStaging.handItems
                      : staging.handItems
                }
```

`stateAt` and `accentAt`:

```tsx
                stateAt={
                  discarding
                    ? handLimit.stateAt
                    : answering
                      ? defenseStaging.stateAt
                      : staging.stateAt
                }
                accentAt={
                  discarding
                    ? handLimit.accentAt
                    : answering
                      ? defenseStaging.accentAt
                      : staging.accentAt
                }
```

`onPlay` (~line 1346):

```tsx
                onPlay={
                  deal.active
                    ? undefined
                    : discarding
                      ? handLimit.onHandPlay
                      : answering
                        ? defenseStaging.onHandPlay
                        : staging.onHandPlay
                }
```

`onCardClick` — a click is not a discard (a stray one would cost a real card), so while discarding the fan takes no clicks at all:

```tsx
                onCardClick={
                  deal.active || discarding
                    ? undefined
                    : answering
                      ? (i) => defenseStaging.onCardClick(i)
                      : (i) => {
                          if (staging.onCardClick(i)) return
                          const item = staging.handItems[i]
                          if (item) gestures.onCardClick(item.uid)
                        }
                }
```

`onReorder` — it must read the fan the discard hook actually rendered:

```tsx
                onReorder={
                  deal.active
                    ? undefined
                    : (uid, to) =>
                        handOrder.commit(
                          you.hand,
                          discarding
                            ? handLimit.handItems
                            : answering
                              ? defenseStaging.handItems
                              : staging.handItems,
                          uid,
                          to,
                        )
                }
```

4. Render the grid. Put it directly after the `.centre` block (after the `attack` slot's closing `</div>`, ~line 1100):

```tsx
      {/* THE DISCARD GRID (#104) — the excess a turn's end costs, laid out for
          the whole table to read. The cells are a fixed shape chosen before the
          first card moved, so every card flies straight to its own; an empty
          one shows the shape still being filled. It is dropped the moment the
          beat takes the grid over (`handed`), which is the same commit the
          exit's own carriers go up in. */}
      {handLimit.cells > 0 && !handLimit.handed && (
        <div className={opening.discardGrid} data-testid="board-discard-grid">
          {gridCells(handLimit.cells).map((cell, i) => {
            const held = handLimit.placed.find((p) => p.slot === i)
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the cells are a fixed grid and the index IS the slot
                key={i}
                className={opening.gridCell}
                data-grid-cell={i}
                style={{
                  insetBlockStart: `${GRID_TOP}%`,
                  inlineSize: `${cell.w}px`,
                  transform: `translate(calc(-50% + ${cell.dx}px), calc(-50% + ${cell.dy}px))`,
                }}
                ref={(el) => handLimit.bindCell(i, el)}
              >
                {held ? (
                  <div className={opening.cellCard} data-grid-card>
                    <Card card={held.card} interactive={false} width="100%" />
                  </div>
                ) : (
                  <span className={opening.cellEmpty} />
                )}
              </div>
            )
          })}
        </div>
      )}
```

5. Render the hook's carriers beside the other overlays — find where `staging.overlay` / `defenseStaging.overlay` are rendered and add `{handLimit.overlay}` in the same place.

6. Suppress the panel (~line 1443):

```tsx
      {state.pending?.player === state.selfId &&
        state.pending.kind !== 'discardForRelease' &&
        state.pending.kind !== 'handLimit' &&
        state.pending.kind !== 'defend' && (
```

7. The ask line — extend the `let ask` chain (~line 820), after the `costPending` branch:

```tsx
  } else if (discarding && handLimit.owed > 0) {
    ask = copy.table.askHandLimit
  }
```

- [ ] **Step 6: Add the grid's styles**

In `apps/frontend/src/pages/board/[gameId]/_Board.module.css`, after the centre-slot rules:

```css
/* The hand limit's grid (#104). Only the things every cell shares live here —
   the position of each one is inline, from `gridCells`, because the layout is a
   function of the count and a stylesheet cannot be asked about it (the same
   rule `TableCentre/centre.ts` states for the named places). Above the centre
   slots: while this is up they are empty, and nothing else may sit over it. */
.discardGrid {
  position: absolute;
  inset: 0;
  z-index: 12;
  /* the container is a layer, not a target — only a filled cell answers the
     pointer, and an empty one must not eat a press meant for the table */
  pointer-events: none;
}

.gridCell {
  position: absolute;
  inset-inline-start: 50%;
  aspect-ratio: var(--card-aspect);
}

.cellCard {
  position: relative;
  block-size: 100%;
}

.cellEmpty {
  position: absolute;
  inset: 0;
  border: 1px dashed var(--white-12);
  border-radius: 8px;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @release/web "test src/pages/board/[gameId]/__tests__/boardHandLimit.test.tsx"`
Expected: PASS, 8 tests.

- [ ] **Step 8: Verify nothing else on the board moved**

Run: `pnpm --filter @release/web test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add "apps/frontend/src/pages/board/[gameId]/_useHandLimit.tsx" "apps/frontend/src/pages/board/[gameId]/_Board.tsx" "apps/frontend/src/pages/board/[gameId]/_Board.module.css" "apps/frontend/src/pages/board/[gameId]/__tests__/boardHandLimit.test.tsx" apps/frontend/src/entities/game/board/types.ts packages/translation/src/locales/en/common.json packages/translation/src/locales/ru/common.json
git commit -m "feat(web): the fan pays the hand limit, into a grid at the centre (#104)"
```

---

### Task 7: The beat adopts the grid the player built

The seam between the two halves. Without it, the local actor's own discards would be flown in from a fan they left long ago — a second copy of every card.

**Files:**
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx`
- Modify: `apps/frontend/src/pages/board/[gameId]/__tests__/boardHandLimit.test.tsx`

**Interfaces:**
- Consumes: `HandLimitHandoff` (Task 4), `useBeats({ handLimit })` (Task 5), the hook's `dispatched` / `placed` / `cellAt` / `release` (Task 6).
- Produces: nothing new — this task only connects what exists.

- [ ] **Step 1: Write the failing test**

Append to `boardHandLimit.test.tsx`:

```tsx
// The seam (#104): once the RESOLVE is out, the grid the player filled is what
// the beat flies — so the page must be offering it. Asserted through the board's
// own render rather than the ref: the cells are still standing and still hold
// their cards after the dispatch, which is exactly what the beat measures.
it('keeps the filled grid standing after the dispatch, for the beat to take', async () => {
  render(boardOverLimit(2, { onResolve: vi.fn() }))
  await pullCardFromFan(0)
  await pullCardFromFan(0)
  expect(screen.getByTestId('board-discard-grid')).toBeTruthy()
  expect(filledCells()).toBe(2)
  // and the fan does not get them back while it stands
  expect(fanSlots()).toBe(HAND.length - 2)
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @release/web "test src/pages/board/[gameId]/__tests__/boardHandLimit.test.tsx"`
Expected: PASS already (the grid stands because nothing clears it yet) — this test is the regression guard for the wiring below, which must not change that.

- [ ] **Step 3: Declare the ref and pass it to the queue**

In `_Board.tsx`, beside `handoffRef` (~line 211):

```tsx
  // The hand limit's own handoff (#104), a ref for the same reason `handoffRef`
  // is one: the beat reads it once at run start (I8), not a render's worth of
  // state it would have to wait on.
  const handLimitRef = useRef<HandLimitHandoff | null>(null)
```

Add the import of the type to the existing `~/entities/game/board/types` import, and pass it in the `useBeats({ … })` call (~line 235):

```tsx
    handLimit: handLimitRef,
```

- [ ] **Step 4: Keep the ref current**

After the existing `useLayoutEffect` that maintains `handoffRef` (~line 545-615), add its own effect — separate, because it answers a different question and shares none of that one's branches:

```tsx
  // The grid, offered to the beat exactly while there IS one to take: the
  // RESOLVE is out (so the grid is complete and locked) and the cells are still
  // standing. `release()` is how the beat drops that render; the picked cards
  // stay out of the fan until the pending itself clears.
  useLayoutEffect(() => {
    handLimitRef.current =
      handLimit.dispatched && handLimit.placed.length > 0
        ? {
            player: state.selfId,
            cards: handLimit.placed,
            cellAt: handLimit.cellAt,
            release: handLimit.release,
          }
        : null
  }, [
    handLimit.dispatched,
    handLimit.placed,
    handLimit.cellAt,
    handLimit.release,
    state.selfId,
  ])
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @release/web test && pnpm typecheck`
Expected: PASS, including Task 4's `adopts the grid the actor already filled`.

- [ ] **Step 6: Commit**

```bash
git add "apps/frontend/src/pages/board/[gameId]/_Board.tsx" "apps/frontend/src/pages/board/[gameId]/__tests__/boardHandLimit.test.tsx"
git commit -m "feat(web): the beat takes the grid the player filled, not the fan they left (#104)"
```

---

### Task 8: A card can come back out of the grid

The grid is a decision in progress: nothing is dispatched until the last cell fills, so until then any card in it can be carried back into the hand. Without this a misdrop costs a real card with no undo.

**Files:**
- Modify: `apps/frontend/src/pages/board/[gameId]/_useHandLimit.tsx`
- Create: `apps/frontend/src/pages/board/[gameId]/_useHandLimit.module.css`
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx`
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.module.css`
- Modify: `apps/ui/src/index.ts` (export the fan's existing `handStep` arithmetic)
- Create: `apps/frontend/src/pages/board/[gameId]/__tests__/boardHandLimitBack.test.tsx`

**Interfaces:**
- Consumes: everything from Task 6.
- Produces: on `HandLimitStaging` — `carrying: boolean`, `gapAt: number | null`, `gapSize: number`, `onCellDown(e, card)`, `backOverlay` folded into `overlay`; on `Options` — `onReturned?: (uid: string, slot: number) => void`; from `@release/ui` — the existing `handStep(n: number): number` fan geometry helper.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/pages/board/[gameId]/__tests__/boardHandLimitBack.test.tsx`:

```tsx
// Carry-back (#104): the grid is a decision in progress. A card in it can be
// pressed and carried back into the fan — its cell is freed for the next pull,
// and the count still adds up, because the grid was sized for the whole excess.
//
// Reduced motion is mocked ON: the movement is covered by the recipe and the
// story; what this suite pins is the bookkeeping, which must be identical
// either way.
import type { CardData } from '@release/ui'
import { cardById } from '@release/ui'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

vi.mock('~/shared/lib/useReducedMotion', () => ({ useReducedMotion: () => true }))

// biome-ignore lint/style/noNonNullAssertion: known catalogue entries
const bug = cardById('attack-bug')!
// biome-ignore lint/style/noNonNullAssertion: known catalogue entries
const debugger_ = cardById('protection-debugger')!

const HAND: { uid: string; card: CardData }[] = [
  { uid: 'attack-bug#0', card: bug },
  { uid: 'protection-debugger#0', card: debugger_ },
]

function boardOverLimit(excess: number) {
  const base = makeBoardProps()
  return (
    <Board
      {...makeBoardProps({
        state: {
          ...base.state,
          you: { ...base.state.you, hand: HAND },
          turn: base.state.selfId,
          hasDrawn: true,
          pending: {
            kind: 'handLimit',
            player: base.state.selfId,
            excess,
            options: HAND.map((c) => c.uid),
          },
        },
      })}
    />
  )
}

async function pullCardFromFan(index: number) {
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 600))
  })
}

// press the card in its cell, drag it over the fan, release
async function carryBack(slot: number) {
  const cell = document.querySelector<HTMLElement>(`[data-grid-cell="${slot}"] [data-grid-card]`)
  if (!cell) throw new Error('no card in that cell')
  const hand = document.querySelector<HTMLElement>('[class*="handWrap"]')
  const box = hand?.getBoundingClientRect()
  const y = (box?.top ?? 0) + 10
  fireEvent.mouseDown(cell, { clientX: 100, clientY: 100 })
  fireEvent.mouseMove(window, { clientX: 120, clientY: y })
  fireEvent.mouseUp(window, { clientX: 120, clientY: y })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
}

const fanSlots = () => document.querySelectorAll('[data-hand-slot]').length
const filledCells = () => document.querySelectorAll('[data-grid-card]').length

it('a card carried back to the hand leaves the grid and returns to the fan', async () => {
  render(boardOverLimit(2))
  await pullCardFromFan(0)
  expect(filledCells()).toBe(1)
  expect(fanSlots()).toBe(HAND.length - 1)
  await carryBack(0)
  expect(filledCells()).toBe(0)
  expect(fanSlots()).toBe(HAND.length)
  // the grid is still open — it was sized for the whole excess, and the card
  // that came back will have to be given up again
  expect(screen.getByTestId('board-discard-grid')).toBeTruthy()
})

it('frees the cell it left, so the next pull takes that one back', async () => {
  render(boardOverLimit(2))
  await pullCardFromFan(0)
  await carryBack(0)
  await pullCardFromFan(0)
  // cell 0 again — the claimed cells are a SET, not a running count
  expect(document.querySelector('[data-grid-cell="0"] [data-grid-card]')).toBeTruthy()
  expect(filledCells()).toBe(1)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @release/web "test src/pages/board/[gameId]/__tests__/boardHandLimitBack.test.tsx"`
Expected: FAIL — the grid card has no mouse handler yet, so after `carryBack(0)` `filledCells()` stays 1.

- [ ] **Step 3: Add the carry-back to the hook**

In `_useHandLimit.tsx`, add to `Options`:

```ts
  /**
   * A card came back out of the grid and landed in the fan at `slot`. The page
   * commits the player's own order for it (`useHandOrder`) — the card never
   * left `you.hand`, so this is a placement, not an arrival, and the slot the
   * pointer named is the one that must stick.
   */
  onReturned?: (uid: string, slot: number) => void
```

Add to `HandLimitStaging`:

```ts
  /** a card is riding the cursor out of the grid — the fan offers nothing else */
  carrying: boolean
  /** where the fan parts for it, from the pointer; null while it is away */
  gapAt: number | null
  gapSize: number
  /** press on a card standing in the grid: it comes off onto the cursor */
  onCellDown: (e: React.MouseEvent, card: GridCard) => void
```

Add the imports at the top:

```tsx
import type React from 'react'
import { Card, handStep } from '@release/ui'
import styles from './_useHandLimit.module.css'
```

Export the fan's existing arithmetic from `apps/ui/src/index.ts` by changing its current fan export to:

```ts
export { CARD_W, handStep, type SlotPlacement, slotPlacement } from './table/Hand/fan'
```

The board must consume this helper; it must not re-derive the fan's spacing.

Add the state and the drag, after `flyToCell`:

```tsx
  // the card riding the cursor: its cell, its size, and where in it the pointer
  // took hold — so it does not jump to its own corner on pick-up
  const [back, setBack] = useState<
    (GridCard & { w: number; h: number; fracX: number; fracY: number }) | null
  >(null)
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  const backRef = useRef<HTMLDivElement | null>(null)
  const cursor = useRef({ x: 0, y: 0 })
  // the drag's handlers are the closure they began with (I8) — the slot under
  // the pointer changes under them, so they read it through a ref
  const dropSlotRef = useRef<number | null>(null)
  dropSlotRef.current = dropSlot

  // how far above the fan still counts as "over the hand" — the Hand's own band
  const BAND_PAD = 32

  // where the pointer is pointing along the fan, by the fan's own arithmetic:
  // n+1 places for n cards, so a card can go before the first and after the last
  const slotAt = useCallback((clientX: number, n: number) => {
    const hr = anchors.hand.current?.getBoundingClientRect()
    if (!hr) return Math.round(n / 2)
    const step = handStep(n + 1)
    const i = Math.round((clientX - (hr.left + hr.width / 2)) / step + n / 2)
    return Math.max(0, Math.min(n, i))
  }, [anchors.hand])

  const onCellDown = useCallback(
    (e: React.MouseEvent, card: GridCard) => {
      if (back || dispatchedRef.current) return
      const r = e.currentTarget.getBoundingClientRect()
      e.preventDefault()
      cursor.current = { x: e.clientX, y: e.clientY }
      // the cell is free again the instant the card leaves it — a SET, so this
      // very cell is the one the next pull takes back
      claimed.current.delete(card.slot)
      landed.current -= 1
      setPlaced((p) => p.filter((x) => x.slot !== card.slot))
      setBack({
        ...card,
        w: r.width,
        h: r.height,
        fracX: (e.clientX - r.left) / r.width,
        fracY: (e.clientY - r.top) / r.height,
      })
    },
    [back],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: `back` is the trigger; the handlers deliberately use the closure captured when the drag began (I8)
  useEffect(() => {
    if (!back) return
    const place = () => {
      const el = backRef.current
      if (!el) return
      el.style.left = `${cursor.current.x - back.fracX * back.w}px`
      el.style.top = `${cursor.current.y - back.fracY * back.h}px`
    }
    place()
    const onMove = (e: MouseEvent) => {
      cursor.current = { x: e.clientX, y: e.clientY }
      place()
      const hr = anchors.hand.current?.getBoundingClientRect()
      const over = hr ? e.clientY >= hr.top - BAND_PAD : false
      setDropSlot(over ? slotAt(e.clientX, handItemsRef.current.length) : null)
    }
    const onUp = async (e: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const hr = anchors.hand.current?.getBoundingClientRect()
      const rect = backRef.current?.getBoundingClientRect()
      const overHand = hr ? e.clientY >= hr.top - BAND_PAD : false
      const at = dropSlotRef.current ?? slotAt(e.clientX, handItemsRef.current.length)
      setDropSlot(null)
      if (overHand) {
        setBack(null)
        pickedRef.current = pickedRef.current.filter((uid) => uid !== back.uid)
        setPicked(pickedRef.current)
        latest.current.onReturned?.(back.uid, at)
        // into the slot the POINTER named, not the middle of the fan: the hand
        // just said where, and landing anywhere else ignores it
        if (!reduced && rect) {
          void arrival.arrive(
            [{ key: back.uid, card: back.card, from: rect }],
            handItemsRef.current.length,
            at,
          )
        }
        return
      }
      // released anywhere else: the card FLIES HOME to its own cell. Snapping
      // would read as the drag having failed; it simply goes back.
      const el = backRef.current
      const to = cellEls.current[back.slot]?.getBoundingClientRect()
      if (!reduced && el && rect && to) {
        await play('playToCenter', el, { from: rect, to })?.finished
      }
      claimed.current.add(back.slot)
      landed.current += 1
      setPlaced((p) => [...p, { uid: back.uid, card: back.card, slot: back.slot }])
      setBack(null)
      if (landed.current === cellsRef.current) finish()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [back])
```

> `arrival`'s own `onLanded` clears `picked` wholesale (Task 6's rejection path). Change it now that two callers exist, so a carry-back's landing does not wipe the cards still standing in the grid:
>
> ```tsx
>   const arrival = useHandArrival(anchors.hand, (_gap, landedCards) => {
>     const back = new Set(landedCards.map((l) => l.key))
>     pickedRef.current = pickedRef.current.filter((uid) => !back.has(uid))
>     setPicked(pickedRef.current)
>   })
> ```

Render the carried card into the hook's own overlay, and return the new fields:

```tsx
  const backOverlay = back ? (
    <div
      key="hand-limit-back"
      className={styles.backFlyer}
      ref={backRef}
      style={{ inlineSize: back.w }}
    >
      <Card card={back.card} interactive={false} width="100%" />
    </div>
  ) : null
```

Create the co-located `_useHandLimit.module.css`:

```css
/* the card being carried back out of the grid — rides above everything at the
   cursor, and never catches the pointer it is following */
.backFlyer {
  position: fixed;
  z-index: var(--z-flight);
  pointer-events: none;
}
```

Return:

```tsx
    overlay: [...flyer.overlay, ...arrival.overlay, ...(backOverlay ? [backOverlay] : [])],
    carrying: back != null,
    gapAt: back ? dropSlot : arrival.gapAt,
    gapSize: back ? 1 : arrival.gapSize,
    onCellDown,
```

- [ ] **Step 4: Wire it into the board**

In `_Board.tsx`:

Pass the commit through the hook's options (the hook must not import `useHandOrder` — the page owns it):

```tsx
    onReturned: (uid, slot) => {
      const item = you.hand.find((c) => c.uid === uid)
      if (!item) return
      // the card never left `you.hand`, so this is a placement, not an
      // arrival: rebuild the fan as it will look with the card back at the
      // slot the pointer named, and commit that order
      const vis = [...handLimit.handItems]
      vis.splice(slot, 0, item)
      handOrder.commit(you.hand, vis, uid, slot)
    },
```

Give the cell its press handler and let a filled cell take the pointer:

```tsx
                {held ? (
                  // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only pick-up back into the hand; the discard itself is confirmed by the grid filling up
                  <div
                    className={opening.cellCard}
                    data-grid-card
                    onMouseDown={(e) => handLimit.onCellDown(e, held)}
                  >
                    <Card card={held.card} interactive={false} width="100%" />
                  </div>
                ) : (
```

Fold the hook's gap and `carrying` into the `<Hand>` props — the discard hook wins while it owns the fan:

```tsx
                gapAt={deal.gapAt ?? (discarding ? handLimit.gapAt : null) ?? beats.gapAt ?? liveGapAt}
                gapSize={
                  deal.gapAt == null
                    ? discarding && handLimit.gapAt != null
                      ? handLimit.gapSize
                      : beats.gapAt == null
                        ? liveGapSize
                        : beats.gapSize
                    : deal.gapSize
                }
                carrying={discarding && handLimit.carrying}
```

In `_Board.module.css`, let a filled cell answer the pointer (the container stays `pointer-events: none`):

```css
/* a card standing in the grid can be taken back out — the grid is a decision in
   progress, not a done deal. Grab-cursor and a small lift say so before the
   pointer is pressed. */
.cellCard {
  position: relative;
  block-size: 100%;
  cursor: grab;
  pointer-events: auto;
  transition: transform 180ms var(--ease-out);
}

.cellCard:hover {
  transform: translateY(-6px);
}
```

Extend the existing `@media (prefers-reduced-motion: reduce)` block near the top of `_Board.module.css` with the second rule:

```css
@media (prefers-reduced-motion: reduce) {
  .ask {
    transform: translate(-50%, 146px);
    transition: none;
  }

  .cellCard {
    transition: none;
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @release/web "test src/pages/board/[gameId]/__tests__/boardHandLimitBack.test.tsx"`
Expected: PASS, 2 tests.

- [ ] **Step 6: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/ui/src/index.ts "apps/frontend/src/pages/board/[gameId]/_useHandLimit.tsx" "apps/frontend/src/pages/board/[gameId]/_useHandLimit.module.css" "apps/frontend/src/pages/board/[gameId]/_Board.tsx" "apps/frontend/src/pages/board/[gameId]/_Board.module.css" "apps/frontend/src/pages/board/[gameId]/__tests__/boardHandLimitBack.test.tsx"
git commit -m "feat(web): a card in the grid is not gone yet — it can be carried back (#104)"
```

---

### Task 9: The written half

The project's standing rule: an animation changed is changed in two places — the audit page (what the state IS) and `docs/animations/` (how it is applied). A local workaround nobody hears about is how one movement ends up written three times.

PR #126's review correction is part of the starting record: its eliminate guard/preload/stall/reduced-motion documentation stays intact, and the withdrawn “two kinds of video” finding stays absent. This task extends only the existing Hand limit scenario and keyboard/no-deadline records named below.

**Files:**
- Modify: `docs/animations/recipes.md` (the "Hand limit" recipe)
- Modify: `docs/animations/glossary.md` (`GATHER_HOLD`'s readers, `CLEAR_STEP`)
- Modify: `docs/animations/backlog.md` (the keyboard entry, ~line 333)
- Modify: `apps/playground/stories/AnimationAuditStory/AnimationAuditStory.tsx`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Extend the recipe**

In `docs/animations/recipes.md`, at the end of the "Hand limit — discard the hand down to the limit" section (just before its `**Live reference.**` line), add:

```markdown
**On the board (#104).** The scene is split across the two halves of the board's own machinery, and
the split is what keeps the promise "the hand is never blocked by a flight":

- **The gesture** (`pages/board/[gameId]/_useHandLimit.tsx`) owns everything before the engine
  answers: the pull gate (`pending.options` for legality, `excess` for the limit), one carrier per
  card — no single-flight guard, unlike its three sibling hooks — the grid's claimed cells, the
  carry-back, and the single `RESOLVE` fired when the last card LANDS.
- **The beat** (`features/board-beats/handLimitBeat.tsx`) owns everything after: it adopts the grid
  the local player built (through `HandLimitHandoff`) or builds the same one from the actor's seat
  for every other peer, holds `GATHER_HOLD`, and sends every card out with `layer` = its slot and
  `delay` = `slot × CLEAR_STEP`.

The geometry both halves read is `@release/ui`'s `TableCentre/discardGrid.ts` — the shapes, the
widths and the cell offsets, quoted from this scene.
```

- [ ] **Step 2: Update the glossary**

In `docs/animations/glossary.md`, change the `GATHER_HOLD` row to name both readers and add a row for `CLEAR_STEP` beside it:

```markdown
| `GATHER_HOLD` | `1500` | `Error503Story` · `HandLimitStory` | cards gathered at the centre are held before they scatter — the sweep's heap and the hand limit's grid, one value |
| `CLEAR_STEP` | `90` | `HandLimitStory` | between cards as the finished grid leaves for the discard |
```

- [ ] **Step 3: Extend the keyboard backlog entry**

In `docs/animations/backlog.md`, at the end of the entry "Отбить атаку с клавиатуры больше нечем — последний островок убран сознательно" (before its `**Статус.**` line), add:

```markdown
**Дописано в #104.** К `defend` и `discardForRelease` добавился третий случай — сброс по лимиту
руки. Панель `PendingPrompt` для `handLimit` снята по той же причине (карты на столе спрашивают
сами, а панель накрыла бы сетку, которую игрок в этот момент собирает), и веер по-прежнему без
клавиатуры. Этот случай хуже двух предыдущих: у `handLimit` **нет дедлайна**
(`apps/frontend/src/network/session/referee.ts` — «`handLimit` и `crush` не несут своего
дедлайна»), так что зависший выбор не разруливается таймаутом, а останавливает матч всем. Запись
та же, приоритет выше.
```

- [ ] **Step 4: Update the audit page**

In `apps/playground/stories/AnimationAuditStory/AnimationAuditStory.tsx`, extend the existing `Hand limit` scenario's `from.ru` string with this text before its closing quote:

```text
 На живом борде (#104) жест в `_useHandLimit.tsx` владеет пуллами, параллельными полётами и сеткой до ответа движка; `handLimitBeat.tsx` принимает готовую сетку у локального игрока или строит ту же сетку с места соперника, держит общий с беззащитным Error 503 `GATHER_HOLD` и отправляет всё в сброс.
```

Extend the same scenario's `from.en` string with:

```text
 On the live board (#104), the gesture in `_useHandLimit.tsx` owns the pulls, concurrent flights and grid until the engine answers; `handLimitBeat.tsx` adopts the local player's finished grid or builds the same grid from an opponent seat, holds the `GATHER_HOLD` shared with a defenceless Error 503, and sends the whole grid to the discard.
```

Then add the board implementation path directly after `where: 'HandLimit',`:

```tsx
    board:
      'pages/board/[gameId]/_useHandLimit.tsx, features/board-beats/handLimitBeat.tsx',
```

In the existing finding `С клавиатуры на борде не отбиться и не оплатить релиз — двери нет вообще`, insert this sentence immediately before `— ЗАКРЫТО ОТВЕТОМ ВЛАДЕЛЬЦА` in `problem.ru`:

```text
 В #104 сюда добавился сброс по лимиту руки: `PendingPrompt` для `handLimit` снят, потому что он накрывает собираемую сетку и спрашивает второй раз то, что уже спрашивает веер. У этого случая нет собственного дедлайна, поэтому зависший мышиный выбор останавливает матч всем.
```

Insert the English counterpart immediately before `— CLOSED BY THE OWNER` in `problem.en`:

```text
 #104 adds hand-limit discard to the same gap: `PendingPrompt` is suppressed for `handLimit` because it covers the grid being assembled and asks a second time what the fan already asks. This pending has no deadline of its own, so a stalled mouse-only choice stops the match for everyone.
```

Finally replace that finding's `where` object with:

```tsx
    where: {
      ru: 'ui: table/Hand + frontend: pages/board/[gameId]/_Board.tsx (PendingPrompt), _useBoardStaging.ts (onCostPick), _useHandLimit.tsx',
      en: 'ui: table/Hand + frontend: pages/board/[gameId]/_Board.tsx (PendingPrompt), _useBoardStaging.ts (onCostPick), _useHandLimit.tsx',
    },
```

Do not add a second no-deadline finding: the existing `Пендинг без дедлайна останавливает партию` / `A pending with no deadline stalls the match` entry already names `handLimit` and remains the general record for all affected pending kinds.

- [ ] **Step 5: Verify the docs test still passes**

Run: `pnpm --filter @release/ui test src/animations/docs.test.ts && pnpm lint`
Expected: PASS. (This task adds no preset, so the presets↔reference check is unaffected — run it anyway; it is the guard that says so.)

- [ ] **Step 6: Commit**

```bash
git add docs/animations/recipes.md docs/animations/glossary.md docs/animations/backlog.md apps/playground/stories/AnimationAuditStory/AnimationAuditStory.tsx
git commit -m "docs(animations): the hand limit as the board plays it (#104)"
```

---

## Final verification

- [ ] **Run the whole repo**

```bash
pnpm --filter @release/web exec vitest run --no-file-parallelism
pnpm --filter '!@release/web' -r test
pnpm typecheck
pnpm lint
```

The web suite is deliberately serial here: PR #126 added real-timer media/guard coverage, and its review found parallel load could time out a correct guard. A serial pass is the required signal before treating a timeout as a product failure.

- [ ] **Watch it once, in the real app.** The unit tests run under reduced motion or with WAAPI absent, so nothing above has ever seen the flights. Start the board preview and play a turn into an over-limit hand (`8bit` or `memory` mode): the pull should take a cell immediately, a second pull must not wait for the first to land, the grid must hold visibly before it leaves, and the cards must not jump on the handover into the heap. Use the Browser pane's preview tools for this — never `pnpm dev` through Bash.

- [ ] **Publish the branch and open the PR** against `main`, referencing #104 and linking the design doc.

```bash
git push -u origin feat/104-hand-limit
gh pr create --base main --head feat/104-hand-limit --title 'Hand limit discard on the board (#104)' --body 'Closes #104.

Implements the approved hand-limit grid gesture, its dedicated board beat, carry-back, shared centre geometry, reduced-motion cleanup, and animation documentation.

Design: docs/specs/2026-08-28-board-hand-limit-design.md'
```
