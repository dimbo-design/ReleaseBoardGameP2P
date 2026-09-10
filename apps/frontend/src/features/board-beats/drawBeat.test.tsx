import type { Leaving } from '@release/ui/animations'
import { scatterAt } from '@release/ui/animations'
import { act, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { BoardAnchors, BoardState } from '~/entities/game/board'
import { useDrawBeat } from './drawBeat'
import type { PlannedDraw } from './planBeats'

const played = vi.hoisted(() => ({ names: [] as string[] }))
// What each real `arrive()` call was aimed at — the `handLength` argument.
// I8's whole claim is that the SECOND card of a batch aims at the fan the
// FIRST card actually grew to, not the length the batch started with; the
// resulting hand's LENGTH can't tell the two apart (splice always inserts one
// item regardless of `gap`), so the test needs this sequence, not the count.
const arrivals = vi.hoisted(() => ({
  handLengths: [] as number[],
  ats: [] as (number | undefined)[],
}))
// What the discard exit step actually received — not just that it was called.
const exits = vi.hoisted(() => ({ items: [] as Leaving[] }))
// The ORDER of two calls that both leave no trace of it in `published`/`exits`
// alone: the shadow publish (this beat's `c.publish(next)`) and the carrier's
// release (`drop('draw')`). Both are wrapped below so the standing-trigger
// test can assert the publish happened first — the whole point of I2's
// "publish first, drop second" comment in drawBeat.tsx.
const order = vi.hoisted(() => ({ log: [] as string[] }))
vi.mock('@release/ui/animations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@release/ui/animations')>()
  return {
    ...real,
    play: (name: string) => {
      played.names.push(name)
      return { finished: Promise.resolve() } as unknown as Animation
    },
    // `useDiscardExit` (apps/ui/src/animations/useDiscardExit.tsx) imports
    // `play` from its own sibling module (`./play`), not from this barrel — so
    // the mock above never sees its `centerToDiscard` call; the real function
    // runs underneath it regardless of the mock. `useBeats.test.tsx` hits the
    // same wall for the discard beat and stubs the whole hook instead of the
    // leaf it calls internally; this does the same; `flipCard` (Card's own
    // flip, played from `patch`) has the identical gap and the fourth test's
    // own comment already says as much — this closes the one case that IS
    // asserted on. `send`'s items are captured (not just counted) so the
    // reveal test can pin the card, key and scatter it actually sent.
    useDiscardExit: () => ({
      overlay: [],
      send: (items: Leaving[]) => {
        played.names.push('centerToDiscard')
        exits.items.push(...items)
        return Promise.resolve()
      },
      reset: () => {},
      FLIGHT_MS: 420,
    }),
    // `useFlyer` stays real — `drop` is wrapped only to log WHEN the carrier
    // for 'draw' actually let go, alongside the publish it must follow.
    useFlyer: (...args: Parameters<typeof real.useFlyer>) => {
      const step = real.useFlyer(...args)
      return {
        ...step,
        drop: (key?: string) => {
          if (key === 'draw') order.log.push('drop:draw')
          return step.drop(key)
        },
      }
    },
    // The fan itself stays real — the probe's whole point is measuring it —
    // but `arrive` is wrapped to record the `handLength` it was called with,
    // per call, so the I8 test can assert on the SEQUENCE rather than only
    // the final count.
    useHandArrival: (...args: Parameters<typeof real.useHandArrival>) => {
      const step = real.useHandArrival(...args)
      return {
        ...step,
        arrive: (items: Parameters<typeof step.arrive>[0], handLength: number, at?: number) => {
          arrivals.handLengths.push(handLength)
          // `at` is the SLOT the card lands in, and it is recorded separately
          // because it is a different claim from how big the fan was: the fan
          // can be right while the landing place is wrong, which is exactly the
          // defect the landing test below pins.
          arrivals.ats.push(at)
          return step.arrive(items, handLength, at)
        },
      }
    },
  }
})

const base = {
  you: { name: 'You', hand: [], release: {} },
  opponents: [{ id: 'p2', name: 'Two', handCount: 3, release: {} }],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
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
  handSlotAt: () => null,
  releaseSlot: () => null,
  bindPile: () => {},
  bindSeat: () => {},
  bindReleaseSlot: () => {},
} as unknown as BoardAnchors

const draw = (over: Partial<PlannedDraw> = {}): PlannedDraw => ({
  key: 'w4',
  eventId: 4,
  player: 'p1',
  pile: 0,
  mine: true,
  card: 'attack-bug',
  ...over,
})

function run(draws: PlannedDraw[]) {
  const published: BoardState[] = []
  let start: (() => Promise<void>) | null = null
  function Probe() {
    const beat = useDrawBeat(anchors)
    start = () =>
      beat.run(
        { kind: 'draw', key: 'draw:4', draws },
        {
          base,
          publish: (s) => {
            published.push(s)
            // A pending-carrying publish is the one shadow this beat commits
            // before it drops the carrier — that's the moment the ordering
            // test cares about, not every publish a run makes.
            if (s.pending) order.log.push('publish:pending')
          },
        },
      )
    return <>{beat.overlay}</>
  }
  render(<Probe />)
  return {
    published,
    // `act(async () => await start())` alone never sees the runner's
    // intermediate DOM: React defers every update scheduled while an async
    // act() scope is open (they queue in `ReactSharedInternals.actQueue`) and
    // only flushes them once that scope's own promise settles — so a beat
    // that spans real `wait()` delays would never observe `useFlyer`'s flyer
    // mount mid-run, and `elOf('draw')` would read null the whole way through.
    // Fake timers advanced in small steps, each its own `act()` call (the same
    // shape `boardIntro.test.tsx` uses for the real deal), force a flush after
    // every step, so the runner sees the real DOM as it actually stands.
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

it('takes my own card to the centre, turns it over, and sits it in the fan', async () => {
  played.names = []
  const { published, go } = run([draw()])
  await go()
  expect(played.names).toContain('drawToCenter')
  // The hand it publishes is the fan the NEXT card of the batch must aim at.
  expect(published.at(-1)?.you.hand.map((h) => h.card.id)).toEqual(['attack-bug'])
})

it('sends an opponent’s card to their seat, face down', async () => {
  played.names = []
  const { published, go } = run([draw({ player: 'p2', mine: false, card: undefined })])
  await go()
  expect(played.names).toEqual(['drawToCenter', 'dealToSeat'])
  // Their count goes up; nothing enters this peer's fan, and no identity is
  // invented for a card the projection never named.
  expect(published.at(-1)?.opponents[0].handCount).toBe(4)
})

it('grows the fan between the cards of a multi-draw (I8)', async () => {
  played.names = []
  arrivals.handLengths = []
  const { published, go } = run([draw(), draw({ key: 'w5', eventId: 5, card: 'attack-ddos' })])
  await go()
  expect(published.at(-1)?.you.hand).toHaveLength(2)
  // The load-bearing assertion: the batch has one hand, so both draws feed
  // the SAME `useHandArrival` instance — the second card must aim at the fan
  // the first card actually grew to (1), not the length the batch started
  // with (0 again). A stale read of the run's ORIGINAL base passes [0, 0]
  // here instead — same final count, wrong slot for the second card.
  expect(arrivals.handLengths).toEqual([0, 1])
})

// Where the card LANDS, which is a different claim from how big the fan was.
// `useHandArrival` puts an arrival in the middle of the fan by default, and for
// a playground scene that is right — the scene owns its hand array and can put
// the card wherever it just animated it to. The board cannot: the projection
// owns the hand, and the engine APPENDS a drawn card (fake/reduce.ts:126) in an
// order `toBoardState` passes straight through. So the slot has to be the end,
// or the beat's last frame disagrees with the projection it hands to and the
// card jumps from mid-fan to the end the moment the shadow drops.
it('lands a drawn card at the end of the fan, where the projection puts it', async () => {
  arrivals.handLengths = []
  arrivals.ats = []
  const { published, go } = run([draw(), draw({ key: 'w5', eventId: 5, card: 'attack-ddos' })])
  await go()
  // Each card aims at the slot after everything already in the fan — never the
  // middle, which for the second card here would be slot 0 (round(1/2)).
  expect(arrivals.ats).toEqual([0, 1])
  // And the published hand agrees, in order: the card the beat flew second is
  // the one the fan holds last.
  expect(published.at(-1)?.you.hand.map((h) => h.card.id)).toEqual(['attack-bug', 'attack-ddos'])
})

it('reveals a trigger at the centre and files it in the discard itself', async () => {
  played.names = []
  exits.items = []
  const { go } = run([
    draw({ card: undefined, reveal: { card: 'trigger-error-503', discardId: 6 } }),
  ])
  await go()
  // The reveal ends where the card is filed: it stands at the centre, so it
  // leaves from the centre. flipCard is played by `patch`, not by `play`.
  expect(played.names).toEqual(['drawToCenter', 'centerToDiscard'])
  expect(exits.items).toHaveLength(1)
  expect(exits.items[0].card.id).toBe('trigger-error-503')
  // `discardId` is the trigger's own `discarded` event id — the exit files it
  // under that, not the draw's `eventId`.
  expect(exits.items[0].key).toBe('d6')
  // I7: the flight lands on the SAME scatter the heap will rest it on, so the
  // handover changes nothing on screen.
  expect(exits.items[0].scatter).toEqual(scatterAt(6))
})

it('leaves a standing trigger at the centre and publishes the pending behind it', async () => {
  played.names = []
  exits.items = []
  order.log = []
  const { published, go } = run([draw({ card: undefined, reveal: { card: 'trigger-error-503' } })])
  await go()
  // it did NOT leave for the heap
  expect(exits.items).toEqual([])
  // …and the shadow it published carries the alarm, so the static render is
  // already up when the carrier lets go
  expect(published.at(-1)?.pending).toEqual({
    kind: 'neutralize503',
    player: 'p1',
    card: 'trigger-error-503',
    methods: [],
  })
  // The ordering itself, made observable: the pending-carrying publish must
  // land BEFORE the carrier is dropped. Reversed, a paint can land between
  // the two with the flyer gone and the alarm not yet rendered — a blank
  // centre slot for a frame, the exact defect this beat exists to prevent.
  expect(order.log).toEqual(['publish:pending', 'drop:draw'])
})
