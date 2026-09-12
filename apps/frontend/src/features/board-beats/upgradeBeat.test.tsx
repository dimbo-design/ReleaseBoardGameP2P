// SYSTEM UPGRADE'S ARRIVALS (#108). The beat animates only what is flying in;
// the cards already at the centre are the projection's, so what is worth
// pinning here is that each throw flies, and that several inside one batch are
// staggered rather than landing on top of each other.
import { act, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { BoardAnchors, BoardState, StagedHandoff } from '~/entities/game/board'
import type { BeatPlan } from './planBeats'
import { useUpgradeBeat } from './upgradeBeat'

// One shared timeline, stamped with the fake clock, so the second card's START
// can be compared against the first's — presence alone would still pass if the
// stagger were dropped, which is the defect this file exists to catch.
const timeline = vi.hoisted(() => ({
  starts: [] as number[],
  targets: [] as { left: number; width: number }[],
  arrivals: vi.fn(),
  motions: [] as string[],
  exits: vi.fn(async (_items: unknown) => {}),
}))
vi.mock('@release/ui/animations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@release/ui/animations')>()),
  useDiscardExit: () => ({ send: timeline.exits, overlay: [] }),
  useHandArrival: (
    _ref: unknown,
    landed: (gap: number, cards: { key: string; card: unknown }[]) => void,
  ) => ({
    overlay: [],
    gapAt: null,
    gapSize: 1,
    arrive: (cards: { key: string; card: unknown }[], count: number) => {
      timeline.arrivals(cards, count)
      landed(0, cards)
      return Promise.resolve()
    },
  }),
  play: (_name: string, _el: HTMLElement, params: { to: { left: number; width: number } }) => {
    timeline.motions.push(_name)
    timeline.targets.push(params.to)
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
  pending: {
    kind: 'systemUpgrade',
    actor: 'p1',
    owed: ['p2', 'p3'],
    thrown: [],
    sudo: false,
    phase: 'discarding',
    source: 'operation-system-upgrade',
  },
  setup: {},
  playable: [],
  frozen: [],
} as unknown as BoardState

function harness(opts: { seats?: boolean; local?: StagedHandoff } = {}) {
  const root = node()
  const centre = node()
  root.append(centre)
  for (const [index, player] of ['p2', 'p3'].entries()) {
    const slot = node()
    slot.dataset.upgradeSlot = player
    slot.getBoundingClientRect = () =>
      ({ left: 100 + index * 174, top: 200, width: 150, height: 210 }) as DOMRect
    root.append(slot)
  }
  const anchors = {
    hand: { current: node() },
    centre: { current: centre },
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
    api.beat = useUpgradeBeat(anchors, { current: opts.local ?? null })
    return <>{api.beat.overlay}</>
  }
  render(<Probe />)
  return { api, ctx: { base, publish: vi.fn() } }
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

it('lands on distinct 150px row slots and publishes the standing cards', async () => {
  timeline.targets = []
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
  expect(timeline.targets.map(({ left, width }) => ({ left, width }))).toEqual([
    { left: 100, width: 150 },
    { left: 274, width: 150 },
  ])
  expect(ctx.publish.mock.calls[0][0].pending.thrown).toHaveLength(2)
  expect(ctx.publish.mock.calls[0][0].pending.owed).toEqual([])
})

it('holds the final base row before its measured cards leave for discard', async () => {
  timeline.exits.mockClear()
  const { api, ctx } = harness()
  let publishedAt = 0
  let leftAt = 0
  ctx.publish.mockImplementation(() => {
    publishedAt ||= Date.now()
  })
  timeline.exits.mockImplementationOnce(() => {
    leftAt = Date.now()
    return Promise.resolve()
  })
  const final = plan([{ eventId: 1, player: 'p2', card: 'attack-bug' }])
  final.clear = [{ eventId: 2, player: 'p2', card: 'attack-bug' }]
  await drive(() => api.beat?.run(final, ctx))
  expect(leftAt - publishedAt).toBeGreaterThanOrEqual(2500)
  expect(timeline.exits).toHaveBeenCalledWith([
    expect.objectContaining({
      key: 'upgrade-exit:2',
      node: expect.any(HTMLElement),
    }),
  ])
  expect(ctx.publish.mock.lastCall?.[0].pending).toBeNull()
})

it('hands an accepted local card to its real pending UID before releasing the carrier', async () => {
  timeline.starts = []
  const release = vi.fn()
  const { api, ctx } = harness({ local: { mainUid: 'given', el: node(), release } })
  release.mockImplementation(() => {
    expect(ctx.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        pending: expect.objectContaining({
          thrown: [{ player: 'p1', card: { uid: 'given', id: 'attack-bug' } }],
        }),
      }),
    )
  })
  const after = {
    ...base,
    pending: {
      ...base.pending,
      kind: 'systemUpgrade',
      thrown: [{ player: 'p1', card: { uid: 'given', id: 'attack-bug' } }],
    },
  } as BoardState
  await drive(() =>
    api.beat?.run(plan([{ eventId: 1, player: 'p1', card: 'attack-bug' }]), { ...ctx, after }),
  )
  expect(timeline.starts).toHaveLength(0)
  expect(release).toHaveBeenCalledOnce()
})

it.each([
  'p1',
  'p4',
])('reveals the sudo choice, sends it to %s, and discards the other row card', async (player) => {
  timeline.arrivals.mockClear()
  timeline.exits.mockClear()
  timeline.motions = []
  const { api, ctx } = harness()
  const before = {
    ...base,
    opponents: [{ id: 'p4', name: 'Four', handCount: 2, release: {} }],
    pending: {
      kind: 'systemUpgrade',
      actor: player,
      owed: [],
      sudo: true,
      phase: 'picking',
      source: 'operation-system-upgrade',
      thrown: [
        { player: 'p2', card: { uid: 'chosen', id: 'attack-bug' } },
        { player: 'p3', card: { uid: 'remaining', id: 'attack-bug' } },
      ],
    },
  } as BoardState
  const take = {
    kind: 'upgrade',
    key: 'upgrade-take:1',
    throws: [],
    take: { player, card: 'attack-bug', uid: 'chosen', fromPlayer: 'p2' },
    clear: [{ eventId: 2, player: 'p3', card: 'attack-bug' }],
  } as Extract<BeatPlan, { kind: 'upgrade' }>
  await drive(() => api.beat?.run(take, { ...ctx, base: before }))
  expect(timeline.motions[0]).toBe('playToCenter')
  expect(timeline.exits).toHaveBeenCalledWith([
    expect.objectContaining({
      key: 'upgrade-exit:2',
      node: expect.objectContaining({ dataset: expect.objectContaining({ upgradeSlot: 'p3' }) }),
    }),
  ])
  const result = ctx.publish.mock.lastCall?.[0] as BoardState
  expect(result.pending).toBeNull()
  if (player === 'p1') {
    expect(timeline.arrivals).toHaveBeenCalledWith([expect.objectContaining({ key: 'chosen' })], 0)
    expect(result.you.hand.map((c) => c.uid)).toEqual(['chosen'])
    expect(timeline.motions).not.toContain('dealToSeat')
  } else {
    expect(timeline.arrivals).not.toHaveBeenCalled()
    expect(timeline.motions).toContain('dealToSeat')
    expect(result.opponents[0].handCount).toBe(3)
  }
})
