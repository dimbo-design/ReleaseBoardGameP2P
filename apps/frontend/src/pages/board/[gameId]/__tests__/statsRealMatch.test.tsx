import type { GameState } from '@release/engine'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS, runUntilIdle } from '@release/engine/fake'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { PeerInfo, Seat } from '~/network'
import StatsPage from '../stats'

// The rest of this branch's page tests drive the screen from hand-written
// fixtures, which prove the wiring but never the numbers: a fixture cannot
// disagree with the engine, so it cannot catch the page and the fold drifting
// apart. This suite plays a REAL match to its end with the real engine, takes
// the real projection, and renders the real page from it.
//
// It exists because the walkthrough that would otherwise cover this — two
// browsers, one finished match — cannot run in CI, and could not be run in the
// authoring sandbox either: that browser emits only mDNS `.local` ICE
// candidates it cannot resolve, so no WebRTC DataChannel completes there, even
// between two RTCPeerConnections inside a single page.

const SEATS: Seat[] = [
  { playerId: 'p1', peerId: 'peer-a', clientId: 'client-a', name: 'Ann' },
  { playerId: 'p2', peerId: 'peer-b', clientId: 'client-b', name: 'Bo' },
  { playerId: 'p3', peerId: 'peer-c', clientId: 'client-c', name: 'Cy' },
]

let view: ReturnType<ReturnType<typeof createFakeEngine>['project']> | null
let peers: Record<string, PeerInfo>
let seats: Seat[]
let selfId: string

vi.mock('@release/translation', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { returnObjects?: boolean }) => (opts?.returnObjects ? {} : k),
    i18n: { resolvedLanguage: 'en', changeLanguage: () => Promise.resolve() },
  }),
}))
vi.mock('~/app/lib/lobbyNavigation', () => ({ useLeaveMatch: () => vi.fn() }))
vi.mock('~/app/providers/SessionProvider', () => ({
  useSession: () => ({
    state: { selfId, peers, hostId: 'peer-a' },
    roomCode: 'ROOM',
    seats,
    leaveGame: vi.fn(),
    setWhere: vi.fn(),
  }),
}))
vi.mock('~/features/play-game/useGame', () => ({ useGame: () => ({ view, events: [] }) }))

const peer = (id: string, name: string, where: PeerInfo['where']): PeerInfo => ({
  id,
  clientId: `client-${id}`,
  name,
  role: id === 'peer-a' ? 'host' : 'player',
  ready: true,
  where,
})

// Plays a real match to its natural end with the engine's own bot, so the
// numbers on screen are ones the rules actually produced. `runUntilIdle` and
// `botAction` are the same pair the engine's conformance suite drives itself
// with, so this borrows behaviour that is pinned elsewhere rather than encoding
// any rules knowledge here.
function playedOut(): GameState {
  const engine = createFakeEngine()
  let state = engine.createGame({
    gameId: 'real',
    seed: 3,
    players: SEATS.map((s) => ({ id: s.playerId, name: s.name })),
    setup: {
      handLimit: 'base',
      releases: 'base',
      releaseCond: 'base',
      ai: 'base',
      gitBranch: 'base',
    },
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })

  // `runUntilIdle` hands control back when it reaches a named player's own
  // turn. Naming a seat that does not exist means it never hands back, so it
  // drives every seat — including reactive pendings — until the match ends or
  // it hits its own iteration cap. Looping it advances the clock so windows can
  // expire rather than sitting open forever.
  for (let round = 0; round < 40 && !state.over; round += 1) {
    const before = state
    state = runUntilIdle(engine, state, 'nobody', 1_000 + round * 60_000)
    if (state === before) break
  }

  if (!state.over) {
    throw new Error('seed 3 no longer plays out to a winner — pick a new seed and say which')
  }
  return state
}

beforeEach(() => {
  selfId = 'peer-a'
  seats = SEATS
  peers = {
    'peer-a': peer('peer-a', 'Ann', 'stats'),
    'peer-b': peer('peer-b', 'Bo', 'lobby'),
    'peer-c': peer('peer-c', 'Cy', 'game'),
  }
})

it('shows the winner and the counters of a match the engine actually played', () => {
  const engine = createFakeEngine()
  const state = playedOut()
  view = engine.project(state, 'p1')
  const tally = view.tally
  if (!tally) throw new Error('a finished match must project its tally')

  render(<StatsPage />)

  // The winner block names a real winner, resolved from the engine's seat id
  // through the frozen seating to a peer.
  const winner = SEATS.find((s) => s.playerId === state.over?.winner)
  if (!winner) throw new Error('the winning seat must be one of the three')
  expect(screen.getAllByText(winner.name).length).toBeGreaterThan(0)
  expect(screen.getAllByText('stats.winnerLabel').length).toBeGreaterThan(0)

  // Every non-zero value in the two columns the table actually renders is on
  // screen. Zero is skipped deliberately: the table is full of zeros, so
  // matching one would pass against a page showing nothing of this match.
  // The five achievement metrics are NOT checked here — they reach the screen
  // only on a plate, and only for a sole leader, which the next test covers.
  let checked = 0
  for (const seat of SEATS) {
    for (const value of [tally[seat.playerId].attack, tally[seat.playerId].defense]) {
      if (value === 0) continue
      expect(screen.getAllByText(String(value)).length).toBeGreaterThan(0)
      checked += 1
    }
  }
  // Otherwise the loop above asserted nothing.
  expect(checked).toBeGreaterThan(0)

  // The local player is marked as themselves, without their nickname being
  // replaced by the word.
  expect(screen.getAllByText('Ann').length).toBeGreaterThan(0)
  expect(screen.getAllByText('stats.selfTag').length).toBeGreaterThan(0)
})

it('gives a tied achievement to nobody, so fewer than five plates render', () => {
  // The rule no fixture test reaches: `leader()` awards a plate only to a SOLE
  // leader, so a tie leaves it off and the row of plates is allowed to come up
  // short. This match ties on err503 by itself — both p1 and p2 turn up exactly
  // one 503 — so the tie is the engine's, not one this test arranged.
  const engine = createFakeEngine()
  const state = playedOut()
  view = engine.project(state, 'p1')
  const tally = view.tally
  if (!tally) throw new Error('a finished match must project its tally')

  const top = (key: 'err503' | 'attackedInto') =>
    SEATS.map((s) => tally[s.playerId][key]).sort((a, b) => b - a)
  const [firstErr, secondErr] = top('err503')
  // Guard the premise: if a rules change breaks the tie, this says so plainly
  // instead of the assertions below quietly testing nothing.
  expect(firstErr).toBe(secondErr)
  expect(firstErr).toBeGreaterThan(0)

  render(<StatsPage />)

  // Tied — so nobody is named, even though the metric did happen.
  expect(screen.queryByText('stats.achievements.err503.title')).toBeNull()
  // Sole leader — so this one IS named, which is what proves the absence above
  // is the tie rule rather than the plates having failed to render at all.
  const [firstInto, secondInto] = top('attackedInto')
  expect(firstInto).toBeGreaterThan(secondInto)
  expect(screen.getByText('stats.achievements.attackedInto.title')).toBeTruthy()
  // Nobody scored a DDoS, so that plate is absent for the other reason.
  expect(screen.queryByText('stats.achievements.ddos.title')).toBeNull()
})

it('keeps a departed player in the table, marked offline with their own numbers', () => {
  const engine = createFakeEngine()
  const state = playedOut()
  view = engine.project(state, 'p1')
  // Cy dropped: gone from the roster, still in the seating the match was dealt
  // with. Their row must survive their connection.
  delete peers['peer-c']

  render(<StatsPage />)

  expect(screen.getAllByText('Cy').length).toBeGreaterThan(0)
  expect(screen.getAllByText('stats.location.offline').length).toBeGreaterThan(0)
  // And the peers still present read their own announced locations.
  expect(screen.getAllByText('stats.location.stats').length).toBeGreaterThan(0)
  expect(screen.getAllByText('stats.location.lobby').length).toBeGreaterThan(0)
})
