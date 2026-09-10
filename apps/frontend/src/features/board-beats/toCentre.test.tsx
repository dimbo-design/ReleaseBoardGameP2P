import { cardById } from '@release/ui'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TABLE_HOLD, useToCentre } from './toCentre'

const RECT = (left: number, top: number) => ({ left, top, width: 150, height: 210 })

// `toSlot` spans a real `nextFrames()` (two rAF ticks) inside `raise`, and
// React defers every update queued inside one async `act()` scope until that
// scope's own promise settles — so a naive `act(async () => await toSlot())`
// would never see the flyer mount mid-flight, and `elOf(key)` would read null
// the whole way through. Same shape as `useDiscardExit.test.tsx`'s `drive`.
async function drive<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers()
  try {
    let done = false
    const finished = run()
    // Deliberately not awaited here — the point is to keep pumping fake
    // timers below until it settles, not to block on it now.
    void finished.finally(() => {
      done = true
    })
    while (!done) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20)
      })
    }
    // `finished` has already settled by the time the loop above exits — this
    // just reads the value (or rethrows) without needing a non-null assertion.
    return await finished
  } finally {
    vi.useRealTimers()
  }
}

describe('useToCentre', () => {
  it('raises the card at `from`, flies it, and reports the slot it was pinned to', async () => {
    // An object with an optional property, mutated inside the closure, not a
    // reassigned `let` — TS narrows a reassigned `let` to its DECLARED value at
    // read points outside the closure that sets it (`useDiscardExit.test.tsx`
    // uses the same shape for the same reason).
    const api: { step?: ReturnType<typeof useToCentre> } = {}
    function Harness() {
      api.step = useToCentre()
      return <>{api.step.overlay}</>
    }
    render(<Harness />)
    const card = cardById('trigger-ai')
    if (!card) throw new Error('trigger-ai not found in the catalogue')
    const { step } = api
    if (!step) throw new Error('useToCentre did not mount')
    const landed = await drive(() =>
      step.toSlot({
        key: 'draw',
        card,
        from: RECT(0, 0),
        to: RECT(400, 300),
      }),
    )
    expect(landed).toEqual(RECT(400, 300))
    const el = step.elOf('draw')
    expect(el).not.toBeNull()
    // I4 — the landed card IS at its rect, in the DOM and not just in the
    // return value, so the next leg starts from where it stands. Deleting the
    // `pin(key, to)` call inside `toSlot` would not fail the assertions above
    // it (the promise still resolves with `to`, and `elOf` still finds the
    // node raise() mounted) — only this one catches it.
    expect(el?.style.left).toBe('400px')
  })

  it("holds the scene's own value, not a number of its own", () => {
    expect(TABLE_HOLD).toBe(2600)
  })
})
