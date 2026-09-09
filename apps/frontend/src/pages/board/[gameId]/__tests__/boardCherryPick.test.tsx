// THE GRID THAT ANSWERS GIT CHERRY-PICK'S OWN PICK (#108). Cherry-pick
// (`operation-git-cherry-pick`) raises the same `pickFromDiscard` kind Inside
// does (`boardAi.test.tsx`'s own describe block), but over the whole discard
// rather than its releases, and under sudo takes two — a shape
// `_useInsideStaging`'s row was never built for. `_useCherryPickStaging`
// gives it a sibling surface rather than widening that row.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockReducedMotion } from '~/test/reducedMotion'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

// Task A4's fix round 1: the unpicked cards never leave the projection
// (`decks.discard` still holds them, and `_Board.tsx` renders the heap off
// that same array the whole time the grid is open), so a confirmed pick must
// never send one to the discard-exit step — that step's own flight is what
// used to draw each unpicked card twice, once flying and once already
// resting in the heap underneath. Mocking `useDiscardExit` turns its own
// calls into the assertion surface, the same pattern `boardHandLimit.test.tsx`
// already uses to track a discard-exit step's calls — a card count across the
// DOM couldn't tell a fixed grid cell from a translating one in jsdom, which
// has no Web Animations API to observe.
const exits = vi.hoisted(() => ({ items: [] as string[][] }))
vi.mock('@release/ui/animations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@release/ui/animations')>()
  return {
    ...actual,
    useDiscardExit: () => ({
      overlay: [],
      send: (items: { key: string }[]) => {
        exits.items.push(items.map((item) => item.key))
        return Promise.resolve()
      },
      reset: () => {},
      FLIGHT_MS: 0,
    }),
  }
})

// Same shape as `boardAi.test.tsx`'s own `cherryPending` (not exported from
// there, so mirrored here rather than reached for across files) — the
// regression suite that first proved Cherry-pick must NOT land on Inside's
// row.
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

  // Findings round 1: the unpicked card (c1 here) is already on screen in the
  // discard heap the whole time this grid is open — `_Board.tsx` renders
  // `decks.discardHeap` off the same projection the engine never removes it
  // from. A confirmed pick must not additionally hand it to the discard-exit
  // step; that step's own flight is what used to draw it twice.
  it('never sends an unpicked card to the discard-exit step — the heap already shows it', () => {
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
