import type { Rect } from '@release/ui/animations'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import type { BeatRun, BoardAnchors, BoardState } from '~/entities/game/board'

// THE SHARED BEAT-TEST HARNESS. Every runner in this folder is the same shape —
// a hook built on `useFlyer`/`useToCentre`/`useHandArrival`, driven against a
// `BoardAnchors` registry and a `BeatRun`, spanning real `wait()`/`nextFrames()`
// delays that only resolve under advancing fake timers — and every existing
// test (`transferBeat.test.tsx`, `handLimitBeat.test.tsx`) had written its own
// copy of that driving. Lifted from `handLimitBeat.test.tsx` rather than
// `transferBeat.test.tsx`: a beat that exits through the heap needs
// `useDiscardExit` replaced wholesale (its `send` is what a test wants to spy
// on directly), and only `handLimitBeat.test.tsx` already does that —
// `transferBeat.test.tsx` never touches the discard exit at all, because a
// hand transfer never goes there.
//
// ONE THING COULD NOT BE LIFTED INTO HERE: `vi.mock('@release/ui/animations', …)`
// itself. Vitest hoists a `vi.mock` call to the top of the FILE THAT WRITES IT,
// ahead of that file's own imports — not ahead of every file in the graph. Two
// dead ends came before this shape:
//
//   - `vi.mock` living HERE, called once for every consumer: a test's own
//     `import { useAiBeat } from './aiBeat'` can resolve `@release/ui/animations`
//     to the REAL module first (it is `aiBeat.tsx`'s own dependency, loaded
//     before this file's mock ever gets a chance to register), binding `play`
//     to the unmocked export for good — `playedNames()` stays empty forever.
//   - the test's OWN `vi.mock` calling a shared FACTORY FUNCTION imported from
//     here (`mockAnimations(await importOriginal())`): Vitest's hoisting
//     rewrites every OTHER import in a file that contains `vi.mock` into a
//     lazy accessor, and CALLING one of those accessors from inside the
//     factory throws `Cannot access '...' before initialization` — reordering
//     the test file's own imports around it "fixed" this once, which is a
//     coincidence of THAT file's dependency graph, not a rule; Biome's own
//     import sort undoes it on the next `pnpm lint`, and it broke again.
//
// What actually holds regardless of import order: referencing an imported
// PLAIN OBJECT's properties from inside the factory is fine — only CALLING an
// imported function is what the TDZ rewrite trips on. So `animationsTrace` is
// exported as data, and every beat test writes the same dozen lines itself,
// at its own top level, reading and writing that shared object:
//
//   vi.mock('@release/ui/animations', async (importOriginal) => {
//     const real = await importOriginal<typeof import('@release/ui/animations')>()
//     return {
//       ...real,
//       play: (name: string, el: Element | null, params?: Record<string, unknown>) => {
//         animationsTrace.played.push(name)
//         return real.play(name, el, params)
//       },
//       useDiscardExit: () => ({
//         overlay: [],
//         send: (items: unknown[]) => animationsTrace.exitSpy(items),
//         reset: () => {},
//         FLIGHT_MS: 420,
//       }),
//     }
//   })
//
// — in exchange for every OTHER piece of the harness (the anchors, the
// render, the drive loop) staying shared and written exactly once.

export const animationsTrace = {
  played: [] as string[],
  // The params each `play()` call carried, index-aligned with `played`. A test
  // asking WHERE a flight aimed reads this; one asking only WHETHER it ran
  // reads `played`. A beat test whose own `vi.mock` does not push here simply
  // leaves it empty — the two arrays are only aligned for the files that fill
  // both, which is why `playedWith()` below looks the index up by name.
  params: [] as (Record<string, unknown> | undefined)[],
  waited: [] as number[],
  // A single merged, chronologically-ordered log of `nextFrames()` calls
  // (pushed as `'nextFrames'`) and `drop(key)` calls (pushed as `` `drop:${key}` ``).
  // Kept separate from `played`/`waited` because what a test needs from it is
  // RELATIVE ORDER between the two kinds of entry (did the render get its
  // frame before the carrier let go — I2), not either call's own arguments.
  order: [] as string[],
  exitSpy: vi.fn(async (_items: unknown[]) => {}),
}

/** The preset names passed to `play()`, in call order since the last reset. */
export function playedNames(): string[] {
  return animationsTrace.played
}

/**
 * The params of the FIRST `play(name, …)` call since the last reset — what a
 * flight aimed at, not merely that it happened. Only meaningful in a test file
 * whose own `vi.mock` pushes onto `animationsTrace.params` alongside `played`.
 */
export function playedWith(name: string): Record<string, unknown> | undefined {
  const at = animationsTrace.played.indexOf(name)
  return at < 0 ? undefined : animationsTrace.params[at]
}

/**
 * EVERY `play(name, …)` call's params since the last reset, in call order.
 * The counterpart to `playedWith` for a scene that plays one preset more than
 * once: two cards going home on `returnToDeck` are one name and two flights,
 * and an assertion that cannot tell them apart is satisfied by either alone.
 */
export function playedAll(name: string): (Record<string, unknown> | undefined)[] {
  return animationsTrace.played.flatMap((n, i) => (n === name ? [animationsTrace.params[i]] : []))
}

/**
 * The `ms` arguments passed to `wait()`, in call order since the last reset.
 * A test that writes its own `vi.mock('@release/ui/animations', …)` (see this
 * file's own header — the mock cannot live here) traces `wait` the same way
 * the shared mock above traces `play`: push onto `animationsTrace.waited`,
 * then delegate to the real implementation.
 */
export function waitedMs(): number[] {
  return animationsTrace.waited
}

/**
 * The merged `nextFrames()`/`drop(key)` call log — see `animationsTrace.order`.
 * A test proving an ordering invariant (a render must be up before a carrier
 * drops, I2) reads two indices out of this and compares them, rather than
 * asserting either call happened in isolation — presence alone survives a
 * reordering bug that only sequence catches.
 */
export function callOrder(): string[] {
  return animationsTrace.order
}

/** A card-shaped rect at a given point — `toCentre.test.tsx`'s own `RECT`, shared. */
export function boxed(left: number, top: number): Rect {
  return { left, top, width: 150, height: 210 }
}

/** A div that measures as the given rect — the fixture's own anchors, shared. */
export function nodeAt(rect: Rect): HTMLDivElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => rect,
    }) as DOMRect
  return el
}

export type AnchorsFixture = BoardAnchors & {
  /** what the mocked `useDiscardExit`'s `send` was called with, across every runner mounted on this fixture */
  exitSpy: typeof animationsTrace.exitSpy
}

// One card-sized box per named anchor, spread out so a geometry assertion can
// tell them apart. Resets the shared trace on every call: `animationsTrace` is
// module-level, so a fixture built for one test must not carry the last test's
// recordings into this one.
export function anchorsFixture(overrides: Partial<BoardAnchors> = {}): AnchorsFixture {
  animationsTrace.played = []
  animationsTrace.params = []
  animationsTrace.waited = []
  animationsTrace.order = []
  animationsTrace.exitSpy = vi.fn(async () => {})
  const piles: Record<number, HTMLDivElement> = { 0: nodeAt(boxed(0, 300)) }
  const slots: Record<string, HTMLDivElement> = {
    'p1:frontend': nodeAt(boxed(700, 100)),
  }
  const base: BoardAnchors = {
    rail: { current: null },
    bg: { current: nodeAt({ left: 0, top: 0, width: 1200, height: 800 }) },
    decks: { current: null },
    discard: { current: null },
    seats: { current: null },
    dock: { current: null },
    zone: { current: null },
    centre: { current: nodeAt(boxed(400, 300)) },
    stage: { current: null },
    cost: { current: null },
    sudo: { current: null },
    cover: { current: null },
    hand: { current: nodeAt(boxed(400, 650)) },
    discardBox: { current: nodeAt(boxed(1000, 20)) },
    cause: { current: nodeAt(boxed(250, 300)) },
    effect: { current: nodeAt(boxed(450, 300)) },
    picked: { current: nodeAt(boxed(450, 520)) },
    eventsBox: { current: nodeAt(boxed(20, 20)) },
    seatOf: () => null,
    seatBox: () => boxed(0, 0),
    handSlotAt: () => null,
    releaseSlot: (player, slot) => slots[`${player}:${slot}`] ?? null,
    bindSeat: () => {},
    bindReleaseSlot: () => {},
    pileBox: (index) => piles[index] ?? null,
    bindPile: () => {},
  }
  return { ...base, ...overrides, exitSpy: animationsTrace.exitSpy }
}

/**
 * Mounts a beat hook AND its own overlay — a hook's `overlay` only binds its
 * flyer/arrival refs once that JSX is actually in the DOM, which plain
 * `renderHook` never renders. Same shape every existing test built its own
 * `Probe` component for (`toCentre.test.tsx`'s `Harness`, `handLimitBeat.test.tsx`'s
 * `harness()`), lifted once so a new beat test stops writing it again.
 */
export function renderBeat<T extends { overlay: ReactNode[] }>(hook: () => T) {
  const result = { current: undefined as unknown as T }
  function Probe() {
    result.current = hook()
    return <>{result.current.overlay}</>
  }
  const view = render(<Probe />)
  return { result, view }
}

const DEFAULT_BASE: BoardState = {
  you: { name: 'You', hand: [], release: {} },
  opponents: [],
  decks: { main: [10], events: 5, discardCount: 0 },
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
} as unknown as BoardState

/**
 * Drives `run(plan, ctx)` to completion under fake timers — the `drive()`/`go()`
 * idiom `toCentre.test.tsx` and `handLimitBeat.test.tsx` each wrote for
 * themselves, pumping in 20ms steps because a beat spans real `wait()` delays
 * that only settle that way. `anchors` clears this fixture's own play/exit
 * recordings before the run starts, so two `runBeat` calls against the same
 * fixture (a test driving two plans in sequence) each read only their own run.
 *
 * NEVER wrap this call in the CALLER's own `act(...)`: nested `act()` scopes
 * defer React's commit until the OUTERMOST one resolves, so a flyer's ref
 * callback never fires while the run is still in flight — `raise()`'s own
 * `elOf(key)` check (right after `nextFrames()`) finds nothing, `toSlot`
 * returns null every time, and nothing this drives ever actually plays. That
 * is exactly what happened while building this harness (see the task report):
 * `overlay` stayed empty through the whole run and only reached its real state
 * once the outer `act()` finally let go, at which point the run had already
 * finished measuring nothing. `runBeat` wraps its OWN per-tick advances in
 * `act()`, which is the nesting depth that actually commits — matching
 * `toCentre.test.tsx`'s own `drive()`, which never wraps its outer call either.
 */
export async function runBeat<P>(
  run: (plan: P, ctx: BeatRun) => Promise<void>,
  plan: P,
  anchors: AnchorsFixture,
  opts: { base?: BoardState; publish?: (s: BoardState) => void } = {},
): Promise<{ published: BoardState[] }> {
  animationsTrace.played = []
  animationsTrace.params = []
  animationsTrace.waited = []
  animationsTrace.order = []
  anchors.exitSpy.mockClear()
  const published: BoardState[] = []
  const base = opts.base ?? DEFAULT_BASE
  const publish = opts.publish ?? ((s: BoardState) => published.push(s))
  vi.useFakeTimers()
  try {
    let done = false
    const finished = run(plan, { base, publish }).finally(() => {
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
  return { published }
}
