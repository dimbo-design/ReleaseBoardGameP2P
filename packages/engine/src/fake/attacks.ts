import type { Action, Choice } from '../actions'
import { RELEASE_ATTACKS, rulesFor } from '../cards'
import type { Reduction } from '../engine'
import type { CardInstance, CardUid, GameState, Pending, PlayerId, ReleaseSlot } from '../state'
import type { PendingView } from '../view'
import { bankToDiscard, createLog, DEFEND_MS, defencesFor, type Log, reject, setHand } from './core'
import { stealRandom } from './handAttacks'
import { canAttackWith, closeWindow, handOverWindow, openWindow, respondersFor } from './window'

const SLOTS: readonly ReleaseSlot[] = ['frontend', 'backend', 'database']

const discard = (state: GameState, cards: CardInstance[]): GameState => bankToDiscard(state, cards)

// Bank cards and say so — every spent card leaves a `discarded` the board can
// plan a movement from (the reasons existed unemitted; see the design doc).
function bankSpent(
  state: GameState,
  log: Log,
  player: PlayerId,
  cards: CardInstance[],
  reason: 'attackSpent' | 'defenceSpent',
  parent?: number,
): GameState {
  for (const c of cards) log.add({ type: 'discarded', player, card: c.id, reason }, parent)
  return { ...discard(state, cards), eventSeq: log.seq }
}

function clearSlot(state: GameState, player: PlayerId, slot: ReleaseSlot): GameState {
  const zone = { ...state.players[player].release }
  delete zone[slot]
  return {
    ...state,
    players: { ...state.players, [player]: { ...state.players[player], release: zone } },
  }
}

// Destroy a release, or hand it to `stealer` when the attack was a Security Bug.
// Rollback gives the attack card back, but not the right to use it again this
// exchange. Only when it actually returns to the attacker: with sudo the
// defender keeps it, and locking its new owner would invent a rule.
// Where a reflected attack may land. Code Review makes a release untouchable by
// bug/out-of-memory/legacy/security-bug "даже с sudo" (resolution.md §4), and a
// reflected attack is still that attack — so a protected release is no more
// reachable coming back than it was going out.
function reflectableSlots(state: GameState, owner: PlayerId): ReleaseSlot[] {
  return SLOTS.filter((slot) => {
    const held = state.players[owner].release[slot]
    return held !== undefined && held.codeReview === undefined
  })
}

function lockReplay(state: GameState, player: PlayerId, card: CardUid): GameState {
  const me = state.players[player]
  return {
    ...state,
    players: { ...state.players, [player]: { ...me, replayLocked: [...me.replayLocked, card] } },
  }
}

function takeRelease(
  state: GameState,
  log: Log,
  owner: PlayerId,
  slot: ReleaseSlot,
  stealer: PlayerId | null,
  parent?: number,
): GameState {
  const released = state.players[owner].release[slot]
  if (!released) return { ...state, eventSeq: log.seq }
  const spoils = [released.card, ...(released.codeReview ? [released.codeReview] : [])]
  const cleared = clearSlot(state, owner, slot)

  // Security Bug takes the release for itself — unless that slot is occupied, in
  // which case the stolen release is discarded instead.
  if (stealer && !cleared.players[stealer].release[slot]) {
    log.add(
      { type: 'releaseStolen', from: owner, to: stealer, slot, card: released.card.id },
      parent,
    )
    const withCodeReviewGone = released.codeReview
      ? discard(cleared, [released.codeReview])
      : cleared
    return {
      ...withCodeReviewGone,
      players: {
        ...withCodeReviewGone.players,
        [stealer]: {
          ...withCodeReviewGone.players[stealer],
          release: {
            ...withCodeReviewGone.players[stealer].release,
            [slot]: { card: released.card },
          },
        },
      },
      eventSeq: log.seq,
    }
  }

  log.add({ type: 'releaseDestroyed', player: owner, slot, card: released.card.id }, parent)
  return { ...discard(cleared, spoils), eventSeq: log.seq }
}

export function onAttack(state: GameState, action: Action & { type: 'ATTACK' }): Reduction {
  const w = state.window
  if (!w) return reject(state, action, 'no reaction window is open')
  if (state.pending) return reject(state, action, 'a decision is pending')
  if (!respondersFor(state, w.target.player).includes(action.player)) {
    return reject(state, action, 'you cannot respond to this window')
  }
  const hand = state.players[action.player].hand
  const card = hand.find((c) => c.uid === action.card)
  if (!card) return reject(state, action, 'you do not hold that card')
  if (!RELEASE_ATTACKS.has(card.id))
    return reject(state, action, 'that card cannot attack a release')
  // The two checks above give the precise reason; this one is the authority.
  // `canAttackWith` is what the table is offered, so anything it withholds —
  // a DDoS freeze, Rollback's replay lock — has to bounce here too, or the
  // rule holds for the offer and leaks through the action.
  if (!canAttackWith(state, action.player).includes(action.card)) {
    return reject(state, action, 'that card cannot be thrown into this window')
  }

  // A Sudo rides along as one action and must actually be held.
  let sudo = false
  if (action.combo !== undefined) {
    const partner = hand.find((c) => c.uid === action.combo)
    if (partner?.id !== 'support-sudo') {
      return reject(state, action, 'invalid sudo combo')
    }
    if (!rulesFor(card.id)?.sudo) return reject(state, action, 'that card has no sudo effect')
    sudo = true
  }

  const log = createLog(state.eventSeq)
  log.add({
    type: 'attacked',
    attacker: action.player,
    card: card.id,
    sudo,
    target: w.target.player,
  })

  // The attack leaves the hand now; where it ends up depends on the defence.
  const spent = setHand(
    state,
    action.player,
    hand.filter((c) => c.uid !== action.card && c.uid !== action.combo),
  )
  const sudoCard = action.combo ? hand.find((c) => c.uid === action.combo) : undefined

  return {
    state: {
      ...spent,
      pending: {
        kind: 'defend',
        player: w.target.player,
        attacker: action.player,
        attack: card.uid,
        attackId: card.id,
        sudo,
        ...(sudoCard ? { combo: sudoCard } : {}),
        canDefendWith: defencesFor(state, w.target.player, sudo),
        openedAt: action.at,
        deadline: action.at + DEFEND_MS,
        scope: 'release',
      },
      eventSeq: log.seq,
    },
    events: log.events,
  }
}

// A hand attack's defence: the attacker's own turn, no reaction window. A miss
// steals (or, for Security Bug, opens the request pending); a hit resolves
// per the defence's own effect — cancel, return, or reflect (see below) — and
// clears the pending either way, since there is no release to spare and thus
// no window to reopen.
function onHandDefend(
  state: GameState,
  pending: Extract<Pending, { kind: 'defend' }>,
  action: Action & { type: 'RESOLVE' },
): Reduction {
  const choice = action.choice as Extract<Choice, { kind: 'defend' }>
  const log = createLog(state.eventSeq)
  const attacker = pending.attacker
  const attackCard: CardInstance = { uid: pending.attack, id: pending.attackId }
  const combo = pending.combo ? [pending.combo] : []

  if (choice.card === null) {
    const hitId = log.add({ type: 'tookHit', player: action.player })
    const spent = bankSpent(
      { ...state, pending: null },
      log,
      attacker,
      [attackCard, ...combo],
      'attackSpent',
      hitId,
    )
    if (attackCard.id === 'attack-security-bug') {
      return {
        state: {
          ...spent,
          pending: { kind: 'requestCard', player: attacker, target: action.player },
          eventSeq: log.seq,
        },
        events: log.events,
      }
    }
    return { state: stealRandom(spent, log, action.player, attacker), events: log.events }
  }

  if (!pending.canDefendWith.includes(choice.card)) {
    return reject(state, action, 'that card cannot defend this attack')
  }
  const hand = state.players[action.player].hand
  const defence = hand.find((c) => c.uid === choice.card)
  if (!defence) return reject(state, action, 'you do not hold that card')

  // sudo Rollback: the defender keeps the attacking card instead of returning it.
  let sudoDefence = false
  if (choice.combo !== undefined) {
    const partner = hand.find((c) => c.uid === choice.combo)
    if (partner?.id !== 'support-sudo') return reject(state, action, 'invalid sudo combo')
    if (!rulesFor(defence.id)?.sudo) return reject(state, action, 'that defence has no sudo effect')
    sudoDefence = true
  }

  const effect =
    defence.id === 'defense-rollback'
      ? 'return'
      : defence.id === 'defense-works-on-my-machine'
        ? 'reflect'
        : 'cancel'
  const defendedId = log.add({ type: 'defended', player: action.player, card: defence.id, effect })

  const spentHand = setHand(
    state,
    action.player,
    hand.filter((c) => c.uid !== choice.card && c.uid !== choice.combo),
  )
  const sudoCard = choice.combo ? hand.find((c) => c.uid === choice.combo) : undefined
  const spentDefence = [defence, ...(sudoCard ? [sudoCard] : [])]
  let next: GameState = { ...spentHand, pending: null, eventSeq: log.seq }

  if (effect === 'return') {
    // Rollback hands the attack back; sudo Rollback keeps it for the defender.
    const recipient = sudoDefence ? action.player : attacker
    const returned = setHand(next, recipient, [...next.players[recipient].hand, attackCard])
    const locked = sudoDefence ? returned : lockReplay(returned, attacker, attackCard.uid)
    next = bankSpent(locked, log, action.player, spentDefence, 'defenceSpent', defendedId)
    next = bankSpent(next, log, attacker, combo, 'attackSpent', defendedId)
    return { state: next, events: log.events }
  }

  if (effect === 'reflect') {
    // Works on my Machine turns the attack back on its author: the roles swap,
    // so the original target becomes the taker and the attacker the victim.
    let swapped = bankSpent(next, log, attacker, [attackCard, ...combo], 'attackSpent', defendedId)
    swapped = bankSpent(swapped, log, action.player, spentDefence, 'defenceSpent', defendedId)
    if (attackCard.id === 'attack-security-bug') {
      return {
        state: {
          ...swapped,
          pending: { kind: 'requestCard', player: action.player, target: attacker },
        },
        events: log.events,
      }
    }
    return { state: stealRandom(swapped, log, attacker, action.player), events: log.events }
  }

  next = bankSpent(next, log, attacker, [attackCard, ...combo], 'attackSpent', defendedId)
  next = bankSpent(next, log, action.player, spentDefence, 'defenceSpent', defendedId)
  return { state: next, events: log.events }
}

export function onDefend(state: GameState, action: Action & { type: 'RESOLVE' }): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'defend') return reject(state, action, 'no defence pending')
  if (pending.player !== action.player) return reject(state, action, 'not your decision')
  const choice = action.choice
  if (choice.kind !== 'defend') return reject(state, action, 'wrong choice for this decision')

  if (pending.scope === 'hand') return onHandDefend(state, pending, action)

  const w = state.window
  if (!w) return reject(state, action, 'no defence pending')

  const log = createLog(state.eventSeq)
  const attacker = pending.attacker
  const { slot } = w.target
  // The attack card was removed from the attacker's hand when it was thrown.
  const attackCard: CardInstance = { uid: pending.attack, id: pending.attackId }
  const stealer = attackCard.id === 'attack-security-bug' ? attacker : null
  const combo = pending.combo ? [pending.combo] : []

  // Take the hit.
  if (choice.card === null) {
    const hitId = log.add({ type: 'tookHit', player: action.player })
    const spent = bankSpent(
      { ...state, pending: null },
      log,
      attacker,
      [attackCard, ...combo],
      'attackSpent',
      hitId,
    )
    const hit = takeRelease(spent, log, action.player, slot, stealer)
    // A steal puts a FRESH release in the thief's zone, and by the rules every
    // fresh release gets its own attack time however it got there
    // (`resolution.md` §1) — so the window is handed over rather than closed on
    // a win. `takeRelease` reports nothing, and it does not always steal: an
    // occupied slot in the thief's zone sends the release to the discard
    // instead, leaving whatever the thief already held there untouched — so
    // this checks that the card now in the thief's slot IS the one just
    // attacked, rather than trusting `stealer` to mean a steal happened or the
    // slot's mere occupancy (which a pre-existing release also satisfies) to
    // mean this release just arrived.
    const thief = stealer
    const taken = thief ? hit.players[thief].release[slot] : undefined
    if (thief && taken && taken.card.uid === w.target.card) {
      return {
        state: handOverWindow(hit, log, { player: thief, slot, card: taken.card.uid }, action.at),
        events: log.events,
      }
    }
    return { state: closeWindow(hit, log), events: log.events }
  }

  if (!pending.canDefendWith.includes(choice.card)) {
    return reject(state, action, 'that card cannot defend this attack')
  }
  const hand = state.players[action.player].hand
  const defence = hand.find((c) => c.uid === choice.card)
  if (!defence) return reject(state, action, 'you do not hold that card')

  // sudo Rollback: the defender keeps the attacking card instead of returning it.
  let sudoDefence = false
  if (choice.combo !== undefined) {
    const partner = hand.find((c) => c.uid === choice.combo)
    if (partner?.id !== 'support-sudo') return reject(state, action, 'invalid sudo combo')
    if (!rulesFor(defence.id)?.sudo) return reject(state, action, 'that defence has no sudo effect')
    sudoDefence = true
  }

  const effect =
    defence.id === 'defense-rollback'
      ? 'return'
      : defence.id === 'defense-works-on-my-machine'
        ? 'reflect'
        : 'cancel'
  const defendedId = log.add({ type: 'defended', player: action.player, card: defence.id, effect })

  const spentHand = setHand(
    state,
    action.player,
    hand.filter((c) => c.uid !== choice.card && c.uid !== choice.combo),
  )
  const sudoCard = choice.combo ? hand.find((c) => c.uid === choice.combo) : undefined
  const spentDefence = [defence, ...(sudoCard ? [sudoCard] : [])]
  let next: GameState = { ...spentHand, pending: null }

  if (effect === 'return') {
    // Rollback hands the attack back; sudo Rollback keeps it for the defender.
    const recipient = sudoDefence ? action.player : attacker
    next = setHand(next, recipient, [...next.players[recipient].hand, attackCard])
    if (!sudoDefence) next = lockReplay(next, attacker, attackCard.uid)
    next = bankSpent(next, log, action.player, spentDefence, 'defenceSpent', defendedId)
    next = bankSpent(next, log, attacker, combo, 'attackSpent', defendedId)
  } else if (effect === 'reflect') {
    // Works on my Machine turns the attack on its author — the same effect they
    // were about to apply, not a generic destruction.
    next = bankSpent(next, log, attacker, [attackCard, ...combo], 'attackSpent', defendedId)
    next = bankSpent(next, log, action.player, spentDefence, 'defenceSpent', defendedId)
    // The effect returns as it was AIMED: the attacker's release of exactly the
    // type that was attacked. Not the defender's choice, not any other slot —
    // the mirror reading, which the card supports without an added rule (rules
    // owner, #92). It lands only where the attacker holds that type and it is
    // not under Code Review; otherwise the attack is still cancelled and this
    // second effect simply finds nothing, which is not the same as not firing.
    const victimSlot = reflectableSlots(next, attacker).includes(slot) ? slot : undefined
    if (victimSlot) {
      // Security Bug's own effect is to take, so the reflection takes — and for
      // a reflected one that always ends in the discard rather than a steal:
      // it aims at the defender's slot of the attacked type, and that slot is
      // occupied by the very release being defended, which never left because
      // the attack was cancelled. `takeRelease` discards on an occupied slot.
      const thief = attackCard.id === 'attack-security-bug' ? action.player : null
      next = takeRelease(next, log, attacker, victimSlot, thief)
    }
  } else {
    next = bankSpent(next, log, attacker, [attackCard, ...combo], 'attackSpent', defendedId)
    next = bankSpent(next, log, action.player, spentDefence, 'defenceSpent', defendedId)
  }

  // The release survived, so the exchange continues in a fresh, shorter window.
  const reopened = openWindow({ ...next, window: null }, log, w.target, w.round + 1, action.at)
  return { state: { ...reopened, eventSeq: log.seq }, events: log.events }
}

// A pending decision is projected to its owner in full; everyone else learns only
// that the table is waiting on someone.
export function pendingView(state: GameState, viewerId: PlayerId): PendingView | null {
  const p = state.pending
  if (!p) return null
  const mine = p.player === viewerId
  switch (p.kind) {
    case 'defend':
      return {
        kind: 'defend',
        player: p.player,
        attacker: p.attacker,
        attackCard: p.attackId,
        sudo: p.sudo,
        options: mine ? [...p.canDefendWith] : [],
        openedAt: p.openedAt,
        deadline: p.deadline,
        scope: p.scope,
      }
    case 'discardForRelease':
      return {
        kind: 'discardForRelease',
        player: p.player,
        // the owner's own staged card: they need to know which of their cards
        // is standing at the centre. Redacted for everyone else, exactly as
        // `options` is — see the open rules question this leaves in
        // docs/rules/backlog.md.
        ...(mine ? { release: p.release } : {}),
        options: mine
          ? state.players[p.player].hand
              .filter((c) => c.uid !== p.release && c.uid !== p.codeReview)
              .map((c) => c.uid)
          : [],
      }
    case 'handLimit':
      return {
        kind: 'handLimit',
        player: p.player,
        excess: p.excess,
        options: mine ? state.players[p.player].hand.map((c) => c.uid) : [],
        ...(p.source ? { source: p.source } : {}),
      }
    case 'requestCard':
      return { kind: 'requestCard', player: p.player, target: p.target }
    case 'giveCard':
      return { kind: 'giveCard', player: p.player, requested: p.requested }
    case 'neutralize503':
      return {
        kind: 'neutralize503',
        player: p.player,
        // public: the rules oblige the drawer to show it to everyone. null for
        // the ai-error-503 mimic, which has no card standing anywhere.
        card: p.card ? p.card.id : null,
        methods: [...p.methods],
        ...(p.source ? { source: p.source } : {}),
      }
    case 'crush':
      return {
        kind: 'crush',
        player: p.player,
        slot: p.slot,
        methods: [...p.methods],
        ...(p.source ? { source: p.source } : {}),
      }
    case 'pickFromDiscard':
      // Only discardTop/discardCount are ever projected of the discard pile
      // (project.ts) — its full contents are not public. Gated behind `mine`
      // like every other variant here: an effect brings its own viewing
      // surface for the player using it, not a reveal to the table.
      return {
        kind: 'pickFromDiscard',
        player: p.player,
        options: mine ? [...p.options] : [],
        picks: p.picks,
        source: p.source,
      }
    default:
      return null
  }
}
