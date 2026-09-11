import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from '@release/engine/fake'
import { createLoopbackTransport } from '../transport/loopback'
import type { Ticker } from './link'
import { createSession, type SessionRef } from './referee'
import { attachKeeper } from './remoteLink'
import { buildSoloTable } from './solo'
import { createStartGate } from './startGate'

// A ticker the test advances by hand, so nothing here waits on a real clock.
function manualTicker(): Ticker & { fire(): void } {
  let fn: (() => void) | null = null
  return {
    start(f) {
      fn = f
    },
    stop() {
      fn = null
    },
    fire() {
      fn?.()
    },
  }
}

function soloGame(botNames: string[]) {
  const t = createLoopbackTransport()
  const table = buildSoloTable({
    selfPeerId: t.id,
    clientId: 'client-me',
    name: 'Ann',
    botNames,
    setup: {},
  })
  const engine = createFakeEngine()
  const { session } = createSession({
    gameId: 'solo-1',
    keeperId: 'p1',
    engine,
    // Choose this empirically rather than trusting the literal: a seed whose
    // opening draw is a trigger opens a pending, PUSH is then refused, and the
    // turn never reaches p2. Any seed reaching a clean draw serves. 7 is one
    // of the seeds where the opening draw IS a trigger, which is exactly what
    // this comment warns against — verified by running the suite, not by
    // eyeballing the deck. 17 reaches a clean draw and drives the bot's turn
    // across several ticks (five, at this deck/seat count) before handing
    // p1 the turn back, rather than resolving in one, so the test still
    // exercises "one action per tick" rather than degenerating into a single
    // step.
    seed: 17,
    players: table.players,
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const ref: SessionRef = { current: session }
  const gate = createStartGate({ expect: ['p1'] })
  const ticker = manualTicker()
  const keeper = attachKeeper({ ref, transport: t, now: () => Date.now(), ticker, gate })
  return { ref, gate, ticker, keeper, transport: t }
}

// The gate's whole purpose, in the shape solo gives it: the human is watching
// cards fly, and the bots must not be playing behind the animation.
it('holds every bot until the human reports its opening done', () => {
  const { ref, ticker, keeper, transport } = soloGame(['Bot 1'])
  const before = ref.current
  ticker.fire()
  expect(ref.current).toBe(before)

  keeper.introReady(transport.id)
  // The human is seat p1 and moves first, so the tick after the gate opens
  // stamps the turn clock rather than playing a bot — either way, the table is
  // no longer frozen.
  ticker.fire()
  expect(ref.current).not.toBe(before)
})

// The point of the whole feature: a seat with nobody behind it takes its turn.
it('plays a bot seat through to the human getting the turn back', () => {
  const { ref, ticker, keeper, transport } = soloGame(['Bot 1'])
  keeper.introReady(transport.id)

  // End the human's opening turn, so the bot is on.
  keeper.link.submit({ type: 'DRAW' })
  keeper.link.submit({ type: 'PUSH' })
  expect(ref.current.state.turn.player).toBe('p2')

  // One action per tick, exactly as an absent seat has always been driven.
  for (let i = 0; i < 20 && ref.current.state.turn.player === 'p2'; i += 1) ticker.fire()
  expect(ref.current.state.turn.player).toBe('p1')
})

// A bot holds no connection, so nothing may be addressed to it.
it('never projects a hand to a seat nobody is holding', () => {
  const { ref } = soloGame(['Bot 1', 'Bot 2'])
  expect(ref.current.seats.filter((s) => s.bot)).toHaveLength(2)
  expect(ref.current.seats.filter((s) => s.peerId !== null)).toHaveLength(1)
})
