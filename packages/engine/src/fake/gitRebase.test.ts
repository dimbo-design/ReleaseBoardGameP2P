import { describe, expect, it } from 'vitest'
import type { GameConfig } from '../engine'
import type { CardInstance, GameState, Setup } from '../state'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from './index'
import { reduce } from './reduce'

const engine = createFakeEngine()

const BASE: Setup = {
  handLimit: 'base',
  releases: 'base',
  releaseCond: 'easy',
  ai: 'base',
  gitBranch: 'base',
}

const config: GameConfig = {
  gameId: 'g1',
  seed: 4242,
  players: [
    { id: 'p1', name: 'you' },
    { id: 'p2', name: 'kernel_panic' },
  ],
  setup: BASE,
  deck: FAKE_DECK,
  events: FAKE_EVENTS,
}

const REBASE: CardInstance = { uid: 'operation-git-rebase#0', id: 'operation-git-rebase' }
const SUDO: CardInstance = { uid: 'support-sudo#0', id: 'support-sudo' }

// Numbered filler so a pile can be read off by position rather than by luck —
// verbatim from gitPiles.test.ts.
const pile = (tag: string, n: number): CardInstance[] =>
  Array.from({ length: n }, (_, i) => ({ uid: `attack-bug#${tag}${i}`, id: 'attack-bug' }))

function table(hand: CardInstance[], main: CardInstance[][], discard: CardInstance[] = []) {
  const base = engine.createGame(config)
  const state: GameState = {
    ...base,
    // Already drawn, so the operation is the only thing this turn does.
    turn: { ...base.turn, player: 'p1', drawnFrom: [0] },
    players: { ...base.players, p1: { ...base.players.p1, hand } },
    decks: { ...base.decks, main, discard },
  }
  return state
}

// Staged directly rather than through PLAY, so the projection tests below
// stay independent of onPlay/onReorderTop and keep exercising the pure
// contract from the previous task (#108).
function stateWithReorderTop(): GameState {
  const base = engine.createGame(config)
  const piles: { pile: number; cards: CardInstance[] }[] = [
    {
      pile: 0,
      cards: [
        { uid: 'attack-bug#r0', id: 'attack-bug' },
        { uid: 'release-frontend#r1', id: 'release-frontend' },
        { uid: 'attack-ddos#r2', id: 'attack-ddos' },
      ],
    },
  ]
  return {
    ...base,
    pending: { kind: 'reorderTop', player: 'p1', piles, source: 'operation-git-rebase' },
  }
}

it("hides the reorder piles from an opponent's projection", () => {
  // "не показывая другим": a deck's contents are never public, so this is
  // `mine` or nothing — the same gate pickFromDiscard.options uses, verified
  // in discard.test.ts's own "hides the discard options" test.
  const state = stateWithReorderTop()
  const opponentView = engine.project(state, 'p2')
  expect(opponentView.pending).toMatchObject({ kind: 'reorderTop', player: 'p1' })
  const pending = opponentView.pending as { piles: unknown[] }
  expect(pending.piles).toEqual([])
})

it("gives the owner's own projection the full pile contents", () => {
  const state = stateWithReorderTop()
  const ownerView = engine.project(state, 'p1')
  expect(ownerView.pending).toMatchObject({
    kind: 'reorderTop',
    player: 'p1',
    piles: [
      {
        pile: 0,
        cards: [
          { uid: 'attack-bug#r0', id: 'attack-bug' },
          { uid: 'release-frontend#r1', id: 'release-frontend' },
          { uid: 'attack-ddos#r2', id: 'attack-ddos' },
        ],
      },
    ],
  })
})

describe('Git Rebase', () => {
  it('offers the top three of the pile the player named', () => {
    const state = table([REBASE], [pile('a', 5), pile('b', 5)])
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 1 },
      at: 1,
    })
    expect(next.pending).toMatchObject({ kind: 'reorderTop', player: 'p1' })
    const p = next.pending as { piles: { pile: number; cards: CardInstance[] }[] }
    expect(p.piles).toHaveLength(1)
    expect(p.piles[0].pile).toBe(1)
    expect(p.piles[0].cards.map((c) => c.uid)).toEqual([
      'attack-bug#b0',
      'attack-bug#b1',
      'attack-bug#b2',
    ])
  })

  it('reaches every pile under sudo, and names none', () => {
    const state = table([REBASE, SUDO], [pile('a', 5), pile('b', 4)])
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      combo: SUDO.uid,
      at: 1,
    })
    const p = next.pending as { piles: { pile: number; cards: CardInstance[] }[] }
    expect(p.piles.map((e) => e.pile)).toEqual([0, 1])
  })

  it('offers what a short pile has, rather than refusing the play', () => {
    // Rules decisions 2026-09-04 answer 2.
    const state = table([REBASE], [pile('a', 2)])
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 0 },
      at: 1,
    })
    const p = next.pending as { piles: { cards: CardInstance[] }[] }
    expect(p.piles[0].cards).toHaveLength(2)
  })

  it('spends the card for nothing when there is no pile at all', () => {
    const state = table([REBASE], [])
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      at: 1,
    })
    expect(next.pending).toBeNull()
    expect(next.decks.discard.map((c) => c.id)).toContain('operation-git-rebase')
    expect(next.players.p1.hand).toHaveLength(0)
  })

  it('puts the pile back in the order the player committed', () => {
    const played = reduce(table([REBASE], [pile('a', 5)]), {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 0 },
      at: 1,
    }).state
    const { state: next } = reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: {
        kind: 'reorderTop',
        order: [{ pile: 0, cards: ['attack-bug#a2', 'attack-bug#a0', 'attack-bug#a1'] }],
      },
      at: 2,
    })
    expect(next.pending).toBeNull()
    expect(next.decks.main[0].map((c) => c.uid)).toEqual([
      'attack-bug#a2',
      'attack-bug#a0',
      'attack-bug#a1',
      'attack-bug#a3',
      'attack-bug#a4',
    ])
  })

  it('rejects an order that is not a permutation of what was offered', () => {
    const played = reduce(table([REBASE], [pile('a', 5)]), {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 0 },
      at: 1,
    }).state
    const { state: next, events } = reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: {
        kind: 'reorderTop',
        // #a3 was never on offer — it is the fourth card down.
        order: [{ pile: 0, cards: ['attack-bug#a0', 'attack-bug#a1', 'attack-bug#a3'] }],
      },
      at: 2,
    })
    expect(next).toBe(played)
    expect(events.map((e) => e.type)).toEqual(['rejected'])
  })

  it('rejects an order that repeats a card instead of naming each once', () => {
    // Mutation check (B3 step 6): dropping the `seen` repeat guard lets this
    // through, since every uid it names is individually on offer.
    const played = reduce(table([REBASE], [pile('a', 5)]), {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 0 },
      at: 1,
    }).state
    const { state: next, events } = reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: {
        kind: 'reorderTop',
        order: [{ pile: 0, cards: ['attack-bug#a0', 'attack-bug#a0', 'attack-bug#a0'] }],
      },
      at: 2,
    })
    expect(next).toBe(played)
    expect(events.map((e) => e.type)).toEqual(['rejected'])
  })

  it('rejects a reorder from somebody else', () => {
    const played = reduce(table([REBASE], [pile('a', 5)]), {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 0 },
      at: 1,
    }).state
    const { events } = reduce(played, {
      type: 'RESOLVE',
      player: 'p2',
      choice: {
        kind: 'reorderTop',
        order: [{ pile: 0, cards: ['attack-bug#a0', 'attack-bug#a1', 'attack-bug#a2'] }],
      },
      at: 2,
    })
    expect(events.map((e) => e.type)).toEqual(['rejected'])
  })

  it('shows an opponent projection nothing of the offer', () => {
    const played = reduce(table([REBASE], [pile('a', 5)]), {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 0 },
      at: 1,
    }).state
    const view = engine.project(played, 'p2')
    expect(view.pending).toMatchObject({ kind: 'reorderTop', player: 'p1', piles: [] })
  })

  it('rejects a committed order once the pile it names has moved underneath it', () => {
    // Mutation check (B3 step 6): a stale pending must not be trusted over
    // live state — dropping the live-pile guard would duplicate cards a1/a2
    // here instead of rejecting. Nothing in the reducer mutates `main` while a
    // pending stands, so this drives the state directly to simulate the case
    // the guard exists for (a concurrent change reaching the pile another way).
    const played = reduce(table([REBASE], [pile('a', 5)]), {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      target: { kind: 'pile', pile: 0 },
      at: 1,
    }).state
    const moved: GameState = {
      ...played,
      decks: {
        ...played.decks,
        main: [[{ uid: 'attack-bug#zz0', id: 'attack-bug' }, ...played.decks.main[0].slice(1)]],
      },
    }
    const { state: next, events } = reduce(moved, {
      type: 'RESOLVE',
      player: 'p1',
      choice: {
        kind: 'reorderTop',
        order: [{ pile: 0, cards: ['attack-bug#a0', 'attack-bug#a1', 'attack-bug#a2'] }],
      },
      at: 2,
    })
    expect(next).toBe(moved)
    expect(events.map((e) => e.type)).toEqual(['rejected'])
  })
})

describe.each(['base', 'strategic'] as const)('Rebase draws in %s Branch mode', (gitBranch) => {
  it.each([
    { sudo: false, chosen: 0 },
    { sudo: false, chosen: 1 },
    { sudo: true, chosen: 0 },
    { sudo: true, chosen: 1 },
  ])('draws the committed top cards with sudo=$sudo from pile $chosen', ({ sudo, chosen }) => {
    const main = [pile('a', 5), pile('b', 5), pile('c', 5)]
    const base = table(sudo ? [REBASE, SUDO] : [REBASE], main)
    const start: GameState = {
      ...base,
      setup: { ...base.setup, gitBranch },
      turn: { ...base.turn, drawnFrom: [] },
    }
    const played = reduce(start, {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      ...(sudo ? { combo: SUDO.uid } : { target: { kind: 'pile' as const, pile: chosen } }),
      at: 1,
    }).state
    const changedPiles = sudo ? [0, 1, 2] : [chosen]
    expect(played.pending).toMatchObject({
      kind: 'reorderTop',
      piles: changedPiles.map((i) => ({ pile: i, cards: main[i].slice(0, 3) })),
    })
    const resolved = reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: {
        kind: 'reorderTop',
        order: changedPiles.map((i) => ({
          pile: i,
          cards: [main[i][2].uid, main[i][0].uid, main[i][1].uid],
        })),
      },
      at: 2,
    })
    expect(resolved.events).toEqual([])
    expect(resolved.state.pending).toBeNull()
    expect(resolved.state.rngCursor).toBe(start.rngCursor)
    expect(resolved.state.players.p1.hand).toEqual([])
    expect(resolved.state.turn.drawnFrom).toEqual([])

    const drawn = reduce(resolved.state, { type: 'DRAW', player: 'p1', pile: chosen, at: 3 })
    const drawnPiles = gitBranch === 'base' ? [0, 1, 2] : [chosen]
    expect(drawn.state.players.p1.hand).toEqual(
      drawnPiles.map((i) => main[i][changedPiles.includes(i) ? 2 : 0]),
    )
    expect(drawn.events.map((event) => event.type)).toEqual(drawnPiles.map(() => 'drawn'))
    expect(drawn.state.turn.drawnFrom).toEqual(drawnPiles)
    for (const i of [0, 1, 2]) {
      const reordered = changedPiles.includes(i)
        ? [main[i][2], main[i][0], main[i][1], ...main[i].slice(3)]
        : main[i]
      expect(drawn.state.decks.main[i]).toEqual(
        drawnPiles.includes(i) ? reordered.slice(1) : reordered,
      )
    }
  })

  it.each([
    false,
    true,
  ])('preserves the remaining order after an opponent draws before the next turn (sudo=%s)', (sudo) => {
    const main = [pile('a', 5), pile('b', 5)]
    const base = table(sudo ? [REBASE, SUDO] : [REBASE], main)
    const start: GameState = {
      ...base,
      setup: { ...base.setup, gitBranch },
      turn: { ...base.turn, drawnFrom: [0, 1] },
      players: { ...base.players, p2: { ...base.players.p2, hand: [] } },
    }
    const played = reduce(start, {
      type: 'PLAY',
      player: 'p1',
      card: REBASE.uid,
      ...(sudo ? { combo: SUDO.uid } : { target: { kind: 'pile' as const, pile: 1 } }),
      at: 1,
    }).state
    const changedPiles = sudo ? [0, 1] : [1]
    const resolved = reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: {
        kind: 'reorderTop',
        order: changedPiles.map((i) => ({
          pile: i,
          cards: [main[i][2].uid, main[i][0].uid, main[i][1].uid],
        })),
      },
      at: 2,
    }).state
    const opponentTurn = reduce(resolved, { type: 'PUSH', player: 'p1', at: 3 }).state
    expect(opponentTurn.turn.player).toBe('p2')
    const opponentDraw = reduce(opponentTurn, {
      type: 'DRAW',
      player: 'p2',
      pile: 1,
      at: 4,
    }).state
    expect(opponentDraw.players.p2.hand).toEqual(
      gitBranch === 'base' ? [main[0][sudo ? 2 : 0], main[1][2]] : [main[1][2]],
    )
    const ownTurn = reduce(opponentDraw, { type: 'PUSH', player: 'p2', at: 5 }).state
    expect(ownTurn.turn.player).toBe('p1')
    const ownDraw = reduce(ownTurn, { type: 'DRAW', player: 'p1', pile: 1, at: 6 }).state
    expect(ownDraw.players.p1.hand).toEqual(
      gitBranch === 'base' ? [main[0][sudo ? 0 : 1], main[1][0]] : [main[1][0]],
    )
    expect(ownDraw.decks.main[1]).toEqual(main[1].slice(1).filter((card) => card !== main[1][2]))
  })
})
