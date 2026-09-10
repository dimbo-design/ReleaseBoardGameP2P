import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from '@release/engine/fake'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'
import type { UseLobby } from '~/entities/lobby'
import { MAX_RECONNECT_ATTEMPTS } from '~/entities/lobby'
import BoardPage from '../index'

// Same opening-collapse mock board.test.tsx uses, for the same reason: this
// suite is about presence, not the deal's choreography.
vi.mock('~/shared/lib/useReducedMotion', () => ({ useReducedMotion: () => true }))

let sessionValue: UseLobby
vi.mock('~/app/providers/SessionProvider', () => ({
  useSession: () => sessionValue,
}))

// Mirrors board.test.tsx's own `session()` fixture, extended with the
// reconnect fields this task wires up — a fixture from before this task never
// set them, because nothing in the page read them yet.
function session(overrides: Partial<UseLobby> = {}): UseLobby {
  return {
    state: { selfId: 'me', hostId: 'me', maxPlayers: 6, setup: {}, peers: {} },
    status: 'in-lobby',
    roomCode: 'YTG-N2Q',
    isHost: true,
    seats: [],
    restoring: false,
    reconnect: {
      attempt: 0,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      status: 'idle',
      events: [],
      retry: vi.fn(),
    },
    kick: vi.fn(),
    setWhere: vi.fn(),
    leaveGame: vi.fn(),
    ...overrides,
  } as unknown as UseLobby
}

function renderBoardWith(path = '/board/g1') {
  const router = createMemoryRouter([{ path: '/board/:gameId', element: <BoardPage /> }], {
    initialEntries: [path],
  })
  return { router, ...render(<RouterProvider router={router} />) }
}

// A real projection, built the same way the other board tests build one — the
// point is a live table with an actual opponent seat, not a mock shape.
function realView(playerId: 'p1' | 'p2' = 'p1') {
  const engine = createFakeEngine()
  const state = engine.createGame({
    gameId: 'g1',
    seed: 7,
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  return engine.project(state, playerId)
}

it('keeps a dropped player on the table and marks the seat offline', async () => {
  // Two seats frozen at the deal; Bo's peer has dropped out of the live
  // roster (applyPeerLeft prunes it the instant its channel drops), but the
  // seat itself — dealt once, held for the match — still exists.
  sessionValue = session({
    state: {
      selfId: 'me',
      hostId: 'me',
      maxPlayers: 6,
      setup: {},
      peers: {
        me: {
          id: 'me',
          clientId: 'client-me',
          name: 'Ann',
          role: 'host',
          ready: true,
          where: 'game',
        },
      },
    },
    seats: [
      { playerId: 'p1', peerId: 'me', clientId: 'client-me', name: 'Ann' },
      { playerId: 'p2', peerId: 'gone', clientId: 'client-bo', name: 'Bo' },
    ],
    gameSync: { view: realView('p1'), events: [] },
  } as Partial<UseLobby>)

  renderBoardWith()

  // The seat survives its connection: built from the seating, not the roster.
  expect(await screen.findByText('Bo')).toBeTruthy()
  // Matched bilingually (real catalogs, no i18n mock — matching board.test.tsx's
  // own idiom) rather than pinned to one language's string.
  expect(await screen.findByText(/^(offline|нет связи)$/i)).toBeTruthy()
})

it('shows the reconnect overlay while the host is restoring the match', async () => {
  // `restoring` is the host's half of the overlay (a guest's is
  // `reconnect.status`) — set alone, with no gameSync at all, the way a host
  // reload actually starts: the session exists before anything syncs.
  sessionValue = session({ restoring: true })
  renderBoardWith()
  expect(await screen.findByTestId('board-page')).toBeTruthy()
  expect(await screen.findByText(/^(reconnecting…|переподключение…)$/i)).toBeTruthy()
})

it('shows the reconnect overlay while a guest is dialing its way back', async () => {
  // The guest's half — `restoring` stays false, `reconnect.status` carries it.
  sessionValue = session({ reconnect: { ...session().reconnect, status: 'trying', attempt: 1 } })
  renderBoardWith()
  expect(await screen.findByText(/^(reconnecting…|переподключение…)$/i)).toBeTruthy()
})

it('stays online once the roster is complete and nothing is reconnecting', () => {
  sessionValue = session({
    state: {
      selfId: 'me',
      hostId: 'me',
      maxPlayers: 6,
      setup: {},
      peers: {
        me: {
          id: 'me',
          clientId: 'client-me',
          name: 'Ann',
          role: 'host',
          ready: true,
          where: 'game',
        },
      },
    },
    seats: [{ playerId: 'p1', peerId: 'me', clientId: 'client-me', name: 'Ann' }],
  } as Partial<UseLobby>)
  renderBoardWith()
  expect(screen.queryByText(/^(reconnecting…|переподключение…)$/i)).toBeNull()
})
