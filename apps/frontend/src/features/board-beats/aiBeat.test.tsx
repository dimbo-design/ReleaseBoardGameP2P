import { scatterAt } from '@release/ui/animations'
import { describe, expect, it, vi } from 'vitest'
import type { BoardState } from '~/entities/game/board'
import { SHOW_HOLD, useAiBeat } from './aiBeat'
import {
  anchorsFixture,
  animationsTrace,
  boxed,
  callOrder,
  nodeAt,
  playedAll,
  playedNames,
  playedWith,
  renderBeat,
  runBeat,
  waitedMs,
} from './testing'
import { HALLUCINATION_HOLD, TABLE_HOLD } from './toCentre'

// The harness's own mock has to be wired here, not inside `./testing` — see
// that file's own header for why (importing a shared FACTORY FUNCTION into a
// `vi.mock` factory hits a Vitest hoisting TDZ that import order cannot fix
// reliably, since Biome resorts imports on every lint pass). Referencing
// `animationsTrace`'s properties, rather than calling an imported function,
// is what survives regardless of import order — so this block is the one
// piece every beat test repeats for itself.
vi.mock('@release/ui/animations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@release/ui/animations')>()
  return {
    ...real,
    play: (name: string, el: Element | null, params?: Record<string, unknown>) => {
      animationsTrace.played.push(name)
      // index-aligned with `played` — `playedWith(name)` is what reads it, and
      // it is what tells "a flight happened" from "a flight aimed HERE"
      animationsTrace.params.push(params)
      return real.play(name, el, params)
    },
    wait: (ms: number) => {
      animationsTrace.waited.push(ms)
      return real.wait(ms)
    },
    // `aiBeat.tsx` has exactly one call site for `nextFrames` (the `standing`
    // branch) — `useFlyer.tsx`'s own internal `raise()` imports `nextFrames`
    // straight from `./timing`, not through this barrel, so it never touches
    // this trace. That makes a plain call-order log here unambiguous: any
    // `'nextFrames'` entry IS the standing branch's own await.
    nextFrames: () => {
      animationsTrace.order.push('nextFrames')
      return real.nextFrames()
    },
    // Wrapping `useFlyer` (not `drop` alone — it isn't a named export) so
    // `useToCentre`'s `drop` is traced the same way: this barrel IS what
    // `toCentre.ts` imports `useFlyer` from, so the wrapped `drop` is the one
    // `aiBeat.tsx` actually calls.
    useFlyer: () => {
      const flyer = real.useFlyer()
      return {
        ...flyer,
        drop: (key?: string) => {
          animationsTrace.order.push(`drop:${key ?? '*'}`)
          return flyer.drop(key)
        },
      }
    },
    useDiscardExit: () => ({
      overlay: [],
      send: (items: unknown[]) => animationsTrace.exitSpy(items),
      reset: () => {},
      FLIGHT_MS: 420,
    }),
  }
})

// The fixture's own two boxes, named: `releaseSlot('p1', 'frontend')` and the
// `effect` place (`testing.tsx`'s `slots` map and `anchorsFixture`). A flight
// home is told from another by WHERE IT STARTS, so these have to be nameable.
const ZONE_SLOT = boxed(700, 100)
const EFFECT_BOX = boxed(450, 300)

describe('aiBeat', () => {
  it('brings the trigger and the card it pulled to their own places, then settles the release', async () => {
    const anchors = anchorsFixture()
    const plan = {
      kind: 'aiEvent' as const,
      key: 'ai:1',
      eventId: 1,
      player: 'p1',
      pile: 0,
      trigger: 'trigger-ai',
      triggerDiscardId: 3,
      eventCard: 'ai-release-frontend',
      tail: { kind: 'zone' as const, slot: 'frontend', card: 'release-frontend' },
    }
    const { result } = renderBeat(() => useAiBeat(anchors))
    // NOT wrapped in an outer `act(...)` — see `runBeat`'s own header in
    // `./testing`: nesting it here defers every commit to this act's own
    // resolution, and the flyers this beat raises never get a chance to bind.
    await runBeat(result.current.run, plan, anchors)
    // the trigger left for the heap on its own event id's scatter (I7)
    expect(anchors.exitSpy).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ key: 'd3' })]),
    )
    // the AI card went to the slot and NOT to the events deck
    expect(playedNames()).toContain('playToReleaseZone')
    expect(playedNames()).not.toContain('returnToDeck')
  })

  const crushPlan = (destination: 'events' | 'discard') => ({
    kind: 'aiEvent' as const,
    key: 'ai:1',
    eventId: 1,
    player: 'p1',
    pile: 0,
    trigger: 'trigger-ai',
    triggerDiscardId: 3,
    eventCard: 'ai-crush-frontend',
    tail: { kind: 'crush' as const, slot: 'frontend', card: 'release-frontend', destination },
  })

  it('sends a destroyed AI release home and never to the heap', async () => {
    // 'p1:frontend' is already wired into the default fixture's `releaseSlot`
    // (`testing.tsx`'s own `slots` map) — no override needed to reach it.
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    await runBeat(result.current.run, crushPlan('events'), anchors)
    // TWO cards go home, and WHICH is the whole point (#71): the AI card leaves
    // from the `effect` place it was standing in, the destroyed release from
    // its own zone slot. `arrayContaining(['returnToDeck'])` stood here and
    // proved neither — the AI card's own `goHome` supplies a `returnToDeck` on
    // every crush there is, so no-op'ing the release's flight left this test,
    // the one named for #71's guarantee, entirely green.
    const homes = playedAll('returnToDeck').map((params) => params?.from)
    expect(homes).toHaveLength(2)
    expect(homes).toContainEqual(ZONE_SLOT) // the release, out of the zone
    expect(homes).toContainEqual(EFFECT_BOX) // the AI card, off the centre
    // the ONLY thing in the heap is the trigger
    const keys = (anchors.exitSpy.mock.calls.flat(2) as { key: string }[]).map((c) => c.key)
    expect(keys).toEqual(['d3'])
  })

  it('sends a destroyed ordinary release to the heap', async () => {
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    await runBeat(result.current.run, crushPlan('discard'), anchors)
    const keys = (anchors.exitSpy.mock.calls.flat(2) as { key: string }[]).map((c) => c.key)
    expect(keys.sort()).toEqual(['crushed', 'd3'])
    // …and it did NOT also go home. Exactly one card takes that road here — the
    // AI card, off the centre — so this test cannot pass on the evidence the
    // events-deck one above is about, nor that one on this.
    expect(playedAll('returnToDeck').map((params) => params?.from)).toEqual([EFFECT_BOX])
  })

  // A zone slot wearing a Code Review renders as a `CardPair`; the aux half is
  // its own tilted node, which is how the beat finds where the second card
  // actually stands.
  const protectedSlot = () => {
    const slot = nodeAt(boxed(700, 100))
    const aux = nodeAt({ left: 706, top: 118, width: 150, height: 210 })
    aux.setAttribute('data-aux', '')
    slot.appendChild(aux)
    return slot
  }

  // `destroySlot`'s spoils are the release AND its Code Review
  // (fake/triggers.ts:87). Flying only the release left the second card
  // blinking out of the zone with no flight of its own.
  it('takes the Code Review with the release it was protecting', async () => {
    const slot = protectedSlot()
    const anchors = anchorsFixture({ releaseSlot: () => slot })
    const { result } = renderBeat(() => useAiBeat(anchors))
    await runBeat(
      result.current.run,
      {
        ...crushPlan('discard'),
        tail: { ...crushPlan('discard').tail, codeReview: 'support-code-review' },
      },
      anchors,
    )
    const items = anchors.exitSpy.mock.calls.flat(2) as { key: string; card: { id: string } }[]
    expect(items.map((i) => i.key).sort()).toEqual(['crushed', 'crushedAux', 'd3'])
    expect(items.find((i) => i.key === 'crushedAux')?.card.id).toBe('support-code-review')
  })

  it('keeps the Code Review out of the events deck when the release goes home', async () => {
    // The split `defenseBeat`'s sacrifice leg already makes: a Code Review is
    // never an events-deck card, so it takes the ordinary road even when the
    // release it protected does not.
    const slot = protectedSlot()
    const anchors = anchorsFixture({ releaseSlot: () => slot })
    const { result } = renderBeat(() => useAiBeat(anchors))
    await runBeat(
      result.current.run,
      {
        ...crushPlan('events'),
        tail: { ...crushPlan('events').tail, codeReview: 'support-code-review' },
      },
      anchors,
    )
    const items = anchors.exitSpy.mock.calls.flat(2) as { key: string; card: { id: string } }[]
    expect(items.map((i) => i.key).sort()).toEqual(['crushedAux', 'd3'])
    // two go home and no more — the AI card and the release. A third would be
    // the Code Review taking a road that is not its own.
    const homes = playedAll('returnToDeck').map((params) => params?.from)
    expect(homes).toHaveLength(2)
    expect(homes).toContainEqual(ZONE_SLOT)
  })

  // I7 FOR A CARD WITH NO EVENT OF ITS OWN. `destroySlot` called without a
  // reason emits `releaseDestroyed` and no `discarded`, so there is no event
  // id to key a scatter off — but the heap still shows the card as its
  // stand-in for the discard's top, and the plan carries that pose. The
  // flight has to land ON it: anything else (the draw's own `plan.eventId`,
  // as this used to send, or a fresh `jitter()`) jumps on the last frame,
  // which is the whole reason one scatter drives both.
  it('lands a crushed release on the very pose the heap will rest it on', async () => {
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    const rest = { rot: 3, dx: 4, dy: 5 }
    await runBeat(
      result.current.run,
      { ...crushPlan('discard'), tail: { ...crushPlan('discard').tail, rest } },
      anchors,
    )
    const items = anchors.exitSpy.mock.calls.flat(2) as { key: string; scatter?: unknown }[]
    expect(items.find((i) => i.key === 'crushed')?.scatter).toEqual(rest)
  })

  // The contrast, and the recorded gap: a release buried under its own Code
  // Review is not the heap's top, so the plan carries no pose for it — and the
  // Code Review has no entry of its own either. The trigger beside them is what
  // a card WITH a real `discarded` id looks like.
  it('claims a heap pose only for the card the heap actually rests', async () => {
    const slot = protectedSlot()
    const anchors = anchorsFixture({ releaseSlot: () => slot })
    const { result } = renderBeat(() => useAiBeat(anchors))
    await runBeat(
      result.current.run,
      {
        ...crushPlan('discard'),
        tail: { ...crushPlan('discard').tail, codeReview: 'support-code-review' },
      },
      anchors,
    )
    const items = anchors.exitSpy.mock.calls.flat(2) as { key: string; scatter?: unknown }[]
    expect(items.find((i) => i.key === 'd3')?.scatter).toEqual(scatterAt(3))
    expect(items.find((i) => i.key === 'crushed')?.scatter).toBeUndefined()
    expect(items.find((i) => i.key === 'crushedAux')?.scatter).toBeUndefined()
  })

  const standingPlan = {
    kind: 'aiEvent' as const,
    key: 'ai:1',
    eventId: 1,
    player: 'p1',
    pile: 0,
    trigger: 'trigger-ai',
    triggerDiscardId: 3,
    eventCard: 'ai-bad-vibe-coding',
    tail: { kind: 'standing' as const },
  }

  it('lets the trigger go and leaves the AI card standing when a prompt is owed', async () => {
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    // NOT wrapped in an outer `act(...)` — see `runBeat`'s own header in
    // `./testing`.
    await runBeat(result.current.run, standingPlan, anchors)
    // the trigger was filed…
    const keys = (anchors.exitSpy.mock.calls.flat(2) as { key: string }[]).map((c) => c.key)
    expect(keys).toEqual(['d3'])
    // …and the AI card neither followed it nor went home
    expect(playedNames()).not.toContain('returnToDeck')
  })

  // `none`, `alarm` and `turnEnded` reach byte-identical code — Task 6's
  // `goHome` fallback, unmodified by this task — so one table-driven case
  // over the three tails the brief names, rather than three near-copies of
  // the same assertion.
  it.each([
    { kind: 'none' as const },
    { kind: 'alarm' as const },
    { kind: 'turnEnded' as const },
  ])('takes both away when the tail is $kind', async (tail) => {
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    await runBeat(result.current.run, { ...standingPlan, tail }, anchors)
    expect(playedNames()).toContain('returnToDeck')
  })

  // Pins I2 (`aiBeat.tsx:173-175`'s own comment): the projection's render
  // must be up before the carrier lets go, not after. `nextFrames()` is
  // called exactly once in this scenario (see the mock's own comment), and
  // `order`'s indices only agree with "before" if the call actually precedes
  // the drop — a version that dropped the carrier FIRST and awaited
  // `nextFrames()` after would still make the call, but out of order, and
  // this assertion catches that the same way it catches deleting the line.
  it('paints the projection before letting the AI carrier go', async () => {
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    await runBeat(result.current.run, standingPlan, anchors)
    const order = callOrder()
    const nextFramesIndex = order.indexOf('nextFrames')
    const dropIndex = order.indexOf('drop:eff')
    expect(nextFramesIndex).toBeGreaterThanOrEqual(0)
    expect(dropIndex).toBeGreaterThan(nextFramesIndex)
  })

  // `runBeat`'s own opts carry no `onWait` hook (the brief's snippet assumed
  // one, but the harness only ever traced `play`) — extended the same trace
  // to `wait` instead (`animationsTrace.waited`, exposed as `waitedMs()`),
  // which is what every OTHER beat-test assertion in this file already does
  // for `play`.
  it('holds Hallucination twice as long as anything else', async () => {
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    await runBeat(
      result.current.run,
      {
        ...standingPlan,
        eventCard: 'ai-hallucination',
        tail: { kind: 'turnEnded' as const },
      },
      anchors,
    )
    expect(waitedMs()).toContain(HALLUCINATION_HOLD)
    expect(waitedMs()).not.toContain(TABLE_HOLD)
  })
})

describe('runTaken — a Release comes back out of the discard (#106, Task 11)', () => {
  const takenPlan = {
    kind: 'takenFromDiscard' as const,
    key: 'taken:20',
    eventId: 20,
    player: 'p1',
    card: 'release-frontend',
    mine: true,
  }

  it("shows the card at the centre for everyone, lands it in the hand, and sends Inside's own card home", async () => {
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    // NOT wrapped in an outer `act(...)` — see `runBeat`'s own header in
    // `./testing`.
    const { published } = await runBeat(
      result.current.runTaken,
      { ...takenPlan, homeward: 'ai-inside' },
      anchors,
    )
    // out of the heap, into the hand, and the AI card follows it home — in
    // that order
    expect(playedNames()).toEqual(['drawToCenter', 'returnToDeck'])
    expect(waitedMs()).toContain(SHOW_HOLD)
    expect(waitedMs()).toContain(420) // `flipCard`'s own duration — matches `goHome`
    expect(
      published.some(
        (s) => s.you.hand.length === 1 && s.you.hand[0]?.card.id === 'release-frontend',
      ),
    ).toBe(true)
  })

  it('delivers to the taker at their seat, face up the whole way, and bumps their count', async () => {
    const anchors = anchorsFixture()
    const base: BoardState = {
      you: { name: 'You', hand: [], release: {} },
      opponents: [{ id: 'p2', name: 'Two', handCount: 3, release: {} }],
      decks: { main: [10], events: 5, discardCount: 0 },
      selfId: 'p1',
      history: [],
      setup: {},
      playable: [],
      frozen: [],
    } as unknown as BoardState
    const { result } = renderBeat(() => useAiBeat(anchors))
    const { published } = await runBeat(
      result.current.runTaken,
      { ...takenPlan, player: 'p2', mine: false },
      anchors,
      { base },
    )
    expect(playedNames()).toEqual(['drawToCenter', 'dealToSeat'])
    // the recipient's counter carries it now — the same fact
    // `transferBeat.tsx`'s own `bumpRecipient` publishes
    expect(published.at(-1)?.opponents[0].handCount).toBe(4)
  })

  it('does not send anything home when the plan carries no `homeward`', async () => {
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    await runBeat(result.current.runTaken, takenPlan, anchors)
    expect(playedNames()).not.toContain('returnToDeck')
  })

  // THE SLOT IS OCCUPIED. `pickFromDiscard` is still open while this flies, so
  // `_Board.tsx`'s `aiStanding` is rendering the AI card that demanded the pick
  // in the `effect` place. Aiming there put two cards in one rect for the whole
  // of `SHOW_HOLD`; `centre` is the place `centre.ts` names for a card the
  // system has put up for the table to read.
  it('shows the taken card at the centre, not on top of the AI card that demanded it', async () => {
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    await runBeat(result.current.runTaken, takenPlan, anchors)
    const centre = anchors.centre.current?.getBoundingClientRect()
    const effect = anchors.effect.current?.getBoundingClientRect()
    expect(playedWith('drawToCenter')?.to).toMatchObject({
      left: centre?.left,
      top: centre?.top,
    })
    expect(playedWith('drawToCenter')?.to).not.toMatchObject({
      left: effect?.left,
      top: effect?.top,
    })
  })

  // The duplicate this closes: the shadow still carried the pending, so the
  // projection kept rendering the AI card at `effect` while the carrier below
  // flew away from that very rect.
  it('lets the pending go before the AI card flies home', async () => {
    const anchors = anchorsFixture()
    const { result } = renderBeat(() => useAiBeat(anchors))
    const base = {
      you: { name: 'You', hand: [], release: {} },
      opponents: [],
      decks: { main: [10], events: 5, discardCount: 0 },
      selfId: 'p1',
      pending: { kind: 'pickFromDiscard', player: 'p1', options: [], source: 'ai-inside' },
      history: [],
      setup: {},
      playable: [],
      frozen: [],
    } as unknown as BoardState
    // each publish stamped with the flights already played when it happened —
    // presence alone would survive a publish made AFTER the flight
    const stamps: { pending: unknown; plays: string[] }[] = []
    await runBeat(result.current.runTaken, { ...takenPlan, homeward: 'ai-inside' }, anchors, {
      base,
      publish: (s) => stamps.push({ pending: s.pending, plays: [...playedNames()] }),
    })
    expect(playedNames()).toContain('returnToDeck')
    const cleared = stamps.find((st) => st.pending === null)
    expect(cleared).toBeDefined()
    expect(cleared?.plays).not.toContain('returnToDeck')
  })
})
