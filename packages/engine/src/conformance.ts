import type { Action, Target } from './actions'
import { rulesFor } from './cards'
import type { DeckEntry, Engine, GameConfig } from './engine'
import type { Event } from './events'
import { botAction } from './fake/bots'
import { randomAt } from './rng'
import type { GameState, PlayerId, ReleaseSlot, Setup } from './state'

export interface ConformanceOptions {
  deck: DeckEntry[]
  events: DeckEntry[]
}

const BASE_SETUP: Setup = {
  handLimit: 'base',
  releases: 'base',
  releaseCond: 'base',
  ai: 'base',
  gitBranch: 'base',
}

// BASE_SETUP's hand limit is unbounded, so endTurn's overflow branch and
// onHandLimit's committing path are otherwise dead code for this whole suite.
// A 5-card limit collides with the 5-card opening hand on the very first draw.
const MEMORY_SETUP: Setup = { ...BASE_SETUP, handLimit: 'memory' }

const configFor = (options: ConformanceOptions, seed: number, setup = BASE_SETUP): GameConfig => ({
  gameId: 'conformance',
  seed,
  players: [
    { id: 'p1', name: 'one' },
    { id: 'p2', name: 'two' },
    { id: 'p3', name: 'three' },
  ],
  setup,
  deck: options.deck,
  events: options.events,
})

// The fuzz clock. A reaction window's deadline is `at_open + 15000` on its
// first round and `+ 10000` after (see fake/window.ts). Advancing `at` by only
// 1 per step, as a per-action counter would, makes every deadline forever in
// the future — `onWindowExpired`'s guard could never fire naturally, and the
// entire expiry path (one of only two ways a window closes) went unexercised.
// 1000ms per step makes a round-1 window expirable about 15 steps after it
// opens, which is fast enough to reach within a 400-step run, while still
// spending roughly those same 15 steps with a premature WINDOW_EXPIRED
// correctly rejecting on "the window has not expired" — both paths get
// exercised, not just the accepting one.
const atFor = (n: number): number => 1000 + n * 1000

// Builds a valid choice from the data a pending decision itself carries, so the
// fuzz stream always resolves what it opens instead of stalling on it. Left to
// the random RESOLVE branch below (which only ever proposes a 'defend'
// choice), any pending kind would perpetually reject as "wrong choice for this
// decision" — `onDraw`/`onPush` also reject outright while `pending` is set,
// so turn rotation freezes for the remainder of the stream and every property
// built on `drive()` silently stops exercising anything past that point. A
// pending kind with no case here falls through to `null`, i.e. to that same
// random RESOLVE branch — the 'resolves every pending decision' property
// below is what turns that silent stall into a failing test instead. A later
// task that adds a new Pending variant (neutralize503, crush) adds a case here.
function resolvePendingAction(state: GameState, n: number): Action | null {
  const { pending } = state
  if (!pending) return null
  const at = atFor(n)
  switch (pending.kind) {
    case 'handLimit': {
      const hand = state.players[pending.player].hand
      const cards = hand.slice(0, pending.excess).map((c) => c.uid)
      return { type: 'RESOLVE', player: pending.player, choice: { kind: 'handLimit', cards }, at }
    }
    case 'discardForRelease': {
      const hand = state.players[pending.player].hand
      // Neither the release nor its comboed Code Review can pay its own cost —
      // onPlay already guaranteed a spare exists before opening this pending.
      const spare = hand.find((c) => c.uid !== pending.release && c.uid !== pending.codeReview)
      if (!spare) return null
      return {
        type: 'RESOLVE',
        player: pending.player,
        choice: { kind: 'discardForRelease', card: spare.uid },
        at,
      }
    }
    case 'defend': {
      // Defend with the first legal card if one is held, otherwise take the hit
      // (`null`) — either way the pending resolves in one step.
      const card = pending.canDefendWith[0] ?? null
      return { type: 'RESOLVE', player: pending.player, choice: { kind: 'defend', card }, at }
    }
    case 'requestCard': {
      // Guess the target's first held card's type if any, otherwise a fixed
      // id that is certain to miss — either way the pending resolves in one step.
      const targetHand = state.players[pending.target].hand
      const card = targetHand[0]?.id ?? 'attack-bug'
      return { type: 'RESOLVE', player: pending.player, choice: { kind: 'requestCard', card }, at }
    }
    case 'giveCard': {
      // onRequestCard only opens this pending once it has confirmed the holder
      // has a matching card, so this lookup cannot fail.
      const hand = state.players[pending.player].hand
      const match = hand.find((c) => c.id === pending.requested)
      if (!match) return null
      return {
        type: 'RESOLVE',
        player: pending.player,
        choice: { kind: 'giveCard', card: match.uid },
        at,
      }
    }
    case 'neutralize503': {
      // fireTrigger only ever offers a method this player can actually pay
      // for, so the first one is always valid — resolving in one step either
      // way.
      const method = pending.methods[0]
      if (!method) return null
      if (method === 'sacrifice') {
        const slots = ['frontend', 'backend', 'database'] as const
        const slot = slots.find((s) => state.players[pending.player].release[s])
        const card = slot && state.players[pending.player].release[slot]?.card.uid
        if (!card) return null
        return {
          type: 'RESOLVE',
          player: pending.player,
          choice: { kind: 'neutralize503', method, card },
          at,
        }
      }
      return {
        type: 'RESOLVE',
        player: pending.player,
        choice: { kind: 'neutralize503', method },
        at,
      }
    }
    case 'crush': {
      // resolveAiEvent only ever offers a method this player can actually pay
      // for, so the first one is always valid — resolving in one step either
      // way.
      const method = pending.methods[0]
      if (!method) return null
      if (method === 'sacrifice') {
        const slots = ['frontend', 'backend', 'database'] as const
        const slot = slots.find((s) => state.players[pending.player].release[s])
        const card = slot && state.players[pending.player].release[slot]?.card.uid
        if (!card) return null
        return {
          type: 'RESOLVE',
          player: pending.player,
          choice: { kind: 'crush', method, card },
          at,
        }
      }
      return {
        type: 'RESOLVE',
        player: pending.player,
        choice: { kind: 'crush', method },
        at,
      }
    }
    case 'pickFromDiscard': {
      // openPickFromDiscard only ever offers a nonempty list, so the first
      // option is always valid; the second pick only exists when `picks` is 2.
      const card = pending.options[0]?.uid
      if (!card) return null
      const toDeck = pending.picks === 2 ? pending.options[1]?.uid : undefined
      return {
        type: 'RESOLVE',
        player: pending.player,
        choice: { kind: 'pickFromDiscard', card, ...(toDeck ? { toDeck } : {}) },
        at,
      }
    }
    default:
      return null
  }
}

// Picks a plausible target for a held card, if it is an attack. Undefined for
// any other card (PLAY ignores `target` when it does not apply) and for an
// attack with nowhere to land, which exercises onPlay's own "needs a target" /
// "illegal target" rejections instead.
function attackTarget(
  state: GameState,
  actor: PlayerId,
  cardId: string | undefined,
  seed: number,
  n: number,
): Target | undefined {
  if (!cardId || rulesFor(cardId)?.kind !== 'attack') return undefined
  const others = state.seating.filter((id) => id !== actor && !state.eliminated.includes(id))
  if (others.length === 0) return undefined
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(randomAt(seed, n * 8 + 6) * items.length)]

  if (cardId !== 'attack-ddos') return { kind: 'player', player: pick(others) }

  const targets: Target[] = []
  for (const id of others) {
    if (state.players[id].release.monitoring) targets.push({ kind: 'monitoring', player: id })
    for (const slot of ['frontend', 'backend', 'database'] as const) {
      if (state.players[id].release[slot]) targets.push({ kind: 'release', player: id, slot })
    }
  }
  return targets.length > 0 ? pick(targets) : undefined
}

// A deterministic pseudo-random action stream. Deliberately includes illegal
// actions — most of these will be rejected, which is exactly what totality means.
function fuzzAction(state: GameState, seed: number, n: number): Action {
  const resolving = resolvePendingAction(state, n)
  if (resolving) return resolving

  const pick = <T>(items: readonly T[], salt: number): T =>
    items[Math.floor(randomAt(seed, n * 8 + salt) * items.length)]
  const player: PlayerId = pick(state.seating, 1)
  const hand = state.players[player].hand
  const uid = hand.length > 0 ? pick(hand, 2).uid : 'no-such-card'
  const at = atFor(n)

  // An attack card is only ever legally played with a target, and onPlay now
  // rejects one outright without it — a fuzzer that never attaches a target
  // would leave the whole attack path (and everything reachable only through
  // it: hand theft, Security Bug's request/give handoff, DDoS) permanently
  // unreached, which would in turn silently hide any regression there from
  // every property in this file, `progress` included.
  const held = hand.find((c) => c.uid === uid)
  const target = attackTarget(state, player, held?.id, seed, n)

  const kind = Math.floor(randomAt(seed, n * 8 + 3) * 7)
  switch (kind) {
    case 0:
      return { type: 'DRAW', player, at }
    case 1:
      return { type: 'PUSH', player, at }
    case 2:
      return { type: 'PLAY', player, card: uid, ...(target ? { target } : {}), at }
    case 3:
      return { type: 'ATTACK', player, card: uid, at }
    case 4:
      return { type: 'PASS', player, at }
    case 5:
      return { type: 'WINDOW_EXPIRED', at }
    default:
      return { type: 'RESOLVE', player, choice: { kind: 'defend', card: null }, at }
  }
}

// Forces a Code Review combo whenever the turn player holds both a release for
// an open slot and a Code Review. The plain fuzz stream never attaches a
// combo (see `fuzzAction`'s PLAY case), so left alone it would never produce a
// Code Review-protected release at all, leaving the "protected release opens
// no window" property permanently vacuous. Falls through to ordinary fuzzing
// whenever the combo is not currently possible.
function forceCodeReviewCombo(state: GameState, n: number): Action | null {
  if (state.pending || state.window || state.over) return null
  const player = state.turn.player
  const releaseCap = state.setup.releases === 'fast' ? Number.POSITIVE_INFINITY : 1
  if (state.turn.releasesPlayed >= releaseCap) return null
  const hand = state.players[player].hand
  const codeReview = hand.find((c) => c.id === 'support-code-review')
  if (!codeReview) return null
  const release = hand.find((c) => {
    const rules = rulesFor(c.id)
    return rules?.kind === 'release' && !state.players[player].release[rules.slot as ReleaseSlot]
  })
  if (!release) return null
  return { type: 'PLAY', player, card: release.uid, combo: codeReview.uid, at: atFor(n) }
}

// Forces a DDoS onto a zone target (a Monitoring, or a Code Review-protected
// release) whenever the turn player holds a DDoS and one exists.
// `engine.legalTargets` is the same contract any real caller uses to find a
// target, so this does not reach into fake internals to locate one — it just
// removes the fuzz stream's randomness from which target gets picked, so a run
// reliably lands a DDoS on a zone target instead of maybe never doing so.
function forceDdosOnZone(engine: Engine, state: GameState, n: number): Action | null {
  if (state.pending || state.window || state.over) return null
  const player = state.turn.player
  const ddos = state.players[player].hand.find((c) => c.id === 'attack-ddos')
  if (!ddos) return null
  const targets = engine.legalTargets(state, player, ddos.uid)
  const zoneTarget = targets.find((t) => t.kind === 'release' || t.kind === 'monitoring')
  if (!zoneTarget) return null
  return { type: 'PLAY', player, card: ddos.uid, target: zoneTarget, at: atFor(n) }
}

// Drives a mixed stream — DDoS-onto-zone and Code Review combos forced
// whenever possible, ordinary fuzzing otherwise — and reports what it saw
// along the way. Shared by the two invariants that both need a protected
// release to exist: "no window opens for one" and "DDoS is the only card that
// reaches one".
function driveProtectedReleaseAndDdos(
  engine: Engine,
  options: ConformanceOptions,
  seed: number,
  steps: number,
) {
  let state = engine.createGame(configFor(options, seed))
  let sawProtectedRelease = false
  let sawWindowOnProtectedRelease = false
  let sawDdosOnProtectedRelease = false
  let sawDdosOnMonitoring = false
  let sawNonDdosZoneTarget = false

  for (let n = 0; n < steps && !state.over; n += 1) {
    const w = state.window
    if (w) {
      const target = state.players[w.target.player].release[w.target.slot]
      if (target?.codeReview) sawWindowOnProtectedRelease = true
    }
    for (const id of state.seating) {
      for (const slot of ['frontend', 'backend', 'database'] as const) {
        if (state.players[id].release[slot]?.codeReview) sawProtectedRelease = true
      }
    }
    // Only meaningful while a card is actually choosable — during a pending
    // decision or an open window, `legalTargets` reflects that suspension
    // rather than what the card could otherwise reach.
    if (!state.pending && !state.window) {
      const actor = state.turn.player
      for (const c of state.players[actor].hand) {
        if (rulesFor(c.id)?.kind !== 'attack' || c.id === 'attack-ddos') continue
        const targets = engine.legalTargets(state, actor, c.uid)
        if (targets.some((t) => t.kind === 'release' || t.kind === 'monitoring')) {
          sawNonDdosZoneTarget = true
        }
      }
    }

    const action =
      forceDdosOnZone(engine, state, n) ??
      forceCodeReviewCombo(state, n) ??
      fuzzAction(state, seed, n)

    if (action.type === 'PLAY' && action.target) {
      const held = state.players[action.player].hand.find((c) => c.uid === action.card)
      if (held?.id === 'attack-ddos') {
        if (action.target.kind === 'monitoring') sawDdosOnMonitoring = true
        if (action.target.kind === 'release') {
          const before = state.players[action.target.player].release[action.target.slot]
          if (before?.codeReview) sawDdosOnProtectedRelease = true
        }
      }
    }

    state = engine.reduce(state, action).state
  }

  return {
    sawProtectedRelease,
    sawWindowOnProtectedRelease,
    sawDdosOnProtectedRelease,
    sawDdosOnMonitoring,
    sawNonDdosZoneTarget,
  }
}

// Every card instance the game is holding, wherever it is: hands, zones, piles,
// discard, and the events deck.
//
// Nothing is excluded any more. Under the phantom model a placement was a
// second representation of a card that was already back in its deck, so it had
// to be filtered out or the total would climb legitimately. An event card now
// *is* the card standing on the table (#93, general.md §6.4), counted once
// wherever it happens to be.
function realCardUids(state: GameState): string[] {
  const uids = [
    ...state.decks.main.flat(),
    ...state.decks.discard,
    ...state.decks.events,
    ...Object.values(state.players).flatMap((p) => [
      ...p.hand,
      // The three release slots hold { card, codeReview? }; `monitoring` holds
      // the instance itself, so it cannot go through the same branch.
      ...(['frontend', 'backend', 'database'] as const).flatMap((slot) => {
        const r = p.release[slot]
        return r ? [r.card, ...(r.codeReview ? [r.codeReview] : [])] : []
      }),
      ...(p.release.monitoring ? [p.release.monitoring] : []),
    ]),
  ].map((c) => c.uid)
  // A thrown attack card is in mid-air while a `defend` is owed: out of the
  // attacker's hand and not yet anywhere else. It is still very much in the
  // game, so a stream that simply ends while one is open must not read as a
  // loss — that is a snapshot artefact, not a leaked card.
  if (state.pending?.kind === 'defend') uids.push(state.pending.attack)
  // The alarm while its answer is being chosen — same mid-air state as a thrown
  // attack above, and the same reason a stream ending here must not read as a
  // lost card. Null for the ai-error-503 mimic, which holds no card here.
  if (state.pending?.kind === 'neutralize503' && state.pending.card) {
    uids.push(state.pending.card.uid)
  }
  return uids.sort()
}

function drive(engine: Engine, state: GameState, seed: number, steps: number) {
  let current = state
  const events: Event[] = []
  for (let n = 0; n < steps; n += 1) {
    const r = engine.reduce(current, fuzzAction(current, seed, n))
    current = r.state
    events.push(...r.events)
  }
  return { state: current, events }
}

export function describeEngine(
  name: string,
  make: () => Engine,
  options: ConformanceOptions,
): void {
  describe(`engine conformance: ${name}`, () => {
    describe('setup', () => {
      it('deals every seated player an opening hand, and says so', () => {
        const engine = make()
        const state = engine.createGame(configFor(options, 4242))
        const events = engine.setupEvents(state)
        const dealt = events.filter((e) => e.type === 'dealt')
        expect(dealt).toHaveLength(state.seating.length)
        for (const e of dealt) {
          if (e.type !== 'dealt') continue
          expect(e.count).toBe(state.players[e.player].hand.length)
          // `open` may only name cards the player actually holds.
          for (const id of e.open ?? []) {
            expect(state.players[e.player].hand.some((c) => c.id === id)).toBe(true)
          }
        }
      })
    })

    describe('determinism', () => {
      it('builds an identical game from an identical config', () => {
        const a = make().createGame(configFor(options, 777))
        const b = make().createGame(configFor(options, 777))
        expect(a).toEqual(b)
      })

      it('diverges on a different seed', () => {
        const a = make().createGame(configFor(options, 777))
        const b = make().createGame(configFor(options, 778))
        // `state.seed` is copied verbatim from config.seed, so a whole-state
        // `not.toEqual` would pass trivially on that one scalar even if the
        // shuffle and deal ignored the seed entirely. Assert on seed-derived
        // output instead: the draw-pile order and the dealt hands.
        expect(a.decks.main[0].map((c) => c.uid)).not.toEqual(b.decks.main[0].map((c) => c.uid))
        const handsA = a.seating.map((id) => a.players[id].hand.map((c) => c.uid))
        const handsB = b.seating.map((id) => b.players[id].hand.map((c) => c.uid))
        expect(handsA).not.toEqual(handsB)
      })

      it('yields identical state and events for an identical action stream', () => {
        const engine = make()
        const start = engine.createGame(configFor(options, 4242))
        const a = drive(engine, start, 31, 120)
        const b = drive(make(), engine.createGame(configFor(options, 4242)), 31, 120)
        expect(a.state).toEqual(b.state)
        expect(a.events).toEqual(b.events)
      })

      it('does not mutate the state handed to reduce, at every step', () => {
        const engine = make()
        let current = engine.createGame(configFor(options, 4242))
        // `drive()` reassigns `current` to the new state after each call, so
        // comparing only the very first input against a single snapshot would
        // never catch a `reduce` that mutates its argument on a later,
        // non-initial call — the likelier bug. Snapshot and compare every step.
        for (let n = 0; n < 60; n += 1) {
          const before = structuredClone(current)
          const r = engine.reduce(current, fuzzAction(current, 5, n))
          expect(current).toEqual(before)
          current = r.state
        }
      })
    })

    describe('tally', () => {
      it('seeds a counter for every seat, all at zero', () => {
        const engine = make()
        const state = engine.createGame(configFor(options, 4242))
        expect(Object.keys(state.tally).sort()).toEqual([...state.seating].sort())
        for (const id of state.seating) {
          expect(Object.values(state.tally[id]).every((n) => n === 0)).toBe(true)
        }
      })

      it('never lets a counter go backwards', () => {
        // The one invariant that holds for every metric under every rules
        // change: these are occurrence counts, so a reduction may add to them
        // and may leave them alone, but may never subtract.
        const engine = make()
        let state = engine.createGame(configFor(options, 4242))
        for (let n = 0; n < 400; n += 1) {
          const r = engine.reduce(state, fuzzAction(state, 5, n))
          for (const id of state.seating) {
            const before = state.tally[id]
            const after = r.state.tally[id]
            for (const key of Object.keys(before) as (keyof typeof before)[]) {
              expect(after[key]).toBeGreaterThanOrEqual(before[key])
            }
          }
          state = r.state
        }
      })

      it('counts every attack that was logged, and no others', () => {
        // The tally is a fold over the log, so the log is what it must agree
        // with. `attacked` is public and never redacted, which makes it the one
        // metric a conformance suite can recount from the outside.
        const engine = make()
        let state = engine.createGame(configFor(options, 4242))
        const thrown: Record<string, number> = {}
        for (let n = 0; n < 400; n += 1) {
          const r = engine.reduce(state, fuzzAction(state, 5, n))
          for (const e of r.events) {
            if (e.type === 'attacked') thrown[e.attacker] = (thrown[e.attacker] ?? 0) + 1
          }
          state = r.state
        }
        for (const id of state.seating) {
          expect(state.tally[id].attack).toBe(thrown[id] ?? 0)
        }
        // Otherwise the assertion above is vacuous: nobody ever attacked.
        expect(Object.keys(thrown).length).toBeGreaterThan(0)
      })

      it('shows the tally to a viewer only once the match is over', () => {
        const engine = make()
        let state = engine.createGame(configFor(options, 3))
        let sawOpen = false
        for (let n = 0; n < 2200; n += 1) {
          const view = engine.project(state, state.seating[0])
          if (state.over) {
            expect(view.tally).not.toBeNull()
            expect(Object.keys(view.tally ?? {}).sort()).toEqual([...state.seating].sort())
          } else {
            expect(view.tally).toBeNull()
            sawOpen = true
          }
          state = engine.reduce(state, fuzzAction(state, 3, n)).state
        }
        expect(sawOpen).toBe(true)
        // Seed 3 reaches gameOver around step 1821 (see 'ends exactly once'),
        // so the non-null half above is genuinely exercised.
        expect(state.over).not.toBeNull()
      })
    })

    describe('totality', () => {
      it('never throws across a long fuzz stream', () => {
        const engine = make()
        const start = engine.createGame(configFor(options, 99))
        expect(() => drive(engine, start, 17, 400)).not.toThrow()
      })

      it('never throws across a long fuzz stream under a constrained hand limit', () => {
        const engine = make()
        const start = engine.createGame(configFor(options, 99, MEMORY_SETUP))
        expect(() => drive(engine, start, 17, 400)).not.toThrow()
      })

      it('rejects an unrecognised action and leaves the state identical', () => {
        const engine = make()
        const start = engine.createGame(configFor(options, 99))
        const bogus = { type: 'NOT_AN_ACTION', player: 'p1', at: 1 } as unknown as Action
        const r = engine.reduce(start, bogus)
        expect(r.state).toBe(start)
        expect(r.events.map((e) => e.type)).toEqual(['rejected'])
      })

      it('keeps state structurally valid throughout the stream', () => {
        const engine = make()
        const start = engine.createGame(configFor(options, 55))
        const { state } = drive(engine, start, 23, 300)
        expect(state.seating).toHaveLength(3)
        for (const id of state.seating) expect(state.players[id]).toBeDefined()
        expect(state.decks.main.length).toBeGreaterThan(0)
        expect(state.eventSeq).toBeGreaterThanOrEqual(start.eventSeq)
      })

      it('keeps state structurally valid and actually resolves a hand-limit decision', () => {
        const engine = make()
        const start = engine.createGame(configFor(options, 55, MEMORY_SETUP))
        const { state, events } = drive(engine, start, 23, 300)
        expect(state.seating).toHaveLength(3)
        for (const id of state.seating) expect(state.players[id]).toBeDefined()
        expect(state.decks.main.length).toBeGreaterThan(0)
        expect(state.eventSeq).toBeGreaterThanOrEqual(start.eventSeq)
        // Proves onHandLimit's committing path actually ran, not merely that
        // its rejection guards were exercised.
        const discardedForHandLimit = events.some(
          (e) => e.type === 'discarded' && e.reason === 'handLimit',
        )
        expect(discardedForHandLimit).toBe(true)
      })

      it('never creates or loses a card across a long stream', () => {
        // One property covering the whole class: a deck that grows, a hand card
        // that evaporates, a release destroyed into nowhere. Each of those is
        // otherwise invisible until counts drift far enough for someone to
        // notice at the table, and #61's git operations turn the discard into a
        // draw pile, which is exactly when a stray instance starts circulating.
        const engine = make()
        const start = engine.createGame(configFor(options, 55))
        const before = realCardUids(start)
        const { state } = drive(engine, start, 23, 300)
        expect(realCardUids(state)).toEqual(before)
      })

      it('never lets a card from the events deck reach the discard', () => {
        // "Карта события никогда не уходит в общий сброс" (general.md §6.4).
        // The discard is recycled into a draw pile by the refill and by sudo
        // Git Merge, so an event card that landed there would start circulating
        // in the main deck.
        const engine = make()
        const start = engine.createGame(configFor(options, 55))
        const { state } = drive(engine, start, 23, 300)
        const eventIds = new Set(start.decks.events.map((c) => c.uid))
        expect(state.decks.discard.filter((c) => eventIds.has(c.uid))).toEqual([])
        expect(state.decks.main.flat().filter((c) => eventIds.has(c.uid))).toEqual([])
      })

      it('numbers every committed event uniquely and monotonically', () => {
        const engine = make()
        const start = engine.createGame(configFor(options, 55))
        const { events } = drive(engine, start, 23, 200)
        // A rejected action returns the state referentially unchanged (see
        // "rejects an unrecognised action" above), so its event's id is
        // necessarily a repeat of whatever the next id would be from that
        // unchanged state — that is not a defect, it falls directly out of the
        // no-mutation contract. Uniqueness and monotonicity are invariants of
        // the committed history, i.e. of events other than `rejected`.
        const committed = events.filter((e) => e.type !== 'rejected')
        const ids = committed.map((e) => e.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect([...ids].sort((x, y) => x - y)).toEqual(ids)
      })
    })

    describe('progress', () => {
      // The defect this guards against is silent, not loud. Two different
      // fields can each hold the stream hostage for the rest of a run, and
      // every other property in this file would keep passing while exercising
      // almost nothing past that point:
      //  - a pending decision the fuzzer cannot resolve holds `state.pending`
      //    (`onDraw`/`onPush` reject outright while it is set);
      //  - an open reaction window that never closes holds `state.window`
      //    (same rejection, different gate) — and closing is not guaranteed
      //    by unanimous PASS alone: it is probabilistic per responder per
      //    step, the fuzzer never emits UNPASS, and a window can also close
      //    by expiring once its deadline has passed.
      // This test is what turns either silent coverage loss into a red test.
      const driveProgress = (setup: Setup, seed: number) => {
        const engine = make()
        let state = engine.createGame(configFor(options, seed, setup))
        let pendingStreak = 0
        let maxPendingStreak = 0
        let windowStreak = 0
        let maxWindowStreak = 0
        // 900 steps, not 400: Security Bug's hand-scope miss opens a three-deep
        // decision chain (defend -> requestCard -> giveCard, see below), and
        // reaching all three under this seed needs roughly 650 steps to first
        // draw, play and miss a Security Bug at all. A shorter run would never
        // exercise `requestCard`/`giveCard` here, silently hiding a regression
        // in either from this property.
        for (let n = 0; n < 900; n += 1) {
          state = engine.reduce(state, fuzzAction(state, seed, n)).state
          pendingStreak = state.pending ? pendingStreak + 1 : 0
          maxPendingStreak = Math.max(maxPendingStreak, pendingStreak)
          windowStreak = state.window ? windowStreak + 1 : 0
          maxWindowStreak = Math.max(maxWindowStreak, windowStreak)
        }
        return { maxPendingStreak, maxWindowStreak, finalTurnIndex: state.turn.index }
      }

      it('resolves every pending decision instead of stalling the stream', () => {
        const { maxPendingStreak, maxWindowStreak, finalTurnIndex } = driveProgress(
          BASE_SETUP,
          2468,
        )
        // A lone decision resolves in the one step it is genuinely open. Security
        // Bug's hand-scope miss is the deepest legitimate chain: defend (open) ->
        // requestCard (the attacker names a type) -> giveCard (the holder
        // surrenders a copy), three consecutive steps each requiring a different
        // player's input, not a stall. A real stall still stands out sharply from
        // 3: it holds `pending` for the rest of the run (hundreds of steps).
        expect(maxPendingStreak).toBeLessThanOrEqual(3)
        // A window legitimately stays open for several steps while responders
        // decide, so `<= 1` is the wrong bound here, unlike for `pending`. The
        // fuzz clock (`atFor`) makes a round-1 deadline reachable ~15 steps
        // after opening; from there, the probability of *not* drawing a
        // WINDOW_EXPIRED action (1 of 7 fuzz kinds) within k more steps is
        // (6/7)^k, under 0.1% by k = 45 — so 60 is a generous but non-trivial
        // bound: comfortably above every legitimately-closing run observed in
        // this suite (max 29), while far below what an unclosable window
        // produces (330, observed by forcing one during verification).
        expect(maxWindowStreak).toBeLessThanOrEqual(60)
        // A stalled stream also never rotates the turn again. This threshold
        // is unattainable without genuinely resolving decisions and windows
        // the fuzz stream itself opens (hand-limit discards, release costs,
        // reaction windows, ...).
        expect(finalTurnIndex).toBeGreaterThan(8)
      })

      // BASE_SETUP's unbounded hand limit means a `handLimit` pending never
      // arises under it (see the totality describe above) — without this run,
      // a regression in that specific case would be invisible to this file.
      it('resolves every pending decision under a constrained hand limit', () => {
        const { maxPendingStreak, maxWindowStreak, finalTurnIndex } = driveProgress(
          MEMORY_SETUP,
          2468,
        )
        // Same bound as above, for the same reason (see that test's comment).
        expect(maxPendingStreak).toBeLessThanOrEqual(3)
        expect(maxWindowStreak).toBeLessThanOrEqual(60)
        expect(finalTurnIndex).toBeGreaterThan(8)
      })
    })

    describe('projection privacy', () => {
      // The property that would otherwise leak silently: nothing a viewer must not
      // know may appear anywhere in their view, at any point in a game.
      it('never exposes another hand or the ordered deck', () => {
        const engine = make()
        let state = engine.createGame(configFor(options, 2024))
        for (let n = 0; n < 150; n += 1) {
          for (const viewer of state.seating) {
            const serialized = JSON.stringify(engine.project(state, viewer))
            for (const other of state.seating) {
              if (other === viewer) continue
              for (const c of state.players[other].hand) {
                expect(serialized, `${viewer} can see ${other}'s ${c.uid}`).not.toContain(c.uid)
              }
            }
            for (const pile of state.decks.main) {
              for (const c of pile) {
                expect(serialized, `${viewer} can see deck card ${c.uid}`).not.toContain(c.uid)
              }
            }
            // The event deck is equally ordered and secret — Task 11's AI
            // event reveals make this load-bearing, not merely symmetric.
            for (const c of state.decks.events) {
              expect(serialized, `${viewer} can see event deck card ${c.uid}`).not.toContain(c.uid)
            }
          }
          state = engine.reduce(state, fuzzAction(state, 2024, n)).state
        }
      })

      it('reports opponents by hand count', () => {
        const engine = make()
        const state = engine.createGame(configFor(options, 2024))
        const view = engine.project(state, 'p1')
        expect(view.opponents.map((o) => o.id)).toEqual(['p2', 'p3'])
        for (const o of view.opponents) {
          expect(o.handCount).toBe(state.players[o.id].hand.length)
        }
      })

      it('offers no playable card to a player who is not on turn', () => {
        const engine = make()
        const state = engine.createGame(configFor(options, 2024))
        const idle = state.seating.filter((id) => id !== state.turn.player)
        for (const id of idle) expect(engine.project(state, id).self.playable).toEqual([])
      })

      it('never marks an unheld card as playable', () => {
        const engine = make()
        let state = engine.createGame(configFor(options, 8080))
        for (let n = 0; n < 120; n += 1) {
          for (const viewer of state.seating) {
            const view = engine.project(state, viewer)
            const held = new Set(state.players[viewer].hand.map((c) => c.uid))
            for (const uid of view.self.playable) expect(held.has(uid)).toBe(true)
          }
          state = engine.reduce(state, fuzzAction(state, 8080, n)).state
        }
      })
    })

    describe('legalTargets', () => {
      it('returns nothing for a card the actor cannot play', () => {
        const engine = make()
        const state = engine.createGame(configFor(options, 31337))
        expect(engine.legalTargets(state, 'p1', 'no-such-card')).toEqual([])
        const idle = state.seating.find((id) => id !== state.turn.player) as PlayerId
        const someCard = state.players[idle].hand[0].uid
        expect(engine.legalTargets(state, idle, someCard)).toEqual([])
      })

      it('never names the actor as their own target', () => {
        const engine = make()
        let state = engine.createGame(configFor(options, 31337))
        for (let n = 0; n < 80; n += 1) {
          const actor = state.turn.player
          for (const c of state.players[actor].hand) {
            for (const t of engine.legalTargets(state, actor, c.uid)) {
              if ('player' in t) expect(t.player).not.toBe(actor)
            }
          }
          state = engine.reduce(state, fuzzAction(state, 31337, n)).state
        }
      })
    })

    describe('rules invariants', () => {
      // Transcribed from docs/rules/rules-board-game.md and docs/understanding.md §7.
      // Each test states which driver it uses (the fuzz stream, `botAction`, or
      // a mix that forces a specific card interaction) and why that one reaches
      // the state in question reliably, rather than defaulting to the fuzz
      // stream everywhere out of habit.

      it('never assigns a release to the wrong zone slot', () => {
        // Fuzz-driven: this only needs *some* zone churn, not a deep decision
        // chain. Under this seed the game runs to completion (a release win)
        // around step 1811, filling all three slots along the way; 2200 steps
        // leaves margin without relying on a game that never ends.
        const engine = make()
        let state = engine.createGame(configFor(options, 6161))
        const sawSlot = { frontend: false, backend: false, database: false }
        for (let n = 0; n < 2200 && !state.over; n += 1) {
          for (const id of state.seating) {
            const zone = state.players[id].release
            for (const slot of ['frontend', 'backend', 'database'] as const) {
              const released = zone[slot]
              if (!released) continue
              sawSlot[slot] = true
              expect(released.card.id, `${id}'s ${slot} slot holds ${released.card.id}`).toBe(
                `release-${slot}`,
              )
            }
          }
          state = engine.reduce(state, fuzzAction(state, 6161, n)).state
        }
        // A slot never once filled would make its own check above vacuous.
        expect(sawSlot.frontend).toBe(true)
        expect(sawSlot.backend).toBe(true)
        expect(sawSlot.database).toBe(true)
      })

      it('respects the release cap in a turn under base, and lifts it under fast', () => {
        // Fuzz-driven under two setups: only the cap itself is at stake here,
        // not any deeper decision chain.
        //
        // Seed changed from 6262 when #61 slice B added Git Branch and Git
        // Merge to FAKE_DECK: a longer deck consumes a different amount of the
        // shuffle's RNG stream, so every fixed seed lands on a new trajectory
        // and 6262's fast run no longer happens to ship two releases in one
        // turn. The cap never broke — its witness stopped occurring.
        const engine = make()
        const fastSetup: Setup = { ...BASE_SETUP, releases: 'fast' }

        let base = engine.createGame(configFor(options, 6267))
        for (let n = 0; n < 600; n += 1) {
          expect(base.turn.releasesPlayed).toBeLessThanOrEqual(1)
          base = engine.reduce(base, fuzzAction(base, 6267, n)).state
        }

        let fast = engine.createGame(configFor(options, 6267, fastSetup))
        let sawMoreThanOne = false
        for (let n = 0; n < 600; n += 1) {
          if (fast.turn.releasesPlayed > 1) sawMoreThanOne = true
          fast = engine.reduce(fast, fuzzAction(fast, 6267, n)).state
        }
        // Without this, a cap that silently still applied under 'fast' would
        // pass the assertion above by never being tested against a run that
        // could actually exceed 1.
        expect(sawMoreThanOne).toBe(true)
      })

      it('enforces the hand limit at the end of a turn, per the mode axis', () => {
        // Fuzz-driven under MEMORY_SETUP: BASE_SETUP's hand limit is unbounded
        // (see MEMORY_SETUP's own comment above `configFor`), so this would be
        // vacuous under base — the assertion below would never have anything to
        // clamp.
        const engine = make()
        const handLimit = 5
        let state = engine.createGame(configFor(options, 6363, MEMORY_SETUP))
        let previousIndex = state.turn.index
        let sawMidTurnOverflow = false
        for (let n = 0; n < 900; n += 1) {
          state = engine.reduce(state, fuzzAction(state, 6363, n)).state
          for (const id of state.seating) {
            if (state.players[id].hand.length > handLimit) sawMidTurnOverflow = true
          }
          // Checked only at a turn boundary: mid-turn a hand may legitimately
          // sit over the limit until the discard prompt resolves (that is
          // exactly the "per the mode axis, at the end of a turn" scope of this
          // rule, not "at all times").
          if (state.turn.index !== previousIndex) {
            previousIndex = state.turn.index
            for (const id of state.seating) {
              expect(
                state.players[id].hand.length,
                `${id}'s hand is still over the limit at a turn boundary`,
              ).toBeLessThanOrEqual(handLimit)
            }
          }
        }
        // Otherwise this test could pass merely because the limit was never
        // exceeded at all, proving nothing about *when* it gets enforced.
        expect(sawMidTurnOverflow).toBe(true)
      })

      it('opens no reaction window for a Code Review-protected release', () => {
        // A mixed driver: `forceCodeReviewCombo` overrides the plain fuzz
        // stream (which never attaches a combo) whenever a protected release is
        // currently playable, so one reliably gets created within the run.
        const engine = make()
        const result = driveProtectedReleaseAndDdos(engine, options, 6464, 1500)
        expect(
          result.sawProtectedRelease,
          'never created a protected release to test the property against',
        ).toBe(true)
        expect(result.sawWindowOnProtectedRelease).toBe(false)
      })

      it('times the window at 15s on the first round and 10s after', () => {
        // Fuzz-driven: a defended-and-reopened window is common enough in a
        // long fuzz run for both round shapes to appear without forcing
        // anything. Under this seed a round-2+ window opens by step 76.
        //
        // Seed 6, not the original seed 2: adding a card to FAKE_EVENTS (task
        // "Inside, and the fuzz stream can resolve the new pending") shifts the
        // events-deck shuffle length, which shifts createGame's returned
        // rngCursor, which every later AI-trigger draw reads from — so the
        // whole downstream event sequence for a fixed seed changes even though
        // the main draw pile and opening hands do not. Under the reshuffled
        // seed 2, no release-attack window is ever defended with a card before
        // the game ends (confirmed by tracing: all `defended` events in that
        // run go through the hand-defense path, not the window-reopening one),
        // so a round-2+ window never appears within budget. This is a seed
        // fragility in the test, not an engine defect — openWindow still
        // unconditionally reopens at round+1 after a successful release-window
        // defend.
        //
        // Seed 55 now, not 6: #61 slice B added Git Branch and Git Merge to
        // FAKE_DECK, which moves the main shuffle the same way adding Inside
        // moved the events one, and every seed the previous sweep found (6, 17,
        // 19, 23, 24) stopped reaching a defended release window. Swept again
        // against the current deck.
        const engine = make()
        let state = engine.createGame(configFor(options, 55))
        let sawRound1 = false
        let sawLaterRound = false
        for (let n = 0; n < 600 && !state.over; n += 1) {
          const r = engine.reduce(state, fuzzAction(state, 6, n))
          for (const e of r.events) {
            if (e.type !== 'windowOpened') continue
            const expected = e.round === 1 ? 15_000 : 10_000
            expect(e.deadline - atFor(n)).toBe(expected)
            if (e.round === 1) sawRound1 = true
            else sawLaterRound = true
          }
          state = r.state
        }
        expect(sawRound1).toBe(true)
        // Without this, a bug that always used the first-round duration would
        // pass the check above simply because no later round was ever seen.
        expect(sawLaterRound).toBe(true)
      })

      it('genuinely revokes a pass with UNPASS', () => {
        // Bot-driven to the first open window: any release a bot plays opens
        // one immediately (bots never combo a Code Review), so this is quick
        // and deterministic. PASS/UNPASS are then issued by hand, since no bot
        // policy ever calls UNPASS.
        const engine = make()
        let state = engine.createGame(configFor(options, 6767))
        const at = 1
        for (let i = 0; i < 200 && !state.window && !state.over; i += 1) {
          const seat = state.pending?.player ?? state.turn.player
          const action = botAction(engine, state, seat, at)
          if (!action) break
          state = engine.reduce(state, action).state
        }
        expect(
          state.window,
          'never reached an open reaction window to test UNPASS against',
        ).not.toBeNull()
        const owner = state.window?.target.player
        const responders = state.seating.filter(
          (id) => id !== owner && !state.eliminated.includes(id),
        )
        expect(responders.length).toBeGreaterThanOrEqual(2)
        const [a, b] = responders

        state = engine.reduce(state, { type: 'PASS', player: a, at }).state
        expect(state.window?.passed).toContain(a)

        state = engine.reduce(state, { type: 'UNPASS', player: a, at }).state
        expect(state.window?.passed).not.toContain(a)

        // If UNPASS were a no-op, `a` would still count as passed here, and the
        // window would already have closed on `b`'s pass alone (2 of 2) instead
        // of needing both again below — this is what would go undetected by
        // only checking `passed` above.
        state = engine.reduce(state, { type: 'PASS', player: b, at }).state
        expect(
          state.window,
          'closed after only one of two responders had genuinely passed',
        ).not.toBeNull()

        state = engine.reduce(state, { type: 'PASS', player: a, at }).state
        expect(state.window).toBeNull()
      })

      it('is the only card that reaches a protected release or a Monitoring', () => {
        // Same mixed driver as the Code Review window test above, plus
        // `forceDdosOnZone`: without it, the fuzz stream's random target choice
        // (see `attackTarget`) might never happen to land a DDoS on a zone
        // target within any bounded run, leaving the positive half of this
        // property untested.
        //
        // Seed changed from 7 when #61 slice B lengthened FAKE_DECK: the same
        // shuffle shift that moved the two tests above moved this one, and 7 no
        // longer reaches a protected release inside the budget. The negative
        // half — no non-DDoS attack ever offered a zone target — held on every
        // seed swept, which is the half that would signal a real defect.
        const engine = make()
        const result = driveProtectedReleaseAndDdos(engine, options, 23, 1500)
        expect(
          result.sawNonDdosZoneTarget,
          'a non-DDoS attack was offered a release or Monitoring target',
        ).toBe(false)
        expect(result.sawDdosOnProtectedRelease).toBe(true)
        expect(result.sawDdosOnMonitoring).toBe(true)
      })

      it('ends exactly once and then accepts nothing', () => {
        // Fuzz-driven: reaching gameOver at all, then continuing to throw
        // actions at the ended game, is exactly what the stream already does
        // for free over a long enough run. Under this seed the game ends
        // around step 1821; 2200 steps leaves margin to also exercise the
        // "accepts nothing" half afterwards.
        const engine = make()
        let state = engine.createGame(configFor(options, 3))
        let overAt = -1
        for (let n = 0; n < 2200; n += 1) {
          const r = engine.reduce(state, fuzzAction(state, 3, n))
          if (r.state.over && overAt < 0) overAt = n
          if (overAt >= 0 && n > overAt) {
            expect(r.events.every((e) => e.type === 'rejected')).toBe(true)
            expect(r.state).toBe(state)
          }
          state = r.state
        }
        // Otherwise every assertion above is vacuous: the game never ended.
        expect(overAt).toBeGreaterThanOrEqual(0)
      })
    })
  })
}
