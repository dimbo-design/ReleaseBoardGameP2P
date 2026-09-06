import { rulesFor } from '../cards'
import type { GameConfig } from '../engine'
import type { CardInstance, GameState } from '../state'
import { playableFor, project } from './project'
import { createGame } from './setup'

// A typo in a CardId is invisible to TypeScript (CardId is just string) and
// silently routes a test through the unsupported-id path instead of the rule
// it means to exercise. Fail loudly instead.
const inst = (id: string, n = 0): CardInstance => {
  if (!rulesFor(id)) throw new Error(`unknown card id in test fixture: ${id}`)
  return { uid: `${id}#${n}`, id }
}

const config = (): GameConfig => ({
  gameId: 'g1',
  seed: 4242,
  players: [
    { id: 'p1', name: 'you' },
    { id: 'p2', name: 'kernel_panic' },
  ],
  setup: {
    handLimit: 'base',
    releases: 'base',
    releaseCond: 'base',
    ai: 'base',
    gitBranch: 'base',
  },
  deck: [
    { id: 'release-frontend', qty: 4 },
    { id: 'attack-bug', qty: 7 },
    { id: 'protection-debugger', qty: 8 },
    { id: 'protection-monitoring', qty: 5 },
    { id: 'support-sudo', qty: 5 },
    { id: 'trigger-ai', qty: 12 },
  ],
  events: [{ id: 'ai-hallucination', qty: 2 }],
})

it('shows the viewer their own hand in full', () => {
  const s = createGame(config())
  const v = project(s, 'p1')
  expect(v.self.id).toBe('p1')
  expect(v.self.hand).toEqual(s.players.p1.hand)
})

it('reduces opponents to a hand count', () => {
  const s = createGame(config())
  const v = project(s, 'p1')
  expect(v.opponents).toHaveLength(1)
  expect(v.opponents[0].id).toBe('p2')
  expect(v.opponents[0].handCount).toBe(5)
  expect(JSON.stringify(v.opponents[0])).not.toContain('uid')
})

it('leaks no opponent card identity anywhere in the view', () => {
  const s = createGame(config())
  const v = project(s, 'p1')
  const serialized = JSON.stringify(v)
  for (const c of s.players.p2.hand) {
    expect(serialized, `leaked ${c.uid}`).not.toContain(c.uid)
  }
})

it('never reveals the ordered draw pile, only its size', () => {
  const s = createGame(config())
  const v = project(s, 'p1')
  expect(v.decks.piles).toEqual([s.decks.main[0].length])
  const serialized = JSON.stringify(v)
  for (const c of s.decks.main[0]) {
    expect(serialized, `leaked ${c.uid}`).not.toContain(c.uid)
  }
})

it('publishes the discard top and count', () => {
  const s = createGame(config())
  const withDiscard = {
    ...s,
    decks: { ...s.decks, discard: [{ uid: 'attack-bug#0', id: 'attack-bug' }] },
  }
  const v = project(withDiscard, 'p1')
  expect(v.decks.discardTop).toBe('attack-bug')
  expect(v.decks.discardCount).toBe(1)
})

it('publishes release zones as card ids for both sides', () => {
  const s = createGame(config())
  const placed = {
    ...s,
    players: {
      ...s.players,
      p2: {
        ...s.players.p2,
        release: {
          frontend: {
            card: { uid: 'release-frontend#0', id: 'release-frontend' },
            codeReview: { uid: 'support-code-review#0', id: 'support-code-review' },
          },
          backend: undefined,
          database: undefined,
          monitoring: undefined,
        },
      },
    },
  }
  const v = project(placed, 'p1')
  expect(v.opponents[0].release.frontend).toEqual({
    uid: 'release-frontend#0',
    card: 'release-frontend',
    codeReview: 'support-code-review',
  })
})

it('marks a player on their own turn as able to play something', () => {
  const s = createGame(config())
  // Add both a playable attack card and a non-playable support card
  const attackCard = inst('attack-bug', 1)
  const supportCard = inst('support-sudo', 1)
  const withCards = {
    ...s,
    players: {
      ...s.players,
      p1: {
        ...s.players.p1,
        hand: [attackCard, supportCard, ...s.players.p1.hand],
      },
    },
  }
  const playable = project(withCards, 'p1').self.playable
  // Should have playable cards (the attack card)
  expect(playable.length).toBeGreaterThan(0)
  // Should not include the support card
  expect(playable).toContain(attackCard.uid)
  expect(playable).not.toContain(supportCard.uid)
})

it('offers nothing playable to a player whose turn it is not', () => {
  const s = createGame(config())
  expect(project(s, 'p2').self.playable).toEqual([])
})

it('reports elimination on the opponent view', () => {
  const s = createGame(config())
  const out = { ...s, eliminated: ['p2'] }
  expect(project(out, 'p1').opponents[0].eliminated).toBe(true)
})

describe('projection privacy barrier', () => {
  it('copies setup so mutations do not reach the source', () => {
    const s = createGame(config())
    const v = project(s, 'p1')
    v.setup.handLimit = 'x' as never
    expect(s.setup.handLimit).toBe('base')
  })

  it('copies over so mutations do not reach the source', () => {
    const s = createGame(config())
    const withOver = { ...s, over: { winner: 'p1', condition: 'release' as const } }
    const v = project(withOver, 'p1')
    if (v.over) {
      v.over.winner = 'p2'
    }
    expect(withOver.over.winner).toBe('p1')
  })
})

describe('playableFor legality rules', () => {
  it('yields [] when game is over', () => {
    const s = createGame(config())
    const over = { ...s, over: { winner: 'p1', condition: 'release' as const } }
    expect(playableFor(over, 'p1')).toEqual([])
  })

  it('yields [] when a pending decision is set', () => {
    const s = createGame(config())
    const withPending = {
      ...s,
      pending: { kind: 'handLimit' as const, player: 'p1', excess: 2 },
    }
    expect(playableFor(withPending, 'p1')).toEqual([])
  })

  it('yields [] when a window is open', () => {
    const s = createGame(config())
    const withWindow = {
      ...s,
      window: {
        target: { player: 'p1', slot: 'frontend' as const, card: 'attack-bug#0' },
        round: 1,
        openedAt: 0,
        deadline: 0,
        passed: [],
      },
    }
    expect(playableFor(withWindow, 'p1')).toEqual([])
  })

  it('yields [] for an eliminated viewer', () => {
    const s = createGame(config())
    const eliminated = { ...s, eliminated: ['p1'] }
    expect(playableFor(eliminated, 'p1')).toEqual([])
  })

  it('does not include a frozen card', () => {
    const s = createGame(config())
    // Freeze an attack card that would otherwise be playable, not a protection card
    const attackCard = inst('attack-bug', 1)
    const unplayableAttack = inst('attack-bug', 2)
    const frozen = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1,
          hand: [attackCard, unplayableAttack, ...s.players.p1.hand],
          frozen: [attackCard.uid],
        },
      },
    }
    const playable = playableFor(frozen, 'p1')
    // The frozen attack card should not be playable
    expect(playable).not.toContain(attackCard.uid)
    // But an unfrozen attack card should be playable
    expect(playable).toContain(unplayableAttack.uid)
  })

  it('does not include a release card when its slot is filled', () => {
    const s = createGame(config())
    // Explicitly put a release card in hand
    const releaseCard = inst('release-frontend', 1)
    const filledSlot = { card: inst('release-frontend', 0) }
    const filled = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1,
          hand: [releaseCard, ...s.players.p1.hand],
          release: {
            ...s.players.p1.release,
            frontend: filledSlot,
          },
        },
      },
    }
    const playable = playableFor(filled, 'p1')
    // The release card should not be playable when slot is filled
    expect(playable).not.toContain(releaseCard.uid)
  })

  // `playable` is a promise to every consumer that reads it — the UI renders
  // it, `botAction` picks from it, and the keeper drives an absent seat from
  // it. A release the hand cannot pay for is one `onPlay` rejects (release.ts,
  // "no card left to pay the release cost"), so offering it shows a player a
  // card that bounces back with nothing to explain it and sends a policy into
  // a move that cannot land.
  it('does not include a lone release, whose cost the hand cannot pay', () => {
    const s = createGame(config())
    const releaseCard = inst('release-frontend', 1)
    const lone = {
      ...s,
      players: { ...s.players, p1: { ...s.players.p1, hand: [releaseCard] } },
    }

    expect(playableFor(lone, 'p1')).not.toContain(releaseCard.uid)

    // One spare card is the whole difference: it is what pays the cost.
    const affordable = {
      ...lone,
      players: {
        ...lone.players,
        p1: { ...lone.players.p1, hand: [releaseCard, inst('support-sudo', 3)] },
      },
    }
    expect(playableFor(affordable, 'p1')).toContain(releaseCard.uid)
  })

  it('includes a lone release under releaseCond: easy, where it costs nothing', () => {
    const s = createGame({ ...config(), setup: { ...config().setup, releaseCond: 'easy' } })
    const releaseCard = inst('release-frontend', 1)
    const lone = {
      ...s,
      players: { ...s.players, p1: { ...s.players.p1, hand: [releaseCard] } },
    }

    expect(playableFor(lone, 'p1')).toContain(releaseCard.uid)
  })

  it('does not include a release card when the cap is hit under releases: base', () => {
    const s = createGame(config())
    // Explicitly put a release card in hand
    const releaseCard = inst('release-database', 1)
    const withPlayedRelease = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1,
          hand: [releaseCard, ...s.players.p1.hand],
        },
      },
      turn: { ...s.turn, releasesPlayed: 1 },
    }
    // Under releases: 'base', cap is 1, so with 1 already played, no more releases are playable
    const playable = playableFor(withPlayedRelease, 'p1')
    // The release card should not be playable when cap is hit
    expect(playable).not.toContain(releaseCard.uid)
  })

  it('allows release cards when cap is not hit under releases: fast', () => {
    const fastConfig = { ...config(), setup: { ...config().setup, releases: 'fast' } }
    const fast = createGame(fastConfig)
    // Construct state with explicit release card in hand and cap already hit at 1
    const releaseCard = inst('release-backend', 1)
    const supportCard = inst('support-sudo', 1)
    const withRelease = {
      ...fast,
      players: {
        ...fast.players,
        p1: {
          ...fast.players.p1,
          hand: [releaseCard, supportCard, ...fast.players.p1.hand],
          // backend slot is empty, so card can be played
          release: { ...fast.players.p1.release, backend: undefined },
        },
      },
      turn: { ...fast.turn, releasesPlayed: 1 },
    }
    const playable = playableFor(withRelease, 'p1')
    // Under releases: 'fast', cap is Infinity, so even after 1 played, this release is playable
    expect(playable).toContain(releaseCard.uid)
    // But support cards are never playable
    expect(playable).not.toContain(supportCard.uid)
  })

  it('includes protection-monitoring when monitoring slot is empty', () => {
    const s = createGame(config())
    // Explicitly add protection-monitoring and a trigger card (not playable) to hand
    const monitoringCard = inst('protection-monitoring', 1)
    const triggerCard = inst('trigger-ai', 1)
    const withMonitoring = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1,
          hand: [monitoringCard, triggerCard, ...s.players.p1.hand],
          // Ensure monitoring slot is empty
          release: { ...s.players.p1.release, monitoring: undefined },
        },
      },
    }
    const playable = playableFor(withMonitoring, 'p1')
    // Monitoring card should be playable
    expect(playable).toContain(monitoringCard.uid)
    // Trigger card should not be playable
    expect(playable).not.toContain(triggerCard.uid)
  })

  it('does not include protection-monitoring when monitoring slot is filled', () => {
    const s = createGame(config())
    // Explicitly add protection-monitoring to hand and fill the monitoring slot
    const monitoringCard = inst('protection-monitoring', 1)
    const filledMonitoring = inst('protection-monitoring', 0)
    const filled = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1,
          hand: [monitoringCard, ...s.players.p1.hand],
          release: {
            ...s.players.p1.release,
            monitoring: filledMonitoring,
          },
        },
      },
    }
    const playable = playableFor(filled, 'p1')
    expect(playable).not.toContain(monitoringCard.uid)
  })

  it('never includes protection-debugger', () => {
    const s = createGame(config())
    // Explicitly add protection-debugger to hand
    const debuggerCard = inst('protection-debugger', 1)
    const withDebugger = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1,
          hand: [debuggerCard, ...s.players.p1.hand],
        },
      },
    }
    const playable = playableFor(withDebugger, 'p1')
    expect(playable).not.toContain(debuggerCard.uid)
  })

  it('never includes cancel (defence) cards', () => {
    const s = createGame(config())
    // Explicitly add defence cards to hand with correct spelling
    const cancelCard = inst('defense-hotfix', 1)
    const notABugCard = inst('defense-not-a-bug', 1)
    const withDefence = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1,
          hand: [cancelCard, notABugCard, ...s.players.p1.hand],
        },
      },
    }
    const playable = playableFor(withDefence, 'p1')
    expect(playable).not.toContain(cancelCard.uid)
    expect(playable).not.toContain(notABugCard.uid)
  })

  it('never includes support cards', () => {
    const s = createGame(config())
    // Explicitly add support card and an attack card (playable) to hand
    const supportCard = inst('support-sudo', 1)
    const attackCard = inst('attack-bug', 1)
    const withSupport = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1,
          hand: [supportCard, attackCard, ...s.players.p1.hand],
        },
      },
    }
    const playable = playableFor(withSupport, 'p1')
    // Support card should not be playable
    expect(playable).not.toContain(supportCard.uid)
    // Attack card should be playable
    expect(playable).toContain(attackCard.uid)
  })

  it('never includes trigger cards', () => {
    const s = createGame(config())
    // Explicitly add trigger card and an attack card (playable) to hand
    const triggerCard = inst('trigger-ai', 1)
    const attackCard = inst('attack-bug', 1)
    const withTrigger = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1,
          hand: [triggerCard, attackCard, ...s.players.p1.hand],
        },
      },
    }
    const playable = playableFor(withTrigger, 'p1')
    // Trigger card should not be playable
    expect(playable).not.toContain(triggerCard.uid)
    // Attack card should be playable
    expect(playable).toContain(attackCard.uid)
  })
})

// Builds a state with only the named players' hands replaced — everything
// else (deck, turn, releases) comes from a fresh default game. Shared by
// `self.targets` and `self.combos`, both of which prime a hand and read the
// projection back.
const primed = (hands: Record<string, CardInstance[]>): GameState => {
  const s = createGame(config())
  let players = s.players
  for (const [id, hand] of Object.entries(hands)) {
    players = { ...players, [id]: { ...players[id], hand } }
  }
  return { ...s, players }
}

describe('self.targets', () => {
  it('projects legal targets for playable attacks and nothing else', () => {
    // prime: it is p1's turn (default), p1 holds an attack, a release, and a defence
    const s = primed({
      p1: [inst('attack-bug', 0), inst('release-frontend', 0), inst('defense-hotfix', 0)],
    })
    const view = project(s, 'p1')
    // the attack targets every living opponent's seat
    expect(view.self.targets['attack-bug#0']).toEqual([{ kind: 'player', player: 'p2' }])
    // a release needs no target: no entry, not an empty one
    expect(view.self.targets['release-frontend#0']).toBeUndefined()
    // an unplayable card (defence on your own turn) has no entry either
    expect(view.self.targets['defense-hotfix#0']).toBeUndefined()
  })

  it('projects release and monitoring targets for DDoS', () => {
    // p2 stands a Frontend release and a Monitoring; p1 holds attack-ddos
    const s = primed({ p1: [inst('attack-ddos', 0)] })
    const sWithP2Release: GameState = {
      ...s,
      players: {
        ...s.players,
        p2: {
          ...s.players.p2,
          release: {
            ...s.players.p2.release,
            frontend: { card: inst('release-frontend', 9) },
            monitoring: inst('protection-monitoring', 9),
          },
        },
      },
    }
    const view = project(sWithP2Release, 'p1')
    expect(view.self.targets['attack-ddos#0']).toEqual(
      expect.arrayContaining([
        { kind: 'monitoring', player: 'p2' },
        { kind: 'release', player: 'p2', slot: 'frontend' },
      ]),
    )
  })

  it('projects no targets while a window or pending suspends play', () => {
    // any state where playableFor returns [] — e.g. a window is open
    const s = createGame(config())
    const windowOpen: GameState = {
      ...s,
      window: {
        target: { player: 'p1', slot: 'frontend' as const, card: 'attack-bug#0' },
        round: 1,
        openedAt: 0,
        deadline: 0,
        passed: [],
      },
    }
    expect(project(windowOpen, 'p2').self.targets).toEqual({})
  })
})

describe('self.combos', () => {
  it('pairs Sudo with playable sudo-carriers on the holder turn', () => {
    // p1's turn; hand: support-sudo#0, attack-bug#0 (targets exist), defense-rollback#0
    const s = primed({
      p1: [inst('support-sudo', 0), inst('attack-bug', 0), inst('defense-rollback', 0)],
    })
    const view = project(s, 'p1')
    // rollback is a defence — not playable on your own turn, so not pairable here
    expect(view.self.combos['support-sudo#0']).toEqual(['attack-bug#0'])
  })

  it('pairs Sudo with canAttackWith cards inside a reaction window', () => {
    // p1 stands a Frontend release; window open on it; p2 holds the sudo pair
    const s = primed({ p2: [inst('support-sudo', 0), inst('attack-bug', 0)] })
    const windowOpen: GameState = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1,
          release: { ...s.players.p1.release, frontend: { card: inst('release-frontend', 9) } },
        },
      },
      window: {
        target: { player: 'p1', slot: 'frontend' as const, card: 'attack-bug#0' },
        round: 1,
        openedAt: 0,
        deadline: 0,
        passed: [],
      },
    }
    expect(project(windowOpen, 'p2').self.combos['support-sudo#0']).toEqual(['attack-bug#0'])
  })

  it('pairs Code Review with a playable release only when a third card can pay', () => {
    // releaseCond: base; hand of exactly [release-frontend#0, support-code-review#0] —
    // the pair would leave nothing to pay the cost, so release.ts:268 rejects it,
    // and the offer must too
    const twoCardHand = primed({
      p1: [inst('release-frontend', 0), inst('support-code-review', 0)],
    })
    expect(project(twoCardHand, 'p1').self.combos['support-code-review#0']).toBeUndefined()

    // a third card in hand is what pays the cost, so the pairing appears
    const threeCardHand = primed({
      p1: [
        inst('release-frontend', 0),
        inst('support-code-review', 0),
        inst('protection-debugger', 0),
      ],
    })
    expect(project(threeCardHand, 'p1').self.combos['support-code-review#0']).toEqual([
      'release-frontend#0',
    ])
  })

  it('pairs Code Review with a two-card hand under releaseCond: easy, where there is no cost', () => {
    const s = createGame({ ...config(), setup: { ...config().setup, releaseCond: 'easy' } })
    const easyTwoCardHand = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1,
          hand: [inst('release-frontend', 0), inst('support-code-review', 0)],
        },
      },
    }
    expect(project(easyTwoCardHand, 'p1').self.combos['support-code-review#0']).toEqual([
      'release-frontend#0',
    ])
  })

  it('offers no combos while a defence pending suspends play, and the hand holds nothing it may answer with', () => {
    const s = primed({ p2: [inst('support-sudo', 0), inst('attack-bug', 0)] })
    const pendingDefend: GameState = {
      ...s,
      pending: {
        kind: 'defend' as const,
        player: 'p2',
        attacker: 'p1',
        attack: 'attack-bug#1',
        attackId: 'attack-bug',
        sudo: false,
        canDefendWith: [],
        openedAt: 0,
        deadline: 1000,
        scope: 'hand' as const,
      },
    }
    expect(project(pendingDefend, 'p2').self.combos).toEqual({})
  })

  // Task 17 (#101): a defend pending owed to this player is the one case
  // `playableFor` empties out (project.ts's own first check) that still has a
  // legal Sudo pairing — the defence it is about to enhance. Sourced from the
  // pending's own answerable set (`canDefendWith`), not re-derived: legality
  // stays the engine's answer even here.
  it("pairs the defender's own Sudo with the defence it may enhance, while a defend pending is open", () => {
    // only defense-rollback carries the sudo tag (cards.ts) — defense-hotfix
    // answers the SAME attack but cannot be enhanced by a Sudo
    const s = primed({
      p2: [inst('support-sudo', 0), inst('defense-rollback', 0), inst('defense-hotfix', 0)],
    })
    const pendingDefend: GameState = {
      ...s,
      pending: {
        kind: 'defend' as const,
        player: 'p2',
        attacker: 'p1',
        attack: 'attack-bug#1',
        attackId: 'attack-bug',
        sudo: false,
        canDefendWith: ['defense-rollback#0', 'defense-hotfix#0'],
        openedAt: 0,
        deadline: 1000,
        scope: 'release' as const,
      },
    }
    expect(project(pendingDefend, 'p2').self.combos['support-sudo#0']).toEqual([
      'defense-rollback#0',
    ])
  })

  // The restriction "under a sudo-backed attack a Sudo can enhance nothing"
  // falls out of the intersection above for free: a sudo attack already drops
  // Rollback from `canDefendWith` (Cancel fails against sudo — `defencesFor`,
  // pinned in attacks.test.ts's own "denies a Cancel defence against a sudo
  // attack"), so there is nothing left in the intersection to offer.
  it('offers no sudo pairing under a sudo-backed attack, mirroring canDefendWith', () => {
    const s = primed({
      p2: [inst('support-sudo', 0), inst('defense-rollback', 0), inst('defense-not-a-bug', 0)],
    })
    const pendingDefend: GameState = {
      ...s,
      pending: {
        kind: 'defend' as const,
        player: 'p2',
        attacker: 'p1',
        attack: 'attack-bug#1',
        attackId: 'attack-bug',
        sudo: true,
        // a sudo attack: Cancel-kind defense-rollback is withheld, only the
        // Unicorn-kind defence remains
        canDefendWith: ['defense-not-a-bug#0'],
        openedAt: 0,
        deadline: 1000,
        scope: 'release' as const,
      },
    }
    expect(project(pendingDefend, 'p2').self.combos['support-sudo#0']).toBeUndefined()
  })

  // A pending owed to someone ELSE must never leak the defender's own combo
  // to the projection built for the viewer asking — `pendingView` already
  // redacts `options` to [] for a non-owner; this is the same boundary for
  // `combos`.
  it('never offers a combo for a defend pending owed to someone else', () => {
    const s = primed({ p2: [inst('support-sudo', 0), inst('defense-rollback', 0)] })
    const pendingDefend: GameState = {
      ...s,
      pending: {
        kind: 'defend' as const,
        player: 'p1',
        attacker: 'p2',
        attack: 'attack-bug#1',
        attackId: 'attack-bug',
        sudo: false,
        canDefendWith: ['defense-rollback#0'],
        openedAt: 0,
        deadline: 1000,
        scope: 'release' as const,
      },
    }
    expect(project(pendingDefend, 'p2').self.combos).toEqual({})
  })
})

describe('the AI facts a board cannot otherwise see', () => {
  it('projects `event` for an AI-granted release and omits it for an ordinary one', () => {
    const base = createGame(config())
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        p1: {
          ...base.players.p1,
          release: {
            frontend: {
              card: { uid: 'ai#1', id: 'release-frontend', event: 'ai-release-frontend' },
            },
            backend: { card: { uid: 'base#1', id: 'release-backend' } },
          },
        },
      },
    }
    const view = project(state, 'p1')
    expect(view.self.release.frontend?.event).toBe('ai-release-frontend')
    expect(view.self.release.backend?.event).toBeUndefined()
  })

  it('projects the AI card behind a crush prompt, to a player who is not the one asked', () => {
    const base = createGame(config())
    const state: GameState = {
      ...base,
      pending: {
        kind: 'crush',
        player: 'p1',
        slot: 'frontend',
        methods: ['debugger'],
        source: 'ai-crush-frontend',
      },
    }
    // public, like `pickFromDiscard.source` — the whole table watched it revealed
    expect(project(state, 'p2').pending).toMatchObject({ source: 'ai-crush-frontend' })
  })

  it('projects the AI card behind a Bad Vibe hand limit and behind the 503 mimic', () => {
    const base = createGame(config())
    const bad: GameState = {
      ...base,
      pending: {
        kind: 'handLimit',
        player: 'p1',
        excess: 1,
        endsTurn: false,
        source: 'ai-bad-vibe-coding',
      },
    }
    expect(project(bad, 'p2').pending).toMatchObject({ source: 'ai-bad-vibe-coding' })
    const mimic: GameState = {
      ...base,
      pending: {
        kind: 'neutralize503',
        player: 'p1',
        card: null,
        methods: ['debugger'],
        source: 'ai-error-503',
      },
    }
    // `card` stays null — `bankAlarm` reads it to decide what to bank, and the
    // mimic's own card is already home in the events deck
    expect(project(mimic, 'p2').pending).toMatchObject({ card: null, source: 'ai-error-503' })
  })
})
