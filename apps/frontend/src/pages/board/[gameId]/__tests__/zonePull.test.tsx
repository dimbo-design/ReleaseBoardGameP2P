import { act, fireEvent, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useZonePull } from '../_useZonePull'

function harness(accepts: (x: number, y: number) => boolean) {
  const onDrop = vi.fn()
  const onCancel = vi.fn()
  const api: { pull?: ReturnType<typeof useZonePull> } = {}
  function Probe() {
    api.pull = useZonePull({ onDrop, onCancel, accepts })
    return (
      <>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: test-only stand-in for the real release-zone card */}
        <div
          data-testid="slot"
          onMouseDown={(e) => api.pull?.begin('frontend', e.currentTarget, e)}
        >
          card
        </div>
        {api.pull.overlay}
      </>
    )
  }
  const view = render(<Probe />)
  return { view, api, onDrop, onCancel }
}

it('hands the drop back to the caller when the pointer let go on the table', () => {
  const { view, onDrop } = harness(() => true)
  fireEvent.mouseDown(view.getByTestId('slot'), { clientX: 10, clientY: 10 })
  act(() => {
    fireEvent.mouseMove(window, { clientX: 400, clientY: 300 })
    fireEvent.mouseUp(window, { clientX: 400, clientY: 300 })
  })
  expect(onDrop).toHaveBeenCalledWith('frontend', expect.objectContaining({ x: 400, y: 300 }))
})

it('cancels when the pointer let go somewhere the caller refuses', () => {
  const { view, onDrop, onCancel } = harness(() => false)
  fireEvent.mouseDown(view.getByTestId('slot'), { clientX: 10, clientY: 10 })
  act(() => fireEvent.mouseUp(window, { clientX: 10, clientY: 700 }))
  expect(onDrop).not.toHaveBeenCalled()
  expect(onCancel).toHaveBeenCalledWith('frontend')
})

it('stops listening once the drag is over', () => {
  const { view, onDrop } = harness(() => true)
  fireEvent.mouseDown(view.getByTestId('slot'), { clientX: 10, clientY: 10 })
  act(() => fireEvent.mouseUp(window, { clientX: 400, clientY: 300 }))
  onDrop.mockClear()
  act(() => fireEvent.mouseUp(window, { clientX: 400, clientY: 300 }))
  expect(onDrop).not.toHaveBeenCalled()
})

it('tears down its window listeners and rAF when unmounted mid-drag, with no mouseup ever firing', () => {
  const removeSpy = vi.spyOn(window, 'removeEventListener')
  const cafSpy = vi.spyOn(window, 'cancelAnimationFrame')
  const { view, onDrop, onCancel } = harness(() => true)
  fireEvent.mouseDown(view.getByTestId('slot'), { clientX: 10, clientY: 10 })
  act(() => {
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 })
  })

  view.unmount()

  expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
  expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))
  expect(cafSpy).toHaveBeenCalled()

  // Prove the listeners are actually gone, not just that removal was
  // attempted: a mousemove/mouseup after unmount must reach no handler.
  act(() => {
    fireEvent.mouseMove(window, { clientX: 500, clientY: 500 })
    fireEvent.mouseUp(window, { clientX: 500, clientY: 500 })
  })
  expect(onDrop).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()

  removeSpy.mockRestore()
  cafSpy.mockRestore()
})
