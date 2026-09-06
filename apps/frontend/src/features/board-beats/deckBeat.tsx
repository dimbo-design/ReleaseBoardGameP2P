import type { CardData } from '@release/ui'
import { cardAreaOf } from '@release/ui'
import type { Rect } from '@release/ui/animations'
import { nextFrames, play, useFlyer, wait } from '@release/ui/animations'
import { useCallback, useRef } from 'react'
import type { BeatRun, BoardAnchors } from '~/entities/game/board'
import type { BeatPlan, PileStep } from './planBeats'

// What happens to the draw piles themselves. Three movements, one scene
// (`DeckAnimationsStory`), and none of them carries a card whose face anybody
// sees: a pile is face down before and after, so what moves is the pile.
//
// The cards that CAUSE a split or a merge — Git Branch and Git Merge — landed
// with #61 slice B, and `classifyPiles` (planBeats.ts) derives which movement
// ran from `pilesChanged` alone. These are the movements they drive.

const GATHER_MS = 360 // the heap collecting itself into a pile
const TURN_MS = 460 // the gathered pile turning face down on the deck
// Named for the piles, not for a pair: `MERGE_MS` in this feature folder is
// the 620ms card-pair fold (entities/game/board/poses.ts). What moves here is
// a whole pile absorbing into another, and it is a different duration.
const PILE_SPLIT_MS = 520
const PILE_MERGE_MS = 520
const STEP_HOLD = 360 // the standard short beat between deck steps

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export function useDeckBeat(anchors: BoardAnchors) {
  const { overlay, raise, patch, drop } = useFlyer()
  const latest = useRef({ anchors })
  latest.current = { anchors }

  // The discard becomes a pile: it gathers where it lies, flies to the pile's
  // spot face up, and turns over on landing. `deckReshuffled` and Git Branch's
  // Sudo step are the same movement — one shuffles and the other does not, and
  // neither is visible from outside.
  const discardOntoPile = useCallback(
    async (pile: number, top: CardData | undefined) => {
      const a = latest.current.anchors
      const fromCell = rectOf(a.discardBox.current)
      const toCell = rectOf(a.pileBox(pile))
      // No top card means an empty discard: nothing to carry, and nothing this
      // beat may invent a face for.
      if (!fromCell || !toCell || !top) return
      const from = cardAreaOf(fromCell)
      const [el] = await raise([{ key: 'pile', card: top, at: from }])
      await wait(GATHER_MS)
      if (el) {
        const anim = play('gatherToDeck', el, { from, to: cardAreaOf(toCell), duration: 560 })
        if (anim) await anim.finished
      }
      await wait(STEP_HOLD)
      patch('pile', { faceDown: true })
      await wait(TURN_MS)
      drop('pile')
    },
    [raise, patch, drop],
  )

  const runReshuffle = useCallback(
    async (_plan: Extract<BeatPlan, { kind: 'reshuffle' }>, ctx: BeatRun) => {
      // Wait for the shadow before measuring anything — the same order, and for
      // the same reason, as `step()` below spells out at length. At entry the
      // board is still the one the batch produced: the discard already emptied,
      // the row already the single recycled pile. Both rects this flight is
      // built from would be read off that board rather than off the one the
      // beat animates away from.
      await nextFrames()
      // The recycled discard always lands on pile 0: `refillFromDiscard` runs
      // only when every pile is empty and replaces `main` with a single one.
      // The card that carries the flight is the discard's own top, from the
      // projection the board is still showing — never a chosen one.
      await discardOntoPile(0, ctx.base.decks.discard ?? undefined)
    },
    [discardOntoPile],
  )

  const step = useCallback(
    async (s: PileStep, ctx: BeatRun) => {
      // WAIT FOR THE SHADOW, THEN MEASURE. The queue starts a beat from inside a
      // layout effect, so at entry the DOM still holds the projection the BATCH
      // produced, and the shadow that puts the pre-batch row back is a commit
      // away. For a row of piles that is not a wrong rect but a missing one: on
      // Git Merge the row has already collapsed to the survivor, every absorbed
      // pile has unmounted, and `bindPile(i, null)` has dropped it from the
      // registry — so `pileBox(i)` answers null for each of them, not one flight
      // is built, and the merge plays NOTHING while the counts snap over. Two
      // frames is how we get to the other side of that commit (I2), exactly as
      // the discard beat does.
      //
      // Per STEP, not once per run: `advance()` publishes mid-run, so the second
      // step of a Git Branch + Sudo batch faces the same one-commit lag against
      // the row the first step has just grown. A single wait at the top of
      // `runPiles` would make only the first step honest and leave every one
      // after it measuring a board that has not caught up yet. A step that
      // measures for itself never has to know what the step before it waited
      // for.
      await nextFrames()
      const a = latest.current.anchors
      if (s.kind === 'merge') {
        const to = rectOf(a.pileBox(0))
        const flights: Promise<unknown>[] = []
        if (to) {
          // Every pile but the survivor, and each from its OWN rect. The target
          // is measured once — only the sources differ.
          for (let i = 1; i < ctx.base.decks.main.length; i++) {
            const el = a.pileBox(i)
            if (!el) continue
            const anim = play('absorbToDeck', el, {
              from: rectOf(el),
              to,
              duration: PILE_MERGE_MS,
            })
            if (anim) flights.push(anim.finished)
          }
          if (s.withDiscard) {
            const heap = a.discardBox.current
            if (heap) {
              const anim = play('absorbToDeck', heap, {
                from: rectOf(heap),
                to,
                duration: PILE_MERGE_MS,
              })
              if (anim) flights.push(anim.finished)
            }
          }
        }
        await Promise.all(flights)
        advance(ctx, s.piles)
        return
      }

      if (s.kind === 'split') {
        // FLIP: the half is already in its new DOM place and is animated FROM
        // the rect its source pile had. So the source is measured BEFORE the
        // publish that remounts the row (I1), and the flight after it. "Before
        // the publish" is only half of it, though — the wait above is the other
        // half: without it this reads pile `at` already narrowed by the row the
        // batch left (`pileWidthFor` gives 120 at two piles where the pile being
        // split had 150), and the half would fly out of a rect the pile never
        // had.
        const from = rectOf(a.pileBox(s.at))
        advance(ctx, s.piles)
        await nextFrames()
        const el = a.pileBox(s.at + 1)
        if (el && from) {
          const anim = play('flyFrom', el, { from, duration: PILE_SPLIT_MS })
          if (anim) await anim.finished
        }
        return
      }

      // fromDiscard — the discard becomes a further pile at the end of the row.
      // It has to exist before anything can land on it, so it is published first
      // and flown into second. The top card is read BEFORE the publish: the
      // projection this beat animates away from is the one that still has a
      // discard to carry.
      const top = ctx.base.decks.discard ?? undefined
      advance(ctx, s.piles)
      await nextFrames()
      await discardOntoPile(s.at, top)
    },
    [discardOntoPile],
  )

  const runPiles = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'piles' }>, ctx: BeatRun) => {
      // Git Branch + Sudo emits TWO changes in one batch — a split, then the
      // discard becoming a further pile. Each runs against the table as the last
      // one left it, which is why `ctx.base` is re-read every time.
      for (const s of plan.steps) {
        await step(s, ctx)
        await wait(STEP_HOLD)
      }
    },
    [step],
  )

  // A new match cancels what is in the air: the only carrier this beat ever
  // raises is the one flyer `discardOntoPile` puts up (the gathered discard, or
  // the recycled pile), so dropping it is the whole of it.
  const reset = useCallback(() => drop(), [drop])

  return { overlay, runReshuffle, runPiles, reset }
}

// The board with a different row of piles — published to the queue AND written
// back into the run's own base. Both, because Git Branch + Sudo has a SECOND
// step, and it has to run against the table the first one left: publishing
// alone would show the right thing and then classify the next step against a
// row that no longer exists.
function advance(ctx: BeatRun, piles: number[]): void {
  ctx.base = { ...ctx.base, decks: { ...ctx.base.decks, main: piles } }
  ctx.publish(ctx.base)
}
