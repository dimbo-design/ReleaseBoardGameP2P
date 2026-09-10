import type { PlayerId } from '@release/engine'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from '@release/engine/fake'
import type { WireMessage } from '../types'
import type { Sync, Ticker } from './link'
import { createMemoryNetwork } from './memoryNetwork'
import { ABSENT_GRACE_MS, createSession, type SessionRef } from './referee'
import { attachKeeper, createRemoteLink } from './remoteLink'
import { createStartGate, type StartGate } from './startGate'

// A keeper over a two-seat session, with the knobs the gate cases need. The
// frames peer-b receives are collected in `sent`, which is how "the keeper
// applied nothing" is observed from outside.
function keeperWith(
  opts: {
    gate?: StartGate
    ticker?: Ticker
    now?: () => number
    players?: { playerId: PlayerId; peerId: string | null; name: string }[]
  } = {},
) {
  const net = createMemoryNetwork(['peer-a', 'peer-b'])
  const { session } = createSession({
    gameId: 'g1',
    keeperId: 'a',
    engine: createFakeEngine(),
    seed: 3,
    players: opts.players ?? [
      { playerId: 'a', peerId: 'peer-a', name: 'Ann' },
      { playerId: 'b', peerId: 'peer-b', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const ref: SessionRef = { current: session }
  let clock = 1_000
  const sent: WireMessage[] = []
  const keeper = attachKeeper({
    ref,
    transport: net.transport('peer-a'),
    now: opts.now ?? (() => (clock += 100)),
    ticker: opts.ticker ?? { start: () => {}, stop: () => {} },
    gate: opts.gate,
  })
  net.onDeliver('peer-a', (frame) => keeper.handleMessage(frame))
  net.onDeliver('peer-b', (frame) => sent.push(frame))
  return { net, ref, keeper, sent }
}

function twoPeerGame() {
  const base = keeperWith()
  const remote = createRemoteLink({
    transport: base.net.transport('peer-b'),
    keeperPeerId: 'peer-a',
  })
  base.net.onDeliver('peer-b', (frame) => {
    base.sent.push(frame)
    remote.handleMessage(frame)
  })
  return { ...base, remote, link: remote.link }
}

// The gate's cap must not become a real 12-second timer in a unit test, so the
// keeper cases hand it a timer nobody fires.
const noCap = () => () => {}

it('carries a remote peer`s intent to the keeper and its view back', () => {
  const { ref, link } = twoPeerGame()
  const seen: Sync[] = []
  link.subscribe((sync) => seen.push(sync))

  // 'b' does not hold the turn, so this must come back as a rejection —
  // proving the round trip without depending on the deal.
  link.submit({ type: 'DRAW' })

  expect(seen).toHaveLength(1)
  expect(seen[0].view.self.id).toBe('b')
  expect(seen[0].events.map((e) => e.type)).toEqual(['rejected'])
  expect(ref.current.state.turn.player).toBe('a')
})

it('sends a remote peer only its own projection', () => {
  const { ref, link } = twoPeerGame()
  const seen: Sync[] = []
  link.subscribe((sync) => seen.push(sync))

  link.submit({ type: 'PASS' })

  const handA = ref.current.state.players.a.hand.map((c) => c.uid)
  const wire = JSON.stringify(seen)
  for (const uid of handA) expect(wire).not.toContain(uid)
})

it('drives the keeper`s own seat through its link, with no connection to itself', () => {
  // The keeper is a player too. A self-addressed `send` is dropped by PeerJS
  // (`connections.get(self)` is undefined), so if this seat had to go over the
  // transport the host could never take its own turn and every other player
  // would wait on it forever — `driveAbsent` never covers a seat that is
  // *connected*.
  const { ref, keeper } = twoPeerGame()
  const seen: Sync[] = []
  keeper.link.subscribe((sync) => seen.push(sync))

  keeper.link.submit({ type: 'DRAW' })

  expect(ref.current.state.turn.drawnFrom).not.toEqual([])
  expect(seen).toHaveLength(1)
  expect(seen[0].view.self.id).toBe('a')
})

it('ignores a SYNC that did not come from the keeper', () => {
  // A forged SYNC would replace a victim's whole view with cards of the
  // attacker's choosing, so their real actions come back rejected against a
  // board they cannot see.
  const { net, link } = twoPeerGame()
  const seen: Sync[] = []
  link.subscribe((sync) => seen.push(sync))

  net.transport('peer-c').send('peer-b', {
    type: 'SYNC',
    payload: { view: { self: { id: 'b' } } as never, events: [] },
  })

  expect(seen).toEqual([])
})

it('ignores a KEEPER_CHANGED that did not come from the keeper', () => {
  // `keeperId: null` is the death notice: honouring a forged one would drop
  // every player to the Reconnect screen and end the game mid-play.
  const net = createMemoryNetwork(['peer-a', 'peer-b', 'peer-c'])
  const changes: (string | null)[] = []
  const remote = createRemoteLink({
    transport: net.transport('peer-b'),
    keeperPeerId: 'peer-a',
    onKeeperChanged: (id) => changes.push(id),
  })
  net.onDeliver('peer-b', (frame) => remote.handleMessage(frame))

  net.transport('peer-c').send('peer-b', { type: 'KEEPER_CHANGED', payload: { keeperId: null } })
  expect(changes).toEqual([])

  net.transport('peer-a').send('peer-b', { type: 'KEEPER_CHANGED', payload: { keeperId: 'c' } })
  expect(changes).toEqual(['c'])
})

it('re-points at the successor once the caller resolves its peer id', () => {
  // KEEPER_CHANGED announces a `PlayerId` and `submit` addresses a peer id, so
  // the announcement alone cannot move the link: without `setKeeper` every
  // intent would keep going to the deposed keeper, or to nobody at all once it
  // left.
  const net = createMemoryNetwork(['peer-a', 'peer-b', 'peer-c'])
  const atC: WireMessage[] = []
  const remote = createRemoteLink({ transport: net.transport('peer-b'), keeperPeerId: 'peer-a' })
  net.onDeliver('peer-c', (frame) => atC.push(frame))

  remote.link.submit({ type: 'DRAW' })
  expect(atC).toEqual([])

  remote.setKeeper('peer-c')
  remote.link.submit({ type: 'DRAW' })

  expect(atC.map((f) => f.type)).toEqual(['INTENT'])
})

it('stops answering intents once it has handed the session over', () => {
  // Two keepers answering one table is worse than none: a move applied here
  // never reaches the successor, and the two SYNC streams contradict each
  // other on every peer whose link has not been re-pointed yet.
  const { ref, keeper, remote } = twoPeerGame()
  const before = ref.current

  keeper.handover('b')
  remote.link.submit({ type: 'DRAW' })

  expect(ref.current.keeperId).toBe('b')
  expect(ref.current.state).toBe(before.state)
})

it('drops a frame whose payload the envelope never validated', () => {
  // `parseEnvelope` checks type/from/seq and nothing else, so the payload is
  // whatever the connection carried — including nothing at all.
  const { ref, keeper } = twoPeerGame()
  const before = ref.current

  expect(() =>
    keeper.handleMessage({ type: 'INTENT', from: 'peer-b', seq: 1 } as WireMessage),
  ).not.toThrow()
  expect(() =>
    keeper.handleMessage({
      type: 'INTENT',
      payload: { intent: null },
      from: 'peer-b',
      seq: 2,
    } as unknown as WireMessage),
  ).not.toThrow()

  expect(ref.current).toBe(before)
})

it('never hands a subscriber a SYNC with no view in it', () => {
  const { net, link } = twoPeerGame()
  const seen: Sync[] = []
  link.subscribe((sync) => seen.push(sync))

  net.transport('peer-a').send('peer-b', { type: 'SYNC' } as never)

  expect(seen).toEqual([])
})

it('deals every seat its opening hand without anyone acting first', () => {
  const { keeper, link } = twoPeerGame()
  const remoteSeen: Sync[] = []
  const keeperSeen: Sync[] = []
  link.subscribe((sync) => remoteSeen.push(sync))
  keeper.link.subscribe((sync) => keeperSeen.push(sync))

  // Nobody has submitted anything. Without resync the table sits empty until
  // someone clicks, which is not a game.
  keeper.resync()

  expect(remoteSeen).toHaveLength(1)
  expect(keeperSeen).toHaveLength(1)
  expect(remoteSeen[0].view.self.id).toBe('b')
  expect(keeperSeen[0].view.self.id).toBe('a')
  expect(remoteSeen[0].view.self.hand.length).toBeGreaterThan(0)
  expect(keeperSeen[0].view.self.hand.length).toBeGreaterThan(0)
  // A statement of position, not a replay.
  expect(remoteSeen[0].events).toEqual([])
})

it('still sends each seat only its own hand on a resync', () => {
  const { ref, keeper, link } = twoPeerGame()
  const seen: Sync[] = []
  link.subscribe((sync) => seen.push(sync))

  keeper.resync()

  // The same guarantee the per-intent fan-out gives: none of a's card instances
  // may appear anywhere in what b receives.
  const handA = ref.current.state.players.a.hand.map((c) => c.uid)
  const wire = JSON.stringify(seen)
  expect(handA.length).toBeGreaterThan(0)
  for (const uid of handA) expect(wire).not.toContain(uid)
})

it('applies no intent while the gate is shut', () => {
  const { keeper, ref, sent } = keeperWith({
    gate: createStartGate({ expect: ['a', 'b'], schedule: noCap }),
  })
  const before = ref.current.state
  keeper.link.submit({ type: 'DRAW' })
  // Buffered, not rejected: the click was legitimate, it is just early.
  expect(ref.current.state).toBe(before)
  expect(sent.filter((m) => m.type === 'SYNC')).toHaveLength(0)
})

it('plays the buffered intents, in order, when the gate opens', () => {
  const gate = createStartGate({ expect: ['a', 'b'], schedule: noCap })
  const { keeper, ref } = keeperWith({ gate })
  const before = ref.current.state
  keeper.link.submit({ type: 'DRAW' })
  keeper.introReady('peer-a')
  expect(ref.current.state).toBe(before)
  keeper.introReady('peer-b')
  expect(ref.current.state).not.toBe(before)
})

it('releases buffered intents in arrival order', () => {
  const gate = createStartGate({ expect: ['a'], schedule: noCap })
  const { keeper, ref } = keeperWith({ gate })
  // DRAW then PUSH: applied the other way round, the PUSH would end the turn
  // and the DRAW would be rejected against a turn that is no longer a's.
  keeper.link.submit({ type: 'DRAW' })
  keeper.link.submit({ type: 'PUSH' })
  keeper.introReady('peer-a')
  expect(ref.current.state.turn.player).toBe('b')
  // b's turn is fresh — nothing drawn on it. (`drawnFrom` is the state's record
  // of which piles this turn drew from; the projection derives `hasDrawn` from
  // it for the UI.)
  expect(ref.current.state.turn.drawnFrom).toEqual([])
})

it('stamps a buffered intent with the clock at release, not at arrival', () => {
  const gate = createStartGate({ expect: ['a'], schedule: noCap })
  const reads: number[] = []
  let clock = 1_000
  const { keeper, ref } = keeperWith({
    gate,
    now: () => {
      reads.push(clock)
      return clock
    },
  })
  keeper.link.submit({ type: 'DRAW' })
  // The game begins when the gate opens, so the clock is not read at all while
  // the intent sits in the buffer.
  expect(reads).toEqual([])

  clock = 9_000
  keeper.introReady('peer-a')
  expect(reads).toEqual([9_000])
  // And the buffered DRAW really was applied on release, not dropped.
  expect(ref.current.state.turn.drawnFrom.length).toBeGreaterThan(0)
})

it('does not tick while the gate is shut', () => {
  // Only meaningful if the tick would otherwise move the game: seat 'b' holds
  // the turn and has dropped, so `driveAbsent` is past its grace period and one
  // tick away from playing a seat while everyone is still watching cards fly.
  const ticks: (() => void)[] = []
  const ticker = { start: (fn: () => void) => ticks.push(fn), stop: () => {} }
  const gate = createStartGate({ expect: ['a'], schedule: noCap })
  let clock = 1_000
  const { ref, keeper } = keeperWith({
    gate,
    ticker,
    now: () => clock,
    players: [
      { playerId: 'b', peerId: 'peer-b', name: 'Bo' },
      { playerId: 'a', peerId: 'peer-a', name: 'Ann' },
    ],
  })
  keeper.peerLeft('peer-b')
  clock += ABSENT_GRACE_MS + 1

  const before = ref.current.state
  for (const t of ticks) t()
  expect(ref.current.state).toBe(before)

  // The same tick, once the table is live, does move the game.
  keeper.introReady('peer-a')
  for (const t of ticks) t()
  expect(ref.current.state).not.toBe(before)
})

it('reads a seat report off the wire', () => {
  const gate = createStartGate({ expect: ['a', 'b'], schedule: noCap })
  const { keeper } = keeperWith({ gate })
  keeper.handleMessage({
    type: 'INTRO_READY',
    payload: { gameId: 'g1' },
    from: 'peer-b',
    seq: 1,
  })
  expect(gate.open).toBe(false)
  keeper.introReady('peer-a')
  expect(gate.open).toBe(true)
})

it('reads a report whose payload the envelope never validated', () => {
  // `parseEnvelope` checks type/from/seq and nothing else, and identity comes
  // from the connection — so the payload is never read through here.
  const gate = createStartGate({ expect: ['a'], schedule: noCap })
  const { keeper } = keeperWith({ gate })
  expect(() =>
    keeper.handleMessage({ type: 'INTRO_READY', from: 'peer-a', seq: 1 } as WireMessage),
  ).not.toThrow()
  expect(gate.open).toBe(true)
})

it('ignores a report from a peer holding no seat', () => {
  const gate = createStartGate({ expect: ['a', 'b'], schedule: noCap })
  const { keeper } = keeperWith({ gate })
  keeper.handleMessage({
    type: 'INTRO_READY',
    payload: { gameId: 'g1' },
    from: 'spectator-9',
    seq: 1,
  })
  keeper.introReady('spectator-9')
  expect(gate.open).toBe(false)
})

it('cancels the gate when the keeper stops keeping', () => {
  // A deposed or closed keeper still holding a pending cap would fire `flush`
  // into a session it no longer owns.
  const capped = createStartGate({ expect: ['a', 'b'], schedule: noCap })
  const closed = keeperWith({ gate: capped })
  closed.keeper.close()
  capped.ready('a')
  capped.ready('b')
  expect(capped.open).toBe(false)

  const handedOver = createStartGate({ expect: ['a', 'b'], schedule: noCap })
  const deposed = keeperWith({ gate: handedOver })
  deposed.keeper.handover('b')
  handedOver.ready('a')
  handedOver.ready('b')
  expect(handedOver.open).toBe(false)
})

it('drops a gate`s pending cap timer when the keeper closes', () => {
  const pending: (() => void)[] = []
  const gate = createStartGate({
    expect: ['a', 'b'],
    schedule: (fn) => {
      pending.push(fn)
      return () => {
        pending.splice(pending.indexOf(fn), 1)
      }
    },
  })
  const { keeper } = keeperWith({ gate })
  expect(pending).toHaveLength(1)
  keeper.close()
  expect(pending).toHaveLength(0)
})

it('opens on the cap so one silent peer cannot freeze the keeper', () => {
  const caps: (() => void)[] = []
  const gate = createStartGate({
    expect: ['a', 'b'],
    schedule: (fn) => {
      caps.push(fn)
      return () => {}
    },
  })
  const { keeper, ref } = keeperWith({ gate })
  const before = ref.current.state
  keeper.link.submit({ type: 'DRAW' })
  expect(ref.current.state).toBe(before)
  for (const fire of caps) fire()
  expect(ref.current.state).not.toBe(before)
})

it('runs ungated when no gate is supplied', () => {
  const { keeper, ref } = keeperWith({})
  const before = ref.current.state
  keeper.link.submit({ type: 'DRAW' })
  expect(ref.current.state).not.toBe(before)
})

it('reports every committed state change to onCommit', () => {
  const net = createMemoryNetwork(['host', 'guest'])
  const { session } = createSession({
    gameId: 'g1',
    keeperId: 'p1',
    engine: createFakeEngine(),
    seed: 1,
    players: [
      { playerId: 'p1', peerId: 'host', name: 'Ann' },
      { playerId: 'p2', peerId: 'guest', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const ref: SessionRef = { current: session }
  const saved: string[] = []
  const keeper = attachKeeper({
    ref,
    transport: net.transport('host'),
    now: () => 1_000,
    onCommit: (s) => saved.push(s.gameId),
  })

  keeper.peerLeft('guest')

  expect(saved).toEqual(['g1'])
  keeper.close()
})
