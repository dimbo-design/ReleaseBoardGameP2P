import { fireEvent, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { mockReducedMotion } from '~/test/reducedMotion'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

vi.mock('~/shared/lib/useReducedMotion', () => ({ useReducedMotion: () => true }))

// The board without an intro is the live board, and under reduced motion the
// queue never runs a beat — so what is on screen is the projection itself. That
// is the assertion worth making at THIS level: the board's output does not
// depend on whether the animation played. The queue's own behaviour is covered
// in features/board-beats/useBeats.test.tsx; this suite covers the wiring.
//
// The other half of the wiring — that the discard still puts up a card box for
// `anchors.discardBox`, and therefore for a flight to aim at — is already
// asserted, with the same fixture and the same selector, by
// boardAnchors.test.tsx. It is not restated here: one fact, one test.
it('renders the projection’s own discard heap in the pile', () => {
  const props = makeBoardProps()
  const heap = [
    { uid: 'd1', card: props.state.you.hand[0].card, rot: 4, dx: 2, dy: -3 },
    { uid: 'd2', card: props.state.you.hand[1].card, rot: -6, dx: -1, dy: 5 },
  ]
  const withHeap = {
    ...props,
    state: { ...props.state, decks: { ...props.state.decks, discardHeap: heap, discardCount: 2 } },
  }
  const { container } = render(<Board {...withHeap} />)
  const discard = container.querySelector('[class*="discard"]')
  // Two heap cards render, and the count is the projection's own — the number
  // stays authoritative even when the fold is short (the bankToDiscard gap).
  expect(discard?.querySelectorAll('[class*="heapCard"]')).toHaveLength(2)
})

// A discard is a thing that HAPPENED, not a thing being decided: freezing the
// fan for 420ms every time a card leaves reads as lag, not as safety
// (docs/animations/README.md — "Gating the hand", approach 3). Only the opening
// is exclusive, so on a board with no intro every hand card stays clickable.
it('leaves the hand live on a board with no opening', () => {
  mockReducedMotion(true)
  const onPlay = vi.fn()
  const base = makeBoardProps()
  const uid = base.state.you.hand[0].uid
  // `playable` is the engine's own answer and the only thing that makes a card
  // clickable; with no `legalTargets` the card needs no target, so the press
  // plays it outright. `onPlay` firing IS "the gesture reached the game" — and
  // it is exactly what would stop if the board held the hand inert, because a
  // gated board hands the gesture machine INERT_ACTIONS, whose onPlay is gone.
  const props = makeBoardProps({
    state: { ...base.state, playable: [uid] },
    actions: { onPlay },
  })
  const { container } = render(<Board {...props} />)
  const slot = container.querySelector<HTMLElement>('[data-hand-slot]')
  expect(slot).toBeTruthy()
  // The board always wires Hand's `onPlay` now (#99's staging gesture), so
  // drag mode is on — but this card needs no target, so the staging gesture
  // refuses the pull and the press falls back to a plain click: down and up
  // with no movement between them, under Hand's own drag threshold.
  fireEvent.mouseDown(slot as HTMLElement)
  fireEvent.mouseMove(window, { clientX: 0, clientY: -200 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  expect(onPlay).toHaveBeenCalledWith(uid, undefined, undefined)
})
