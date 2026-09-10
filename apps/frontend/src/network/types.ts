import type { Action, Event, GameState, PlayerId, PlayerView, Setup } from '@release/engine'

// A plain Omit over a union collapses it to its common members, so it has to
// distribute. `player` and `at` are stripped because the keeper decides both:
// a peer may not act as another seat, nor claim what time it is.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

// WINDOW_EXPIRED and CLOCK_STARTED are excluded, not stripped: they carry no
// player identity and are fired by the keeper's own clock, never by a peer.
export type Intent = DistributiveOmit<
  Exclude<Action, { type: 'WINDOW_EXPIRED' } | { type: 'CLOCK_STARTED' }>,
  'player' | 'at'
>

// Opaque key→value map for game mode settings (handLimit, releases, etc.).
// The engine's own, re-exported rather than redeclared: the lobby's setup is
// handed straight to `createGame`, so a second same-named type inside
// `network/` could only ever drift away from the one that has to match.
export type { Setup }

export type Role = 'host' | 'player' | 'guest'

// Which screen a peer is on. There is no 'offline' member on purpose: nobody
// announces their own disconnection. A peer that has gone is simply absent from
// LobbyState.peers, and the results screen reads that absence.
export type Where = 'game' | 'stats' | 'lobby'

export interface PeerInfo {
  id: string
  // Stable across a reload, unlike `id` — a PeerJS peer id dies with the tab.
  // This is what lets the host recognise a returning player and hand back the
  // seat it kept for them (shared/lib/persistence.ts).
  clientId: string
  name: string
  role: Role
  ready: boolean
  where: Where
}

// One seat at the table, minted by `seatsFor` (~/entities/game/seats) when the
// host deals. It lives here rather than in `entities` because it travels on the
// wire: GAME_STARTING carries the whole seating so every peer holds the same
// frozen assignment for the life of the match, instead of each recomputing it
// from a roster that shrinks whenever somebody drops.
export interface Seat {
  playerId: PlayerId
  peerId: string
  // The seat's durable owner. `peerId` is whichever tab currently holds this
  // seat and is rewritten by every rebind; `clientId` is who that tab belongs
  // to and never changes for the life of the match.
  clientId: string
  name: string
}

// Discriminated union of every protocol message ({ type, payload }).
export type Message =
  // --- Lobby ---
  | { type: 'JOIN_REQUEST'; payload: { name: string; clientId: string } }
  | { type: 'PEER_LIST'; payload: { peers: PeerInfo[]; yourRole: Role } }
  | {
      type: 'PEER_JOINED'
      payload: {
        id: string
        clientId: string
        name: string
        role: Role
        ready: boolean
        where: Where
      }
    }
  | { type: 'PLAYER_READY'; payload: Record<string, never> }
  // A peer announcing which screen it is on, so the results table can say where
  // everyone went. Addressed to the host, which applies it and re-broadcasts the
  // updated PeerInfo — exactly the path PLAYER_READY takes.
  | { type: 'WHEREABOUTS'; payload: { where: Where } }
  | { type: 'LOBBY_CONFIG_UPDATED'; payload: { maxPlayers?: number; setup?: Setup } }
  | { type: 'LOBBY_DISBANDED'; payload: Record<string, never> }
  | { type: 'PLAYER_KICKED'; payload: { peerId: string; reason?: string } }
  | { type: 'TRANSFER_HOST'; payload: { newHostId: string } }
  | { type: 'HOST_TRANSFERRED'; payload: { from: string; to: string } }
  // The host leaving the lobby for the board, so every peer follows. Lobby-scoped
  // on purpose: it carries no keeper, because the lobby has no PlayerId to name
  // one with — peers are identified by PeerJS id here, and seats are assigned by
  // the engine's setup. GAME_STARTED below is the sync layer's handshake and
  // stays reserved for it.
  // The seating travels with the start, and is never recomputed after it. The
  // roster is live — `applyPeerLeft` prunes a peer the moment its channel drops,
  // mid-match as readily as in the lobby — so a seat derived from it at read
  // time renumbers the survivors and hands one player another's counters.
  | { type: 'GAME_STARTING'; payload: { gameId: string; seats: Seat[] } }
  // One seat has changed hands: the player who held it reloaded and came back
  // on a new peer id. Every peer holds the frozen seating from GAME_STARTING,
  // so without this patch their winner lookup and results rows keep naming a
  // peer id that no longer exists. The returning peer does not need it — it
  // was sent the whole seating.
  | { type: 'SEAT_REBOUND'; payload: { playerId: PlayerId; peerId: string } }
  // --- Game ---
  | { type: 'GAME_STARTED'; payload: { gameId: string; keeperId: PlayerId } }
  // A seat has finished its opening animation and is ready for the game to
  // move. Addressed to the keeper, which holds the table until every seat has
  // said this (or the cap expires) — see session/startGate.ts.
  | { type: 'INTRO_READY'; payload: { gameId: string } }
  | { type: 'INTENT'; payload: { intent: Intent } }
  // Private, per recipient — one projection plus that viewer's events. Never broadcast.
  // `resync` marks a REPLAY of what this seat already ought to know — the full
  // visible log, handed to a peer that rejoined. It is folded into history and
  // the discard heap, and it is NOT animated: a reconnect drops straight to the
  // live board, exactly as `isOpening` already says it must.
  | { type: 'SYNC'; payload: { view: PlayerView; events: Event[]; resync?: boolean } }
  // The only message carrying GameState, and only to a handover successor.
  | { type: 'KEEPER_STATE'; payload: { state: GameState } }
  // null is the death notice: the keeper is gone and the game cannot continue.
  | { type: 'KEEPER_CHANGED'; payload: { keeperId: PlayerId | null } }

export type MessageType = Message['type']

export type WireMessage = Message & { from: string; seq: number }
