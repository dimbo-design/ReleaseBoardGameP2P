import type { Seat as RefereeSeat } from './referee'
import { restoreSeats } from './restore'

const stored: RefereeSeat[] = [
  { playerId: 'p1', peerId: 'ROOMCODE', absentSince: null },
  { playerId: 'p2', peerId: 'guest-old', absentSince: null },
  { playerId: 'p3', peerId: null, absentSince: 5 },
]

it('keeps the host own seat, whose peer id is reclaimed unchanged', () => {
  const seats = restoreSeats(stored, 'ROOMCODE', 10_000)
  expect(seats[0]).toEqual({ playerId: 'p1', peerId: 'ROOMCODE', absentSince: null })
})

it('empties every other seat and restamps its absence to now', () => {
  const seats = restoreSeats(stored, 'ROOMCODE', 10_000)
  expect(seats[1]).toEqual({ playerId: 'p2', peerId: null, absentSince: 10_000 })
})

// The trap: a seat that was already absent carries an old timestamp. Restored
// as-is, driveAbsent sees it far past the 30s grace and bot-plays it before
// the player has any chance to re-dial. The pause was not time spent.
it('restamps a seat that was already absent before the reload', () => {
  const seats = restoreSeats(stored, 'ROOMCODE', 10_000)
  expect(seats[2]).toEqual({ playerId: 'p3', peerId: null, absentSince: 10_000 })
})
