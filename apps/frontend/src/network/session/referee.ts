import type { Action, DeckEntry, Engine, Event, GameState, PlayerId, Setup } from '@release/engine'
import { botAction, drawObligationMet } from '@release/engine/fake'
import type { Intent, Message } from '../types'
import { forViewer, rejectionsIn } from './audience'

export interface Seat {
  playerId: PlayerId
  // null while the seat is disconnected. The seat itself survives, which is
  // why PlayerId is a persisted client id rather than a PeerJS peer id.
  peerId: string | null
  absentSince: number | null
  // A seat nobody is coming back to. The absence grace below is a rule about
  // humans who might return; a bot never was one, so it is played from the
  // first tick instead of after 30 seconds of waiting for nobody.
  bot?: boolean
}

export interface Session {
  gameId: string
  keeperId: PlayerId
  engine: Engine
  state: GameState
  seats: Seat[]
  // Every event this match has emitted, in id order. The referee used to
  // reduce, fan out and forget — which is precisely why a peer that missed a
  // batch could never be told what was in it.
  log: Event[]
}

// The session is immutable and every entry point returns a new one, so the
// transport shells hold this cell rather than a Session directly.
export interface SessionRef {
  current: Session
}

// Same shape as lobby/host.ts's Outgoing: `to` is a peer id, or 'broadcast'.
export interface Outgoing {
  to: string | 'broadcast'
  message: Message
}

export interface SessionResult {
  session: Session
  outgoing: Outgoing[]
}

export function syncMessage(
  session: Session,
  playerId: PlayerId,
  events: Event[],
  resync = false,
): Message {
  return {
    type: 'SYNC',
    payload: {
      view: session.engine.project(session.state, playerId),
      events: forViewer(events, playerId),
      ...(resync ? { resync: true } : {}),
    },
  }
}

// One private SYNC per connected seat. A disconnected seat is skipped rather
// than queued: its state is not a fold over deltas, so reconnecting only ever
// needs one fresh projection.
export function syncAll(session: Session, events: Event[]): Outgoing[] {
  return session.seats
    .filter((s): s is Seat & { peerId: string } => s.peerId !== null)
    .map((s) => ({ to: s.peerId, message: syncMessage(session, s.playerId, events) }))
}

export function createSession(args: {
  gameId: string
  keeperId: PlayerId
  engine: Engine
  seed: number
  players: { playerId: PlayerId; peerId: string | null; name: string; bot?: boolean }[]
  setup: Setup
  deck: DeckEntry[]
  events: DeckEntry[]
}): SessionResult {
  const state = args.engine.createGame({
    gameId: args.gameId,
    seed: args.seed,
    players: args.players.map((p) => ({ id: p.playerId, name: p.name })),
    setup: args.setup,
    deck: args.deck,
    events: args.events,
  })

  // Computed once and reused for both the log and the wire below, so the two
  // can never disagree about what the deal was.
  const dealt = args.engine.setupEvents(state)

  const session: Session = {
    gameId: args.gameId,
    keeperId: args.keeperId,
    engine: args.engine,
    state,
    seats: args.players.map((p) => ({
      playerId: p.playerId,
      peerId: p.peerId,
      absentSince: null,
      ...(p.bot ? { bot: true as const } : {}),
    })),
    // The deal is the first thing that happened in this game, so it is the
    // first thing in the log too — a peer restoring the match needs it to draw
    // its own hand.
    log: dealt,
  }

  return {
    session,
    outgoing: [
      {
        to: 'broadcast',
        message: {
          type: 'GAME_STARTED',
          payload: { gameId: args.gameId, keeperId: args.keeperId },
        },
      },
      // The deal is the first thing that happened in this game, so it is the
      // first thing in the feed — the move history opened on a blank without it,
      // and the board's intro reads the deal from here.
      ...syncAll(session, dealt),
    ],
  }
}

export function commit(
  ref: SessionRef,
  result: SessionResult,
  deliver: (outgoing: Outgoing) => void,
): void {
  ref.current = result.session
  for (const outgoing of result.outgoing) deliver(outgoing)
}

export function seatOfPeer(session: Session, peerId: string): Seat | undefined {
  return session.seats.find((s) => s.peerId === peerId)
}

// How long a seat may stay silent before the keeper starts playing it. Matches
// the attack-window timeout the 2026-06-22 networking spec already chose.
export const ABSENT_GRACE_MS = 30_000

export function disconnect(session: Session, peerId: string, now: number): SessionResult {
  const seat = seatOfPeer(session, peerId)
  if (!seat) return { session, outgoing: [] }

  // The seat survives its connection: hand, pending and turn all live in
  // GameState, which never left the keeper.
  const seats = session.seats.map((s) =>
    s.peerId === peerId ? { ...s, peerId: null, absentSince: now } : s,
  )
  return { session: { ...session, seats }, outgoing: [] }
}

export function rebind(
  session: Session,
  playerId: PlayerId,
  peerId: string,
  now: number,
): SessionResult {
  const seat = session.seats.find((s) => s.playerId === playerId)
  if (!seat) return { session, outgoing: [] }

  // Only an absent seat can be claimed. Nothing authenticates a PlayerId — it
  // is a uuid the client persists and announces — so a peer naming someone
  // else's would otherwise take a seat that is still connected: the fan-out
  // would follow the new peer id, the claimant would immediately receive that
  // seat's full projection (hand included) from the SYNC below, and the player
  // still holding it would stop hearing anything with no error. `disconnect`
  // is the only thing that frees a seat, and it runs on the connection closing.
  if (seat.peerId !== null) return { session, outgoing: [] }

  const seats = session.seats.map((s) =>
    s.playerId === playerId ? { ...s, peerId, absentSince: null } : s,
  )
  const next: Session = { ...session, seats }

  // A turn deadline that expired while this seat was EMPTY was deferred, not
  // spent: `tick` refuses to fire a deadline against a seat with nobody in it,
  // and says the absence grace owns a disconnected seat's forward progress. So
  // the shield has to end by handing the turn back, not by forfeiting it — a
  // returning player who found their clock expired gets a fresh one, or the
  // very next tick would auto-play their whole turn before their board even
  // painted. Only an EXPIRED clock: a live one keeps its remaining time, so
  // blinking the connection extends nothing. The first clock stays the
  // ticker's to start — an undefined deadline is not an expired one.
  const { turn } = next.state
  if (turn.player === playerId && turn.deadline !== undefined && now >= turn.deadline) {
    const { state, events } = next.engine.reduce(next.state, { type: 'CLOCK_STARTED', at: now })
    if (state !== next.state) {
      const restamped: Session = { ...next, state, log: [...next.log, ...events] }
      // The new clock is a state change every seat renders (the dock's ring
      // ticks on it), so it travels to everyone — the rejoiner's catch-up
      // projection rides in the same fan-out. But `seats` was already rebound
      // above, so the rejoiner is already among `syncAll`'s recipients: left
      // alone, it would get that ordinary delta AND the marked resend below,
      // two SYNCs where the resend contract promises exactly one. Excluding it
      // here and appending its own marked, full-log resend keeps every other
      // seat's ordinary unmarked delta while giving the rejoiner the one
      // resync it is owed — built from `restamped.log`, which already carries
      // this CLOCK_STARTED's own events, rather than `next.log`, which does not.
      return {
        session: restamped,
        outgoing: [
          ...syncAll(restamped, events).filter((o) => o.to !== peerId),
          { to: peerId, message: syncMessage(restamped, playerId, restamped.log, true) },
        ],
      }
    }
  }

  // Catch-up is a projection PLUS the whole log this seat is entitled to,
  // marked as a resend: a peer's state was never a fold over deltas it might
  // have missed, and the rejoining board must fold this straight into history
  // without animating it, rather than replay the match as choreography.
  return {
    session: next,
    outgoing: [{ to: peerId, message: syncMessage(next, playerId, next.log, true) }],
  }
}

// The engine has no concept of a player who left, so a pending owed by one
// would stall the game permanently. Past the grace period the keeper plays that
// seat with the engine's own opponent policy.
//
// This is deliberately not `runUntilIdle`: that helper auto-resolves pendings
// owed by the *human* and must never front a live UI, because it would silently
// answer the reaction window for someone sitting right there. Here the seat is
// empty, so there is no decision to take away.
export function driveUnattended(session: Session, now: number): SessionResult {
  // A keeper with nobody connected has no table to keep moving: every SYNC it
  // produced would be addressed to a seat that cannot receive it, and the
  // match would advance for no one. Not reachable for a host-keeper, which
  // keeps its own seat through a restore — this guards the case where the
  // keeper itself is the peer whose seat dropped.
  if (!session.seats.some((s) => s.peerId !== null)) return { session, outgoing: [] }

  // A seat with nobody behind it: a bot, which never had anybody, or a human
  // past the grace. Everything below this line treats the two identically —
  // the difference is only in how long the table waits before giving up on
  // somebody arriving.
  const unattended = session.seats.filter(
    (s) =>
      s.peerId === null &&
      (s.bot || (s.absentSince !== null && now - s.absentSince >= ABSENT_GRACE_MS)),
  )

  // Scan every expired-absent seat rather than picking the first: an absent
  // seat that currently owes nothing (not its turn, nothing pending on it)
  // must not shadow a later seat that does — with two or more seats gone,
  // the one the game is actually waiting on need not be seated first.
  for (const seat of unattended) {
    const action = botAction(session.engine, session.state, seat.playerId, now)
    if (!action) continue

    // `tick` owns the window deadline, and it is the only thing that owns it.
    // When the absent seat holds the open window, botAction answers with
    // WINDOW_EXPIRED stamped at `Math.max(at, deadline)` (bots.ts) — a forged
    // future time that would close the window for everyone still sitting
    // there, the moment this seat's grace period runs out. The keeper's clock
    // is the only clock (spec decision 6), so the suggestion is dropped and
    // the window expires on its own deadline, through `tick`, or not at all.
    if (action.type === 'WINDOW_EXPIRED') continue

    const { state, events } = session.engine.reduce(session.state, action)
    if (state !== session.state) {
      const next: Session = { ...session, state, log: [...session.log, ...events] }
      return { session: next, outgoing: syncAll(next, events) }
    }

    // botAction's suggestion was rejected outright. An absent seat still owes
    // the table forward progress, so on its own uninterrupted turn fall back
    // to the same escape hatch a human out of moves would take: draw if it
    // hasn't, or end the turn if it has. Anything still rejected means there
    // is truly nothing to do, and the next expired seat gets a turn instead.
    //
    // This covers a proactive turn only, and deliberately so: it is a net for
    // a `playable` list that offers more than `onPlay` accepts, and `playable`
    // is only consulted on a seat's own turn. A pending is answered from the
    // option list the engine itself publishes on the pending view, so its
    // answer is legal by construction and there is nothing to fall back to —
    // which is why an option list the engine cannot answer has to be fixed in
    // the engine rather than papered over here. `playableFor`
    // (packages/engine/src/fake/project.ts) checking the release cost is that
    // fix for the case this net was written against.
    const { turn, pending, window, over } = session.state
    if (turn.player === seat.playerId && !pending && !window && !over) {
      const fallback: Action = drawObligationMet(session.state)
        ? { type: 'PUSH', player: seat.playerId, at: now }
        : { type: 'DRAW', player: seat.playerId, at: now }
      const retried = session.engine.reduce(session.state, fallback)
      if (retried.state !== session.state) {
        const next: Session = {
          ...session,
          state: retried.state,
          log: [...session.log, ...retried.events],
        }
        return { session: next, outgoing: syncAll(next, retried.events) }
      }
    }
  }

  return { session, outgoing: [] }
}

// The action types a peer is allowed to ask for. `Intent` already excludes
// WINDOW_EXPIRED, but only in TypeScript: what arrives here is parsed JSON from
// a connection, and `parseEnvelope` validates the envelope, never the payload.
// Without this check a peer could fire the keeper's own deadline action early
// and close a reaction window out from under a pending defence, which
// `onDefend` (packages/engine/src/fake/attacks.ts) then rejects forever.
const PEER_INTENT_TYPES: ReadonlySet<string> = new Set<Action['type']>([
  'DRAW',
  'PLAY',
  'PUSH',
  'ATTACK',
  'PASS',
  'UNPASS',
  'RESOLVE',
])

// Parsed JSON, not an `Intent`: the type annotation on the wire is a claim the
// sender made. `null`, a string, or a missing payload all reach here, so the
// shape is checked before anything reads through it.
function isPeerIntent(intent: unknown): intent is Intent {
  if (typeof intent !== 'object' || intent === null) return false
  return PEER_INTENT_TYPES.has((intent as { type?: unknown }).type as string)
}

// The keeper's answer to one peer's intent.
//
// Identity and time are both overwritten rather than validated: `player` comes
// from the connection the frame arrived on, so a peer cannot act as another
// seat, and `at` comes from the keeper's own clock, so a peer cannot claim a
// deadline has passed. Rules evaluation therefore reads one clock. Display does
// not: `window.deadline` and `pending.deadline` are absolute keeper-epoch
// milliseconds and they travel inside every SYNC, so a peer rendering a
// countdown from them is off by the two machines' clock skew — see the
// deadlines note in docs/specs/2026-07-30-p2p-sync-layer-design.md.
export function applyIntent(
  session: Session,
  fromPeerId: string,
  // Deliberately not `Intent`: this is the keeper's trust boundary and what
  // arrives is whatever the connection carried. Callers holding a real Intent
  // pass it unchanged.
  intent: unknown,
  now: number,
): SessionResult {
  const seat = seatOfPeer(session, fromPeerId)
  if (!seat) return { session, outgoing: [] }

  // Dropped in silence rather than answered with a rejection: a well-behaved
  // peer cannot produce this, so there is no UI to inform.
  if (!isPeerIntent(intent)) return { session, outgoing: [] }

  const action = { ...intent, player: seat.playerId, at: now } as Action
  const { state, events } = session.engine.reduce(session.state, action)

  // Referential, not structural: `reduce` hands back the identical object when
  // it refuses an action, which is exactly what "nothing happened" means here.
  // The event ids of consecutive rejections repeat, so they cannot be compared.
  if (state === session.state) {
    const message: Message = {
      type: 'SYNC',
      payload: {
        view: session.engine.project(session.state, seat.playerId),
        events: rejectionsIn(events),
      },
    }
    return { session, outgoing: [{ to: fromPeerId, message }] }
  }

  const next: Session = { ...session, state, log: [...session.log, ...events] }
  return { session: next, outgoing: syncAll(next, events) }
}

// Voluntary only. A keeper that crashes takes GameState and the seed with it,
// and the game ends — peers cannot reconstruct it, because reconstructing it
// means holding the seed, which is the deck order.
export function handover(session: Session, toPlayerId: PlayerId): SessionResult {
  // Handing over to yourself is not a handover, and it cannot be treated as
  // one: the fresh `next` below would pass attachKeeper's "did anything
  // change" identity check, so the keeper would announce a change and stop its
  // ticker while still holding the session — leaving every deadline in the
  // game unowned. The first reaction window or disconnect would then hang the
  // whole table with no error.
  if (toPlayerId === session.keeperId) return { session, outgoing: [] }

  const successor = session.seats.find((s) => s.playerId === toPlayerId)
  if (!successor?.peerId) return { session, outgoing: [] }

  const next: Session = { ...session, keeperId: toPlayerId }
  return {
    session: next,
    outgoing: [
      {
        to: successor.peerId,
        message: { type: 'KEEPER_STATE', payload: { state: session.state } },
      },
      { to: 'broadcast', message: { type: 'KEEPER_CHANGED', payload: { keeperId: toPlayerId } } },
    ],
  }
}

// The successor's side of a handover: it now holds the state it was given.
// Also the host-reload restore's entry point (`useLobby.ts`'s `restoreHost`),
// which is why `log` is accepted here rather than always starting fresh: that
// caller has the match's own log in hand (read back from storage) and passes
// it through.
export function adoptSession(args: {
  state: GameState
  gameId: string
  keeperId: PlayerId
  engine: Engine
  seats: Seat[]
  // Omitted by the handover path above: KEEPER_STATE carries GameState alone,
  // not the log the predecessor had accumulated, and that message has no
  // production receiver today — nothing currently adopts a session through it.
  // Should one arrive, it would start logless, same as this default.
  log?: Event[]
}): Session {
  return {
    gameId: args.gameId,
    keeperId: args.keeperId,
    engine: args.engine,
    state: args.state,
    seats: args.seats,
    log: args.log ?? [],
  }
}

// The keeper owns every clock in the session. `WINDOW_EXPIRED` carries no player
// identity and the engine rejects it before the deadline regardless of sender,
// so there is no owner rule to encode — the keeper simply fires it, and peers
// never send it at all (Intent excludes it).
export function tick(session: Session, now: number): SessionResult {
  const window = session.state.window
  const pending = session.state.pending
  // An attack thrown into an open window sets a `defend` pending but leaves
  // `state.window` untouched (onAttack, packages/engine/src/fake/attacks.ts),
  // so the two can coexist with the defend deadline at or after the window's.
  // Every other window action already rejects while a decision is pending, so
  // the keeper's own timeout must defer the same way: expiring the window out
  // from under a pending defend would null `state.window`, and the
  // release-scope defend resolution (onDefend, attacks.ts) requires a window
  // to still exist — permanently stalling that pending. Resolving the pending
  // first (below) closes the window itself where that is the correct outcome.
  //
  // Only `defend` defers it. A blanket "any pending" would be the wider rule,
  // and the wrong one: `handLimit` and `crush` (state.ts) carry no deadline of
  // their own, so one of those coexisting with an open window would hold that
  // window open for as long as the pending seat stayed silent.
  if (window && pending?.kind !== 'defend' && now >= window.deadline) {
    const { state, events } = session.engine.reduce(session.state, {
      type: 'WINDOW_EXPIRED',
      at: now,
    })
    if (state === session.state) return { session, outgoing: [] }
    const next: Session = { ...session, state, log: [...session.log, ...events] }
    return { session: next, outgoing: syncAll(next, events) }
  }

  // A stalled defence blocks every other player, which is why the engine gives
  // it a deadline — but it gives no expiry action, so the keeper answers with
  // the passive default on the owing player's behalf.
  if (pending?.kind === 'defend' && now >= pending.deadline) {
    const seat = session.seats.find((s) => s.playerId === pending.player)
    // A disconnected owing seat has nobody to resolve on: the stalled defence
    // simply waits for that seat to reconnect rather than being force-resolved.
    if (!seat?.peerId) return { session, outgoing: [] }
    return applyIntent(
      session,
      seat.peerId,
      { type: 'RESOLVE', choice: { kind: 'defend', card: null } },
      now,
    )
  }

  // The turn's inactivity clock. The engine stamps it on every commit that
  // leaves the table idling on the player on turn (reduce's post-step), but
  // the FIRST turn has no committed action behind it — createGame carries no
  // timestamp — so the keeper starts that one clock itself, on its first tick.
  // The ticker only runs once the start gate opens (remoteLink), which is what
  // makes "first tick" mean "the table went live", not "cards still flying".
  // `discardForRelease` does not suspend the turn clock (#101): paying a
  // release's price is the turn's own owner acting inside their own turn, so
  // the engine keeps stamping the deadline through it (`stampTurnClock`,
  // packages/engine/src/fake/reduce.ts) and the keeper has to keep firing it.
  // Every other pending hands the wait to somebody else and still defers.
  const { turn, drawing, over } = session.state
  const costPending = pending?.kind === 'discardForRelease' ? pending : null
  if (!window && (!pending || costPending) && !drawing && !over) {
    if (turn.deadline === undefined) {
      const { state, events } = session.engine.reduce(session.state, {
        type: 'CLOCK_STARTED',
        at: now,
      })
      if (state === session.state) return { session, outgoing: [] }
      const next: Session = { ...session, state, log: [...session.log, ...events] }
      return { session: next, outgoing: syncAll(next, events) }
    }

    if (now >= turn.deadline) {
      // The same rule as the stalled defence above: a deadline never fires
      // against a seat with nobody in it — driveUnattended's grace period owns a
      // disconnected seat's forward progress.
      const seat = session.seats.find((s) => s.playerId === turn.player)
      if (!seat?.peerId) return { session, outgoing: [] }

      // The idle player's whole obligation resolves on one expiry — the
      // mandatory draw, then the push — per the dock's design notes
      // (playground TurnDockBlock): a timed-out turn ends, it does not win a
      // fresh 30s per forced action. A draw that raises a pending (Error 503)
      // or ends the turn itself (Hallucination) stops the push half; the
      // pending's own flow takes over from there.
      let state = session.state
      let events: Event[] = []
      // An unpaid release still standing goes back first, for the same reason a
      // press on DRAW or PUSH takes it back (#101): while an unpaid release
      // stands, anything other than paying takes it back — and here nothing
      // paid it. It is also what makes the draw/push below reachable at all,
      // since the engine refuses both while any pending is open. `cancelRelease`
      // is free of consequences by construction: the play emitted nothing and
      // moved no card, so clearing the pending IS the whole undo.
      if (costPending) {
        const taken = session.engine.reduce(state, {
          type: 'RESOLVE',
          player: costPending.player,
          choice: { kind: 'cancelRelease' },
          at: now,
        })
        state = taken.state
        events = taken.events
      }
      if (!drawObligationMet(state)) {
        const drawn = session.engine.reduce(state, { type: 'DRAW', player: turn.player, at: now })
        state = drawn.state
        // Appended, not assigned: the cancel above may have run first. It emits
        // nothing today, and this is what keeps that from being load-bearing.
        events = [...events, ...drawn.events]
      }
      if (
        state.turn.player === turn.player &&
        !state.pending &&
        !state.window &&
        !state.over &&
        drawObligationMet(state)
      ) {
        const pushed = session.engine.reduce(state, { type: 'PUSH', player: turn.player, at: now })
        if (pushed.state !== state) {
          events = [...events, ...pushed.events]
          state = pushed.state
        }
      }
      if (state === session.state) return { session, outgoing: [] }
      const next: Session = { ...session, state, log: [...session.log, ...events] }
      return { session: next, outgoing: syncAll(next, events) }
    }
  }

  return { session, outgoing: [] }
}
