import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ELIMINATION_CLIPS, useEliminationPreload } from './eliminateBeat'

// The clips are fetched ahead of the moment they are needed (#126 review):
// today the first byte is asked for exactly when the overlay is already on
// screen, which is where both "loading eats the clip's budget" and the risk of
// an empty overlay come from.
const fetched: string[] = []
let idle: (() => void) | null = null
let scheduled = 0

beforeEach(() => {
  fetched.length = 0
  idle = null
  scheduled = 0
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      fetched.push(String(url))
      return Promise.resolve({ ok: true } as Response)
    }),
  )
  // Idle is the point — the fetch must not compete with the board — so the
  // callback is captured and fired by hand rather than waited for.
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
    scheduled++
    idle = cb
    return 1
  })
  vi.stubGlobal('cancelIdleCallback', () => {
    idle = null
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function Probe({ enabled }: { enabled: boolean }) {
  useEliminationPreload(enabled)
  return null
}

it('fetches every clip once the match is running, at idle', () => {
  render(<Probe enabled />)
  expect(fetched).toEqual([]) // not yet — idle has not come round
  act(() => idle?.())
  // ALL of them: which clip comes up is known only at the elimination itself
  expect(fetched.sort()).toEqual([...ELIMINATION_CLIPS].sort())
})

it('fetches nothing until the match is running', () => {
  render(<Probe enabled={false} />)
  expect(idle).toBeNull()
  expect(fetched).toEqual([])
})

it('does not queue a second pass on a re-render', () => {
  const { rerender } = render(<Probe enabled />)
  act(() => idle?.())
  expect(scheduled).toBe(1)
  rerender(<Probe enabled />)
  expect(scheduled).toBe(1) // the board re-renders constantly; this must not follow
  expect(fetched.length).toBe(ELIMINATION_CLIPS.length)
})

// Belt to that brace: even if something did fire the callback twice, the fetch
// happens once — the board re-renders often enough that "scheduled once" should
// not be the only thing standing between it and a repeated 1.9MB fetch.
it('fetches once even if idle comes round twice', () => {
  render(<Probe enabled />)
  act(() => idle?.())
  act(() => idle?.())
  expect(fetched.length).toBe(ELIMINATION_CLIPS.length)
})
