import type { Seat } from './referee'

// The seating a restored keeper adopts.
//
// Three rules, and all three matter. Every seat's absence is restamped to
// `now`: a stored `absentSince` describes time that passed while nothing was
// keeping the table, and `driveUnattended` reading it would see every seat far
// past its 30s grace and bot-play the whole match before a single player
// could re-dial. The pause was not time spent.
//
// The host's own seat is the first exception, and keeps its peer id. The room
// code IS that peer id and the restore reclaims it unchanged, so the seat is
// still addressable — and `attachKeeper` routes an outgoing addressed to
// `transport.id` to its own local link rather than over a connection to
// itself. Null it and the restoring host would sit in front of a table it
// never receives a projection for.
//
// A bot seat is the second exception, left untouched: it has no absence to
// restamp and nothing to come back from.
export function restoreSeats(stored: Seat[], hostPeerId: string, now: number): Seat[] {
  return stored.map((seat) => {
    // A bot was never present, so there is no absence to restamp — and
    // restamping one would freeze every bot for a full grace period after
    // every reload, which is the opposite of what the restamp is for.
    if (seat.bot) return seat
    return seat.peerId === hostPeerId
      ? { ...seat, absentSince: null }
      : { ...seat, peerId: null, absentSince: now }
  })
}
