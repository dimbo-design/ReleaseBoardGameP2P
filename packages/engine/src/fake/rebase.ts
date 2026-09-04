import type { Action } from '../actions'
import type { Reduction } from '../engine'
import type { CardInstance, CardUid, GameState, PlayerId } from '../state'
import { bankToDiscard, type Log, reject } from './core'

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

export function onReorderTop(state: GameState, action: Action & { type: 'RESOLVE' }): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'reorderTop') return reject(state, action, 'no reorder is pending')
  if (pending.player !== action.player) return reject(state, action, 'not your decision')
  const choice = action.choice
  if (choice.kind !== 'reorderTop') return reject(state, action, 'wrong choice for pending')

  // Every offered pile must be answered, exactly once each.
  if (choice.order.length !== pending.piles.length) {
    return reject(state, action, 'that is not the offer')
  }

  const main = [...state.decks.main]
  for (const entry of pending.piles) {
    const answer = choice.order.find((o) => o.pile === entry.pile)
    if (!answer) return reject(state, action, 'that is not the offer')
    const offered = entry.cards.map((c) => c.uid)
    // A permutation, not merely a subset: same length, same members, no repeats.
    if (answer.cards.length !== offered.length)
      return reject(state, action, 'that is not the offer')
    const seen = new Set<CardUid>()
    for (const uid of answer.cards) {
      if (!offered.includes(uid) || seen.has(uid)) {
        return reject(state, action, 'that card was not on offer')
      }
      seen.add(uid)
    }
    // The pending's cards are a snapshot; nothing changes a pile while a
    // pending stands, but trusting the snapshot over live state would
    // duplicate a card the moment that stops being true —
    // `onPickFromDiscard`'s own guard, and for the same reason.
    const live = main[entry.pile] ?? []
    if (offered.some((uid, i) => live[i]?.uid !== uid)) {
      return reject(state, action, 'that pile has moved')
    }
    const byUid = new Map(entry.cards.map((c) => [c.uid, c]))
    main[entry.pile] = [
      ...answer.cards.map((uid) => byUid.get(uid) as CardInstance),
      ...live.slice(offered.length),
    ]
  }

  // No event: the order is exactly what the rules say nobody else sees, and the
  // card's own `discarded` (openReorderTop) is the whole public story.
  return {
    state: { ...state, decks: { ...state.decks, main }, pending: null },
    events: [],
  }
}
