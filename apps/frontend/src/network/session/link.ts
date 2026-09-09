import type { Event, PlayerId, PlayerView } from '@release/engine'
import type { Intent } from '../types'
import {
  applyIntent,
  commit,
  driveAbsent,
  type Outgoing,
  rebind,
  type SessionRef,
  tick,
} from './referee'

export interface Sync {
  view: PlayerView
  events: Event[]
  resync?: boolean
}

// The seam. `useGame` and the page hold this and nothing else, so they cannot
// tell a local engine from a remote keeper — which is what lets solo play, the
// playground, and every headless test exercise the same code the network does.
export interface GameLink {
  submit(intent: Intent): void
  subscribe(listener: (sync: Sync) => void): () => void
  close(): void
}

// Injected so tests drive time by hand instead of waiting on a real clock.
export interface Ticker {
  start(fn: () => void): void
  stop(): void
}

export function intervalTicker(ms = 250): Ticker {
  let handle: ReturnType<typeof setInterval> | null = null
  return {
    start(fn) {
      handle = setInterval(fn, ms)
    },
    stop() {
      if (handle !== null) clearInterval(handle)
      handle = null
    },
  }
}

// A local seat's address. A seat with no connection still has to be addressable
// or the referee can neither resolve its intents (`seatOfPeer` matches on peer
// id) nor fan out to it (`syncAll` skips a null-peerId seat) — every click
// would be discarded with no rejection and no log. The prefix keeps these out
// of the PeerJS id space so a synthetic address can never collide with a real
// connection.
const localAddress = (playerId: PlayerId) => `local:${playerId}`

// Every link over one SessionRef, so a commit made through one of them reaches
// the others. `applyIntent` fans out to every seat, but only the submitting
// link's `deliver` runs — without a shared registry each link would discard the
// messages addressed to its peers and every seat but the actor would freeze.
// Keyed weakly: a ref that goes out of scope takes its links with it.
const linksByRef = new WeakMap<SessionRef, Set<(outgoing: Outgoing) => void>>()

export function createLocalLink(args: {
  ref: SessionRef
  me: PlayerId
  now: () => number
  ticker?: Ticker
}): GameLink {
  const ticker = args.ticker ?? intervalTicker()
  const listeners = new Set<(sync: Sync) => void>()

  // Resolved per call rather than once, because a rebind changes the seat's
  // peer id under a link that outlives it.
  const myPeerId = () => args.ref.current.seats.find((s) => s.playerId === args.me)?.peerId ?? null

  // Bind an unconnected seat to its local address. Solo play and the playground
  // build sessions whose seats hold no connection at all; a seat that does hold
  // one (a keeper that is also a player, driving its own seat through a local
  // link) keeps it.
  if (args.ref.current.seats.some((s) => s.playerId === args.me && s.peerId === null)) {
    // `0` for the clock: this is the startup self-bind, before the table is
    // live — no deadline exists yet, so the re-stamp branch cannot fire, and
    // the first clock stays the ticker's to start.
    args.ref.current = rebind(args.ref.current, args.me, localAddress(args.me), 0).session
  }

  const receive = (outgoing: Outgoing) => {
    // 'broadcast' is unreachable for SYNC today (only GAME_STARTED broadcasts,
    // and the type check below filters that out) — kept for future broadcast
    // SYNC producers so this guard doesn't silently drop them later.
    if (outgoing.to !== myPeerId() && outgoing.to !== 'broadcast') return
    if (outgoing.message.type !== 'SYNC') return
    for (const listener of listeners) listener(outgoing.message.payload)
  }

  const siblings = linksByRef.get(args.ref) ?? new Set<(outgoing: Outgoing) => void>()
  linksByRef.set(args.ref, siblings)
  siblings.add(receive)

  // Offered to every link over this ref, each of which keeps only what is
  // addressed to its own seat.
  const deliver = (outgoing: Outgoing) => {
    for (const sibling of siblings) sibling(outgoing)
  }

  ticker.start(() => {
    const now = args.now()
    commit(args.ref, tick(args.ref.current, now), deliver)
    commit(args.ref, driveAbsent(args.ref.current, now), deliver)
  })

  return {
    submit(intent) {
      const me = myPeerId()
      if (me === null) return
      commit(args.ref, applyIntent(args.ref.current, me, intent, args.now()), deliver)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      ticker.stop()
      listeners.clear()
      siblings.delete(receive)
    },
  }
}
