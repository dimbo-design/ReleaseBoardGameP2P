import { describe, expect, it } from 'vitest'
import { GRID_GAP, gridCardW, gridCells, gridOf } from './discardGrid'

// The grid's rules, which a stylesheet cannot be asked about — the same reason
// `centre.test.ts` exists next door. Values are the approved scene's
// (HandLimitStory); this file only pins that they are still true.
describe('the discard grid at the centre', () => {
  it('picks its shape from the count, not from the cards arriving', () => {
    expect(gridOf(1)).toEqual({ cols: 1, rows: 1 })
    expect(gridOf(4)).toEqual({ cols: 4, rows: 1 })
    expect(gridOf(6)).toEqual({ cols: 3, rows: 2 })
    expect(gridOf(8)).toEqual({ cols: 4, rows: 2 })
    expect(gridOf(10)).toEqual({ cols: 5, rows: 2 })
    expect(gridOf(15)).toEqual({ cols: 5, rows: 3 })
  })

  // an empty grid still has a box: `gridOf(0)` is asked before the first card
  it('never yields a grid of nothing', () => {
    expect(gridOf(0)).toEqual({ cols: 1, rows: 1 })
  })

  it('shrinks the card as the grid grows taller', () => {
    expect(gridCardW(1)).toBeGreaterThan(gridCardW(2))
    expect(gridCardW(2)).toBeGreaterThan(gridCardW(3))
  })

  it('centres the block on the grid point', () => {
    const cells = gridCells(4)
    const midX = cells.reduce((a, c) => a + c.dx, 0) / cells.length
    expect(Math.abs(midX)).toBeLessThan(0.001)
    // one row: every cell on the same line, and that line through the point
    expect(cells.every((c) => c.dy === 0)).toBe(true)
  })

  it('leaves exactly one gap between neighbours, across and down', () => {
    const cells = gridCells(6) // 3 x 2
    expect(cells[1].dx - cells[0].dx).toBeCloseTo(cells[0].w + GRID_GAP)
    expect(cells[3].dy - cells[0].dy).toBeCloseTo(cells[0].h + GRID_GAP)
  })

  it('never overlaps two cells', () => {
    const cells = gridCells(15)
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i]
        const b = cells[j]
        const apart = Math.abs(a.dx - b.dx) >= a.w - 0.001 || Math.abs(a.dy - b.dy) >= a.h - 0.001
        expect(apart).toBe(true)
      }
    }
  })
})
