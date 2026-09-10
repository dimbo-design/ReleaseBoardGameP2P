import type { PlayerView } from '@release/engine'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { PeerInfo, Seat } from '~/network'
import StatsPage from '../stats'

const goToLobby = vi.fn()
const leaveGame = vi.fn()
const setWhere = vi.fn()

let view: PlayerView | null
let peers: Record<string, PeerInfo>
let seats: Seat[]
let selfId: string

vi.mock('@release/translation', () => ({
  useTranslation: () => ({
    // The screen is i18n-agnostic and takes copy as props, so echoing the key
    // is enough to assert which copy reached which slot.
    t: (k: string, opts?: { returnObjects?: boolean }) => (opts?.returnObjects ? {} : k),
    i18n: { resolvedLanguage: 'en', changeLanguage: () => Promise.resolve() },
  }),
}))
vi.mock('~/app/lib/lobbyNavigation', () => ({ useLeaveMatch: () => goToLobby }))
vi.mock('~/app/providers/SessionProvider', () => ({
  useSession: () => ({
    state: { selfId, peers, hostId: 'peer-a' },
    roomCode: 'ROOM',
    // The seating frozen at the deal, as the session holds it (#19) — not
    // something this page derives from a roster that changes under it.
    seats,
    leaveGame,
    setWhere,
  }),
}))
vi.mock('~/features/play-game/useGame', () => ({ useGame: () => ({ view, events: [] }) }))

const zero = { attack: 0, defense: 0, ddos: 0, ai: 0, err503: 0, cherryPick: 0, attackedInto: 0 }

beforeEach(() => {
  goToLobby.mockClear()
  leaveGame.mockClear()
  setWhere.mockClear()
  selfId = 'peer-a'
  peers = {
    'peer-a': {
      id: 'peer-a',
      clientId: 'client-a',
      name: 'Ann',
      role: 'host',
      ready: true,
      where: 'stats',
    },
    'peer-b': {
      id: 'peer-b',
      clientId: 'client-b',
      name: 'Bo',
      role: 'player',
      ready: true,
      where: 'lobby',
    },
  }
  seats = [
    { playerId: 'p1', peerId: 'peer-a', clientId: 'client-a', name: 'Ann' },
    { playerId: 'p2', peerId: 'peer-b', clientId: 'client-b', name: 'Bo' },
  ]
  view = {
    over: { winner: 'p1', condition: 'release' },
    tally: { p1: { ...zero, attack: 5 }, p2: { ...zero, defense: 3 } },
  } as unknown as PlayerView
})

it('names the winner by resolving the engine seat back to a peer', () => {
  render(<StatsPage />)
  // The frozen seating says p1 is peer-a.
  expect(screen.getAllByText('Ann').length).toBeGreaterThan(0)
})

it('reads the seating the match was dealt with, not the roster still connected', () => {
  // Three peers were dealt in as p1/p2/p3 and the middle one dropped mid-match.
  // The roster is pruned on disconnect (network/useLobby.ts onDisconnect), so a
  // seating recomputed here would make Cid p2 — printing Bo's counters under
  // Cid's name, dropping Bo from the match entirely, and leaving the winning
  // seat p3 unresolved so the winner block would not render at all.
  selfId = 'aaa'
  seats = [
    { playerId: 'p1', peerId: 'aaa', clientId: 'client-aaa', name: 'Ann' },
    { playerId: 'p2', peerId: 'bbb', clientId: 'client-bbb', name: 'Bo' },
    { playerId: 'p3', peerId: 'ccc', clientId: 'client-ccc', name: 'Cid' },
  ]
  peers = {
    aaa: {
      id: 'aaa',
      clientId: 'client-aaa',
      name: 'Ann',
      role: 'host',
      ready: true,
      where: 'stats',
    },
    ccc: {
      id: 'ccc',
      clientId: 'client-ccc',
      name: 'Cid',
      role: 'player',
      ready: true,
      where: 'stats',
    },
  }
  view = {
    over: { winner: 'p3', condition: 'release' },
    tally: {
      p1: { ...zero, attack: 11 },
      p2: { ...zero, attack: 22 },
      p3: { ...zero, attack: 33 },
    },
  } as unknown as PlayerView

  const { container } = render(<StatsPage />)
  const rows = Array.from(container.querySelectorAll('li')).map((li) => li.textContent ?? '')

  expect(rows).toHaveLength(3)
  // Every seat keeps its own counters, in the order the match was dealt.
  expect(rows[0]).toContain('Ann')
  expect(rows[0]).toContain('11')
  // The player who left keeps their row, their number, and reads offline.
  expect(rows[1]).toContain('Bo')
  expect(rows[1]).toContain('22')
  expect(rows[1]).toContain('stats.location.offline')
  expect(rows[2]).toContain('Cid')
  expect(rows[2]).toContain('33')
  // And the winning seat still resolves to a peer, so the block renders.
  expect(screen.getByText('stats.winnerLabel')).toBeTruthy()
  expect(screen.getAllByText('Cid').length).toBeGreaterThan(1)
})

it('falls back to the roster when the session holds no seating', () => {
  // A reload loses the session, so there is no frozen seating to read. Degrading
  // to today's roster shows a partial result; refusing to seat anyone shows none.
  seats = []
  render(<StatsPage />)
  expect(screen.getAllByText('Ann').length).toBeGreaterThan(0)
  expect(screen.getByText('5')).toBeTruthy()
})

it("shows every seat's counters", () => {
  render(<StatsPage />)
  expect(screen.getByText('5')).toBeTruthy()
  expect(screen.getByText('3')).toBeTruthy()
})

it('announces that this peer is on the results screen', () => {
  render(<StatsPage />)
  expect(setWhere).toHaveBeenCalledWith('stats')
})

it('leaves the match before navigating, so the follower does not bounce it back', () => {
  render(<StatsPage />)
  fireEvent.click(screen.getByText('stats.toLobby'))
  expect(leaveGame).toHaveBeenCalledTimes(1)
  expect(goToLobby).toHaveBeenCalledWith('ROOM')
})

it('renders an empty result rather than crashing when there is no projection', () => {
  // A spectator holds no seat and is never projected to; a reload loses the
  // session entirely. Both land here.
  view = null
  render(<StatsPage />)
  expect(screen.getByTestId('stats-page')).toBeTruthy()
  expect(screen.queryByText('Ann')).toBeNull()
})
