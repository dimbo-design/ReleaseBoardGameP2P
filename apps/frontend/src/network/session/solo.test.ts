import { buildSoloTable } from './solo'

const table = () =>
  buildSoloTable({
    selfPeerId: 'local:solo',
    clientId: 'client-me',
    name: 'Ann',
    botNames: ['Bot 1', 'Bot 2'],
    setup: { 'mode.hand': '8bit' },
  })

it('seats the human first, so the human moves first', () => {
  // The engine starts the match on `seating[0]` (fake/setup.ts) — seat order
  // IS turn order, so this is the whole of decision 7.
  expect(table().players.map((p) => p.playerId)).toEqual(['p1', 'p2', 'p3'])
  expect(table().players[0].name).toBe('Ann')
})

it('gives the engine no connection for a bot', () => {
  const { players } = table()
  expect(players[0].peerId).toBe('local:solo')
  expect(players[1]).toMatchObject({ peerId: null, bot: true })
  expect(players[2]).toMatchObject({ peerId: null, bot: true })
})

// The board reads the roster, not the engine, to decide who is at the table and
// who has dropped (pages/board/[gameId]/index.tsx). A bot missing from it would
// render as a disconnected player for the whole match.
it('gives every bot a roster entry, so the board does not read it as dropped', () => {
  const { lobby, seats } = table()
  expect(Object.keys(lobby.peers)).toHaveLength(3)
  for (const seat of seats) expect(lobby.peers[seat.peerId]).toBeDefined()
  expect(Object.values(lobby.peers).every((p) => p.where === 'game' && p.ready)).toBe(true)
})

// `seated` in the board page compares a participant id against `state.selfId`.
it('makes the human the self and the host of its own table', () => {
  const { lobby } = table()
  expect(lobby.selfId).toBe('local:solo')
  expect(lobby.hostId).toBe('local:solo')
  expect(lobby.peers['local:solo'].role).toBe('host')
  expect(lobby.setup).toEqual({ 'mode.hand': '8bit' })
})

it('sizes the table to the seats it actually has', () => {
  expect(table().lobby.maxPlayers).toBe(3)
  const solo = buildSoloTable({
    selfPeerId: 'local:solo',
    clientId: 'c',
    name: 'A',
    setup: {},
    botNames: ['Solo Bot'],
  })
  expect(solo.seats).toHaveLength(2)
})
