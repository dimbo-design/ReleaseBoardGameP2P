import { CARD_RATIO, CARD_W } from '@release/ui'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '~/shared/lib/useReducedMotion'
import styles from './_useZonePull.module.css'

// Pulling a card out of your OWN release zone — a source nothing on the board
// has ever taken a card from (#102). Ported from the playground's
// `Error503Story`, the approved visual source.
//
// It knows nothing about the game: it drags a rect around and reports where the
// pointer let go. What is legal to pull, and what a drop MEANS, belong to the
// caller — which is what lets #105's transfers and #106's crush answer reuse it.

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

const CARD_H = CARD_W * CARD_RATIO
const RESIZE_MS = 200 // the pick-up eases to the normal card size

interface DragState<K extends string> {
  key: K
  cx: number // cursor at pick-up
  cy: number
  // where inside the card it was grabbed (0..1) — keeps that point under the
  // cursor as the card resizes, so the pick-up doesn't snap centre-to-cursor
  fracX: number
  fracY: number
  startW: number // source on-screen width (eases to CARD_W)
}

export interface ZonePull<K extends string = string> {
  /** the slot being dragged right now, or null */
  dragging: K | null
  /** start a drag from the node the pointer went down on */
  begin: (key: K, el: HTMLElement, e: ReactMouseEvent) => void
  /** the drag carrier, rendered by the page */
  overlay: ReactNode
  /** bind the card the carrier should show while `dragging` is set */
  render: (node: ReactNode) => void
}

export function useZonePull<K extends string = string>(opts: {
  onDrop: (key: K, at: { x: number; y: number; rect: Rect }) => void
  onCancel: (key: K) => void
  accepts: (x: number, y: number) => boolean
}): ZonePull<K> {
  const { onDrop, onCancel, accepts } = opts
  const reduced = useReducedMotion()
  const [drag, setDrag] = useState<DragState<K> | null>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  // The carrier's content is state, not a ref: `render()` is called from the
  // consumer's own render body, and mutating a ref there is the thing React
  // warns against — it's unsafe under concurrent rendering. This costs one
  // extra render per `render()` call (pick-up only, not per frame); the rAF
  // loop below still writes style.left/top/width straight onto the node.
  const [content, setContent] = useState<ReactNode>(null)

  function begin(key: K, el: HTMLElement, e: ReactMouseEvent) {
    // Only a primary press starts a drag — a right- or middle-press on the
    // slot is not "pick this up", and the module is shared (#105/#106 reuse
    // it too), so the guard belongs here rather than only in one caller.
    if (e.button !== 0) return
    e.preventDefault() // don't start a text selection on pick-up
    const r = el.getBoundingClientRect()
    setDrag({
      key,
      cx: e.clientX,
      cy: e.clientY,
      fracX: (e.clientX - r.left) / r.width,
      fracY: (e.clientY - r.top) / r.height,
      startW: r.width,
    })
  }

  // drag lifecycle: the carrier is picked up EXACTLY where it was grabbed
  // (same position + size), then eases to the normal card size while the grab
  // point stays under the cursor (no snap-to-centre); on release, hit-test via
  // `accepts` and hand the drop (or cancel) back to the caller.
  // biome-ignore lint/correctness/useExhaustiveDependencies: drag is the trigger; the handlers use the closures captured when the drag began
  useEffect(() => {
    if (!drag) return
    // One rAF loop drives BOTH the size ease and the position each frame, so
    // the grabbed point stays exactly under the cursor while the card
    // resizes. Splitting them (a CSS transition for the size, JS for the
    // position) gives a visible resize-from-corner followed by a snap.
    const cursor = { x: drag.cx, y: drag.cy }
    const start = performance.now()
    let raf = 0
    const frame = (now: number) => {
      const node = dragRef.current
      if (node) {
        // `prefers-reduced-motion` (project rule: honoured everywhere, and
        // `play()` does not check it for us — JS choreography has to ask on
        // its own, `useReducedMotion` is the codebase's way of doing that).
        // The pick-up itself stays direct manipulation either way — the card
        // still follows the cursor 1:1 — this only gates the 200ms EASE of
        // its width from the source rect to the normal card size; under
        // `reduce` it snaps to that size on the very first frame instead.
        const t = reduced ? 1 : Math.min(1, (now - start) / RESIZE_MS)
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
      const r = dragRef.current?.getBoundingClientRect()
      const rect: Rect = r
        ? { left: r.left, top: r.top, width: r.width, height: r.height }
        : { left: e.clientX, top: e.clientY, width: CARD_W, height: CARD_H }
      if (accepts(e.clientX, e.clientY)) onDrop(drag.key, { x: e.clientX, y: e.clientY, rect })
      else onCancel(drag.key)
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag])

  return {
    dragging: drag?.key ?? null,
    begin,
    overlay: drag && (
      <div className={styles.carrier} ref={dragRef} style={{ width: CARD_W }}>
        {content}
      </div>
    ),
    render: (node: ReactNode) => setContent(node),
  }
}
