import type { Seat } from '../types'
import {
  canStart,
  disbandLobby,
  handleJoinRequest,
  handleReady,
  handleWhereabouts,
  kick,
  setMaxPlayers,
} from './host'
import { createLobbyState, playerCount } from './state'

const host = {
  id: 'h',
  clientId: 'client-h',
  name: 'Host',
  role: 'host' as const,
  ready: true,
  where: 'lobby' as const,
}

function base(maxPlayers: number) {
  return createLobbyState({ selfId: 'h', hostId: 'h', maxPlayers, peers: [host] })
}

it('assigns player role and emits PEER_LIST + PEER_JOINED', () => {
  const { state, outgoing } = handleJoinRequest(base(4), 'p1', 'Pam', 'client-p1')
  expect(state.peers.p1.role).toBe('player')

  const list = outgoing.find((o) => o.message.type === 'PEER_LIST')
  expect(list?.to).toBe('p1')
  expect(list?.message.type === 'PEER_LIST' && list.message.payload.yourRole).toBe('player')

  const joined = outgoing.find((o) => o.message.type === 'PEER_JOINED')
  expect(joined?.to).toBe('broadcast')
  expect(joined?.message.type === 'PEER_JOINED' && joined.message.payload.ready).toBe(false)
})

it('handleReady broadcasts PEER_JOINED with ready: true', () => {
  const joined = handleJoinRequest(base(4), 'p1', 'Pam', 'client-p1').state
  const { outgoing } = handleReady(joined, 'p1')
  const broadcast = outgoing.find((o) => o.message.type === 'PEER_JOINED')
  expect(broadcast?.to).toBe('broadcast')
  expect(broadcast?.message.type === 'PEER_JOINED' && broadcast.message.payload.ready).toBe(true)
})

it('handleReady toggles readiness back off (reversible)', () => {
  const joined = handleJoinRequest(base(4), 'p1', 'Pam', 'client-p1').state
  const readied = handleReady(joined, 'p1').state // false -> true
  expect(readied.peers.p1.ready).toBe(true)
  const { state, outgoing } = handleReady(readied, 'p1') // true -> false
  expect(state.peers.p1.ready).toBe(false)
  const broadcast = outgoing.find((o) => o.message.type === 'PEER_JOINED')
  expect(broadcast?.message.type === 'PEER_JOINED' && broadcast.message.payload.ready).toBe(false)
})

it('assigns guest when player slots are full', () => {
  const { state } = handleJoinRequest(base(2), 'p1', 'Pam', 'client-p1') // host fills 1, p1 fills 2
  const second = handleJoinRequest(state, 'p2', 'Pat', 'client-p2')
  expect(second.state.peers.p2.role).toBe('guest')
})

it('kick removes the peer and broadcasts PLAYER_KICKED', () => {
  const joined = handleJoinRequest(base(4), 'p1', 'Pam', 'client-p1').state
  const { state, outgoing } = kick(joined, 'p1', 'afk')
  expect(state.peers.p1).toBeUndefined()
  expect(outgoing[0].message).toEqual({
    type: 'PLAYER_KICKED',
    payload: { peerId: 'p1', reason: 'afk' },
  })
  expect(outgoing[0].to).toBe('broadcast')
})

it('setMaxPlayers clamps to 2..6', () => {
  expect(setMaxPlayers(base(4), 9).state.maxPlayers).toBe(6)
  expect(setMaxPlayers(base(4), 1).state.maxPlayers).toBe(2)
})

it('setMaxPlayers demotes over-capacity players to guests when lowering the cap', () => {
  // 6-max lobby: host + 3 players all assigned 'player'.
  let s = base(6)
  s = handleJoinRequest(s, 'p1', 'P1', 'client-p1').state
  s = handleJoinRequest(s, 'p2', 'P2', 'client-p2').state
  s = handleJoinRequest(s, 'p3', 'P3', 'client-p3').state
  expect(playerCount(s)).toBe(4)

  const { state, outgoing } = setMaxPlayers(s, 2)
  // Host keeps a slot, first joiner keeps player; the rest demoted to guest.
  expect(state.peers.h.role).toBe('host')
  expect(state.peers.p1.role).toBe('player')
  expect(state.peers.p2.role).toBe('guest')
  expect(state.peers.p3.role).toBe('guest')
  expect(playerCount(state)).toBe(2)

  // Each demotion is broadcast so guests stay consistent.
  const demotions = outgoing.filter((o) => o.message.type === 'PEER_JOINED')
  expect(demotions).toHaveLength(2)
})

it('canStart requires >=2 players all ready', () => {
  const onePlayer = base(4)
  expect(canStart(onePlayer)).toBe(false) // only host
  const withReady = handleJoinRequest(onePlayer, 'p1', 'Pam', 'client-p1').state
  expect(canStart(withReady)).toBe(false) // p1 not ready
  withReady.peers.p1.ready = true
  expect(canStart(withReady)).toBe(true)
})

it('disbandLobby broadcasts LOBBY_DISBANDED without mutating state', () => {
  const s = base(4)
  const { state, outgoing } = disbandLobby(s)
  expect(state).toBe(s)
  expect(outgoing).toHaveLength(1)
  expect(outgoing[0]).toEqual({
    to: 'broadcast',
    message: { type: 'LOBBY_DISBANDED', payload: {} },
  })
})

it('records where a peer went and tells the table', () => {
  const state = createLobbyState({
    selfId: 'host',
    hostId: 'host',
    maxPlayers: 4,
    peers: [
      {
        id: 'host',
        clientId: 'client-host',
        name: 'Ann',
        role: 'host',
        ready: true,
        where: 'lobby',
      },
      { id: 'g1', clientId: 'client-g1', name: 'Bo', role: 'player', ready: false, where: 'lobby' },
    ],
  })

  const r = handleWhereabouts(state, 'g1', 'stats')

  expect(r.state.peers.g1.where).toBe('stats')
  expect(r.outgoing).toEqual([
    {
      to: 'broadcast',
      message: {
        type: 'PEER_JOINED',
        payload: {
          id: 'g1',
          clientId: 'client-g1',
          name: 'Bo',
          role: 'player',
          ready: false,
          where: 'stats',
        },
      },
    },
  ])
})

it('says nothing when a peer re-announces where it already is', () => {
  // Every screen announces on mount, and React mounts more than once in
  // StrictMode. Without this guard a remount is a table-wide broadcast.
  const state = createLobbyState({
    selfId: 'host',
    hostId: 'host',
    maxPlayers: 4,
    peers: [
      { id: 'g1', clientId: 'client-g1', name: 'Bo', role: 'player', ready: false, where: 'stats' },
    ],
  })

  const r = handleWhereabouts(state, 'g1', 'stats')

  expect(r.state).toBe(state)
  expect(r.outgoing).toEqual([])
})

it('ignores a whereabouts from someone not in the room', () => {
  const state = createLobbyState({
    selfId: 'host',
    hostId: 'host',
    maxPlayers: 4,
    peers: [
      { id: 'g1', clientId: 'client-g1', name: 'Bo', role: 'player', ready: false, where: 'lobby' },
    ],
  })

  const r = handleWhereabouts(state, 'stranger', 'game')

  expect(r.state).toBe(state)
  expect(r.outgoing).toEqual([])
})

it('seats a joiner in the lobby, since that is the only place to join from', () => {
  const state = createLobbyState({
    selfId: 'host',
    hostId: 'host',
    maxPlayers: 4,
    peers: [
      {
        id: 'host',
        clientId: 'client-host',
        name: 'Ann',
        role: 'host',
        ready: true,
        where: 'lobby',
      },
    ],
  })

  const r = handleJoinRequest(state, 'g1', 'Bo', 'client-g1')

  expect(r.state.peers.g1.where).toBe('lobby')
})

// Named `returningBase` (not `base`) to avoid colliding with the `base(maxPlayers)`
// helper above — this fixture is a mid-match lobby with a frozen seat to return to.
const returningBase = () =>
  createLobbyState({
    selfId: 'host',
    hostId: 'host',
    maxPlayers: 2,
    peers: [
      {
        id: 'host',
        clientId: 'client-host',
        name: 'Ann',
        role: 'host',
        ready: true,
        where: 'game',
      },
    ],
  })

const seating: Seat[] = [
  { playerId: 'p1', peerId: 'host', clientId: 'client-host', name: 'Ann' },
  { playerId: 'p2', peerId: 'dead-peer', clientId: 'client-bo', name: 'Bo' },
]

it('seats a returning player back into the seat their clientId owns', () => {
  const r = handleJoinRequest(returningBase(), 'fresh-peer', 'Bo', 'client-bo', seating)
  expect(r.state.peers['fresh-peer']).toMatchObject({ role: 'player', name: 'Bo' })
  expect(r.outgoing).toContainEqual({
    to: 'broadcast',
    message: { type: 'SEAT_REBOUND', payload: { playerId: 'p2', peerId: 'fresh-peer' } },
  })
})

// The trap this test exists for: assignRole would look at a full room and hand
// back 'guest', silently demoting a player out of a match they are still
// seated in.
it('does not demote a returning player when the room has filled behind them', () => {
  const full = createLobbyState({
    selfId: 'host',
    hostId: 'host',
    maxPlayers: 2,
    peers: [
      {
        id: 'host',
        clientId: 'client-host',
        name: 'Ann',
        role: 'host',
        ready: true,
        where: 'game',
      },
      {
        id: 'squatter',
        clientId: 'client-x',
        name: 'Cy',
        role: 'player',
        ready: true,
        where: 'game',
      },
    ],
  })
  const r = handleJoinRequest(full, 'fresh-peer', 'Bo', 'client-bo', seating)
  expect(r.state.peers['fresh-peer'].role).toBe('player')
})

it('treats an unknown clientId as an ordinary join', () => {
  const r = handleJoinRequest(returningBase(), 'newcomer', 'Cy', 'client-new', seating)
  expect(r.state.peers.newcomer.role).toBe('player')
  expect(r.outgoing.some((o) => o.message.type === 'SEAT_REBOUND')).toBe(false)
})

it('treats any join as ordinary when no match is running', () => {
  const r = handleJoinRequest(returningBase(), 'fresh-peer', 'Bo', 'client-bo')
  expect(r.outgoing.some((o) => o.message.type === 'SEAT_REBOUND')).toBe(false)
})
