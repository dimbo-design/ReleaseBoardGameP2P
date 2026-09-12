import type { Action } from '../actions'
import { rulesFor } from '../cards'
import type { Reduction } from '../engine'
import type { CardInstance, GameState, PlayerId } from '../state'
import { bankToDiscard, createLog, type Log, reject } from './core'

// Cherry-pick offers the whole pile; Inside offers only Releases. Everything
// else about the two effects is identical, which is why they share a pending.
//
// A trigger is the one card the pile may hold that a hand may not: "обе карты
// нельзя держать в руке" (docs/rules/cards.md). Under sudo it stays on offer —
// the rules let a trigger be the card that goes onto the DECK — and
// onPickFromDiscard is what refuses it the hand slot. Without sudo there is no
// slot it could legally fill, so it is not offered at all.
export function discardOptions(
  state: GameState,
  releasesOnly: boolean,
  sudo = false,
): CardInstance[] {
  if (releasesOnly) return state.decks.discard.filter((c) => rulesFor(c.id)?.kind === 'release')
  if (sudo) return state.decks.discard
  return state.decks.discard.filter((c) => rulesFor(c.id)?.kind !== 'trigger')
}

const discard = (state: GameState, cards: CardInstance[]): GameState => bankToDiscard(state, cards)

// `card` and `combo` have already left the hand by the time this runs. The
// discard pile is read *before* either of them lands there, which is what
// stops Cherry-pick offering itself (or its Sudo) back as a pick — but both
// still join the discard unconditionally afterward. A card can never leave
// the game: an exhausted draw pile is refilled by shuffling the discard back
// in (rules answer 7), so a card that vanished here would permanently shrink
// the game's card pool.
export function openPickFromDiscard(
  state: GameState,
  log: Log,
  player: PlayerId,
  card: CardInstance,
  combo: CardInstance | undefined,
  releasesOnly: boolean,
): GameState {
  const options = discardOptions(state, releasesOnly, combo !== undefined)
  const spent = combo ? [card, combo] : [card]
  // Every other spend path logs a `discarded` event for the card it consumes
  // (release.ts's release-cost pay, reduce.ts's hand-limit discard,
  // triggers.ts's elimination spoils) — without this, the fizzle path (an
  // empty or ineligible discard) produced zero events at all: MoveHistory
  // showed nothing and eventSeq never advanced for a legal, consequential play.
  for (const c of spent) log.add({ type: 'discarded', player, card: c.id, reason: 'effect' })
  const spentState = discard(state, spent)
  // The hand slot is mandatory and a trigger may never fill it
  // (onPickFromDiscard). So the offer is measured by what could take THAT
  // slot, not by its raw length: a sudo pick over a discard of nothing but
  // triggers has no legal resolution at all, and opening a pending for it
  // would freeze the turn. Rules answer 11 makes it a wasteful play instead.
  const forHand = options.filter((c) => rulesFor(c.id)?.kind !== 'trigger')
  if (forHand.length === 0) return { ...spentState, eventSeq: log.seq }
  const picks = Math.min(combo ? 2 : 1, options.length) as 1 | 2
  return {
    ...spentState,
    pending: { kind: 'pickFromDiscard', player, options, picks, source: card.id },
    eventSeq: log.seq,
  }
}

export function onPickFromDiscard(
  state: GameState,
  action: Action & { type: 'RESOLVE' },
): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'pickFromDiscard') {
    return reject(state, action, 'no discard pick is pending')
  }
  if (pending.player !== action.player) return reject(state, action, 'not your decision')
  const choice = action.choice
  if (choice.kind !== 'pickFromDiscard') return reject(state, action, 'wrong choice for pending')

  const offered = (uid: string) => pending.options.find((c) => c.uid === uid)
  const toHand = offered(choice.card)
  // Membership in *this* pending's options, not merely "some card": a stale
  // selection the current pending never offered must not resolve.
  if (!toHand) return reject(state, action, 'that card is not on offer')

  // The offer may legitimately contain a trigger (a sudo pick can put one on
  // the deck), so the hand slot is guarded here rather than by withholding it.
  // A hostile or stale RESOLVE never passes through the board, which is why
  // this cannot live in the UI.
  if (rulesFor(toHand.id)?.kind === 'trigger') {
    return reject(state, action, 'that card cannot go to a hand')
  }

  const toDeck = pending.picks === 2 && choice.toDeck ? offered(choice.toDeck) : undefined
  if (pending.picks === 2 && choice.toDeck && !toDeck) {
    return reject(state, action, 'that card is not on offer')
  }
  if (toDeck && toDeck.uid === toHand.uid) {
    return reject(state, action, 'one card cannot go to both places')
  }

  // The pending's options are a snapshot taken when it opened; nothing today
  // changes the discard while a pending is set (every other action rejects
  // outright), but trusting the snapshot over live state would duplicate a
  // card instead of moving it the moment that stops being true — the mirror
  // image of the vanishing-card defect, and a one-line guard against it.
  const inLiveDiscard = (uid: string) => state.decks.discard.some((c) => c.uid === uid)
  if (!inLiveDiscard(toHand.uid)) return reject(state, action, 'that card left the discard')
  if (toDeck && !inLiveDiscard(toDeck.uid)) {
    return reject(state, action, 'that card left the discard')
  }

  const log = createLog(state.eventSeq)
  const taken = new Set([toHand.uid, ...(toDeck ? [toDeck.uid] : [])])
  const remaining = state.decks.discard.filter((c) => !taken.has(c.uid))
  const player = state.players[action.player]

  log.add({ type: 'takenFromDiscard', player: action.player, card: toHand.id, to: 'hand' })
  // The rules place this one unseen, so its identity is private to the placer —
  // the same treatment `drawn` gives a card whose face only the drawer saw.
  if (toDeck) {
    log.add({
      type: 'takenFromDiscard',
      player: action.player,
      card: toDeck.id,
      to: 'deck',
      visibleTo: [action.player],
    })
  }

  const main = toDeck
    ? state.decks.main.map((p, i) => (i === 0 ? [toDeck, ...p] : p))
    : state.decks.main

  return {
    state: {
      ...state,
      players: { ...state.players, [action.player]: { ...player, hand: [...player.hand, toHand] } },
      decks: { ...state.decks, discard: remaining, main },
      pending: null,
      eventSeq: log.seq,
    },
    events: log.events,
  }
}
