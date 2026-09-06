import { cardAreaOf, cardById, GRID_TOP, gridCells } from '@release/ui'
import type { Leaving, Rect } from '@release/ui/animations'
import { nextFrames, play, scatterAt, useDiscardExit, useFlyer, wait } from '@release/ui/animations'
import { type RefObject, useCallback, useRef } from 'react'
import type { BeatRun, BoardAnchors, HandLimitHandoff } from '~/entities/game/board'
import { CLEAR_STEP, GATHER_HOLD } from '~/entities/game/board'
import type { BeatPlan, DiscardCard } from './planBeats'
import { withoutFlown } from './withoutFlown'

// THE HAND LIMIT'S OWN EXIT (#104). The excess does not trickle into the heap
// one card at a time: it stands in a grid at the centre — sized upfront from
// the count, so every card goes straight to its own cell — the grid is held
// open long enough for the table to read what the turn cost, and only then does
// the whole of it leave, card by card but as one movement.
//
// Two ways in, one way out:
//   • ADOPT — the actor is us. The grid is already standing: the page's own
//     gesture (`_useHandLimit.tsx`) built it card by card while the player was
//     deciding, long before these events came back off the wire. Nothing flies
//     in, and a carrier here would put a second copy of every card on screen.
//   • BUILD — every other peer, and ourselves with no handoff (a rejoin). The
//     cells are computed rather than rendered: a gathered card needs no DOM cell
//     of its own, it flies to a box and stands there as a carrier — the same
//     thing #102's sweep does with its heap.
//
// The tail is shared, and so is `GATHER_HOLD` itself: the hold here IS the
// no-defence sweep's hold, one value with two readers rather than two tunings.

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

// The grid's cells in viewport coordinates. `gridCells` gives offsets from the
// grid's own point; the point itself is `GRID_TOP` of the table, measured off
// the ambience layer, which is `inset: 0` of the table (I6 — these are card
// boxes, never a tilted node's bounding rect).
function cellBoxes(n: number, table: Rect): Rect[] {
  const cx = table.left + table.width / 2
  const cy = table.top + (table.height * GRID_TOP) / 100
  return gridCells(n).map((c) => ({
    left: cx + c.dx - c.w / 2,
    top: cy + c.dy - c.h / 2,
    width: c.w,
    height: c.h,
  }))
}

function claimCards(
  cards: DiscardCard[],
  placed: HandLimitHandoff['cards'],
): HandLimitHandoff['cards'] | null {
  if (cards.length !== placed.length) return null
  const spare = [...placed]
  const claimed: HandLimitHandoff['cards'] = []
  for (const card of cards) {
    const at = spare.findIndex((item) => item.card.id === card.card)
    if (at < 0) return null
    claimed.push(spare.splice(at, 1)[0])
  }
  return claimed
}

export function useHandLimitBeat(
  anchors: BoardAnchors,
  handoff?: RefObject<HandLimitHandoff | null>,
) {
  const { overlay: exitOverlay, send, reset: resetExit } = useDiscardExit(anchors.discardBox)
  const flyer = useFlyer()
  const latest = useRef({ anchors, send, handoff })
  const generation = useRef(0)
  latest.current = { anchors, send, handoff }

  // where a card that has to be FLOWN in starts from — the same three sources
  // `discardBeat` knows, for the same reason it knows them
  const whereFrom = useCallback((c: DiscardCard): Rect | null => {
    const a = latest.current.anchors
    if (c.source.kind === 'hand') return rectOf(a.handSlotAt(c.source.index))
    if (c.source.kind === 'release') return rectOf(a.releaseSlot(c.source.player, c.source.slot))
    return a.seatBox(c.source.player)
  }, [])

  // The AI card standing behind this prompt goes home now that the batch has
  // answered it. It has been standing on the projection's own render
  // (`_Board.tsx`'s `aiStanding`, off `pending.source`) since the batch that
  // revealed it — that beat could not fly it home, because it still had to
  // stand and explain the prompt this beat is what answers.
  //
  // Written out here rather than imported from `defenseBeat.tsx`'s own
  // `sendHomeward`, or `aiBeat.tsx`'s `goHome`: each runner owns its own
  // `useFlyer` carrier, and a carrier passed between hooks is how this
  // codebase has already grown two latch bugs of that family (`useBeats.ts`'s
  // own comments). `isStale` is this file's own — a reset mid-flight must not
  // let a card from an abandoned match keep travelling.
  const sendHomeward = useCallback(
    async (id: string, isStale: () => boolean) => {
      const a = latest.current.anchors
      const card = cardById(id)
      const from = rectOf(a.effect.current)
      const deck = rectOf(a.eventsBox.current)
      if (!card || !from || !deck) return
      // a no-travel raise at the card's own standing spot — the honest answer
      // to "it is here already"
      const [el] = await flyer.raise([{ key: 'homeward', at: from, card }])
      if (!el || isStale()) return
      flyer.patch('homeward', { faceDown: true })
      await wait(420) // `flipCard`'s own duration — matches `aiBeat.tsx`'s `goHome`
      if (isStale()) return
      const anim = play('returnToDeck', el, { from, to: cardAreaOf(deck) })
      if (anim) await anim.finished
      flyer.drop('homeward')
    },
    [flyer.raise, flyer.patch, flyer.drop],
  )

  const run = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'handLimit' }>, ctx: BeatRun) => {
      const runGeneration = generation.current
      const isStale = () => generation.current !== runGeneration
      // The page may clear this ref as its pending render advances while we
      // yield. Capture the gesture fact now; measure its live cells only after
      // the shadow has painted below.
      const earlyHeld = latest.current.handoff?.current
      // WAIT FOR THE SHADOW, THEN MEASURE — the queue starts this from inside a
      // layout effect, so at entry React has committed the projection that
      // ARRIVED and the shadow that puts the cards back is a commit away. Two
      // frames is how we get to the other side of it (I1, and the same reason
      // `discardBeat` waits).
      await nextFrames()
      if (isStale()) return
      const a = latest.current.anchors
      // Keep a handoff that was already present, but give the same-commit
      // local/keeper path one frame boundary to publish its dispatched grid.
      // `useBeats` starts this runner in an earlier layout effect than Board's
      // handoff effect, so the ref can legitimately be null at entry and live
      // by the time the shadow is ready to measure.
      const held = earlyHeld ?? latest.current.handoff?.current
      // Adopt only a grid that is REALLY ours and really complete: the same
      // player, and a cell for every card the engine banked. Anything else
      // falls through to the honest path — a flight from where the board can
      // actually see the card.
      const mine = plan.player === ctx.base.selfId
      const adopted =
        held && mine && held.player === plan.player ? claimCards(plan.cards, held.cards) : null

      // TAKEOFF: the cards are gone from wherever they stood — publish before
      // the movement, or the board shows each card twice for its whole flight.
      // The discard end stays `ctx.base`'s own (see `withoutFlown`).
      const flown = withoutFlown(ctx.base, plan.cards)
      ctx.publish(flown)

      let items: Leaving[] = []

      if (adopted) {
        // ADOPT. The grid is standing; each card leaves from the cell it has
        // been sitting in. Matched by card id with a claimed list, the same way
        // `sourceOf` claims a hand slot: two copies of one card are
        // interchangeable to look at, so the first unclaimed one is right.
        const measured = adopted
          .map((placed, i) => {
            const box = rectOf(held?.cellAt(placed.slot) ?? null)
            return box ? { box, card: plan.cards[i], placed } : null
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry != null)
        if (measured.length !== plan.cards.length) {
          // Geometry is animation input, never game truth. Keep the complete
          // grid through its hold, then yield every card together to the
          // accepted projection instead of releasing it under a partial exit.
          //
          // The road home is deliberately skipped on this bail-out (#106):
          // once the pending clears, `_Board.tsx`'s `aiStanding` derivation
          // yields null anyway, so the card leaves the standing slot
          // regardless of whether this beat flies it — and flying it home
          // from a beat that has already given up on its own geometry risks
          // a flight from a stale rect, which is worse than no flight.
          await wait(GATHER_HOLD)
          if (isStale()) return
          held?.release()
          flyer.drop()
          return
        }
        items = measured.map(({ box, card: c, placed }) => ({
          key: c.key,
          card: placed.card,
          from: box,
          layer: placed.slot,
          delay: placed.slot * CLEAR_STEP,
          scatter: scatterAt(c.eventId),
        }))
      } else {
        // BUILD. Cells are computed, not rendered — a gathered card stands on
        // its own carrier until the exit takes over.
        //
        // …except Bad Vibe-Coding's, which has no grid at all (#106, Decision
        // 6): `gridCells(1)` centres its one cell at `dx 0`, underneath the AI
        // card standing at the `effect` place. `plan.picked` is the same fact
        // `_useHandLimit`'s own `aiPicked` render reads, carried on the plan
        // because THIS path is every peer who is not the discarder — they have
        // no handoff to adopt, so without it they would build that overlap.
        //
        // The box is MEASURED off the board's own `picked` anchor rather than
        // computed here: that node is positioned by
        // `centrePlaceStyle('aiPick', 'picked')`, so the beat and the render
        // read one geometry instead of two copies of `CENTRE_SLOTS.picked`.
        const table = rectOf(a.bg.current)
        const pickedBox = plan.picked ? rectOf(a.picked.current) : null
        // One card by construction — the pending's `excess` is 1 for Bad Vibe
        // — and if that ever stopped being true this stacks them exactly as
        // the page's own `aiPicked` render already stacks its cells there.
        const boxes = pickedBox
          ? plan.cards.map(() => pickedBox)
          : table
            ? cellBoxes(plan.cards.length, table)
            : []
        const flying: {
          key: string
          planCard: DiscardCard
          card: NonNullable<ReturnType<typeof cardById>>
          from: Rect
          box: Rect
          slot: number
        }[] = []
        for (let i = 0; i < plan.cards.length; i++) {
          const planCard = plan.cards[i]
          const card = cardById(planCard.card)
          const from = whereFrom(planCard)
          const box = boxes[i]
          if (!card || !from || !box) continue
          flying.push({ key: `hl${planCard.eventId}`, planCard, card, from, box, slot: i })
        }
        if (flying.length > 0) {
          // I10 — every carrier mounts on its OWN rect, and they travel at once:
          // the grid fills as one gesture, not as a queue of arrivals.
          await flyer.raise(
            flying.map((f) => ({ key: f.key, at: f.from, layer: f.slot, card: f.card })),
          )
          if (isStale()) return
          await Promise.all(
            flying.map(async (f) => {
              const el = flyer.elOf(f.key)
              const movement = el ? play('playToCenter', el, { from: f.from, to: f.box }) : null
              if (movement) {
                await movement.finished
                if (isStale()) return
              }
              if (isStale()) return
              // I4 — it IS at the cell now; pin it, or the next render puts the
              // carrier back where it was raised
              flyer.pin(f.key, f.box)
            }),
          )
          if (isStale()) return
        }
        items = flying.map((f) => ({
          key: f.planCard.key,
          card: f.card,
          from: f.box,
          layer: f.slot,
          delay: f.slot * CLEAR_STEP,
          scatter: scatterAt(f.planCard.eventId),
        }))
      }

      // Same deliberate omission as the adopted-mismatch bail-out above: the
      // road home (#106) is not sent from here either. Nothing measurable
      // means the grid itself never played, so there is nothing for the
      // homeward leg to follow either — and the same "a stale rect is worse
      // than no flight" reasoning applies.
      if (items.length === 0) return

      // HELD OPEN — the same beat the no-defence sweep holds for, and the same
      // value: the table has to be able to read what the turn cost before any
      // of it moves.
      await wait(GATHER_HOLD)
      if (isStale()) return

      // Hand the grid back immediately ahead of the exit, never before the hold
      // (`defenseBeat`'s own ordering, and the bug it was written for): the
      // exit mounts its own carriers at these very boxes, so the page's render
      // and the flight swap inside one commit. `release()` drops the grid's
      // render only — the picked cards stay out of the fan until the pending
      // itself clears.
      if (adopted) held?.release()
      flyer.drop()
      if (isStale()) return
      await latest.current.send(items)
      if (isStale()) return

      // The AI card that raised this prompt goes home now that the batch has
      // answered it — its own road, not this grid's (#106).
      //
      // The pending goes FIRST, in its own publish, exactly as
      // `defenseBeat.runNeutralized` does it and for the same reason: the
      // shadow still carries the prompt, so `_Board.tsx`'s `aiStanding`
      // (off `pending.source`) is still rendering that card in the `effect`
      // slot — and `sendHomeward` is about to raise a carrier at that very
      // rect and fly it away. Without this the table sees a duplicate stand
      // still while its own copy leaves.
      //
      // A publish, not a flag the render could be told to obey: the two
      // early returns above deliberately skip this leg (see their comments),
      // and they rely on the PROJECTION clearing the card once the pending
      // does. Suppressing the render instead would leave those paths with a
      // card both suppressed and never flown — genuinely vanished.
      if (plan.homeward) {
        ctx.publish({ ...flown, pending: null })
        await sendHomeward(plan.homeward, isStale)
      }
    },
    [whereFrom, flyer.raise, flyer.elOf, flyer.pin, flyer.drop, sendHomeward],
  )

  // A new match cancels what is in the air: both the exit step's flights and
  // this runner's own carriers belong here, not to the queue, and a card left
  // mid-flight would keep crossing the board of a match that no longer exists.
  const reset = useCallback(() => {
    generation.current += 1
    resetExit()
    flyer.drop()
  }, [resetExit, flyer.drop])

  return { overlay: [...exitOverlay, ...flyer.overlay], run, reset }
}
