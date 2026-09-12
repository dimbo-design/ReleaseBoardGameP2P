import type { CardInstance, GameState } from '@release/engine'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from '@release/engine/fake'
import { describe, expect, it } from 'vitest'
import type { Sync } from './link'
import { createMemoryNetwork } from './memoryNetwork'
import { createSession, type SessionRef } from './referee'
import { attachKeeper, createRemoteLink } from './remoteLink'

const REBASE: CardInstance = { uid: 'rebase', id: 'operation-git-rebase' }
const SUDO: CardInstance = { uid: 'sudo', id: 'support-sudo' }
const MAIN: CardInstance[][] = [
  [
    { uid: 'a0', id: 'attack-bug' },
    { uid: 'a1', id: 'defense-hotfix' },
    { uid: 'a2', id: 'release-frontend' },
    { uid: 'a3', id: 'protection-debugger' },
  ],
  [
    { uid: 'b0', id: 'attack-ddos' },
    { uid: 'b1', id: 'support-code-review' },
    { uid: 'b2', id: 'release-backend' },
    { uid: 'b3', id: 'defense-rollback' },
  ],
]

describe.each(['base', 'strategic'] as const)('Rebase over the %s Branch session', (gitBranch) => {
  it.each([
    { actor: 'a', sudo: false },
    { actor: 'a', sudo: true },
    { actor: 'b', sudo: false },
    { actor: 'b', sudo: true },
  ])('commits and draws through seat $actor with sudo=$sudo', ({ actor, sudo }) => {
    const net = createMemoryNetwork(['peer-a', 'peer-b'])
    const { session } = createSession({
      gameId: 'rebase-draw',
      keeperId: 'a',
      engine: createFakeEngine(),
      seed: 4242,
      players: [
        { playerId: 'a', peerId: 'peer-a', name: 'Ann' },
        { playerId: 'b', peerId: 'peer-b', name: 'Bo' },
      ],
      setup: { gitBranch, handLimit: 'base', releases: 'base', releaseCond: 'easy', ai: 'base' },
      deck: FAKE_DECK,
      events: FAKE_EVENTS,
    })
    const hand = sudo ? [REBASE, SUDO] : [REBASE]
    const state: GameState = {
      ...session.state,
      turn: { ...session.state.turn, player: actor, drawnFrom: [] },
      players: {
        a: { ...session.state.players.a, hand: actor === 'a' ? hand : [] },
        b: { ...session.state.players.b, hand: actor === 'b' ? hand : [] },
      },
      decks: { ...session.state.decks, main: MAIN, discard: [] },
    }
    const ref: SessionRef = { current: { ...session, state } }
    let now = 1_000
    const keeper = attachKeeper({
      ref,
      transport: net.transport('peer-a'),
      now: () => now++,
      ticker: { start: () => {}, stop: () => {} },
    })
    const remote = createRemoteLink({
      transport: net.transport('peer-b'),
      keeperPeerId: 'peer-a',
    })
    net.onDeliver('peer-a', keeper.handleMessage)
    net.onDeliver('peer-b', remote.handleMessage)
    const hostSyncs: Sync[] = []
    const guestSyncs: Sync[] = []
    keeper.link.subscribe((sync) => hostSyncs.push(sync))
    remote.link.subscribe((sync) => guestSyncs.push(sync))
    const link = actor === 'a' ? keeper.link : remote.link
    const actorSyncs = actor === 'a' ? hostSyncs : guestSyncs
    const otherSyncs = actor === 'a' ? guestSyncs : hostSyncs

    try {
      link.submit({
        type: 'PLAY',
        card: REBASE.uid,
        ...(sudo ? { combo: SUDO.uid } : { target: { kind: 'pile', pile: 1 } }),
      })
      expect(actorSyncs[0].view.pending).toMatchObject({
        kind: 'reorderTop',
        piles: (sudo ? [0, 1] : [1]).map((i) => ({ pile: i, cards: MAIN[i].slice(0, 3) })),
      })
      expect(otherSyncs[0].view.pending).toMatchObject({ kind: 'reorderTop', piles: [] })
      const beforeResolve = ref.current

      // Reversed pile entries also verify that pile identity, not entry position,
      // determines where each private order goes after the JSON round trip.
      link.submit({
        type: 'RESOLVE',
        choice: {
          kind: 'reorderTop',
          order: sudo
            ? [
                { pile: 1, cards: ['b2', 'b0', 'b1'] },
                { pile: 0, cards: ['a1', 'a2', 'a0'] },
              ]
            : [{ pile: 1, cards: ['b2', 'b0', 'b1'] }],
        },
      })

      expect(ref.current.state).not.toBe(beforeResolve.state)
      expect(ref.current.state.pending).toBeNull()
      expect(ref.current.log).toEqual(beforeResolve.log)
      expect(ref.current.state.decks.main).toEqual([
        sudo ? [MAIN[0][1], MAIN[0][2], MAIN[0][0], MAIN[0][3]] : MAIN[0],
        [MAIN[1][2], MAIN[1][0], MAIN[1][1], MAIN[1][3]],
      ])
      for (const syncs of [hostSyncs, guestSyncs]) {
        expect(syncs).toHaveLength(2)
        expect(syncs[1].events).toEqual([])
        expect(syncs[1].view.pending).toBeNull()
      }

      link.submit({ type: 'DRAW', pile: 1 })

      const expectedHand = gitBranch === 'base' ? [MAIN[0][sudo ? 1 : 0], MAIN[1][2]] : [MAIN[1][2]]
      expect(ref.current.state.players[actor].hand).toEqual(expectedHand)
      expect(actorSyncs[2].view.self.hand).toEqual(expectedHand)
      expect(actorSyncs[2].events).toMatchObject(
        expectedHand.map((card) => ({ type: 'drawn', player: actor, card: card.id })),
      )
      expect(ref.current.state.decks.main[1]).toEqual([MAIN[1][0], MAIN[1][1], MAIN[1][3]])
      expect(otherSyncs[2].view.self.hand).toEqual([])
      for (const card of expectedHand) {
        expect(JSON.stringify(otherSyncs[2])).not.toContain(`"${card.uid}"`)
      }
    } finally {
      remote.link.close()
      keeper.close()
    }
  })
})
