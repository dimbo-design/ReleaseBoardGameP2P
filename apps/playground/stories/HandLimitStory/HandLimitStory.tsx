import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { play, type Scatter, useDiscardExit, useFlyer, useHandArrival, wait } from '@/animations'
import { CARDS } from '@/cards'
import type { Card as CardType } from '@/cards/types'
import Card from '@/primitives/Card'
import Pile from '@/primitives/Pile'
import Typography from '@/primitives/Typography'
import Hand from '@/table/Hand'
import { handStep } from '@/table/Hand/fan'
import type { HandItem, HandPlayDrop } from '@/table/Hand/Hand'
import { GRID_GAP, GRID_TOP, gridCardW, gridOf } from '@/table/TableCentre/discardGrid'
import { pick, useLang } from '../../Playground/lang'
import HoverSelect from '../controls/HoverSelect'
import TechBar from '../controls/TechBar'
import { TechButton } from '../controls/TechControls'
import { reorderHand } from '../interactive/reorderHand'
import styles from './HandLimitStory.module.css'

// Hand limit — discarding down to the end-of-turn hand limit (the `handLimit`
// pending). The canonical Hand, plus the one rule that drives it: while the hand
// is OVER the limit a card can be pulled out of the fan to discard it; at or
// under the limit the fan rejects the drop and the card glides back.
//
// The discarded cards do NOT go to the heap one by one. They build a GRID at the
// centre — open, so the opponents read the whole cost of the turn — and only when
// the last excess card lands does the finished grid leave for the discard. The
// count is known before the first card moves (excess = hand − limit), so the grid
// shape is chosen upfront and every card flies straight to its own cell. Nothing
// waits on anything: the hand is never blocked by a flight.

// hand filler — ordinary (non-trigger) base cards; the AI / Error 503 triggers
// can never sit in a hand (rules: setup returns them to the deck)
const HAND_POOL = CARDS.filter((c) => c.deck === 'base' && c.category !== 'trigger')

// end-of-turn hand limit variants (rules → "Лимит карт в руке"): Base = no
// limit, 8 bit = 8, Memory Problem = 5
const LIMITS = [5, 8, Number.POSITIVE_INFINITY]
// hand sizes to deal — also the screen reset (re-deals and empties the discard)
const SIZES = [4, 6, 9, 13]

const GRID_HOLD = 1500 // the finished grid is held open before it leaves
const CLEAR_STEP = 90 // per-card stagger, grid → discard

// a card at rest in the discard — carries its own scatter (tilt + offset)
interface DiscardEntry extends Scatter {
  card: CardType
}
// a card that has landed in the grid, in its own cell
interface Placed {
  card: CardType
  slot: number
}
// a card being carried back out of the grid: its cell, its size, and where in it
// the cursor took hold — so it does not jump to its own corner on pick-up
interface Back extends Placed {
  w: number
  h: number
  fracX: number
  fracY: number
}

// how far above the fan still counts as "over the hand" — the Hand's own band
const BAND_PAD = 32

const makeHand = (n: number): HandItem[] =>
  HAND_POOL.slice(0, n).map((card, i) => ({ uid: `h${i}`, card }))

export default function HandLimitStory() {
  const { lang } = useLang()
  const [limit, setLimit] = useState(5)
  const [size, setSize] = useState(9)
  const [hand, setHand] = useState<HandItem[]>(() => makeHand(9))
  const [discard, setDiscard] = useState<DiscardEntry[]>([])
  // the open grid at the centre: `cells` is its fixed size for this turn (0 = no
  // grid yet), `placed` are the cards that have already landed in it
  const [cells, setCells] = useState(0)
  const [placed, setPlaced] = useState<Placed[]>([])

  // a card on its way back out of the grid, riding the cursor
  const [back, setBack] = useState<Back | null>(null)
  // where in the fan it would land right now — null while the pointer is away
  // from the hand. The fan opens this slot WHILE the card is still in the air, so
  // the place is shown before the drop rather than explained after it, exactly as
  // it works when a card is reordered inside the hand.
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  const backRef = useRef<HTMLDivElement>(null)
  const cursor = useRef({ x: 0, y: 0 })
  const handRef = useRef<HTMLDivElement>(null)
  const discardRef = useRef<HTMLDivElement>(null)
  const { send: sendToDiscard } = useDiscardExit(discardRef, (cards) =>
    setDiscard((d) => [...d, ...cards]),
  )
  const cellRefs = useRef<(HTMLDivElement | null)[]>([])
  // the cards in transit — several are in the air at once, so each carries its own
  // key. Discarding is "think, then dump fast": a flight must never gate the next drag.
  const { overlay: flyerOverlay, raise, drop } = useFlyer()
  // going back INTO the hand is the shared step, the same one a draw uses: the
  // fan opens in the middle and the card lands on a slot's own pivot. An undo
  // should read as the event it undoes, not as its own special move.
  const {
    overlay: arrivalOverlay,
    gapAt,
    gapSize,
    arrive,
  } = useHandArrival(handRef, (gap, list) =>
    setHand((h) => {
      const next = [...h]
      next.splice(gap, 0, ...list.map((l) => ({ uid: l.key, card: l.card })))
      return next
    }),
  )
  const flightSeq = useRef(0)
  // Which cells are spoken for — in flight or already filled. A SET and not a
  // counter, because a card can be taken back out of the grid and its cell has to
  // become free again for the next one.
  const claimed = useRef<Set<number>>(new Set())
  const landed = useRef(0) // cells actually filled — the last one flushes the grid
  const runId = useRef(0) // bumped on reset — a flight from a previous deal stops committing
  // grid size and contents mirrored as refs: the flights run across several
  // awaits and must not read a stale render's state (I8)
  const cellsRef = useRef(0)
  const placedRef = useRef<Placed[]>([])
  // the drag's handlers are the closure it began with (I8) — the slot the pointer
  // is over changes under them, so they read it through a ref
  const dropSlotRef = useRef<number | null>(null)
  dropSlotRef.current = dropSlot

  const excess = Math.max(0, hand.length - limit)
  const grid = gridOf(cells)
  const cardW = gridCardW(grid.rows)
  cellsRef.current = cells
  placedRef.current = placed

  // deal N cards — doubles as the screen reset (empties the discard and the grid,
  // so re-picking the same size replays the scene from scratch). Changing the
  // limit resets the same way: the grid is sized for one turn's excess, and that
  // number is exactly what the limit decides.
  const reset = (n: number, nextLimit: number) => {
    runId.current += 1
    claimed.current.clear()
    landed.current = 0
    setBack(null)
    cellRefs.current = []
    drop()
    setSize(n)
    setLimit(nextLimit)
    setHand(makeHand(n))
    setDiscard([])
    setPlaced([])
    setCells(0)
  }

  // the finished grid leaves for the discard, card by card with a short stagger
  const flushGrid = async (run: number) => {
    await wait(GRID_HOLD)
    if (runId.current !== run) return
    // the finished grid leaves through the shared step: every card on its own,
    // staggered, each flying the cell element it already occupies
    await sendToDiscard(
      placedRef.current.map((p) => ({
        key: `g${p.slot}`,
        card: p.card,
        node: cellRefs.current[p.slot],
        layer: p.slot,
        delay: p.slot * CLEAR_STEP,
      })),
    )
    if (runId.current !== run) return
    claimed.current.clear()
    landed.current = 0
    cellRefs.current = []
    setPlaced([])
    setCells(0)
  }

  // one card: hand → its own cell in the grid.
  // I8 — the card, its slot and its source rect come in as arguments.
  const flyToCell = async (card: CardType, slot: number, fromRect?: DOMRect) => {
    const run = runId.current
    const id = ++flightSeq.current
    if (!fromRect) return
    const key = `f${id}`
    // raising also lets the grid cells mount before they are measured
    const [el] = await raise([{ key, card, at: fromRect }])
    if (runId.current !== run) return
    const to = cellRefs.current[slot]?.getBoundingClientRect()
    if (el && to) {
      const anim = play('playToCenter', el, { from: fromRect, to })
      if (anim) await anim.finished
    }
    if (runId.current !== run) return
    // the real card takes over the cell as the flyer unmounts (same commit — no gap)
    drop(key)
    setPlaced((p) => [...p, { card, slot }])
    landed.current += 1
    if (landed.current === cellsRef.current) void flushGrid(run)
  }

  // the lowest cell nobody has claimed. Cells free up again when a card is taken
  // back out of the grid, so this is a search and not a running count.
  const freeSlot = () => {
    for (let i = 0; i < cellsRef.current; i += 1) if (!claimed.current.has(i)) return i
    return -1
  }

  // Where the pointer is pointing along the fan — the Hand's own arithmetic, from
  // the same handStep, so the card lands in the gap the player is looking at.
  // n+1 places for n cards: a card can go before the first and after the last.
  const slotAt = (clientX: number, n: number) => {
    const hr = handRef.current?.getBoundingClientRect()
    if (!hr) return Math.round(n / 2)
    const step = handStep(n + 1)
    const i = Math.round((clientX - (hr.left + hr.width / 2)) / step + n / 2)
    return Math.max(0, Math.min(n, i))
  }

  // ===== a card comes back out of the grid =====
  // The grid is a decision in progress, not a done deal: until it is full and
  // leaves, any card in it can be pulled back into the hand. The count still
  // adds up — the grid was sized for the WHOLE turn's excess, so a card returning
  // to the hand puts back exactly the one it will have to give up again.
  const startBack = (e: React.MouseEvent, card: CardType, slot: number) => {
    if (back) return
    const r = e.currentTarget.getBoundingClientRect()
    e.preventDefault()
    cursor.current = { x: e.clientX, y: e.clientY }
    claimed.current.delete(slot)
    landed.current -= 1
    setPlaced((p) => p.filter((x) => x.slot !== slot))
    setBack({
      card,
      slot,
      w: r.width,
      h: r.height,
      fracX: (e.clientX - r.left) / r.width,
      fracY: (e.clientY - r.top) / r.height,
    })
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: back is the trigger; the handlers use the closure captured when the drag began
  useEffect(() => {
    if (!back) return
    const place = () => {
      const el = backRef.current
      if (el) {
        el.style.left = `${cursor.current.x - back.fracX * back.w}px`
        el.style.top = `${cursor.current.y - back.fracY * back.h}px`
      }
    }
    place()
    const onMove = (e: MouseEvent) => {
      cursor.current = { x: e.clientX, y: e.clientY }
      place()
      const hr = handRef.current?.getBoundingClientRect()
      const over = hr ? e.clientY >= hr.top - BAND_PAD : false
      setDropSlot(over ? slotAt(e.clientX, hand.length) : null)
    }
    const onUp = async (e: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const hr = handRef.current?.getBoundingClientRect()
      const rect = backRef.current?.getBoundingClientRect()
      const overHand = hr ? e.clientY >= hr.top - BAND_PAD : false
      const at = dropSlotRef.current
      setDropSlot(null)
      if (overHand && rect) {
        setBack(null)
        // into the slot the POINTER named, not into the middle of the fan: the
        // hand just said where, and landing anywhere else ignores it
        void arrive(
          [{ key: `b${flightSeq.current++}`, card: back.card, from: rect }],
          hand.length,
          at ?? slotAt(e.clientX, hand.length),
        )
        return
      }
      // released anywhere else — the card FLIES BACK to the cell it came from.
      // Snapping would read as the drag having failed; the card simply goes home.
      const el = backRef.current
      const to = cellRefs.current[back.slot]?.getBoundingClientRect()
      if (el && rect && to) {
        const anim = play('playToCenter', el, { from: rect, to })
        if (anim) await anim.finished
      }
      claimed.current.add(back.slot)
      landed.current += 1
      setPlaced((p) => [...p, { card: back.card, slot: back.slot }])
      setBack(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [back])

  // pulled out of the fan → into the grid, but only while the hand is over the
  // limit; otherwise the drop is rejected and the Hand glides the card back
  const onPlay = (uid: string, dropped: HandPlayDrop): boolean => {
    if (hand.length <= limit) return false
    const card = hand.find((it) => it.uid === uid)?.card
    if (!card) return false
    // the first card of the turn fixes the grid: the count is known upfront
    if (cellsRef.current === 0) {
      cellsRef.current = excess
      setCells(excess)
    }
    const slot = freeSlot()
    if (slot < 0) return false
    claimed.current.add(slot)
    setHand((h) => h.filter((it) => it.uid !== uid))
    void flyToCell(card, slot, dropped.rect)
    return true
  }

  const limitLabel = (n: number) => (Number.isFinite(n) ? String(n) : '∞')

  return (
    <div className={styles.root}>
      <TechBar>
        <TechButton onClick={() => reset(size, limit)}>
          {pick(lang, { ru: 'рестарт', en: 'restart' })}
        </TechButton>
        <HoverSelect
          label={pick(lang, { ru: 'лимит руки', en: 'hand limit' })}
          value={String(limit)}
          options={LIMITS.map((n) => ({ value: String(n), label: limitLabel(n) }))}
          onChange={(v) => reset(size, Number(v))}
        />
        <HoverSelect
          label={pick(lang, { ru: 'раздать карт', en: 'deal cards' })}
          value={String(size)}
          options={SIZES.map((n) => ({ value: String(n), label: String(n) }))}
          onChange={(v) => reset(Number(v), limit)}
        />
        <div className={styles.readout} data-over={excess > 0}>
          <Typography base="mono-xs">
            {pick(lang, { ru: 'в руке', en: 'in hand' })}: <b>{hand.length}</b>
            {' · '}
            {pick(lang, { ru: 'лимит', en: 'limit' })}: <b>{limitLabel(limit)}</b>
            {excess > 0 && (
              <>
                {' · '}
                {pick(lang, { ru: 'сбросить', en: 'to discard' })}: <b>{excess}</b>
              </>
            )}
          </Typography>
        </div>
      </TechBar>
      <div className={styles.stage}>
        {/* the open grid at the centre — the turn's discard, laid out for everyone
            to read; empty cells show the shape that is being filled */}
        {cells > 0 && (
          <div
            className={styles.grid}
            // the row and the gap are the kit's own numbers (discardGrid.ts) —
            // a CSS module cannot import them, so they arrive inline, the same
            // idiom the board itself uses for GRID_TOP (`_Board.tsx`)
            style={{
              insetBlockStart: `${GRID_TOP}%`,
              gap: `${GRID_GAP}px`,
              gridTemplateColumns: `repeat(${grid.cols}, ${cardW}px)`,
            }}
          >
            {Array.from({ length: cells }, (_, i) => {
              const card = placed.find((p) => p.slot === i)?.card
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: the cells are a fixed grid, the index IS the slot
                  key={i}
                  className={styles.cell}
                  ref={(el) => {
                    cellRefs.current[i] = el
                  }}
                >
                  {card ? (
                    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only pick-up back into the hand; the discard itself is confirmed by the grid filling up
                    <div className={styles.cellCard} onMouseDown={(e) => startBack(e, card, i)}>
                      <Card card={card} interactive={false} width="100%" />
                    </div>
                  ) : (
                    <span className={styles.cellEmpty} />
                  )}
                </div>
              )
            })}
          </div>
        )}

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

        {/* hand — bottom-centre; over the limit every card is a valid discard.
            Never blocked by a flight in progress: the next card can be pulled out
            while the previous one is still on its way to its cell. */}
        <div className={styles.you}>
          <div className={styles.hint}>
            <Typography base="mono-xs">
              {excess > 0
                ? pick(lang, {
                    ru: 'вытащи карту из руки — она встанет в сетку сброса',
                    en: 'pull a card out of the hand — it takes a cell in the grid',
                  })
                : pick(lang, {
                    ru: 'лимит соблюдён — сбрасывать нечего',
                    en: 'within the limit — nothing to discard',
                  })}
            </Typography>
          </div>
          <div className={styles.handWrap} ref={handRef}>
            <Hand
              items={hand}
              gapAt={back ? dropSlot : gapAt}
              gapSize={back ? 1 : gapSize}
              carrying={back != null}
              stateAt={excess > 0 ? () => 'playable' : undefined}
              // any card is a valid discard — one uniform colour, not the per-category
              // accent (which would read as "this type is what fits"). The hue is the
              // context of the move: this pick COSTS a card, so it reads as a loss.
              accentAt={excess > 0 ? () => 'var(--danger-accent)' : undefined}
              onReorder={(uid, to) => setHand((h) => reorderHand(h, uid, to))}
              onPlay={onPlay}
            />
          </div>
        </div>

        {/* the card being carried back out of the grid — rides the cursor */}
        {back && (
          <div className={styles.backFlyer} ref={backRef} style={{ inlineSize: back.w }}>
            <Card card={back.card} interactive={false} width="100%" />
          </div>
        )}

        {/* the cards on their way to a cell — several can be in the air at once */}
        {flyerOverlay}
        {arrivalOverlay}
      </div>
    </div>
  )
}
