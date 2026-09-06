import type { Event } from '@release/engine'
import { cardById } from '@release/ui'
import { scatterAt } from '@release/ui/animations'
import { describe, expect, it } from 'vitest'
import type { BoardState } from '~/entities/game/board'
import { standInScatter } from '~/entities/game/board'
import type { BeatPlan } from './planBeats'
import { classifyPiles, planBeats } from './planBeats'

const card = (id: string) =>
  cardById(id) ?? { id, name: id, category: 'attack', deck: 'base', art: '', tags: [], qty: 0 }

const boardBefore = (over: Partial<BoardState> = {}): BoardState =>
  ({
    you: {
      name: 'You',
      hand: [
        { uid: 'u1', card: card('attack-bug') },
        { uid: 'u2', card: card('protection-debugger') },
      ],
      release: { frontend: card('release-frontend') },
    },
    opponents: [
      { id: 'p2', name: 'Two', handCount: 3, release: { backend: card('release-backend') } },
    ],
    decks: { main: [10], events: 5, discardCount: 0 },
    selfId: 'p1',
    history: [],
    setup: {},
    playable: [],
    frozen: [],
    ...over,
  }) as BoardState

const discarded = (id: number, over: Partial<Extract<Event, { type: 'discarded' }>> = {}): Event =>
  ({ id, type: 'discarded', player: 'p1', card: 'attack-bug', reason: 'effect', ...over }) as Event

const attacked = (over: Partial<Extract<Event, { type: 'attacked' }>> & { id: number }): Event =>
  ({
    type: 'attacked',
    attacker: 'p1',
    card: 'attack-bug',
    sudo: false,
    target: 'p2',
    ...over,
  }) as Event

const released = (over: Partial<Extract<Event, { type: 'released' }>> & { id: number }): Event =>
  ({ type: 'released', player: 'p1', slot: 'frontend', card: 'release-frontend', ...over }) as Event

const tookHit = (over: Partial<Extract<Event, { type: 'tookHit' }>> & { id: number }): Event =>
  ({ type: 'tookHit', player: 'p1', ...over }) as Event

const defended = (over: Partial<Extract<Event, { type: 'defended' }>> & { id: number }): Event =>
  ({ type: 'defended', player: 'p1', card: 'defense-hotfix', effect: 'cancel', ...over }) as Event

// The pending a resolving `defended`/`tookHit` sees on screen: `before` still
// carries it, because the resolution hasn't happened yet as far as the board
// shown before this batch is concerned (I1).
type DefendPending = Extract<NonNullable<BoardState['pending']>, { kind: 'defend' }>
const defendPending = (over: Partial<DefendPending> = {}): DefendPending =>
  ({
    kind: 'defend',
    player: 'p1',
    attacker: 'p2',
    attackCard: 'attack-bug',
    sudo: true,
    options: [],
    openedAt: 0,
    deadline: 0,
    scope: 'hand',
    ...over,
  }) as DefendPending

describe('planBeats', () => {
  it('yields nothing for a batch with no choreography', () => {
    const events: Event[] = [
      { id: 1, type: 'turnStarted', player: 'p1', index: 0 },
      { id: 2, type: 'passed', player: 'p1' },
    ]
    expect(planBeats(events, boardBefore())).toEqual([])
  })

  it('flies the player’s own discard from its slot in the fan', () => {
    const [beat] = planBeats([discarded(4)], boardBefore())
    expect(beat.kind === 'discard' && beat.cards).toEqual([
      { key: 'd4', eventId: 4, card: 'attack-bug', source: { kind: 'hand', index: 0 } },
    ])
  })

  // The step's own rule: cards leave one by one but ALL AT ONCE.
  it('puts every discard of one batch in a single beat', () => {
    const events = [
      discarded(4, { reason: 'effect' }),
      discarded(5, { card: 'protection-debugger', reason: 'effect' }),
    ]
    const beats = planBeats(events, boardBefore())
    expect(beats).toHaveLength(1)
    const [beat] = beats
    expect(beat.kind === 'discard' && beat.cards.map((c) => c.key)).toEqual(['d4', 'd5'])
    expect(beat.key).toBe('discard:4')
  })

  // The excess leaves as one gesture, and NOT as an ordinary discard: on the
  // actor's own board those cards are standing in the grid at the centre, and
  // the grid is what the beat flies out (#104).
  it('gives a hand-limit discard its own beat, keyed by its first card', () => {
    const beats = planBeats(
      [
        discarded(4, { reason: 'handLimit' }),
        discarded(5, { card: 'protection-debugger', reason: 'handLimit' }),
      ],
      boardBefore(),
    )
    expect(beats).toHaveLength(1)
    const [beat] = beats
    expect(beat.kind).toBe('handLimit')
    expect(beat.key).toBe('handLimit:4')
    expect(beat.kind === 'handLimit' && beat.player).toBe('p1')
    expect(beat.kind === 'handLimit' && beat.cards.map((c) => c.key)).toEqual(['d4', 'd5'])
  })

  it('never folds a hand-limit discard together with an ordinary one', () => {
    const beats = planBeats(
      [
        discarded(4, { reason: 'effect' }),
        discarded(5, { card: 'protection-debugger', reason: 'handLimit' }),
      ],
      boardBefore(),
    )
    expect(beats.map((b) => b.kind)).toEqual(['discard', 'handLimit'])
  })

  // Two players over the limit in one relayed batch: one grid each, or the
  // second player's cards would fly into the first player's grid.
  it('closes the run when a second player pays the same price', () => {
    const beats = planBeats(
      [
        discarded(4, { reason: 'handLimit' }),
        discarded(5, { player: 'p2', card: 'attack-bug', reason: 'handLimit' }),
      ],
      boardBefore(),
    )
    expect(beats.map((b) => b.kind)).toEqual(['handLimit', 'handLimit'])
    expect(beats[1].kind === 'handLimit' && beats[1].player).toBe('p2')
  })

  // Bad Vibe-Coding raises the same pending mid-turn with `endsTurn: false`
  // (packages/engine/src/fake/triggers.ts) — one card, no turn boundary behind
  // it, and the identical beat.
  it('plans the mid-turn single-card case exactly the same way', () => {
    const beats = planBeats([discarded(9, { reason: 'handLimit' })], boardBefore())
    expect(beats.map((b) => b.kind)).toEqual(['handLimit'])
    expect(beats[0].kind === 'handLimit' && beats[0].cards).toHaveLength(1)
  })

  // The road home (#106): Bad Vibe-Coding raises its prompt as a `handLimit`
  // pending with its own `source` (fake/triggers.ts:419) — the discard that
  // answers it is where the card goes.
  it('sends a Bad Vibe-Coding card home on the discard that pays its price', () => {
    const beats = planBeats(
      [discarded(9, { reason: 'handLimit' })],
      boardBefore({
        pending: {
          kind: 'handLimit',
          player: 'p1',
          excess: 1,
          options: [],
          source: 'ai-bad-vibe-coding',
        },
      } as Partial<BoardState>),
    )
    expect(beats[0]).toMatchObject({ homeward: 'ai-bad-vibe-coding' })
  })

  // DECISION 6 HAS TO REACH THE BEAT (#106). `_useHandLimit`'s own `aiPicked`
  // render exists only on the DISCARDER's board; every other peer builds the
  // grid from computed boxes, so unless the plan says which shape this run is,
  // Bad Vibe's one card gathers at `gridCells(1)`'s `dx 0` — underneath the AI
  // card standing at `effect`.
  it('marks a Bad Vibe-Coding run as the picked place, not the grid', () => {
    const beats = planBeats(
      [discarded(9, { reason: 'handLimit' })],
      boardBefore({
        pending: {
          kind: 'handLimit',
          player: 'p1',
          excess: 1,
          options: [],
          source: 'ai-bad-vibe-coding',
        },
      } as Partial<BoardState>),
    )
    expect(beats[0]).toMatchObject({ kind: 'handLimit', picked: true })
  })

  it('leaves an ordinary turn’s-end run to the grid', () => {
    // No pending is open when a turn ends, so nothing marks the shape — the
    // contrast that makes the assertion above mean something.
    const beats = planBeats([discarded(9, { reason: 'handLimit' })], boardBefore())
    expect(beats[0].kind).toBe('handLimit')
    expect(beats[0]).not.toHaveProperty('picked')
  })

  it('claims each hand slot once when two copies of a card go out together', () => {
    const state = boardBefore({
      you: {
        name: 'You',
        hand: [
          { uid: 'u1', card: card('attack-bug') },
          { uid: 'u2', card: card('attack-bug') },
        ],
        release: {},
      },
    } as Partial<BoardState>)
    const [beat] = planBeats([discarded(4), discarded(5)], state)
    expect(beat.kind === 'discard' && beat.cards.map((c) => c.source)).toEqual([
      { kind: 'hand', index: 0 },
      { kind: 'hand', index: 1 },
    ])
  })

  it('flies a destroyed card out of the release slot it stood in', () => {
    const [beat] = planBeats(
      [discarded(4, { card: 'release-frontend', reason: 'destroyed' })],
      boardBefore(),
    )
    expect(beat.kind === 'discard' && beat.cards[0].source).toEqual({
      kind: 'release',
      player: 'p1',
      slot: 'frontend',
    })
  })

  // `neutralized` has TWO producers and they are not the same movement: a
  // sacrifice takes a release out of the zone, but a Debugger answering a 503 is
  // played from the HAND and never touches the zone — and that is the commoner of
  // the two. Treating the reason as decisive left it with no source at all, so it
  // never animated. The reason narrows where to look first; it does not decide.
  it('falls through to the hand when a neutralized card was never in the zone', () => {
    const [beat] = planBeats(
      [discarded(4, { card: 'protection-debugger', reason: 'neutralized' })],
      boardBefore(),
    )
    expect(beat.kind === 'discard' && beat.cards[0].source).toEqual({ kind: 'hand', index: 1 })
  })

  it('flies an opponent’s destroyed release out of their own slot', () => {
    const [beat] = planBeats(
      [discarded(4, { player: 'p2', card: 'release-backend', reason: 'destroyed' })],
      boardBefore(),
    )
    expect(beat.kind === 'discard' && beat.cards[0].source).toEqual({
      kind: 'release',
      player: 'p2',
      slot: 'backend',
    })
  })

  it('flies an opponent’s hand discard from their seat', () => {
    const [beat] = planBeats([discarded(4, { player: 'p2' })], boardBefore())
    expect(beat.kind === 'discard' && beat.cards[0].source).toEqual({ kind: 'seat', player: 'p2' })
  })

  // THE UNDECIDED CASE. The rule for a beat whose target is already gone is not
  // settled (docs/animations/backlog.md), so nothing is invented here: a card
  // with no source is simply not flown, exactly like an event with no
  // choreography at all. It still reaches the discard, because the projection
  // puts it there — the animation is what is skipped, never the outcome.
  it('drops a card whose source is not on the board, rather than guessing one', () => {
    const beats = planBeats([discarded(4, { card: 'attack-ddos' })], boardBefore())
    expect(beats).toEqual([])
  })

  it('keeps the cards it can aim when one of a batch has no source', () => {
    const [beat] = planBeats(
      [discarded(4, { card: 'attack-ddos' }), discarded(5, { card: 'attack-bug' })],
      boardBefore(),
    )
    expect(beat.kind === 'discard' && beat.cards.map((c) => c.key)).toEqual(['d5'])
  })
})

const drawn = (id: number, over: Partial<Extract<Event, { type: 'drawn' }>> = {}): Event =>
  ({ id, type: 'drawn', player: 'p1', card: 'attack-bug', pile: 0, deckSize: 39, ...over }) as Event

describe('planBeats — the draw', () => {
  it('reads my own draw off the card the event still carries', () => {
    const [beat] = planBeats([drawn(4)], boardBefore())
    expect(beat).toMatchObject({ kind: 'draw' })
    expect(beat.kind === 'draw' && beat.draws[0]).toMatchObject({
      eventId: 4,
      pile: 0,
      mine: true,
      card: 'attack-bug',
    })
  })

  // The redaction leaves the event and takes the card. That, and only that, is
  // what tells an onlooker's draw apart from a trigger.
  it('reads an opponent’s draw as a face-down flight to their seat', () => {
    const [beat] = planBeats([drawn(4, { player: 'p2', card: undefined })], boardBefore())
    expect(beat.kind === 'draw' && beat.draws[0]).toMatchObject({
      player: 'p2',
      mine: false,
      card: undefined,
      reveal: undefined,
    })
  })

  it('names a trigger from the reveal that follows it', () => {
    const events: Event[] = [
      drawn(4, { card: undefined }),
      { id: 5, type: 'revealed', player: 'p1', card: 'trigger-error-503' } as Event,
      discarded(6, { card: 'trigger-error-503', reason: 'trigger' }),
    ]
    const beats = planBeats(events, boardBefore())
    expect(beats).toHaveLength(1)
    expect(beats[0].kind === 'draw' && beats[0].draws[0].reveal).toEqual({
      card: 'trigger-error-503',
      discardId: 6,
    })
  })

  // AN AI TRIGGER IS NOT A DRAW (#106). Its card-less `drawn` is claimed whole
  // by the `aiEvent` plan, from the pile onward, so the draw plan never sees
  // it at all — see the `aiEvent` describe block below for the full shape.
  it('claims an AI trigger whole rather than leaving it to the draw', () => {
    const events: Event[] = [
      drawn(4, { card: undefined }),
      { id: 5, type: 'aiRevealed', player: 'p1', aiCard: 'trigger-ai', eventCard: 'ai-x' } as Event,
      discarded(6, { card: 'trigger-ai', reason: 'trigger' }),
    ]
    const beats = planBeats(events, boardBefore())
    expect(beats.map((b) => b.kind)).toEqual(['aiEvent'])
  })

  // Task 1 stopped banking a 503 at reveal — it is held on the pending until
  // answered — so the reveal can arrive with nothing behind it at all.
  it('plans a revealed trigger that stands, with no discard of its own', () => {
    const events: Event[] = [
      drawn(4, { card: undefined }),
      { id: 5, type: 'revealed', player: 'p1', card: 'trigger-error-503' } as Event,
    ]
    const beats = planBeats(events, boardBefore())
    expect(beats).toHaveLength(1)
    expect(beats[0].kind === 'draw' && beats[0].draws[0].reveal).toEqual({
      card: 'trigger-error-503',
    })
  })

  it('still plans a revealed trigger that files itself, with its discard id', () => {
    const events: Event[] = [
      drawn(4, { card: undefined }),
      { id: 5, type: 'revealed', player: 'p1', card: 'trigger-error-503' } as Event,
      discarded(6, { card: 'trigger-error-503', reason: 'trigger' }),
    ]
    const beats = planBeats(events, boardBefore())
    expect(beats[0].kind === 'draw' && beats[0].draws[0].reveal).toEqual({
      card: 'trigger-error-503',
      discardId: 6,
    })
    // and it is claimed, so the discard planner does not fly it a second time
    expect(beats.filter((b) => b.kind === 'discard')).toEqual([])
  })

  it('puts a multi-draw in one beat, in the order it was drawn', () => {
    const beats = planBeats([drawn(4), drawn(5, { pile: 1 })], boardBefore())
    expect(beats).toHaveLength(1)
    expect(beats[0].kind === 'draw' && beats[0].draws.map((d) => d.pile)).toEqual([0, 1])
  })
})

describe('planBeats — order', () => {
  // The refill happens INSIDE the draw sequence, before the card is taken
  // (fake/reduce.ts:88). A queue that played these the other way round would
  // show a card drawn from a pile that has not been rebuilt yet.
  it('rebuilds the deck before the draw it made possible', () => {
    const events: Event[] = [
      { id: 3, type: 'deckReshuffled', cards: 12 } as Event,
      drawn(4),
      { id: 5, type: 'pilesChanged', piles: [11] } as Event,
    ]
    const beats = planBeats(
      events,
      boardBefore({ decks: { main: [0], events: 5, discardCount: 12 } } as Partial<BoardState>),
    )
    expect(beats.map((b) => b.kind)).toEqual(['reshuffle', 'draw'])
  })

  // A run coalesces; it does not reach across something else. Two discards on
  // either side of a draw are two gestures, because that is what happened.
  it('does not let a discard run swallow one on the far side of a draw', () => {
    const events = [discarded(4), drawn(5), discarded(6, { card: 'protection-debugger' })]
    const beats = planBeats(events, boardBefore())
    expect(beats.map((b) => b.kind)).toEqual(['discard', 'draw', 'discard'])
  })

  // A batch can span more than one engine action (useBeats.ts) — a run of one
  // kind must not reach across an unrelated event that carries no choreography
  // of its own. Two draws either side of a turn boundary are two gestures, not
  // one just because nothing visible happened in between.
  it('does not let a draw run swallow one on the far side of an unrelated event', () => {
    const events: Event[] = [
      drawn(4),
      { id: 5, type: 'turnEnded', player: 'p1' } as Event,
      drawn(6),
    ]
    const beats = planBeats(events, boardBefore())
    expect(beats.map((b) => b.kind)).toEqual(['draw', 'draw'])
  })

  it('does not let a discard run swallow one on the far side of an unrelated event', () => {
    const events = [
      discarded(4),
      { id: 5, type: 'turnEnded', player: 'p1' } as Event,
      discarded(6, { card: 'protection-debugger' }),
    ]
    const beats = planBeats(events, boardBefore())
    expect(beats.map((b) => b.kind)).toEqual(['discard', 'discard'])
  })
})

describe('planBeats — the combo pair (#100)', () => {
  it('an attacked event plans an attackPlaced beat, sudo or not', () => {
    const plans = planBeats(
      [attacked({ id: 5, attacker: 'p2', card: 'attack-bug', sudo: true, target: 'p1' })],
      boardBefore(),
    )
    expect(plans).toEqual([
      {
        kind: 'attackPlaced',
        key: 'attack:5',
        eventId: 5,
        attacker: 'p2',
        card: 'attack-bug',
        sudo: true,
        // carried since #101, Fix C: the runner needs to know whether the
        // answer is ours before it may publish a shadow saying one is owed
        target: 'p1',
      },
    ])
  })

  it('a released with codeReview plans a releasePlaced beat', () => {
    const withReview = planBeats(
      [
        released({
          id: 7,
          player: 'p1',
          slot: 'frontend',
          card: 'release-frontend',
          codeReview: 'support-code-review',
        }),
      ],
      boardBefore(),
    )
    expect(withReview).toEqual([
      {
        kind: 'releasePlaced',
        key: 'release:7',
        eventId: 7,
        player: 'p1',
        slot: 'frontend',
        card: 'release-frontend',
        codeReview: 'support-code-review',
      },
    ])
  })

  it('plans a beat for a plain release too, and links the cost that paid for it', () => {
    const plans = planBeats(
      [
        discarded(6, { card: 'attack-bug', reason: 'releaseCost' }),
        released({ id: 7, player: 'p1', slot: 'frontend', card: 'release-frontend' }),
      ],
      boardBefore(),
    )
    expect(plans).toEqual([
      {
        kind: 'releasePlaced',
        key: 'release:7',
        eventId: 7,
        player: 'p1',
        slot: 'frontend',
        card: 'release-frontend',
        cost: { eventId: 6, card: 'attack-bug' },
      },
    ])
  })

  it('does not let the discard beat fly the cost a second time', () => {
    // the cost belongs to the release beat: it is shown open at the centre and
    // leaves from there, not from the hand slot it had already left
    const plans = planBeats(
      [
        discarded(6, { card: 'attack-bug', reason: 'releaseCost' }),
        released({ id: 7, card: 'release-frontend' }),
      ],
      boardBefore(),
    )
    expect(plans.some((p) => p.kind === 'discard')).toBe(false)
  })

  it('plans a release with no cost in easy mode', () => {
    const plans = planBeats([released({ id: 7, card: 'release-frontend' })], boardBefore())
    expect(plans).toEqual([
      {
        kind: 'releasePlaced',
        key: 'release:7',
        eventId: 7,
        player: 'p1',
        slot: 'frontend',
        card: 'release-frontend',
      },
    ])
  })

  it('keeps carrying the Code Review of a comboed release', () => {
    const plans = planBeats(
      [released({ id: 7, card: 'release-frontend', codeReview: 'support-code-review' })],
      boardBefore(),
    )
    expect(plans[0]).toMatchObject({ kind: 'releasePlaced', codeReview: 'support-code-review' })
  })

  it('does not claim an unrelated discard sitting before a release', () => {
    // only `releaseCost` is the cost. A hand-limit discard that happens to
    // precede a release is its own gesture and keeps its own beat.
    const plans = planBeats(
      [
        discarded(6, { card: 'attack-bug', reason: 'handLimit' }),
        released({ id: 7, card: 'release-frontend' }),
      ],
      boardBefore(),
    )
    expect(plans.map((p) => p.kind)).toEqual(['handLimit', 'releasePlaced'])
  })

  it('resolution discards of the pending pair take the pair exit, others keep the discard beat', () => {
    const withPending = boardBefore({ pending: defendPending() } as Partial<BoardState>)
    const events = [
      tookHit({ id: 9 }),
      discarded(10, { player: 'p2', card: 'attack-bug', reason: 'attackSpent' }),
      discarded(11, { player: 'p2', card: 'support-sudo', reason: 'attackSpent' }),
    ]
    const plans = planBeats(events, withPending)
    expect(plans).toEqual([
      {
        kind: 'pairToDiscard',
        key: 'pairOut:10',
        main: { eventId: 10, card: 'attack-bug' },
        aux: { eventId: 11, card: 'support-sudo' },
      },
    ])
  })

  // sudo:false → pending carries no sudo half at all, so there is only ONE
  // discard to route — and it still goes through pairToDiscard, not the
  // ordinary discard beat: the centre card is what flies, and sourceOf could
  // never find it (it is in no hand and no zone).
  it('a plain attack resolution routes its one discard through pairToDiscard too', () => {
    const withPending = boardBefore({
      pending: defendPending({ sudo: false }),
    } as Partial<BoardState>)
    const events = [
      tookHit({ id: 9 }),
      discarded(10, { player: 'p2', card: 'attack-bug', reason: 'attackSpent' }),
    ]
    const plans = planBeats(events, withPending)
    expect(plans).toEqual([
      { kind: 'pairToDiscard', key: 'pairOut:10', main: { eventId: 10, card: 'attack-bug' } },
    ])
  })

  // Rollback gives the attack card back to the attacker's hand instead of
  // discarding it (fake/attacks.ts's `effect === 'return'` branch), so only
  // the sudo half is banked — the pending still names `attackCard`, but no
  // `discarded` for it ever arrives. The sudo match must not require a
  // `pairToDiscard` to already exist, or this half would have nothing to join.
  it('rollback return: only the sudo half flies out', () => {
    const withPending = boardBefore({ pending: defendPending() } as Partial<BoardState>)
    const events = [discarded(10, { player: 'p2', card: 'support-sudo', reason: 'attackSpent' })]
    const plans = planBeats(events, withPending)
    expect(plans).toEqual([
      { kind: 'pairToDiscard', key: 'pairOut:10', aux: { eventId: 10, card: 'support-sudo' } },
    ])
  })

  // Rollback is itself sudo-capable: a DEFENDER can combo their OWN
  // `support-sudo` onto a Rollback defence. The engine banks that group
  // (`defenceSpent`) BEFORE the attacker's group (`attackSpent`) — the
  // reverse of every other resolution — so the batch carries TWO
  // `support-sudo` discards with different reasons and players. Only the
  // `attackSpent` one (the attacker's own combo, the pending's real other
  // half) may ride the pair exit; the defender's `defenceSpent` one is an
  // ordinary discard, same as their Rollback card.
  it('a defender’s own sudo combo on a Rollback does not steal the pending pair’s aux slot', () => {
    // The LOCAL player (p1) is the attacker here — its sudo card left its own
    // hand back when the attack was thrown, so `sourceOf` finds nothing for
    // it if this ever falls through to the ordinary discard path (the
    // silent-vanish failure mode this test pins).
    const withPending = boardBefore({
      pending: defendPending({ player: 'p2', attacker: 'p1' }),
    } as Partial<BoardState>)
    const events = [
      discarded(9, { player: 'p2', card: 'defense-rollback', reason: 'defenceSpent' }),
      discarded(10, { player: 'p2', card: 'support-sudo', reason: 'defenceSpent' }),
      discarded(11, { player: 'p1', card: 'support-sudo', reason: 'attackSpent' }),
    ]
    const plans = planBeats(events, withPending)
    expect(plans).toEqual([
      {
        kind: 'discard',
        key: 'discard:9',
        cards: [
          {
            key: 'd9',
            eventId: 9,
            card: 'defense-rollback',
            source: { kind: 'seat', player: 'p2' },
          },
          { key: 'd10', eventId: 10, card: 'support-sudo', source: { kind: 'seat', player: 'p2' } },
        ],
      },
      { kind: 'pairToDiscard', key: 'pairOut:11', aux: { eventId: 11, card: 'support-sudo' } },
    ])
  })
})

describe('planBeats — the answer to an attack (#101)', () => {
  const pending = () =>
    boardBefore({
      pending: defendPending({ scope: 'release', sudo: false }),
    } as Partial<BoardState>)

  it('plans one exchange for a cancelling defence and claims both spent cards', () => {
    const plans = planBeats(
      [
        defended({ id: 12, player: 'p1', card: 'defense-hotfix', effect: 'cancel' }),
        discarded(13, { player: 'p2', card: 'attack-bug', reason: 'attackSpent' }),
        discarded(14, { player: 'p1', card: 'defense-hotfix', reason: 'defenceSpent' }),
      ],
      pending(),
    )
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      kind: 'covered',
      key: 'covered:12',
      defender: 'p1',
      card: 'defense-hotfix',
      effect: 'cancel',
      attacker: 'p2',
      attackCard: 'attack-bug',
      spent: [
        { eventId: 13, card: 'attack-bug' },
        { eventId: 14, card: 'defense-hotfix' },
      ],
    })
  })

  // ===== MISSING FIXTURE 3 (#101, Fix C, finding 4) — ONE SYNC FLUSH =====
  //
  // Nothing in the suite ever planned a batch in which the attack and its
  // answer arrive together, so nothing noticed that `before.pending` — the
  // board as it stood BEFORE the batch — is the only thing this planner asks
  // about what is standing at the centre. In a star topology that batch is
  // the NORM rather than an edge case: every peer that is neither attacker
  // nor defender gets both events in one relayed sync, so the defence
  // animation this branch exists to build was missing for spectators, which
  // is most of the table in a 3+ player game. The spent cards simply appeared
  // in the heap with no cover ever shown.
  //
  // The planner already tracks a table fact through a batch this way: `piles`
  // starts at `before.decks.main` and every `pilesChanged` moves it on. The
  // attack standing at the centre is the same kind of fact.
  it('plans the exchange when the attack and its answer arrive in one batch', () => {
    const plans = planBeats(
      [
        attacked({ id: 11, attacker: 'p2', card: 'attack-bug', sudo: false, target: 'p1' }),
        defended({ id: 12, player: 'p1', card: 'defense-hotfix', effect: 'cancel' }),
        discarded(13, { player: 'p2', card: 'attack-bug', reason: 'attackSpent' }),
        discarded(14, { player: 'p1', card: 'defense-hotfix', reason: 'defenceSpent' }),
      ],
      // no pending on screen yet — this peer is seeing the attack for the
      // first time in the same flush that resolves it
      boardBefore(),
    )
    expect(plans.map((p) => p.kind)).toEqual(['attackPlaced', 'covered'])
    expect(plans[1]).toMatchObject({
      kind: 'covered',
      key: 'covered:12',
      defender: 'p1',
      attacker: 'p2',
      attackCard: 'attack-bug',
      attackSudo: false,
      spent: [
        { eventId: 13, card: 'attack-bug' },
        { eventId: 14, card: 'defense-hotfix' },
      ],
    })
  })

  // The same flush, the other resolution: nobody defends. The attack card and
  // the sudo that backed it leave the CENTRE as a pair — `sourceOf` could
  // never find them (no hand, no zone), so `pairToDiscard` is the only thing
  // that flies them, and it too was keyed off `before.pending`.
  it('splits the pending pair when the attack and the hit arrive in one batch', () => {
    const plans = planBeats(
      [
        attacked({ id: 11, attacker: 'p2', card: 'attack-bug', sudo: true, target: 'p1' }),
        tookHit({ id: 12, player: 'p1' }),
        discarded(13, { player: 'p2', card: 'attack-bug', reason: 'attackSpent' }),
        discarded(14, { player: 'p2', card: 'support-sudo', reason: 'attackSpent' }),
      ],
      boardBefore(),
    )
    expect(plans.map((p) => p.kind)).toEqual(['attackPlaced', 'pairToDiscard'])
    expect(plans[1]).toMatchObject({
      kind: 'pairToDiscard',
      main: { eventId: 13, card: 'attack-bug' },
      aux: { eventId: 14, card: 'support-sudo' },
    })
  })

  it('sends a plain Rollback’s attack back to the attacker and never banks it', () => {
    const plans = planBeats(
      [
        defended({ id: 12, player: 'p1', card: 'defense-rollback', effect: 'return' }),
        discarded(14, { player: 'p1', card: 'defense-rollback', reason: 'defenceSpent' }),
      ],
      pending(),
    )
    expect(plans[0]).toMatchObject({
      kind: 'covered',
      effect: 'return',
      returnTo: 'p2',
      spent: [{ eventId: 14, card: 'defense-rollback' }],
    })
  })

  it('keeps a sudo Rollback’s attack for the defender', () => {
    // `attacks.ts:247` — recipient = sudoDefence ? the defender : the attacker.
    // The engine records the defender's sudo as a `defenceSpent` discard of
    // `support-sudo`, and that is the only signal the return changed hands.
    const plans = planBeats(
      [
        defended({ id: 12, player: 'p1', card: 'defense-rollback', effect: 'return' }),
        discarded(14, { player: 'p1', card: 'defense-rollback', reason: 'defenceSpent' }),
        discarded(15, { player: 'p1', card: 'support-sudo', reason: 'defenceSpent' }),
      ],
      pending(),
    )
    expect(plans[0]).toMatchObject({ effect: 'return', returnTo: 'p1', sudo: 'support-sudo' })
  })

  it('returns a sudo-backed attack to the attacker when the Rollback was plain', () => {
    const plans = planBeats(
      [
        defended({ id: 12, player: 'p1', card: 'defense-rollback', effect: 'return' }),
        discarded(13, { player: 'p2', card: 'support-sudo', reason: 'attackSpent' }),
        discarded(14, { player: 'p1', card: 'defense-rollback', reason: 'defenceSpent' }),
      ],
      boardBefore({
        pending: defendPending({ scope: 'release', sudo: true }),
      } as Partial<BoardState>),
    )
    // the sudo in this exchange is the ATTACKER's, so the defender comboed
    // nothing and the attack goes home to them
    expect(plans[0]).toMatchObject({ effect: 'return', returnTo: 'p2', sudo: undefined })
  })

  it('carries the attack’s own sudo so the exchange leaves as the pair it was', () => {
    const plans = planBeats(
      [
        defended({ id: 12, player: 'p1', card: 'defense-hotfix', effect: 'cancel' }),
        discarded(13, { player: 'p2', card: 'attack-bug', reason: 'attackSpent' }),
        discarded(14, { player: 'p2', card: 'support-sudo', reason: 'attackSpent' }),
        discarded(15, { player: 'p1', card: 'defense-hotfix', reason: 'defenceSpent' }),
      ],
      boardBefore({
        pending: defendPending({ scope: 'release', sudo: true }),
      } as Partial<BoardState>),
    )
    expect(plans[0]).toMatchObject({ kind: 'covered', attackSudo: true })
    expect((plans[0] as { spent: unknown[] }).spent).toHaveLength(3)
  })

  it('plans no movement for the events that are only a change of state', () => {
    // The window opening and closing, a pass, a hit taken, a monitoring
    // destroyed — these are things the projection SHOWS (the dock, the ring,
    // the badges), not things that fly. Planning nothing is the default and is
    // pinned here on purpose: the alternative is inventing choreography, which
    // this project sends to the backlog instead.
    const plans = planBeats(
      [
        { id: 30, type: 'windowOpened', player: 'p1', slot: 'frontend', round: 1, deadline: 0 },
        { id: 31, type: 'passed', player: 'p2' },
        { id: 32, type: 'unpassed', player: 'p2' },
        { id: 33, type: 'windowClosed', player: 'p1', slot: 'frontend' },
      ] as Event[],
      boardBefore(),
    )
    expect(plans).toEqual([])
  })

  it('leaves the take-hit resolution to the pair exit it already had', () => {
    const plans = planBeats(
      [
        tookHit({ id: 9 }),
        discarded(10, { player: 'p2', card: 'attack-bug', reason: 'attackSpent' }),
      ],
      boardBefore({ pending: defendPending({ scope: 'release' }) } as Partial<BoardState>),
    )
    expect(plans.map((p) => p.kind)).toEqual(['pairToDiscard'])
  })

  // Security Bug: the release beaten by the attack is not destroyed — it is
  // TAKEN, into the attacker's own zone. `attacks.test.ts`'s own
  // "opens a fresh window on the stolen release" pins the real event order —
  // `tookHit`, `discarded(attackSpent)`, `releaseStolen`, `windowClosed`,
  // `windowOpened` — so this reaches through the whole batch, not just the
  // one event, to pin that the pair's own exit still gets its beat AND the
  // crossing gets its own, one event apiece.
  it('plans the steal as a crossing between two zones', () => {
    const plans = planBeats(
      [
        tookHit({ id: 9 }),
        discarded(10, { player: 'p2', card: 'attack-bug', reason: 'attackSpent' }),
        {
          id: 20,
          type: 'releaseStolen',
          from: 'p1',
          to: 'p2',
          slot: 'frontend',
          card: 'release-frontend',
        } as Event,
        { id: 21, type: 'windowClosed', player: 'p2', slot: 'frontend' } as Event,
        {
          id: 22,
          type: 'windowOpened',
          player: 'p2',
          slot: 'frontend',
          round: 1,
          deadline: 0,
        } as Event,
      ],
      boardBefore({ pending: defendPending({ scope: 'release' }) } as Partial<BoardState>),
    )
    expect(plans).toEqual([
      { kind: 'pairToDiscard', key: 'pairOut:10', main: { eventId: 10, card: 'attack-bug' } },
      {
        kind: 'stolen',
        key: 'stolen:20',
        eventId: 20,
        from: 'p1',
        to: 'p2',
        slot: 'frontend',
        card: 'release-frontend',
      },
    ])
  })
})

describe('planBeats — the answer to an Error 503 (#102)', () => {
  const neutralized = (
    over: Partial<Extract<Event, { type: 'neutralized' }>> & { id: number },
  ): Event => ({ type: 'neutralized', player: 'p1', method: 'debugger', ...over }) as Event

  const alarmPending = () =>
    ({
      kind: 'neutralize503',
      player: 'p1',
      card: 'trigger-error-503',
      methods: ['debugger'],
    }) as NonNullable<BoardState['pending']>

  it('plans a Debugger answer as one exchange', () => {
    const plans = planBeats(
      [
        neutralized({ id: 10 }),
        discarded(11, { card: 'trigger-error-503', reason: 'trigger' }),
        discarded(12, { card: 'protection-debugger', reason: 'neutralized' }),
      ],
      boardBefore({ pending: alarmPending() }),
    )
    expect(plans).toEqual([
      {
        kind: 'neutralized',
        key: 'neutralized:10',
        eventId: 10,
        player: 'p1',
        method: 'debugger',
        alarm: { eventId: 11, card: 'trigger-error-503' },
        spent: [{ eventId: 12, card: 'protection-debugger' }],
      },
    ])
  })

  it('plans a Monitoring answer with nothing spent', () => {
    const plans = planBeats(
      [
        neutralized({ id: 10, method: 'monitoring' }),
        discarded(11, { card: 'trigger-error-503', reason: 'trigger' }),
      ],
      boardBefore({ pending: alarmPending() }),
    )
    expect(plans).toEqual([
      {
        kind: 'neutralized',
        key: 'neutralized:10',
        eventId: 10,
        player: 'p1',
        method: 'monitoring',
        alarm: { eventId: 11, card: 'trigger-error-503' },
        spent: [],
      },
    ])
  })

  it('names the slot a sacrificed release flies out of, and takes its Code Review with it', () => {
    const before = boardBefore({
      pending: alarmPending(),
      you: {
        name: 'You',
        hand: [],
        release: { frontend: card('release-frontend') },
        support: { frontend: card('support-code-review') },
      },
    } as Partial<BoardState>)
    const plans = planBeats(
      [
        neutralized({ id: 10, method: 'sacrifice' }),
        discarded(11, { card: 'trigger-error-503', reason: 'trigger' }),
        {
          id: 12,
          type: 'releaseDestroyed',
          player: 'p1',
          slot: 'frontend',
          card: 'release-frontend',
        } as Event,
        discarded(13, { card: 'release-frontend', reason: 'neutralized' }),
        discarded(14, { card: 'support-code-review', reason: 'neutralized' }),
      ],
      before,
    )
    expect(plans).toEqual([
      {
        kind: 'neutralized',
        key: 'neutralized:10',
        eventId: 10,
        player: 'p1',
        method: 'sacrifice',
        slot: 'frontend',
        // no `releaseEvent` on this fixture's release — an ordinary release,
        // so `bankToDiscard` really does put it in the heap
        destination: 'discard',
        alarm: { eventId: 11, card: 'trigger-error-503' },
        spent: [
          { eventId: 13, card: 'release-frontend' },
          { eventId: 14, card: 'support-code-review' },
        ],
      },
    ])
  })

  // docs/animations/backlog.md:1062 — a sacrificed release that IS an
  // events-deck card has already been sent home by `bankToDiscard`, no matter
  // what this resolution's own `discarded(reason: 'neutralized')` says. Read
  // the same way `AiTail`'s crush reads it (`planBeats — aiEvent`'s "THE PAIR
  // THAT MATTERS #1"), off the pre-batch `releaseEvent` map.
  it('names an events-deck release’s real destination, not the heap its own discard implies', () => {
    const before = boardBefore({
      pending: alarmPending(),
      you: {
        name: 'You',
        hand: [],
        release: { frontend: card('release-frontend') },
        releaseEvent: { frontend: 'ai-release-frontend' },
      },
    } as Partial<BoardState>)
    const plans = planBeats(
      [
        neutralized({ id: 10, method: 'sacrifice' }),
        discarded(11, { card: 'trigger-error-503', reason: 'trigger' }),
        {
          id: 12,
          type: 'releaseDestroyed',
          player: 'p1',
          slot: 'frontend',
          card: 'release-frontend',
        } as Event,
        discarded(13, { card: 'release-frontend', reason: 'neutralized' }),
      ],
      before,
    )
    expect(plans.find((p) => p.kind === 'neutralized')).toMatchObject({ destination: 'events' })
  })

  // The shared gap (Task 7 fix round 1): a `neutralize503` pending can bank no
  // alarm at all — a `crush` (the AI threat card is never on the table), or the
  // `ai-error-503` mimic, whose card has already gone back to its own events
  // deck (`fake/triggers.ts` builds this pending with `card: null`). Both reach
  // this walk as a `neutralized` event followed ONLY by the answer's own
  // `discarded(reason: 'neutralized')` — no `discarded(reason: 'trigger')`
  // before it — so `alarm` is never assigned and the spread
  // `...(alarm ? { alarm } : {})` omits the key entirely rather than setting it
  // to `undefined`.
  it('plans a neutralized resolution with no alarm to take away', () => {
    const plans = planBeats(
      [
        neutralized({ id: 10 }),
        discarded(11, { card: 'protection-debugger', reason: 'neutralized' }),
      ],
      boardBefore({ pending: alarmPending() }),
    )
    expect(plans).toHaveLength(1)
    // the key is OMITTED, not present-and-undefined — `toEqual` treats those
    // as equal, so `not.toHaveProperty` is the assertion that actually pins it
    expect(plans[0]).not.toHaveProperty('alarm')
    expect(plans[0]).toEqual({
      kind: 'neutralized',
      key: 'neutralized:10',
      eventId: 10,
      player: 'p1',
      method: 'debugger',
      spent: [{ eventId: 11, card: 'protection-debugger' }],
    })
  })

  it('leaves nothing for the discard planner to fly twice', () => {
    const plans = planBeats(
      [
        neutralized({ id: 10 }),
        discarded(11, { card: 'trigger-error-503', reason: 'trigger' }),
        discarded(12, { card: 'protection-debugger', reason: 'neutralized' }),
      ],
      boardBefore({ pending: alarmPending() }),
    )
    expect(plans.filter((p) => p.kind === 'discard')).toEqual([])
  })

  // The road home (#106): the AI card standing behind the prompt this batch
  // answers has to leave eventually, and this is when. Selected off the
  // PRE-BATCH pending with a plain equality — `before.pending` is still the
  // projection with the prompt open (I1).
  it('sends the standing AI card home on the batch that answers its prompt', () => {
    const before = boardBefore({
      pending: {
        kind: 'crush',
        player: 'p1',
        slot: 'frontend',
        methods: ['debugger'],
        source: 'ai-crush-frontend',
      },
    } as Partial<BoardState>)
    const plans = planBeats(
      [
        neutralized({ id: 10 }),
        discarded(11, { card: 'protection-debugger', reason: 'neutralized' }),
      ],
      before,
    )
    expect(plans.find((p) => p.kind === 'neutralized')).toMatchObject({
      homeward: 'ai-crush-frontend',
    })
  })

  it('adds no road home when the prompt was nobody’s AI card', () => {
    const plans = planBeats(
      [
        neutralized({ id: 10 }),
        discarded(11, { card: 'trigger-error-503', reason: 'trigger' }),
        discarded(12, { card: 'protection-debugger', reason: 'neutralized' }),
      ],
      boardBefore({ pending: alarmPending() }),
    )
    expect(plans.find((p) => p.kind === 'neutralized')).not.toHaveProperty('homeward')
  })

  // THE BATCH THAT LOOKS EMPTY AND IS NOT (#106). Answer a `crush` — or the
  // `ai-error-503` mimic — with MONITORING and the resolution banks nothing at
  // all: both pendings carry a null `card`, so `bankAlarm` logs no discard, and
  // Monitoring costs nothing, so there is no `discarded(neutralized)` either.
  // The "an exchange with nothing in it is not a beat" guard used to drop the
  // whole plan on that shape — and with it the road home, leaving the AI card
  // standing at `effect` to vanish the moment the queue drained.
  it('keeps a Monitoring answer that owes an AI card its road home', () => {
    const plans = planBeats(
      [neutralized({ id: 10, method: 'monitoring' })],
      boardBefore({
        pending: {
          kind: 'crush',
          player: 'p1',
          slot: 'frontend',
          methods: ['monitoring'],
          source: 'ai-crush-frontend',
        },
      } as Partial<BoardState>),
    )
    expect(plans.map((p) => p.kind)).toEqual(['neutralized'])
    expect(plans[0]).toMatchObject({
      method: 'monitoring',
      spent: [],
      homeward: 'ai-crush-frontend',
    })
    expect(plans[0]).not.toHaveProperty('alarm')
  })

  it('still drops a Monitoring answer that owes nothing at all', () => {
    // The contrast that keeps the guard a guard: a 503 the standing Monitoring
    // answered by itself banks its alarm inside the DRAW that turned it up, so
    // this resolution really does have nothing to show — and no AI card is
    // standing behind it either.
    const plans = planBeats(
      [neutralized({ id: 10, method: 'monitoring' })],
      boardBefore({ pending: alarmPending() }),
    )
    expect(plans).toEqual([])
  })
})

describe('planBeats — the sweep (#102)', () => {
  const eliminated = (
    over: Partial<Extract<Event, { type: 'eliminated' }>> & { id: number },
  ): Event => ({ type: 'eliminated', player: 'p1', ...over }) as Event

  it('gathers a knocked-out player’s cards into one sweep', () => {
    const plans = planBeats(
      [
        eliminated({ id: 20 }),
        discarded(21, { card: 'attack-bug', reason: 'effect' }),
        discarded(22, { card: 'protection-debugger', reason: 'effect' }),
        discarded(23, { card: 'release-frontend', reason: 'destroyed' }),
      ],
      boardBefore(),
    )
    expect(plans).toEqual([
      {
        kind: 'discard',
        key: 'discard:21',
        gather: true,
        cards: [
          { key: 'd21', eventId: 21, card: 'attack-bug', source: { kind: 'hand', index: 0 } },
          {
            key: 'd22',
            eventId: 22,
            card: 'protection-debugger',
            source: { kind: 'hand', index: 1 },
          },
          {
            key: 'd23',
            eventId: 23,
            card: 'release-frontend',
            source: { kind: 'release', player: 'p1', slot: 'frontend' },
          },
        ],
      },
      // and the video behind it (#103) — the sweep is what it plays over
      { kind: 'eliminated', key: 'eliminated:20', eventId: 20, player: 'p1' },
    ])
  })

  it('leaves an ordinary discard ungathered', () => {
    const plans = planBeats([discarded(21, { reason: 'effect' })], boardBefore())
    expect((plans[0] as { gather?: true }).gather).toBeUndefined()
  })

  // Correction 1's own failure mode, pinned: `sweeping` must be cleared
  // INSIDE `flush()`, not at the eliminated/discarded call site, or the flag
  // set by an earlier sweep would survive across an unrelated event and
  // wrongly gather a LATER discard that has nothing to do with it.
  it('does not gather a later, unrelated discard after the sweep has closed', () => {
    const plans = planBeats(
      [
        eliminated({ id: 20 }),
        discarded(21, { card: 'attack-bug', reason: 'effect' }),
        tookHit({ id: 22 }), // closes the sweep's run — nothing to do with it
        discarded(23, { card: 'protection-debugger', reason: 'effect' }),
      ],
      boardBefore(),
    )
    const discards = plans.filter((p) => p.kind === 'discard')
    expect(discards).toEqual([
      {
        kind: 'discard',
        key: 'discard:21',
        gather: true,
        cards: [
          { key: 'd21', eventId: 21, card: 'attack-bug', source: { kind: 'hand', index: 0 } },
        ],
      },
      {
        kind: 'discard',
        key: 'discard:23',
        cards: [
          {
            key: 'd23',
            eventId: 23,
            card: 'protection-debugger',
            source: { kind: 'hand', index: 1 },
          },
        ],
      },
    ])
  })
})

describe('planBeats — elimination (#103)', () => {
  const eliminated = (
    over: Partial<Extract<Event, { type: 'eliminated' }>> & { id: number },
  ): Event => ({ type: 'eliminated', player: 'p1', ...over }) as Event

  // The video plays over a board that has already emptied, so the plan is
  // pushed when the sweep's own run closes rather than where the event is
  // read — the `eliminated` arrives BEFORE the discards it opens.
  it('plays after the sweep it opened, not before it', () => {
    const plans = planBeats(
      [
        eliminated({ id: 20 }),
        discarded(21, { card: 'attack-bug', reason: 'effect' }),
        discarded(22, { card: 'protection-debugger', reason: 'effect' }),
      ],
      boardBefore(),
    )
    expect(plans.map((p) => p.kind)).toEqual(['discard', 'eliminated'])
    expect(plans[1]).toEqual({
      kind: 'eliminated',
      key: 'eliminated:20',
      eventId: 20,
      player: 'p1',
    })
  })

  // `lastStanding` reaches elimination with nothing to sweep, and a discard
  // plan with no cards is dropped by `flush()` — so a video that rode on the
  // sweep would not exist on exactly the path that has no sweep.
  it('plays for an elimination that sweeps nothing', () => {
    const plans = planBeats([eliminated({ id: 20, player: 'p2' })], boardBefore())
    expect(plans).toEqual([{ kind: 'eliminated', key: 'eliminated:20', eventId: 20, player: 'p2' }])
  })

  // Two players out in one batch is two videos, not one: each elimination is
  // its own beat, behind its own sweep.
  it('gives each knocked-out player their own beat', () => {
    const plans = planBeats(
      [eliminated({ id: 20, player: 'p1' }), eliminated({ id: 21, player: 'p2' })],
      boardBefore(),
    )
    expect(plans).toEqual([
      { kind: 'eliminated', key: 'eliminated:20', eventId: 20, player: 'p1' },
      { kind: 'eliminated', key: 'eliminated:21', eventId: 21, player: 'p2' },
    ])
  })
})

describe('classifyPiles', () => {
  // The event carries counts and nothing else — not the operation, not the
  // index. Recovering it positionally is a derivation, not a guess: a split
  // leaves the halves where the pile was, so one index accounts for two.
  it('reads a split from the pile that became two', () => {
    expect(classifyPiles([24], [12, 12])).toEqual({ kind: 'split', at: 0, piles: [12, 12] })
    expect(classifyPiles([10, 20, 30], [10, 10, 10, 30])).toEqual({
      kind: 'split',
      at: 1,
      piles: [10, 10, 10, 30],
    })
  })

  it('reads a merge, and whether the discard came with it', () => {
    expect(classifyPiles([4, 6], [10])).toEqual({ kind: 'merge', withDiscard: false, piles: [10] })
    // Sudo gathers the discard in too, so the survivor holds more than the
    // piles did — which is the only signal that the discard flew.
    expect(classifyPiles([4, 6], [15])).toEqual({ kind: 'merge', withDiscard: true, piles: [15] })
  })

  it('reads Git Branch + Sudo’s second step as the discard becoming a pile', () => {
    expect(classifyPiles([12, 12], [12, 12, 6])).toEqual({
      kind: 'fromDiscard',
      at: 2,
      piles: [12, 12, 6],
    })
  })

  // A pile that runs out ceases to exist. Nothing moves — the cards were face
  // down before and there are none after — so there is no beat to play.
  it('plays nothing for a pruned empty pile', () => {
    expect(classifyPiles([0, 10], [10])).toBeNull()
  })

  it('plays nothing when the counts say nothing happened', () => {
    expect(classifyPiles([10], [10])).toBeNull()
    expect(classifyPiles([0, 0], [0])).toBeNull()
  })
})

describe('planBeats — a 503 a standing Monitoring answers by itself (#103)', () => {
  const standingAlarm = () =>
    ({
      kind: 'neutralize503',
      player: 'p1',
      card: 'trigger-error-503',
      methods: ['monitoring'],
    }) as NonNullable<BoardState['pending']>

  // The engine answers it inside the draw that turned it up: no pending, no
  // gesture, one batch (`fake/triggers.ts` — the Monitoring branch). The
  // `neutralized` sits BETWEEN the reveal and the discard it caused, because
  // the discard is parented to the method that banked it.
  const auto = (): Event[] =>
    [
      { id: 30, type: 'drawn', player: 'p1', pile: 0, deckSize: 9 },
      { id: 31, type: 'revealed', player: 'p1', card: 'trigger-error-503' },
      { id: 32, type: 'neutralized', player: 'p1', method: 'monitoring' },
      { id: 33, type: 'discarded', player: 'p1', card: 'trigger-error-503', reason: 'trigger' },
    ] as Event[]

  it('gives the draw the discard to fly, past the method that banked it', () => {
    const plans = planBeats(auto(), boardBefore())
    const draw = plans.find((p) => p.kind === 'draw')
    expect(draw).toBeDefined()
    expect((draw as Extract<BeatPlan, { kind: 'draw' }>).draws[0].reveal).toEqual({
      card: 'trigger-error-503',
      discardId: 33,
      neutralized: true,
    })
  })

  // An exchange with nothing in it is not a beat: the draw owns the only card
  // that moves, and a `neutralized` plan behind it would hold the table for its
  // own hold with nothing to show for it.
  it('plans no exchange of its own', () => {
    const plans = planBeats(auto(), boardBefore())
    expect(plans.map((p) => p.kind)).toEqual(['draw'])
  })

  // …but a CHOSEN Monitoring still has its own beat: the alarm stood at the
  // centre through a pending and is taken away by the exchange, not by a draw.
  it('leaves a chosen Monitoring answer its own exchange', () => {
    const plans = planBeats(
      [
        { id: 40, type: 'neutralized', player: 'p1', method: 'monitoring' },
        { id: 41, type: 'discarded', player: 'p1', card: 'trigger-error-503', reason: 'trigger' },
      ] as Event[],
      boardBefore({ pending: standingAlarm() }),
    )
    expect(plans.map((p) => p.kind)).toEqual(['neutralized'])
  })
})

describe('planBeats — an attack resolved inside its own play (#19 follow-up)', () => {
  // A DDoS is banked by the play that made it and raises no pending: its
  // `attackSpent` discard comes NEXT, with no answer in between. The beat has
  // to know, or it would publish a shadow saying an answer is owed for a throw
  // nobody can answer.
  it('marks a DDoS as resolved, so nothing claims an answer is owed', () => {
    const plans = planBeats(
      [
        {
          id: 10,
          type: 'attacked',
          attacker: 'p1',
          card: 'attack-ddos',
          sudo: false,
          target: 'p2',
        },
        { id: 11, type: 'discarded', player: 'p1', card: 'attack-ddos', reason: 'attackSpent' },
      ] as unknown as Event[],
      boardBefore(),
    )
    const attack = plans.find((p) => p.kind === 'attackPlaced')
    expect(attack).toMatchObject({ card: 'attack-ddos', resolved: true })
  })

  // An ordinary attack stands until it is answered, and must keep saying so.
  it('leaves an attack that stands unmarked', () => {
    const plans = planBeats(
      [
        { id: 10, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'p1' },
      ] as unknown as Event[],
      boardBefore(),
    )
    expect(plans[0]).not.toHaveProperty('resolved')
  })

  // …and so does one answered later in the SAME batch: the answer sits between
  // the throw and the discard, so the attack really did stand.
  it('leaves an attack answered inside the batch unmarked', () => {
    const plans = planBeats(
      [
        { id: 10, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'p1' },
        {
          id: 11,
          type: 'defended',
          player: 'p1',
          card: 'defense-hotfix',
          effect: 'cancel',
          attacker: 'p2',
          attackCard: 'attack-bug',
          attackSudo: false,
        },
        { id: 12, type: 'discarded', player: 'p2', card: 'attack-bug', reason: 'attackSpent' },
      ] as unknown as Event[],
      boardBefore(),
    )
    expect(plans.find((p) => p.kind === 'attackPlaced')).not.toHaveProperty('resolved')
  })
})

describe('card transfers', () => {
  const requested = (over: Partial<Extract<Event, { type: 'requested' }>> = {}): Event =>
    ({
      id: 1,
      type: 'requested',
      attacker: 'p1',
      target: 'p2',
      card: 'attack-bug',
      hit: true,
      ...over,
    }) as Event

  const transfer = (over: Partial<Extract<Event, { type: 'handTransfer' }>> = {}): Event =>
    ({ id: 2, type: 'handTransfer', from: 'p2', to: 'p1', card: 'attack-bug', ...over }) as Event

  it('carries a request through whole, hit or miss', () => {
    const [hit] = planBeats([requested()], boardBefore())
    expect(hit).toMatchObject({
      kind: 'requested',
      attacker: 'p1',
      target: 'p2',
      card: 'attack-bug',
      hit: true,
    })
    const [miss] = planBeats([requested({ hit: false })], boardBefore())
    expect(miss).toMatchObject({ kind: 'requested', hit: false })
  })

  it('names the role from selfId', () => {
    const taker = planBeats([transfer()], boardBefore())[0]
    expect(taker).toMatchObject({ kind: 'handTransfer', role: 'taker' })

    const victim = planBeats([transfer({ from: 'p1', to: 'p2' })], boardBefore())[0]
    expect(victim).toMatchObject({ kind: 'handTransfer', role: 'victim' })

    const watcher = planBeats([transfer({ from: 'p2', to: 'p3' })], boardBefore())[0]
    expect(watcher).toMatchObject({ kind: 'handTransfer', role: 'watcher' })
  })

  it('reads `named` off the giveCard pending, not off the batch', () => {
    // The `requested` that started a Security Bug landed in an EARLIER batch —
    // it opened the pending and returned. So the only thing in reach that says
    // this transfer was a named one is the projection the batch animates away
    // from, and it says so publicly: `giveCard` is projected unredacted.
    const named = planBeats(
      [transfer()],
      boardBefore({ pending: { kind: 'giveCard', player: 'p2', requested: 'attack-bug' } }),
    )[0]
    expect(named).toMatchObject({ kind: 'handTransfer', named: true })

    // A random steal raises no pending at all (handAttacks.ts:43 `stealRandom`).
    const random = planBeats([transfer()], boardBefore())[0]
    expect(random).toMatchObject({ kind: 'handTransfer', named: false })
  })

  it('takes the donor hand size off the pre-batch projection', () => {
    // I1: by the time the beat runs the projection has already taken the card
    // out, so a grid measured from `live` would be one back short.
    const plan = planBeats(
      [transfer()],
      boardBefore({
        opponents: [{ id: 'p2', name: 'Two', handCount: 4, release: {} }],
      }),
    )[0]
    expect(plan).toMatchObject({ kind: 'handTransfer', donorHand: 4 })
  })

  it('never widens a redacted transfer', () => {
    // THE correctness property. `handTransfer.card` is present only for the two
    // parties (handAttacks.ts sets `visibleTo: [from, to]`), and the closed
    // flight is selected by that absence — never by a rule the board re-derives
    // about who may see what. A plan that invented a card here would leak the
    // identity into the DOM for every spectator.
    const plan = planBeats([transfer({ from: 'p2', to: 'p3', card: undefined })], boardBefore())[0]
    expect(plan).toMatchObject({ kind: 'handTransfer', role: 'watcher' })
    expect((plan as Extract<BeatPlan, { kind: 'handTransfer' }>).card).toBeUndefined()
  })
})

describe('planBeats — aiEvent (#106)', () => {
  // drawn(card-less) → aiRevealed → discarded(trigger) → the effect's own events
  const aiBatch = (...tail: Event[]): Event[] => [
    { id: 1, type: 'drawn', player: 'p1', pile: 0, deckSize: 30 },
    {
      id: 2,
      type: 'aiRevealed',
      player: 'p1',
      aiCard: 'trigger-ai',
      eventCard: 'ai-crush-frontend',
    },
    { id: 3, type: 'discarded', player: 'p1', card: 'trigger-ai', reason: 'trigger' },
    ...tail,
  ]

  it('claims the draw and its reveal, and emits no draw plan', () => {
    const plans = planBeats(aiBatch(), boardBefore())
    expect(plans.map((p) => p.kind)).toEqual(['aiEvent'])
    expect(plans[0]).toMatchObject({
      player: 'p1',
      pile: 0,
      trigger: 'trigger-ai',
      triggerDiscardId: 3,
      eventCard: 'ai-crush-frontend',
    })
  })

  it('reads the ending off the events that follow, never off the card id', () => {
    const zone = planBeats(
      [
        { id: 1, type: 'drawn', player: 'p1', pile: 0, deckSize: 30 },
        {
          id: 2,
          type: 'aiRevealed',
          player: 'p1',
          aiCard: 'trigger-ai',
          eventCard: 'ai-release-frontend',
        },
        { id: 3, type: 'discarded', player: 'p1', card: 'trigger-ai', reason: 'trigger' },
        { id: 4, type: 'released', player: 'p1', slot: 'frontend', card: 'release-frontend' },
      ],
      boardBefore(),
    )
    // The full array, not just `zone[0]` — the tail's own `released` must be
    // CLAIMED, not merely read, or the ordinary release branch plans it too.
    expect(zone.map((p) => p.kind)).toEqual(['aiEvent'])
    expect(zone[0]).toMatchObject({
      tail: { kind: 'zone', slot: 'frontend', card: 'release-frontend' },
    })

    const halluc = planBeats(
      [
        { id: 1, type: 'drawn', player: 'p1', pile: 0, deckSize: 30 },
        {
          id: 2,
          type: 'aiRevealed',
          player: 'p1',
          aiCard: 'trigger-ai',
          eventCard: 'ai-hallucination',
        },
        { id: 3, type: 'discarded', player: 'p1', card: 'trigger-ai', reason: 'trigger' },
        { id: 4, type: 'turnEnded', player: 'p1' },
      ],
      boardBefore(),
    )
    expect(halluc.map((p) => p.kind)).toEqual(['aiEvent'])
    expect(halluc[0]).toMatchObject({ tail: { kind: 'turnEnded' } })
  })

  // THE PAIR THAT MATTERS #1 — two batches identical apart from the projection
  it('sends a destroyed AI release home and an ordinary one to the heap', () => {
    const batch = aiBatch({
      id: 4,
      type: 'releaseDestroyed',
      player: 'p1',
      slot: 'frontend',
      card: 'release-frontend',
    })
    const ai = boardBefore({
      you: {
        name: 'You',
        hand: [],
        release: { frontend: card('release-frontend') },
        releaseEvent: { frontend: 'ai-release-frontend' },
      },
    } as Partial<BoardState>)
    const plain = boardBefore({
      you: {
        name: 'You',
        hand: [],
        release: { frontend: card('release-frontend') },
        releaseEvent: {},
      },
    } as Partial<BoardState>)
    const aiPlans = planBeats(batch, ai)
    const plainPlans = planBeats(batch, plain)
    expect(aiPlans.map((p) => p.kind)).toEqual(['aiEvent'])
    expect(plainPlans.map((p) => p.kind)).toEqual(['aiEvent'])
    expect(aiPlans[0]).toMatchObject({ tail: { destination: 'events' } })
    expect(plainPlans[0]).toMatchObject({ tail: { destination: 'discard' } })
  })

  // A crush takes the release AND the Code Review tucked under it —
  // `destroySlot`'s own spoils (fake/triggers.ts:87). The event names only the
  // release, so the pair has to be read off the pre-batch projection's
  // `support`; without it the Code Review blinks out of the zone unflown.
  it('carries the Code Review the destroyed release was wearing', () => {
    const batch = aiBatch({
      id: 4,
      type: 'releaseDestroyed',
      player: 'p1',
      slot: 'frontend',
      card: 'release-frontend',
    })
    const protectedRelease = boardBefore({
      you: {
        name: 'You',
        hand: [],
        release: { frontend: card('release-frontend') },
        support: { frontend: card('support-code-review') },
        releaseEvent: {},
      },
    } as Partial<BoardState>)
    const bare = boardBefore({
      you: {
        name: 'You',
        hand: [],
        release: { frontend: card('release-frontend') },
        support: {},
        releaseEvent: {},
      },
    } as Partial<BoardState>)
    expect(planBeats(batch, protectedRelease)[0]).toMatchObject({
      tail: { kind: 'crush', card: 'release-frontend', codeReview: 'support-code-review' },
    })
    // and an unprotected release carries none — the field says "there was one",
    // never "there might have been"
    const plan = planBeats(batch, bare)[0] as Extract<BeatPlan, { kind: 'aiEvent' }>
    expect(plan.tail).not.toHaveProperty('codeReview')
  })

  it('reads a destroyed opponent’s Code Review off their own zone', () => {
    const batch = aiBatch({
      id: 4,
      type: 'releaseDestroyed',
      player: 'p2',
      slot: 'backend',
      card: 'release-backend',
    })
    const before = boardBefore({
      opponents: [
        {
          id: 'p2',
          name: 'Two',
          handCount: 3,
          release: { backend: card('release-backend') },
          support: { backend: card('support-code-review') },
        },
      ],
    } as Partial<BoardState>)
    expect(planBeats(batch, before)[0]).toMatchObject({
      tail: { kind: 'crush', codeReview: 'support-code-review' },
    })
  })

  // WHERE THE HEAP WILL ACTUALLY REST IT. An automatic `destroySlot` emits no
  // `discarded`, so there is no event id to key a scatter off — but the heap
  // still shows the card, as its stand-in for the discard's top, and that
  // stand-in has a pose. The plan reads it through the very function
  // `toDiscardHeap` rests it with (I7), off the post-batch count `useBeats`
  // hands in — never recomputed from `before` plus what the batch looks like
  // it banked.
  it('rests a crushed release on the pose the heap will actually give it', () => {
    const batch = aiBatch({
      id: 4,
      type: 'releaseDestroyed',
      player: 'p1',
      slot: 'frontend',
      card: 'release-frontend',
    })
    const before = boardBefore({
      you: {
        name: 'You',
        hand: [],
        release: { frontend: card('release-frontend') },
        support: {},
        releaseEvent: {},
      },
    } as Partial<BoardState>)
    const plan = planBeats(batch, before, null, 7)[0] as Extract<BeatPlan, { kind: 'aiEvent' }>
    expect(plan.tail).toMatchObject({ kind: 'crush', rest: standInScatter(7) })
    // and it is the STAND-IN's pose, never a real discard event's — those are
    // keyed positive and this one is deliberately out of their range
    expect(plan.tail).not.toMatchObject({ rest: scatterAt(4) })
  })

  it('rests nothing when the heap has nothing to rest it as', () => {
    const batch = aiBatch({
      id: 4,
      type: 'releaseDestroyed',
      player: 'p1',
      slot: 'frontend',
      card: 'release-frontend',
    })
    const withReview = boardBefore({
      you: {
        name: 'You',
        hand: [],
        release: { frontend: card('release-frontend') },
        support: { frontend: card('support-code-review') },
        releaseEvent: {},
      },
    } as Partial<BoardState>)
    const goesHome = boardBefore({
      you: {
        name: 'You',
        hand: [],
        release: { frontend: card('release-frontend') },
        support: {},
        releaseEvent: { frontend: 'ai-release-frontend' },
      },
    } as Partial<BoardState>)
    // buried under its own Code Review — `bankToDiscard` banks the spoils as
    // [release, codeReview], so the Code Review is the top and this one is
    // under it, with no entry of its own (docs/animations/backlog.md)
    expect(planBeats(batch, withReview, null, 7)[0]).not.toMatchObject({ tail: { rest: {} } })
    // never reaches the heap at all — it is claimed back by the events deck
    expect(planBeats(batch, goesHome, null, 7)[0]).not.toMatchObject({ tail: { rest: {} } })
    // and with no count handed in there is nothing to read
    expect(planBeats(batch, boardBefore(), null)[0]).not.toMatchObject({ tail: { rest: {} } })
  })

  // THE PAIR THAT MATTERS #2 — two batches identical AND empty
  it('separates a prompt that is owed from nothing having happened, using `owed`', () => {
    const batch = aiBatch()
    const before = boardBefore()
    const nothing = planBeats(batch, before, null)
    const owed = planBeats(batch, before, {
      kind: 'crush',
      player: 'p1',
      slot: 'frontend',
      methods: ['debugger'],
      source: 'ai-crush-frontend',
    })
    expect(nothing.map((p) => p.kind)).toEqual(['aiEvent'])
    expect(owed.map((p) => p.kind)).toEqual(['aiEvent'])
    expect(nothing[0]).toMatchObject({ tail: { kind: 'none' } })
    expect(owed[0]).toMatchObject({ tail: { kind: 'standing' } })
  })

  it('lights the alarm for the 503 mimic, standing or not', () => {
    const revealed: Event = { id: 4, type: 'revealed', player: 'p1', card: 'ai-error-503' }
    const mimic = (...rest: Event[]): Event[] => [
      { id: 1, type: 'drawn', player: 'p1', pile: 0, deckSize: 30 },
      { id: 2, type: 'aiRevealed', player: 'p1', aiCard: 'trigger-ai', eventCard: 'ai-error-503' },
      { id: 3, type: 'discarded', player: 'p1', card: 'trigger-ai', reason: 'trigger' },
      revealed,
      ...rest,
    ]
    // answerable: the prompt is owed, the card stands, and the glow is owed with it
    const answerable = planBeats(mimic(), boardBefore(), {
      kind: 'neutralize503',
      player: 'p1',
      card: null,
      methods: ['debugger'],
      source: 'ai-error-503',
    })
    expect(answerable.map((p) => p.kind)).toEqual(['aiEvent'])
    expect(answerable[0]).toMatchObject({ tail: { kind: 'standing', alarm: true } })
    // defenceless: `eliminated` follows in the same batch and the sweep takes
    // over — the mimic's own scene AND the sweep it triggers, one beat apiece
    const doomed = planBeats(
      mimic({ id: 5, type: 'eliminated', player: 'p1' }),
      boardBefore(),
      null,
    )
    expect(doomed.map((p) => p.kind)).toEqual(['aiEvent', 'eliminated'])
    expect(doomed[0]).toMatchObject({ tail: { kind: 'alarm' } })
  })

  it('does not let the discard planner claim the trigger a second time', () => {
    const plans = planBeats(aiBatch(), boardBefore(), null)
    expect(plans.some((p) => p.kind === 'discard')).toBe(false)
  })
})

describe('planBeats — a Release comes back out of the discard (#106, Task 11)', () => {
  it("plans the card coming out of the discard, and sends Inside's own card home with it", () => {
    const before = boardBefore({
      pending: {
        kind: 'pickFromDiscard',
        player: 'p1',
        options: [],
        picks: 1,
        source: 'ai-inside',
      },
    } as Partial<BoardState>)
    const plans = planBeats(
      [{ id: 20, type: 'takenFromDiscard', player: 'p1', card: 'release-frontend', to: 'hand' }],
      before,
    )
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      kind: 'takenFromDiscard',
      eventId: 20,
      player: 'p1',
      card: 'release-frontend',
      mine: true,
      homeward: 'ai-inside',
    })
  })

  it('reads `mine` off the projection, not off the player who acted', () => {
    // `before.selfId` is 'p1' (`boardBefore`'s own default) — a card taken by
    // 'p2' is public (`takenFromDiscard` carries no `visibleTo`), and every
    // peer plans the same beat off it, just with `mine` the other way.
    const plans = planBeats(
      [{ id: 20, type: 'takenFromDiscard', player: 'p2', card: 'release-backend', to: 'hand' }],
      boardBefore(),
    )
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ kind: 'takenFromDiscard', mine: false })
  })

  it('plans nothing when no prompt was open — `homeward` stays absent', () => {
    const plans = planBeats(
      [{ id: 20, type: 'takenFromDiscard', player: 'p1', card: 'release-frontend', to: 'hand' }],
      boardBefore(),
    )
    expect(plans[0]).not.toHaveProperty('homeward')
  })

  // Cherry-pick's second pick (#61, not yet implemented) puts a card back on
  // top of a pile, unseen by anyone but the placer — a private placement,
  // not a beat. Flushed and passed straight through, the default this file
  // already keeps for an event with no choreography.
  it("passes Cherry-pick's own placement through with no beat of its own", () => {
    const plans = planBeats(
      [{ id: 20, type: 'takenFromDiscard', player: 'p1', card: 'release-frontend', to: 'deck' }],
      boardBefore(),
    )
    expect(plans).toHaveLength(0)
  })
})
