import { isRelayable, relayTargets } from './relay'

it('never forwards a message a guest would read as the host`s word', () => {
  expect(isRelayable('PLAYER_KICKED')).toBe(false)
  expect(isRelayable('PEER_LIST')).toBe(false)
  expect(isRelayable('LOBBY_DISBANDED')).toBe(false)
})

it('never forwards a frame addressed to one party, because forwarding is broadcasting', () => {
  // A wire frame names no recipient, so `relayTargets` fans it out to everyone.
  // SYNC is one seat's projection, KEEPER_STATE is GameState itself, and INTENT
  // is the card a player chose — including one the keeper rejected, which the
  // engine emitted no event for at all. Relaying any of them hands the whole
  // table what the keeper's per-seat fan-out exists to keep private.
  expect(isRelayable('SYNC')).toBe(false)
  expect(isRelayable('INTENT')).toBe(false)
  expect(isRelayable('KEEPER_STATE')).toBe(false)
})

it('never relays a seat`s intro report', () => {
  // It is addressed to the keeper, like every other game frame.
  expect(isRelayable('INTRO_READY')).toBe(false)
})

it('never forwards the keeper`s own announcements', () => {
  // Authored by the keeper alone, and `KEEPER_CHANGED` with `keeperId: null` is
  // the death notice — forwarding a peer-originated one is a kill switch any
  // player could pull on the whole table.
  expect(isRelayable('KEEPER_CHANGED')).toBe(false)
  expect(isRelayable('GAME_STARTED')).toBe(false)
})

it('never forwards the call to leave the lobby', () => {
  // A relayed frame reaches guests wearing the host's id, so forwarding a
  // peer-originated GAME_STARTING would let any player drag the whole table
  // out of the lobby to a board of its choosing.
  expect(isRelayable('GAME_STARTING')).toBe(false)
})

it('never forwards the host`s repointing of a seat', () => {
  // A relayed frame reaches guests wearing the host's id, so forwarding a
  // peer-originated SEAT_REBOUND would let any player repoint any seat at a peer
  // id of its choosing — and that seat's private fan-out follows the peer id.
  expect(isRelayable('SEAT_REBOUND')).toBe(false)
})

it('forwards to all peers except the sender and the host', () => {
  const targets = relayTargets({ connectedPeerIds: ['h', 'a', 'b', 'c'], hostId: 'h', from: 'a' })
  expect(targets.sort()).toEqual(['b', 'c'])
})

it('returns empty when sender is the only non-host peer', () => {
  expect(relayTargets({ connectedPeerIds: ['h', 'a'], hostId: 'h', from: 'a' })).toEqual([])
})
