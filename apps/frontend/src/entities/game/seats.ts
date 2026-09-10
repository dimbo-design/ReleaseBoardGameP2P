import type { PlayerId } from '@release/engine'
import type { PeerInfo, Seat } from '~/network'

// `Seat` is declared in network/types.ts because it rides GAME_STARTING, and
// re-exported here so every reader still asks the seating module for it.
export type { Seat }

// PlayerId and peer id are distinct spaces that are both `string`, which is
// exactly what hides a mix-up (network/session/remoteLink.ts:34). Minting
// `p1…pN` rather than reusing the peer id keeps them visibly different, so a
// swap addresses an obviously wrong seat instead of quietly working.
const seatId = (index: number): PlayerId => `p${index + 1}`

// Who sits down, in the order the referee will seat them. Spectators are not
// players and get no seat — they watch through the roster, not the engine.
//
// Called ONCE per match, by the host in `startGame`; the result is broadcast on
// GAME_STARTING and held for the life of the match (network/useLobby.ts). It
// reads the live roster, so calling it again later would seat whoever is still
// connected — renumbering the survivors and moving players between seats. The
// only remaining caller past the deal is the degraded fallback on a page that
// has no frozen seating to read.
export function seatsFor(peers: Record<string, PeerInfo>): Seat[] {
  return Object.values(peers)
    .filter((p) => p.role === 'host' || p.role === 'player')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p, i) => ({ playerId: seatId(i), peerId: p.id, clientId: p.clientId, name: p.name }))
}

// The seat a given peer got, or null if it is watching rather than playing.
export function seatOf(seats: Seat[], peerId: string): Seat | null {
  return seats.find((s) => s.peerId === peerId) ?? null
}
