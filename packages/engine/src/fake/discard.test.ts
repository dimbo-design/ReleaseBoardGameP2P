import { describe, expect, it } from 'vitest'
import type { CardInstance, GameState, PlayerId } from '../state'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from './index'
import { reduce } from './reduce'

const engine = createFakeEngine()

function gameWith(discard: string[], hand: string[]): GameState {
  const base = engine.createGame({
    gameId: 'g',
    seed: 3,
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  return {
    ...base,
    turn: { ...base.turn, player: 'p1', drawnFrom: [0] },
    decks: { ...base.decks, discard: discard.map((id, i) => ({ uid: `${id}#d${i}`, id })) },
    players: {
      ...base.players,
      p1: { ...base.players.p1, hand: hand.map((id, i) => ({ uid: `${id}#h${i}`, id })) },
    },
  }
}

const CHERRY = 'operation-git-cherry-pick'

// Drives the AI event the same way triggers.test.ts drives every other AI
// event: stack a trigger-ai on top of pile 0 and shrink the events deck to a
// single entry so which event fires is deterministic, then DRAW.
function applyAiInside(state: GameState, player: PlayerId): GameState {
  const ai: CardInstance = { uid: 'trigger-ai#ai0', id: 'trigger-ai' }
  const inside: CardInstance = { uid: 'ai-inside#e0', id: 'ai-inside' }
  const staged: GameState = {
    ...state,
    turn: { ...state.turn, player, drawnFrom: [] },
    decks: {
      ...state.decks,
      main: [[ai, ...state.decks.main[0]], ...state.decks.main.slice(1)],
      events: [inside],
    },
  }
  return reduce(staged, { type: 'DRAW', player, at: 1 }).state
}

describe('Git Cherry-pick', () => {
  it('opens a pending offering the whole discard, one pick', () => {
    const state = gameWith(['attack-bug', 'release-frontend'], [CHERRY])
    const { state: next } = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      at: 1,
    })
    expect(next.pending).toMatchObject({ kind: 'pickFromDiscard', player: 'p1', picks: 1 })
    const pending = next.pending as { options: { id: string }[] }
    expect(pending.options.map((o) => o.id)).toEqual(['attack-bug', 'release-frontend'])
  })

  it('moves the chosen card from the discard into hand', () => {
    const state = gameWith(['attack-bug'], [CHERRY])
    const played = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      at: 1,
    }).state
    const { state: next } = engine.reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: { kind: 'pickFromDiscard', card: 'attack-bug#d0' },
      at: 2,
    })
    expect(next.players.p1.hand.map((c) => c.id)).toContain('attack-bug')
    expect(next.decks.discard.some((c) => c.uid === 'attack-bug#d0')).toBe(false)
    expect(next.pending).toBeNull()
  })

  it('is spent without a pending when the discard is empty', () => {
    const state = gameWith([], [CHERRY])
    const { state: next, events } = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      at: 1,
    })
    // Answer 11: a legal move with consequences, never a rejection.
    expect(events.some((e) => e.type === 'rejected')).toBe(false)
    expect(next.pending).toBeNull()
    expect(next.decks.discard.map((c) => c.id)).toContain(CHERRY)
    expect(next.players.p1.hand.some((c) => c.id === CHERRY)).toBe(false)
    // The fizzle path must still be observable: a legal, consequential play
    // that emits zero events would show nothing in MoveHistory and leave
    // eventSeq unmoved, indistinguishable from nothing having happened.
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'discarded', player: 'p1', card: CHERRY, reason: 'effect' }),
    )
    expect(next.eventSeq).toBeGreaterThan(state.eventSeq)
  })

  it('owes two picks with sudo, and puts the second on top of pile 0', () => {
    const state = gameWith(['attack-bug', 'release-frontend'], [CHERRY, 'support-sudo'])
    const played = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      combo: 'support-sudo#h1',
      at: 1,
    }).state
    expect(played.pending).toMatchObject({ picks: 2 })
    const { state: next } = engine.reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: {
        kind: 'pickFromDiscard',
        card: 'attack-bug#d0',
        toDeck: 'release-frontend#d1',
      },
      at: 2,
    })
    expect(next.players.p1.hand.map((c) => c.id)).toContain('attack-bug')
    expect(next.decks.main[0][0].uid).toBe('release-frontend#d1')
    // Both offered cards left the pile, and the spent Cherry-pick and Sudo
    // joined it. Cards never leave the game: answer 7 refills an exhausted
    // deck by shuffling the discard, so a card that vanished would shrink the
    // game's card pool permanently.
    expect(next.decks.discard.map((c) => c.id).sort()).toEqual([CHERRY, 'support-sudo'].sort())
  })

  it('owes only one pick with sudo when the discard holds a single card', () => {
    const state = gameWith(['attack-bug'], [CHERRY, 'support-sudo'])
    const played = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      combo: 'support-sudo#h1',
      at: 1,
    }).state
    expect(played.pending).toMatchObject({ picks: 1 })
  })

  it('keeps the deck-bound card private to the player who placed it', () => {
    const state = gameWith(['attack-bug', 'release-frontend'], [CHERRY, 'support-sudo'])
    const played = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      combo: 'support-sudo#h1',
      at: 1,
    }).state
    const { events } = engine.reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: {
        kind: 'pickFromDiscard',
        card: 'attack-bug#d0',
        toDeck: 'release-frontend#d1',
      },
      at: 2,
    })
    const toDeck = events.find((e) => e.type === 'takenFromDiscard' && e.to === 'deck')
    expect(toDeck?.visibleTo).toEqual(['p1'])
  })

  it('never loses a card from the game', () => {
    const state = gameWith(['attack-bug', 'release-frontend'], [CHERRY, 'support-sudo'])
    const before =
      state.decks.discard.length +
      state.players.p1.hand.length +
      state.decks.main.reduce((n, p) => n + p.length, 0)
    const played = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      combo: 'support-sudo#h1',
      at: 1,
    }).state
    const { state: next } = engine.reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: { kind: 'pickFromDiscard', card: 'attack-bug#d0', toDeck: 'release-frontend#d1' },
      at: 2,
    })
    const after =
      next.decks.discard.length +
      next.players.p1.hand.length +
      next.decks.main.reduce((n, p) => n + p.length, 0)
    expect(after).toBe(before)
  })

  it("hides the discard options from an opponent's projection", () => {
    const state = gameWith(['attack-bug', 'release-frontend'], [CHERRY])
    const { state: next } = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      at: 1,
    })
    // Only discardTop/discardCount are ever public (project.ts) — the pile's
    // full contents are not, so an opponent's projection of this pending must
    // carry no option uids at all, the same as every other owner-only pending.
    const opponentView = engine.project(next, 'p2')
    expect(opponentView.pending).toMatchObject({ kind: 'pickFromDiscard', player: 'p1' })
    const pending = opponentView.pending as { options: { uid: string }[] }
    expect(pending.options).toEqual([])
  })

  // "Обе карты нельзя держать в руке" (docs/rules/cards.md, the trigger
  // section). Both trigger types reach the discard in ordinary play, because
  // that is where fireTrigger banks them.
  it('does not offer a trigger to a base pick — it could only go to the hand', () => {
    const state = gameWith(['trigger-error-503', 'attack-bug'], [CHERRY])
    const { state: next } = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      at: 1,
    })
    const pending = next.pending as { options: { id: string }[]; picks: number }
    expect(pending.options.map((o) => o.id)).toEqual(['attack-bug'])
    expect(pending.picks).toBe(1)
  })

  it('raises no pending at all when the discard holds nothing but triggers', () => {
    const state = gameWith(['trigger-error-503', 'trigger-ai'], [CHERRY])
    const { state: next } = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      at: 1,
    })
    // Rules answer 11: a play with nothing to take is the player's own blunder,
    // not a rejected action — the card is spent and the turn goes on.
    expect(next.pending).toBeNull()
    expect(next.decks.discard.map((c) => c.id)).toContain('operation-git-cherry-pick')
  })

  it('keeps offering triggers under sudo, where one may take the deck slot', () => {
    const state = gameWith(['trigger-error-503', 'attack-bug'], [CHERRY, 'support-sudo'])
    const { state: next } = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      combo: 'support-sudo#h1',
      at: 1,
    })
    const pending = next.pending as { options: { id: string }[]; picks: number }
    expect(pending.options.map((o) => o.id)).toEqual(['trigger-error-503', 'attack-bug'])
    expect(pending.picks).toBe(2)
  })

  it('raises no pending for a sudo pick over a discard of nothing but triggers', () => {
    const state = gameWith(['trigger-error-503', 'trigger-ai'], [CHERRY, 'support-sudo'])
    const { state: next } = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      combo: 'support-sudo#h1',
      at: 1,
    })
    // Rules answer 11: the mandatory hand slot has no legal filler among
    // triggers, so this is a wasteful play, not a decision left open.
    expect(next.pending).toBeNull()
    expect(next.decks.discard.map((c) => c.id).sort()).toEqual(
      [CHERRY, 'support-sudo', 'trigger-error-503', 'trigger-ai'].sort(),
    )
  })

  it('raises no pending for a sudo pick over a discard of a single trigger', () => {
    const state = gameWith(['trigger-error-503'], [CHERRY, 'support-sudo'])
    const { state: next } = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      combo: 'support-sudo#h1',
      at: 1,
    })
    expect(next.pending).toBeNull()
    expect(next.decks.discard.map((c) => c.id).sort()).toEqual(
      [CHERRY, 'support-sudo', 'trigger-error-503'].sort(),
    )
  })

  it('refuses a trigger as the card taken to hand, even under sudo', () => {
    const state = gameWith(['trigger-error-503', 'attack-bug'], [CHERRY, 'support-sudo'])
    const played = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      combo: 'support-sudo#h1',
      at: 1,
    }).state
    const { state: next, events } = engine.reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: { kind: 'pickFromDiscard', card: 'trigger-error-503#d0', toDeck: 'attack-bug#d1' },
      at: 2,
    })
    expect(next).toBe(played)
    expect(events.map((e) => e.type)).toEqual(['rejected'])
    expect(next.players.p1.hand.map((c) => c.id)).not.toContain('trigger-error-503')
  })

  it('lets a trigger be the sudo card that goes onto the deck', () => {
    const state = gameWith(['trigger-error-503', 'attack-bug'], [CHERRY, 'support-sudo'])
    const played = engine.reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: `${CHERRY}#h0`,
      combo: 'support-sudo#h1',
      at: 1,
    }).state
    const { state: next } = engine.reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: { kind: 'pickFromDiscard', card: 'attack-bug#d1', toDeck: 'trigger-error-503#d0' },
      at: 2,
    })
    expect(next.players.p1.hand.map((c) => c.id)).toContain('attack-bug')
    expect(next.decks.main[0][0].id).toBe('trigger-error-503')
  })
})

describe('Inside', () => {
  it('offers only Release cards from the discard', () => {
    const state = gameWith(['attack-bug', 'release-frontend', 'release-backend'], [])
    const next = applyAiInside(state, 'p1')
    const pending = next.pending as { options: { id: string }[]; picks: number }
    expect(pending.options.map((o) => o.id)).toEqual(['release-frontend', 'release-backend'])
    expect(pending.picks).toBe(1)
  })

  it('resolves to nothing when the discard holds no Release', () => {
    const state = gameWith(['attack-bug', 'attack-ddos'], [])
    expect(applyAiInside(state, 'p1').pending).toBeNull()
  })
})
