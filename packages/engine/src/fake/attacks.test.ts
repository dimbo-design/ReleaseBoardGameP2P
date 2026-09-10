import type { GameConfig } from '../engine'
import type { CardInstance, GameState, Setup } from '../state'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from './index'
import { reduce } from './reduce'
import { WINDOW_NEXT_MS } from './window'

const engine = createFakeEngine()

const EASY: Setup = {
  handLimit: 'base',
  releases: 'base',
  releaseCond: 'easy',
  ai: 'base',
  gitBranch: 'base',
}

const config = (): GameConfig => ({
  gameId: 'g1',
  seed: 4242,
  players: [
    { id: 'p1', name: 'you' },
    { id: 'p2', name: 'kernel_panic' },
  ],
  setup: EASY,
  deck: FAKE_DECK,
  events: FAKE_EVENTS,
})

const FE: CardInstance = { uid: 'release-frontend#0', id: 'release-frontend' }
const FE2: CardInstance = { uid: 'release-frontend#1', id: 'release-frontend' }
const BUG: CardInstance = { uid: 'attack-bug#0', id: 'attack-bug' }
const BUG2: CardInstance = { uid: 'attack-bug#1', id: 'attack-bug' }
const SEC: CardInstance = { uid: 'attack-security-bug#0', id: 'attack-security-bug' }
const SUDO: CardInstance = { uid: 'support-sudo#0', id: 'support-sudo' }
const HOTFIX: CardInstance = { uid: 'defense-hotfix#0', id: 'defense-hotfix' }
const NOTABUG: CardInstance = { uid: 'defense-not-a-bug#0', id: 'defense-not-a-bug' }
const ROLLBACK: CardInstance = { uid: 'defense-rollback#0', id: 'defense-rollback' }
const WOMM: CardInstance = {
  uid: 'defense-works-on-my-machine#0',
  id: 'defense-works-on-my-machine',
}
const DDOS: CardInstance = { uid: 'attack-ddos#0', id: 'attack-ddos' }
const MON: CardInstance = { uid: 'protection-monitoring#0', id: 'protection-monitoring' }

// p1 releases Frontend; p1 then holds `defence`, p2 holds `attack`.
const staged = (attack: CardInstance[], defence: CardInstance[]): GameState => {
  const s = engine.createGame(config())
  const primed: GameState = {
    ...s,
    players: {
      ...s.players,
      p1: { ...s.players.p1, hand: [FE, ...defence] },
      p2: { ...s.players.p2, hand: attack },
    },
  }
  return reduce(primed, { type: 'PLAY', player: 'p1', card: FE.uid, at: 1000 }).state
}

it('turns an attack into a defence decision for the release owner', () => {
  const r = reduce(staged([BUG], [HOTFIX]), {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    at: 1001,
  })
  expect(r.state.pending).toMatchObject({
    kind: 'defend',
    player: 'p1',
    attacker: 'p2',
    attack: BUG.uid,
    sudo: false,
    canDefendWith: [HOTFIX.uid],
  })
  expect(r.events.map((e) => e.type)).toEqual(['attacked'])
})

it('destroys the release when the owner takes the hit', () => {
  const attacked = reduce(staged([BUG], []), {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: null },
    at: 1002,
  })
  expect(r.state.players.p1.release.frontend).toBeUndefined()
  expect(r.state.window).toBeNull()
  expect(r.state.decks.discard.map((c) => c.uid)).toContain(FE.uid)
  // The attack card is now banked (and says so) at resolution, between the hit
  // and the release it destroyed — Task 8 (#100).
  expect(r.events.map((e) => e.type)).toEqual([
    'tookHit',
    'discarded',
    'releaseDestroyed',
    'windowClosed',
  ])
})

it('reopens the window a round later when the attack is cancelled', () => {
  const attacked = reduce(staged([BUG], [HOTFIX]), {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: HOTFIX.uid },
    at: 1002,
  })
  expect(r.state.players.p1.release.frontend?.card).toEqual(FE)
  expect(r.state.window).toMatchObject({ round: 2, deadline: 1002 + WINDOW_NEXT_MS, passed: [] })
  expect(r.state.decks.discard.map((c) => c.uid)).toEqual([BUG.uid, HOTFIX.uid])
})

it('denies a Cancel defence against a sudo attack but allows a Unicorn', () => {
  const withSudo = staged([BUG, SUDO], [HOTFIX, NOTABUG])
  const attacked = reduce(withSudo, {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    combo: SUDO.uid,
    at: 1001,
  })
  expect(attacked.state.pending).toMatchObject({ sudo: true, canDefendWith: [NOTABUG.uid] })

  const refused = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: HOTFIX.uid },
    at: 1002,
  })
  expect(refused.state).toBe(attacked.state)
  expect(refused.events[0].type).toBe('rejected')

  const held = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: NOTABUG.uid },
    at: 1002,
  })
  expect(held.state.players.p1.release.frontend?.card).toEqual(FE)
})

it('holds the sudo half on the pending, not in the discard', () => {
  const r = reduce(staged([BUG, SUDO], [NOTABUG]), {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    combo: SUDO.uid,
    at: 1001,
  })
  expect(r.state.decks.discard).not.toContainEqual(SUDO)
  expect(r.state.pending).toMatchObject({ kind: 'defend', combo: SUDO })
  expect(r.events.map((e) => e.type)).toEqual(['attacked']) // unchanged at attack time
})

it('banks both halves with attackSpent when the hit is taken', () => {
  const attacked = reduce(staged([BUG, SUDO], []), {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    combo: SUDO.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: null },
    at: 1002,
  })
  const discards = r.events.filter((e) => e.type === 'discarded')
  expect(discards).toMatchObject([
    { card: BUG.id, reason: 'attackSpent', player: 'p2' },
    { card: SUDO.id, reason: 'attackSpent', player: 'p2' },
  ])
  // parent: both discards hang off the tookHit event
  const hit = r.events.find((e) => e.type === 'tookHit')
  for (const d of discards) expect(d.parent).toBe(hit?.id)
  expect(r.state.decks.discard).toEqual(expect.arrayContaining([BUG, SUDO]))
})

it('banks a sudo-comboed attack’s both halves, then the cancelling defence, when it is repelled', () => {
  // Not a Bug is the only cancel-effect card `defencesFor` still offers against
  // a sudo attack (it is 'unicorn' kind, exempt from the sudo block that
  // 'cancel' kind cards like Hotfix hit) — the one way to reach this shape.
  const attacked = reduce(staged([BUG, SUDO], [NOTABUG]), {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    combo: SUDO.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: NOTABUG.uid },
    at: 1002,
  })
  const discards = r.events.filter((e) => e.type === 'discarded')
  // Order: the attack card banks before its sudo half, both before the defence.
  expect(discards).toMatchObject([
    { card: BUG.id, reason: 'attackSpent', player: 'p2' },
    { card: SUDO.id, reason: 'attackSpent', player: 'p2' },
    { card: NOTABUG.id, reason: 'defenceSpent', player: 'p1' },
  ])
  const defended = r.events.find((e) => e.type === 'defended')
  for (const d of discards) expect(d.parent).toBe(defended?.id)
  expect(r.state.decks.discard).toEqual(expect.arrayContaining([BUG, SUDO, NOTABUG]))
})

it('banks the defence with defenceSpent and the cancelled attack with attackSpent', () => {
  const attacked = reduce(staged([BUG], [HOTFIX]), {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: HOTFIX.uid },
    at: 1002,
  })
  const discards = r.events.filter((e) => e.type === 'discarded')
  expect(discards).toMatchObject([
    { card: BUG.id, reason: 'attackSpent', player: 'p2' },
    { card: HOTFIX.id, reason: 'defenceSpent', player: 'p1' },
  ])
  const defended = r.events.find((e) => e.type === 'defended')
  for (const d of discards) expect(d.parent).toBe(defended?.id)
  expect(r.state.decks.discard).toEqual(expect.arrayContaining([BUG, HOTFIX]))
})

it('on Rollback return only the defence is banked — the attack goes to a hand', () => {
  const attacked = reduce(staged([BUG], [ROLLBACK]), {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: ROLLBACK.uid },
    at: 1002,
  })
  const discards = r.events.filter((e) => e.type === 'discarded')
  expect(discards).toMatchObject([{ card: ROLLBACK.id, reason: 'defenceSpent', player: 'p1' }])
  expect(r.state.players.p2.hand.map((c) => c.uid)).toContain(BUG.uid)
})

it('DDoS emits attackSpent for what it consumed', () => {
  const s = engine.createGame(config())
  const primed: GameState = {
    ...s,
    players: {
      ...s.players,
      p1: { ...s.players.p1, hand: [DDOS] },
      p2: { ...s.players.p2, release: { monitoring: MON } },
    },
  }
  const r = reduce(primed, {
    type: 'PLAY',
    player: 'p1',
    card: DDOS.uid,
    target: { kind: 'monitoring', player: 'p2' },
    at: 1000,
  })
  expect(r.events).toContainEqual(
    expect.objectContaining({
      type: 'discarded',
      player: 'p1',
      card: DDOS.id,
      reason: 'attackSpent',
    }),
  )
})

it('rejects a DRAW while a sudo attack pending is open, keeping the withheld half out of reach', () => {
  const attacked = reduce(staged([BUG, SUDO], [NOTABUG]), {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    combo: SUDO.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, { type: 'DRAW', player: 'p1', at: 1002 })
  expect(r.state).toBe(attacked.state)
  expect(r.events[0].type).toBe('rejected')
})

it('returns the attack to the attacker’s hand on Rollback', () => {
  const attacked = reduce(staged([BUG], [ROLLBACK]), {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: ROLLBACK.uid },
    at: 1002,
  })
  expect(r.state.players.p2.hand.map((c) => c.uid)).toEqual([BUG.uid])
  expect(r.state.decks.discard.map((c) => c.uid)).toEqual([ROLLBACK.uid])
})

it('gives the attack to the defender on sudo Rollback', () => {
  const attacked = reduce(staged([BUG], [ROLLBACK, SUDO]), {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: ROLLBACK.uid, combo: SUDO.uid },
    at: 1002,
  })
  expect(r.state.players.p1.hand.map((c) => c.uid)).toContain(BUG.uid)
})

it('reflects the effect onto the attacker with Works on my Machine', () => {
  const s = staged([BUG], [WOMM])
  const withAttackerRelease: GameState = {
    ...s,
    players: {
      ...s.players,
      p2: {
        ...s.players.p2,
        // Both types, so the mirror has something to hit AND something it must
        // leave alone: p1's FRONTEND is what was attacked.
        release: {
          frontend: { card: { uid: 'release-frontend#p2', id: 'release-frontend' } },
          backend: { card: { uid: 'release-backend#0', id: 'release-backend' } },
        },
      },
    },
  }
  const attacked = reduce(withAttackerRelease, {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: WOMM.uid },
    at: 1002,
  })
  // The attack was cancelled, so the defended release never left.
  expect(r.state.players.p1.release.frontend?.card).toEqual(FE)
  // The effect returned at the type it was aimed: the attacker's frontend falls…
  expect(r.state.players.p2.release.frontend).toBeUndefined()
  // …and their backend is untouched. Reflection mirrors, it does not choose.
  expect(r.state.players.p2.release.backend).toBeTruthy()
  expect(r.events.some((e) => e.type === 'defended' && e.effect === 'reflect')).toBe(true)
})

it('steals the release into the attacker’s zone with Security Bug', () => {
  const attacked = reduce(staged([SEC], []), {
    type: 'ATTACK',
    player: 'p2',
    card: SEC.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: null },
    at: 1002,
  })
  expect(r.state.players.p1.release.frontend).toBeUndefined()
  expect(r.state.players.p2.release.frontend?.card).toEqual(FE)
  expect(r.events.some((e) => e.type === 'releaseStolen')).toBe(true)
})

it('discards the stolen release instead of stealing it when the attacker’s slot is occupied', () => {
  const s = staged([SEC], [])
  // p2 (the attacker) already has a frontend release of their own — the exact
  // slot Security Bug would otherwise steal p1's release into.
  const withAttackerRelease: GameState = {
    ...s,
    players: {
      ...s.players,
      p2: { ...s.players.p2, release: { frontend: { card: FE2 } } },
    },
  }
  const attacked = reduce(withAttackerRelease, {
    type: 'ATTACK',
    player: 'p2',
    card: SEC.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: null },
    at: 1002,
  })
  expect(r.state.players.p1.release.frontend).toBeUndefined()
  // The attacker's existing release is untouched, and the stolen card lands in
  // the discard rather than displacing it.
  expect(r.state.players.p2.release.frontend?.card).toEqual(FE2)
  expect(r.state.decks.discard.map((c) => c.uid)).toContain(FE.uid)
  expect(r.events.some((e) => e.type === 'releaseStolen')).toBe(false)
  expect(r.events.some((e) => e.type === 'releaseDestroyed')).toBe(true)
})

it('opens a fresh window on the stolen release in the thief’s zone', () => {
  const attacked = reduce(staged([SEC], []), {
    type: 'ATTACK',
    player: 'p2',
    card: SEC.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: null },
    at: 1002,
  })
  // The release moved, and it is fresh where it landed: p2 owns it now, so the
  // window belongs to p2's slot and p1 is the one who may answer.
  expect(r.state.players.p2.release.frontend?.card).toEqual(FE)
  expect(r.state.window).toMatchObject({
    target: { player: 'p2', slot: 'frontend', card: FE.uid },
    round: 1,
    passed: [],
  })
  expect(r.events.map((e) => e.type)).toEqual([
    'tookHit',
    'discarded',
    'releaseStolen',
    'windowClosed',
    'windowOpened',
  ])
})

it('does not open a window when the steal fell through to a discard', () => {
  // The attacker's matching slot is occupied, so `takeRelease` discards the
  // release instead of stealing it. Nothing fresh arrived in anyone's zone, so
  // the exchange simply ends.
  const s = staged([SEC], [])
  const withAttackerRelease: GameState = {
    ...s,
    players: { ...s.players, p2: { ...s.players.p2, release: { frontend: { card: FE2 } } } },
  }
  const attacked = reduce(withAttackerRelease, {
    type: 'ATTACK',
    player: 'p2',
    card: SEC.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: null },
    at: 1002,
  })
  expect(r.state.window).toBeNull()
  expect(r.events.map((e) => e.type)).toEqual([
    'tookHit',
    'discarded',
    'releaseDestroyed',
    'windowClosed',
  ])
})

it('lets the robbed player attack the release that was taken from them', () => {
  // The point of the window: the victim is a responder now, because responders
  // are everyone alive except the release's OWNER, and the owner changed.
  const attacked = reduce(staged([SEC], [BUG]), {
    type: 'ATTACK',
    player: 'p2',
    card: SEC.uid,
    at: 1001,
  })
  const stolen = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: null },
    at: 1002,
  })
  const answer = reduce(stolen.state, {
    type: 'ATTACK',
    player: 'p1',
    card: BUG.uid,
    at: 1003,
  })
  expect(answer.events.some((e) => e.type === 'rejected')).toBe(false)
  expect(answer.events.some((e) => e.type === 'attacked')).toBe(true)
})

it('never opens a window for a reflected Security Bug, because it never steals', () => {
  // The reflection aims at the defender's slot of the attacked type, and that
  // slot holds the very release being defended — it never left, the attack was
  // cancelled. `takeRelease` discards on an occupied slot, so no steal, no
  // window handover; the exchange reopens the ORIGINAL window at round + 1.
  const attacked = reduce(staged([SEC], [WOMM]), {
    type: 'ATTACK',
    player: 'p2',
    card: SEC.uid,
    at: 1001,
  })
  const r = reduce(attacked.state, {
    type: 'RESOLVE',
    player: 'p1',
    choice: { kind: 'defend', card: WOMM.uid },
    at: 1002,
  })
  expect(r.events.some((e) => e.type === 'releaseStolen')).toBe(false)
  expect(r.state.window).toMatchObject({ target: { player: 'p1', slot: 'frontend' }, round: 2 })
})

it('rejects an attack from someone who cannot respond', () => {
  // p1 owns the target release (frontend) and genuinely holds an attack card
  // (BUG2), so only the responders guard — not "you do not hold that card" —
  // can be the cause of the rejection.
  const s = staged([BUG], [BUG2])
  const r = reduce(s, { type: 'ATTACK', player: 'p1', card: BUG2.uid, at: 1001 })
  expect(r.events[0].type).toBe('rejected')
  expect(r.state).toBe(s)
})

it('projects the defence prompt only to the player who owes it', () => {
  const attacked = reduce(staged([BUG], [HOTFIX]), {
    type: 'ATTACK',
    player: 'p2',
    card: BUG.uid,
    at: 1001,
  }).state
  expect(engine.project(attacked, 'p1').pending).toMatchObject({
    kind: 'defend',
    options: [HOTFIX.uid],
    attackCard: 'attack-bug',
  })
  // p2 learns a decision is outstanding but never sees p1's options.
  const other = engine.project(attacked, 'p2').pending
  expect(other?.kind).toBe('defend')
  expect(other && 'options' in other && other.options).toEqual([])
})

it('rejects a DDoS played with a sudo', () => {
  // Not a rules curiosity — it is the premise the board's `resolved` flag rests
  // on. planBeats decides a turn-played DDoS never stood awaiting an answer by
  // checking that the NEXT event is that same card's own attackSpent discard.
  // That reading only holds while a DDoS spends exactly one card. `attack-ddos`
  // has no sudo effect in cards.ts, so a combo is rejected before any of it —
  // and this says so out loud, because a card that resolved in place while
  // spending something alongside it would slide past the check and bring the
  // fabricated defend pending back (review of PR #125).
  const s = engine.createGame(config())
  const primed: GameState = {
    ...s,
    players: {
      ...s.players,
      p1: { ...s.players.p1, hand: [DDOS, SUDO] },
      p2: { ...s.players.p2, release: { monitoring: MON } },
    },
  }

  const r = reduce(primed, {
    type: 'PLAY',
    player: 'p1',
    card: DDOS.uid,
    combo: SUDO.uid,
    target: { kind: 'monitoring', player: 'p2' },
    at: 1000,
  })

  expect(r.state).toBe(primed)
  expect(r.events).toContainEqual(
    expect.objectContaining({ type: 'rejected', reason: 'that card has no sudo variant' }),
  )
})

it('logs a turn-played DDoS as an attack, not only as its consequences', () => {
  // A DDoS played on your own turn used to reach the table through resolveDdos,
  // which logged what the attack DID — a Monitoring destroyed, a release
  // returned — and never that an attack happened. The move history therefore
  // showed a Monitoring dying with nothing that killed it, and the results
  // screen counted no attack at all: the one card the "King of DDoS" plate is
  // about was the one attack nothing counted. And because a DDoS is
  // deliberately unanswerable by a defence card, a match whose attacks were
  // DDoS showed 0 in BOTH results columns.
  const s = engine.createGame(config())
  const primed: GameState = {
    ...s,
    players: {
      ...s.players,
      p1: { ...s.players.p1, hand: [DDOS] },
      p2: { ...s.players.p2, release: { monitoring: MON } },
    },
  }

  const r = reduce(primed, {
    type: 'PLAY',
    player: 'p1',
    card: DDOS.uid,
    target: { kind: 'monitoring', player: 'p2' },
    at: 1000,
  })

  expect(r.events).toContainEqual(
    expect.objectContaining({ type: 'attacked', attacker: 'p1', card: DDOS.id, target: 'p2' }),
  )
  expect(r.state.tally.p1).toMatchObject({ attack: 1, ddos: 1 })
  expect(r.state.tally.p2.attackedInto).toBe(1)
  // The consequence is still logged; the attack is now logged alongside it.
  expect(r.events.some((e) => e.type === 'monitoringDestroyed')).toBe(true)
})
