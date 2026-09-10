import type { PlayerTally } from '@release/engine'
import type { PeerInfo } from '~/network'
import { toStatPlayers } from './toStatPlayers'

const tally = (over: Partial<PlayerTally> = {}): PlayerTally => ({
  attack: 0,
  defense: 0,
  ddos: 0,
  ai: 0,
  err503: 0,
  cherryPick: 0,
  attackedInto: 0,
  ...over,
})

const seats = [
  { playerId: 'p1', peerId: 'peer-a', clientId: 'client-a', name: 'Ann' },
  { playerId: 'p2', peerId: 'peer-b', clientId: 'client-b', name: 'Bo' },
]

const peers: Record<string, PeerInfo> = {
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

it('rows are keyed by peer id, never by the engine seat id', () => {
  // PlayerId and peer id are both `string`, which is exactly what hides a
  // mix-up. The screen resolves winnerId and selfId against peer ids, so a row
  // carrying 'p1' would silently match nobody.
  const rows = toStatPlayers({ tally: { p1: tally(), p2: tally() }, seats, peers })
  expect(rows.map((r) => r.id)).toEqual(['peer-a', 'peer-b'])
})

it('carries the counters of each seat onto its row', () => {
  const rows = toStatPlayers({
    tally: { p1: tally({ attack: 5, ddos: 2, attackedInto: 4 }), p2: tally({ defense: 3 }) },
    seats,
    peers,
  })
  expect(rows[0]).toMatchObject({ attack: 5, ddos: 2, attackedInto: 4 })
  expect(rows[1]).toMatchObject({ defense: 3 })
})

it('reads player locations from the roster', () => {
  const rows = toStatPlayers({ tally: { p1: tally(), p2: tally() }, seats, peers })
  expect(rows.map((r) => r.location)).toEqual(['stats', 'lobby'])
})

it('keeps the row of a player who left, and calls them offline', () => {
  // They played the match. Dropping the row would rewrite its history to
  // exclude someone who was there.
  //
  // `seats` still naming peer-b while the roster no longer does is the shape
  // the page produces once the seating is frozen at the deal (#19): the roster
  // is pruned on disconnect, the seating is not.
  const rows = toStatPlayers({
    tally: { p1: tally(), p2: tally({ attack: 9 }) },
    seats,
    peers: { 'peer-a': peers['peer-a'] },
  })
  expect(rows).toHaveLength(2)
  expect(rows[1]).toMatchObject({ id: 'peer-b', name: 'Bo', location: 'offline', attack: 9 })
})

it('a seat that lost its peer keeps its own counters, and so does everyone else', () => {
  // The scenario the frozen seating exists for. Three peers were dealt in as
  // p1/p2/p3; the middle one drops mid-match. A seating recomputed from the
  // surviving roster would renumber Cid to p2 and print Bo's counters under
  // Cid's name while Bo vanished from the match entirely.
  const dealt = [
    { playerId: 'p1', peerId: 'aaa', clientId: 'client-aaa', name: 'Ann' },
    { playerId: 'p2', peerId: 'bbb', clientId: 'client-bbb', name: 'Bo' },
    { playerId: 'p3', peerId: 'ccc', clientId: 'client-ccc', name: 'Cid' },
  ]
  const survivors: Record<string, PeerInfo> = {
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

  const rows = toStatPlayers({
    tally: {
      p1: tally({ attack: 1 }),
      p2: tally({ attack: 2 }),
      p3: tally({ attack: 3 }),
    },
    seats: dealt,
    peers: survivors,
  })

  expect(rows).toEqual([
    expect.objectContaining({ id: 'aaa', name: 'Ann', location: 'stats', attack: 1 }),
    expect.objectContaining({ id: 'bbb', name: 'Bo', location: 'offline', attack: 2 }),
    expect.objectContaining({ id: 'ccc', name: 'Cid', location: 'stats', attack: 3 }),
  ])
})

it('rows follow the seating, not the order the roster happens to enumerate', () => {
  // The two orders have to disagree for this to prove anything: the roster is
  // built Bo-then-Ann, the seating says Ann sat first.
  const rosterFirstBo: Record<string, PeerInfo> = {
    'peer-b': peers['peer-b'],
    'peer-a': peers['peer-a'],
  }
  const rows = toStatPlayers({
    tally: { p1: tally({ attack: 1 }), p2: tally({ attack: 2 }) },
    seats,
    peers: rosterFirstBo,
  })
  expect(rows.map((r) => r.id)).toEqual(['peer-a', 'peer-b'])
  expect(rows.map((r) => r.attack)).toEqual([1, 2])
})

it('names a departed player from the seat, since the roster no longer can', () => {
  const rows = toStatPlayers({ tally: { p1: tally(), p2: tally() }, seats, peers: {} })
  expect(rows.map((r) => r.name)).toEqual(['Ann', 'Bo'])
})

it('gives a seat with no counters a row of zeros rather than dropping it', () => {
  const rows = toStatPlayers({ tally: {}, seats, peers })
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({
    attack: 0,
    defense: 0,
    ddos: 0,
    ai: 0,
    err503: 0,
    cherryPick: 0,
    attackedInto: 0,
  })
})

it('has no rows when nobody was seated', () => {
  expect(toStatPlayers({ tally: {}, seats: [], peers })).toEqual([])
})
