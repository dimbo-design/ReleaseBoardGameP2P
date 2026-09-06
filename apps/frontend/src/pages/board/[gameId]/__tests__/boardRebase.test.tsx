// THE ROW THAT ANSWERS GIT REBASE (#108). `reorderTop` is the first pending
// whose whole content is private: `pendingView` hands every peer but its owner
// an empty `piles`, so the row has nothing to hide and simply renders what it
// was given. What the table sees instead is the card's own flight to the
// discard, which the ordinary discard run plays.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

// `piles` is the shape `pendingView` (fake/attacks.ts) actually produces: one
// entry per pile for the owner, and the EMPTY ARRAY — not an entry holding no
// cards — for everybody else. `null` here is that second case.
const rebasePending = (cards: { uid: string; id: string }[] | null, player = 'you') => ({
  kind: 'reorderTop' as const,
  player,
  piles: cards ? [{ pile: 0, cards }] : [],
  source: 'operation-git-rebase',
})

// Same shape as `boardCherryPick.test.tsx`'s own helper — `makeBoardProps` plus
// `render(<Board .../>)`, because there is no shared `renderBoard` export.
function renderBoard(over: { pending: ReturnType<typeof rebasePending>; actions?: object }) {
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

describe('the row that answers Git Rebase', () => {
  it('shows the offered cards in a numbered row and commits the order', () => {
    const onResolve = vi.fn()
    renderBoard({
      pending: rebasePending([
        { uid: 'r0', id: 'attack-bug' },
        { uid: 'r1', id: 'release-frontend' },
        { uid: 'r2', id: 'defense-hotfix' },
      ]),
      actions: { onResolve },
    })
    expect(screen.getByTestId('board-rebase-row')).not.toBeNull()

    // Move the third card to the front, then commit.
    fireEvent.click(screen.getByTestId('rebase-up-r2'))
    fireEvent.click(screen.getByTestId('rebase-up-r2'))
    fireEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
    expect(onResolve).toHaveBeenCalledWith({
      kind: 'reorderTop',
      order: [{ pile: 0, cards: ['r2', 'r0', 'r1'] }],
    })
  })

  it('shows nothing to a peer whose projection carries no cards', () => {
    renderBoard({ pending: rebasePending(null, 'p2') })
    expect(screen.queryByTestId('board-rebase-row')).toBeNull()
  })

  // The test above is answered by the ownership check alone — `p2` is not
  // `you`, so it would pass with no emptiness gate at all (confirmed by
  // mutation: dropping `piles.length > 0` leaves it green). This is the case
  // that actually pins the gate: ours, and empty. The engine does not open a
  // Rebase over a pile it cannot offer, so this is a guard against a projection
  // that hands the owner nothing, not a state the fake reaches today.
  it('renders no row for an offer of our own that carries no cards', () => {
    renderBoard({ pending: rebasePending(null) })
    expect(screen.queryByTestId('board-rebase-row')).toBeNull()
  })
})
