import type { Event, PlayerView } from '@release/engine'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { expect, it, vi } from 'vitest'
import type { BoardState } from '~/entities/game/board'
import { useDealIntro } from '../useDealIntro'

// The opening no longer starts itself (#96): it publishes one beat and the
// board's queue decides when — and whether — to play it. So these tests drive
// the beat directly, which is what the queue does.
//
// There is deliberately no `useReducedMotion` mock here any more. The hook does
// not read the preference; the queue does, and its answer reaches the opening as
// `collapse()` instead of `run()`. Mocking it here would have been a mock of
// something nothing calls — the kind that keeps passing after the behaviour it
// claimed to pin has moved somewhere else.
//
// The cases below are the two ends the opening can reach and the guarantees that
// hold either way: it reports exactly once, and it reports per MATCH rather than
// per peer.

// `useDealIntro` now takes the board's full `BoardAnchors` — this test only
// exercises the members the sequencer itself reads, but the shape must still
// satisfy the interface, so the rest are stubbed inert.
const refs = () => ({
  rail: createRef<HTMLDivElement>(),
  bg: createRef<HTMLDivElement>(),
  decks: createRef<HTMLDivElement>(),
  discard: createRef<HTMLDivElement>(),
  seats: createRef<HTMLDivElement>(),
  dock: createRef<HTMLDivElement>(),
  zone: createRef<HTMLDivElement>(),
  centre: createRef<HTMLDivElement>(),
  stage: createRef<HTMLDivElement>(),
  cost: createRef<HTMLDivElement>(),
  sudo: createRef<HTMLDivElement>(),
  cover: createRef<HTMLDivElement>(),
  hand: createRef<HTMLDivElement>(),
  discardBox: createRef<HTMLDivElement>(),
  cause: createRef<HTMLDivElement>(),
  effect: createRef<HTMLDivElement>(),
  picked: createRef<HTMLDivElement>(),
  eventsBox: createRef<HTMLDivElement>(),
  seatOf: () => null,
  seatBox: () => null,
  handSlotAt: () => null,
  releaseSlot: () => null,
  bindSeat: () => {},
  bindReleaseSlot: () => {},
  pileBox: () => null,
  bindPile: () => {},
})

// Minimal but real: the shapes the sequencer reads. No `as unknown as` cast —
// these satisfy PlayerView / BoardState outright, so drift is a compile error.
const view = (): PlayerView => ({
  self: {
    id: 'p1',
    name: 'One',
    hand: [
      { uid: 'protection-debugger#0', id: 'protection-debugger' },
      { uid: 'attack-bug#1', id: 'attack-bug' },
    ],
    release: {},
    playable: [],
    targets: {},
    combos: {},
    frozen: [],
  },
  opponents: [{ id: 'p2', name: 'Two', handCount: 2, release: {}, eliminated: false }],
  decks: { piles: [100], events: 21, discardCount: 0 },
  turn: { player: 'p1', index: 0, hasDrawn: false },
  window: null,
  pending: null,
  // `Setup` is Record<string, string> in both the engine and the kit.
  setup: {},
  over: null,
  tally: null,
})

const events = (): Event[] => [
  { id: 1, type: 'dealt', player: 'p1', count: 2, open: ['protection-debugger'] },
  { id: 2, type: 'dealt', player: 'p2', count: 2, open: ['protection-debugger'] },
]

const live = (): BoardState => ({
  you: { name: 'One', hand: [], release: {} },
  opponents: [{ id: 'p2', name: 'Two', handCount: 2, release: {} }],
  decks: { main: [100], events: 21, discardCount: 0 },
  turn: 'p1',
  hasDrawn: false,
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
})

// The queue now hands every beat's `run` a `BeatRun` (#97 generalizes the
// opening's own shadow to the whole queue). The opening ignores it — nothing
// here asserts on `publish` — so a fresh, inert context is all `run()` needs
// to be called the way the queue calls it.
const noopCtx = () => ({ base: live(), publish: () => {} })

// What the queue calls instead of `run` when the player asked for less motion.
// The opening still has to REPORT — the host's start gate waits on every seat,
// and a seat that never reports would hold the match shut for everyone — so
// collapsing is a jump to the end state, not a no-op.
it('collapses to the end state and still reports', () => {
  const onDone = vi.fn()
  const { result } = renderHook(() =>
    useDealIntro({
      live: live(),
      gameId: 'g1',
      view: view(),
      events: events(),
      refs: refs(),
      onDone,
    }),
  )
  act(() => result.current.beat?.collapse())
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(result.current.active).toBe(false)
  expect(result.current.shadow).toBeNull()
})

it('does not run for a projection that is not an opening', async () => {
  const v = view()
  v.turn.hasDrawn = true
  const onDone = vi.fn()
  const { result } = renderHook(() =>
    useDealIntro({ live: live(), gameId: 'g1', view: v, events: events(), refs: refs(), onDone }),
  )
  // The beat exists — there is a match — but playing it finds nothing to replay
  // and hands over at once rather than animating an opening that never happened.
  await act(async () => {
    await result.current.beat?.run(noopCtx())
  })
  expect(result.current.active).toBe(false)
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
})

it('does not run before the first projection arrives', () => {
  const onDone = vi.fn()
  const { result } = renderHook(() =>
    useDealIntro({ live: live(), gameId: 'g1', view: null, events: [], refs: refs(), onDone }),
  )
  // Nothing to replay yet, and nothing reported: the gate must keep waiting.
  expect(result.current.active).toBe(false)
  expect(onDone).not.toHaveBeenCalled()
})

it('deals again for a second match in the same mount', async () => {
  // The intro used to be keyed on `view.self.id` — this peer's own seat, which
  // is the same in every game it plays — and the "already reported" latch was
  // never reset. Together that made it once per PEER: a rematch without a
  // remount would have shown a table that dealt itself in silence.
  const onDone = vi.fn()
  const { result, rerender } = renderHook(
    (props: { id: string }) =>
      useDealIntro({
        live: live(),
        gameId: props.id,
        view: view(),
        events: events(),
        refs: refs(),
        onDone,
      }),
    { initialProps: { id: 'g1' } },
  )
  // The beat is keyed by the match, which is what the queue arms on — a new key
  // is a new opening, and the "already reported" latch resets with it.
  expect(result.current.beat?.key).toBe('g1')
  act(() => result.current.beat?.collapse())
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))

  rerender({ id: 'g2' })
  expect(result.current.beat?.key).toBe('g2')
  act(() => result.current.beat?.collapse())
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(2))
})

it('reports done exactly once even if the projection updates', async () => {
  const onDone = vi.fn()
  const { result, rerender } = renderHook(
    (props: { v: PlayerView }) =>
      useDealIntro({
        live: live(),
        gameId: 'g1',
        view: props.v,
        events: events(),
        refs: refs(),
        onDone,
      }),
    { initialProps: { v: view() } },
  )
  act(() => result.current.beat?.collapse())
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  // A fresh projection object is not a fresh match: the latch is keyed on the
  // match id, so re-rendering with a new `view` must not re-open the opening.
  rerender({ v: view() })
  rerender({ v: view() })
  act(() => result.current.beat?.collapse())
  expect(onDone).toHaveBeenCalledTimes(1)
})
