// The staging → beat handoff's own shadow-gating invariant (#100, Task 11
// review round 1, Important #3 — writing this test surfaced a REAL, already-
// existing race, not just a future-edit risk; both the race and the fix are
// documented here and in comboBeat.tsx's own header on `runAttack`).
//
// The batch that carries an `attacked`/`released` event updates `live` in the
// SAME prop change (useBeats.ts's own "I1" note: "by the time the batch
// effect runs, `live` is already the projection the arriving batch
// produced"). On the very FIRST render of that update, `useBeats`'s `running`
// state does not exist yet — it is only set by an EFFECT that runs after this
// render commits — so `beats.shadow` is still null and `state = beats.shadow
// ?? live` briefly reads as `live`: the card ALREADY out of the hand.
// `_useBoardStaging.ts`'s own hand-watching effect reacts to exactly that
// (its usual, correct job — "the projection moved our card out of the hand,
// staging's job is done") and clears `staged`, believing the play was simply
// accepted. That effect is a passive `useEffect`, so it can only fire once
// this render's synchronous work is done — but `useBeats`'s OWN watching
// effect is a `useLayoutEffect`, and IT starts the beat SYNCHRONOUSLY, within
// that same window, before any passive effect gets a turn. So reading the
// handoff at the TOP of `runAttack`/`runRelease` — before their first `await`
// — wins the race: the value is captured before the passive effect ever runs.
// Reading it one line later (after `await nextFrames()`, as both runners
// originally did) loses it: the passive effect fires in between, clears
// `staged`, and this beat's own handoff-building effect (`_Board.tsx`, and
// this harness) follows suit — so the beat reads a NULL handoff, falls to the
// "everyone else" branch, and folds the actor's own play in a second time
// from a hand slot it already left.
//
// This drives the real seam: the actual `useBoardStaging` + `useBeats` (+ the
// real `useComboBeat` underneath), wired the same way `_Board.tsx` wires them
// — a `handoffRef` kept current in a layout effect off `staging.staged`. It is
// NOT a mount of `_Board.tsx` itself: that component's `intro`/deal-intro
// machinery has its own gating (`beats.enabled` depends on the deal reporting
// done), which is orthogonal to this seam and would need a full synthetic
// dealt game to drive through. This harness reproduces only the load-bearing
// wiring — the same effect body as `_Board.tsx`'s own — so a future change to
// THAT effect must be mirrored here too.

import type { Event, PlayerId } from '@release/engine'
import type { CardData, TableTarget } from '@release/ui'
import { CARD_W, Card, CardPair, cardById, ReleaseZone } from '@release/ui'
import { act, render, screen } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import { expect, it, vi } from 'vitest'
import type { BoardState, StagedHandoff } from '~/entities/game/board'
import { useBoardAnchors } from '~/entities/game/board'
import { useBeats } from '~/features/board-beats'
import { useBoardStaging } from '../_useBoardStaging'
import { useDefenseStaging } from '../_useDefenseStaging'

vi.mock('~/shared/lib/useReducedMotion', () => ({ useReducedMotion: () => false }))

// `calls` alongside `names` (#101, Fix D, finding 9): the ORDER of the two
// movements is what most of this file asks about, but one test has to ask where
// a movement actually started — a raise at the destination and a flight across
// the table are both a `playToCenter` in `names`.
const played = vi.hoisted(() => ({
  names: [] as string[],
  calls: [] as { name: string; params: Record<string, unknown> }[],
}))
vi.mock('@release/ui/animations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@release/ui/animations')>()
  return {
    ...real,
    play: (name: string, el: Element, params?: Record<string, unknown>) => {
      played.names.push(name)
      played.calls.push({ name, params: params ?? {} })
      return real.play(name, el, params)
    },
  }
})

const card = (id: string) => cardById(id) as CardData

const before: BoardState = {
  you: { name: 'You', hand: [{ uid: 'u-atk', card: card('attack-bug') }], release: {} },
  opponents: [{ id: 'p2', name: 'Two', handCount: 3, release: {} }],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
  turn: 'p1' as PlayerId,
  hasDrawn: true,
  selfId: 'p1',
  history: [],
  setup: {},
  playable: ['u-atk'],
  frozen: [],
  targets: { 'u-atk': [{ kind: 'player', player: 'p2' }] },
} as unknown as BoardState

const attackedEvent: Event = {
  id: 1,
  type: 'attacked',
  attacker: 'p1',
  card: 'attack-bug',
  sudo: false,
  target: 'p2',
}

// The projection once the attack lands: the card is out of the local hand,
// its target is gone, and the opponent owes a defence.
const after: BoardState = {
  ...before,
  you: { ...before.you, hand: [] },
  targets: {},
  pending: {
    kind: 'defend',
    player: 'p2',
    attacker: 'p1',
    attackCard: 'attack-bug',
    sudo: false,
    options: [],
    openedAt: 0,
    deadline: 15000,
    scope: 'hand',
  },
} as unknown as BoardState

const api: {
  staging?: ReturnType<typeof useBoardStaging>
  handoffRef?: React.RefObject<StagedHandoff | null>
  anchors?: ReturnType<typeof useBoardAnchors>
} = {}

// The load-bearing subset of `_Board.tsx`'s own wiring: `useBeats` gets the
// handoff ref; `useBoardStaging` gets `beats.shadow ?? live` (never `live`
// directly — that is I1, and also what makes THIS seam observable at all);
// the ref is kept current in a layout effect off `staging.staged`, mirroring
// `_Board.tsx`'s own body exactly.
function Harness({ live, events }: { live: BoardState; events: Event[] }) {
  const anchors = useBoardAnchors()
  const handoffRef = useRef<StagedHandoff | null>(null)
  const soloStagedRef = useRef<HTMLDivElement>(null)
  api.handoffRef = handoffRef
  api.anchors = anchors

  // A marker for the cost-carrying release test below, not a real staging
  // hook's clear (this harness has no `paidCost` state to clear at all — it
  // never wires `useBoardStaging`'s own `clearPaidCost` in here). `play`'s own
  // mock below cannot see `runRelease`'s cost leg hand off to the discard
  // exit: `useDiscardExit.tsx` calls `play('centerToDiscard', ...)` through a
  // SIBLING import, not the `@release/ui/animations` barrel this file mocks
  // (the same gotcha `comboBeat.test.tsx`'s own header documents). `runRelease`
  // calls `clearPaidCost` at the EXACT same synchronous point it calls
  // `send()` (comboBeat.tsx's own `runRelease`), so pushing into the SAME
  // `played.names` array from here gives an equivalent, observable ordering
  // signal without needing to intercept that unreachable call.
  const clearPaidCostRef = useRef<(() => void) | null>(() => played.names.push('clearPaidCost'))
  // The placement beat's own seam into the staging hook (#101, Fix A), kept
  // current below exactly the way `_Board.tsx` keeps it.
  const takeStagedReleaseRef = useRef<(() => void) | null>(null)
  const beats = useBeats({
    live,
    events,
    anchors,
    enabled: true,
    staging: handoffRef,
    clearPaidCost: clearPaidCostRef,
    takeStagedRelease: takeStagedReleaseRef,
  })
  const state = beats.shadow ?? live

  const staging = useBoardStaging({ state, anchors, actions: {}, events, enabled: true })
  api.staging = staging
  takeStagedReleaseRef.current = staging.takeStagedRelease

  useLayoutEffect(() => {
    const s = staging.staged
    handoffRef.current =
      s?.phase === 'dispatched' && s.main
        ? {
            mainUid: s.main.uid,
            supportUid: s.support?.uid,
            el: s.merged ? staging.pairRef.current : soloStagedRef.current,
            release: staging.release,
          }
        : null
  }, [staging.staged, staging.pairRef, staging.release])

  const soloStaged =
    staging.staged && !staging.staged.merged && staging.staged.main?.card.category !== 'release'
      ? (staging.staged.support ?? staging.staged.main)
      : null

  // `_Board.tsx`'s own `stagedRelease`, mirrored here for the same reason the
  // handoff effect above is: it is load-bearing wiring for the seam under
  // test. A solo release stands at the STAGE slot rather than the centre, and
  // the third of its three guards (`releasePlacing`) is what the placement
  // beat flips so the flight it starts is not doubled by this render (#101,
  // Fix A, Defect 1).
  const costPending =
    state.pending?.kind === 'discardForRelease' && state.pending.player === state.selfId
      ? state.pending
      : null
  const stagedReleaseLocal =
    staging.staged?.phase === 'dispatched' &&
    !staging.staged.support &&
    staging.staged.main?.card.category === 'release'
      ? staging.staged.main
      : undefined
  const stagedRelease = staging.stageStanding
    ? ((costPending ? state.you.hand.find((c) => c.uid === costPending.release) : undefined) ??
      stagedReleaseLocal)
    : undefined

  return (
    <div>
      {/* the fan renders `handItems`, not `you.hand` — one card shorter for as
          long as a release is staged, which is precisely the mismatch
          `foldIn`'s hand-index lookup used to walk into */}
      <div ref={anchors.hand}>
        {staging.handItems.map((c) => (
          <div key={c.uid} data-hand-slot />
        ))}
      </div>
      <div ref={anchors.stage} data-testid="stage-slot">
        {stagedRelease && <Card card={stagedRelease.card} interactive={false} width="100%" />}
      </div>
      <div ref={anchors.centre} data-board-centre>
        {soloStaged && staging.overlay.length === 0 && (
          <div ref={soloStagedRef} data-testid="solo-staged" />
        )}
        {/* mirrors `_Board.tsx`'s own centre-pending block verbatim (the
            sudo/CardPair branch included) — the resolution/opponent-sudo
            tests below need the same pair the real board would render. */}
        {!staging.staged &&
          state.pending?.kind === 'defend' &&
          (() => {
            const data = cardById(state.pending.attackCard)
            if (!data) return null
            const aux = state.pending.sudo ? cardById('support-sudo') : null
            return (
              <div data-pending-play data-testid="pending">
                {aux ? (
                  <CardPair main={data} aux={aux} width="100%" />
                ) : (
                  <Card card={data} interactive={false} width="100%" />
                )}
              </div>
            )
          })()}
      </div>
      {/* the opponent seats `foldIn` folds an opponent's own play in from
          (`anchors.seatBox`). 'p2' throws in every fixture here; 'p3' DEFENDS in
          the one-flush exchange below, and until #101's Fix D that seat was not
          bound at all — so the spectator's cover fell through to
          `defenseBeat`'s own last-resort `?? coverBox` and "flew" nowhere,
          zero distance, while the comment here claimed one seat covered every
          fixture. Its rect is stubbed because jsdom measures every unstyled
          node as all zeros, and a flight from a zero box to the cover slot's
          zero box is exactly the non-journey this is here to tell apart. */}
      <div ref={(el) => anchors.bindSeat('p2', el)} />
      <div
        ref={(el) => {
          if (el)
            el.getBoundingClientRect = () =>
              ({ left: 400, top: 200, width: 150, height: 210 }) as unknown as DOMRect
          anchors.bindSeat('p3', el)
        }}
      />
      {/* the cost slot — only the paired-release-with-cost test below needs
          it (`runRelease`'s cost leg measures it regardless of actor/remote),
          but binding it unconditionally costs nothing for the other tests */}
      <div ref={anchors.cost} />
      {/* the cover slot — only the one-flush exchange below needs it
          (`defenseBeat.runCovered` measures it), but binding it costs the
          other tests nothing */}
      <div ref={anchors.cover} data-testid="cover-slot" />
      <div ref={anchors.discardBox} />
      {/* a lean proxy for `_Board.tsx`'s own `<Pile heap={decks.discardHeap}>`
          — `Pile`'s own rendering of a heap is already pinned elsewhere
          (boardDiscard.test.tsx); what this harness needs is only that the
          projection's own heap is what's on screen once the queue hands over. */}
      <div data-testid="discard-heap">
        {(state.decks.discardHeap ?? []).map((h) => (
          <span key={h.uid} data-card={h.card.id} />
        ))}
      </div>
      <ReleaseZone
        release={state.you.release}
        support={state.you.support}
        player={state.selfId}
        slotRef={(key, el) => anchors.bindReleaseSlot(state.selfId, key, el)}
      />
      <div ref={staging.pairRef} data-testid="pair-flyer">
        {staging.staged?.merged && staging.staged.support && staging.staged.main && (
          <CardPair
            main={staging.staged.main.card}
            aux={staging.staged.support.card}
            width="100%"
          />
        )}
      </div>
      {staging.overlay}
      {beats.overlays}
    </div>
  )
}

// `deckBeat.test.tsx`/`comboBeat.test.tsx`'s own `drive`, with one addition:
// `run` (the prop update that arms the beat) has to happen AFTER fake timers
// are already active, not before — `runAttack`'s `nextFrames()` calls
// `requestAnimationFrame` the instant the beat starts, and a real (unfaked)
// rAF registered before `vi.useFakeTimers()` runs on a clock
// `advanceTimersByTimeAsync` never touches, so the beat would hang forever.
//
// `steps` defaults to the original budget (30 × 20ms = 600ms) every existing
// call site here relies on — long enough for a fold's own MERGE_MS/620ms-ish
// animations. The cost-carrying release test below needs more: its own
// `wait(SHOW_HOLD)` (1.2s, a real `setTimeout` under these fake timers) alone
// exceeds the default budget, so that one call passes a larger `steps`.
async function drive(run: () => void, steps = 30) {
  vi.useFakeTimers()
  try {
    run()
    for (let i = 0; i < steps; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20)
      })
    }
  } finally {
    vi.useRealTimers()
  }
}

it('hands the table back without re-folding when the local player’s own attack lands', async () => {
  played.names = []
  const { rerender } = render(<Harness live={before} events={[]} />)

  // the real dispatch: pull the attack card, aim it at the opponent
  act(() => {
    api.staging?.onHandPlay('u-atk', { x: 0, y: 0 })
  })
  act(() => {
    api.staging?.onTargetPick({ kind: 'player', player: 'p2' } as TableTarget)
  })
  expect(api.staging?.staged?.phase).toBe('dispatched')
  // the handoff is up: this beat's own play, standing at the centre
  expect(api.handoffRef?.current?.mainUid).toBe('u-atk')

  // the engine answers: the attack landed, the card is out of the hand, a
  // defence is owed. `useBeats` picks up `attackPlaced` from the new event —
  // in the SAME prop update that already moves `live` past the pull (I1).
  await drive(() => rerender(<Harness live={after} events={[attackedEvent]} />))

  // no re-fold: the beat recognised its own staged play and released it
  // instead of flying it in again from the (now-empty) hand slot.
  expect(played.names).not.toContain('foldIntoPair')
  // the handoff and the staged play are both cleared once the beat is done —
  // via `release()`, not via the OTHER (premature) path this test pins shut.
  expect(api.handoffRef?.current).toBeNull()
  expect(api.staging?.staged).toBeNull()
})

// ===== Task 12 (#100): the wire-driven scenarios this harness is built to
// answer, beyond the handoff race above. `planBeats.test.ts` already pins the
// EVENT → PLAN classification for both of these, and `comboBeat.test.tsx`
// already pins `runAttack`/`runRelease`/`runPairOut`'s own mechanics against a
// fake anchor registry; what neither exercises is the REAL `useBeats` queue —
// plan → run → shadow → drain → handover — landing on the render the actual
// hooks (not a stand-in) would produce.

const opponentSudoBefore: BoardState = {
  you: { name: 'You', hand: [], release: {} },
  opponents: [{ id: 'p2', name: 'Two', handCount: 4, release: {} }],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
  turn: 'p2' as PlayerId,
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
} as unknown as BoardState

const opponentSudoAttacked: Event = {
  id: 1,
  type: 'attacked',
  attacker: 'p2',
  card: 'attack-bug',
  sudo: true,
  target: 'p1',
}

const opponentSudoAfter: BoardState = {
  ...opponentSudoBefore,
  opponents: [{ id: 'p2', name: 'Two', handCount: 3, release: {} }],
  pending: {
    kind: 'defend',
    player: 'p1',
    attacker: 'p2',
    attackCard: 'attack-bug',
    sudo: true,
    options: [],
    openedAt: 0,
    deadline: 15000,
    scope: 'hand',
  },
} as unknown as BoardState

// The mutation-check: drop the `plan.attacker === ctx.base.selfId` guard (or
// the sudo aux) in `runAttack` and this fails two different ways — either the
// opponent's own throw would go looking for a local handoff that was never
// there (nothing folds, no pending renders), or only one half would fold and
// the CardPair assertion below would find a lone Card instead.
it('an opponent’s sudo attack plans the full fold — no local staging involved at any point', async () => {
  played.names = []
  const { rerender } = render(<Harness live={opponentSudoBefore} events={[]} />)
  expect(api.staging?.staged).toBeNull()
  expect(api.handoffRef?.current).toBeNull()

  await drive(() => rerender(<Harness live={opponentSudoAfter} events={[opponentSudoAttacked]} />))

  // both halves fold in from the attacker’s own seat
  expect(played.names.filter((n) => n === 'foldIntoPair')).toHaveLength(2)
  // the local player never staged anything — an opponent’s play never reads
  // or writes the handoff at all
  expect(api.handoffRef?.current).toBeNull()
  expect(api.staging?.staged).toBeNull()
  // the projection the beat hands over to: the pair, not a lone card
  const pending = screen.getByTestId('pending')
  expect(pending.querySelector('[data-main]')).toBeTruthy()
  expect(pending.querySelector('[data-aux]')).toBeTruthy()
})

const resolutionBefore: BoardState = {
  you: { name: 'You', hand: [], release: {} },
  opponents: [{ id: 'p2', name: 'Two', handCount: 3, release: {} }],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
  turn: 'p2' as PlayerId,
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
  pending: {
    kind: 'defend',
    player: 'p1',
    attacker: 'p2',
    attackCard: 'attack-bug',
    sudo: true,
    options: [],
    openedAt: 0,
    deadline: 15000,
    scope: 'hand',
  },
} as unknown as BoardState

const resolutionEvents: Event[] = [
  { id: 10, type: 'tookHit', player: 'p1' } as Event,
  { id: 11, type: 'discarded', player: 'p2', card: 'attack-bug', reason: 'attackSpent' } as Event,
  { id: 12, type: 'discarded', player: 'p2', card: 'support-sudo', reason: 'attackSpent' } as Event,
]

// `runPairOut` never calls `ctx.publish` (comboBeat.tsx's own header) — the
// projection handed over to IS the state this literal already carries, same
// as `boardDiscard.test.tsx` builds a heap. What is under test here is only
// that the real queue gets there: the beat measures the pending pair,
// completes without stranding the shadow, and the handover lands on it.
const resolutionAfter: BoardState = {
  ...resolutionBefore,
  pending: undefined,
  decks: {
    ...resolutionBefore.decks,
    discardHeap: [
      { uid: 'h11', card: card('attack-bug'), rot: 4, dx: 2, dy: -3 },
      { uid: 'h12', card: card('support-sudo'), rot: -6, dx: -1, dy: 5 },
    ],
    discardCount: 2,
  },
} as unknown as BoardState

it('the resolution splits the pending pair into the discard heap', async () => {
  const { rerender } = render(<Harness live={resolutionBefore} events={[]} />)
  expect(screen.getByTestId('pending').hasAttribute('data-pending-play')).toBe(true)

  await drive(() => rerender(<Harness live={resolutionAfter} events={resolutionEvents} />))

  expect(screen.queryByTestId('pending')).toBeNull()
  const heap = screen.getByTestId('discard-heap').querySelectorAll('[data-card]')
  expect(Array.from(heap).map((el) => el.getAttribute('data-card'))).toEqual([
    'attack-bug',
    'support-sudo',
  ])
})

// The carried requirement beyond the brief's four tests (#100, Task 11 review
// — a disclosed gap): the release path's own version of the attack test
// above. Pulling Code Review and folding a release partner IN (the gesture,
// `_useBoardStaging.ts`'s own `onCardClick`) stands the merged pair at the
// centre; `released` landing with the SAME actor recognises that staged pair
// via the handoff and flies it to the slot instead of folding a second one in
// from a hand it never left (this repo, per `comboBeat.tsx`'s `runRelease`).
const releaseBefore: BoardState = {
  you: {
    name: 'You',
    hand: [
      { uid: 'support-code-review#0', card: card('support-code-review') },
      { uid: 'release-frontend#0', card: card('release-frontend') },
    ],
    release: {},
  },
  opponents: [{ id: 'p2', name: 'Two', handCount: 3, release: {} }],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
  turn: 'p1' as PlayerId,
  hasDrawn: true,
  selfId: 'p1',
  history: [],
  setup: {},
  playable: ['support-code-review#0', 'release-frontend#0'],
  frozen: [],
  targets: {},
  comboOptions: { 'support-code-review#0': ['release-frontend#0'] },
} as unknown as BoardState

const releasedEvent: Event = {
  id: 1,
  type: 'released',
  player: 'p1',
  slot: 'frontend',
  card: 'release-frontend',
  codeReview: 'support-code-review',
}

const releaseAfter: BoardState = {
  ...releaseBefore,
  you: {
    ...releaseBefore.you,
    hand: [],
    release: { frontend: card('release-frontend') },
    support: { frontend: card('support-code-review') },
  },
  playable: [],
  comboOptions: {},
} as unknown as BoardState

it('adopts the actor’s own staged release pair into the zone instead of re-folding it', async () => {
  played.names = []
  const { rerender } = render(<Harness live={releaseBefore} events={[]} />)

  // the real fold: pull Code Review, then a click on its only partner —
  // no target and no open window, so `onCardClick`'s own fold dispatches at
  // once once it settles (boardStaging.test.tsx's "a release partner
  // dispatches without a target" drives the identical pair through the DOM;
  // this reaches through the hook directly, same as the attack test above).
  // Real timers, not `drive`'s fake ones: the fold's own MERGE_MS animation is
  // `_useBoardStaging.ts`'s concern, not the beat's — `drive` itself exists to
  // keep the two clocks apart. The click is its OWN (synchronous) `act()`,
  // separate from the wait that follows: `onCardClick`'s fold reads its own
  // `[data-main]`/`[data-aux]` markers off a CardPair React only just
  // committed via `commitStaged` — bundling the click into the SAME async
  // `act()` as the wait (as `fireEvent`'s callers never do — every one of
  // them already fires as its own act(), same as this) risks that commit not
  // having landed yet when the fold's own `nextFrames()` goes to read it.
  act(() => {
    api.staging?.onHandPlay('support-code-review#0', { x: 0, y: 0 })
  })
  act(() => {
    api.staging?.onCardClick(0) // handItems, with the support pulled, is just [release-frontend#0]
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700)) // past MERGE_MS (620ms)
  })
  expect(api.staging?.staged?.phase).toBe('dispatched')
  expect(api.handoffRef?.current?.mainUid).toBe('release-frontend#0')
  expect(api.handoffRef?.current?.supportUid).toBe('support-code-review#0')
  // the LOCAL fold above is `_useBoardStaging.ts`'s own `onCardClick` — it
  // plays 'foldIntoPair' too (the same mocked `play`), so the slate has to be
  // wiped here: what the assertion below pins is that the BEAT does not fold
  // a second time, not that the array is empty outright.
  played.names = []

  // the engine answers: the release landed with the same Code Review combo.
  // `useBeats` picks up `releasePlaced` from the new event — same I1 timing
  // as the attack test above.
  await drive(() => rerender(<Harness live={releaseAfter} events={[releasedEvent]} />))

  // adopted, not re-folded: the pair was already standing where the flight
  // to the release slot starts from.
  expect(played.names).toContain('playToReleaseZone')
  expect(played.names).not.toContain('foldIntoPair')
  expect(api.handoffRef?.current).toBeNull()
  expect(api.staging?.staged).toBeNull()
  // lands in the release slot with the zone's own support render — the same
  // node `runRelease` itself measured as `toRect` (`anchors.releaseSlot`)
  const slot = api.anchors?.releaseSlot('p1', 'frontend')
  expect(slot?.querySelector('[data-main]')).toBeTruthy()
  expect(slot?.querySelector('[data-aux]')).toBeTruthy()
})

// ===== Fix A (#101), Defect 1: the actor's own PLAIN release =====
//
// The commonest action in the game, and the case this file (and
// comboBeat.test.tsx) never had: every `releasePlaced` test before these two
// was either a remote player's or a Code Review combo. A plain release is
// nothing like either — it never merges, so it never gets the pair flyer's
// node, and `_Board.tsx`'s `soloStaged` excludes a release on purpose, so
// `handoffRef.el` is null for it even before the catch-up effect clears the
// handoff outright when the cost pending echoes back. Both of those are
// deliberate; what was missing is that the beat then fell through to `foldIn`,
// which measures `you.hand` — where the release still IS — against a fan that
// no longer renders it.
//
// The hand below puts the release LAST on purpose: that is the shape where the
// old fallback produced no flight at all rather than a wrong one
// (`handSlotAt(1)` past the end of a one-slot fan → null → `seatBox('p1')`,
// which is never bound for the local player → `foldIn` returns null).
const soloReleaseBefore: BoardState = {
  you: {
    name: 'You',
    hand: [
      { uid: 'attack-bug#0', card: card('attack-bug') },
      { uid: 'release-frontend#0', card: card('release-frontend') },
    ],
    release: {},
  },
  opponents: [{ id: 'p2', name: 'Two', handCount: 3, release: {} }],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
  turn: 'p1' as PlayerId,
  hasDrawn: true,
  selfId: 'p1',
  history: [],
  setup: {},
  playable: ['release-frontend#0'],
  frozen: [],
  targets: {},
  comboOptions: {},
} as unknown as BoardState

// The engine's answer to the play: it emits NOTHING and holds a pending
// instead, so the release is still in the hand and only the pending moved.
const soloReleasePending: BoardState = {
  ...soloReleaseBefore,
  playable: [],
  pending: {
    kind: 'discardForRelease',
    player: 'p1',
    release: 'release-frontend#0',
    options: ['attack-bug#0'],
  },
} as unknown as BoardState

const soloReleaseAfter: BoardState = {
  ...soloReleaseBefore,
  you: {
    ...soloReleaseBefore.you,
    hand: [],
    release: { frontend: card('release-frontend') },
  },
  playable: [],
  pending: undefined,
} as unknown as BoardState

const soloReleasedEvent: Event = {
  id: 2,
  type: 'released',
  player: 'p1',
  slot: 'frontend',
  card: 'release-frontend',
}

// Pulls the release out of the fan for real and walks the projection up to the
// moment the cost pending is standing, exactly as a round trip would.
async function standTheRelease(rerender: (ui: React.ReactElement) => void) {
  act(() => {
    api.staging?.onHandPlay('release-frontend#0', { x: 0, y: 0 })
  })
  // `onHandPlay`'s own async tail (no `drop.rect` here, so no flight — it goes
  // straight to `setStageLanded(true)`)
  await act(async () => {
    await Promise.resolve()
  })
  rerender(<Harness live={soloReleasePending} events={[]} />)
}

it('flies the actor’s own plain release out of the stage slot, not out of the fan', async () => {
  played.names = []
  const { rerender } = render(<Harness live={soloReleaseBefore} events={[]} />)
  await standTheRelease(rerender)
  // standing, and out of the fan — the two facts the old fallback tripped over
  expect(screen.getByTestId('stage-slot').querySelector('[data-card]')).toBeTruthy()
  expect(document.querySelectorAll('[data-hand-slot]')).toHaveLength(1)
  played.names = []

  // the engine answers: the cost is paid and the release lands. `costBefore`
  // (planBeats.ts) reads the `discarded(releaseCost)` immediately ahead of
  // `released` as this release's own cost.
  const costDiscardEvent: Event = {
    id: 1,
    type: 'discarded',
    player: 'p1',
    card: 'attack-bug',
    reason: 'releaseCost',
  } as Event
  await drive(
    () =>
      rerender(<Harness live={soloReleaseAfter} events={[costDiscardEvent, soloReleasedEvent]} />),
    // past the cost leg's own `wait(SHOW_HOLD)` (1.2s under these fake timers)
    90,
  )

  // it flew, once, and it never folded in from a hand slot
  expect(played.names).toContain('playToReleaseZone')
  expect(played.names).not.toContain('foldIntoPair')
  expect(played.names.filter((n) => n === 'playToReleaseZone')).toHaveLength(1)
  // and it landed where the projection puts it
  const slot = api.anchors?.releaseSlot('p1', 'frontend')
  expect(slot?.querySelector('[data-card="release-frontend"]')).toBeTruthy()

  // the placement guard is a per-release cycle, not a one-way latch: the NEXT
  // release pulled this match has to stand at the stage slot the same as the
  // first one did. `_useBoardStaging.ts` re-arms it on the pull — the stage
  // machine goes back to `flying`, beside `paidCost`'s own clear — so drop that
  // line and this goes red while every assertion above stays green.
  rerender(
    <Harness
      live={
        {
          ...soloReleaseAfter,
          you: {
            ...soloReleaseAfter.you,
            hand: [{ uid: 'release-backend#0', card: card('release-backend') }],
          },
          playable: ['release-backend#0'],
        } as unknown as BoardState
      }
      events={[costDiscardEvent, soloReleasedEvent]}
    />,
  )
  act(() => {
    api.staging?.onHandPlay('release-backend#0', { x: 0, y: 0 })
  })
  await act(async () => {
    await Promise.resolve()
  })
  expect(screen.getByTestId('stage-slot').querySelector('[data-card]')).toBeTruthy()
})

// The other half of Defect 1: while that flight is in the air the static
// stage-slot render must be GONE. The shadow the beat renders still carries
// the `discardForRelease` pending (that is what `base` is), so `costPending`
// and `stagedReleaseLocal` are both exactly as they were — nothing but the
// stage machine leaving `standing` can empty the slot, which makes this a clean
// discriminator.
//
// The flight is held open on purpose (the same `animate` stub
// boardRelease.test.tsx uses): jsdom resolves `.finished` on the next
// microtask, so there is no other way to observe "mid-flight". The cost is
// left off this one so the hold lands on the release's own flight rather than
// on the cost's discard exit — the cost leg is already pinned by the test
// above and by comboBeat.test.tsx.
it('does not leave the release standing at the stage slot while it is being flown to the zone', async () => {
  played.names = []
  const { rerender } = render(<Harness live={soloReleaseBefore} events={[]} />)
  await standTheRelease(rerender)
  const stage = screen.getByTestId('stage-slot')
  expect(stage.querySelector('[data-card]')).toBeTruthy()

  const animateSpy = vi.spyOn(Element.prototype, 'animate').mockImplementation(
    () =>
      ({
        cancel: () => {},
        finished: new Promise<void>(() => {}), // never settles — the flight stays in the air
      }) as unknown as Animation,
  )
  try {
    await drive(() => rerender(<Harness live={soloReleaseAfter} events={[soloReleasedEvent]} />))

    // the carrier is up, holding the release…
    expect(document.querySelector('[class*="flyer"] [data-card="release-frontend"]')).toBeTruthy()
    // …and the stage slot it left is empty, so the card is not on screen twice
    expect(stage.querySelector('[data-card]')).toBeNull()
  } finally {
    // in a `finally`, not after the assertions: a failing expectation throws,
    // and a stub of `animate` that outlived this test would silently park
    // every fold in the file behind it
    animateSpy.mockRestore()
  }
})

// Fix round 1 (post-review, corrected): the same paired-release adoption as
// above, but this release ALSO carries a cost — the rules charge one
// regardless of the Code Review combo, and `planBeats.ts`'s `costBefore`
// treats `cost`/`codeReview` as independent optional fields, so this
// combination is real. This is the test the review asked for, and the ONLY
// one in the suite that can actually pin `runRelease`'s ordering requirement
// (the header comment on `runRelease` in comboBeat.tsx): `comboBeat.test.tsx`'s
// own harness hands the beat a STATIC `staging` ref that nothing ever mutates
// mid-test, so moving the cost leg there — before or after the synchronous
// `handoff` capture — changes nothing observable. The real race is between
// `_useBoardStaging.ts`'s own passive effect (which clears `staged` once the
// release card leaves `you.hand`, the SAME mechanism `runAttack`'s header
// comment describes) and `useBeats`'s layout-effect-driven `drain()`, and only
// THIS harness wires both hooks for real — the fold above is the actor's OWN
// staged pair, standing at the centre exactly where a REAL `_useBoardStaging`
// would leave it.
it('adopts the actor’s own staged release pair into the zone even when its release also carries a cost', async () => {
  played.names = []
  const { rerender } = render(<Harness live={releaseBefore} events={[]} />)

  // the real fold — identical to the no-cost test above
  act(() => {
    api.staging?.onHandPlay('support-code-review#0', { x: 0, y: 0 })
  })
  act(() => {
    api.staging?.onCardClick(0)
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700)) // past MERGE_MS (620ms)
  })
  expect(api.staging?.staged?.phase).toBe('dispatched')
  expect(api.handoffRef?.current?.mainUid).toBe('release-frontend#0')
  played.names = []

  // the engine answers with BOTH halves of the reduction `costBefore` expects:
  // the cost's own `discarded(releaseCost)` immediately before `released`
  // (fake/release.ts's `placeRelease`, per planBeats.ts's own comment).
  const costDiscardEvent: Event = {
    id: 1,
    type: 'discarded',
    player: 'p1',
    card: 'attack-bug',
    reason: 'releaseCost',
  } as Event
  const releasedEventWithCost: Event = {
    id: 2,
    type: 'released',
    player: 'p1',
    slot: 'frontend',
    card: 'release-frontend',
    codeReview: 'support-code-review',
  }
  await drive(
    () =>
      rerender(<Harness live={releaseAfter} events={[costDiscardEvent, releasedEventWithCost]} />),
    // past the cost leg's own `wait(SHOW_HOLD)` (1.2s, a real `setTimeout`
    // under these fake timers) — the other tests' 600ms budget is not enough.
    90,
  )

  // the fast path still engages: adopted, not re-folded
  expect(played.names).toContain('playToReleaseZone')
  expect(played.names).not.toContain('foldIntoPair')
  expect(api.handoffRef?.current).toBeNull()
  expect(api.staging?.staged).toBeNull()
  // the cost still hands off to the discard exit — `'clearPaidCost'` is the
  // Harness's own marker for that hand-off (see its comment: `play`'s mock
  // cannot observe `useDiscardExit`'s internal `centerToDiscard` call at all,
  // sibling-import bypass)…
  expect(played.names).toContain('clearPaidCost')
  // …and still before the release lands
  expect(played.names.indexOf('clearPaidCost')).toBeLessThan(
    played.names.indexOf('playToReleaseZone'),
  )
})

// ===== MISSING FIXTURE 3 (#101, Fix C, finding 4) — ONE SYNC FLUSH =====
//
// `planBeats.test.ts` pins that the PLAN is built when the throw and its
// answer arrive together. This pins that the board actually plays it, through
// the real queue: two chained beats, the shadow each one hands the next, and
// the render in between.
//
// It is the spectator's view, and in a star topology that is most of the
// table: every peer who is neither attacker nor defender receives both events
// in one relayed batch. Before this round the `covered` plan was never built
// for them at all — the exchange's cards simply appeared in the discard — and
// once it was, the attack still blinked out the instant its fold landed,
// leaving the cover to be held over an empty slot for SHOW_HOLD.
const watchingBefore: BoardState = {
  you: { name: 'You', hand: [], release: {} },
  opponents: [
    { id: 'p2', name: 'Two', handCount: 3, release: {} },
    { id: 'p3', name: 'Three', handCount: 3, release: {} },
  ],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
  turn: 'p2' as PlayerId,
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
} as unknown as BoardState

const oneFlush: Event[] = [
  { id: 20, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'p3' },
  { id: 21, type: 'defended', player: 'p3', card: 'defense-hotfix', effect: 'cancel' } as Event,
  { id: 22, type: 'discarded', player: 'p2', card: 'attack-bug', reason: 'attackSpent' } as Event,
  {
    id: 23,
    type: 'discarded',
    player: 'p3',
    card: 'defense-hotfix',
    reason: 'defenceSpent',
  } as Event,
]

const watchingAfter: BoardState = {
  ...watchingBefore,
  decks: {
    ...watchingBefore.decks,
    discardHeap: [
      { uid: 'h22', card: card('attack-bug'), rot: 4, dx: 2, dy: -3 },
      { uid: 'h23', card: card('defense-hotfix'), rot: -6, dx: -1, dy: 5 },
    ],
    discardCount: 2,
  },
} as unknown as BoardState

it('plays the whole exchange for a watching peer that gets both events at once', async () => {
  played.names = []
  played.calls = []
  const { rerender } = render(<Harness live={watchingBefore} events={[]} />)
  expect(screen.queryByTestId('pending')).toBeNull()

  await drive(() => rerender(<Harness live={watchingAfter} events={oneFlush} />), 120)

  // the attack folded in, and the defence flew over it — two movements, not
  // one, and the second is the one that used to be missing entirely
  expect(played.names).toContain('foldIntoPair')
  expect(played.names).toContain('playToCenter')
  // and the defence really TRAVELLED: out of the defender's own seat, which is
  // `cardBoxIn` of the stubbed rect above (centre 475/305, a CARD_W box), not a
  // zero-distance raise at the cover slot it lands on
  const cover = played.calls.find((c) => c.name === 'playToCenter')
  expect(cover?.params.from).toMatchObject({ left: 475 - CARD_W / 2 })
  expect(cover?.params.from).not.toEqual(cover?.params.to)
  // the fold happened first: the cover covers something that is already there
  expect(played.names.indexOf('foldIntoPair')).toBeLessThan(played.names.indexOf('playToCenter'))
  // and the exchange reached the heap, in the order it lay on the table
  const heap = screen.getByTestId('discard-heap').querySelectorAll('[data-card]')
  expect(Array.from(heap).map((el) => el.getAttribute('data-card'))).toEqual([
    'attack-bug',
    'defense-hotfix',
  ])
})

// The attack has to be ON SCREEN while the cover is held over it. `runAttack`
// drops its carrier the moment the fold lands, on the understanding that the
// centre's static pending render takes the card over in the same commit — and
// in a one-flush batch there is no such render unless the beat publishes one,
// because `base` predates the batch. Observed mid-beat, since that is the
// whole span in question.
it('keeps the attack standing at the centre while the cover is held over it', async () => {
  played.names = []
  const { rerender } = render(<Harness live={watchingBefore} events={[]} />)
  // far enough in for the fold to have landed and the cover's own hold to be
  // running (SHOW_HOLD is 1.2s), nowhere near the exit
  await drive(() => rerender(<Harness live={watchingAfter} events={oneFlush} />), 45)
  expect(screen.queryByTestId('pending')).toBeTruthy()
})

// ===== Fix D round 4 — the same seam, on the DEFENCE side =====
//
// The harness above is the turn side's. This is its twin, and it exists because
// the defect the user hit on their first real two-peer game lived in the one
// commit no fixture in this repo built: the batch effect firing while
// `beats.shadow` is still null, WITH a defence staged and its own carrier still
// in the air.
//
// Why that combination is the ordinary case, not an edge: `commitAndFly`
// dispatches the RESOLVE synchronously and only then starts the fan→cover
// flight. The engine's answer comes back inside that flight — always for a host
// (its engine is local), and for a client on any round trip shorter than one
// flight. On that commit `state === live`: no pending, so `answering` is false,
// the static cover child is not mounted, `coverStagedRef` is null, and the
// passive catch-up clears `staged`. Two artifacts followed, and the player saw
// both at once: the beat flew the card in a SECOND time from the fan slot it had
// already left, and the card itself popped back into the fan for the whole beat.
//
// Same construction rules as the harness above: real `useBeats`, real
// `useDefenseStaging`, real `useDefenseBeat` underneath, wired in `_Board.tsx`'s
// own hook ORDER — `useBeats` first, so its layout effect plans and drains
// before the handoff effect below ever runs. That order is the race.
const dapi: {
  defense?: ReturnType<typeof useDefenseStaging>
  handoffRef?: { current: StagedHandoff | null }
} = {}

const SLOT_RECT = { left: 40, top: 300, width: 150, height: 210 }
const COVER_RECT = { left: 500, top: 100, width: 150, height: 210 }
const stubRect = (el: HTMLElement | null, r: typeof SLOT_RECT) => {
  if (el) el.getBoundingClientRect = () => r as unknown as DOMRect
}

function DefenceHarness({ live, events }: { live: BoardState; events: Event[] }) {
  const anchors = useBoardAnchors()
  const handoffRef = useRef<StagedHandoff | null>(null)
  const coverStagedRef = useRef<HTMLDivElement>(null)
  dapi.handoffRef = handoffRef
  const clearPaidCostRef = useRef<(() => void) | null>(null)
  const takeStagedReleaseRef = useRef<(() => void) | null>(null)
  const beats = useBeats({
    live,
    events,
    anchors,
    enabled: true,
    staging: handoffRef,
    clearPaidCost: clearPaidCostRef,
    takeStagedRelease: takeStagedReleaseRef,
  })
  const state = beats.shadow ?? live
  const answering = state.pending?.kind === 'defend' && state.pending.player === state.selfId
  const defenseStaging = useDefenseStaging({ state, anchors, actions: {}, events, enabled: true })
  dapi.defense = defenseStaging

  // `_Board.tsx`'s own `stagedCover` gate, verbatim: the static cover render
  // only exists once this hook's carrier has let go of the card.
  const stagedCover =
    answering && defenseStaging.landed && defenseStaging.overlay.length === 0
      ? defenseStaging.staged?.main
      : undefined

  // `_Board.tsx`'s handoff effect, same body and — critically — declared AFTER
  // `useBeats` above, exactly as the board declares it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: landed/overlay gate a ref read, mirroring _Board.tsx
  useLayoutEffect(() => {
    const ds = defenseStaging.staged
    handoffRef.current =
      ds?.phase === 'dispatched' && ds.main
        ? {
            mainUid: ds.main.uid,
            supportUid: ds.support?.uid,
            el: coverStagedRef.current,
            release: defenseStaging.release,
          }
        : null
  }, [
    defenseStaging.staged,
    defenseStaging.release,
    defenseStaging.landed,
    defenseStaging.overlay.length,
  ])

  return (
    <div>
      <div ref={anchors.hand}>
        {defenseStaging.handItems.map((slot) => (
          <div key={slot.uid} data-hand-slot ref={(el) => stubRect(el, SLOT_RECT)}>
            <Card card={slot.card} interactive={false} width="100%" />
          </div>
        ))}
      </div>
      <div data-testid="cover-slot" ref={anchors.cover}>
        {stagedCover && (
          <div ref={coverStagedRef} data-testid="cover-staged">
            <Card card={stagedCover.card} interactive={false} width="100%" />
          </div>
        )}
      </div>
      <div ref={anchors.centre} />
      <div ref={anchors.discardBox} />
      {defenseStaging.overlay}
      {beats.overlays}
    </div>
  )
}

const defBefore: BoardState = {
  // TWO cards, and that is load-bearing: with only the defence in hand the fan
  // is empty once it is staged, `handSlotAt` finds nothing to measure, and the
  // beat falls through to the cover box by accident rather than by design. A
  // real defender almost always holds something else, and then the stale index
  // resolves to a NEIGHBOUR's slot — a card flying in from a slot that never
  // held it.
  you: {
    name: 'You',
    hand: [
      { uid: 'defense-hotfix#0', card: card('defense-hotfix') },
      { uid: 'attack-bug#0', card: card('attack-bug') },
    ],
    release: {},
  },
  opponents: [{ id: 'p2', name: 'Two', handCount: 3, release: {} }],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
  turn: 'p2',
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
  pending: {
    kind: 'defend',
    player: 'p1',
    attacker: 'p2',
    attackCard: 'attack-bug',
    sudo: false,
    options: ['defense-hotfix#0'],
    openedAt: 0,
    deadline: 30_000,
    scope: 'hand',
  },
} as unknown as BoardState

// the projection the engine's answer produces: the pending is gone and the card
// has left the hand — which is precisely what the catch-up reads as "done"
const defAfter: BoardState = {
  ...defBefore,
  you: { ...defBefore.you, hand: [{ uid: 'attack-bug#0', card: card('attack-bug') }] },
  pending: null,
  decks: {
    ...defBefore.decks,
    discardHeap: [
      { uid: 'h31', card: card('attack-bug'), rot: 4, dx: 2, dy: -3 },
      { uid: 'h32', card: card('defense-hotfix'), rot: -6, dx: -1, dy: 5 },
    ],
    discardCount: 2,
  },
} as unknown as BoardState

const defFlush: Event[] = [
  { id: 30, type: 'defended', player: 'p1', card: 'defense-hotfix', effect: 'cancel' } as Event,
  { id: 31, type: 'discarded', player: 'p2', card: 'attack-bug', reason: 'attackSpent' } as Event,
  {
    id: 32,
    type: 'discarded',
    player: 'p1',
    card: 'defense-hotfix',
    reason: 'defenceSpent',
  } as Event,
]

// The gesture's own flight is held open on purpose: `landed === false` with the
// carrier still up IS the production state this is about, and jsdom's WAAPI stub
// resolves `.finished` on the next microtask, so without this the flight would
// always have landed before the events arrived and the bug would be unreachable.
function holdFlightsOpen() {
  return vi
    .spyOn(Element.prototype, 'animate')
    .mockImplementation(
      () => ({ cancel: () => {}, finished: new Promise<void>(() => {}) }) as unknown as Animation,
    )
}

it('does not replay our own defence, or hand it back to the fan, when the answer lands mid-flight', async () => {
  const animateSpy = holdFlightsOpen()
  try {
    played.names = []
    played.calls = []
    const { rerender } = render(<DefenceHarness live={defBefore} events={[]} />)
    // jsdom measures every unstyled node as all zeros, and the whole question
    // here is WHICH box a flight starts from — the cover slot or a fan slot —
    // so the two have to be distinguishable. Stubbed once: the slot div lives
    // for the life of the harness.
    stubRect(screen.getByTestId('cover-slot'), COVER_RECT)

    // pull the defence out of the fan — the real gesture, dispatched at once.
    // `drive` (not a bare `act`) because `flyer.raise` mounts its overlay
    // through a state update and then awaits `nextFrames()`: inside a single
    // async `act` scope React defers that commit until the scope settles, so
    // `raise` would hand back an unmounted node and the flight would be skipped
    // — the very state this fixture must NOT be in.
    await drive(() => {
      dapi.defense?.onHandPlay('defense-hotfix#0', { x: 0, y: 0, rect: SLOT_RECT as DOMRect })
    }, 20)
    // the gesture's own flight is up and has NOT landed — the production state
    // this whole fixture exists to construct
    expect(played.calls.filter((c) => c.name === 'playToCenter')).toHaveLength(1)
    expect(dapi.defense?.landed).toBe(false)
    expect(dapi.handoffRef?.current).not.toBeNull()
    expect(dapi.handoffRef?.current?.el ?? null).toBeNull()
    const beforeBeat = played.calls.length

    // the engine answers INSIDE that flight — `beats.shadow` is still null on
    // this commit, so the batch effect plans and drains against `live`
    await drive(() => rerender(<DefenceHarness live={defAfter} events={defFlush} />), 55)

    // 1. the beat raised NOTHING for the cover. Our own defence is the
    // gesture's to deliver — its carrier is mid-flight to that very slot — so a
    // beat that raises anything there is raising a second copy of a card that is
    // already on its way. Pre-fix it raised one; where that copy came FROM (the
    // fan slot on a real board, this harness's cover box) is the difference the
    // player saw, but the copy itself is the defect, and its absence is what
    // this pins. The from-the-fan-slot half is pinned at unit level, where
    // `handSlotAt` can be stubbed to a real rect
    // (`defenseBeat.test.tsx`'s own rejoin test).
    const beatFlights = played.calls.slice(beforeBeat).filter((c) => c.name === 'playToCenter')
    expect(beatFlights).toHaveLength(0)

    // 2. the card did not pop back into the fan — the gesture still owns it,
    // and the fan holds only the card that was never played
    expect(dapi.defense?.staged?.main?.uid).toBe('defense-hotfix#0')
    expect(dapi.defense?.handItems.map((i) => i.uid)).toEqual(['attack-bug#0'])
    expect(
      Array.from(document.querySelectorAll('[data-hand-slot] [data-card]')).map((el) =>
        el.getAttribute('data-card'),
      ),
    ).toEqual(['attack-bug'])
  } finally {
    animateSpy.mockRestore()
  }
})

// REPRODUCTION (user report): playing a card flies it to the table but leaves a
// copy in the fan. The window nothing covered is AFTER `handoff.release()`:
// the beat clears the gesture's staging so the static cover render can hand
// over, but the board is still rendering the beat's SHADOW — `base`, the
// projection from before the batch, whose `you.hand` still holds the card that
// was played. With `staged` null there is nothing left filtering it out, so it
// reappears in the fan for the length of the exit.
//
// The existing mid-flight test above stops before the beat ever reaches
// `release()`, which is why the suite was green while the board was not.
it('never shows the played defence back in the fan, at any point in the beat', async () => {
  const animateSpy = holdFlightsOpen()
  try {
    played.names = []
    played.calls = []
    const { rerender } = render(<DefenceHarness live={defBefore} events={[]} />)
    stubRect(screen.getByTestId('cover-slot'), COVER_RECT)

    const fan = () =>
      Array.from(document.querySelectorAll('[data-hand-slot] [data-card]')).map((el) =>
        el.getAttribute('data-card'),
      )

    await drive(() => {
      dapi.defense?.onHandPlay('defense-hotfix#0', { x: 0, y: 0, rect: SLOT_RECT as DOMRect })
    }, 20)
    expect(fan()).toEqual(['attack-bug'])

    // the engine answers and the beat plays the whole exchange through
    const seen: (string | null)[][] = []
    vi.useFakeTimers()
    try {
      rerender(<DefenceHarness live={defAfter} events={defFlush} />)
      for (let i = 0; i < 120; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20)
        })
        seen.push(fan())
      }
    } finally {
      vi.useRealTimers()
    }

    // The card was played. It must not be in the fan on ANY frame of the beat.
    const framesShowingIt = seen.filter((f) => f.includes('defense-hotfix')).length
    const sample = (seen.find((f) => f.includes('defense-hotfix')) ?? []).join(',')
    expect({ framesShowingIt, sample }).toEqual({ framesShowingIt: 0, sample: '' })
  } finally {
    animateSpy.mockRestore()
  }
})

// The same defect on the TURN side: a release the player shipped reappearing in
// the fan while the beat flies it to the zone. Same cause as the defence case
// above — `handoff.release()` clearing the staging that filters the fan, while
// the board still renders the beat's pre-batch shadow.
it('never shows the played release back in the fan, at any point in the beat', async () => {
  played.names = []
  const { rerender } = render(<Harness live={soloReleaseBefore} events={[]} />)
  await standTheRelease(rerender)
  const fanCount = () => document.querySelectorAll('[data-hand-slot]').length
  expect(fanCount()).toBe(1)

  const costDiscardEvent: Event = {
    id: 1,
    type: 'discarded',
    player: 'p1',
    card: 'attack-bug',
    reason: 'releaseCost',
  } as Event

  const seen: number[] = []
  vi.useFakeTimers()
  try {
    rerender(<Harness live={soloReleaseAfter} events={[costDiscardEvent, soloReleasedEvent]} />)
    for (let i = 0; i < 120; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20)
      })
      seen.push(fanCount())
    }
  } finally {
    vi.useRealTimers()
  }

  // The release left the hand when it was staged. Nothing in this beat may put
  // a card back into the fan, so the count must never climb above where the
  // gesture left it.
  expect({ maxFan: Math.max(...seen), frames: seen.filter((n) => n > 1).length }).toEqual({
    maxFan: 1,
    frames: 0,
  })
})
