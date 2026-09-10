import { cardById } from '@release/ui'
import type { Leaving } from '@release/ui/animations'
import { scatterAt } from '@release/ui/animations'
import { act, render } from '@testing-library/react'
import type { RefObject } from 'react'
import { expect, it, vi } from 'vitest'
import type { BeatRun, BoardAnchors, BoardState, StagedHandoff } from '~/entities/game/board'
import { ATTACK_POSE, COVER_POSE } from '~/entities/game/board'
import { useDefenseBeat } from './defenseBeat'
import type { BeatPlan } from './planBeats'

const played = vi.hoisted(() => ({
  names: [] as string[],
  // the full call, not just the name — `runCovered`'s own `play('playToCenter', …)`
  // is called straight through this mocked barrel (unlike `useDiscardExit`'s
  // internal `play`, which goes through a sibling import the mock never sees),
  // so the params reaching it — the cover's own tilt/offset (COVER_POSE) — are
  // observable here and worth pinning: a fly with no pose reads as a neat
  // stack, not a second play lying over the attack.
  calls: [] as { name: string; params: Record<string, unknown> }[],
}))
// What `useDiscardExit`'s `send` actually received — not just that it was
// called. `useDiscardExit`'s own `send` calls `play` through a SIBLING import
// (apps/ui/src/animations/useDiscardExit.tsx imports `./play` directly, not
// through this barrel), so mocking `play` above never sees it — drawBeat.test.tsx,
// comboBeat.test.tsx and useBeats.test.tsx hit the same wall and stub the whole
// hook instead of the leaf it calls internally; this does the same.
const exits = vi.hoisted(() => ({ items: [] as Leaving[] }))
// `hang`/`release` — the same "park a flight mid-air" convention
// `useBeats.test.tsx` uses for the discard exit: `send()` stores its resolver
// instead of resolving, so a test can hold the beat in flight and choose the
// moment it lands.
const hang = vi.hoisted(() => ({ on: false, release: null as (() => void) | null }))
// What each real `arrive()` call was aimed at — `drawBeat.test.tsx`'s own
// pass-through wrapper idiom: the fan itself stays real (it is what the
// Rollback return actually has to land in), but the call is recorded so a
// test can tell "landed in our own fan" from "flew to a seat instead" without
// re-deriving it from DOM state.
const arrivals = vi.hoisted(() => ({
  handLengths: [] as number[],
  ats: [] as (number | undefined)[],
  // Incremented only once the REAL `arrive()` promise settles — after its
  // own `nextFrames()` + `wait(FLIGHT_MS)` + landing callback, not when it is
  // merely CALLED. `handLengths`/`ats` above are pushed synchronously at the
  // call, so they cannot tell "the runner awaited the flight" from "the
  // runner fired it and moved on" — this can, checked once the runner's own
  // promise has settled.
  landed: 0,
}))
// What the runner's own `patch()` call actually carried — the steal's morph
// (Task 15) is a content swap on the flyer, not a flag, so the only way to
// observe "it turned LOD" is to read the `lod` prop off the React element
// `patch` was handed. Real `useFlyer` underneath (pass-through, same idiom as
// `useHandArrival` above): the morph's correctness is WHEN patch is called
// relative to the flight starting, and a fully faked flyer cannot show that.
const patched = vi.hoisted(() => ({ lod: undefined as boolean | undefined }))
vi.mock('@release/ui/animations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@release/ui/animations')>()
  const { useState } = await import('react')
  return {
    ...real,
    play: (name: string, _el: unknown, params: Record<string, unknown> = {}) => {
      played.names.push(name)
      played.calls.push({ name, params })
      return { finished: Promise.resolve() } as unknown as Animation
    },
    useFlyer: (...args: Parameters<typeof real.useFlyer>) => {
      const flyer = real.useFlyer(...args)
      return {
        ...flyer,
        patch: (key: string, next: Parameters<typeof flyer.patch>[1]) => {
          const content = next.content as { props?: { lod?: boolean } } | undefined
          if (content && typeof content === 'object' && 'props' in content) {
            patched.lod = content.props?.lod
          }
          return flyer.patch(key, next)
        },
      }
    },
    useHandArrival: (...args: Parameters<typeof real.useHandArrival>) => {
      const step = real.useHandArrival(...args)
      return {
        ...step,
        arrive: (items: Parameters<typeof step.arrive>[0], handLength: number, at?: number) => {
          arrivals.handLengths.push(handLength)
          arrivals.ats.push(at)
          return step.arrive(items, handLength, at).then(() => {
            arrivals.landed += 1
          })
        },
      }
    },
    // A stateful stand-in, not a fixed `overlay: []`: the reset() test needs
    // to tell "a flyer is mounted" from "reset() cleared it," and a hardcoded
    // empty overlay can't distinguish those.
    useDiscardExit: () => {
      const [flying, setFlying] = useState(false)
      return {
        overlay: flying ? ['flight'] : [],
        send: (items: Leaving[]) => {
          played.names.push('centerToDiscard')
          exits.items.push(...items)
          if (!hang.on) return Promise.resolve()
          setFlying(true)
          return new Promise<void>((r) => {
            hang.release = () => {
              setFlying(false)
              r()
            }
          })
        },
        reset: () => setFlying(false),
        FLIGHT_MS: 420,
      }
    },
  }
})

const base = {
  you: { name: 'You', hand: [], release: {} },
  opponents: [{ id: 'p2', name: 'Two', handCount: 3, release: {} }],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
} as unknown as BoardState

const node = () => document.createElement('div')

// A node whose rect is distinctive rather than jsdom's default all-zeros —
// needed only where a test has to tell two anchors' boxes apart (the road
// home's `from`/`to`).
function nodeAt(rect: { left: number; top: number; width: number; height: number }) {
  const el = node()
  el.getBoundingClientRect = () =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }) as DOMRect
  return el
}

// biome-ignore lint/style/noNonNullAssertion: a known catalogue entry
const hotfix = cardById('defense-hotfix')!

// `handSlot` is what `anchors.handSlotAt` answers with. Null by default — the
// board's own asymmetry on a REJOIN, where the gesture that would have put the
// card in a slot never happened on this peer — and a real node for the one test
// that exercises the fallback's FIRST leg (#101, Fix D, finding 6): with every
// harness answering null, that leg was unreachable and deleting it left the
// whole suite green.
function harness(handSlot: HTMLElement | null = null) {
  const centre = node()
  const cover = node()
  const sudoNode = node()
  const stage = node()
  const cost = node()
  // Distinctive rects — the road home's own test tells `effect`'s box apart
  // from `eventsBox`'s by these.
  const effect = nodeAt({ left: 450, top: 300, width: 150, height: 210 })
  const eventsBox = nodeAt({ left: 20, top: 20, width: 150, height: 210 })
  const anchors = {
    hand: { current: node() },
    centre: { current: centre },
    stage: { current: stage },
    cost: { current: cost },
    sudo: { current: sudoNode },
    cover: { current: cover },
    effect: { current: effect },
    eventsBox: { current: eventsBox },
    discardBox: { current: node() },
    pileBox: () => null,
    // Only OPPONENTS' seats are bound on the real board — `_Board.tsx` renders
    // no seat for the local player — so `seatBox` answers null for 'p1'. That
    // asymmetry is what finding 6 (#101, Fix C) runs into: on a rejoin our own
    // defence has no handoff to inherit AND no seat to fly from.
    seatBox: (player: string) =>
      player === 'p1' ? null : { left: 0, top: 0, width: 150, height: 210 },
    seatOf: () => node(),
    handSlotAt: () => handSlot,
    releaseSlot: () => node(),
    bindPile: () => {},
    bindSeat: () => {},
    bindReleaseSlot: () => {},
  } as unknown as BoardAnchors
  const api: { beat?: ReturnType<typeof useDefenseBeat> } = {}
  function Probe({ staging }: { staging?: RefObject<StagedHandoff | null> }) {
    api.beat = useDefenseBeat(anchors, staging)
    return <>{api.beat.overlay}</>
  }
  return { anchors, api, centre, cover, Probe }
}

// `drawBeat.test.tsx`/`deckBeat.test.tsx`'s established pattern: a runner that
// spans real `nextFrames()`/`wait()` delays needs its intermediate DOM observed
// step by step, because React defers every update queued inside a single async
// `act()` scope until that scope's own promise settles.
async function drive(run: () => Promise<void> | undefined) {
  vi.useFakeTimers()
  try {
    let done = false
    const finished = Promise.resolve(run()).then(() => {
      done = true
    })
    while (!done) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20)
      })
    }
    await finished
  } finally {
    vi.useRealTimers()
  }
}

const ctx: BeatRun = { base, publish: () => {} }

const cancelPlan = (): Extract<BeatPlan, { kind: 'covered' }> => ({
  kind: 'covered',
  key: 'covered:12',
  eventId: 12,
  defender: 'p2',
  card: 'defense-hotfix',
  effect: 'cancel',
  attacker: 'p1',
  attackCard: 'attack-bug',
  attackSudo: false,
  spent: [
    { eventId: 13, card: 'attack-bug', reason: 'attackSpent' },
    { eventId: 14, card: 'defense-hotfix', reason: 'defenceSpent' },
  ],
})

// The local player (`base.selfId`) is `p1`, so the default here is "I defend
// against p2's attack" — the same convention `planBeats.test.ts`'s own
// Rollback fixtures use (`defended({ player: 'p1', ... })` against
// `defendPending()`'s default `attacker: 'p2'`), so a plain Rollback's
// `returnTo` naturally lands on the attacker, p2 — a seat.
const rollbackPlan = (
  over: Partial<Extract<BeatPlan, { kind: 'covered' }>> = {},
): Extract<BeatPlan, { kind: 'covered' }> => ({
  kind: 'covered',
  key: 'covered:30',
  eventId: 30,
  defender: 'p1',
  card: 'defense-rollback',
  effect: 'return',
  attacker: 'p2',
  attackCard: 'attack-bug',
  attackSudo: false,
  spent: [{ eventId: 31, card: 'defense-rollback', reason: 'defenceSpent' }],
  ...over,
})

// ===== covered =====

// The same fact `runNeutralized` had to learn (#103 testing, problem 1): a beat
// that publishes nothing hands its own base on untouched, so the shadow held the
// pre-batch board — the `defend` pending included — for the whole run. The
// answered attack went on rendering at the centre under its own flyer, the dock
// stayed in its reaction state, and the beat behind this one animated against
// that same stale board.
it('lets go of the answered attack as the exchange takes off', async () => {
  exits.items.length = 0
  const { api, Probe } = harness()
  render(<Probe />)
  const published: BoardState[] = []
  const withAttack = {
    ...base,
    pending: {
      kind: 'defend',
      player: 'p1',
      attacker: 'p2',
      attackCard: 'attack-bug',
      sudo: false,
    },
  } as unknown as BoardState
  await drive(() =>
    api.beat?.runCovered(cancelPlan(), {
      base: withAttack,
      publish: (st) => published.push(st),
    }),
  )
  expect(published.length).toBeGreaterThan(0)
  expect(published.at(-1)?.pending).toBeNull()
})

it('lays the defence over the attack and sends the whole exchange out together', async () => {
  played.names = []
  played.calls = []
  exits.items = []
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() => api.beat?.runCovered(cancelPlan(), ctx))
  // THE COVER — an opponent's defence (no local handoff standing at the
  // slot), so this exercises the fly itself, not just the exit that follows
  // it. Pinned on the PARAMS reaching `play`, not just its name: the whole
  // point is the offset-and-opposite-tilt (COVER_POSE) that makes the
  // defence read as a second play lying over the attack, not a neat stack —
  // a fly with no pose at all would still satisfy a name-only assertion.
  const cover = played.calls.find((c) => c.name === 'playToCenter')
  expect(cover).toBeDefined()
  expect(cover?.params).toMatchObject({ rotate: 6, dx: 16, dy: -12 })
  // ONE send: the attack and the cover leave as one exchange, not two gestures
  expect(exits.items).toHaveLength(2)
  const [attackExit, coverExit] = exits.items
  // each carries its own layer, so the heap keeps the order they lay in on
  // the table (I9) — the attack was UNDER the cover and lands under it in the
  // heap too
  expect(attackExit).toMatchObject({ layer: 0, scatter: scatterAt(13) })
  expect(coverExit).toMatchObject({ layer: 1, scatter: scatterAt(14) })
})

// The discriminating case for `spentOf`'s reason guard: `support-sudo` is
// banked on BOTH sides of this exchange (the attack's own sudo, AND the
// defender's own, folded under the defence). A lookup by card id alone would
// find the FIRST `support-sudo` entry for both sides — attributing the
// attacker's sudo to the defence, or vice versa — which is exactly the
// ambiguity the brief calls out.
it('keeps the attacker’s own sudo and the defender’s own sudo apart when both sides carry one', async () => {
  played.names = []
  played.calls = []
  exits.items = []
  const { api, Probe } = harness()
  render(<Probe />)
  const plan: Extract<BeatPlan, { kind: 'covered' }> = {
    kind: 'covered',
    key: 'covered:20',
    eventId: 20,
    defender: 'p2',
    card: 'defense-hotfix',
    sudo: 'support-sudo',
    effect: 'cancel',
    attacker: 'p1',
    attackCard: 'attack-bug',
    attackSudo: true,
    spent: [
      { eventId: 21, card: 'attack-bug', reason: 'attackSpent' },
      { eventId: 22, card: 'support-sudo', reason: 'attackSpent' },
      { eventId: 23, card: 'defense-hotfix', reason: 'defenceSpent' },
      { eventId: 24, card: 'support-sudo', reason: 'defenceSpent' },
    ],
  }
  await drive(() => api.beat?.runCovered(plan, ctx))
  expect(exits.items).toHaveLength(2)
  const [attack, cover] = exits.items
  // the attack's own sudo — the ATTACKER's, event 22 — travels out WITH the
  // attack card, not the defender's (event 24)
  expect(attack).toMatchObject({
    card: expect.objectContaining({ id: 'attack-bug' }),
    aux: expect.objectContaining({ id: 'support-sudo' }),
    auxScatter: scatterAt(22),
  })
  // the cover carries the DEFENDER's own sudo (event 24, not 22 — the
  // attacker's) — the discriminating assertion: a `spentOf` that matched by
  // card id alone would find event 22 (the FIRST 'support-sudo' in `spent`,
  // which happens to be the attacker's) for BOTH sides, and this line goes
  // red the moment the reason guard is dropped
  expect(cover).toMatchObject({
    card: expect.objectContaining({ id: 'defense-hotfix' }),
    aux: expect.objectContaining({ id: 'support-sudo' }),
    auxScatter: scatterAt(24),
  })
})

it('carries the attack’s own sudo out with it as the pair it was', async () => {
  played.names = []
  played.calls = []
  exits.items = []
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() =>
    api.beat?.runCovered(
      {
        kind: 'covered',
        key: 'covered:12',
        eventId: 12,
        defender: 'p2',
        card: 'defense-hotfix',
        effect: 'cancel',
        attacker: 'p1',
        attackCard: 'attack-bug',
        attackSudo: true,
        spent: [
          { eventId: 13, card: 'attack-bug', reason: 'attackSpent' },
          { eventId: 14, card: 'support-sudo', reason: 'attackSpent' },
          { eventId: 15, card: 'defense-hotfix', reason: 'defenceSpent' },
        ],
      },
      ctx,
    ),
  )
  expect(exits.items[0]).toMatchObject({
    card: expect.objectContaining({ id: 'attack-bug' }),
    aux: expect.objectContaining({ id: 'support-sudo' }),
    auxScatter: scatterAt(14),
  })
})

// ===== Fix C, finding 6 — the cover on a rejoin =====
//
// The cover branch runs for OUR OWN defence whenever there is no handoff to
// inherit — a rejoin, or a replay, where the gesture that would have staged it
// never happened on this peer. It then asked `seatBox` for a source, and
// `seatBox` is null for the local player (only opponents' seats are bound), so
// it fell out of the branch having done nothing: the cover never flew AND
// never stood, and the exit that follows started from an empty box.
//
// A source it can always answer, in the same order `comboBeat`'s own `foldIn`
// resolves one: the fan slot the card left, then the actor's seat, and — when
// neither exists, which is exactly the rejoin — the cover slot itself, so the
// card at least stands where it belongs instead of vanishing.
it('stands our own cover even with no handoff and no seat to fly from', async () => {
  played.names = []
  played.calls = []
  exits.items = []
  const { api, Probe, cover } = harness()
  render(<Probe />) // no `staging` — nothing to inherit, as on a rejoin
  await drive(() => api.beat?.runCovered({ ...cancelPlan(), defender: 'p1', attacker: 'p2' }, ctx))
  const flights = played.calls.filter((c) => c.name === 'playToCenter')
  expect(flights).toHaveLength(1)
  // it lands at the cover slot, in the cover's own pose — the same end state
  // the flight from a seat reaches
  const box = cover.getBoundingClientRect()
  expect(flights[0].params).toMatchObject({
    from: { left: box.left, top: box.top, width: box.width, height: box.height },
    to: { left: box.left, top: box.top, width: box.width, height: box.height },
    rotate: COVER_POSE.rot,
  })
  // and the beat still reaches its exit. NOT evidence for the fix: the exit leg
  // measures `a.cover` for its own `from` regardless (`defenseBeat.tsx`), so
  // this says the exchange happened, not where it started from. The flight
  // assertions above are what carry this test (#101, Fix D, finding 9).
  expect(exits.items.map((i) => i.card.id)).toContain('defense-hotfix')
})

// The FIRST leg of that same chain, which nothing reached until now: our own
// defence flying out of the fan slot it left. It is the leg written for the
// LOCAL player — the one `seatBox` can never answer for — so with every harness
// stubbing `handSlotAt` to null it was dead code that no deletion could redden
// (#101, Fix D, finding 6).
//
// The slot's rect is stubbed to something distinctive, because jsdom measures
// every unstyled node as all zeros: the cover slot and the hand slot would
// otherwise be the same rect, and `from` could not tell which leg produced it.
//
// What this test asserts is WHICH LEG answered, not that the box it answered
// with is the right shape. `defenseBeat.tsx` takes the slot's raw
// `getBoundingClientRect()`, and a fan slot is rotated, so that is the box
// AROUND the tilted card rather than the card's own — the I6 breach its sibling
// leg (`seatBox` → `cardBoxIn`) does not have. Pre-existing, recorded in
// `docs/animations/backlog.md` and the audit register with both candidate fixes
// and why choosing between them needs a live table. The expectation below is
// written against today's raw rect on purpose: it is the marker for that entry,
// not an endorsement of the measurement.
it('flies our own defence out of the fan slot it left', async () => {
  played.names = []
  played.calls = []
  exits.items = []
  const slot = node()
  slot.getBoundingClientRect = () =>
    ({ left: 40, top: 60, width: 150, height: 210 }) as unknown as DOMRect
  const { api, Probe, cover } = harness(slot)
  render(<Probe />) // no `staging` — the fan slot is the only source there is
  await drive(() =>
    api.beat?.runCovered(
      { ...cancelPlan(), defender: 'p1', attacker: 'p2' },
      // the defence is still in the pre-batch hand, which is what makes the
      // slot lookup answer at all
      {
        ...ctx,
        base: {
          ...base,
          you: { ...base.you, hand: [{ uid: 'defense-hotfix#0', card: hotfix }] },
        } as unknown as BoardState,
      },
    ),
  )
  const flights = played.calls.filter((c) => c.name === 'playToCenter')
  expect(flights).toHaveLength(1)
  const box = cover.getBoundingClientRect()
  expect(flights[0].params).toMatchObject({
    // the fan slot, not the cover slot it lands on — a real journey
    from: { left: 40, top: 60, width: 150, height: 210 },
    to: { left: box.left, top: box.top, width: box.width, height: box.height },
    rotate: COVER_POSE.rot,
  })
})

// ===== Fix D round 3 — the shape the user hit on their first real game =====
//
// A local defence that has been staged has a handoff, and that handoff's `el` is
// null for the whole time its fan→cover flight is in the air: the static cover
// child only mounts once `landed` is true and the carrier is gone
// (`_Board.tsx`'s `stagedCover`), so the layout effect that snapshots the node
// has nothing to bind and writes `el: null`.
//
// The engine's `covered` events arrive INSIDE that window — the host's engine is
// local, and a client only needs a round trip shorter than one flight — and
// `useBeats` is called before that snapshot effect, so `runCovered` reads the
// previous commit's handoff: non-null, `el: null`. The outer guard passed, and
// the hand-slot leg then flew the card in a SECOND time, from the fan.
//
// No test had ever built that shape. The two handoff-bearing tests below both
// pass `el: node()`, and the rejoin test above passes no handoff at all — so the
// only two shapes under test were the two that behave correctly, and the one the
// app actually produces was covered by neither.
it('does not fly our own staged defence in from the fan a second time', async () => {
  played.names = []
  played.calls = []
  exits.items = []
  const slot = node()
  slot.getBoundingClientRect = () =>
    ({ left: 40, top: 60, width: 150, height: 210 }) as unknown as DOMRect
  const { api, Probe, cover } = harness(slot)
  // the production shape: we staged this defence, so a handoff exists — and its
  // node is null, because the gesture's own carrier is still flying it there
  const staging = { current: { mainUid: 'u1', el: null, release: () => {} } as StagedHandoff }
  render(<Probe staging={staging} />)
  await drive(() =>
    api.beat?.runCovered(
      { ...cancelPlan(), defender: 'p1', attacker: 'p2' },
      {
        ...ctx,
        base: {
          ...base,
          you: { ...base.you, hand: [{ uid: 'defense-hotfix#0', card: hotfix }] },
        } as unknown as BoardState,
      },
    ),
  )
  // The beat raises NOTHING for the cover. Round 3 gated only the fan-slot leg,
  // which left this raising a motionless copy at the destination — necessary
  // then, because the staging was being thrown away underneath it and that copy
  // was the only thing holding the slot. Round 4 stopped the throwing away
  // (`_useDefenseStaging`'s catch-up waits for its own carrier), so the gesture
  // now delivers the card and holds it, and any raise here would be a second
  // copy on top of the player's own.
  expect(played.calls.filter((c) => c.name === 'playToCenter')).toHaveLength(0)
  // and emphatically nothing from the fan slot the card left — the replay the
  // user watched. Asserted against the stub above, which is the only reason
  // this file can tell that box apart from the cover's.
  expect(played.calls.map((c) => c.params.from)).not.toContainEqual(
    expect.objectContaining({ left: 40, top: 60 }),
  )
  // the cover slot is still what the exchange leaves from, untouched by any of
  // this: the exit measures `a.cover` regardless
  expect(cover.getBoundingClientRect().left).toBe(0)
})

// ===== rollback returns the attack, instead of banking it =====

it('flies a plain Rollback’s attack back to the seat that threw it', async () => {
  played.names = []
  played.calls = []
  arrivals.handLengths = []
  exits.items = []
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() => api.beat?.runCovered(rollbackPlan({ returnTo: 'p2' }), ctx))
  // it went to a seat, not into our fan
  expect(arrivals.handLengths).toHaveLength(0)
  // TWO playToCenters: the cover lying over the attack, AND the attack's own
  // return flight — `toContain` alone would already be satisfied by the
  // cover's, which fires regardless of the return leg this test is actually
  // about, so the count is what makes this discriminating.
  expect(played.calls.filter((c) => c.name === 'playToCenter')).toHaveLength(2)
  // and it was never banked: only the defence left for the discard
  expect(exits.items.map((i) => i.card.id)).toEqual(['defense-rollback'])
})

it('brings a sudo Rollback’s attack into our own fan', async () => {
  arrivals.handLengths = []
  arrivals.ats = []
  arrivals.landed = 0
  const { api, Probe } = harness()
  render(<Probe />)
  // base.selfId is 'p1', so returnTo: 'p1' is us
  await drive(() =>
    api.beat?.runCovered(
      rollbackPlan({ returnTo: 'p1', defender: 'p1', sudo: 'support-sudo' }),
      ctx,
    ),
  )
  expect(arrivals.handLengths).toHaveLength(1)
  // the gap opens in the MIDDLE of the fan: no index is passed
  expect(arrivals.ats[0]).toBeUndefined()
  // The load-bearing assertion for "one moment, not two": by the time
  // `runCovered` itself has resolved, the flight must actually have LANDED —
  // not merely been kicked off. A runner that fires `arrive()` and races a
  // same-duration `wait()` alongside it (instead of awaiting the real thing)
  // resolves ~2 frames before `arrive()`'s own promise does (it spends those
  // frames on `nextFrames()` before its own timer starts), so this would
  // still read 0 here if that regressed.
  expect(arrivals.landed).toBe(1)
})

// Deliberately the actor's OWN defence (`defender: ctx.base.selfId`, with a
// handoff whose `.el` is set) rather than `cancelPlan()`'s opponent one: that
// path skips the cover flyer entirely (the handoff is already standing where
// the cover goes), so the ONLY carrier this beat raises is the discard exit —
// the same bias comboBeat.test.tsx's own reset test explains for picking
// `runPairOut` over `runAttack`/`runRelease`. A `cancelPlan()`-style opponent
// defence would ALSO raise a 'cover' flyer, and that flyer mounts well before
// `wait(SHOW_HOLD)` even starts — so `overlay.length > 0` would already hold
// before the exit ever hangs, and the assertion would pass whether or not
// `resetExit()` does anything at all (confirmed empirically: commenting out
// `resetExit()` in `reset()` left this test green under that scenario — see
// the task report). Isolating the exit is what makes the assertion actually
// about `resetExit()`, not just `flyer.drop()`.
//
// Fix round 1 (Important 2): `release()` used to run BEFORE `wait(SHOW_HOLD)`
// — invisible while the handoff was always null for a local defender (the
// bug Carry #2 named), but once that carried a real `.el` (Task 16's fix),
// calling `release()` this early cleared the local defender's own static
// cover render at once, leaving the cover slot blank for the whole ~1.2s
// hold before the exit flight ever raised anything to replace it. `release()`
// now waits until the hold is over, immediately ahead of the exit — the same
// "drop right before the replacement mounts" ordering `comboBeat.tsx`'s own
// `runRelease` cost leg already uses for the identical class of bug.
it('keeps the local defender’s own handoff standing through the whole hold', async () => {
  played.names = []
  played.calls = []
  exits.items = []
  const { api, Probe } = harness()
  const release = vi.fn()
  const staging = { current: { mainUid: 'u1', el: node(), release } as StagedHandoff }
  render(<Probe staging={staging} />)
  vi.useFakeTimers()
  try {
    hang.on = false
    const running = api.beat?.runCovered({ ...cancelPlan(), defender: 'p1' }, ctx)
    // past `nextFrames()`, comfortably inside the 1.2s `SHOW_HOLD` span
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(release).not.toHaveBeenCalled()
    // past the whole hold and the exit flight (send() resolves at once — `hang.on` is false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(release).toHaveBeenCalledTimes(1)
    await running
  } finally {
    vi.useRealTimers()
  }
})

// `wait(SHOW_HOLD)` is a REAL ~1.2s delay, unlike `runPairOut`'s single
// `nextFrames()` — so getting INTO the hung `send()` needs fake timers
// advanced past it, not `comboBeat.test.tsx`'s 80ms real-timer flush.
it('reset() drops an exchange parked mid-air', async () => {
  played.names = []
  played.calls = []
  exits.items = []
  const { api, Probe } = harness()
  const release = vi.fn()
  const staging = { current: { mainUid: 'u1', el: node(), release } as StagedHandoff }
  render(<Probe staging={staging} />)
  vi.useFakeTimers()
  try {
    hang.on = true
    const running = api.beat?.runCovered({ ...cancelPlan(), defender: 'p1' }, ctx)
    // past `nextFrames()` and the whole `wait(SHOW_HOLD)` hold, into the hung
    // `send()`
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(api.beat?.overlay.length).toBeGreaterThan(0)
    act(() => {
      api.beat?.reset()
    })
    expect(api.beat?.overlay.length).toBe(0)
    hang.on = false
    hang.release?.()
    await running
  } finally {
    vi.useRealTimers()
  }
})

// ===== stolen — Security Bug takes the release across the table (#101) =====

it('flies the stolen release from the robbed zone into the thief’s', async () => {
  played.names = []
  patched.lod = undefined
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() =>
    api.beat?.runStolen(
      {
        kind: 'stolen',
        key: 'stolen:20',
        eventId: 20,
        from: 'p1',
        to: 'p2',
        slot: 'frontend',
        card: 'release-frontend',
      },
      ctx,
    ),
  )
  expect(played.names).toContain('playToCenter')
  // it reads as LOD by the time it lands — the morph happens IN FLIGHT, not on
  // arrival, so `patch` was called with the LOD face while the card travelled.
  // base.selfId is 'p1', so 'p2' is an opponent's zone.
  expect(patched.lod).toBe(true)
})

// The guard that keeps the morph from firing unconditionally: a release
// stolen INTO OUR OWN zone (the reflected case, and any future one) is read
// in full, same as any other card lying in our own zone — never as LOD. If
// the guard were dropped and `patch` always carried `lod: true`, this would
// go red the moment it does.
it('reads a release stolen into our own zone in full, never as LOD', async () => {
  played.names = []
  patched.lod = undefined
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() =>
    api.beat?.runStolen(
      {
        kind: 'stolen',
        key: 'stolen:21',
        eventId: 21,
        from: 'p2',
        to: 'p1',
        slot: 'frontend',
        card: 'release-frontend',
      },
      ctx,
    ),
  )
  expect(played.names).toContain('playToCenter')
  expect(patched.lod).toBeUndefined()
})

// ===== neutralized — the answered Error 503 leaves as one exchange (#102) =====

const debuggerPlan = (): Extract<BeatPlan, { kind: 'neutralized' }> => ({
  kind: 'neutralized',
  key: 'neutralized:10',
  eventId: 10,
  player: 'p2',
  method: 'debugger',
  alarm: { eventId: 11, card: 'trigger-error-503' },
  spent: [{ eventId: 12, card: 'protection-debugger' }],
})

// The answer is given, so the alarm is ANSWERED — and the board has to say so
// while the exchange is still in the air. The beat published nothing at all
// before this, so `beats.shadow` held the pre-batch board — pending and all —
// for the whole run: the red glow burned until the queue drained, the answered
// 503 went on rendering at the centre under its own flyer, and the beat handed
// that same stale board on to the draw behind it, which is why a resumed draw
// landed its card while the alarm was still up (#103 testing, problem 1).
//
// Published at TAKEOFF, the same moment (and for the same reason) `discardBeat`
// publishes `withoutFlown`: the cards are in the air, so the table must not
// still be holding them.
it('lets go of the answered alarm as the exchange takes off', async () => {
  exits.items.length = 0
  const { api, Probe } = harness()
  render(<Probe />)
  const published: (BoardState | null)[] = []
  // `send` is what puts the pair in the air, so what the board had published by
  // THEN is the question — not what it ends on.
  const withAlarm = {
    ...base,
    pending: {
      kind: 'neutralize503',
      player: 'p2',
      card: 'trigger-error-503',
      methods: ['debugger'],
    },
  } as unknown as BoardState
  await drive(() =>
    api.beat?.runNeutralized(debuggerPlan(), {
      base: withAlarm,
      publish: (s) => published.push(s),
    }),
  )
  expect(published.length).toBeGreaterThan(0)
  expect(published.at(-1)?.pending).toBeNull()
})

it('covers the alarm and takes both away as one exchange', async () => {
  exits.items.length = 0
  played.calls.length = 0
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() => api.beat?.runNeutralized(debuggerPlan(), ctx))

  // the answer flew to the cover slot at the cover's own tilt
  expect(played.calls.some((c) => c.name === 'playToCenter')).toBe(true)
  expect(played.calls.find((c) => c.name === 'playToCenter')?.params).toMatchObject({
    rotate: COVER_POSE.rot,
    dx: COVER_POSE.dx,
    dy: COVER_POSE.dy,
  })
  // ONE send, two cards, the alarm underneath
  expect(exits.items).toHaveLength(2)
  expect(exits.items.map((i) => i.layer)).toEqual([0, 1])
  expect(exits.items[0].card.id).toBe('trigger-error-503')
  expect(exits.items[1].card.id).toBe('protection-debugger')
  // each lands on its own discard event's scatter (I7)
  expect(exits.items[0].scatter).toEqual(scatterAt(11))
  expect(exits.items[1].scatter).toEqual(scatterAt(12))
  // and each starts from the tilt it was resting at (I6/I9)
  expect(exits.items[0].pose).toEqual(ATTACK_POSE)
  expect(exits.items[1].pose).toEqual(COVER_POSE)
})

it('sends the alarm alone when Monitoring answered, and flies nothing', async () => {
  exits.items.length = 0
  played.calls.length = 0
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() =>
    api.beat?.runNeutralized({ ...debuggerPlan(), method: 'monitoring', spent: [] }, ctx),
  )
  expect(played.calls.filter((c) => c.name === 'playToCenter')).toEqual([])
  expect(exits.items).toHaveLength(1)
  expect(exits.items[0].card.id).toBe('trigger-error-503')
  expect(exits.items[0].layer).toBe(0)
})

// The crux of the whole task: a `neutralize503` pending with no card standing
// anywhere at all — a `crush` (the AI threat card was never on the table), or
// the `ai-error-503` mimic, whose card has already gone back to its own deck
// (`fake/triggers.ts` builds this pending with `card: null`). Both reach the
// board with `plan.alarm` absent. `exchange` reads layer off array POSITION
// after filtering `null`s out — so with no alarm half at all, the answer is
// the only entry and must land at layer 0, not be silently promoted to some
// other slot in the heap.
it('sends only the answer at layer 0 when there is no alarm to take away', async () => {
  exits.items.length = 0
  played.calls.length = 0
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() => api.beat?.runNeutralized({ ...debuggerPlan(), alarm: undefined }, ctx))
  expect(exits.items).toHaveLength(1)
  expect(exits.items[0].card.id).toBe('protection-debugger')
  expect(exits.items[0].layer).toBe(0)
})

it('flies a sacrificed release out of its own zone slot', async () => {
  exits.items.length = 0
  played.calls.length = 0
  const { api, Probe, anchors } = harness()
  const slotNode = document.createElement('div')
  vi.spyOn(anchors, 'releaseSlot').mockReturnValue(slotNode)
  render(<Probe />)
  await drive(() =>
    api.beat?.runNeutralized(
      {
        ...debuggerPlan(),
        method: 'sacrifice',
        slot: 'frontend',
        spent: [
          { eventId: 12, card: 'release-frontend' },
          { eventId: 13, card: 'support-code-review' },
        ],
      },
      ctx,
    ),
  )
  expect(anchors.releaseSlot).toHaveBeenCalledWith('p2', 'frontend')
  // the release carries its Code Review as the pair's aux, each on its own scatter
  expect(exits.items[1].aux?.id).toBe('support-code-review')
  expect(exits.items[1].auxScatter).toEqual(scatterAt(13))
})

// The crux of #106's fix: a sacrificed release that IS an events-deck card
// has already been claimed home by `bankToDiscard` the instant it left the
// zone — the discard exit is not where it goes, no matter what this
// resolution's own `discarded(reason: 'neutralized')` says
// (docs/animations/backlog.md:1062).
it('sends a sacrificed AI release home instead of into the heap it never really reaches', async () => {
  exits.items.length = 0
  played.names = []
  played.calls = []
  const { api, Probe, anchors } = harness()
  const slotNode = document.createElement('div')
  vi.spyOn(anchors, 'releaseSlot').mockReturnValue(slotNode)
  render(<Probe />)
  await drive(() =>
    api.beat?.runNeutralized(
      {
        ...debuggerPlan(),
        method: 'sacrifice',
        slot: 'frontend',
        destination: 'events',
        spent: [
          { eventId: 12, card: 'release-frontend' },
          { eventId: 13, card: 'support-code-review' },
        ],
      },
      ctx,
    ),
  )
  // the release took the road home
  expect(played.names).toContain('returnToDeck')
  // …not the discard exit — never among what left for the heap
  expect(exits.items.map((i) => i.card.id)).not.toContain('release-frontend')
  // its Code Review is never an events-deck card, so it still takes the
  // ordinary road — alone now, since the pair it used to leave paired with
  // is bound for two different places
  const codeReview = exits.items.find((i) => i.card.id === 'support-code-review')
  expect(codeReview).toBeDefined()
  expect(codeReview?.aux).toBeFalsy()
})

// Fix round 1: the split above sends the Code Review as a STANDALONE item,
// which drops the one thing `useDiscardExit`'s own `expand()` used to give it
// for free — its true tucked position, measured off `[data-aux]` inside
// `a.cover.current`. That DOM only ever holds a static `CardPair` for OUR OWN
// staged sacrifice (`_Board.tsx`'s `stagedNeutralize`), so this is the one
// scenario the fallback (`coverBox` — the release's own box) was silently
// wrong for.
it('starts a locally staged Code Review from its own tucked position, not the release’s box', async () => {
  exits.items.length = 0
  played.names = []
  played.calls = []
  const { api, Probe, cover } = harness()
  // mimic `_Board.tsx`'s own static render for our staged sacrifice: the
  // release's own box (`coverBox`), and the Code Review tucked under it at
  // its own rotated rect (`CardPair`'s `[data-aux]`) — distinct from the
  // release's box, the same way a real tilted, offset tuck would be.
  cover.getBoundingClientRect = () =>
    ({ left: 300, top: 300, width: 150, height: 210, right: 450, bottom: 510 }) as DOMRect
  const auxNode = document.createElement('div')
  auxNode.setAttribute('data-aux', '')
  auxNode.getBoundingClientRect = () =>
    ({ left: 310, top: 250, width: 170, height: 160, right: 480, bottom: 410 }) as DOMRect
  cover.appendChild(auxNode)
  const release = vi.fn()
  const staging = {
    current: { mainUid: 'u9', el: document.createElement('div'), release },
  } as unknown as RefObject<StagedHandoff | null>
  render(<Probe staging={staging} />)
  await drive(() =>
    api.beat?.runNeutralized(
      {
        ...debuggerPlan(),
        player: 'p1', // base.selfId — this IS our own staged sacrifice
        method: 'sacrifice',
        slot: 'frontend',
        destination: 'events',
        spent: [
          { eventId: 12, card: 'release-frontend' },
          { eventId: 13, card: 'support-code-review' },
        ],
      },
      ctx,
    ),
  )
  const codeReview = exits.items.find((i) => i.card.id === 'support-code-review')
  expect(codeReview).toBeDefined()
  // trimmed from the aux's own rotated bounding rect, centred on it —
  // `cardBoxIn({left:310,top:250,width:170,height:160}, 150)` — not the
  // release's own coverBox ({left:300,top:300,...})
  expect(codeReview?.from).toEqual({ left: 320, top: 225, width: 150, height: 210 })
})

// Minor gap (fix round 1): `sacrificedHome` gates only on `plan.spent[0]`,
// so a sacrifice with no Code Review at all was correct by trace but
// exercised by nothing.
it('sends a sacrificed AI release home even with no Code Review to split off', async () => {
  exits.items.length = 0
  played.names = []
  played.calls = []
  const { api, Probe, anchors } = harness()
  vi.spyOn(anchors, 'releaseSlot').mockReturnValue(document.createElement('div'))
  render(<Probe />)
  await drive(() =>
    api.beat?.runNeutralized(
      {
        ...debuggerPlan(),
        method: 'sacrifice',
        slot: 'frontend',
        destination: 'events',
        spent: [{ eventId: 12, card: 'release-frontend' }],
      },
      ctx,
    ),
  )
  expect(played.names).toContain('returnToDeck')
  // only the alarm is left to the heap — no Code Review to split off, and
  // the release itself already took the road home
  expect(exits.items.map((i) => i.card.id)).toEqual(['trigger-error-503'])
})

it('leaves a sacrificed release that is NOT an events-deck card to the ordinary discard road', async () => {
  exits.items.length = 0
  played.names = []
  played.calls = []
  const { api, Probe, anchors } = harness()
  vi.spyOn(anchors, 'releaseSlot').mockReturnValue(document.createElement('div'))
  render(<Probe />)
  await drive(() =>
    api.beat?.runNeutralized(
      {
        ...debuggerPlan(),
        method: 'sacrifice',
        slot: 'frontend',
        destination: 'discard',
        spent: [
          { eventId: 12, card: 'release-frontend' },
          { eventId: 13, card: 'support-code-review' },
        ],
      },
      ctx,
    ),
  )
  expect(played.names).not.toContain('returnToDeck')
  // the pair leaves together, exactly as it always has
  expect(exits.items.map((i) => i.card.id)).toContain('release-frontend')
  expect(exits.items.find((i) => i.card.id === 'release-frontend')?.aux?.id).toBe(
    'support-code-review',
  )
})

// The road home (#106): the AI card standing behind this prompt
// (`_Board.tsx`'s `aiStanding`, off `pending.source`) leaves for the events
// deck on the very batch that answers the prompt it explains.
it('sends the AI card standing behind the prompt home once this batch answers it', async () => {
  exits.items.length = 0
  played.names = []
  played.calls = []
  const { api, Probe, anchors } = harness()
  render(<Probe />)
  await drive(() =>
    api.beat?.runNeutralized({ ...debuggerPlan(), homeward: 'ai-crush-frontend' }, ctx),
  )
  const home = played.calls.filter((c) => c.name === 'returnToDeck')
  expect(home).toHaveLength(1)
  const effectBox = anchors.effect.current?.getBoundingClientRect()
  const eventsBox = anchors.eventsBox.current?.getBoundingClientRect()
  expect(home[0].params).toMatchObject({
    from: { left: effectBox?.left, top: effectBox?.top },
    to: { left: eventsBox?.left, top: eventsBox?.top },
  })
})

it('adds no road home when the batch answered nobody’s AI card', async () => {
  played.names = []
  played.calls = []
  const { api, Probe } = harness()
  render(<Probe />)
  await drive(() => api.beat?.runNeutralized(debuggerPlan(), ctx))
  expect(played.names).not.toContain('returnToDeck')
})

it('leaves our own staged answer alone and only releases the handoff', async () => {
  exits.items.length = 0
  played.calls.length = 0
  const { api, Probe } = harness()
  const release = vi.fn()
  const staging = {
    current: { mainUid: 'u9', el: document.createElement('div'), release },
  } as unknown as RefObject<StagedHandoff | null>
  render(<Probe staging={staging} />)
  await drive(() => api.beat?.runNeutralized({ ...debuggerPlan(), player: 'p1' }, ctx))
  // ours is already standing at the cover slot — the beat must not fly a second
  // copy of it in from the fan (#101, Fix D rounds 3 and 4, same defect class)
  expect(played.calls.filter((c) => c.name === 'playToCenter')).toEqual([])
  expect(release).toHaveBeenCalledTimes(1)
  expect(exits.items).toHaveLength(2)
})
