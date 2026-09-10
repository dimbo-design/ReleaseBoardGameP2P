import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { vi } from 'vitest'
import { MAX_RECONNECT_ATTEMPTS, type UseLobby } from '~/entities/lobby'
import LobbyView from '../_LobbyView'
import LobbyPage from '../[lobbyId]'

// LobbyCode and GameSettings take whole copy objects via returnObjects, so the
// mock has to hand back a shape for those keys rather than echoing the key —
// otherwise their labels render blank and assertions on them are meaningless.
const OBJECT_COPY: Record<string, unknown> = {
  lobbyCode: { label: 'lobbyCode.label', copy: 'lobbyCode.copy', copied: 'lobbyCode.copied' },
}

vi.mock('@release/translation', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { returnObjects?: boolean }) =>
      opts?.returnObjects && OBJECT_COPY[k] ? OBJECT_COPY[k] : k,
    i18n: { language: 'ru', resolvedLanguage: 'ru', changeLanguage: vi.fn() },
  }),
}))

const writeText = vi.fn().mockResolvedValue(undefined)
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText },
  configurable: true,
})

// All the lobby pieces read the session through useSession, so a single mock
// here drives create/join/roster/start behavior.
let sessionValue: UseLobby
vi.mock('~/app/providers/SessionProvider', () => ({
  useSession: () => sessionValue,
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

function renderInRouter(ui: ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

it('shows the invite screen when there is no session', () => {
  sessionValue = base()
  renderInRouter(<LobbyPage />)
  expect(screen.getByText('invite.formTitle')).toBeTruthy()
  expect(screen.getByText('invite.joinCta')).toBeTruthy()
})

it('pre-fills the code from a shared /lobby/:lobbyId link', () => {
  sessionValue = base()
  render(
    <MemoryRouter initialEntries={['/lobby/ABC-23D']}>
      <Routes>
        <Route path="/lobby/:lobbyId" element={<LobbyPage />} />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByDisplayValue('ABC-23D')).toBeTruthy()
})

it('clears a stale error on mount', () => {
  sessionValue = { ...base(), status: 'error', error: 'peer-unavailable', errorKind: 'not-found' }
  renderInRouter(<LobbyPage />)
  expect(sessionValue.clearError).toHaveBeenCalledOnce()
})

it('the invite screen home button resets the (failed) session', () => {
  sessionValue = { ...base(), status: 'error', error: 'peer-unavailable', errorKind: 'not-found' }
  renderInRouter(<LobbyPage />)
  fireEvent.click(screen.getByText('invite.homePage'))
  expect(sessionValue.leaveSession).toHaveBeenCalledOnce()
})

it('shows the kicked message instead of the form', () => {
  sessionValue = { ...base(), status: 'kicked' }
  renderInRouter(<LobbyPage />)
  expect(screen.getByText('lobby.kickedMessage')).toBeTruthy()
  expect(screen.queryByText('lobby.joinTitle')).toBeNull()
})

function inSession(): UseLobby {
  return {
    ...base(),
    status: 'in-lobby',
    roomCode: 'ABC-23D',
    isHost: true,
    state: {
      selfId: 'h',
      hostId: 'h',
      maxPlayers: 4,
      setup: {
        handLimit: 'base',
        releases: 'base',
        releaseCond: 'base',
        ai: 'base',
        gitBranch: 'base',
      },
      peers: {
        h: {
          id: 'h',
          clientId: 'client-h',
          name: 'Host',
          role: 'host',
          ready: true,
          where: 'lobby',
        },
        p1: {
          id: 'p1',
          clientId: 'client-p1',
          name: 'Pat',
          role: 'player',
          ready: false,
          where: 'lobby',
        },
      },
    },
  }
}

it('offers Continue/Leave when arriving with an active session', () => {
  sessionValue = inSession()
  renderInRouter(<LobbyPage />)
  expect(screen.getByText('lobby.activeSession')).toBeTruthy()
  expect(screen.getByText('lobby.continue')).toBeTruthy()
  expect(screen.getByText('lobby.leave')).toBeTruthy()
  // Neither the join form nor the live session view is shown yet.
  expect(screen.queryByText('lobby.joinTitle')).toBeNull()
  expect(screen.queryByText('lobbyScreen.players')).toBeNull()
})

it('Leave from the interstitial tears the session down', () => {
  sessionValue = inSession()
  renderInRouter(<LobbyPage />)
  fireEvent.click(screen.getByText('lobby.leave'))
  expect(sessionValue.leaveSession).toHaveBeenCalledOnce()
})

it('Continue reveals the live session view (room code, roster, copy)', () => {
  sessionValue = inSession()
  renderInRouter(<LobbyPage />)
  fireEvent.click(screen.getByText('lobby.continue'))
  expect(screen.getByText('ABC-23D')).toBeTruthy()
  expect(screen.getByText('Host')).toBeTruthy()
  expect(screen.getByText('Pat')).toBeTruthy()
  expect(screen.getByText('lobbyCode.copy')).toBeTruthy()
})

it('LobbyView guest Leave tears the session down', () => {
  const s = inSession()
  // biome-ignore lint/style/noNonNullAssertion: inSession() always seeds state
  sessionValue = { ...s, isHost: false, state: { ...s.state!, selfId: 'p1' } }
  renderInRouter(<LobbyView />)
  fireEvent.click(screen.getByText('lobbyScreen.leave'))
  expect(sessionValue.leaveSession).toHaveBeenCalledOnce()
})

it('LobbyView host disband confirm tears the session down', () => {
  sessionValue = inSession()
  renderInRouter(<LobbyView />)
  // Header disband opens the confirm modal; the modal's own disband confirms.
  fireEvent.click(screen.getByText('lobbyScreen.disband'))
  const disbandButtons = screen.getAllByText('lobbyScreen.disband')
  fireEvent.click(disbandButtons[disbandButtons.length - 1])
  expect(sessionValue.disband).toHaveBeenCalledOnce()
})

it('LobbyView renders game modes section', () => {
  sessionValue = inSession()
  renderInRouter(<LobbyView />)
  expect(screen.getByText('lobbyScreen.modes')).toBeTruthy()
})

it('LobbyView renders spectator section when guests present', () => {
  sessionValue = {
    ...inSession(),
    state: {
      selfId: 'h',
      hostId: 'h',
      maxPlayers: 4,
      setup: {
        handLimit: 'base',
        releases: 'base',
        releaseCond: 'base',
        ai: 'base',
        gitBranch: 'base',
      },
      peers: {
        h: {
          id: 'h',
          clientId: 'client-h',
          name: 'Host',
          role: 'host',
          ready: true,
          where: 'lobby',
        },
        g1: {
          id: 'g1',
          clientId: 'client-g1',
          name: 'Gus',
          role: 'guest',
          ready: false,
          where: 'lobby',
        },
      },
    },
  }
  renderInRouter(<LobbyView />)
  expect(screen.getByText('Gus')).toBeTruthy()
  expect(screen.getByText('lobbyScreen.roleGuest')).toBeTruthy()
})

// The HUD tone is the lobby's "ready to go" signal. It rides on the same
// canStart the Start button uses, so the green background and an enabled Start
// can never disagree — a mismatch there is exactly what a host would query.
// The copy button hands over the invite LINK, not the bare code — that link is
// what opens the invite screen with the code pre-filled. @release/ui's LobbyCode
// block copies the code, which is why this markup is rendered locally.
it('LobbyView copies the invite link rather than the code', () => {
  sessionValue = inSession()
  const { container } = renderInRouter(<LobbyView />)
  const copyBtn = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'lobbyCode.copy',
  )
  expect(copyBtn).toBeTruthy()
  expect(screen.getByText('ABC-23D')).toBeTruthy()
  fireEvent.click(copyBtn as HTMLButtonElement)
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/lobby/ABC-23D'))
  expect(writeText).not.toHaveBeenCalledWith('ABC-23D')
})

it('LobbyView shows the neutral HUD tone while the game cannot start', () => {
  sessionValue = { ...inSession(), canStart: false }
  const { container } = renderInRouter(<LobbyView />)
  expect(container.querySelector('[data-tone="neutral"]')).toBeTruthy()
  expect(container.querySelector('[data-tone="positive"]')).toBeNull()
})

it('LobbyView turns the HUD tone positive once the game can start', () => {
  sessionValue = { ...inSession(), canStart: true }
  const { container } = renderInRouter(<LobbyView />)
  expect(container.querySelector('[data-tone="positive"]')).toBeTruthy()
  expect(container.querySelector('[data-tone="neutral"]')).toBeNull()
})

it('LobbyView host sees disband button', () => {
  sessionValue = inSession()
  renderInRouter(<LobbyView />)
  expect(screen.getByText('lobbyScreen.disband')).toBeTruthy()
})

it('LobbyView guest does not see disband button', () => {
  sessionValue = { ...inSession(), isHost: false }
  renderInRouter(<LobbyView />)
  expect(screen.queryByText('lobbyScreen.disband')).toBeNull()
})

it('shows the disbanded message instead of the form', () => {
  sessionValue = { ...base(), status: 'disbanded' }
  renderInRouter(<LobbyPage />)
  expect(screen.getByText('lobby.disbandedMessage')).toBeTruthy()
  expect(screen.queryByText('lobby.joinTitle')).toBeNull()
})

it('skips the interstitial when resumed=true', () => {
  sessionValue = inSession()
  render(
    <MemoryRouter initialEntries={[{ pathname: '/lobby/ABC-23D', state: { resumed: true } }]}>
      <LobbyPage />
    </MemoryRouter>,
  )
  expect(screen.queryByText('lobby.activeSession')).toBeNull()
  expect(screen.getByText('ABC-23D')).toBeTruthy()
})

it('walking back from the results screen shows the lobby with everyone still in it', () => {
  // The state the "to lobby" button actually leaves behind: the room is alive
  // and its roster intact, the match id is gone (leaveGame), and the seating the
  // finished match was dealt with is still held. The lobby must show the room,
  // not the join form, and must still list every player.
  sessionValue = {
    ...inSession(),
    gameId: null,
    seats: [
      { playerId: 'p1', peerId: 'h', clientId: 'client-h', name: 'Host' },
      { playerId: 'p2', peerId: 'p1', clientId: 'client-p1', name: 'Pat' },
    ],
  }

  render(
    <MemoryRouter initialEntries={[{ pathname: '/lobby/ABC-23D', state: { resumed: true } }]}>
      <LobbyPage />
    </MemoryRouter>,
  )

  // Not the join form, and not the Continue/Leave interstitial.
  expect(screen.queryByText('invite.formTitle')).toBeNull()
  expect(screen.queryByText('lobby.activeSession')).toBeNull()
  // The room, with its code and both players.
  expect(screen.getByText('ABC-23D')).toBeTruthy()
  expect(screen.getByText('Host')).toBeTruthy()
  expect(screen.getByText('Pat')).toBeTruthy()
})

it('announces the lobby as its whereabouts when arriving back from a match', () => {
  const setWhere = vi.fn()
  sessionValue = { ...inSession(), gameId: null, setWhere }

  render(
    <MemoryRouter initialEntries={[{ pathname: '/lobby/ABC-23D', state: { resumed: true } }]}>
      <LobbyPage />
    </MemoryRouter>,
  )

  // Otherwise everyone else's results table would still show this peer on the
  // results screen after they had left it.
  expect(setWhere).toHaveBeenCalledWith('lobby')
})
