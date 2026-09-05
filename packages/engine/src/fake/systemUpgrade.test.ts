import { describe, expect, it } from 'vitest'
import type { GameConfig } from '../engine'
import type { CardInstance, GameState, PlayerId, Setup } from '../state'
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
    { id: 'p3', name: 'null_pointer' },
  ],
  setup: BASE,
  deck: FAKE_DECK,
  events: FAKE_EVENTS,
}

const UPGRADE: CardInstance = { uid: 'operation-system-upgrade#0', id: 'operation-system-upgrade' }
// SUDO is not needed by this task's four tests (the opener only computes the
// roster; the sudo pick is C4's work) — left out rather than kept unused,
// since `noUnusedLocals` is on. A later task reintroduces it alongside the
// tests that exercise it.
const card = (tag: string) => ({ uid: `attack-bug#${tag}`, id: 'attack-bug' })

// Three-seat table, built on gitPiles.test.ts's `table()`. Hands come in by
// seat so a test reads as "who holds what" rather than positional arguments —
// and the returned state is a plain GameState, so a later test (thrown cards
// mid-resolution, a pending already open) can spread over it same as any
// other fixture here.
function seats(hands: Record<PlayerId, CardInstance[]>): GameState {
  const base = engine.createGame(config)
  return {
    ...base,
    // Already drawn, so the operation is the only thing this turn does.
    turn: { ...base.turn, player: 'p1', drawnFrom: [0] },
    players: {
      ...base.players,
      p1: { ...base.players.p1, hand: hands.p1 ?? [] },
      p2: { ...base.players.p2, hand: hands.p2 ?? [] },
      p3: { ...base.players.p3, hand: hands.p3 ?? [] },
    },
  }
}

describe('System Upgrade', () => {
  it('owes every other seat, and never the actor', () => {
    // p1 keeps a spare card after playing UPGRADE, so a hand-empty actor can
    // never be mistaken for one excluded by the "never the actor" rule this
    // test names — the mutation check below relies on that separation.
    const state = seats({ p1: [UPGRADE, card('a')], p2: [card('b')], p3: [card('c')] })
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    })
    expect(next.pending).toMatchObject({
      kind: 'systemUpgrade',
      actor: 'p1',
      owed: ['p2', 'p3'],
      thrown: [],
      sudo: false,
      phase: 'discarding',
    })
  })

  it('does not ask a seat with an empty hand', () => {
    // Rules decisions 2026-09-04 answer 3.
    const state = seats({ p1: [UPGRADE], p2: [], p3: [card('c')] })
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    })
    expect((next.pending as { owed: string[] }).owed).toEqual(['p3'])
  })

  it('does not ask an eliminated seat', () => {
    const base = seats({ p1: [UPGRADE], p2: [card('b')], p3: [card('c')] })
    const state = { ...base, eliminated: ['p2'] }
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    })
    expect((next.pending as { owed: string[] }).owed).toEqual(['p3'])
  })

  it('spends the card for nothing when nobody can discard', () => {
    const state = seats({ p1: [UPGRADE], p2: [], p3: [] })
    const { state: next } = reduce(state, {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    })
    expect(next.pending).toBeNull()
    expect(next.decks.discard.map((c) => c.id)).toContain('operation-system-upgrade')
  })
})
