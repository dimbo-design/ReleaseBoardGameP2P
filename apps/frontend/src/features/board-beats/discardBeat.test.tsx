import { cardById } from '@release/ui'
import type { Leaving, Rect } from '@release/ui/animations'
import { scatterAt } from '@release/ui/animations'
import { act, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { BeatRun, BoardAnchors, BoardState } from '~/entities/game/board'
import { useDiscardBeat } from './discardBeat'
import type { BeatPlan } from './planBeats'

// Same idiom `defenseBeat.test.tsx` already uses: `useFlyer` stays real
// (pass-through), with its `glide` calls recorded so a test can tell "the
// swept cards were drawn together first" from "they went straight out" —
// `glide` is `useFlyer`'s real move method (`apps/ui/src/animations/useFlyer.tsx`),
// not the sketch's made-up name. `useDiscardExit` is stubbed the same way
// `drawBeat.test.tsx`/`comboBeat.test.tsx`/`defenseBeat.test.tsx` all stub it:
// its own `send` calls `play` through a sibling import the barrel mock never
// sees, so the leaf itself is replaced instead.
const played = vi.hoisted(() => ({
  calls: [] as { name: string; params: Record<string, unknown> }[],
}))
const exits = vi.hoisted(() => ({ items: [] as Leaving[] }))
vi.mock('@release/ui/animations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@release/ui/animations')>()
  return {
    ...real,
    useFlyer: (...args: Parameters<typeof real.useFlyer>) => {
      const flyer = real.useFlyer(...args)
      return {
        ...flyer,
        glide: (key: string, rect: Rect, ms: number) => {
          played.calls.push({ name: 'glide', params: { key, rect, ms } })
          return flyer.glide(key, rect, ms)
        },
      }
    },
    useDiscardExit: () => ({
      overlay: [],
      send: (items: Leaving[]) => {
        exits.items.push(...items)
        return Promise.resolve()
      },
      reset: () => {},
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

const ctx: BeatRun = { base, publish: () => {} }

// `defenseBeat.test.tsx`'s own pattern: a runner that spans real
// `nextFrames()`/`wait()` delays needs its intermediate DOM observed step by
// step, because React defers every update queued inside one async `act()`
// scope until that scope's own promise settles.
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

function harness() {
  const anchors = {
    centre: { current: node() },
    hand: { current: node() },
    discardBox: { current: node() },
    handSlotAt: () => node(),
    releaseSlot: () => node(),
    seatBox: () => ({ left: 0, top: 0, width: 150, height: 210 }),
  } as unknown as BoardAnchors
  const api: { beat?: ReturnType<typeof useDiscardBeat> } = {}
  function Probe() {
    api.beat = useDiscardBeat(anchors)
    return <>{api.beat.overlay}</>
  }
  return { api, Probe }
}

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
          {
            key: 'd22',
            eventId: 22,
            card: 'protection-debugger',
            source: { kind: 'hand', index: 1 },
          },
        ],
      } as Extract<BeatPlan, { kind: 'discard' }>,
      ctx,
    ),
  )
  // every card was drawn to the centre first…
  expect(played.calls.filter((c) => c.name === 'glide').length).toBe(2)
  // …and each still lands on its own event's scatter (I7)
  expect(exits.items.map((i) => i.scatter)).toEqual([scatterAt(21), scatterAt(22)])
})

it('flies an ordinary discard straight out, with no gather', async () => {
  exits.items.length = 0
  played.calls.length = 0
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() =>
    api.beat?.run(
      {
        kind: 'discard',
        key: 'discard:21',
        cards: [
          { key: 'd21', eventId: 21, card: 'attack-bug', source: { kind: 'hand', index: 0 } },
        ],
      } as Extract<BeatPlan, { kind: 'discard' }>,
      ctx,
    ),
  )
  expect(played.calls.filter((c) => c.name === 'glide')).toEqual([])
  expect(exits.items).toHaveLength(1)
})
