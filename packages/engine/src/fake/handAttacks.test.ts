import type { GameConfig } from '../engine'
import type { CardInstance, GameState, Setup } from '../state'
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
  ],
  setup: EASY,
  deck: FAKE_DECK,
  events: FAKE_EVENTS,
})

const BUG: CardInstance = { uid: 'attack-bug#0', id: 'attack-bug' }
const SEC: CardInstance = { uid: 'attack-security-bug#0', id: 'attack-security-bug' }
const DDOS: CardInstance = { uid: 'attack-ddos#0', id: 'attack-ddos' }
const MON: CardInstance = { uid: 'protection-monitoring#0', id: 'protection-monitoring' }
const FE: CardInstance = { uid: 'release-frontend#0', id: 'release-frontend' }
const CR: CardInstance = { uid: 'support-code-review#0', id: 'support-code-review' }
const HOTFIX: CardInstance = { uid: 'defense-hotfix#0', id: 'defense-hotfix' }
const NOTABUG: CardInstance = { uid: 'defense-not-a-bug#0', id: 'defense-not-a-bug' }
const ROLLBACK: CardInstance = { uid: 'defense-rollback#0', id: 'defense-rollback' }
const WORKS: CardInstance = {
  uid: 'defense-works-on-my-machine#0',
  id: 'defense-works-on-my-machine',
}
const SUDO: CardInstance = { uid: 'support-sudo#0', id: 'support-sudo' }
const SUDO2: CardInstance = { uid: 'support-sudo#1', id: 'support-sudo' }
const SPARE: CardInstance = { uid: 'protection-debugger#0', id: 'protection-debugger' }

const table = (p1: CardInstance[], p2: CardInstance[]): GameState => {
  const s = engine.createGame(config())
  return {
    ...s,
    players: {
      ...s.players,
      p1: { ...s.players.p1, hand: p1 },
      p2: { ...s.players.p2, hand: p2 },
    },
  }
}

it('opens a hand-scoped defence when Bug targets a player', () => {
  const r = reduce(table([BUG], [HOTFIX]), {
    type: 'PLAY',
    player: 'p1',
    card: BUG.uid,
    target: { kind: 'player', player: 'p2' },
    at: 1000,
  })
  expect(r.state.pending).toMatchObject({ kind: 'defend', player: 'p2', scope: 'hand' })
  expect(r.state.window).toBeNull()
})

it('steals one card when the hand attack is taken', () => {
  const victim: CardInstance = { uid: 'support-sudo#0', id: 'support-sudo' }
  const attacked = reduce(table([BUG], [victim]), {
    type: 'PLAY',
    player: 'p1',
    card: BUG.uid,
    target: { kind: 'player', player: 'p2' },
    at: 1000,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p2',
    choice: { kind: 'defend', card: null },
    at: 1001,
  })
  expect(r.state.players.p2.hand).toEqual([])
  expect(r.state.players.p1.hand.map((c) => c.uid)).toEqual([victim.uid])
  // The identity of a stolen card is private to the two parties.
  const transfer = r.events.find((e) => e.type === 'handTransfer')
  expect(transfer?.visibleTo?.sort()).toEqual(['p1', 'p2'])
})

it('leaves the hand intact when the attack is cancelled', () => {
  // A spare card beyond the defence itself: if a cancelled attack still stole,
  // this is the card that would go missing — a single-card hand would empty
  // out either way and hide that failure.
  const spare: CardInstance = { uid: 'support-sudo#0', id: 'support-sudo' }
  const attacked = reduce(table([BUG], [HOTFIX, spare]), {
    type: 'PLAY',
    player: 'p1',
    card: BUG.uid,
    target: { kind: 'player', player: 'p2' },
    at: 1000,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p2',
    choice: { kind: 'defend', card: HOTFIX.uid },
    at: 1001,
  })
  expect(r.state.players.p2.hand).toEqual([spare])
  expect(r.state.players.p1.hand).toEqual([])
  expect(r.state.window).toBeNull()
})

it('returns the attack card to the attacker when Rollback defends a hand attack', () => {
  const attacked = reduce(table([BUG], [ROLLBACK]), {
    type: 'PLAY',
    player: 'p1',
    card: BUG.uid,
    target: { kind: 'player', player: 'p2' },
    at: 1000,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p2',
    choice: { kind: 'defend', card: ROLLBACK.uid },
    at: 1001,
  })
  expect(r.state.players.p1.hand.map((c) => c.uid)).toEqual([BUG.uid])
  expect(r.state.players.p2.hand).toEqual([])
  expect(r.state.decks.discard.map((c) => c.uid)).toContain(ROLLBACK.uid)
})

it('sudo Rollback keeps the attack card with the defender instead of the attacker', () => {
  const attacked = reduce(table([BUG], [ROLLBACK, SUDO]), {
    type: 'PLAY',
    player: 'p1',
    card: BUG.uid,
    target: { kind: 'player', player: 'p2' },
    at: 1000,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p2',
    choice: { kind: 'defend', card: ROLLBACK.uid, combo: SUDO.uid },
    at: 1001,
  })
  expect(r.state.players.p2.hand.map((c) => c.uid)).toEqual([BUG.uid])
  expect(r.state.players.p1.hand).toEqual([])
})

it('holds the sudo half on a hand-attack pending, not in the discard', () => {
  const r = reduce(table([BUG, SUDO], []), {
    type: 'PLAY',
    player: 'p1',
    card: BUG.uid,
    combo: SUDO.uid,
    target: { kind: 'player', player: 'p2' },
    at: 1000,
  })
  expect(r.state.decks.discard).not.toContainEqual(SUDO)
  expect(r.state.pending).toMatchObject({ kind: 'defend', combo: SUDO })
  expect(r.events.map((e) => e.type)).toEqual(['attacked'])
})

it('banks both halves with attackSpent when a hand-attack hit is taken', () => {
  const attacked = reduce(table([BUG, SUDO], []), {
    type: 'PLAY',
    player: 'p1',
    card: BUG.uid,
    combo: SUDO.uid,
    target: { kind: 'player', player: 'p2' },
    at: 1000,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p2',
    choice: { kind: 'defend', card: null },
    at: 1001,
  })
  const discards = r.events.filter((e) => e.type === 'discarded')
  expect(discards).toMatchObject([
    { card: BUG.id, reason: 'attackSpent', player: 'p1' },
    { card: SUDO.id, reason: 'attackSpent', player: 'p1' },
  ])
  const hit = r.events.find((e) => e.type === 'tookHit')
  for (const d of discards) expect(d.parent).toBe(hit?.id)
  expect(r.state.decks.discard).toEqual(expect.arrayContaining([BUG, SUDO]))
})

it('banks a sudo-comboed hand attack’s both halves, then the cancelling defence, when it is repelled', () => {
  // Not a Bug is the only cancel-effect card `defencesFor` still offers against
  // a sudo attack (it is 'unicorn' kind, exempt from the sudo block that
  // 'cancel' kind cards like Hotfix hit) — the one way to reach this shape.
  const attacked = reduce(table([BUG, SUDO], [NOTABUG]), {
    type: 'PLAY',
    player: 'p1',
    card: BUG.uid,
    combo: SUDO.uid,
    target: { kind: 'player', player: 'p2' },
    at: 1000,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p2',
    choice: { kind: 'defend', card: NOTABUG.uid },
    at: 1001,
  })
  const discards = r.events.filter((e) => e.type === 'discarded')
  // Order: the attack card banks before its sudo half, both before the defence.
  expect(discards).toMatchObject([
    { card: BUG.id, reason: 'attackSpent', player: 'p1' },
    { card: SUDO.id, reason: 'attackSpent', player: 'p1' },
    { card: NOTABUG.id, reason: 'defenceSpent', player: 'p2' },
  ])
  const defended = r.events.find((e) => e.type === 'defended')
  for (const d of discards) expect(d.parent).toBe(defended?.id)
  expect(r.state.decks.discard).toEqual(expect.arrayContaining([BUG, SUDO, NOTABUG]))
})

it('reflects a random-steal attack: the defender steals from the attacker instead', () => {
  // SPARE is the only card left in the attacker's hand once BUG is thrown, so
  // it is the one thing the reflected steal could possibly take.
  const attacked = reduce(table([BUG, SPARE], [WORKS]), {
    type: 'PLAY',
    player: 'p1',
    card: BUG.uid,
    target: { kind: 'player', player: 'p2' },
    at: 1000,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p2',
    choice: { kind: 'defend', card: WORKS.uid },
    at: 1001,
  })
  expect(r.state.players.p1.hand).toEqual([])
  expect(r.state.players.p2.hand.map((c) => c.uid)).toEqual([SPARE.uid])
  const transfer = r.events.find((e) => e.type === 'handTransfer')
  expect(transfer).toMatchObject({ from: 'p1', to: 'p2' })
})

it('reflects Security Bug: the roles swap, defender becomes the requester', () => {
  const attacked = reduce(table([SEC], [WORKS]), {
    type: 'PLAY',
    player: 'p1',
    card: SEC.uid,
    target: { kind: 'player', player: 'p2' },
    at: 1000,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p2',
    choice: { kind: 'defend', card: WORKS.uid },
    at: 1001,
  })
  expect(r.state.pending).toMatchObject({ kind: 'requestCard', player: 'p2', target: 'p1' })
})

it('asks Security Bug for a card type, and misses when it is absent', () => {
  const attacked = reduce(table([SEC], []), {
    type: 'PLAY',
    player: 'p1',
    card: SEC.uid,
    target: { kind: 'player', player: 'p2' },
    at: 1000,
  })
  const taken = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p2',
    choice: { kind: 'defend', card: null },
    at: 1001,
  })
  expect(taken.state.pending).toMatchObject({ kind: 'requestCard', player: 'p1', target: 'p2' })

  const r = reduce(taken.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'requestCard', card: 'support-sudo' },
    at: 1002,
  })
  expect(r.state.pending).toBeNull()
  expect(r.events.some((e) => e.type === 'requested' && e.hit === false)).toBe(true)
})

it('surrenders the requested card on a hit, moving it from target to attacker', () => {
  const attacked = reduce(table([SEC], [SUDO2]), {
    type: 'PLAY',
    player: 'p1',
    card: SEC.uid,
    target: { kind: 'player', player: 'p2' },
    at: 1000,
  })
  const missed = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p2',
    choice: { kind: 'defend', card: null },
    at: 1001,
  })
  const hit = reduce(missed.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'requestCard', card: 'support-sudo' },
    at: 1002,
  })
  expect(hit.state.pending).toMatchObject({ kind: 'giveCard', player: 'p2', attacker: 'p1' })
  expect(hit.events.some((e) => e.type === 'requested' && e.hit === true)).toBe(true)

  const r = reduce(hit.state, {
    type: 'RESOLVE',
    player: 'p2',
    choice: { kind: 'giveCard', card: SUDO2.uid },
    at: 1003,
  })
  expect(r.state.pending).toBeNull()
  expect(r.state.players.p2.hand).toEqual([])
  expect(r.state.players.p1.hand.map((c) => c.uid)).toEqual([SUDO2.uid])
  const transfer = r.events.find((e) => e.type === 'handTransfer')
  expect(transfer).toMatchObject({ from: 'p2', to: 'p1', card: 'support-sudo' })
  expect(transfer?.visibleTo?.sort()).toEqual(['p1', 'p2'])
})

it('destroys a Monitoring with DDoS', () => {
  const s = table([DDOS], [])
  const guarded: GameState = {
    ...s,
    players: { ...s.players, p2: { ...s.players.p2, release: { monitoring: MON } } },
  }
  const r = reduce(guarded, {
    type: 'PLAY',
    player: 'p1',
    card: DDOS.uid,
    target: { kind: 'monitoring', player: 'p2' },
    at: 1000,
  })
  expect(r.state.players.p2.release.monitoring).toBeUndefined()
  expect(r.state.decks.discard.map((c) => c.uid)).toContain(MON.uid)
  // And the feed says so. It used to be banked by a direct write, so everything
  // built from the feed ran a card behind the projection's discardCount — the
  // board's discard heap carried a stand-in for exactly this. Parented to the
  // destruction, the way triggers.ts parents a destroyed release's spoils.
  const destroyed = r.events.find((e) => e.type === 'monitoringDestroyed')
  expect(r.events).toContainEqual(
    expect.objectContaining({
      type: 'discarded',
      player: 'p2',
      card: MON.id,
      reason: 'destroyed',
      parent: destroyed?.id,
    }),
  )
})

it('returns a protected release to hand and freezes it', () => {
  const s = table([DDOS], [])
  const guarded: GameState = {
    ...s,
    players: {
      ...s.players,
      p2: { ...s.players.p2, release: { frontend: { card: FE, codeReview: CR } } },
    },
  }
  const r = reduce(guarded, {
    type: 'PLAY',
    player: 'p1',
    card: DDOS.uid,
    target: { kind: 'release', player: 'p2', slot: 'frontend' },
    at: 1000,
  })
  expect(r.state.players.p2.release.frontend).toBeUndefined()
  expect(r.state.players.p2.hand.map((c) => c.uid)).toEqual([FE.uid])
  expect(r.state.players.p2.frozen).toEqual([FE.uid])
  // Code Review is discarded rather than returned with it.
  expect(r.state.decks.discard.map((c) => c.uid)).toContain(CR.uid)
  // The release bounces to hand, so it gets no discard — but the Code Review
  // does, and that was the second card this path banked in silence.
  const returned = r.events.find((e) => e.type === 'releaseReturned')
  expect(r.events).toContainEqual(
    expect.objectContaining({
      type: 'discarded',
      player: 'p2',
      card: CR.id,
      reason: 'destroyed',
      parent: returned?.id,
    }),
  )
  expect(r.events.some((e) => e.type === 'discarded' && e.card === FE.id)).toBe(false)
})

it('thaws a frozen card when its owner’s next turn ends', () => {
  const s = table([], [])
  const frozen: GameState = {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1, frozen: [FE.uid], hand: [FE] } },
    turn: { player: 'p1', index: 0, drawnFrom: [0], releasesPlayed: 0 },
  }
  const r = reduce(frozen, { type: 'PUSH', player: 'p1', at: 1000 })
  expect(r.state.players.p1.frozen).toEqual([])
})
