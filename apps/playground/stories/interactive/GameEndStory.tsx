import enCommon from '@release/translation/locales/en/common.json'
import ruCommon from '@release/translation/locales/ru/common.json'
import { useEffect, useRef, useState } from 'react'
import { play, scatterAt, useFlyer } from '@/animations'
import { CARDS, cardById } from '@/cards'
import type { Card as CardType } from '@/cards/types'
import { nextHandUid } from '@/mocks/hand'
import HudBackground from '@/primitives/HudBackground'
import Pile from '@/primitives/Pile'
import type { HeapCard } from '@/primitives/Pile/Pile'
import TabRail from '@/primitives/TabRail'
import Typography from '@/primitives/Typography'
import type { TypographyBase } from '@/primitives/Typography/Typography'
import GameOver from '@/table/GameOver'
import Hand from '@/table/Hand'
import type { HandItem, HandPlayDrop } from '@/table/Hand/Hand'
import ReleaseZone from '@/table/ReleaseZone'
import type { ReleaseSlots } from '@/table/ReleaseZone/ReleaseZone'
import Seat from '@/table/Seat'
import TurnDock from '@/table/TurnDock/TurnDock'
import { pick, useLang } from '../../Playground/lang'
import TechBar from '../controls/TechBar'
import { TechButton, TechHint } from '../controls/TechControls'
import styles from './GameEndStory.module.css'
import { reorderHand } from './reorderHand'

// The last move of a match. Two of the player's three slots are closed, the
// third release is in hand — pull it out of the fan and the game is over:
//
//   release → its own slot in the zone (the snap landing every release gets)
//   → the poppers go off: code symbols burst out of both bottom corners
//   → after the celebration, the game-over window comes up over the table.
//
// The table underneath is the Table screen's own arrangement, assembled here
// from the same elements it uses.

// what is left of the base deck: the whole deck (104 by the rules) minus every
// card that is out of it — the hands, the discard and the releases on the table
const DECK_TOTAL = 104
const DISCARD_N = 18
const OPP_HANDS = 3 + 2 + 5
const HAND_N = 4
const RELEASES_OUT = 4 // two in your zone, one in each of two opponents'
const DECK_MAIN = DECK_TOTAL - DISCARD_N - OPP_HANDS - HAND_N - RELEASES_OUT
// the events deck does NOT wear down: by the rules an AI effect goes back into
// it after it resolves, so it stands at its full 21 all game
const DECK_EVENTS = 21

// the poppers: [when it goes off, how strong it is]. Three separate bangs, not
// one repeated — the second is a smaller after-pop, the third the loudest.
const POPPERS: [number, number][] = [
  [0, 1],
  [620, 0.7],
  [1450, 1.25],
]
// the window does NOT wait for the last piece to fall: it comes up while the
// confetti is still in the air, and the poppers keep going over it
const OVER_AT = 2400
const CONFETTI_MS = 8500 // by then every piece has flown its arc out; clean up
const POP_PER_SIDE = 33

// the discard as it lies: each card at its own scatter, deterministic by index
const DISCARD_POOL = CARDS.filter((c) => c.deck === 'base' && c.category !== 'trigger')
const HEAP: HeapCard[] = Array.from({ length: DISCARD_N }, (_, i) => ({
  card: DISCARD_POOL[i % DISCARD_POOL.length],
  ...scatterAt(i, 116),
}))

const EMPTY_RELEASE: ReleaseSlots = { frontend: undefined, backend: undefined, database: undefined }

// two slots closed, Database still open — the slot the match ends on
const START_RELEASE: ReleaseSlots = {
  frontend: cardById('release-frontend'),
  backend: cardById('release-backend'),
  database: undefined,
}

const WINNING_CARD = 'release-database'
const HAND_IDS = [WINNING_CARD, 'attack-bug', 'defense-not-a-bug', 'support-sudo']
const makeHand = (): HandItem[] =>
  HAND_IDS.map((id) => cardById(id))
    .filter((c): c is CardType => Boolean(c))
    .map((card) => ({
      uid: nextHandUid(),
      card,
    }))

const OPPONENTS = [
  {
    id: 'p2',
    name: 'kernel_panic',
    handCount: 3,
    release: { ...EMPTY_RELEASE, backend: cardById('release-backend') },
  },
  { id: 'p3', name: 'segfault', handCount: 2, release: EMPTY_RELEASE },
  {
    id: 'p4',
    name: 'null_ptr',
    handCount: 5,
    release: { ...EMPTY_RELEASE, frontend: cardById('release-frontend') },
  },
]

// the poppers throw code, not paper
const GLYPHS = ['{', '}', ';', '<>', '/>', '()', '=>', '&&', '||', '#', '$', '*', '!', '[]', '::']
const GLYPH_COLORS = [
  'var(--brand-green)',
  'var(--select-accent)',
  'var(--cat-attack)',
  'var(--cat-support)',
  'var(--cat-release)',
  'var(--fg)',
]

// the pieces come in a few sizes — steps of the mono scale, not loose px
const GLYPH_SIZES: TypographyBase[] = ['mono-sm', 'mono', 'mono-strong', 'mono-lg', 'mono-xl']

interface Pop {
  id: number
  glyph: string
  color: string
  base: TypographyBase
  side: 'left' | 'right'
  dx: number
  dy: number
  peak: number
  spin: number
  dur: number
}

const rnd = (min: number, max: number) => min + Math.random() * (max - min)
const oneOf = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]

let popSeq = 0
let volleySeq = 0

// One popper going off: half out of the left corner, half out of the right, each
// piece thrown inward and up. `power` is what makes a volley ITS OWN — the count,
// the reach and the time in the air all follow it, so two poppers are two events
// and not the same one played twice.
function volley(power: number): Pop[] {
  const n = Math.round(POP_PER_SIDE * power)
  return Array.from({ length: n * 2 }, (_, i) => {
    const side = i < n ? 'left' : 'right'
    const dir = side === 'left' ? 1 : -1
    return {
      id: ++popSeq,
      glyph: oneOf(GLYPHS),
      color: oneOf(GLYPH_COLORS),
      base: oneOf(GLYPH_SIZES),
      side,
      dx: dir * rnd(60, 930) * power,
      dy: rnd(420, 930),
      peak: rnd(360, 780) * power,
      spin: rnd(-900, 900),
      dur: rnd(2900, 4500) * power,
    } satisfies Pop
  })
}

// A volley is INDEPENDENT: its pieces are made once and started once, in an
// effect that runs on mount only. Nothing about a later popper touches it —
// starting the animation from a render-time ref callback is what used to kill
// the pieces already in the air (the callback re-fires on every render, and
// `play` stacks a second animation on a node that is mid-flight).
function Volley({ pieces }: { pieces: Pop[] }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const nodes = box.current?.children
    if (!nodes) return
    pieces.forEach((p, i) => {
      const node = nodes[i]
      if (node)
        play('confettiFly', node, { dx: p.dx, dy: p.dy, peak: p.peak, spin: p.spin, dur: p.dur })
    })
  }, [pieces])

  return (
    <div ref={box} className={styles.volley}>
      {pieces.map((p) => (
        <span
          key={p.id}
          className={`${styles.pop} ${p.side === 'left' ? styles.popLeft : styles.popRight}`}
          style={{ color: p.color }}
        >
          <Typography as="span" base={p.base} tk="tk-02">
            {p.glyph}
          </Typography>
        </span>
      ))}
    </div>
  )
}

export default function GameEndStory() {
  const { lang } = useLang()
  const copy = lang === 'en' ? enCommon : ruCommon

  const [hand, setHand] = useState<HandItem[]>(makeHand)
  const [release, setRelease] = useState<ReleaseSlots>(START_RELEASE)
  const [volleys, setVolleys] = useState<{ id: number; pieces: Pop[] }[]>([])
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)

  const slotRefs = useRef<Partial<Record<keyof ReleaseSlots, HTMLDivElement | null>>>({})
  const timers = useRef<number[]>([])
  const { overlay: flyerOverlay, raise, drop } = useFlyer()

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms))

  function restart() {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
    drop()
    setHand(makeHand())
    setRelease(START_RELEASE)
    setVolleys([])
    setOver(false)
    setBusy(false)
  }

  // one more popper joins the ones already in the air
  const fire = (power: number) =>
    setVolleys((v) => [...v, { id: ++volleySeq, pieces: volley(power) }])

  // GESTURE — the winning release is pulled out of the fan; nothing else plays
  const handPlay = (uid: string, dropped: HandPlayDrop): boolean => {
    if (busy || over || !dropped.rect) return false
    const item = hand.find((it) => it.uid === uid)
    if (!item || item.card.id !== WINNING_CARD) return false
    void finish(item, dropped.rect)
    return true
  }

  // the release settles into its slot, the poppers go off, and the match ends
  async function finish(item: HandItem, from: DOMRect) {
    setBusy(true)
    setHand((h) => h.filter((it) => it.uid !== item.uid))
    const slot = slotRefs.current.database?.getBoundingClientRect()
    const [el] = await raise([
      {
        key: 'release',
        at: { left: from.left, top: from.top, width: from.width, height: from.height },
        card: item.card,
      },
    ])
    if (el && slot) {
      // a release lands with a snap — the preset every release in the game uses
      const anim = play('playToReleaseZone', el, { from, to: slot })
      if (anim) await anim.finished
    }
    setRelease((r) => ({ ...r, database: item.card }))
    drop('release')

    // the zone is complete — the poppers go off over the finished table. Three
    // of them, each with its own power and its own moment; every one is added to
    // the list and never touched again, so a later bang leaves the earlier
    // pieces flying their own arcs out.
    for (const [at, power] of POPPERS) later(() => fire(power), at)
    // the window comes up while the confetti is still flying, not after it
    later(() => {
      setOver(true)
      setBusy(false)
    }, OVER_AT)
    later(() => setVolleys([]), CONFETTI_MS)
  }

  return (
    <div className={styles.root}>
      {/* The technical line is a ROW of the playground, not a layer over the
          screen: it takes its own height, and the table below owns everything
          left — so nothing the scene paints over the table has to dodge it. */}
      <TechBar>
        <TechButton onClick={restart}>{pick(lang, { ru: 'рестарт', en: 'restart' })}</TechButton>
        <TechHint>
          {pick(lang, {
            ru: 'вытяни Database из веера — это последний релиз в партии',
            en: 'pull Database out of the fan — the last release of the match',
          })}
        </TechHint>
      </TechBar>

      <div className={styles.stage}>
        {/* the table's own background layer, over the grid the area paints */}
        <HudBackground tone="neutral" className={styles.hud} />

        {/* opponents — one row on top, as on the table; late in the match their
          hands are thin and a release stands in two of the zones */}
        <div className={styles.opponents}>
          {OPPONENTS.map((o) => (
            <Seat
              key={o.id}
              player={{ id: o.id, name: o.name, handCount: o.handCount, release: o.release }}
              copy={copy.seat}
            />
          ))}
        </div>

        {/* draw decks — the base one worn down by a whole match, the events one whole */}
        <div className={styles.decks}>
          <Pile label={copy.table.deck} deck="base" count={DECK_MAIN} width={150} countPos="tl" />
          <Pile label={copy.table.events} deck="ai" count={DECK_EVENTS} width={150} countPos="tl" />
        </div>

        {/* discard — a tossed heap by now, as it lies on the table */}
        <div className={styles.discard}>
          <Pile
            label={copy.table.discard}
            heap={HEAP}
            count={HEAP.length}
            width={116}
            logoVariant={lang}
          />
        </div>

        {/* your turn — the deciding release is in hand */}
        <div className={styles.turnDock}>
          <TurnDock state="draw" seconds={20} progress={1} copy={copy.turnDock} />
        </div>

        <div className={styles.you}>
          <ReleaseZone
            release={release}
            size="100px"
            slotRef={(key, el) => {
              slotRefs.current[key] = el
            }}
          />
          <div className={styles.handWrap} style={{ pointerEvents: busy ? 'none' : undefined }}>
            <Hand
              items={hand}
              stateAt={(i) => (hand[i]?.card.id === WINNING_CARD ? 'playable' : 'idle')}
              onPlay={handPlay}
              onReorder={(uid, to) => setHand((h) => reorderHand(h, uid, to))}
            />
          </div>
        </div>

        {/* the page rail, as on the table. Inert: this page is a choreography, not
          the panels — a tab that opened nothing would read as broken. */}
        <TabRail
          items={[
            { id: 'history', label: copy.table.tabHistory },
            { id: 'participants', label: copy.table.tabParticipants },
            { id: 'rules', label: copy.table.tabRules },
            { id: 'modes', label: copy.table.tabModes },
          ]}
          active={null}
          onSelect={() => {}}
        />

        {/* the poppers: code symbols out of both bottom corners. Each volley is its
          own element and starts once — the scene owns the spread and the timing,
          the `confettiFly` preset owns one piece's arc. */}
        <div className={styles.pops} aria-hidden="true">
          {volleys.map((v) => (
            <Volley key={v.id} pieces={v.pieces} />
          ))}
        </div>

        {/* the card on its way to the slot */}
        {flyerOverlay}

        {/* the game-over window — it covers the table area, which is the screen
          being shown; the playground's technical line is outside it.
          The winner is named, not addressed: «ты» / «you» made the window speak
          about whoever is looking instead of saying who won — the same slip the
          Stats screen already dropped in favour of nicknames. */}
        {over && (
          <GameOver
            winner={{ name: 'Dimbo' }}
            condition="release"
            copy={copy.gameOver}
            onContinue={restart}
          />
        )}
      </div>
    </div>
  )
}
