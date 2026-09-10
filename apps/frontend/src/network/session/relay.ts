import type { MessageType } from '../types'

// Messages the host never forwards on a peer's behalf, for two distinct
// reasons.
//
// Authority: the roster, the lobby config, the three that end someone's
// membership, and the call to leave for the board are the host's own word. The
// transport stamps `from` with the connection a frame arrived on
// (transport/peer.ts), so a relayed frame reaches a guest wearing the host's id
// — forwarding a peer-originated one of these would hand any player the host's
// authority over everyone else. A forwarded GAME_STARTING would let any peer
// drag the whole table out of the lobby.
//
// Privacy and authorship: every game frame is addressed to exactly one party,
// but a wire frame names no recipient, so relaying one is broadcasting it.
// SYNC carries a single seat's projection and KEEPER_STATE carries GameState
// itself — the deck order included — and INTENT carries the card a player just
// chose, including one the keeper went on to reject and therefore emitted no
// event for at all. Forwarding any of them puts a private payload in front of
// the whole table, which is the one thing the keeper's per-seat fan-out exists
// to prevent. INTRO_READY is addressed to the keeper for exactly the reason
// INTENT is: it is a game frame one seat sends to the party that answers it,
// and a relayed copy arrives wearing the host's id — so forwarding it would let
// one peer report the intro finished on the host's behalf and release the table
// early, out from under everyone still watching. KEEPER_CHANGED is not
// private but is authored by the keeper
// alone, and `keeperId: null` is the death notice that ends the game for
// everyone: a forwarded peer-originated one is a table-wide kill switch.
// SEAT_REBOUND belongs to the first group: it is the host's answer to a
// returning player, and a forwarded peer-originated one would let any player
// repoint any seat at a peer id of its choosing — the seat's private fan-out
// follows that peer id, so the forger would start receiving another seat's
// projection, hand included.
//
// Nothing legitimate is lost. The keeper is the host, so every game frame
// travels a direct connection in both directions and never reaches the relay.
// A keeper sitting behind the host needs the opposite of a type-only rule — a
// relay that routes each frame to its named recipient, and a transport that
// sends through the host in the first place — which is part of the handover
// wiring in #18.
const NEVER_RELAYED: ReadonlySet<MessageType> = new Set<MessageType>([
  'PEER_LIST',
  'PEER_JOINED',
  'LOBBY_CONFIG_UPDATED',
  'PLAYER_KICKED',
  'LOBBY_DISBANDED',
  'HOST_TRANSFERRED',
  'GAME_STARTING',
  'SEAT_REBOUND',
  'GAME_STARTED',
  'INTENT',
  'INTRO_READY',
  'SYNC',
  'KEEPER_STATE',
  'KEEPER_CHANGED',
])

export function isRelayable(type: MessageType): boolean {
  return !NEVER_RELAYED.has(type)
}

// Host relay: a message arriving from one peer is forwarded to every other
// connected peer, never back to the sender and never to the host's own
// connection (the host delivers its own outbound messages directly).
export function relayTargets(args: {
  connectedPeerIds: string[]
  hostId: string
  from: string
}): string[] {
  return args.connectedPeerIds.filter((id) => id !== args.from && id !== args.hostId)
}
