import type { CardInstance, GameState, PlayerId } from '../state'
import { bankToDiscard, type Log } from './core'

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
