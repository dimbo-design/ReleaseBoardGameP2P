import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { play, useCardReorder } from '@/animations'
import { CARDS } from '@/cards'
import type { Card as CardType } from '@/cards/types'
import { nextHandUid } from '@/mocks/hand'
import Card, { CARD_RATIO, cardAreaOf } from '@/primitives/Card'
import Pile from '@/primitives/Pile'
import Typography from '@/primitives/Typography'
import ConfirmAction from '@/table/ConfirmAction'
import { pick, useLang } from '../../../Playground/lang'
import TechBar from '../../controls/TechBar'
import { TechButton, TechSwitch, TechToggle } from '../../controls/TechControls'
import styles from './GitCards.module.css'

// "Git Rebase" — look at the top 3 cards of a draw deck and reorder them
// secretly. Rows are numbered 1-3 on top (1 = the new top of the deck).
//  base: one deck. With one deck in play the cards come straight out; with
//        several, you first pick which deck.
//  sudo: apply to EVERY draw deck at once — one row of 3 per deck, sharing the
//        single 1-2-3 numbering on top.
const BASE = CARDS.filter((c) => c.deck === 'base')
const DECK_COUNTS = [1, 2, 3, 4, 5] as const // technical toggle: number of draw decks

const DECK_W = 150 // draw-deck pile width — same as the Table screen
const REORDER_W = 150 // reorder card width — full size (never shrunk; the area scrolls)
const GAP = 30 // gap between slots in a row
const STEP = REORDER_W + GAP // slot pitch
const ROW_W = REORDER_W * 3 + GAP * 2 // a full row of 3 slots
const ROW_H = Math.round(REORDER_W * CARD_RATIO) // row height (reserves the card)
const ROWS_GAP = 24 // gap between per-deck rows

// timings — deliberately unhurried (a human is reading the cards, not a robot)
const DEAL_DUR = 520 // cards fly out of the deck into the reorder
const DEAL_STEP = 80 // per-card stagger dealing out
const DEAL_HOLD = 200 // settle before the row is interactive
const FLIP_DUR = 420 // = the flipCard preset (flip face-down before flying back)
const FLIP_HOLD = 260 // hold face-down before the flight
const BACK_DUR = 600 // = the returnToDeck flight
const BACK_STEP = 90 // per-card stagger flying back

type DeckCount = (typeof DECK_COUNTS)[number]
type Phase = 'idle' | 'pick' | 'deal' | 'order' | 'resolve' | 'done'

interface RCard {
  uid: string
  card: CardType
}
// One deck's top-3, in current (committed) order: index 0 = position 1 = top.
interface Row {
  deckId: number
  cards: RCard[]
}
// the draw decks in play, derived from the toggle (counts are cosmetic)
const decksFor = (n: DeckCount) =>
  Array.from({ length: n }, (_, i) => ({ id: i, count: 22 - i * 2 }))

const buildRow = (deckId: number): Row => ({
  deckId,
  cards: Array.from({ length: 3 }, () => ({
    uid: nextHandUid(),
    card: BASE[Math.floor(Math.random() * BASE.length)],
  })),
})

export default function Rebase({ selector }: { selector: ReactNode }) {
  const { lang } = useLang()
  const [sudo, setSudo] = useState(false)
  const [decksN, setDecksN] = useState<DeckCount>(1)
  const [phase, setPhase] = useState<Phase>('idle')
  const [rows, setRows] = useState<Row[]>([])
  const [faceDown, setFaceDown] = useState(false) // flip on resolve (secret order)

  const cardEls = useRef<Map<string, HTMLElement>>(new Map())
  const deckRefs = useRef<Map<number, HTMLElement>>(new Map())
  const timers = useRef<number[]>([])

  const reorder = useCardReorder({
    enabled: phase === 'order',
    step: STEP,
    rows: rows.map((row) => ({ id: row.deckId, cards: row.cards.map((c) => c.uid) })),
    onReorder: (id, order) =>
      setRows((current) =>
        current.map((row) =>
          row.deckId === id
            ? { ...row, cards: order.flatMap((uid) => row.cards.filter((c) => c.uid === uid)) }
            : row,
        ),
      ),
  })

  const decks = decksFor(decksN)

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
  }
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms))
  useEffect(() => {
    const pool = timers.current
    return () => {
      for (const t of pool) window.clearTimeout(t)
    }
  }, [])

  // deal: on entering 'deal', each card flies from its deck straight to its FINAL
  // slot in the (constant) order layout — pinned position:fixed for the flight so
  // the scroll container never clips it, then released back in-flow at the exact
  // same spot. Nothing shifts when 'order' begins → no teleport between layouts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on entering 'deal'
  useLayoutEffect(() => {
    if (phase !== 'deal') return
    let maxDelay = 0
    rows.forEach((row) => {
      const deckEl = deckRefs.current.get(row.deckId)
      if (!deckEl) return
      const dc = cardAreaOf(deckEl.getBoundingClientRect())
      row.cards.forEach((c, idx) => {
        const el = cardEls.current.get(c.uid)
        if (!el) return
        const slot = el.getBoundingClientRect() // final resting rect (in-flow at its slot)
        const delay = idx * DEAL_STEP
        maxDelay = Math.max(maxDelay, delay)
        // pin at the slot, offset to the deck, then glide the offset back to zero
        el.style.position = 'fixed'
        el.style.left = `${slot.left}px`
        el.style.top = `${slot.top}px`
        el.style.width = `${slot.width}px`
        el.style.margin = '0'
        el.style.zIndex = '40'
        el.style.transition = 'none'
        el.style.transform = `translate(${dc.left - slot.left}px, ${dc.top - slot.top}px)`
        el.style.opacity = '0'
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            el.style.transition = `transform ${DEAL_DUR}ms var(--ease-out) ${delay}ms, opacity ${DEAL_DUR}ms ${delay}ms`
            el.style.transform = 'translate(0, 0)'
            el.style.opacity = '1'
          }),
        )
        // release back in-flow at the SAME slot once the flight lands. Suppress
        // the transition across the fixed→absolute switch (position base changes
        // from the slot to the row origin, so the transform value jumps from 0 to
        // slot*STEP) — otherwise .orderCard's transition animates that jump and
        // the card visibly slides in a second time. Reflow, then hand the
        // transition back for drag/drop.
        later(
          () => {
            el.style.transition = 'none'
            el.style.position = ''
            el.style.left = ''
            el.style.top = ''
            el.style.width = ''
            el.style.margin = ''
            el.style.zIndex = ''
            el.style.opacity = ''
            el.style.transform = `translate(${idx * STEP}px, 0)`
            void el.offsetWidth
            el.style.transition = ''
          },
          DEAL_DUR + delay + 30,
        )
      })
    })
    later(() => setPhase('order'), DEAL_DUR + maxDelay + DEAL_HOLD)
  }, [phase])

  function toIdle() {
    clearTimers()
    setRows([])
    setFaceDown(false)
    setPhase('idle')
  }

  function start() {
    setFaceDown(false)
    // sudo → every deck at once; a single deck → straight to the cards; otherwise
    // (base, several decks) → pick which deck first
    if (sudo) {
      setRows(decks.map((d) => buildRow(d.id)))
      setPhase('deal')
    } else if (decksN === 1) {
      setRows([buildRow(0)])
      setPhase('deal')
    } else {
      setPhase('pick')
    }
  }

  function pickDeck(id: number) {
    if (phase !== 'pick') return
    setRows([buildRow(id)])
    setPhase('deal')
  }

  // fly each row's cards (now face-down) back onto their deck, in the chosen
  // order. Freeze to a fixed box at the current spot first so the flight starts
  // exactly where the card is (no jump off the slot-index transform).
  function flyBackToDecks() {
    rows.forEach((row) => {
      const deckEl = deckRefs.current.get(row.deckId)
      if (!deckEl) return
      const dc = cardAreaOf(deckEl.getBoundingClientRect())
      row.cards.forEach((c, i) => {
        const el = cardEls.current.get(c.uid)
        if (!el) return
        const r = el.getBoundingClientRect()
        el.style.transition = 'none'
        el.style.transform = 'none'
        el.style.position = 'fixed'
        el.style.left = `${r.left}px`
        el.style.top = `${r.top}px`
        el.style.width = `${r.width}px`
        el.style.margin = '0'
        el.style.zIndex = `${50 + (2 - i)}` // position 1 lands on top of the deck
        later(
          () => play('returnToDeck', el, { from: r, to: dc, duration: BACK_DUR }),
          i * BACK_STEP,
        )
      })
    })
  }

  function confirm() {
    if (phase !== 'order' || reorder.drag) return
    setPhase('resolve')
    setFaceDown(true) // the reordered cards flip face-down — the order stays secret
    later(flyBackToDecks, FLIP_DUR + FLIP_HOLD)
    later(() => setPhase('done'), FLIP_DUR + FLIP_HOLD + BACK_DUR + 2 * BACK_STEP + 280)
  }

  function restart() {
    toIdle()
  }
  function changeSudo(v: boolean) {
    setSudo(v)
    toIdle()
  }
  function changeDecks(n: DeckCount) {
    setDecksN(n)
    toIdle()
  }

  const showCards = phase === 'deal' || phase === 'order' || phase === 'resolve'
  const deckWord = pick(lang, { ru: 'колода', en: 'deck' })
  const pickHint = pick(lang, { ru: 'выбери колоду добора', en: 'pick a draw deck' })
  const orderHint = pick(lang, {
    ru: 'перетаскиванием задай порядок · 1 — верх колоды',
    en: 'drag to set the order · 1 = top of deck',
  })

  return (
    <div className={styles.root}>
      <TechBar>
        {selector}
        <span className={styles.sep} />
        <TechButton onClick={restart}>{pick(lang, { ru: 'рестарт', en: 'restart' })}</TechButton>
        <TechToggle on={sudo} onChange={changeSudo}>
          sudo
        </TechToggle>
        <TechSwitch
          label={pick(lang, { ru: 'колод', en: 'decks' })}
          options={DECK_COUNTS.map((n) => ({ value: n, label: String(n) }))}
          value={decksN}
          onChange={changeDecks}
        />
      </TechBar>
      <div className={styles.stage}>
        {/* draw decks — same placement/behaviour as the Table screen: a 2-row grid
            that flows into columns (Git Branch splits grow it rightward), full-size
            Pile (150). Pickable in the 'pick' phase, dimmed under the overlay. */}
        <div className={styles.decks}>
          {decks.map((d) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only deck pick in a sandbox story
            <div
              key={d.id}
              ref={(el) => {
                if (el) deckRefs.current.set(d.id, el)
                else deckRefs.current.delete(d.id)
              }}
              className={`${styles.deck} ${phase === 'pick' ? styles.deckPickable : ''}`}
              onMouseDown={phase === 'pick' ? () => pickDeck(d.id) : undefined}
            >
              <Pile
                label={decksN > 1 ? `${deckWord} ${d.id + 1}` : deckWord}
                deck="base"
                count={d.count}
                width={DECK_W}
                countPos="tl"
                selected={phase === 'pick'}
              />
            </div>
          ))}
        </div>

        {/* idle: the start button in the centre */}
        {phase === 'idle' && (
          <div className={styles.startSlot}>
            <button type="button" className={styles.callBtn} onClick={start}>
              git rebase
            </button>
          </div>
        )}

        {(phase === 'pick' || showCards) && (
          <div className={`${styles.scrim} ${showCards ? styles.scrimOver : ''}`} />
        )}

        {/* the reorder area — the 1-2-3 numbering once on top, then one full-size
            row per deck. The whole area scrolls when there are too many rows to fit
            (cards keep full size); the dragged card follows the pointer via
            transform and glides into its slot on drop. */}
        {showCards && (
          <div className={styles.orderWrap} data-bar={phase === 'order'}>
            <div
              className={`${styles.numHeader} ${phase === 'resolve' ? styles.chromeOut : styles.chromeIn}`}
              style={{ gap: GAP }}
            >
              {[1, 2, 3].map((n) => (
                <span key={n} className={styles.num} style={{ inlineSize: REORDER_W }}>
                  {n}
                </span>
              ))}
            </div>
            <div className={styles.rows} style={{ gap: ROWS_GAP }}>
              {rows.map((row) => (
                <div
                  key={row.deckId}
                  className={styles.orderRow}
                  style={{ inlineSize: ROW_W, blockSize: ROW_H }}
                >
                  {/* which deck this row is. Only with several decks: with one
                      there is nothing to tell apart. It matters most when a
                      single deck was PICKED out of several — the row is alone on
                      screen and otherwise says nothing about which one it is. */}
                  {decksN > 1 && (
                    <Typography
                      base="label-sm"
                      tk="tk-14"
                      className={`${styles.rowLabel} ${
                        phase === 'resolve' ? styles.chromeOut : styles.chromeIn
                      }`}
                    >
                      {`${deckWord} ${row.deckId + 1}`}
                    </Typography>
                  )}
                  {row.cards.map((c, idx) => {
                    const position = reorder.position(row.deckId, c.uid, idx)
                    const style = {
                      inlineSize: REORDER_W,
                      transform: `translate(${position.x}px, ${position.y}px)`,
                    }
                    return (
                      <div
                        key={c.uid}
                        ref={(el) => {
                          if (el) cardEls.current.set(c.uid, el)
                          else cardEls.current.delete(c.uid)
                        }}
                        className={`${styles.orderCard} ${position.dragging ? styles.dragging : ''}`}
                        style={style}
                        onPointerDown={(e) => reorder.onPointerDown(row.deckId, c.uid, e)}
                      >
                        <Card
                          card={c.card}
                          faceDown={faceDown}
                          interactive={false}
                          width={REORDER_W}
                        />
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === 'pick' && (
          <div className={styles.rbHint}>
            <span className={styles.hint}>{pickHint}</span>
          </div>
        )}

        {/* confirm — the shared slide-up bar; the drag hint rides in its caption */}
        <ConfirmAction
          open={phase === 'order'}
          label={pick(lang, { ru: 'подтвердить', en: 'confirm' })}
          caption={orderHint}
          onConfirm={confirm}
        />
      </div>
    </div>
  )
}
