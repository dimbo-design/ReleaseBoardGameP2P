import type { CardData } from '@release/ui'
import { cardById } from '@release/ui'
import type { Leaving } from '@release/ui/animations'
import { scatterAt } from '@release/ui/animations'
import { act, render } from '@testing-library/react'
import type { RefObject } from 'react'
import { expect, it, vi } from 'vitest'
import type { BeatRun, BoardAnchors, BoardState, StagedHandoff } from '~/entities/game/board'
import { useComboBeat } from './comboBeat'
import type { BeatPlan } from './planBeats'

// Two arrays, and they are deliberately NOT index-aligned — read the second
// sentence before using them.
//
// `names` is the ORDER of everything this suite observes: every `play()` the
// runner makes, plus markers pushed by things that are not flights at all —
// the mocked discard exit's own `'centerToDiscard'` below, and a test's own
// marker for a seam call (the placement test's `takeStagedRelease`). `params`
// holds the arguments of the `play()` calls ONLY, in their own order. So
// `params[i]` is the i-th FLIGHT, not the entry at `names[i]`; indexing one by
// the other is wrong the moment any marker precedes the flight you meant.
//
// `params` is what tells "the release flew" from "the release flew FROM THE
// RIGHT PLACE" — the whole of Defect 1 (#101, Fix A) was a flight that
// happened, from the wrong origin.
const played = vi.hoisted(() => ({
  names: [] as string[],
  params: [] as (Record<string, unknown> | undefined)[],
}))

// Both arrays, always together: `params` accumulating across a file whose
// tests only ever cleared `names` is a trap for the next test that asserts on
// it (#101, Fix A, fix round 1 — review finding 3).
const resetPlayed = () => {
  played.names = []
  played.params = []
}

// What `useDiscardExit`'s `send` actually received — not just that it was
// called. `useDiscardExit`'s own `send` calls `play` through a SIBLING import
// (apps/ui/src/animations/useDiscardExit.tsx imports `./play` directly, not
// through this barrel), so mocking `play` above never sees it — drawBeat.test.tsx
// and useBeats.test.tsx hit the same wall and stub the whole hook instead of
// the leaf it calls internally; this does the same.
const exits = vi.hoisted(() => ({ items: [] as Leaving[] }))
// `hang`/`release` — the same "park a flight mid-air" convention
// `useBeats.test.tsx` uses for the discard exit: `send()` stores its resolver
// instead of resolving, so a test can hold the pair-out beat in flight and
// choose the moment it lands.
const hang = vi.hoisted(() => ({ on: false, release: null as (() => void) | null }))
vi.mock('@release/ui/animations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@release/ui/animations')>()
  const { useState } = await import('react')
  return {
    ...real,
    play: (name: string, _el: Element, params?: Record<string, unknown>) => {
      played.names.push(name)
      played.params.push(params)
      return { finished: Promise.resolve() } as unknown as Animation
    },
    // A stateful stand-in, not a fixed `overlay: []`: the reset() test needs
    // to tell "a flyer is mounted" from "reset() cleared it," and a hardcoded
    // empty overlay can't distinguish those.
    useDiscardExit: () => {
      const [flying, setFlying] = useState(false)
      return {
        overlay: flying ? ['flight'] : [],
        send: (items: Leaving[]) => {
          played.names.push('centerToDiscard')
          exits.items.push(...items)
          if (!hang.on) return Promise.resolve()
          setFlying(true)
          return new Promise<void>((r) => {
            hang.release = () => {
              setFlying(false)
              r()
            }
          })
        },
        reset: () => setFlying(false),
        FLIGHT_MS: 420,
      }
    },
  }
})

const card = (id: string) => cardById(id) as CardData

// The local player holds the attack card in hand at index 0 — the slot a
// local click-thrown attack (staged nothing) folds in from.
const base = {
  you: { name: 'You', hand: [{ uid: 'u1', card: card('attack-bug') }], release: {} },
  opponents: [{ id: 'p2', name: 'Two', handCount: 3, release: {} }],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
} as unknown as BoardState

const node = () => document.createElement('div')

// A node that answers a KNOWN box. jsdom measures everything as zeros, so a
// flight's origin is unassertable without this — and the origin is exactly
// what Defect 1 (#101, Fix A) got wrong.
const boxed = (left: number, top: number) => {
  const el = node()
  const rect = { left, top, width: 150, height: 210, right: left + 150, bottom: top + 210 }
  el.getBoundingClientRect = () => ({ ...rect, x: left, y: top, toJSON: () => rect }) as DOMRect
  return el
}

const CENTRE_BOX = { left: 400, top: 300, width: 150, height: 210 }
const STAGE_BOX = { left: 200, top: 300, width: 150, height: 210 }

function harness() {
  const centre = boxed(CENTRE_BOX.left, CENTRE_BOX.top)
  const stage = boxed(STAGE_BOX.left, STAGE_BOX.top)
  const handSlot = node()
  const releaseSlot = node()
  const anchors = {
    hand: { current: node() },
    centre: { current: centre },
    stage: { current: stage },
    cost: { current: node() },
    discardBox: { current: node() },
    pileBox: () => null,
    // Only OPPONENTS' seats are bound on the real board (`_Board.tsx` renders
    // no seat for the local player), so `seatBox` answers null for 'p1' — the
    // asymmetry `foldIn`'s own fallback runs into, and half of why a local
    // release used to fly from nowhere at all.
    seatBox: (player: string) =>
      player === 'p1' ? null : { left: 0, top: 0, width: 150, height: 210 },
    seatOf: () => node(),
    handSlotAt: (i: number) => (i === 0 ? handSlot : null),
    releaseSlot: () => releaseSlot,
    bindPile: () => {},
    bindSeat: () => {},
    bindReleaseSlot: () => {},
  } as unknown as BoardAnchors
  const api: { beat?: ReturnType<typeof useComboBeat> } = {}
  function Probe({
    staging,
    takeStagedRelease,
  }: {
    staging?: RefObject<StagedHandoff | null>
    takeStagedRelease?: RefObject<(() => void) | null>
  }) {
    api.beat = useComboBeat(anchors, staging, undefined, takeStagedRelease)
    return <>{api.beat.overlay}</>
  }
  return { anchors, api, centre, stage, Probe }
}

// `drawBeat.test.tsx`/`deckBeat.test.tsx`'s established pattern: a runner that
// spans real `nextFrames()`/`wait()` delays needs its intermediate DOM observed
// step by step, because React defers every update queued inside a single async
// `act()` scope until that scope's own promise settles.
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

const ctx: BeatRun = { base, publish: () => {} }

// ===== attackPlaced =====

// The mutation-check: delete the handoff branch (or its guard) and the beat
// would fold the card in from the hand slot instead of just handing the table
// back — which is exactly what the `not.toContain('foldIntoPair')` below
// would catch.
it('hands the table back without folding when the actor’s own staged play arrives', async () => {
  resetPlayed()
  const { api, Probe } = harness()
  const release = vi.fn()
  const staging = { current: { mainUid: 'u1', el: node(), release } as StagedHandoff }
  render(<Probe staging={staging} />)
  const plan: Extract<BeatPlan, { kind: 'attackPlaced' }> = {
    kind: 'attackPlaced',
    key: 'attack:5',
    eventId: 5,
    attacker: 'p1',
    card: 'attack-bug',
    sudo: false,
    target: 'p2',
  }
  await drive(() => api.beat?.runAttack(plan, ctx))
  expect(release).toHaveBeenCalledTimes(1)
  expect(played.names).not.toContain('foldIntoPair')
})

// ===== Fix C, finding 4 — the attack the cover is about to cover =====
//
// Dropping the fold's carrier is only safe because the centre's static pending
// render takes the card over on the same commit. When the throw and its answer
// arrive in ONE sync flush — the ordinary case for every peer that is neither
// attacker nor defender, in a star topology — `base` predates the batch and
// carries no pending, so nothing takes over: the attack blinks out, and the
// `covered` beat behind it holds a defence over an empty slot for SHOW_HOLD.
// The beat publishes the table it just made instead.
it('publishes the attack it just folded in, so the cover has something to cover', async () => {
  resetPlayed()
  const { api, Probe } = harness()
  const published: BoardState[] = []
  render(<Probe />)
  const plan: Extract<BeatPlan, { kind: 'attackPlaced' }> = {
    kind: 'attackPlaced',
    key: 'attack:5',
    eventId: 5,
    attacker: 'p2',
    card: 'attack-bug',
    sudo: false,
    target: 'p3', // neither us nor the thrower: we are watching
  }
  // `base` has no pending — this peer is seeing the throw for the first time
  await drive(() => api.beat?.runAttack(plan, { base, publish: (s) => published.push(s) }))
  expect(published).toHaveLength(1)
  expect(published[0].pending).toMatchObject({
    kind: 'defend',
    player: 'p3',
    attacker: 'p2',
    attackCard: 'attack-bug',
    sudo: false,
  })
})

// A DDoS is not answerable by a defence card — the engine resolves it on the
// spot and raises no pending at all (`release.ts`'s own comment). Since #19's
// fix it DOES log `attacked`, so it reaches this beat like any other attack,
// and a fabricated `defend` here would tell the table an answer is owed for a
// throw nobody can answer — with `deriveDock` drawing the known-wrong `0s`
// expired ring over it for the length of the beat.
it('never says an answer is owed for an attack that cannot be answered', async () => {
  resetPlayed()
  const { api, Probe } = harness()
  const published: BoardState[] = []
  render(<Probe />)
  const plan: Extract<BeatPlan, { kind: 'attackPlaced' }> = {
    kind: 'attackPlaced',
    key: 'attack:5',
    eventId: 5,
    attacker: 'p2',
    card: 'attack-ddos',
    sudo: false,
    target: 'p3', // neither us nor the thrower: we are watching
    // what `planBeats` marks a DDoS batch with — its own test is next door
    resolved: true,
  }
  await drive(() => api.beat?.runAttack(plan, { base, publish: (s) => published.push(s) }))
  expect(published).toHaveLength(0)
})

// The one peer this must never do it for. `options` is redacted for everyone
// but the pending's owner, so an empty one published onto OUR OWN board would
// say a defence is owed and offer no legal card to give it. Unreachable in
// practice — a peer who answered has necessarily seen the attack in an earlier
// batch — but the guard is what makes that a fact rather than a hope.
it('never tells us a defence is owed when the answer would be ours', async () => {
  resetPlayed()
  const { api, Probe } = harness()
  const published: BoardState[] = []
  render(<Probe />)
  const plan: Extract<BeatPlan, { kind: 'attackPlaced' }> = {
    kind: 'attackPlaced',
    key: 'attack:5',
    eventId: 5,
    attacker: 'p2',
    card: 'attack-bug',
    sudo: false,
    target: 'p1', // us
  }
  await drive(() => api.beat?.runAttack(plan, { base, publish: (s) => published.push(s) }))
  expect(published).toHaveLength(0)
})

// And it stays out of the way in the ordinary case: the pending was already on
// screen before this batch, so the static render is already there to take over
// and there is nothing to publish.
it('publishes nothing when the attack was already standing before this batch', async () => {
  resetPlayed()
  const { api, Probe } = harness()
  const published: BoardState[] = []
  render(<Probe />)
  const standing = {
    ...base,
    pending: {
      kind: 'defend',
      player: 'p3',
      attacker: 'p2',
      attackCard: 'attack-bug',
      sudo: false,
      options: [],
      openedAt: 0,
      deadline: 0,
      scope: 'hand',
    },
  } as unknown as BoardState
  await drive(() =>
    api.beat?.runAttack(
      {
        kind: 'attackPlaced',
        key: 'attack:5',
        eventId: 5,
        attacker: 'p2',
        card: 'attack-bug',
        sudo: false,
        target: 'p3',
      },
      { base: standing, publish: (s) => published.push(s) },
    ),
  )
  expect(published).toHaveLength(0)
})

// ===== Fix D, finding 7 — the ACTOR's own corner of the same batch =====
//
// Fix C fixed the blink-out for spectators and missed the seat it is most
// visible from. The attacker's own staged node is handed back at the top of the
// beat — nothing to move, the pending render takes over — but in a coalesced
// batch (a slow link, a rejoin, a replay) `base` predates the batch and carries
// no pending either, so THEIR attack blinks out too, and the `covered` beat
// behind it holds a defence over an empty slot for the whole SHOW_HOLD. The
// answer is never theirs to give (they threw it), so the redaction argument
// that keeps the publish away from the DEFENDER does not apply here.
it('publishes our own attack too when the answer arrives in the same batch', async () => {
  resetPlayed()
  const { api, Probe } = harness()
  const published: BoardState[] = []
  const release = vi.fn()
  const staging = { current: { mainUid: 'u1', el: node(), release } as StagedHandoff }
  render(<Probe staging={staging} />)
  const plan: Extract<BeatPlan, { kind: 'attackPlaced' }> = {
    kind: 'attackPlaced',
    key: 'attack:5',
    eventId: 5,
    attacker: 'p1', // us
    card: 'attack-bug',
    sudo: false,
    target: 'p2',
  }
  await drive(() => api.beat?.runAttack(plan, { base, publish: (s) => published.push(s) }))
  // the staged node is still handed back — nothing about that changes
  expect(release).toHaveBeenCalledTimes(1)
  expect(played.names).not.toContain('foldIntoPair')
  // …and the attack it left standing is published, so the cover has something
  // to cover
  expect(published).toHaveLength(1)
  expect(published[0].pending).toMatchObject({
    kind: 'defend',
    player: 'p2',
    attacker: 'p1',
    attackCard: 'attack-bug',
  })
})

// It DECLINES over a standing pending rather than replacing it (#101, Fix D,
// finding 7). The publish spreads `...ctx.base`, so a guard that only excluded
// `defend` would overwrite any other kind with a fabricated one. Not reachable
// today — a cost step resolves before a window opens — which is exactly why it
// is worth a guard rather than an argument.
it('never replaces a pending that is already standing', async () => {
  resetPlayed()
  const { api, Probe } = harness()
  const published: BoardState[] = []
  render(<Probe />)
  const owing = {
    ...base,
    pending: {
      kind: 'discardForRelease',
      player: 'p2',
      options: [],
    },
  } as unknown as BoardState
  await drive(() =>
    api.beat?.runAttack(
      {
        kind: 'attackPlaced',
        key: 'attack:5',
        eventId: 5,
        attacker: 'p2',
        card: 'attack-bug',
        sudo: false,
        target: 'p3',
      },
      { base: owing, publish: (s) => published.push(s) },
    ),
  )
  expect(published).toHaveLength(0)
})

it('folds an opponent’s attack in from their seat', async () => {
  resetPlayed()
  const { api, Probe } = harness()
  render(<Probe />)
  const plan: Extract<BeatPlan, { kind: 'attackPlaced' }> = {
    kind: 'attackPlaced',
    key: 'attack:5',
    eventId: 5,
    attacker: 'p2',
    card: 'attack-bug',
    sudo: false,
    target: 'p2',
  }
  await drive(() => api.beat?.runAttack(plan, ctx))
  expect(played.names).toEqual(['foldIntoPair'])
})

it('folds both halves of a sudo pair in from the attacker’s seat', async () => {
  resetPlayed()
  const { api, Probe } = harness()
  render(<Probe />)
  const plan: Extract<BeatPlan, { kind: 'attackPlaced' }> = {
    kind: 'attackPlaced',
    key: 'attack:5',
    eventId: 5,
    attacker: 'p2',
    card: 'attack-bug',
    sudo: true,
    target: 'p2',
  }
  await drive(() => api.beat?.runAttack(plan, ctx))
  expect(played.names.filter((n) => n === 'foldIntoPair')).toHaveLength(2)
})

// A window attack thrown by a plain click never touches `_useBoardStaging.ts`
// at all — the handoff stays null, and the card is still findable by id in
// the local hand, same as `sourceOf` does for a discard.
it('folds the local player’s own click-thrown attack in from its hand slot when nothing was staged', async () => {
  resetPlayed()
  const { api, Probe } = harness()
  render(<Probe />)
  const plan: Extract<BeatPlan, { kind: 'attackPlaced' }> = {
    kind: 'attackPlaced',
    key: 'attack:5',
    eventId: 5,
    attacker: 'p1',
    card: 'attack-bug',
    sudo: false,
    target: 'p1',
  }
  await drive(() => api.beat?.runAttack(plan, ctx))
  expect(played.names).toEqual(['foldIntoPair'])
})

// ===== releasePlaced =====

it('flies the actor’s own staged pair straight to the release slot', async () => {
  resetPlayed()
  const { api, Probe } = harness()
  const release = vi.fn()
  const staging = { current: { mainUid: 'u1', el: node(), release } as StagedHandoff }
  render(<Probe staging={staging} />)
  const plan: Extract<BeatPlan, { kind: 'releasePlaced' }> = {
    kind: 'releasePlaced',
    key: 'release:7',
    eventId: 7,
    player: 'p1',
    slot: 'frontend',
    card: 'release-frontend',
    codeReview: 'support-code-review',
  }
  await drive(() => api.beat?.runRelease(plan, ctx))
  expect(played.names).toEqual(['playToReleaseZone'])
  expect(release).toHaveBeenCalledTimes(1)
})

// Defect 1 (#101, Fix A) — the commonest action in the game, and the one case
// this suite never had: the LOCAL player's own plain release. It stands at the
// STAGE slot from the moment it was pulled (`_useBoardStaging.ts`), so there is
// nothing to fold in — it flies from there, once, and the static render that
// was standing there is let go in the same beat.
//
// The base hand below is the real shape of that moment: the release has NOT
// left `you.hand` (the engine's release path emits nothing and touches no
// hand while the cost pending is open) but the fan does not render it, so
// `foldIn`'s hand-index lookup — the branch this beat used to fall into —
// aims at a fan slot that belongs to a different card, or at none at all.
const soloReleaseCtx: BeatRun = {
  base: {
    ...base,
    you: {
      ...base.you,
      hand: [
        { uid: 'u1', card: card('attack-bug') },
        { uid: 'u2', card: card('release-frontend') },
      ],
    },
  } as unknown as BoardState,
  publish: () => {},
}

it('flies the actor’s own plain release from the stage slot, once, and lets its standing render go first', async () => {
  resetPlayed()
  const { api, Probe } = harness()
  // the seam's own marker, pushed into the SAME array as the flights so the
  // ORDER is assertable: the static render must be released in the commit the
  // carrier goes up, never after the flight (the approved scene's own
  // `setStaged(null)` + `raise` in one commit)
  const take = vi.fn(() => {
    played.names.push('takeStagedRelease')
  })
  render(<Probe takeStagedRelease={{ current: take }} />)
  const plan: Extract<BeatPlan, { kind: 'releasePlaced' }> = {
    kind: 'releasePlaced',
    key: 'release:7',
    eventId: 7,
    player: 'p1',
    slot: 'frontend',
    card: 'release-frontend',
  }
  await drive(() => api.beat?.runRelease(plan, soloReleaseCtx))
  // one flight, and the fold never happens
  expect(played.names).toEqual(['takeStagedRelease', 'playToReleaseZone'])
  expect(take).toHaveBeenCalledTimes(1)
  // and it starts at the STAGE slot — not the attack centre, which is where
  // the beat used to measure from
  expect(played.params[0]).toMatchObject({ from: STAGE_BOX })
})

it('folds an opponent’s Code Review combo in and flies it to their slot', async () => {
  resetPlayed()
  const { api, Probe } = harness()
  render(<Probe />)
  const plan: Extract<BeatPlan, { kind: 'releasePlaced' }> = {
    kind: 'releasePlaced',
    key: 'release:7',
    eventId: 7,
    player: 'p2',
    slot: 'backend',
    card: 'release-backend',
    codeReview: 'support-code-review',
  }
  await drive(() => api.beat?.runRelease(plan, ctx))
  expect(played.names.filter((n) => n === 'foldIntoPair')).toHaveLength(2)
  expect(played.names).toContain('playToReleaseZone')
})

// The cost leg (#101, Task 11): by the rules a release costs one card, and
// the cost is shown to the table in the open before it goes. `player: 'p2'`
// here (not the local `ctx.base.selfId`, 'p1') — a remote player's cost, so
// this beat's own flyer carries it in from their seat, holds it, and only
// then does it leave through the shared discard exit.
it('shows the cost open, sends it to the discard, then lands the release', async () => {
  resetPlayed()
  exits.items = []
  const { api, Probe } = harness()
  render(<Probe />)
  const plan: Extract<BeatPlan, { kind: 'releasePlaced' }> = {
    kind: 'releasePlaced',
    key: 'release:7',
    eventId: 7,
    player: 'p2',
    slot: 'frontend',
    card: 'release-frontend',
    cost: { eventId: 6, card: 'attack-bug' },
  }
  await drive(() => api.beat?.runRelease(plan, ctx))
  // the cost left through the shared discard exit, on its own event's scatter
  expect(exits.items).toHaveLength(1)
  expect(exits.items[0]).toMatchObject({
    key: 'c6',
    card: expect.objectContaining({ id: 'attack-bug' }),
    scatter: scatterAt(6),
  })
  // and the release landed with the snap every release lands with
  expect(played.names).toContain('playToReleaseZone')
  // the cost is shown BEFORE the release moves: the discard exit is recorded
  // ahead of the zone flight
  expect(played.names.indexOf('centerToDiscard')).toBeLessThan(
    played.names.indexOf('playToReleaseZone'),
  )
})

it('lands a release with no cost without an exit', async () => {
  resetPlayed()
  exits.items = []
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() =>
    api.beat?.runRelease(
      {
        kind: 'releasePlaced',
        key: 'release:7',
        eventId: 7,
        player: 'p2',
        slot: 'frontend',
        card: 'release-frontend',
      },
      ctx,
    ),
  )
  expect(exits.items).toHaveLength(0)
  expect(played.names).toContain('playToReleaseZone')
})

// Fix round 1 (post-review): a PAIRED release (Code Review combo) can ALSO
// carry a cost — the rules charge one regardless of the combo, and
// `planBeats` treats `cost`/`codeReview` as independent optional fields — so
// this combination is real, and it is the one the cost leg's placement
// (AFTER the synchronous `handoff` capture, not before) exists to protect.
//
// A STATIC `staging` ref (as every other test in this file uses) cannot pin
// the ordering: nothing here ever mutates `.current` mid-run, so the beat
// would read the same value whether the capture sits before or after the
// cost leg — a reorder would pass this test either way, which is exactly
// the "passed for the wrong reason" risk flagged in review. So this test
// SIMULATES the real race instead of relying on one: `_useBoardStaging.ts`'s
// own passive effect clears the handoff the instant the synchronous render
// burst that started this beat is done (`runAttack`'s own comment above
// explains why) — a microtask scheduled right before `drive()` fires at
// exactly that boundary, before ANY of this beat's own `await`s (including
// the cost leg's `wait(SHOW_HOLD)`) have had a chance to resolve. Reading
// `handoff` synchronously, at the top, already holds the real value before
// this runs; reading it after the cost leg's own awaits (the regression this
// guards against) reads the ALREADY-CLEARED ref instead.
//
// The mutation-check `not.toContain('foldIntoPair')` is the discriminating
// assertion (same idiom as "hands the table back without folding" above): if
// the cost leg is ever moved back ahead of the capture, `handoff` comes back
// null, this beat falls to `foldIn` — which DOES call `foldIntoPair` — and
// this assertion goes red. Verified empirically (not just by this comment):
// temporarily moving the capture to after the cost leg turns this test red;
// restoring the order turns it green again — see the task report.
it('honours the actor’s own paired handoff even when its release also carries a cost', async () => {
  resetPlayed()
  exits.items = []
  const { api, Probe } = harness()
  const release = vi.fn()
  const staging: { current: StagedHandoff | null } = {
    current: { mainUid: 'u1', el: node(), release } as StagedHandoff,
  }
  render(<Probe staging={staging} />)
  const plan: Extract<BeatPlan, { kind: 'releasePlaced' }> = {
    kind: 'releasePlaced',
    key: 'release:7',
    eventId: 7,
    player: 'p1',
    slot: 'frontend',
    card: 'release-frontend',
    codeReview: 'support-code-review',
    cost: { eventId: 6, card: 'attack-bug' },
  }
  // the simulated clear — scheduled now, fires at the first microtask
  // checkpoint after `drive()` below starts the beat, i.e. right after its
  // OWN synchronous prefix yields at its first `await`
  void Promise.resolve().then(() => {
    staging.current = null
  })
  await drive(() => api.beat?.runRelease(plan, ctx))
  // the handoff is honoured: the actor's own staged pair is ADOPTED, not
  // re-folded
  expect(release).toHaveBeenCalledTimes(1)
  expect(played.names).not.toContain('foldIntoPair')
  // the cost still leaves through the discard exit…
  expect(exits.items).toHaveLength(1)
  expect(exits.items[0]).toMatchObject({
    key: 'c6',
    card: expect.objectContaining({ id: 'attack-bug' }),
    scatter: scatterAt(6),
  })
  // …and still before the release flies
  expect(played.names).toContain('playToReleaseZone')
  expect(played.names.indexOf('centerToDiscard')).toBeLessThan(
    played.names.indexOf('playToReleaseZone'),
  )
})

// ===== pairToDiscard =====

it('splits the pending pair at the centre into two singles for the discard', async () => {
  const { api, Probe, centre } = harness()
  const pending = node()
  pending.setAttribute('data-pending-play', '')
  centre.appendChild(pending)
  render(<Probe />)
  exits.items = []
  const plan: Extract<BeatPlan, { kind: 'pairToDiscard' }> = {
    kind: 'pairToDiscard',
    key: 'pairOut:10',
    main: { eventId: 10, card: 'attack-bug' },
    aux: { eventId: 11, card: 'support-sudo' },
  }
  await drive(() => api.beat?.runPairOut(plan, ctx))
  expect(exits.items).toHaveLength(1)
  expect(exits.items[0]).toMatchObject({
    key: 'p10',
    card: expect.objectContaining({ id: 'attack-bug' }),
    aux: expect.objectContaining({ id: 'support-sudo' }),
    // the aux's OWN scatter (I7) — without it, `useDiscardExit`'s pair-split
    // has no way to learn the aux's discard event id and flies it on a random
    // `jitter()` instead (useDiscardExit.test.tsx pins the consuming side).
    auxScatter: scatterAt(11),
  })
})

it('flies only the sudo half out on a rollback return', async () => {
  const { api, Probe, centre } = harness()
  const pending = node()
  pending.setAttribute('data-pending-play', '')
  centre.appendChild(pending)
  render(<Probe />)
  exits.items = []
  const plan: Extract<BeatPlan, { kind: 'pairToDiscard' }> = {
    kind: 'pairToDiscard',
    key: 'pairOut:10',
    aux: { eventId: 10, card: 'support-sudo' },
  }
  await drive(() => api.beat?.runPairOut(plan, ctx))
  expect(exits.items).toHaveLength(1)
  expect(exits.items[0]).toMatchObject({
    key: 'p10',
    card: expect.objectContaining({ id: 'support-sudo' }),
  })
  expect(exits.items[0].aux).toBeUndefined()
})

// The pin the brief asks for: nothing today pins `[data-pending-play]` itself
// — this beat is the one place that reads it, so a `_Board.tsx` change that
// dropped the attribute would silently leave the split unmeasurable (never
// stranded, but never flown either). The test above (a real node CARRYING the
// attribute) is what would catch that regression; this one pins the no-node
// side of the same branch.
it('sends nothing when the pending node cannot be measured', async () => {
  const { api, Probe } = harness()
  render(<Probe />)
  exits.items = []
  const plan: Extract<BeatPlan, { kind: 'pairToDiscard' }> = {
    kind: 'pairToDiscard',
    key: 'pairOut:10',
    main: { eventId: 10, card: 'attack-bug' },
  }
  await drive(() => api.beat?.runPairOut(plan, ctx))
  expect(exits.items).toHaveLength(0)
})

// ===== reset =====

// A new match cancels what is in the air (fix 1, #97) — mirrored here for the
// combo runner's own two carriers: the fold's own flyer (`useFlyer`) and the
// pair-out's discard exit (`useDiscardExit`, shared with `discardBeat`).
//
// This parks the pair-out half, the same `hang`/`release` mechanism
// `useBeats.test.tsx`'s rematch test uses for the discard beat's own exit, so
// the assertion is on the REAL carrier `send()` mounted — not a mock whose
// overlay was empty either way. The fold's own flyer half (`flyer.drop()`) is
// the same one-line combinator already shipped and typechecked for
// `deckBeat`'s `reset`; parking a *second*, independent carrier (a fold at the
// centre, which needs its own hung `play()`) for the same assertion would
// double the harness's mocking surface for no additional branch coverage —
// `reset()` is one function, and this proves it actually runs and has an
// effect, not that its two lines exist.
it('reset() drops a pair-out flight parked mid-air', async () => {
  resetPlayed()
  exits.items = []
  const { api, Probe, centre } = harness()
  const pending = node()
  pending.setAttribute('data-pending-play', '')
  centre.appendChild(pending)
  render(<Probe />)
  const plan: Extract<BeatPlan, { kind: 'pairToDiscard' }> = {
    kind: 'pairToDiscard',
    key: 'pairOut:10',
    main: { eventId: 10, card: 'attack-bug' },
    aux: { eventId: 11, card: 'support-sudo' },
  }
  hang.on = true
  const running = api.beat?.runPairOut(plan, ctx)
  // Past `runPairOut`'s own `nextFrames()` wait and into the hung `send()` —
  // the same real-timer flush `useBeats.test.tsx`'s `flush()` uses for the
  // same wait.
  await act(async () => void (await new Promise((r) => setTimeout(r, 80))))
  expect(api.beat?.overlay.length).toBeGreaterThan(0)
  act(() => {
    api.beat?.reset()
  })
  expect(api.beat?.overlay.length).toBe(0)
  // Release the hang so the parked call resolves and doesn't leak into a
  // later test.
  hang.on = false
  hang.release?.()
  await running
})
