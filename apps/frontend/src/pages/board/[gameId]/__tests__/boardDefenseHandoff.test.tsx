import type { Event } from '@release/engine'
import { cardById } from '@release/ui'
import { act, fireEvent, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BoardState } from '~/entities/game/board'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

const motion = vi.hoisted(() => ({ reduced: false }))
vi.mock('~/shared/lib/useReducedMotion', () => ({ useReducedMotion: () => motion.reduced }))

// Skip only the opening. The board, defense gesture, hand and beat queue are real.
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

afterEach(() => {
  vi.useRealTimers()
  motion.reduced = false
})

const hand = ['defense-hotfix', 'support-sudo', 'attack-bug'].map((id) => ({
  uid: `${id}#0`,
  // biome-ignore lint/style/noNonNullAssertion: known catalogue entries
  card: cardById(id)!,
}))
const fan = () =>
  Array.from(document.querySelectorAll('[data-hand-slot] [data-card]')).map((el) =>
    el.getAttribute('data-card'),
  )
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

it.each([
  { reduced: false, responseMs: 20, paired: false },
  { reduced: false, responseMs: 700, paired: false },
  { reduced: false, responseMs: 20, paired: true },
  { reduced: true, responseMs: 20, paired: false },
])('keeps the spent defense out of the board hand through resolution (%j)', async (scenario) => {
  motion.reduced = scenario.reduced
  vi.useFakeTimers()
  const onResolve = vi.fn()
  const base = makeBoardProps({ actions: { onResolve } })
  const before: BoardState = {
    ...base.state,
    you: { ...base.state.you, hand },
    playable: [],
    comboOptions: { 'support-sudo#0': ['defense-hotfix#0'] },
    pending: {
      kind: 'defend',
      player: 'you',
      attacker: 'p2',
      attackCard: 'attack-bug',
      sudo: false,
      options: ['defense-hotfix#0'],
      openedAt: 0,
      deadline: 15_000,
      scope: 'release',
    },
  }
  const onDone = () => {}
  const board = (state: BoardState, feed: Event[]) => (
    <Board {...base} state={state} intro={{ gameId: null, view: null, events: feed, onDone }} />
  )
  const { rerender } = render(board(before, []))

  const slot = document.querySelectorAll('[data-hand-slot]')[scenario.paired ? 1 : 0]
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  if (scenario.paired) {
    await advance(700)
    const partner = document.querySelectorAll('[data-hand-slot]')[0]
    fireEvent.mouseDown(partner, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(window, { clientX: 0, clientY: 0 })
  }
  await advance(scenario.responseMs)
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'defend',
    card: 'defense-hotfix#0',
    combo: scenario.paired ? 'support-sudo#0' : undefined,
  })
  const remaining = scenario.paired ? ['attack-bug'] : ['support-sudo', 'attack-bug']
  expect(fan()).toEqual(remaining)

  const events: Event[] = [
    { id: 1, type: 'defended', player: 'you', card: 'defense-hotfix', effect: 'cancel' },
    { id: 2, type: 'discarded', player: 'p2', card: 'attack-bug', reason: 'attackSpent' },
    { id: 3, type: 'discarded', player: 'you', card: 'defense-hotfix', reason: 'defenceSpent' },
    ...(scenario.paired
      ? ([
          { id: 4, type: 'discarded', player: 'you', card: 'support-sudo', reason: 'defenceSpent' },
        ] as Event[])
      : []),
  ]
  const after: BoardState = {
    ...before,
    you: { ...before.you, hand: hand.filter((item) => remaining.includes(item.card.id)) },
    pending: null,
    comboOptions: {},
  }
  rerender(board(after, events))
  // Observe the actual Hand through the hold, the exit and the settled board.
  // A hook-only harness misses Board switching hand sources when pending clears.
  for (let elapsed = 0; elapsed < 3000; elapsed += 20) {
    await advance(20)
    expect(fan(), `hand at ${elapsed + 20}ms after resolution`).toEqual(remaining)
  }
})
