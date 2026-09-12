import type { GameConfig } from '../engine'
import type { CardInstance, GameState, Setup } from '../state'
import { TURN_ACTION_MS } from './core'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from './index'
import { reduce } from './reduce'

const engine = createFakeEngine()

const EASY: Setup = {
  handLimit: 'base',
  releases: 'base',
  releaseCond: 'easy',
  ai: 'base',
  gitBranch: 'base',
}

const config = (): GameConfig => ({
  gameId: 'g1',
  seed: 4242,
  players: [
    { id: 'p1', name: 'you' },
    { id: 'p2', name: 'kernel_panic' },
    { id: 'p3', name: 'segfault' },
  ],
  setup: EASY,
  deck: FAKE_DECK,
  events: FAKE_EVENTS,
})

const FE: CardInstance = { uid: 'release-frontend#0', id: 'release-frontend' }
const BUG: CardInstance = { uid: 'attack-bug#0', id: 'attack-bug' }
const SUDO: CardInstance = { uid: 'support-sudo#0', id: 'support-sudo' }
const NOTABUG: CardInstance = { uid: 'defense-not-a-bug#0', id: 'defense-not-a-bug' }
const HOTFIX: CardInstance = { uid: 'defense-hotfix#0', id: 'defense-hotfix' }

// An inert card, pinned to the top of the draw pile below: drawing it is only
// a draw — no trigger to pause the sequence, no AI event to reveal. Named
// rather than left to the shuffle, because these are clock tests and what the
// draw happens to turn up is not what any of them is about. Left to the seed,
// the top card moves every time FAKE_DECK gains an entry (`operation-system-
// upgrade`, #108, turned it into a `trigger-ai` that opened a window and so
// legitimately cleared the very clock the test was reading).
const INERT: CardInstance = { uid: 'protection-debugger#t', id: 'protection-debugger' }

// p1 on turn holding a release; p2 holds a Bug so a window has a live responder;
// an inert card on top of pile 0 so a DRAW is only a DRAW.
const primed = (hands?: Partial<Record<'p1' | 'p2' | 'p3', CardInstance[]>>): GameState => {
  const s = engine.createGame(config())
  return {
    ...s,
    players: {
      ...s.players,
      p1: { ...s.players.p1, hand: hands?.p1 ?? [FE] },
      p2: { ...s.players.p2, hand: hands?.p2 ?? [BUG] },
      p3: { ...s.players.p3, hand: hands?.p3 ?? [] },
    },
    decks: { ...s.decks, main: [[INERT, ...s.decks.main[0]], ...s.decks.main.slice(1)] },
  }
}

// `primed` runs the EASY mode, where a release lands for free and no cost
// pending ever opens. The clock-through-the-cost cases need the BASE rule, and
// a spare card in p1's hand for the price to be payable at all.
const costPrimed = (): GameState => {
  const s = engine.createGame({ ...config(), setup: { ...EASY, releaseCond: 'base' } })
  return {
    ...s,
    players: {
      ...s.players,
      p1: { ...s.players.p1, hand: [FE, BUG] },
      p2: { ...s.players.p2, hand: [] },
      p3: { ...s.players.p3, hand: [] },
    },
  }
}

it('starts with no turn clock — createGame has no timestamp to stamp one from', () => {
  const s = engine.createGame(config())
  expect(s.turn.openedAt).toBeUndefined()
  expect(s.turn.deadline).toBeUndefined()
})

it('stamps the clock from CLOCK_STARTED at the keeper-supplied time', () => {
  const r = reduce(primed(), { type: 'CLOCK_STARTED', at: 5000 })
  expect(r.state).not.toBe(primed())
  expect(r.state.turn.openedAt).toBe(5000)
  expect(r.state.turn.deadline).toBe(5000 + TURN_ACTION_MS)
})

it('rejects CLOCK_STARTED when a clock is already running', () => {
  const started = reduce(primed(), { type: 'CLOCK_STARTED', at: 5000 }).state
  const again = reduce(started, { type: 'CLOCK_STARTED', at: 9000 })
  expect(again.state).toBe(started)
  expect(again.events.map((e) => e.type)).toEqual(['rejected'])
})

it('re-stamps the clock on every committed action while the table stays idle', () => {
  const s = reduce(primed(), { type: 'CLOCK_STARTED', at: 5000 }).state
  const drawn = reduce(s, { type: 'DRAW', player: 'p1', at: 9000 }).state
  expect(drawn.turn.openedAt).toBe(9000)
  expect(drawn.turn.deadline).toBe(9000 + TURN_ACTION_MS)
})

it('hands the next player a fresh clock when the turn ends', () => {
  const s = reduce(primed(), { type: 'CLOCK_STARTED', at: 5000 }).state
  const drawn = reduce(s, { type: 'DRAW', player: 'p1', at: 9000 }).state
  const pushed = reduce(drawn, { type: 'PUSH', player: 'p1', at: 12_000 }).state
  expect(pushed.turn.player).toBe('p2')
  expect(pushed.turn.openedAt).toBe(12_000)
  expect(pushed.turn.deadline).toBe(12_000 + TURN_ACTION_MS)
})

it('clears the clock while a reaction window holds the table', () => {
  const s = reduce(primed(), { type: 'CLOCK_STARTED', at: 5000 }).state
  const windowed = reduce(s, { type: 'PLAY', player: 'p1', card: FE.uid, at: 9000 }).state
  expect(windowed.window).not.toBeNull()
  expect(windowed.turn.openedAt).toBeUndefined()
  expect(windowed.turn.deadline).toBeUndefined()
})

it('gives the turn player a fresh clock the moment the window closes', () => {
  const s = reduce(primed(), { type: 'CLOCK_STARTED', at: 5000 }).state
  const windowed = reduce(s, { type: 'PLAY', player: 'p1', card: FE.uid, at: 9000 }).state
  const one = reduce(windowed, { type: 'PASS', player: 'p2', at: 10_000 }).state
  const closed = reduce(one, { type: 'PASS', player: 'p3', at: 11_000 }).state
  expect(closed.window).toBeNull()
  expect(closed.turn.player).toBe('p1')
  expect(closed.turn.openedAt).toBe(11_000)
  expect(closed.turn.deadline).toBe(11_000 + TURN_ACTION_MS)
})

// #101 (review round 2). Every other pending hands the wait to somebody else —
// a defence, a hand limit, a 503 — and the turn is genuinely not being spent.
// Paying a release's price is the turn's own owner still acting inside their
// own turn, so suspending the clock there would let a player stop their own
// clock by staging a release and walking away.
it('keeps the clock running while a release waits for its price', () => {
  const s = reduce(costPrimed(), { type: 'CLOCK_STARTED', at: 5000 }).state
  const staged = reduce(s, { type: 'PLAY', player: 'p1', card: FE.uid, at: 9000 }).state
  expect(staged.pending).toMatchObject({ kind: 'discardForRelease', player: 'p1' })
  // the PLAY is a committed action like any other, so it re-stamps rather than
  // merely leaving the old span alone
  expect(staged.turn.openedAt).toBe(9000)
  expect(staged.turn.deadline).toBe(9000 + TURN_ACTION_MS)
})

// The narrowness of that exception. Point it at any other pending and the
// clock still has to stop, or the rule above has quietly become "no pending
// suspends the clock".
it('still clears the clock for a pending that is somebody else’s wait', () => {
  const s = reduce(costPrimed(), { type: 'CLOCK_STARTED', at: 5000 }).state
  const staged = reduce(s, { type: 'PLAY', player: 'p1', card: FE.uid, at: 9000 }).state
  const placed = reduce(staged, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'discardForRelease', card: BUG.uid },
    at: 10_000,
  }).state
  // the release landed and its window opened — that IS somebody else's wait
  expect(placed.window).not.toBeNull()
  expect(placed.turn.deadline).toBeUndefined()
})

// Taking the release back is a committed action, so it re-stamps like any
// other — the player does not lose the turn for changing their mind, and does
// not get to bank the unspent stretch either.
it('re-stamps the clock when an unpaid release is taken back', () => {
  const s = reduce(costPrimed(), { type: 'CLOCK_STARTED', at: 5000 }).state
  const staged = reduce(s, { type: 'PLAY', player: 'p1', card: FE.uid, at: 9000 }).state
  const back = reduce(staged, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'cancelRelease' },
    at: 12_000,
  }).state
  expect(back.pending).toBeNull()
  expect(back.turn.openedAt).toBe(12_000)
  expect(back.turn.deadline).toBe(12_000 + TURN_ACTION_MS)
})

it('rejects CLOCK_STARTED while a window is open — the window owns that wait', () => {
  const s = reduce(primed(), { type: 'CLOCK_STARTED', at: 5000 }).state
  const windowed = reduce(s, { type: 'PLAY', player: 'p1', card: FE.uid, at: 9000 }).state
  const r = reduce(windowed, { type: 'CLOCK_STARTED', at: 20_000 })
  expect(r.state).toBe(windowed)
})

it('projects the clock to every viewer', () => {
  const s = reduce(primed(), { type: 'CLOCK_STARTED', at: 5000 }).state
  for (const viewer of ['p1', 'p2', 'p3']) {
    const view = engine.project(s, viewer)
    expect(view.turn.openedAt).toBe(5000)
    expect(view.turn.deadline).toBe(5000 + TURN_ACTION_MS)
  }
})

it('rejects CLOCK_STARTED once the game is over', () => {
  const s = primed()
  const done: GameState = { ...s, over: { winner: 'p1', condition: 'release' } }
  const r = reduce(done, { type: 'CLOCK_STARTED', at: 5000 })
  expect(r.state).toBe(done)
})

// A deadline can outlive its own expiry unacted: the keeper's tick refuses to
// fire it against an empty seat, so a player who drops mid-turn comes back to a
// clock that ran out while nobody could act on it. Restarting THAT clock is
// legal — it is the deferred-expiry handover, not an extension of a live turn.
it('restarts the clock when the old deadline has already expired unacted', () => {
  const started = reduce(primed(), { type: 'CLOCK_STARTED', at: 5000 })
  const at = 5000 + TURN_ACTION_MS + 9000 // well past the deadline
  const r = reduce(started.state, { type: 'CLOCK_STARTED', at })
  expect(r.state).not.toBe(started.state)
  expect(r.state.turn.openedAt).toBe(at)
  expect(r.state.turn.deadline).toBe(at + TURN_ACTION_MS)
})

it('still rejects a restart while the clock is live — no extensions', () => {
  const started = reduce(primed(), { type: 'CLOCK_STARTED', at: 5000 })
  const r = reduce(started.state, { type: 'CLOCK_STARTED', at: 5000 + TURN_ACTION_MS - 1 })
  expect(r.state).toBe(started.state)
  expect(r.events[0]?.type).toBe('rejected')
})

// #116 review on the #117 rebase: pair banking at resolution (#100) and the
// turn clock's post-commit stamp (#98) meet in `reduce` for the first time
// here, and nothing had exercised them together — a resolution that banks a
// pair is ALSO a commit that re-stamps (or deliberately withholds) the turn's
// clock. These three pin both facts of each such commit at once.

it('a resolution that banks a spent pair also re-stamps the clock it idles into', () => {
  // p2 throws a sudo-comboed Bug into p1's window; p1 takes the hit. One
  // commit: both halves bank, the release dies, the window closes — and the
  // post-step hands p1's continuing turn a fresh clock, at the RESOLVE's `at`.
  const s = reduce(primed({ p2: [BUG, SUDO] }), { type: 'CLOCK_STARTED', at: 5000 }).state
  const windowed = reduce(s, { type: 'PLAY', player: 'p1', card: FE.uid, at: 9000 }).state
  const attacked = reduce(windowed, {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    combo: SUDO.uid,
    at: 10_000,
  }).state
  // the defend pending owns the wait — no turn clock while it stands
  expect(attacked.turn.deadline).toBeUndefined()

  const r = reduce(attacked, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: null },
    at: 12_000,
  }).state
  expect(r.decks.discard).toEqual(expect.arrayContaining([BUG, SUDO]))
  expect(r.window).toBeNull()
  expect(r.pending).toBeNull()
  expect(r.turn.player).toBe('p1')
  expect(r.turn.openedAt).toBe(12_000)
  expect(r.turn.deadline).toBe(12_000 + TURN_ACTION_MS)
})

it('a banking resolution that reopens the window withholds the clock — the window owns the wait', () => {
  // Same throw, but p1 repels it with Not a Bug (the one cancel a sudo attack
  // still allows). One commit: all three cards bank AND the window reopens at
  // round 2 — so the turn clock must stay off, not restart under the window.
  const s = reduce(primed({ p1: [FE, NOTABUG], p2: [BUG, SUDO] }), {
    type: 'CLOCK_STARTED',
    at: 5000,
  }).state
  const windowed = reduce(s, { type: 'PLAY', player: 'p1', card: FE.uid, at: 9000 }).state
  const attacked = reduce(windowed, {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    combo: SUDO.uid,
    at: 10_000,
  }).state

  const r = reduce(attacked, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: NOTABUG.uid },
    at: 12_000,
  }).state
  expect(r.decks.discard).toEqual(expect.arrayContaining([BUG, SUDO, NOTABUG]))
  expect(r.window).toMatchObject({ round: 2 })
  expect(r.turn.openedAt).toBeUndefined()
  expect(r.turn.deadline).toBeUndefined()
})

it('a hand-scope pair banks on the attacker`s own turn, and their clock restarts with it', () => {
  // No window at all: p1 sudo-combos a Bug at p2's hand on their own turn.
  // p2 takes the hit — the pair banks, the steal happens, and the same commit
  // returns the idle wait (and the clock) to p1, whose turn never left.
  const s = reduce(primed({ p1: [BUG, SUDO], p2: [HOTFIX] }), {
    type: 'CLOCK_STARTED',
    at: 5000,
  }).state
  const thrown = reduce(s, {
    type: 'PLAY',
    player: 'p1',
    card: BUG.uid,
    combo: SUDO.uid,
    target: { kind: 'player', player: 'p2' },
    at: 9000,
  }).state
  expect(thrown.pending).toMatchObject({ kind: 'defend', scope: 'hand' })
  expect(thrown.turn.deadline).toBeUndefined()

  const r = reduce(thrown, {
    type: 'RESOLVE',
    player: 'p2',
    choice: { kind: 'defend', card: null },
    at: 12_000,
  }).state
  expect(r.decks.discard).toEqual(expect.arrayContaining([BUG, SUDO]))
  expect(r.pending).toBeNull()
  expect(r.turn.player).toBe('p1')
  expect(r.turn.openedAt).toBe(12_000)
  expect(r.turn.deadline).toBe(12_000 + TURN_ACTION_MS)
})
