import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import CreateLobbyForm from './CreateLobbyForm'

vi.mock('@release/translation', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      typeof o?.returnObjects === 'boolean' || k === 'gameModes' ? {} : `${k}${o?.n ?? ''}`,
  }),
}))

const startSolo = vi.fn()
const createLobby = vi.fn()
vi.mock('./useCreateLobby', () => ({ useCreateLobby: () => createLobby }))
vi.mock('~/features/start-game/useStartSolo', () => ({ useStartSolo: () => startSolo }))
vi.mock('~/app/lib/lobbyNavigation', () => ({ useGoToLobby: () => vi.fn() }))
vi.mock('~/app/providers/SessionProvider', () => ({
  useSession: () => ({ status: 'idle', error: null }),
}))

it('starts a solo match with the chosen number of bots, and opens no room', () => {
  render(<CreateLobbyForm />)
  fireEvent.change(screen.getByLabelText('start.nicknameLabel'), { target: { value: 'Ann' } })
  fireEvent.click(screen.getByText('start.soloCta'))

  expect(createLobby).not.toHaveBeenCalled()
  expect(startSolo).toHaveBeenCalledWith('Ann', 1, expect.any(Object), expect.any(Function))
})
