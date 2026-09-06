import type { CardData } from '@release/ui'
import { CARD_W, cardAreaOf, cardBoxIn, cardById } from '@release/ui'
import type { Rect } from '@release/ui/animations'
import {
  nextFrames,
  play,
  scatterAt,
  useDiscardExit,
  useHandArrival,
  wait,
} from '@release/ui/animations'
import { useCallback, useRef } from 'react'
import type { BeatRun, BoardAnchors, BoardState } from '~/entities/game/board'
import type { BeatPlan, PlannedDraw } from './planBeats'
import { TABLE_HOLD, useToCentre } from './toCentre'

// A card is drawn. One flight to the centre, then a branch on who drew it and
// what it turned out to be — the scene is `DrawCardStory`, driven here by the
// events instead of by a click on a deck.
//
// The trigger's WHOLE life is in this beat, reveal to discard. The engine files
// it in the same batch (fake/triggers.ts:123,139), so a card left standing at
// the centre would contradict a projection that has already put it in the heap.
// It never touches a hand or a zone, so it leaves from where it stands: the
// flyer stays pinned at the centre (I4) and the shared exit step takes it from
// there.

const BEFORE_FLIP = 220 // the card rests at the centre before it turns over
const AFTER_FLIP = 560 // flipCard is 420; the rest is a pause to read it by
const SEAT_SHRINK = 0.7 // an opponent's card lands smaller, dissolving into the count

// An opponent's closed card. The projection never says what it is, so nothing
// here may guess: this carries no face, only the base deck's cover, and it is
// always flown faceDown. Card reads `deck` for the back and nothing else.
const COVER: CardData = {
  id: 'unknown',
  name: '',
  category: 'protection',
  deck: 'base',
  art: '',
  tags: [],
  qty: 0,
}

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export function useDrawBeat(anchors: BoardAnchors) {
  const { overlay: flyerOverlay, patch, drop, elOf, toSlot } = useToCentre()
  const exit = useDiscardExit(anchors.discardBox)

  // The run's own state, held in a ref because the whole beat is one closure and
  // the fan grows inside it (I8). Reading the board's props here instead would
  // give every card after the first the fan the batch STARTED with.
  const ctx = useRef<BeatRun | null>(null)

  const {
    overlay: handOverlay,
    gapAt,
    gapSize,
    arrive,
    reset: resetArrival,
  } = useHandArrival(anchors.hand, (gap, landed) => {
    const c = ctx.current
    if (!c) return
    const hand = [...c.base.you.hand]
    hand.splice(gap, 0, ...landed.map((it) => ({ uid: it.key, card: it.card })))
    // The published state becomes the base the NEXT card aims at — the board
    // really has that many cards in the fan now, and the last frame of this beat
    // has to equal the projection it hands over to.
    const next = { ...c.base, you: { ...c.base.you, hand } }
    c.base = next
    c.publish(next)
  })

  const latest = useRef({ anchors, arrive, exit })
  latest.current = { anchors, arrive, exit }

  // deck -> centre, face down. The one leg every draw has, whoever drew it.
  const toCentre = useCallback(
    (d: PlannedDraw): Promise<Rect | null> => {
      const a = latest.current.anchors
      const cell = rectOf(a.pileBox(d.pile))
      const centre = rectOf(a.centre.current)
      if (!cell || !centre) return Promise.resolve(null)
      const face = d.card ?? d.reveal?.card
      const card = (face ? cardById(face) : null) ?? COVER
      return toSlot({ key: 'draw', card, from: cardAreaOf(cell), to: centre })
    },
    [toSlot],
  )

  const run = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'draw' }>, beat: BeatRun) => {
      ctx.current = beat
      for (const d of plan.draws) {
        const centre = await toCentre(d)
        if (!centre) continue

        if (d.reveal) {
          // A trigger is turned up for the whole table and stands there.
          await wait(BEFORE_FLIP)
          patch('draw', { faceDown: false })
          await wait(AFTER_FLIP)
          await wait(TABLE_HOLD)
          const card = cardById(d.reveal.card)
          if (card && d.reveal.discardId !== undefined) {
            // It leaves from the centre on the same scatter the heap already
            // rests it on (I7) — the flyer IS the card, so the step flies the
            // node rather than mounting a copy of it.
            await latest.current.exit.send([
              {
                key: `d${d.reveal.discardId}`,
                card,
                node: elOf('draw'),
                scatter: scatterAt(d.reveal.discardId),
              },
            ])
            drop('draw')
            continue
          }
          // IT STANDS. An unanswered Error 503 is held on its pending until a
          // method is chosen, so there is nothing to fly — the board's static
          // alarm render takes the slot instead. Publish first, drop second:
          // the board renders this beat's shadow while it runs
          // (_Board.tsx's `deal.shadow ?? beats.shadow ?? live`), so the
          // render is up before the carrier lets go and the slot is never
          // blank for a frame — the same handoff ordering the cover slot uses.
          //
          // `methods: []` because the beat CANNOT know them: they live on the
          // projection, and this runs against `base`. Empty is the honest
          // value and a safe one — it offers no answer, so the staging hook
          // stays inert, and the queue drains onto the live pending on the
          // next tick (a raised pending ends the batch; fireTrigger returns
          // there). A shadow of the projection for a frame, not a claim about
          // the game.
          const c = ctx.current
          if (c) {
            const next = {
              ...c.base,
              pending: {
                kind: 'neutralize503' as const,
                player: d.player,
                card: d.reveal.card,
                methods: [],
              },
            }
            c.base = next
            c.publish(next)
          }
          await nextFrames() // the publish above has committed (I2)
          drop('draw')
          continue
        }

        if (d.mine && d.card) {
          await wait(BEFORE_FLIP)
          patch('draw', { faceDown: false })
          await wait(AFTER_FLIP)
          const card = cardById(d.card)
          const at = rectOf(elOf('draw'))
          drop('draw')
          // How many cards the fan holds RIGHT NOW — `ctx.current.base`, not the
          // projection the batch started with, so every card after the first
          // aims at the fan the one before it grew (I8).
          const grown = ctx.current?.base.you.hand.length ?? 0
          // …and it lands at the END of that fan, not in its middle. The step
          // defaults to the middle because a drawn card has no place of its own
          // in a scene that owns its hand array — but on the board the
          // projection owns it, and the engine APPENDS what it drew
          // (fake/reduce.ts:126), an order `toBoardState` passes through
          // untouched. Landing anywhere else makes the last frame of this beat
          // disagree with the projection it hands over to, and the card visibly
          // jumps from the middle of the fan to its end on the handover.
          if (card && at)
            await latest.current.arrive([{ key: `h${d.eventId}`, card, from: at }], grown, grown)
          continue
        }

        // Somebody else's, and closed. It flies to their seat as a back and
        // dissolves into the counter — a closed card has no identity in the
        // projection, so it never turns over.
        const seat = latest.current.anchors.seatBox(d.player)
        const el = elOf('draw')
        if (el && seat) {
          // `seatBox` already trims the seat to a card box (I6); this is a
          // second, smaller trim — down to `SEAT_SHRINK` of a card width — not
          // a duplicate of the first.
          const to = cardBoxIn(seat, CARD_W * SEAT_SHRINK)
          const anim = play('dealToSeat', el, { from: centre, to })
          if (anim) await anim.finished
        }
        drop('draw')
        const c = ctx.current
        if (c) {
          const next: BoardState = {
            ...c.base,
            opponents: c.base.opponents.map((o) =>
              o.id === d.player ? { ...o, handCount: o.handCount + 1 } : o,
            ),
          }
          c.base = next
          c.publish(next)
        }
      }
      ctx.current = null
    },
    [toCentre, patch, drop, elOf],
  )

  // A new match cancels what is in the air: every carrier this beat can leave
  // mid-flight, dropped. `drop()` with no key takes down every flyer this run
  // raised (the centre card, a closed card on its way to a seat); the arrival
  // and the exit are the SAME shared steps `discardBeat` resets for the same
  // reason, reached through here because a draw can end in either of them (a
  // trigger leaves through `exit`, a card of the drawer's own through
  // `arrive`).
  const reset = useCallback(() => {
    drop()
    resetArrival()
    exit.reset()
  }, [drop, resetArrival, exit])

  return { overlay: [...flyerOverlay, ...handOverlay, ...exit.overlay], gapAt, gapSize, run, reset }
}
