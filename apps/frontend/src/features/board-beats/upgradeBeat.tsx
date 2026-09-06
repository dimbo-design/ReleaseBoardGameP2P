import { cardById } from '@release/ui'
import type { Rect } from '@release/ui/animations'
import { play, useFlyer, wait } from '@release/ui/animations'
import { useCallback, useRef } from 'react'
import type { BeatRun, BoardAnchors } from '~/entities/game/board'
import type { BeatPlan } from './planBeats'

// System Upgrade's arrivals, and ONLY the arrivals. The cards that have already
// landed are rendered by the projection (`_useUpgradeStaging`), because
// `pending.thrown` is public and survives a batch boundary — so this beat never
// has to hold the centre, and the last frame it plays is the pose the
// projection renders (I7).
const THROW_DUR = 460 // a card flies from a seat to the centre
const THROW_STEP = 260 // stagger, when several land in one batch
const THROW_SCALE = 0.42 // it starts small at the seat and grows to full

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export function useUpgradeBeat(anchors: BoardAnchors) {
  const { overlay, raise, drop } = useFlyer()
  const latest = useRef({ anchors })
  latest.current = { anchors }

  const run = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'upgrade' }>, _beat: BeatRun) => {
      const a = latest.current.anchors
      const centre = rectOf(a.centre.current)
      if (!centre) return
      await Promise.all(
        plan.throws.map(async (t, i) => {
          // Several answers inside ONE batch are staggered; answers that
          // arrived in separate batches are separate beats and this loop runs
          // once. Both are the same code, which is the point of folding a run.
          await wait(i * THROW_STEP)
          const seat = a.seatBox(t.player)
          const card = cardById(t.card)
          if (!seat || !card) return
          const from = {
            left: seat.left + (seat.width - centre.width * THROW_SCALE) / 2,
            top: seat.top + (seat.height - centre.height * THROW_SCALE) / 2,
            width: centre.width * THROW_SCALE,
            height: centre.height * THROW_SCALE,
          }
          const key = `upgrade:${t.eventId}`
          const [el] = await raise([{ key, card, at: from }])
          if (el) {
            const anim = play('playToCenter', el, { from, to: centre, duration: THROW_DUR })
            if (anim) await anim.finished
          }
          // The flyer lets go in the same commit the projection's own render of
          // that card takes over, so it is never on screen twice — the rule
          // #101's Fix A had to learn the hard way.
          drop(key)
        }),
      )
    },
    [raise, drop],
  )

  return { overlay, run }
}
