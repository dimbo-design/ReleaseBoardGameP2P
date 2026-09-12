import { cardById } from '@release/ui'
import { act, fireEvent, render, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SHOW_HOLD, useBoardAnchors } from '~/entities/game/board'
import { mockReducedMotion } from '~/test/reducedMotion'
import Board from '../_Board'
import { useBoardStaging } from '../_useBoardStaging'
import { introFixture, makeBoardProps } from './fixture'

describe('starting a play from the hand', () => {
  it('flies an accepted Monitoring from its local staged node into the zone', async () => {
    mockReducedMotion(false)
    vi.useFakeTimers()
    let movedStaged = false
    const animate = Element.prototype.animate
    const movement = vi.spyOn(Element.prototype, 'animate').mockImplementation(function (
      this: Element,
      ...args: Parameters<Element['animate']>
    ) {
      if (this.getAttribute('data-testid') === 'board-centre-staged') movedStaged = true
      return animate.apply(this, args)
    })
    try {
      const props = makeBoardProps()
      const accepted = vi.fn()
      const restored = introFixture()
      const view = { ...restored.view, turn: { ...restored.view.turn, index: 1 } }
      const card = cardById('protection-monitoring')
      if (!card) throw new Error('missing Monitoring')
      const before = {
        ...props.state,
        you: { ...props.state.you, hand: [{ uid: 'mine', card }], release: {} },
        turn: props.state.selfId,
        hasDrawn: true,
        playable: ['mine'],
        targets: {},
        comboOptions: {},
      }
      function Table() {
        const [placed, setPlaced] = useState(false)
        return (
          <Board
            {...props}
            state={
              placed
                ? { ...before, you: { ...before.you, hand: [], release: { monitoring: card } } }
                : before
            }
            actions={{
              onPlay: () => {
                accepted()
                setPlaced(true)
              },
            }}
            intro={{
              gameId: 'monitoring-test',
              view,
              onDone: () => {},
              events: placed
                ? [{ id: 1, type: 'placed', player: before.selfId, card: 'protection-monitoring' }]
                : [],
            }}
          />
        )
      }
      render(<Table />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      const slot = document.querySelector('[data-hand-slot]')
      if (!slot) throw new Error('missing hand slot')
      fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
      fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
      for (let time = 0; time < 3000; time += 20) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20)
        })
      }
      expect(accepted).toHaveBeenCalledTimes(1)
      expect(movedStaged).toBe(true)
      expect(document.querySelector('[data-testid="board-centre-staged"]')).toBeNull()
    } finally {
      movement.mockRestore()
      vi.useRealTimers()
    }
  })

  it('does not dispatch a cancelled pull after the same card is pulled again', async () => {
    mockReducedMotion(false)
    vi.useFakeTimers()
    try {
      const base = makeBoardProps().state
      const card = cardById('protection-monitoring')
      if (!card) throw new Error('missing Monitoring')
      const onPlay = vi.fn()
      const state = {
        ...base,
        you: { ...base.you, hand: [{ uid: 'mine', card }] },
        playable: ['mine'],
        targets: {},
        comboOptions: {},
      }
      const { result } = renderHook(() =>
        useBoardStaging({
          state,
          anchors: useBoardAnchors(),
          actions: { onPlay },
          events: [],
          enabled: true,
          matchKey: null,
        }),
      )
      const drop = { x: 1, y: 1, rect: new DOMRect(1, 1, 150, 210) }
      act(() => {
        result.current.onHandPlay('mine', drop)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      act(() => {
        result.current.cancel()
      })
      act(() => {
        result.current.onHandPlay('mine', drop)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SHOW_HOLD - 400)
      })
      expect(onPlay).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(onPlay).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    'protection-monitoring',
    'operation-git-cherry-pick',
    'operation-system-upgrade',
  ])('pulls %s through centre staging instead of requiring a click', (id) => {
    mockReducedMotion(true)
    const base = makeBoardProps().state
    const card = cardById(id)
    if (!card) throw new Error(id)
    const onPlay = vi.fn()
    const state = {
      ...base,
      you: { ...base.you, hand: [{ uid: 'mine', card }] },
      playable: ['mine'],
      targets: {},
      comboOptions: {},
    }
    const { result } = renderHook(() =>
      useBoardStaging({
        state,
        anchors: useBoardAnchors(),
        actions: { onPlay },
        events: [],
        enabled: true,
        matchKey: null,
      }),
    )
    act(() => {
      expect(result.current.onCardClick(0)).toBe(false)
    })
    expect(onPlay).not.toHaveBeenCalled()
    act(() => {
      expect(
        result.current.onHandPlay('mine', { x: 1, y: 1, rect: new DOMRect(1, 1, 150, 210) }),
      ).toBe(true)
    })
    expect(onPlay).toHaveBeenCalledWith('mine', undefined, undefined)
  })
})
