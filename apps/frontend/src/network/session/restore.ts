import type { Seat } from './referee'

// The seating a restored keeper adopts.
//
// Two rules, and both matter. Every seat's absence is restamped to `now`: a
// stored `absentSince` describes time that passed while nothing was keeping
// the table, and `driveAbsent` reading it would see every seat far past its
// 30s grace and bot-play the whole match before a single player could re-dial.
// The pause was not time spent.
//
// The host's own seat is the exception, and keeps its peer id. The room code
// IS that peer id and the restore reclaims it unchanged, so the seat is still
// addressable — and `attachKeeper` routes an outgoing addressed to
// `transport.id` to its own local link rather than over a connection to
// itself. Null it and the restoring host would sit in front of a table it
// never receives a projection for.
export function restoreSeats(stored: Seat[], hostPeerId: string, now: number): Seat[] {
  return stored.map((seat) =>
    seat.peerId === hostPeerId
      ? { ...seat, absentSince: null }
      : { ...seat, peerId: null, absentSince: now },
  )
}
