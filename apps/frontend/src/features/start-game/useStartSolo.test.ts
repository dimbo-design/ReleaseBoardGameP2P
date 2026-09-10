import { DEFAULT_SETUP } from '@release/ui'
import { renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import { useStartSolo } from './useStartSolo'

const startSolo = vi.fn()
let session: { startSolo: typeof startSolo }

vi.mock('~/app/providers/SessionProvider', () => ({
  useSession: () => session,
}))

beforeEach(() => {
  startSolo.mockClear()
  session = { startSolo }
})

// The one line under test — `Array.from({ length: bots }, (_, i) =>
// botName(i + 1))` — has no coverage at any value but 1 (CreateLobbyForm.test's
// default), so a regression that seats the wrong count, the wrong order, or
// skips the formatter would pass every other suite silently.
it('turns a bot count into that many names, in order, built through the formatter', () => {
  const { result } = renderHook(() => useStartSolo())
  const botName = vi.fn((n: number) => `Bot ${n}`)

  result.current('Ann', 3, DEFAULT_SETUP, botName)

  expect(botName).toHaveBeenNthCalledWith(1, 1)
  expect(botName).toHaveBeenNthCalledWith(2, 2)
  expect(botName).toHaveBeenNthCalledWith(3, 3)
  expect(startSolo).toHaveBeenCalledWith('Ann', ['Bot 1', 'Bot 2', 'Bot 3'], DEFAULT_SETUP)
})

it('seats a single bot the same way the default slider value does', () => {
  const { result } = renderHook(() => useStartSolo())

  result.current('Ann', 1, DEFAULT_SETUP, (n) => `Bot ${n}`)

  expect(startSolo).toHaveBeenCalledWith('Ann', ['Bot 1'], DEFAULT_SETUP)
})

it('seats the full table at the slider`s maximum', () => {
  const { result } = renderHook(() => useStartSolo())

  result.current('Ann', 5, DEFAULT_SETUP, (n) => `Bot ${n}`)

  expect(startSolo).toHaveBeenCalledWith(
    'Ann',
    ['Bot 1', 'Bot 2', 'Bot 3', 'Bot 4', 'Bot 5'],
    DEFAULT_SETUP,
  )
})
