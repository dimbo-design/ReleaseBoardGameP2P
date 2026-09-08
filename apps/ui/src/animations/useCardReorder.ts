import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef, useState } from 'react'

interface Drag {
  row: number
  uid: string
  x: number
  y: number
  to: number
}

/** Drag within a numbered card row, previewing the insertion before committing. */
export function useCardReorder(args: {
  enabled: boolean
  step: number
  rows: { id: number; cards: string[] }[]
  onReorder: (row: number, cards: string[]) => void
}) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const latest = useRef(args)
  latest.current = args
  const grab = useRef<{
    gx: number
    gy: number
    left: number
    top: number
    cards: string[]
    to: number
  } | null>(null)

  useLayoutEffect(() => {
    if (!args.enabled) {
      setDrag(null)
      grab.current = null
    }
  }, [args.enabled])

  // biome-ignore lint/correctness/useExhaustiveDependencies: subscribe per grab; pointer movement reads refs
  useLayoutEffect(() => {
    if (!drag) return
    const { row, uid } = drag
    const move = (e: PointerEvent) => {
      const g = grab.current
      if (!g || !latest.current.enabled) return
      const x = e.clientX - g.gx - g.left
      const y = e.clientY - g.gy - g.top
      g.to = Math.max(0, Math.min(g.cards.length - 1, Math.round(x / latest.current.step)))
      setDrag({ row, uid, x, y, to: g.to })
    }
    const cancel = () => {
      grab.current = null
      setDrag(null)
    }
    const up = (e: PointerEvent) => {
      move(e)
      const g = grab.current
      if (g && latest.current.enabled) {
        const cards = g.cards.filter((id) => id !== uid)
        cards.splice(g.to, 0, uid)
        latest.current.onReorder(row, cards)
      }
      cancel()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [drag?.row, drag?.uid])

  const onPointerDown = (row: number, uid: string, e: ReactPointerEvent<HTMLElement>) => {
    if (!args.enabled || grab.current || e.button !== 0) return
    const cards = args.rows.find((r) => r.id === row)?.cards
    const parent = e.currentTarget.parentElement
    if (!cards || !parent) return
    const index = cards.indexOf(uid)
    if (index < 0) return
    e.preventDefault()
    e.stopPropagation()
    const cr = e.currentTarget.getBoundingClientRect()
    const rr = parent.getBoundingClientRect()
    grab.current = {
      gx: e.clientX - cr.left,
      gy: e.clientY - cr.top,
      left: rr.left,
      top: rr.top,
      cards,
      to: index,
    }
    setDrag({ row, uid, x: cr.left - rr.left, y: cr.top - rr.top, to: index })
  }

  const position = (row: number, uid: string, index: number) => {
    if (drag?.row !== row) return { x: index * args.step, y: 0, dragging: false }
    if (drag.uid === uid) return { x: drag.x, y: drag.y, dragging: true }
    const others = (grab.current?.cards ?? []).filter((id) => id !== drag.uid)
    const at = others.indexOf(uid)
    const slot = at >= drag.to ? at + 1 : at
    return { x: slot * args.step, y: 0, dragging: false }
  }
  return { drag, onPointerDown, position }
}
