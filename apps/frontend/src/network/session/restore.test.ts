import type { Seat as RefereeSeat, Seat } from './referee'
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

// The trap this guards: `restoreSeats` restamps a stored absence to `now` so a
// reload does not bot-play the whole match at once. A bot has no absence to
// restamp — it was never there — and restamping one would freeze every bot for
// a full grace period after every reload.
it('leaves a bot seat exactly as it was', () => {
  const seats: Seat[] = [
    { playerId: 'p1', peerId: 'host-peer', absentSince: null },
    { playerId: 'p2', peerId: null, absentSince: null, bot: true },
  ]
  expect(restoreSeats(seats, 'host-peer', 5_000)).toEqual([
    { playerId: 'p1', peerId: 'host-peer', absentSince: null },
    { playerId: 'p2', peerId: null, absentSince: null, bot: true },
  ])
})
