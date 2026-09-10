# AI cards on the board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `AiCardsStory` to the real board — the AI trigger off a draw pile, the event card off the events deck, held together at the centre, then resolved seven different ways — driven by the engine's `aiRevealed` and the events that follow it instead of by a click on a deck.

**Architecture:** One `aiEvent` beat owns the whole scene. `planBeats` claims the card-less `drawn` and its `aiRevealed` together, so the draw plan never sees an AI trigger, and reads the ending off the events that follow rather than off the AI card's id. Two additive engine facts make the board able to see what it must not guess: where a destroyed card goes, and which AI card a prompt belongs to. Four of the seven endings raise a pending, so the AI card stands across a batch gap on the projection and travels home on the batch that answers it.

**Tech Stack:** TypeScript, React 19, Vite, Vitest + @testing-library/react, CSS Modules with design tokens, pnpm workspaces. Animation through `@release/ui/animations` (`play`, `useFlyer`, `useHandArrival`, `useDiscardExit`, `scatterAt`, `nextFrames`, `wait`).

**Spec:** [`docs/specs/2026-09-03-board-ai-cards-design.md`](./2026-09-03-board-ai-cards-design.md)

## Global Constraints

- **Branch:** `feat/106-ai-cards`, branched from **`feat/104-hand-limit`** (not `main`) — Bad Vibe-Coding resolves through the `handLimit` pending and that board surface lives in open PR [#131](https://github.com/MythHand/ReleaseBoardGameP2P/pull/131). The PR closes [#106](https://github.com/MythHand/ReleaseBoardGameP2P/issues/106) and stacks on #131; rebase onto `main` once #131 merges. Three commits are already on this branch and must **not** be redone: `8738332` (the design doc), `0723e94` (its conformance correction) and `cf4e33b` (this plan). Task 1 is therefore the first code commit, not the first commit.
- **`prefers-reduced-motion` is honoured everywhere.** `play()` drives WAAPI directly and does **not** check it — JS choreography asks through `useReducedMotion`; CSS uses a media query. `useBeats` already collapses every beat under it, so a runner needs no check of its own — but anything that is a **game action** rather than choreography must keep working when beats do not. The `ai-inside` single-candidate auto-resolve is exactly that case (Task 10).
- **No hardcoded colours.** Every colour comes from a token in `apps/ui/src/design/tokens.css` via `var(--*)`. Missing one → add the token first.
- **All user-visible text through `@release/translation`.** A key must exist in **both** `packages/translation/src/locales/en/common.json` and `…/ru/common.json`. No string literals in `.tsx`.
- **Code comments in English.** `presets.ts`, `centre.ts` and some kit files carry Russian comments; those are legacy. New comments are English.
- **Guessing about the rules is forbidden.** Anything not settled by `docs/rules/` goes to `docs/rules/backlog.md` **and** gets a `> ❓ **Не из правил.**` marker at the exact paragraph in the spec.
- **A movement found in two scenes is a module that has not been packaged yet.** Task 2 exists for precisely this reason — do not copy `drawBeat`'s flight into `aiBeat`.
- **Run into a gap — record it** in the audit page's register (`apps/playground/stories/AnimationAuditStory`) **and** `docs/animations/backlog.md`. Task 11 collects the ones this work already knows about; anything new found on the way joins them.
- **Commands:** `pnpm test` (all), `pnpm -C apps/frontend test <path>` / `pnpm -C apps/ui test <path>` / `pnpm -C packages/engine test <path>` (one package), `pnpm typecheck`, `pnpm lint`. A pre-commit hook runs `typecheck` and lints staged files; expect it on every commit.
- **Timings are `AiCardsStory`'s, not new inventions.** `TABLE_HOLD` 2600 · `HALLUCINATION_HOLD` 5200 · `SHOW_HOLD` 1500 · `PICK_HOLD` 900 · `FLIP_MS` 420 · `BEFORE_FLIP` 220 · `AFTER_FLIP` 560 (the last two are `drawBeat`'s existing values, unchanged).
- **No new preset.** All seven movements already exist (`drawToCenter`, `returnToDeck`, `playToReleaseZone`, `playToCenter`, `flipCard`, `dealToSeat`, and `centerToDiscard` through `useDiscardExit`). `apps/ui/src/animations/docs.test.ts` therefore has nothing new to enforce — if you find yourself adding a preset, stop and re-read the spec.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/engine/src/view.ts` | `ReleasedView.event`; `source` on three `PendingView` variants | 1 |
| `packages/engine/src/state.ts` | `source` on three `Pending` variants | 1 |
| `packages/engine/src/fake/project.ts` | project `event` onto `ReleasedView` | 1 |
| `packages/engine/src/fake/attacks.ts` | project `source` in `pendingView` | 1 |
| `packages/engine/src/fake/triggers.ts` | set `source` on the three pendings `resolveAiEvent` raises | 1 |
| `apps/ui/src/table/Table/intents.ts` | the kit's structural mirror of both | 1 |
| `apps/frontend/src/features/board-beats/toCentre.ts` | **new** — the pile→slot flight, packaged once; `TABLE_HOLD` | 2 |
| `apps/frontend/src/features/board-beats/drawBeat.tsx` | calls it; `REVEAL_HOLD` becomes the scene's value | 2 |
| `apps/frontend/src/entities/game/board/types.ts` | `releaseEvent`, on `you` and on each opponent | 3 |
| `apps/frontend/src/entities/game/board/toBoardState.ts` | the carrier the catalogue mapping would otherwise drop | 3 |
| `apps/frontend/src/features/board-beats/planBeats.ts` | `aiEvent`; the `owed` argument; `homeward`; `takenFromDiscard` | 4, 9, 11 |
| `apps/frontend/src/entities/game/board/anchors.ts` | `cause`, `effect`, `picked`, `eventsBox` | 5 |
| `apps/frontend/src/pages/board/[gameId]/_Board.tsx` | the three slots, the standing card, the events pile's box, the two prompt surfaces | 5, 10, 11 |
| `apps/frontend/src/pages/board/[gameId]/_Board.module.css` | only what all three slots share | 5 |
| `apps/frontend/src/features/board-beats/aiBeat.tsx` | **new** — everything that flies for an AI card | 6–8, 11 |
| `apps/frontend/src/features/board-beats/testing.tsx` | **new** — the shared beat-test harness Tasks 7-9 import | 6 |
| `apps/frontend/src/features/board-beats/useBeats.ts` | queue wiring; `owed`; the gap contributors | 4, 6, 11 |
| `apps/frontend/src/features/board-beats/index.ts` | barrel exports | 6 |
| `apps/frontend/src/features/board-beats/defenseBeat.tsx` | the road home, and the sacrifice flight that was wrong | 9 |
| `apps/frontend/src/features/board-beats/handLimitBeat.tsx` | the road home | 9 |
| `apps/frontend/src/pages/board/[gameId]/_useHandLimit.tsx` | Bad Vibe uses the `picked` place, not the grid | 10 |
| `apps/frontend/src/pages/board/[gameId]/_useInsideStaging.tsx` | **new** — the Inside row and its auto-resolve | 11 |
| `packages/translation/src/locales/{en,ru}/common.json` | the Inside prompt | 11 |
| `docs/animations/{reference,recipes,backlog}.md`, `AnimationAuditStory` | the spec's written pair, and the findings | 12 |

Tasks 6-8 and 11 all edit `aiBeat.tsx`. That is deliberate: it is one runner, and the endings are added one at a time so each carries its own test cycle and its own review gate. Do not split the file.

**Task order is a dependency chain, not a preference.** The engine facts (1) come before anything that reads them; the packaged flight (2) before the runner that needs it twice; the board's carrier (3) before the plan that reads it (4); the slots (5) before the beat that aims at them (6), because a flight cannot aim at a node that is not there.

---

### Task 1: The engine's two facts

The board must not guess two things, and today it cannot see either. **Where a destroyed card goes:** `bankToDiscard` (`fake/core.ts`) sends a card carrying `event` back to `decks.events` rather than to the discard, but the `discarded` it reports with always names the discard, and a standing AI release wears the plain `release-<slot>` id on purpose. `releasedView` (`fake/project.ts:11`) then drops `event` entirely. **Which AI card a prompt belongs to:** `crush` carries only a slot, `neutralize503.card` is `null` for the `ai-error-503` mimic, and `handLimit` carries nothing at all — while `pickFromDiscard.source` already exists with exactly the meaning needed.

Both are additive. No `GameState` shape changes: `event` is already on `CardInstance`, and `resolveAiEvent` already has `event.id` in hand where it raises each pending.

**A warning about the type tests.** Neither `contract.test-d.ts` nor `engineContract.test-d.ts` catches an **optional** field added to one side and not the other — `Exact<A, B>` passes when the only difference is an optional property. What does catch it is ordinary typecheck in the consuming direction: `BoardState.pending` is the **kit's** `TablePending`, so a board file reading `pending.source` fails to compile until the kit has it. Add both sides in this task; do not rely on a type test to remind you.

**Files:**
- Modify: `packages/engine/src/view.ts` (`ReleasedView` ~line 15; `PendingView`'s `neutralize503`, `crush`, `handLimit` variants ~lines 65-70)
- Modify: `packages/engine/src/state.ts` (`Pending`'s `neutralize503` ~line 115, `crush` ~line 121, `handLimit` ~line 127)
- Modify: `packages/engine/src/fake/project.ts:10-11` (`releasedView`), and the `monitoring` line at ~:20
- Modify: `packages/engine/src/fake/attacks.ts` (`pendingView`, ~lines 445-456)
- Modify: `packages/engine/src/fake/triggers.ts` (`resolveAiEvent`: the crush, bad-vibe and `ai-error-503` cases)
- Modify: `apps/ui/src/table/Table/intents.ts` (`TablePending`, ~lines 57-60)
- Test: `packages/engine/src/fake/project.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ReleasedView.event?: CardId` — the events-deck id this instance goes home as. Absent for an ordinary card. Read by Tasks 3 and 7.
  - `PendingView`/`TablePending`: `crush.source?: CardId`, `neutralize503.source?: CardId`, `handLimit.source?: CardId` — the AI event card this prompt belongs to; public on all three, like `pickFromDiscard.source`. Read by Tasks 3, 7, 8, 9.

- [ ] **Step 1: Write the failing projection tests**

Append to `packages/engine/src/fake/project.test.ts`:

```ts
describe('the AI facts a board cannot otherwise see', () => {
  it('projects `event` for an AI-granted release and omits it for an ordinary one', () => {
    const engine = makeFake()
    const base = engine.createGame(configFor({}, 7))
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        p1: {
          ...base.players.p1,
          release: {
            frontend: { card: { uid: 'ai#1', id: 'release-frontend', event: 'ai-release-frontend' } },
            backend: { card: { uid: 'base#1', id: 'release-backend' } },
          },
        },
      },
    }
    const view = projectFor(state, 'p1')
    expect(view.you.release.frontend?.event).toBe('ai-release-frontend')
    expect(view.you.release.backend?.event).toBeUndefined()
  })

  it('projects the AI card behind a crush prompt, to a player who is not the one asked', () => {
    const engine = makeFake()
    const base = engine.createGame(configFor({}, 7))
    const state: GameState = {
      ...base,
      pending: {
        kind: 'crush',
        player: 'p1',
        slot: 'frontend',
        methods: ['debugger'],
        source: 'ai-crush-frontend',
      },
    }
    // public, like `pickFromDiscard.source` — the whole table watched it revealed
    expect(projectFor(state, 'p2').pending).toMatchObject({ source: 'ai-crush-frontend' })
  })

  it('projects the AI card behind a Bad Vibe hand limit and behind the 503 mimic', () => {
    const engine = makeFake()
    const base = engine.createGame(configFor({}, 7))
    const bad: GameState = {
      ...base,
      pending: {
        kind: 'handLimit',
        player: 'p1',
        excess: 1,
        endsTurn: false,
        source: 'ai-bad-vibe-coding',
      },
    }
    expect(projectFor(bad, 'p2').pending).toMatchObject({ source: 'ai-bad-vibe-coding' })
    const mimic: GameState = {
      ...base,
      pending: {
        kind: 'neutralize503',
        player: 'p1',
        card: null,
        methods: ['debugger'],
        source: 'ai-error-503',
      },
    }
    // `card` stays null — `bankAlarm` reads it to decide what to bank, and the
    // mimic's own card is already home in the events deck
    expect(projectFor(mimic, 'p2').pending).toMatchObject({ card: null, source: 'ai-error-503' })
  })
})
```

Match the file's existing import and helper names (`makeFake`/`configFor`/`projectFor` or whatever it already uses) rather than the names above if they differ — read the top of the file first.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/engine test -- project`
Expected: FAIL — TypeScript rejects `event` and `source` as unknown properties on the state literals, and the assertions read `undefined`.

- [ ] **Step 3: Add the fields to the engine's types**

In `packages/engine/src/view.ts`, `ReleasedView`:

```ts
export interface ReleasedView {
  uid: CardUid
  card: CardId
  codeReview?: CardId
  // The events-deck id this instance goes home as when it leaves the table
  // (general.md §6.4). A standing AI release wears the plain `release-<slot>`
  // id on purpose, so it reads and plays as an ordinary one — which leaves the
  // board no other way to tell where a destroyed card actually goes, because
  // `bankToDiscard` routes it silently and `discarded` names the discard either
  // way (docs/animations/backlog.md, closed by this field).
  event?: CardId
}
```

…and on the three `PendingView` variants, each with the same one-line comment:

```ts
  | {
      kind: 'neutralize503'
      player: PlayerId
      card: CardId | null
      methods: NeutralizeMethod[]
      // The AI event card this prompt belongs to, so the table can keep it
      // standing while the answer is chosen. Public, like `pickFromDiscard`'s:
      // the whole table watched it be revealed.
      source?: CardId
    }
  | {
      kind: 'crush'
      player: PlayerId
      slot: ReleaseSlot
      methods: NeutralizeMethod[]
      source?: CardId
    }
  | { kind: 'handLimit'; player: PlayerId; excess: number; options: CardUid[]; source?: CardId }
```

In `packages/engine/src/state.ts`, add `source?: CardId` to the same three `Pending` variants (`neutralize503`, `crush`, `handLimit`), keeping each variant's existing comment block intact.

- [ ] **Step 4: Project them**

In `packages/engine/src/fake/project.ts`, `releasedView` and the monitoring line:

```ts
const releasedView = (r: Released | undefined): ReleasedView | undefined =>
  r && {
    uid: r.card.uid,
    card: r.card.id,
    codeReview: r.codeReview?.id,
    ...(r.card.event ? { event: r.card.event } : {}),
  }
```

```ts
  if (z.monitoring) {
    view.monitoring = {
      uid: z.monitoring.uid,
      card: z.monitoring.id,
      ...(z.monitoring.event ? { event: z.monitoring.event } : {}),
    }
  }
```

In `packages/engine/src/fake/attacks.ts`, `pendingView` — spread `source` on all three, unconditionally (it is public):

```ts
    case 'neutralize503':
      return {
        kind: 'neutralize503',
        player: p.player,
        card: p.card ? p.card.id : null,
        methods: [...p.methods],
        ...(p.source ? { source: p.source } : {}),
      }
    case 'crush':
      return {
        kind: 'crush',
        player: p.player,
        slot: p.slot,
        methods: [...p.methods],
        ...(p.source ? { source: p.source } : {}),
      }
```

…and the same spread on the existing `handLimit` case, leaving its `options: mine ? … : []` gate exactly as it is.

- [ ] **Step 5: Set `source` where the three pendings are raised**

In `packages/engine/src/fake/triggers.ts`, `resolveAiEvent` — three one-line additions:

```ts
      // ai-crush-*
      return {
        ...state,
        pending: { kind: 'crush', player, slot, methods, source: event.id },
        eventSeq: log.seq,
      }
```

```ts
      // ai-bad-vibe-coding
      return {
        ...state,
        pending: { kind: 'handLimit', player, excess: 1, endsTurn: false, source: event.id },
        eventSeq: log.seq,
      }
```

```ts
      // ai-error-503
      return {
        ...state,
        pending: { kind: 'neutralize503', player, card: null, methods, source: event.id },
        eventSeq: log.seq,
      }
```

`ai-inside` already passes `source: event.id` — leave it alone.

- [ ] **Step 6: Mirror both in the kit**

In `apps/ui/src/table/Table/intents.ts`, `TablePending` — add `source?: string` to `neutralize503`, `crush` and `handLimit`. The kit mirrors the engine structurally rather than importing it (Decision 7, stated at the top of that file), so this is a hand-kept copy and `engineContract.test-d.ts` will only catch it if the field were required. Add the same comment naming that limit:

```ts
  // Mirrors PendingView. NOTE: an *optional* field added on one side only is
  // NOT caught by engineContract.test-d.ts — `Exact` passes when the sole
  // difference is optional. What catches it is the board reading `.source`
  // against this type and failing to compile.
  | { kind: 'neutralize503'; player: string; card: string | null; methods: NeutralizeMethodId[]; source?: string }
  | { kind: 'crush'; player: string; slot: ReleaseSlotId; methods: NeutralizeMethodId[]; source?: string }
  | { kind: 'handLimit'; player: string; excess: number; options: string[]; source?: string }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm -C packages/engine test -- project`
Expected: PASS, all three.

- [ ] **Step 8: Verify by mutation, not by reasoning**

#61's standing warning, and the nine tests that shipped green asserting nothing during the engine's own implementation. Break each fact and confirm the matching test goes red:

```bash
# 1. drop the projection of `event` — test 1 must fail
# 2. drop the `source` spread from the crush case — test 2 must fail
# 3. drop `source: event.id` from the bad-vibe pending — test 3 must fail
```

Restore after each. A mutation that leaves the suite green means the test asserts nothing; fix the test, not the note.

- [ ] **Step 9: Run the full suite and commit**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. `conformance.ts` is untouched — its "never creates or loses a card across a long stream" and "never lets a card from the events deck reach the discard" properties already exist and already pass.

```bash
git add packages/engine/src apps/ui/src/table/Table/intents.ts
git commit -m "feat(engine): say where a destroyed card goes, and which AI card a prompt belongs to (#106)"
```

---

### Task 2: `toCentre` packaged, and the trigger's hold gets its approved value

`drawBeat`'s `toCentre` is the pile→centre flight: raise a card at a pile's card box, fly it on `drawToCenter`, pin it where it lands (I4). `aiBeat` needs exactly that twice — once for the trigger, once for the event card off the events deck — and by #88's own standing rule a movement found in two scenes is a module that has not been packaged yet. Packaging it as a **hook** rather than a bare function is what avoids passing `useFlyer`'s carrier around: the hook owns the `useFlyer` call and hands back both the carrier and the flight.

The one behavioural change rides along here because it is in the same function's blast radius: `REVEAL_HOLD = 900` is a number `drawBeat` invented, and the audit register's owner answer settled it — the value comes from the example scene, the scene is `AI cards` because the behaviour of AI cards at the centre is its subject, and the value is `TABLE_HOLD = 2600`. There is no separate "plain reveal" hold in any scene, because a trigger's stand *is* part of reading the AI card.

**Files:**
- Create: `apps/frontend/src/features/board-beats/toCentre.ts`
- Modify: `apps/frontend/src/features/board-beats/drawBeat.tsx` (imports, the `useFlyer` call, `toCentre`, `REVEAL_HOLD`)
- Test: `apps/frontend/src/features/board-beats/drawBeat.test.tsx` (existing — it must stay green, and one hold assertion changes)

**Interfaces:**
- Consumes: nothing.
- Produces: `useToCentre()` → `{ overlay, raise, pin, patch, drop, elOf, toSlot }`, where

  ```ts
  toSlot(args: {
    key: string
    card: CardData
    from: Rect          // the source cell, already `cardAreaOf`-normalised by the caller
    to: Rect            // the slot's own card box
    faceDown?: boolean  // default true
  }): Promise<Rect | null>
  ```

  resolves to `to` once the card is pinned there, or `null` if nothing could be raised. Used by Task 4.
- Produces: `TABLE_HOLD = 2600` and `HALLUCINATION_HOLD = 5200`, exported from `toCentre.ts` so `drawBeat` and `aiBeat` share one definition rather than two copies of one number.

- [ ] **Step 1: Write the failing test for the shared step**

Create `apps/frontend/src/features/board-beats/toCentre.test.tsx`:

```tsx
import { cardById } from '@release/ui'
import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TABLE_HOLD, useToCentre } from './toCentre'

const RECT = (left: number, top: number) => ({ left, top, width: 150, height: 210 })

describe('useToCentre', () => {
  it('raises the card at `from`, flies it, and reports the slot it was pinned to', async () => {
    let api: ReturnType<typeof useToCentre> | null = null
    function Harness() {
      api = useToCentre()
      return <>{api.overlay}</>
    }
    render(<Harness />)
    const card = cardById('trigger-ai')
    expect(card).toBeDefined()
    let landed: unknown
    await act(async () => {
      landed = await api?.toSlot({
        key: 'draw',
        card: card!,
        from: RECT(0, 0),
        to: RECT(400, 300),
      })
    })
    expect(landed).toEqual(RECT(400, 300))
    expect(api?.elOf('draw')).not.toBeNull()
  })

  it('holds the scene's own value, not a number of its own', () => {
    expect(TABLE_HOLD).toBe(2600)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C apps/frontend test -- toCentre`
Expected: FAIL — `Cannot find module './toCentre'`.

- [ ] **Step 3: Write the module**

Create `apps/frontend/src/features/board-beats/toCentre.ts`:

```ts
import type { CardData } from '@release/ui'
import type { Rect } from '@release/ui/animations'
import { play, useFlyer } from '@release/ui/animations'
import { useCallback } from 'react'

// THE FLIGHT OUT OF A PILE, packaged once.
//
// A card leaves a pile face down, travels to a named place at the centre, and
// STAYS there — pinned, so whatever comes next (a flip, a second flight, a
// discard exit) starts from where it stands rather than from where it began
// (I4). `drawBeat` had it first and `aiBeat` needs it twice; by #88's own
// standing rule that makes it a module rather than a movement to write again.
//
// It is a hook and not a bare function so that it can own the `useFlyer` call:
// a bare function would have to be handed the carrier, and a carrier passed
// between files is how two runners end up sharing one overlay by accident.

// How long a card the SYSTEM turned up stands for the table to read it. The
// value is the example scene's — `AiCardsStory`'s `TABLE_HOLD` — and not a
// number chosen here. There is no separate "plain reveal" hold anywhere in the
// scenes, because a trigger's stand IS part of reading the AI card it pulled:
// the two stand together and leave together (`resolveGeneric`).
export const TABLE_HOLD = 2600
// Hallucination lingers twice as long — `AiCardsStory`'s own doubling.
export const HALLUCINATION_HOLD = TABLE_HOLD * 2

export function useToCentre() {
  const flyer = useFlyer()
  const { raise, pin } = flyer

  const toSlot = useCallback(
    async (args: {
      key: string
      card: CardData
      from: Rect
      to: Rect
      faceDown?: boolean
    }): Promise<Rect | null> => {
      const { key, card, from, to, faceDown = true } = args
      const [el] = await raise([{ key, card, at: from, faceDown }])
      if (!el) return null
      const anim = play('drawToCenter', el, { from, to })
      if (anim) await anim.finished
      pin(key, to) // I4 — the next leg starts from where it stands
      return to
    },
    [raise, pin],
  )

  return { ...flyer, toSlot }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C apps/frontend test -- toCentre`
Expected: PASS, both.

- [ ] **Step 5: Make `drawBeat` call it**

In `apps/frontend/src/features/board-beats/drawBeat.tsx`:

1. Replace the `useFlyer` import with `useToCentre` from `./toCentre`, and add `TABLE_HOLD`:

```ts
import { nextFrames, play, scatterAt, useDiscardExit, useHandArrival, wait } from '@release/ui/animations'
import { TABLE_HOLD, useToCentre } from './toCentre'
```

2. Replace the carrier line:

```ts
  const { overlay: flyerOverlay, raise, pin, patch, drop, elOf, toSlot } = useToCentre()
```

3. Delete the local `REVEAL_HOLD` constant and use `TABLE_HOLD` at its one call site:

```ts
          await wait(TABLE_HOLD)
```

4. Replace the body of the local `toCentre` callback with a call to `toSlot`, keeping its name and signature so nothing else in the file moves:

```ts
  // deck -> centre, face down. The one leg every draw has, whoever drew it.
  const toCentre = useCallback(
    async (d: PlannedDraw): Promise<Rect | null> => {
      const a = latest.current.anchors
      const cell = rectOf(a.pileBox(d.pile))
      const centre = rectOf(a.centre.current)
      if (!cell || !centre) return null
      const face = d.card ?? d.reveal?.card
      const card = (face ? cardById(face) : null) ?? COVER
      return toSlot({ key: 'draw', card, from: cardAreaOf(cell), to: centre })
    },
    [toSlot],
  )
```

`raise` and `pin` may now be unused in this file — if the linter says so, drop them from the destructure.

- [ ] **Step 6: Run the draw suite**

Run: `pnpm -C apps/frontend test -- drawBeat`
Expected: PASS, except any test asserting the old 900ms hold. Update that assertion to `TABLE_HOLD` (import it) rather than to a fresh literal — the point of the change is that the number has one home.

- [ ] **Step 7: Run the board suite, then commit**

Run: `pnpm -C apps/frontend test && pnpm typecheck`
Expected: PASS. The hold change lengthens a reveal, so a test using fake timers may need its advance updated; a test that hardcodes 900 anywhere is the one this task is fixing.

```bash
git add apps/frontend/src/features/board-beats/toCentre.ts apps/frontend/src/features/board-beats/toCentre.test.tsx apps/frontend/src/features/board-beats/drawBeat.tsx
git commit -m "refactor(web): package the flight out of a pile, and give the trigger's hold its approved value (#106)"
```

---

### Task 3: The fact reaches the board

Task 1 put `event` on the engine's `ReleasedView`. The board cannot read it yet, and the reason is worth understanding before you touch anything: `toReleaseSlots` (`toBoardState.ts:32`) maps a `ReleasedView` down to a `CardData` from the catalogue, because the kit's `ReleaseSlots` renders `Card` objects and has no member for anything else. Everything not on `CardData` is dropped there — which is exactly why `uid` already travels beside it, in `releaseUid`, rather than inside it.

`event` takes the same road, and it must reach **opponents** too, not only `you`: `resolveAiEvent`'s crush destroys the drawer's own release, and the drawer is frequently somebody else.

**Files:**
- Modify: `apps/frontend/src/entities/game/board/types.ts` (`you.releaseEvent`, and the opponent shape)
- Modify: `apps/frontend/src/entities/game/board/toBoardState.ts` (a `toReleaseEvents` map beside `toReleaseUids`, wired into `you` and into `opponents`)
- Test: `apps/frontend/src/entities/game/board/toBoardState.test.ts`

**Interfaces:**
- Consumes: `ReleasedView.event` (Task 1).
- Produces: `BoardState['you']['releaseEvent']?: Partial<Record<'frontend'|'backend'|'database'|'monitoring', string>>` and the same optional field on each entry of `BoardState['opponents']`. Absent slot means an ordinary card. Read by Tasks 4 and 8.

- [ ] **Step 1: Write the failing test**

Append to `apps/frontend/src/entities/game/board/toBoardState.test.ts`:

```ts
it('carries the events-deck identity of a standing AI release, for you and for an opponent', () => {
  const view = viewFixture()
  view.you.release = {
    frontend: { uid: 'ai#1', card: 'release-frontend', event: 'ai-release-frontend' },
    backend: { uid: 'base#1', card: 'release-backend' },
  }
  view.opponents[0].release = {
    monitoring: { uid: 'ai#2', card: 'protection-monitoring', event: 'ai-monitoring' },
  }
  const state = toBoardState(view, LABELS)
  expect(state.you.releaseEvent).toEqual({ frontend: 'ai-release-frontend' })
  expect(state.opponents[0].releaseEvent).toEqual({ monitoring: 'ai-monitoring' })
  // the slots themselves are unchanged — the card still reads as an ordinary one
  expect(state.you.release.frontend?.id).toBe('release-frontend')
})
```

Use whatever fixture builder the file already has instead of `viewFixture()`/`LABELS` if the names differ — read the top of the file first.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C apps/frontend test -- toBoardState`
Expected: FAIL — `releaseEvent` is not a property of the projected state (and TypeScript rejects `event` on the fixture literal until Task 1 is in).

- [ ] **Step 3: Add the map and wire it**

In `toBoardState.ts`, directly after `toReleaseUids`:

```ts
// The other identity `toReleaseSlots` drops — and the one the board cannot do
// without. A standing AI release wears the plain `release-<slot>` id so it reads
// and plays as an ordinary one; `event` is the only thing that says otherwise,
// and without it a beat has no way to tell a card going home to the events deck
// from one going to the discard heap (docs/animations/backlog.md).
type ReleaseEvents = Partial<Record<'frontend' | 'backend' | 'database' | 'monitoring', string>>

function toReleaseEvents(release: ReleaseView): ReleaseEvents {
  const out: ReleaseEvents = {}
  if (release.frontend?.event) out.frontend = release.frontend.event
  if (release.backend?.event) out.backend = release.backend.event
  if (release.database?.event) out.database = release.database.event
  if (release.monitoring?.event) out.monitoring = release.monitoring.event
  return out
}
```

Then add `releaseEvent: toReleaseEvents(view.you.release)` beside the existing `releaseUid:` on `you`, and `releaseEvent: toReleaseEvents(o.release)` inside the `opponents.map` at `:200`.

In `types.ts`, declare it optional on both shapes, mirroring how `releaseUid` is declared on `you`.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C apps/frontend test -- toBoardState`
Expected: PASS.

- [ ] **Step 5: Verify by mutation**

Delete the `if (release.monitoring?.event)` line and confirm the opponent half of the assertion goes red. Restore.

- [ ] **Step 6: Commit**

Run: `pnpm -C apps/frontend test && pnpm typecheck`

```bash
git add apps/frontend/src/entities/game/board
git commit -m "feat(web): the board can see which releases came from the events deck (#106)"
```

---

### Task 4: `planBeats` grows `aiEvent`

The walk claims the card-less `drawn` at `i` whenever `events[i+1]` is `aiRevealed`, takes the trigger's own `discarded` at `i+2`, and reads the ending from what follows at `i+3`. `revealAfter`'s `aiRevealed` branch goes away with it — after this task the draw plan never sees an AI trigger at all, and `revealAfter` handles only `revealed` (the base Error 503).

Two facts are read from outside the batch, and both need saying out loud because a plan that reads outside its batch is a plan that can surprise a reader:

- **`destination`** comes from the pre-batch projection — `releaseEvent[slot]` on whichever player owns the zone. `before`, never live: the release is gone from the live projection by the time the batch is planned (I1).
- **`standing` versus `none`** cannot come from the batch at all. Raising a pending emits no event, so a crush over an empty slot and a crush that will be answered produce byte-identical, **empty** batches — and they are opposite scenes. So `planBeats` gains a third argument, `owed`: the pending the batch LEFT standing, which `useBeats` already holds as `live.pending`. The test is exact rather than heuristic: `owed?.source === eventCard`.

**Files:**
- Modify: `apps/frontend/src/features/board-beats/planBeats.ts` (the `BeatPlan` union, `revealAfter`, the `drawn` branch, the signature)
- Modify: `apps/frontend/src/features/board-beats/useBeats.ts` (pass `live.pending` as `owed`)
- Test: `apps/frontend/src/features/board-beats/planBeats.test.ts`

**Interfaces:**
- Consumes: `BoardState['you'|'opponents'].releaseEvent` (Task 3); `TablePending['crush'|'neutralize503'|'handLimit'].source` (Task 1).
- Produces:

```ts
export type AiTail =
  | { kind: 'zone'; slot: string; card: string }
  | { kind: 'crush'; slot: string; card: string; destination: 'events' | 'discard' }
  | { kind: 'turnEnded' }
  | { kind: 'alarm' }
  | { kind: 'standing'; alarm?: true }
  | { kind: 'none' }

// added to the BeatPlan union
| {
    kind: 'aiEvent'
    key: string
    eventId: number
    player: string
    pile: number
    trigger: string
    triggerDiscardId: number
    eventCard: string
    tail: AiTail
  }
```

- Produces: `planBeats(events: Event[], before: BoardState, owed?: TablePending | null): BeatPlan[]`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/frontend/src/features/board-beats/planBeats.test.ts`:

```ts
describe('aiEvent', () => {
  // drawn(card-less) → aiRevealed → discarded(trigger) → the effect's own events
  const aiBatch = (...tail: Event[]): Event[] => [
    { id: 1, type: 'drawn', player: 'p1', pile: 0, deckSize: 30 },
    { id: 2, type: 'aiRevealed', player: 'p1', aiCard: 'trigger-ai', eventCard: 'ai-crush-frontend' },
    { id: 3, type: 'discarded', player: 'p1', card: 'trigger-ai', reason: 'trigger' },
    ...tail,
  ]

  it('claims the draw and its reveal, and emits no draw plan', () => {
    const plans = planBeats(aiBatch(), boardFixture())
    expect(plans.map((p) => p.kind)).toEqual(['aiEvent'])
    expect(plans[0]).toMatchObject({
      player: 'p1',
      pile: 0,
      trigger: 'trigger-ai',
      triggerDiscardId: 3,
      eventCard: 'ai-crush-frontend',
    })
  })

  it('reads the ending off the events that follow, never off the card id', () => {
    const zone = planBeats(
      [
        { id: 1, type: 'drawn', player: 'p1', pile: 0, deckSize: 30 },
        { id: 2, type: 'aiRevealed', player: 'p1', aiCard: 'trigger-ai', eventCard: 'ai-release-frontend' },
        { id: 3, type: 'discarded', player: 'p1', card: 'trigger-ai', reason: 'trigger' },
        { id: 4, type: 'released', player: 'p1', slot: 'frontend', card: 'release-frontend' },
      ],
      boardFixture(),
    )
    expect(zone[0]).toMatchObject({ tail: { kind: 'zone', slot: 'frontend', card: 'release-frontend' } })

    const halluc = planBeats(
      [
        { id: 1, type: 'drawn', player: 'p1', pile: 0, deckSize: 30 },
        { id: 2, type: 'aiRevealed', player: 'p1', aiCard: 'trigger-ai', eventCard: 'ai-hallucination' },
        { id: 3, type: 'discarded', player: 'p1', card: 'trigger-ai', reason: 'trigger' },
        { id: 4, type: 'turnEnded', player: 'p1' },
      ],
      boardFixture(),
    )
    expect(halluc[0]).toMatchObject({ tail: { kind: 'turnEnded' } })
  })

  // THE PAIR THAT MATTERS #1 — two batches identical apart from the projection
  it('sends a destroyed AI release home and an ordinary one to the heap', () => {
    const batch = aiBatch({
      id: 4,
      type: 'releaseDestroyed',
      player: 'p1',
      slot: 'frontend',
      card: 'release-frontend',
    })
    const ai = boardFixture({
      you: { release: { frontend: cardById('release-frontend') }, releaseEvent: { frontend: 'ai-release-frontend' } },
    })
    const plain = boardFixture({
      you: { release: { frontend: cardById('release-frontend') }, releaseEvent: {} },
    })
    expect(planBeats(batch, ai)[0]).toMatchObject({ tail: { destination: 'events' } })
    expect(planBeats(batch, plain)[0]).toMatchObject({ tail: { destination: 'discard' } })
  })

  // THE PAIR THAT MATTERS #2 — two batches identical AND empty
  it('separates a prompt that is owed from nothing having happened, using `owed`', () => {
    const batch = aiBatch()
    const before = boardFixture()
    expect(planBeats(batch, before, null)[0]).toMatchObject({ tail: { kind: 'none' } })
    expect(
      planBeats(batch, before, {
        kind: 'crush',
        player: 'p1',
        slot: 'frontend',
        methods: ['debugger'],
        source: 'ai-crush-frontend',
      })[0],
    ).toMatchObject({ tail: { kind: 'standing' } })
  })

  it('lights the alarm for the 503 mimic, standing or not', () => {
    const revealed: Event = { id: 4, type: 'revealed', player: 'p1', card: 'ai-error-503' }
    const mimic = (...rest: Event[]) => [
      { id: 1, type: 'drawn', player: 'p1', pile: 0, deckSize: 30 } as Event,
      { id: 2, type: 'aiRevealed', player: 'p1', aiCard: 'trigger-ai', eventCard: 'ai-error-503' } as Event,
      { id: 3, type: 'discarded', player: 'p1', card: 'trigger-ai', reason: 'trigger' } as Event,
      revealed,
      ...rest,
    ]
    // answerable: the prompt is owed, the card stands, and the glow is owed with it
    expect(
      planBeats(mimic(), boardFixture(), {
        kind: 'neutralize503',
        player: 'p1',
        card: null,
        methods: ['debugger'],
        source: 'ai-error-503',
      })[0],
    ).toMatchObject({ tail: { kind: 'standing', alarm: true } })
    // defenceless: `eliminated` follows in the same batch and the sweep takes over
    const doomed = planBeats(mimic({ id: 5, type: 'eliminated', player: 'p1' }), boardFixture(), null)
    expect(doomed[0]).toMatchObject({ tail: { kind: 'alarm' } })
    expect(doomed.some((p) => p.kind === 'eliminated')).toBe(true)
  })

  it('does not let the discard planner claim the trigger a second time', () => {
    const plans = planBeats(aiBatch(), boardFixture(), null)
    expect(plans.some((p) => p.kind === 'discard')).toBe(false)
  })
})
```

Use the file's own fixture helper rather than `boardFixture()` if it is named differently, and give it the shape those tests need.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C apps/frontend test -- planBeats`
Expected: FAIL — `planBeats` takes two arguments, there is no `aiEvent` kind, and the AI batch still plans a `draw`.

- [ ] **Step 3: Add the plan shape and the tail reader**

In `planBeats.ts`, add `AiTail` and the `aiEvent` member to `BeatPlan` exactly as given under **Interfaces** above, then add the reader beside `revealAfter`:

```ts
// The zone a player's releases stand in, on the board that is still on screen
// (I1). `sourceOf` reaches for the same two places; this asks a different
// question of them, so it is its own two lines rather than a parameter on that.
const releaseEventsOf = (before: BoardState, player: string) =>
  player === before.selfId
    ? before.you.releaseEvent
    : before.opponents.find((o) => o.id === player)?.releaseEvent

// What the AI card DID, read from the events behind it rather than from its own
// id. That is this file's standing rule (see the DDoS note on `attacked`), and
// here it earns its keep twice: `released`/`placed` following is what says the
// event card stayed on the table instead of going home, and `revealed` followed
// by `eliminated` is what separates a defenceless 503 from one that will be
// answered.
//
// `owed` is the one thing no batch can report about itself: raising a pending
// emits no event, so a crush over an empty slot and a crush that will be
// answered are the same empty batch and opposite scenes.
function aiTailAfter(
  events: Event[],
  i: number,
  before: BoardState,
  eventCard: string,
  owed: TablePending | null | undefined,
): AiTail {
  const next = events[i + 3]
  if (next?.type === 'released') {
    return { kind: 'zone', slot: next.slot, card: next.card }
  }
  if (next?.type === 'placed') {
    return { kind: 'zone', slot: 'monitoring', card: next.card }
  }
  if (next?.type === 'releaseDestroyed') {
    const home = releaseEventsOf(before, next.player)?.[next.slot as 'frontend'] !== undefined
    return {
      kind: 'crush',
      slot: next.slot,
      card: next.card,
      destination: home ? 'events' : 'discard',
    }
  }
  if (next?.type === 'turnEnded') return { kind: 'turnEnded' }
  const mimic = next?.type === 'revealed' && next.card === eventCard
  // A prompt is owed for THIS card — not merely "some pending exists", which a
  // relayed batch could have carried in from anywhere. Only the four pendings
  // an AI effect can raise carry `source` at all, so the equality is the whole
  // test; no kind check is needed in front of it.
  const standing = owed?.source === eventCard
  if (standing) return { kind: 'standing', ...(mimic ? { alarm: true as const } : {}) }
  if (mimic) return { kind: 'alarm' }
  return { kind: 'none' }
}
```

- [ ] **Step 4: Claim the pair in the walk**

At the very top of the `if (e.type === 'drawn')` branch in `planBeats`, before the existing `revealAfter` line:

```ts
    if (e.type === 'drawn') {
      // AN AI TRIGGER IS NOT A DRAW. It is its own scene from the pile onward,
      // so it is claimed whole here and the draw plan never sees it — the
      // trigger's WHOLE life then lives inside one beat, which is the invariant
      // `drawBeat`'s own header defends.
      const ai = events[i + 1]
      if (e.card === undefined && ai?.type === 'aiRevealed') {
        flush()
        const filed = events[i + 2]
        // The trigger's own exit, claimed so the discard planner cannot take it
        // a second time — the same `owned` set `revealAfter` writes to.
        if (filed?.type === 'discarded' && filed.card === ai.aiCard) owned.add(filed.id)
        plans.push({
          kind: 'aiEvent',
          key: `ai:${e.id}`,
          eventId: e.id,
          player: e.player,
          pile: e.pile,
          trigger: ai.aiCard,
          triggerDiscardId: filed?.type === 'discarded' ? filed.id : -1,
          eventCard: ai.eventCard,
          tail: aiTailAfter(events, i, before, ai.eventCard, owed),
        })
        continue
      }
      const reveal = e.card === undefined ? revealAfter(events, i) : null
      // …unchanged from here
```

Then delete the `aiRevealed` arm from `revealAfter`, leaving:

```ts
  const card = reveal.type === 'revealed' ? reveal.card : null
```

and update that function's header comment to say it now handles only the base Error 503, because an AI trigger is claimed before it is ever reached.

- [ ] **Step 5: Widen the signature and pass `owed`**

```ts
export function planBeats(
  events: Event[],
  before: BoardState,
  // The pending this batch LEFT standing — `useBeats`'s `live.pending`. The one
  // fact a batch cannot report about itself, because raising a pending emits no
  // event. Optional so every existing caller and test keeps compiling.
  owed?: TablePending | null,
): BeatPlan[] {
```

Import `TablePending` from `@release/ui` at the top of the file.

In `useBeats.ts`, at the single call site inside the batch effect:

```ts
    for (const plan of planBeats(fresh, before, live.pending)) {
```

`live` is already in that effect's scope and already a dependency.

- [ ] **Step 6: Run them to verify they pass**

Run: `pnpm -C apps/frontend test -- planBeats`
Expected: PASS, all six.

- [ ] **Step 7: Verify by mutation**

- Hardcode `destination: 'discard'` → the first pair-that-matters goes red on its `'events'` half.
- Hardcode `standing` to `false` → the second pair goes red on its `'standing'` half.
- Return `{ kind: 'none' }` for a `released` next → the "reads the ending off the events" test goes red.

Restore after each.

- [ ] **Step 8: Run the frontend suite and commit**

Run: `pnpm -C apps/frontend test && pnpm typecheck`
Expected: PASS. Existing `drawBeat`/`board` tests that fed an AI batch and expected a `draw` plan now expect an `aiEvent`; update them — that is the behaviour change, not a regression.

```bash
git add apps/frontend/src/features/board-beats/planBeats.ts apps/frontend/src/features/board-beats/planBeats.test.ts apps/frontend/src/features/board-beats/useBeats.ts
git commit -m "feat(web): an AI trigger is its own scene, claimed whole from the pile (#106)"
```

---

### Task 5: The board's three slots, and the card that stands behind a prompt

A flight cannot aim at a node that is not there, so the slots come before the beat that uses them. Three of them: `cause` (the trigger, left of centre), `effect` (the AI card, wider than the rest — it is the card of the moment and the table reads it), and `picked` (Bad Vibe's given-up card, to the right of the AI card).

They are positioned from `centrePlaceStyle`, which is the declared single source for centre geometry, rather than by new literals in the board's CSS module. Say plainly what you are *not* doing: the board's four **existing** centre slots duplicate `centre.ts`'s numbers as literals (`_Board.module.css:74-102` — `-92px`, `+92px`, `-180px`, `42%`). Migrating four shipped, approved slots is not this task's business. Adding three more copies to keep them company is how a duplication becomes a convention, so the new ones read the source and the old drift goes to the register (Task 12).

The `effect` slot also does a second job. While a `crush`, `neutralize503`, `handLimit` or `pickFromDiscard` pending carries a `source`, it stands `cardById(pending.source)` for **every** peer — the render that carries the AI card across the batch gap, and the reason the `standing` ending is only an entrance. This is the same shape `giveCard`'s public centre card already has at `_Board.tsx:1274`.

**Files:**
- Modify: `apps/frontend/src/entities/game/board/anchors.ts` (four new refs)
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx` (three slots; the events pile's `boxRef` at `:1065`)
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.module.css` (what all three slots share, and only that)
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/boardAnchors.test.tsx` and a new `boardAi.test.tsx`

**Interfaces:**
- Consumes: `TablePending.source` (Task 1).
- Produces: `BoardAnchors.cause`, `.effect`, `.picked` (`RefObject<HTMLDivElement | null>`) and `.eventsBox` (the events pile's card box, same shape as `.discardBox`). Used by Tasks 6-9.
- Produces: `data-testid="board-ai-effect"` on the standing card, `data-centre-slot="cause" | "effect" | "picked"` on the slots.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/pages/board/[gameId]/__tests__/boardAi.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderBoard, stateWith } from './fixture'

describe('the AI pair at the centre', () => {
  it('mounts all three slots for the whole life of the board', () => {
    renderBoard(stateWith({}))
    for (const slot of ['cause', 'effect', 'picked']) {
      expect(document.querySelector(`[data-centre-slot="${slot}"]`)).not.toBeNull()
    }
  })

  it('stands the AI card behind a prompt, for a peer who is not the one asked', () => {
    renderBoard(
      stateWith({
        selfId: 'p2',
        pending: {
          kind: 'crush',
          player: 'p1',
          slot: 'frontend',
          methods: ['debugger'],
          source: 'ai-crush-frontend',
        },
      }),
    )
    expect(screen.getByTestId('board-ai-effect')).toBeInTheDocument()
  })

  it('stands nothing when the prompt carries no source', () => {
    renderBoard(
      stateWith({
        pending: { kind: 'handLimit', player: 'p1', excess: 2, options: [] },
      }),
    )
    expect(screen.queryByTestId('board-ai-effect')).toBeNull()
  })
})
```

Use the `__tests__/fixture.ts` helpers the sibling board tests already use (`boardHandLimit.test.tsx` is the nearest example); the two names above are placeholders for whatever it exports.

Append to `boardAnchors.test.tsx`:

```tsx
it('binds the events pile so a card can fly home to it', () => {
  renderBoard(stateWith({}))
  expect(document.querySelector('[data-events-box]')).not.toBeNull()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C apps/frontend test -- boardAi boardAnchors`
Expected: FAIL — no such slots, no `board-ai-effect`, no `data-events-box`.

- [ ] **Step 3: Add the anchors**

In `apps/frontend/src/entities/game/board/anchors.ts`, add to the interface, beside `centre`/`stage`/`cost`:

```ts
  /** the AI trigger — the cause, standing left of the card it pulled */
  cause: RefObject<HTMLDivElement | null>
  /** the AI card itself — wider than the rest, because the table reads it */
  effect: RefObject<HTMLDivElement | null>
  /** what an AI effect asked for: the card given up, standing open beside it */
  picked: RefObject<HTMLDivElement | null>
  /** the events pile's CARD box — where an event card goes home */
  eventsBox: RefObject<HTMLDivElement | null>
```

…create the four refs in `useBoardAnchors` beside the existing ones, and add all four to the returned object **and** leave the `useMemo` dependency array untouched (refs are stable, exactly as `centre`/`discardBox` already are).

- [ ] **Step 4: Render the slots and bind the events pile**

In `_Board.tsx`, import the geometry:

```ts
import { centrePlaceStyle } from '@release/ui'
```

Add the three slots beside the existing centre slots (after the `cost` slot is a good home), each positioned from the single source:

```tsx
      {/* THE AI PAIR (#106). The trigger that caused it stands left; the card
          it pulled stands right, and wider — it is the card of the moment.
          Positioned from `centrePlaceStyle`, the declared single source for
          centre geometry, rather than from literals of their own: the four
          slots above predate that source and still carry copies of its numbers
          (recorded in the register), and three more copies is how a duplication
          becomes the house style. */}
      <div
        className={opening.aiSlot}
        data-centre-slot="cause"
        style={centrePlaceStyle('ai', 'cause')}
        ref={anchors.cause}
      />
      <div
        className={opening.aiSlot}
        data-centre-slot="effect"
        style={centrePlaceStyle('ai', 'effect')}
        ref={anchors.effect}
      >
        {/* The card standing behind a prompt, held publicly while the engine
            waits for an answer. This is what carries it across the gap between
            the batch that revealed it and the batch that answers — they are
            different batches, so no beat overlay can span it, and `source` is
            public on every one of the four pendings that can raise it. */}
        {aiStanding && (
          <div className={opening.aiCard} data-testid="board-ai-effect">
            <Card card={aiStanding} interactive={false} width="100%" />
          </div>
        )}
      </div>
      <div
        className={opening.aiSlot}
        data-centre-slot="picked"
        style={centrePlaceStyle('aiPick', 'picked')}
        ref={anchors.picked}
      />
```

…with the derivation up beside the other `pending` reads (near `pendingAlarm` at `:387`):

```ts
  // The AI card a prompt belongs to — `source` on `crush`, `neutralize503`,
  // `handLimit` and `pickFromDiscard`. Public on all four: the whole table
  // watched the card be revealed, so every peer stands the same one.
  const aiStanding = state.pending?.source ? (cardById(state.pending.source) ?? null) : null
```

And give the events pile at `:1065` its box ref, matching the discard pile's own line:

```tsx
          <Pile
            label={copy.table.events}
            deck="ai"
            count={decks.events}
            width={150}
            countPos="tl"
            boxRef={anchors.eventsBox}
            data-events-box
          />
```

If `Pile` does not forward unknown props, put `data-events-box` on a wrapping `<div ref={anchors.eventsBox}>` instead and drop `boxRef` — read `Pile`'s props before choosing.

- [ ] **Step 5: Add only what all three slots share**

In `_Board.module.css` — everything that differs comes from `centrePlaceStyle`, so this is deliberately three lines:

```css
/* The AI pair's slots (#106). Position, width and layer all arrive inline from
   `centrePlaceStyle` — the single source in `TableCentre/centre.ts`. What stays
   here is only what every centre place shares, plus the rule that an empty one
   is not a target. */
.aiSlot {
  position: absolute;
  aspect-ratio: var(--card-aspect);
}

.aiCard {
  inline-size: 100%;
}
```

…and add `.aiSlot:empty` to the existing `:empty { pointer-events: none }` group at `:167`.

- [ ] **Step 6: Run them to verify they pass**

Run: `pnpm -C apps/frontend test -- boardAi boardAnchors`
Expected: PASS.

- [ ] **Step 7: Verify by mutation, then commit**

Change `state.pending?.source` to `undefined` and confirm the "stands the AI card behind a prompt" test goes red. Restore.

Run: `pnpm -C apps/frontend test && pnpm typecheck && pnpm lint`

```bash
git add apps/frontend/src/entities/game/board/anchors.ts "apps/frontend/src/pages/board/[gameId]/_Board.tsx" "apps/frontend/src/pages/board/[gameId]/_Board.module.css" "apps/frontend/src/pages/board/[gameId]/__tests__"
git commit -m "feat(web): the centre makes room for the AI pair, and holds it while a prompt stands (#106)"
```

---

### Task 6: `aiBeat` — the file, the opening, and the queue wiring

The opening is common to all six endings, so it lands with the file and with one ending to prove it: `zone`, the simplest, where the AI card settles into a release slot and **stays** — no return home, because the batch said `released`/`placed` and that is what standing on the table looks like from outside.

**Files:**
- Create: `apps/frontend/src/features/board-beats/aiBeat.tsx`
- Create: `apps/frontend/src/features/board-beats/aiBeat.test.tsx`
- Modify: `apps/frontend/src/features/board-beats/useBeats.ts` (the runner, the `beatOf` arm, the deps, the match-boundary reset, the overlay)
- Modify: `apps/frontend/src/features/board-beats/index.ts` (barrel)

**Interfaces:**
- Consumes: `useToCentre`, `TABLE_HOLD`, `HALLUCINATION_HOLD` (Task 2); the `aiEvent` plan (Task 4); `anchors.cause`, `.effect`, `.eventsBox` (Task 5).
- Produces: `useAiBeat(anchors: BoardAnchors)` → `{ overlay: ReactNode[], run, reset }`, where `run(plan, ctx: BeatRun): Promise<void>`.
- **Produces: the shared beat-test harness**, `apps/frontend/src/features/board-beats/testing.tsx`, exporting `anchorsFixture(overrides?)`, `renderBeat(hook)`, `runBeat(run, plan, anchors, opts?)`, `playedNames()` and `boxed(left, top)`. Tasks 7, 8 and 9 all use it, and no other task creates it. Build it by lifting whichever of `transferBeat.test.tsx` / `handLimitBeat.test.tsx` has the closer harness — do not invent a third shape. If the two disagree in a way that matters, say so in your report rather than picking silently.
- Produces: flyer keys `'trig'` (the trigger), `'eff'` (the AI card), `'crushed'` (Task 7). One key is one flyer; raising the same key twice replaces the carrier.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/features/board-beats/aiBeat.test.tsx`:

```tsx
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAiBeat } from './aiBeat'
import { anchorsFixture, runBeat } from './testing'

describe('aiBeat', () => {
  it('brings the trigger and the card it pulled to their own places, then settles the release', async () => {
    const anchors = anchorsFixture()
    const plan = {
      kind: 'aiEvent' as const,
      key: 'ai:1',
      eventId: 1,
      player: 'p1',
      pile: 0,
      trigger: 'trigger-ai',
      triggerDiscardId: 3,
      eventCard: 'ai-release-frontend',
      tail: { kind: 'zone' as const, slot: 'frontend', card: 'release-frontend' },
    }
    const played = vi.fn()
    const { result } = renderBeat(() => useAiBeat(anchors))
    await act(() => runBeat(result.current.run, plan, anchors))
    // the trigger left for the heap on its own event id's scatter (I7)
    expect(anchors.exitSpy).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ key: 'd3' })]),
    )
    // the AI card went to the slot and NOT to the events deck
    expect(played.mock.calls.map((c) => c[0])).toContain('playToReleaseZone')
    expect(played.mock.calls.map((c) => c[0])).not.toContain('returnToDeck')
  })
})
```

There is no `./testing` module in `board-beats` today, and creating it is part of this task (see **Interfaces**) — Tasks 7, 8 and 9 import the same five helpers. Lift the shape from whichever of `transferBeat.test.tsx` / `handLimitBeat.test.tsx` is closer; both currently inline their harnesses, so this is an extraction rather than an invention. `playedNames()` returns the preset names passed to `play()` in call order, which is what Tasks 7 and 8 assert on.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C apps/frontend test -- aiBeat`
Expected: FAIL — `Cannot find module './aiBeat'`.

- [ ] **Step 3: Write the runner**

Create `apps/frontend/src/features/board-beats/aiBeat.tsx`:

```tsx
import { cardAreaOf, cardById } from '@release/ui'
import type { Rect } from '@release/ui/animations'
import { play, scatterAt, useDiscardExit, useHandArrival, wait } from '@release/ui/animations'
import { useCallback, useRef } from 'react'
import type { BeatRun, BoardAnchors } from '~/entities/game/board'
import type { BeatPlan } from './planBeats'
import { HALLUCINATION_HOLD, TABLE_HOLD, useToCentre } from './toCentre'

// AN AI CARD, from the pile to whatever it turns out to mean.
//
// One scene with six endings, and it is one runner because the opening is one
// opening: a trigger comes off a draw pile and stands at the left as the CAUSE,
// the events deck gives up the card that explains it, and both are held long
// enough to be read. Only then do the endings differ.
//
// What must not be re-derived here is the ending. The plan read it off the
// events the engine actually emitted; a runner that looked at `eventCard` and
// decided for itself what an `ai-crush-frontend` does would be a second opinion
// about the rules, free to drift from the first.

const FLIP_MS = 420 // `flipCard`'s own duration
const BEFORE_FLIP = 220 // the card rests where it landed before it turns over
const AFTER_FLIP = 560 // the flip, plus a pause to read it by

// One key is one flyer: raising a key that is still up replaces the carrier
// rather than hanging a second node on the same name.
const TRIG = 'trig'
const EFF = 'eff'

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export function useAiBeat(anchors: BoardAnchors) {
  const { overlay: flyerOverlay, raise, pin, patch, drop, elOf, toSlot } = useToCentre()
  const exit = useDiscardExit(anchors.discardBox)
  const ctx = useRef<BeatRun | null>(null)

  const {
    overlay: handOverlay,
    gapAt,
    gapSize,
    arrive,
    reset: resetArrival,
  } = useHandArrival(anchors.hand, (gap, landed) => {
    const c = ctx.current
    if (!c) return
    const hand = [...c.base.you.hand]
    hand.splice(gap, 0, ...landed.map((it) => ({ uid: it.key, card: it.card })))
    const next = { ...c.base, you: { ...c.base.you, hand } }
    c.base = next
    c.publish(next)
  })

  const latest = useRef({ anchors, exit, arrive })
  latest.current = { anchors, exit, arrive }

  // A card leaves the table for the events deck. It turns face down first — the
  // way every card entering play turns face up first — and then shrinks back
  // into the pile it came from.
  const goHome = useCallback(
    async (key: string, from: Rect | null) => {
      patch(key, { faceDown: true })
      await wait(FLIP_MS)
      const el = elOf(key)
      const deck = rectOf(latest.current.anchors.eventsBox.current)
      if (!el || !from || !deck) return
      const anim = play('returnToDeck', el, { from, to: cardAreaOf(deck) })
      if (anim) await anim.finished
    },
    [patch, elOf],
  )

  const run = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'aiEvent' }>, beat: BeatRun) => {
      ctx.current = beat
      const a = latest.current.anchors
      const trigger = cardById(plan.trigger)
      const event = cardById(plan.eventCard)
      const pile = rectOf(a.pileBox(plan.pile))
      const cause = rectOf(a.cause.current)
      const effect = rectOf(a.effect.current)
      const events = rectOf(a.eventsBox.current)
      if (!trigger || !event || !pile || !cause || !effect || !events) return

      // 1. the trigger comes off the pile and stands as the cause
      await toSlot({ key: TRIG, card: trigger, from: cardAreaOf(pile), to: cause })
      await wait(BEFORE_FLIP)
      patch(TRIG, { faceDown: false })
      await wait(AFTER_FLIP)

      // 2. the events deck gives up the card that explains it
      await toSlot({ key: EFF, card: event, from: cardAreaOf(events), to: effect })
      await wait(BEFORE_FLIP)
      patch(EFF, { faceDown: false })
      await wait(AFTER_FLIP)

      // 3. the table reads them. Hallucination lingers twice as long — the
      //    scene's own doubling, not a judgement made here.
      await wait(plan.eventCard === 'ai-hallucination' ? HALLUCINATION_HOLD : TABLE_HOLD)

      // 4. the trigger goes to the heap, on the scatter its own event id
      //    produces — one value, two readers (I7), so the heap rests it exactly
      //    where the flight put it.
      const triggerOut =
        plan.triggerDiscardId >= 0
          ? latest.current.exit
              .send([
                {
                  key: `d${plan.triggerDiscardId}`,
                  card: trigger,
                  node: elOf(TRIG),
                  scatter: scatterAt(plan.triggerDiscardId),
                },
              ])
              .then(() => drop(TRIG))
          : Promise.resolve()

      // 5. …and the AI card takes the road its ending gives it.
      const effectOut = (async () => {
        if (plan.tail.kind === 'zone') {
          const slot = rectOf(a.releaseSlot(plan.player, plan.tail.slot))
          const el = elOf(EFF)
          if (el && slot) {
            const anim = play('playToReleaseZone', el, { from: effect, to: slot })
            if (anim) await anim.finished
          }
          // It STAYS. No return home: the batch said `released`/`placed`, which
          // is what standing on the table looks like from outside the engine.
          drop(EFF)
          return
        }
        await goHome(EFF, effect)
        drop(EFF)
      })()

      await Promise.all([triggerOut, effectOut])
    },
    [toSlot, patch, drop, elOf, goHome],
  )

  const reset = useCallback(() => {
    drop()
    resetArrival()
    ctx.current = null
  }, [drop, resetArrival])

  return { overlay: [...flyerOverlay, ...handOverlay], gapAt, gapSize, run, reset }
}
```

- [ ] **Step 4: Wire it into the queue**

In `useBeats.ts`: `const ais = useAiBeat(anchors)` beside `const transfers = …`; an arm in `beatOf`

```ts
      if (plan.kind === 'aiEvent') {
        return {
          key: plan.key,
          base,
          // Not exclusive: an AI card is read, not obeyed, and nothing about it
          // needs input dead.
          exclusive: false,
          // The 503 mimic's own glow. A `standing` tail carries it too, because
          // the alarm is owed for as long as the prompt is — same field, same
          // reason, as `draw`'s `neutralized` case.
          alarm: plan.tail.kind === 'alarm' || plan.tail.alarm === true,
          run: (ctx) => ais.run(plan, ctx),
        }
      }
```

…`ais.run` in `beatOf`'s dependency array, `ais.reset()` in the match-boundary effect beside the others, and `...ais.overlay` in the returned `overlays`.

`gapAt`/`gapSize` gain a third contributor for Task 11's Inside arrival; leave them alone for now and extend in that task.

In `index.ts`, add `export { useAiBeat } from './aiBeat'` and `AiTail` to the exported types from `./planBeats`.

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm -C apps/frontend test -- aiBeat`
Expected: PASS.

- [ ] **Step 6: Verify by mutation, then commit**

Delete the `if (plan.tail.kind === 'zone')` early return so the zone tail falls through to `goHome`, and confirm the test's `not.toContain('returnToDeck')` goes red. Restore.

Run: `pnpm -C apps/frontend test && pnpm typecheck`

```bash
git add apps/frontend/src/features/board-beats
git commit -m "feat(web): the AI pair arrives, is read, and the release it grants stays (#106)"
```

---

### Task 7: The crush ending — a destroyed card takes its own road

Crush destroys the matching release. The AI card goes home either way; what differs is the **destroyed** card, and this is the ending #71 exists for. An AI release returns to the events deck; an ordinary one goes to the common discard. The board could not tell them apart until Tasks 1 and 3, and `planBeats` has already decided it — the runner reads `plan.tail.destination` and never re-derives it.

**Files:**
- Modify: `apps/frontend/src/features/board-beats/aiBeat.tsx`
- Modify: `apps/frontend/src/features/board-beats/aiBeat.test.tsx`

**Interfaces:**
- Consumes: `AiTail`'s `crush` variant (Task 4).
- Produces: flyer key `'crushed'`.

- [ ] **Step 1: Write the failing tests — the pair that matters**

Append to `aiBeat.test.tsx`, inside the same `describe`:

```tsx
  const crushPlan = (destination: 'events' | 'discard') => ({
    kind: 'aiEvent' as const,
    key: 'ai:1',
    eventId: 1,
    player: 'p1',
    pile: 0,
    trigger: 'trigger-ai',
    triggerDiscardId: 3,
    eventCard: 'ai-crush-frontend',
    tail: { kind: 'crush' as const, slot: 'frontend', card: 'release-frontend', destination },
  })

  it('sends a destroyed AI release home and never to the heap', async () => {
    const anchors = anchorsFixture({ release: { 'p1:frontend': boxed(100, 100) } })
    const { result } = renderBeat(() => useAiBeat(anchors))
    await act(() => runBeat(result.current.run, crushPlan('events'), anchors))
    // two cards go home: the AI card, and the release it destroyed
    expect(playedNames()).toEqual(expect.arrayContaining(['returnToDeck']))
    // the ONLY thing in the heap is the trigger
    const keys = anchors.exitSpy.mock.calls.flat(2).map((c: { key: string }) => c.key)
    expect(keys).toEqual(['d3'])
  })

  it('sends a destroyed ordinary release to the heap', async () => {
    const anchors = anchorsFixture({ release: { 'p1:frontend': boxed(100, 100) } })
    const { result } = renderBeat(() => useAiBeat(anchors))
    await act(() => runBeat(result.current.run, crushPlan('discard'), anchors))
    const keys = anchors.exitSpy.mock.calls.flat(2).map((c: { key: string }) => c.key)
    expect(keys).toEqual(expect.arrayContaining(['d3', 'crushed']))
  })
```

The second assertion in the first test is the load-bearing one, and it is written as an exact equality on purpose: "the heap received only the trigger" is what a later refactor breaks by accident, and `arrayContaining` would not notice.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C apps/frontend test -- aiBeat`
Expected: FAIL — the crush tail falls through to the generic `goHome` and nothing raises the destroyed card at all.

- [ ] **Step 3: Add the leg**

In `aiBeat.tsx`, add the key beside the other two:

```ts
const CRUSHED = 'crushed' // the release a crush destroys — its own carrier, its own road
```

…and inside `run`, between step 3 (the hold) and step 4 (the trigger's exit), raise the destroyed card where it stands so it leaves from its own slot rather than from the centre:

```ts
      // The destroyed release becomes a flyer exactly where it stands, and the
      // zone lets go of it in the same commit — a card cannot be in a slot and
      // in the air at once.
      let crushedFrom: Rect | null = null
      if (plan.tail.kind === 'crush') {
        const card = cardById(plan.tail.card)
        crushedFrom = rectOf(a.releaseSlot(plan.player, plan.tail.slot))
        if (card && crushedFrom) await raise([{ key: CRUSHED, card, at: crushedFrom }])
      }
```

…then extend step 5's `effectOut` block with the destroyed card's own road, run alongside it:

```ts
      const crushedOut = (async () => {
        if (plan.tail.kind !== 'crush' || !crushedFrom) return
        const card = cardById(plan.tail.card)
        if (!card) return
        // Its road is the plan's answer, not one worked out here: the fact lives
        // on the pre-batch projection (`releaseEvent`), which the runner cannot
        // see and the plan already read (#71 — the class of bug this closes).
        if (plan.tail.destination === 'events') {
          await goHome(CRUSHED, crushedFrom)
          drop(CRUSHED)
          return
        }
        await latest.current.exit.send([
          { key: CRUSHED, card, node: elOf(CRUSHED), scatter: scatterAt(plan.eventId) },
        ])
        drop(CRUSHED)
      })()

      await Promise.all([triggerOut, effectOut, crushedOut])
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -C apps/frontend test -- aiBeat`
Expected: PASS, all three.

- [ ] **Step 5: Verify by mutation, then commit**

Change the `destination === 'events'` branch to fall through to the discard exit and confirm the exact-equality assertion goes red. Restore.

```bash
git add apps/frontend/src/features/board-beats/aiBeat.tsx apps/frontend/src/features/board-beats/aiBeat.test.tsx
git commit -m "feat(web): a crushed release goes where it actually goes (#106)"
```

---

### Task 8: The endings that leave a prompt standing

Four of the seven raise a pending — crush (answerable), the 503 mimic, Bad Vibe, and Inside — and for those the AI card must **stay** on the table, because it is what explains the prompt. The trigger does not: the engine banks it immediately, so holding it across the gap would contradict a projection that already has it in the heap, which is precisely what `drawBeat`'s own header forbids.

That asymmetry is deliberate and is the one place this task diverges from `AiCardsStory`, which leaves everything at once. It goes to the register rather than being quietly smoothed over (Task 12). The AI card gets away with standing because `decks.events` is projected as a **count**, not as identified cards: standing it costs the counter one and contradicts nothing visible.

`turnEnded`, `alarm` and `none` all leave together, so they need no code beyond what Task 6 already wrote — but they need tests, because "the default branch happens to be right" is not a thing anyone can see.

**Files:**
- Modify: `apps/frontend/src/features/board-beats/aiBeat.tsx`
- Modify: `apps/frontend/src/features/board-beats/aiBeat.test.tsx`

**Interfaces:**
- Consumes: `AiTail`'s `standing`, `alarm`, `turnEnded`, `none` variants (Task 4).
- Produces: nothing new. The `standing` ending leaves the `EFF` carrier down and the `effect` slot holding the projection's own render (Task 5).

- [ ] **Step 1: Write the failing tests**

```tsx
  const standingPlan = {
    kind: 'aiEvent' as const,
    key: 'ai:1',
    eventId: 1,
    player: 'p1',
    pile: 0,
    trigger: 'trigger-ai',
    triggerDiscardId: 3,
    eventCard: 'ai-bad-vibe-coding',
    tail: { kind: 'standing' as const },
  }

  it('lets the trigger go and leaves the AI card standing when a prompt is owed', async () => {
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    await act(() => runBeat(result.current.run, standingPlan, anchors))
    // the trigger was filed…
    const keys = anchors.exitSpy.mock.calls.flat(2).map((c: { key: string }) => c.key)
    expect(keys).toEqual(['d3'])
    // …and the AI card neither followed it nor went home
    expect(playedNames()).not.toContain('returnToDeck')
  })

  it('takes both away when nothing is owed', async () => {
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    await act(() =>
      runBeat(result.current.run, { ...standingPlan, tail: { kind: 'none' as const } }, anchors),
    )
    expect(playedNames()).toContain('returnToDeck')
  })

  it('holds Hallucination twice as long as anything else', async () => {
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    const waited: number[] = []
    await act(() =>
      runBeat(
        result.current.run,
        { ...standingPlan, eventCard: 'ai-hallucination', tail: { kind: 'turnEnded' as const } },
        anchors,
        { onWait: (ms: number) => waited.push(ms) },
      ),
    )
    expect(waited).toContain(HALLUCINATION_HOLD)
    expect(waited).not.toContain(TABLE_HOLD)
  })
```

The third test needs the harness to observe `wait`; if the existing sibling harnesses use fake timers instead of a spy, follow theirs and assert on the advanced time.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C apps/frontend test -- aiBeat`
Expected: FAIL on the first — the AI card currently goes home for every non-`zone` ending, `standing` included.

- [ ] **Step 3: Add the branch**

Replace `effectOut`'s tail in `aiBeat.tsx`:

```ts
      const effectOut = (async () => {
        if (plan.tail.kind === 'zone') {
          const slot = rectOf(a.releaseSlot(plan.player, plan.tail.slot))
          const el = elOf(EFF)
          if (el && slot) {
            const anim = play('playToReleaseZone', el, { from: effect, to: slot })
            if (anim) await anim.finished
          }
          drop(EFF)
          return
        }
        // IT STANDS. A prompt is owed and this card is what explains it, so the
        // carrier is simply dropped where it landed and the projection's own
        // render takes the slot (`_Board.tsx`'s `aiStanding`, off
        // `pending.source`). Its journey home belongs to the batch that answers
        // the prompt, not to this one.
        //
        // The trigger does NOT get the same treatment, and the difference is
        // not a preference: the engine banks it in this very batch, so holding
        // it would contradict a projection that already has it in the heap. The
        // AI card can stand because `decks.events` is projected as a count —
        // one fewer, and nothing on screen disagrees.
        if (plan.tail.kind === 'standing') {
          await nextFrames() // the projection's render is up before the carrier lets go (I2)
          drop(EFF)
          return
        }
        await goHome(EFF, effect)
        drop(EFF)
      })()
```

…and add `nextFrames` to the `@release/ui/animations` import.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -C apps/frontend test -- aiBeat`
Expected: PASS, all six.

- [ ] **Step 5: Verify by mutation, then commit**

Remove the `standing` branch so it falls through to `goHome`, and confirm the first test goes red. Restore.

```bash
git add apps/frontend/src/features/board-beats/aiBeat.tsx apps/frontend/src/features/board-beats/aiBeat.test.tsx
git commit -m "feat(web): the card that raised a prompt stays on the table to explain it (#106)"
```

---

### Task 9: The road home, and the flight that was already wrong

An AI card left standing has to leave eventually, and the batch that answers its prompt is when. The leg is added to whatever plan that batch already makes — `neutralized`, `handLimit` or `takenFromDiscard` — and selected off the pre-batch projection with a plain equality, the same way #105 selected `named`: `base.pending?.source` names the card, and `base` is by definition the projection that still had the prompt open (I1).

One existing flight is fixed by the same fact. `defenseBeat.runNeutralized` flies a **sacrificed** release into the discard heap where it never really lands, because the events deck has already taken it — `docs/animations/backlog.md:1062` records exactly this. Now that `releaseEvent` exists, that leg can ask.

**Files:**
- Modify: `apps/frontend/src/features/board-beats/planBeats.ts` (a `homeward?: string` field on the three plan kinds)
- Modify: `apps/frontend/src/features/board-beats/defenseBeat.tsx` (`runNeutralized` — the road home, and the sacrifice fix)
- Modify: `apps/frontend/src/features/board-beats/handLimitBeat.tsx` (the road home)
- Test: `apps/frontend/src/features/board-beats/planBeats.test.ts`, `defenseBeat.test.tsx`

**Interfaces:**
- Consumes: `base.pending.source` (Task 1), `releaseEvent` (Task 3), `goHome`'s movement (Task 6 — `returnToDeck`).
- Produces: `homeward?: string` on the `neutralized`, `handLimit` and `takenFromDiscard` plans — the AI card id to send back to the events deck as part of this beat. Absent means there is none.

- [ ] **Step 1: Write the failing tests**

In `planBeats.test.ts`:

```ts
it('sends the standing AI card home on the batch that answers its prompt', () => {
  const before = boardFixture({
    pending: { kind: 'crush', player: 'p1', slot: 'frontend', methods: ['debugger'], source: 'ai-crush-frontend' },
  })
  const plans = planBeats(
    [
      { id: 10, type: 'neutralized', player: 'p1', method: 'debugger' },
      { id: 11, type: 'discarded', player: 'p1', card: 'protection-debugger', reason: 'neutralized' },
    ],
    before,
  )
  expect(plans.find((p) => p.kind === 'neutralized')).toMatchObject({ homeward: 'ai-crush-frontend' })
})

it('adds no road home when the prompt was nobody's AI card', () => {
  const before = boardFixture({
    pending: { kind: 'neutralize503', player: 'p1', card: 'trigger-error-503', methods: ['debugger'] },
  })
  const plans = planBeats(
    [
      { id: 10, type: 'neutralized', player: 'p1', method: 'debugger' },
      { id: 11, type: 'discarded', player: 'p1', card: 'protection-debugger', reason: 'neutralized' },
    ],
    before,
  )
  expect(plans.find((p) => p.kind === 'neutralized')).not.toHaveProperty('homeward')
})
```

In `defenseBeat.test.tsx`:

```tsx
it('returns a sacrificed AI release to the events deck instead of the heap', async () => {
  // docs/animations/backlog.md:1062 — this flight has been wrong since #102
  const anchors = anchorsFixture({ release: { 'p1:frontend': boxed(100, 100) } })
  const plan = neutralizedPlan({
    method: 'sacrifice',
    destroyed: { slot: 'frontend', card: 'release-frontend', destination: 'events' as const },
  })
  const { result } = renderBeat(() => useDefenseBeat(anchors, stagingRef()))
  await act(() => runBeat(result.current.runNeutralized, plan, anchors))
  expect(playedNames()).toContain('returnToDeck')
  const keys = anchors.exitSpy.mock.calls.flat(2).map((c: { key: string }) => c.key)
  expect(keys).not.toContain('sacrificed')
})
```

Read `defenseBeat.tsx`'s existing `neutralized` plan shape first and give `neutralizedPlan` the fields it really has; `destination` is the field this task adds to its destroyed-release half, mirroring `AiTail`'s `crush`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C apps/frontend test -- planBeats defenseBeat`
Expected: FAIL — no `homeward` on any plan, and the sacrifice leg unconditionally uses the discard exit.

- [ ] **Step 3: Plan the road home**

In `planBeats.ts`, add the field to the three plan kinds:

```ts
    /**
     * The AI card standing behind the prompt this batch answers, on its way back
     * to the events deck. Selected off the pre-batch projection — `before.pending`
     * is by definition the projection that still had the prompt open (I1) — with a
     * plain equality rather than a rule reconstructed from card ids, the same way
     * `handTransfer`'s `named` is selected (#105).
     *
     * The card does not fly home in the beat that revealed it, because it has to
     * stand and explain the prompt. This is where it goes.
     */
    homeward?: string
```

…and set it where each of the three plans is pushed:

```ts
const homewardOf = (before: BoardState): { homeward?: string } =>
  before.pending?.source ? { homeward: before.pending.source } : {}
```

`neutralized` and `handLimit` spread `...homewardOf(before)`; the `takenFromDiscard` plan gets it in Task 11 when that plan is created.

Extend the `neutralized` plan's destroyed-release half with `destination`, read the same way `AiTail`'s crush reads it — `releaseEventsOf(before, player)?.[slot] !== undefined ? 'events' : 'discard'`.

- [ ] **Step 4: Fly it**

In `defenseBeat.tsx`'s `runNeutralized` and `handLimitBeat.tsx`'s runner, add the same closing leg. Both files already have a flyer and `anchors`; add the same `goHome`-shaped helper rather than importing one from `aiBeat` (that hook owns a different carrier):

```ts
      // The AI card that raised this prompt goes home now that the prompt is
      // answered. It has been standing on the projection's own render
      // (`_Board.tsx`'s `aiStanding`) since the batch that revealed it.
      if (plan.homeward) {
        const card = cardById(plan.homeward)
        const from = rectOf(anchors.effect.current)
        const deck = rectOf(anchors.eventsBox.current)
        if (card && from && deck) {
          const [el] = await raise([{ key: 'homeward', card, at: from }])
          if (el) {
            patch('homeward', { faceDown: true })
            await wait(420)
            const anim = play('returnToDeck', el, { from, to: cardAreaOf(deck) })
            if (anim) await anim.finished
          }
          drop('homeward')
        }
      }
```

And in `runNeutralized`'s sacrifice branch, branch the destroyed release on `destination` — the leg
written out rather than pointed at, because you may be reading this task without having read Task 7:

```ts
      // A sacrificed release takes its own road, and until now it always took
      // the wrong one for an AI card: the heap, where it never really landed,
      // because `bankToDiscard` had already sent it back to the events deck
      // (docs/animations/backlog.md:1062). The plan read the answer off the
      // pre-batch projection; nothing here re-derives it.
      if (destroyed.destination === 'events') {
        patch('sacrificed', { faceDown: true })
        await wait(420)
        const el = elOf('sacrificed')
        const deck = rectOf(anchors.eventsBox.current)
        if (el && slotRect && deck) {
          const anim = play('returnToDeck', el, { from: slotRect, to: cardAreaOf(deck) })
          if (anim) await anim.finished
        }
        drop('sacrificed')
      } else {
        await exit.send([
          {
            key: 'sacrificed',
            card,
            node: elOf('sacrificed'),
            scatter: scatterAt(destroyed.eventId),
          },
        ])
        drop('sacrificed')
      }
```

Match the flyer key and the local names (`destroyed`, `slotRect`, `card`) to whatever `runNeutralized`
already calls them — the shape is what transfers, not the identifiers.

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm -C apps/frontend test -- planBeats defenseBeat handLimitBeat`
Expected: PASS.

- [ ] **Step 6: Verify by mutation, then commit**

Make `homewardOf` always return `{}` and confirm the first plan test goes red. Force `destination` to `'discard'` and confirm the sacrifice test goes red. Restore both.

```bash
git add apps/frontend/src/features/board-beats
git commit -m "feat(web): the AI card goes home when its prompt is answered, and a sacrificed one stops landing nowhere (#106)"
```

---

### Task 10: Bad Vibe-Coding — the given-up card stands beside the AI card

Bad Vibe borrows the hand-limit prompt without its consequence (`endsTurn: false` — the seat stays put), so #104's whole surface already answers it: pull a card out of the fan, and it flies to a cell at the centre. The cell is the problem. `gridCells(1)` puts its single cell at `dx: 0, w: 150`, which sits **underneath** the `effect` slot at `dx: 82, w: 200` — the AI card would cover the card being given up.

The issue and the scene both put it to the right of the AI card instead, in `centre.ts`'s `aiPick` set. `source` is what tells the surface which shape to build, which is the second job that field does.

Everything measured stays DOM-based — `bindCell`/`cellAt` read the bound node — so only the cell's *style* changes and no flight needs touching.

**Files:**
- Modify: `apps/frontend/src/pages/board/[gameId]/_useHandLimit.tsx` (expose the shape)
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx` (position the one cell)
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/boardAi.test.tsx`

**Interfaces:**
- Consumes: `TablePending['handLimit'].source` (Task 1), `centrePlaceStyle('aiPick', 'picked')` (Task 5).
- Produces: `useHandLimit(...).aiPicked: boolean` — true while the open hand-limit prompt is an AI effect's. Everything else about the hook's return is unchanged.

- [ ] **Step 1: Write the failing test**

```tsx
it('stands Bad Vibe's given-up card beside the AI card, not under it', () => {
  renderBoard(
    stateWith({
      selfId: 'p1',
      pending: {
        kind: 'handLimit',
        player: 'p1',
        excess: 1,
        options: ['h0'],
        source: 'ai-bad-vibe-coding',
      },
    }),
  )
  // …after the first pull fixes the grid
  pullFromHand(0)
  const cell = document.querySelector('[data-grid-cell="0"]') as HTMLElement
  // the `picked` place, not the grid's centred cell
  expect(cell.style.transform).toBe(centreTransform('picked'))
})

it('keeps the ordinary hand limit on its grid', () => {
  renderBoard(
    stateWith({ selfId: 'p1', pending: { kind: 'handLimit', player: 'p1', excess: 2, options: ['h0', 'h1'] } }),
  )
  pullFromHand(0)
  const cell = document.querySelector('[data-grid-cell="0"]') as HTMLElement
  expect(cell.style.transform).not.toBe(centreTransform('picked'))
})
```

`pullFromHand` stands for whatever gesture helper `boardHandLimit.test.tsx` already uses — reuse it rather than writing a second one.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C apps/frontend test -- boardAi`
Expected: FAIL — both cells carry the grid transform.

- [ ] **Step 3: Expose the shape**

In `_useHandLimit.tsx`, beside the existing `pending` derivation:

```ts
  // Bad Vibe-Coding borrows this prompt (`source` names the AI card that raised
  // it), and its one card does NOT go to the grid: `gridCells(1)` centres its
  // cell at dx 0, underneath the AI card standing at the `effect` place. The
  // scene stands it to the RIGHT of that card instead — `centre.ts`'s `aiPick`
  // set — and this is what tells the render which of the two shapes to build.
  const aiPicked = pending?.source != null
```

…and add `aiPicked` to the returned object.

- [ ] **Step 4: Position the cell**

In `_Board.tsx`, inside the grid's `.map`, replace the inline `style` with a branch:

```tsx
                style={
                  handLimit.aiPicked
                    ? centrePlaceStyle('aiPick', 'picked')
                    : {
                        insetBlockStart: `${GRID_TOP}%`,
                        inlineSize: `${cell.w}px`,
                        transform: `translate(calc(-50% + ${cell.dx}px), calc(-50% + ${cell.dy}px))`,
                      }
                }
```

`centrePlaceStyle` supplies `insetInlineStart`, `inlineSize` and `transform` itself, so the two branches are complete alternatives rather than a merge.

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm -C apps/frontend test -- boardAi boardHandLimit`
Expected: PASS. `boardHandLimit.test.tsx` must stay green untouched — an ordinary hand limit has no `source`, so nothing about it moves.

- [ ] **Step 6: Verify by mutation, then commit**

Make `aiPicked` always true and confirm the ordinary-grid test goes red. Restore.

```bash
git add "apps/frontend/src/pages/board/[gameId]"
git commit -m "feat(web): Bad Vibe's card stands beside the AI card, not beneath it (#106)"
```

---

### Task 11: `ai-inside` — the open row, and the card that comes out of the heap

The issue calls this blocked on #61. It is not: `cards.ts:70` carries `'ai-inside': { kind: 'ai' }` and `resolveAiEvent` raises a `pickFromDiscard` pending with `picks: 1` and `releasesOnly`. What is missing is only the board surface, which `PendingPrompt` says in a comment of its own ("No case in the switch below yet renders it — that is a later task").

The choice is a **staging hook**, because `options` are gated behind `mine` (`attacks.ts:461`) and nobody else may see them. The outcome is a **beat**, because `takenFromDiscard` is public and carries the card, so the whole table watches it come out.

One divergence from the story, and it is the honest direction: the story removes its candidates from the heap while they stand in the row, because its heap is local state. The board's is the projection, and `openPickFromDiscard` leaves them in `decks.discard` until the pick resolves — so the row stands **over** an unchanged heap. Translated, not transcribed, exactly as #105 treated two scenes whose geometry belonged to a stage with no seats in it.

**Files:**
- Create: `apps/frontend/src/pages/board/[gameId]/_useInsideStaging.tsx` (+ `.module.css`)
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx` (mount it; suppress `PendingPrompt` for `pickFromDiscard`)
- Modify: `apps/frontend/src/features/board-beats/planBeats.ts` (the `takenFromDiscard` plan)
- Modify: `apps/frontend/src/features/board-beats/aiBeat.tsx` (`runTaken`), `useBeats.ts` (the arm, and `gapAt`/`gapSize`)
- Modify: `packages/translation/src/locales/{en,ru}/common.json`
- Test: `boardAi.test.tsx`, `planBeats.test.ts`, `aiBeat.test.tsx`

**Interfaces:**
- Consumes: `TablePending['pickFromDiscard']` (existing), `anchors.discardBox`, `anchors.effect` (Task 5), `homewardOf` (Task 9).
- Produces: plan `{ kind: 'takenFromDiscard'; key: string; eventId: number; player: string; card: string; mine: boolean; homeward?: string }`.
- Produces: `useInsideStaging({ state, actions, copy, enabled }) → { row: ReactNode | null }`.
- Produces: translation keys `table.insidePrompt` (the caption) in both catalogs.

- [ ] **Step 1: Write the failing tests**

In `boardAi.test.tsx`:

```tsx
it('offers the discard's releases in a row, and not the pending panel', () => {
  renderBoard(
    stateWith({
      selfId: 'p1',
      pending: {
        kind: 'pickFromDiscard',
        player: 'p1',
        options: [
          { uid: 'r1', id: 'release-frontend' },
          { uid: 'r2', id: 'release-backend' },
        ],
        picks: 1,
        source: 'ai-inside',
      },
    }),
  )
  expect(screen.getByTestId('board-inside-row')).toBeInTheDocument()
  expect(screen.queryByTestId('pending-prompt')).toBeNull()
})

it('answers a single candidate without asking, and only once', () => {
  const onResolve = vi.fn()
  const pending = {
    kind: 'pickFromDiscard' as const,
    player: 'p1',
    options: [{ uid: 'r1', id: 'release-frontend' }],
    picks: 1 as const,
    source: 'ai-inside',
  }
  const { rerender } = renderBoard(stateWith({ selfId: 'p1', pending }), { onResolve })
  rerender(stateWith({ selfId: 'p1', pending }))
  expect(onResolve).toHaveBeenCalledTimes(1)
  expect(onResolve).toHaveBeenCalledWith({ kind: 'pickFromDiscard', card: 'r1' })
  expect(screen.queryByTestId('board-inside-row')).toBeNull()
})

it('answers a single candidate under reduced motion too', () => {
  // it is a game action, not choreography: beats collapse, the engine still waits
  matchMediaReducedMotion(true)
  const onResolve = vi.fn()
  renderBoard(
    stateWith({
      selfId: 'p1',
      pending: {
        kind: 'pickFromDiscard',
        player: 'p1',
        options: [{ uid: 'r1', id: 'release-frontend' }],
        picks: 1,
        source: 'ai-inside',
      },
    }),
    { onResolve },
  )
  expect(onResolve).toHaveBeenCalledTimes(1)
})

it('shows an opponent nothing of the options', () => {
  renderBoard(
    stateWith({
      selfId: 'p2',
      pending: { kind: 'pickFromDiscard', player: 'p1', options: [], picks: 1, source: 'ai-inside' },
    }),
  )
  expect(screen.queryByTestId('board-inside-row')).toBeNull()
  // …but the AI card that asked is public, and stands
  expect(screen.getByTestId('board-ai-effect')).toBeInTheDocument()
})
```

In `planBeats.test.ts`:

```ts
it('plans the card coming out of the discard, and sends Inside's own card home with it', () => {
  const before = boardFixture({
    selfId: 'p1',
    pending: { kind: 'pickFromDiscard', player: 'p1', options: [], picks: 1, source: 'ai-inside' },
  })
  const plans = planBeats(
    [{ id: 20, type: 'takenFromDiscard', player: 'p1', card: 'release-frontend', to: 'hand' }],
    before,
  )
  expect(plans[0]).toMatchObject({
    kind: 'takenFromDiscard',
    card: 'release-frontend',
    mine: true,
    homeward: 'ai-inside',
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C apps/frontend test -- boardAi planBeats`
Expected: FAIL on every one.

- [ ] **Step 3: Write the staging hook**

Create `_useInsideStaging.tsx`, modelled on `_useRequestStaging.tsx` (read it first — the auto-resolve latch below is its `giveCard` latch, and the reasoning transfers whole):

```tsx
import type { TableActions } from '@release/ui'
import { Card, ConfirmAction, cardById } from '@release/ui'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { BoardState } from '~/entities/game/board'
import styles from './_useInsideStaging.module.css'

// Taking a Release back out of the discard — `ai-inside`, and Git Cherry-pick
// when #61 lands. Active only while a `pickFromDiscard` pending is ours; its
// siblings never run at the same time, because a pending suspends normal play
// and a pending has one kind.
//
// The options are the OWNER'S: `pendingView` gates them behind `mine`, because
// only discardTop/discardCount are ever public. So the choice lives here and
// nobody else sees it — what everybody sees is the outcome, and that is a beat.
//
// The row stands OVER an unchanged heap. `AiCardsStory` lifts its candidates
// out of the discard while they are being chosen from, because its heap is
// local state; ours is the projection, and `openPickFromDiscard` leaves them in
// `decks.discard` until the pick resolves. Honest rather than clever.

export function useInsideStaging(args: {
  state: BoardState
  actions?: TableActions
  copy: { prompt: string; confirm: string }
  enabled: boolean
}): { row: ReactNode | null } {
  const { state, actions, copy, enabled } = args
  const pending = state.pending
  const ours =
    enabled && pending?.kind === 'pickFromDiscard' && pending.player === state.selfId
      ? pending
      : null

  const [picked, setPicked] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  // ONE candidate is not a choice — #105's own precedent for `giveCard`. It is
  // answered at once rather than on a timer: the beat queue already serialises,
  // and the readable pause belongs to the beat's own hold.
  //
  // It lives here and NOT in a beat because `prefers-reduced-motion` collapses
  // every beat, and this is a game action: an engine left waiting on an
  // animation nobody plays is a stalled match.
  //
  // The latch is keyed on the pending itself, not on the mount — a latch that
  // outlives the thing it latches is a bug `useBeats` has been bitten by twice
  // in its own comments.
  const answered = useRef<string | null>(null)
  useEffect(() => {
    if (!ours) {
      answered.current = null
      return
    }
    if (ours.options.length !== 1) return
    const only = ours.options[0]
    const key = `${ours.player}:${ours.source}:${only.uid}`
    if (answered.current === key) return
    answered.current = key
    actions?.onResolve?.({ kind: 'pickFromDiscard', card: only.uid })
  }, [ours, actions])

  useEffect(() => {
    if (!ours) {
      setPicked(null)
      setConfirmed(false)
    }
  }, [ours])

  if (!ours || ours.options.length < 2 || confirmed) return { row: null }

  return {
    row: (
      <div className={styles.row} data-testid="board-inside-row">
        {ours.options.map((o) => {
          const data = cardById(o.id)
          if (!data) return null
          return (
            <button
              key={o.uid}
              type="button"
              className={styles.cell}
              onClick={() => setPicked(o.uid)}
            >
              <Card
                card={data}
                interactive={false}
                width="100%"
                state={picked === o.uid ? 'selected' : 'idle'}
                // one out of a set — the uniform selection colour, never the
                // per-category accent
                accent="var(--select-accent)"
              />
            </button>
          )
        })}
        <ConfirmAction
          open
          label={copy.confirm}
          caption={copy.prompt}
          disabled={picked == null}
          onConfirm={() => {
            // re-checked against THIS render's offer, not merely "something is
            // selected" — the discipline every branch of the kit's panel keeps
            if (!picked || !ours.options.some((o) => o.uid === picked)) return
            setConfirmed(true)
            actions?.onResolve?.({ kind: 'pickFromDiscard', card: picked })
          }}
        />
      </div>
    ),
  }
}
```

Write `_useInsideStaging.module.css` with the row's layout only — a centred flex row above the centre band, gap and cell width in px, every colour from a token.

- [ ] **Step 4: Mount it and suppress the panel**

In `_Board.tsx`: call the hook beside `requesting` at `:415`, render `{inside.row}` beside `{requesting.band}` at `:1807`, add the copy from `t('table.insidePrompt')` and the shared confirm label, and add one more line to the `PendingPrompt` suppression chain at `:1613`:

```tsx
        // the row on the table asks this one, for the same reason the others
        // above are asked by the cards themselves (#106)
        state.pending.kind !== 'pickFromDiscard' && (
```

Add `table.insidePrompt` to **both** `packages/translation/src/locales/en/common.json` and `…/ru/common.json` — EN "pick a release from the discard", RU «выберите релиз из сброса», the scene's own words.

- [ ] **Step 5: Plan and fly the outcome**

In `planBeats.ts`, a branch of its own:

```ts
    if (e.type === 'takenFromDiscard') {
      flush()
      plans.push({
        kind: 'takenFromDiscard',
        key: `taken:${e.id}`,
        eventId: e.id,
        player: e.player,
        card: e.card,
        mine: e.player === before.selfId,
        ...homewardOf(before),
      })
      continue
    }
```

In `aiBeat.tsx`, `runTaken` — one path, two audiences:

```ts
  const runTaken = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'takenFromDiscard' }>, beat: BeatRun) => {
      ctx.current = beat
      const a = latest.current.anchors
      const card = cardById(plan.card)
      const heap = rectOf(a.discardBox.current)
      const centre = rectOf(a.effect.current)
      if (!card || !heap || !centre) return
      // out of the heap and up to the centre, face up: the table is shown what
      // was taken, because `takenFromDiscard` is public and carries the card
      await toSlot({ key: EFF, card, from: cardAreaOf(heap), to: centre, faceDown: false })
      await wait(SHOW_HOLD)
      const from = rectOf(elOf(EFF))
      if (plan.mine && from) {
        drop(EFF)
        latest.current.arrive([{ key: `ins${plan.eventId}`, card, from }], beat.base.you.hand.length)
      } else {
        const seat = a.seatBox(plan.player)
        const el = elOf(EFF)
        if (el && seat) {
          const anim = play('dealToSeat', el, { from: centre, to: seat, scale: 0.7 })
          if (anim) await anim.finished
        }
        drop(EFF)
      }
      // Inside's own card goes home now that its prompt is answered. Written
      // out rather than shared with the sibling runners: each of them owns a
      // different carrier, and a carrier passed between files is how two beats
      // end up sharing one overlay by accident.
      if (plan.homeward) {
        const ai = cardById(plan.homeward)
        const deck = rectOf(a.eventsBox.current)
        if (ai && deck) {
          const [el] = await raise([{ key: 'homeward', card: ai, at: centre }])
          if (el) {
            patch('homeward', { faceDown: true })
            await wait(FLIP_MS)
            const anim = play('returnToDeck', el, { from: centre, to: cardAreaOf(deck) })
            if (anim) await anim.finished
          }
          drop('homeward')
        }
      }
    },
    [toSlot, elOf, drop],
  )
```

…with `const SHOW_HOLD = 1500` beside the other constants — `AiCardsStory`'s own value for how long a card taken from the discard is shown to everyone. Return `runTaken` from the hook, add the queue arm in `useBeats.ts` (`exclusive: false`, `alarm: false`), and extend the queue's `gapAt`/`gapSize` to consider `ais` alongside `draws` and `transfers` — one beat runs at a time, so it is a choice between three, never a merge.

- [ ] **Step 6: Run them to verify they pass**

Run: `pnpm -C apps/frontend test -- boardAi planBeats aiBeat`
Expected: PASS.

- [ ] **Step 7: Verify by mutation, then commit**

Change the auto-resolve guard to `options.length >= 1` and confirm the two-candidate row test goes red. Drop the latch key's `uid` term and confirm the "only once" test still passes but a second *distinct* pending no longer resolves — add that case if the harness makes it cheap. Restore.

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add "apps/frontend/src/pages/board/[gameId]" apps/frontend/src/features/board-beats packages/translation/src/locales
git commit -m "feat(web): Inside reaches into the discard, and the table sees what comes out (#106)"
```

---

### Task 12: The written pair, and the findings

The audit page shows the state; `docs/animations/` explains the application. They are different consumers, not duplicates, and #88's standing rules make keeping them in step part of the work rather than a follow-up. Two backlog entries **close** here and two **open**.

**Files:**
- Modify: `docs/animations/reference.md` (the beat registry)
- Modify: `docs/animations/recipes.md` (the board recipe)
- Modify: `docs/animations/backlog.md` (two closures, two new entries)
- Modify: `apps/playground/stories/AnimationAuditStory/AnimationAuditStory.tsx` (register + `board:` pointers)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code reads. `apps/ui/src/animations/docs.test.ts` enforces preset rows only, and this task adds no preset — if it goes red, you added one, and the spec says not to.

- [ ] **Step 1: Add the beat registry row**

In `docs/animations/reference.md`, beside the `draw`, `transfer` and `reshuffle` rows, an `ai` row naming the runner (`aiBeat.tsx`), what it plays (pile → `cause`, events deck → `effect`, `TABLE_HOLD`, then one of six endings), and the two facts it reads outside its batch (`releaseEvent`, `owed`).

- [ ] **Step 2: Write the board recipe**

In `docs/animations/recipes.md`, beside the existing playground recipe for the AI scene, the board one: the shared opening, the six endings in a table, and the two audiences of `takenFromDiscard`. Name the divergence from the story explicitly — the trigger leaves alone when a prompt is owed — with the reason, so the next reader does not "fix" it back.

- [ ] **Step 3: Close two backlog entries**

- **`:299` "Сколько триггер стоит в центре — значения нет"** — the owner's answer named `TABLE_HOLD = 2600` and said "the board edit is what is left". Task 2 made it. Mark `ЗАКРЫТО` in place, keeping the entry and its reasoning, the way `:1016` was closed.
- **`:1062` "Событийная карта, ушедшая домой, объявляется `discarded`"** — closed by `ReleasedView.event` (Task 1) and by the sacrifice flight it fixed (Task 9). Mark `ЗАКРЫТО` and name both.

- [ ] **Step 4: Open two**

- **The AI trigger is banked before its own effect resolves.** The rules leave everything at once (`AiCardsStory`'s `resolveGeneric`, and #106's own Bad Vibe text); `fireTrigger` files `discarded(trigger-ai)` immediately after `aiRevealed`, so once a prompt is owed the projection already has it in the heap and the board must let it go alone. What would close it: moving the banking after `resolveAiEvent`. Note that this is the same shape as `:1135`'s Security Bug entry and should be read beside it.
- **The board's four existing centre slots duplicate `centre.ts`.** `_Board.module.css:74-102` carries `-92px`, `+92px`, `-180px` and `42%` as literals, while `TableCentre/centre.ts` exists to be the single source and `centrePlaceStyle` is what the three new AI slots use. What would close it: migrating the four. Not done here because they are shipped and approved, and a restyling regression is a worse outcome than a recorded duplication.

Follow the file's own "How to write an entry" section at `:22` — title, «Что не хватает», «Чем грозит», «Что закроет», «Статус».

- [ ] **Step 5: Update the audit page**

In `AnimationAuditStory.tsx`: `board:` pointers on the AI scene entries; the `REVEAL_HOLD` register finding (`:925`) marked closed with the value that shipped; and the two new findings added with `open` status. Both languages — the register carries `ru` and `en` for every entry.

- [ ] **Step 6: Verify and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS, `docs.test.ts` included.

```bash
git add docs/animations apps/playground/stories/AnimationAuditStory
git commit -m "docs(animations): the AI scene as the board plays it (#106)"
```

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feat/106-ai-cards
gh pr create --base feat/104-hand-limit --title "AI cards on the board (#106)" --body-file -
```

Base it on `feat/104-hand-limit`, not `main` — it stacks on #131. Say so in the body, and say that it rebases onto `main` once #131 merges.

---

## Self-Review

**Spec coverage.** Every section of the design has a task:

| Spec section | Task |
|---|---|
| Decision 1 — one `aiEvent` beat owns the scene | 4, 6 |
| Decision 2 — `ReleasedView.event` | 1, 3 |
| Decision 3 — `source` on three pendings | 1 |
| Decision 4 — the ending read off the batch | 4 |
| Decision 5 — the trigger leaves when a prompt is owed | 8 |
| Decision 6 — Bad Vibe's `picked` place | 10 |
| Decision 7 — Inside's staging hook | 11 |
| Decision 8 — one candidate auto-resolves | 11 |
| Decision 9 — the new slots read `centrePlaceStyle` | 5 |
| Decision 10 — the road home rides the answering batch | 9 |
| Decision 11 — `owed` | 4 |
| The seven endings | 6 (zone), 7 (crush), 8 (turnEnded/alarm/none/standing), 10 (Bad Vibe), 11 (Inside); Good Vibe needs no task — the engine's `drawing` sequence resumes in later batches, so its draws are ordinary draw beats and a chained trigger is another `aiEvent`, which #72's fix is what makes true |
| `REVEAL_HOLD` → the scene's value | 2 |
| `defenseBeat.runNeutralized`'s wrong flight | 9 |
| Documentation and findings | 12 |

**Two things a reader should not have to discover.**

1. **Task 3 is not in the spec's architecture section, and it should have been.** The spec says the board "reads it off the pre-batch projection", which is true, but `toReleaseSlots` maps `ReleasedView` down to a catalogue `CardData` and drops everything else — so the fact needs its own carrier beside `releaseUid`, for opponents as well as for `you`. That is a real step, not an implementation detail, and it is Task 3.

2. **Good Vibe-Coding has no task on purpose.** Its two draws arrive in later batches through the engine's `drawing` sequence, so they are ordinary draw beats; a trigger among them plans as another `aiEvent`, and the beat queue serialises the two. If Good Vibe turns out to need a beat of its own, that is a discovery, and it goes in the register before it goes in the code.

**Type consistency, checked across tasks.** `AiTail` variants (`zone` / `crush` / `turnEnded` / `alarm` / `standing` / `none`) are used with the same names in Tasks 4, 6, 7 and 8. `homeward` is spelled the same in Tasks 9 and 11. `releaseEvent` is the same name in Tasks 3, 4 and 9. Flyer keys (`TRIG` / `EFF` / `CRUSHED` / `'homeward'`) do not collide, and each is one carrier. `aiPicked` (Task 10) and `aiStanding` (Task 5) are different things with deliberately different names — one is a shape for the hand-limit cell, the other is a card standing behind a prompt.

**Where this plan is deliberately thin.** The test harnesses in Tasks 6-9 are described by reference to `transferBeat.test.tsx` and `handLimitBeat.test.tsx` rather than written out, because those two files disagree about the shape and the right answer is to follow whichever is closer rather than to invent a third. If they disagree in a way that matters, say so in the review rather than picking silently.
