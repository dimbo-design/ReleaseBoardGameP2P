import type { PlayerView } from '@release/engine'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { vi } from 'vitest'
import type { PeerInfo, Seat, UseLobby } from '~/network'
import LobbyPage from '~/pages/lobby/[lobbyId]'
import StatsPage from '../stats'

// The "to lobby" button, end to end and WITHOUT mocking the navigation. The
// other stats tests stub useGoToLobby, so they prove the button calls something
// — not that the something lands on a live lobby still showing everybody.
//
// The load-bearing detail is `state: { resumed: true }`, which useGoToLobby
// attaches: LobbyPage seeds `continued` from it, and without it a peer arriving
// on a session that is already live gets the Continue/Leave interstitial
// instead of the room.

const OBJECT_COPY: Record<string, unknown> = {
  lobbyCode: { label: 'lobbyCode.label', copy: 'lobbyCode.copy', copied: 'lobbyCode.copied' },
}

vi.mock('@release/translation', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { returnObjects?: boolean }) =>
      opts?.returnObjects && OBJECT_COPY[k] ? OBJECT_COPY[k] : k,
    i18n: { language: 'en', resolvedLanguage: 'en', changeLanguage: vi.fn() },
  }),
}))

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  configurable: true,
})

const PEERS: Record<string, PeerInfo> = {
  h: { id: 'h', clientId: 'client-h', name: 'Ann', role: 'host', ready: true, where: 'stats' },
  g: { id: 'g', clientId: 'client-g', name: 'Bo', role: 'player', ready: true, where: 'game' },
}
// `clientId` is the seat's durable owner, so each seat carries the client of the
// peer holding it — `peerId` is rewritten by a rebind, this is not (#110).
const SEATS: Seat[] = [
  { playerId: 'p1', peerId: 'g', clientId: 'client-g', name: 'Bo' },
  { playerId: 'p2', peerId: 'h', clientId: 'client-h', name: 'Ann' },
]
const zero = { attack: 0, defense: 0, ddos: 0, ai: 0, err503: 0, cherryPick: 0, attackedInto: 0 }

let session: UseLobby

vi.mock('~/app/providers/SessionProvider', () => ({ useSession: () => session }))
vi.mock('~/features/play-game/useGame', () => ({
  useGame: () => ({
    view: {
      over: { winner: 'p2', condition: 'release' },
      tally: { p1: { ...zero, attack: 2 }, p2: { ...zero, attack: 4 } },
    } as unknown as PlayerView,
    events: [],
  }),
}))

function makeSession(over: Partial<UseLobby> = {}): UseLobby {
  return {
    state: { selfId: 'h', hostId: 'h', maxPlayers: 4, setup: {}, peers: { ...PEERS } },
    status: 'in-lobby',
    roomCode: 'ABC-23D',
    isHost: true,
    canStart: true,
    gameId: 'h-1',
    gameLink: null,
    gameSync: null,
    seats: SEATS,
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
    ...over,
  } as UseLobby
}

function renderFlow() {
  return render(
    <MemoryRouter initialEntries={['/board/h-1/stats']}>
      <Routes>
        <Route path="/board/:gameId/stats" element={<StatsPage />} />
        <Route path="/lobby/:lobbyId" element={<LobbyPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  session = makeSession()
})

it('lands on the live lobby, still showing every player', () => {
  // leaveGame is what the real hook does: clear the match id, keep the room.
  session = makeSession({
    leaveGame: vi.fn(() => {
      session = makeSession({ gameId: null, leaveGame: session.leaveGame })
    }),
  })

  renderFlow()
  expect(screen.getByTestId('stats-page')).toBeTruthy()

  fireEvent.click(screen.getByText('stats.toLobby'))

  // The room, not the join form and not the Continue/Leave interstitial.
  expect(screen.queryByTestId('stats-page')).toBeNull()
  expect(screen.queryByText('invite.formTitle')).toBeNull()
  expect(screen.queryByText('lobby.activeSession')).toBeNull()
  expect(screen.getByText('ABC-23D')).toBeTruthy()
  // Everyone who was in the room is still listed.
  expect(screen.getByText('Ann')).toBeTruthy()
  expect(screen.getByText('Bo')).toBeTruthy()
})

it('clears the match before navigating, so the follower cannot bounce it back', () => {
  const leaveGame = vi.fn()
  session = makeSession({ leaveGame })

  renderFlow()
  fireEvent.click(screen.getByText('stats.toLobby'))

  expect(leaveGame).toHaveBeenCalledTimes(1)
})

it('goes to the start screen when there is no room left to return to', () => {
  // Reachable by reloading on this route: the session goes, so the screen is
  // already empty and there is no lobby to walk back to. Without this the
  // button is inert and the player is stranded on a blank results page.
  session = makeSession({ roomCode: null, state: null, seats: [] })

  render(
    <MemoryRouter initialEntries={['/board/h-1/stats']}>
      <Routes>
        <Route path="/board/:gameId/stats" element={<StatsPage />} />
        <Route path="/lobby/:lobbyId" element={<LobbyPage />} />
        <Route path="/start" element={<div>start screen</div>} />
      </Routes>
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByText('stats.toLobby'))

  expect(screen.getByText('start screen')).toBeTruthy()
  expect(screen.queryByTestId('stats-page')).toBeNull()
})
