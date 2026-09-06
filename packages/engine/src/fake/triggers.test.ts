import type { GameConfig } from '../engine'
import type { CardInstance, GameState, Setup } from '../state'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from './index'
import { playableFor, project } from './project'
import { reduce } from './reduce'

const engine = createFakeEngine()

const BASE: Setup = {
  handLimit: 'base',
  releases: 'base',
  releaseCond: 'base',
  ai: 'base',
  gitBranch: 'base',
}

const config = (): GameConfig => ({
  gameId: 'g1',
  seed: 4242,
  players: [
    { id: 'p1', name: 'you' },
    { id: 'p2', name: 'kernel_panic' },
  ],
  setup: BASE,
  deck: FAKE_DECK,
  events: FAKE_EVENTS,
})

const E503: CardInstance = { uid: 'trigger-error-503#0', id: 'trigger-error-503' }
const DBG: CardInstance = { uid: 'protection-debugger#0', id: 'protection-debugger' }
const MON: CardInstance = { uid: 'protection-monitoring#0', id: 'protection-monitoring' }
const FE: CardInstance = { uid: 'release-frontend#0', id: 'release-frontend' }

// Stack `top` as the next card p1 will draw.
const withTop = (top: CardInstance, hand: CardInstance[] = []): GameState => {
  const s = engine.createGame(config())
  return {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1, hand } },
    decks: { ...s.decks, main: [[top, ...s.decks.main[0]]] },
  }
}

it('reveals Error 503 to everyone and demands neutralization', () => {
  const r = reduce(withTop(E503, [DBG]), { type: 'DRAW', player: 'p1', at: 1000 })
  const revealed = r.events.find((e) => e.type === 'revealed')
  expect(revealed).toBeDefined()
  expect(revealed?.visibleTo).toBeUndefined()
  expect(r.state.pending).toEqual({
    kind: 'neutralize503',
    player: 'p1',
    card: E503,
    methods: ['debugger'],
  })
})

it('holds the alarm on the pending instead of banking it at the reveal', () => {
  const r = reduce(withTop(E503, [DBG]), { type: 'DRAW', player: 'p1', at: 1000 })
  // by the rules it reaches the discard only once it has been neutralized
  expect(r.state.decks.discard.map((c) => c.uid)).not.toContain(E503.uid)
  expect(r.events.filter((e) => e.type === 'discarded')).toEqual([])
})

it('banks the alarm with the Debugger that answered it, alarm first', () => {
  const drawn = reduce(withTop(E503, [DBG]), { type: 'DRAW', player: 'p1', at: 1000 })
  const r = reduce(drawn.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'neutralize503', method: 'debugger' },
    at: 1001,
  })
  expect(r.events.map((e) => e.type)).toEqual(['neutralized', 'discarded', 'discarded'])
  const discards = r.events.filter((e) => e.type === 'discarded')
  // alarm first: the discard event ids are what give the exchange its layering
  // on the board, and each card lands on the scatter its own id produces (I7)
  expect(discards.map((e) => (e.type === 'discarded' ? e.card : null))).toEqual([
    'trigger-error-503',
    'protection-debugger',
  ])
  expect(discards.map((e) => (e.type === 'discarded' ? e.reason : null))).toEqual([
    'trigger',
    'neutralized',
  ])
  // both hang off the `neutralized` that caused them
  const cause = r.events.find((e) => e.type === 'neutralized')
  expect(discards.every((e) => e.parent === cause?.id)).toBe(true)
  expect(r.state.pending).toBeNull()
})

// "Пока стоит — trigger-error-503 ... игнорируются": nothing is asked, so
// nothing stands. The 503 is answered inside the draw that turned it up, in one
// batch, and Monitoring stays (#103 testing, problem 2). The competing reading —
// that Monitoring is one of three methods the player CHOOSES — is in
// docs/rules/backlog.md rather than settled here.
it('answers a 503 by itself when Monitoring stands, and Monitoring stays', () => {
  const s = withTop(E503, [])
  const guarded: GameState = {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1, release: { monitoring: MON } } },
  }
  const r = reduce(guarded, { type: 'DRAW', player: 'p1', at: 1000 })

  expect(r.state.pending).toBeNull()
  expect(r.state.players.p1.release.monitoring).toEqual(MON)
  expect(r.state.decks.discard.map((c) => c.uid)).toEqual([E503.uid])
  // the causal order every other answer keeps: the method, then what it banked
  expect(r.events.map((e) => e.type)).toEqual(['drawn', 'revealed', 'neutralized', 'discarded'])
})

// A Debugger cannot be spent on a threat that was never a threat: with
// Monitoring standing there is no decision to offer it to.
it('never offers to burn a Debugger while Monitoring stands', () => {
  const s = withTop(E503, [DBG])
  const guarded: GameState = {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1, release: { monitoring: MON } } },
  }
  const r = reduce(guarded, { type: 'DRAW', player: 'p1', at: 1000 })
  expect(r.state.pending).toBeNull()
  expect(r.state.players.p1.hand.map((c) => c.uid)).toContain(DBG.uid)
})

it('banks the alarm when a release is sacrificed for it', () => {
  const s = withTop(E503, [])
  const holding: GameState = {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1, release: { frontend: { card: FE } } } },
  }
  const drawn = reduce(holding, { type: 'DRAW', player: 'p1', at: 1000 })
  const r = reduce(drawn.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'neutralize503', method: 'sacrifice', card: FE.uid },
    at: 1001,
  })
  expect(r.events.map((e) => e.type)).toEqual([
    'neutralized',
    'discarded', // the alarm
    'releaseDestroyed',
    'discarded', // the release that paid for it
  ])
  expect(r.state.decks.discard.map((c) => c.uid)).toEqual([E503.uid, FE.uid])
  expect(r.state.players.p1.release.frontend).toBeUndefined()
})

it('still banks the alarm at once when there is no way out', () => {
  // the defenceless path is unchanged: nothing stands, because nothing is asked
  const r = reduce(withTop(E503, []), { type: 'DRAW', player: 'p1', at: 1000 })
  expect(r.state.pending).toBeNull()
  expect(r.state.decks.discard.map((c) => c.uid)).toContain(E503.uid)
  expect(r.state.eliminated).toEqual(['p1'])
})

it('projects the alarm card to everyone at the table', () => {
  const drawn = reduce(withTop(E503, [DBG]), { type: 'DRAW', player: 'p1', at: 1000 })
  // the rules make the reveal mandatory, so the card is public — not gated on
  // `mine` the way an owner-only option list is
  for (const viewer of ['p1', 'p2'] as const) {
    const view = project(drawn.state, viewer)
    expect(view.pending).toMatchObject({ kind: 'neutralize503', card: 'trigger-error-503' })
  }
})

// Stacks `trigger-ai` as the next draw and shrinks the events deck to a
// single entry, so which event fires is not the shuffle's decision — same
// pattern eventCards.test.ts and aiEvents.test.ts use to drive one specific
// AI event.
const withAiEvent = (event: CardInstance, hand: CardInstance[] = []): GameState => {
  // A non-colliding uid suffix: the real deck already carries its own
  // `trigger-ai#0..N`, unremoved elsewhere in the pile, so reusing `#0` here
  // would plant a genuine duplicate uid for the conservation check below to
  // trip over. Same fix eventCards.test.ts's own `AI` fixture uses (`#ai0`).
  const ai: CardInstance = { uid: 'trigger-ai#ai0', id: 'trigger-ai' }
  const s = engine.createGame(config())
  return {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1, hand } },
    decks: { ...s.decks, main: [[ai, ...s.decks.main[0]]], events: [event] },
  }
}

it('sends the ai-error-503 mimic home to the events deck, never to the discard', () => {
  // `resolveAiEvent`'s `ai-error-503` branch sets `card: null` on the
  // `neutralize503` pending it raises: `fireTrigger`'s `trigger-ai` branch has
  // already returned this event card to `decks.events` by the time the
  // pending exists, so there is no card standing anywhere for a neutralize
  // answer to bank alongside it. A regression that gave the pending the real
  // card would make `bankAlarm` discard it — landing the same uid in both
  // `decks.events` and `decks.discard` at once.
  const event: CardInstance = { uid: 'ai-error-503#e0', id: 'ai-error-503' }
  const drawn = reduce(withAiEvent(event, [DBG]), { type: 'DRAW', player: 'p1', at: 1000 })
  // A Debugger in hand means a `neutralize503` pending is actually raised,
  // not an immediate elimination — and its card is null from the start.
  // `source` names the AI card this prompt belongs to (resolveAiEvent's
  // ai-error-503 branch) — driven through the real trigger resolution, not a
  // state literal, so a regression that drops the field here is caught.
  expect(drawn.state.pending).toMatchObject({
    kind: 'neutralize503',
    card: null,
    source: 'ai-error-503',
  })

  const r = reduce(drawn.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'neutralize503', method: 'debugger' },
    at: 1001,
  })

  expect(r.state.decks.events.map((c) => c.uid)).toContain(event.uid)
  expect(r.state.decks.discard.map((c) => c.uid)).not.toContain(event.uid)

  // Conservation invariant for this card specifically: one uid, one place.
  // Scoped to `event.uid` rather than a whole-state uniqueness scan — this
  // file's fixtures (DBG, E503, …) already reuse `#0`-suffixed uids for hand
  // overrides without regard to what the real deck dealt elsewhere, so a
  // blanket scan would flag pre-existing fixture noise unrelated to this fix.
  // `conformance.ts`'s own realCardUids sweep (mirrored here) is what makes
  // this the same accounting; the regression this guards against is this
  // exact uid landing in two zones (`decks.events` and `decks.discard`) at
  // once, which is precisely what counting its occurrences catches.
  const allCards = [
    ...r.state.decks.main.flat(),
    ...r.state.decks.discard,
    ...r.state.decks.events,
    ...Object.values(r.state.players).flatMap((p) => [
      ...p.hand,
      ...(['frontend', 'backend', 'database'] as const).flatMap((slot) => {
        const rel = p.release[slot]
        return rel ? [rel.card, ...(rel.codeReview ? [rel.codeReview] : [])] : []
      }),
      ...(p.release.monitoring ? [p.release.monitoring] : []),
    ]),
  ]
  expect(allCards.filter((c) => c.uid === event.uid)).toHaveLength(1)
})

it('spends a Debugger to neutralize', () => {
  const drawn = reduce(withTop(E503, [DBG]), { type: 'DRAW', player: 'p1', at: 1000 })
  const r = reduce(drawn.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'neutralize503', method: 'debugger' },
    at: 1001,
  })
  expect(r.state.pending).toBeNull()
  expect(r.state.players.p1.hand).toEqual([])
  expect(r.state.decks.discard.map((c) => c.uid)).toEqual(
    expect.arrayContaining([DBG.uid, E503.uid]),
  )
})

it('lets Monitoring absorb it and survive', () => {
  const s = withTop(E503, [])
  const guarded: GameState = {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1, release: { monitoring: MON } } },
  }
  const r = reduce(guarded, { type: 'DRAW', player: 'p1', at: 1000 })
  expect(r.state.pending).toBeNull()
  expect(r.state.players.p1.release.monitoring).toEqual(MON)
  expect(r.state.decks.discard.map((c) => c.uid)).toContain(E503.uid)
})

it('sacrifices a release when that is the only way out', () => {
  const s = withTop(E503, [])
  const holding: GameState = {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1, release: { frontend: { card: FE } } } },
  }
  const drawn = reduce(holding, { type: 'DRAW', player: 'p1', at: 1000 })
  expect(drawn.state.pending).toMatchObject({ methods: ['sacrifice'] })
  const r = reduce(drawn.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'neutralize503', method: 'sacrifice', card: FE.uid },
    at: 1001,
  })
  expect(r.state.players.p1.release.frontend).toBeUndefined()
  expect(r.state.eliminated).toEqual([])
})

it('eliminates a player with no way to neutralize, ending the game', () => {
  const r = reduce(withTop(E503, []), { type: 'DRAW', player: 'p1', at: 1000 })
  expect(r.state.pending).toBeNull()
  expect(r.state.eliminated).toEqual(['p1'])
  expect(r.state.over).toEqual({ winner: 'p2', condition: 'lastStanding' })
  expect(r.events.map((e) => e.type)).toEqual(
    expect.arrayContaining(['revealed', 'eliminated', 'gameOver']),
  )
})

it('reveals an AI trigger together with the event it pulls', () => {
  const ai: CardInstance = { uid: 'trigger-ai#0', id: 'trigger-ai' }
  const r = reduce(withTop(ai, []), { type: 'DRAW', player: 'p1', at: 1000 })
  const revealed = r.events.find((e) => e.type === 'aiRevealed')
  expect(revealed).toBeDefined()
  expect(revealed?.visibleTo).toBeUndefined()
  // The trigger goes to the discard; the event card belongs to its own deck.
  expect(r.state.decks.discard.map((c) => c.uid)).toContain(ai.uid)
  // "общее число её карт в игре — 21: каждая либо в колоде, либо на столе"
  // (general.md §6.4). A one-off effect is back in the deck already; one that
  // stays on the table is counted where it stands, so the total is the
  // assertion and the deck's own length is not.
  const onTable = Object.values(r.state.players).flatMap((p) => [
    ...(p.release.monitoring?.event ? [p.release.monitoring] : []),
    ...(['frontend', 'backend', 'database'] as const).flatMap((slot) =>
      p.release[slot]?.card.event ? [p.release[slot]?.card] : [],
    ),
  ])
  expect(r.state.decks.events.length + onTable.length).toBe(
    FAKE_EVENTS.reduce((n, e) => n + e.qty, 0),
  )
})

// --- Review findings: discarded events on every trigger-caused discard ---

it('discards the revealed Error 503 itself, parented to the reveal, when there is no way out', () => {
  // Unlike the with-a-neutralize-option case above, nothing is asked here, so
  // there is nothing to hold: the alarm is banked at once, same as before.
  const r = reduce(withTop(E503, []), { type: 'DRAW', player: 'p1', at: 1000 })
  const revealed = r.events.find((e) => e.type === 'revealed')
  const discarded = r.events.find((e) => e.type === 'discarded' && e.card === 'trigger-error-503')
  expect(revealed).toBeDefined()
  expect(discarded).toMatchObject({ player: 'p1', reason: 'trigger', parent: revealed?.id })
})

it('discards the revealed AI trigger itself, parented to the AI reveal', () => {
  const ai: CardInstance = { uid: 'trigger-ai#0', id: 'trigger-ai' }
  const r = reduce(withTop(ai, []), { type: 'DRAW', player: 'p1', at: 1000 })
  const revealed = r.events.find((e) => e.type === 'aiRevealed')
  const discarded = r.events.find((e) => e.type === 'discarded' && e.card === 'trigger-ai')
  expect(revealed).toBeDefined()
  expect(discarded).toMatchObject({ player: 'p1', reason: 'trigger', parent: revealed?.id })
})

it('discards a spent Debugger, parented to the neutralized event', () => {
  const drawn = reduce(withTop(E503, [DBG]), { type: 'DRAW', player: 'p1', at: 1000 })
  const r = reduce(drawn.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'neutralize503', method: 'debugger' },
    at: 1001,
  })
  const neutralized = r.events.find((e) => e.type === 'neutralized')
  const discarded = r.events.find((e) => e.type === 'discarded' && e.card === 'protection-debugger')
  expect(neutralized).toBeDefined()
  expect(discarded).toMatchObject({ player: 'p1', reason: 'neutralized', parent: neutralized?.id })
})

it('discards a sacrificed release, parented to the neutralized event', () => {
  const s = withTop(E503, [])
  const holding: GameState = {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1, release: { frontend: { card: FE } } } },
  }
  const drawn = reduce(holding, { type: 'DRAW', player: 'p1', at: 1000 })
  const r = reduce(drawn.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'neutralize503', method: 'sacrifice', card: FE.uid },
    at: 1001,
  })
  const neutralized = r.events.find((e) => e.type === 'neutralized')
  const discarded = r.events.find((e) => e.type === 'discarded' && e.card === 'release-frontend')
  expect(neutralized).toBeDefined()
  expect(discarded).toMatchObject({ player: 'p1', reason: 'neutralized', parent: neutralized?.id })
})

it("discards an eliminated player's hand, parented to the eliminated event", () => {
  const bug: CardInstance = { uid: 'attack-bug#0', id: 'attack-bug' }
  const r = reduce(withTop(E503, [bug]), { type: 'DRAW', player: 'p1', at: 1000 })
  expect(r.state.eliminated).toEqual(['p1'])
  const eliminated = r.events.find((e) => e.type === 'eliminated')
  const discarded = r.events.find((e) => e.type === 'discarded' && e.card === 'attack-bug')
  expect(eliminated).toBeDefined()
  expect(discarded).toMatchObject({ player: 'p1', reason: 'effect', parent: eliminated?.id })
})

// --- Review finding: an ai-release-* placement must remain a plain, playable
// release once it is bounced back to hand — not stuck as an unplayable 'ai'
// card. Exercised end to end: AI event places it, DDoS returns it to hand and
// freezes it for one round, the freeze lifts when the owner's own turn ends,
// and only then is it playable again. ---

it('keeps an AI-placed release playable after a DDoS bounce and thaw', () => {
  const events: GameConfig['events'] = [{ id: 'ai-release-frontend', qty: 1 }]
  const cfg: GameConfig = {
    gameId: 'g2',
    seed: 4242,
    players: [
      { id: 'p1', name: 'you' },
      { id: 'p2', name: 'kernel_panic' },
    ],
    setup: BASE,
    deck: FAKE_DECK,
    events,
  }
  const base = engine.createGame(cfg)
  const ai: CardInstance = { uid: 'trigger-ai#0', id: 'trigger-ai' }
  // `releaseCond: 'base'` makes a release cost a second card, so p1 holds one
  // spare for the final assertion to be about the thaw rather than the cost.
  // Code Review is never playable on its own, so it cannot itself appear in the
  // `playableFor` results checked below.
  const spare: CardInstance = { uid: 'support-code-review#0', id: 'support-code-review' }
  const s: GameState = {
    ...base,
    players: {
      ...base.players,
      p1: { ...base.players.p1, hand: [spare] },
    },
    decks: { ...base.decks, main: [[ai, ...base.decks.main[0]]] },
  }

  // p1 draws the AI trigger; the single-entry event deck deterministically
  // pulls ai-release-frontend regardless of the rng cursor.
  const drawn = reduce(s, { type: 'DRAW', player: 'p1', at: 1000 })
  expect(drawn.state.players.p1.release.frontend?.card.id).toBe('release-frontend')
  const placedUid = drawn.state.players.p1.release.frontend?.card.uid as string

  // The AI-placed release is attackable, so it opens a reaction window, and no
  // turn ends while one is open. Nobody throws anything, so it times out.
  const settled = reduce(drawn.state, {
    type: 'WINDOW_EXPIRED',
    at: drawn.state.window?.deadline ?? 1001,
  })

  // End p1's turn.
  const p1Pushed = reduce(settled.state, { type: 'PUSH', player: 'p1', at: 1001 })
  expect(p1Pushed.state.turn.player).toBe('p2')

  // p2 DDoS's the placed release: it bounces to p1's hand and freezes.
  const ddos: CardInstance = { uid: 'attack-ddos#0', id: 'attack-ddos' }
  const p2Armed: GameState = {
    ...p1Pushed.state,
    players: { ...p1Pushed.state.players, p2: { ...p1Pushed.state.players.p2, hand: [ddos] } },
  }
  const bounced = reduce(p2Armed, {
    type: 'PLAY',
    player: 'p2',
    card: ddos.uid,
    target: { kind: 'release', player: 'p1', slot: 'frontend' },
    at: 1002,
  })
  expect(bounced.state.players.p1.release.frontend).toBeUndefined()
  expect(bounced.state.players.p1.hand.map((c) => c.uid)).toContain(placedUid)
  expect(bounced.state.players.p1.frozen).toContain(placedUid)

  // p2 ends their turn (skip drawing — hasDrawn is set directly, as `withTop`-
  // style helpers elsewhere in this file already construct state directly).
  const p2Done: GameState = { ...bounced.state, turn: { ...bounced.state.turn, drawnFrom: [0] } }
  const toP1 = reduce(p2Done, { type: 'PUSH', player: 'p2', at: 1003 })
  expect(toP1.state.turn.player).toBe('p1')
  expect(toP1.state.players.p1.frozen).toContain(placedUid)

  // p1's turn while still frozen: not playable yet.
  expect(playableFor(toP1.state, 'p1')).not.toContain(placedUid)

  // p1 ends this turn — the freeze lifts as their own turn ends.
  const p1Done: GameState = { ...toP1.state, turn: { ...toP1.state.turn, drawnFrom: [0] } }
  const toP2 = reduce(p1Done, { type: 'PUSH', player: 'p1', at: 1004 })
  expect(toP2.state.players.p1.frozen).toEqual([])

  // Back to p2, then back to p1: now it must be playable.
  const p2Done2: GameState = { ...toP2.state, turn: { ...toP2.state.turn, drawnFrom: [0] } }
  const backToP1 = reduce(p2Done2, { type: 'PUSH', player: 'p2', at: 1005 })
  expect(backToP1.state.turn.player).toBe('p1')
  expect(playableFor(backToP1.state, 'p1')).toContain(placedUid)
})

// ===== declining a 503 (#103 testing, problem 4) =====
//
// The card says the player выбывает "если не нейтрализует карту одним из трёх
// способов" — it names no obligation to use a способ you happen to hold, so a
// player who can answer and would rather not is declining, not cheating. The
// board has always offered the key for it (`deriveDock` shows PASS through a
// pending of your own) and every press was rejected in silence, because no
// action behind it existed. See docs/rules/backlog.md — the reading is written
// down there rather than settled here.
it('lets a player who will not neutralize decline, and eliminates them for it', () => {
  const drawn = reduce(withTop(E503, [DBG]), { type: 'DRAW', player: 'p1', at: 1000 })
  expect(drawn.state.pending).toMatchObject({ kind: 'neutralize503' })

  const r = reduce(drawn.state, { type: 'PASS', player: 'p1', at: 1001 })

  expect(r.state.pending).toBeNull()
  expect(r.state.eliminated).toEqual(['p1'])
  // the alarm is banked exactly as it is on every other route out of a 503
  expect(r.state.decks.discard.map((c) => c.uid)).toContain(E503.uid)
  expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(['discarded', 'eliminated']))
})

it('takes the declining player’s whole table with them, hand and zone', () => {
  const holding = withTop(E503, [DBG])
  const withZone: GameState = {
    ...holding,
    players: {
      ...holding.players,
      p1: { ...holding.players.p1, release: { frontend: { card: FE } } },
    },
  }
  const drawn = reduce(withZone, { type: 'DRAW', player: 'p1', at: 1000 })
  const r = reduce(drawn.state, { type: 'PASS', player: 'p1', at: 1001 })

  expect(r.state.players.p1.hand).toEqual([])
  expect(r.state.players.p1.release.frontend).toBeUndefined()
  // the Debugger they declined to spend goes with the rest of the hand
  expect(r.state.decks.discard.map((c) => c.uid)).toContain(DBG.uid)
})

it('refuses a decline from anyone but the player the decision is owed by', () => {
  const drawn = reduce(withTop(E503, [DBG]), { type: 'DRAW', player: 'p1', at: 1000 })
  const r = reduce(drawn.state, { type: 'PASS', player: 'p2', at: 1001 })
  expect(r.state.eliminated).toEqual([])
  expect(r.events.some((e) => e.type === 'rejected')).toBe(true)
})
