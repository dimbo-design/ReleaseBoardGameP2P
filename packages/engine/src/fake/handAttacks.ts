import type { Action, Target } from '../actions'
import type { Reduction } from '../engine'
import { randomAt } from '../rng'
import type { CardInstance, GameState, PlayerId } from '../state'
import { bankToDiscard, createLog, DEFEND_MS, defencesFor, type Log, reject, setHand } from './core'

const discard = (state: GameState, cards: CardInstance[]): GameState => bankToDiscard(state, cards)

// Opens a hand-scoped defence. The attack card has already left the attacker's
// hand; a successful defence simply means the theft never happens.
export function openHandAttack(
  state: GameState,
  log: Log,
  attacker: PlayerId,
  attack: CardInstance,
  target: PlayerId,
  sudo: boolean,
  combo: CardInstance | undefined,
  at: number,
): GameState {
  log.add({ type: 'attacked', attacker, card: attack.id, sudo, target })
  return {
    ...state,
    pending: {
      kind: 'defend',
      player: target,
      attacker,
      attack: attack.uid,
      attackId: attack.id,
      sudo,
      ...(combo ? { combo } : {}),
      canDefendWith: defencesFor(state, target, sudo),
      openedAt: at,
      deadline: at + DEFEND_MS,
      scope: 'hand',
    },
    eventSeq: log.seq,
  }
}

// Bug / Out of Memory / Legacy Code: one card at random. The cursor advances
// through state, so the same action on the same state always takes the same card.
export function stealRandom(
  state: GameState,
  log: Log,
  from: PlayerId,
  to: PlayerId,
  parent?: number,
): GameState {
  const hand = state.players[from].hand
  if (hand.length === 0) return { ...state, eventSeq: log.seq }
  const index = Math.floor(randomAt(state.seed, state.rngCursor) * hand.length)
  const card = hand[index]
  log.add(
    {
      type: 'handTransfer',
      from,
      to,
      card: card.id,
      // Only the two parties learn which card moved; the table sees counts.
      visibleTo: [from, to],
    },
    parent,
  )
  const stripped = setHand(
    state,
    from,
    hand.filter((c) => c.uid !== card.uid),
  )
  return {
    ...setHand(stripped, to, [...stripped.players[to].hand, card]),
    rngCursor: state.rngCursor + 1,
    eventSeq: log.seq,
  }
}

// DDoS: destroy a Monitoring, or bounce a release back to its owner's hand and
// freeze that instance for a round. It is the only card that reaches a release
// protected by Code Review — which is discarded rather than returned.
export function resolveDdos(
  state: GameState,
  log: Log,
  // Unused today — neither `monitoringDestroyed` nor `releaseReturned` records
  // who threw the DDoS; kept in the signature so a future task can attribute it
  // without changing every call site.
  _actor: PlayerId,
  target: Target,
): GameState {
  if (target.kind === 'monitoring') {
    const mon = state.players[target.player].release.monitoring
    if (!mon) return { ...state, eventSeq: log.seq }
    const destroyedId = log.add({
      type: 'monitoringDestroyed',
      player: target.player,
      card: mon.id,
    })
    // The Monitoring goes to the discard, and the feed has to say so. It used
    // to be banked by a direct write, which left everything derived from the
    // feed a card behind the projection's discardCount — the board's heap had
    // a stand-in for exactly this. Parented to the destruction, the way
    // triggers.ts parents a destroyed release's spoils.
    log.add(
      { type: 'discarded', player: target.player, card: mon.id, reason: 'destroyed' },
      destroyedId,
    )
    const zone = { ...state.players[target.player].release }
    delete zone.monitoring
    return {
      ...discard(
        {
          ...state,
          players: {
            ...state.players,
            [target.player]: { ...state.players[target.player], release: zone },
          },
        },
        [mon],
      ),
      eventSeq: log.seq,
    }
  }

  if (target.kind !== 'release') return { ...state, eventSeq: log.seq }
  const released = state.players[target.player].release[target.slot]
  if (!released) return { ...state, eventSeq: log.seq }

  const returnedId = log.add({
    type: 'releaseReturned',
    player: target.player,
    slot: target.slot,
    card: released.card.id,
  })
  const zone = { ...state.players[target.player].release }
  delete zone[target.slot]
  const owner = state.players[target.player]
  const bounced: GameState = {
    ...state,
    players: {
      ...state.players,
      [target.player]: {
        ...owner,
        release: zone,
        hand: [...owner.hand, released.card],
        frozen: [...owner.frozen, released.card.uid],
      },
    },
  }
  // The release itself bounces to hand, but a Code Review under it does not
  // follow it there — it goes to the discard, and that was the second card
  // this function banked in silence.
  if (released.codeReview) {
    log.add(
      {
        type: 'discarded',
        player: target.player,
        card: released.codeReview.id,
        reason: 'destroyed',
      },
      returnedId,
    )
  }
  const cleaned = released.codeReview ? discard(bounced, [released.codeReview]) : bounced
  return { ...cleaned, eventSeq: log.seq }
}

export function onRequestCard(state: GameState, action: Action & { type: 'RESOLVE' }): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'requestCard') return reject(state, action, 'no request pending')
  if (pending.player !== action.player) return reject(state, action, 'not your decision')
  const choice = action.choice
  if (choice.kind !== 'requestCard') return reject(state, action, 'wrong choice for this decision')

  const log = createLog(state.eventSeq)
  const held = state.players[pending.target].hand.filter((c) => c.id === choice.card)

  if (held.length === 0) {
    // A miss is public: everyone learns the guess was wrong.
    log.add({
      type: 'requested',
      attacker: pending.player,
      target: pending.target,
      card: choice.card,
      hit: false,
    })
    return { state: { ...state, pending: null, eventSeq: log.seq }, events: log.events }
  }

  log.add({
    type: 'requested',
    attacker: pending.player,
    target: pending.target,
    card: choice.card,
    hit: true,
  })
  // The holder chooses which copy to surrender.
  return {
    state: {
      ...state,
      pending: {
        kind: 'giveCard',
        player: pending.target,
        requested: choice.card,
        attacker: pending.player,
      },
      eventSeq: log.seq,
    },
    events: log.events,
  }
}

export function onGiveCard(state: GameState, action: Action & { type: 'RESOLVE' }): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'giveCard') return reject(state, action, 'no handover pending')
  if (pending.player !== action.player) return reject(state, action, 'not your decision')
  const choice = action.choice
  if (choice.kind !== 'giveCard') return reject(state, action, 'wrong choice for this decision')

  const hand = state.players[action.player].hand
  const card = hand.find((c) => c.uid === choice.card)
  if (!card || card.id !== pending.requested) {
    return reject(state, action, 'that is not the requested card')
  }

  const log = createLog(state.eventSeq)
  log.add({
    type: 'handTransfer',
    from: action.player,
    to: pending.attacker,
    card: card.id,
    visibleTo: [action.player, pending.attacker],
  })
  const stripped = setHand(
    state,
    action.player,
    hand.filter((c) => c.uid !== choice.card),
  )
  const moved = setHand(stripped, pending.attacker, [
    ...stripped.players[pending.attacker].hand,
    card,
  ])
  return { state: { ...moved, pending: null, eventSeq: log.seq }, events: log.events }
}
