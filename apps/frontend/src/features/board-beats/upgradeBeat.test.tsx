// SYSTEM UPGRADE'S ARRIVALS (#108). The beat animates only what is flying in;
// the cards already at the centre are the projection's, so what is worth
// pinning here is that each throw flies, and that several inside one batch are
// staggered rather than landing on top of each other.
import { act, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { BoardAnchors, BoardState } from '~/entities/game/board'
import type { BeatPlan } from './planBeats'
import { useUpgradeBeat } from './upgradeBeat'

// One shared timeline, stamped with the fake clock, so the second card's START
// can be compared against the first's — presence alone would still pass if the
// stagger were dropped, which is the defect this file exists to catch.
const timeline = vi.hoisted(() => ({ starts: [] as number[] }))
vi.mock('@release/ui/animations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@release/ui/animations')>()),
  play: () => {
    timeline.starts.push(Date.now())
    return { finished: Promise.resolve() } as unknown as Animation
  },
}))

const node = () => document.createElement('div')

const base = {
  you: { name: 'You', hand: [], release: {} },
  opponents: [],
  decks: { main: [24], events: 5, discardCount: 0, discardHeap: [], discard: undefined },
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
} as unknown as BoardState

function harness(opts: { seats?: boolean } = {}) {
  const anchors = {
    hand: { current: node() },
    centre: { current: node() },
    discardBox: { current: node() },
    pileBox: () => null,
    seatBox: () => (opts.seats === false ? null : { left: 0, top: 0, width: 200, height: 280 }),
    seatOf: () => null,
    handSlotAt: () => null,
    releaseSlot: () => null,
    bindPile: () => {},
    bindSeat: () => {},
    bindReleaseSlot: () => {},
  } as unknown as BoardAnchors
  const api: { beat?: ReturnType<typeof useUpgradeBeat> } = {}
  function Probe() {
    api.beat = useUpgradeBeat(anchors)
    return <>{api.beat.overlay}</>
  }
  render(<Probe />)
  return { api, ctx: { base, publish: () => {} } }
}

// `deckBeat.test.tsx`'s established pattern: a runner that spans real `wait()`
// delays needs its intermediate DOM observed step by step, or `useFlyer`'s
// flyer never mounts and every flight is silently skipped.
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

const plan = (throws: { eventId: number; player: string; card: string }[]) =>
  ({ kind: 'upgrade', key: `upgrade:${throws[0]?.eventId}`, throws }) as Extract<
    BeatPlan,
    { kind: 'upgrade' }
  >

it('flies one seat’s answer to the centre', async () => {
  timeline.starts = []
  const { api, ctx } = harness()
  await drive(() => api.beat?.run(plan([{ eventId: 1, player: 'p2', card: 'attack-bug' }]), ctx))
  expect(timeline.starts).toHaveLength(1)
})

it('staggers two answers that arrive in one batch', async () => {
  timeline.starts = []
  const { api, ctx } = harness()
  await drive(() =>
    api.beat?.run(
      plan([
        { eventId: 1, player: 'p2', card: 'attack-bug' },
        { eventId: 2, player: 'p3', card: 'defense-hotfix' },
      ]),
      ctx,
    ),
  )
  expect(timeline.starts).toHaveLength(2)
  // THROW_STEP is 260; the second card must not start with the first. Compared
  // with a margin because the drive loop advances the clock in 20ms steps.
  expect(timeline.starts[1] - timeline.starts[0]).toBeGreaterThanOrEqual(240)
})

it('flies nothing for a seat the board cannot aim at', async () => {
  timeline.starts = []
  const { api, ctx } = harness({ seats: false })
  await drive(() => api.beat?.run(plan([{ eventId: 1, player: 'p2', card: 'attack-bug' }]), ctx))
  expect(timeline.starts).toEqual([])
})
