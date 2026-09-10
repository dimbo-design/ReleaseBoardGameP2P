import { cardAreaOf, cardBoxIn, cardById } from '@release/ui'
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
import type { BeatRun, BoardAnchors } from '~/entities/game/board'
import type { BeatPlan } from './planBeats'
import { HALLUCINATION_HOLD, TABLE_HOLD, useToCentre } from './toCentre'

// AN AI CARD, from the pile to whatever it turns out to mean.
//
// One scene with six endings, and it is one runner because the opening is one
// opening: a trigger comes off a draw pile and stands at the left as the CAUSE,
// the events deck gives up the card that explains it, and both are held long
// enough to be read. Only then do the endings differ.
//
// What must not be re-derived here is the ending. The plan read it off the
// events the engine actually emitted; a runner that looked at `eventCard` and
// decided for itself what an `ai-crush-frontend` does would be a second opinion
// about the rules, free to drift from the first.

const FLIP_MS = 420 // `flipCard`'s own duration
const BEFORE_FLIP = 220 // the card rests where it landed before it turns over
const AFTER_FLIP = 560 // the flip, plus a pause to read it by
// `AiCardsStory`'s own `insideGrab` — how long a card taken from the discard
// stands open at the centre before it leaves. Exported for its own test.
export const SHOW_HOLD = 1500

// One key is one flyer: raising a key that is still up replaces the carrier
// rather than hanging a second node on the same name.
const TRIG = 'trig'
const EFF = 'eff'
const CRUSHED = 'crushed' // the release a crush destroys — its own carrier, its own road
// …and the Code Review tucked under it. `destroySlot`'s spoils are both cards
// (fake/triggers.ts:87), and their roads fork — the release may be an
// events-deck card and go home, the Code Review never is — so each gets its
// own carrier rather than travelling as one pair.
const CRUSHED_AUX = 'crushedAux'

const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export function useAiBeat(anchors: BoardAnchors) {
  const { overlay: flyerOverlay, patch, drop, elOf, raise, toSlot } = useToCentre()
  const exit = useDiscardExit(anchors.discardBox)
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
    const next = { ...c.base, you: { ...c.base.you, hand } }
    c.base = next
    c.publish(next)
  })

  const latest = useRef({ anchors, exit, arrive })
  latest.current = { anchors, exit, arrive }

  // A card leaves the table for the events deck. It turns face down first — the
  // way every card entering play turns face up first — and then shrinks back
  // into the pile it came from.
  const goHome = useCallback(
    async (key: string, from: Rect | null) => {
      patch(key, { faceDown: true })
      await wait(FLIP_MS)
      const el = elOf(key)
      const deck = rectOf(latest.current.anchors.eventsBox.current)
      if (!el || !from || !deck) return
      const anim = play('returnToDeck', el, { from, to: cardAreaOf(deck) })
      if (anim) await anim.finished
    },
    [patch, elOf],
  )

  const run = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'aiEvent' }>, beat: BeatRun) => {
      ctx.current = beat
      const a = latest.current.anchors
      const trigger = cardById(plan.trigger)
      const event = cardById(plan.eventCard)
      const pile = rectOf(a.pileBox(plan.pile))
      const cause = rectOf(a.cause.current)
      const effect = rectOf(a.effect.current)
      const events = rectOf(a.eventsBox.current)
      if (!trigger || !event || !pile || !cause || !effect || !events) return

      // 1. the trigger comes off the pile and stands as the cause
      await toSlot({ key: TRIG, card: trigger, from: cardAreaOf(pile), to: cause })
      await wait(BEFORE_FLIP)
      patch(TRIG, { faceDown: false })
      await wait(AFTER_FLIP)

      // 2. the events deck gives up the card that explains it
      await toSlot({ key: EFF, card: event, from: cardAreaOf(events), to: effect })
      await wait(BEFORE_FLIP)
      patch(EFF, { faceDown: false })
      await wait(AFTER_FLIP)

      // 3. the table reads them. Hallucination lingers twice as long — the
      //    scene's own doubling, not a judgement made here. This is the ONE
      //    place this runner reads the card's id, and it is not the exception
      //    to "don't re-derive the ending" — it never decides what the effect
      //    DOES, only how long the READING lasts, and `plan.tail` still
      //    exclusively governs the former. `AiCardsStory` (the approved scene)
      //    reads `eventCard` twice for two different questions — once for this
      //    hold, once for its own turn-interrupt flag — because presentation
      //    and mechanic are separate questions there too. If a second AI card
      //    ever needs its own hold, the right fix is a `hold` field on the
      //    plan, not a second id check here.
      await wait(plan.eventCard === 'ai-hallucination' ? HALLUCINATION_HOLD : TABLE_HOLD)

      // The destroyed release becomes a flyer exactly where it stands, and the
      // zone lets go of it in the same commit — a card cannot be in a slot and
      // in the air at once.
      let crushedFrom: Rect | null = null
      let auxFrom: Rect | null = null
      if (plan.tail.kind === 'crush') {
        const card = cardById(plan.tail.card)
        const aux = plan.tail.codeReview ? cardById(plan.tail.codeReview) : null
        const slotEl = a.releaseSlot(plan.player, plan.tail.slot)
        crushedFrom = rectOf(slotEl)
        // The Code Review is tucked under the release, so the zone renders the
        // slot as a `CardPair` and the aux half has its own tilted node. I6 —
        // a tilted node's bounding rect is the box AROUND it, so trim it back
        // to a card box, exactly as `defenseBeat`'s sacrifice leg measures the
        // same pair.
        const auxEl = aux ? (slotEl?.querySelector<HTMLElement>('[data-aux]') ?? null) : null
        auxFrom =
          auxEl && crushedFrom ? cardBoxIn(auxEl.getBoundingClientRect(), crushedFrom.width) : null
        const going = [
          ...(card && crushedFrom ? [{ key: CRUSHED, card, at: crushedFrom }] : []),
          ...(aux && (auxFrom ?? crushedFrom)
            ? [{ key: CRUSHED_AUX, card: aux, at: (auxFrom ?? crushedFrom) as Rect }]
            : []),
        ]
        if (going.length > 0) await raise(going)
      }

      // 4. the trigger goes to the heap, on the scatter its own event id
      //    produces — one value, two readers (I7), so the heap rests it exactly
      //    where the flight put it.
      const triggerOut =
        plan.triggerDiscardId >= 0
          ? latest.current.exit
              .send([
                {
                  key: `d${plan.triggerDiscardId}`,
                  card: trigger,
                  node: elOf(TRIG),
                  scatter: scatterAt(plan.triggerDiscardId),
                },
              ])
              .then(() => drop(TRIG))
          : Promise.resolve()

      // 5. …and the AI card takes the road its ending gives it.
      const effectOut = (async () => {
        if (plan.tail.kind === 'zone') {
          const slot = rectOf(a.releaseSlot(plan.player, plan.tail.slot))
          const el = elOf(EFF)
          if (el && slot) {
            const anim = play('playToReleaseZone', el, { from: effect, to: slot })
            if (anim) await anim.finished
          }
          // It STAYS. No return home: the batch said `released`/`placed`, which
          // is what standing on the table looks like from outside the engine.
          drop(EFF)
          return
        }
        // IT STANDS. A prompt is owed and this card is what explains it, so the
        // carrier is simply dropped where it landed and the projection's own
        // render takes the slot (`_Board.tsx`'s `aiStanding`, off
        // `pending.source`). Its journey home belongs to the batch that answers
        // the prompt, not to this one.
        //
        // The trigger does NOT get the same treatment, and the difference is
        // not a preference: the engine banks it in this very batch, so holding
        // it would contradict a projection that already has it in the heap. The
        // AI card can stand because `decks.events` is projected as a count —
        // one fewer, and nothing on screen disagrees.
        if (plan.tail.kind === 'standing') {
          // One frame boundary before the carrier lets go. NOT "the
          // projection's render comes up first" — it cannot: the shadow is
          // still `before`, which has no pending, and `aiStanding` only
          // appears once the queue drains to `live`. What the await actually
          // buys is that the drop lands on a later commit than the flight's
          // own last frame, so the carrier is never removed inside the same
          // commit that painted it at its landing spot (I2). The ordering is
          // pinned by `aiBeat.test.tsx`'s own call-order assertion.
          await nextFrames()
          drop(EFF)
          return
        }
        await goHome(EFF, effect)
        drop(EFF)
      })()

      // …and the destroyed release takes the road the plan already worked out,
      // with the Code Review that was tucked under it going its own way.
      //
      // NEITHER CARD HAS A `discarded` EVENT TO FLY ON. `destroySlot` called
      // without a reason (fake/triggers.ts:88-92 — the automatic destruction)
      // emits `releaseDestroyed` and nothing else, so `toDiscardHeap`, which
      // folds one heap card per `discarded`, holds no entry keyed to either.
      //
      // The heap does still rest ONE of them: its `top<count>` stand-in for
      // the discard's top. `plan.tail.rest` is that pose, read at plan time
      // through the shared `standInScatter` off the projection that will
      // render the heap — so the flight and the rest are one value (I7) and
      // the card does not jump on its last frame. It is present only when this
      // release really is what the top will be; a release buried under its own
      // Code Review has nothing, and neither has the Code Review itself. Those
      // two are recorded in `docs/animations/backlog.md` rather than papered
      // over with an invented pose — an omitted scatter takes a fresh
      // `jitter()`, which is at least honestly arbitrary. What is gone for
      // good is the previous `scatterAt(plan.eventId)`: a place keyed to the
      // DRAW's own event id, under which nothing rests at all.
      const crushedOut = (async () => {
        if (plan.tail.kind !== 'crush' || !crushedFrom) return
        const card = cardById(plan.tail.card)
        const aux = plan.tail.codeReview ? cardById(plan.tail.codeReview) : null
        // The Code Review is never an events-deck card, so it always takes the
        // ordinary road even when the release it protected does not — the same
        // split, for the same reason, `defenseBeat`'s sacrifice leg makes.
        const auxOut = aux
          ? latest.current.exit
              .send([{ key: CRUSHED_AUX, card: aux, node: elOf(CRUSHED_AUX) }])
              .then(() => drop(CRUSHED_AUX))
          : Promise.resolve()
        const mainOut = (async () => {
          if (!card) return
          // Its road is the plan's answer, not one worked out here: the fact
          // lives on the pre-batch projection (`releaseEvent`), which the
          // runner cannot see and the plan already read (#71 — the class of
          // bug this closes).
          if (plan.tail.kind === 'crush' && plan.tail.destination === 'events') {
            await goHome(CRUSHED, crushedFrom)
            drop(CRUSHED)
            return
          }
          await latest.current.exit.send([
            {
              key: CRUSHED,
              card,
              node: elOf(CRUSHED),
              ...(plan.tail.kind === 'crush' && plan.tail.rest ? { scatter: plan.tail.rest } : {}),
            },
          ])
          drop(CRUSHED)
        })()
        await Promise.all([mainOut, auxOut])
      })()

      await Promise.all([triggerOut, effectOut, crushedOut])
    },
    [toSlot, patch, drop, elOf, raise, goHome],
  )

  // A RELEASE COMES BACK OUT OF THE DISCARD — `ai-inside`'s own answer,
  // resolved. One path, two audiences: it is shown open at the centre for
  // the whole table (`takenFromDiscard` carries no `visibleTo` — it is
  // public), and only THEN does it split by who it belongs to.
  const runTaken = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'takenFromDiscard' }>, beat: BeatRun) => {
      ctx.current = beat
      const a = latest.current.anchors
      const card = cardById(plan.card)
      const heap = rectOf(a.discardBox.current)
      // `anchors.centre`, NOT `effect`: the `effect` place belongs to the AI
      // card that demanded this pick, and while `pickFromDiscard` is still
      // open that card is standing in it (`_Board.tsx`'s `aiStanding`) — two
      // cards in one rect for the whole of `SHOW_HOLD`. `centre.ts` names the
      // `centre` place for exactly this: what is happening NOW — something the
      // system has put at the centre for the table to read, which is what a
      // release coming back out of the discard is.
      const centre = rectOf(a.centre.current)
      if (!card || !heap || !centre) return
      // out of the heap and up to the centre, face up — `AiCardsStory`'s own
      // `insideGrab`, held for the same `SHOW_HOLD`
      await toSlot({ key: EFF, card, from: cardAreaOf(heap), to: centre, faceDown: false })
      await wait(SHOW_HOLD)
      const from = rectOf(elOf(EFF))
      if (plan.mine && from) {
        drop(EFF)
        await latest.current.arrive(
          [{ key: `ins${plan.eventId}`, card, from }],
          beat.base.you.hand.length,
        )
      } else {
        const seat = a.seatBox(plan.player)
        const el = elOf(EFF)
        if (el && seat) {
          const anim = play('dealToSeat', el, { from: centre, to: seat, scale: 0.7 })
          if (anim) await anim.finished
        }
        drop(EFF)
        // The recipient is one card heavier the moment the flight lands on
        // them — `transferBeat.tsx`'s own `bumpRecipient`, the same fact for
        // the same reason: the engine's own snapshot already counts it, and
        // without this the handover to `live` pops their fan by one the
        // instant the queue drains.
        const c = ctx.current
        if (c) {
          const next = {
            ...c.base,
            opponents: c.base.opponents.map((o) =>
              o.id === plan.player ? { ...o, handCount: o.handCount + 1 } : o,
            ),
          }
          c.base = next
          c.publish(next)
        }
      }
      // Inside's own card goes home now that its prompt is answered — its
      // own road, not this exchange's (#106). It has been standing on the
      // projection's own render (`_Board.tsx`'s `aiStanding`, off
      // `pending.source`) since the batch that revealed it — that beat could
      // not fly it home, because it still had to stand and explain the
      // prompt this one answers.
      //
      // Written out here rather than shared with `handLimitBeat.tsx`'s or
      // `defenseBeat.tsx`'s own `sendHomeward`: each runner owns its own
      // carrier, and a carrier passed between hooks is how this codebase has
      // already grown two latch bugs of that family (`useBeats.ts`'s own
      // comments).
      if (plan.homeward) {
        // The pending goes first, in its own publish — `defenseBeat`'s own
        // ordering (`runNeutralized`), and the same reason: the shadow still
        // carries the prompt, so `_Board.tsx`'s `aiStanding` is still
        // rendering this very card at `effect` while the carrier below is
        // about to fly away from that same rect.
        const c = ctx.current
        if (c) {
          const next = { ...c.base, pending: null }
          c.base = next
          c.publish(next)
        }
        const ai = cardById(plan.homeward)
        const home = rectOf(a.effect.current)
        const deck = rectOf(a.eventsBox.current)
        if (ai && home && deck) {
          // a no-travel raise at the card's own standing spot — the honest
          // answer to "it is here already"
          const [el] = await raise([{ key: 'homeward', at: home, card: ai }])
          if (el) {
            patch('homeward', { faceDown: true })
            await wait(FLIP_MS)
            const anim = play('returnToDeck', el, { from: home, to: cardAreaOf(deck) })
            if (anim) await anim.finished
            drop('homeward')
          }
        }
      }
    },
    [toSlot, elOf, drop, raise, patch],
  )

  const reset = useCallback(() => {
    drop()
    resetArrival()
    ctx.current = null
  }, [drop, resetArrival])

  return {
    overlay: [...flyerOverlay, ...handOverlay, ...exit.overlay],
    gapAt,
    gapSize,
    run,
    runTaken,
    reset,
  }
}
