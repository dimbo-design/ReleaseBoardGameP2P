import { cardById } from '@release/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockReducedMotion } from '~/test/reducedMotion'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

function showOperation(id: string, sudo = false) {
  mockReducedMotion(true)
  const base = makeBoardProps()
  const onPlay = vi.fn()
  const card = cardById(id)
  const support = cardById('support-sudo')
  if (!card || !support) throw new Error('missing card')
  render(
    <Board
      {...base}
      state={{
        ...base.state,
        you: {
          ...base.state.you,
          hand: [...(sudo ? [{ uid: 'sudo', card: support }] : []), { uid: 'op', card }],
        },
        decks: { ...base.state.decks, main: [7, 13] },
        playable: ['op'],
        targets: {
          op: [
            { kind: 'pile', pile: 0 },
            { kind: 'pile', pile: 1 },
          ],
        },
        comboOptions: sudo ? { sudo: ['op'] } : {},
      }}
      actions={{ onPlay }}
    />,
  )
  return onPlay
}

function clickFirstCard(pull = false) {
  const slot = document.querySelector('[data-hand-slot]')
  if (!slot) throw new Error('missing hand card')
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  if (pull) fireEvent.mouseMove(window, { clientX: 0, clientY: -200 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: pull ? -200 : 0 })
}

describe('Git pile choice', () => {
  it.each([
    'operation-git-branch',
    'operation-git-rebase',
  ])('stages %s on pull and sends the selected second pile', (id) => {
    const onPlay = showOperation(id)
    clickFirstCard(true)
    expect(onPlay).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /deck 2/i }))
    expect(onPlay).toHaveBeenCalledWith('op', { kind: 'pile', pile: 1 }, undefined)
  })

  it('still chooses a pile when Branch is paired with Sudo', () => {
    const onPlay = showOperation('operation-git-branch', true)
    clickFirstCard(true)
    clickFirstCard()
    expect(onPlay).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /deck 2/i }))
    expect(onPlay).toHaveBeenCalledWith('op', { kind: 'pile', pile: 1 }, 'sudo')
  })

  it('plays Sudo Rebase against every pile without asking for one', () => {
    const onPlay = showOperation('operation-git-rebase', true)
    clickFirstCard(true)
    clickFirstCard()
    expect(onPlay).toHaveBeenCalledWith('op', undefined, 'sudo')
    expect(screen.queryByRole('button', { name: /deck 2/i })).toBeNull()
  })
})
