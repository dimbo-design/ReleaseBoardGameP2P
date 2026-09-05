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
const SUDO: CardInstance = { uid: 'support-sudo#0', id: 'support-sudo' }
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

  it('takes the card out of that hand and holds it at the centre', () => {
    const played = reduce(seats({ p1: [UPGRADE], p2: [card('b')], p3: [card('c')] }), {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    }).state
    const { state: next, events } = reduce(played, {
      type: 'RESOLVE',
      player: 'p2',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#b' },
      at: 2,
    })
    expect(next.players.p2.hand).toHaveLength(0)
    // Held on the pending, not banked: the cards lie face up at the centre
    // until everyone has answered.
    expect(next.decks.discard.some((c) => c.uid === 'attack-bug#b')).toBe(false)
    expect(next.pending).toMatchObject({ owed: ['p3'], thrown: [{ player: 'p2' }] })
    expect(events.map((e) => e.type)).toEqual(['upgradeThrown'])
  })

  it('rejects a seat that is not on the roster', () => {
    // p1 (the actor, never on its own roster) keeps a spare card it actually
    // holds — 'attack-bug#a' — so a dropped `owed.includes` guard would find
    // it in p1's own hand and let the discard through. Naming a card p1 does
    // not hold would let the separate "you do not hold that card" guard catch
    // it instead, and the roster check would never be exercised at all.
    const played = reduce(seats({ p1: [UPGRADE, card('a')], p2: [card('b')], p3: [card('c')] }), {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    }).state
    const { state: next, events } = reduce(played, {
      type: 'RESOLVE',
      player: 'p1',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#a' },
      at: 2,
    })
    expect(next).toBe(played)
    expect(events.map((e) => e.type)).toEqual(['rejected'])
  })

  it('banks everything to the discard when the last seat answers, without sudo', () => {
    let s = reduce(seats({ p1: [UPGRADE], p2: [card('b')], p3: [card('c')] }), {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      at: 1,
    }).state
    s = reduce(s, {
      type: 'RESOLVE',
      player: 'p2',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#b' },
      at: 2,
    }).state
    const { state: next, events } = reduce(s, {
      type: 'RESOLVE',
      player: 'p3',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#c' },
      at: 3,
    })
    expect(next.pending).toBeNull()
    expect(next.decks.discard.map((c) => c.uid)).toEqual(
      expect.arrayContaining(['attack-bug#b', 'attack-bug#c']),
    )
    expect(events.map((e) => e.type)).toEqual(['upgradeThrown', 'discarded', 'discarded'])
  })

  it('opens the pick instead of banking, under sudo', () => {
    let s = reduce(seats({ p1: [UPGRADE, SUDO], p2: [card('b')], p3: [card('c')] }), {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      combo: SUDO.uid,
      at: 1,
    }).state
    s = reduce(s, {
      type: 'RESOLVE',
      player: 'p2',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#b' },
      at: 2,
    }).state
    const { state: next } = reduce(s, {
      type: 'RESOLVE',
      player: 'p3',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#c' },
      at: 3,
    })
    expect(next.pending).toMatchObject({ phase: 'picking', owed: [], actor: 'p1' })
  })

  // The three reductions C3's sudo test already drives, as a named state the
  // pick tests share. Local to this file: it is a fixture, not machinery.
  const sudoUpToPicking = (): GameState => {
    let s = reduce(seats({ p1: [UPGRADE, SUDO], p2: [card('b')], p3: [card('c')] }), {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      combo: SUDO.uid,
      at: 1,
    }).state
    s = reduce(s, {
      type: 'RESOLVE',
      player: 'p2',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#b' },
      at: 2,
    }).state
    return reduce(s, {
      type: 'RESOLVE',
      player: 'p3',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#c' },
      at: 3,
    }).state
  }

  it('gives the actor the card they picked and discards the rest', () => {
    const picking = sudoUpToPicking()
    const { state: next, events } = reduce(picking, {
      type: 'RESOLVE',
      player: 'p1',
      choice: { kind: 'upgradeTake', card: 'attack-bug#c' },
      at: 4,
    })
    expect(next.players.p1.hand.map((c) => c.uid)).toContain('attack-bug#c')
    expect(next.decks.discard.map((c) => c.uid)).toContain('attack-bug#b')
    expect(next.decks.discard.map((c) => c.uid)).not.toContain('attack-bug#c')
    expect(next.pending).toBeNull()
    expect(events.map((e) => e.type)).toEqual(['upgradeTaken', 'discarded'])
  })

  it('refuses a card that was not thrown this time', () => {
    const picking = sudoUpToPicking()
    const { state: next, events } = reduce(picking, {
      type: 'RESOLVE',
      player: 'p1',
      // In the discard, but not in `thrown` — "выбор из того, что сброшено в
      // этот раз, а не из всего сброса".
      choice: { kind: 'upgradeTake', card: 'operation-system-upgrade#0' },
      at: 4,
    })
    expect(next).toBe(picking)
    expect(events.map((e) => e.type)).toEqual(['rejected'])
  })

  it('refuses a take from anyone but the actor', () => {
    const picking = sudoUpToPicking()
    const { events } = reduce(picking, {
      type: 'RESOLVE',
      player: 'p2',
      choice: { kind: 'upgradeTake', card: 'attack-bug#c' },
      at: 4,
    })
    expect(events.map((e) => e.type)).toEqual(['rejected'])
  })

  it('refuses a pick while a seat still owes', () => {
    // Only p2 has answered — p3 is still on the roster and the phase has not
    // flipped to 'picking' yet. p2's card is already sitting in `thrown`, so a
    // dropped phase guard would find it there and let the actor jump the
    // queue; the phase check is the only thing standing in the way.
    const s = reduce(seats({ p1: [UPGRADE, SUDO], p2: [card('b')], p3: [card('c')] }), {
      type: 'PLAY',
      player: 'p1',
      card: UPGRADE.uid,
      combo: SUDO.uid,
      at: 1,
    }).state
    const stillOwed = reduce(s, {
      type: 'RESOLVE',
      player: 'p2',
      choice: { kind: 'upgradeDiscard', card: 'attack-bug#b' },
      at: 2,
    }).state
    const { state: next, events } = reduce(stillOwed, {
      type: 'RESOLVE',
      player: 'p1',
      choice: { kind: 'upgradeTake', card: 'attack-bug#b' },
      at: 3,
    })
    expect(next).toBe(stillOwed)
    expect(events.map((e) => e.type)).toEqual(['rejected'])
  })
})
