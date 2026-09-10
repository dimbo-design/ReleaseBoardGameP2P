import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { vi } from 'vitest'
import { MAX_RECONNECT_ATTEMPTS, type UseLobby } from '~/entities/lobby'
import InviteScreen from '../_InviteScreen'

vi.mock('@release/translation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { resolvedLanguage: 'en', changeLanguage: vi.fn() },
  }),
}))

let sessionValue: UseLobby
vi.mock('~/app/providers/SessionProvider', () => ({
  useSession: () => sessionValue,
}))

// useGoToLobby (Task 1's navigation helper) and the screen's own "home" button
// both call useNavigate from the generouted router — mocked here so the
// rejected-submit test can assert navigation never fired.
const navigateMock = vi.fn()
vi.mock('~/app/router', () => ({
  useNavigate: () => navigateMock,
}))

function base(): UseLobby {
  return {
    state: null,
    status: 'idle',
    restoring: false,
    reconnect: {
      attempt: 0,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      status: 'idle',
      events: [],
      retry: vi.fn(),
    },
    roomCode: null,
    isHost: false,
    canStart: false,
    gameId: null,
    gameLink: null,
    gameSync: null,
    seats: [],
    error: null,
    errorKind: null,
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    ready: vi.fn(),
    setWhere: vi.fn(),
    kick: vi.fn(),
    setMaxPlayers: vi.fn(),
    startGame: vi.fn(),
    introReady: vi.fn(),
    transferHost: vi.fn(),
    setSetup: vi.fn(),
    disband: vi.fn(),
    leaveSession: vi.fn(),
    leaveGame: vi.fn(),
    clearError: vi.fn(),
  }
}

const joined = (peers: Record<string, unknown>): UseLobby =>
  ({
    ...base(),
    status: 'in-lobby',
    roomCode: 'F96-NMT',
    state: { selfId: 'me', hostId: 'h', maxPlayers: 6, setup: {}, peers },
  }) as UseLobby

const renderScreen = () =>
  render(
    <MemoryRouter>
      <InviteScreen />
    </MemoryRouter>,
  )

// Renders at /lobby/:lobbyId so the code field pre-fills from the route param —
// the same idiom lobby.test.tsx uses for its "pre-fills the code" case.
// `nickname` mirrors what useGoToLobby hands over from the start-screen modal.
const renderAtLobby = (code: string, nickname?: string) =>
  render(
    <MemoryRouter
      initialEntries={[{ pathname: `/lobby/${code}`, state: nickname ? { nickname } : undefined }]}
    >
      <Routes>
        <Route path="/lobby/:lobbyId" element={<InviteScreen />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  navigateMock.mockClear()
})

it('shows the form when there is no session', () => {
  sessionValue = base()
  renderScreen()
  expect(screen.getByText('invite.formTitle')).toBeTruthy()
  expect(screen.getByText('invite.joinCta')).toBeTruthy()
})

it('disables the spectator role, since guest mode is not supported yet', () => {
  sessionValue = base()
  renderScreen()
  expect(screen.getByText('invite.roleSpectator').closest('button')?.disabled).toBe(true)
  expect(screen.getByText('invite.rolePlayer').closest('button')?.disabled).toBe(false)
})

it('shows the connecting state with a cancel action', () => {
  sessionValue = { ...base(), status: 'connecting' }
  renderScreen()
  expect(screen.getByText('invite.connecting')).toBeTruthy()
  expect(screen.getByText('invite.cancel')).toBeTruthy()
})

it('shows the connected state until the roster arrives', () => {
  sessionValue = joined({ me: { id: 'me', name: 'Me', role: 'guest', ready: false } })
  renderScreen()
  expect(screen.getByText('invite.connected')).toBeTruthy()
})

// Pins the roster-presence half of the condition: `rosterPending` must flip
// off once the host itself shows up in `peers`, or the green banner (and a
// host's own view of the screen) would never clear. Without this, swapping
// the guard for a plain `status === 'in-lobby'` still passes every other test.
it('leaves the connected state once the host roster arrives', () => {
  sessionValue = joined({
    h: { id: 'h', name: 'Host', role: 'host', ready: true },
    me: { id: 'me', name: 'Me', role: 'guest', ready: false },
  })
  renderScreen()
  expect(screen.queryByText('invite.connected')).toBeNull()
  expect(screen.getByText('invite.joinCta')).toBeTruthy()
})

it('shows the not-found status for an unknown code', () => {
  sessionValue = {
    ...base(),
    status: 'error',
    error: 'peer-unavailable: x',
    errorKind: 'not-found',
  }
  renderScreen()
  expect(screen.getByText('invite.notFoundStatus')).toBeTruthy()
  expect(screen.getByText('invite.retry')).toBeTruthy()
})

it('shows the generic failure status for a connection error', () => {
  sessionValue = { ...base(), status: 'error', error: 'network: x', errorKind: 'connection' }
  renderScreen()
  expect(screen.getByText('invite.connectError')).toBeTruthy()
  expect(screen.getByText('invite.retry')).toBeTruthy()
})

it('never leaks the raw PeerJS error string', () => {
  sessionValue = {
    ...base(),
    status: 'error',
    error: 'peer-unavailable: x',
    errorKind: 'not-found',
  }
  renderScreen()
  expect(screen.queryByText(/peer-unavailable/)).toBeNull()
})

it('cancelling a connection tears the session down', () => {
  sessionValue = { ...base(), status: 'connecting' }
  renderScreen()
  fireEvent.click(screen.getByText('invite.cancel'))
  expect(sessionValue.leaveSession).toHaveBeenCalledOnce()
})

// Code is pre-filled via the route so the nickname is the ONLY missing
// required field — pins the Form required-path specifically, rather than
// passing for any of several reasons (both fields empty, click not wired, etc).
it('does not join when the nickname is empty', () => {
  sessionValue = base()
  renderAtLobby('F96-NMT')
  fireEvent.click(screen.getByText('invite.joinCta'))
  expect(sessionValue.joinRoom).not.toHaveBeenCalled()
})

// Pins the submit path end to end: joinRoom's argument order (code first,
// nickname second — both are `string`, so a swap type-checks fine and would
// only ever show up here).
it('submits with the code first and the nickname second', () => {
  sessionValue = { ...base(), joinRoom: vi.fn().mockResolvedValue('F96-NMT') }
  renderAtLobby('F96-NMT')
  fireEvent.change(screen.getByLabelText('invite.nicknameLabel'), { target: { value: 'Ann' } })
  fireEvent.click(screen.getByText('invite.joinCta'))
  expect(sessionValue.joinRoom).toHaveBeenCalledWith('F96-NMT', 'Ann')
})

// Pins the silent catch: a rejected joinRoom must leave the form up and must
// never call goToLobby's navigate — without this, an unconditional
// goToLobby(formatted) after the await would go unnoticed.
it('stays on the form and does not navigate when the join rejects', async () => {
  sessionValue = {
    ...base(),
    joinRoom: vi.fn().mockRejectedValue(new Error('peer-unavailable: x')),
  }
  renderAtLobby('F96-NMT')
  fireEvent.change(screen.getByLabelText('invite.nicknameLabel'), { target: { value: 'Ann' } })
  fireEvent.click(screen.getByText('invite.joinCta'))

  await waitFor(() => expect(sessionValue.joinRoom).toHaveBeenCalledWith('F96-NMT', 'Ann'))
  // let the rejected promise's catch run before asserting on its aftermath
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(navigateMock).not.toHaveBeenCalled()
  expect(screen.getByText('invite.joinCta')).toBeTruthy()
})

it('pre-fills the nickname handed over from the start-screen join modal', () => {
  sessionValue = base()
  renderAtLobby('F96-NMT', 'Ann')
  expect(screen.getByDisplayValue('Ann')).toBeTruthy()
  expect(screen.getByDisplayValue('F96-NMT')).toBeTruthy()
})

it('keeps the handed-over nickname when the join fails on arrival', () => {
  sessionValue = {
    ...base(),
    status: 'error',
    error: 'peer-unavailable: x',
    errorKind: 'not-found',
  }
  renderAtLobby('F96-NMT', 'Ann')
  // The user must be able to hit retry without retyping what they entered.
  expect(screen.getByText('invite.notFoundStatus')).toBeTruthy()
  expect(screen.getByDisplayValue('Ann')).toBeTruthy()
})

it('leaves the nickname empty when arriving straight from an invite link', () => {
  sessionValue = base()
  renderAtLobby('F96-NMT')
  expect(screen.queryByDisplayValue('Ann')).toBeNull()
})
