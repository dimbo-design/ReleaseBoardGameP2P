import type { Action, CardInstance, Event, GameState, Setup } from '@release/engine'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from '@release/engine/fake'
import { describe, expect, it } from 'vitest'
import { type HistoryLabels, toBoardState } from './toBoardState'

// Every other test for `returnCard`, `redirect` and the attack/defence nesting
// hand-writes `parent: 1` on the defence event. That pins the adapter's own
// contract and proves nothing about what a real exchange produces — which is
// exactly how the engine went on never emitting that link while four green
// tests said otherwise (#138). This drives the real engine through a real
// Rollback and a real Works on my Machine instead, so the tails are asserted
// against events the engine actually logged.
const T0 = 1_000_000
const labels = {} as HistoryLabels

// `releaseCond: 'easy'` is what lets a Release reach the board without paying a
// discard first — the shortest path to an open reaction window.
const EASY: Setup = {
  handLimit: 'base',
  releases: 'base',
  releaseCond: 'easy',
  ai: 'base',
  gitBranch: 'base',
}

const FE: CardInstance = { uid: 'release-frontend#0', id: 'release-frontend' }
const BUG: CardInstance = { uid: 'attack-bug#0', id: 'attack-bug' }
const ROLLBACK: CardInstance = { uid: 'defense-rollback#0', id: 'defense-rollback' }
const WOMM: CardInstance = {
  uid: 'defense-works-on-my-machine#0',
  id: 'defense-works-on-my-machine',
}

// Ann ships a Release, Bo throws a Bug at it, Ann answers with `defence`. The
// whole feed is kept, because the link under test spans two reductions: the
// `attacked` is logged by one, the `defended` by the next.
function exchange(defence: CardInstance): { view: ReturnType<typeof project>; log: Event[] } {
  const engine = createFakeEngine()
  let state = engine.createGame({
    gameId: 'g1',
    seed: 4242,
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bo' },
    ],
    setup: EASY,
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })

  // Hands put in place rather than dealt: relying on the deal would make this
  // hostage to FAKE_DECK's shuffle, and a failure would say nothing about
  // parents.
  state = {
    ...state,
    players: {
      ...state.players,
      p1: { ...state.players.p1, hand: [FE, defence] },
      p2: { ...state.players.p2, hand: [BUG] },
    },
  }

  const log: Event[] = []
  // `reduce` is total — an illegal action comes back unchanged with a `rejected`
  // event. Swallowing one would leave this asserting against an exchange that
  // never happened, so it throws instead.
  const step = (action: Action) => {
    const { state: next, events } = engine.reduce(state, action)
    const rejected = events.find((e) => e.type === 'rejected')
    if (rejected) {
      throw new Error(`${action.type} was rejected: ${(rejected as { reason: string }).reason}`)
    }
    state = next
    log.push(...events)
  }

  step({ type: 'PLAY', player: 'p1', card: FE.uid, at: T0 })
  step({ type: 'ATTACK', player: 'p2', card: BUG.uid, at: T0 + 1 })
  step({
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: defence.uid },
    at: T0 + 2,
  })

  return { view: project(state), log }
}

const project = (state: GameState) => createFakeEngine().project(state, 'p1')

describe('an attack and the defence that answered it, as the engine logs them', () => {
  it("names the attacker on Rollback's return tail", () => {
    const { view, log } = exchange(ROLLBACK)

    const table = toBoardState(view, log, labels)
    const attacked = log.find((e) => e.type === 'attacked')
    const defended = log.find((e) => e.type === 'defended')
    const attackRow = table.history.find((e) => e.id === attacked?.id)
    const defenceRow = attackRow?.children?.find((c) => c.id === defended?.id)

    // The name of the seat the card went back to — Bo threw it, Bo gets it back.
    expect(defenceRow?.returnCard).toBe('Bo')
  })

  it('nests the defence under the attack it answered', () => {
    const { view, log } = exchange(ROLLBACK)

    const table = toBoardState(view, log, labels)
    const defended = log.find((e) => e.type === 'defended')
    const attacked = log.find((e) => e.type === 'attacked')

    // The defence is no longer a root of its own: the tree hangs it off the
    // attack, which is the whole point of the engine carrying the id across.
    expect(table.history.some((e) => e.id === defended?.id)).toBe(false)
    const attackRow = table.history.find((e) => e.id === attacked?.id)
    expect(attackRow?.children?.map((c) => c.id)).toContain(defended?.id)
  })

  it("names the attacker on Works on my Machine's redirect tail", () => {
    const { view, log } = exchange(WOMM)

    const table = toBoardState(view, log, labels)
    const attacked = log.find((e) => e.type === 'attacked')
    const defended = log.find((e) => e.type === 'defended')
    const attackRow = table.history.find((e) => e.id === attacked?.id)
    const defenceRow = attackRow?.children?.find((c) => c.id === defended?.id)

    // The seat the effect bounced back into — the one that sent it.
    expect(defenceRow?.redirect).toBe('Bo')
  })
})
