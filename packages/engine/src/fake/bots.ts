import type { Action, Choice } from '../actions'
import { rulesFor } from '../cards'
import type { Engine } from '../engine'
import {
  type CardUid,
  type GameState,
  type PlayerId,
  pendingOwes,
  type ReleaseSlot,
  seatOwing,
} from '../state'
import type { ReleaseView } from '../view'

// The order the rules give (see release.ts's `neutralizeOptions`): the
// cheapest available answer first. Matched here so a bot forced to sacrifice
// always gives up the same slot a human reading the rulebook would.
const SLOTS: readonly ReleaseSlot[] = ['frontend', 'backend', 'database']

// A policy bug (an option list that never empties, a pending the bot never
// resolves) must not hang the caller — this bounds `runUntilIdle` the same
// way `DEFEND_MS`/`WINDOW_*_MS` bound a human's clock.
const MAX_IDLE_ITERATIONS = 500

function firstFilledReleaseUid(release: ReleaseView): CardUid | undefined {
  for (const slot of SLOTS) {
    const released = release[slot]
    if (released) return released.uid
  }
  return undefined
}

// A source of actions, exactly like a human or the future P2P sync layer:
// every branch below reads its options from `project`/`legalTargets`, never
// from `state` directly, so the bot is a real consumer of the same contract
// the UI uses rather than a privileged insider.
export function botAction(
  engine: Engine,
  state: GameState,
  me: PlayerId,
  at: number,
): Action | null {
  const view = engine.project(state, me)
  if (view.over) return null

  const pending = view.pending
  // "Is this decision mine?" — asked of the projection, through the engine's
  // own predicate, because a `systemUpgrade` is owed to a roster rather than to
  // one seat and `me` may be anywhere on it. Every kind below still answers for
  // a single seat; the predicate is what decides whether `me` is that seat.
  if (pending && pendingOwes(pending, me)) {
    switch (pending.kind) {
      case 'defend': {
        const card = pending.options[0] ?? null
        return { type: 'RESOLVE', player: me, choice: { kind: 'defend', card }, at }
      }
      case 'discardForRelease': {
        const card = pending.options[0]
        return { type: 'RESOLVE', player: me, choice: { kind: 'discardForRelease', card }, at }
      }
      case 'handLimit': {
        const cards = pending.options.slice(0, pending.excess)
        return { type: 'RESOLVE', player: me, choice: { kind: 'handLimit', cards }, at }
      }
      case 'neutralize503':
      case 'crush': {
        const method = pending.methods[0]
        const choice: Choice =
          method === 'sacrifice'
            ? { kind: pending.kind, method, card: firstFilledReleaseUid(view.self.release) }
            : { kind: pending.kind, method }
        return { type: 'RESOLVE', player: me, choice, at }
      }
      case 'requestCard': {
        // Security Bug's bluff: name a card type actually seen in play — the
        // only card identity a bot may see about someone else's hand.
        const card = view.decks.discardTop ?? ''
        return { type: 'RESOLVE', player: me, choice: { kind: 'requestCard', card }, at }
      }
      case 'giveCard': {
        const match = view.self.hand.find((c) => c.id === pending.requested)
        return {
          type: 'RESOLVE',
          player: me,
          choice: { kind: 'giveCard', card: match?.uid ?? '' },
          at,
        }
      }
      case 'pickFromDiscard': {
        // options[0] may be a trigger a sudo offer carries for the DECK slot;
        // naming it for the hand is rejected, and a pending nothing can resolve
        // stalls everything behind it.
        const hand = pending.options.find((c) => rulesFor(c.id)?.kind !== 'trigger')
        if (!hand) return null
        const toDeck =
          pending.picks === 2 ? pending.options.find((c) => c.uid !== hand.uid)?.uid : undefined
        return {
          type: 'RESOLVE',
          player: me,
          choice: { kind: 'pickFromDiscard', card: hand.uid, ...(toDeck ? { toDeck } : {}) },
          at,
        }
      }
      case 'reorderTop': {
        // A bot has no opinion about deck order; leaving it alone is a legal
        // answer and keeps the seat from stalling the table.
        const order = pending.piles.map((e) => ({
          pile: e.pile,
          cards: e.cards.map((c) => c.uid),
        }))
        return { type: 'RESOLVE', player: me, choice: { kind: 'reorderTop', order }, at }
      }
      default:
        return null
    }
  }

  if (view.window) {
    // The window's own owner is never a responder — they cannot ATTACK or
    // PASS it. Left with nothing else to do, they are the one who closes it
    // once its own deadline has passed, exactly as a countdown timer would.
    if (view.window.player === me) {
      return { type: 'WINDOW_EXPIRED', at: Math.max(at, view.window.deadline) }
    }
    const options = view.window.canAttackWith
    if (options.length > 0) {
      return { type: 'ATTACK', player: me, card: options[0], at }
    }
    return { type: 'PASS', player: me, at }
  }

  if (view.turn.player === me) {
    const playable = view.self.playable
    if (playable.length > 0) {
      const card = playable[0]
      const targets = engine.legalTargets(state, me, card)
      return targets.length > 0
        ? { type: 'PLAY', player: me, card, target: targets[0], at }
        : { type: 'PLAY', player: me, card, at }
    }
    if (!view.turn.hasDrawn) {
      return { type: 'DRAW', player: me, at }
    }
    return { type: 'PUSH', player: me, at }
  }

  return null
}

// Drives every non-human seat until the human's own PROACTIVE turn, the game
// ends, or a policy bug would otherwise hang the caller (the 500-iteration
// cap below).
//
// This also auto-resolves any REACTIVE pending owed by the human — `defend`,
// `neutralize503`, `crush`, `handLimit` — using the same default policy as
// any bot seat, whenever it interrupts someone else's turn. That is a
// deliberate convenience for a HEADLESS driver (tests, simulation, "what does
// a finished game look like"): it lets the loop reach the human's real turn
// without a UI in the room to answer on their behalf.
//
// Do not point this at a live UI where a human answers their own prompts.
// The reaction window is the game's most interactive moment (bluffing on
// Security Bug, choosing to eat a hit vs. spend a defence) — auto-resolving
// it removes the decision the player is meant to make. A UI-facing driver
// must stop on any pending owed by the human and surface it instead of
// calling into this function.
export function runUntilIdle(
  engine: Engine,
  state: GameState,
  human: PlayerId,
  at: number,
): GameState {
  let current = state
  for (let i = 0; i < MAX_IDLE_ITERATIONS; i += 1) {
    // `current.over`/`current.pending`/`current.window`/`current.turn.player`
    // below are raw GameState reads, but they are loop control — "whose turn
    // is it, is the game over" — not a legality decision. The never-read-
    // options-from-GameState rule is about what a seat may DO, which still
    // comes from `project`/`legalTargets` inside `botAction`; it was never
    // about knowing whose turn it structurally is.
    if (current.over) return current
    // "Owes an action" means it is their proactive turn — a reactive pending
    // interrupting someone else's turn (e.g. defending an attack) still gets
    // driven here, exactly like any other seat, so the table only actually
    // hands back once it is genuinely the human's own turn to act. See the
    // doc comment above: this is the headless-driver behaviour, not safe to
    // reuse verbatim for a UI driver.
    if (current.turn.player === human && !current.pending && !current.window) return current
    // The seat the pending is waiting on, which is no longer always a single
    // named one: a `systemUpgrade` owes its whole roster, and the driver has to
    // pick somebody to be. `seatOwing` gives the first seat still owing (the
    // actor once it is picking), so repeated passes here drain the roster one
    // answer at a time instead of asking a seat that has already answered.
    const seat = seatOwing(current.pending) ?? current.turn.player
    const action = botAction(engine, current, seat, at)
    if (!action) return current
    current = engine.reduce(current, action).state
  }
  return current
}
