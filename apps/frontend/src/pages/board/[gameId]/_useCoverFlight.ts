// The half of a staged answer that is the same wherever the answer came from:
// the card flies to a centre slot at a pose, and once its carrier lets go (or
// at once under reduced motion) the page's own static render may take over.
//
// Extracted at the third caller, not the second (#88's standing rule: a
// movement found in two scenes is a module that has not been packaged yet).
// `_useDefenseStaging.tsx` had it privately for #101; `_useNeutralizeStaging`
// needs exactly it for #102, and the 2026-08-18 design promised this module
// and did not land it.
//
// What it deliberately does NOT own: the dispatch (a `defend` and a
// `neutralize503` are different choices) and the way home (the fan for a hand
// card, its own slot for a release). Both stay with the caller.

import type { Event } from '@release/engine'
import type { CardData } from '@release/ui'
import { play, type Rect, useFlyer } from '@release/ui/animations'
import { type ReactNode, useCallback, useRef, useState } from 'react'
import { useReducedMotion } from '~/shared/lib/useReducedMotion'

type Flyer = ReturnType<typeof useFlyer>

export interface FlyArgs {
  card: CardData
  /** where it takes off from — a drag's own drop rect, or nothing to measure */
  from: Rect | undefined
  /** the centre slot, read at the last possible moment (I1: after the commit
   *  that reflows the table, never before it) */
  to: () => DOMRect | undefined
  pose: { rot: number; dx: number; dy: number }
  /** the flyer's own name for this carrier — one cycle, one key */
  key?: string
  /** …or whatever the caller puts in the carrier instead of a bare card */
  content?: ReactNode
  /** checked in the `finally`, right before `landed` is raised: answers
   *  whether THIS cycle still owns the staging it was flying for. A caller
   *  whose staging can be cancelled and replaced while the flight is still in
   *  the air (Task 17's Sudo slot) passes this so a stale cycle's landing
   *  does not flip `landed` true for whatever staging replaced it — see
   *  `_useDefenseStaging.tsx`'s `stageDefSudo` for the concrete check. Omit it
   *  when no restaging can happen mid-flight; the flag is then always raised,
   *  same as before this option existed. */
  stillCurrent?: () => boolean
}

export interface CoverFlight {
  /** true once the flight has landed, or at once under reduced motion */
  landed: boolean
  /** re-arm for a fresh cycle and fly `card` from `from` to `to` at `pose` */
  fly: (args: FlyArgs) => Promise<void>
  /** arm the gate for a flight the CALLER runs itself — a shape that is not
   *  this module's (a two-element fold raises both halves and animates them in
   *  parallel, so it keeps its own flight) still wants the one `landed` gate
   *  the page reads. Pair with `settle()` on every exit path. */
  arm: () => void
  /** the carrier has let go — the caller's static render may take over */
  settle: () => void
  /** stamp the watermark at a dispatch: everything already in `events` is old news */
  mark: (events: Event[]) => void
  /** what arrived since the last `mark()` — for a caller that has to match the
   *  rejection against its own action rather than take any rejection at all */
  since: (events: Event[]) => Event[]
  /** has the engine refused anything since the last `mark()`? */
  rejectedSince: (events: Event[]) => boolean
  overlay: ReactNode[]
  reset: () => void
}

/**
 * `shared` lets a page that already has a `useFlyer` — because some of its
 * flights are NOT this module's shape, and because two cycles on one table
 * (`_useDefenseStaging`'s cover and its Sudo slot) each need their own
 * `landed` gate — put every carrier on ONE flyer. Two `useFlyer`s rendered
 * side by side number their nodes from their own counters, so their overlays
 * collide on React keys the moment both are in the air. Called with nothing,
 * the module owns its carrier outright, which is what a single-flight page
 * (Task 9's `_useNeutralizeStaging`) wants.
 */
export function useCoverFlight(shared?: Flyer): CoverFlight {
  const reduced = useReducedMotion()
  const own = useFlyer()
  const flyer = shared ?? own
  const [landed, setLanded] = useState(false)

  const arm = useCallback(() => setLanded(false), [])
  const settle = useCallback(() => setLanded(true), [])

  const fly = useCallback(
    async ({ card, from, to, pose, key = 'cover', content, stillCurrent }: FlyArgs) => {
      setLanded(false) // fresh cycle — the flight below has not carried this card yet
      try {
        const dest = to()
        if (!reduced && from && dest) {
          // `content != null` rather than a plain truthiness check: React 19's
          // `ReactNode` admits a Promise, and biome's `noMisusedPromises`
          // rejects one in a condition.
          const [el] = await flyer.raise([
            { key, card: content == null ? card : undefined, at: from, content },
          ])
          if (el) {
            await play('playToCenter', el, {
              from,
              to: dest,
              rotate: pose.rot,
              dx: pose.dx,
              dy: pose.dy,
            })?.finished
          }
          flyer.drop(key)
        }
      } finally {
        // the carrier has dropped it (or, under reduced motion, there was never
        // one) — the caller's static render may take over now, not a moment
        // before. In a `finally` since #101, Fix D round 4, and load-bearing
        // there: a `.finished` that rejects must still report the carrier gone,
        // or `landed` stays false with a dispatched play staged and the fan
        // keeps a hole in it for the rest of the match.
        //
        // `stillCurrent` is checked HERE, not before the `try` — a rejected
        // `.finished` must still reach this line, and a cancel-and-restage
        // must still leave `landed` false for whatever now-current staging
        // replaced this cycle. Both properties hold only if the flag on the
        // OLD cycle is gated right where it is raised, not by skipping the
        // `finally` altogether (whole-branch review, fix round: a restaged
        // Sudo was flipping `sudoLanded` true for the NEW staging, painting
        // the static card while the new carrier was still flying it).
        if (!stillCurrent || stillCurrent()) setLanded(true)
      }
    },
    [reduced, flyer.raise, flyer.drop],
  )

  // captured the instant a dispatch commits — the caller's rejected-watcher
  // reads only what came AFTER this point, the same discipline
  // `_useBoardStaging.ts` applies to this same array.
  const watermark = useRef(0)
  const mark = useCallback((events: Event[]) => {
    watermark.current = events.length
  }, [])
  const since = useCallback((events: Event[]) => events.slice(watermark.current), [])
  const rejectedSince = useCallback(
    (events: Event[]) => events.slice(watermark.current).some((e) => e.type === 'rejected'),
    [],
  )

  const reset = useCallback(() => {
    setLanded(false)
    watermark.current = 0
    flyer.drop()
  }, [flyer.drop])

  return { landed, fly, arm, settle, mark, since, rejectedSince, overlay: flyer.overlay, reset }
}
