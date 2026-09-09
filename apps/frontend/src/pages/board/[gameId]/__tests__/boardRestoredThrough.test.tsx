// Task 16, fix round 1 (#136): integration coverage for the real wiring the
// unit suite in `useBeats.test.tsx` cannot reach. That file's own `Probe`
// never passes `intro`, so `useBeats`'s reset effect (`seen.current = 0` when
// the deal-intro key first appears) always short-circuits on its
// `key == null` guard — the interaction between that reset and the
// monotonic-forward advance is structurally unobservable there. This mounts
// the real `Board`, which arms a real `IntroBeat` with a real, stable key
// (`useDealIntro`'s own `gameKey`), so the reset effect actually runs once at
// mount, and the suite proves the later, live-resync advance survives it.
//
// `planBeats` is spied at its OWN module path, not through the barrel
// `_Board.tsx` imports `useBeats` from (`~/features/board-beats`, the
// pattern `boardAlarm.test.tsx`/`boardGameOver.test.tsx` use for `useBeats`
// itself). `useBeats.ts` reaches `planBeats` through a sibling relative
// import (`./planBeats`), so wrapping the barrel's `useBeats` would leave
// that real, unmocked `planBeats` running underneath with nothing to
// observe. Vitest mocks by resolved module id: `~/features/board-beats/planBeats`
// and `./planBeats` (as `useBeats.ts` sees it) are the same file on disk, so
// mocking the former also replaces what the latter resolves to.
import type { Event, PlayerView } from '@release/engine'
import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import Board from '../_Board'
import { introFixture, makeBoardProps } from './fixture'

// Not reduced: the sequencer arms itself in a layout effect on every mount
// regardless of `isOpening`, and the non-reduced path is the one that queues
// a real beat through `drain()` rather than collapsing straight to `finish()`
// — the more faithful rehearsal of what a rejoining peer's board actually
// runs.
vi.mock('~/shared/lib/useReducedMotion', () => ({ useReducedMotion: () => false }))

const planned = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('~/features/board-beats/planBeats', async (importOriginal) => {
  const real = await importOriginal<typeof import('~/features/board-beats/planBeats')>()
  return {
    ...real,
    planBeats: (...args: Parameters<typeof real.planBeats>) => {
      planned.calls.push(args)
      return real.planBeats(...args)
    },
  }
})

// A mid-match projection: `isOpening` (features/game-intro/isOpening.ts)
// reads FALSE off `turn.index !== 0` alone, with every other opening
// condition left exactly as `introFixture` built it. `useDealIntro`'s own
// `sequence()` then hands over at once (`!isOpening(v)` guard) instead of
// running the choreography, so `enabled` flips `true` on the render right
// after mount — the same shape a peer that rejoins mid-game, or a reload
// mid-game, actually sees.
const restoredView: PlayerView = {
  ...introFixture().view,
  turn: { player: 'p1', index: 1, hasDrawn: true },
}

const dealt1: Event = {
  id: 1,
  type: 'dealt',
  player: 'p1',
  count: 2,
  open: ['protection-debugger'],
}
const dealt2: Event = {
  id: 2,
  type: 'dealt',
  player: 'p2',
  count: 2,
  open: ['protection-debugger'],
}
const discard3: Event = {
  id: 3,
  type: 'discarded',
  player: 'p1',
  card: 'attack-bug',
  reason: 'effect',
}

// A macrotask tick, not a microtask: `drain()`'s own settle path resolves a
// Promise from inside a Promise executor, which still defers its `.then()` a
// tick, and `finish()`'s cascading `setState`s need a render in between. Real
// timers throughout — nothing here waits on the deal's own choreography,
// only on the opening's synchronous "not an opening, hand over at once" exit.
const flush = () => new Promise((r) => setTimeout(r, 0))

it('plans nothing for a restored feed when the real Board mounts mid-match', async () => {
  planned.calls = []
  const props = makeBoardProps()
  render(
    <Board
      {...props}
      intro={{
        gameId: 'g1',
        view: restoredView,
        events: [dealt1, dealt2, discard3],
        restoredThrough: discard3.id,
        onDone: () => {},
      }}
    />,
  )
  await flush()
  await flush()
  expect(planned.calls).toEqual([])
})

it('does not let a live resync replay as choreography through the real wiring', async () => {
  planned.calls = []
  const props = makeBoardProps()
  const { rerender } = render(
    <Board
      {...props}
      intro={{
        gameId: 'g1',
        view: restoredView,
        events: [dealt1, dealt2],
        restoredThrough: dealt2.id,
        onDone: () => {},
      }}
    />,
  )
  await flush()
  await flush()
  expect(planned.calls).toEqual([])

  // The resync: two more events land while this peer never reloaded — the
  // board is the SAME mount, `enabled` was already `true`, and
  // `restoredThrough` (built off `restoredNow` in `useGame.ts`, Task 15)
  // advances in the same render to cover them, exactly as a rejoin resend
  // reports. The reset effect does not fire again here: `intro.gameId`/the
  // deal's own key is unchanged, so `playing.current === key` and the guard
  // that would zero `seen` back out never trips.
  const resync1: Event = { ...discard3, id: 4 }
  const resync2: Event = { ...discard3, id: 5 }
  rerender(
    <Board
      {...props}
      intro={{
        gameId: 'g1',
        view: restoredView,
        events: [dealt1, dealt2, resync1, resync2],
        restoredThrough: resync2.id,
        onDone: () => {},
      }}
    />,
  )
  await flush()
  await flush()
  expect(planned.calls).toEqual([])
})
