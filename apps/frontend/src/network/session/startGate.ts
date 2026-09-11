import type { PlayerId } from '@release/engine'

// How long the table waits for the slowest intro. A peer with a hidden tab, a
// stalled animation or a crashed renderer must not freeze the game for everyone
// else, so the wait is capped and the game starts without it.
export const INTRO_CAP_MS = 12_000

export interface StartGate {
  readonly open: boolean
  // A seat has finished its intro. Unknown or repeated ids are ignored.
  ready(playerId: PlayerId): void
  // Runs once, when the gate opens — by the last report or by the cap.
  onOpen(fn: () => void): void
  // Stop waiting and never open. For a keeper that is closed or deposed.
  cancel(): void
}

// Who still has to finish their opening before the game may move.
//
// The keeper's ticker runs `tick` and `driveUnattended`, so without this an absent
// seat could be played by the engine while every human is still watching cards
// fly — and a host whose intro finished first could act into a guest's
// animation. Neither is a clock the engine owns: nothing at the deal carries a
// deadline, so this holds the table rather than pausing anything.
export function createStartGate(args: {
  expect: PlayerId[]
  capMs?: number
  schedule?: (fn: () => void, ms: number) => () => void
}): StartGate {
  const waiting = new Set(args.expect)
  const listeners = new Set<() => void>()
  let opened = waiting.size === 0
  let cancelled = false

  const schedule =
    args.schedule ??
    ((fn: () => void, ms: number) => {
      const handle = setTimeout(fn, ms)
      return () => clearTimeout(handle)
    })

  let stopTimer: (() => void) | null = null

  const release = () => {
    if (opened || cancelled) return
    opened = true
    stopTimer?.()
    stopTimer = null
    for (const fn of listeners) fn()
    listeners.clear()
  }

  if (!opened) stopTimer = schedule(release, args.capMs ?? INTRO_CAP_MS)

  return {
    get open() {
      return opened
    },
    ready(playerId) {
      if (cancelled || opened) return
      // A seat nobody is waiting on: a spectator, or a peer that reconnected
      // after the gate opened. Ignored rather than treated as progress.
      if (!waiting.delete(playerId)) return
      if (waiting.size === 0) release()
    },
    onOpen(fn) {
      if (cancelled) return
      if (opened) {
        fn()
        return
      }
      listeners.add(fn)
    },
    cancel() {
      cancelled = true
      stopTimer?.()
      stopTimer = null
      listeners.clear()
    },
  }
}
