import type { CardInstance, GameState, PlayerId } from '../state'
import { bankToDiscard, type Log } from './core'

// Git Rebase — look at the top three of a draw pile and reorder them, showing
// nobody. The privacy is the pendingView gate (attacks.ts), not anything here:
// this file only decides WHICH cards are offered.
const TOP = 3

// Base names one pile (rules decisions 2026-09-04 answer 1); sudo reaches every
// pile and names none. A pile shorter than three offers what it has, and no
// pile at all offers nothing — both legal plays that spend the card
// (answer 2), which is why this returns a state with no pending rather than a
// rejection.
export function openReorderTop(
  state: GameState,
  log: Log,
  player: PlayerId,
  card: CardInstance,
  combo: CardInstance | undefined,
  pile: number,
): GameState {
  const spent = combo ? [card, combo] : [card]
  for (const c of spent) log.add({ type: 'discarded', player, card: c.id, reason: 'effect' })
  const spentState = bankToDiscard(state, spent)

  const indices = combo ? state.decks.main.map((_, i) => i) : [pile]
  const piles = indices
    .filter((i) => (state.decks.main[i]?.length ?? 0) > 0)
    .map((i) => ({ pile: i, cards: state.decks.main[i].slice(0, TOP) }))

  if (piles.length === 0) return { ...spentState, eventSeq: log.seq }
  return {
    ...spentState,
    pending: { kind: 'reorderTop', player, piles, source: card.id },
    eventSeq: log.seq,
  }
}
