import type { Event, PlayerId } from '@release/engine'
import type { Transport } from '../transport/peer'
import type { Intent, WireMessage } from '../types'
import { type GameLink, intervalTicker, type Sync, type Ticker } from './link'
import {
  applyIntent,
  commit,
  disconnect,
  driveAbsent,
  handover,
  type Outgoing,
  rebind,
  type Session,
  type SessionRef,
  seatOfPeer,
  syncAll,
  tick,
} from './referee'
import type { StartGate } from './startGate'

// The peer side of the link, plus the two seams a lobby-level caller drives:
// frames arriving off the transport, and the keeper this link talks to.
export interface RemoteHandle {
  link: GameLink
  handleMessage(frame: WireMessage): void
  // Re-point the link at a new keeper after a handover. Separate from
  // `onKeeperChanged` because the announcement names a `PlayerId` and `submit`
  // addresses a peer id: only the caller holds the roster that maps one to the
  // other, so only the caller can complete the move.
  setKeeper(peerId: string): void
}

// The peer side. It holds no GameState and cannot run `reduce`, so there is no
// optimistic local application: every intent round-trips to the keeper, and the
// view that comes back is the whole truth this peer is entitled to.
export function createRemoteLink(args: {
  transport: Transport
  // A PeerJS peer id, not a PlayerId. The two identity spaces are distinct and
  // both are `string`, which is exactly what would hide a mix-up: every
  // "keeperId" on the wire (GAME_STARTED, KEEPER_CHANGED) is a PlayerId, and
  // none of them can be passed here without being resolved through the roster.
  keeperPeerId: string
  // `null` means the keeper is gone and the game cannot continue: the peer
  // should surface @release/ui's Reconnect screen and return to the lobby.
  onKeeperChanged?: (keeperId: PlayerId | null) => void
}): RemoteHandle {
  const listeners = new Set<(sync: Sync) => void>()
  let keeperPeerId = args.keeperPeerId

  return {
    link: {
      submit(intent: Intent) {
        args.transport.send(keeperPeerId, { type: 'INTENT', payload: { intent } })
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      close() {
        listeners.clear()
      },
    },
    setKeeper(peerId) {
      keeperPeerId = peerId
    },
    handleMessage(frame) {
      // Only the keeper speaks for the session, so a frame from anyone else is
      // not one of these messages however it is labelled. Without this any
      // player could forge a KEEPER_CHANGED carrying `null` — the death notice
      // — and end the game for the whole table, or forge a SYNC and replace a
      // victim's entire view with cards of the attacker's choosing. The guest
      // lobby path gates on `fromHost` for exactly this reason (useLobby.ts).
      if (frame.from !== keeperPeerId) return

      if (frame.type === 'KEEPER_CHANGED') {
        // `parseEnvelope` validates the envelope, never the payload
        // (envelope.ts), and here the missing-payload default would be the
        // most destructive reading available: `keeperId: null` ends the game.
        if (!frame.payload || !('keeperId' in frame.payload)) return
        args.onKeeperChanged?.(frame.payload.keeperId)
        return
      }
      if (frame.type !== 'SYNC') return
      // Same reason: a frame that merely claims to be a SYNC must not reach a
      // subscriber as `undefined` and take the UI down with it.
      if (!frame.payload?.view) return
      for (const listener of listeners) listener(frame.payload)
    },
  }
}

// The result of attaching a keeper to a session: message handling plus the
// membership hooks a lobby-level caller drives on connect/disconnect.
export interface KeeperHandle {
  // The keeper is a player too, and this is its seat's side of the same
  // `GameLink` seam every other seat holds. Its intents never touch the
  // transport: there is no connection to itself (PeerJS `connections.get(self)`
  // is always undefined, so a self-addressed send is silently dropped), so they
  // go straight into the referee and its own SYNCs come back the same way.
  link: GameLink
  // Push every seat its current projection, optionally carrying a feed of events
  // that produced it. `createSession` returns the opening deal as `outgoing`, but
  // a caller holding only this handle has nowhere to put it — so without this
  // nobody sees their hand until they act.
  //
  // `events` exists because that opening deal is not decoration: the board's
  // intro replays the deal from it, and the move history opens on it. A caller
  // that starts a game must hand the deal in here, or every peer receives a
  // projection with no account of how it came about.
  resync(events?: Event[]): void
  handleMessage(frame: WireMessage): void
  peerLeft(peerId: string): void
  peerReturned(playerId: PlayerId, peerId: string): void
  // Voluntary keeper handover: hand GameState to the successor privately and
  // announce the change. The successor's side of it — adopting that state and
  // attaching its own keeper — belongs to the page/lobby wiring in #18, so
  // nothing calls this yet from production code.
  handover(toPlayerId: PlayerId): void
  // A seat has finished its opening animation. Takes a peer id, not a
  // PlayerId, so the keeper's own seat reports through exactly the rule a
  // remote seat's INTRO_READY takes: the seat is resolved from the connection.
  introReady(peerId: string): void
  close(): void
}

// The keeper side: the only party that calls into the engine.
export function attachKeeper(args: {
  ref: SessionRef
  transport: Transport
  now: () => number
  ticker?: Ticker
  // Absent, the keeper answers immediately — which is what solo play, the
  // playground and every test that predates the intro want.
  gate?: StartGate
  // Called after every state change this keeper commits. The keeper's own
  // commits are the only ones worth persisting — a local link's are solo play
  // and the playground, which have no session to come back to. Optional so
  // every existing caller and test is unaffected.
  onCommit?: (session: Session) => void
}): KeeperHandle {
  const ticker = args.ticker ?? intervalTicker()
  const listeners = new Set<(sync: Sync) => void>()
  // False once this handle has handed the session away or been closed. Every
  // entry point checks it: a deposed keeper that kept reducing would be a
  // second authority answering the same table — peers whose links have not been
  // re-pointed yet would have their intents applied to a state the successor
  // never sees, and the two SYNC streams would contradict each other.
  let keeping = true

  const deliver = (outgoing: Outgoing) => {
    if (outgoing.to === 'broadcast') {
      args.transport.broadcast(outgoing.message)
      return
    }
    // The keeper's own seat: its SYNC goes to its local link rather than out
    // over a connection to itself, which does not exist.
    if (outgoing.to === args.transport.id) {
      if (outgoing.message.type === 'SYNC') {
        for (const listener of listeners) listener(outgoing.message.payload)
      }
      return
    }
    args.transport.send(outgoing.to, outgoing.message)
  }

  // Every internal commit goes through here rather than calling `commit`
  // directly, so persistence cannot be forgotten at one of the several call
  // sites below.
  const save = (result: Parameters<typeof commit>[1]) => {
    commit(args.ref, result, deliver)
    args.onCommit?.(args.ref.current)
  }

  // Intents that arrived before the gate opened. Buffered rather than rejected:
  // every peer's input is dead during its own intro, so an intent here can only
  // come from a peer that skipped ahead — and a rejection would surface to that
  // player as an error for a click they were entitled to make.
  const early: { peerId: string; intent: unknown }[] = []

  const applyNow = (peerId: string, intent: unknown) => {
    save(applyIntent(args.ref.current, peerId, intent, args.now()))
  }

  // Stamped at release, not at arrival: the game begins when the gate opens, so
  // an action cannot carry a timestamp from before the table was live.
  const flush = () => {
    const queued = early.splice(0, early.length)
    for (const e of queued) applyNow(e.peerId, e.intent)
  }

  const gated = () => args.gate !== undefined && !args.gate.open
  // Fires straight away for a gate that is already open, so there is no window
  // in which the buffer is filled and never drained.
  args.gate?.onOpen(flush)

  const submitted = (peerId: string, intent: unknown) => {
    if (gated()) {
      early.push({ peerId, intent })
      return
    }
    applyNow(peerId, intent)
  }

  ticker.start(() => {
    // The whole reason the gate exists: `driveAbsent` playing an absent seat
    // mid-animation is the move nobody at the table could see coming.
    if (gated()) return
    const now = args.now()
    save(tick(args.ref.current, now))
    save(driveAbsent(args.ref.current, now))
  })

  // One rule for host and guest: the seat comes from the connection, never from
  // anything the sender claims, exactly as `applyIntent` resolves it.
  const reportReady = (peerId: string) => {
    const seat = seatOfPeer(args.ref.current, peerId)
    // A peer holding no seat is a spectator; nobody is waiting on it.
    if (seat) args.gate?.ready(seat.playerId)
  }

  return {
    link: {
      submit(intent) {
        if (!keeping) return
        // Addressed by the keeper's own peer id, exactly as a remote seat's
        // intent is: `applyIntent` resolves the seat from it and stamps the
        // player, so the keeper gets no privilege from being the keeper.
        submitted(args.transport.id, intent)
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      close() {
        listeners.clear()
      },
    },
    resync(events = []) {
      if (!keeping) return
      // Empty by default: a statement of where the game stands, not a replay of
      // how it got there. A caller starting a game passes the opening deal, which
      // is the one moment the two are the same thing.
      save({ session: args.ref.current, outgoing: syncAll(args.ref.current, events) })
    },
    handleMessage(frame) {
      if (!keeping) return
      if (frame.type === 'INTRO_READY') {
        // Nothing in the payload is read: `parseEnvelope` never validated it,
        // and the only thing this frame has to say is already in `from`.
        reportReady(frame.from)
        return
      }
      if (frame.type !== 'INTENT') return
      // The payload is unvalidated JSON (`parseEnvelope` checks type/from/seq
      // and nothing else), so `payload` itself may be missing; `applyIntent`
      // takes it from here as `unknown` and checks the rest.
      submitted(frame.from, frame.payload?.intent)
    },
    peerLeft(peerId) {
      if (!keeping) return
      save(disconnect(args.ref.current, peerId, args.now()))
    },
    peerReturned(playerId, peerId) {
      if (!keeping) return
      save(rebind(args.ref.current, playerId, peerId, args.now()))
    },
    handover(toPlayerId) {
      if (!keeping) return
      const result = handover(args.ref.current, toPlayerId)
      if (result.session === args.ref.current) return
      save(result)
      // The session it holds is no longer the one being played: from here the
      // successor reduces, so this keeper stops stamping clocks onto a state
      // nobody will receive and stops answering the intents still in flight
      // towards it.
      keeping = false
      ticker.stop()
      // Otherwise a cap still pending here fires `flush` into a session this
      // keeper no longer owns.
      args.gate?.cancel()
    },
    introReady(peerId) {
      if (!keeping) return
      reportReady(peerId)
    },
    close() {
      keeping = false
      ticker.stop()
      args.gate?.cancel()
      listeners.clear()
    },
  }
}
