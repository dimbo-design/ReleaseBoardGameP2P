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
})
