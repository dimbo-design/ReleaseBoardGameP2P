import type { PlayerId } from '@release/engine'
import { createLobbyState, type LobbyState } from '../lobby/state'
import type { PeerInfo, Seat, Setup } from '../types'

// A bot's address in the ROSTER. Bots hold no connection, but the board decides
// who is at the table — and who has dropped — by looking each seat up in
// `state.peers` (pages/board/[gameId]/index.tsx), so a bot needs an entry there
// even though nothing is ever sent to it. Same colon rule as the loopback
// transport: outside the room-code alphabet, so it can never be a real peer.
const botPeerId = (n: number) => `local:bot-${n}`

export interface SoloTable {
  // The LOBBY seating, held by `applySeats` and stored with the keeper
  // snapshot. A bot's entry carries a peer id here.
  seats: Seat[]
  lobby: LobbyState
  // What the REFEREE is seated with. A bot's entry carries no peer id here —
  // `syncAll` skips a seat with none, which is what keeps the keeper from
  // projecting a hand to nobody.
  players: { playerId: PlayerId; peerId: string | null; name: string; bot?: boolean }[]
}

export function buildSoloTable(args: {
  selfPeerId: string
  clientId: string
  name: string
  // Supplied by the caller rather than built here: `network/` may not import
  // i18next (the frontend's layering rule), and these are display copy. One
  // name per bot — the length is the bot count.
  botNames: string[]
  setup: Setup
}): SoloTable {
  const seats: Seat[] = [
    { playerId: 'p1', peerId: args.selfPeerId, clientId: args.clientId, name: args.name },
    ...args.botNames.map((name, i) => ({
      playerId: `p${i + 2}`,
      peerId: botPeerId(i + 1),
      clientId: `local:bot-client-${i + 1}`,
      name,
    })),
  ]

  const peers: PeerInfo[] = seats.map((seat, i) => ({
    id: seat.peerId,
    clientId: seat.clientId,
    name: seat.name,
    role: i === 0 ? 'host' : 'player',
    // A bot is never not ready and never anywhere else. `where` is what the
    // results screen prints as a player's whereabouts, and 'game' is the only
    // honest answer for a seat that exists solely inside this match.
    ready: true,
    where: 'game',
  }))

  return {
    seats,
    lobby: createLobbyState({
      selfId: args.selfPeerId,
      hostId: args.selfPeerId,
      maxPlayers: seats.length,
      setup: args.setup,
      peers,
    }),
    players: seats.map((seat, i) =>
      i === 0
        ? { playerId: seat.playerId, peerId: args.selfPeerId, name: seat.name }
        : { playerId: seat.playerId, peerId: null, name: seat.name, bot: true },
    ),
  }
}
