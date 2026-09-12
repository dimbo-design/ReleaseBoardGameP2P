import type { GameConfig } from '../engine'
import { createGame, expand, OPENING_EXCLUDED } from './setup'

const DECK = [
  { id: 'release-frontend', qty: 4 },
  { id: 'release-backend', qty: 4 },
  { id: 'release-database', qty: 5 },
  { id: 'attack-bug', qty: 7 },
  { id: 'attack-security-bug', qty: 5 },
  { id: 'attack-ddos', qty: 6 },
  { id: 'defense-hotfix', qty: 3 },
  { id: 'defense-not-a-bug', qty: 2 },
  { id: 'protection-monitoring', qty: 4 },
  { id: 'protection-debugger', qty: 8 },
  { id: 'support-sudo', qty: 5 },
  { id: 'support-code-review', qty: 5 },
  { id: 'trigger-error-503', qty: 7 },
  { id: 'trigger-ai', qty: 12 },
]

const EVENTS = [
  { id: 'ai-crush-frontend', qty: 2 },
  { id: 'ai-hallucination', qty: 2 },
]

const config = (over: Partial<GameConfig> = {}): GameConfig => ({
  gameId: 'g1',
  seed: 4242,
  players: [
    { id: 'p1', name: 'you' },
    { id: 'p2', name: 'kernel_panic' },
    { id: 'p3', name: 'segfault' },
  ],
  setup: {
    handLimit: 'base',
    releases: 'base',
    releaseCond: 'base',
    ai: 'base',
    gitBranch: 'base',
  },
  deck: DECK,
  events: EVENTS,
  ...over,
})

it('assigns deterministic uids and honours quantities', () => {
  const items = expand([{ id: 'attack-bug', qty: 3 }])
  expect(items).toEqual([
    { uid: 'attack-bug#0', id: 'attack-bug' },
    { uid: 'attack-bug#1', id: 'attack-bug' },
    { uid: 'attack-bug#2', id: 'attack-bug' },
  ])
})

it('deals five cards to every player', () => {
  const s = createGame(config())
  for (const id of s.seating) expect(s.players[id].hand).toHaveLength(5)
})

// "One Debugger plus 4 random" — and those 4 come from a deck that still holds
// other Debuggers, so a second one by chance is rules-correct. The guarantee is
// a floor, not an exact count. Swept across seeds so it cannot pass by luck.
it('guarantees every player at least one Debugger, on any seed', () => {
  for (let seed = 0; seed < 50; seed += 1) {
    const s = createGame(config({ seed }))
    for (const id of s.seating) {
      const n = s.players[id].hand.filter((c) => c.id === 'protection-debugger').length
      expect(n, `seed ${seed}, ${id}`).toBeGreaterThanOrEqual(1)
    }
  }
})

it('keeps AI and Error 503 out of every opening hand', () => {
  const s = createGame(config())
  for (const id of s.seating) {
    for (const c of s.players[id].hand) {
      expect(OPENING_EXCLUDED.has(c.id), `${id} holds ${c.id}`).toBe(false)
    }
  }
})

it('accounts for every card exactly once', () => {
  const s = createGame(config())
  const dealt = s.seating.flatMap((id) => s.players[id].hand.map((c) => c.uid))
  const inDeck = s.decks.main.flat().map((c) => c.uid)
  const all = [...dealt, ...inDeck, ...s.decks.discard.map((c) => c.uid)]
  const total = DECK.reduce((n, e) => n + e.qty, 0)
  expect(all).toHaveLength(total)
  expect(new Set(all).size).toBe(total)
})

it('starts with one draw pile, an events deck and an empty discard', () => {
  const s = createGame(config())
  expect(s.decks.main).toHaveLength(1)
  expect(s.decks.events).toHaveLength(4)
  expect(s.decks.discard).toEqual([])
})

it('is deterministic for a given seed and divergent across seeds', () => {
  expect(createGame(config())).toEqual(createGame(config()))
  expect(createGame(config({ seed: 99 })).players.p1.hand).not.toEqual(
    createGame(config()).players.p1.hand,
  )
})

it('excludes deck entries the engine does not implement', () => {
  // An id off the catalogue entirely, because the engine now implements every
  // card on it — System Upgrade, which used to stand in here, was the last one
  // deferred (#108). The filter is about a caller handing over ids this build
  // has no rules for, and that is what this id is.
  const s = createGame(
    config({
      deck: [...DECK, { id: 'not-a-card', qty: 3 }],
    }),
  )
  const ids = [...s.seating.flatMap((id) => s.players[id].hand), ...s.decks.main.flat()].map(
    (c) => c.id,
  )
  expect(ids).not.toContain('not-a-card')
})

it('opens on the first seat with nothing drawn or released', () => {
  const s = createGame(config())
  expect(s.turn).toEqual({ player: 'p1', index: 0, drawnFrom: [], releasesPlayed: 0 })
  expect(s.window).toBeNull()
  expect(s.pending).toBeNull()
  expect(s.over).toBeNull()
  expect(s.eliminated).toEqual([])
  // The deal reserves one event id per seated player (see createGame), so the
  // counter starts past them, not at 0.
  expect(s.eventSeq).toBe(s.seating.length)
})

it('leaves every release zone empty', () => {
  const s = createGame(config())
  for (const id of s.seating) {
    expect(s.players[id].release).toEqual({})
    expect(s.players[id].frozen).toEqual([])
  }
})
