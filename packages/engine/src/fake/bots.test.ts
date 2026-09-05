import type { Engine, GameConfig } from '../engine'
import { seatOwing } from '../state'
import { botAction, runUntilIdle } from './bots'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from './index'

const engine = createFakeEngine()

const CHERRY = 'operation-git-cherry-pick'

const config = (): GameConfig => ({
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
  deck: FAKE_DECK,
  events: FAKE_EVENTS,
})

it('offers nothing to a seat with no outstanding action', () => {
  const s = engine.createGame(config())
  expect(botAction(engine, s, 'p2', 1000)).toBeNull()
})

it('only ever proposes an action the engine accepts', () => {
  let state = engine.createGame(config())
  for (let n = 0; n < 400 && !state.over; n += 1) {
    const seat = seatOwing(state.pending) ?? state.turn.player
    const action = botAction(engine, state, seat, 1000 + n * 100)
    if (!action) break
    const r = engine.reduce(state, action)
    expect(
      r.events.filter((e) => e.type === 'rejected'),
      `rejected ${JSON.stringify(action)}`,
    ).toEqual([])
    state = r.state
  }
})

it('drives the table back to the human without hanging', () => {
  const s = engine.createGame(config())
  const advanced = runUntilIdle(engine, { ...s, turn: { ...s.turn, player: 'p2' } }, 'p1', 1000)
  expect(advanced.turn.player === 'p1' || advanced.over !== null).toBe(true)
})

it('reaches a finished game when every seat is driven', () => {
  let state = engine.createGame(config())
  for (let n = 0; n < 2000 && !state.over; n += 1) {
    const seat = seatOwing(state.pending) ?? state.turn.player
    const action = botAction(engine, state, seat, 1000 + n * 100)
    if (!action) break
    state = engine.reduce(state, action).state
  }
  expect(state.over).not.toBeNull()
})

// A sudo Cherry-pick keeps a trigger on offer (it can go to the deck slot),
// so `pending.options[0]` is not always hand-eligible. A bot naming it for
// the hand anyway (as the identical-shape bug in conformance.ts's fuzz
// policy did) gets rejected, and a rejected bot answer stalls a real match
// whenever the keeper takes over an absent seat (referee.ts).
it('answers a sudo pick-from-discard whose first option is a trigger, not a rejection', () => {
  const base = engine.createGame(config())
  const state = {
    ...base,
    turn: { ...base.turn, player: 'p1', drawnFrom: [0] },
    decks: {
      ...base.decks,
      discard: [
        { uid: 'trigger-error-503#d0', id: 'trigger-error-503' },
        { uid: 'attack-bug#d1', id: 'attack-bug' },
      ],
    },
    players: {
      ...base.players,
      p1: {
        ...base.players.p1,
        hand: [
          { uid: `${CHERRY}#h0`, id: CHERRY },
          { uid: 'support-sudo#h1', id: 'support-sudo' },
        ],
      },
    },
  }
  const played = engine.reduce(state, {
    type: 'PLAY',
    player: 'p1',
    card: `${CHERRY}#h0`,
    combo: 'support-sudo#h1',
    at: 1,
  }).state
  expect(played.pending?.kind).toBe('pickFromDiscard')

  const action = botAction(engine, played, 'p1', 2)
  expect(action?.type).toBe('RESOLVE')
  if (!action) throw new Error('expected an action')
  const { events } = engine.reduce(played, action)
  expect(events.some((e) => e.type === 'rejected')).toBe(false)
})

// The iteration cap is the only thing standing between a policy that cannot
// make progress and a hung caller — this stubs `reduce` to never advance the
// state, so `runUntilIdle` would spin forever without the cap. An explicit
// per-test timeout makes a regression here fail loudly instead of stalling
// the whole suite.
it('does not hang when the policy cannot make progress', () => {
  const s = engine.createGame(config())
  const stuck = { ...s, turn: { ...s.turn, player: 'p2' } }
  const stub: Engine = {
    createGame: engine.createGame,
    setupEvents: engine.setupEvents,
    // Every action is accepted but changes nothing: the table can never
    // advance toward p1's turn or a finished game.
    reduce: (state) => ({ state, events: [] }),
    project: engine.project,
    legalTargets: engine.legalTargets,
  }

  const result = runUntilIdle(stub, stuck, 'p1', 1000)

  expect(result.turn.player).toBe('p2')
  expect(result.over).toBeNull()
}, 2_000)
