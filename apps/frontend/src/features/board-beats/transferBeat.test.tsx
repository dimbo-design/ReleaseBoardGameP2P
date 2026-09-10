import { act, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { BoardAnchors, BoardState } from '~/entities/game/board'
import type { BeatPlan } from './planBeats'
import { useTransferBeat } from './transferBeat'

const played = vi.hoisted(() => ({
  names: [] as string[],
  shakes: [] as unknown[],
  takes: [] as unknown[],
}))
const arrivals = vi.hoisted(() => ({ handLengths: [] as number[], calls: 0 }))

vi.mock('@release/ui/animations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@release/ui/animations')>()
  return {
    ...real,
    play: (name: string, _el: unknown, params?: unknown) => {
      played.names.push(name)
      if (name === 'shake') played.shakes.push(params)
      if (name === 'takeFromSeat') played.takes.push(params)
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
// Centre node with a real bounding rect for geometry tests
const centreNode = document.createElement('div')
centreNode.getBoundingClientRect = () => ({
  left: 400,
  top: 300,
  width: 200,
  height: 280,
  right: 600,
  bottom: 580,
  x: 400,
  y: 300,
  toJSON: () => ({}),
})
const anchors = {
  hand: { current: node() },
  centre: { current: centreNode },
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

const transferPlan = (
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

function runTransfer(plan: Extract<BeatPlan, { kind: 'handTransfer' }>, on: BoardState = base) {
  const published: BoardState[] = []
  const domSnapshots: string[] = []
  let start: (() => Promise<void>) | null = null
  function Probe() {
    const beat = useTransferBeat(anchors)
    start = () => beat.runTransfer(plan, { base: on, publish: (s) => published.push(s) })
    return <>{beat.overlay}</>
  }
  const view = render(<Probe />)
  return {
    published,
    view,
    domSnapshots,
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
          // Capture the DOM state after each animation frame
          domSnapshots.push(view.container.innerHTML)
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
  played.takes = []
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

it('clears the giveCard pending once the taken card is in the air, not just at the end', async () => {
  // `_Board.tsx` stands the named card at the centre for as long as
  // `state.pending?.kind === 'giveCard'` — the carrier that spans the batch
  // gap between `requested` and `handTransfer`. Once THIS leg's own flyer
  // has the card, that static render is a duplicate standing underneath it
  // for the rest of the beat unless the leg clears the pending it inherited.
  const on = {
    ...base,
    pending: { kind: 'giveCard', player: 'p1', requested: 'attack-bug' },
  } as BoardState
  const r = runTransfer(transferPlan(), on)
  await r.go()
  expect(r.published.some((s) => s.pending === null)).toBe(true)
  // and it stays cleared — nothing later in the leg should resurrect it
  expect(r.published.at(-1)?.pending).toBeNull()
})

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

it('clears the giveCard pending once the lost card leaves the fan, not just at the end', async () => {
  // Same invariant as the taker leg's own test, mirrored: this leg's flyer
  // takes the card out of `you.hand`, so the `giveCard` pending it inherited
  // must not survive to keep `_Board.tsx`'s static centre render doubling it.
  const on = {
    ...base,
    pending: { kind: 'giveCard', player: 'p1', requested: 'attack-bug' },
  } as BoardState
  const r = runTransfer(transferPlan({ from: 'p1', to: 'p2', role: 'victim' }), on)
  await r.go()
  expect(r.published.some((s) => s.pending === null)).toBe(true)
  expect(r.published.at(-1)?.pending).toBeNull()
})

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
  // Check every snapshot captured during the flight
  for (const snapshot of r.domSnapshots) {
    expect(snapshot).not.toContain('attack-bug')
  }
})

const requestPlan = (
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

it('clears the requestCard pending once the flyer is up on a miss, not just at the end', async () => {
  // `_useRequestStaging`'s `asking` (and its `CardCatalog` band) stays
  // mounted for as long as `pending.kind === 'requestCard'` is the asker's
  // own. A miss never hands that pending to a `giveCard` — nothing in the
  // projection survives it — so the leg has to clear it itself once its own
  // centre flyer takes over, or the band lingers underneath that flyer for
  // the whole hold, shake and note.
  const on = {
    ...base,
    pending: { kind: 'requestCard', player: 'p1', target: 'p2' },
  } as BoardState
  const r = runRequested(requestPlan({ hit: false }), on)
  await r.go()
  expect(r.published.length).toBeGreaterThan(0)
  expect(r.published.at(-1)?.pending).toBeNull()
})

it('flinches your own fan when the miss is aimed at you', async () => {
  // To everyone else the target is a Seat; to the target there is no seat at
  // all — they are `you`, and what they own is the fan. Same gesture, rendered
  // as the target actually appears.
  //
  // Spying on the real `anchors.seatOf` rather than an unwired mock: the claim
  // is that the code never calls the seat lookup for its own outcome, and only
  // a spy on the lookup the code actually calls can prove that.
  const spy = vi.spyOn(anchors, 'seatOf')
  try {
    const own = { ...base, selfId: 'p2' } as BoardState
    const r = runRequested(requestPlan({ hit: false, target: 'p2' }), own)
    await r.go()
    expect(played.names).toContain('shake')
    expect(spy).not.toHaveBeenCalled()
  } finally {
    spy.mockRestore()
  }
})

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

it('centres a single offered back on the table centre', async () => {
  // A single card in hand triggers the offer. The offered back must be
  // centred at the table centre, not offset left by -OFFER_SPREAD*width/2.
  // The bug: span was non-zero even when n=1, causing an offset.
  const r = runTransfer(transferPlan({ named: false, donorHand: 1 }))
  await r.go()
  // 1 offered back + 1 taken card's own flight = 2 takeFromSeat calls
  const takes = played.names.filter((n) => n === 'takeFromSeat').length
  expect(takes).toBe(2)
  // The offered back is the first takeFromSeat call; its destination pose is
  // in played.takes[0].to. Animation primitives translate by centres, so assert
  // the pose's centre equals the table centre's centre.
  const offeredBackPose = (played.takes[0] as { to: { left: number; width: number } }).to
  const offeredCentre = offeredBackPose.left + offeredBackPose.width / 2
  // Centre is at left=400, width=200, so its centre is 400+100=500
  const tableCentre = 400 + 200 / 2
  expect(offeredCentre).toBe(tableCentre)
  expect(arrivals.calls).toBe(1)
})

it('caps the offer at OFFER_MAX even when the donor holds more', async () => {
  const r = runTransfer(transferPlan({ named: false, donorHand: 20 }))
  await r.go()
  // 9 offered backs (OFFER_MAX) + 1 taken card's own flight
  const takes = played.names.filter((n) => n === 'takeFromSeat').length
  expect(takes).toBe(10)
  expect(arrivals.calls).toBe(1)
})
