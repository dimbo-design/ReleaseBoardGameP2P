// THE GRID THE HAND LIMIT'S EXCESS BUILDS AT THE CENTRE.
//
// Quoted verbatim from the playground's `HandLimitStory` — the approved visual
// source — and kept HERE for the same reason `centre.ts` keeps the named
// places: geometry written in a CSS module can be neither reused by a flight
// nor asked about by a test, which is exactly how one layout ends up written
// twice and equal by attention alone.
//
// It is NOT a `CentreSet`. A set is a handful of named places a scene declared;
// a grid's cells are a function of a count, and no one can list them. Same
// folder, same rule, different shape.
import { CARD_RATIO } from '@/primitives/Card'

export interface GridShape {
  cols: number
  rows: number
}

/** one cell, as an offset from the grid's own centre point */
export interface GridCell {
  dx: number
  dy: number
  w: number
  h: number
}

/** The grid's row, in % of the table's height. */
export const GRID_TOP = 44
/** between neighbouring cells, px */
export const GRID_GAP = 12
/** Card width by row count. */
export const GRID_CARD_W = [150, 132, 116]

/** The shape for `n` cards, chosen upfront from the known excess. */
export function gridOf(n: number): GridShape {
  if (n <= 4) return { cols: Math.max(n, 1), rows: 1 }
  if (n <= 6) return { cols: 3, rows: 2 }
  if (n <= 8) return { cols: 4, rows: 2 }
  if (n <= 10) return { cols: 5, rows: 2 }
  return { cols: Math.ceil(n / 3), rows: 3 }
}

export function gridCardW(rows: number): number {
  return GRID_CARD_W[rows - 1] ?? GRID_CARD_W[GRID_CARD_W.length - 1]
}

/** Every cell of an `n`-card grid, as offsets from the grid's centre point. */
export function gridCells(n: number): GridCell[] {
  const { cols, rows } = gridOf(n)
  const w = gridCardW(rows)
  const h = w * CARD_RATIO
  const blockW = cols * w + (cols - 1) * GRID_GAP
  const blockH = rows * h + (rows - 1) * GRID_GAP
  const cells: GridCell[] = []
  for (let i = 0; i < n; i += 1) {
    const col = i % cols
    const row = Math.floor(i / cols)
    cells.push({
      dx: col * (w + GRID_GAP) - blockW / 2 + w / 2,
      dy: row * (h + GRID_GAP) - blockH / 2 + h / 2,
      w,
      h,
    })
  }
  return cells
}
