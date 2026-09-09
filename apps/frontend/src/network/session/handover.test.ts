import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from '@release/engine/fake'
import type { WireMessage } from '../types'
import { createMemoryNetwork } from './memoryNetwork'
import { adoptSession, createSession, handover, type Session, type SessionRef } from './referee'
import { attachKeeper } from './remoteLink'

function session(): Session {
  return createSession({
    gameId: 'g1',
    keeperId: 'a',
    engine: createFakeEngine(),
    seed: 5,
    players: [
      { playerId: 'a', peerId: 'peer-a', name: 'Ann' },
      { playerId: 'b', peerId: 'peer-b', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  }).session
}

it('hands the full state to the successor and announces the change', () => {
  const { outgoing } = handover(session(), 'b')
  const stateMessage = outgoing.find((o) => o.message.type === 'KEEPER_STATE')
  const announcement = outgoing.find((o) => o.message.type === 'KEEPER_CHANGED')

  expect(stateMessage?.to).toBe('peer-b')
  expect(announcement).toEqual({
    to: 'broadcast',
    message: { type: 'KEEPER_CHANGED', payload: { keeperId: 'b' } },
  })
})

it('sends GameState to the successor and to nobody else', () => {
  const { outgoing } = handover(session(), 'b')

  // The branch's headline privacy claim, asserted structurally: KEEPER_STATE is
  // the one message carrying GameState, and the successor is its only
  // recipient. A field-name scan would keep passing if the payload were
  // reshaped or if GameState rode inside some other message.
  const recipients = outgoing.filter((o) => o.message.type === 'KEEPER_STATE').map((o) => o.to)
  expect(recipients).toEqual(['peer-b'])
  for (const o of outgoing) {
    if (o.to !== 'peer-b') expect(o.message.type).not.toBe('KEEPER_STATE')
  }
})

it('hands over through the keeper handle and stops keeping the session', () => {
  const net = createMemoryNetwork(['peer-a', 'peer-b'])
  const ref: SessionRef = { current: session() }
  const received: WireMessage[] = []
  net.onDeliver('peer-b', (frame) => received.push(frame))
  let stopped = false
  const keeper = attachKeeper({
    ref,
    transport: net.transport('peer-a'),
    now: () => 1_000,
    ticker: {
      start: () => {},
      stop: () => {
        stopped = true
      },
    },
  })

  keeper.handover('b')

  expect(ref.current.keeperId).toBe('b')
  expect(received.map((f) => f.type)).toContain('KEEPER_STATE')
  expect(stopped).toBe(true)
})

it('refuses to hand over to itself, which would leave the clock unowned', () => {
  // A keeper who is also a player can pick their own name from the successor
  // list. Committing it would announce a change and stop the ticker while this
  // keeper still holds the session: no reaction window would ever expire and no
  // disconnected seat would ever be driven, hanging the whole table with no
  // error.
  const start = session()
  const result = handover(start, 'a')

  expect(result.session).toBe(start)
  expect(result.outgoing).toEqual([])
})

it('keeps its ticker running when a self-handover is refused', () => {
  const net = createMemoryNetwork(['peer-a', 'peer-b'])
  const ref: SessionRef = { current: session() }
  let stopped = false
  const keeper = attachKeeper({
    ref,
    transport: net.transport('peer-a'),
    now: () => 1_000,
    ticker: {
      start: () => {},
      stop: () => {
        stopped = true
      },
    },
  })

  keeper.handover('a')

  expect(ref.current.keeperId).toBe('a')
  expect(stopped).toBe(false)
})

it('refuses to hand over to a seat that is not connected', () => {
  const start = session()
  const orphaned: Session = {
    ...start,
    seats: start.seats.map((s) => (s.playerId === 'b' ? { ...s, peerId: null } : s)),
  }
  const result = handover(orphaned, 'b')

  expect(result.session).toBe(orphaned)
  expect(result.outgoing).toEqual([])
})

it('the successor adopts the state and can keep reducing', () => {
  const start = session()
  const adopted = adoptSession({
    state: start.state,
    gameId: 'g1',
    keeperId: 'b',
    engine: createFakeEngine(),
    seats: start.seats,
  })

  expect(adopted.keeperId).toBe('b')
  expect(adopted.state.players.a.hand).toEqual(start.state.players.a.hand)
  // KEEPER_STATE (the handover message above) carries GameState alone, so a
  // successor adopting through it has no log to be given — `log` defaults to
  // empty rather than being required.
  expect(adopted.log).toEqual([])
})

// The other caller of `adoptSession`: a host restoring its own match after a
// reload (`useLobby.ts`'s `restoreHost`) has the match's own log in hand —
// read back from storage — and this is what lets it hand it through instead
// of starting the successor's fresh-log default above.
it('adopts the log it is given instead, for a host restoring its own match', () => {
  const start = session()
  const adopted = adoptSession({
    state: start.state,
    gameId: 'g1',
    keeperId: 'a',
    engine: createFakeEngine(),
    seats: start.seats,
    log: start.log,
  })

  expect(adopted.log).toEqual(start.log)
})
