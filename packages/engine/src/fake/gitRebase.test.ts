import { expect, it } from 'vitest'
import type { GameConfig } from '../engine'
import type { CardInstance, GameState, Setup } from '../state'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from './index'

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

// Playing and resolving Git Rebase are later tasks (#108) — no `onPlay`
// exists yet to open this pending through PLAY, so it is staged directly,
// the same way gitPiles.test.ts stages a split deck.
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
