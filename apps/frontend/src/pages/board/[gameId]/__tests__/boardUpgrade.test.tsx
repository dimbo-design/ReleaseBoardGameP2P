// THE CENTRE A SYSTEM UPGRADE FILLS (#108). `systemUpgrade` is the first
// pending owed to several seats at once, so one surface has to answer three
// different questions depending on where this seat stands in it: being asked,
// having answered, or (under sudo, once the roster has drained) picking from
// what everyone threw.
//
// Nothing here is private — the rules put the thrown cards face up at the
// centre — so the standing cards come straight off the projection and no beat
// has to hold them across a batch boundary.
import { cardById } from '@release/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

const card = (id: string) => {
  const data = cardById(id)
  if (!data) throw new Error(`no such card: ${id}`)
  return data
}

const upgradePending = (over: Record<string, unknown> = {}) => ({
  kind: 'systemUpgrade' as const,
  actor: 'p2',
  owed: ['you'],
  thrown: [] as { player: string; card: { uid: string; id: string } }[],
  sudo: false,
  phase: 'discarding' as const,
  source: 'operation-system-upgrade',
  ...over,
})

function renderBoard(over: {
  pending: ReturnType<typeof upgradePending>
  hand?: { uid: string; card: ReturnType<typeof card> }[]
  actions?: object
}) {
  const base = makeBoardProps()
  return render(
    <Board
      {...makeBoardProps({
        state: {
          ...base.state,
          pending: over.pending,
          ...(over.hand ? { you: { ...base.state.you, hand: over.hand } } : {}),
        },
        actions: over.actions,
      })}
    />,
  )
}

describe('the centre a System Upgrade fills', () => {
  it('discards by pulling from the real hand without a duplicate picker', async () => {
    const onResolve = vi.fn()
    renderBoard({
      pending: upgradePending(),
      hand: [{ uid: 'h1', card: card('attack-bug') }],
      actions: { onResolve },
    })
    expect(screen.queryByTestId('upgrade-hand-h1')).toBeNull()
    const slot = document.querySelector('[data-hand-slot]')
    if (!slot) throw new Error('the hand rendered no slot to pull from')
    fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
    fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
    await vi.waitFor(() =>
      expect(onResolve).toHaveBeenCalledWith({ kind: 'upgradeDiscard', card: 'h1' }),
    )
  })

  it('asks this seat for nothing once it has answered', () => {
    renderBoard({
      pending: upgradePending({
        owed: ['p3'],
        thrown: [{ player: 'you', card: { uid: 'h1', id: 'attack-bug' } }],
      }),
    })
    expect(screen.queryByTestId('board-upgrade-ask')).toBeNull()
    // The thrown card stands at the centre for everyone, from the projection —
    // no beat is holding it.
    expect(screen.getByTestId('upgrade-thrown-h1')).not.toBeNull()
  })

  it('offers the actor a pick, and only the thrown cards', () => {
    const onResolve = vi.fn()
    renderBoard({
      pending: upgradePending({
        actor: 'you',
        owed: [],
        sudo: true,
        phase: 'picking',
        thrown: [
          { player: 'p2', card: { uid: 't1', id: 'attack-bug' } },
          { player: 'p3', card: { uid: 't2', id: 'defense-hotfix' } },
        ],
      }),
      actions: { onResolve },
    })
    fireEvent.click(screen.getByTestId('upgrade-thrown-t2'))
    fireEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
    expect(onResolve).toHaveBeenCalledWith({ kind: 'upgradeTake', card: 't2' })
  })
})
