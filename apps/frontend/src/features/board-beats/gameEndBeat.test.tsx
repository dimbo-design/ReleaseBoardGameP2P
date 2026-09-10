import type { Event } from '@release/engine'
import { act, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BeatRun, BoardState } from '~/entities/game/board'
import { CONFETTI_MS, GAME_OVER_AT, useGameEndBeat } from './gameEndBeat'
import { planBeats } from './planBeats'

const animations = vi.hoisted(() => ({ names: [] as string[] }))
vi.mock('@release/ui/animations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@release/ui/animations')>()
  return {
    ...actual,
    play: (name: Parameters<typeof actual.play>[0], ...args: unknown[]) => {
      animations.names.push(name)
      return actual.play(name, ...(args as [Element, Record<string, unknown>]))
    },
  }
})

afterEach(() => {
  vi.useRealTimers()
  animations.names = []
})

const base = {
  you: { name: 'You', hand: [], release: {} },
  opponents: [],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
} as unknown as BoardState

const ctx: BeatRun = { base, publish: () => {} }
const [planned] = planBeats(
  [{ id: 99, type: 'gameOver', winner: 'p1', condition: 'release' } as Event],
  base,
)
if (planned.kind !== 'gameEnd') throw new Error('expected a game-end plan')
const plan = planned

function harness() {
  const api: { beat?: ReturnType<typeof useGameEndBeat> } = {}
  function Probe() {
    api.beat = useGameEndBeat()
    return <>{api.beat.overlay}</>
  }
  return { api, Probe }
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    await Promise.resolve()
  })
}

it('adds three independent volleys without replacing pieces already in flight', async () => {
  vi.useFakeTimers()
  const { api, Probe } = harness()
  const { getByTestId } = render(<Probe />)

  act(() => {
    void api.beat?.run(plan, ctx)
  })
  await tick(1)

  const pops = getByTestId('game-end-confetti')
  expect(pops.children).toHaveLength(1)
  expect(pops.children[0].children).toHaveLength(66)
  expect(animations.names.filter((name) => name === 'confettiFly')).toHaveLength(66)
  const firstVolley = pops.children[0]

  await tick(619)
  expect(pops.children).toHaveLength(2)
  expect(pops.children[1].children).toHaveLength(46)
  expect(pops.children[0]).toBe(firstVolley)

  await tick(830)
  expect(pops.children).toHaveLength(3)
  expect(pops.children[2].children).toHaveLength(82)
  expect(pops.children[0]).toBe(firstVolley)
})

it('finishes at 2.4 seconds while confetti stays up until its own cleanup', async () => {
  vi.useFakeTimers()
  const { api, Probe } = harness()
  const { queryByTestId } = render(<Probe />)
  let done = false

  act(() => {
    void api.beat?.run(plan, ctx).then(() => {
      done = true
    })
  })
  await tick(GAME_OVER_AT - 1)
  expect(done).toBe(false)
  expect(queryByTestId('game-end-confetti')).not.toBeNull()

  await tick(1)
  expect(done).toBe(true)
  expect(queryByTestId('game-end-confetti')).not.toBeNull()

  await tick(8500 - GAME_OVER_AT)
  expect(queryByTestId('game-end-confetti')).toBeNull()
})

it('cancels scheduled volleys and clears mounted confetti on reset', async () => {
  vi.useFakeTimers()
  const { api, Probe } = harness()
  const { queryByTestId } = render(<Probe />)

  act(() => {
    void api.beat?.run(plan, ctx)
  })
  await tick(1)
  expect(queryByTestId('game-end-confetti')).not.toBeNull()

  act(() => {
    api.beat?.reset()
  })
  expect(queryByTestId('game-end-confetti')).toBeNull()

  await tick(CONFETTI_MS)
  expect(queryByTestId('game-end-confetti')).toBeNull()
})

it('settles the active beat immediately when reset cancels it', async () => {
  vi.useFakeTimers()
  const { api, Probe } = harness()
  render(<Probe />)
  let done = false

  act(() => {
    void api.beat?.run(plan, ctx).then(() => {
      done = true
    })
  })
  await tick(1)
  expect(done).toBe(false)

  await act(async () => {
    api.beat?.reset()
    await Promise.resolve()
  })
  expect(done).toBe(true)
})
