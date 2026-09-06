import type { Event, PlayerView } from '@release/engine'
import { HEAP_SHOW, scatterAt } from '@release/ui/animations'
import { describe, expect, it } from 'vitest'
import { type HistoryLabels, standInScatter, toBoardState } from './toBoardState'

// A minimal but real PlayerView — every field is the engine's actual shape,
// not a mock. `hand[0].id` is a catalogue id ('attack-bug'); `hand[0].uid` is
// an unrelated instance id ('c1') — deliberately different strings so a test
// that reads the wrong one fails loudly instead of passing by coincidence.
const view: PlayerView = {
  self: {
    id: 'you',
    name: 'you',
    hand: [{ uid: 'c1', id: 'attack-bug' }],
    release: {},
    playable: ['c1'],
    targets: {},
    combos: {},
    frozen: [],
  },
  opponents: [{ id: 'p2', name: 'bot', handCount: 3, release: {}, eliminated: false }],
  decks: { piles: [30, 10], events: 8, discardCount: 2, discardTop: 'attack-ddos' },
  turn: { player: 'you', index: 4, hasDrawn: false },
  window: null,
  pending: null,
  setup: {},
  over: null,
  tally: null,
}

// Only the event types these tests exercise — HistoryLabels requires the full
// Event union, so the cast documents that this is a deliberately partial
// fixture, matching the brief's guidance ("Object.fromEntries over the event
// types they exercise").
const labels = Object.fromEntries([
  ['drawn', 'Draw'],
  ['placed', 'Played'],
  ['eliminated', 'Eliminated'],
  ['discarded', 'Discarded'],
]) as HistoryLabels

describe('toBoardState', () => {
  // The projection has always carried the piles; the adapter used to sum them
  // because the board could only draw one. It draws them all now, so the shape
  // travels through untouched.
  it('carries the pile list through untouched', () => {
    expect(toBoardState(view, [], labels).decks.main).toEqual([30, 10])
  })

  it('carries hand uids through unchanged so animation keys stay stable', () => {
    const hand = toBoardState(view, [], labels).you.hand
    expect(hand[0].uid).toBe('c1')
    // and resolves the *catalogue id* to the real card — proves `id` (not
    // `uid`) drove the lookup.
    expect(hand[0].card.name).toBe('Bug')
  })

  it('renders a placeholder for a card id the catalogue does not know', () => {
    const unknown: PlayerView = {
      ...view,
      self: { ...view.self, hand: [{ uid: 'c9', id: 'not-a-card' }] },
    }
    expect(() => toBoardState(unknown, [], labels)).not.toThrow()
    expect(toBoardState(unknown, [], labels).you.hand[0].card).toBeTruthy()
  })

  it('folds the turn clock into one optional pair the dock can sweep', () => {
    const timed: PlayerView = {
      ...view,
      turn: { ...view.turn, openedAt: 1_000, deadline: 31_000 },
    }
    expect(toBoardState(timed, [], labels).turnClock).toEqual({ openedAt: 1_000, deadline: 31_000 })
    // No clock (a window/pending owns the wait, or the keeper has not started
    // the first turn's) folds to null, never to a half-formed pair.
    expect(toBoardState(view, [], labels).turnClock).toBeNull()
  })

  it('marks an eliminated opponent', () => {
    const out: PlayerView = {
      ...view,
      opponents: [{ ...view.opponents[0], eliminated: true }],
    }
    expect(toBoardState(out, [], labels).opponents[0].eliminated).toBe(true)
  })

  it('resolves the discard pile top through the catalogue id, not a uid', () => {
    // discardTop is a CardId ('attack-ddos'); nothing here is a CardUid — the
    // engine's projection never puts an instance id there.
    expect(toBoardState(view, [], labels).decks.discard?.name).toBe('DDoS')
  })

  it('does not throw for an unknown discard top and does not surface a raw id as a name', () => {
    const unknownDiscard: PlayerView = {
      ...view,
      decks: { ...view.decks, discardTop: 'not-a-card' },
    }
    expect(() => toBoardState(unknownDiscard, [], labels)).not.toThrow()
  })

  it('folds the event log into history newest first', () => {
    const log: Event[] = [
      { id: 1, type: 'drawn', player: 'you', pile: 0, deckSize: 39 },
      { id: 2, type: 'placed', player: 'p2', card: 'attack-bug' },
    ]
    const history = toBoardState(view, log, labels).history
    expect(history.length).toBe(2)
    expect(history[0].kind).toBe(labels.placed)
    expect(history[1].kind).toBe(labels.drawn)
  })

  it('preserves parent so MoveHistory can build its tree', () => {
    const log: Event[] = [
      { id: 1, type: 'drawn', player: 'you', pile: 0, deckSize: 39 },
      { id: 2, type: 'eliminated', player: 'p2', parent: 1 },
    ]
    const history = toBoardState(view, log, labels).history
    expect(history[0].parent).toBe(1)
  })

  it('filters events not visible to the local player out of the history', () => {
    const log: Event[] = [
      { id: 1, type: 'drawn', player: 'you', pile: 0, deckSize: 39, visibleTo: ['p2'] },
    ]
    expect(toBoardState(view, log, labels).history).toHaveLength(0)
  })

  it('does not produce participants or spectators — those are room facts', () => {
    const state = toBoardState(view, [], labels)
    expect('participants' in state).toBe(false)
    expect('spectators' in state).toBe(false)
  })

  it('carries a window openedAt through unchanged, alongside deadline', () => {
    const withWindow: PlayerView = {
      ...view,
      window: {
        player: 'you',
        slot: 'frontend',
        round: 1,
        openedAt: 100,
        deadline: 200,
        passed: [],
        canAttackWith: [],
      },
    }
    const window = toBoardState(withWindow, [], labels).window
    expect(window?.openedAt).toBe(100)
    expect(window?.deadline).toBe(200)
  })

  it('passes the projection targets through as table targets', () => {
    const withTargets: PlayerView = {
      ...view,
      self: { ...view.self, targets: { 'attack-bug#0': [{ kind: 'player', player: 'p2' }] } },
    }
    expect(toBoardState(withTargets, [], labels).targets).toEqual({
      'attack-bug#0': [{ kind: 'player', player: 'p2' }],
    })
  })

  it('feeds comboOptions from the projection, not the rules table', () => {
    const withCombos: PlayerView = {
      ...view,
      self: { ...view.self, combos: { 'support-sudo#0': ['attack-bug#0'] } },
    }
    expect(toBoardState(withCombos, [], labels).comboOptions).toEqual({
      'support-sudo#0': ['attack-bug#0'],
    })
  })

  it('carries a released Code Review as the slot support', () => {
    const withReleaseSupport: PlayerView = {
      ...view,
      self: {
        ...view.self,
        release: {
          frontend: { uid: 'r#0', card: 'release-frontend', codeReview: 'support-code-review' },
        },
      },
    }
    const state = toBoardState(withReleaseSupport, [], labels)
    expect(state.you.support?.frontend?.id).toBe('support-code-review')
  })

  it('keeps the uid of every release the player holds', () => {
    const withReleaseUids: PlayerView = {
      ...view,
      self: {
        ...view.self,
        release: {
          frontend: { uid: 'release-frontend#3', card: 'release-frontend' },
          monitoring: { uid: 'protection-monitoring#1', card: 'protection-monitoring' },
        },
      },
    }
    const state = toBoardState(withReleaseUids, [], labels)
    // the card data the kit renders is unchanged…
    expect(state.you.release.frontend?.id).toBe('release-frontend')
    // …and the uid the engine needs to be told which release was sacrificed
    // survives beside it
    expect(state.you.releaseUid).toEqual({
      frontend: 'release-frontend#3',
      monitoring: 'protection-monitoring#1',
    })
  })

  it('carries the events-deck identity of a standing AI release, for you and for an opponent', () => {
    const withEvents: PlayerView = {
      ...view,
      self: {
        ...view.self,
        release: {
          frontend: { uid: 'ai#1', card: 'release-frontend', event: 'ai-release-frontend' },
          backend: { uid: 'base#1', card: 'release-backend' },
        },
      },
      opponents: [
        {
          ...view.opponents[0],
          release: {
            monitoring: { uid: 'ai#2', card: 'protection-monitoring', event: 'ai-monitoring' },
          },
        },
      ],
    }
    const state = toBoardState(withEvents, [], labels)
    expect(state.you.releaseEvent).toEqual({ frontend: 'ai-release-frontend' })
    expect(state.opponents[0].releaseEvent).toEqual({ monitoring: 'ai-monitoring' })
    // the slots themselves are unchanged — the card still reads as an ordinary one
    expect(state.you.release.frontend?.id).toBe('release-frontend')
  })

  it('carries a defend pending openedAt through unchanged, alongside deadline', () => {
    const withPending: PlayerView = {
      ...view,
      pending: {
        kind: 'defend',
        player: 'you',
        attacker: 'p2',
        attackCard: 'attack-bug',
        sudo: false,
        options: ['c1'],
        openedAt: 50,
        deadline: 150,
        scope: 'hand',
      },
    }
    const pending = toBoardState(withPending, [], labels).pending
    expect(pending && 'openedAt' in pending ? pending.openedAt : undefined).toBe(50)
    expect(pending && 'deadline' in pending ? pending.deadline : undefined).toBe(150)
  })
})

// The decks are the only slice these assertions vary, so they spread the shared
// projection rather than restating one — a second full PlayerView here would
// drift from the one every other test in this file reads.
const withDecks = (decks: Partial<PlayerView['decks']>): PlayerView => ({
  ...view,
  decks: { ...view.decks, ...decks },
})

const discardedEvent = (id: number, card: string, reason = 'effect'): Event =>
  ({ id, type: 'discarded', player: 'you', card, reason }) as Event

describe('the discard heap', () => {
  it('is empty when nothing has been discarded and nothing is on top', () => {
    const state = toBoardState(withDecks({ discardCount: 0, discardTop: undefined }), [], labels)
    expect(state.decks.discardHeap).toEqual([])
  })

  it('gives one entry per discarded event, keyed by the event id', () => {
    const log = [
      discardedEvent(7, 'protection-debugger'),
      discardedEvent(9, 'attack-bug', 'handLimit'),
    ]
    const heap =
      toBoardState(withDecks({ discardCount: 2, discardTop: 'attack-bug' }), log, labels).decks
        .discardHeap ?? []
    expect(heap.map((c) => c.uid)).toEqual(['d7', 'd9'])
    expect(heap.map((c) => c.card.id)).toEqual(['protection-debugger', 'attack-bug'])
  })

  // The scatter is the whole reason the heap is derived rather than invented per
  // render: the beat flies the card on scatterAt(e.id) and the heap rests
  // it on the same value, so the landing frame IS the resting frame (I7).
  it('scatters a card the same way every time', () => {
    const log = [discardedEvent(7, 'attack-bug')]
    const decks = withDecks({ discardCount: 1, discardTop: 'attack-bug' })
    const first = toBoardState(decks, log, labels).decks.discardHeap ?? []
    const second = toBoardState(decks, log, labels).decks.discardHeap ?? []
    expect(first).toEqual(second)
    expect(first[0]).toMatchObject(scatterAt(7))
  })

  it('keeps only the cards the pile actually renders', () => {
    const log = Array.from({ length: HEAP_SHOW + 4 }, (_, i) => discardedEvent(i + 1, 'attack-bug'))
    const heap =
      toBoardState(withDecks({ discardCount: log.length, discardTop: 'attack-bug' }), log, labels)
        .decks.discardHeap ?? []
    expect(heap).toHaveLength(HEAP_SHOW)
    expect(heap.at(-1)?.uid).toBe(`d${log.length}`)
  })

  // The engine banks a spent attack or defence straight into the discard with no
  // event at all (docs/animations/backlog.md), so the fold runs behind the count.
  // Pile ignores `topCard` once a heap is present, so without this the board
  // would show a stale card as the top of the discard.
  it('appends the projection top when the fold does not end on it', () => {
    const log = [discardedEvent(7, 'attack-bug')]
    const heap =
      toBoardState(withDecks({ discardCount: 4, discardTop: 'attack-ddos' }), log, labels).decks
        .discardHeap ?? []
    expect(heap.map((c) => c.card.id)).toEqual(['attack-bug', 'attack-ddos'])
    expect(heap.at(-1)?.uid).toBe('top4')
    // Keyed out of the event ids' range, so the stand-in can never take a real
    // card's pose (see the implementation note on negative keys).
    expect(heap.at(-1)).toMatchObject(scatterAt(-5))
    // …and it is the SHARED value, not a formula written twice. `planBeats`
    // reads `standInScatter` to fly a silently banked card onto exactly this
    // pose (#106, the crush ending), so the flight and the rest are one value
    // (I7); a key spelled out separately here would let the two drift apart
    // with nothing failing.
    expect(heap.at(-1)).toMatchObject(standInScatter(4))
  })

  // The pile can EMPTY without the feed saying so card by card: refillFromDiscard
  // recycles the whole discard into the deck and emits only `deckReshuffled`.
  // The historical `discarded` events stay in the feed forever, so a fold that
  // trusted them alone would keep drawing a stack over a counter reading zero —
  // and because Pile renders a non-empty heap INSTEAD of the empty-zone slot, the
  // "discard is empty" affordance would never come back for the rest of the match.
  it('empties with the pile when the discard is recycled into the deck', () => {
    const log = [discardedEvent(7, 'attack-bug'), discardedEvent(9, 'protection-debugger')]
    const state = toBoardState(withDecks({ discardCount: 0, discardTop: undefined }), log, labels)
    expect(state.decks.discardHeap).toEqual([])
  })

  // …and it can shrink without emptying: Cherry-pick takes cards back out.
  it('never shows more cards than the pile says it holds', () => {
    const log = [
      discardedEvent(7, 'attack-bug'),
      discardedEvent(9, 'protection-debugger'),
      discardedEvent(11, 'attack-bug'),
    ]
    const heap =
      toBoardState(withDecks({ discardCount: 1, discardTop: 'attack-bug' }), log, labels).decks
        .discardHeap ?? []
    expect(heap).toHaveLength(1)
  })

  it('does not append a top the fold already ends on', () => {
    const log = [discardedEvent(7, 'attack-bug')]
    const heap =
      toBoardState(withDecks({ discardCount: 1, discardTop: 'attack-bug' }), log, labels).decks
        .discardHeap ?? []
    expect(heap).toHaveLength(1)
  })
})
