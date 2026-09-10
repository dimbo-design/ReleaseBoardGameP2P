import { useTranslation } from '@release/translation'
import type { CardData } from '@release/ui'
import { CARD_W, cardBoxIn, cardById } from '@release/ui'
import type { Rect } from '@release/ui/animations'
import { nextFrames, play, useFlyer, useHandArrival, wait } from '@release/ui/animations'
import { useCallback, useRef, useState } from 'react'
import type { BeatRun, BoardAnchors, BoardState } from '~/entities/game/board'
import type { BeatPlan } from './planBeats'
import styles from './transferBeat.module.css'

// A card changes hands. One surface seen from three sides — you take a card,
// you lose one, or you watch one cross the table — and they are one runner
// because the flight is one flight: a seat, the centre, a destination. What
// differs is which end is a hand and which is a seat, and whether the card has
// an identity this peer is entitled to at all.
//
// THE BRANCH THAT MATTERS is not `role`, it is `plan.card`. Present means this
// peer is a party to the transfer (the engine sets `visibleTo: [from, to]`);
// absent means it is not, and the flight closes. Nothing here re-derives who
// may see what — that answer arrived with the event, and re-deriving it is how
// a hand leaks.

const REVEAL_HOLD = 820 // face-up at the centre before it drops into the fan
const CENTER_HOLD = 820 // face-down at the centre before it sinks into the seat
const SEAT_SHRINK = 0.7 // how small a card is inside a seat — `drawBeat`'s own value
const REQUEST_HOLD = 820 // the named card stands at the centre before the outcome
const MISS_HOLD = 1620 // the flinch and the note, before the scene clears
// A whole seat (or a whole fan) flinching, not the 7px `settle` sized for an
// input field — the story's own values.
const SHAKE = { amp: 9, dur: 460, shape: 'spring' } as const

// One flyer key for the whole run: there is never more than one card in the
// air here, and a key IS a flyer — raising the same key twice replaces the
// carrier instead of hanging a second node on the same name.
const KEY = 'transfer'

const OFFER_STEP = 45 // between neighbouring backs, as they fan out
const OFFER_HOLD = 620 // the hand stands offered before the card turns over
const OFFER_SPREAD = 0.62 // how far across the centre the fan opens, as a share of its width
const OFFER_MAX = 9 // backs actually rendered; a bigger hand is not a bigger question

// A card nobody at this seat is entitled to know. The projection never says
// what it is, so nothing here may guess: this carries no face, only the base
// deck's cover, and it is always flown faceDown. `Card` reads `deck` for the
// back and nothing else.
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

// Where the offered backs sit: a shallow arc across the centre, evenly spaced,
// each the size a card is at the table. Not a grid — a hand held out. The
// count is capped because past a point more backs stop reading as "a hand" and
// start reading as "a deck", and the suspense is the same either way.
function offerPoses(count: number, centre: Rect): Rect[] {
  const n = Math.max(1, Math.min(OFFER_MAX, count))
  const span = n === 1 ? 0 : centre.width * OFFER_SPREAD
  const step = n === 1 ? 0 : span / (n - 1)
  const first = centre.left + centre.width / 2 - span / 2 - centre.width / 2
  return Array.from({ length: n }, (_, i) => ({
    left: first + step * i,
    top: centre.top,
    width: centre.width,
    height: centre.height,
  }))
}

export function useTransferBeat(anchors: BoardAnchors) {
  const { overlay: flyerOverlay, raise, pin, patch, drop, elOf } = useFlyer()

  // The run's own context, held in a ref because the whole beat is one closure
  // and the hand it lands in is the one THIS run has grown, not the one the
  // batch started with.
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

  const latest = useRef({ anchors, arrive })
  latest.current = { anchors, arrive }

  // The donor is one card lighter the moment it leaves them. Published as its
  // own step rather than folded into the landing, because the two ends of a
  // transfer are two different players and the flight is long enough to see
  // both — and because a watcher's flight has this end and no other.
  const dropFromDonor = useCallback((player: string) => {
    const c = ctx.current
    if (!c) return
    const next: BoardState = {
      ...c.base,
      opponents: c.base.opponents.map((o) =>
        o.id === player ? { ...o, handCount: Math.max(0, o.handCount - 1) } : o,
      ),
    }
    c.base = next
    c.publish(next)
  }, [])

  // The recipient is one card heavier the moment the flight lands on them.
  // Symmetric with `dropFromDonor` above, and its own step for the same
  // reason — used from the two legs where the recipient IS an opponent's seat
  // rather than `you.hand` (the taker's own arrival goes through
  // `useHandArrival` instead, which publishes its own landing).
  const bumpRecipient = useCallback((player: string) => {
    const c = ctx.current
    if (!c) return
    const next: BoardState = {
      ...c.base,
      opponents: c.base.opponents.map((o) =>
        o.id === player ? { ...o, handCount: o.handCount + 1 } : o,
      ),
    }
    c.base = next
    c.publish(next)
  }, [])

  // The pre-batch pending stops here, the moment a leg's own carrier takes
  // the card over. Same idiom as `defenseBeat`'s TAKEOFF publish: the beat
  // publishes the state it is animating TOWARD, so `_Board.tsx`'s static
  // `giveCard` render (and `_useRequestStaging`'s `requestCard` band) has
  // nothing left to key on once this fires — instead of standing the same
  // card at the centre underneath this exact flyer for the rest of the leg.
  const clearPending = useCallback(() => {
    const c = ctx.current
    if (!c) return
    const next: BoardState = { ...c.base, pending: null }
    c.base = next
    c.publish(next)
  }, [])

  const { t } = useTranslation()
  // The miss note. State rather than a ref: it is rendered, and the overlay has
  // to re-render when it appears and again when it goes.
  const [missed, setMissed] = useState(false)

  const runRequested = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'requested' }>, beat: BeatRun) => {
      ctx.current = beat
      try {
        const a = latest.current.anchors
        const centre = rectOf(a.centre.current)
        const card = cardById(plan.card)
        if (!centre || !card) return
        // The named card, face-up, at the centre — for EVERY peer, asker
        // included. `requested` carries no `visibleTo`: the rules make the
        // request public on a hit and a miss alike (docs/rules/cards.md:125).
        const [el] = await raise([{ key: KEY, card, at: centre, faceDown: false }])
        if (el) {
          // It APPEARS rather than travels. The one candidate origin — the
          // catalog cell the asker named it in — belongs to a hook this beat
          // cannot see (Task 8) and cannot measure, so no peer gets a flight:
          // every board, asker included, gets the same pop into the reserved
          // centre slot.
          const anim = play('popIn', el)
          if (anim) await anim.finished
        }

        if (plan.hit) {
          // Hand it to the projection. `giveCard` is public (fake/attacks.ts:444
          // projects it with no `mine` gate), so the board's own centre render
          // takes this exact spot — and it has to, because the transfer arrives
          // in a LATER batch and no overlay of this beat's can span the gap.
          //
          // Publish first, drop second: the board renders this beat's shadow
          // while it runs, so the static render is up before the carrier lets
          // go and the slot is never blank for a frame. Same ordering, and the
          // same reason, as the standing trigger in `drawBeat`.
          const c = ctx.current
          if (c) {
            const next: BoardState = {
              ...c.base,
              pending: {
                kind: 'giveCard' as const,
                player: plan.target,
                requested: plan.card,
              },
            }
            c.base = next
            c.publish(next)
          }
          await nextFrames() // the publish above has committed (I2)
          drop(KEY)
          return
        }

        // A MISS. The pending clears outright, so nothing in the projection
        // survives this — the beat carries the whole scene or the table never
        // learns the outcome, which is the rule this exists to keep.
        //
        // Cleared HERE, not at the end: the flyer above is already up and
        // holding the card at the centre, so this is the moment it takes over
        // from the asker's own `CardCatalog` band (`_useRequestStaging`,
        // still armed on `requestCard`). Left standing, that band would stay
        // mounted showing the same card underneath this flyer for the whole
        // hold, shake and note, then vanish with no animation when the queue
        // drains.
        clearPending()
        await wait(REQUEST_HOLD)
        // Rendered as the target actually appears: a Seat to everyone watching,
        // and to the target themselves no seat at all — they are `you`, and
        // what they own is the fan. One gesture, two renderings.
        const mine = plan.target === beat.base.selfId
        const flinch = mine ? a.hand.current : a.seatOf(plan.target)
        play('shake', flinch, SHAKE)
        setMissed(true)
        await wait(MISS_HOLD)
        setMissed(false)
        drop(KEY)
      } finally {
        ctx.current = null
      }
    },
    [raise, drop, clearPending],
  )

  const runTransfer = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'handTransfer' }>, beat: BeatRun) => {
      ctx.current = beat
      try {
        if (plan.role === 'taker') {
          const a = latest.current.anchors
          const seat = a.seatBox(plan.from)
          const centre = rectOf(a.centre.current)
          const card = plan.card ? cardById(plan.card) : null
          // A taker always knows what they took — but a missing rect or an
          // unknown id ends the leg and lets the projection stand, which is the
          // contract every runner keeps.
          if (!seat || !centre || !card) return
          // out of the seat's own card box (I6), at the size a card is while it
          // is inside a hidden hand — the exact box `dealToSeat` sinks into
          const from = cardBoxIn(seat, CARD_W * SEAT_SHRINK)
          // A random steal offers the donor's hand first: the suspense is real,
          // because the card genuinely is random. A named one has no question
          // left in it — the table watched the asker choose.
          if (!plan.named && plan.donorHand > 0) {
            const poses = offerPoses(plan.donorHand, centre)
            const backs = poses.map((_, i) => ({
              key: `offer${i}`,
              card: COVER,
              at: from,
              faceDown: true,
            }))
            const els = await raise(backs)
            await Promise.all(
              els.map(async (b, i) => {
                if (!b) return
                await wait(i * OFFER_STEP)
                const anim = play('takeFromSeat', b, { from, to: poses[i] })
                if (anim) await anim.finished
              }),
            )
            await wait(OFFER_HOLD)
            // …and back they go. The one that was taken is not among them: it
            // flies on its own below, out of the same seat, so the offer is
            // cleared whole rather than one card short.
            await Promise.all(
              els.map(async (b, i) => {
                if (!b) return
                const anim = play('dealToSeat', b, { from: poses[i], to: from })
                if (anim) await anim.finished
              }),
            )
            for (let i = 0; i < backs.length; i++) drop(`offer${i}`)
          }
          const [el] = await raise([{ key: KEY, card, at: from, faceDown: true }])
          // TAKEOFF: our own flyer now holds the card (still at the seat, not
          // yet at the centre — but the pending is not standing in for a
          // position, it is standing in for OWNERSHIP of this card's render,
          // and that just changed hands). Clearing any earlier would race the
          // raise above and blank nothing in exchange; any later leaves
          // `_Board.tsx`'s static `giveCard` render doubling this same card
          // at the centre while the flyer is still crossing to it.
          clearPending()
          if (el) {
            const anim = play('takeFromSeat', el, { from, to: centre })
            if (anim) await anim.finished
            pin(KEY, centre) // I4 — it IS at the centre now
          }
          dropFromDonor(plan.from)
          patch(KEY, { faceDown: false }) // Card plays its own flipCard
          await wait(REVEAL_HOLD)
          const at = rectOf(elOf(KEY))
          drop(KEY)
          // The fan as it stands RIGHT NOW, and the card lands at its END —
          // the engine appends what a hand gains and `toBoardState` passes that
          // order through untouched, so any other slot makes this beat's last
          // frame disagree with the projection it hands over to.
          const grown = ctx.current?.base.you.hand.length ?? 0
          if (at)
            await latest.current.arrive([{ key: `t${plan.eventId}`, card, from: at }], grown, grown)
          return
        }
        if (plan.role === 'victim') {
          const a = latest.current.anchors
          const centre = rectOf(a.centre.current)
          const seat = a.seatBox(plan.to)
          const card = plan.card ? cardById(plan.card) : null
          if (!centre || !seat || !card) return
          // Which slot it leaves from. The registry indexes rather than looks
          // up by uid — deliberately, so it need not know the hand — and the
          // caller already holds the hand it planned against, so the index is
          // resolved here. Matching on the card ID is what the engine itself
          // matched on (`onGiveCard` checks `card.id === pending.requested`);
          // copies are interchangeable, so the first is as right as any.
          const index = beat.base.you.hand.findIndex((h) => h.card.id === plan.card)
          const slot = index >= 0 ? rectOf(a.handSlotAt(index)) : null
          if (!slot) return
          const [el] = await raise([{ key: KEY, card, at: slot, faceDown: false }])
          // your fan closes the gap while the card is in the air, and the
          // `giveCard` pending clears in the same publish: our own flyer now
          // holds the card, so `_Board.tsx`'s static centre render has
          // nothing left to earn its keep with (same TAKEOFF moment the taker
          // leg marks separately, folded here into a publish this leg already
          // makes).
          const c0 = ctx.current
          if (c0) {
            const hand = c0.base.you.hand.filter((_, i) => i !== index)
            const next = { ...c0.base, pending: null, you: { ...c0.base.you, hand } }
            c0.base = next
            c0.publish(next)
          }
          if (el) {
            const anim = play('playToCenter', el, { from: slot, to: centre })
            if (anim) await anim.finished
            pin(KEY, centre)
          }
          // It turns FACE-DOWN, and that is the beat: from here it is theirs,
          // and a hidden hand is where it is going.
          patch(KEY, { faceDown: true })
          await wait(CENTER_HOLD)
          const to = cardBoxIn(seat, CARD_W * SEAT_SHRINK)
          const held = elOf(KEY)
          if (held) {
            const anim = play('dealToSeat', held, { from: centre, to })
            if (anim) await anim.finished
          }
          drop(KEY)
          // …and the taker's counter carries it now. That counter IS their hand.
          bumpRecipient(plan.to)
          return
        }
        // A watcher. `plan.card` is absent — not "unknown to us", absent from
        // the event — so there is nothing to turn over and nothing to hold at
        // the centre to be read. It crosses closed, and the two counts are the
        // only thing that actually changes. This leg is currently unreachable in
        // production: the engine tags every `handTransfer` event with
        // `visibleTo: [from, to]`, and non-parties never receive the event. The
        // leg ships because it expresses the "never widen a redacted event"
        // property, and it will stay passing after `handTransfer` becomes public
        // with `card` redacted the way `drawn` already is.
        const a = latest.current.anchors
        const fromSeat = a.seatBox(plan.from)
        const toSeat = a.seatBox(plan.to)
        const centre = rectOf(a.centre.current)
        if (!fromSeat || !toSeat || !centre) return
        const from = cardBoxIn(fromSeat, CARD_W * SEAT_SHRINK)
        const to = cardBoxIn(toSeat, CARD_W * SEAT_SHRINK)
        const [el] = await raise([{ key: KEY, card: COVER, at: from, faceDown: true }])
        // TAKEOFF, watcher leg: the `giveCard` pending is public even to a
        // watcher (`pendingView`'s `requested` carries no `mine` gate — the
        // request was named aloud), so a watcher's board is standing the same
        // static centre render as everyone else's until this fires. Our own
        // cover flyer above now carries the crossing, so it stops here.
        clearPending()
        if (el) {
          const out = play('takeFromSeat', el, { from, to: centre })
          if (out) await out.finished
          pin(KEY, centre)
          dropFromDonor(plan.from)
          const home = play('dealToSeat', el, { from: centre, to })
          if (home) await home.finished
        }
        drop(KEY)
        bumpRecipient(plan.to)
      } finally {
        ctx.current = null
      }
    },
    [raise, pin, patch, drop, elOf, dropFromDonor, bumpRecipient, clearPending],
  )

  // A new match cancels what is in the air: the carrier this run may have left
  // mid-flight, and the parked arrival that would otherwise land a dead match's
  // card in the new one's fan.
  const reset = useCallback(() => {
    drop()
    resetArrival()
    setMissed(false)
  }, [drop, resetArrival])

  return {
    overlay: [
      ...flyerOverlay,
      ...handOverlay,
      ...(missed
        ? [
            <div key="transfer-miss" className={styles.note}>
              {t('table.requestMiss')}
            </div>,
          ]
        : []),
    ],
    gapAt,
    gapSize,
    runRequested,
    runTransfer,
    reset,
  }
}
