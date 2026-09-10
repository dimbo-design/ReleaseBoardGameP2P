import type { Action, Target } from '../actions'
import { rulesFor } from '../cards'
import type { Reduction } from '../engine'
import { shuffle } from '../rng'
import type { CardUid, GameState, PlayerId } from '../state'
import { foldTally } from '../tally'
import { onAttack, onDefend } from './attacks'
import {
  attackTargets,
  createLog,
  drawObligationMet,
  endTurn,
  handLimitFor,
  isWellFormedAction,
  type Log,
  nextSeat,
  reject,
  setHand,
  TURN_ACTION_MS,
} from './core'
import { onPickFromDiscard } from './discard'
import { onGiveCard, onRequestCard } from './handAttacks'
import { pruneEmptyPiles } from './piles'
import { playableFor } from './project'
import { onCancelRelease, onDiscardForRelease, onPlay } from './release'
import { fireTrigger, onDecline503, onNeutralize } from './triggers'
import { onPass, onUnpass, onWindowExpired } from './window'

export { handLimitFor, nextSeat }

export function legalTargets(state: GameState, actor: PlayerId, card: CardUid): Target[] {
  if (!playableFor(state, actor).includes(card)) return []
  const held = state.players[actor].hand.find((c) => c.uid === card)
  if (!held) return []
  const rules = rulesFor(held.id)
  if (rules?.kind !== 'attack') return []
  return attackTargets(state, actor, held.id)
}

// Rules decisions answer 7, first case: with no draw cards left anywhere, the
// discard is taken, shuffled, and becomes a single new draw pile. Without it the
// deck is finite and the draw is mandatory, so an ordinary game does not end —
// it stops, with `onPush` refusing the turn and every pile empty.
//
// Deterministic like every other shuffle here: keyed on (seed, cursor) and the
// advanced cursor written back, so each peer recomputes the same pile from the
// same serialized state rather than agreeing over the wire.
//
// Answer 7's second case — one pile of several running out, which removes that
// pile rather than recycling anything — is not here. It cannot be reached while
// `main` only ever holds one pile, and the split that creates the others is
// slice A of #61.
function refillFromDiscard(state: GameState, log: Log): GameState {
  if (state.decks.main.some((pile) => pile.length > 0)) return state
  // Nothing to recycle: every card is in a hand or a release zone. The draw
  // stays rejected, which is honest, rather than being handed an empty pile.
  if (state.decks.discard.length === 0) return state

  const { items, cursor } = shuffle(state.decks.discard, state.seed, state.rngCursor)
  log.add({ type: 'deckReshuffled', cards: items.length })
  return {
    ...state,
    decks: { ...state.decks, main: [items], discard: [] },
    rngCursor: cursor,
  }
}

// One step of an in-progress draw, repeated until the sequence is spent or
// something interrupts it. This is the machinery rules decisions answer 2
// describes: the draw is neither atomic nor a series of player-issued actions,
// but one action carrying a sequence that survives a pending.
//
// It stops rather than finishing when the drawer can no longer be drawing —
// the game ended, they were eliminated, or the turn moved on. Each of those
// used to keep dealing: a card into an eliminated player's hand, or a second
// card for a player whose turn Hallucination had already ended.
export function runDrawSequence(state: GameState, log: Log, at: number): GameState {
  let next = state
  while (next.drawing && next.drawing.piles.length > 0) {
    const owed = next.drawing
    if (next.over || next.eliminated.includes(owed.player) || next.turn.player !== owed.player) {
      return { ...next, drawing: null, eventSeq: log.seq }
    }

    const [pileIndex, ...rest] = owed.piles
    const remaining = rest.length > 0 ? { ...owed, piles: rest } : null
    const filled = refillFromDiscard(next, log)
    const pile = filled.decks.main[pileIndex]
    // A pile with nothing in it and nothing to recycle yields no card; the step
    // is spent either way rather than retried forever.
    if (!pile || pile.length === 0) {
      next = { ...filled, drawing: remaining, eventSeq: log.seq }
      continue
    }

    const card = pile[0]
    const main = filled.decks.main.map((p, i) => (i === pileIndex ? p.slice(1) : p))
    const advanced: GameState = {
      ...filled,
      decks: { ...filled.decks, main },
      drawing: remaining,
      // A turn's obligation is discharged pile by pile, so each card taken
      // records its source. Good Vibe-Coding draws twice off pile 0 and the
      // duplicate is harmless — the obligation asks whether a pile has been
      // drawn from, not how often.
      turn:
        owed.player === filled.turn.player
          ? { ...filled.turn, drawnFrom: [...filled.turn.drawnFrom, pileIndex] }
          : filled.turn,
    }

    if (rulesFor(card.id)?.kind === 'trigger') {
      log.add({
        type: 'drawn',
        player: owed.player,
        pile: pileIndex,
        deckSize: main[pileIndex].length,
      })
      next = fireTrigger(advanced, log, owed.player, card, at)
    } else {
      log.add({
        type: 'drawn',
        player: owed.player,
        card: card.id,
        pile: pileIndex,
        deckSize: main[pileIndex].length,
      })
      next = setHand(advanced, owed.player, [...advanced.players[owed.player].hand, card])
    }

    // Paused, not finished: whatever the card raised is owed first, and the
    // rest of the sequence waits in `drawing` for the resume.
    if (next.pending) return { ...next, eventSeq: log.seq }
  }
  // The sequence is over, so an emptied pile may go now — never mid-sequence,
  // where removing one would shift the indices still owed behind it.
  return pruneEmptyPiles({ ...next, drawing: null, eventSeq: log.seq }, log)
}

// Which piles this draw covers. Base runs over every pile that has cards in it;
// Strategic takes one from the pile the action names (rules decisions answer 1).
// A table with nothing anywhere still yields `[0]`, so the sequence reaches the
// refill rather than being turned away before it can recycle the discard.
function drawTargets(state: GameState, chosen: number | undefined): number[] {
  if (state.setup.gitBranch === 'strategic') return [chosen ?? 0]
  const stocked = state.decks.main.flatMap((pile, i) => (pile.length > 0 ? [i] : []))
  return stocked.length > 0 ? stocked : [0]
}

function onDraw(state: GameState, action: Action & { type: 'DRAW' }): Reduction {
  if (state.over) return reject(state, action, 'game is over')
  if (state.pending) return reject(state, action, 'a decision is pending')
  if (state.window) return reject(state, action, 'a reaction window is open')
  if (state.turn.player !== action.player) return reject(state, action, 'not your turn')
  if (drawObligationMet(state)) return reject(state, action, 'already drew this turn')

  const piles = drawTargets(state, action.pile)
  // Nothing in the named piles and nothing to recycle into them: the draw is
  // refused rather than silently counting as done.
  const reachable =
    piles.some((i) => (state.decks.main[i]?.length ?? 0) > 0) || state.decks.discard.length > 0
  if (!reachable) return reject(state, action, 'that pile is empty')

  // The sequence does the work — the same runner Good Vibe-Coding uses, so a
  // trigger drawn from pile 1 of 3 pauses here exactly as it pauses there.
  const log = createLog(state.eventSeq)
  const started: GameState = { ...state, drawing: { player: action.player, piles } }
  return { state: runDrawSequence(started, log, action.at), events: log.events }
}

function onPush(state: GameState, action: Action & { type: 'PUSH' }): Reduction {
  if (state.over) return reject(state, action, 'game is over')
  if (state.pending) return reject(state, action, 'a decision is pending')
  if (state.window) return reject(state, action, 'a reaction window is open')
  if (state.turn.player !== action.player) return reject(state, action, 'not your turn')
  // The draw is mandatory, so a turn cannot be passed without it.
  if (!drawObligationMet(state)) return reject(state, action, 'you must draw before pushing')

  const log = createLog(state.eventSeq)
  return { state: endTurn(state, log), events: log.events }
}

function onHandLimit(state: GameState, action: Action & { type: 'RESOLVE' }): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'handLimit') return reject(state, action, 'no hand-limit decision pending')
  if (pending.player !== action.player) return reject(state, action, 'not your decision')
  const choice = action.choice
  if (choice.kind !== 'handLimit') return reject(state, action, 'wrong choice for this decision')
  // The entry guard only checks that `choice.kind` is a string, not this
  // variant's payload — a well-formed RESOLVE can still carry a handLimit
  // choice with a missing or malformed `cards` array.
  if (!Array.isArray(choice.cards)) return reject(state, action, 'malformed handLimit choice')
  if (choice.cards.length !== pending.excess) {
    return reject(state, action, `discard exactly ${pending.excess}`)
  }

  const hand = state.players[action.player].hand
  const doomed = new Set(choice.cards)
  if (choice.cards.some((uid) => !hand.some((c) => c.uid === uid))) {
    return reject(state, action, 'you do not hold that card')
  }

  const log = createLog(state.eventSeq)
  const discarded = hand.filter((c) => doomed.has(c.uid))
  for (const c of discarded) {
    log.add({ type: 'discarded', player: action.player, card: c.id, reason: 'handLimit' })
  }

  const kept = setHand(
    state,
    action.player,
    hand.filter((c) => !doomed.has(c.uid)),
  )
  const withDiscard: GameState = {
    ...kept,
    decks: { ...kept.decks, discard: [...kept.decks.discard, ...discarded] },
    pending: null,
  }
  // Bad Vibe-Coding asks the same question without ending anything — it is a
  // card off the hand, not a lost turn. Only the hand limit that a turn's own
  // ending raised goes on to end it.
  if (pending.endsTurn === false) {
    return { state: { ...withDiscard, eventSeq: log.seq }, events: log.events }
  }
  return { state: endTurn(withDiscard, log), events: log.events }
}

// Keeper-only, like WINDOW_EXPIRED. Everything after the first turn is stamped
// by the post-commit step in `reduce` below; this exists because the first turn
// has no committed action behind it — createGame carries no timestamp.
function onClockStarted(state: GameState, action: Action & { type: 'CLOCK_STARTED' }): Reduction {
  if (state.over) return reject(state, action, 'game is over')
  if (state.pending) return reject(state, action, 'a decision is pending')
  if (state.window) return reject(state, action, 'a reaction window is open')
  if (state.drawing) return reject(state, action, 'a draw is in progress')
  // A LIVE clock may not be restarted — that would be an extension. An expired
  // one may: the keeper's tick refuses to fire a deadline against an empty
  // seat, so a player who dropped mid-turn returns to a clock that ran out
  // with nobody able to act on it. Restarting it is the deferred expiry being
  // handed back to its owner, and the keeper is the only party who can ask
  // (CLOCK_STARTED is not a peer intent — session/referee.ts).
  if (state.turn.deadline !== undefined && action.at < state.turn.deadline) {
    return reject(state, action, 'the turn clock is already running')
  }
  return {
    state: {
      ...state,
      turn: { ...state.turn, openedAt: action.at, deadline: action.at + TURN_ACTION_MS },
    },
    events: [],
  }
}

// The turn's inactivity clock, restarted by every committed action while the
// table idles on the player on turn and suspended while a window, a pending or
// a running draw owns the wait. One shared step after every commit, so no
// handler — present or future — can forget it; a rejected action never reaches
// here, which is what keeps `reject`'s state-identity contract intact.
//
// `discardForRelease` is the one pending that does NOT suspend it (#101). The
// others hand the wait to somebody else — a defence, a hand limit, a 503 — and
// the turn is genuinely not being spent. Paying a release's price is the turn's
// own owner still acting inside their own turn, so pulling that stretch out
// from under the turn's timer would let a player stop their own clock by
// staging a release and walking away. The clock is app timing rather than a
// rule (docs/rules/README.md, "Что правилом НЕ является"), so this is a timing
// decision and not a rules one.
function stampTurnClock(state: GameState, at: number): GameState {
  const costPending = state.pending?.kind === 'discardForRelease'
  const idle = !state.over && (!state.pending || costPending) && !state.window && !state.drawing
  if (!idle) {
    if (state.turn.deadline === undefined && state.turn.openedAt === undefined) return state
    return { ...state, turn: { ...state.turn, openedAt: undefined, deadline: undefined } }
  }
  return { ...state, turn: { ...state.turn, openedAt: at, deadline: at + TURN_ACTION_MS } }
}

function onResolve(state: GameState, action: Action & { type: 'RESOLVE' }): Reduction {
  switch (action.choice.kind) {
    case 'handLimit':
      return onHandLimit(state, action)
    case 'discardForRelease':
      return onDiscardForRelease(state, action)
    case 'cancelRelease':
      return onCancelRelease(state, action)
    case 'defend':
      return onDefend(state, action)
    case 'requestCard':
      return onRequestCard(state, action)
    case 'giveCard':
      return onGiveCard(state, action)
    case 'neutralize503':
    case 'crush':
      return onNeutralize(state, action)
    case 'pickFromDiscard':
      return onPickFromDiscard(state, action)
    // Every Choice variant is now handled above; this default only guards
    // against a malformed choice (any `kind` string) surviving deserialization.
    default:
      return reject(
        state,
        action,
        `unsupported choice: ${(action.choice as { kind: string }).kind}`,
      )
  }
}

export function reduce(state: GameState, action: Action): Reduction {
  // A malformed action (any shape survives JSON deserialization) is rejected
  // before any handler destructures it, so no handler needs its own guard.
  if (!isWellFormedAction(action)) {
    return reject(state, action, 'malformed action')
  }

  const at = 'at' in action && typeof action.at === 'number' ? action.at : 0
  let result = dispatch(state, action)
  // A paused draw resumes the moment nothing is owed ahead of it, inside the
  // same reduction that cleared the way. Doing it here rather than in each
  // resolution path means every way a pending can end — answered, declined,
  // fatal — resumes identically, and no future one can forget to.
  if (result.state.drawing && !result.state.pending) {
    const log = createLog(result.state.eventSeq)
    result = {
      state: runDrawSequence(result.state, log, at),
      events: [...result.events, ...log.events],
    }
  }
  // A rejected action hands back the identical state object, and must keep
  // doing so — the clock only moves on a commit. It also emits nothing worth
  // counting, so the fold sits below this guard rather than above it.
  if (result.state === state) return result
  const stamped = stampTurnClock(result.state, at)
  return {
    state: { ...stamped, tally: foldTally(stamped.tally, result.events) },
    events: result.events,
  }
}

function dispatch(state: GameState, action: Action): Reduction {
  switch (action.type) {
    case 'DRAW':
      return onDraw(state, action)
    case 'PUSH':
      return onPush(state, action)
    case 'RESOLVE':
      return onResolve(state, action)
    case 'PLAY':
      return onPlay(state, action)
    case 'PASS':
      // One key, two meanings, told apart by what the table is waiting for. A
      // 503 the presser owns is a decision, not a reaction window: PASS there
      // is "I will not neutralize" (#103 testing, problem 4), and `onPass`
      // would reject it twice over — no window is open, and a decision is
      // pending. Every other PASS is the window's own.
      return state.pending?.kind === 'neutralize503' && state.pending.player === action.player
        ? onDecline503(state, action)
        : onPass(state, action)
    case 'UNPASS':
      return onUnpass(state, action)
    case 'WINDOW_EXPIRED':
      return onWindowExpired(state, action)
    case 'CLOCK_STARTED':
      return onClockStarted(state, action)
    case 'ATTACK':
      return onAttack(state, action)
    default:
      return reject(
        state,
        action as Action,
        `unsupported action: ${String((action as Action)?.type)}`,
      )
  }
}
