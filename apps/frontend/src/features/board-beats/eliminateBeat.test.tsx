import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BeatRun, BoardState } from '~/entities/game/board'
import {
  CLIP_MS,
  ELIM_DELAY,
  ELIM_MIN_MS,
  ELIM_START_MS,
  ELIMINATION_CLIPS,
  guardMsFor,
  idealEndMsFor,
  useEliminateBeat,
} from './eliminateBeat'
import type { BeatPlan } from './planBeats'

// jsdom implements no media pipeline: `play()` is a stub that throws "Not
// implemented", and no clip ever fires `ended` on its own. Replaced here so the
// runner's own loop can be driven by hand — which is the point, since what is
// under test is what the runner does with those callbacks.
const plays = { count: 0 }
beforeEach(() => {
  plays.count = 0
  HTMLMediaElement.prototype.play = vi.fn(() => {
    plays.count++
    return Promise.resolve()
  })
})

// A test that fails mid-run never reaches its own `useRealTimers`, and the next
// one would then start against a clock somebody else left running — which is how
// a broken runner can look green here. Put back unconditionally instead.
afterEach(() => {
  vi.useRealTimers()
})

const base = {
  you: { name: 'You', hand: [], release: {} },
  opponents: [],
  decks: { main: [10], events: 5, discardCount: 0, discardHeap: [] },
  selfId: 'p1',
  history: [],
  setup: {},
  playable: [],
  frozen: [],
} as unknown as BoardState

const ctx: BeatRun = { base, publish: () => {} }

const plan = (eventId: number, player = 'p1'): Extract<BeatPlan, { kind: 'eliminated' }> => ({
  kind: 'eliminated',
  key: `eliminated:${eventId}`,
  eventId,
  player,
})

function harness() {
  const api: { beat?: ReturnType<typeof useEliminateBeat> } = {}
  function Probe() {
    api.beat = useEliminateBeat()
    return <>{api.beat.overlay}</>
  }
  return { api, Probe }
}

// Starts the beat and hands back the running promise plus a way to let time
// pass without waiting for it to finish — the runner has to be observed mid-run
// (the clip on screen) as well as at its end.
async function start(eventId = 20) {
  vi.useFakeTimers()
  const { api, Probe } = harness()
  render(<Probe />)
  let done = false
  const finished = Promise.resolve(api.beat?.run(plan(eventId), ctx)).then(() => {
    done = true
  })
  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }
  // past the delay that lets the emptied table read before the video covers it
  await tick(ELIM_DELAY + 20)
  const video = () => document.querySelector('video')
  return {
    api,
    finished,
    tick,
    isDone: () => done,
    video,
    // The clip really starts: nothing counts until this arrives, because
    // loading must not spend the clip's own budget (#126 review).
    playing: () => {
      act(() => {
        fireEvent.playing(video() as HTMLVideoElement)
      })
    },
    guard: () => guardMsFor(video()?.getAttribute('src') ?? ''),
    settle: async () => {
      while (!done) await tick(200)
      await finished
      vi.useRealTimers()
    },
  }
}

it('holds the emptied table before the clip covers it', async () => {
  vi.useFakeTimers()
  const { api, Probe } = harness()
  render(<Probe />)
  const finished = Promise.resolve(api.beat?.run(plan(20), ctx))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ELIM_DELAY - 50)
  })
  expect(document.querySelector('video')).toBeNull()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100)
  })
  expect(document.querySelector('video')).not.toBeNull()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ELIM_START_MS + 100)
  })
  await finished
  vi.useRealTimers()
})

// The pick is derived from the event every peer already has, so one
// elimination is one clip on every screen — not four private ones.
it('resolves one clip from the elimination itself', async () => {
  const run = await start(21)
  expect(run.video()?.getAttribute('src')).toBe(ELIMINATION_CLIPS[21 % ELIMINATION_CLIPS.length])
  await run.settle()

  const again = await start(21)
  expect(again.video()?.getAttribute('src')).toBe(ELIMINATION_CLIPS[21 % ELIMINATION_CLIPS.length])
  await again.settle()
})

it('loops a clip that ends before the floor', async () => {
  const run = await start()
  run.playing()
  await run.tick(1000)
  const before = plays.count
  act(() => {
    fireEvent.ended(run.video() as HTMLVideoElement)
  })
  expect(plays.count).toBe(before + 1) // played again
  expect(run.video()).not.toBeNull() // and still on screen
  expect(run.isDone()).toBe(false)
  await run.settle()
})

it('leaves once a loop finishes past the floor', async () => {
  const run = await start()
  run.playing()
  await run.tick(ELIM_MIN_MS + 100)
  act(() => {
    fireEvent.ended(run.video() as HTMLVideoElement)
  })
  await run.finished
  expect(run.isDone()).toBe(true)
  expect(run.video()).toBeNull()
  vi.useRealTimers()
})

// A missing file or a codec the browser refuses. The beat owns the table while
// it runs, so a clip that cannot play must hand it straight back — the board is
// already in its eliminated state, which is what carries the news.
it('hands the table back when the clip cannot play', async () => {
  const run = await start()
  act(() => {
    fireEvent.error(run.video() as HTMLVideoElement)
  })
  await run.finished
  expect(run.isDone()).toBe(true)
  expect(run.video()).toBeNull()
  vi.useRealTimers()
})

// `ended` is the only thing that ends the loop, and a stalled stream never
// fires it. The guard is the clip's OWN first-whole-loop-past-the-floor, so it
// lands just after a legitimate end rather than at some blanket number that is
// wrong for every clip at once (#126 review).
it('gives the table back on its own when a playing clip stalls', async () => {
  const run = await start()
  run.playing()
  await run.tick(run.guard() + 100)
  await run.finished
  expect(run.isDone()).toBe(true)
  expect(run.video()).toBeNull()
  vi.useRealTimers()
})

// The condition that makes the per-clip number honest: loading must not spend
// the clip's own budget, or a slow connection cuts the clip short with a
// different number. So nothing is counted until playback really starts.
it('does not spend the clip’s own time while it is still loading', async () => {
  const run = await start()
  await run.tick(run.guard() + 100) // longer than the clip's whole budget…
  expect(run.isDone()).toBe(false) // …and it has not started, so nothing is spent
  run.playing()
  await run.tick(run.guard() - 100)
  expect(run.isDone()).toBe(false) // the clip's own time is only now running out
  await run.tick(200)
  await run.finished
  expect(run.isDone()).toBe(true)
  vi.useRealTimers()
})

// …which leaves a hole the per-clip guard cannot cover, because it is not about
// the clip: one that never begins at all spends no budget and would hold the
// board for the rest of the match. That is a LOADING failure, so it gets a
// loading-shaped guard of its own rather than a share of the clip's time.
it('gives the table back when the clip never begins', async () => {
  const run = await start()
  await run.tick(ELIM_START_MS + 100)
  await run.finished
  expect(run.isDone()).toBe(true)
  expect(run.video()).toBeNull()
  vi.useRealTimers()
})

// Autoplay refused: the promise rejects and no event ever arrives, so the beat
// would sit on a dead table waiting for a clip that was never going to play.
it('hands the table back when playback is refused outright', async () => {
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.reject(new Error('NotAllowedError')))
  const run = await start()
  await run.tick(50)
  await run.finished
  expect(run.isDone()).toBe(true)
  expect(run.video()).toBeNull()
  vi.useRealTimers()
})

it('drops the clip when a new match cancels what is in the air', async () => {
  const run = await start()
  expect(run.video()).not.toBeNull()
  act(() => {
    run.api.beat?.reset()
  })
  expect(run.video()).toBeNull()
  await run.settle()
})

// The reviewer's scenario on #126, driven rather than argued: a clip that loops
// does not reach its last `ended` at the ideal time. Every seam — `ended`, the
// rewind, `play()`, a frame decoding — pushes the real end later, so a guard
// armed on the ideal number exactly gets to the exit first and the beat ends on
// a timer instead of on the loop boundary. Nothing would have flagged it: the
// clip just stops a few frames early.
it('lets a looping clip reach its own last ended, seams and all', async () => {
  // the clip with the most passes, and so the most seams — found rather than
  // assumed, since the list is sorted by path and its order is not ours to fix
  const worst = ELIMINATION_CLIPS.reduce(
    (best, url, i) => {
      const d = CLIP_MS[url.split('/').pop() as string]
      const n = Math.round(idealEndMsFor(url) / d)
      return n > best.n ? { n, i } : best
    },
    { n: 0, i: 0 },
  )
  const run = await start(worst.i)
  const src = run.video()?.getAttribute('src') as string
  const one = CLIP_MS[src.split('/').pop() as string]
  const loops = Math.round(idealEndMsFor(src) / one)
  expect(loops).toBeGreaterThan(1) // this test is meaningless on a single-pass clip

  const seam = 120 // what a real rewind-and-decode costs between passes
  run.playing()
  for (let pass = 1; pass < loops; pass++) {
    await run.tick(one + seam)
    act(() => {
      fireEvent.ended(run.video() as HTMLVideoElement)
    })
    // still going: the floor has not been reached, so `ended` replays it
    expect(run.isDone()).toBe(false)
  }
  // the last pass — the beat is now past the ideal end and every seam with it,
  // which is exactly where a guard with no slack would already have fired
  await run.tick(one + seam)
  expect(run.isDone()).toBe(false)
  act(() => {
    fireEvent.ended(run.video() as HTMLVideoElement)
  })
  await run.finished
  expect(run.isDone()).toBe(true)
  vi.useRealTimers()
})
