// THE GRID THAT ANSWERS GIT CHERRY-PICK'S OWN PICK (#108). Cherry-pick
// (`operation-git-cherry-pick`) raises the same `pickFromDiscard` kind Inside
// does (`boardAi.test.tsx`'s own describe block), but over the whole discard
// rather than its releases, and under sudo takes two — a shape
// `_useInsideStaging`'s row was never built for. `_useCherryPickStaging`
// gives it a sibling surface rather than widening that row.
import { cardById } from '@release/ui'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockReducedMotion } from '~/test/reducedMotion'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

// The opening is outside this test; keep the real board and event queue.
vi.mock('~/features/game-intro/useDealIntro', () => ({
  useDealIntro: ({ onDone }: { onDone: () => void }) => {
    useEffect(onDone, [onDone])
    return {
      active: false,
      beat: null,
      shadow: null,
      staged: [],
      overlays: null,
      gapAt: null,
      gapSize: 0,
      faceDown: () => false,
    }
  },
}))
const exits = vi.hoisted(() => ({ items: [] as string[][], pending: null as Promise<void> | null }))
vi.mock('@release/ui/animations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@release/ui/animations')>()
  return {
    ...actual,
    useDiscardExit: () => ({
      overlay: [],
      send: (items: { key: string }[]) => {
        exits.items.push(items.map((item) => item.key))
        return exits.pending ?? Promise.resolve()
      },
      reset: () => {},
      FLIGHT_MS: 0,
    }),
  }
})

it.each([
  1, 2,
] as const)('keeps a Cherry-pick arrival in its landing slot across projections (%s picks)', async (picks) => {
  vi.useFakeTimers()
  mockReducedMotion(false)
  let finishReturn = () => {}
  exits.pending = new Promise<void>((resolve) => {
    finishReturn = resolve
  })
  try {
    const base = makeBoardProps()
    const hand = ['defense-hotfix', 'attack-bug', 'support-sudo'].map((id, i) =>
      handItem(`original-${i}`, id),
    )
    const picked = handItem('picked', 'release-frontend')
    const pending = cherryPending(
      [
        { uid: picked.uid, id: picked.card.id },
        { uid: 'deck', id: 'release-backend' },
        { uid: 'rest', id: 'protection-debugger' },
      ],
      picks,
    )
    const state = { ...base.state, you: { ...base.state.you, hand }, pending }
    const intro = { gameId: 'cherry-arrival', view: null, onDone: () => {}, events: [] }
    const props = { ...base, state, intro, actions: { onResolve: vi.fn() } }
    const { container, rerender } = render(<Board {...props} />)
    fireEvent.click(screen.getByTestId('cherry-cell-picked'))
    if (picks === 2) fireEvent.click(screen.getByTestId('cherry-cell-deck'))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    const accepted = {
      ...props,
      state: { ...state, pending: null, you: { ...state.you, hand: [...hand, picked] } },
      intro: {
        ...intro,
        events: [
          {
            id: 1,
            type: 'takenFromDiscard' as const,
            player: 'you',
            card: picked.card.id,
            to: 'hand' as const,
          },
        ],
      },
    }
    rerender(<Board {...accepted} />)
    // Keep the heap return pending: landing must update the fan itself,
    // without waiting for another animation or the final live projection.
    for (let i = 0; i < 25; i++) await act(() => vi.advanceTimersByTimeAsync(100))
    const names = () =>
      [...container.querySelectorAll('[data-hand-slot]')].map((slot) =>
        ['Hotfix', 'Bug', 'Frontend', 'Sudo'].find((name) => slot.textContent?.includes(name)),
      )
    expect(names()).toEqual(['Hotfix', 'Bug', 'Frontend', 'Sudo'])
    await act(async () => {
      finishReturn()
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(names()).toEqual(['Hotfix', 'Bug', 'Frontend', 'Sudo'])
    rerender(<Board {...accepted} state={{ ...accepted.state, history: [] }} />)
    expect(names()).toEqual(['Hotfix', 'Bug', 'Frontend', 'Sudo'])
  } finally {
    finishReturn()
    exits.pending = null
    vi.useRealTimers()
  }
})

// Same shape as `boardAi.test.tsx`'s own `cherryPending` (not exported from
// there, so mirrored here rather than reached for across files) — the
// regression suite that first proved Cherry-pick must NOT land on Inside's
// row.
const handItem = (uid: string, id: string) => {
  const card = cardById(id)
  if (!card) throw new Error(`Unknown fixture card: ${id}`)
  return { uid, card }
}

const cherryPending = (options: { uid: string; id: string }[], picks: 1 | 2 = 1) => ({
  kind: 'pickFromDiscard' as const,
  player: 'you',
  options,
  picks,
  source: 'operation-git-cherry-pick',
})

// `makeBoardProps` + `render(<Board .../>)` — the same rendering the rest of
// this suite (including `boardAi.test.tsx`'s Cherry-pick regression tests)
// already uses; there is no separate `renderBoard` export to reuse instead.
function renderBoard(over: { pending: ReturnType<typeof cherryPending>; actions?: object }) {
  const base = makeBoardProps()
  return render(
    <Board
      {...makeBoardProps({
        state: { ...base.state, pending: over.pending },
        actions: over.actions,
      })}
    />,
  )
}

describe("the grid that answers Git Cherry-pick's own pick", () => {
  it('gives an operation-git-cherry-pick pending the grid, not the panel', () => {
    const onResolve = vi.fn()
    renderBoard({
      pending: cherryPending([
        { uid: 'c1', id: 'attack-bug' },
        { uid: 'c2', id: 'release-frontend' },
      ]),
      actions: { onResolve },
    })
    expect(screen.getByTestId('board-cherry-grid')).not.toBeNull()
    expect(screen.queryByTestId('board-inside-row')).toBeNull()

    fireEvent.click(screen.getByTestId('cherry-cell-c2'))
    fireEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
    expect(onResolve).toHaveBeenCalledWith({ kind: 'pickFromDiscard', card: 'c2' })
  })

  it('names both roles under a sudo pick and sends toDeck', () => {
    const onResolve = vi.fn()
    renderBoard({
      pending: cherryPending(
        [
          { uid: 'c1', id: 'attack-bug' },
          { uid: 'c2', id: 'release-frontend' },
        ],
        2,
      ),
      actions: { onResolve },
    })
    fireEvent.click(screen.getByTestId('cherry-cell-c1'))
    fireEvent.click(screen.getByTestId('cherry-cell-c2'))
    fireEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
    expect(onResolve).toHaveBeenCalledWith({
      kind: 'pickFromDiscard',
      card: 'c1',
      toDeck: 'c2',
    })
  })

  // Task A4's own line: the flights must never cross it. `play()` drives
  // WAAPI directly and does not check the preference — the CSS-transition
  // dealing/reveal legs and the `later()` timers are what have to ask, or a
  // reduced-motion player would wait on a flight nobody rendered.
  it('resolves at once under reduced motion, with nothing left flying', () => {
    const mm = mockReducedMotion(true)
    const onResolve = vi.fn()
    renderBoard({
      pending: cherryPending([
        { uid: 'c1', id: 'attack-bug' },
        { uid: 'c2', id: 'release-frontend' },
      ]),
      actions: { onResolve },
    })
    fireEvent.click(screen.getByTestId('cherry-cell-c2'))
    fireEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
    expect(onResolve).toHaveBeenCalledWith({ kind: 'pickFromDiscard', card: 'c2' })
    expect(screen.queryByTestId('board-cherry-grid')).toBeNull()
    mm.mockRestore()
  })

  it('does not return unpicked cards before the engine accepts the choice', () => {
    exits.items = []
    const onResolve = vi.fn()
    renderBoard({
      pending: cherryPending([
        { uid: 'c1', id: 'attack-bug' },
        { uid: 'c2', id: 'release-frontend' },
      ]),
      actions: { onResolve },
    })
    fireEvent.click(screen.getByTestId('cherry-cell-c2'))
    fireEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
    expect(onResolve).toHaveBeenCalledWith({ kind: 'pickFromDiscard', card: 'c2' })
    expect(exits.items.flat()).not.toContain('c1')
  })
})

// A pick you cannot move is a pick you cannot correct. `canSelect` refused
// every unpicked card the moment `picks` was full, and the click handler
// returned the array unchanged — so the only way out of a mis-click was to
// notice that clicking the CHOSEN card releases it. On the deployed
// playground that reads as a dead grid, which is how it was reported.
describe('changing a pick before confirming', () => {
  it('moves the single pick to the card clicked next', () => {
    const onResolve = vi.fn()
    renderBoard({
      pending: cherryPending([
        { uid: 'c1', id: 'attack-bug' },
        { uid: 'c2', id: 'release-frontend' },
      ]),
      actions: { onResolve },
    })
    fireEvent.click(screen.getByTestId('cherry-cell-c1'))
    fireEvent.click(screen.getByTestId('cherry-cell-c2'))
    fireEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
    expect(onResolve).toHaveBeenCalledWith({ kind: 'pickFromDiscard', card: 'c2' })
  })

  // Two slots full: the new card takes the OLDEST one's place, so the pick
  // that survives is the one chosen most recently.
  it('replaces the oldest of two sudo picks', () => {
    const onResolve = vi.fn()
    renderBoard({
      pending: cherryPending(
        [
          { uid: 'c1', id: 'attack-bug' },
          { uid: 'c2', id: 'release-frontend' },
          { uid: 'c3', id: 'release-backend' },
        ],
        2,
      ),
      actions: { onResolve },
    })
    fireEvent.click(screen.getByTestId('cherry-cell-c1'))
    fireEvent.click(screen.getByTestId('cherry-cell-c2'))
    fireEvent.click(screen.getByTestId('cherry-cell-c3'))
    fireEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
    expect(onResolve).toHaveBeenCalledWith({
      kind: 'pickFromDiscard',
      card: 'c2',
      toDeck: 'c3',
    })
  })

  // The swap is not a licence to reach an illegal pair. A trigger may only
  // ever hold the DECK slot, so a base pick — whose only slot is the hand —
  // still refuses one, full or not.
  it('refuses to swap a trigger into the single hand slot', () => {
    const onResolve = vi.fn()
    renderBoard({
      pending: cherryPending([
        { uid: 'c1', id: 'release-frontend' },
        { uid: 'c2', id: 'trigger-error-503' },
      ]),
      actions: { onResolve },
    })
    fireEvent.click(screen.getByTestId('cherry-cell-c1'))
    fireEvent.click(screen.getByTestId('cherry-cell-c2'))
    fireEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
    expect(onResolve).toHaveBeenCalledWith({ kind: 'pickFromDiscard', card: 'c1' })
  })
})

it('returns unpicked cards only after the engine accepts the local pick', async () => {
  mockReducedMotion(false)
  exits.items = []
  const onResolve = vi.fn()
  const base = makeBoardProps()
  const pending = cherryPending([
    { uid: 'a', id: 'attack-bug' },
    { uid: 'b', id: 'release-frontend' },
  ])
  const props = { ...base, state: { ...base.state, pending }, actions: { onResolve } }
  const { rerender } = render(<Board {...props} />)
  fireEvent.click(screen.getByTestId('cherry-cell-b'))
  fireEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
  expect(exits.items.flat()).not.toContain('a')
  rerender(
    <Board
      {...props}
      state={{ ...base.state, pending: null }}
      intro={{
        gameId: null,
        view: null,
        onDone: () => {},
        events: [
          { id: 1, type: 'takenFromDiscard', player: 'you', card: 'release-frontend', to: 'hand' },
        ],
      }}
    />,
  )
  await vi.waitFor(() => expect(exits.items.flat()).toContain('a'), { timeout: 3000 })
})

it.each([false, true])('reopens a refused Cherry-pick choice (single offer: %s)', (single) => {
  mockReducedMotion(true)
  const base = makeBoardProps()
  const onResolve = vi.fn()
  const options = [
    { uid: 'a', id: 'attack-bug' },
    ...(single ? [] : [{ uid: 'b', id: 'release-frontend' }]),
  ]
  const pending = cherryPending(options)
  const state = { ...base.state, pending }
  const { rerender } = render(<Board {...base} state={state} actions={{ onResolve }} />)
  if (!single) {
    fireEvent.click(screen.getByTestId('cherry-cell-a'))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
  }
  expect(onResolve).toHaveBeenCalledTimes(1)
  rerender(
    <Board
      {...base}
      state={state}
      actions={{ onResolve }}
      intro={{
        gameId: null,
        view: null,
        onDone: () => {},
        events: [
          {
            id: 10,
            type: 'rejected',
            reason: 'that is not the offer',
            action: {
              type: 'RESOLVE',
              player: 'you',
              at: 0,
              choice: { kind: 'pickFromDiscard', card: 'a' },
            },
          },
        ],
      }}
    />,
  )
  expect(screen.getByTestId('board-cherry-grid')).toBeTruthy()
  if (!single) fireEvent.click(screen.getByTestId('cherry-cell-b'))
  fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
  expect(onResolve).toHaveBeenCalledTimes(2)
  expect(onResolve).toHaveBeenLastCalledWith({ kind: 'pickFromDiscard', card: single ? 'a' : 'b' })
})
