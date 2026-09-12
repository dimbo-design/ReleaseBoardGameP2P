import { describe, expect, it } from 'vitest'
import type { GameConfig } from '../engine'
import type { CardInstance, GameState, Setup } from '../state'
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from './index'
import { reduce } from './reduce'

const engine = createFakeEngine()

const BASE: Setup = {
  handLimit: 'base',
  releases: 'base',
  releaseCond: 'easy',
  ai: 'base',
  gitBranch: 'base',
}

const config: GameConfig = {
  gameId: 'g1',
  seed: 4242,
  players: [
    { id: 'p1', name: 'you' },
    { id: 'p2', name: 'kernel_panic' },
  ],
  setup: BASE,
  deck: FAKE_DECK,
  events: FAKE_EVENTS,
}

const AI: CardInstance = { uid: 'trigger-ai#ai0', id: 'trigger-ai' }
const c = (id: string, n = '0'): CardInstance => ({ uid: `${id}#${n}`, id })

// Fires one named AI event deterministically: a trigger on top of the pile and
// an events deck of exactly the cards named, so which one comes up is not the
// shuffle's decision.
function fireEvent(patch: Partial<GameState>, events: CardInstance[], player = 'p1') {
  const base = engine.createGame(config)
  const staged: GameState = {
    ...base,
    turn: { ...base.turn, player, drawnFrom: [] },
    ...patch,
    decks: {
      ...base.decks,
      ...(patch.decks ?? {}),
      main: [[AI, ...base.decks.main[0]]],
      events,
    },
  }
  return reduce(staged, { type: 'DRAW', player, at: 1000 })
}

const eventUids = (s: GameState) => s.decks.events.map((x) => x.uid)

describe('an event card that stays on the table (#93)', () => {
  it('is out of the events deck while it stands there', () => {
    // general.md §6.4: "лежит в зоне игрока и всё это время в колоде событий
    // его нет — там 20 карт, а не 21". Under the phantom model the deck read
    // its full size throughout.
    const mon = c('ai-monitoring', 'e')
    const spare = c('ai-hallucination', 'e')
    // `spare` first: the pick is `events[floor(randomAt(seed, rngCursor) *
    // events.length)]`, and rngCursor is where createGame's shuffle of the
    // (now Rebase-sized, #108) main deck left off — this order is what lands
    // on `mon` under that cursor. The test only cares that ONE of the two
    // stands and the other doesn't, not which index the RNG landed on.
    const r = fireEvent({}, [spare, mon])

    expect(r.state.players.p1.release.monitoring).toBeTruthy()
    expect(eventUids(r.state)).not.toContain(mon.uid)
    expect(eventUids(r.state)).toContain(spare.uid)
  })

  it('cannot be drawn again while its own placement is standing', () => {
    // The reachable half of the defect: one copy of each ai-release-*, two of
    // ai-monitoring. Back in the deck immediately, it could come up again and
    // fizzle against its own occupied slot.
    const mon = c('ai-monitoring', 'e')
    const first = fireEvent({}, [mon])
    expect(first.state.players.p1.release.monitoring).toBeTruthy()
    expect(first.state.decks.events).toEqual([])
  })

  it('goes back to the events deck when it leaves the table, not to the discard', () => {
    // "Карта события никогда не уходит в общий сброс".
    const mon = c('ai-monitoring', 'e')
    const placed = fireEvent({}, [mon])
    const standing = placed.state.players.p1.release.monitoring as CardInstance

    const ddos = c('attack-ddos')
    const armed: GameState = {
      ...placed.state,
      window: null,
      pending: null,
      drawing: null,
      turn: { ...placed.state.turn, player: 'p2', drawnFrom: [0] },
      players: {
        ...placed.state.players,
        p2: { ...placed.state.players.p2, hand: [ddos] },
      },
    }
    const hit = reduce(armed, {
      type: 'PLAY',
      player: 'p2',
      card: ddos.uid,
      target: { kind: 'monitoring', player: 'p1' },
      at: 2000,
    })

    expect(hit.state.players.p1.release.monitoring).toBeFalsy()
    expect(hit.state.decks.discard.map((x) => x.uid)).not.toContain(standing.uid)
    expect(eventUids(hit.state)).toContain(mon.uid)
  })

  it('goes home when it is sacrificed to neutralize a threat', () => {
    // "будет уничтожен, отдан в жертву или уйдёт вместе с выбывшим владельцем"
    // — the return is the card's own condition and holds however it leaves.
    // Sacrifice is the reachable one here: answering Error 503 with a Monitoring
    // does not spend the Monitoring ("Monitoring остаётся"), so that is not it.
    const rel = c('ai-release-frontend', 'e')
    const placed = fireEvent({}, [rel])
    const standing = placed.state.players.p1.release.frontend?.card as CardInstance
    expect(standing).toBeTruthy()

    // No Debugger and no Monitoring, so the AI-granted release is the only
    // thing p1 can give up.
    const withThreat: GameState = {
      ...placed.state,
      window: null,
      pending: null,
      drawing: null,
      players: { ...placed.state.players, p1: { ...placed.state.players.p1, hand: [] } },
      decks: { ...placed.state.decks, main: [[c('trigger-error-503', 't')]] },
      turn: { ...placed.state.turn, player: 'p1', drawnFrom: [] },
    }
    const drew = reduce(withThreat, { type: 'DRAW', player: 'p1', at: 3000 })
    const answered = reduce(drew.state, {
      type: 'RESOLVE',
      player: 'p1',
      choice: { kind: 'neutralize503', method: 'sacrifice', card: standing.uid },
      at: 3100,
    })

    expect(answered.state.players.p1.release.frontend).toBeFalsy()
    expect(answered.state.decks.discard.map((x) => x.uid)).not.toContain(rel.uid)
    expect(eventUids(answered.state)).toContain(rel.uid)
  })

  it('still plays as an ordinary card if DDoS bounces a placed release to hand', () => {
    // The reason the phantom carried a plain catalogue id: `rulesFor` calls
    // `ai-release-frontend` kind `ai`, which `playableFor` never offers. A card
    // standing on the table has to read as the release it is standing in for.
    const rel = c('ai-release-frontend', 'e')
    const placed = fireEvent({}, [rel])
    const standing = placed.state.players.p1.release.frontend?.card as CardInstance

    expect(standing).toBeTruthy()
    expect(engine.project(placed.state, 'p1').self.release.frontend?.card).toBe('release-frontend')
  })
})
