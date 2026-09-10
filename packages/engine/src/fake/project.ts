import type { Target } from '../actions'
import { rulesFor } from '../cards'
import type { CardUid, GameState, PlayerId, Released } from '../state'
import { emptyTally, type PlayerTally } from '../tally'
import type { PlayerView, ReleasedView, ReleaseView } from '../view'
import { pendingView } from './attacks'
import { attackTargets, drawObligationMet } from './core'
import { canAttackWith } from './window'

const releasedView = (r: Released | undefined): ReleasedView | undefined =>
  r && {
    uid: r.card.uid,
    card: r.card.id,
    codeReview: r.codeReview?.id,
    ...(r.card.event ? { event: r.card.event } : {}),
  }

function releaseView(state: GameState, id: PlayerId): ReleaseView {
  const z = state.players[id].release
  const view: ReleaseView = {
    frontend: releasedView(z.frontend),
    backend: releasedView(z.backend),
    database: releasedView(z.database),
  }
  if (z.monitoring) {
    view.monitoring = {
      uid: z.monitoring.uid,
      card: z.monitoring.id,
      ...(z.monitoring.event ? { event: z.monitoring.event } : {}),
    }
  }
  return view
}

// Which of a player's cards may be played right now. Exported so validation and
// projection share one answer — two copies of legality drift silently.
export function playableFor(state: GameState, viewerId: PlayerId): CardUid[] {
  if (state.over) return []
  // A pending decision suspends normal play; its own options are carried on the
  // pending view instead.
  if (state.pending) return []
  if (state.window) return []
  // Answer 2: playing from hand is impossible while a draw is in progress. A
  // paused sequence is still in progress — the pause is owed to a trigger, not
  // an opening for the drawer to spend on something else.
  if (state.turn.player !== viewerId) return []
  if (state.eliminated.includes(viewerId)) return []

  const me = state.players[viewerId]
  const releaseCap = state.setup.releases === 'fast' ? Number.POSITIVE_INFINITY : 1

  return me.hand
    .filter((c) => {
      if (me.frozen.includes(c.uid) || me.replayLocked.includes(c.uid)) return false
      const rules = rulesFor(c.id)
      if (!rules) return false
      switch (rules.kind) {
        case 'release': {
          if (state.turn.releasesPlayed >= releaseCap) return false
          // One card of each type only; the slot must be free.
          if (me.release[rules.slot as 'frontend']) return false
          // Unless the mode makes releases free, the cost is a second card, so
          // a lone release is unplayable — `onPlay` (release.ts) rejects it.
          // Listing it anyway would show a player a card that bounces back as
          // a rejection with nothing to explain it, and would send any policy
          // reading this list (bots.ts, the keeper driving an absent seat) into
          // a move the engine refuses.
          if (state.setup.releaseCond !== 'easy' && me.hand.length < 2) return false
          return true
        }
        case 'protection':
          // Monitoring goes to the zone (one at a time); Debugger only answers a
          // trigger, so it is never played proactively.
          return c.id === 'protection-monitoring' ? !me.release.monitoring : false
        case 'operation':
          // Playable even when the discard cannot satisfy it: answer 11 makes
          // that a legal move with consequences, not a rejection.
          return true
        case 'attack':
          return attackTargets(state, viewerId, c.id).length > 0
        // Defences answer an attack, supports ride along with another card, and
        // triggers fire on the draw — none is a standalone play.
        case 'cancel':
        case 'unicorn':
        case 'support':
        case 'trigger':
        case 'ai':
          return false
        default:
          return false
      }
    })
    .map((c) => c.uid)
}

// An entry only for the playable cards that need a target — the same
// `attackTargets` the reducer itself validates against, so the offer and the
// acceptance cannot drift.
export function targetsFor(state: GameState, viewerId: PlayerId): Record<CardUid, Target[]> {
  const result: Record<CardUid, Target[]> = {}
  const hand = state.players[viewerId].hand
  for (const uid of playableFor(state, viewerId)) {
    const card = hand.find((c) => c.uid === uid)
    if (!card || rulesFor(card.id)?.kind !== 'attack') continue
    result[uid] = attackTargets(state, viewerId, card.id)
  }
  return result
}

// Which pairs a support card in hand may legally start right now, keyed by
// the support card's own uid (support-first staging: Tasks 9-10 stage the
// support first, then look up its partners). Sudo rides with a sudo-carrier
// that is playable on the turn or throwable into an open window; Code Review
// rides with a release, but only when a third card is left to pay its cost
// (release.ts:268 rejects a pair that leaves nothing to pay with, unless the
// mode waives the cost). Mirrors `playableFor`/`canAttackWith`: no window, no
// pending, no turn — no combos either, EXCEPT the one case below.
//
// Task 17 (#101): a `defend` pending owed to THIS player is the one pending
// that still has a legal Sudo pairing — the defence it is about to enhance.
// `playableFor` empties out while any pending is open (its own first check),
// so that path is closed the same as ever; the pending's own answerable set
// (`canDefendWith`) stands in for it instead, exactly the way `playable`/
// `throwable` already do for the turn/window case just above. Legality is
// still the engine's answer either way — this reads it, never re-derives it.
// "A sudo-backed attack can be enhanced by nothing" needs no extra check: a
// sudo attack already drops every Cancel-kind defence (defense-rollback, the
// only defence with its own sudo tag) out of `canDefendWith` (`defencesFor`
// above), so the intersection below is empty on its own.
export function combosFor(state: GameState, viewerId: PlayerId): Record<CardUid, CardUid[]> {
  const me = state.players[viewerId]
  const result: Record<CardUid, CardUid[]> = {}
  const playable = new Set(playableFor(state, viewerId))
  const throwable = new Set(canAttackWith(state, viewerId))
  const defendable =
    state.pending?.kind === 'defend' && state.pending.player === viewerId
      ? new Set(state.pending.canDefendWith)
      : null
  for (const s of me.hand) {
    if (s.id !== 'support-sudo' && s.id !== 'support-code-review') continue
    const partners = me.hand
      .filter((c) => {
        if (c.uid === s.uid) return false
        const rules = rulesFor(c.id)
        if (s.id === 'support-sudo') {
          if (rules?.sudo !== true) return false
          if (defendable) return defendable.has(c.uid)
          return playable.has(c.uid) || throwable.has(c.uid)
        }
        // Code Review rides a release being PLAYED — and the pair must leave a
        // card to pay the cost (release.ts:268), unless the mode waives it.
        if (rules?.kind !== 'release' || !playable.has(c.uid)) return false
        return state.setup.releaseCond === 'easy' || me.hand.length >= 3
      })
      .map((c) => c.uid)
    if (partners.length > 0) result[s.uid] = partners
  }
  return result
}

// The results are for the results screen. `cherryPick` counts a pull whose
// second card is deliberately private (fake/discard.ts), so a live counter
// would leak mid-match exactly what visibleTo was written to hide. Keyed by
// seating so the map is complete and ordered however the table is seated, and
// copied so a viewer cannot reach back into GameState through it.
function tallyView(state: GameState): Record<PlayerId, PlayerTally> | null {
  if (!state.over) return null
  const out: Record<PlayerId, PlayerTally> = {}
  for (const id of state.seating) out[id] = { ...(state.tally[id] ?? emptyTally()) }
  return out
}

export function project(state: GameState, viewerId: PlayerId): PlayerView {
  const me = state.players[viewerId]
  const top = state.decks.discard[state.decks.discard.length - 1]

  return {
    self: {
      id: me.id,
      name: me.name,
      hand: me.hand.map((c) => ({ ...c })),
      release: releaseView(state, viewerId),
      playable: playableFor(state, viewerId),
      targets: targetsFor(state, viewerId),
      combos: combosFor(state, viewerId),
      frozen: [...me.frozen],
    },
    opponents: state.seating
      .filter((id) => id !== viewerId)
      .map((id) => ({
        id,
        name: state.players[id].name,
        handCount: state.players[id].hand.length,
        release: releaseView(state, id),
        eliminated: state.eliminated.includes(id),
      })),
    decks: {
      piles: state.decks.main.map((p) => p.length),
      events: state.decks.events.length,
      discardTop: top?.id,
      discardCount: state.decks.discard.length,
    },
    turn: {
      player: state.turn.player,
      index: state.turn.index,
      // The kit asks one question — is a draw still owed — so the answer
      // crosses as the boolean it always was, not as the raw pile list.
      hasDrawn: drawObligationMet(state),
      openedAt: state.turn.openedAt,
      deadline: state.turn.deadline,
    },
    window: state.window && {
      player: state.window.target.player,
      slot: state.window.target.slot,
      round: state.window.round,
      openedAt: state.window.openedAt,
      deadline: state.window.deadline,
      passed: [...state.window.passed],
      canAttackWith: canAttackWith(state, viewerId),
    },
    pending: pendingView(state, viewerId),
    setup: { ...state.setup },
    over: state.over && { ...state.over },
    tally: tallyView(state),
  }
}
