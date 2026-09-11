import enCommon from '@release/translation/locales/en/common.json'
import ruCommon from '@release/translation/locales/ru/common.json'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type Leaving,
  play,
  restTransform,
  type Scatter,
  scatterAt,
  useDiscardExit,
  useFlyer,
  useHandArrival,
  usePairFold,
  wait,
} from '@/animations'
import { CARDS, cardById } from '@/cards'
import type { Card as CardType } from '@/cards/types'
import Arrow, { useArrow } from '@/primitives/Arrow'
import Card, { CARD_RATIO, cardBoxIn } from '@/primitives/Card'
import CardPair from '@/primitives/CardPair'
import Pile from '@/primitives/Pile'
import { useCardPreview } from '@/table/CardPreview'
import Hand from '@/table/Hand'
import { CARD_W, slotPlacement } from '@/table/Hand/fan'
import type { HandItem, HandPlayDrop } from '@/table/Hand/Hand'
import ReleaseZone from '@/table/ReleaseZone'
import type { ReleaseSlots } from '@/table/ReleaseZone/ReleaseZone'
import Seat from '@/table/Seat'
import { PILE_WIDTH } from '@/table/Table/piles'
import AskLine from '@/table/TableCentre/AskLine'
import { centrePlaceStyle } from '@/table/TableCentre/centre'
import TurnDock from '@/table/TurnDock/TurnDock'
import { pick, useLang } from '../../Playground/lang'
import HoverSelect from '../controls/HoverSelect'
import TechBar from '../controls/TechBar'
import { TechButton, TechHint, TechToggle } from '../controls/TechControls'
import styles from './DefenseReleaseStory.module.css'
import { reorderHand } from './reorderHand'

// Defense Release — playing a Release and defending it.
//
// The turn in full: pulling the Release out of the fan puts it on the table, but
// it does not land yet — by the rules a Release costs one card from the hand, so
// the cost is paid alongside it, in the open, and only then does the Release
// settle into its zone slot. That opens the opponents' instant-attack window.
//
// The attacks are dev-driven on purpose: the tech bar picks WHICH card is thrown
// and throws it, and which opponent it comes from is deliberately not modelled —
// what matters for the animation is the queue. Attacks keep coming until the bar
// passes, so the chained case (attack → Cancel → another attack → Unicorn) is
// reachable, and that is the case the visuals actually have to answer.

// The hand this scene needs: TWO Releases — both playable, one per zone slot, so
// the "next release waits for the current one's attack window to close" rule is
// something you can actually walk through — the Sudo that enhances a defence, and
// every defence card, one of each, so both answers (Cancel-type and Unicorn-type)
// are always in hand.
const SUDO = 'support-sudo'
const HAND_IDS = [
  'release-backend',
  'release-frontend',
  SUDO,
  ...CARDS.filter((c) => c.category === 'defense').map((c) => c.id),
]
const DISCARD_POOL = CARDS.filter(
  (c) => c.deck === 'base' && c.category !== 'trigger' && !HAND_IDS.includes(c.id),
).slice(0, 4)

// attacks that can hit a fresh release (DDoS is the protected-release answer and
// does not belong to this window)
const ATTACKS = ['attack-bug', 'attack-out-of-memory', 'attack-legacy-code', 'attack-security-bug']
// Security Bug does not destroy the release it beats — the attacker TAKES it
// into their own release zone. Only if that slot of theirs is already occupied
// does the release go to the discard instead.
const SECURITY_BUG = 'attack-security-bug'
// Rollback does not burn the attack it answers — it sends it back. Played plain,
// the attack returns to the hand of the opponent who threw it; played under the
// defender's own Sudo, the defender keeps it and it lands in THEIR hand instead.
const ROLLBACK = 'defense-rollback'
// the sudo an opponent lays under an attack — not the one in the player's hand
const SUDO_CARD = cardById(SUDO) ?? null

const SHOW_HOLD = 1200 // a card shown open on the table before it moves on
const LAND_HOLD = 700 // the attack rests at the centre before it can be answered

// Cards thrown onto the table are not laid out straight — an attack lands at a
// tilt and the defence covers it at a different one, offset, so the two read as
// two separate plays rather than one neat stack.
const ATTACK_POSE = { rot: -4, dx: 0, dy: 0 }
const COVER_POSE = { rot: 6, dx: 16, dy: -12 }
// the defender's own Sudo waits in its own place, left of the attack — it is not
// part of the pair until a defence is chosen for it
const SUDO_POSE = { rot: -7, dx: 0, dy: 0 }
const MERGE_MS = 620 // the defence and its Sudo fold into a pair

type Phase = 'idle' | 'cost' | 'window' | 'answer'

interface Opp {
  id: string
  name: string
  handCount: number
}
// a card at rest in the discard heap — carries its own scatter (tilt + offset)
interface DiscardEntry extends Scatter {
  card: CardType
}
// What rides in the flyer. `aux` is the sudo that enhances an attack — a
// sudo-enhanced attack is one play, so it travels and rests as ONE pair, never as
// two separate cards. `lod` is the at-a-glance reading: the card is handed it on
// the frame the flight starts, so its layers ease over the flight instead of
// being swapped on landing.
const faceOf = (card: CardType, aux?: CardType | null, lod?: boolean) =>
  aux ? (
    <CardPair main={card} aux={aux} width="100%" />
  ) : (
    <Card card={card} interactive={false} width="100%" lod={lod} />
  )

const EMPTY_RELEASE: ReleaseSlots = { frontend: undefined, backend: undefined, database: undefined }

const OPPONENTS: Opp[] = [
  { id: 'p2', name: 'kernel_panic', handCount: 5 },
  { id: 'p3', name: 'segfault', handCount: 7 },
]

const makeHand = (): HandItem[] =>
  HAND_IDS.map((id) => cardById(id))
    .filter((c): c is CardType => c != null)
    .map((card, i) => ({ uid: `h${i}`, card }))

// the seeded heap is persistent, so its scatter is deterministic by heap index —
// the same cards lie the same way across re-renders and, later, across peers.
// A card tossed in during play gets a one-off jitter() instead.
const makeDiscard = (): DiscardEntry[] => DISCARD_POOL.map((card, i) => ({ card, ...scatterAt(i) }))

// which zone slot a Release card belongs to — its name IS the slot (Frontend →
// frontend), the same mapping the Combo scene uses
const slotOf = (card: CardType) => card.name.toLowerCase() as keyof ReleaseSlots

// a defence answers an attack unless the attack is sudo-enhanced — then only the
// unicorn-type cards still work (rules: "Карты защиты Cancel не работают")
const canDefend = (card: CardType, sudo: boolean): boolean =>
  card.category === 'defense' && (!sudo || card.tags.includes('unicorn'))

// …and the player's own Sudo is an answer only if the hand holds a defence it can
// BOTH enhance and that still works against this attack. Against a sudo-enhanced
// attack those two never meet in the catalogue (the only sudo-able defence is a
// cancel-type one), so the Sudo is dead weight and must not read as available.
const canEnhance = (card: CardType, sudo: boolean): boolean =>
  canDefend(card, sudo) && card.tags.includes('sudo')

export default function DefenseReleaseStory() {
  const { lang } = useLang()
  const turnCopy = (lang === 'en' ? enCommon : ruCommon).turnDock
  const seatCopy = (lang === 'en' ? enCommon : ruCommon).seat

  const [hand, setHand] = useState<HandItem[]>(makeHand)
  const [release, setRelease] = useState<ReleaseSlots>(EMPTY_RELEASE)
  const [discard, setDiscard] = useState<DiscardEntry[]>(makeDiscard)
  const [phase, setPhase] = useState<Phase>('idle')
  const [staged, setStaged] = useState<CardType | null>(null) // the Release awaiting its cost
  const [cost, setCost] = useState<CardType | null>(null) // the card paid for it
  // the slot of the Release played THIS turn — the only one an attack can hit.
  // A release that survived its window is settled: later attacks are not aimed at
  // it, and it is cleared when the window closes.
  const [target, setTarget] = useState<keyof ReleaseSlots | null>(null)
  // the attack standing at the centre, and the sudo that enhanced it. The flag is
  // captured when the attack is thrown, so flipping the bar afterwards cannot
  // change what is already on the table.
  const [incoming, setIncoming] = useState<CardType | null>(null)
  const [incomingSudo, setIncomingSudo] = useState(false)
  const [cover, setCover] = useState<CardType | null>(null) // the defence over it
  // who threw the attack currently on the table, and what each opponent holds in
  // their own release zone — a Security Bug that lands moves a release there
  const [attacker, setAttacker] = useState<string | null>(null)
  const [oppRelease, setOppRelease] = useState<Record<string, ReleaseSlots>>({})
  const [oppHand, setOppHand] = useState<Record<string, number>>({})
  // the player's own Sudo, pulled out to enhance the defence they are about to
  // play. It waits beside the attack until a sudo-able defence is clicked.
  const [defSudo, setDefSudo] = useState<CardType | null>(null)
  // the same Sudo once it has merged under the defence — a separate slot only so
  // the standing one can be handed to the flyer without ever being on screen twice
  const [coverAux, setCoverAux] = useState<CardType | null>(null)
  const [busy, setBusy] = useState(false)
  // tech bar
  const [attackId, setAttackId] = useState(ATTACKS[0])
  const [sudo, setSudo] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const costRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLDivElement>(null)
  const coverRef = useRef<HTMLDivElement>(null)
  const sudoRef = useRef<HTMLDivElement>(null)
  const discardRef = useRef<HTMLDivElement>(null)
  // the card in the air. It carries a PAIR as often as a single card, rests at a
  // table pose, and morphs into its at-a-glance reading mid-flight — so what rides
  // in the node is this scene's own element; the carrier holds the node.
  const { overlay: flyerOverlay, raise, patch, drop, elOf } = useFlyer()
  // two cards becoming one pair — the shared step. The defence and the Sudo
  // already standing on the table fold together, each from where it really is.
  const { overlay: pairOverlay, fold: foldPair, release: releasePair } = usePairFold()
  // reading a card that stands at the centre — the shared block from the kit.
  // Five slots here (the release, its cost, the attack, the defender's sudo, the
  // cover), and each of them reads on its own.
  const { slotProps, overlay: previewOverlay } = useCardPreview()
  const seatRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const relSlotRefs = useRef<Record<string, HTMLDivElement | null>>({})
  // an opponent's own release slots, keyed `${seatId}:${slot}`
  const oppSlotRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const handWrapRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  const nextSeat = useRef(0)
  // I8 — these are read inside sequences that run across several awaits, and the
  // Hand captures `onPlay` when a drag begins, so a closure read would be stale
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase
  const stagedRef = useRef<CardType | null>(null)
  stagedRef.current = staged
  const incomingRef = useRef<CardType | null>(null)
  incomingRef.current = incoming
  const incomingSudoRef = useRef(false)
  incomingSudoRef.current = incomingSudo
  const attackerRef = useRef<string | null>(null)
  attackerRef.current = attacker
  const oppReleaseRef = useRef<Record<string, ReleaseSlots>>({})
  oppReleaseRef.current = oppRelease
  const defSudoRef = useRef<CardType | null>(null)
  defSudoRef.current = defSudo
  const targetRef = useRef<keyof ReleaseSlots | null>(null)
  targetRef.current = target
  const busyRef = useRef(false)
  busyRef.current = busy
  // the hand as it is NOW: a returning card is inserted after several awaits, and
  // by then the closure's `hand` is one card behind (the defence already left it)
  const handItemsRef = useRef<HandItem[]>([])
  handItemsRef.current = hand

  const attackCard = cardById(attackId)
  // is the player's own Sudo an answer at all right now — i.e. does the hand hold
  // a defence it can enhance that also works against THIS attack
  const sudoUsable = hand.some((it) => canEnhance(it.card, sudo))
  // the aiming arrow — drawn only while a choice is actually pending
  const { from: arrowFrom, to: arrowTo, active: aiming, aim, stop: stopAim } = useArrow()

  // Cards leave the table for the discard through the shared exit step: one by
  // one but all at once, a pair splitting into its two singles.
  const {
    overlay: discardOverlay,
    send: sendToDiscard,
    reset: resetExit,
  } = useDiscardExit(discardRef, (cards) => setDiscard((d) => [...d, ...cards]))

  // A card coming back into the hand settles through the shared insert: the fan
  // opens a gap in the MIDDLE in advance, the card scales to the fan and tucks
  // under the right half of it. One motion for every scene — never a bare flight.
  const {
    gapAt,
    gapSize,
    overlay: insertOverlay,
    arrive,
    reset: resetInsert,
    FLIGHT_MS,
  } = useHandArrival(handWrapRef, (gap, landed) => {
    setHand((h) => {
      const next = h.slice()
      next.splice(gap, 0, ...landed.map((it) => ({ uid: it.key, card: it.card })))
      return next
    })
  })

  // The card box of fan slot `i` in a fan of `total` — computed from the fan
  // geometry, never from a slot's bounding rect: a slot is rotated, so its rect
  // is the box AROUND the tilted card and a flight aimed at it lands off (I6).
  const slotBoxAt = (i: number, total: number): Rect | undefined => {
    const hr = handWrapRef.current?.getBoundingClientRect()
    if (!hr) return undefined
    const base = slotPlacement(i, total)
    const height = CARD_W * CARD_RATIO
    return {
      left: hr.left + hr.width / 2 + base.x - CARD_W / 2,
      top: hr.bottom + base.y - height,
      width: CARD_W,
      height,
    }
  }

  // one flight: mount the flyer at `from`, move it to `to`, leave it there.
  // I2 (paint before moving) and I4 (pin on landing) live here so every step
  // below is a single call.
  const fly = async (
    card: CardType,
    from: DOMRect | Rect,
    to: DOMRect | Rect,
    aux?: CardType | null,
    pose?: { rot: number; dx: number; dy: number },
    toLod?: boolean,
  ) => {
    const at = { left: from.left, top: from.top, width: from.width, height: from.height }
    const [el] = await raise([{ key: 'fly', at, content: faceOf(card, aux) }])
    if (!el) return
    // flip the reading on the same frame the travel starts: the face layers ease
    // to their LOD values over the flight, so nothing is swapped on arrival
    if (toLod) patch('fly', { content: faceOf(card, aux, true) })
    const anim = play('playToCenter', el, {
      from,
      to,
      rotate: pose?.rot,
      dx: pose?.dx,
      dy: pose?.dy,
    })
    if (anim) await anim.finished
    // the animation is left filled on purpose: the carrier mounts a fresh node per
    // flight, so it is never reused, and pinning here would cancel the animation and
    // drop the landing pose for the frame before the resting card takes over — a
    // visible straightening blink. This flight does NOT end in pin().
  }

  // the flyer leaves for the discard from wherever it currently is — the same
  // shared step, flying the element that is already on screen
  const toDiscard = async (card: CardType) => {
    await sendToDiscard([{ key: 'spent', card, node: elOf('fly') }])
    drop('fly')
  }

  // ===== the turn =====

  // the Release goes onto the table but does NOT land — it waits for its cost
  const stageRelease = async (item: HandItem, rect: DOMRect) => {
    setBusy(true)
    setHand((h) => h.filter((it) => it.uid !== item.uid))
    const to = stageRef.current?.getBoundingClientRect()
    if (to) await fly(item.card, rect, to)
    setStaged(item.card)
    drop('fly')
    setPhase('cost')
    setBusy(false)
  }

  // the cost: shown open beside the Release, then discarded; only then does the
  // Release settle into its slot and the attack window opens
  const payCost = async (item: HandItem, rect: DOMRect) => {
    setBusy(true)
    setHand((h) => h.filter((it) => it.uid !== item.uid))
    const to = costRef.current?.getBoundingClientRect()
    if (to) await fly(item.card, rect, to)
    setCost(item.card)
    drop('fly')
    await wait(SHOW_HOLD)

    // the cost leaves for the discard
    const costRect = costRef.current?.getBoundingClientRect()
    if (costRect) {
      setCost(null)
      await fly(item.card, costRect, costRect)
      await toDiscard(item.card)
    }

    // the Release settles into its OWN zone slot — the scene plays more than one
    const relCard = stagedRef.current
    const slotKey = relCard ? slotOf(relCard) : null
    const fromRect = stageRef.current?.getBoundingClientRect()
    const slot = slotKey ? relSlotRefs.current[slotKey]?.getBoundingClientRect() : undefined
    if (relCard && slotKey && fromRect && slot) {
      // the staged card and the flyer swap in the SAME commit — otherwise there
      // is one frame with neither on screen
      setStaged(null)
      const [el] = await raise([
        {
          key: 'fly',
          at: {
            left: fromRect.left,
            top: fromRect.top,
            width: fromRect.width,
            height: fromRect.height,
          },
          content: faceOf(relCard),
        },
      ])
      if (el) {
        // a release lands with a snap — the one preset that is not playToCenter
        const anim = play('playToReleaseZone', el, { from: fromRect, to: slot })
        if (anim) await anim.finished
      }
      setRelease((r) => ({ ...r, [slotKey]: relCard }))
      // it is fresh — this is the release the opening attack window is about
      setTarget(slotKey)
      drop('fly')
    }
    setPhase('window')
    setBusy(false)
  }

  // the bar throws an attack. Which opponent it comes from is not modelled — the
  // seats simply take turns, so the flight is seen from both sides of the table.
  const throwAttack = async () => {
    if (!attackCard || phaseRef.current !== 'window' || busy) return
    setBusy(true)
    const seat = OPPONENTS[nextSeat.current % OPPONENTS.length]
    nextSeat.current += 1
    const aux = sudo ? SUDO_CARD : null
    const seatRect = seatRefs.current[seat.id]?.getBoundingClientRect()
    const centre = centerRef.current?.getBoundingClientRect()
    if (seatRect && centre) {
      // I6 — aim from a card-sized box inside the seat, not the whole seat cell.
      // The attack goes to the CENTRE of the table, open to everyone, not onto
      // the release it is aimed at — one card, or one pair when sudo backs it.
      // I7 — it lands already at its table tilt, so the swap to the resting card
      // is seamless.
      await fly(attackCard, cardBoxIn(seatRect, CARD_W), centre, aux, ATTACK_POSE)
    }
    setIncoming(attackCard)
    setIncomingSudo(sudo)
    setAttacker(seat.id)
    drop('fly')
    setPhase('answer')
    await wait(LAND_HOLD)
    setBusy(false)
  }

  // the player's Sudo goes onto the table and waits beside the attack for the
  // defence it will enhance
  // Same as the Combo scene: the Sudo goes to its OWN staging slot on the table
  // and an arrow points from it at what it will enhance. It must not fly to the
  // card it is about to back — that reads as the pair already being assembled.
  const stageDefSudo = async (item: HandItem, rect: DOMRect, dropped: HandPlayDrop) => {
    setBusy(true)
    setHand((h) => h.filter((it) => it.uid !== item.uid))
    const box = sudoRef.current?.getBoundingClientRect()
    if (box) await fly(item.card, rect, box, null, SUDO_POSE)
    setDefSudo(item.card)
    drop('fly')
    setBusy(false)
    // the arrow starts where the Sudo now stands and follows the cursor
    if (box) aim({ x: box.left + box.width / 2, y: box.top + box.height / 2 }, dropped)
  }

  // A card put onto the table WAITS for an answer from the hand, and pressing on
  // nothing valid takes it back — the rule from the Combo scene. Two steps here
  // ask that way: the Release standing at the centre waits for the card that pays
  // its cost (no arrow — there is nothing to point at, the ask is the whole hand),
  // and the Sudo waits for the defence it enhances (with the arrow). Both go back
  // into the middle of the fan through the shared insert, so cancelling a play
  // lands a card in the hand exactly like drawing one.
  const cancelStaged = useCallback(() => {
    if (busyRef.current) return
    const toHand = (card: CardType, box: DOMRect | undefined, rot = 0) => {
      if (!box) return
      void arrive([{ key: `r${++seq.current}`, card, from: box, rot }], handItemsRef.current.length)
    }
    const waitingRelease = stagedRef.current
    if (phaseRef.current === 'cost' && waitingRelease) {
      const from = stageRef.current?.getBoundingClientRect()
      setStaged(null)
      setPhase('idle')
      toHand(waitingRelease, from)
      return
    }
    const mySudo = defSudoRef.current
    if (!mySudo) return
    stopAim()
    const from = sudoRef.current?.getBoundingClientRect()
    setDefSudo(null)
    toHand(mySudo, from, SUDO_POSE.rot)
  }, [arrive, stopAim])

  // a press on nothing valid cancels. Presses inside the hand stop propagation —
  // those are answers (or a card being picked up), not a miss.
  useEffect(() => {
    const pending = defSudo != null || (phase === 'cost' && staged != null)
    if (!pending || busy) return
    const onDown = () => cancelStaged()
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [defSudo, phase, staged, busy, cancelStaged])

  // The defence and the standing Sudo FOLD into a pair: each inner card starts
  // exactly where its real card is on screen and travels to its place in the
  // pair. Nothing is hidden and nothing is re-created — the Sudo the player put
  // on the table is the same element that ends up tucked under the defence.
  //
  // The move itself is the shared step (`usePairFold`): it was written here
  // first, and then three more times on the board. What stays the scene's is
  // WHEN it happens and what the pair rests at — the step owns the geometry.
  const mergeIntoPair = async (defCard: CardType, fromRect: Rect | DOMRect, sudoCard: CardType) => {
    const box = coverRef.current?.getBoundingClientRect()
    const sudoBox = sudoRef.current?.getBoundingClientRect()
    if (!box || !sudoBox) return
    // the standing Sudo is handed over to the pair in the SAME commit, so it is
    // never on screen twice and never off screen either
    setDefSudo(null)
    await foldPair({
      main: defCard,
      aux: sudoCard,
      mainFrom: fromRect,
      auxFrom: sudoBox,
      box,
      pose: restTransform(COVER_POSE),
      dur: MERGE_MS,
    })
  }

  // a defence covers the attack at the centre: both leave for the discard and
  // the release survives
  const defend = async (item: HandItem, rect: DOMRect) => {
    const att = incomingRef.current
    const aux = incomingSudoRef.current ? SUDO_CARD : null
    const mySudo = defSudoRef.current
    const by = attackerRef.current
    if (!att) return
    setBusy(true)
    setHand((h) => h.filter((it) => it.uid !== item.uid))
    // the defence covers the attack — offset and tilted differently, so the two
    // read as two plays and not as one tidy stack. Under a Sudo it is a pair.
    if (mySudo) {
      await mergeIntoPair(item.card, rect, mySudo)
    } else {
      const coverBox = coverRef.current?.getBoundingClientRect()
      if (coverBox) await fly(item.card, rect, coverBox, null, COVER_POSE)
    }
    setCover(item.card)
    setCoverAux(mySudo)
    // the resting render has taken over — both carriers can go (whichever of the
    // two brought the card here; the other call is a no-op)
    drop('fly')
    releasePair()
    await wait(SHOW_HOLD)

    // I1 — measure both while they are still on the table, then let them go
    // together: one exchange, one exit
    const attBox = centerRef.current?.getBoundingClientRect()
    const defBox = coverRef.current?.getBoundingClientRect()
    // Rollback sends the attack back instead of burning it: to the defender's
    // own hand under Sudo, otherwise to the hand of whoever threw it
    const returns = item.card.id === ROLLBACK
    const toMe = returns && mySudo != null
    const seatBox = by ? seatRefs.current[by]?.getBoundingClientRect() : undefined
    // what leaves the table, card by card — built while the slots are still there
    const attackExit: Leaving[] = attBox
      ? [
          {
            key: 'attack',
            card: att,
            aux,
            el: centerRef.current,
            from: attBox,
            pose: ATTACK_POSE,
            layer: 0,
          },
        ]
      : []
    const exiting = [
      // the defence is always spent, with the Sudo that backed it
      ...(defBox
        ? [
            {
              key: 'defence',
              card: item.card,
              aux: mySudo,
              el: coverRef.current,
              from: defBox,
              pose: COVER_POSE,
              layer: 1,
            },
          ]
        : []),
      // the attack burns with it — unless Rollback is sending it back, and then
      // only the Sudo that backed the attack is spent
      ...(returns ? attackExit.filter((e) => e.key !== 'attack') : attackExit),
    ]

    setIncoming(null)
    setIncomingSudo(false)
    setAttacker(null)
    setCover(null)
    setCoverAux(null)
    setDefSudo(null)

    if (attBox && defBox) {
      await Promise.all([
        sendToDiscard(exiting),
        // …and the returned attack travels at the same time
        returns
          ? (async () => {
              // into MY hand — through the shared insert: the fan opens a gap in
              // the middle in advance and the card scales down into it. The one
              // "card settles into the hand" motion every other scene uses.
              if (toMe) {
                void arrive(
                  [{ key: `r${++seq.current}`, card: att, from: attBox }],
                  handItemsRef.current.length,
                )
                await wait(FLIGHT_MS)
              } else {
                const to = seatBox ? cardBoxIn(seatBox, CARD_W) : undefined
                if (!to) return
                await fly(att, attBox, to)
                if (by) setOppHand((o) => ({ ...o, [by]: (o[by] ?? 0) + 1 }))
                drop('fly')
              }
            })()
          : undefined,
      ])
    }
    setPhase('window')
    setBusy(false)
  }

  // The attack succeeds. Everything but a Security Bug destroys the release —
  // it goes to the discard alongside the attack. A Security Bug TAKES it: the
  // release crosses the table into the attacker's own zone and stays in play,
  // and only the attack itself is spent.
  const letThrough = async () => {
    const att = incomingRef.current
    const aux = incomingSudoRef.current ? SUDO_CARD : null
    // the attack answers the release played THIS turn, whichever one that is
    const slotKey = targetRef.current
    const relCard = slotKey ? release[slotKey] : null
    const by = attackerRef.current
    if (!att || !slotKey || busy) return
    setBusy(true)
    // I1 — measure everything before it leaves the DOM
    const centre = centerRef.current?.getBoundingClientRect()
    const slot = relSlotRefs.current[slotKey]?.getBoundingClientRect()
    // the attacker's own slot of that kind — free means they can take the release,
    // occupied means it is discarded instead (a player never holds two of a kind)
    const takes =
      att.id === SECURITY_BUG && by != null && oppReleaseRef.current[by]?.[slotKey] == null
    const takeSlot = takes && by ? oppSlotRefs.current[`${by}:${slotKey}`] : null
    const takeBox = takeSlot?.getBoundingClientRect()
    // what leaves the table, card by card — built while the slots are still there
    const exiting = [
      // the spent attack, with the Sudo that backed it — it lies over the release
      ...(centre
        ? [
            {
              key: 'attack',
              card: att,
              aux,
              el: centerRef.current,
              from: centre,
              pose: ATTACK_POSE,
              layer: 1,
            },
          ]
        : []),
      // …and the release with it, unless it is being taken
      ...(relCard && !takes
        ? [{ key: 'release', card: relCard, from: slot as Rect, layer: 0 }]
        : []),
    ]

    setIncoming(null)
    setIncomingSudo(false)
    setAttacker(null)
    setTarget(null)
    if (relCard) setRelease((r) => ({ ...r, [slotKey]: undefined }))

    if (centre && slot) {
      await Promise.all([
        sendToDiscard(exiting),
        // the taken release crosses to the attacker's zone at the same time
        relCard && takes && takeBox && by
          ? // it is crossing into an OPPONENT's zone, where cards are read as
            // LOD — so it morphs on the way instead of being swapped on arrival
            fly(relCard, slot, takeBox, null, undefined, true).then(() => {
              setOppRelease((r) => ({ ...r, [by]: { ...r[by], [slotKey]: relCard } }))
              drop('fly')
            })
          : undefined,
      ])
    }
    setPhase('idle')
    setBusy(false)
  }

  // the attackers are done — the release stands and stops being a target
  const passAttacks = () => {
    if (phaseRef.current !== 'window') return
    setTarget(null)
    setPhase('idle')
  }

  const reset = () => {
    setHand(makeHand())
    setRelease(EMPTY_RELEASE)
    setDiscard(makeDiscard())
    setPhase('idle')
    setStaged(null)
    setCost(null)
    setTarget(null)
    setIncoming(null)
    setIncomingSudo(false)
    setCover(null)
    setCoverAux(null)
    setDefSudo(null)
    setAttacker(null)
    setOppRelease({})
    setOppHand({})
    resetExit()
    drop('fly')
    resetInsert()
    setBusy(false)
    nextSeat.current = 0
  }

  // GESTURE — pulling a card out of the fan puts it into the turn. Which card is
  // legal depends on the step: the Release starts the play, any card can pay its
  // cost, and only a working defence answers an attack.
  const handPlay = (uid: string, dropped: HandPlayDrop): boolean => {
    if (busy || !dropped.rect) return false
    const item = hand.find((it) => it.uid === uid)
    if (!item) return false
    // A release can only be started while the turn is green (phase idle) — by the
    // rules the next release waits until the attack window on the current one is
    // over, and the dock's green state IS that moment. Its own slot must also be
    // free: the zone holds one card per type.
    if (phase === 'idle' && item.card.category === 'release' && !release[slotOf(item.card)]) {
      void stageRelease(item, dropped.rect)
      return true
    }
    if (phase === 'cost') {
      void payCost(item, dropped.rect)
      return true
    }
    if (phase === 'answer') {
      // your own Sudo goes onto the table first and waits for the defence it
      // enhances — the partner of a combo is CLICKED, never pulled out
      if (item.card.id === SUDO && !defSudo && sudoUsable) {
        void stageDefSudo(item, dropped.rect, dropped)
        return true
      }
      if (!defSudo && canDefend(item.card, sudo)) {
        void defend(item, dropped.rect)
        return true
      }
    }
    return false
  }

  // a click answers the staged Sudo: the defence it enhances. Clicking a card it
  // cannot enhance is a miss like any other — it takes the Sudo back.
  const pickEnhanced = (i: number) => {
    if (phaseRef.current !== 'answer' || !defSudoRef.current || busy) return
    const item = hand[i]
    if (!item || !canEnhance(item.card, sudo)) {
      cancelStaged()
      return
    }
    stopAim() // the choice is made — nothing is being pointed at any more
    const rect = slotBoxAt(i, hand.length)
    if (rect) void defend(item, rect as DOMRect)
  }

  // The hand is highlighted only when a step is actually waiting on a choice
  // from it, and only on the cards that answer that step. Nothing is lit at rest
  // — a glow with nothing asked reads as "already selected", not as "available".
  //
  // The cost step is the exception in colour, not in rule: any card answers it
  // and answering costs you that card, so the eligible set is the whole fan and
  // its hue is the loss one. It is lit only once the ask is on screen.
  const stateAt = (i: number) => {
    const card = hand[i]?.card
    if (!card) return 'idle' as const
    if (phase === 'cost') return 'playable' as const
    if (phase === 'answer') {
      // with your Sudo already on the table only the defences it can enhance
      // stay lit; otherwise every working defence does, plus the Sudo itself
      if (defSudo) return canEnhance(card, sudo) ? ('playable' as const) : ('idle' as const)
      return canDefend(card, sudo) || (card.id === SUDO && sudoUsable)
        ? ('playable' as const)
        : ('idle' as const)
    }
    return 'idle' as const
  }
  const accentAt = (i: number) => (phase === 'cost' && hand[i] ? 'var(--danger-accent)' : undefined)

  const hint = {
    idle: pick(lang, {
      ru: 'вытащи релиз из руки',
      en: 'pull a release out of the hand',
    }),
    cost: pick(lang, {
      ru: 'релиз стоит одной карты — вытащи любую',
      en: 'a release costs one card — pull any of them out',
    }),
    window: pick(lang, {
      ru: 'окно атаки: бросай атаки или пасуй',
      en: 'attack window: throw attacks or pass',
    }),
    answer: defSudo
      ? pick(lang, {
          ru: 'кликни защиту, которую усилит sudo',
          en: 'click the defence the sudo will enhance',
        })
      : pick(lang, {
          ru: 'ответь защитой или пасуй в доке — атака пройдёт',
          en: 'answer with a defence, or pass in the dock — the attack lands',
        }),
  }[phase]

  return (
    <div className={styles.root}>
      <TechBar>
        <TechButton onClick={reset}>{pick(lang, { ru: 'рестарт', en: 'restart' })}</TechButton>
        <HoverSelect
          label={pick(lang, { ru: 'карта атаки', en: 'attack card' })}
          value={attackId}
          options={ATTACKS.map((id) => ({ value: id, label: cardById(id)?.name ?? id }))}
          onChange={setAttackId}
        />
        <TechToggle on={sudo} onChange={setSudo}>
          sudo
        </TechToggle>
        <TechButton onClick={throwAttack} disabled={phase !== 'window' || busy}>
          {pick(lang, { ru: 'атаковать', en: 'attack' })}
        </TechButton>
        <TechButton onClick={passAttacks} disabled={phase !== 'window' || busy}>
          {pick(lang, { ru: 'пас атак', en: 'pass attacks' })}
        </TechButton>
        <div className={styles.hint}>
          <TechHint>{hint}</TechHint>
        </div>
      </TechBar>
      <div className={styles.stage}>
        {/* opponents — top-centre, as on the table; an attack flies out of a seat */}
        <div className={styles.opponents}>
          {OPPONENTS.map((o) => (
            <div
              key={o.id}
              ref={(el) => {
                seatRefs.current[o.id] = el
              }}
            >
              <Seat
                player={{
                  id: o.id,
                  name: o.name,
                  handCount: o.handCount + (oppHand[o.id] ?? 0),
                  release: oppRelease[o.id] ?? EMPTY_RELEASE,
                }}
                copy={seatCopy}
                slotRef={(key, el) => {
                  oppSlotRefs.current[`${o.id}:${key}`] = el
                }}
              />
            </div>
          ))}
        </div>

        {/* the played Release waits here for its cost, which is shown beside it.
            The ask sits with the cards, not only in the dev bar — a release parked
            at the centre with no explanation reads as a stuck play. */}
        <div
          className={styles.slot}
          style={centrePlaceStyle('release', 'stage')}
          ref={stageRef}
          {...slotProps(staged)}
        >
          {staged && <Card card={staged} interactive={false} width="100%" />}
        </div>
        <div
          className={styles.slot}
          style={centrePlaceStyle('release', 'cost')}
          ref={costRef}
          {...slotProps(cost)}
        >
          {cost && <Card card={cost} interactive={false} width="100%" />}
        </div>

        {/* the attack stands at the CENTRE, open to the whole table — one card, or
            one pair when a sudo backs it (a sudo-enhanced attack is one play) */}
        <div
          className={styles.slot}
          style={centrePlaceStyle('defence', 'centre')}
          ref={centerRef}
          {...slotProps(incoming)}
        >
          {incoming && (
            <div className={styles.pose} style={{ transform: restTransform(ATTACK_POSE) }}>
              {incomingSudo && SUDO_CARD ? (
                <CardPair main={incoming} aux={SUDO_CARD} width="100%" />
              ) : (
                <Card card={incoming} interactive={false} width="100%" />
              )}
            </div>
          )}
        </div>

        {/* the defender's own Sudo waits in its OWN place until a defence is
            chosen for it — the arrow says what it is aimed at */}
        <div
          className={styles.slot}
          style={centrePlaceStyle('defence', 'sudo')}
          ref={sudoRef}
          {...slotProps(defSudo)}
        >
          {defSudo && !cover && (
            <div className={styles.pose} style={{ transform: restTransform(SUDO_POSE) }}>
              <Card card={defSudo} interactive={false} width="100%" />
            </div>
          )}
        </div>

        {/* the defence covering the attack — offset and tilted the other way */}
        <div
          className={styles.slot}
          style={centrePlaceStyle('defence', 'cover')}
          ref={coverRef}
          {...slotProps(cover)}
        >
          {cover && (
            <div className={styles.pose} style={{ transform: restTransform(COVER_POSE) }}>
              {coverAux ? (
                <CardPair main={cover} aux={coverAux} width="100%" />
              ) : (
                <Card card={cover} interactive={false} width="100%" />
              )}
            </div>
          )}
        </div>
        {previewOverlay}

        {/* what the table is waiting for — the shared line from the kit, which
            hangs off the centre's own height and stays mounted so it can fade
            out as well as in */}
        <AskLine shown={phase === 'cost'}>
          {pick(lang, {
            ru: 'релиз стоит одной карты — вытащи любую из руки',
            en: 'a release costs one card — pull any of them out of the hand',
          })}
        </AskLine>

        {/* the decks — left of centre, the Table screen's own column: the draw
            pile in its row, the AI events deck under it. Nothing is drawn from
            them in this scene; they are here because the table the scene shows
            is the table with its decks on it. Counts are the mock table's own
            (`@/mocks/table`), so the scene reads like the screen. */}
        <div className={styles.decks}>
          <div className={styles.pileRow}>
            <Pile
              label={pick(lang, { ru: 'колода', en: 'deck' })}
              deck="base"
              count={78}
              width={PILE_WIDTH}
              countPos="tl"
            />
          </div>
          <Pile
            label={pick(lang, { ru: 'события', en: 'events' })}
            deck="ai"
            count={21}
            width={150}
            countPos="tl"
          />
        </div>

        {/* discard — right of centre; cards lie scattered (a tossed heap) */}
        <div className={styles.discard}>
          <Pile
            heap={discard}
            count={discard.length}
            width={116}
            boxRef={discardRef}
            logoVariant={lang}
            label={pick(lang, { ru: 'сброс', en: 'discard' })}
          />
        </div>

        {/* Turn dock — the canonical turn-control area, bottom-left. An attack on a
            release is the AMBER reaction, not the red one: red is reserved for the
            Error 503 danger reaction. Its PASS key is the answer "I do not defend",
            so pressing it lets the attack succeed — the dock owns that decision
            rather than a dev button.

            The reaction lasts the whole window, not just the moment an attack is on
            the table: it opens when the release lands and holds until the attackers
            pass. Between two attacks the player is still under the window — the dock
            must not fall back to "your move". */}
        <div className={styles.turnDock}>
          <TurnDock
            state={
              phase === 'window' || phase === 'answer'
                ? 'reaction'
                : phase === 'idle'
                  ? 'draw'
                  : 'push'
            }
            seconds={20}
            progress={1}
            activePlayer={OPPONENTS[nextSeat.current % OPPONENTS.length].name}
            copy={turnCopy}
            onPass={phase === 'answer' && !busy ? letThrough : undefined}
          />
        </div>

        {/* player area — release zone above the hand */}
        <div className={styles.you}>
          <ReleaseZone
            release={release}
            size="100px"
            slotRef={(key, el) => {
              relSlotRefs.current[key] = el
            }}
          />
          {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only guard so a press in the fan doesn't read as a miss and cancel the aim; the Hand owns the real interaction */}
          <div
            className={styles.handWrap}
            ref={handWrapRef}
            style={{ pointerEvents: busy ? 'none' : undefined }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Hand
              items={hand}
              gapAt={gapAt}
              gapSize={gapSize}
              stateAt={stateAt}
              accentAt={accentAt}
              onPlay={handPlay}
              onCardClick={defSudo ? pickEnhanced : undefined}
              onReorder={(uid, to) => setHand((h) => reorderHand(h, uid, to))}
            />
          </div>
        </div>

        {aiming && <Arrow from={arrowFrom} to={arrowTo} color="var(--cat-support)" />}

        {/* the travelling card — the shared carrier */}
        {flyerOverlay}

        {/* the shared steps' own overlays: two cards folding into a pair, a card
            settling into the fan (Rollback under Sudo), and the cards leaving
            the table for the discard */}
        {pairOverlay}
        {insertOverlay}
        {discardOverlay}
      </div>
    </div>
  )
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}
