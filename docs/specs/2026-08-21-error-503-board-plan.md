# Error 503 on the board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the playground's `Error503Story` to the real board — the alarm's edge glow, the 503 standing at the centre until it is answered, three card gestures for the three neutralize methods, one exchange that takes the alarm and its answer away together, and the sweep that empties a defenceless player's table.

**Architecture:** The engine stops banking the 503 at reveal and parks it on the `neutralize503` pending, exactly as `defend` already parks a thrown attack — which makes the board render the alarm from the projection through the static centre block a pending attack already uses. A new sibling staging hook owns the three gestures; `defenseBeat` grows `runNeutralized`, sharing `runCovered`'s exchange exit; `discard` grows a `gather` flag for the sweep. The pull-and-cover cycle both staging hooks need is extracted once rather than copied a third time.

**Tech Stack:** TypeScript, React 19, Vite, Vitest + @testing-library/react, CSS Modules with design tokens, pnpm workspaces. Animation through `@release/ui/animations` (`play`, `useFlyer`, `useDiscardExit`, `useHandArrival`, `scatterAt`, `nextFrames`, `wait`).

**Spec:** [`docs/specs/2026-08-21-error-503-board-design.md`](./2026-08-21-error-503-board-design.md)

## Global Constraints

- **Branch:** `feat/102-error-503`, stacked on `origin/feat/101-defense-release`. Rebase onto `main` when [#121](https://github.com/MythHand/ReleaseBoardGameP2P/pull/121) merges. The PR closes [#102](https://github.com/MythHand/ReleaseBoardGameP2P/issues/102).
- **`prefers-reduced-motion` is honoured everywhere.** `play()` drives WAAPI directly and does **not** check it — JS choreography asks through `useReducedMotion` / the Wave 0 layer; CSS uses a media query. Never assume a global reset: `apps/frontend/src/app/index.css:24` covers view transitions only.
- **No hardcoded colours.** Every colour comes from a token in `apps/ui/src/design/tokens.css` via `var(--*)`. Missing one → add the token first.
- **All user-visible text through `@release/translation`.** A key must exist in **both** `packages/translation/src/locales/en/common.json` and `…/ru/common.json`. No string literals in `.tsx`.
- **Code comments in English.**
- **Guessing about the rules is forbidden.** Anything not settled by `docs/rules/` goes to `docs/rules/backlog.md` **and** gets a `> ❓ **Не из правил.**` marker at the exact paragraph in the spec.
- **A movement found in two scenes is a module that has not been packaged yet.** Port into the shared home; never copy into a second place.
- **Run into a gap — record it** in the audit page's register (`apps/playground/stories/AnimationAuditStory`) **and** `docs/animations/backlog.md`.
- **Commands:** `pnpm test` (all), `pnpm -C apps/frontend test <path>` (one package), `pnpm typecheck`, `pnpm lint`. A pre-commit hook runs `typecheck`; expect it on every commit.

---

### Task 1: The engine — the 503 stands until it is answered

The engine banks the alarm the instant it is revealed, so by the projection it is in the heap while the player is still choosing. `docs/rules/resolution.md`'s destinations table says otherwise: `trigger-error-503` **после нейтрализации** → «сброс (вместе с картой, которой нейтрализовали)». One moment, both cards. This task makes the code match, which also makes the pending a structural twin of `defend`.

**Files:**
- Modify: `packages/engine/src/state.ts:105`
- Modify: `packages/engine/src/view.ts:54`
- Modify: `packages/engine/src/fake/attacks.ts:441-442` (`pendingView`)
- Modify: `packages/engine/src/fake/triggers.ts:121-132, 176-210`
- Modify: `packages/engine/src/conformance.ts:388`
- Modify: `apps/ui/src/table/Table/intents.ts:45`
- Test: `packages/engine/src/fake/triggers.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Pending` variant `{ kind: 'neutralize503'; player: PlayerId; card: CardInstance; methods: NeutralizeMethod[] }`; `PendingView` and `TablePending` variant `{ kind: 'neutralize503'; player: string; card: CardId; methods: NeutralizeMethodId[] }`. Every later task reads `pending.card` as the alarm's card id.

- [ ] **Step 1: Write the failing tests**

Add to `packages/engine/src/fake/triggers.test.ts`. The existing `reveals Error 503 to everyone and demands neutralization` test asserts `toEqual({ kind, player, methods })` — it must gain `card`, so edit it in place rather than adding a duplicate:

```ts
it('reveals Error 503 to everyone and demands neutralization', () => {
  const r = reduce(withTop(E503, [DBG]), { type: 'DRAW', player: 'p1', at: 1000 })
  const revealed = r.events.find((e) => e.type === 'revealed')
  expect(revealed).toBeDefined()
  expect(revealed?.visibleTo).toBeUndefined()
  expect(r.state.pending).toEqual({
    kind: 'neutralize503',
    player: 'p1',
    card: E503,
    methods: ['debugger'],
  })
})

it('holds the alarm on the pending instead of banking it at the reveal', () => {
  const r = reduce(withTop(E503, [DBG]), { type: 'DRAW', player: 'p1', at: 1000 })
  // by the rules it reaches the discard only once it has been neutralized
  expect(r.state.decks.discard.map((c) => c.uid)).not.toContain(E503.uid)
  expect(r.events.filter((e) => e.type === 'discarded')).toEqual([])
})

it('banks the alarm with the Debugger that answered it, alarm first', () => {
  const drawn = reduce(withTop(E503, [DBG]), { type: 'DRAW', player: 'p1', at: 1000 })
  const r = reduce(drawn.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'neutralize503', method: 'debugger' },
    at: 1001,
  })
  expect(r.events.map((e) => e.type)).toEqual(['neutralized', 'discarded', 'discarded'])
  const discards = r.events.filter((e) => e.type === 'discarded')
  // alarm first: the discard event ids are what give the exchange its layering
  // on the board, and each card lands on the scatter its own id produces (I7)
  expect(discards.map((e) => (e.type === 'discarded' ? e.card : null))).toEqual([
    'trigger-error-503',
    'protection-debugger',
  ])
  expect(discards.map((e) => (e.type === 'discarded' ? e.reason : null))).toEqual([
    'trigger',
    'neutralized',
  ])
  // both hang off the `neutralized` that caused them
  const cause = r.events.find((e) => e.type === 'neutralized')
  expect(discards.every((e) => e.parent === cause?.id)).toBe(true)
  expect(r.state.pending).toBeNull()
})

it('banks the alarm when Monitoring answers, and Monitoring stays', () => {
  const s = withTop(E503, [])
  const guarded: GameState = {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1, release: { monitoring: MON } } },
  }
  const drawn = reduce(guarded, { type: 'DRAW', player: 'p1', at: 1000 })
  const r = reduce(drawn.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'neutralize503', method: 'monitoring' },
    at: 1001,
  })
  expect(r.state.players.p1.release.monitoring).toEqual(MON)
  expect(r.state.decks.discard.map((c) => c.uid)).toEqual([E503.uid])
  expect(r.events.map((e) => e.type)).toEqual(['neutralized', 'discarded'])
})

it('banks the alarm when a release is sacrificed for it', () => {
  const s = withTop(E503, [])
  const holding: GameState = {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1, release: { frontend: { card: FE } } } },
  }
  const drawn = reduce(holding, { type: 'DRAW', player: 'p1', at: 1000 })
  const r = reduce(drawn.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'neutralize503', method: 'sacrifice', card: FE.uid },
    at: 1001,
  })
  expect(r.events.map((e) => e.type)).toEqual([
    'neutralized',
    'discarded', // the alarm
    'releaseDestroyed',
    'discarded', // the release that paid for it
  ])
  expect(r.state.decks.discard.map((c) => c.uid)).toEqual([E503.uid, FE.uid])
  expect(r.state.players.p1.release.frontend).toBeUndefined()
})

it('still banks the alarm at once when there is no way out', () => {
  // the defenceless path is unchanged: nothing stands, because nothing is asked
  const r = reduce(withTop(E503, []), { type: 'DRAW', player: 'p1', at: 1000 })
  expect(r.state.pending).toBeNull()
  expect(r.state.decks.discard.map((c) => c.uid)).toContain(E503.uid)
  expect(r.state.eliminated).toEqual(['p1'])
})

it('projects the alarm card to everyone at the table', () => {
  const drawn = reduce(withTop(E503, [DBG]), { type: 'DRAW', player: 'p1', at: 1000 })
  // the rules make the reveal mandatory, so the card is public — not gated on
  // `mine` the way an owner-only option list is
  for (const viewer of ['p1', 'p2'] as const) {
    const view = project(drawn.state, viewer)
    expect(view.pending).toMatchObject({ kind: 'neutralize503', card: 'trigger-error-503' })
  }
})
```

`project` needs importing at the top of the test file:

```ts
import { playableFor, project } from './project'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/engine test triggers`
Expected: FAIL — `pending` has no `card`, discards land at the reveal, and `project` is not exported from `./project` if the name differs (check the real export and use it).

- [ ] **Step 3: Widen the pending's type across the three declarations**

`packages/engine/src/state.ts:105` — the alarm waits here, the way `defend` waits with its thrown attack:

```ts
  // The alarm waits here while its answer is chosen — out of the deck, in no
  // hand and no zone, exactly as a thrown attack waits on a `defend`. By the
  // rules it reaches the discard only once it has been neutralized, «вместе с
  // картой, которой нейтрализовали» (docs/rules/resolution.md), so holding it
  // is what lets both leave in one moment.
  | { kind: 'neutralize503'; player: PlayerId; card: CardInstance; methods: NeutralizeMethod[] }
```

`packages/engine/src/view.ts:54` — public, because the reveal is mandatory (`docs/rules/cards.md`, «немедленно, с показом всем»):

```ts
  | { kind: 'neutralize503'; player: PlayerId; card: CardId; methods: NeutralizeMethod[] }
```

`apps/ui/src/table/Table/intents.ts:45` — the kit's structural mirror:

```ts
  | { kind: 'neutralize503'; player: string; card: string; methods: NeutralizeMethodId[] }
```

`packages/engine/src/fake/attacks.ts:441-442` in `pendingView` — not gated on `mine`, unlike an option list:

```ts
    case 'neutralize503':
      return {
        kind: 'neutralize503',
        player: p.player,
        // public: the rules oblige the drawer to show it to everyone
        card: p.card.id,
        methods: [...p.methods],
      }
```

- [ ] **Step 4: Count the held card in the conservation invariant**

`packages/engine/src/conformance.ts`, immediately after the `defend` line at :388:

```ts
  if (state.pending?.kind === 'defend') uids.push(state.pending.attack)
  // The alarm while its answer is being chosen — same mid-air state as a thrown
  // attack above, and the same reason a stream ending here must not read as a
  // lost card.
  if (state.pending?.kind === 'neutralize503') uids.push(state.pending.card.uid)
```

- [ ] **Step 5: Hold the card in `fireTrigger`**

`packages/engine/src/fake/triggers.ts`, replacing the `trigger-error-503` branch at :122-132:

```ts
  if (card.id === 'trigger-error-503') {
    const revealedId = log.add({ type: 'revealed', player, card: card.id })
    const methods = neutralizeOptions(state, player)
    // No way out: nothing is asked, so nothing stands. The card is banked here
    // and the elimination follows in the same batch — unchanged from before.
    if (methods.length === 0) {
      log.add({ type: 'discarded', player, card: card.id, reason: 'trigger' }, revealedId)
      return eliminate(discard(state, [card]), log, player)
    }
    // …otherwise the alarm STANDS. It waits on the pending until an answer is
    // chosen, and the two go to the discard together (resolution.md's own
    // destinations table). Holding it is also what lets the board cover it:
    // a card already in the heap cannot be answered on the table.
    return {
      ...state,
      pending: { kind: 'neutralize503', player, card, methods },
      eventSeq: log.seq,
    }
  }
```

- [ ] **Step 6: Bank the alarm in `onNeutralize`**

Add this helper above `onNeutralize` in the same file:

```ts
// The alarm leaves WITH the answer, never before it — one moment for both
// cards (docs/rules/resolution.md's destinations table). Banked FIRST of the
// two, because the discard event ids are what give the exchange its layering
// on the board (the alarm underneath, the answer on top) and each card lands
// on the scatter its own id produces.
//
// `card` is null for a `crush`, which raises the same three methods with no
// card of its own standing anywhere — the AI event card is not on the table.
function bankAlarm(
  state: GameState,
  log: Log,
  player: PlayerId,
  card: CardInstance | null,
  parent: number,
): GameState {
  if (!card) return { ...state, eventSeq: log.seq }
  log.add({ type: 'discarded', player, card: card.id, reason: 'trigger' }, parent)
  return { ...discard(state, [card]), eventSeq: log.seq }
}
```

Then inside `onNeutralize`, after the existing `const hand = …` line:

```ts
  // Only the 503 holds a card; `crush` shares this reducer and holds none.
  const alarm = pending.kind === 'neutralize503' ? pending.card : null
```

Rewrite the three branches. Debugger:

```ts
  if (choice.method === 'debugger') {
    const dbg = hand.find((c) => c.id === 'protection-debugger')
    if (!dbg) return reject(state, action, 'you do not hold a Debugger')
    const neutralizedId = log.add({ type: 'neutralized', player, method: 'debugger' })
    const withAlarm = bankAlarm(state, log, player, alarm, neutralizedId)
    log.add({ type: 'discarded', player, card: dbg.id, reason: 'neutralized' }, neutralizedId)
    const withoutDbg = setHand(
      withAlarm,
      player,
      hand.filter((c) => c.uid !== dbg.uid),
    )
    return {
      // `discard` rather than appending to `decks.discard` by hand, matching
      // every other bank in this file. Identical for a Debugger, which is
      // never an events-deck card, and correct if that ever changes.
      state: { ...discard(withoutDbg, [dbg]), pending: null, eventSeq: log.seq },
      events: log.events,
    }
  }
```

Monitoring:

```ts
  if (choice.method === 'monitoring') {
    const mon = state.players[player].release.monitoring
    if (!mon) return reject(state, action, 'you do not have a Monitoring')
    const neutralizedId = log.add({ type: 'neutralized', player, method: 'monitoring' })
    const withAlarm = bankAlarm(state, log, player, alarm, neutralizedId)
    return { state: { ...withAlarm, pending: null, eventSeq: log.seq }, events: log.events }
  }
```

Sacrifice — the slot lookup still reads `state`, whose zone banking the alarm does not touch:

```ts
  // sacrifice
  if (!choice.card) return reject(state, action, 'sacrifice needs a release card')
  const slot = SLOTS.find((s) => state.players[player].release[s]?.card.uid === choice.card)
  if (!slot) return reject(state, action, 'you do not hold that release')
  const neutralizedId = log.add({ type: 'neutralized', player, method: 'sacrifice' })
  const withAlarm = bankAlarm(state, log, player, alarm, neutralizedId)
  const destroyed = destroySlot(withAlarm, log, player, slot, 'neutralized', neutralizedId)
  return { state: { ...destroyed, pending: null, eventSeq: log.seq }, events: log.events }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm -C packages/engine test triggers`
Expected: PASS.

- [ ] **Step 8: Run the whole engine suite and the type contracts**

Run: `pnpm -C packages/engine test && pnpm typecheck`
Expected: PASS. `apps/frontend/src/entities/game/board/contract.test-d.ts` and `engineContract.test-d.ts` assert assignability both ways between the engine's `PendingView` and the kit's `TablePending` — if `intents.ts` was missed in Step 3, this is where it fails.

If `packages/engine/src/fake/bots.ts` or `referee.ts` constructs a `neutralize503` pending anywhere, the compiler names the site; give it the card it is answering.

- [ ] **Step 9: Commit**

```bash
git add packages/engine apps/ui/src/table/Table/intents.ts
git commit -m "fix(engine): the 503 waits on its pending and leaves with the card that answered it (#102)"
```

---

### Task 2: The adapter keeps the release uids

`ReleaseView`'s slots carry `uid` and card id, but `toBoardState` keeps only the card data — the kit's `ReleaseSlots` is deliberately domain-free. So the board has no uid to put in a sacrifice choice.

**Files:**
- Modify: `apps/frontend/src/entities/game/board/types.ts` (the `BoardState['you']` block)
- Modify: `apps/frontend/src/entities/game/board/toBoardState.ts:32-38`
- Test: `apps/frontend/src/entities/game/board/toBoardState.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BoardState['you'].releaseUid?: Partial<Record<'frontend' | 'backend' | 'database' | 'monitoring', string>>`. Task 9 reads it to name the release a sacrifice burns.

- [ ] **Step 1: Write the failing test**

Add to `apps/frontend/src/entities/game/board/toBoardState.test.ts`, following the file's existing view-fixture idiom:

```ts
it('keeps the uid of every release the player holds', () => {
  const view = viewWith({
    self: {
      release: {
        frontend: { uid: 'release-frontend#3', card: 'release-frontend' },
        monitoring: { uid: 'protection-monitoring#1', card: 'protection-monitoring' },
      },
    },
  })
  const state = toBoardState(view, [], labels)
  // the card data the kit renders is unchanged…
  expect(state.you.release.frontend?.id).toBe('release-frontend')
  // …and the uid the engine needs to be told which release was sacrificed
  // survives beside it
  expect(state.you.releaseUid).toEqual({
    frontend: 'release-frontend#3',
    monitoring: 'protection-monitoring#1',
  })
})
```

Match `viewWith` / `labels` to whatever the file already uses to build a `PlayerView`; if there is no such helper, build the view inline the way the neighbouring tests do.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C apps/frontend test toBoardState`
Expected: FAIL — `state.you.releaseUid` is `undefined`.

- [ ] **Step 3: Add the field to `BoardState`**

In `apps/frontend/src/entities/game/board/types.ts`, inside `BoardState['you']`, beside `release`:

```ts
    // The uid of whatever stands in each slot. The kit's `ReleaseSlots` carries
    // card DATA and no identity — it is domain-free by design — but a choice
    // the engine has to act on names a uid (`neutralize503`'s sacrifice), so
    // the adapter keeps them here rather than widening the kit's own type.
    releaseUid?: Partial<Record<'frontend' | 'backend' | 'database' | 'monitoring', string>>
```

- [ ] **Step 4: Fill it in the adapter**

In `apps/frontend/src/entities/game/board/toBoardState.ts`, beside `toReleaseSlots`:

```ts
// The identities `toReleaseSlots` above drops. Same four keys, same source —
// split out because the kit's ReleaseSlots may not carry them.
function toReleaseUids(release: ReleaseView) {
  const out: NonNullable<BoardState['you']['releaseUid']> = {}
  if (release.frontend) out.frontend = release.frontend.uid
  if (release.backend) out.backend = release.backend.uid
  if (release.database) out.database = release.database.uid
  if (release.monitoring) out.monitoring = release.monitoring.uid
  return out
}
```

and add `releaseUid: toReleaseUids(view.self.release),` to the `you` object the adapter builds. Import `BoardState` if the file does not already type its own return.

Check the real shape of `ReleaseView` first — `monitoring` holds the instance itself while the three slots hold `{ card, codeReview? }` (see `conformance.ts:374-381`), so the `.uid` may sit one level down for the three. Read `packages/engine/src/view.ts`'s `ReleaseView` and match it exactly rather than assuming.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -C apps/frontend test toBoardState`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/entities/game/board
git commit -m "feat(web): the board can name the release it is about to burn (#102)"
```

---

### Task 3: Extract the pull-and-cover cycle — `_useCoverFlight.ts`

`commitAndFly` (`_useDefenseStaging.tsx:318-361`) is already "stand a card at a centre slot at a pose, gate the static render on `landed` with its `finally`, watch the feed past a dispatch watermark for `rejected`". Task 9 needs it identically. Wave 3's design promised this module and it did not land; this is the third-copy point, so it gets packaged now. **Pure refactor — no behaviour change, and `boardDefense.test.tsx` must stay green untouched.**

**Files:**
- Create: `apps/frontend/src/pages/board/[gameId]/_useCoverFlight.ts`
- Modify: `apps/frontend/src/pages/board/[gameId]/_useDefenseStaging.tsx:318-361` and its `rejected` watcher
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/coverFlight.test.tsx`

**Interfaces:**
- Consumes: `BoardAnchors`, `COVER_POSE` from `~/entities/game/board`.
- Produces:

```ts
export interface CoverFlight {
  /** true once the flight has landed, or at once under reduced motion */
  landed: boolean
  /** re-arm for a fresh cycle and fly `card` from `from` to `to` at `pose` */
  fly: (args: {
    card: CardData
    from: Rect | undefined
    to: () => DOMRect | undefined
    pose: { rot: number; dx: number; dy: number }
    key?: string
    content?: ReactNode
  }) => Promise<void>
  /** stamp the watermark at a dispatch: everything already in `events` is old news */
  mark: (events: Event[]) => void
  /** has the engine refused anything since the last `mark()`? */
  rejectedSince: (events: Event[]) => boolean
  overlay: ReactNode[]
  reset: () => void
}
export function useCoverFlight(): CoverFlight
```

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/pages/board/[gameId]/__tests__/coverFlight.test.tsx`:

```tsx
import type { Event } from '@release/engine'
import { cardById } from '@release/ui'
import { act, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useCoverFlight } from '../_useCoverFlight'

const played = vi.hoisted(() => ({ calls: [] as { name: string; params: Record<string, unknown> }[] }))
vi.mock('@release/ui/animations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@release/ui/animations')>()
  return {
    ...real,
    play: (name: string, _el: unknown, params: Record<string, unknown> = {}) => {
      played.calls.push({ name, params })
      return { finished: Promise.resolve() } as unknown as Animation
    },
  }
})

// biome-ignore lint/style/noNonNullAssertion: a known catalogue entry
const hotfix = cardById('defense-hotfix')!
const POSE = { rot: 6, dx: 16, dy: -12 }

function harness() {
  const api: { flight?: ReturnType<typeof useCoverFlight> } = {}
  function Probe() {
    api.flight = useCoverFlight()
    return <>{api.flight.overlay}</>
  }
  render(<Probe />)
  return api
}

it('is not landed until the flight finishes, and lands with the pose it was given', async () => {
  const api = harness()
  expect(api.flight?.landed).toBe(false)
  const to = document.createElement('div')
  await act(async () => {
    await api.flight?.fly({
      card: hotfix,
      from: { left: 0, top: 0, width: 150, height: 210 },
      to: () => to.getBoundingClientRect(),
      pose: POSE,
    })
  })
  expect(played.calls.at(-1)?.name).toBe('playToCenter')
  expect(played.calls.at(-1)?.params).toMatchObject({ rotate: 6, dx: 16, dy: -12 })
  expect(api.flight?.landed).toBe(true)
})

it('reports landed even when the animation is cancelled mid-flight', async () => {
  // the `finally` that #101 Fix D round 4 made load-bearing: a rejecting
  // `.finished` must still report the carrier gone, or a dispatched play
  // leaves a hole in the fan for the rest of the match
  played.calls.length = 0
  const api = harness()
  const to = document.createElement('div')
  await act(async () => {
    await api.flight?.fly({
      card: hotfix,
      from: undefined, // no source to measure — the flight cannot run at all
      to: () => to.getBoundingClientRect(),
      pose: POSE,
    })
  })
  expect(api.flight?.landed).toBe(true)
})

it('sees only rejections that arrive after the mark', () => {
  const api = harness()
  // a rejection that was already on the feed when we dispatched is not OURS —
  // the same watermark discipline `_useBoardStaging.ts` applies to this array
  const before: Event[] = [{ id: 1, type: 'rejected', action: {}, reason: 'nope' } as Event]
  act(() => api.flight?.mark(before))
  expect(api.flight?.rejectedSince(before)).toBe(false)
  const after: Event[] = [...before, { id: 2, type: 'rejected', action: {}, reason: 'no' } as Event]
  expect(api.flight?.rejectedSince(after)).toBe(true)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C apps/frontend test coverFlight`
Expected: FAIL — `_useCoverFlight` does not exist.

- [ ] **Step 3: Write the module**

Create `apps/frontend/src/pages/board/[gameId]/_useCoverFlight.ts`. Lift the body of `_useDefenseStaging.tsx`'s `commitAndFly` verbatim, keeping every comment that explains *why* — especially the `finally`'s. The module owns the flyer, the `landed` gate and the watermark; it owns no game state and no dispatch, which is what lets two hooks with different dispatches share it:

```ts
// The half of a staged answer that is the same wherever the answer came from:
// the card flies to a centre slot at a pose, and once its carrier lets go (or
// at once under reduced motion) the page's own static render may take over.
//
// Extracted at the third caller, not the second (#88's standing rule: a
// movement found in two scenes is a module that has not been packaged yet).
// `_useDefenseStaging.ts` had it privately for #101; `_useNeutralizeStaging`
// needs exactly it for #102, and the 2026-08-18 design promised this module
// and did not land it.
//
// What it deliberately does NOT own: the dispatch (a `defend` and a
// `neutralize503` are different choices) and the way home (the fan for a hand
// card, its own slot for a release). Both stay with the caller.
```

The `fly` implementation, with the ordering and the `finally` preserved:

```ts
  const fly = useCallback(
    async ({ card, from, to, pose, key = 'cover', content }: FlyArgs) => {
      setLanded(false) // fresh cycle — the flight below has not carried this card yet
      try {
        const dest = to()
        if (!reduced && from && dest) {
          const [el] = await flyer.raise([{ key, card: content ? undefined : card, at: from, content }])
          if (el) {
            await play('playToCenter', el, {
              from,
              to: dest,
              rotate: pose.rot,
              dx: pose.dx,
              dy: pose.dy,
            })?.finished
          }
          flyer.drop(key)
        }
      } finally {
        // the carrier has dropped it (or, under reduced motion, there was never
        // one) — the caller's static render may take over now, not a moment
        // before. In a `finally` since #101, Fix D round 4, and load-bearing
        // there: a `.finished` that rejects must still report the carrier gone,
        // or `landed` stays false with a dispatched play staged and the fan
        // keeps a hole in it for the rest of the match.
        setLanded(true)
      }
    },
    [reduced, flyer.raise, flyer.drop],
  )
```

and the watermark:

```ts
  // captured the instant a dispatch commits — the caller's rejected-watcher
  // reads only what came AFTER this point, the same discipline
  // `_useBoardStaging.ts` applies to this same array.
  const watermark = useRef(0)
  const mark = useCallback((events: Event[]) => {
    watermark.current = events.length
  }, [])
  const rejectedSince = useCallback(
    (events: Event[]) => events.slice(watermark.current).some((e) => e.type === 'rejected'),
    [],
  )
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `pnpm -C apps/frontend test coverFlight`
Expected: PASS.

- [ ] **Step 5: Rewrite `_useDefenseStaging` onto it**

Replace `commitAndFly`'s inline flight with a `coverFlight.fly(...)` call and its `landed`/watermark state with the module's, keeping every behaviour: the dispatch still happens **synchronously before** the flight starts (the no-duplicate rule requires it), and `stageDefSudo`'s own flight to `anchors.sudo` uses the same `fly` with `SUDO_POSE` and `key: 'sudo'`. The fold (`onCardClick`) keeps its own bespoke two-element `foldIntoPair` — that is not this module's shape and must not be forced into it.

- [ ] **Step 6: Run the Wave 3 suites untouched**

Run: `pnpm -C apps/frontend test boardDefense comboHandoff boardRelease`
Expected: PASS, with **no edits to those test files**. A refactor that needs its tests changed is not a refactor — if one fails, the extraction changed behaviour; fix the module, not the test.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/pages/board
git commit -m "refactor(web): the stand-a-card-at-the-centre cycle becomes a module its second caller can use (#102)"
```

---

### Task 4: The alarm renders — the glow, and the 503 at the centre

The read-only half: the board shows the alarm. No gesture yet — `PendingPrompt` still answers it, so the game stays playable at this commit.

**Files:**
- Modify: `apps/ui/src/design/tokens.css`
- Modify: `apps/ui/src/primitives/EdgeGlow/EdgeGlow.tsx:20`
- Modify: `apps/ui/src/primitives/EdgeGlow/EdgeGlow.module.css`
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx`
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/boardAlarm.test.tsx` (new)

**Interfaces:**
- Consumes: `pending.card` from Task 1.
- Produces: `const pendingAlarm` in `_Board.tsx` — `state.pending` narrowed to `neutralize503` or null; `data-testid="board-centre-alarm"` on the standing card; `data-testid="board-glow-strong"` / `"board-glow-weak"` on the two layers.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/pages/board/[gameId]/__tests__/boardAlarm.test.tsx`, using the fixture the sibling board tests already share (`./fixture`):

```tsx
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import Board from '../_Board'
import { boardProps, withPending } from './fixture'

const alarm = { kind: 'neutralize503' as const, player: 'p1', card: 'trigger-error-503', methods: ['debugger' as const] }

it('stands the alarm at the centre while the decision is ours', () => {
  render(<Board {...withPending(boardProps(), alarm)} />)
  expect(screen.getByTestId('board-centre-alarm')).toBeInTheDocument()
})

it('lights the table strongly, under the hand, when the alarm is ours', () => {
  const { container } = render(<Board {...withPending(boardProps(), alarm)} />)
  const glow = screen.getByTestId('board-glow-strong')
  const you = container.querySelector('[data-testid="board-you"]')
  expect(glow).toBeInTheDocument()
  expect(screen.queryByTestId('board-glow-weak')).not.toBeInTheDocument()
  // DOM ORDER IS THE RULE: our own alarm sits BEFORE the hand, so it glows
  // under it. `compareDocumentPosition` returns FOLLOWING for a node that
  // comes later in the document.
  expect(glow.compareDocumentPosition(you as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('lights an opponent’s alarm weakly, over the hand', () => {
  const theirs = { ...alarm, player: 'p2' }
  const { container } = render(<Board {...withPending(boardProps(), theirs)} />)
  const glow = screen.getByTestId('board-glow-weak')
  const you = container.querySelector('[data-testid="board-you"]')
  expect(screen.queryByTestId('board-glow-strong')).not.toBeInTheDocument()
  expect(glow.compareDocumentPosition(you as Node) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
})

it('shows no alarm at all with nothing pending', () => {
  render(<Board {...boardProps()} />)
  expect(screen.queryByTestId('board-centre-alarm')).not.toBeInTheDocument()
  expect(screen.queryByTestId('board-glow-strong')).not.toBeInTheDocument()
  expect(screen.queryByTestId('board-glow-weak')).not.toBeInTheDocument()
})
```

Read `__tests__/fixture.ts` first and use its real exports; add a `withPending` helper there if it has none, next to whatever the defence tests use to set a pending.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C apps/frontend test boardAlarm`
Expected: FAIL — no such testids.

- [ ] **Step 3: Token, and the primitive's two fixes**

`apps/ui/src/design/tokens.css`, beside the other semantic colours:

```css
  /* the table's alarm — an Error 503 nobody has answered yet */
  --alarm-glow: #ff3344;
```

`apps/ui/src/primitives/EdgeGlow/EdgeGlow.tsx:20` — the Styling Rule forbids a hardcoded colour, and this is the primitive's default:

```tsx
  color = 'var(--alarm-glow)',
```

`apps/ui/src/primitives/EdgeGlow/EdgeGlow.module.css`, after `.glow`:

```css
/* The alarm still APPEARS under reduce — it is information, not decoration.
   Only the fade goes. Nothing global covers this: apps/frontend/src/app/index.css
   resets view transitions and nothing else. */
@media (prefers-reduced-motion: reduce) {
  .glow {
    transition: none;
  }
}
```

- [ ] **Step 4: Render the alarm in `_Board.tsx`**

Beside `pendingDefend` (`_Board.tsx:407`):

```tsx
  // The alarm standing at the centre. Read ONCE, same reason and same shape as
  // `pendingDefend` above. `staging.staged` does not gate it: an answer to a
  // 503 goes to the COVER slot, never over the alarm's own.
  const pendingAlarm = state.pending?.kind === 'neutralize503' ? state.pending : null
  const alarmMine = pendingAlarm?.player === state.selfId
```

Inside the `anchors.centre` block, after the `pendingDefend` render, add its twin — same slot, same inner `.pose` child so the slot rect stays the true card box (I6), resting at `ATTACK_POSE` because it is the thing being answered:

```tsx
        {pendingAlarm &&
          (() => {
            const data = cardById(pendingAlarm.card)
            if (!data) return null
            return (
              <div
                className={opening.centreCard}
                data-testid="board-centre-alarm"
                data-pending-play
              >
                <div className={opening.pose} style={{ transform: restTransform(ATTACK_POSE) }}>
                  <Card card={data} interactive={false} width="100%" />
                </div>
              </div>
            )
          })()}
```

Add `{...previewProps(pendingAlarm ? cardById(pendingAlarm.card) : null)}` to the centre slot's existing `previewProps` call by widening it — the alarm is a card standing at the centre and reading it is exactly what `CardPreview` is bound to those slots for:

```tsx
        {...previewProps(
          pendingDefend
            ? cardById(pendingDefend.attackCard)
            : pendingAlarm
              ? cardById(pendingAlarm.card)
              : null,
        )}
```

- [ ] **Step 5: Mount the two glow layers**

**Immediately before** `<div className={kit.you}>`:

```tsx
      {/* OUR OWN alarm — strong, and BEFORE the hand in the DOM so it glows
          UNDER it. The bounds are the table zone itself: `kit.table` is already
          `position: relative; overflow: hidden; isolation: isolate`, so the
          layout supplies them and there is nothing to measure. The playground's
          `.glowBounds` and its hardcoded tech-bar offsets stay in the
          playground — that story is explicitly not the reference here (Page
          Shell Rule, apps/playground/CLAUDE.md). */}
      {pendingAlarm && alarmMine && (
        <EdgeGlow visible intensity="strong" data-testid="board-glow-strong" />
      )}
```

**Immediately after** the closing `</div>` of `kit.you`:

```tsx
      {/* SOMEONE ELSE's alarm — weak, and AFTER the hand so it lies over it.
          `pointer-events: none` is already on the primitive for both
          intensities (EdgeGlow.module.css), so the fan's hover reaction is not
          smothered and the DOM position is the only thing to get right. */}
      {pendingAlarm && !alarmMine && (
        <EdgeGlow visible intensity="weak" data-testid="board-glow-weak" />
      )}
```

`EdgeGlow` takes no `data-testid` today. Add it to `EdgeGlowProps` as an explicit optional prop and spread it onto the div — do **not** widen the component to arbitrary props:

```tsx
interface EdgeGlowProps {
  visible?: boolean
  intensity?: 'strong' | 'weak'
  color?: string
  className?: string
  'data-testid'?: string
}
```

Add `EdgeGlow` to `_Board.tsx`'s `@release/ui` import, and give `kit.you`'s wrapper `data-testid="board-you"` if it has none.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -C apps/frontend test boardAlarm`
Expected: PASS.

- [ ] **Step 7: Check the rest of the board still renders**

Run: `pnpm -C apps/frontend test board && pnpm -C apps/ui test EdgeGlow && pnpm lint`
Expected: PASS. Stylelint is the one that catches a colour that did not become a token.

- [ ] **Step 8: Commit**

```bash
git add apps/ui apps/frontend/src/pages/board
git commit -m "feat(web,ui): an unanswered 503 stands at the centre and lights the table (#102)"
```

---

### Task 5: A revealed trigger may stand

`revealAfter` reads a trigger's reveal only when its `discarded` sits at `events[i + 2]`. After Task 1 it is not there, so the plan would carry neither `card` nor `reveal` and the draw would fall through to the opponent branch and fly a face-down card at a seat.

**Files:**
- Modify: `apps/frontend/src/features/board-beats/planBeats.ts:219-231` and the `PlannedDraw` interface
- Modify: `apps/frontend/src/features/board-beats/drawBeat.tsx:110-133`
- Test: `apps/frontend/src/features/board-beats/planBeats.test.ts`, `apps/frontend/src/features/board-beats/drawBeat.test.tsx`

**Interfaces:**
- Consumes: Task 1's deferred discard.
- Produces: `PlannedDraw['reveal']` is `{ card: string; discardId?: number }` — absent `discardId` means the trigger **stands** at the centre.

- [ ] **Step 1: Write the failing plan test**

Add to `planBeats.test.ts`, with the helpers the file already has:

```ts
const revealed = (over: Partial<Extract<Event, { type: 'revealed' }>> & { id: number }): Event =>
  ({ type: 'revealed', player: 'p1', card: 'trigger-error-503', ...over }) as Event
const drawn = (over: Partial<Extract<Event, { type: 'drawn' }>> & { id: number }): Event =>
  ({ type: 'drawn', player: 'p1', pile: 0, deckSize: 9, ...over }) as Event

it('plans a revealed trigger that stands, with no discard of its own', () => {
  const plans = planBeats([drawn({ id: 1 }), revealed({ id: 2 })], boardBefore())
  expect(plans).toEqual([
    {
      kind: 'draw',
      key: 'draw:1',
      draws: [
        {
          key: 'w1',
          eventId: 1,
          player: 'p1',
          pile: 0,
          mine: true,
          card: undefined,
          reveal: { card: 'trigger-error-503' },
        },
      ],
    },
  ])
})

it('still plans a revealed trigger that files itself, with its discard id', () => {
  const plans = planBeats(
    [
      drawn({ id: 1 }),
      revealed({ id: 2 }),
      discarded(3, { card: 'trigger-error-503', reason: 'trigger' }),
    ],
    boardBefore(),
  )
  const draw = plans[0] as Extract<import('./planBeats').BeatPlan, { kind: 'draw' }>
  expect(draw.draws[0].reveal).toEqual({ card: 'trigger-error-503', discardId: 3 })
  // and it is claimed, so the discard planner does not fly it a second time
  expect(plans.filter((p) => p.kind === 'discard')).toEqual([])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/frontend test planBeats`
Expected: FAIL — the standing case yields `reveal: undefined`.

- [ ] **Step 3: Widen `reveal` and `revealAfter`**

In `planBeats.ts`'s `PlannedDraw`:

```ts
  /**
   * Turned up in front of the whole table. `discardId` is the trigger's own
   * `discarded`, which the DRAW beat owns: the card is at the centre when it is
   * filed, and flying it from a hand slot it never occupied would be a lie.
   *
   * ABSENT means the trigger STANDS. An Error 503 that raises a
   * `neutralize503` is not banked until it is answered (#102, and
   * docs/rules/resolution.md's own destinations table), so there is no discard
   * to claim and nothing to fly — the beat hands it to the pending's static
   * render instead.
   */
  reveal?: { card: string; discardId?: number }
```

and `revealAfter`:

```ts
function revealAfter(events: Event[], i: number): { card: string; discardId?: number } | null {
  const reveal = events[i + 1]
  if (!reveal) return null
  const card =
    reveal.type === 'revealed' ? reveal.card : reveal.type === 'aiRevealed' ? reveal.aiCard : null
  if (card == null) return null
  const filed = events[i + 2]
  // No discard behind it: the trigger is standing, not leaving. Reported as a
  // reveal all the same — the flight to the centre and the flip are the same
  // either way, and only the tail differs.
  if (filed?.type !== 'discarded' || filed.card !== card) return { card }
  return { card, discardId: filed.id }
}
```

The caller at `planBeats.ts`'s `drawn` branch claims the discard only when there is one:

```ts
      const reveal = e.card === undefined ? revealAfter(events, i) : null
      if (reveal?.discardId !== undefined) owned.add(reveal.discardId)
```

- [ ] **Step 4: Write the failing beat test**

Add to `drawBeat.test.tsx`, in the file's own harness idiom:

```tsx
it('leaves a standing trigger at the centre and publishes the pending behind it', async () => {
  const { api, anchors, publishes } = harness()
  await drive(() =>
    api.beat?.run(
      {
        kind: 'draw',
        key: 'draw:1',
        draws: [
          {
            key: 'w1',
            eventId: 1,
            player: 'p1',
            pile: 0,
            mine: true,
            reveal: { card: 'trigger-error-503' },
          },
        ],
      },
      ctx,
    ),
  )
  // it did NOT leave for the heap
  expect(exits.items).toEqual([])
  // …and the shadow it published carries the alarm, so the static render is
  // already up when the carrier lets go
  expect(publishes.at(-1)?.pending).toEqual({
    kind: 'neutralize503',
    player: 'p1',
    card: 'trigger-error-503',
    methods: [],
  })
})
```

`harness()` must record `publish` calls; if it does not yet, give its `ctx` a `publish: (s) => publishes.push(s)` and export `publishes` from the harness.

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm -C apps/frontend test drawBeat`
Expected: FAIL — the beat still sends the card to the discard, or falls through.

- [ ] **Step 6: Split the reveal branch in `drawBeat`**

Replace the body of `if (d.reveal)` in `drawBeat.tsx`:

```tsx
        if (d.reveal) {
          // A trigger is turned up for the whole table and stands there.
          await wait(BEFORE_FLIP)
          patch('draw', { faceDown: false })
          await wait(AFTER_FLIP)
          await wait(REVEAL_HOLD)
          const card = cardById(d.reveal.card)
          if (card && d.reveal.discardId !== undefined) {
            // It leaves from the centre on the same scatter the heap already
            // rests it on (I7) — the flyer IS the card, so the step flies the
            // node rather than mounting a copy of it.
            await latest.current.exit.send([
              {
                key: `d${d.reveal.discardId}`,
                card,
                node: elOf('draw'),
                scatter: scatterAt(d.reveal.discardId),
              },
            ])
            drop('draw')
            continue
          }
          // IT STANDS. An unanswered Error 503 is held on its pending until a
          // method is chosen, so there is nothing to fly — the board's static
          // alarm render takes the slot instead. Publish first, drop second:
          // the board renders this beat's shadow while it runs
          // (_Board.tsx's `deal.shadow ?? beats.shadow ?? live`), so the
          // render is up before the carrier lets go and the slot is never
          // blank for a frame — the same handoff ordering the cover slot uses.
          //
          // `methods: []` because the beat CANNOT know them: they live on the
          // projection, and this runs against `base`. Empty is the honest
          // value and a safe one — it offers no answer, so the staging hook
          // stays inert, and the queue drains onto the live pending on the
          // next tick (a raised pending ends the batch; fireTrigger returns
          // there). A shadow of the projection for a frame, not a claim about
          // the game.
          const c = ctx.current
          if (c) {
            const next = {
              ...c.base,
              pending: {
                kind: 'neutralize503' as const,
                player: d.player,
                card: d.reveal.card,
                methods: [],
              },
            }
            c.base = next
            c.publish(next)
          }
          await nextFrames() // the publish above has committed (I2)
          drop('draw')
          continue
        }
```

Import `nextFrames` from `@release/ui/animations` in `drawBeat.tsx` if it is not already there.

- [ ] **Step 7: Run both suites to verify they pass**

Run: `pnpm -C apps/frontend test planBeats drawBeat`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/features/board-beats
git commit -m "feat(web): a revealed 503 stands at the centre instead of filing itself (#102)"
```

---

### Task 6: `planBeats` grows the `neutralized` plan

**Files:**
- Modify: `apps/frontend/src/features/board-beats/planBeats.ts`
- Test: `apps/frontend/src/features/board-beats/planBeats.test.ts`

**Interfaces:**
- Consumes: Task 1's event order (`neutralized`, then the alarm's discard, then the answer's).
- Produces:

```ts
  | {
      kind: 'neutralized'
      key: string
      eventId: number
      player: string
      method: 'debugger' | 'monitoring' | 'sacrifice'
      /** sacrifice only: the zone slot the answer flies out of */
      slot?: string
      /** the alarm's own discard — the card standing at the centre */
      alarm?: { eventId: number; card: string }
      /** what the answer cost: the Debugger, or the release and its Code Review */
      spent: { eventId: number; card: string }[]
    }
```

- [ ] **Step 1: Write the failing tests**

Add to `planBeats.test.ts`:

```ts
const neutralized = (
  over: Partial<Extract<Event, { type: 'neutralized' }>> & { id: number },
): Event => ({ type: 'neutralized', player: 'p1', method: 'debugger', ...over }) as Event

const alarmPending = () =>
  ({ kind: 'neutralize503', player: 'p1', card: 'trigger-error-503', methods: ['debugger'] }) as
    NonNullable<BoardState['pending']>

it('plans a Debugger answer as one exchange', () => {
  const plans = planBeats(
    [
      neutralized({ id: 10 }),
      discarded(11, { card: 'trigger-error-503', reason: 'trigger' }),
      discarded(12, { card: 'protection-debugger', reason: 'neutralized' }),
    ],
    boardBefore({ pending: alarmPending() }),
  )
  expect(plans).toEqual([
    {
      kind: 'neutralized',
      key: 'neutralized:10',
      eventId: 10,
      player: 'p1',
      method: 'debugger',
      alarm: { eventId: 11, card: 'trigger-error-503' },
      spent: [{ eventId: 12, card: 'protection-debugger' }],
    },
  ])
})

it('plans a Monitoring answer with nothing spent', () => {
  const plans = planBeats(
    [
      neutralized({ id: 10, method: 'monitoring' }),
      discarded(11, { card: 'trigger-error-503', reason: 'trigger' }),
    ],
    boardBefore({ pending: alarmPending() }),
  )
  expect(plans).toEqual([
    {
      kind: 'neutralized',
      key: 'neutralized:10',
      eventId: 10,
      player: 'p1',
      method: 'monitoring',
      alarm: { eventId: 11, card: 'trigger-error-503' },
      spent: [],
    },
  ])
})

it('names the slot a sacrificed release flies out of, and takes its Code Review with it', () => {
  const before = boardBefore({
    pending: alarmPending(),
    you: {
      name: 'You',
      hand: [],
      release: { frontend: card('release-frontend') },
      support: { frontend: card('support-code-review') },
    },
  } as Partial<BoardState>)
  const plans = planBeats(
    [
      neutralized({ id: 10, method: 'sacrifice' }),
      discarded(11, { card: 'trigger-error-503', reason: 'trigger' }),
      { id: 12, type: 'releaseDestroyed', player: 'p1', slot: 'frontend', card: 'release-frontend' } as Event,
      discarded(13, { card: 'release-frontend', reason: 'neutralized' }),
      discarded(14, { card: 'support-code-review', reason: 'neutralized' }),
    ],
    before,
  )
  expect(plans).toEqual([
    {
      kind: 'neutralized',
      key: 'neutralized:10',
      eventId: 10,
      player: 'p1',
      method: 'sacrifice',
      slot: 'frontend',
      alarm: { eventId: 11, card: 'trigger-error-503' },
      spent: [
        { eventId: 13, card: 'release-frontend' },
        { eventId: 14, card: 'support-code-review' },
      ],
    },
  ])
})

it('leaves nothing for the discard planner to fly twice', () => {
  const plans = planBeats(
    [
      neutralized({ id: 10 }),
      discarded(11, { card: 'trigger-error-503', reason: 'trigger' }),
      discarded(12, { card: 'protection-debugger', reason: 'neutralized' }),
    ],
    boardBefore({ pending: alarmPending() }),
  )
  expect(plans.filter((p) => p.kind === 'discard')).toEqual([])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/frontend test planBeats`
Expected: FAIL — `neutralized` breaks the run and plans nothing, and the discards fall to `sourceOf`.

- [ ] **Step 3: Add the plan to the union**

In `planBeats.ts`'s `BeatPlan`, after `covered`:

```ts
  // An Error 503 answered. Everything the runner needs to play the exchange
  // without going back to the projection: the alarm standing at the centre,
  // and what the answer cost — nothing at all for Monitoring, which answers
  // from where it stands and stays there.
  | {
      kind: 'neutralized'
      key: string
      eventId: number
      player: string
      method: 'debugger' | 'monitoring' | 'sacrifice'
      /** sacrifice only: the zone slot the answer flies out of */
      slot?: string
      /**
       * The alarm's own discard. Optional, not guaranteed: a `crush` shares
       * this event with no card standing anywhere, so the plan must survive
       * having no alarm to take away.
       */
      alarm?: { eventId: number; card: string }
      /** the Debugger, or the sacrificed release and its Code Review */
      spent: { eventId: number; card: string }[]
    }
```

- [ ] **Step 4: Walk it**

In the event loop, before the generic `discarded` branch:

```ts
    if (e.type === 'neutralized') {
      // One event, one beat — the exchange is its own gesture, never coalesced
      // with what came before or after.
      flush()
      // Everything this resolution banked, in the order the engine banked it:
      // the alarm first, then what paid for it (fake/triggers.ts's own
      // `bankAlarm`). The walk continues forward rather than scanning — a
      // resolution's discards are contiguous, and the first non-discard event
      // ends them. `releaseDestroyed` sits between them for a sacrifice, and
      // names the slot, so it is read rather than skipped.
      let alarm: { eventId: number; card: string } | undefined
      const spent: { eventId: number; card: string }[] = []
      let slot: string | undefined
      let j = i + 1
      while (j < events.length) {
        const d = events[j]
        if (d.type === 'releaseDestroyed' && d.player === e.player) {
          slot = d.slot
          j++
          continue
        }
        if (d.type !== 'discarded') break
        if (d.reason === 'trigger' && !alarm) {
          alarm = { eventId: d.id, card: d.card }
        } else if (d.reason === 'neutralized') {
          spent.push({ eventId: d.id, card: d.card })
        } else {
          break
        }
        owned.add(d.id)
        j++
      }
      plans.push({
        kind: 'neutralized',
        key: `neutralized:${e.id}`,
        eventId: e.id,
        player: e.player,
        method: e.method,
        ...(slot ? { slot } : {}),
        ...(alarm ? { alarm } : {}),
        spent,
      })
      i = j - 1 // the discards this plan claimed are consumed
      continue
    }
```

`owned.add` is only reached for the discards, not for `releaseDestroyed`, which plans nothing of its own and needs no claim.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C apps/frontend test planBeats`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/features/board-beats/planBeats.ts apps/frontend/src/features/board-beats/planBeats.test.ts
git commit -m "feat(web): an answered 503 is planned as one exchange (#102)"
```

---

### Task 7: `defenseBeat.runNeutralized`, and the queue wiring

`runCovered` with different inputs. The exit is the same exit, so it gets factored into a helper inside the file rather than restated.

**Files:**
- Modify: `apps/frontend/src/features/board-beats/defenseBeat.tsx`
- Modify: `apps/frontend/src/features/board-beats/useBeats.ts:185-215`
- Test: `apps/frontend/src/features/board-beats/defenseBeat.test.tsx`

**Interfaces:**
- Consumes: `BeatPlan` variant `neutralized` (Task 6); `COVER_POSE`, `ATTACK_POSE`, `SHOW_HOLD` from `~/entities/game/board`.
- Produces: `useDefenseBeat(...).runNeutralized(plan, ctx): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Add to `defenseBeat.test.tsx`, using the file's existing `harness`, `drive`, `exits`, `played` and `ctx`:

```tsx
const debuggerPlan = (): Extract<BeatPlan, { kind: 'neutralized' }> => ({
  kind: 'neutralized',
  key: 'neutralized:10',
  eventId: 10,
  player: 'p2',
  method: 'debugger',
  alarm: { eventId: 11, card: 'trigger-error-503' },
  spent: [{ eventId: 12, card: 'protection-debugger' }],
})

it('covers the alarm and takes both away as one exchange', async () => {
  exits.items.length = 0
  played.calls.length = 0
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() => api.beat?.runNeutralized(debuggerPlan(), ctx))

  // the answer flew to the cover slot at the cover's own tilt
  expect(played.calls.some((c) => c.name === 'playToCenter')).toBe(true)
  expect(played.calls.find((c) => c.name === 'playToCenter')?.params).toMatchObject({
    rotate: COVER_POSE.rot,
    dx: COVER_POSE.dx,
    dy: COVER_POSE.dy,
  })
  // ONE send, two cards, the alarm underneath
  expect(exits.items).toHaveLength(2)
  expect(exits.items.map((i) => i.layer)).toEqual([0, 1])
  expect(exits.items[0].card.id).toBe('trigger-error-503')
  expect(exits.items[1].card.id).toBe('protection-debugger')
  // each lands on its own discard event's scatter (I7)
  expect(exits.items[0].scatter).toEqual(scatterAt(11))
  expect(exits.items[1].scatter).toEqual(scatterAt(12))
  // and each starts from the tilt it was resting at (I6/I9)
  expect(exits.items[0].pose).toEqual(ATTACK_POSE)
  expect(exits.items[1].pose).toEqual(COVER_POSE)
})

it('sends the alarm alone when Monitoring answered, and flies nothing', async () => {
  exits.items.length = 0
  played.calls.length = 0
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() =>
    api.beat?.runNeutralized(
      { ...debuggerPlan(), method: 'monitoring', spent: [] },
      ctx,
    ),
  )
  expect(played.calls.filter((c) => c.name === 'playToCenter')).toEqual([])
  expect(exits.items).toHaveLength(1)
  expect(exits.items[0].card.id).toBe('trigger-error-503')
  expect(exits.items[0].layer).toBe(0)
})

it('flies a sacrificed release out of its own zone slot', async () => {
  exits.items.length = 0
  played.calls.length = 0
  const { api, Probe, anchors } = harness()
  const slotNode = document.createElement('div')
  vi.spyOn(anchors, 'releaseSlot').mockReturnValue(slotNode)
  render(<Probe />)
  await drive(() =>
    api.beat?.runNeutralized(
      {
        ...debuggerPlan(),
        method: 'sacrifice',
        slot: 'frontend',
        spent: [
          { eventId: 12, card: 'release-frontend' },
          { eventId: 13, card: 'support-code-review' },
        ],
      },
      ctx,
    ),
  )
  expect(anchors.releaseSlot).toHaveBeenCalledWith('p2', 'frontend')
  // the release carries its Code Review as the pair's aux, each on its own scatter
  expect(exits.items[1].aux?.id).toBe('support-code-review')
  expect(exits.items[1].auxScatter).toEqual(scatterAt(13))
})

it('leaves our own staged answer alone and only releases the handoff', async () => {
  exits.items.length = 0
  played.calls.length = 0
  const { api, Probe } = harness()
  const release = vi.fn()
  const staging = {
    current: { mainUid: 'u9', el: document.createElement('div'), release },
  } as unknown as RefObject<StagedHandoff | null>
  render(<Probe staging={staging} />)
  await drive(() =>
    api.beat?.runNeutralized({ ...debuggerPlan(), player: 'p1' }, ctx),
  )
  // ours is already standing at the cover slot — the beat must not fly a second
  // copy of it in from the fan (#101, Fix D rounds 3 and 4, same defect class)
  expect(played.calls.filter((c) => c.name === 'playToCenter')).toEqual([])
  expect(release).toHaveBeenCalledTimes(1)
  expect(exits.items).toHaveLength(2)
})
```

Import `ATTACK_POSE` and `scatterAt` at the top of the test file if they are not already there.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/frontend test defenseBeat`
Expected: FAIL — `runNeutralized` is not a function.

- [ ] **Step 3: Factor `runCovered`'s exit into a helper**

In `defenseBeat.tsx`, above `runCovered`:

```tsx
// One exchange, one send. Each card carries its layer, so the heap keeps the
// order they lay in on the table (I9), and each lands on its own `discarded`
// event's scatter (I7). Shared by the two resolutions that have this shape —
// an attack answered by a defence, and an alarm answered by any of its three
// methods — because it is one movement and #88's standing rule says one
// movement is one module.
interface ExchangeHalf {
  eventId: number
  card: CardData
  aux?: CardData | null
  auxEventId?: number
  el: HTMLElement | null
  from: Rect
  pose: { rot: number; dx: number; dy: number }
}
const exchange = (halves: (ExchangeHalf | null)[]): Leaving[] =>
  halves.filter((h): h is ExchangeHalf => h !== null).map((h, layer) => ({
    key: `x${h.eventId}`,
    card: h.card,
    aux: h.aux ?? null,
    el: h.el,
    from: h.from,
    pose: h.pose,
    layer,
    scatter: scatterAt(h.eventId),
    ...(h.auxEventId !== undefined ? { auxScatter: scatterAt(h.auxEventId) } : {}),
  }))
```

Rewrite `runCovered`'s `items` construction to build through `exchange([...])`. The **layer must stay** 0 for the attack and 1 for the cover, which `exchange` gives by position — so pass them in that order, and pass `null` for a half that is not there rather than skipping it, or a missing attack would silently promote the cover to layer 0.

- [ ] **Step 4: Write `runNeutralized`**

```tsx
  // Error 503 answered (#102). The same exchange `runCovered` plays, with the
  // alarm in the attack's place and one of three methods in the defence's.
  // Monitoring is the same beat without a card: it answers from the zone and
  // stays there, so nothing flies and the alarm leaves alone.
  const runNeutralized = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'neutralized' }>, ctx: BeatRun) => {
      // read BEFORE the first await, same race and same fix as runCovered's
      const handoff = latest.current.staging?.current
      const mine = plan.player === ctx.base.selfId
      await nextFrames() // the shadow that renders `before` has committed (I2)
      const a = latest.current.anchors
      const coverBox = rectOf(a.cover.current)
      const alarmBox = rectOf(a.centre.current)
      const alarmCard = plan.alarm ? cardById(plan.alarm.card) : null
      const answer = plan.spent[0] ? cardById(plan.spent[0].card) : null
      const aux = plan.spent[1] ? cardById(plan.spent[1].card) : null

      // THE COVER. Skipped for Monitoring, which has no card to move, and for
      // our OWN answer, which the gesture has already delivered to this exact
      // slot — asking whether the play was STAGED rather than whether its node
      // happens to exist yet is what keeps a second copy from flying in
      // (#101, Fix D rounds 3 and 4).
      if (plan.method !== 'monitoring' && coverBox && answer && !(mine && handoff)) {
        // Where it comes from: the sacrificed release's own zone slot, then our
        // own fan slot on a rejoin or a replay, then the actor's seat for
        // everyone else, and finally the cover slot itself — a no-travel raise
        // is the honest answer to "it is here and I cannot say where it came
        // from", and it leaves the exit starting from something real.
        const fromSlot =
          plan.method === 'sacrifice' && plan.slot
            ? rectOf(a.releaseSlot(plan.player, plan.slot))
            : null
        const handIndex = mine
          ? ctx.base.you.hand.findIndex((h) => h.card.id === plan.spent[0]?.card)
          : -1
        const from =
          fromSlot ??
          (handIndex >= 0 ? rectOf(a.handSlotAt(handIndex)) : null) ??
          a.seatBox(plan.player) ??
          coverBox
        const [el] = await flyer.raise([
          {
            key: 'cover',
            at: from,
            content: aux ? <CardPair main={answer} aux={aux} width="100%" /> : undefined,
            card: aux ? undefined : answer,
          },
        ])
        if (el) {
          await play('playToCenter', el, {
            from,
            to: coverBox,
            rotate: COVER_POSE.rot,
            dx: COVER_POSE.dx,
            dy: COVER_POSE.dy,
          })?.finished
        }
      }
      await wait(SHOW_HOLD)

      // released HERE, immediately ahead of the exit rather than before the
      // hold — `release()` clears the local answerer's own static cover render
      // at once, and the staging hook's `landed` gate has nothing else backing
      // that slot. Same ordering runCovered had to be fixed into.
      if (mine && handoff) handoff.release()

      const items = exchange([
        plan.alarm && alarmBox && alarmCard
          ? {
              eventId: plan.alarm.eventId,
              card: alarmCard,
              el: a.centre.current,
              from: alarmBox,
              pose: ATTACK_POSE,
            }
          : null,
        plan.spent[0] && coverBox && answer
          ? {
              eventId: plan.spent[0].eventId,
              card: answer,
              aux,
              auxEventId: plan.spent[1]?.eventId,
              el: a.cover.current,
              from: coverBox,
              pose: COVER_POSE,
            }
          : null,
      ])
      if (items.length > 0) await latest.current.send(items)
      flyer.drop('cover')
    },
    [flyer.raise, flyer.drop],
  )
```

Return `runNeutralized` from the hook alongside `runCovered` and `runStolen`.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C apps/frontend test defenseBeat`
Expected: PASS, **including the pre-existing `runCovered` tests** — the `exchange` helper must not have changed their layers or scatters.

- [ ] **Step 6: Wire it into the queue**

`apps/frontend/src/features/board-beats/useBeats.ts`, beside the `covered` case at :185:

```ts
      if (plan.kind === 'neutralized') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          run: (ctx) => defense.runNeutralized(plan, ctx),
        }
      }
```

and add `defense.runNeutralized` to that `useCallback`'s dependency array beside `defense.runCovered`.

- [ ] **Step 7: Run the queue's own suite**

Run: `pnpm -C apps/frontend test useBeats defenseBeat`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/features/board-beats
git commit -m "feat(web): the alarm and the card that answered it leave the table together (#102)"
```

---

### Task 8: `_useZonePull` — taking a card out of your own zone

Nothing on the board has ever pulled a card out of the release zone. Ported from `Error503Story`'s drag loop, which is the approved visual source.

**Files:**
- Create: `apps/frontend/src/pages/board/[gameId]/_useZonePull.tsx`
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/zonePull.test.tsx`

**Interfaces:**
- Consumes: `CARD_W` from `@release/ui`.
- Produces:

```ts
export interface ZonePull<K extends string = string> {
  /** the slot being dragged right now, or null */
  dragging: K | null
  /** start a drag from the node the pointer went down on */
  begin: (key: K, el: HTMLElement, e: ReactMouseEvent) => void
  /** the drag carrier, rendered by the page */
  overlay: ReactNode
  /** bind the card the carrier should show while `dragging` is set */
  render: (node: ReactNode) => void
}
export function useZonePull<K extends string = string>(opts: {
  onDrop: (key: K, at: { x: number; y: number; rect: Rect }) => void
  onCancel: (key: K) => void
  accepts: (x: number, y: number) => boolean
}): ZonePull<K>
```

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/pages/board/[gameId]/__tests__/zonePull.test.tsx`:

```tsx
import { act, fireEvent, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useZonePull } from '../_useZonePull'

function harness(accepts: (x: number, y: number) => boolean) {
  const onDrop = vi.fn()
  const onCancel = vi.fn()
  const api: { pull?: ReturnType<typeof useZonePull> } = {}
  function Probe() {
    api.pull = useZonePull({ onDrop, onCancel, accepts })
    return (
      <>
        <div data-testid="slot" onMouseDown={(e) => api.pull?.begin('frontend', e.currentTarget, e)}>
          card
        </div>
        {api.pull.overlay}
      </>
    )
  }
  const view = render(<Probe />)
  return { view, api, onDrop, onCancel }
}

it('hands the drop back to the caller when the pointer let go on the table', () => {
  const { view, onDrop } = harness(() => true)
  fireEvent.mouseDown(view.getByTestId('slot'), { clientX: 10, clientY: 10 })
  act(() => {
    fireEvent.mouseMove(window, { clientX: 400, clientY: 300 })
    fireEvent.mouseUp(window, { clientX: 400, clientY: 300 })
  })
  expect(onDrop).toHaveBeenCalledWith('frontend', expect.objectContaining({ x: 400, y: 300 }))
})

it('cancels when the pointer let go somewhere the caller refuses', () => {
  const { view, onDrop, onCancel } = harness(() => false)
  fireEvent.mouseDown(view.getByTestId('slot'), { clientX: 10, clientY: 10 })
  act(() => fireEvent.mouseUp(window, { clientX: 10, clientY: 700 }))
  expect(onDrop).not.toHaveBeenCalled()
  expect(onCancel).toHaveBeenCalledWith('frontend')
})

it('stops listening once the drag is over', () => {
  const { view, onDrop } = harness(() => true)
  fireEvent.mouseDown(view.getByTestId('slot'), { clientX: 10, clientY: 10 })
  act(() => fireEvent.mouseUp(window, { clientX: 400, clientY: 300 }))
  onDrop.mockClear()
  act(() => fireEvent.mouseUp(window, { clientX: 400, clientY: 300 }))
  expect(onDrop).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/frontend test zonePull`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the module**

Create `apps/frontend/src/pages/board/[gameId]/_useZonePull.tsx`, porting `Error503Story.tsx:435-505` (`beginDrag` plus the drag `useEffect`) with its comments. The load-bearing details, all from the approved source:

```tsx
// Pulling a card out of your OWN release zone — a source nothing on the board
// has ever taken a card from (#102). Ported from the playground's
// `Error503Story`, the approved visual source.
//
// It knows nothing about the game: it drags a rect around and reports where the
// pointer let go. What is legal to pull, and what a drop MEANS, belong to the
// caller — which is what lets #105's transfers and #106's crush answer reuse it.

const RESIZE_MS = 200 // the pick-up eases to the normal card size

// One rAF loop drives BOTH the size ease and the position each frame, so the
// grabbed point stays exactly under the cursor while the card resizes. Two
// loops (or a CSS transition plus a JS position) give a resize-from-corner
// followed by a snap.
```

The pick-up records the grab fraction so the point under the cursor stays under it:

```tsx
    const r = el.getBoundingClientRect()
    setDrag({
      key,
      cx: e.clientX,
      cy: e.clientY,
      fracX: (e.clientX - r.left) / r.width, // grab point inside the card (0..1)
      fracY: (e.clientY - r.top) / r.height,
      startW: r.width,
    })
```

and the frame loop:

```tsx
      const t = Math.min(1, (now - start) / RESIZE_MS)
      const ease = 1 - (1 - t) ** 3
      const w = drag.startW + (CARD_W - drag.startW) * ease
      const h = (w * CARD_H) / CARD_W
      node.style.width = `${w}px`
      node.style.left = `${cursor.x - drag.fracX * w}px`
      node.style.top = `${cursor.y - drag.fracY * h}px`
```

`e.preventDefault()` on the mousedown, or the pointer drag starts a text selection that survives the drop. The `mousemove`/`mouseup` listeners go on `window` and are removed in the effect's cleanup **and** on `mouseup`, and the rAF is cancelled in both places. The carrier is `position: fixed` — like every other flight carrier — so nothing between it and the viewport may become a containing block.

Add `_useZonePull.module.css` for the carrier: `position: fixed; z-index: var(--z-flight); pointer-events: none;` and `aspect-ratio: var(--card-aspect)`. Check `_Board.module.css`'s `.pairFlyer` for the exact tokens it uses and match them.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C apps/frontend test zonePull`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/pages/board
git commit -m "feat(web): a card can be pulled out of your own release zone (#102)"
```

---

### Task 9: `_useNeutralizeStaging` — the three gestures

**Files:**
- Create: `apps/frontend/src/pages/board/[gameId]/_useNeutralizeStaging.tsx`
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx`
- Modify: `packages/translation/src/locales/en/common.json`, `packages/translation/src/locales/ru/common.json`
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/boardNeutralize.test.tsx`

**Interfaces:**
- Consumes: `useCoverFlight` (Task 3), `useZonePull` (Task 8), `BoardState['you'].releaseUid` (Task 2), `pending.methods`.
- Produces:

```ts
export interface NeutralizeStaging {
  staged: { card: CardData; aux?: CardData | null } | null
  landed: boolean
  overlay: ReactNode[]
  handItems: HandItem[]
  stateAt: (index: number) => HandCardState
  accentAt: (key: 'frontend' | 'backend' | 'database' | 'monitoring') => string | undefined
  grabbable: (key: 'frontend' | 'backend' | 'database' | 'monitoring') => boolean
  liftedAt: (key: 'frontend' | 'backend' | 'database' | 'monitoring') => boolean
  onHandPlay: (uid: string, drop: HandPlayDrop) => boolean
  onSlotDown: (key: 'frontend' | 'backend' | 'database' | 'monitoring', e: ReactMouseEvent) => void
  release: () => void
  reset: () => void
}
```

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/pages/board/[gameId]/__tests__/boardNeutralize.test.tsx`, in `boardDefense.test.tsx`'s idiom (read it first and match its mocks and its `renderBoard` helper):

```tsx
it('offers only the methods the pending names', () => {
  const state = withAlarm({ methods: ['debugger'], hand: ['protection-debugger', 'attack-bug'] })
  renderBoard(state)
  // the Debugger lights, everything else greys out — Hand's own dim
  expect(handStateAt(0)).toBe('playable')
  expect(handStateAt(1)).toBe('disabled')
})

it('answers with a Debugger dropped on the table', () => {
  const onResolve = vi.fn()
  const state = withAlarm({ methods: ['debugger'], hand: ['protection-debugger'] })
  const { hand } = renderBoard(state, { onResolve })
  playFromHand(hand, 0, { x: 640, y: 200 }) // the middle of the table
  expect(onResolve).toHaveBeenCalledWith({ kind: 'neutralize503', method: 'debugger' })
})

it('gives the card back when it is dropped over your own area', () => {
  const onResolve = vi.fn()
  const state = withAlarm({ methods: ['debugger'], hand: ['protection-debugger'] })
  const { hand } = renderBoard(state, { onResolve })
  // "The whole table accepts the drop; only the player's own area gives the
  // card back" — dropping it back where it came from reads as changing your mind
  playFromHand(hand, 0, { x: 640, y: 900 })
  expect(onResolve).not.toHaveBeenCalled()
})

it('names the release a sacrifice burns', () => {
  const onResolve = vi.fn()
  const state = withAlarm({
    methods: ['sacrifice'],
    release: { frontend: 'release-frontend' },
    releaseUid: { frontend: 'release-frontend#3' },
  })
  renderBoard(state, { onResolve })
  dragSlotToTable('frontend', { x: 640, y: 200 })
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'neutralize503',
    method: 'sacrifice',
    card: 'release-frontend#3',
  })
})

it('answers with Monitoring on a click, and moves nothing', () => {
  const onResolve = vi.fn()
  const state = withAlarm({ methods: ['monitoring'], release: { monitoring: 'protection-monitoring' } })
  const { container } = renderBoard(state, { onResolve })
  fireEvent.click(slotNode(container, 'monitoring'))
  expect(onResolve).toHaveBeenCalledWith({ kind: 'neutralize503', method: 'monitoring' })
  // it never leaves the zone: nothing is staged at the cover slot
  expect(screen.queryByTestId('board-cover-staged')).not.toBeInTheDocument()
})

it('does not light a slot the pending does not offer', () => {
  const state = withAlarm({
    methods: ['debugger'],
    release: { frontend: 'release-frontend' },
    releaseUid: { frontend: 'release-frontend#3' },
    hand: ['protection-debugger'],
  })
  const { container } = renderBoard(state)
  // sacrifice is not on offer, so the release is not grabbable
  fireEvent.mouseDown(slotNode(container, 'frontend'), { clientX: 10, clientY: 10 })
  fireEvent.mouseUp(window, { clientX: 640, clientY: 200 })
  expect(screen.queryByTestId('board-cover-staged')).not.toBeInTheDocument()
})

it('shows no method panel for a 503', () => {
  const state = withAlarm({ methods: ['debugger'], hand: ['protection-debugger'] })
  renderBoard(state)
  // the gesture IS the answer; the generic panel covered the very cards it
  // was asking about (the same reason it was suppressed for `defend`)
  expect(screen.queryByTestId('pending-prompt')).not.toBeInTheDocument()
})
```

Write `withAlarm`, `handStateAt`, `playFromHand`, `dragSlotToTable` and `slotNode` as local helpers, modelled on whatever `boardDefense.test.tsx` already uses for the same jobs.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/frontend test boardNeutralize`
Expected: FAIL.

- [ ] **Step 3: Write the hook**

Create `apps/frontend/src/pages/board/[gameId]/_useNeutralizeStaging.tsx`. Its opening comment states the boundary:

```tsx
// Answering an Error 503 (#102). Active only while the `neutralize503` pending
// is ours — its siblings `_useBoardStaging.ts` (the turn's plays) and
// `_useDefenseStaging.tsx` (a window's) never run at the same time: a pending
// suspends normal play, and the engine returns [] from `playableFor` while one
// is open (fake/project.ts's own first check).
//
// Legality is the projection's answer throughout: `pending.methods` names what
// may answer, and each method is the CARD that performs it — the Debugger in
// the fan, a Release in the zone, the standing Monitoring. Nothing here
// re-derives which; a method the pending does not name is simply not pullable.
//
// Monitoring answers on a CLICK and nothing moves. It never leaves the zone,
// so flying it to the centre and back would be a lie about what happened — and
// the approved source has no gesture for it at all, because the story
// auto-fired it. Recorded in docs/animations/backlog.md rather than invented
// around; what ships is the smallest thing that moves nothing.
```

The three gestures. The fan:

```tsx
  const onHandPlay = useCallback(
    (uid: string, drop: HandPlayDrop): boolean => {
      if (!active || !methods.includes('debugger')) return false
      const item = state.you.hand.find((h) => h.uid === uid)
      if (!item || item.card.id !== 'protection-debugger') return false
      // The whole table accepts the drop; only your own area gives the card
      // back — dropping it where it came from reads as changing your mind.
      if (!onTable(drop.x, drop.y)) return false
      commit({ method: 'debugger' }, item.card, drop.rect)
      return true
    },
    [active, methods, state.you.hand, onTable, commit],
  )
```

`onTable` is the drop rule, measured off the anchors the board already binds:

```tsx
  // Your own area is the release zone and the fan together. Everything else on
  // screen is table. Measured, not guessed: both nodes are already anchored.
  const onTable = useCallback(
    (x: number, y: number) => {
      const zone = anchors.zone.current?.getBoundingClientRect()
      const hand = anchors.hand.current?.getBoundingClientRect()
      const inside = (r?: DOMRect) =>
        r ? x >= r.left && x <= r.right && y >= r.top && y <= r.bottom : false
      return !inside(zone) && !inside(hand)
    },
    [anchors.zone, anchors.hand],
  )
```

The zone, through `useZonePull`:

```tsx
  const pull = useZonePull<SlotKey>({
    accepts: onTable,
    onCancel: () => setLifted(null),
    onDrop: (key, at) => {
      setLifted(null)
      if (key === 'monitoring') return // never dragged; it answers on a click
      const uid = state.you.releaseUid?.[key]
      const card = state.you.release[key]
      if (!uid || !card) return
      commit({ method: 'sacrifice', card: uid }, card, at.rect, state.you.support?.[key])
    },
  })
```

Monitoring, on a click:

```tsx
  const onSlotClick = useCallback(
    (key: SlotKey) => {
      if (!active || key !== 'monitoring' || !methods.includes('monitoring')) return
      // Nothing is staged and nothing flies: the answer is given from where the
      // card stands, and the beat takes the alarm away on its own.
      actions?.onResolve?.({ kind: 'neutralize503', method: 'monitoring' })
    },
    [active, methods, actions],
  )
```

and the shared commit, dispatching **synchronously before** the flight (the no-duplicate rule) and flying through Task 3's module:

```tsx
  const commit = useCallback(
    (choice: TableChoice, card: CardData, from: Rect | undefined, aux?: CardData | null) => {
      setStaged({ card, aux })
      flight.mark(eventsRef.current)
      actions?.onResolve?.(choice)
      void flight.fly({
        card,
        from,
        to: () => anchors.cover.current?.getBoundingClientRect(),
        pose: COVER_POSE,
        content: aux ? <CardPair main={card} aux={aux} width="100%" /> : undefined,
      })
    },
    [actions, anchors.cover, flight],
  )
```

`grabbable`, `accentAt` and `stateAt` all read `methods` so what lights is exactly what can be taken:

```tsx
  const grabbable = useCallback(
    (key: SlotKey) =>
      active &&
      !staged &&
      (key === 'monitoring'
        ? methods.includes('monitoring')
        : methods.includes('sacrifice') && Boolean(state.you.release[key])),
    [active, staged, methods, state.you.release],
  )
  const stateAt = useCallback(
    (index: number): HandCardState => {
      if (!active) return 'idle'
      const item = state.you.hand[index]
      const answers = methods.includes('debugger') && item?.card.id === 'protection-debugger'
      return answers ? 'playable' : 'disabled'
    },
    [active, methods, state.you.hand],
  )
```

A rejection returns the card home: watch the feed with `flight.rejectedSince(events)` and, when it fires, clear `staged` and fly the card back — into the fan through `useHandArrival` for the Debugger, back to its slot with a `play('playToCenter')` in reverse for a release.

- [ ] **Step 4: Wire it into `_Board.tsx`**

Beside the two existing staging hooks:

```tsx
  const alarmMineOpen = pendingAlarm != null && alarmMine
  const neutralizing = useNeutralizeStaging({
    state,
    anchors,
    actions,
    events,
    enabled: alarmMineOpen && !beats.exclusive,
    matchKey,
  })
```

Fold it into the three-way pick the board already makes between `staging` and `defenseStaging` for `stateAt`, `accentAt`, `onHandPlay`, `gapAt`, `gapSize` and the overlays. Add the zone bindings to the `ReleaseZone` the board already renders:

```tsx
                accentAt={(key) => neutralizing.accentAt(key) ?? existingAccentAt(key)}
                liftedAt={(key) => neutralizing.liftedAt(key)}
                onSlotDown={(key, e) => neutralizing.onSlotDown(key, e)}
```

Render the staged answer at the cover slot behind the same `landed` gate `stagedCover` uses, and suppress the panel — one more kind on the chain at `_Board.tsx:1274`:

```tsx
      {state.pending?.player === state.selfId &&
        state.pending.kind !== 'discardForRelease' &&
        state.pending.kind !== 'defend' &&
        // the gesture IS the answer, and the panel covered the very cards it
        // was asking about — same reason, same fix as `defend` above
        state.pending.kind !== 'neutralize503' && (
```

Add the ask line, so a step waiting on the fan is not silent:

```tsx
  } else if (alarmMineOpen && !neutralizing.staged) {
    ask = copy.table.askNeutralize
  }
```

- [ ] **Step 5: Add the copy, in both catalogues**

`packages/translation/src/locales/en/common.json`, in `table`:

```json
    "askNeutralize": "Neutralise the alarm — play a Debugger, or give up a release",
```

`packages/translation/src/locales/ru/common.json`, in `table`:

```json
    "askNeutralize": "Нейтрализуй тревогу — сыграй Debugger или отдай релиз",
```

A key missing from one catalogue silently falls back, so add both in the same edit. If the copy needs to name Monitoring too, say so in both or in neither.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm -C apps/frontend test boardNeutralize`
Expected: PASS.

- [ ] **Step 7: Check nothing else on the board moved**

Run: `pnpm -C apps/frontend test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/pages/board packages/translation
git commit -m "feat(web): the 503 is answered by the card that answers it (#102)"
```

---

### Task 10: The sweep — a defenceless player's table empties

**Files:**
- Modify: `apps/frontend/src/features/board-beats/planBeats.ts`
- Modify: `apps/frontend/src/features/board-beats/discardBeat.tsx`
- Modify: `apps/frontend/src/features/board-beats/useBeats.ts`
- Modify: `apps/frontend/src/entities/game/board/poses.ts`
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx`
- Test: `apps/frontend/src/features/board-beats/planBeats.test.ts`, `…/discardBeat.test.tsx` (new if absent), `…/useBeats.test.tsx`, `__tests__/boardAlarm.test.tsx`

**Interfaces:**
- Consumes: `DiscardCard`, `useDiscardExit`.
- Produces: `BeatPlan` `discard` gains `gather?: true`; `Beats` gains `alarm: boolean`; `poses.ts` exports `GATHER_HOLD = 1500`.

- [ ] **Step 1: Write the failing plan test**

```ts
it('gathers a knocked-out player’s cards into one sweep', () => {
  const plans = planBeats(
    [
      { id: 20, type: 'eliminated', player: 'p1' } as Event,
      discarded(21, { card: 'attack-bug', reason: 'effect' }),
      discarded(22, { card: 'protection-debugger', reason: 'effect' }),
      discarded(23, { card: 'release-frontend', reason: 'destroyed' }),
    ],
    boardBefore(),
  )
  expect(plans).toEqual([
    {
      kind: 'discard',
      key: 'discard:21',
      gather: true,
      cards: [
        { key: 'd21', eventId: 21, card: 'attack-bug', source: { kind: 'hand', index: 0 } },
        { key: 'd22', eventId: 22, card: 'protection-debugger', source: { kind: 'hand', index: 1 } },
        {
          key: 'd23',
          eventId: 23,
          card: 'release-frontend',
          source: { kind: 'release', player: 'p1', slot: 'frontend' },
        },
      ],
    },
  ])
})

it('leaves an ordinary discard ungathered', () => {
  const plans = planBeats([discarded(21, { reason: 'handLimit' })], boardBefore())
  expect((plans[0] as { gather?: true }).gather).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/frontend test planBeats`
Expected: FAIL — `eliminated` flushes and plans nothing, so the discards form an ordinary run.

- [ ] **Step 3: Open a gathered run on `eliminated`**

In `planBeats.ts`, add `gather?: true` to the `discard` plan's type with a comment, then before the default `flush()`:

```ts
    if (e.type === 'eliminated') {
      // Everything this player owned leaves at once, and it leaves as ONE
      // gesture: gathered at the centre, held open long enough for the table to
      // read what happened, and only then scattered. The same beat the hand
      // limit gets (#104 will reuse this leg).
      flush()
      sweeping = e.player
      continue
    }
```

with `let sweeping: string | null = null` beside the other run locals, cleared in `flush()`. The `discarded` branch opens its run with the flag while a sweep is open and the card belongs to that player:

```ts
      if (!discard) flush()
      discard ??= {
        kind: 'discard',
        key: `discard:${e.id}`,
        cards: [],
        ...(sweeping === e.player ? { gather: true as const } : {}),
      }
```

Careful: `flush()` must not clear `sweeping` before the run that belongs to it opens. Set `sweeping` **after** the `flush()` call inside the `eliminated` branch, as written above, and clear it only when a non-discard event breaks the run — i.e. in the default branch's `flush()` call site, not inside `flush()` itself.

- [ ] **Step 4: Write the failing runner test**

In `discardBeat.test.tsx` (create it in `defenseBeat.test.tsx`'s idiom if it does not exist):

```tsx
it('draws the swept cards together before it scatters them', async () => {
  exits.items.length = 0
  played.calls.length = 0
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() =>
    api.beat?.run(
      {
        kind: 'discard',
        key: 'discard:21',
        gather: true,
        cards: [
          { key: 'd21', eventId: 21, card: 'attack-bug', source: { kind: 'hand', index: 0 } },
          { key: 'd22', eventId: 22, card: 'protection-debugger', source: { kind: 'hand', index: 1 } },
        ],
      },
      ctx,
    ),
  )
  // every card was drawn to the centre first…
  expect(played.calls.filter((c) => c.name === 'glide').length).toBe(2)
  // …and each still lands on its own event's scatter (I7)
  expect(exits.items.map((i) => i.scatter)).toEqual([scatterAt(21), scatterAt(22)])
})

it('flies an ordinary discard straight out, with no gather', async () => {
  played.calls.length = 0
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() =>
    api.beat?.run(
      {
        kind: 'discard',
        key: 'discard:21',
        cards: [{ key: 'd21', eventId: 21, card: 'attack-bug', source: { kind: 'hand', index: 0 } }],
      },
      ctx,
    ),
  )
  expect(played.calls.filter((c) => c.name === 'glide')).toEqual([])
})
```

Match `glide` to whatever `useFlyer`'s real move is called in this codebase — read `useFlyer`'s exports and use the true name.

- [ ] **Step 5: Add the gather leg**

`apps/frontend/src/entities/game/board/poses.ts`:

```ts
/** the swept cards are held open at the centre before they scatter — the same
 *  beat the hand limit's grid gets (#104) */
export const GATHER_HOLD = 1500
```

In `discardBeat.tsx`'s `run`, between measuring the sources and handing them to `send`, port `Error503Story`'s `sweep(items, gather)`:

```tsx
      if (plan.gather) {
        const centre = rectOf(latest.current.anchors.centre.current)
        if (centre) {
          // A HEAP, not a neat stack: the same scatter model the discard uses,
          // so the pile at the centre reads as a pile.
          const heap = items.map((_, i) => scatterAt(i))
          const boxes = heap.map((sc) => ({
            left: centre.left + sc.dx,
            top: centre.top + sc.dy,
            width: centre.width,
            height: centre.height,
          }))
          await flyer.raise(items.map((it, i) => ({ key: `s${i}`, card: it.card, at: it.from })))
          await Promise.all(
            items.map((_, i) => {
              // the tilt travels WITH the move, so the card eases into its
              // place in the pile instead of snapping into the angle
              flyer.patch(`s${i}`, { pose: restTransform({ ...heap[i], dx: 0, dy: 0 }) })
              return flyer.glide(`s${i}`, boxes[i], 300)
            }),
          )
          // held open at the centre — the table has to be readable before the
          // cards scatter
          await wait(GATHER_HOLD)
          // Hand the step the card BOXES, not the tilted nodes: a rotated
          // node's bounding rect is the box AROUND it (I6). The step raises
          // its own flyers and unwinds the tilt in flight, so the carrier's
          // are dropped in the same turn the step's appear.
          for (let i = 0; i < items.length; i++) {
            items[i] = { ...items[i], from: boxes[i], pose: { rot: heap[i].rot, dx: 0, dy: 0 }, layer: i }
          }
          flyer.drop()
        }
      }
```

`useDiscardBeat` needs its own `useFlyer()` for this, added to the hook's returned `overlay` and cleared in its `reset`.

Under `prefers-reduced-motion` the gather is skipped entirely — the cards go straight to the heap. Read the flag through the Wave 0 layer the way the other runners do rather than checking the media query here.

- [ ] **Step 6: Raise `alarm` on the queue and glow from it**

In `useBeats.ts`, beside `exclusive` in the returned object:

```ts
    // The sweep is an elimination, and an elimination is why the alarm was
    // sounding. The defenceless path raises no pending at all — the engine
    // eliminates in the same batch as the reveal — so without this the hand
    // would fly away with nothing explaining it.
    alarm: running?.kind === 'discard' && running.gather === true,
```

`Beat` carries no `kind` today; add `alarm: boolean` to the `Beat` interface instead and set it where the plan is turned into a beat, which keeps plan shapes out of the queue's runtime state:

```ts
      if (plan.kind === 'discard') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: plan.gather === true,
          run: (ctx) => discards.run(plan, ctx),
        }
      }
```

with `alarm: false` on every other branch, and `alarm: running?.alarm ?? false` in the returned object.

In `_Board.tsx`, the glow reads both:

```tsx
  const alarmMine = pendingAlarm?.player === state.selfId
  // …or a sweep is running, which is the defenceless path's own alarm
  const glowStrong = (pendingAlarm != null && alarmMine) || beats.alarm
```

and the two mount points use `glowStrong` / `pendingAlarm != null && !alarmMine`.

- [ ] **Step 7: Add the board test**

In `boardAlarm.test.tsx`:

```tsx
it('keeps the table lit while a knocked-out player’s cards sweep away', () => {
  renderBoardWithBeats({ alarm: true })
  expect(screen.getByTestId('board-glow-strong')).toBeInTheDocument()
})
```

- [ ] **Step 8: Run everything**

Run: `pnpm -C apps/frontend test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src
git commit -m "feat(web): a defenceless table gathers at the centre before it scatters (#102)"
```

---

### Task 11: Crush's sacrifice stops being rejected

`PendingPrompt` resolves both `neutralize503` and `crush` with `{ method }` and never a `card`, so `triggers.ts`'s `'sacrifice needs a release card'` refuses every sacrifice. The 503 no longer goes through the panel; `crush` still does, and leaving a live rejection there until Wave 6 is a bug left standing, not a scope decision.

**Files:**
- Modify: `apps/ui/src/table/Table/PendingPrompt/PendingPrompt.tsx:296-322`
- Test: `apps/ui/src/table/Table/PendingPrompt/PendingPrompt.test.tsx`

**Interfaces:**
- Consumes: `TablePending` variant `crush`, `TableChoice` variant `crush`.
- Produces: nothing later tasks read.

- [ ] **Step 1: Write the failing test**

```tsx
it('names the release a crush sacrifice burns', () => {
  const onResolve = vi.fn()
  const pending: TablePending = {
    kind: 'crush',
    player: 'you',
    slot: 'frontend',
    methods: ['sacrifice'],
  }
  render(
    <PendingPrompt
      pending={pending}
      hand={[]}
      release={{ frontend: { uid: 'release-frontend#3', card: card('release-frontend') } }}
      copy={copy}
      onResolve={onResolve}
    />,
  )
  fireEvent.click(screen.getByText(copy.methods.sacrifice))
  fireEvent.click(screen.getByText('release-frontend'))
  fireEvent.click(screen.getByText(copy.crush.action))
  // the engine rejects a sacrifice with no card — it cannot find the slot
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'crush',
    method: 'sacrifice',
    card: 'release-frontend#3',
  })
})

it('will not confirm a sacrifice with no release picked', () => {
  const onResolve = vi.fn()
  const pending: TablePending = {
    kind: 'crush',
    player: 'you',
    slot: 'frontend',
    methods: ['sacrifice'],
  }
  render(
    <PendingPrompt
      pending={pending}
      hand={[]}
      release={{ frontend: { uid: 'release-frontend#3', card: card('release-frontend') } }}
      copy={copy}
      onResolve={onResolve}
    />,
  )
  fireEvent.click(screen.getByText(copy.methods.sacrifice))
  fireEvent.click(screen.getByText(copy.crush.action))
  expect(onResolve).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/ui test PendingPrompt`
Expected: FAIL.

- [ ] **Step 3: Add the release picker to the `crush` case**

`PendingPrompt` needs the player's own zone to offer it. Add an optional prop — the kit takes what it renders, it does not reach for it:

```tsx
  /** the player's own releases, by slot: what a `sacrifice` method may burn.
   *  Carries the uid, because the engine's choice names one. */
  release?: Partial<Record<'frontend' | 'backend' | 'database', { uid: string; card: CardType }>>
```

and in the `crush` case:

```tsx
    case 'crush': {
      const burnable = Object.values(release ?? {}).filter(Boolean)
      // A sacrifice must name WHICH release it burns — the engine refuses one
      // that does not ('sacrifice needs a release card'), so the panel is not
      // complete until a slot is picked.
      const needsCard = method === 'sacrifice'
      complete =
        method != null &&
        pending.methods.includes(method) &&
        (!needsCard || (sacrificed != null && burnable.some((r) => r.uid === sacrificed)))
      confirm = () => {
        if (!complete || !method) return
        onResolve({ kind: 'crush', method, ...(needsCard ? { card: sacrificed as string } : {}) })
      }
      options = [
        ...pending.methods.map((m) => (
          <TextOption
            key={m}
            label={METHOD_LABEL[m]}
            selected={method === m}
            onClick={() => setMethod(m)}
          />
        )),
        ...(needsCard
          ? burnable.map((r) => (
              <CardOption
                key={r.uid}
                uid={r.uid}
                card={r.card}
                selected={sacrificed === r.uid}
                onClick={() => setSacrificed(r.uid)}
              />
            ))
          : []),
      ]
      break
    }
```

with `const [sacrificed, setSacrificed] = useState<string | null>(null)` beside the component's other option state. `CardOption` currently takes `uid` and looks the card up in `hand`; give it an optional `card` prop for a card that is not in a hand, or add a sibling `ZoneCardOption` — read the component first and take whichever is the smaller honest change.

Leave the `neutralize503` case as it is: the board no longer renders the panel for it, and the playground's `TableStory` still needs something there.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C apps/ui test PendingPrompt && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ui/src/table/Table/PendingPrompt
git commit -m "fix(ui): a crush sacrifice names the release it burns, so the engine stops refusing it (#102)"
```

---

### Task 12: Documentation and the findings

The scene is not finished until the two written surfaces agree with it. This is the same PR as the code it describes.

**Files:**
- Modify: `docs/animations/recipes.md` (the "Error 503 (player turn)" recipe)
- Modify: `docs/animations/backlog.md`
- Modify: `apps/playground/stories/AnimationAuditStory/AnimationAuditStory.tsx`
- Modify: `docs/rules/backlog.md`, `docs/rules/resolution.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code reads.

- [ ] **Step 1: Bring the recipe up to the board's reality**

The Error 503 recipe currently documents a shape the story itself no longer has — `DROP_PAD = 48` and a 750 ms Monitoring hold, against the story's own `onTable` test and `COVER_HOLD = 1200`. Correct those, then add the board's own section beside the story's, the way Wave 3 did: the alarm from `pending`, the glow's two mount points and why DOM order is the rule, the three gestures, the one-send exchange with its layers and scatters, and the gather leg with `GATHER_HOLD`.

- [ ] **Step 2: Record the three findings, in both places**

Each goes in the audit page's register (one line, visible) **and** `docs/animations/backlog.md` (in full, with what it threatens and what would close it):

1. **No designed gesture for an answer that does not leave the table.** Monitoring answers a 503 from its own slot; the approved source auto-fired it, so there is nothing to port. A click ships. *What would close it:* a designed movement for an answer given from where it stands.
2. **An event card banked home is announced as `discarded`.** `bankToDiscard` routes a card with an `event` field back to the events deck, but the event says `discarded` and the placed card carries the plain `release-<slot>` id on purpose — so the board flies a sacrificed `ai-release-*` to the heap, where it never lands. Pre-existing and general (`discardBeat` has it for every event card); #102's `neutralized` plan claims one such discard. *What would close it:* a destination on `discarded`, or an event of its own.
3. **A pending with no deadline stalls the match.** `referee.ts:402` expires only `defend` pendings and `:422` suspends the turn clock while any pending is open, so a connected player who never answers a `neutralize503` freezes the game — as they would a `handLimit`, `discardForRelease`, `pickFromDiscard`, `requestCard`, `giveCard` or `crush`. *What would close it:* a deadline on every pending kind, which is its own issue.

- [ ] **Step 3: File the stall as its own issue**

```bash
gh issue create --repo MythHand/ReleaseBoardGameP2P \
  --title "A pending with no deadline stalls the match" \
  --body "referee.ts:402 expires only \`defend\` pendings, and :422 suspends the turn clock while any pending is open. A connected player who never answers a \`neutralize503\`, \`handLimit\`, \`discardForRelease\`, \`pickFromDiscard\`, \`requestCard\`, \`giveCard\` or \`crush\` freezes the game for everyone. Found while building #102, which is why that task ships the sweep without a way to reach it by timing out. The fix belongs to all seven kinds at once, not to one of them."
```

Add the issue number to both records from Step 2.

- [ ] **Step 4: Record the rules question**

`docs/rules/backlog.md` gains: whether a player who *can* neutralize a 503 may decline and be eliminated. §7 says «Игрок выбывает, если не нейтрализует карту одним из трёх способов», which does not settle whether declining is a legal choice. The playground story has a PASS; the engine has no way to refuse.

`docs/rules/resolution.md` §7, at the paragraph the question came from:

```markdown
> ❓ **Не из правил.** Может ли игрок, у которого есть способ нейтрализовать 503,
> отказаться и выбыть? §7 отвечает только на «не нейтрализовал». В движке отказа
> нет; в сцене плейграунда есть PASS. Вопрос открыт — см.
> [`backlog.md`](./backlog.md).
```

- [ ] **Step 5: Note the code catching up with the text**

`docs/rules/resolution.md`'s destinations table already says the 503 goes to the discard «после нейтрализации … вместе с картой, которой нейтрализовали». Task 1 made the code obey it. If `docs/rules/backlog.md` carries a "спека отстаёт от кода" entry naming this, retire it per the backlog's own rule — a resolved entry does not stay as a trophy. If it does not, add nothing: the text was right all along.

- [ ] **Step 6: Verify and commit**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: PASS. `apps/ui/src/animations/docs.test.ts` goes red if a new preset was added without its `reference.md` line — this task is where that is caught.

```bash
git add docs apps/playground
git commit -m "docs(animations,rules): the board's 503, and the three gaps it turned up (#102)"
```

---

## Self-Review

**Spec coverage.** Engine change → Task 1. Release uids → Task 2. The extraction → Task 3. Glow, token, reduced motion, alarm at the centre → Task 4. `revealAfter` → Task 5. `neutralized` plan → Task 6. `runNeutralized` → Task 7. Zone pull → Task 8. The three gestures, the drop rule, panel suppression, copy → Task 9. Sweep, `GATHER_HOLD`, `Beats.alarm`, the defenceless glow → Task 10. Crush's sacrifice → Task 11. Recipes, register, backlogs, the new issue, the rules marker → Task 12. Every "out of scope" item stays out.

**Names to keep straight across tasks.** `pending.card` (Task 1) is a `CardId` on the view and a `CardInstance` in engine state — the board only ever sees the id. `you.releaseUid` (Task 2) is a partial record keyed by slot, including `monitoring`. `useCoverFlight`'s `mark` takes the events array, not nothing (Task 3, Step 1's correction). `PlannedDraw['reveal'].discardId` is optional, and absent is the *standing* case (Task 5). The `neutralized` plan's `spent` carries the answer only — the alarm rides in `alarm` (Task 6), and `runNeutralized` reads `spent[0]` as the answer and `spent[1]` as its Code Review (Task 7). `Beat.alarm` is a queue field, not a plan field (Task 10, Step 6).

**Two places to read the real code before writing.** Task 2, Step 4: `ReleaseView`'s `monitoring` holds the instance directly while the three slots hold `{ card, codeReview? }`, so `.uid` sits at a different depth. Task 10, Step 4: use `useFlyer`'s real move name rather than the `glide` the test sketches. Both are called out inline where they bite.
