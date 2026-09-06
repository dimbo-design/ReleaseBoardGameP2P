import type { Action, Choice } from '../actions'
import type { Reduction } from '../engine'
import type { DiscardReason } from '../events'
import { randomAt } from '../rng'
import type { CardInstance, GameState, NeutralizeMethod, PlayerId, ReleaseSlot } from '../state'
import { bankToDiscard, checkWin, createLog, endTurn, type Log, reject, setHand } from './core'
import { discardOptions } from './discard'
import { openWindow } from './window'

const SLOTS: readonly ReleaseSlot[] = ['frontend', 'backend', 'database']

const discard = (state: GameState, cards: CardInstance[]): GameState => bankToDiscard(state, cards)

// The order the rules give: Debugger first, Monitoring second, sacrificing a
// release last — a player answers with the cheapest option they hold.
export function neutralizeOptions(state: GameState, player: PlayerId): NeutralizeMethod[] {
  const methods: NeutralizeMethod[] = []
  const me = state.players[player]
  if (me.hand.some((c) => c.id === 'protection-debugger')) methods.push('debugger')
  if (me.release.monitoring) methods.push('monitoring')
  if (SLOTS.some((slot) => me.release[slot])) methods.push('sacrifice')
  return methods
}

// Appends to `eliminated`, discards the hand and zone, and ends the game once
// only one living player remains. Every card that leaves the board gets its
// own public `discarded` event — a hand card as a side effect of the trigger
// ('effect'), a release (and its Code Review) or a Monitoring as destroyed
// alongside their owner ('destroyed') — so the causal trail survives an
// elimination the same way it survives a hand-limit or release-cost discard.
export function eliminate(state: GameState, log: Log, player: PlayerId): GameState {
  const me = state.players[player]
  const zoneCards = SLOTS.flatMap((slot) => {
    const r = me.release[slot]
    return r ? [r.card, ...(r.codeReview ? [r.codeReview] : [])] : []
  })
  const monitoringCards = me.release.monitoring ? [me.release.monitoring] : []
  const spoils = [...me.hand, ...zoneCards, ...monitoringCards]

  // `eliminated` is the cause, so it is logged first and its id captured as
  // `parent` for every card discard that follows — those discards could not
  // otherwise point at an event id that does not exist yet.
  const eliminatedId = log.add({ type: 'eliminated', player })
  for (const c of me.hand) {
    log.add({ type: 'discarded', player, card: c.id, reason: 'effect' }, eliminatedId)
  }
  for (const c of [...zoneCards, ...monitoringCards]) {
    log.add({ type: 'discarded', player, card: c.id, reason: 'destroyed' }, eliminatedId)
  }

  const cleared: GameState = {
    ...discard(state, spoils),
    players: {
      ...state.players,
      [player]: { ...me, hand: [], release: {} },
    },
    eliminated: [...state.eliminated, player],
    pending: null,
    eventSeq: log.seq,
  }

  const living = cleared.seating.filter((id) => !cleared.eliminated.includes(id))
  if (living.length === 1) {
    log.add({ type: 'gameOver', winner: living[0], condition: 'lastStanding' })
    return { ...cleared, over: { winner: living[0], condition: 'lastStanding' }, eventSeq: log.seq }
  }
  return cleared
}

// `reason` is only supplied when the destruction is a chosen answer (the
// sacrifice neutralize method) rather than an automatic one (an unanswered
// crush): a chosen sacrifice gets its own `discarded` event per card on top of
// `releaseDestroyed`, matching the pattern the debugger/monitoring methods
// use; an automatic destruction stays exactly as `takeRelease` in release.ts
// already treats attack-caused destruction — `releaseDestroyed` alone.
function destroySlot(
  state: GameState,
  log: Log,
  player: PlayerId,
  slot: ReleaseSlot,
  reason?: DiscardReason,
  parent?: number,
): GameState {
  const me = state.players[player]
  const released = me.release[slot]
  if (!released) return { ...state, eventSeq: log.seq }
  const spoils = [released.card, ...(released.codeReview ? [released.codeReview] : [])]
  log.add({ type: 'releaseDestroyed', player, slot, card: released.card.id })
  if (reason) {
    for (const c of spoils) log.add({ type: 'discarded', player, card: c.id, reason }, parent)
  }
  const zone = { ...me.release }
  delete zone[slot]
  return {
    ...discard(
      { ...state, players: { ...state.players, [player]: { ...me, release: zone } } },
      spoils,
    ),
    eventSeq: log.seq,
  }
}

// Whether an instance is standing in someone's zone right now — the test for
// "did this event's effect keep the card on the table".
function standsOnTable(state: GameState, uid: string): boolean {
  return Object.values(state.players).some((p) => {
    const mon = p.release.monitoring
    if (mon?.uid === uid) return true
    return SLOTS.some((slot) => p.release[slot]?.card.uid === uid)
  })
}

// Handles the two trigger ids. Neither card ever reaches the drawer's hand —
// it is revealed the instant it is drawn.
export function fireTrigger(
  state: GameState,
  log: Log,
  player: PlayerId,
  card: CardInstance,
  at: number,
): GameState {
  if (card.id === 'trigger-error-503') {
    const revealedId = log.add({ type: 'revealed', player, card: card.id })
    const methods = neutralizeOptions(state, player)
    // No way out: nothing is asked, so nothing stands. The card is banked here
    // and the elimination follows in the same batch — unchanged from before.
    if (methods.length === 0) {
      log.add({ type: 'discarded', player, card: card.id, reason: 'trigger' }, revealedId)
      return eliminate(discard(state, [card]), log, player)
    }
    // A standing Monitoring makes the 503 "игнорируются" (cards.md, the
    // Monitoring entry): nothing is asked, so nothing stands. It is answered
    // inside the very draw that turned it up — one batch, no decision, and the
    // Monitoring stays where it is.
    //
    // The Error 503 entry lists Monitoring as one of three способов the player
    // CHOOSES, which is the competing reading, and the two disagree about a
    // real case: whether a player holding both may burn a Debugger instead.
    // docs/rules/backlog.md carries both, and cards.md carries the marker —
    // this branch is the reading the game runs on, not the one it settles.
    if (state.players[player].release.monitoring) {
      const neutralizedId = log.add({ type: 'neutralized', player, method: 'monitoring' })
      // Parented to the method that banked it, exactly as `bankAlarm` does on
      // every chosen answer — the causal trail does not change shape just
      // because nobody was asked.
      log.add({ type: 'discarded', player, card: card.id, reason: 'trigger' }, neutralizedId)
      return { ...discard(state, [card]), eventSeq: log.seq }
    }
    // …otherwise the alarm STANDS. It waits on the pending until an answer is
    // chosen, and the two go to the discard together (resolution.md's own
    // destinations table). Holding it is also what lets the board cover it:
    // a card already in the heap cannot be answered on the table.
    return {
      ...state,
      pending: { kind: 'neutralize503', player, card, methods },
      eventSeq: log.seq,
    }
  }

  // trigger-ai
  const events = state.decks.events
  const index = Math.floor(randomAt(state.seed, state.rngCursor) * events.length)
  const event = events[index]
  const aiRevealedId = log.add({ type: 'aiRevealed', player, aiCard: card.id, eventCard: event.id })
  log.add({ type: 'discarded', player, card: card.id, reason: 'trigger' }, aiRevealedId)
  const remainingEvents = events.filter((_, i) => i !== index)
  const discarded = discard(state, [card])
  const drawn: GameState = {
    ...discarded,
    decks: { ...discarded.decks, events: remainingEvents },
    rngCursor: state.rngCursor + 1,
    eventSeq: log.seq,
  }
  const resolved = resolveAiEvent(drawn, log, player, event, at)
  // A one-off effect returns its card straight away; one that stays on the
  // table keeps it, and the card goes home when it leaves (general.md §6.4).
  // So the events deck genuinely shrinks while such a card is in play.
  if (standsOnTable(resolved, event.uid)) return { ...resolved, eventSeq: log.seq }
  return {
    ...resolved,
    decks: { ...resolved.decks, events: [...resolved.decks.events, event] },
    eventSeq: log.seq,
  }
}

// The alarm leaves WITH the answer, never before it — one moment for both
// cards (docs/rules/resolution.md's destinations table). Banked FIRST of the
// two, because the discard event ids are what give the exchange its layering
// on the board (the alarm underneath, the answer on top) and each card lands
// on the scatter its own id produces.
//
// `card` is null for a `crush`, which raises the same three methods with no
// card of its own standing anywhere — the AI event card is not on the table.
function bankAlarm(
  state: GameState,
  log: Log,
  player: PlayerId,
  card: CardInstance | null,
  parent: number,
): GameState {
  if (!card) return { ...state, eventSeq: log.seq }
  log.add({ type: 'discarded', player, card: card.id, reason: 'trigger' }, parent)
  return { ...discard(state, [card]), eventSeq: log.seq }
}

// Declining the 503: the player CAN answer and will not. The card's own text
// makes elimination the consequence of not neutralizing — "игрок выбывает, если
// не нейтрализует карту одним из трёх способов" — and names no duty to spend a
// способ merely because you hold one, so this is the same outcome the
// defenceless path already reaches, by choice instead of by force.
//
// The reading is an inference and is written down as one: docs/rules/backlog.md
// carries it, and the marker sits at the paragraph in docs/rules/cards.md it
// came from. Reachable only through the alarm the player owns — a `crush`
// shares `onNeutralize` but not this: declining one destroys a slot rather than
// its owner, which is a different rule and not one this task settled.
export function onDecline503(state: GameState, action: Action & { type: 'PASS' }): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'neutralize503') return reject(state, action, 'no 503 is owed by you')
  if (pending.player !== action.player) return reject(state, action, 'not your decision')

  const log = createLog(state.eventSeq)
  // The alarm is banked exactly as every other route out of a 503 banks it, and
  // BEFORE the elimination, so the card that caused it reads as leaving first.
  // No parent: the reveal that would have been one belongs to an earlier batch.
  // `card` is typed nullable because `crush` shares the pending's shape and
  // holds none. A 503 always has one; the guard is what makes that a fact the
  // types agree with rather than one this function assumes.
  const alarm = pending.card
  let banked = state
  if (alarm) {
    log.add({ type: 'discarded', player: action.player, card: alarm.id, reason: 'trigger' })
    banked = discard(state, [alarm])
  }
  return {
    state: eliminate({ ...banked, pending: null, eventSeq: log.seq }, log, action.player),
    events: log.events,
  }
}

// Routes both trigger decisions: neutralize503 and crush share the same set of
// methods and the same resolution machinery, differing only in what happens
// on the corresponding "no answer" path (elimination vs. destroying a slot).
export function onNeutralize(state: GameState, action: Action & { type: 'RESOLVE' }): Reduction {
  const pending = state.pending
  if (pending?.kind !== 'neutralize503' && pending?.kind !== 'crush') {
    return reject(state, action, 'no neutralize decision pending')
  }
  if (pending.player !== action.player) return reject(state, action, 'not your decision')
  const choice = action.choice as Extract<Choice, { kind: 'neutralize503' | 'crush' }>
  if (choice.kind !== pending.kind) return reject(state, action, 'wrong choice for this decision')
  if (!pending.methods.includes(choice.method)) {
    return reject(state, action, 'that method is not available')
  }

  const log = createLog(state.eventSeq)
  const player = action.player
  const hand = state.players[player].hand
  // Only the 503 holds a card; `crush` shares this reducer and holds none.
  const alarm = pending.kind === 'neutralize503' ? pending.card : null

  if (choice.method === 'debugger') {
    const dbg = hand.find((c) => c.id === 'protection-debugger')
    if (!dbg) return reject(state, action, 'you do not hold a Debugger')
    const neutralizedId = log.add({ type: 'neutralized', player, method: 'debugger' })
    const withAlarm = bankAlarm(state, log, player, alarm, neutralizedId)
    log.add({ type: 'discarded', player, card: dbg.id, reason: 'neutralized' }, neutralizedId)
    const withoutDbg = setHand(
      withAlarm,
      player,
      hand.filter((c) => c.uid !== dbg.uid),
    )
    return {
      // `discard` rather than appending to `decks.discard` by hand, matching
      // every other bank in this file. Identical for a Debugger, which is
      // never an events-deck card, and correct if that ever changes.
      state: { ...discard(withoutDbg, [dbg]), pending: null, eventSeq: log.seq },
      events: log.events,
    }
  }

  if (choice.method === 'monitoring') {
    const mon = state.players[player].release.monitoring
    if (!mon) return reject(state, action, 'you do not have a Monitoring')
    const neutralizedId = log.add({ type: 'neutralized', player, method: 'monitoring' })
    const withAlarm = bankAlarm(state, log, player, alarm, neutralizedId)
    return { state: { ...withAlarm, pending: null, eventSeq: log.seq }, events: log.events }
  }

  // sacrifice
  if (!choice.card) return reject(state, action, 'sacrifice needs a release card')
  const slot = SLOTS.find((s) => state.players[player].release[s]?.card.uid === choice.card)
  if (!slot) return reject(state, action, 'you do not hold that release')
  const neutralizedId = log.add({ type: 'neutralized', player, method: 'sacrifice' })
  const withAlarm = bankAlarm(state, log, player, alarm, neutralizedId)
  const destroyed = destroySlot(withAlarm, log, player, slot, 'neutralized', neutralizedId)
  return { state: { ...destroyed, pending: null, eventSeq: log.seq }, events: log.events }
}

// The fake's event set, each reusing existing machinery.
export function resolveAiEvent(
  state: GameState,
  log: Log,
  player: PlayerId,
  event: CardInstance,
  at: number,
): GameState {
  switch (event.id) {
    case 'ai-crush-frontend':
    case 'ai-crush-backend':
    case 'ai-crush-database': {
      const slot = event.id.replace('ai-crush-', '') as ReleaseSlot
      // Crush destroys "соответствующую карту Release". With that slot empty
      // there is nothing to destroy, so there is nothing to neutralize either —
      // opening the prompt made a player burn a Debugger, or sacrifice a
      // different release, against a threat that had no legal target.
      if (!state.players[player].release[slot]) return { ...state, eventSeq: log.seq }
      const methods = neutralizeOptions(state, player)
      if (methods.length === 0) return destroySlot(state, log, player, slot)
      return {
        ...state,
        pending: { kind: 'crush', player, slot, methods, source: event.id },
        eventSeq: log.seq,
      }
    }

    case 'ai-release-frontend':
    case 'ai-release-backend':
    case 'ai-release-database': {
      const slot = event.id.replace('ai-release-', '') as ReleaseSlot
      const me = state.players[player]
      if (me.release[slot]) return { ...state, eventSeq: log.seq }
      // A fresh instance, not `event` itself: the event card returns to its own
      // deck once this resolves, while the placed release stays on the board —
      // sharing one uid between the two would make the same card exist in two
      // places at once. The uid is also deliberately unrelated to the deck's
      // `release-<slot>#n` numbering, so it can never collide with a real
      // draw-pile card's uid in a projected view (see the privacy conformance
      // property in conformance.ts).
      //
      // The id is the plain `release-<slot>` catalogue id, not the event's own
      // `ai-release-<slot>` id: `rulesFor` classifies the latter as kind 'ai',
      // which `playableFor` always refuses to play standalone. If this card is
      // later bounced to hand by DDoS and thaws, it must read as an ordinary
      // release or it can never be played again.
      // The event card itself, standing in for the release it grants: its own
      // uid so it can go home, the plain catalogue id so it reads and plays as
      // an ordinary Release if DDoS ever bounces it to a hand.
      const placed: CardInstance = {
        uid: event.uid,
        id: `release-${slot}`,
        event: event.id,
      }
      log.add({ type: 'released', player, slot, card: placed.id })
      const zoned: GameState = {
        ...state,
        players: {
          ...state.players,
          [player]: { ...me, release: { ...me.release, [slot]: { card: placed } } },
        },
        eventSeq: log.seq,
      }
      // "Этот релиз можно атаковать" — the window is the engine's only route to
      // ATTACK, so a release placed without one is permanently safe, which
      // makes an AI-granted release strictly better than a shipped one.
      // No Code Review here, by the same rule, so the window is unconditional.
      //
      // Win timing mirrors `placeRelease`: a release that faces a window is
      // settled when the window closes, and only a placement no window can
      // follow is settled on the spot.
      const opened = openWindow(zoned, log, { player, slot, card: placed.uid }, 1, at)
      if (!opened.window) return checkWin(opened, log)
      return opened
    }

    case 'ai-monitoring': {
      const me = state.players[player]
      if (me.release.monitoring) return { ...state, eventSeq: log.seq }
      // Same reasoning as the release case above: the plain catalogue id, not
      // the event's own `ai-monitoring` id, so the placed card plays and
      // renders as an ordinary Monitoring if it is ever displaced and returns.
      const placed: CardInstance = {
        uid: event.uid,
        id: 'protection-monitoring',
        event: event.id,
      }
      log.add({ type: 'placed', player, card: placed.id })
      return {
        ...state,
        players: {
          ...state.players,
          [player]: { ...me, release: { ...me.release, monitoring: placed } },
        },
        eventSeq: log.seq,
      }
    }

    case 'ai-good-vibe-coding':
      // "доберите 2 карты (карты AI/Error 503 срабатывают как при обычном
      // доборе)" — two cards off the draw pile, one at a time. Handing the
      // sequence to `drawing` rather than looping here is what makes the
      // "срабатывают" half true: a trigger drawn first pauses the sequence and
      // the second card waits, instead of a second trigger overwriting the
      // single pending slot and erasing the first threat.
      //
      // The reducer runs and resumes the sequence; this only declares it.
      return { ...state, drawing: { player, piles: [0, 0] }, eventSeq: log.seq }

    case 'ai-bad-vibe-coding':
      // "сбросьте одну карту из руки" — nothing about the turn. An empty hand
      // has nothing to give, and the pending would be unanswerable: `[]` never
      // matches `excess: 1`, and a pending blocks every action for every
      // player, so the table stalls for good.
      if (state.players[player].hand.length === 0) return { ...state, eventSeq: log.seq }
      // Reuses the handLimit pending for its prompt and resolution, but not its
      // consequence: `endsTurn` false keeps the seat with its owner.
      return {
        ...state,
        pending: { kind: 'handLimit', player, excess: 1, endsTurn: false, source: event.id },
        eventSeq: log.seq,
      }

    case 'ai-hallucination':
      return endTurn(state, log)

    case 'ai-error-503': {
      log.add({ type: 'revealed', player, card: event.id })
      const methods = neutralizeOptions(state, player)
      if (methods.length === 0) return eliminate(state, log, player)
      // The event card is already back in the events deck by this point (the
      // trigger-ai branch above appends it once resolveAiEvent returns) — it
      // never touches the discard, so there is no card standing here for a
      // neutralize answer to bank alongside it (general.md §6.4).
      return {
        ...state,
        pending: { kind: 'neutralize503', player, card: null, methods, source: event.id },
        eventSeq: log.seq,
      }
    }

    case 'ai-inside': {
      // Unlike a played card, the event card itself is never spent to the
      // discard here — fireTrigger's caller returns it to the events deck once
      // this resolves, so it takes no part in openPickFromDiscard's spend list.
      // Only a Release may be taken back; an empty discard resolves to nothing.
      const options = discardOptions(state, true)
      if (options.length === 0) return { ...state, eventSeq: log.seq }
      return {
        ...state,
        pending: { kind: 'pickFromDiscard', player, options, picks: 1, source: event.id },
        eventSeq: log.seq,
      }
    }

    default:
      return { ...state, eventSeq: log.seq }
  }
}
