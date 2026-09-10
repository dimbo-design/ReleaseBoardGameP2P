import type { PeerInfo } from '~/network'
import { seatOf, seatsFor } from './seats'

const peer = (
  id: string,
  name: string,
  role: PeerInfo['role'],
  clientId = `client-${id}`,
): PeerInfo => ({
  id,
  clientId,
  name,
  role,
  ready: true,
  where: 'lobby',
})

const roster = (...list: PeerInfo[]): Record<string, PeerInfo> =>
  Object.fromEntries(list.map((p) => [p.id, p]))

it('seats players and leaves spectators standing', () => {
  const seats = seatsFor(
    roster(
      peer('peer-a', 'Ann', 'host'),
      peer('peer-b', 'Bo', 'player'),
      peer('peer-c', 'Cid', 'guest'),
    ),
  )
  expect(seats.map((s) => s.name)).toEqual(['Ann', 'Bo'])
  // A spectator has no seat at all — not a seat that happens to be empty.
  expect(seats.some((s) => s.peerId === 'peer-c')).toBe(false)
})

it('mints player ids that could never be mistaken for peer ids', () => {
  const seats = seatsFor(roster(peer('peer-a', 'Ann', 'host'), peer('peer-b', 'Bo', 'player')))
  expect(seats.map((s) => s.playerId)).toEqual(['p1', 'p2'])
  // The whole point: passing one where the other belongs must look wrong.
  for (const s of seats) expect(s.playerId).not.toBe(s.peerId)
})

it('carries each seat back to the peer that holds it', () => {
  const seats = seatsFor(roster(peer('peer-a', 'Ann', 'host'), peer('peer-b', 'Bo', 'player')))
  expect(seatOf(seats, 'peer-b')?.playerId).toBe('p2')
  expect(seatOf(seats, 'peer-b')?.name).toBe('Bo')
})

it('gives a spectator no seat to sit in', () => {
  const seats = seatsFor(roster(peer('peer-a', 'Ann', 'host'), peer('peer-c', 'Cid', 'guest')))
  expect(seatOf(seats, 'peer-c')).toBeNull()
})

it('seats the same roster the same way however it is enumerated', () => {
  const a = peer('peer-a', 'Ann', 'host')
  const b = peer('peer-b', 'Bo', 'player')
  const c = peer('peer-c', 'Cid', 'player')
  // Insertion order differs; the seating must not, or a re-render could move a
  // player between seats mid-game.
  expect(seatsFor(roster(a, b, c))).toEqual(seatsFor(roster(c, a, b)))
})

it('carries each peer clientId onto the seat it is dealt', () => {
  const seats = seatsFor(
    roster(peer('peer-a', 'Ann', 'host', 'client-a'), peer('peer-b', 'Bo', 'player', 'client-b')),
  )
  expect(seats).toEqual([
    { playerId: 'p1', peerId: 'peer-a', clientId: 'client-a', name: 'Ann' },
    { playerId: 'p2', peerId: 'peer-b', clientId: 'client-b', name: 'Bo' },
  ])
})
