# Card transfers on the board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the three playground transfer scenes to the real board — name a card and take it, take one at random, and lose one of yours — driven by the engine's `requested` and `handTransfer` events instead of by a demo button.

**Architecture:** One shared surface seen from three sides. `planBeats` grows two plan kinds; a new `transferBeat` runner owns everything that flies, branching once on `role` (taker / victim / watcher) and once on whether the event carried a card at all. A new sibling staging hook owns the ask — the `CardCatalog` band that replaces `PendingPrompt` for `requestCard`, and the silent `giveCard` auto-resolve. The named card survives the gap between the two batches on the projection, not on a beat overlay, because `giveCard` is projected unredacted to every peer.

**Tech Stack:** TypeScript, React 19, Vite, Vitest + @testing-library/react, CSS Modules with design tokens, pnpm workspaces. Animation through `@release/ui/animations` (`play`, `useFlyer`, `useHandArrival`, `nextFrames`, `wait`).

**Spec:** [`docs/specs/2026-09-01-card-transfers-board-design.md`](./2026-09-01-card-transfers-board-design.md)

## Global Constraints

- **Branch:** `feat/105-card-transfers`, fresh from `main` at `9767a08`. The PR closes [#105](https://github.com/MythHand/ReleaseBoardGameP2P/issues/105). Two commits already on it: `cd907b9` (the design doc) and `25381ca` (the kit's `requestCard` guess-space fix, Decision 8 — already done, do **not** redo it).
- **`prefers-reduced-motion` is honoured everywhere.** `play()` drives WAAPI directly and does **not** check it — JS choreography asks through `useReducedMotion`; CSS uses a media query. `useBeats` already collapses every beat under it, so a runner needs no check of its own — but anything that is a **game action** rather than choreography must keep working when beats do not. The `giveCard` auto-resolve is exactly that case (Task 8).
- **No hardcoded colours.** Every colour comes from a token in `apps/ui/src/design/tokens.css` via `var(--*)`. Missing one → add the token first.
- **All user-visible text through `@release/translation`.** A key must exist in **both** `packages/translation/src/locales/en/common.json` and `…/ru/common.json`. No string literals in `.tsx`.
- **Code comments in English.** `presets.ts` and some kit files carry Russian comments; those are legacy. New comments are English.
- **Guessing about the rules is forbidden.** Anything not settled by `docs/rules/` goes to `docs/rules/backlog.md` **and** gets a `> ❓ **Не из правил.**` marker at the exact paragraph in the spec.
- **A movement found in two scenes is a module that has not been packaged yet.** Port into the shared home; never copy into a second place. Task 1 exists for precisely this reason.
- **Run into a gap — record it** in the audit page's register (`apps/playground/stories/AnimationAuditStory`) **and** `docs/animations/backlog.md`. Task 9 collects the ones this work already knows about; anything new found on the way joins them.
- **Commands:** `pnpm test` (all), `pnpm -C apps/frontend test <path>` / `pnpm -C apps/ui test <path>` (one package), `pnpm typecheck`, `pnpm lint`. A pre-commit hook runs `typecheck` and lints staged files; expect it on every commit.
- **`pnpm lint` does not work from this worktree.** `biome.json`'s `files.includes` carries `"!**/.claude/worktrees"`, and this worktree's own absolute path matches it, so biome ignores the whole tree and exits 1 with "No files were processed". Lint by explicit path instead: `npx release-lint check --error-on-warnings <paths>`. The pre-commit hook is unaffected (lint-staged passes explicit paths).
- **Timings are the stories', not new inventions.** `PICK_BEAT` 620 · `REQUEST_HOLD` 820 · `REVEAL_HOLD` 820 · `CENTER_HOLD` 820 · `MISS_HOLD` 1620 · shake `amp 9 / 460ms / spring` · `REVEAL_W` 220 · `SEAT_SHRINK` 0.7 · grid stagger 45ms.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/ui/src/animations/presets.ts` | `takeFromSeat` — the pair `dealToSeat` never had | 1 |
| `docs/animations/reference.md` | its row (test-enforced by `docs.test.ts`) | 1, 9 |
| `apps/frontend/src/features/board-beats/planBeats.ts` | two new plan kinds, pure | 2 |
| `apps/frontend/src/features/board-beats/transferBeat.tsx` | **new** — everything that flies for a transfer | 3–7 |
| `apps/frontend/src/features/board-beats/useBeats.ts` | queue wiring for the two kinds | 3, 6 |
| `apps/frontend/src/features/board-beats/index.ts` | barrel export | 3 |
| `apps/frontend/src/pages/board/[gameId]/_useRequestStaging.tsx` | **new** — the catalog band, the `giveCard` auto-resolve | 8 |
| `apps/frontend/src/pages/board/[gameId]/_Board.tsx` | prompt suppression, the band, the public centre card | 8 |
| `packages/translation/src/locales/{en,ru}/common.json` | the miss note, the catalog prompt | 6, 8 |
| `docs/animations/recipes.md`, `AnimationAuditStory`, `docs/animations/backlog.md` | the spec's written pair, and the findings | 9 |

Tasks 3–7 all edit `transferBeat.tsx`. That is deliberate: the file is one runner with one `run` per plan kind, and the legs are added one at a time so each carries its own test cycle and its own review gate. Do not split the file.

---

### Task 1: `takeFromSeat` — the movement out of a seat

`dealToSeat` sends a card from the centre into a player's seat, where it fades because it is dissolving into a hidden hand. Nothing in the vocabulary comes back *out*. Two legs in this plan need that (the taker's flight in Task 3, the watcher's in Task 5), and the deferred System Upgrade prototype throws cards seat → centre too — so by the project's own rule this is a module, not a movement to write twice.

Geometrically it is `drawToCenter`. It is still its own preset, because that one's name says it leaves the draw deck, and the vocabulary already names movements by meaning over geometry — `returnToDeck` is documented as "pair of `drawToCenter`" and exists separately for exactly this reason.

**Files:**
- Modify: `apps/ui/src/animations/presets.ts` (beside `dealToSeat`, ~line 175)
- Modify: `docs/animations/reference.md` (the presets table, after the `dealToSeat` row)
- Test: `apps/ui/src/animations/docs.test.ts` (existing — it enforces the row; no new test file)

**Interfaces:**
- Consumes: nothing.
- Produces: `play('takeFromSeat', el, { from: Rect, to: Rect, duration?: number })` → `Animation | null`. Default duration 460ms, `EASE`, no fade.

- [ ] **Step 1: Add the preset, and watch the docs test fail**

In `apps/ui/src/animations/presets.ts`, directly after the `dealToSeat` entry:

```ts
  // A card comes OUT of a player's seat to the centre — the pair of
  // dealToSeat, which dissolves a card into a hidden hand. No fade: this one
  // is arriving on the table rather than leaving it, and it is about to be
  // turned over. Geometrically the same travel as drawToCenter; kept separate
  // because that preset's name says it leaves the draw deck, and a card taken
  // out of a hand does not.
  takeFromSeat: (el: Element, p?: Record<string, unknown>): Animation | null =>
    move(el, p as MoveParams, durationOf(p, 460), EASE),
```

- [ ] **Step 2: Run the docs test to verify it fails**

Run: `pnpm -C apps/ui test -- docs`
Expected: FAIL — `expected [ 'takeFromSeat' ] to deeply equal []` from "gives every preset a row in reference.md". This is the registry noticing an undocumented preset, which is the point of the test.

- [ ] **Step 3: Add the reference row**

In `docs/animations/reference.md`, in the presets table immediately after the `dealToSeat` row:

```markdown
| `takeFromSeat` | `duration` ?? **460** | EASE | — | `{ from, to, duration? }` | a card comes out of a player seat to the center (pair of `dealToSeat`) |
```

- [ ] **Step 4: Run the docs test to verify it passes**

Run: `pnpm -C apps/ui test -- docs`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ui/src/animations/presets.ts docs/animations/reference.md
git commit -m "Add takeFromSeat, the pair dealToSeat never had (#105)"
```

---

### Task 2: `planBeats` grows `requested` and `handTransfer`

Pure, and therefore the cheapest place to pin the facts that actually matter. Three of them are derived rather than carried, and each derivation has a reason it cannot be done later:

- `role` — who this peer is to the transfer. `PlannedDraw.mine` sets the precedent.
- `named` — whether this is the Security Bug path or a random steal. The two halves of a Security Bug arrive in **different batches** (`requested{hit:true}` opens the `giveCard` pending and returns; the transfer comes from the victim's own `RESOLVE`), so nothing in the transfer's batch says so. It is read off the projection the batch animates away from: while a `giveCard` is open, `before.pending.kind === 'giveCard'`. A plain equality check against a public pending — not a rule reconstructed from card ids.
- `donorHand` — how many backs the random-steal grid deals. Off `before`, because the live projection has already taken the card out (I1).

`card` is whatever the event carried and **nothing widens it**. Absent means this peer is not entitled to the identity, and that single absence is what selects the closed flight in Task 5.

**Files:**
- Modify: `apps/frontend/src/features/board-beats/planBeats.ts` (the `BeatPlan` union ~line 66; the walk's `switch`)
- Test: `apps/frontend/src/features/board-beats/planBeats.test.ts`

**Interfaces:**
- Consumes: `BoardState` (`~/entities/game/board`), `Event` (`@release/engine`).
- Produces: two `BeatPlan` members, consumed by Tasks 3–7 and by `useBeats`:

```ts
export type TransferRole = 'taker' | 'victim' | 'watcher'

// added to BeatPlan
| { kind: 'requested'; key: string; eventId: number
    attacker: string; target: string; card: string; hit: boolean }
| { kind: 'handTransfer'; key: string; eventId: number
    from: string; to: string; card?: string
    role: TransferRole; named: boolean; donorHand: number }
```

- [ ] **Step 1: Write the failing tests**

Append to `apps/frontend/src/features/board-beats/planBeats.test.ts`. `boardBefore` and `card` already exist at the top of that file; `boardBefore`'s `selfId` is `'p1'`.

```ts
describe('card transfers', () => {
  const requested = (over: Partial<Extract<Event, { type: 'requested' }>> = {}): Event =>
    ({
      id: 1,
      type: 'requested',
      attacker: 'p1',
      target: 'p2',
      card: 'attack-bug',
      hit: true,
      ...over,
    }) as Event

  const transfer = (over: Partial<Extract<Event, { type: 'handTransfer' }>> = {}): Event =>
    ({ id: 2, type: 'handTransfer', from: 'p2', to: 'p1', card: 'attack-bug', ...over }) as Event

  it('carries a request through whole, hit or miss', () => {
    const [hit] = planBeats([requested()], boardBefore())
    expect(hit).toMatchObject({
      kind: 'requested',
      attacker: 'p1',
      target: 'p2',
      card: 'attack-bug',
      hit: true,
    })
    const [miss] = planBeats([requested({ hit: false })], boardBefore())
    expect(miss).toMatchObject({ kind: 'requested', hit: false })
  })

  it('names the role from selfId', () => {
    const taker = planBeats([transfer()], boardBefore())[0]
    expect(taker).toMatchObject({ kind: 'handTransfer', role: 'taker' })

    const victim = planBeats([transfer({ from: 'p1', to: 'p2' })], boardBefore())[0]
    expect(victim).toMatchObject({ kind: 'handTransfer', role: 'victim' })

    const watcher = planBeats([transfer({ from: 'p2', to: 'p3' })], boardBefore())[0]
    expect(watcher).toMatchObject({ kind: 'handTransfer', role: 'watcher' })
  })

  it('reads `named` off the giveCard pending, not off the batch', () => {
    // The `requested` that started a Security Bug landed in an EARLIER batch —
    // it opened the pending and returned. So the only thing in reach that says
    // this transfer was a named one is the projection the batch animates away
    // from, and it says so publicly: `giveCard` is projected unredacted.
    const named = planBeats(
      [transfer()],
      boardBefore({ pending: { kind: 'giveCard', player: 'p2', requested: 'attack-bug' } }),
    )[0]
    expect(named).toMatchObject({ kind: 'handTransfer', named: true })

    // A random steal raises no pending at all (handAttacks.ts:43 `stealRandom`).
    const random = planBeats([transfer()], boardBefore())[0]
    expect(random).toMatchObject({ kind: 'handTransfer', named: false })
  })

  it('takes the donor hand size off the pre-batch projection', () => {
    // I1: by the time the beat runs the projection has already taken the card
    // out, so a grid measured from `live` would be one back short.
    const plan = planBeats(
      [transfer()],
      boardBefore({
        opponents: [{ id: 'p2', name: 'Two', handCount: 4, release: {} }],
      }),
    )[0]
    expect(plan).toMatchObject({ kind: 'handTransfer', donorHand: 4 })
  })

  it('never widens a redacted transfer', () => {
    // THE correctness property. `handTransfer.card` is present only for the two
    // parties (handAttacks.ts sets `visibleTo: [from, to]`), and the closed
    // flight is selected by that absence — never by a rule the board re-derives
    // about who may see what. A plan that invented a card here would leak the
    // identity into the DOM for every spectator.
    const plan = planBeats([transfer({ from: 'p2', to: 'p3', card: undefined })], boardBefore())[0]
    expect(plan).toMatchObject({ kind: 'handTransfer', role: 'watcher' })
    expect((plan as Extract<BeatPlan, { kind: 'handTransfer' }>).card).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C apps/frontend test -- planBeats`
Expected: FAIL — every new case gets `undefined` for the first plan, because the walk yields no beat for these event types yet.

- [ ] **Step 3: Add the plan kinds**

In `apps/frontend/src/features/board-beats/planBeats.ts`, above the `BeatPlan` union:

```ts
/** who this peer is to a transfer — the same shape `PlannedDraw.mine` has, widened */
export type TransferRole = 'taker' | 'victim' | 'watcher'
```

Then two members on `BeatPlan`, after the `eliminated` entry:

```ts
  // A card is demanded by name (Security Bug). Public on a hit AND on a miss —
  // `docs/rules/cards.md:125` — so every peer plans this identically, and `hit`
  // is what tells the two outcomes apart. `attacker`/`target` come off the
  // event rather than off the turn because a `reflect` (Works on my Machine,
  // fake/attacks.ts:260-269) swaps the roles, and the event is the only thing
  // that already knows which way round they ended up.
  | {
      kind: 'requested'
      key: string
      eventId: number
      attacker: string
      target: string
      card: string
      hit: boolean
    }
  // A card changes hands. `card` is present only for the two parties
  // (`visibleTo: [from, to]` in fake/handAttacks.ts); its ABSENCE is what
  // selects the closed flight, and nothing here may widen it.
  | {
      kind: 'handTransfer'
      key: string
      eventId: number
      from: string
      to: string
      card?: string
      role: TransferRole
      named: boolean
      donorHand: number
    }
```

- [ ] **Step 4: Add the walk's two cases**

In the `switch (e.type)` inside `planBeats`, beside the other terminal cases. Both `flush()` first — a transfer is its own gesture and must not coalesce into a run of discards in front of it.

```ts
      case 'requested': {
        flush()
        plans.push({
          kind: 'requested',
          key: `requested:${e.id}`,
          eventId: e.id,
          attacker: e.attacker,
          target: e.target,
          card: e.card,
          hit: e.hit,
        })
        break
      }
      case 'handTransfer': {
        flush()
        // `named` cannot come from this batch: `requested{hit:true}` opened the
        // `giveCard` pending and returned, and the transfer arrives from the
        // victim's own RESOLVE — a separate reduction. The projection the batch
        // animates away from is what still knows, and it knows publicly.
        const named = before.pending?.kind === 'giveCard'
        const role: TransferRole =
          e.to === before.selfId ? 'taker' : e.from === before.selfId ? 'victim' : 'watcher'
        // I1 — the donor's fan as it stands ON SCREEN. `live` has already lost
        // the card, so a grid measured there would deal one back too few.
        const donorHand =
          e.from === before.selfId
            ? before.you.hand.length
            : (before.opponents.find((o) => o.id === e.from)?.handCount ?? 0)
        plans.push({
          kind: 'handTransfer',
          key: `transfer:${e.id}`,
          eventId: e.id,
          from: e.from,
          to: e.to,
          // spread rather than assigned: `card` must stay ABSENT when the event
          // had none, not become an explicit `undefined` a later reader could
          // mistake for a value it is allowed to fill in
          ...(e.card ? { card: e.card } : {}),
          role,
          named,
          donorHand,
        })
        break
      }
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm -C apps/frontend test -- planBeats`
Expected: PASS, all cases including the pre-existing ones.

- [ ] **Step 6: Export the new type from the barrel**

In `apps/frontend/src/features/board-beats/index.ts`, add `TransferRole` to the existing type export:

```ts
export type {
  BeatPlan,
  DiscardCard,
  DiscardSource,
  PileStep,
  PlannedDraw,
  TransferRole,
} from './planBeats'
```

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck`
Expected: all seven packages Done.

```bash
git add apps/frontend/src/features/board-beats/planBeats.ts apps/frontend/src/features/board-beats/planBeats.test.ts apps/frontend/src/features/board-beats/index.ts
git commit -m "planBeats: requested and handTransfer become plans (#105)"
```

---

### Task 3: `transferBeat` — the file, the taker's flight, and the queue wiring

The taker's leg is the one the other two are mirrors of, so it comes first and brings the file with it. A card comes out of the donor's seat, grows to the centre, turns over, is read, and settles into the fan.

Two publishes, and both exist because the beat's last frame must equal the projection it hands over to (I7): the donor's count drops when the card leaves the seat, and the fan grows when it lands. Get either wrong and the card visibly jumps on the handover.

After this task, `runTransfer` does nothing for the victim and watcher roles. That is safe rather than broken — a beat that publishes nothing hands its own base on untouched, the queue drains, and the live projection wins. Tasks 4 and 5 fill them in.

**Files:**
- Create: `apps/frontend/src/features/board-beats/transferBeat.tsx`
- Modify: `apps/frontend/src/features/board-beats/useBeats.ts`
- Modify: `apps/frontend/src/features/board-beats/index.ts`
- Test: `apps/frontend/src/features/board-beats/transferBeat.test.tsx` (create)

**Interfaces:**
- Consumes: `BeatPlan`, `TransferRole` (Task 2); `BoardAnchors`, `BeatRun`, `BoardState` (`~/entities/game/board`); `play`, `useFlyer`, `useHandArrival`, `wait` (`@release/ui/animations`); `cardById`, `CARD_W`, `cardBoxIn` (`@release/ui`).
- Produces, consumed by `useBeats` and by Tasks 4–7:

```ts
export function useTransferBeat(anchors: BoardAnchors): {
  overlay: ReactNode[]
  gapAt: number | null
  gapSize: number
  runTransfer: (plan: Extract<BeatPlan, { kind: 'handTransfer' }>, beat: BeatRun) => Promise<void>
  reset: () => void
}
```

`runRequested` joins this return in Task 6.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/features/board-beats/transferBeat.test.tsx`. The mock and probe shape are lifted from `drawBeat.test.tsx` on purpose — same harness, same reasons, including the fake-timer loop that forces React to flush mid-run.

```tsx
import { act, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { BoardAnchors, BoardState } from '~/entities/game/board'
import type { BeatPlan } from './planBeats'
import { useTransferBeat } from './transferBeat'

const played = vi.hoisted(() => ({ names: [] as string[], shakes: [] as unknown[] }))
const arrivals = vi.hoisted(() => ({ handLengths: [] as number[], calls: 0 }))

vi.mock('@release/ui/animations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@release/ui/animations')>()
  return {
    ...real,
    play: (name: string, _el: unknown, params?: unknown) => {
      played.names.push(name)
      if (name === 'shake') played.shakes.push(params)
      return { finished: Promise.resolve() } as unknown as Animation
    },
    useHandArrival: (...args: Parameters<typeof real.useHandArrival>) => {
      const step = real.useHandArrival(...args)
      return {
        ...step,
        arrive: (items: Parameters<typeof step.arrive>[0], handLength: number, at?: number) => {
          arrivals.calls += 1
          arrivals.handLengths.push(handLength)
          return step.arrive(items, handLength, at)
        },
      }
    },
  }
})

const base = {
  you: { name: 'You', hand: [{ uid: 'u1', card: { id: 'attack-bug' } }], release: {} },
  opponents: [{ id: 'p2', name: 'Two', handCount: 5, release: {} }],
  decks: { main: [10], events: 5, discardCount: 0 },
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
} as unknown as BoardState

const node = () => document.createElement('div')
const anchors = {
  hand: { current: node() },
  centre: { current: node() },
  discardBox: { current: node() },
  pileBox: () => node(),
  seatBox: () => ({ left: 0, top: 0, width: 150, height: 210 }),
  seatOf: () => node(),
  handSlotAt: () => node(),
  releaseSlot: () => null,
  bindPile: () => {},
  bindSeat: () => {},
  bindReleaseSlot: () => {},
} as unknown as BoardAnchors

export const transferPlan = (
  over: Partial<Extract<BeatPlan, { kind: 'handTransfer' }>> = {},
): Extract<BeatPlan, { kind: 'handTransfer' }> => ({
  kind: 'handTransfer',
  key: 'transfer:2',
  eventId: 2,
  from: 'p2',
  to: 'p1',
  card: 'attack-bug',
  role: 'taker',
  named: true,
  donorHand: 5,
  ...over,
})

export function runTransfer(plan: Extract<BeatPlan, { kind: 'handTransfer' }>) {
  const published: BoardState[] = []
  let start: (() => Promise<void>) | null = null
  function Probe() {
    const beat = useTransferBeat(anchors)
    start = () => beat.runTransfer(plan, { base, publish: (s) => published.push(s) })
    return <>{beat.overlay}</>
  }
  const view = render(<Probe />)
  return {
    published,
    view,
    go: async () => {
      vi.useFakeTimers()
      try {
        let done = false
        const finished = start?.().then(() => {
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
    },
  }
}

beforeEach(() => {
  played.names = []
  played.shakes = []
  arrivals.handLengths = []
  arrivals.calls = 0
})

it('flies a taken card out of the donor seat and into the fan', async () => {
  const r = runTransfer(transferPlan())
  await r.go()
  expect(played.names).toContain('takeFromSeat')
  expect(arrivals.calls).toBe(1)
  // it lands at the END of the fan: the engine appends what a hand gains, and
  // `toBoardState` passes that order through, so landing anywhere else makes
  // the last frame disagree with the projection it hands over to
  expect(arrivals.handLengths).toEqual([1])
})

it('drops the donor count as the card leaves the seat', async () => {
  // I7 — the beat's last frame IS the projection. The donor is one card lighter
  // on the live projection by the time this runs, so a beat that never said so
  // would pop the count on the handover.
  const r = runTransfer(transferPlan())
  await r.go()
  const counts = r.published.map((s) => s.opponents[0].handCount)
  expect(counts).toContain(4)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/frontend test -- transferBeat`
Expected: FAIL — `Failed to resolve import "./transferBeat"`, since the module does not exist yet.

- [ ] **Step 3: Write `transferBeat.tsx`**

```tsx
import { CARD_W, cardById, cardBoxIn } from '@release/ui'
import type { Rect } from '@release/ui/animations'
import { play, useFlyer, useHandArrival, wait } from '@release/ui/animations'
import { useCallback, useRef } from 'react'
import type { BeatRun, BoardAnchors, BoardState } from '~/entities/game/board'
import type { BeatPlan } from './planBeats'

// A card changes hands. One surface seen from three sides — you take a card,
// you lose one, or you watch one cross the table — and they are one runner
// because the flight is one flight: a seat, the centre, a destination. What
// differs is which end is a hand and which is a seat, and whether the card has
// an identity this peer is entitled to at all.
//
// THE BRANCH THAT MATTERS is not `role`, it is `plan.card`. Present means this
// peer is a party to the transfer (the engine sets `visibleTo: [from, to]`);
// absent means it is not, and the flight closes. Nothing here re-derives who
// may see what — that answer arrived with the event, and re-deriving it is how
// a hand leaks.

const REVEAL_HOLD = 820 // face-up at the centre before it drops into the fan
const SEAT_SHRINK = 0.7 // how small a card is inside a seat — `drawBeat`'s own value

// One flyer key for the whole run: there is never more than one card in the
// air here, and a key IS a flyer — raising the same key twice replaces the
// carrier instead of hanging a second node on the same name.
const KEY = 'transfer'

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export function useTransferBeat(anchors: BoardAnchors) {
  const { overlay: flyerOverlay, raise, pin, patch, drop, elOf } = useFlyer()

  // The run's own context, held in a ref because the whole beat is one closure
  // and the hand it lands in is the one THIS run has grown, not the one the
  // batch started with.
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

  const latest = useRef({ anchors, arrive })
  latest.current = { anchors, arrive }

  // The donor is one card lighter the moment it leaves them. Published as its
  // own step rather than folded into the landing, because the two ends of a
  // transfer are two different players and the flight is long enough to see
  // both — and because a watcher's flight has this end and no other.
  const dropFromDonor = useCallback((player: string) => {
    const c = ctx.current
    if (!c) return
    const next: BoardState = {
      ...c.base,
      opponents: c.base.opponents.map((o) =>
        o.id === player ? { ...o, handCount: Math.max(0, o.handCount - 1) } : o,
      ),
    }
    c.base = next
    c.publish(next)
  }, [])

  const runTransfer = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'handTransfer' }>, beat: BeatRun) => {
      ctx.current = beat
      try {
        if (plan.role === 'taker') {
          const a = latest.current.anchors
          const seat = a.seatBox(plan.from)
          const centre = rectOf(a.centre.current)
          const card = plan.card ? cardById(plan.card) : null
          // A taker always knows what they took — but a missing rect or an
          // unknown id ends the leg and lets the projection stand, which is the
          // contract every runner keeps.
          if (!seat || !centre || !card) return
          // out of the seat's own card box (I6), at the size a card is while it
          // is inside a hidden hand — the exact box `dealToSeat` sinks into
          const from = cardBoxIn(seat, CARD_W * SEAT_SHRINK)
          const [el] = await raise([{ key: KEY, card, at: from, faceDown: true }])
          if (el) {
            const anim = play('takeFromSeat', el, { from, to: centre })
            if (anim) await anim.finished
            pin(KEY, centre) // I4 — it IS at the centre now
          }
          dropFromDonor(plan.from)
          patch(KEY, { faceDown: false }) // Card plays its own flipCard
          await wait(REVEAL_HOLD)
          const at = rectOf(elOf(KEY))
          drop(KEY)
          // The fan as it stands RIGHT NOW, and the card lands at its END —
          // the engine appends what a hand gains and `toBoardState` passes that
          // order through untouched, so any other slot makes this beat's last
          // frame disagree with the projection it hands over to.
          const grown = ctx.current?.base.you.hand.length ?? 0
          if (at) await latest.current.arrive([{ key: `t${plan.eventId}`, card, from: at }], grown, grown)
          return
        }
        // victim — Task 4; watcher — Task 5. Until then they publish nothing
        // and hand their own base on untouched: the queue drains, the shadow is
        // dropped, and the live projection wins.
      } finally {
        ctx.current = null
      }
    },
    [raise, pin, patch, drop, elOf, dropFromDonor],
  )

  // A new match cancels what is in the air: the carrier this run may have left
  // mid-flight, and the parked arrival that would otherwise land a dead match's
  // card in the new one's fan.
  const reset = useCallback(() => {
    drop()
    resetArrival()
  }, [drop, resetArrival])

  return { overlay: [...flyerOverlay, ...handOverlay], gapAt, gapSize, runTransfer, reset }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C apps/frontend test -- transferBeat`
Expected: PASS, both tests.

- [ ] **Step 5: Wire it into the queue**

In `apps/frontend/src/features/board-beats/useBeats.ts`:

Add the import beside the others:

```ts
import { useTransferBeat } from './transferBeat'
```

Instantiate it beside the other runners (after `const elimination = useEliminateBeat()`):

```ts
  const transfers = useTransferBeat(anchors)
```

Add the plan case inside `beatOf`, after the `neutralized` case:

```ts
      if (plan.kind === 'handTransfer') {
        return {
          key: plan.key,
          base,
          // Not exclusive: a card changing hands does not own the table the way
          // an elimination clip does, and nothing about it needs input dead.
          exclusive: false,
          alarm: false,
          run: (ctx) => transfers.runTransfer(plan, ctx),
        }
      }
```

Add `transfers.runTransfer` to `beatOf`'s dependency array.

Add its overlay to the `overlays` array in the return:

```ts
      ...transfers.overlay,
```

Add `transfers.reset()` beside the other runner resets in the match-boundary effect, and extend that effect's `biome-ignore` comment to mention it — the reason is identical (`useHandArrival`'s own `reset` is unmemoized, so listing the runner would fire the effect every render instead of once per match key):

```ts
    transfers.reset()
```

And the fan gap now has two possible sources:

```ts
    // The fan opens for a card on its way into it. Two beats grow it now — a
    // draw (I8) and a card taken from an opponent — and they can never both be
    // open, because one beat runs at a time. So this is a choice between them,
    // not a merge of them.
    gapAt: draws.gapAt ?? transfers.gapAt,
    gapSize: draws.gapAt != null ? draws.gapSize : transfers.gapSize,
```

- [ ] **Step 6: Export from the barrel**

In `apps/frontend/src/features/board-beats/index.ts`:

```ts
export { useTransferBeat } from './transferBeat'
```

- [ ] **Step 7: Run the whole frontend suite and typecheck**

Run: `pnpm -C apps/frontend test`
Expected: PASS. If `boardIntro.test.tsx`'s StrictMode case fails, re-run it alone (`pnpm -C apps/frontend test -- boardIntro`) — it waits nine real seconds and is load-sensitive; a pass in isolation means it is not yours.

Run: `pnpm typecheck`
Expected: all seven packages Done.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/features/board-beats/transferBeat.tsx apps/frontend/src/features/board-beats/transferBeat.test.tsx apps/frontend/src/features/board-beats/useBeats.ts apps/frontend/src/features/board-beats/index.ts
git commit -m "transferBeat: a taken card comes out of a seat and into the fan (#105)"
```

---

### Task 4: The victim's leg — the mirror

The same flight read backwards, and the one place where the mirror is genuinely a different movement rather than the same one reversed: it ends in a **seat**, not a hand, so `useHandArrival` has no part in it. The card leaves a hand; it does not settle into one.

The flip is face-**down**, at the centre. That is the whole story of the beat: at the moment it turns over it stops being yours.

**Files:**
- Modify: `apps/frontend/src/features/board-beats/transferBeat.tsx`
- Test: `apps/frontend/src/features/board-beats/transferBeat.test.tsx`

**Interfaces:**
- Consumes: everything Task 3 produced. No new exports.

- [ ] **Step 1: Write the failing tests**

Append to `transferBeat.test.tsx`:

```tsx
it('sends a lost card from the fan into the taker seat, and never into a hand', async () => {
  const r = runTransfer(transferPlan({ from: 'p1', to: 'p2', role: 'victim' }))
  await r.go()
  expect(played.names).toContain('dealToSeat')
  // THE assertion that separates the mirror from the original. `useHandArrival`
  // is the step for a card ARRIVING in the fan; a card leaving one must never
  // touch it. Pinned explicitly because it is exactly the kind of thing a later
  // refactor unifies by accident, and nothing else would notice.
  expect(arrivals.calls).toBe(0)
})

it('takes the lost card out of your own fan', async () => {
  const r = runTransfer(transferPlan({ from: 'p1', to: 'p2', role: 'victim' }))
  await r.go()
  const hands = r.published.map((s) => s.you.hand.length)
  expect(hands).toContain(0)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C apps/frontend test -- transferBeat`
Expected: FAIL — `dealToSeat` never played and `published` empty, because `runTransfer` returns without doing anything for `role: 'victim'`.

- [ ] **Step 3: Add the constant and the leg**

In `transferBeat.tsx`, beside `REVEAL_HOLD`:

```ts
const CENTER_HOLD = 820 // face-down at the centre before it sinks into the seat
```

Replace the `// victim — Task 4; watcher — Task 5.` comment with:

```ts
        if (plan.role === 'victim') {
          const a = latest.current.anchors
          const centre = rectOf(a.centre.current)
          const seat = a.seatBox(plan.to)
          const card = plan.card ? cardById(plan.card) : null
          if (!centre || !seat || !card) return
          // Which slot it leaves from. The registry indexes rather than looks
          // up by uid — deliberately, so it need not know the hand — and the
          // caller already holds the hand it planned against, so the index is
          // resolved here. Matching on the card ID is what the engine itself
          // matched on (`onGiveCard` checks `card.id === pending.requested`);
          // copies are interchangeable, so the first is as right as any.
          const index = beat.base.you.hand.findIndex((h) => h.card.id === plan.card)
          const slot = index >= 0 ? rectOf(a.handSlotAt(index)) : null
          if (!slot) return
          const [el] = await raise([{ key: KEY, card, at: slot, faceDown: false }])
          // your fan closes the gap while the card is in the air
          const c0 = ctx.current
          if (c0) {
            const hand = c0.base.you.hand.filter((_, i) => i !== index)
            const next = { ...c0.base, you: { ...c0.base.you, hand } }
            c0.base = next
            c0.publish(next)
          }
          if (el) {
            const anim = play('playToCenter', el, { from: slot, to: centre })
            if (anim) await anim.finished
            pin(KEY, centre)
          }
          // It turns FACE-DOWN, and that is the beat: from here it is theirs,
          // and a hidden hand is where it is going.
          patch(KEY, { faceDown: true })
          await wait(CENTER_HOLD)
          const to = cardBoxIn(seat, CARD_W * SEAT_SHRINK)
          const held = elOf(KEY)
          if (held) {
            const anim = play('dealToSeat', held, { from: centre, to })
            if (anim) await anim.finished
          }
          drop(KEY)
          // …and the taker's counter carries it now. That counter IS their hand.
          const c1 = ctx.current
          if (c1) {
            const next: BoardState = {
              ...c1.base,
              opponents: c1.base.opponents.map((o) =>
                o.id === plan.to ? { ...o, handCount: o.handCount + 1 } : o,
              ),
            }
            c1.base = next
            c1.publish(next)
          }
          return
        }
        // watcher — Task 5. Until then it publishes nothing and hands its own
        // base on untouched: the queue drains and the live projection wins.
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm -C apps/frontend test -- transferBeat`
Expected: PASS, all four tests.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck`
Expected: all seven packages Done.

```bash
git add apps/frontend/src/features/board-beats/transferBeat.tsx apps/frontend/src/features/board-beats/transferBeat.test.tsx
git commit -m "transferBeat: the victim's mirror, ending in a seat and not a hand (#105)"
```

---

### Task 5: The watcher's leg — the closed flight

For everyone who is not a party, the event arrived without a `card`. There is nothing to flip and nothing to reveal, and the beat must not invent one. Seat to seat, face-down the whole way, on the same `COVER` stand-in `drawBeat` uses for a closed draw.

This is the leg the issue calls a correctness matter rather than a visual one, and the test is what makes it one.

**Files:**
- Modify: `apps/frontend/src/features/board-beats/transferBeat.tsx`
- Test: `apps/frontend/src/features/board-beats/transferBeat.test.tsx`

**Interfaces:**
- Consumes: everything Tasks 3–4 produced. No new exports.

- [ ] **Step 1: Write the failing tests**

Append to `transferBeat.test.tsx`:

```tsx
it('crosses the table closed when the event carried no card', async () => {
  const r = runTransfer(
    transferPlan({ from: 'p2', to: 'p3', role: 'watcher', card: undefined, named: false }),
  )
  await r.go()
  expect(played.names).toContain('takeFromSeat')
  expect(played.names).toContain('dealToSeat')
  // never turned over, and never handed to the fan
  expect(arrivals.calls).toBe(0)
})

it('leaks no identity into the DOM for a peer that is not a party', async () => {
  // The engine redacts `handTransfer.card` to `visibleTo: [from, to]`, and this
  // is the board keeping that promise. A `faceDown` prop is not enough on its
  // own — what matters is that no real card id is ever mounted, because a card
  // rendered face-down still carries its own art and name in the DOM.
  const r = runTransfer(
    transferPlan({ from: 'p2', to: 'p3', role: 'watcher', card: undefined, named: false }),
  )
  await r.go()
  expect(r.view.container.innerHTML).not.toContain('attack-bug')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C apps/frontend test -- transferBeat`
Expected: FAIL on the first — neither preset played, because `runTransfer` still returns without doing anything for `role: 'watcher'`. (The second passes vacuously today; it is here to stay passing, and it will fail loudly the moment someone reaches for `plan.card ?? something`.)

- [ ] **Step 3: Add the cover card and the leg**

In `transferBeat.tsx`, add the import of `CardData` and the stand-in beside the constants — the same shape and the same reason as `drawBeat`'s:

```ts
import type { CardData } from '@release/ui'
```

```ts
// A card nobody at this seat is entitled to know. The projection never says
// what it is, so nothing here may guess: this carries no face, only the base
// deck's cover, and it is always flown faceDown. `Card` reads `deck` for the
// back and nothing else.
const COVER: CardData = {
  id: 'unknown',
  name: '',
  category: 'protection',
  deck: 'base',
  art: '',
  tags: [],
  qty: 0,
}
```

Replace the `// watcher — Task 5.` comment with:

```ts
        // A watcher. `plan.card` is absent — not "unknown to us", absent from
        // the event — so there is nothing to turn over and nothing to hold at
        // the centre to be read. It crosses closed, and the two counts are the
        // only thing that actually changes.
        const a = latest.current.anchors
        const fromSeat = a.seatBox(plan.from)
        const toSeat = a.seatBox(plan.to)
        const centre = rectOf(a.centre.current)
        if (!fromSeat || !toSeat || !centre) return
        const from = cardBoxIn(fromSeat, CARD_W * SEAT_SHRINK)
        const to = cardBoxIn(toSeat, CARD_W * SEAT_SHRINK)
        const [el] = await raise([{ key: KEY, card: COVER, at: from, faceDown: true }])
        if (el) {
          const out = play('takeFromSeat', el, { from, to: centre })
          if (out) await out.finished
          pin(KEY, centre)
          dropFromDonor(plan.from)
          const home = play('dealToSeat', el, { from: centre, to })
          if (home) await home.finished
        }
        drop(KEY)
        const c = ctx.current
        if (c) {
          const next: BoardState = {
            ...c.base,
            opponents: c.base.opponents.map((o) =>
              o.id === plan.to ? { ...o, handCount: o.handCount + 1 } : o,
            ),
          }
          c.base = next
          c.publish(next)
        }
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm -C apps/frontend test -- transferBeat`
Expected: PASS, all six tests.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck`
Expected: all seven packages Done.

```bash
git add apps/frontend/src/features/board-beats/transferBeat.tsx apps/frontend/src/features/board-beats/transferBeat.test.tsx
git commit -m "transferBeat: the closed flight, for peers the event did not name (#105)"
```

---

### Task 6: `runRequested` — the entrance, and the whole miss

Two jobs in one runner, because the projection survives one outcome and not the other.

On a **hit** the projection does the holding. The pending flips `requestCard → giveCard`, and `giveCard` is projected unredacted to every peer (`fake/attacks.ts:444` — no `mine` gate, unlike `handLimit`), so `pending.requested` is public and every board can render the named card at the centre. The beat is only the entrance, and its last frame is that render (I7).

On a **miss** the pending clears outright. Nothing in the projection survives, so the beat carries the entire scene — and it must, because `docs/rules/cards.md:125` makes the request public on a miss exactly as on a hit: the table has to see which card was asked for and not received.

The refusal has two forms, and this is not a special case bolted on. To the asker and to spectators the target is a Seat, so their seat flinches. To the target themselves there is no seat — they are `you`, and what they own is the fan — so their own hand flinches, which is the story's original gesture exactly. The seat flinch is its translation for everyone who sees the target as a seat instead of a fan.

**Files:**
- Modify: `apps/frontend/src/features/board-beats/transferBeat.tsx`
- Create: `apps/frontend/src/features/board-beats/transferBeat.module.css`
- Modify: `apps/frontend/src/features/board-beats/useBeats.ts`
- Modify: `packages/translation/src/locales/en/common.json`, `packages/translation/src/locales/ru/common.json`
- Test: `apps/frontend/src/features/board-beats/transferBeat.test.tsx`

**Interfaces:**
- Produces, added to `useTransferBeat`'s return:

```ts
  runRequested: (plan: Extract<BeatPlan, { kind: 'requested' }>, beat: BeatRun) => Promise<void>
```

- [ ] **Step 1: Add the copy key to both catalogs**

The band itself reuses the existing `pending.requestCard` copy — it asks the same question the panel asked. Only the miss note is new.

In `packages/translation/src/locales/en/common.json`, inside `table`, after `askNeutralize`:

```json
    "requestMiss": "not in hand",
```

In `packages/translation/src/locales/ru/common.json`, at the same place inside `table`:

```json
    "requestMiss": "нет такой карты",
```

- [ ] **Step 2: Write the failing tests**

Append to `transferBeat.test.tsx`. Add the import and a second probe beside the first:

```tsx
export const requestPlan = (
  over: Partial<Extract<BeatPlan, { kind: 'requested' }>> = {},
): Extract<BeatPlan, { kind: 'requested' }> => ({
  kind: 'requested',
  key: 'requested:1',
  eventId: 1,
  attacker: 'p1',
  target: 'p2',
  card: 'attack-bug',
  hit: true,
  ...over,
})

function runRequested(plan: Extract<BeatPlan, { kind: 'requested' }>, on: BoardState = base) {
  const published: BoardState[] = []
  let start: (() => Promise<void>) | null = null
  function Probe() {
    const beat = useTransferBeat(anchors)
    start = () => beat.runRequested(plan, { base: on, publish: (s) => published.push(s) })
    return <>{beat.overlay}</>
  }
  const view = render(<Probe />)
  return {
    published,
    view,
    go: async () => {
      vi.useFakeTimers()
      try {
        let done = false
        const finished = start?.().then(() => {
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
    },
  }
}

it('hands a hit over to the projection instead of holding it', async () => {
  // The named card has to survive the gap between two BATCHES — the transfer
  // comes from the victim's own RESOLVE — and no beat overlay can span that.
  // So the beat publishes the public `giveCard` pending and lets the board's
  // own render take the centre, which is why this leg is only an entrance.
  const r = runRequested(requestPlan({ hit: true }))
  await r.go()
  const pendings = r.published.map((s) => s.pending?.kind)
  expect(pendings).toContain('giveCard')
})

it('flinches the target seat on a miss, and takes nothing', async () => {
  const r = runRequested(requestPlan({ hit: false }))
  await r.go()
  expect(played.names).toContain('shake')
  // the story's values: a whole seat flinching, not the 7px settle sized for
  // an input field
  expect(played.shakes[0]).toMatchObject({ amp: 9, dur: 460, shape: 'spring' })
  expect(arrivals.calls).toBe(0)
  expect(r.published.map((s) => s.pending?.kind)).not.toContain('giveCard')
})

it('flinches your own fan when the miss is aimed at you', async () => {
  // To everyone else the target is a Seat; to the target there is no seat at
  // all — they are `you`, and what they own is the fan. Same gesture, rendered
  // as the target actually appears.
  const seatOf = vi.fn(() => document.createElement('div'))
  const own = { ...base, selfId: 'p2' } as BoardState
  const r = runRequested(requestPlan({ hit: false, target: 'p2' }), own)
  await r.go()
  expect(played.names).toContain('shake')
  expect(seatOf).not.toHaveBeenCalled()
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm -C apps/frontend test -- transferBeat`
Expected: FAIL — `beat.runRequested is not a function`.

- [ ] **Step 4: Add the note's stylesheet**

Create `apps/frontend/src/features/board-beats/transferBeat.module.css`:

```css
/* The miss note. It sits over the table centre, above the flyer layer, and it
   is the only thing on screen that says a request came back empty — the rules
   make that public, so it must be legible to the whole table and not only to
   whoever asked. */
.note {
  position: fixed;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  transform: translate(-50%, 140px);
  z-index: 260;
  padding-block: 8px;
  padding-inline: 18px;
  border-radius: 8px;
  background: var(--color-surface-raised);
  color: var(--color-text-muted);
  pointer-events: none;
}
```

Before writing it, confirm both token names exist in `apps/ui/src/design/tokens.css`. If either does not, pick the nearest existing token for a raised surface and for muted text — **do not invent a colour**, and do not hardcode one.

- [ ] **Step 5: Add the leg**

In `transferBeat.tsx`, add the imports:

```ts
import { useTranslation } from '@release/translation'
import { nextFrames } from '@release/ui/animations'
import { useState } from 'react'
import styles from './transferBeat.module.css'
```

Add the constants beside the others:

```ts
const REQUEST_HOLD = 820 // the named card stands at the centre before the outcome
const MISS_HOLD = 1620 // the flinch and the note, before the scene clears
// A whole seat (or a whole fan) flinching, not the 7px `settle` sized for an
// input field — the story's own values.
const SHAKE = { amp: 9, dur: 460, shape: 'spring' } as const
```

Inside the hook, above `runTransfer`:

```ts
  const { t } = useTranslation()
  // The miss note. State rather than a ref: it is rendered, and the overlay has
  // to re-render when it appears and again when it goes.
  const [missed, setMissed] = useState(false)

  const runRequested = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'requested' }>, beat: BeatRun) => {
      ctx.current = beat
      try {
        const a = latest.current.anchors
        const centre = rectOf(a.centre.current)
        const card = cardById(plan.card)
        if (!centre || !card) return
        // The named card, face-up, at the centre — for EVERY peer. `requested`
        // carries no `visibleTo`: the rules make the request public on a hit
        // and a miss alike (docs/rules/cards.md:125).
        const [el] = await raise([{ key: KEY, card, at: centre, faceDown: false }])
        if (el) {
          // It ARRIVES rather than travels: only the asker has an origin for it
          // (the catalog cell they named it in, which their own band is holding
          // enlarged), and inventing one for everybody else — flying it out of
          // the attacker's seat — would say the card left their hand. It did not.
          const anim = play('landInPose', el, { from: centre, box: centre })
          if (anim) await anim.finished
        }

        if (plan.hit) {
          // Hand it to the projection. `giveCard` is public (fake/attacks.ts:444
          // projects it with no `mine` gate), so the board's own centre render
          // takes this exact spot — and it has to, because the transfer arrives
          // in a LATER batch and no overlay of this beat's can span the gap.
          //
          // Publish first, drop second: the board renders this beat's shadow
          // while it runs, so the static render is up before the carrier lets
          // go and the slot is never blank for a frame. Same ordering, and the
          // same reason, as the standing trigger in `drawBeat`.
          const c = ctx.current
          if (c) {
            const next: BoardState = {
              ...c.base,
              pending: {
                kind: 'giveCard' as const,
                player: plan.target,
                requested: plan.card,
              },
            }
            c.base = next
            c.publish(next)
          }
          await nextFrames() // the publish above has committed (I2)
          drop(KEY)
          return
        }

        // A MISS. The pending clears outright, so nothing in the projection
        // survives this — the beat carries the whole scene or the table never
        // learns the outcome, which is the rule this exists to keep.
        await wait(REQUEST_HOLD)
        // Rendered as the target actually appears: a Seat to everyone watching,
        // and to the target themselves no seat at all — they are `you`, and
        // what they own is the fan. One gesture, two renderings.
        const mine = plan.target === beat.base.selfId
        const flinch = mine ? a.hand.current : a.seatOf(plan.target)
        play('shake', flinch, SHAKE)
        setMissed(true)
        await wait(MISS_HOLD)
        setMissed(false)
        drop(KEY)
      } finally {
        ctx.current = null
      }
    },
    [raise, drop],
  )
```

And render the note in the overlay:

```ts
  return {
    overlay: [
      ...flyerOverlay,
      ...handOverlay,
      ...(missed
        ? [
            <div key="transfer-miss" className={styles.note}>
              {t('table.requestMiss')}
            </div>,
          ]
        : []),
    ],
    gapAt,
    gapSize,
    runRequested,
    runTransfer,
    reset,
  }
```

Add `setMissed(false)` to `reset`, so a match boundary cannot leave a dead match's note on the new board:

```ts
  const reset = useCallback(() => {
    drop()
    resetArrival()
    setMissed(false)
  }, [drop, resetArrival])
```

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm -C apps/frontend test -- transferBeat`
Expected: PASS, all nine tests.

- [ ] **Step 7: Wire `requested` into the queue**

In `useBeats.ts`, beside the `handTransfer` case added in Task 3:

```ts
      if (plan.kind === 'requested') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: false,
          run: (ctx) => transfers.runRequested(plan, ctx),
        }
      }
```

Add `transfers.runRequested` to `beatOf`'s dependency array.

- [ ] **Step 8: Full suite, typecheck, lint, commit**

Run: `pnpm -C apps/frontend test`
Expected: PASS (see Task 3 Step 7 on the load-sensitive `boardIntro` case).

Run: `pnpm typecheck`
Expected: all seven packages Done.

Run: `npx release-lint check --error-on-warnings apps/frontend/src/features/board-beats/`
Expected: no fixes applied.

```bash
git add apps/frontend/src/features/board-beats/ packages/translation/src/locales/
git commit -m "transferBeat: the named card at the centre, and the miss the table must see (#105)"
```

---

### Task 7: The offer — a random steal fans the donor's hand out of their seat

`stealRandom` picks with the seeded RNG and raises no pending, so there is nothing to choose. What the scene is *for* is the suspense of which card it turns out to be, and that is worth keeping: without it a random steal and a named one are the same flight, and the table cannot tell a Bug from a Security Bug by looking.

The story fans the donor's backs down from the top because a playground stage has no seats. The board has them, so the fan comes out of the donor's seat instead — the gesture translated, not the geometry transcribed. Runs only for the **taker**, and only when `named` is false: a victim already knows what left their hand, and a watcher was told nothing at all.

**Files:**
- Modify: `apps/frontend/src/features/board-beats/transferBeat.tsx`
- Test: `apps/frontend/src/features/board-beats/transferBeat.test.tsx`

**Interfaces:**
- Consumes: everything Tasks 3–6 produced. No new exports.

- [ ] **Step 1: Write the failing tests**

Append to `transferBeat.test.tsx`:

```tsx
it('fans the donor hand out of their seat before a random steal lands', async () => {
  const r = runTransfer(transferPlan({ named: false, donorHand: 4 }))
  await r.go()
  // one `takeFromSeat` per offered back, plus the taken card's own flight
  const offers = played.names.filter((n) => n === 'takeFromSeat').length
  expect(offers).toBe(5)
  expect(arrivals.calls).toBe(1)
})

it('offers nothing when the card was named', async () => {
  // A named transfer has no suspense in it — the asker chose the card and the
  // whole table watched them choose. Fanning a hand here would invent a
  // question that was already answered.
  const r = runTransfer(transferPlan({ named: true, donorHand: 4 }))
  await r.go()
  expect(played.names.filter((n) => n === 'takeFromSeat').length).toBe(1)
})

it('offers nothing to a watcher', async () => {
  const r = runTransfer(
    transferPlan({ from: 'p2', to: 'p3', role: 'watcher', card: undefined, named: false }),
  )
  await r.go()
  expect(played.names.filter((n) => n === 'takeFromSeat').length).toBe(1)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C apps/frontend test -- transferBeat`
Expected: FAIL on the first — one `takeFromSeat`, not five. The other two pass already and are here to stay passing.

- [ ] **Step 3: Add the constants and the offer**

In `transferBeat.tsx`, beside the other constants:

```ts
const OFFER_STEP = 45 // between neighbouring backs, as they fan out
const OFFER_HOLD = 620 // the hand stands offered before the card turns over
const OFFER_SPREAD = 0.62 // how far across the centre the fan opens, as a share of its width
const OFFER_MAX = 9 // backs actually rendered; a bigger hand is not a bigger question
```

Add a private helper above the hook — the fan's geometry, kept here because it is this scene's and nothing else's:

```ts
// Where the offered backs sit: a shallow arc across the centre, evenly spaced,
// each the size a card is at the table. Not a grid — a hand held out. The
// count is capped because past a point more backs stop reading as "a hand" and
// start reading as "a deck", and the suspense is the same either way.
function offerPoses(count: number, centre: Rect): Rect[] {
  const n = Math.max(1, Math.min(OFFER_MAX, count))
  const span = centre.width * OFFER_SPREAD
  const step = n === 1 ? 0 : span / (n - 1)
  const first = centre.left + centre.width / 2 - span / 2 - centre.width / 2
  return Array.from({ length: n }, (_, i) => ({
    left: first + step * i,
    top: centre.top,
    width: centre.width,
    height: centre.height,
  }))
}
```

Inside `runTransfer`'s `taker` branch, immediately after the `if (!seat || !centre || !card) return` guard and **before** the single `raise` that already exists:

```ts
          // A random steal offers the donor's hand first: the suspense is real,
          // because the card genuinely is random. A named one has no question
          // left in it — the table watched the asker choose.
          if (!plan.named && plan.donorHand > 0) {
            const poses = offerPoses(plan.donorHand, centre)
            const backs = poses.map((_, i) => ({
              key: `offer${i}`,
              card: COVER,
              at: from,
              faceDown: true,
            }))
            const els = await raise(backs)
            await Promise.all(
              els.map(async (b, i) => {
                if (!b) return
                await wait(i * OFFER_STEP)
                const anim = play('takeFromSeat', b, { from, to: poses[i] })
                if (anim) await anim.finished
              }),
            )
            await wait(OFFER_HOLD)
            // …and back they go. The one that was taken is not among them: it
            // flies on its own below, out of the same seat, so the offer is
            // cleared whole rather than one card short.
            await Promise.all(
              els.map(async (b, i) => {
                if (!b) return
                const anim = play('dealToSeat', b, { from: poses[i], to: from })
                if (anim) await anim.finished
              }),
            )
            for (let i = 0; i < backs.length; i++) drop(`offer${i}`)
          }
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm -C apps/frontend test -- transferBeat`
Expected: PASS, all twelve tests.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck`
Expected: all seven packages Done.

```bash
git add apps/frontend/src/features/board-beats/transferBeat.tsx apps/frontend/src/features/board-beats/transferBeat.test.tsx
git commit -m "transferBeat: a random steal offers the donor's hand first (#105)"
```

---

### Task 8: `_useRequestStaging` — the band, and the silent hand-over

The ask surface, and the last piece that makes any of the above reachable in a real game. Two things, and no animation of its own.

**The band.** `CardCatalog` across the middle, replacing `PendingPrompt` for `requestCard` exactly as `defend`, `discardForRelease` and `neutralize503` were replaced before it. The reason is the same one that carved out those three: `.prompt` is `inset: 0` at z-index 92 with a fully opaque `.panel` centred inside it, so the panel covers the very table the scene plays on. And the `chosen` hold — the named card standing enlarged while the rest of the catalog slides away — is the first beat of the transfer, which a panel that unmounts when the pending clears cannot hold.

**The hand-over.** `giveCard` asks the victim which copy of one card id to surrender. The copies differ only by uid, so the choice carries no information; the victim watches the scene instead. It fires **immediately** rather than on a timer, because the beat queue already serialises — the transfer beat cannot start before the entrance beat has drained — so the readable pause belongs to `runTransfer`'s own hold. One place owns pacing, and no timer can drift out of step with it.

It also has to live here rather than in a beat: `prefers-reduced-motion` collapses every beat, and this is a game action, not choreography. A victim with reduced motion on must still hand the card over.

**Files:**
- Create: `apps/frontend/src/pages/board/[gameId]/_useRequestStaging.tsx`
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx`
- Create: `apps/frontend/src/pages/board/[gameId]/_useRequestStaging.module.css`
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/boardTransfer.test.tsx` (create)

**Interfaces:**
- Consumes: `BoardState`, `BoardAnchors` (`~/entities/game/board`); `TableActions`, `TablePending`, `CardCatalog`, `ConfirmAction`, `CARDS` (`@release/ui`).
- Produces:

```ts
export function useRequestStaging(args: {
  state: BoardState
  actions?: TableActions
  copy: { prompt: string; action: string; confirm: string }
  enabled: boolean
  matchKey: string | null
}): { band: ReactNode | null }
```

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/pages/board/[gameId]/__tests__/boardTransfer.test.tsx`. `makeBoardProps` is the existing fixture in this folder.

```tsx
import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

const withPending = (pending: unknown, over: Record<string, unknown> = {}) => {
  const base = makeBoardProps()
  return {
    ...base,
    state: { ...base.state, selfId: 'you', pending, ...over },
  }
}

it('answers a requestCard on the table, not through the panel', () => {
  // Same reason `defend` and `neutralize503` left the panel: `.prompt` is
  // inset:0 at z 92 over an opaque panel, so the question covers the table it
  // is about — and the `chosen` hold is the first beat of the transfer, which
  // a panel that unmounts with the pending cannot hold.
  const props = withPending({ kind: 'requestCard', player: 'you', target: 'p2' })
  const { queryByTestId } = render(<Board {...props} />)
  expect(queryByTestId('pending-prompt')).toBeNull()
  expect(queryByTestId('board-request-band')).not.toBeNull()
})

it('hands the card over without asking, once, per pending', () => {
  // The copies differ only by uid — the engine itself matches on `card.id`
  // (fake/handAttacks.ts `onGiveCard`) — so there is nothing to choose. The
  // guard is per-pending and NOT per-mount: a latch that outlives what it
  // latches is the failure `useBeats` has been bitten by twice in its own
  // comments, and a second Security Bug in one match is an ordinary thing.
  const onResolve = vi.fn()
  const held = makeBoardProps().state.you.hand[0]
  const props = withPending({ kind: 'giveCard', player: 'you', requested: held.card.id })
  const { rerender } = render(<Board {...props} actions={{ onResolve }} />)
  expect(onResolve).toHaveBeenCalledTimes(1)
  expect(onResolve.mock.calls[0][0]).toMatchObject({ kind: 'giveCard', card: held.uid })

  rerender(<Board {...props} actions={{ onResolve }} />)
  expect(onResolve).toHaveBeenCalledTimes(1)

  const second = withPending({ kind: 'giveCard', player: 'you', requested: held.card.id })
  rerender(<Board {...{ ...second, actions: { onResolve } }} />)
  expect(onResolve).toHaveBeenCalledTimes(2)
})

it('stands the named card at the centre for a peer who is not a party', () => {
  // `giveCard` is projected unredacted (fake/attacks.ts:444), and the rules
  // make the request public (cards.md:125). A spectator answers nothing and
  // still has to see what was asked for.
  const onResolve = vi.fn()
  const props = withPending({ kind: 'giveCard', player: 'p2', requested: 'attack-bug' })
  const { queryByTestId } = render(<Board {...props} actions={{ onResolve }} />)
  expect(onResolve).not.toHaveBeenCalled()
  expect(queryByTestId('board-requested-card')).not.toBeNull()
})

it('still hands the card over under reduced motion', () => {
  // Every beat collapses here. The hand-over is a game action, not
  // choreography — a victim who prefers reduced motion must not stall the
  // engine waiting for an animation that will never play.
  window.matchMedia = ((q: string) => ({
    matches: q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  const onResolve = vi.fn()
  const held = makeBoardProps().state.you.hand[0]
  const props = withPending({ kind: 'giveCard', player: 'you', requested: held.card.id })
  render(<Board {...props} actions={{ onResolve }} />)
  expect(onResolve).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C apps/frontend test -- boardTransfer`
Expected: FAIL — `pending-prompt` is present (the panel still answers `requestCard`), `board-request-band` is null, and `onResolve` was never called.

- [ ] **Step 3: Write the staging hook**

Create `apps/frontend/src/pages/board/[gameId]/_useRequestStaging.tsx`:

```tsx
import type { TableActions } from '@release/ui'
import { CARDS, CardCatalog, ConfirmAction } from '@release/ui'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { BoardState } from '~/entities/game/board'
import styles from './_useRequestStaging.module.css'

// Naming a card, and losing one. Active only while a `requestCard` or a
// `giveCard` pending is ours — its siblings `_useBoardStaging.ts`,
// `_useDefenseStaging.tsx` and `_useNeutralizeStaging.tsx` never run at the
// same time, because a pending suspends normal play and a pending has one kind.
//
// It owns no animation. What flies belongs to `transferBeat`; what is decided
// belongs here, and the two meet through the projection.

// The guess space: every card that can actually BE in a hand. Triggers cannot
// (`docs/rules/cards.md:320`, `:339` — they resolve as they are drawn), and no
// event-deck card can either (`docs/rules/general.md:189` — each of them is at
// any time «либо в колоде, либо на столе»). Same filter the kit's own panel now
// uses; declared again here rather than imported, because the kit does not put
// it on its barrel and a cross-package reach for one array is not worth a new
// export.
const HOLDABLE = CARDS.filter((c) => c.deck === 'base' && c.category !== 'trigger')

export function useRequestStaging(args: {
  state: BoardState
  actions?: TableActions
  copy: { prompt: string; action: string; confirm: string }
  enabled: boolean
  matchKey: string | null
}): { band: ReactNode | null } {
  const { state, actions, copy, enabled, matchKey } = args
  const pending = state.pending
  const asking = enabled && pending?.kind === 'requestCard' && pending.player === state.selfId
  const giving = enabled && pending?.kind === 'giveCard' && pending.player === state.selfId

  const [named, setNamed] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  // The hand-over answers itself. The engine asks which COPY to surrender and
  // the copies differ only by uid — `onGiveCard` matches on `card.id`, so any
  // of them is the right one — which makes this a decision with no content.
  // The victim watches the scene instead of a panel.
  //
  // Fired at once rather than after a pause: the beat queue serialises, so the
  // transfer cannot start before the entrance beat has drained, and the pause
  // that makes the scene readable belongs to the beat's own hold. A timer here
  // would be a second opinion about pacing, free to drift from the first.
  //
  // It lives in the staging hook and NOT in a beat because
  // `prefers-reduced-motion` collapses every beat: this is a game action, and
  // an engine left waiting on an animation nobody plays is a stalled match.
  const handed = useRef<string | null>(null)
  useEffect(() => {
    if (!giving || pending?.kind !== 'giveCard') return
    // Keyed on the pending itself, not on the mount: a second Security Bug in
    // one match raises a second `giveCard`, and a once-per-mount latch would
    // swallow it. Player and card alone do not separate two identical requests,
    // so the fingerprint carries the hand's own identity for the copy going.
    const copyUid = state.you.hand.find((h) => h.card.id === pending.requested)?.uid
    if (!copyUid) return
    const key = `${pending.player}:${pending.requested}:${copyUid}`
    if (handed.current === key) return
    handed.current = key
    actions?.onResolve?.({ kind: 'giveCard', card: copyUid })
  }, [giving, pending, state.you.hand, actions])

  // A new match starts the surface over: a name armed in a dead match must not
  // confirm into the new one. The same boundary `useBeats` and both sibling
  // staging hooks already take.
  const playing = useRef<string | null>(null)
  useEffect(() => {
    if (matchKey == null || playing.current === matchKey) return
    playing.current = matchKey
    setNamed(null)
    setConfirmed(false)
    handed.current = null
  }, [matchKey])

  // Nothing armed survives the pending it was armed for.
  useEffect(() => {
    if (!asking) {
      setNamed(null)
      setConfirmed(false)
    }
  }, [asking])

  if (!asking) return { band: null }

  return {
    band: (
      <div className={styles.requestBand} data-testid="board-request-band">
        <CardCatalog
          cards={HOLDABLE}
          open={!confirmed}
          selected={named}
          chosen={confirmed ? named : null}
          onPick={(c) => setNamed(c.id)}
        />
        <ConfirmAction
          open={!confirmed}
          label={copy.confirm}
          caption={copy.prompt}
          disabled={named == null}
          onConfirm={() => {
            // Membership is re-checked against THIS render's offer, not merely
            // against "something is selected" — the discipline every branch of
            // the kit's own panel keeps, for the same reason.
            if (!named || !HOLDABLE.some((c) => c.id === named)) return
            setConfirmed(true)
            actions?.onResolve?.({ kind: 'requestCard', card: named })
          }}
        />
      </div>
    ),
  }
}
```

- [ ] **Step 4: Add the band's stylesheet**

Create `apps/frontend/src/pages/board/[gameId]/_useRequestStaging.module.css` — the hook owns its own, the way `_useZonePull.module.css` does, rather than reaching into the page's:

```css
/* The catalog band — the middle of the table, between the seats and the fan.
   Below the flyer layer on purpose: a card taken from an opponent flies over
   the catalog it was named in, not under it. */
.requestBand {
  position: absolute;
  inset-inline: 0;
  inset-block-start: 50%;
  transform: translateY(-50%);
  z-index: 40;
  display: flex;
  justify-content: center;
}
```

- [ ] **Step 5: Wire `_Board.tsx`**

Add the import:

```ts
import { useRequestStaging } from './_useRequestStaging'
```

Instantiate it beside `neutralizing` (around line 368):

```ts
  // naming a card, and losing one (#105). The band replaces the panel for
  // `requestCard`; the `giveCard` half answers itself and renders nothing.
  const requesting = useRequestStaging({
    state,
    actions,
    copy: {
      prompt: copy.pending.requestCard.prompt,
      action: copy.pending.requestCard.action,
      confirm: copy.pending.confirm,
    },
    enabled: !(deal.active || beats.exclusive),
    matchKey: intro?.gameId ?? null,
  })
```

Extend the `PendingPrompt` suppression list (around line 1462) with the two new kinds, and add them to the comment above it — the band is the asker for one, and the other has no question in it:

```ts
      {state.pending?.player === state.selfId &&
        state.pending.kind !== 'discardForRelease' &&
        state.pending.kind !== 'defend' &&
        state.pending.kind !== 'neutralize503' &&
        // the band on the table asks this one, for the same reason the three
        // above are asked by the cards themselves (#105)
        state.pending.kind !== 'requestCard' &&
        // …and this one is not a question: the copies differ only by uid, so
        // `_useRequestStaging` answers it and the victim watches the scene
        state.pending.kind !== 'giveCard' && (
          <PendingPrompt
```

Render the band beside the other staging overlays:

```ts
      {requesting.band}
```

And stand the named card at the centre for **every** peer while a `giveCard` is open. Put it inside the existing `.centre` slot, beside the `pendingDefend` and `pendingAlarm` renders:

```ts
        {/* the card that was named, held publicly while the engine waits for it
            to be handed over. This is what carries it across the gap between
            `requested` and `handTransfer` — they arrive in different batches,
            so no beat overlay can span it — and `giveCard` is projected to
            everyone (fake/attacks.ts:444), so every peer stands the same card. */}
        {state.pending?.kind === 'giveCard' &&
          (() => {
            const data = cardById(state.pending.requested)
            if (!data) return null
            return (
              <div className={opening.centreCard} data-testid="board-requested-card">
                <Card card={data} interactive={false} width="100%" />
              </div>
            )
          })()}
```

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm -C apps/frontend test -- boardTransfer`
Expected: PASS, all four tests.

- [ ] **Step 7: Full suite, typecheck, lint, commit**

Run: `pnpm -C apps/frontend test`
Expected: PASS (see Task 3 Step 7 on `boardIntro`).

Run: `pnpm typecheck`
Expected: all seven packages Done.

Run: `npx release-lint check --error-on-warnings "apps/frontend/src/pages/board/[gameId]/"`
Expected: no fixes applied.

```bash
git add "apps/frontend/src/pages/board/[gameId]/"
git commit -m "The ask: a catalog band on the table, and a hand-over with no question in it (#105)"
```

---

### Task 9: The written spec, the audit page, and the findings

CLAUDE.md makes the audit page and `docs/animations/` a matched pair with the code, and two of the three recipes here are describing implementations that do not exist. Fixing them is the deliverable, not a tidy-up.

**Files:**
- Modify: `docs/animations/recipes.md`
- Modify: `docs/animations/reference.md`
- Modify: `docs/animations/backlog.md`
- Modify: `apps/playground/stories/AnimationAuditStory/AnimationAuditStory.tsx`

- [ ] **Step 1: Correct the two stale recipes**

In `docs/animations/recipes.md`:

- **"Opponent takes your card"** (~line 1699) describes a two-hop flight ending at an opponent **fan** centre with `rotate(180)` and `zIndex` dropping to 30. The story has used **Seats** since `440bc56`: it aims at `cardBoxIn(seat, r.width * SEAT_SHRINK)` and the card shrinks in and fades — the `dealToSeat` movement. Rewrite the Visual result, Elements/refs (`seatRefs`, not `fanRef`), Sequence step 3, and the Invariants block to match the story as it stands.
- **"Taking an opponent's card — deal grid, flip the pick, settle into the hand"** (~line 1119) describes a centred grid built from `gridPositions`, `ORIGIN`, `COLS_MAX`, `DEAL_CARD_W` and `slotRefs`. `PickOpponentCardStory` renders `<Hand faceDown>` sliding down from the top and has none of those names; repo-wide they belong to `GameEndStory` and `ComboStory`. Rewrite it against the fan the story actually has.

- [ ] **Step 2: Add the board recipe**

A new section after the two above, covering what this task shipped: the three audiences (taker / victim / watcher), the `requested` entrance and its miss, the offer before a random steal, and the fact that the named card is held by the projection rather than by a beat. Follow the house shape the other recipes use — **When to call · Visual result · Elements / refs · Sequence · Params & timings · Invariants · End state & cleanup · Building blocks · Live reference**.

- [ ] **Step 3: Add the beat registry row**

In `docs/animations/reference.md`, in the beat registry table beside `draw` and `reshuffle`:

```markdown
| `transfer` | `features/board-beats/transferBeat.tsx` | `requested`, `handTransfer` | `takeFromSeat`, `dealToSeat`, `playToCenter`, `landInPose`, `flipCard` (via `Card`), `shake`, the hand-arrival step |
```

- [ ] **Step 4: Update the audit page**

In `apps/playground/stories/AnimationAuditStory/AnimationAuditStory.tsx`:

- Correct the `OpponentTakesCardStory` entry (`where: 'OpponentTakesCardStory'`), which repeats the abandoned fan flight — `rotate(180)`, `zIndex` 30, "tuck behind the fan".
- Correct the `PickOpponentCard` entry, which says "раздача-грид карт рубашкой / a deal-grid of face-down cards".
- Add `board:` pointers to all three scene entries, in the shape the Error 503 and canonical-hand entries already use: `features/board-beats/transferBeat.tsx, pages/board/[gameId]/_useRequestStaging.tsx, pages/board/[gameId]/_Board.tsx`.
- Update the open finding "A missed Security Bug has nothing to show it" — the board now carries it publicly, so record what shipped and close it.

Both languages. Every entry on that page is `{ ru, en }`.

- [ ] **Step 5: Record the two findings that stay open**

In `docs/animations/backlog.md` and in the audit page's `ISSUES` register (status `open`, both languages):

1. **The rules stand the Security Bug at the centre while the asker chooses; the engine has already banked it.** `docs/rules/cards.md:126` says the attack card lies at the centre for the whole table for the duration of the choice — that is the table's evidence it was played. `onHandDefend` banks it with `bankSpent(..., 'attackSpent')` in the same reduction that raises `pending: requestCard` (`fake/attacks.ts:191-208`), so the projection has it in the discard before anybody chooses. The board cannot stand a card the projection says is in the heap. What closes it: the engine parking the attack card on the `requestCard` pending, the way `defend` already parks a thrown attack — an engine change with its own conformance surface, which is why it is recorded and not done here.
2. **The written spec drifted from two scenes and nothing caught it.** `recipes.md` and the audit page described an opponent fan for `OpponentTakesCardStory` and a deal grid for `PickOpponentCardStory`; neither exists, and one of them never did. `docs.test.ts` catches an undocumented **preset**, but nothing checks that a recipe still describes the scene it names. Both are corrected by this task; the gap that let them rot is not. What would close it: a test that reads each recipe's "Live reference" story and asserts the identifiers the recipe names actually appear in it.

- [ ] **Step 6: Verify and commit**

Run: `pnpm -C apps/ui test -- docs`
Expected: PASS — every preset, including `takeFromSeat`, has its row.

Run: `pnpm -C apps/playground test`
Expected: PASS.

Run: `pnpm typecheck`
Expected: all seven packages Done.

```bash
git add docs/animations/ apps/playground/stories/AnimationAuditStory/
git commit -m "The animation spec catches up with two scenes it never described (#105)"
```

---

## Self-Review

**Spec coverage.** Every section of the design has a task: the `takeFromSeat` preset (Decision 6) → Task 1; the two plan kinds and all three derivations → Task 2; `runTransfer`'s three legs → Tasks 3–5; `runRequested`'s entrance and miss, both refusal renderings (Decision 3) → Task 6; the offer before a random steal (Decision 4, as corrected) → Task 7; the band and the auto-resolve (Decisions 1, 2) and the public centre card (Decision 7) → Task 8; the documentation and both open findings → Task 9. Decision 5 (one hook, one runner) is the file structure itself. Decision 8 (the kit's guess space) landed before this plan, in `25381ca`, and Task 8 reuses its filter.

**Placeholders.** None. Every code step carries the actual code. Two steps carry a judgement rather than a literal — Task 6 Step 4 asks the implementer to confirm two token names exist before using them (and forbids inventing a colour), and Task 9 Steps 1–2 describe prose to rewrite rather than dictating the paragraphs. Both are deliberate: the first is a check that must happen against the real token file, and the second is documentation whose wording is not mechanically derivable.

**Type consistency.** `TransferRole` is defined in Task 2 and used by name in Tasks 3–7. `useTransferBeat` returns `{ overlay, gapAt, gapSize, runTransfer, reset }` from Task 3 and gains `runRequested` in Task 6 — `useBeats` is wired for `handTransfer` in Task 3 and for `requested` in Task 6, matching. `KEY`, `COVER`, `SEAT_SHRINK`, `rectOf`, `dropFromDonor` and `ctx` are declared in Task 3 and reused unchanged afterwards; `COVER` is introduced in Task 5 and then also used by Task 7's offer, which is why Task 7 comes after it. `offerPoses` is Task 7's alone. The test helpers `transferPlan` and `runTransfer` are exported from the test file in Task 3 and reused in Tasks 4, 5 and 7; `requestPlan` and the second probe arrive in Task 6.

**One ordering constraint worth stating.** Task 7 depends on `COVER` from Task 5, not merely on Task 3. Running the tasks out of order would leave the offer with no card to fan.
