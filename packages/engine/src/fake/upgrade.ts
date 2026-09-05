import type { Action } from '../actions'
import type { Reduction } from '../engine'
import type { CardInstance, GameState, PlayerId } from '../state'
import { bankToDiscard, createLog, type Log, reject, setHand } from './core'

// System Upgrade — "все остальные игроки сбрасывают по одной карте", each for
// themselves and simultaneously, so the pending owes a roster rather than a
// seat. Who is on it is computed here and never assumed later: everyone but
// the actor, minus the eliminated, minus the empty-handed (rules decisions
// 2026-09-04 answer 3). An empty roster is an ordinary outcome — the card is
// played and nothing happens — not an error.
export function openSystemUpgrade(
  state: GameState,
  log: Log,
  player: PlayerId,
  card: CardInstance,
  combo: CardInstance | undefined,
): GameState {
  const spent = combo ? [card, combo] : [card]
  for (const c of spent) log.add({ type: 'discarded', player, card: c.id, reason: 'effect' })
  const spentState = bankToDiscard(state, spent)

  const owed = state.seating.filter(
    (id) => id !== player && !state.eliminated.includes(id) && state.players[id].hand.length > 0,
  )
  if (owed.length === 0) return { ...spentState, eventSeq: log.seq }

  return {
    ...spentState,
    pending: {
      kind: 'systemUpgrade',
      actor: player,
      owed,
      thrown: [],
      sudo: combo !== undefined,
      phase: 'discarding',
      source: card.id,
    },
    eventSeq: log.seq,
  }
}

// A seat on the roster answers. The card leaves that hand and joins `thrown`
// on the pending — not banked yet: the rules put the thrown cards face up at
// the centre until every seat has answered. The roster drains one seat per
// call; the last answer either opens the sudo pick or banks everything at
// once, so no future path can bank a card twice or leave one unbanked.
export function onUpgradeDiscard(
  state: GameState,
  action: Action & { type: 'RESOLVE' },
): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'systemUpgrade') return reject(state, action, 'no upgrade is pending')
  if (pending.phase !== 'discarding') return reject(state, action, 'that phase is over')
  if (!pending.owed.includes(action.player)) return reject(state, action, 'not your decision')
  const choice = action.choice
  if (choice.kind !== 'upgradeDiscard') return reject(state, action, 'wrong choice for pending')

  const hand = state.players[action.player].hand
  const given = hand.find((c) => c.uid === choice.card)
  if (!given) return reject(state, action, 'you do not hold that card')

  const log = createLog(state.eventSeq)
  log.add({ type: 'upgradeThrown', player: action.player, card: given.id })

  const owed = pending.owed.filter((id) => id !== action.player)
  const thrown = [...pending.thrown, { player: action.player, card: given }]
  const withHand = setHand(
    state,
    action.player,
    hand.filter((c) => c.uid !== choice.card),
  )

  // Still owed by somebody: hold everything at the centre and wait.
  if (owed.length > 0) {
    return {
      state: { ...withHand, pending: { ...pending, owed, thrown }, eventSeq: log.seq },
      events: log.events,
    }
  }
  // The last answer. Sudo hands the actor a pick; otherwise it all goes now.
  if (pending.sudo) {
    return {
      state: {
        ...withHand,
        pending: { ...pending, owed: [], thrown, phase: 'picking' },
        eventSeq: log.seq,
      },
      events: log.events,
    }
  }
  for (const t of thrown) {
    log.add({ type: 'discarded', player: t.player, card: t.card.id, reason: 'effect' })
  }
  const banked = bankToDiscard(
    withHand,
    thrown.map((t) => t.card),
  )
  return { state: { ...banked, pending: null, eventSeq: log.seq }, events: log.events }
}

// Sudo's pick, once every seat has answered. The offer is `thrown`, never the
// discard pile it is about to join — "выбор из того, что сброшено в этот раз,
// а не из всего сброса". The rest of `thrown` banks to the discard in the same
// reduction: a pending's thrown cards are touched nowhere else while it is
// open, so this is the one and only place any of them can leave it — the pick
// to a hand, the remainder to the discard, and nothing left behind.
export function onUpgradeTake(state: GameState, action: Action & { type: 'RESOLVE' }): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'systemUpgrade') return reject(state, action, 'no upgrade is pending')
  if (pending.phase !== 'picking') return reject(state, action, 'nothing to pick yet')
  if (pending.actor !== action.player) return reject(state, action, 'not your decision')
  const choice = action.choice
  if (choice.kind !== 'upgradeTake') return reject(state, action, 'wrong choice for pending')

  const taken = pending.thrown.find((t) => t.card.uid === choice.card)
  if (!taken) return reject(state, action, 'that card is not on offer')

  const log = createLog(state.eventSeq)
  log.add({ type: 'upgradeTaken', player: action.player, card: taken.card.id })
  const rest = pending.thrown.filter((t) => t.card.uid !== choice.card)
  for (const t of rest) {
    log.add({ type: 'discarded', player: t.player, card: t.card.id, reason: 'effect' })
  }
  const banked = bankToDiscard(
    state,
    rest.map((t) => t.card),
  )
  const actor = banked.players[action.player]
  return {
    state: {
      ...banked,
      players: {
        ...banked.players,
        [action.player]: { ...actor, hand: [...actor.hand, taken.card] },
      },
      pending: null,
      eventSeq: log.seq,
    },
    events: log.events,
  }
}
