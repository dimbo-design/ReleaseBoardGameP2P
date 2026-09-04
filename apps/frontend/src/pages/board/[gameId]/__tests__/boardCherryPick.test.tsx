// THE GRID THAT ANSWERS GIT CHERRY-PICK'S OWN PICK (#108). Cherry-pick
// (`operation-git-cherry-pick`) raises the same `pickFromDiscard` kind Inside
// does (`boardAi.test.tsx`'s own describe block), but over the whole discard
// rather than its releases, and under sudo takes two — a shape
// `_useInsideStaging`'s row was never built for. `_useCherryPickStaging`
// gives it a sibling surface rather than widening that row.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

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
})
