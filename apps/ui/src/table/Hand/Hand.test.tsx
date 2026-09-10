import { fireEvent, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { cardById } from '@/cards'
import Hand from './Hand'

const knownCard = (id: string) => {
  const card = cardById(id)
  if (!card) throw new Error(`missing test catalogue card: ${id}`)
  return card
}

// `carrying` only mutes the fan's own reactions to the cursor (hover lift,
// zoom preview) — see Hand.tsx. Whether a second card may ALSO start a drag
// while one is already carried elsewhere is the consumer's call: the board
// gates onPlay/onReorder itself for the hand-limit discard, precisely so two
// pulls can be in flight together (docs/animations/README.md, "Gating the
// hand", approach 1). A gate here on top of that stopped a second excess card
// from being thrown until the first had landed — this drives the real
// press → move-past-threshold → release gesture through Hand (not the hook)
// with `carrying` true and a consumer that still accepts the drop, and proves
// the fan itself never blocks it.
it('still starts and completes a fan drag while another interaction reports carrying', () => {
  const onPlay = vi.fn(() => true)
  const { container } = render(
    <Hand
      items={[
        { uid: 'attack-bug#0', card: knownCard('attack-bug') },
        { uid: 'protection-debugger#0', card: knownCard('protection-debugger') },
      ]}
      carrying
      onPlay={onPlay}
    />,
  )
  const second = container.querySelectorAll<HTMLElement>('[data-hand-slot]')[1]

  fireEvent.mouseDown(second, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 }) // past DRAG_THRESHOLD
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 }) // released well above the hand → play

  expect(onPlay).toHaveBeenCalledWith('protection-debugger#0', expect.anything())
})
