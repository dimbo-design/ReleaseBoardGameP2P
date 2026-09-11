import enCommon from '@release/translation/locales/en/common.json'
import ruCommon from '@release/translation/locales/ru/common.json'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  type Leaving,
  play,
  type Rect,
  restTransform,
  scatterAt,
  useDiscardExit,
  useFlyer,
  wait,
} from '@/animations'
import { CARDS, CATEGORIES, cardById } from '@/cards'
import type { Card as CardType } from '@/cards/types'
import Badge from '@/primitives/Badge'
import Card, { cardAreaOf } from '@/primitives/Card'
import CardPair from '@/primitives/CardPair'
import EdgeGlow from '@/primitives/EdgeGlow'
import Pile from '@/primitives/Pile'
import { useCardPreview } from '@/table/CardPreview'
import Hand from '@/table/Hand'
import type { HandItem, HandPlayDrop } from '@/table/Hand/Hand'
import ReleaseZone from '@/table/ReleaseZone'
import { centrePlaceStyle } from '@/table/TableCentre/centre'
import TurnDock, { type TurnDockState } from '@/table/TurnDock/TurnDock'
import { pick, useLang } from '../../Playground/lang'
import HoverSelect from '../controls/HoverSelect'
import TechBar from '../controls/TechBar'
import { TechButton, TechToggle } from '../controls/TechControls'
import styles from './Error503Story.module.css'
import { reorderHand } from './reorderHand'

// Error 503 — the player-turn story. From TurnDock 'draw' (no timer wired): the
// player draws, Error 503 comes out of the deck to the centre and reveals to
// everyone with a red edge glow. Then defence, by DRAGGING a card onto the 503
// (no drop-target hints — it just falls into place when released over it):
//   - Monitoring in the release zone → auto-neutralized: 503 briefly at the
//     centre, then straight to discard, NO glow (Monitoring stays).
//   - Debugger from hand OR a Release (with its attached Code Review) from the
//     zone → covers the 503 at the centre, both go to discard.
//   - No defence / the player passes → everything (hand, and on a pass the
//     release zone too) goes to the centre and then to the discard; the player
//     is out and TurnDock drops to 'waiting' (opponent turn).
// The scene is driven by which cards sit where — toggled in the tech bar — not
// by hard-coded per-flow cases.

const BASE = CARDS.filter((c) => c.deck === 'base')

const ERROR503 = 'trigger-error-503'
const DEBUGGER = 'protection-debugger'

function must(id: string): CardType {
  const c = cardById(id)
  if (!c) throw new Error(`unknown card ${id}`)
  return c
}
const ERROR503_CARD = must(ERROR503)

// four innocuous hand fillers — the grey, unplayable cards during the 503 window
const FILLERS = BASE.filter(
  (c) =>
    c.category !== 'trigger' &&
    c.id !== DEBUGGER &&
    c.id !== 'protection-monitoring' &&
    !c.id.startsWith('release'),
).slice(0, 4)

type SlotKey = 'frontend' | 'backend' | 'database' | 'monitoring'
const SLOTS: SlotKey[] = ['frontend', 'backend', 'database', 'monitoring']
const WAITING_PLAYER = 'kernel_panic'
// Where a dragged defence may be released. Not "on the 503": every other scene
// accepts a card dropped anywhere on the table and takes it to where it belongs,
// and having to hit one card exactly is a rule this screen invented for itself.
// The one place that gives the card back is the player's own area — dropping it
// back where it came from reads as changing your mind.
const CARD_W = 150 // normal card width — deck / hand / centre all match (no size skew)
const CARD_H = (CARD_W * 515) / 368 // matching --card-aspect (368 / 515)

// elimination videos — shown to everyone when a player is knocked out. Bundled
// from the story's own folder; nothing reaches into user_input.
const ELIM_VIDEOS = Object.values(
  import.meta.glob('./eliminate/*.mp4', { eager: true, query: '?url', import: 'default' }),
) as string[]
// Every answer to the 503 has the SAME shape, whichever card gives it: the card
// travels to the centre, covers the alarm slightly off so both are read, both
// stand open long enough for the table to see what happened, and only then do they
// leave together as one exchange. Monitoring is the same beat without a card: the
// alarm is shown neutralized, held, and goes.
const COVER_DX = 16 // the cover sits a touch off the alarm — or it just hides it
const COVER_DY = -12
// …and it lies at a tilt, like every other card put down on the table: an answer
// laid perfectly straight over the alarm reads as one tidy stack instead of two
// separate plays. The offset is already in `coverRect()`, so the pose carries
// only the rotation — the same one Defense Release rests its cover at.
const COVER_POSE = { rot: 6, dx: 0, dy: 0 }
const COVER_HOLD = 1200 // the answer and the alarm stand open, читаемые всеми
const GIF_DELAY = 400 // a beat after the table empties, before the video comes in
const GATHER_HOLD = 1500 // the swept cards are held open at the centre before they scatter
const ELIM_MIN_MS = 5000 // play at least this long, then finish the current loop

interface RelSlot {
  main: CardType
  aux?: CardType
}
type Rel = Partial<Record<SlotKey, RelSlot>>

interface DragState {
  kind: 'debugger' | 'release'
  uid?: string // hand card being dragged
  slot?: SlotKey // release slot being dragged
  main: CardType
  aux?: CardType
  cx: number // cursor at pick-up
  cy: number
  // where inside the card it was grabbed (0..1) — keeps that point under the
  // cursor as the card resizes, so the pick-up doesn't snap centre-to-cursor
  fracX: number
  fracY: number
  originCx: number // source-slot centre (for the off-target return)
  originCy: number
  startW: number // source on-screen width (eases to CARD_W)
}
// a card at rest in the discard heap — carries its own scatter (tilt + offset)
interface DiscardEntry {
  card: CardType
  rot: number
  dx: number
  dy: number
}

function buildHand(withDebugger: boolean): HandItem[] {
  const items: HandItem[] = FILLERS.map((card, i) => ({ uid: `h${i}`, card }))
  if (withDebugger) items.splice(2, 0, { uid: 'h-dbg', card: must(DEBUGGER) })
  return items
}
function buildRel(release: boolean, releaseCR: boolean, monitoring: boolean): Rel {
  return {
    frontend: release ? { main: must('release-frontend') } : undefined,
    backend: releaseCR
      ? { main: must('release-backend'), aux: must('support-code-review') }
      : undefined,
    monitoring: monitoring ? { main: must('protection-monitoring') } : undefined,
  }
}

export default function Error503Story() {
  const { lang } = useLang()
  const turnCopy = (lang === 'en' ? enCommon : ruCommon).turnDock
  const tableCopy = (lang === 'en' ? enCommon : ruCommon).table

  // ===== tech-bar toggles — the scene's initial state (cards in places) =====
  const [dbg, setDbg] = useState(true)
  const [rel1, setRel1] = useState(false)
  const [relCR, setRelCR] = useState(false)
  const [mon, setMon] = useState(false)

  // ===== scene state =====
  const [handItems, setHandItems] = useState<HandItem[]>(() => buildHand(true))
  const [rel, setRel] = useState<Rel>(() => buildRel(false, false, false))
  const [centerCard, setCenterCard] = useState<CardType | null>(null)
  const [discard, setDiscard] = useState<DiscardEntry[]>([])
  const [drag, setDrag] = useState<DragState | null>(null)
  const [alert, setAlert] = useState(false) // red edge glow
  const [pending, setPending] = useState(false) // 503 at centre, awaiting the player
  const [eliminated, setEliminated] = useState(false)
  const [gif, setGif] = useState<string | null>(null) // elimination video overlay
  // dev pick: 'random' or an index into ELIM_VIDEOS. Read through a ref — the
  // sequence that plays it spans several awaits (I8)
  const [gifPick, setGifPick] = useState('random')
  const [dock, setDock] = useState<TurnDockState>('draw')
  const [busy, setBusy] = useState(false)

  const deckRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLDivElement>(null)
  const discardRef = useRef<HTMLDivElement>(null)
  const { overlay: discardOverlay, send: sendToDiscard } = useDiscardExit(discardRef, (cards) =>
    setDiscard((d) => [...d, ...cards]),
  )
  const dragRef = useRef<HTMLDivElement>(null)
  const youRef = useRef<HTMLDivElement>(null) // the player's own area: zone + hand
  const handWrapRef = useRef<HTMLDivElement>(null)
  const relSlotRefs = useRef<Record<string, HTMLDivElement | null>>({})
  // every card this scene puts in the air: the drawn 503 ('draw') and the cards
  // swept to the discard ('o0', 'o1', …). The dragged defence is NOT one of them —
  // it follows the cursor rather than flying, and stays the scene's own.
  const { overlay: flyerOverlay, raise, pin, glide, patch, drop } = useFlyer()
  // reading the card that stands at the centre — the shared block from the kit
  const { slotProps, overlay: previewOverlay } = useCardPreview()
  const gifPickRef = useRef('random')
  gifPickRef.current = gifPick
  const eliminating = useRef(false) // one elimination at a time
  const gifStart = useRef(0)
  const gifPasses = useRef(0)
  const gifResolve = useRef<(() => void) | null>(null)

  // Hand owns its hover internally; after a card leaves the hand the pointer is
  // usually at the centre, so tell the fan the mouse left — dispatch a real
  // mouseout on each slot (next frame, after the fan re-lays out) so it clears
  // hover instead of leaving a card lit up under no cursor.
  const clearHandHover = () => {
    requestAnimationFrame(() => {
      const fan = handWrapRef.current?.firstElementChild
      if (!fan) return
      for (const slot of Array.from(fan.children)) {
        slot.dispatchEvent(
          new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
        )
      }
    })
  }

  // elimination video: shown to everyone, looped, at least ELIM_MIN_MS, then the
  // current loop finishes and it is gone. Resolves when hidden.
  //
  // It comes in a beat AFTER the table has emptied (GIF_DELAY) — landing on the
  // same frame reads as a cut — and fades in while it is ALREADY playing: the fade
  // is on the overlay, it does not hold the video back. Going away is abrupt on
  // purpose: the turn is over, there is nothing left to watch out of.
  async function playEliminationGif(): Promise<void> {
    if (ELIM_VIDEOS.length === 0) return
    const chosen = Number(gifPickRef.current)
    const src = Number.isInteger(chosen)
      ? ELIM_VIDEOS[chosen]
      : ELIM_VIDEOS[Math.floor(Math.random() * ELIM_VIDEOS.length)]
    await wait(GIF_DELAY)
    gifStart.current = performance.now()
    gifPasses.current = 0
    setGif(src)
    return new Promise((res) => {
      gifResolve.current = res
    })
  }
  // one pass finished: replay until the minimum time is reached, then fade out.
  // Counted in passes of the clip's own length rather than on the clock — every
  // seam makes real playback run a little long, and a clip whose passes land
  // just under the floor would otherwise play a pass fewer some of the time.
  // The board beat counts the same way (eliminateBeat.tsx).
  function onGifEnded(e: React.SyntheticEvent<HTMLVideoElement>) {
    const v = e.currentTarget
    gifPasses.current += 1
    const one = v.duration * 1000
    const short =
      Number.isFinite(one) && one > 0
        ? gifPasses.current * one < ELIM_MIN_MS
        : performance.now() - gifStart.current < ELIM_MIN_MS
    if (short) {
      v.currentTime = 0
      void v.play()
      return
    }
    setGif(null)
    gifResolve.current?.()
    gifResolve.current = null
  }

  // rebuild the scene from the toggles (on mount and on any toggle change)
  // biome-ignore lint/correctness/useExhaustiveDependencies: applyScene reads only the toggle args
  useEffect(() => applyScene(dbg, rel1, relCR, mon), [dbg, rel1, relCR, mon])

  function applyScene(a: boolean, b: boolean, c: boolean, d: boolean) {
    setHandItems(buildHand(a))
    setRel(buildRel(b, c, d))
    setCenterCard(null)
    drop() // every card still in the air comes down
    setDiscard([])
    setDrag(null)
    setAlert(false)
    setPending(false)
    setEliminated(false)
    setGif(null)
    setBusy(false)
    setDock('draw')
  }

  // read the fanned hand's per-slot rects (order matches handItems) — for the
  // elimination sweep, where each card flies from where it sits
  function handSlotRects(): DOMRect[] {
    const fan = handWrapRef.current?.firstElementChild
    if (!fan) return []
    return Array.from(fan.children).map((el) => (el as HTMLElement).getBoundingClientRect())
  }

  // fly a set of cards to the discard as a scattered heap. `gather` first draws
  // them together at the centre (elimination), then scatters; without it the
  // cards are already at the centre (a resolved defence) and just scatter.
  async function sweep(items: { card: CardType; fromRect: Rect }[], gather: boolean) {
    const centerRect = centerRef.current?.getBoundingClientRect()
    const discardRect = discardRef.current?.getBoundingClientRect()
    if (!discardRect || items.length === 0) return
    // the cards become flyers exactly where they stand
    await raise(items.map((it, i) => ({ key: `o${i}`, card: it.card, at: it.fromRect })))
    // where each card lies once gathered: a HEAP, not a neat stack — the same
    // scatter model the discard uses, so the pile at the centre reads as a pile
    const heap = items.map((_, i) => scatterAt(i, CARD_W))
    let boxes = items.map((it) => it.fromRect)
    if (gather && centerRect) {
      boxes = heap.map((sc) => ({
        left: centerRect.left + sc.dx,
        top: centerRect.top + sc.dy,
        width: centerRect.width,
        height: centerRect.height,
      }))
      await Promise.all(
        items.map((_, i) => {
          // the tilt travels with the move (the carrier transitions it), so the card
          // eases into its place in the pile instead of snapping into the angle
          patch(`o${i}`, { pose: restTransform({ ...heap[i], dx: 0, dy: 0 }) })
          return glide(`o${i}`, boxes[i], 300)
        }),
      )
      // held open at the centre — the same beat the hand-limit grid gets before it
      // leaves: the table has to be readable before the cards scatter
      await wait(GATHER_HOLD)
    }
    // Hand the step the card BOXES, not the tilted nodes: a rotated node's bounding
    // rect is the box around it (I6). The step raises its own flyers, unwinds the
    // tilt in flight and commits them to the heap — so the carrier's are dropped in
    // the same turn the step's appear.
    const gone = sendToDiscard(
      items.map((it, i) => ({
        key: `o${i}`,
        card: it.card,
        from: boxes[i],
        pose: gather ? { rot: heap[i].rot, dx: 0, dy: 0 } : undefined,
        layer: i,
      })),
    )
    drop()
    await gone
  }

  // ===== the draw =====
  async function drawFlow() {
    if (busy || centerCard || eliminated) return
    setBusy(true)
    const deckRect = deckRef.current?.getBoundingClientRect()
    const centerRect = centerRef.current?.getBoundingClientRect()
    if (deckRect && centerRect) {
      const from = cardAreaOf(deckRect)
      const [el] = await raise([{ key: 'draw', card: ERROR503_CARD, at: from, faceDown: true }])
      if (el) {
        const anim = play('drawToCenter', el, { from, to: centerRect })
        if (anim) await anim.finished
        pin('draw', centerRect) // I4 — it stands at the centre, the flip plays in place
      }
    }
    await wait(180)
    patch('draw', { faceDown: false }) // flip face up for everyone
    await wait(560)
    // drawn from the deck → lands straight at the centre (no tilt)
    setCenterCard(ERROR503_CARD)
    drop('draw')

    // Monitoring auto-neutralizes: a brief reveal at the centre, then to discard,
    // no glow. Monitoring stays in the zone.
    if (rel.monitoring) {
      setDock('push')
      await wait(COVER_HOLD) // neutralized, and held open like any other answer
      const cRect = centerRef.current?.getBoundingClientRect()
      setCenterCard(null)
      if (cRect) await sweep([{ card: ERROR503_CARD, fromRect: cRect }], false)
      setBusy(false)
      return
    }

    // no Monitoring: the 503 stays, red glow on, the hand greys out (only
    // Debugger stays colour + playable), the dock enters the danger reaction.
    setAlert(true)
    setPending(true)
    setDock('reaction')
    const canDefend =
      handItems.some((h) => h.card.id === DEBUGGER) || Boolean(rel.frontend) || Boolean(rel.backend)
    if (!canDefend) {
      await wait(2500) // defenceless — knocked out after a beat
      await eliminate(false)
      return
    }
    setBusy(false) // hand off to the player: drag a defence or PASS
  }

  // ===== defence by drag =====

  // the table takes the card; the player's own area (release zone + hand) gives it
  // back. Everything else on screen is table.
  const onTable = (x: number, y: number) => {
    const you = youRef.current?.getBoundingClientRect()
    return !you || y < you.top || x < you.left || x > you.right
  }

  function beginDrag(
    el: HTMLElement,
    e: React.MouseEvent,
    base: Omit<DragState, 'cx' | 'cy' | 'fracX' | 'fracY' | 'originCx' | 'originCy' | 'startW'>,
  ) {
    e.preventDefault() // don't start a text selection on pick-up
    const r = el.getBoundingClientRect()
    setDrag({
      ...base,
      cx: e.clientX,
      cy: e.clientY,
      fracX: (e.clientX - r.left) / r.width, // grab point inside the card (0..1)
      fracY: (e.clientY - r.top) / r.height,
      originCx: r.left + r.width / 2,
      originCy: r.top + r.height / 2,
      startW: r.width,
    })
  }
  // the hand is on the canonical Hand: dragging the Debugger onto the 503 plays
  // it. onPlay is accepted only for the Debugger dropped on the 503; anything
  // else is rejected and the Hand glides the card back.
  function handPlay(uid: string, dropped: HandPlayDrop): boolean {
    if (!pending || busy) return false
    const item = handItems.find((x) => x.uid === uid)
    if (!item || item.card.id !== DEBUGGER) return false
    const c = centerRef.current?.getBoundingClientRect()
    if (!c) return false
    if (!onTable(dropped.x, dropped.y)) return false
    void neutralizeWithDebugger(uid, item.card, dropped.rect ?? c)
    return true
  }
  // where an answer comes to rest: over the alarm, nudged so both are readable
  const coverRect = (): Rect | undefined => {
    const c = centerRef.current?.getBoundingClientRect()
    return c && { left: c.left + COVER_DX, top: c.top + COVER_DY, width: c.width, height: c.height }
  }

  // the alarm and the answer leave together — one exchange, the alarm underneath
  function discardExchange(
    answer: CardType,
    from: Rect,
    aux?: CardType | null,
    el?: HTMLElement | null,
  ) {
    const rect503 = centerRef.current?.getBoundingClientRect()
    const leaving: Leaving[] = []
    if (rect503) leaving.push({ key: 'e503', card: ERROR503_CARD, from: rect503, layer: 0 })
    // the answer leaves from the pose it was standing in, so the step unwinds the
    // tilt during the flight instead of straightening the card on hand-off
    leaving.push({ key: 'def', card: answer, aux, el, from, pose: COVER_POSE, layer: 1 })
    return sendToDiscard(leaving)
  }

  // Debugger played from the hand: it flies to the centre and covers the 503 —
  // the same journey the release makes, so an answer always reads the same way
  async function neutralizeWithDebugger(uid: string, card: CardType, fromRect: DOMRect) {
    setPending(false)
    setBusy(true)
    setAlert(false)
    setHandItems((h) => h.filter((x) => x.uid !== uid))
    const to = coverRect()
    if (to) {
      const [el] = await raise([{ key: 'cover', card, at: fromRect }])
      if (el) {
        const anim = play('playToCenter', el, { from: fromRect, to, rotate: COVER_POSE.rot })
        if (anim) await anim.finished
        // I4 is declined here on purpose: the landing tilt lives in the filled
        // animation, and pinning cancels it — the card would straighten for the
        // whole time it stands over the alarm. It is dropped after the exit
        // instead, which is the documented way out (see useFlyer).
      }
      await wait(COVER_HOLD)
      setCenterCard(null)
      const gone = discardExchange(card, to)
      drop('cover')
      await gone
    }
    setDock('push')
    setBusy(false)
  }
  // which release can answer the 503 right now — the zone reads this for both the
  // highlight and the grab, so what lights up is exactly what can be taken
  const grabbable = (key: SlotKey) =>
    pending && !busy && !drag && (key === 'frontend' || key === 'backend') && Boolean(rel[key])

  function onRelDown(e: React.MouseEvent, key: SlotKey) {
    if (!pending || busy || drag) return
    const s = rel[key]
    if (!s) return
    beginDrag(e.currentTarget as HTMLElement, e, {
      kind: 'release',
      slot: key,
      main: s.main,
      aux: s.aux,
    })
  }

  // drag lifecycle: the flyer is picked up EXACTLY where it was grabbed (same
  // position + size), then eases to the normal card size while the grab point
  // stays under the cursor (no snap-to-centre); on release, hit-test the 503
  // biome-ignore lint/correctness/useExhaustiveDependencies: drag is the trigger; handlers use the closures captured when the drag began
  useEffect(() => {
    if (!drag) return
    // one rAF loop drives BOTH the size ease and the position each frame, so the
    // grabbed point stays exactly under the cursor while the card resizes (no
    // resize-from-corner-then-snap)
    const ResizeMs = 200
    const cursor = { x: drag.cx, y: drag.cy }
    const start = performance.now()
    let raf = 0
    const frame = (now: number) => {
      const node = dragRef.current
      if (node) {
        const t = Math.min(1, (now - start) / ResizeMs)
        const ease = 1 - (1 - t) ** 3
        const w = drag.startW + (CARD_W - drag.startW) * ease
        const h = (w * CARD_H) / CARD_W
        node.style.width = `${w}px`
        node.style.left = `${cursor.x - drag.fracX * w}px`
        node.style.top = `${cursor.y - drag.fracY * h}px`
      }
      raf = requestAnimationFrame(frame)
    }
    const el = dragRef.current
    if (el) el.style.transition = 'none'
    raf = requestAnimationFrame(frame)

    const onMove = (e: MouseEvent) => {
      cursor.x = e.clientX
      cursor.y = e.clientY
    }
    const onUp = (e: MouseEvent) => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (onTable(e.clientX, e.clientY)) void resolveDefense(drag)
      else void returnDrag(drag)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag])

  // dropped on the 503 → cover it at the centre, then both (and any attached
  // Code Review) go to the discard
  async function resolveDefense(d: DragState) {
    setBusy(true)
    setPending(false)
    const to = coverRect()
    const el = dragRef.current
    if (el && to) {
      // the dragged card finishes its own journey: it settles over the alarm at the
      // cover spot and at the normal width (a quick drag can end mid-resize)
      el.style.transition =
        'left 240ms var(--ease-out), top 240ms var(--ease-out), width 240ms var(--ease-out), transform 240ms var(--ease-out)'
      el.style.left = `${to.left}px`
      el.style.top = `${to.top}px`
      el.style.width = `${CARD_W}px`
      // the tilt arrives WITH the card rather than a frame after it stops (I7)
      el.style.transform = restTransform(COVER_POSE)
      await wait(300)
      await wait(COVER_HOLD) // …and both stand open, exactly as long as any answer
    }
    // Hand the defence to the shared exit step AS A PAIR and let it do what it
    // does everywhere else: it measures the tilted aux half itself, trims that box
    // back to a card box (I6) and unwinds the tilt DURING the flight. Feeding it
    // two straightened rects instead is what made the Code Review shift — the
    // trimmed box was right, but the card still snapped upright on hand-off.
    //
    // What it is handed as `from` is the COVER BOX, not the element's rect: the
    // card now rests at a tilt, so its bounding rect is the box around the tilt
    // and would start the flight one size too big. The tilt itself travels as
    // `pose`, which is what the step wants — a card box plus the pose it stands in.
    setAlert(false)
    // the pair is still ON SCREEN while the step measures it (Combo's rule) — only
    // then is the drag taken down, in the same turn React commits
    const gone = to ? discardExchange(d.main, to, d.aux, el) : Promise.resolve()

    // debugger leaves the hand → the fan closes the gap (like Deck animations);
    // tell the fan the mouse left so it doesn't leave a card lit up
    if (d.kind === 'debugger' && d.uid) {
      setHandItems((h) => h.filter((x) => x.uid !== d.uid))
      clearHandHover()
    } else if (d.slot) setRel((r) => ({ ...r, [d.slot as SlotKey]: undefined }))
    setCenterCard(null)
    setDrag(null)
    await gone
    setDock('push')
    setBusy(false)
  }

  // released off-target → glide (and shrink) the card back into its slot
  async function returnDrag(d: DragState) {
    const el = dragRef.current
    if (el) {
      const h = (d.startW * CARD_H) / CARD_W
      el.style.transition =
        'left 240ms var(--ease-out), top 240ms var(--ease-out), width 240ms var(--ease-out)'
      el.style.width = `${d.startW}px`
      el.style.left = `${d.originCx - d.startW / 2}px`
      el.style.top = `${d.originCy - h / 2}px`
      await wait(260)
    }
    setDrag(null)
  }

  // ===== elimination =====
  async function eliminate(includeRelease: boolean) {
    if (busy && !pending) return
    // …and only ONE elimination at a time. The defenceless path is already running
    // (busy AND pending), so PASS during its beat used to start a second one — two
    // sweeps, two videos, one after the other.
    if (eliminating.current) return
    eliminating.current = true
    setBusy(true)
    setPending(false)
    const handRects = handSlotRects()
    const items: { card: CardType; fromRect: DOMRect }[] = handItems
      .map((hi, i) => ({ card: hi.card, fromRect: handRects[i] }))
      .filter((x): x is { card: CardType; fromRect: DOMRect } => Boolean(x.fromRect))
    if (includeRelease) {
      for (const key of SLOTS) {
        const s = rel[key]
        const node = relSlotRefs.current[key]
        if (s && node) {
          const r = node.getBoundingClientRect()
          items.push({ card: s.main, fromRect: r })
          if (s.aux) items.push({ card: s.aux, fromRect: r })
        }
      }
    }
    setAlert(false)
    setHandItems([])
    if (includeRelease) setRel({})
    setCenterCard(null)
    await sweep(items, true)
    // the board settles into the eliminated state under the video, which plays
    // for everyone; when it lifts the "you are out" state is already in place
    setEliminated(true)
    setDock('waiting')
    await playEliminationGif()
    eliminating.current = false
    setBusy(false)
  }

  return (
    <div className={`${styles.root} ${drag ? styles.dragging : ''}`}>
      <TechBar>
        <TechButton onClick={() => applyScene(dbg, rel1, relCR, mon)}>
          {pick(lang, { ru: 'рестарт', en: 'restart' })}
        </TechButton>
        {(
          [
            { on: dbg, set: setDbg, label: 'Debugger' },
            { on: rel1, set: setRel1, label: 'Release' },
            { on: relCR, set: setRelCR, label: 'Release + Code Review' },
            { on: mon, set: setMon, label: 'Monitoring' },
          ] as const
        ).map((t) => (
          <TechToggle key={t.label} on={t.on} onChange={() => t.set((v) => !v)}>
            {t.label}
          </TechToggle>
        ))}
        <HoverSelect
          label="gif"
          value={gifPick}
          options={[
            { value: 'random', label: pick(lang, { ru: 'случайная', en: 'random' }) },
            ...ELIM_VIDEOS.map((_, i) => ({ value: String(i), label: `Gif ${i + 1}` })),
          ]}
          onChange={setGifPick}
        />
      </TechBar>
      <div className={styles.stage}>
        {/* draw deck — left-centre */}
        <div className={styles.decks} ref={deckRef}>
          <Pile
            label={pick(lang, { ru: 'колода', en: 'deck' })}
            deck="base"
            count={40}
            width={150}
            countPos="tl"
          />
        </div>

        {/* centre staging — the 503 comes out here; defence covers it here */}
        <div
          className={styles.center}
          style={centrePlaceStyle('reveal', 'centre')}
          ref={centerRef}
          {...slotProps(centerCard)}
        >
          {centerCard && (
            <div className={styles.centerCard}>
              <Card card={centerCard} interactive={false} width="100%" />
            </div>
          )}
        </div>

        {/* discard — right of centre; cards land scattered (a tossed heap) */}
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

        {/* turn dock — bottom-left */}
        <div className={styles.turnDock}>
          <TurnDock
            state={dock}
            danger={dock === 'reaction'}
            seconds={20}
            progress={1}
            activePlayer={WAITING_PLAYER}
            copy={turnCopy}
            onDraw={dock === 'draw' ? drawFlow : undefined}
            onPass={pending ? () => eliminate(true) : undefined}
          />
        </div>

        {/* the edge glow fills the table zone, which is exactly the stage */}
        {previewOverlay}

        <div className={styles.glowBounds}>
          <EdgeGlow visible={alert} intensity="strong" />
        </div>

        {/* release zone + hand — bottom-centre. Cross-fades to the "you are out"
            badge (release zone gone) when the player is knocked out, as on Table */}
        <div className={styles.you} ref={youRef}>
          <div className={styles.playArea} data-hidden={eliminated}>
            {/* the zone reflects what the scene decided and hands the grab back:
                a release that can answer the 503 lights in its category accent, and
                the one being dragged shows its empty place instead of a hole */}
            <ReleaseZone
              size="100px"
              release={Object.fromEntries(SLOTS.map((key) => [key, rel[key]?.main]))}
              support={Object.fromEntries(SLOTS.map((key) => [key, rel[key]?.aux]))}
              slotRef={(key, el) => {
                relSlotRefs.current[key] = el
              }}
              accentAt={(key) => {
                const card = rel[key]?.main
                return grabbable(key) && card ? CATEGORIES[card.category]?.accent : undefined
              }}
              liftedAt={(key) => drag?.kind === 'release' && drag.slot === key}
              onSlotDown={(key, e) => {
                if (grabbable(key)) onRelDown(e, key)
              }}
            />

            <div className={styles.handWrap} ref={handWrapRef}>
              <Hand
                items={handItems}
                // during the 503 window only the Debugger is playable; the rest grey
                // out (Hand owns the transitioned dim)
                stateAt={
                  pending
                    ? (i) => (handItems[i]?.card.id === DEBUGGER ? 'playable' : 'disabled')
                    : undefined
                }
                onReorder={
                  busy ? undefined : (uid, to) => setHandItems((h) => reorderHand(h, uid, to))
                }
                onPlay={busy ? undefined : handPlay}
              />
            </div>
          </div>

          <div className={styles.eliminated} data-shown={eliminated} aria-hidden={!eliminated}>
            <Badge size="lg">{tableCopy.youEliminated}</Badge>
          </div>
        </div>

        {/* every card this scene has in the air — the shared carrier, and the
            discard step's own overlay (it raises its own flyers for a card handed
            over as a rect rather than as an element) */}
        {flyerOverlay}
        {discardOverlay}

        {/* the card being dragged as a defence */}
        {drag && (
          <div className={styles.dragFlyer} ref={dragRef} style={{ width: CARD_W }}>
            {drag.aux ? (
              <CardPair main={drag.main} aux={drag.aux} width="100%" />
            ) : (
              <Card card={drag.main} interactive={false} width="100%" />
            )}
          </div>
        )}

        {/* elimination video — full-screen for everyone; loops for at least
            ELIM_MIN_MS, then finishes the current loop and fades out */}
        {gif && (
          <div className={styles.gifOverlay}>
            <video
              // a media element does NOT re-fetch when `src` changes: keyed by the
              // source, so a different video is a different element (I5)
              key={gif}
              className={styles.gifVideo}
              src={gif}
              autoPlay
              muted
              playsInline
              onEnded={onGifEnded}
            />
          </div>
        )}
      </div>
    </div>
  )
}
