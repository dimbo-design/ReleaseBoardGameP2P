import type { Transport } from './peer'

// The address a solo player sits at. The colon keeps it out of the PeerJS id
// space: room codes are drawn from ROOM_CODE_ALPHABET (useLobby.ts), which has
// no colon in it, so a synthetic address can never collide with a real peer id
// — and `parseRoomCode` strips it, so it cannot be typed into the join field
// either.
export const SOLO_PEER_ID = 'local:solo'

// A Transport for a table with nobody else at it.
//
// `attachKeeper` wants a transport for three things: its own address, a way to
// send, and a way to broadcast. Solo has the address and genuinely has no
// recipients — every outgoing message is addressed either to a bot seat, which
// holds no connection and is dropped by `syncAll` long before it reaches here,
// or to the keeper's own seat, which `deliver` routes to the local link
// without touching the transport at all. So these are not stubs standing in
// for something unfinished; there is nothing for them to do.
//
// This is what lets solo run `attachKeeper` unchanged, and with it the start
// gate, the intent buffering, the tick and the persistence hook — rather than
// growing a second keeper that would drift from the first.
export function createLoopbackTransport(id: string = SOLO_PEER_ID): Transport {
  return {
    id,
    connectTo() {},
    send() {},
    broadcast() {},
    relay() {},
    connectedIds: () => [],
    close() {},
  }
}
