import type { ReactNode } from 'react'
import { useCallback, useRef, useState } from 'react'
import type { Card as CardType } from '@/cards/types'
import Card from '@/primitives/Card'
import type { Rect } from './scatter'
// Relative, and deliberately so: the frontend's beat tests mock the
// `@release/ui/animations` barrel to trace `nextFrames()`, and reaching for
// `./timing` directly keeps this hook's own internal awaits OUT of that trace.
// Routed through the barrel instead, `raise()`'s frame wait would show up
// alongside a runner's, and `aiBeat.test.tsx`'s call-order assertion — which
// reads "the FIRST `nextFrames` entry IS the standing branch's own" — would
// silently stop proving anything.
import { nextFrames, wait } from './timing'
import styles from './useFlyer.module.css'

// THE carrier of a card in the air — the half of a flight that is NOT the rule.
//
// The three named steps own the rules of a movement (where to aim, which scatter,
// in what order to land, what to do with a pair). Underneath all of them, and under
// every scene's own flight, there is the same node: a fixed card hanging over the
// table. That node kept being written from scratch per scene, and with it the five
// invariants that belong to it — each broken at least once:
//
//   • I10 — it paints where it MOUNTS. Coordinates live in state and are rendered
//     inline; a fixed node without them paints at its flow position (the bottom of
//     the page) for every frame until the code assigns them.
//   • I5  — a fresh node per flight (`key={seq}`), so React never reuses a Card and
//     turns a `faceDown` change into a spurious flip mid-flight.
//   • I2  — it has painted at its source before anything starts moving.
//   • I3  — leftover WAAPI transforms are cancelled before it is repositioned.
//   • I4  — after landing it is PINNED to where it visually is, so the next flight
//     starts from there and not from the old origin.
//
// What it does NOT know: where to fly, which preset, in what order, what to do with
// a pair. That stays with the step or with the scene — which is also why a scene may
// put its OWN element in the node (`content`) and reach into it afterwards.
//
// I4 is the one a scene may decline: a flight whose landing pose lives in the filled
// WAAPI animation must NOT be pinned, because pinning cancels it. Then the node is
// simply dropped after the resting card takes over (see Defense Release).
//
//   const [el] = await raise([{ key: 'draw', card, at: from, faceDown: true }])
//   await play('drawToCenter', el, { from, to })?.finished
//   pin('draw', to)              // identity for the next flight
//   patch('draw', { faceDown: false })
//   drop('draw')

export interface Raise {
  key: string // the scene's own name for this flyer — pin/patch/drop take it
  at: Rect // where it mounts: its FIRST painted frame is here (I10)
  /** the card it carries — the common case */
  card?: CardType
  faceDown?: boolean
  /**
   * …or whatever the scene puts in the node instead: a pair, a card in its
   * at-a-glance reading, a card mid-morph. The node and its five invariants are
   * the carrier's; WHAT rides in it can be the scene's own — including elements
   * the scene then reaches into (a pair's halves are animated frame by frame).
   */
  content?: ReactNode
  /** the pose it rests in — the tilt a card lies at on the table */
  pose?: string
  /** its layer on the table, when several are in the air at once (I9) */
  layer?: number
}

interface Held extends Raise {
  seq: number // React key — a fresh node per flight (I5)
}

export function useFlyer() {
  const [held, setHeld] = useState<Held[]>([])
  const els = useRef<Record<string, HTMLDivElement | null>>({})
  const seq = useRef(0)

  // every one of these is stable: they touch refs and state setters only. A scene
  // may depend on them from a useCallback without re-creating it on every render.
  const elOf = useCallback((key: string) => els.current[key] ?? null, [])

  // put N cards in the air at their own rects and let them paint there before
  // anything moves. Returns their elements, in the order they were given.
  const raise = useCallback(
    async (items: Raise[]): Promise<(HTMLDivElement | null)[]> => {
      if (items.length === 0) return []
      // a key is ONE flyer: raising a key that is still up replaces it instead of
      // hanging a second node on the same name
      const keys = new Set(items.map((it) => it.key))
      setHeld((h) => [
        ...h.filter((it) => !keys.has(it.key)),
        ...items.map((it) => ({ ...it, seq: ++seq.current })),
      ])
      await nextFrames() // I2 — painted at `at`, and mounted, before the caller measures
      return items.map((it) => {
        const el = elOf(it.key)
        if (el) for (const a of el.getAnimations()) a.cancel() // I3
        return el
      })
    },
    [elOf],
  )

  // I4 — the card has landed: it now IS at `rect`. Written to the DOM at once (no
  // frame at the old transform) AND to the state, or the next render would put it
  // back at the rect it was raised from.
  const pin = useCallback(
    (key: string, rect: Rect) => {
      const el = elOf(key)
      if (el) {
        for (const a of el.getAnimations()) a.cancel()
        el.style.left = `${rect.left}px`
        el.style.top = `${rect.top}px`
        el.style.width = `${rect.width}px`
        el.style.transform = ''
      }
      setHeld((h) => h.map((it) => (it.key === key ? { ...it, at: rect } : it)))
    },
    [elOf],
  )

  // move a card that is already in the air to another rect, over `ms`. Where a
  // flyer IS is state here, so a scene cannot just set left/top on the node — the
  // next render would put it back. The transition goes on the element, the value
  // into the state, and the render does the move.
  const glide = useCallback(
    async (key: string, rect: Rect, ms: number) => {
      const el = elOf(key)
      // transform rides along: a card can ease INTO a pose (its own scatter) while
      // it moves, instead of snapping into the tilt and then sliding
      const props = ['left', 'top', 'inline-size', 'transform'].map(
        (p) => `${p} ${ms}ms var(--ease-soft)`,
      )
      if (el) el.style.transition = props.join(', ')
      setHeld((h) => h.map((it) => (it.key === key ? { ...it, at: rect } : it)))
      await wait(ms)
      if (el) el.style.transition = ''
    },
    [elOf],
  )

  // change what the card shows without touching where it is — the flip in place
  const patch = useCallback(
    (key: string, next: Partial<Pick<Raise, 'card' | 'faceDown' | 'content' | 'pose'>>) =>
      setHeld((h) => h.map((it) => (it.key === key ? { ...it, ...next } : it))),
    [],
  )

  // take one down, or all of them
  const drop = useCallback((key?: string) => {
    if (key == null) {
      els.current = {}
      setHeld([])
      return
    }
    delete els.current[key]
    setHeld((h) => h.filter((it) => it.key !== key))
  }, [])

  const overlay = held.map((h) => (
    <div
      key={h.seq}
      className={styles.flyer}
      ref={(el) => {
        els.current[h.key] = el
      }}
      style={{
        left: h.at.left,
        top: h.at.top,
        inlineSize: h.at.width,
        // the layer travels with the card (I9); without one it rides the rung
        zIndex: h.layer == null ? undefined : `calc(var(--z-flight) + ${h.layer})`,
        transform: h.pose,
      }}
    >
      {h.content ??
        (h.card && <Card card={h.card} faceDown={h.faceDown} interactive={false} width="100%" />)}
    </div>
  ))

  return { overlay, raise, pin, glide, patch, drop, elOf }
}
