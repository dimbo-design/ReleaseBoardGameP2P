import type { Event } from '@release/engine'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from '@release/engine/fake'
import { forViewer } from './audience'
import { createMemoryNetwork } from './memoryNetwork'
import { applyIntent, createSession, disconnect, rebind, type SessionRef } from './referee'
import { attachKeeper } from './remoteLink'
import { restoreSeats } from './restore'

// The only test in this directory that drives the whole handshake through a
// real Transport (memoryNetwork.ts) rather than calling referee.ts functions
// directly — frames JSON round-trip exactly as they would over PeerJS, so a
// serialization bug in what rides the wire cannot hide the way it could in a
// referee-only test.
//
// Every other attachKeeper test in this directory stubs the ticker to avoid a
// real setInterval outliving the test; matched here for the same reason,
// though a synchronous test that closes its keeper well under 250ms would
// never actually observe the default one fire.
const noTicker = { start: () => {}, stop: () => {} }

function liveSession() {
  const net = createMemoryNetwork(['host', 'guest', 'guest-returned'])
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
  return { net, ref }
}

it('hands a returning peer its own hand back, on a new peer id', () => {
  const { net, ref } = liveSession()
  const keeper = attachKeeper({
    ref,
    transport: net.transport('host'),
    now: () => 1_000,
    ticker: noTicker,
  })
  const before = ref.current.engine.project(ref.current.state, 'p2').self.hand.map((c) => c.uid)

  keeper.peerLeft('guest')
  expect(ref.current.seats.find((s) => s.playerId === 'p2')?.peerId).toBeNull()

  const received: unknown[] = []
  net.onDeliver('guest-returned', (frame) => received.push(frame))
  keeper.peerReturned('p2', 'guest-returned')

  const sync = received.find((f) => (f as { type: string }).type === 'SYNC') as {
    payload: { view: { self: { hand: { uid: string }[] } } }
  }
  expect(sync).toBeDefined()
  expect(sync.payload.view.self.hand.map((c) => c.uid)).toEqual(before)
  keeper.close()
})

// Nothing authenticates a clientId, so `rebind` refusing an occupied seat is
// the whole defence. Pinned here because losing it would be silent: the
// claimant would simply start receiving another player's hand.
it('refuses a seat that is still connected', () => {
  const { net, ref } = liveSession()
  const keeper = attachKeeper({
    ref,
    transport: net.transport('host'),
    now: () => 1_000,
    ticker: noTicker,
  })
  keeper.peerReturned('p2', 'guest-returned')
  expect(ref.current.seats.find((s) => s.playerId === 'p2')?.peerId).toBe('guest')
  keeper.close()
})

it('a restored keeper resumes the same match a snapshot described', () => {
  const { net, ref } = liveSession()
  const snapshot = JSON.parse(JSON.stringify(ref.current.state))
  const seats = restoreSeats(ref.current.seats, 'host', 50_000)

  const restoredRef: SessionRef = {
    current: { ...ref.current, state: snapshot, seats },
  }
  const keeper = attachKeeper({
    ref: restoredRef,
    transport: net.transport('host'),
    now: () => 50_000,
    ticker: noTicker,
  })

  // The host kept its own seat; the guest's is empty and freshly stamped.
  expect(restoredRef.current.seats.find((s) => s.playerId === 'p1')?.peerId).toBe('host')
  expect(restoredRef.current.seats.find((s) => s.playerId === 'p2')?.absentSince).toBe(50_000)

  keeper.peerReturned('p2', 'guest-returned')
  expect(restoredRef.current.seats.find((s) => s.playerId === 'p2')?.peerId).toBe('guest-returned')
  keeper.close()
})

it('hands a rejoining seat the whole log it is entitled to, marked as a resend', () => {
  const { ref } = liveSession()
  ref.current = applyIntent(ref.current, 'host', { type: 'DRAW', pile: 0 }, 500).session
  // The seat has to be free before `rebind` will let it be reclaimed — it
  // refuses to move a seat that is still connected (see the guard's own
  // comment in referee.ts).
  ref.current = disconnect(ref.current, 'guest', 900).session
  // rebind(session, playerId, peerId, now) — a Session, and it needs a clock.
  const { outgoing } = rebind(ref.current, 'p2', 'guest-returned', 1_000)
  const sync = outgoing.find((o) => o.message.type === 'SYNC')
  const payload = sync?.message.type === 'SYNC' ? sync.message.payload : undefined
  expect(payload).toMatchObject({ resync: true })
  // Exactly the seat's own slice — forViewer does the filtering, so a resend
  // cannot hand a peer an event it was never entitled to.
  expect(payload?.events.map((e: Event) => e.id)).toEqual(
    forViewer(ref.current.log, 'p2').map((e) => e.id),
  )
})

it('does not mark an ordinary sync as a resend', () => {
  const { ref } = liveSession()
  const { outgoing } = applyIntent(ref.current, 'host', { type: 'DRAW', pile: 0 }, 500)
  const sync = outgoing.find((o) => o.message.type === 'SYNC')
  const payload = sync?.message.type === 'SYNC' ? sync.message.payload : undefined
  expect(payload?.resync).toBeFalsy()
})

// rebind has a second exit: when the rejoining seat's OWN turn deadline had
// already expired, it restamps the clock (CLOCK_STARTED) and returns early —
// a branch the resend above never reaches. That is not a narrow corner: it is
// exactly what a disconnect-during-your-own-turn-then-return looks like.
it('still hands the rejoiner the whole log, marked, when its own clock had expired', () => {
  const { ref } = liveSession()
  // End the host's turn so it becomes p2's turn, and p2's own clock starts
  // ticking the moment it does (stampTurnClock fires on every commit that
  // leaves the table idling on the player on turn).
  ref.current = applyIntent(ref.current, 'host', { type: 'DRAW', pile: 0 }, 500).session
  ref.current = applyIntent(ref.current, 'host', { type: 'PUSH' }, 600).session
  expect(ref.current.state.turn.player).toBe('p2')
  const deadline = ref.current.state.turn.deadline
  expect(deadline).toBeDefined()

  // p2 drops mid-turn and returns only after its own deadline has passed.
  ref.current = disconnect(ref.current, 'guest', (deadline ?? 0) - 1_000).session
  const beforeLog = ref.current.log

  const { outgoing } = rebind(ref.current, 'p2', 'guest-returned', (deadline ?? 0) + 1)

  // Exactly one SYNC reaches the rejoiner — not the ordinary unmarked delta
  // AND a marked resend, just the one, marked, resend.
  const toRejoiner = outgoing.filter((o) => o.to === 'guest-returned')
  expect(toRejoiner).toHaveLength(1)
  const rejoinerPayload =
    toRejoiner[0].message.type === 'SYNC' ? toRejoiner[0].message.payload : undefined
  expect(rejoinerPayload).toMatchObject({ resync: true })
  // The full visible log this seat is entitled to — not the (empty) restamp
  // delta the buggy early return used to send instead.
  expect(rejoinerPayload?.events.map((e: Event) => e.id)).toEqual(
    forViewer(beforeLog, 'p2').map((e) => e.id),
  )

  // The still-connected host keeps getting its ordinary, unmarked delta.
  const toHost = outgoing.filter((o) => o.to === 'host')
  expect(toHost).toHaveLength(1)
  const hostPayload = toHost[0].message.type === 'SYNC' ? toHost[0].message.payload : undefined
  expect(hostPayload?.resync).toBeFalsy()
})
