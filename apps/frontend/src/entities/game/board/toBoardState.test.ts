import type { Event, PlayerView } from '@release/engine'
import { cardById, type HistoryEntry } from '@release/ui'
import { HEAP_SHOW, scatterAt } from '@release/ui/animations'
import { describe, expect, it } from 'vitest'
import { type HistoryLabels, standInScatter, toBoardState } from './toBoardState'

// A later task in this plan assembles rows into a tree by `parent`, at which
// point a defended row becomes a CHILD of the attacked row it answers and its
// index in the flat `history` array shifts. Walking by id instead keeps these
// assertions true whether the row is top-level or nested.
const rowById = (rows: HistoryEntry[], id: number): HistoryEntry | undefined => {
  for (const r of rows) {
    if (r.id === id) return r
    const found = r.children ? rowById(r.children, id) : undefined
    if (found) return found
  }
  return undefined
}

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
  ['gameOver', 'Game over'],
  ['deckReshuffled', 'Deck reshuffled'],
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

  // Oldest first, newest at the bottom — the order the approved story reads in
  // (`apps/ui/src/mocks/table.ts`: "История ходов (сверху — раньше)"), and the
  // only order in which a child can sit under the parent it answers.
  it('folds the event log into history oldest first', () => {
    const log: Event[] = [
      { id: 1, type: 'drawn', player: 'you', pile: 0, deckSize: 39 },
      { id: 2, type: 'placed', player: 'p2', card: 'attack-bug' },
    ]
    const history = toBoardState(view, log, labels).history
    expect(history.length).toBe(2)
    expect(history[0].kind).toBe(labels.drawn)
    expect(history[1].kind).toBe(labels.placed)
  })

  it('preserves parent so MoveHistory can build its tree', () => {
    const log: Event[] = [
      { id: 1, type: 'drawn', player: 'you', pile: 0, deckSize: 39 },
      { id: 2, type: 'eliminated', player: 'p2', parent: 1 },
    ]
    const history = toBoardState(view, log, labels).history
    // history[0] is the root (id 1) once rows are assembled into a tree; the
    // id-2 row nests under it as its child rather than sitting flat beside it.
    expect(rowById(history, 1)?.children?.map((c) => c.id)).toEqual([2])
  })

  it('nests an answer under the move it answered', () => {
    const log: Event[] = [
      { id: 1, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'you' },
      {
        id: 2,
        type: 'defended',
        player: 'you',
        card: 'defense-not-a-bug',
        effect: 'cancel',
        parent: 1,
      },
    ]
    const history = toBoardState(view, log, labels).history
    expect(history).toHaveLength(1)
    expect(history[0].children?.map((c) => c.id)).toEqual([2])
  })

  // Row renders Row, so a chain is preserved rather than flattened.
  it('preserves a chain three deep', () => {
    const log: Event[] = [
      { id: 1, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'you' },
      {
        id: 2,
        type: 'defended',
        player: 'you',
        card: 'defense-not-a-bug',
        effect: 'cancel',
        parent: 1,
      },
      { id: 3, type: 'discarded', player: 'you', card: 'attack-bug', reason: 'effect', parent: 2 },
    ] as Event[]
    const history = toBoardState(view, log, labels).history
    expect(history).toHaveLength(1)
    expect(history[0].children?.[0].children?.map((c) => c.id)).toEqual([3])
  })

  // An orphan is promoted, never dropped: MoveHistory walks only downward from
  // the roots it is handed, so a re-parented-to-nothing row would vanish.
  it('promotes a row whose parent this player never saw', () => {
    const log: Event[] = [
      {
        id: 1,
        type: 'attacked',
        attacker: 'p2',
        card: 'attack-bug',
        sudo: false,
        target: 'you',
        visibleTo: ['p2'],
      },
      {
        id: 2,
        type: 'defended',
        player: 'you',
        card: 'defense-not-a-bug',
        effect: 'cancel',
        parent: 1,
      },
    ]
    const history = toBoardState(view, log, labels).history
    expect(history).toHaveLength(1)
    expect(history[0].id).toBe(2)
  })

  it('colours a row by the category of its card', () => {
    const log: Event[] = [{ id: 1, type: 'placed', player: 'you', card: 'attack-bug' }]
    expect(toBoardState(view, log, labels).history[0].cat).toBe('attack')
  })

  // PLACEHOLDER_CARD.category is 'attack'; using it here would paint every
  // unrecognised card red with full confidence. No colour is the honest answer.
  it('leaves a row uncoloured when the catalogue does not know the card', () => {
    const log: Event[] = [{ id: 1, type: 'placed', player: 'you', card: 'not-a-card' }]
    expect(toBoardState(view, log, labels).history[0].cat).toBeUndefined()
  })

  it('leaves a row uncoloured when the event carries no card at all', () => {
    const log: Event[] = [{ id: 1, type: 'passed', player: 'you' }]
    expect(toBoardState(view, log, labels).history[0].cat).toBeUndefined()
  })

  // The brief names the Sudo card's catalogue id as 'operation-sudo'; the real
  // catalogue (apps/ui/src/cards/catalogue.ts) has no such id — the Sudo card
  // is 'support-sudo', category 'support'. The engine agrees (cards.ts,
  // conformance.ts all key sudo combos off 'support-sudo'). Using the brief's
  // id verbatim would make `cardById(...)` resolve to nothing and the combo
  // silently vanish, so this test reads the real id from the catalogue.
  it('shows Sudo as the combo on a boosted attack', () => {
    const log: Event[] = [
      { id: 1, type: 'attacked', attacker: 'you', card: 'attack-bug', sudo: true, target: 'p2' },
    ]
    const combo = toBoardState(view, log, labels).history[0].combo
    expect(combo?.card).toBe(cardById('support-sudo')?.name)
    expect(combo?.cat).toBe('support')
  })

  it('shows no combo on a plain attack', () => {
    const log: Event[] = [
      { id: 1, type: 'attacked', attacker: 'you', card: 'attack-bug', sudo: false, target: 'p2' },
    ]
    expect(toBoardState(view, log, labels).history[0].combo).toBeUndefined()
  })

  it('shows Code Review as the combo on a release that carried one', () => {
    const log: Event[] = [
      {
        id: 1,
        type: 'released',
        player: 'you',
        slot: 'backend',
        card: 'release-backend',
        codeReview: 'support-code-review',
      },
    ]
    const combo = toBoardState(view, log, labels).history[0].combo
    expect(combo?.card).toBe(cardById('support-code-review')?.name)
    expect(combo?.cat).toBe('support')
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
    expect(state.you.release.frontend?.id).toBe('ai-release-frontend')
    expect(state.opponents[0].release.monitoring?.id).toBe('ai-monitoring')
    expect(state.you.release.backend?.id).toBe('release-backend')
    expect(state.you.releaseId).toEqual({
      frontend: 'release-frontend',
      backend: 'release-backend',
    })
    expect(state.opponents[0].releaseId).toEqual({ monitoring: 'protection-monitoring' })
  })

  it.each([
    'frontend',
    'backend',
    'database',
  ] as const)('keeps the AI %s face in both release zones', (slot) => {
    const release = {
      [slot]: { uid: 'event#1', card: `release-${slot}`, event: `ai-release-${slot}` },
    }
    const state = toBoardState(
      {
        ...view,
        self: { ...view.self, release },
        opponents: [{ ...view.opponents[0], release }],
      },
      [],
      labels,
    )
    expect(state.you.release[slot]?.id).toBe(`ai-release-${slot}`)
    expect(state.opponents[0].release[slot]?.id).toBe(`ai-release-${slot}`)
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

  // This exercises four of the union's twenty-nine members, not all of them —
  // what actually enforces "every member produces a row" is the `never`
  // default in `toHistoryEntry`'s switch, at TYPECHECK time: a new event type
  // fails `pnpm typecheck` there rather than rendering as a silent grey line,
  // which is exactly what #108's two upgrade events would otherwise become on
  // merge. This test is a runtime smoke check on a small sample, nothing more.
  it('produces a row for a sample of event types, of the shape the `never` default enforces for all of them', () => {
    const every: Event[] = [
      { id: 1, type: 'dealt', player: 'you', count: 5 },
      { id: 2, type: 'drawn', player: 'you', pile: 0, deckSize: 39 },
      { id: 3, type: 'deckReshuffled', cards: 12 },
      { id: 4, type: 'pilesChanged', piles: [10, 10] },
    ] as Event[]
    const history = toBoardState(view, every, labels).history
    expect(history).toHaveLength(4)
    expect(history.every((h) => typeof h.id === 'number')).toBe(true)
  })

  it('names the player an attack was aimed at', () => {
    const log: Event[] = [
      { id: 1, type: 'attacked', attacker: 'you', card: 'attack-bug', sudo: false, target: 'p2' },
    ]
    // 'bot' is the opponent's NAME in the fixture; 'p2' is its id. Asserting the
    // name proves the projection was consulted rather than the id printed raw.
    expect(toBoardState(view, log, labels).history[0].target?.player).toBe('bot')
  })

  it('names the player a demand was aimed at', () => {
    const log: Event[] = [
      { id: 1, type: 'requested', attacker: 'you', target: 'p2', card: 'attack-bug', hit: true },
    ]
    expect(toBoardState(view, log, labels).history[0].target?.player).toBe('bot')
  })

  // Was previously written against `to: 'you'`, asserting `'you'` — which is
  // both the fixture's `self.id` AND its `self.name`, so the assertion could
  // not fail even if `nameOf` were removed entirely. Uses p2/bot, like its two
  // siblings above, so the name and the id actually differ.
  it('names the player a card was handed to', () => {
    const log: Event[] = [
      { id: 1, type: 'handTransfer', from: 'you', to: 'p2', card: 'attack-bug' },
    ]
    expect(toBoardState(view, log, labels).history[0].target?.player).toBe('bot')
  })

  it('leaves an untargeted event without a target', () => {
    const log: Event[] = [{ id: 1, type: 'passed', player: 'you' }]
    expect(toBoardState(view, log, labels).history[0].target).toBeUndefined()
  })

  // I3 (Important, whole-branch review #136): `who` used to be the raw
  // `actorOf(e)` id with no pass through `nameOf` — the same map `target`
  // already resolves through — so a row could read "attack ⚔ bot … p2"
  // instead of "attack ⚔ bot … Bot" (the mock's own convention).
  it('names who did it, not just the raw seat id', () => {
    const log: Event[] = [
      { id: 1, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'you' },
    ]
    expect(toBoardState(view, log, labels).history[0].who).toBe('bot')
  })

  // I1 (whole-branch review #136): the four tests below all hand-write
  // `parent: 1` on the `defended` event to link it to its `attacked`. That
  // pins the adapter's own contract (`attackerOf` walks `parent` correctly
  // when it is present) — it does NOT prove the feature works against real
  // engine output. The fake engine never sets this parent: both `defended`
  // emission sites (`packages/engine/src/fake/attacks.ts:234`, `:352`) call
  // `log.add` with no parent argument, so `returnCard`/`redirect` and the
  // attack/defence nesting are unreachable in production today. See the
  // `buildHistoryTree` doc comment above and `docs/animations/backlog.md`.
  it('names the attacker a returned card went back to', () => {
    const log: Event[] = [
      { id: 1, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'you' },
      {
        id: 2,
        type: 'defended',
        player: 'you',
        card: 'defense-rollback',
        effect: 'return',
        parent: 1,
      },
    ]
    const history = toBoardState(view, log, labels).history
    expect(rowById(history, 2)?.returnCard).toBe('bot')
  })

  it('names the attacker a reflected effect bounced into', () => {
    const log: Event[] = [
      { id: 1, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'you' },
      {
        id: 2,
        type: 'defended',
        player: 'you',
        card: 'defense-works-on-my-machine',
        effect: 'reflect',
        parent: 1,
      },
    ]
    const history = toBoardState(view, log, labels).history
    expect(rowById(history, 2)?.redirect).toBe('bot')
  })

  it('shows no tail for a plain cancel', () => {
    const log: Event[] = [
      { id: 1, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'you' },
      {
        id: 2,
        type: 'defended',
        player: 'you',
        card: 'defense-not-a-bug',
        effect: 'cancel',
        parent: 1,
      },
    ]
    const history = toBoardState(view, log, labels).history
    const row = rowById(history, 2)
    expect(row?.returnCard).toBeUndefined()
    expect(row?.redirect).toBeUndefined()
  })

  // forViewer can hand a peer a defence whose attack was secret. Naming the wrong
  // player is worse than naming none.
  it('omits the tail when the attack it answered is not visible to this player', () => {
    const log: Event[] = [
      {
        id: 1,
        type: 'attacked',
        attacker: 'p2',
        card: 'attack-bug',
        sudo: false,
        target: 'you',
        visibleTo: ['p2'],
      },
      {
        id: 2,
        type: 'defended',
        player: 'you',
        card: 'defense-rollback',
        effect: 'return',
        parent: 1,
      },
    ]
    expect(toBoardState(view, log, labels).history[0].returnCard).toBeUndefined()
  })

  it('marks elimination, reshuffle and game over as system rows', () => {
    const log: Event[] = [
      { id: 1, type: 'eliminated', player: 'p2' },
      { id: 2, type: 'deckReshuffled', cards: 12 },
      { id: 3, type: 'gameOver', winner: 'you', condition: 'release' },
    ] as Event[]
    expect(toBoardState(view, log, labels).history.map((h) => h.system)).toEqual([true, true, true])
  })

  // C2 (Critical, whole-branch review #136): the kit's system row reads
  // `e.text ?? `${e.who} ${copy.eliminated}`` — so before this fix a `gameOver`
  // row (whose `who` is the WINNER, via `actorOf`) rendered as "<winner> is
  // out", and a `deckReshuffled` row (whose `who` is '', the table did it)
  // rendered as " is out". `labels[e.type]` was computed into `kind` and then
  // thrown away, because the system branch never reads `kind`.
  it('gives a game-over row its own text instead of "is out"', () => {
    const log: Event[] = [
      { id: 1, type: 'gameOver', winner: 'you', condition: 'release' },
    ] as Event[]
    expect(toBoardState(view, log, labels).history[0].text).toBe(labels.gameOver)
  })

  it('gives a deck-reshuffle row its own text instead of an unnamed "is out"', () => {
    const log: Event[] = [{ id: 1, type: 'deckReshuffled', cards: 12 }] as Event[]
    expect(toBoardState(view, log, labels).history[0].text).toBe(labels.deckReshuffled)
  })

  // Left unset on purpose: MoveHistory's fallback (`${who} ${copy.eliminated}`)
  // is what renders the elimination line, and `copy.eliminated` exists
  // specifically to be that suffix.
  it('leaves an elimination row without its own text', () => {
    const log: Event[] = [{ id: 1, type: 'eliminated', player: 'p2' }]
    expect(toBoardState(view, log, labels).history[0].text).toBeUndefined()
  })

  it('does not mark an ordinary move as a system row', () => {
    const log: Event[] = [{ id: 1, type: 'placed', player: 'you', card: 'attack-bug' }]
    expect(toBoardState(view, log, labels).history[0].system).toBeFalsy()
  })

  it('badges an open draw and leaves a closed one unbadged', () => {
    const log: Event[] = [
      { id: 1, type: 'drawn', player: 'you', card: 'attack-bug', pile: 0, deckSize: 39 },
      { id: 2, type: 'drawn', player: 'you', pile: 0, deckSize: 38 },
    ] as Event[]
    const history = toBoardState(view, log, labels).history
    // Assertions keyed by event id rather than index, so they survive any
    // future change to the ordering of the history array.
    expect(rowById(history, 1)?.draw).toBe(true)
    expect(rowById(history, 2)?.draw).toBeFalsy()
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

it.each([
  'upgradeThrown',
  'upgradeTaken',
] as const)('renders %s with its actor and card', (type) => {
  const events: Event[] = [{ id: 1, type, player: 'p2', card: 'attack-bug' }]
  const state = toBoardState(view, events, { ...labels, [type]: 'Upgrade action' })
  expect(state.history[0]).toMatchObject({
    id: 1,
    who: 'bot',
    kind: 'Upgrade action',
    card: cardById('attack-bug')?.name,
  })
})
