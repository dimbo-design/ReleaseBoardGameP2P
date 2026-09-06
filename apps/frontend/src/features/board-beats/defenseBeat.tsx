import type { CardData } from '@release/ui'
import { Card, CardPair, cardAreaOf, cardBoxIn, cardById, PAIR_AUX } from '@release/ui'
import type { Leaving, Rect } from '@release/ui/animations'
import {
  nextFrames,
  play,
  scatterAt,
  useDiscardExit,
  useFlyer,
  useHandArrival,
  wait,
} from '@release/ui/animations'
import type { RefObject } from 'react'
import { useCallback, useRef } from 'react'
import type { BeatRun, BoardAnchors, StagedHandoff } from '~/entities/game/board'
import { ATTACK_POSE, COVER_POSE, SHOW_HOLD } from '~/entities/game/board'
import type { BeatPlan } from './planBeats'

// The answer to an attack (#101): a defence covers what is standing at the
// centre, and the whole exchange leaves together. `_useDefenseStaging.ts` is
// the OTHER half — the gesture that stands the local player's own answer there
// before the engine has spoken; the two meet at `StagedHandoff`, exactly as
// the combo pair's two halves do.

// same 5-line helper comboBeat.tsx keeps privately — copy it, don't import
// across runners
const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

// One exchange, one send. Each card carries its layer, so the heap keeps the
// order they lay in on the table (I9), and each lands on its own `discarded`
// event's scatter (I7). Shared by the two resolutions that have this shape —
// an attack answered by a defence, and an alarm answered by any of its three
// methods — because it is one movement and #88's standing rule says one
// movement is one module.
//
// LAYER COMES FROM POSITION, so a half that is not there must be passed as
// `null` and filtered here rather than skipped by the caller: a missing attack
// would otherwise silently promote the cover to layer 0 and invert the heap.
interface ExchangeHalf {
  eventId: number
  card: CardData
  aux?: CardData | null
  auxEventId?: number
  el: HTMLElement | null
  from: Rect
  pose: { rot: number; dx: number; dy: number }
}
const exchange = (halves: (ExchangeHalf | null)[]): Leaving[] =>
  halves
    .filter((h): h is ExchangeHalf => h !== null)
    .map((h, layer) => ({
      key: `x${h.eventId}`,
      card: h.card,
      aux: h.aux ?? null,
      el: h.el,
      from: h.from,
      pose: h.pose,
      layer,
      scatter: scatterAt(h.eventId),
      ...(h.auxEventId === undefined ? {} : { auxScatter: scatterAt(h.auxEventId) }),
    }))

export function useDefenseBeat(anchors: BoardAnchors, staging?: RefObject<StagedHandoff | null>) {
  const { overlay: exitOverlay, send, reset: resetExit } = useDiscardExit(anchors.discardBox)
  const flyer = useFlyer()
  // ROLLBACK's own destination, when the returned attack lands in the local
  // player's fan rather than an opponent's seat. No `onLanded` work to do:
  // unlike a draw (drawBeat.tsx), the engine already put the card into the
  // hand by mutating state (see the comment at `returning` below), so the
  // NEXT projection already carries it — this beat only has to fly it there.
  const arrival = useHandArrival(anchors.hand, () => {})
  const latest = useRef({ anchors, staging, send, arrival })
  latest.current = { anchors, staging, send, arrival }

  // The AI card standing behind this prompt goes home now that the batch has
  // answered it. It has been standing on the projection's own render
  // (`_Board.tsx`'s `aiStanding`, off `pending.source`) since the batch that
  // revealed it — that beat could not fly it home, because it still had to
  // stand and explain the prompt this beat is what answers.
  //
  // Written out here rather than imported from `aiBeat.tsx`'s own `goHome`:
  // that hook's carrier is `useToCentre`, this one's is `useFlyer`, and a
  // carrier passed between two beats' hooks is how this codebase has already
  // grown two latch bugs of that family (`useBeats.ts`'s own comments).
  const sendHomeward = useCallback(
    async (id: string) => {
      const a = latest.current.anchors
      const card = cardById(id)
      const from = rectOf(a.effect.current)
      const deck = rectOf(a.eventsBox.current)
      if (!card || !from || !deck) return
      // a no-travel raise at the card's own standing spot — the honest answer
      // to "it is here already", the same idiom `runCovered`'s cover leg uses
      const [el] = await flyer.raise([{ key: 'homeward', at: from, card }])
      if (!el) return
      flyer.patch('homeward', { faceDown: true })
      await wait(420) // `flipCard`'s own duration — matches `aiBeat.tsx`'s `goHome`
      const anim = play('returnToDeck', el, { from, to: cardAreaOf(deck) })
      if (anim) await anim.finished
      flyer.drop('homeward')
    },
    [flyer.raise, flyer.patch, flyer.drop],
  )

  const runCovered = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'covered' }>, ctx: BeatRun) => {
      // read BEFORE the first await, same race and same fix as comboBeat's own
      // handoff read: the staging hook's hand-watching effect clears `staged`
      // on this very prop update, and reading it later loses it
      const handoff = latest.current.staging?.current
      const mine = plan.defender === ctx.base.selfId
      await nextFrames() // the shadow that renders `before` has committed (I2)
      const a = latest.current.anchors
      const coverBox = rectOf(a.cover.current)
      const defence = cardById(plan.card)
      const ownSudo = plan.sudo ? cardById(plan.sudo) : null

      // THE COVER — the defence lies over the attack, offset and tilted the
      // other way, so the two read as two plays and not one tidy stack.
      // OURS IS NOT THE BEAT'S TO CARRY. If we staged this defence, the gesture
      // is already delivering it to the cover slot and the beat must keep its
      // hands off: `_useDefenseStaging` flies the card there itself, and the
      // instant its carrier lets go the static cover render takes over in the
      // SAME commit (`flyer.drop` and `setLanded(true)` are batched), so the
      // slot is occupied continuously with nothing to hand over and nothing to
      // duplicate. `handoff.release()` below is the only thing this beat still
      // owes a local defence.
      //
      // This used to ask `handoff?.el` instead of `handoff`, and the difference
      // was the defect the user found on their first real two-peer game (#101,
      // Fix D rounds 3 and 4). A null `el` is not "nobody is holding this card";
      // it is the ORDINARY mid-flight state of a normal local defence, because
      // the static cover child only mounts once the flight has landed. So the
      // beat concluded nothing was standing anywhere and flew the card in a
      // SECOND time, from the fan slot it had already left.
      //
      // Asking whether the play was STAGED — not whether its node happens to
      // exist yet — takes the timing out of the question entirely. Round 3 fixed
      // the same defect by gating the fan-slot leg, which left this branch
      // raising a motionless copy at the destination; that copy was load-bearing
      // only because the staging was being thrown away underneath it, and round
      // 4 stopped that (`_useDefenseStaging`'s catch-up now waits for its own
      // carrier). With the staging surviving, the copy is not merely unnecessary
      // — it would be a second card on top of the gesture's own.
      if (coverBox && defence && !(mine && handoff)) {
        // WHERE IT COMES FROM — resolved in the same order `comboBeat`'s own
        // `foldIn` resolves a source, with one more step on the end.
        //
        // The fan slot the card left, for our own defence: reachable now only on
        // a rejoin or a replay, since a staged one never gets here at all — the
        // gesture that would have staged it never happened on this peer, so
        // nothing else knows where the card is. Then the actor's seat, for
        // everyone else.
        //
        // And finally the cover slot itself. `seatBox` is null for the LOCAL
        // player — only opponents' seats are bound — so before #101, Fix C
        // (finding 6) our own rejoined defence fell out of this branch having
        // done nothing at all: it neither flew nor stood, and the exit that
        // follows then started from an empty box. A no-travel raise at the
        // destination is the honest answer to "it is here and I cannot say
        // where it came from": the card stands, in its own pose, and the
        // exchange leaves from something real.
        const handIndex = mine ? ctx.base.you.hand.findIndex((h) => h.card.id === plan.card) : -1
        const from =
          (handIndex >= 0 ? rectOf(a.handSlotAt(handIndex)) : null) ??
          a.seatBox(plan.defender) ??
          coverBox
        const [el] = await flyer.raise([
          {
            key: 'cover',
            at: from,
            content: ownSudo ? <CardPair main={defence} aux={ownSudo} width="100%" /> : undefined,
            card: ownSudo ? undefined : defence,
          },
        ])
        if (el) {
          await play('playToCenter', el, {
            from,
            to: coverBox,
            rotate: COVER_POSE.rot,
            dx: COVER_POSE.dx,
            dy: COVER_POSE.dy,
          })?.finished
        }
      }
      await wait(SHOW_HOLD)

      // the actor's own answer was already standing where the cover goes —
      // nothing to move, hand the table back. Released HERE, immediately
      // ahead of the exit rather than before the hold above (Fix round 1,
      // Important 2): `release()` clears the local defender's own static
      // cover render at once, and `_useDefenseStaging.ts`'s `landed` gate has
      // nothing else backing that slot — releasing before the hold left it
      // blank for the whole ~1.2s span. The same "drop right before the
      // replacement takes over" ordering `comboBeat.tsx`'s own `runRelease`
      // cost leg already uses for the identical class of bug.
      if (mine && handoff) handoff.release()

      // THE EXIT — one exchange, one send. Each card carries its layer, so the
      // heap keeps the order they lay in on the table (I9), and each lands on
      // its own `discarded` event's scatter (I7).
      const attackBox = rectOf(a.centre.current)
      // by reason as well as card: `support-sudo` can be banked on both sides
      // of one exchange, and only the reason says whose it was
      const spentOf = (card: string, reason: 'attackSpent' | 'defenceSpent') =>
        plan.spent.find((s) => s.card === card && s.reason === reason)
      const attackSpent = spentOf(plan.attackCard, 'attackSpent')
      const attackAux = plan.attackSudo ? spentOf('support-sudo', 'attackSpent') : undefined
      const attackCard = cardById(plan.attackCard)
      const defenceSpent = spentOf(plan.card, 'defenceSpent')
      const defenceAux = ownSudo ? spentOf('support-sudo', 'defenceSpent') : undefined
      // the attack first, the cover second — `exchange` reads the layer off the
      // position, so a half that is not there goes in as `null`, never skipped
      const items = exchange([
        attackSpent && attackBox && attackCard
          ? {
              eventId: attackSpent.eventId,
              card: attackCard,
              aux: plan.attackSudo ? cardById('support-sudo') : null,
              auxEventId: attackAux?.eventId,
              el: a.centre.current,
              from: attackBox,
              pose: ATTACK_POSE,
            }
          : null,
        defenceSpent && coverBox && defence
          ? {
              eventId: defenceSpent.eventId,
              card: defence,
              aux: ownSudo,
              auxEventId: defenceAux?.eventId,
              el: a.cover.current,
              from: coverBox,
              pose: COVER_POSE,
            }
          : null,
      ])
      // ROLLBACK — the attack is not burned, it is sent back. The engine puts
      // it into a hand by mutating state and emits NOTHING for it
      // (attacks.ts:245-252), so `returnTo` is derived rather than read; the
      // gap and what would close it are in docs/animations/backlog.md.
      const returning =
        plan.effect === 'return' && plan.returnTo && attackBox && attackCard
          ? (async () => {
              if (plan.returnTo === ctx.base.selfId) {
                // into our own fan, through the shared insert every other
                // "card settles into the hand" motion uses. No index: the gap
                // opens in the middle of the fan. Awaited for real (not a
                // fixed `wait(FLIGHT_MS)` run alongside it): `arrive()` spends
                // a couple of frames on `nextFrames()` before its own timer
                // even starts, so a parallel clock of the same length resolves
                // early — invisible for a single Rollback (the overlay stays
                // mounted until the hook's own reset), but a second `arrive()`
                // landing in that window would hit `flights.length > 0` and
                // silently no-op.
                await latest.current.arrival.arrive(
                  [{ key: `back${plan.eventId}`, card: attackCard, from: attackBox }],
                  ctx.base.you.hand.length,
                )
                return
              }
              // `anchors.seatBox` resolves null for the LOCAL player — never
              // reached here, since that case took the fan branch above.
              const to = a.seatBox(plan.returnTo as string)
              if (!to) return
              const [el] = await flyer.raise([{ key: 'back', at: attackBox, card: attackCard }])
              if (el) await play('playToCenter', el, { from: attackBox, to })?.finished
              flyer.drop('back')
            })()
          : undefined

      // TAKEOFF: the exchange is resolved and its cards are in the air, so the
      // board lets go of the pending here — the same moment, and the same
      // reason, as `runNeutralized` below and `discardBeat`'s own
      // `withoutFlown`. It is what stops the answered attack rendering at the
      // centre underneath its own flyer, takes the dock out of its reaction
      // state, and keeps the beat BEHIND this one from animating against a
      // board that still has the attack standing on it.
      //
      // Ahead of `returning` as well as of the exit: a Rollback's attack flies
      // to a hand, and the centre must not still be claiming to hold it.
      ctx.publish({ ...ctx.base, pending: null })
      // Together, not in sequence: the exchange leaving for the discard and
      // the attack leaving for its hand are one moment, not two gestures.
      await Promise.all([items.length > 0 ? latest.current.send(items) : undefined, returning])
      flyer.drop('cover')
    },
    [flyer.raise, flyer.drop],
  )

  // Error 503 answered (#102). The same exchange `runCovered` plays, with the
  // alarm in the attack's place and one of three methods in the defence's.
  // Monitoring is the same beat without a card: it answers from the zone and
  // stays there, so nothing flies and the alarm leaves alone.
  const runNeutralized = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'neutralized' }>, ctx: BeatRun) => {
      // read BEFORE the first await, same race and same fix as runCovered's
      const handoff = latest.current.staging?.current
      const mine = plan.player === ctx.base.selfId
      await nextFrames() // the shadow that renders `before` has committed (I2)
      const a = latest.current.anchors
      const coverBox = rectOf(a.cover.current)
      const alarmBox = rectOf(a.centre.current)
      const alarmCard = plan.alarm ? cardById(plan.alarm.card) : null
      const answer = plan.spent[0] ? cardById(plan.spent[0].card) : null
      const aux = plan.spent[1] ? cardById(plan.spent[1].card) : null
      // A sacrificed release that IS an events-deck card has already been
      // claimed home by `bankToDiscard`, whatever this resolution's own
      // `discarded(reason: 'neutralized')` says — so it takes the
      // `returnToDeck` road instead of the heap it would never really reach
      // (docs/animations/backlog.md:1062). The plan read the answer off the
      // pre-batch projection (`releaseEvent`); nothing here re-derives it.
      const toEvents = plan.method === 'sacrifice' && plan.destination === 'events'

      // THE COVER. Skipped for Monitoring, which has no card to move, and for
      // our OWN answer, which the gesture has already delivered to this exact
      // slot — asking whether the play was STAGED rather than whether its node
      // happens to exist yet is what keeps a second copy from flying in
      // (#101, Fix D rounds 3 and 4).
      if (plan.method !== 'monitoring' && coverBox && answer && !(mine && handoff)) {
        // Where it comes from: the sacrificed release's own zone slot, then our
        // own fan slot on a rejoin or a replay, then the actor's seat for
        // everyone else, and finally the cover slot itself — a no-travel raise
        // is the honest answer to "it is here and I cannot say where it came
        // from", and it leaves the exit starting from something real.
        const fromSlot =
          plan.method === 'sacrifice' && plan.slot
            ? rectOf(a.releaseSlot(plan.player, plan.slot))
            : null
        const handIndex = mine
          ? ctx.base.you.hand.findIndex((h) => h.card.id === plan.spent[0]?.card)
          : -1
        const from =
          fromSlot ??
          (handIndex >= 0 ? rectOf(a.handSlotAt(handIndex)) : null) ??
          a.seatBox(plan.player) ??
          coverBox
        const [el] = await flyer.raise([
          {
            key: 'cover',
            at: from,
            content: aux ? <CardPair main={answer} aux={aux} width="100%" /> : undefined,
            card: aux ? undefined : answer,
          },
        ])
        if (el) {
          await play('playToCenter', el, {
            from,
            to: coverBox,
            rotate: COVER_POSE.rot,
            dx: COVER_POSE.dx,
            dy: COVER_POSE.dy,
          })?.finished
        }
      }
      await wait(SHOW_HOLD)

      // released HERE, immediately ahead of the exit rather than before the
      // hold — `release()` clears the local answerer's own static cover render
      // at once, and the staging hook's `landed` gate has nothing else backing
      // that slot. Same ordering runCovered had to be fixed into.
      if (mine && handoff) handoff.release()

      // The Code Review's own true rest position, for the split below that
      // sends it alone — measured the same way `useDiscardExit`'s own
      // `expand()` measures a pair's aux (I6): its bounding rect is the box
      // AROUND the tilt, trimmed back to a card box. Read HERE, synchronously
      // and before any `await` — the same timing `handoff.release()` just
      // above relies on — because `a.cover.current` still holds the STATIC
      // `CardPair` DOM this frame (`_Board.tsx`'s `stagedNeutralize`); the
      // `handed: true` re-render that would clear it has not flushed yet.
      // Only OUR OWN staged sacrifice ever renders a pair there — an
      // opponent's cover never does — so `auxEl` is null for every other
      // case, and the fallback (`coverBox`) is exactly what this leg would
      // read without ever having made this measurement.
      const auxFrom = (() => {
        if (!toEvents || !plan.spent[1] || !coverBox) return null
        const el = a.cover.current?.querySelector<HTMLElement>('[data-aux]')
        return el ? cardBoxIn(el.getBoundingClientRect(), coverBox.width) : null
      })()

      const items = exchange([
        plan.alarm && alarmBox && alarmCard
          ? {
              eventId: plan.alarm.eventId,
              card: alarmCard,
              el: a.centre.current,
              from: alarmBox,
              pose: ATTACK_POSE,
            }
          : null,
        // The release's own Code Review is never an events-deck card, so it
        // always takes the ordinary road even when the release it protected
        // does not: the pair splits here into two singles rather than
        // leaving as one `aux`, the same split `useDiscardExit` itself makes
        // for an ordinary pair, just taken earlier because the two are no
        // longer bound for the same place. `from`/`pose` mirror exactly what
        // `expand()` would have given the aux half of that pair — the split
        // changes WHERE the card goes, not the rest state it leaves from.
        toEvents
          ? plan.spent[1] && coverBox && aux
            ? {
                eventId: plan.spent[1].eventId,
                card: aux,
                el: a.cover.current,
                from: auxFrom ?? coverBox,
                pose: { rot: COVER_POSE.rot + PAIR_AUX.rot, dx: 0, dy: 0 },
              }
            : null
          : plan.spent[0] && coverBox && answer
            ? {
                eventId: plan.spent[0].eventId,
                card: answer,
                aux,
                auxEventId: plan.spent[1]?.eventId,
                el: a.cover.current,
                from: coverBox,
                pose: COVER_POSE,
              }
            : null,
      ])
      // The sacrificed release's own road home — the leg written out rather
      // than pointed at, because it is not `useDiscardExit`'s to carry: that
      // step only ever ends at the heap. Taken alongside the exchange above,
      // not after it: the whole resolution leaves as one moment.
      const sacrificedHome = (async () => {
        if (!toEvents || !plan.spent[0] || !coverBox || !answer) return
        const deck = rectOf(a.eventsBox.current)
        if (!deck) return
        // a no-travel raise at the cover slot — it stands exactly where the
        // pair above was shown, the same idiom the cover leg itself uses
        const [el] = await flyer.raise([{ key: 'sacrificed', at: coverBox, card: answer }])
        if (!el) return
        flyer.patch('sacrificed', { faceDown: true })
        await wait(420) // `flipCard`'s own duration — matches `aiBeat.tsx`'s `goHome`
        const anim = play('returnToDeck', el, { from: coverBox, to: cardAreaOf(deck) })
        if (anim) await anim.finished
        flyer.drop('sacrificed')
      })()
      // TAKEOFF: the answer has been given and both cards are in the air, so the
      // board lets go of the pending HERE — the same moment, and for the same
      // reason, `discardBeat` publishes `withoutFlown`. It is what takes the red
      // glow down (`glowStrong` reads the pending off the shadow) and what stops
      // the answered alarm rendering at the centre underneath its own flyer.
      //
      // It also matters to the beat BEHIND this one: a beat that publishes
      // nothing hands its own base on untouched, so the draw that a resumed
      // sequence puts in the same batch used to animate against a board that
      // still had the alarm standing on it (#103 testing, problem 1).
      ctx.publish({ ...ctx.base, pending: null })
      await Promise.all([items.length > 0 ? latest.current.send(items) : undefined, sacrificedHome])
      flyer.drop('cover')

      // The AI card that raised this prompt goes home now that the batch has
      // answered it — its own road, not this exchange's (#106).
      if (plan.homeward) await sendHomeward(plan.homeward)
    },
    [flyer.raise, flyer.patch, flyer.drop, sendHomeward],
  )

  // Security Bug (#101, Task 15): the release the attack beat is not burned —
  // it crosses from the victim's zone into the thief's. It is entering an
  // OPPONENT's zone, where a release is read as LOD (at a glance, not in
  // full) — so it morphs on the way instead of being swapped on landing. The
  // morph is not a preset: it is a content swap on the flyer, one frame after
  // it mounts (`raise`'s own `nextFrames()`, I2), and the face's own layers
  // ease to their LOD values over the CSS transitions already on them while
  // the flight carries the card across (`ComposedFace`'s own coupling).
  const runStolen = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'stolen' }>, ctx: BeatRun) => {
      await nextFrames() // the shadow that renders `before` has committed (I2)
      const a = latest.current.anchors
      // `from` is the victim's slot as it stood BEFORE this batch (I1 — the
      // beat runs against `base`, and the shadow still renders it); `to` is
      // the thief's, which the live projection has already created. Both
      // resolve for every seat, including our own (`_Board.tsx` binds a
      // release slot for the local player too, unlike `seatBox`).
      const from = rectOf(a.releaseSlot(plan.from, plan.slot))
      const to = rectOf(a.releaseSlot(plan.to, plan.slot))
      const card = cardById(plan.card)
      if (!from || !to || !card) return // nothing measurable: the projection resolves it
      const [el] = await flyer.raise([
        { key: 'steal', at: from, content: <Card card={card} interactive={false} width="100%" /> },
      ])
      if (!el) {
        // `drop` unconditionally, the same idiom `runCovered`'s rollback leg
        // and its own tail already keep (#101, Task 15 review). Not a leak
        // being closed: `raise()` only answers null after adding the key to
        // `held` if a match reset landed mid-await, and `reset()` wipes the
        // flyer's state first — so this call is a no-op on the one path that
        // reaches it. It is here for the consistency of the idiom, which is
        // why there is no test for it: the path is unreachable by design.
        flyer.drop('steal')
        return
      }
      // A release stolen INTO OUR OWN zone (the reflected case, and any
      // future one) is read in full, not as LOD — only a crossing into an
      // OPPONENT's zone gets the at-a-glance reading. The flip happens on
      // the same frame the travel starts, so nothing is swapped on arrival.
      if (plan.to !== ctx.base.selfId) {
        flyer.patch('steal', {
          content: <Card card={card} interactive={false} width="100%" lod />,
        })
      }
      await play('playToCenter', el, { from, to })?.finished
      flyer.drop('steal')
    },
    [flyer.raise, flyer.patch, flyer.drop],
  )

  // A new match cancels what is in the air — same reason and same idiom as
  // every other runner: both carriers belong to the runner, not the queue.
  const reset = useCallback(() => {
    flyer.drop()
    resetExit()
    arrival.reset()
  }, [flyer.drop, resetExit, arrival.reset])

  return {
    overlay: [...exitOverlay, ...flyer.overlay, ...arrival.overlay],
    runCovered,
    runNeutralized,
    runStolen,
    reset,
  }
}
