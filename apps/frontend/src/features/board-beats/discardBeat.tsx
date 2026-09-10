import { cardById } from '@release/ui'
import type { Leaving, Rect } from '@release/ui/animations'
import {
  nextFrames,
  restTransform,
  scatterAt,
  useDiscardExit,
  useFlyer,
  wait,
} from '@release/ui/animations'
import { useCallback, useRef } from 'react'
import type { BeatRun, BoardAnchors } from '~/entities/game/board'
import { GATHER_HOLD } from '~/entities/game/board'
import type { BeatPlan, DiscardCard } from './planBeats'
import { withoutFlown } from './withoutFlown'

// A card leaves the table for the discard. The movement itself belongs to the
// shared step (`useDiscardExit`); what lives here is only where each card
// starts from, and the wait that makes measuring it honest.
//
// No onLanded: the heap is derived from these same events in toBoardState, so
// the cards this step flew are already in the projection it hands over to. A
// second set of books here would be a second source for one heap.

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export function useDiscardBeat(anchors: BoardAnchors) {
  const { overlay: exitOverlay, send, reset: resetExit } = useDiscardExit(anchors.discardBox)
  // The sweep's own carrier (#102): the cards a defenceless player owned are
  // drawn together at the centre before they scatter, and that draw-together
  // leg needs a flyer of its own — the exit step only ever flies FROM where a
  // card stands TO the discard, it has no notion of a stop in between.
  const flyer = useFlyer()
  const latest = useRef({ anchors, send })
  latest.current = { anchors, send }

  const whereFrom = useCallback((c: DiscardCard): Rect | null => {
    const a = latest.current.anchors
    if (c.source.kind === 'hand') return rectOf(a.handSlotAt(c.source.index))
    if (c.source.kind === 'release') return rectOf(a.releaseSlot(c.source.player, c.source.slot))
    return a.seatBox(c.source.player)
  }, [])

  const toLeaving = useCallback(
    (c: DiscardCard): Leaving | null => {
      const card = cardById(c.card)
      const from = whereFrom(c)
      if (!card || !from) return null
      // The SAME Scatter the adapter rests this card on (I7): the flight ends on
      // the pose the heap already holds for it, so nothing moves on handover.
      return { key: c.key, card, from, scatter: scatterAt(c.eventId) }
    },
    [whereFrom],
  )

  const run = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'discard' }>, ctx: BeatRun) => {
      // WAIT FOR THE SHADOW, THEN MEASURE — in that order, and the order is the
      // whole point. The queue starts this from inside a layout effect, so at
      // entry React has committed the projection that ARRIVED: the card is
      // already out of the fan and its slot with it. The shadow that puts the
      // slot back is a commit away. Two frames is how we get to the other side
      // of it (the same reason the carrier waits, I2).
      //
      // Measuring before this yields `null` for a one-card hand (no flight at
      // all) and the wrong slot for a larger one — and no test can see it,
      // because a stub that hands back a detached node measures the same either
      // way. `useBeats.test.tsx` queries the probe's real DOM for exactly this.
      await nextFrames()
      const items: Leaving[] = []
      const flown: DiscardCard[] = []
      for (const c of plan.cards) {
        const leaving = toLeaving(c)
        if (leaving) {
          items.push(leaving)
          flown.push(c)
        }
      }
      if (items.length === 0) return
      // TAKEOFF: the fan has already let go of these cards — publish now, before
      // the flight itself, or the board would show the card twice for as long as
      // the flight lasts (once mid-air, once still sitting in its slot). The
      // discard end is deliberately left at `ctx.base`'s own — see
      // `withoutFlown`'s comment for why.
      ctx.publish(withoutFlown(ctx.base, flown))
      // THE SWEEP (#102): a defenceless player's whole table does not leave
      // card by card — it is gathered at the centre first, held open long
      // enough for the table to read what happened, and only then scattered.
      // Ported from the playground's own Error503Story.sweep(items, gather).
      if (plan.gather) {
        const centre = rectOf(latest.current.anchors.centre.current)
        if (centre) {
          // A HEAP, not a neat stack: the same scatter model the discard uses,
          // so the pile at the centre reads as a pile.
          const heap = items.map((_, i) => scatterAt(i))
          const boxes = heap.map((sc) => ({
            left: centre.left + sc.dx,
            top: centre.top + sc.dy,
            width: centre.width,
            height: centre.height,
          }))
          // `from` is guaranteed here — every item in `items` came out of
          // `toLeaving`, which only ever returns one when its `from` resolved
          // (`Leaving.from` is optional in the shared type only because a
          // flight can also start from a live `node`, a case this beat never
          // produces).
          await flyer.raise(
            items.map((it, i) => ({ key: `s${i}`, card: it.card, at: it.from as Rect })),
          )
          await Promise.all(
            items.map((_, i) => {
              // the tilt travels WITH the move, so the card eases into its
              // place in the pile instead of snapping into the angle
              flyer.patch(`s${i}`, { pose: restTransform({ ...heap[i], dx: 0, dy: 0 }) })
              return flyer.glide(`s${i}`, boxes[i], 300)
            }),
          )
          // held open at the centre — the table has to be readable before the
          // cards scatter
          await wait(GATHER_HOLD)
          // Hand the step the card BOXES, not the tilted nodes: a rotated
          // node's bounding rect is the box AROUND it (I6). The step raises
          // its own flyers and unwinds the tilt in flight, so the carrier's
          // are dropped in the same turn the step's appear.
          for (let i = 0; i < items.length; i++) {
            items[i] = {
              ...items[i],
              from: boxes[i],
              pose: { rot: heap[i].rot, dx: 0, dy: 0 },
              layer: i,
            }
          }
          flyer.drop()
        }
      }
      await latest.current.send(items)
    },
    [toLeaving, flyer.raise, flyer.patch, flyer.glide, flyer.drop],
  )

  // A new match cancels what is in the air — the same reason and the same
  // idiom every other runner keeps its own carriers by: both the exit step's
  // flights and the sweep's own flyer belong to this runner, not the queue,
  // and a card left mid-flight would keep crossing the board of a match that
  // no longer exists.
  const reset = useCallback(() => {
    resetExit()
    flyer.drop()
  }, [resetExit, flyer.drop])

  return { overlay: [...exitOverlay, ...flyer.overlay], run, reset }
}
