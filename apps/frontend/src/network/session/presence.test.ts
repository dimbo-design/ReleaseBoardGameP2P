import type { CardInstance, Engine } from '@release/engine'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from '@release/engine/fake'
import {
  ABSENT_GRACE_MS,
  applyIntent,
  createSession,
  disconnect,
  driveUnattended,
  rebind,
  type Session,
} from './referee'

function session(): Session {
  return createSession({
    gameId: 'g1',
    keeperId: 'a',
    engine: createFakeEngine(),
    seed: 7,
    players: [
      { playerId: 'a', peerId: 'peer-a', name: 'Ann' },
      { playerId: 'b', peerId: 'peer-b', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  }).session
}

it('keeps the seat when its connection drops', () => {
  const after = disconnect(session(), 'peer-b', 1_000).session
  const seat = after.seats.find((s) => s.playerId === 'b')

  expect(seat).toMatchObject({ playerId: 'b', peerId: null, absentSince: 1_000 })
  expect(after.state.players.b.hand.length).toBeGreaterThan(0)
})

it('stops syncing a disconnected seat', () => {
  const after = disconnect(session(), 'peer-b', 1_000).session
  const { outgoing } = applyIntent(after, 'peer-a', { type: 'DRAW' }, 1_100)

  expect(outgoing.map((o) => o.to)).toEqual(['peer-a'])
})

it('restores the seat on reconnect with one fresh SYNC', () => {
  const dropped = disconnect(session(), 'peer-b', 1_000).session
  const { session: back, outgoing } = rebind(dropped, 'b', 'peer-b-2', 1_000)
  const seat = back.seats.find((s) => s.playerId === 'b')
  const sync = outgoing[0]

  expect(seat).toMatchObject({ peerId: 'peer-b-2', absentSince: null })
  expect(outgoing).toHaveLength(1)
  expect(sync.to).toBe('peer-b-2')
  expect(sync.message.type).toBe('SYNC')
  if (sync.message.type === 'SYNC') expect(sync.message.payload.view.self.id).toBe('b')
})

it('refuses to rebind a seat that is still connected', () => {
  // Nothing authenticates a PlayerId — it is a uuid the client persists and
  // announces — so without this guard a peer naming someone else's would take
  // a live seat, receive its full projection (hand included) in the catch-up
  // SYNC, and leave the player still holding it hearing nothing at all.
  const live = session()
  const result = rebind(live, 'b', 'peer-attacker', 1_000)

  expect(result.session).toBe(live)
  expect(result.outgoing).toEqual([])
  expect(live.seats.find((s) => s.playerId === 'b')?.peerId).toBe('peer-b')
})

it('leaves an absent seat alone inside the grace period', () => {
  const dropped = disconnect(session(), 'peer-a', 1_000).session
  const result = driveUnattended(dropped, 1_000 + ABSENT_GRACE_MS - 1)

  expect(result.session).toBe(dropped)
})

it('drives an absent seat once the grace period expires, so the game cannot stall', () => {
  // 'a' holds the turn and vanishes: without the keeper acting, nothing can
  // ever advance and every other player waits forever.
  const dropped = disconnect(session(), 'peer-a', 1_000).session
  const result = driveUnattended(dropped, 1_000 + ABSENT_GRACE_MS + 1)

  expect(result.session.state).not.toBe(dropped.state)
})

// Three seats, so an absent seat that owes nothing (seated before the one
// that owes the actual pending action) can be told apart from one that does.
function threeSeatSession(): Session {
  return createSession({
    gameId: 'g2',
    keeperId: 'a',
    engine: createFakeEngine(),
    seed: 11,
    players: [
      { playerId: 'a', peerId: 'peer-a', name: 'Ann' },
      { playerId: 'b', peerId: 'peer-b', name: 'Bo' },
      { playerId: 'c', peerId: 'peer-c', name: 'Cy' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  }).session
}

// Deal 'a' an exact one-card hand so this test is about the fallback rule,
// not about which seed happens to strand a seat this way. Matches
// packages/engine/src/fake/release.test.ts's own convention of overriding a
// dealt hand after `createGame` rather than hunting for a seed.
it('falls back to DRAW/PUSH when an absent seat holds the turn but its bot suggestion is rejected', () => {
  const release: CardInstance = { uid: 'release-frontend#0', id: 'release-frontend' }
  const created = session()
  // `botAction` picks from `view.self.playable`, so a `playable` list that
  // offers more than `reduce` accepts sends the keeper into a move the engine
  // refuses — and an absent seat whose only suggestion bounces would stall the
  // whole game forever.
  //
  // The mismatch is injected rather than borrowed from the engine, because the
  // engine no longer has one to borrow: `playableFor`
  // (packages/engine/src/fake/project.ts) now checks that the hand can pay a
  // release's cost, which is where that disagreement belonged. This is a test
  // of the referee's net, and it should not go quiet the next time the engine
  // gets its lists right.
  const base = createFakeEngine()
  const overreporting: Engine = {
    ...base,
    project(state, viewer) {
      const view = base.project(state, viewer)
      if (viewer !== 'a') return view
      return { ...view, self: { ...view.self, playable: [release.uid] } }
    },
  }
  // `setup: {}` (see `session()` above) means `releaseCond` isn't 'easy', so
  // playing this release costs a second card and the hand holds none: `onPlay`
  // (packages/engine/src/fake/release.ts) rejects it.
  const forced: Session = {
    ...created,
    engine: overreporting,
    state: {
      ...created.state,
      turn: { ...created.state.turn, player: 'a', drawnFrom: [0] },
      players: { ...created.state.players, a: { ...created.state.players.a, hand: [release] } },
    },
  }
  const dropped = disconnect(forced, 'peer-a', 1_000).session

  const result = driveUnattended(dropped, 1_000 + ABSENT_GRACE_MS + 1)

  // botAction's first (and only) suggestion for this hand is PLAY
  // release-frontend#0, which the engine rejects. Without the fallback,
  // driveUnattended gives up here. With it, the turn ends via PUSH (hasDrawn is
  // already true) and passes to 'b'.
  expect(result.session.state).not.toBe(dropped.state)
  expect(result.session.state.turn.player).toBe('b')
})

// Same fixture and the same rejected bot suggestion, but pinning the log
// append at referee.ts's driveUnattended fallback (~256-267) specifically: the
// PUSH that resolves the fallback emits its own `turnEnded`/`turnStarted`
// pair, and this is the only test in the suite reaching that particular
// `log: [...session.log, ...retried.events]` line. Losing it would leave
// `result.session.state` changed (the assertions above would still pass)
// while nothing the fallback actually committed reached the log at all.
it('logs the fallback PUSH`s events, not just the state it changed', () => {
  const release: CardInstance = { uid: 'release-frontend#0', id: 'release-frontend' }
  const created = session()
  const base = createFakeEngine()
  const overreporting: Engine = {
    ...base,
    project(state, viewer) {
      const view = base.project(state, viewer)
      if (viewer !== 'a') return view
      return { ...view, self: { ...view.self, playable: [release.uid] } }
    },
  }
  const forced: Session = {
    ...created,
    engine: overreporting,
    state: {
      ...created.state,
      turn: { ...created.state.turn, player: 'a', drawnFrom: [0] },
      players: { ...created.state.players, a: { ...created.state.players.a, hand: [release] } },
    },
  }
  const dropped = disconnect(forced, 'peer-a', 1_000).session
  const before = dropped.log.length

  const result = driveUnattended(dropped, 1_000 + ABSENT_GRACE_MS + 1)

  const grown = result.session.log.slice(before).map((e) => e.type)
  expect(grown).toContain('turnEnded')
  expect(grown).toContain('turnStarted')
})

it('drives the absent seat that owes the action even when an earlier absent seat owes nothing', () => {
  // The turn is placed on 'c' rather than rotated there by play. Rotating meant
  // assuming a's and b's turns each end with a bare draw + push, which is a
  // fact about whatever those seats happen to draw — a trigger drawn on the way
  // opens a pending, refuses the push, and the turn never arrives. What this
  // test is about is which absent seat `driveUnattended` picks, so the turn is set
  // and the deal left out of it.
  const rotated = threeSeatSession()
  let s: typeof rotated = {
    ...rotated,
    state: { ...rotated.state, turn: { ...rotated.state.turn, player: 'c', drawnFrom: [] } },
  }
  expect(s.state.turn.player).toBe('c')

  // Seat order is [a, b, c]: 'a' is absent but owes nothing (it is not their
  // turn and nothing is pending on them); 'c' — last in seating order — is
  // the one actually on turn and owes the game its next move.
  s = disconnect(s, 'peer-a', 1_000).session
  s = disconnect(s, 'peer-c', 1_000).session

  const result = driveUnattended(s, 1_000 + ABSENT_GRACE_MS + 1)

  expect(result.session.state).not.toBe(s.state)
})
