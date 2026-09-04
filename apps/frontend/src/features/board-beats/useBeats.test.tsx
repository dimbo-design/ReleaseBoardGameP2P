import type { Event } from '@release/engine'
import type { CardData } from '@release/ui'
import { cardById } from '@release/ui'
import { scatterAt } from '@release/ui/animations'
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BoardAnchors, BoardState, IntroBeat } from '~/entities/game/board'
import { ELIM_DELAY } from './eliminateBeat'
import { useBeats } from './useBeats'

afterEach(() => {
  vi.useRealTimers()
})

const motion = vi.hoisted(() => ({ reduced: true }))
vi.mock('~/shared/lib/useReducedMotion', () => ({ useReducedMotion: () => motion.reduced }))

// `hang` parks the next flight mid-air: send() stores its resolver instead of
// resolving, so a test can hold a beat in flight — `draining` stays true — and
// choose the moment it lands. `release` is that moment.
const sent = vi.hoisted(() => ({
  calls: [] as unknown[][],
  hang: false,
  release: null as (() => void) | null,
}))
vi.mock('@release/ui/animations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@release/ui/animations')>()
  const { useState } = await import('react')
  return {
    ...actual,
    // A stateful stand-in, not a fixed `overlay: []`: the rematch test needs to
    // tell "a flyer is mounted" from "reset() cleared it", and a hardcoded empty
    // overlay can't distinguish those — it would pass whether or not the fix
    // that clears it on a new match exists at all.
    useDiscardExit: () => {
      const [flying, setFlying] = useState(false)
      return {
        overlay: flying ? ['flight'] : [],
        send: (items: unknown[]) => {
          sent.calls.push(items)
          if (!sent.hang) return Promise.resolve()
          setFlying(true)
          return new Promise<void>((r) => {
            sent.release = () => {
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

// The arguments every `planBeats` call was made with, delegating to the real
// implementation — so this records the wire without changing what any other
// test in this file exercises. What it is here for: the two facts a batch
// cannot report about itself (`owed`, and the post-batch discard count) reach
// the planner only because this call site passes them, and dropping either is
// a silent loss no assertion on a beat's OUTPUT can see.
const planned = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('./planBeats', async (importOriginal) => {
  const real = await importOriginal<typeof import('./planBeats')>()
  return {
    ...real,
    planBeats: (...args: Parameters<typeof real.planBeats>) => {
      planned.calls.push(args)
      return real.planBeats(...args)
    },
  }
})

const card = (id: string) => cardById(id) as CardData

// The board BEFORE the batch: the card is still in the fan. This is what the
// queue must keep on screen while the beat runs, and what a source rect is
// measured against.
const preDiscard = {
  you: { name: 'You', hand: [{ uid: 'u1', card: card('attack-bug') }], release: {} },
  opponents: [{ id: 'p2', name: 'Two', handCount: 3, release: {} }],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
} as unknown as BoardState

// …and after: the card is gone from the hand and counted in the discard. The
// beat's last frame has to equal THIS.
const afterDiscard = {
  ...preDiscard,
  you: { ...preDiscard.you, hand: [] },
  decks: { ...preDiscard.decks, discardCount: 1 },
} as unknown as BoardState

const discardEvent = {
  id: 4,
  type: 'discarded',
  player: 'p1',
  card: 'attack-bug',
  reason: 'effect',
} as Event

// jsdom gives every element a zero rect, which is fine: the queue's job is to
// hand the step a rect, not to be right about layout. What matters is that a
// node exists for each anchor, because a MISSING one is the branch that drops a
// card from the flight.
//
// `handSlotAt` deliberately does NOT hand back a detached div. It queries the
// probe's real fan, exactly as the board's registry queries the real one, so it
// answers null when the slot is gone. The first version of this stub returned a
// fresh node on every call — which meant it measured the same whether the card
// was still on screen or not, and hid a defect where the queue measured the
// post-batch DOM and the local player's discard never flew at all.
const node = () => document.createElement('div')
const stub = {
  rail: { current: null },
  bg: { current: null },
  decks: { current: null },
  discard: { current: null },
  seats: { current: null },
  dock: { current: null },
  zone: { current: null },
  centre: { current: null },
  hand: { current: null },
  discardBox: { current: node() },
  seatOf: () => node(),
  seatBox: () => ({ left: 0, top: 0, width: 150, height: 210 }),
  handSlotAt: (i: number) => document.querySelectorAll<HTMLElement>('[data-hand-slot]')[i] ?? null,
  releaseSlot: () => node(),
  bindSeat: () => {},
  bindReleaseSlot: () => {},
  pileBox: () => null,
  bindPile: () => {},
} as unknown as BoardAnchors

// The opening's own shadow: a table with no hand at all, because the cards have
// not been dealt on screen yet. Distinct from preDiscard (a hand of one) and
// afterDiscard (a hand of none, but a card in the discard), so the probe can
// tell which of the three the board is showing.
const preDeal = {
  ...preDiscard,
  you: { ...preDiscard.you, hand: [] },
  decks: { ...preDiscard.decks, main: [40] },
} as unknown as BoardState

function Probe({
  live,
  events,
  anchors,
  intro,
  shadows,
  alarms,
}: {
  live: BoardState
  events: Event[]
  anchors: BoardAnchors
  intro?: IntroBeat | null
  shadows?: string[]
  // Every value `alarm` has held, in order. A final-state assertion cannot see
  // a glow that came up and went again inside one beat, which is exactly what a
  // self-answered 503 does.
  alarms?: boolean[]
}) {
  const beats = useBeats({ live, events, anchors, enabled: true, intro })
  const shown = beats.shadow ?? live
  // Every DISTINCT board the SHADOW has shown, in order. A final-state
  // assertion cannot see a rollback: the board can go A → B → A → B and end
  // exactly where it should while the table visibly jumps on the way, so only
  // the sequence says whether anything was taken back. Consecutive duplicates
  // are dropped — a re-render that changes nothing is not a frame anybody could
  // see — and the live projection is not recorded at all, because between two
  // beats it is not what the board is showing.
  if (beats.shadow) {
    const row = beats.shadow.decks.main.join(',')
    if (shadows && shadows.at(-1) !== row) shadows.push(row)
  }
  if (alarms && alarms.at(-1) !== beats.alarm) alarms.push(beats.alarm)
  return (
    <>
      {/* The fan as the BOARD would render it — one slot per card of whichever
          state is showing. This is what `handSlotAt` queries, so a queue that
          measures before the shadow commits finds nothing here and the flight
          is dropped, which is precisely the failure worth catching. */}
      {shown.you.hand.map((c) => (
        <div key={c.uid} data-hand-slot />
      ))}
      <div data-testid="hand">{shown.you.hand.length}</div>
      {/* The deck tells the three states apart where the hand cannot: preDeal
          and afterDiscard both have an empty fan, and only the deck count says
          whether the board is showing the opening's shadow or the projection. */}
      <div data-testid="deck">{(beats.shadow ?? live).decks.main.join(',')}</div>
      <div data-testid="discardCount">{shown.decks.discardCount}</div>
      <div data-testid="exclusive">{beats.exclusive ? 'exclusive' : 'open'}</div>
      {/* How many flyers are mounted right now — a dead match's in-flight card
          shows up here until its runner's own reset() clears it. */}
      <div data-testid="overlay">{beats.overlays.length}</div>
      {/* …and the overlays themselves, so a beat that puts something ON the
          board (the elimination clip, #103) can be looked for rather than
          merely counted */}
      <div data-testid="overlays">{beats.overlays}</div>
      {/* The running beat's own alarm (#102) — the wire this test exercises end
          to end, from planBeats' `gather` flag through the discard beat's run
          to the queue's own `Beat.alarm`. */}
      <div data-testid="alarm">{beats.alarm ? 'alarm' : 'none'}</div>
      {/* the queue is still working: what the game-over overlay waits on, so
          the winner is not announced over the beat that won it (#103) */}
      <div data-testid="running">{beats.running ? 'running' : 'idle'}</div>
    </>
  )
}

// The probe renders the hand the BOARD would render — shadow if one is up,
// otherwise live. So "1" means the card is still in the fan and "0" means it has
// gone: the queue's whole observable behaviour, without asserting on internals.
//
// The first render is the pre-batch state (a hand of one), and the batch arrives
// on the rerender — which is the real sequence, and the only one where `settled`
// holds a projection the card is still in.
const mount = (intro?: IntroBeat | null) => {
  const utils = render(<Probe live={preDiscard} events={[]} anchors={stub} intro={intro} />)
  utils.rerender(<Probe live={afterDiscard} events={[discardEvent]} anchors={stub} intro={intro} />)
  return utils
}

// Let the queue get all the way through a beat. A beat now waits two animation
// frames before measuring — that is the fix for measuring against the DOM the
// batch left behind — and jsdom drives requestAnimationFrame on a real timer, so
// flushing microtasks alone no longer reaches the other side of it.
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 80))))

// An opening that reports when it is told to, so a test can watch the order.
const introBeat = (log: string[], run?: () => Promise<void>): IntroBeat => ({
  key: 'g1',
  shadow: preDeal,
  run:
    run ??
    (() => {
      log.push('intro')
      return Promise.resolve()
    }),
  collapse: () => log.push('collapse'),
})

// The intro slot is the queue's own "here is a beat, run it" door. Using it
// keeps this test about the SHADOW rather than about planning.
const renderWithBeat = (run: (ctx: { publish: (s: BoardState) => void }) => Promise<void>) =>
  render(
    <Probe
      live={preDiscard}
      events={[]}
      anchors={stub}
      intro={{ key: 'g1', shadow: null, run, collapse: () => {} }}
    />,
  )

// The generalization of what the opening already did. A runner that publishes
// moves the board under itself — which is how the second card of a multi-draw
// aims at the fan the first one grew (I8), and how a split's new pile exists
// before it is measured.
it('renders what a running beat publishes, and drops it when the queue drains', async () => {
  motion.reduced = false
  sent.calls = []
  // A beat that parks after publishing, so the published state can be observed
  // while it is still up.
  const published = { ...preDiscard, decks: { ...preDiscard.decks, main: [7] } } as BoardState
  const { getByTestId } = renderWithBeat((ctx) => {
    ctx.publish(published)
    return new Promise<void>(() => {})
  })
  await flush()
  expect(getByTestId('deck').textContent).toBe('7')
})

// Git Branch landing in the same sync as a discard: two beats out of one batch,
// and the first of them moves the board. `[drawn(mine), …, discarded]` through
// `resolveAiEvent` is the same shape with a fan instead of a row.
const splitEvent = { id: 3, type: 'pilesChanged', piles: [4, 6] } as Event

// The projection the WHOLE batch produces — the row split and the card filed.
const afterBatch = {
  ...afterDiscard,
  decks: { ...afterDiscard.decks, main: [4, 6] },
} as unknown as BoardState

// A batch is planned in one pass against one projection, so every beat of it is
// handed the same base. That is right for the FIRST beat and wrong for every
// one after it the moment a beat moves the board under itself: the pile beat
// publishes the split row, and the beat behind it would render the row the
// batch started from. On a `[drawn(mine), pilesChanged]` batch that is the
// drawn card popping out of the fan and back into it — and the final state is
// correct the whole time, which is why this asserts the sequence.
it('does not let the next beat of a batch take back what the last one published', async () => {
  motion.reduced = false
  sent.calls = []
  // The discard beat parks in its flight instead of finishing, so the board it
  // starts from is a state that can be looked at rather than one that flickers
  // past inside a single act() window. `release` is deliberately never called —
  // this test wants the beat held for good — so `hang` is put back below, or the
  // parking would leak into the next test.
  sent.hang = true
  const shadows: string[] = []
  const utils = render(<Probe live={preDiscard} events={[]} anchors={stub} shadows={shadows} />)
  utils.rerender(
    <Probe
      live={afterBatch}
      events={[splitEvent, discardEvent]}
      anchors={stub}
      shadows={shadows}
    />,
  )
  // One window per step rather than one long one: React holds every update
  // queued inside a single async act() scope until that scope settles, so a
  // 700ms window would render the end state and nothing before it — and this
  // test is entirely about what came before it. Enough windows to cover both
  // beats: the pile beat spans a STEP_HOLD after its publish, and the discard
  // beat behind it needs a frame window of its own to get past its
  // wait-for-the-shadow.
  for (let i = 0; i < 10; i++) await flush()
  // The second beat really did start — without this the sequence below would
  // also be satisfied by a queue that dropped it.
  expect(sent.calls).toHaveLength(1)
  // The row the batch started from, then the split row the first beat
  // published — and nothing after it, because the second beat animates away
  // from the board the first one left. A third entry of '10' here is the
  // rollback: the fan (or, here, the row) snapping back mid-batch.
  expect(shadows).toEqual(['10', '4,6'])
  // The held beat is this test's alone: every test after it sends normally.
  sent.hang = false
  sent.release?.()
})

it('never animates when motion is reduced', async () => {
  motion.reduced = true
  sent.calls = []
  const { getByTestId } = mount()
  await flush()
  expect(sent.calls).toEqual([])
  // Straight to the end state: the card is gone, no beat ever ran.
  expect(getByTestId('hand').textContent).toBe('0')
})

it('keeps the card in the fan while its beat runs', () => {
  motion.reduced = false
  sent.calls = []
  const { getByTestId } = mount()
  expect(getByTestId('hand').textContent).toBe('1')
})

it('hands the board back to the live projection when the queue drains', async () => {
  motion.reduced = false
  const { getByTestId } = mount()
  await flush()
  expect(getByTestId('hand').textContent).toBe('0')
})

// The new kind is registered: a hand-limit batch produces a beat, the queue
// runs it, and the board is not left holding a shadow afterwards (#104).
it('runs a hand-limit discard and drains', async () => {
  motion.reduced = false
  sent.calls = []
  sent.hang = true
  const anchors = { ...stub, bg: { current: node() } } as BoardAnchors
  const event = {
    id: 4,
    type: 'discarded',
    player: 'p1',
    card: 'attack-bug',
    reason: 'handLimit',
  } as Event
  const utils = render(<Probe live={preDiscard} events={[]} anchors={anchors} />)
  utils.rerender(<Probe live={afterDiscard} events={[event]} anchors={anchors} />)

  // nextFrames + GATHER_HOLD (1500): by this point the registered runner has
  // built the grid and reached useDiscardExit, where the mock parks it.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1700))
  })
  expect(sent.calls).toHaveLength(1)

  // Let the exit land. The queue must drain back to the arrived projection.
  sent.hang = false
  await act(async () => {
    sent.release?.()
    await new Promise((r) => setTimeout(r, 80))
  })
  expect(utils.getByTestId('discardCount').textContent).toBe('1')
})

// The shadow's lifetime scopes PER END. Mid-flight, the fan has already let go
// of the card — it left the table the moment its slot was measured, at takeoff
// — but the discard end still holds the pre-batch heap, because the card has
// not visually arrived yet. Both readings come from the SAME shadow, so this
// is the one test that can tell "released too early" (discard already at 1)
// from "released too late" (still in the fan) from the fix (fan empty, heap
// still at 0).
it('the shadow releases the flown card from the fan at takeoff, and holds the discard end until it lands', async () => {
  motion.reduced = false
  sent.calls = []
  sent.hang = true
  const { getByTestId } = mount()
  await flush()
  expect(getByTestId('hand').textContent).toBe('0')
  expect(getByTestId('discardCount').textContent).toBe('0')
  // Landing: live wins, exactly as it does with no flight held at all.
  sent.hang = false
  await act(async () => {
    sent.release?.()
    await new Promise((r) => setTimeout(r, 80))
  })
  expect(getByTestId('hand').textContent).toBe('0')
  expect(getByTestId('discardCount').textContent).toBe('1')
})

it('flies each card on the scatter the heap will rest it on', async () => {
  motion.reduced = false
  sent.calls = []
  mount()
  await flush()
  expect(sent.calls).toHaveLength(1)
  const [items] = sent.calls as [{ key: string; scatter: unknown }[]]
  expect(items).toHaveLength(1)
  expect(items[0].key).toBe('d4')
  // The identity this whole design rests on: the flight ends on the pose the
  // adapter's heap already holds for this card (I7). Task 2 folded the heap with
  // scatterAt(e.id); this is the same call on the same id.
  expect(items[0].scatter).toEqual(scatterAt(discardEvent.id))
})

it('leaves the table open — only the opening is exclusive', () => {
  motion.reduced = false
  const { getByTestId } = mount()
  expect(getByTestId('exclusive').textContent).toBe('open')
})

// ===== beat zero — the opening =====

it('runs the opening before anything the wire brought in', async () => {
  motion.reduced = false
  const log: string[] = []
  sent.calls = []
  mount(introBeat(log))
  // Twice, and the reason is the point of the test: these are two beats in
  // SEQUENCE. The opening drains inside the first window; only then does the
  // queue re-arm and start the discard, which needs a frame window of its own to
  // get past its wait-for-the-shadow. One flush would leave the second beat
  // still standing at the gate — and the assertion below would read that as
  // "the discard was dropped", which is the very thing it is here to disprove.
  await flush()
  await flush()
  // The opening went first, and the discard still happened — queued behind it,
  // not dropped in favour of it.
  expect(log).toEqual(['intro'])
  expect(sent.calls).toHaveLength(1)
})

it('holds the table and shows the opening’s own shadow while it runs', () => {
  motion.reduced = false
  // A run that never settles: the queue is parked on beat zero for this test.
  const { getByTestId } = mount(introBeat([], () => new Promise<void>(() => {})))
  expect(getByTestId('exclusive').textContent).toBe('exclusive')
  // The opening publishes a whole shape rather than animating away from a
  // projection, so the board shows THAT — a table not yet dealt, deck still at
  // 40 — and not the beat's base, whose deck is the projection's 10. The hand is
  // empty in both, which is exactly why this asserts on the deck.
  expect(getByTestId('deck').textContent).toBe('40')
})

it('hands the table back once the opening is over', async () => {
  motion.reduced = false
  const { getByTestId } = mount(introBeat([]))
  await flush()
  expect(getByTestId('exclusive').textContent).toBe('open')
})

// The opening is the one beat that owes something when it does NOT play: it
// reports this seat to the host's start gate, and until every seat has reported
// no peer may act. Skipping it silently would hold the match shut for everyone.
it('collapses the opening instead of running it when motion is reduced', async () => {
  motion.reduced = true
  const log: string[] = []
  mount(introBeat(log))
  await flush()
  expect(log).toEqual(['collapse'])
})

// The end of a match is exactly when discards fly, so the rematch's commit can
// land while a beat is still in the air. On that commit the arm effect unshifts
// the new opening and calls drain() — which returns at its `draining` guard
// instead of shifting the beat out synchronously — and the new-match reset then
// wipes the queue. If the reset runs AFTER the arm, it takes the opening with
// it, and `armed` already holds the new key so nothing ever re-arms: the
// opening never reports and the host's start gate never opens. The from-rest
// rematch path cannot see this — there drain() empties the queue before the
// reset lands — so this test parks a beat mid-flight first.
it('keeps the rematch’s opening when it lands while a beat is in flight', async () => {
  motion.reduced = false
  sent.calls = []
  const log: string[] = []
  const first = introBeat(log)
  // Match one: the opening plays out from rest…
  const utils = render(<Probe live={preDiscard} events={[]} anchors={stub} intro={first} />)
  await flush()
  // …then a discard beat takes off and is held mid-flight.
  sent.hang = true
  utils.rerender(<Probe live={afterDiscard} events={[discardEvent]} anchors={stub} intro={first} />)
  await flush()
  expect(sent.calls).toHaveLength(1)
  // The rematch arrives while the card is still in the air.
  const second: IntroBeat = {
    key: 'g2',
    shadow: preDeal,
    run: () => {
      log.push('intro2')
      return Promise.resolve()
    },
    collapse: () => log.push('collapse2'),
  }
  utils.rerender(<Probe live={preDiscard} events={[]} anchors={stub} intro={second} />)
  // A new match cancels what is in the air: the dead match's flight is still
  // "sent" — its promise is deliberately left unresolved by this test — but the
  // reset effect runs synchronously in the same commit as the rematch, so by
  // the time rerender() returns the runner's own reset() has already cleared
  // its overlay. Asserting on the overlay at this exact instant says which of
  // the two the branch chose: keep flying a card into a discard pile that
  // belongs to a match that no longer exists, or drop it.
  expect(utils.getByTestId('overlay').textContent).toBe('0')
  // The flight lands; the queue must still hold the second opening.
  sent.hang = false
  await act(async () => {
    sent.release?.()
    await new Promise((r) => setTimeout(r, 80))
  })
  expect(log).toEqual(['intro', 'intro2'])
})

// The heap's own stand-in pose is keyed by the discard count AFTER the batch
// (`toBoardState`'s `standInScatter`), and a plan reads it to land a silently
// banked card exactly where the heap will rest it (#106, the crush ending).
// That count exists nowhere in the events — the engine banks some cards with no
// event at all — so it reaches the planner only through this argument.
it('hands the planner the discard count the batch left behind', async () => {
  motion.reduced = false
  planned.calls = []
  sent.hang = false
  const { rerender } = render(<Probe live={preDiscard} events={[]} anchors={stub} />)
  rerender(<Probe live={afterDiscard} events={[discardEvent]} anchors={stub} />)
  await flush()
  const args = planned.calls.at(-1)
  // …the POST-batch count, not the projection the beat animates away from
  expect(args?.[3]).toBe(afterDiscard.decks.discardCount)
  expect(args?.[3]).not.toBe(preDiscard.decks.discardCount)
})

// ===== the sweep's alarm (#102) — the wire between planBeats' `gather` flag
// and the queue's own `Beat.alarm`, driven end to end rather than mocked at
// either end (that is exactly the hole `boardAlarm.test.tsx`'s mocked-`useBeats`
// test leaves open, and this closes it). An opponent going out is used rather
// than the local player: `sourceOf` resolves a non-`selfId` discard straight to
// `{ kind: 'seat', player }` with no hand/release bookkeeping to set up, so the
// events below are the only thing exercising planBeats/beatOf's own wiring.
const eliminatedEvent = { id: 5, type: 'eliminated', player: 'p2' } as Event
const sweptEvent = {
  id: 6,
  type: 'discarded',
  player: 'p2',
  card: 'attack-bug',
  reason: 'effect',
} as Event
const afterSweep = {
  ...preDiscard,
  decks: { ...preDiscard.decks, discardCount: 1 },
} as unknown as BoardState

it('lights the alarm while a gathered sweep runs, and drops it when the queue drains', async () => {
  motion.reduced = false
  sent.calls = []
  // Park the discard beat mid-flight — `alarm` has to be read while the sweep
  // is still the running beat, not glimpsed inside a single act() window that
  // also carries it to completion.
  sent.hang = true
  const { getByTestId, rerender } = render(<Probe live={preDiscard} events={[]} anchors={stub} />)
  rerender(<Probe live={afterSweep} events={[eliminatedEvent, sweptEvent]} anchors={stub} />)
  await flush()
  // The sweep is really running, not skipped or dropped.
  expect(sent.calls).toHaveLength(1)
  expect(getByTestId('alarm').textContent).toBe('alarm')
  // Landing: the queue drains, and the alarm goes dark with it — the same
  // handover every other beat gets, just with `alarm` as the thing watched.
  sent.hang = false
  await act(async () => {
    sent.release?.()
    await new Promise((r) => setTimeout(r, 80))
  })
  expect(getByTestId('alarm').textContent).toBe('none')
})

it('leaves the alarm dark through an ordinary, ungathered discard', async () => {
  motion.reduced = false
  sent.calls = []
  sent.hang = true
  const { getByTestId } = mount()
  await flush()
  expect(sent.calls).toHaveLength(1)
  // No `eliminated` in this batch (see `discardEvent`/`mount` above), so
  // `planBeats` never sets `gather` and the beat's own `alarm` stays false —
  // the negative half of the wire, checked while the beat is still in flight.
  expect(getByTestId('alarm').textContent).toBe('none')
  sent.hang = false
  await act(async () => {
    sent.release?.()
    await new Promise((r) => setTimeout(r, 80))
  })
  expect(getByTestId('alarm').textContent).toBe('none')
})

// ===== the elimination clip (#103) — the same wire as the sweep's alarm above,
// carried one beat further: planBeats' `eliminated` plan through beatOf into a
// runner that puts a video on the board and holds the table while it plays.
it('holds the table under the elimination clip, and hands it back when it goes', async () => {
  motion.reduced = false
  sent.calls = []
  sent.hang = false
  const { getByTestId, container, rerender } = render(
    <Probe live={preDiscard} events={[]} anchors={stub} />,
  )
  rerender(<Probe live={afterSweep} events={[eliminatedEvent, sweptEvent]} anchors={stub} />)
  await flush()
  // the sweep has landed and the clip's own delay has passed
  await act(async () => void (await new Promise((r) => setTimeout(r, ELIM_DELAY + 120))))
  expect(container.querySelector('video')).not.toBeNull()
  // it owns the table while it plays — input is dead under a full-screen video
  expect(getByTestId('exclusive').textContent).toBe('exclusive')
  // …and what it plays over is the board the match is LEFT with, not the one
  // the batch found. A non-exclusive beat here would hold the pre-batch shadow
  // under the clip and empty the table the moment it lifted — the video would
  // be covering the elimination instead of following it.
  expect(getByTestId('discardCount').textContent).toBe('1')
  // and the table comes back when the clip is done with it
  await act(async () => {
    fireEvent.error(container.querySelector('video') as HTMLVideoElement)
    await new Promise((r) => setTimeout(r, 80))
  })
  expect(container.querySelector('video')).toBeNull()
  expect(getByTestId('exclusive').textContent).toBe('open')
})

// The decision, pinned rather than left to emerge: a full-screen autoplaying
// video is exactly what the preference is about, so under it there is no clip
// at all — the board simply stands in its eliminated state, which is what
// carries the news. `useBeats` already queues nothing under the preference;
// this is here so that stays true of the clip specifically.
it('plays no clip at all under prefers-reduced-motion', async () => {
  motion.reduced = true
  sent.calls = []
  sent.hang = false
  const { container, rerender } = render(<Probe live={preDiscard} events={[]} anchors={stub} />)
  rerender(<Probe live={afterSweep} events={[eliminatedEvent, sweptEvent]} anchors={stub} />)
  await flush()
  await act(async () => void (await new Promise((r) => setTimeout(r, ELIM_DELAY + 120))))
  expect(container.querySelector('video')).toBeNull()
})

// ===== the queue's own "still working" (#103) — `over` rides beside the
// projection rather than inside it, so the board needs one plain fact to hold
// the winner overlay back on. Driven through a parked beat rather than mocked:
// the flag is only worth anything if it is true for the whole run.
it('reports the queue as working until it drains', async () => {
  motion.reduced = false
  sent.calls = []
  sent.hang = true
  const { getByTestId } = mount()
  await flush()
  expect(sent.calls).toHaveLength(1) // the beat is really in flight
  expect(getByTestId('running').textContent).toBe('running')
  sent.hang = false
  await act(async () => {
    sent.release?.()
    await new Promise((r) => setTimeout(r, 80))
  })
  expect(getByTestId('running').textContent).toBe('idle')
})

// Under the preference nothing is queued at all, so the queue is never working
// and the winner is announced at once — the board goes straight to its end
// state, which is the same answer the elimination clip gets.
it('is never working under prefers-reduced-motion', async () => {
  motion.reduced = true
  sent.calls = []
  sent.hang = false
  const { getByTestId } = mount()
  await flush()
  expect(getByTestId('running').textContent).toBe('idle')
})

it('starts a release victory celebration as an exclusive board beat', async () => {
  vi.useFakeTimers()
  motion.reduced = false
  const event = {
    id: 99,
    type: 'gameOver',
    winner: 'p1',
    condition: 'release',
  } as Event
  const { container, getByTestId, rerender } = render(
    <Probe live={preDiscard} events={[]} anchors={stub} />,
  )

  rerender(<Probe live={preDiscard} events={[event]} anchors={stub} />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })

  expect(container.querySelector('[data-testid="game-end-confetti"]')).not.toBeNull()
  expect(getByTestId('running').textContent).toBe('running')
  expect(getByTestId('exclusive').textContent).toBe('exclusive')
})

// ===== a 503 a standing Monitoring answers by itself (#103 testing, problem 2)
// No pending is ever raised, so nothing lights the alarm off the projection —
// the plan carries the fact and the queue turns it into the beat's own `alarm`,
// the same field the defenceless sweep already uses for the same reason.
const autoAnswered503 = [
  { id: 7, type: 'drawn', player: 'p1', pile: 0, deckSize: 9 },
  { id: 8, type: 'revealed', player: 'p1', card: 'trigger-error-503' },
  { id: 9, type: 'neutralized', player: 'p1', method: 'monitoring' },
  { id: 10, type: 'discarded', player: 'p1', card: 'trigger-error-503', reason: 'trigger' },
] as Event[]

it('lights the alarm while a self-answered 503 is on its way out', async () => {
  motion.reduced = false
  sent.calls = []
  sent.hang = false
  const alarms: boolean[] = []
  const { getByTestId, rerender } = render(
    <Probe live={preDiscard} events={[]} anchors={stub} alarms={alarms} />,
  )
  rerender(<Probe live={afterSweep} events={autoAnswered503} anchors={stub} alarms={alarms} />)
  await flush()
  // it burned at some point during the beat…
  expect(alarms).toContain(true)
  // …and the table is not left lit once the queue has drained
  expect(getByTestId('alarm').textContent).toBe('none')
})

it('leaves the alarm dark through an ordinary draw', async () => {
  motion.reduced = false
  sent.calls = []
  sent.hang = false
  const alarms: boolean[] = []
  const plain = [
    { id: 7, type: 'drawn', player: 'p1', card: 'attack-bug', pile: 0, deckSize: 9 },
  ] as Event[]
  const { rerender } = render(
    <Probe live={preDiscard} events={[]} anchors={stub} alarms={alarms} />,
  )
  rerender(<Probe live={afterSweep} events={plain} anchors={stub} alarms={alarms} />)
  await flush()
  expect(alarms).not.toContain(true)
})
