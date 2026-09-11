import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { HEAP_SHOW, play, scatterAt, useDiscardExit, useHandArrival } from '@/animations'
import { CARDS } from '@/cards'
import type { Card as CardType } from '@/cards/types'
import { nextHandUid } from '@/mocks/hand'
import Card from '@/primitives/Card'
import Pile from '@/primitives/Pile'
import ConfirmAction from '@/table/ConfirmAction'
import Hand from '@/table/Hand'
import { pick, useLang } from '../../../Playground/lang'
import TechBar from '../../controls/TechBar'
import { TechButton, TechSwitch, TechToggle } from '../../controls/TechControls'
import { reorderHand } from '../reorderHand'
import styles from './GitCards.module.css'

// "Git Cherry-pick" — pick a card out of the whole discard.
//  base: 1 card → your hand.
//  sudo: 2 cards → one to your hand, the other onto the top of the draw deck
//        (face-down; if there were several decks it lands on the first).
// TRIGGER cards (Error 503 and AI) must NOT go to the hand, but by the rules a
// trigger CAN be the sudo card that goes onto the deck — so a trigger is
// unpickable in base and, in sudo, only ever the deck card (a non-trigger always
// takes the hand slot).
// The discard is face-up and known — you just choose; extracting cards must not
// reshuffle it, the rest keep their order.
const BASE = CARDS.filter((c) => c.deck === 'base')
const isTrigger = (c: CardType) => c.category === 'trigger'
const TRIGGERS = BASE.filter(isTrigger)
const HAND_POOL = BASE.filter((c) => !isTrigger(c))
const INITIAL_HAND = 5
const DECK_START = 24
const GRID_W = 150 // discard card width in the selection grid (large, readable)
const DECK_W = 150 // draw-deck pile width — the Table screen's value
const PILE_W = 116 // discard pile width — the Table screen's value
const SIZES = [8, 54] as const // technical toggle: no-scroll vs scroll case

// timings
const DEAL_DUR = 360
const DEAL_STEP = 16 // per-card stagger, dealing out of the pile
const RETURN_DUR = 420 // = the centerToDiscard preset duration
const RETURN_STEP = 14 // per-card stagger, returning to the pile
const FLIP_DUR = 420 // = the flipCard preset duration (flip before the deck flight)
const DECK_DUR = 480 // = the returnToDeck preset duration
const DECK_HOLD = 360 // deck card holds face-down before it merges
const STAGGER_CAP = 40 // don't stagger past this many cards
// hand card, like the opponent-card stories: fly to centre, enlarge, hold, then
// the shared useHandArrival drop into the fan
const REVEAL_W = 220 // width the chosen card reaches in the centre
const REVEAL_DUR = 460 // fly-to-centre duration
const REVEAL_HOLD = 560 // pause in the centre before dropping into the hand
const HAND_MIN = REVEAL_DUR + REVEAL_HOLD + 520 // total before the round can finish

type DiscardSize = (typeof SIZES)[number]
type Phase = 'idle' | 'deal' | 'choose' | 'resolve' | 'done'
// Each card carries its own scatter (tilt + offset), from the shared discard
// module (scatterAt). Both the return flight (toDiscardParams) and the resting
// heap (restTransform) read these exact values, so a card lands where it rests —
// no re-layout / position swap at the end of the animation.
interface DiscardCard {
  uid: string
  card: CardType
  rot: number
  dx: number
  dy: number
}

// A shuffled discard with duplicates (as after a real game); every trigger type
// (503 + AI) is guaranteed present so the "no hand" rule is demonstrable.
function buildDiscard(n: number): DiscardCard[] {
  const arr = Array.from({ length: n }, () => BASE[Math.floor(Math.random() * BASE.length)])
  const used = new Set<number>()
  for (const t of TRIGGERS) {
    if (arr.some((c) => c.id === t.id)) continue
    let i = Math.floor(Math.random() * n)
    while (used.has(i)) i = (i + 1) % n
    used.add(i)
    arr[i] = t
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  // scatter is width-relative (PILE_W) and keyed by heap index, so the heap is
  // stable across re-renders and consistent with the other discard piles
  return arr.map((card, i) => ({ uid: nextHandUid(), card, ...scatterAt(i, PILE_W) }))
}

function makeHand(n: number) {
  return HAND_POOL.slice(0, n).map((card) => ({ uid: nextHandUid(), card }))
}

// centre-to-centre translate + scale to move an element from one rect to another
function between(from: DOMRect, to: DOMRect): string {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  return `translate(${dx}px, ${dy}px) scale(${to.width / from.width})`
}

export default function CherryPick({ selector }: { selector: ReactNode }) {
  const { lang } = useLang()
  const [sudo, setSudo] = useState(false)
  const [size, setSize] = useState<DiscardSize>(8)
  const [phase, setPhase] = useState<Phase>('idle')
  const [discard, setDiscard] = useState<DiscardCard[]>(() => buildDiscard(8))
  const [hand, setHand] = useState(() => makeHand(INITIAL_HAND))
  const [deckCount, setDeckCount] = useState(DECK_START)
  const [picks, setPicks] = useState<string[]>([]) // chosen uids, in order
  const [flipped, setFlipped] = useState<Set<string>>(new Set()) // deck card flips face-down

  const rootRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map())
  const deckRef = useRef<HTMLDivElement>(null)
  const discardRef = useRef<HTMLDivElement>(null)
  const { send: sendToDiscard } = useDiscardExit(discardRef)
  const handRef = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
  }
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms))
  useLayoutEffect(() => {
    const pool = timers.current
    return () => {
      for (const t of pool) window.clearTimeout(t)
    }
  }, [])

  // the chosen card settles into the hand fan (proven family insert)
  const {
    gapAt,
    gapSize,
    overlay,
    arrive,
    reset: resetInsert,
  } = useHandArrival(handRef, (gap, landed) => {
    setHand((h) => {
      const copy = [...h]
      copy.splice(gap, 0, ...landed.map((it) => ({ uid: it.key, card: it.card })))
      return copy
    })
  })

  // roles by the rules: a trigger (if chosen) is always the deck card; a
  // non-trigger always takes the hand slot; else first-chosen → hand, second → deck
  function rolesOf(sel: string[]) {
    const cardOf = (uid?: string) => discard.find((d) => d.uid === uid)?.card
    if (!sudo) return { handUid: sel[0] ?? null, deckUid: null as string | null }
    if (sel.length === 1) {
      const c = cardOf(sel[0])
      return c && isTrigger(c)
        ? { handUid: null as string | null, deckUid: sel[0] }
        : { handUid: sel[0], deckUid: null as string | null }
    }
    if (sel.length >= 2) {
      const [a, b] = sel
      const ca = cardOf(a)
      if (ca && isTrigger(ca)) return { handUid: b, deckUid: a }
      return { handUid: a, deckUid: b }
    }
    return { handUid: null as string | null, deckUid: null as string | null }
  }

  const max = sudo ? 2 : 1

  // A trigger may only ever hold the DECK slot, and that slot exists only when
  // two cards are taken (base: the only slot is the hand → forbidden). Stated
  // over the resulting SET rather than per candidate, because a swap has to be
  // judged the same way an addition is: by what the player is left holding.
  const legal = (set: string[]) =>
    set.filter((u) => {
      const c = discard.find((x) => x.uid === u)?.card
      return c && isTrigger(c)
    }).length <= (max === 2 ? 1 : 0)

  // What one click does. A picked card is released; an unpicked one joins while
  // there is room, and once there is none it takes the OLDEST pick's place
  // instead of being ignored — ignoring it is what made a mis-click
  // uncorrectable unless the player guessed that clicking the CHOSEN card
  // releases it. Returns `p` ITSELF when nothing changes, which is what lets
  // `canSelect` be "would this click do anything?" rather than a second copy of
  // these rules that can drift. Mirrors `_useCherryPickStaging.tsx` on the board.
  function nextPicks(p: string[], uid: string): string[] {
    if (p.includes(uid)) return p.filter((u) => u !== uid)
    const grown = p.length < max ? [...p, uid] : [...p.slice(1), uid]
    return legal(grown) ? grown : p
  }

  function canSelect(d: DiscardCard): boolean {
    return nextPicks(picks, d.uid) !== picks
  }

  function pickCard(d: DiscardCard) {
    if (phase !== 'choose') return
    setPicks((p) => nextPicks(p, d.uid))
  }

  const roles = rolesOf(picks)
  const confirmReady = sudo ? picks.length === 2 : picks.length === 1

  function resetTransforms() {
    cellRefs.current.forEach((el) => {
      el.style.cssText = ''
    })
  }

  function restart() {
    clearTimers()
    resetTransforms()
    resetInsert()
    setPicks([])
    setFlipped(new Set())
    setHand(makeHand(INITIAL_HAND))
    setDeckCount(DECK_START)
    setDiscard(buildDiscard(size))
    setPhase('idle')
  }

  function changeSize(n: DiscardSize) {
    clearTimers()
    resetTransforms()
    resetInsert()
    setSize(n)
    setPicks([])
    setFlipped(new Set())
    setDiscard(buildDiscard(n))
    setPhase('idle')
  }
  function changeSudo(v: boolean) {
    setSudo(v)
    if (phase === 'choose') setPicks([])
  }

  function start() {
    setPicks([])
    setFlipped(new Set())
    setPhase('deal')
  }

  // deal the discard OUT of its pile into the grid: each card starts at the pile
  // rect and flies to its slot (staggered), then the grid is interactive
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on entering 'deal'
  useLayoutEffect(() => {
    if (phase !== 'deal') return
    const pileRect = discardRef.current?.getBoundingClientRect()
    if (!pileRect) return setPhase('choose')
    const els = discard.map((d) => cellRefs.current.get(d.uid))
    els.forEach((el) => {
      if (!el) return
      el.style.transition = 'none'
      el.style.transform = between(el.getBoundingClientRect(), pileRect)
      el.style.opacity = '0'
    })
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        els.forEach((el, i) => {
          if (!el) return
          const delay = Math.min(i, STAGGER_CAP) * DEAL_STEP
          el.style.transition = `transform ${DEAL_DUR}ms var(--ease-out) ${delay}ms, opacity ${DEAL_DUR}ms ${delay}ms`
          el.style.transform = ''
          el.style.opacity = ''
        })
        const total = DEAL_DUR + Math.min(discard.length, STAGGER_CAP) * DEAL_STEP + 60
        later(() => {
          els.forEach((el) => {
            if (el) el.style.transition = ''
          })
          setPhase('choose')
        }, total)
      }),
    )
  }, [phase])

  // confirm: freeze every cell at its viewport rect first — position:fixed both
  // escapes the scroll container's overflow clip (so cards aren't cut off / don't
  // slide under the piles) AND, pinned all at once, causes no reflow. Then the
  // chosen card reveals to centre and drops into the hand (the opponent-story
  // flow), the sudo card flips then flies onto the deck top, and the rest fly
  // back into the pile with a scattered landing.
  function confirmPick() {
    if (phase !== 'choose' || !confirmReady) return
    const { handUid, deckUid } = roles
    const deckRect = deckRef.current?.getBoundingClientRect()
    const handCard = discard.find((d) => d.uid === handUid)?.card
    const remaining = discard.filter((d) => d.uid !== handUid && d.uid !== deckUid)

    // pass 1: read EVERY cell's rect first, before touching layout. Pinning one
    // cell to position:fixed removes it from the flex grid and reflows the rest,
    // so reading + freezing in a single loop would capture already-shifted
    // positions for every card after the first (they'd start their flight from
    // the wrong place, drifting toward the grid's top-left).
    const rects = new Map<string, DOMRect>()
    for (const d of discard) {
      const el = cellRefs.current.get(d.uid)
      if (el) rects.set(d.uid, el.getBoundingClientRect())
    }
    // pass 2: pin them all at their captured rects (no more reflow matters)
    for (const d of discard) {
      const el = cellRefs.current.get(d.uid)
      const r = rects.get(d.uid)
      if (!el || !r) continue
      el.style.position = 'fixed'
      el.style.left = `${r.left}px`
      el.style.top = `${r.top}px`
      el.style.width = `${r.width}px`
      el.style.margin = '0'
      el.style.zIndex = '100'
    }

    setPhase('resolve')

    // chosen → hand: fly to centre, enlarge, hold, then the shared useHandArrival
    // drop into the fan — same as taking an opponent card
    const handEl = handUid ? cellRefs.current.get(handUid) : null
    const handRect = handUid ? rects.get(handUid) : null
    if (handCard && handEl && handRect) {
      const stage = rootRef.current?.getBoundingClientRect()
      const cx = stage ? stage.left + stage.width / 2 : window.innerWidth / 2
      const cy = stage ? stage.top + stage.height / 2 : window.innerHeight / 2
      const dx = cx - (handRect.left + handRect.width / 2)
      const dy = cy - (handRect.top + handRect.height / 2)
      handEl.style.zIndex = '130'
      handEl.style.transition = `transform ${REVEAL_DUR}ms var(--ease-soft)`
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          handEl.style.transform = `translate(${dx}px, ${dy}px) scale(${REVEAL_W / handRect.width})`
        }),
      )
      later(() => {
        const el = cellRefs.current.get(handUid as string)
        if (!el) return
        // the card on screen IS the one that flies — the step measures it and
        // takes it off screen itself, no local copy and no opacity trick
        void arrive([{ key: nextHandUid(), card: handCard, el }], hand.length)
      }, REVEAL_DUR + REVEAL_HOLD)
    }

    // chosen → deck top: flip face-down in place FIRST, then fly onto the deck
    if (deckUid && deckRect) {
      const el = cellRefs.current.get(deckUid)
      if (el) el.style.zIndex = '120' // above the deck pile — lands on top, not under
      setFlipped(new Set([deckUid]))
      later(() => {
        const dEl = cellRefs.current.get(deckUid)
        const r = rects.get(deckUid)
        if (dEl && r && deckRect) play('returnToDeck', dEl, { from: r, to: deckRect })
      }, FLIP_DUR)
    }

    // the rest → back into the pile, each landing at its OWN stored scatter
    // (rot/dx/dy) — the exact transform the resting heap will render, so there's
    // no position swap when the animation ends. The top HEAP_SHOW stay visible;
    // the ones beneath fade out (merge into the pile) instead of vanishing.
    // the scene keeps its own books on the heap (finishResolve rebuilds it), so
    // the shared step only owns the motion here
    void sendToDiscard(
      remaining.map((d, i) => ({
        key: d.uid,
        card: d.card,
        node: cellRefs.current.get(d.uid),
        scatter: d,
        // the top HEAP_SHOW stay visible; the ones beneath dissolve on the way
        fade: i < remaining.length - HEAP_SHOW,
        delay: Math.min(i, STAGGER_CAP) * RETURN_STEP,
        layer: i,
      })),
    )

    const returnDone = RETURN_DUR + Math.min(remaining.length, STAGGER_CAP) * RETURN_STEP
    const deckDone = deckUid ? FLIP_DUR + DECK_DUR + DECK_HOLD : 0
    later(
      () => finishResolve(Boolean(deckUid), remaining),
      Math.max(returnDone, deckDone, HAND_MIN) + 100,
    )
  }

  function finishResolve(tookDeck: boolean, remaining: DiscardCard[]) {
    // no resetTransforms here — clearing the pinned/animated styles would snap the
    // cards back to their grid slots for a frame ("teleport"). Just drop the grid:
    // the flown cards unmount where they landed and the discard heap takes over.
    if (tookDeck) setDeckCount((c) => c + 1)
    setDiscard(remaining)
    setPicks([])
    setFlipped(new Set())
    setPhase('done')
  }

  const showGrid = phase === 'deal' || phase === 'choose' || phase === 'resolve'
  // the selection instruction — rides in the confirm bar's caption (the shared
  // bottom zone), not a separate hint above the grid
  const hint = sudo
    ? pick(lang, {
        ru: 'выбери 2: одна в руку, вторая на верх колоды',
        en: 'choose 2: one to hand, one onto the deck top',
      })
    : pick(lang, { ru: 'выбери карту для добора в руку', en: 'choose a card to take to hand' })

  return (
    <div className={styles.root} ref={rootRef}>
      <TechBar>
        {selector}
        <span className={styles.sep} />
        <TechButton onClick={restart}>{pick(lang, { ru: 'рестарт', en: 'restart' })}</TechButton>
        <TechToggle on={sudo} onChange={changeSudo}>
          sudo
        </TechToggle>
        <TechSwitch
          label={pick(lang, { ru: 'в сбросе', en: 'in discard' })}
          options={SIZES.map((n) => ({ value: n, label: String(n) }))}
          value={size}
          onChange={changeSize}
        />
      </TechBar>
      <div className={styles.stage}>
        {/* draw deck (left) — the sudo target */}
        <div className={styles.deckPile}>
          <div ref={deckRef}>
            <Pile deck="base" count={deckCount} width={DECK_W} countPos="tl" />
          </div>
          <span className={styles.pileLabel}>{pick(lang, { ru: 'колода', en: 'deck' })}</span>
        </div>

        {/* discard (right) — the source; cards deal out of here and return here.
            Rest state is a tossed heap (top cards tilted), not a neat column. */}
        <div className={styles.discardPile}>
          <Pile
            heap={showGrid ? [] : discard}
            count={showGrid ? 0 : discard.length}
            heapShow={HEAP_SHOW}
            width={PILE_W}
            boxRef={discardRef}
            logoVariant={lang}
          />
          <span className={styles.pileLabel}>{pick(lang, { ru: 'сброс', en: 'discard' })}</span>
        </div>

        {/* idle: the start button in the centre */}
        {phase === 'idle' && (
          <div className={styles.startSlot}>
            <button type="button" className={styles.callBtn} onClick={start}>
              git cherry-pick
            </button>
          </div>
        )}

        {/* selection scrim — backing under the picker so it sits above the hand.
            Only while choosing: during resolve it's gone so the hand insert and the
            flying cards are fully visible (not dimmed / tucked under it). */}
        {(phase === 'deal' || phase === 'choose') && <div className={styles.scrim} />}

        {/* the whole discard, face-up, as a grid (scrolls on the 54 case) */}
        {showGrid && (
          <div className={styles.gridWrap}>
            <div className={`${styles.grid} ${phase === 'deal' ? styles.dealing : ''}`}>
              {discard.map((d) => {
                const trigger = isTrigger(d.card)
                const handRole = roles.handUid === d.uid
                const deckRole = roles.deckUid === d.uid
                const selected = handRole || deckRole
                const blocked = phase === 'choose' && !selected && !canSelect(d)
                return (
                  <button
                    key={d.uid}
                    ref={(el) => {
                      if (el) cellRefs.current.set(d.uid, el)
                      else cellRefs.current.delete(d.uid)
                    }}
                    type="button"
                    className={`${styles.cell} ${selected ? styles.selected : ''} ${
                      blocked ? styles.blocked : ''
                    }`}
                    onClick={() => pickCard(d)}
                  >
                    <Card
                      card={d.card}
                      interactive={false}
                      width={GRID_W}
                      faceDown={flipped.has(d.uid)}
                      state={phase === 'choose' && selected ? 'selected' : 'idle'}
                      // pick one out of a set — uniform selection colour, not the
                      // per-category accent
                      accent="var(--select-accent)"
                    />
                    {phase === 'choose' && trigger && !selected && (
                      <span className={styles.lockTag}>
                        {pick(lang, { ru: 'нельзя в руку', en: 'no hand' })}
                      </span>
                    )}
                    {phase === 'choose' && handRole && (
                      <span className={styles.roleTag}>
                        {pick(lang, { ru: '→ в руку', en: '→ hand' })}
                      </span>
                    )}
                    {phase === 'choose' && deckRole && (
                      <span className={styles.roleTag}>
                        {pick(lang, { ru: '→ на колоду', en: '→ deck' })}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* confirm the selection — the shared slide-up bar; the instruction rides
            in its caption */}
        <ConfirmAction
          open={phase === 'choose'}
          label={pick(lang, { ru: 'подтвердить', en: 'confirm' })}
          caption={hint}
          disabled={!confirmReady}
          onConfirm={confirmPick}
        />

        {overlay}

        {/* hover preview off until the round settles — while a card is dealing /
            flying in, the layout would otherwise trigger the hand's zoom-on-hover */}
        <div
          className={styles.handWrap}
          ref={handRef}
          style={{ pointerEvents: phase === 'idle' || phase === 'done' ? undefined : 'none' }}
        >
          <Hand
            items={hand}
            gapAt={gapAt}
            gapSize={gapSize}
            onReorder={(uid, to) => setHand((h) => reorderHand(h, uid, to))}
          />
        </div>
      </div>
    </div>
  )
}
