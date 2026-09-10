import type { Action, Target } from '../actions'
import { rulesFor } from '../cards'
import type { Reduction } from '../engine'
import type { CardInstance, CardUid, GameState, PlayerId, ReleaseSlot } from '../state'
import {
  attackTargets,
  bankToDiscard,
  checkWin,
  createLog,
  type Log,
  reject,
  setHand,
} from './core'
import { openPickFromDiscard } from './discard'
import { openHandAttack, resolveDdos } from './handAttacks'
import { mergePiles, splitPile } from './piles'
import { playableFor } from './project'
import { openWindow } from './window'

// Structural target equality — targets are small value objects, so a field-wise
// comparison is cheaper and clearer than serializing.
const sameTarget = (a: Target, b: Target): boolean =>
  a.kind === b.kind &&
  ('player' in a ? a.player === (b as { player: string }).player : true) &&
  ('slot' in a ? a.slot === (b as { slot: string }).slot : true) &&
  ('card' in a ? a.card === (b as { card: string }).card : true)

// The operation itself is spent whatever it did — including Git Branch against
// a pile it could not split, which answer 4 makes a legal play with no effect.
function discard(state: GameState, log: Log, player: PlayerId, cards: CardInstance[]): GameState {
  for (const c of cards) {
    log.add({ type: 'discarded', player, card: c.id, reason: 'effect' })
  }
  return { ...bankToDiscard(state, cards), eventSeq: log.seq }
}

export function placeRelease(
  state: GameState,
  log: Log,
  at: number,
  player: PlayerId,
  release: CardUid,
  codeReview?: CardUid,
): GameState {
  const hand = state.players[player].hand
  const card = hand.find((c) => c.uid === release)
  if (!card) return { ...state, eventSeq: log.seq }
  const slot = rulesFor(card.id)?.slot as ReleaseSlot
  const cr = codeReview ? hand.find((c) => c.uid === codeReview) : undefined

  log.add({ type: 'released', player, slot, card: card.id, ...(cr ? { codeReview: cr.id } : {}) })

  const withHand = setHand(
    state,
    player,
    hand.filter((c) => c.uid !== release && c.uid !== codeReview),
  )
  const placed: GameState = {
    ...withHand,
    players: {
      ...withHand.players,
      [player]: {
        ...withHand.players[player],
        release: {
          ...withHand.players[player].release,
          [slot]: { card, ...(cr ? { codeReview: cr } : {}) },
        },
      },
    },
    turn: { ...state.turn, releasesPlayed: state.turn.releasesPlayed + 1 },
    pending: null,
  }
  // The win is deliberately not decided here. Three releases win only after the
  // attacks are repelled, and the rules grant an instant-attack right on every
  // fresh release with no exception for the third — so a release that faces a
  // window is settled when that window closes, in `closeWindow`. Winning on
  // placement deleted the one moment the win condition is about.
  //
  // A Code Review-protected release cannot be attacked at all, so no window
  // opens (understanding.md §8) and there is nothing to wait for.
  if (cr) return checkWin(placed, log)

  const opened = openWindow(placed, log, { player, slot, card: card.uid }, 1, at)
  if (!opened.window) return checkWin(opened, log)
  // `openWindow` declines when nobody is left alive to respond. Nothing will
  // ever close a window that never opened, so the win is settled now rather
  // than leaving the game hanging one release short of its end.
  return opened
}

export function onPlay(state: GameState, action: Action & { type: 'PLAY' }): Reduction {
  // playableFor already covers game-over, a pending decision, an open window, turn
  // ownership, freezing, the release cap and the occupied-slot rule — one
  // membership check instead of a stack of duplicated guards that could disagree.
  if (!playableFor(state, action.player).includes(action.card)) {
    return reject(state, action, 'that card is not playable right now')
  }

  const hand = state.players[action.player].hand
  const card = hand.find((c) => c.uid === action.card)
  if (!card) return reject(state, action, 'you do not hold that card')
  const rules = rulesFor(card.id)
  if (!rules) return reject(state, action, 'unknown card')

  // Code Review is a release-only combo; Sudo rides along with any card whose
  // rules mark it sudo-capable (currently the attacks and Git Cherry-pick).
  let codeReview: CardUid | undefined
  let sudoCombo: CardInstance | undefined
  if (action.combo !== undefined) {
    const partner = hand.find((c) => c.uid === action.combo)
    if (!partner) return reject(state, action, 'you do not hold the combo card')
    if (partner.id === 'support-sudo') {
      if (rules.sudo !== true) return reject(state, action, 'that card has no sudo variant')
      sudoCombo = partner
    } else if (partner.id !== 'support-code-review') {
      return reject(state, action, 'that card cannot be comboed here')
    } else if (rules.kind === 'release') {
      codeReview = partner.uid
    } else {
      return reject(state, action, 'Code Review only pairs with a release')
    }
  }

  const log = createLog(state.eventSeq)

  if (rules.kind === 'operation') {
    const spentCards = [card, ...(sudoCombo ? [sudoCombo] : [])]
    const withoutCards = setHand(
      state,
      action.player,
      hand.filter((c) => c.uid !== action.card && c.uid !== sudoCombo?.uid),
    )

    // Cherry-pick asks a question; the pile operations just act. Dispatching on
    // the id rather than on the kind, because `operation` is now three cards
    // that share only where they are played from.
    if (card.id === 'operation-git-branch') {
      // With one pile there is nothing to choose, so an absent target means it.
      const chosen = action.target?.kind === 'pile' ? action.target.pile : 0
      const split = splitPile(withoutCards, log, chosen, sudoCombo !== undefined)
      return { state: discard(split, log, action.player, spentCards), events: log.events }
    }

    if (card.id === 'operation-git-merge') {
      const merged = mergePiles(withoutCards, log, sudoCombo !== undefined)
      return { state: discard(merged, log, action.player, spentCards), events: log.events }
    }

    return {
      state: openPickFromDiscard(withoutCards, log, action.player, card, sudoCombo, false),
      events: log.events,
    }
  }

  if (rules.kind === 'release') {
    if (state.setup.releaseCond === 'easy') {
      const next = placeRelease(state, log, action.at, action.player, action.card, codeReview)
      return { state: next, events: log.events }
    }
    // The cost is a second card, so a lone release is unplayable.
    const spare = hand.filter((c) => c.uid !== action.card && c.uid !== codeReview)
    if (spare.length === 0) return reject(state, action, 'no card left to pay the release cost')
    return {
      state: {
        ...state,
        pending: {
          kind: 'discardForRelease',
          player: action.player,
          release: action.card,
          ...(codeReview ? { codeReview } : {}),
        },
      },
      events: [],
    }
  }

  if (card.id === 'protection-monitoring') {
    log.add({ type: 'placed', player: action.player, card: card.id })
    const withHand = setHand(
      state,
      action.player,
      hand.filter((c) => c.uid !== action.card),
    )
    return {
      state: {
        ...withHand,
        players: {
          ...withHand.players,
          [action.player]: {
            ...withHand.players[action.player],
            release: { ...withHand.players[action.player].release, monitoring: card },
          },
        },
        eventSeq: log.seq,
      },
      events: log.events,
    }
  }

  if (rules.kind === 'attack') {
    if (!action.target) return reject(state, action, 'that card needs a target')
    if (
      !attackTargets(state, action.player, card.id).some((t) =>
        sameTarget(t, action.target as Target),
      )
    ) {
      return reject(state, action, 'illegal target')
    }
    let sudo = false
    if (action.combo !== undefined) {
      const partner = hand.find((c) => c.uid === action.combo)
      if (partner?.id !== 'support-sudo') return reject(state, action, 'invalid sudo combo')
      if (!rules.sudo) return reject(state, action, 'that card has no sudo effect')
      sudo = true
    }
    const spentCards = hand.filter((c) => c.uid === action.card || c.uid === action.combo)
    const spent = setHand(
      state,
      action.player,
      hand.filter((c) => !spentCards.includes(c)),
    )

    // DDoS resolves immediately: it is not answerable by a defence card, so
    // banking it happens right here rather than at a later resolution — it
    // was always the right moment, it just used to do it silently.
    if (card.id === 'attack-ddos') {
      // `attackTargets` only ever offers a DDoS a release or a Monitoring, both
      // of which name their owner; the guard is what tells the compiler that,
      // and it rejects a malformed target rather than logging an attack on
      // nobody.
      if (action.target.kind !== 'release' && action.target.kind !== 'monitoring') {
        return reject(state, action, 'illegal target')
      }
      // A DDoS is an attack, and the log has to say so. It used to say only
      // what the attack DID (a Monitoring destroyed, a release returned), which
      // left the move history without the throw and the results screen without
      // the attack: the one card the "King of DDoS" plate is about was the one
      // attack nothing counted.
      log.add({
        type: 'attacked',
        attacker: action.player,
        card: card.id,
        sudo,
        target: action.target.player,
      })
      for (const c of spentCards) {
        log.add({ type: 'discarded', player: action.player, card: c.id, reason: 'attackSpent' })
      }
      const banked = {
        ...spent,
        decks: { ...spent.decks, discard: [...spent.decks.discard, ...spentCards] },
        eventSeq: log.seq,
      }
      return { state: resolveDdos(banked, log, action.player, action.target), events: log.events }
    }

    if (action.target.kind !== 'player') return reject(state, action, 'illegal target')

    // The sudo half rides on the pending like the attack card itself, and is
    // banked at resolution alongside it — not spent silently here.
    return {
      state: openHandAttack(
        spent,
        log,
        action.player,
        card,
        action.target.player,
        sudo,
        sudoCombo,
        action.at,
      ),
      events: log.events,
    }
  }

  // Nothing else is a standalone play.
  return reject(state, action, `cannot play ${card.id} this way`)
}

export function onDiscardForRelease(
  state: GameState,
  action: Action & { type: 'RESOLVE' },
): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'discardForRelease') return reject(state, action, 'no release cost pending')
  if (pending.player !== action.player) return reject(state, action, 'not your decision')
  const choice = action.choice
  if (choice.kind !== 'discardForRelease') {
    return reject(state, action, 'wrong choice for this decision')
  }
  // Neither the release nor a comboed Code Review can pay for the release.
  if (choice.card === pending.release || choice.card === pending.codeReview) {
    return reject(state, action, 'that card is part of the release')
  }
  const hand = state.players[action.player].hand
  const paid = hand.find((c) => c.uid === choice.card)
  if (!paid) return reject(state, action, 'you do not hold that card')

  const log = createLog(state.eventSeq)
  log.add({ type: 'discarded', player: action.player, card: paid.id, reason: 'releaseCost' })

  const withoutPaid = setHand(
    state,
    action.player,
    hand.filter((c) => c.uid !== choice.card),
  )
  const banked: GameState = {
    ...withoutPaid,
    decks: { ...withoutPaid.decks, discard: [...withoutPaid.decks.discard, paid] },
  }
  return {
    state: placeRelease(banked, log, action.at, action.player, pending.release, pending.codeReview),
    events: log.events,
  }
}

export function onCancelRelease(state: GameState, action: Action & { type: 'RESOLVE' }): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'discardForRelease') return reject(state, action, 'no release staged')
  if (pending.player !== action.player) return reject(state, action, 'not your decision')
  // Nothing moved when the release was staged — the card never left the hand
  // (`onPlay` only sets the pending), so there is nothing to put back and
  // nothing to announce. Clearing the pending IS the whole undo.
  return { state: { ...state, pending: null }, events: [] }
}
