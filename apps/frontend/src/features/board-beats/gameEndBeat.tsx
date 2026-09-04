import { Typography, type TypographyBase } from '@release/ui'
import { play } from '@release/ui/animations'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BeatRun } from '~/entities/game/board'
import styles from './gameEndBeat.module.css'
import type { BeatPlan } from './planBeats'

export const GAME_OVER_AT = 2400
export const POP_PER_SIDE = 33
export const CONFETTI_MS = 8500

const POPPERS: [at: number, power: number][] = [
  [0, 1],
  [620, 0.7],
  [1450, 1.25],
]

const GLYPHS = ['{', '}', ';', '<>', '/>', '()', '=>', '&&', '||', '#', '$', '*', '!', '[]', '::']
const GLYPH_COLORS = [
  'var(--brand-green)',
  'var(--select-accent)',
  'var(--cat-attack)',
  'var(--cat-support)',
  'var(--cat-release)',
  'var(--fg)',
]
const GLYPH_SIZES: TypographyBase[] = ['mono-sm', 'mono', 'mono-strong', 'mono-lg', 'mono-xl']

interface Piece {
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

interface VolleyState {
  id: number
  pieces: Piece[]
}

const rnd = (min: number, max: number) => min + Math.random() * (max - min)
const oneOf = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]

let pieceSeq = 0
let volleySeq = 0

function makeVolley(power: number): Piece[] {
  const count = Math.round(POP_PER_SIDE * power)
  return Array.from({ length: count * 2 }, (_, index) => {
    const side = index < count ? 'left' : 'right'
    const direction = side === 'left' ? 1 : -1
    return {
      id: ++pieceSeq,
      glyph: oneOf(GLYPHS),
      color: oneOf(GLYPH_COLORS),
      base: oneOf(GLYPH_SIZES),
      side,
      dx: direction * rnd(60, 930) * power,
      dy: rnd(420, 930),
      peak: rnd(360, 780) * power,
      spin: rnd(-900, 900),
      dur: rnd(2900, 4500) * power,
    }
  })
}

function Volley({ pieces }: { pieces: Piece[] }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const nodes = box.current?.children
    if (!nodes) return
    pieces.forEach((piece, index) => {
      const node = nodes[index]
      if (node) {
        play('confettiFly', node, {
          dx: piece.dx,
          dy: piece.dy,
          peak: piece.peak,
          spin: piece.spin,
          dur: piece.dur,
        })
      }
    })
  }, [pieces])

  return (
    <div ref={box} className={styles.volley}>
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className={`${styles.pop} ${piece.side === 'left' ? styles.popLeft : styles.popRight}`}
          style={{ color: piece.color }}
        >
          <Typography as="span" base={piece.base} tk="tk-02">
            {piece.glyph}
          </Typography>
        </span>
      ))}
    </div>
  )
}

export function useGameEndBeat(): {
  overlay: ReactNode[]
  run: (plan: Extract<BeatPlan, { kind: 'gameEnd' }>, ctx: BeatRun) => Promise<void>
  reset: () => void
} {
  const [volleys, setVolleys] = useState<VolleyState[]>([])
  const timers = useRef<number[]>([])
  const settle = useRef<(() => void) | null>(null)

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer)
    timers.current = []
    settle.current?.()
    settle.current = null
  }, [])
  const reset = useCallback(() => {
    clearTimers()
    setVolleys([])
  }, [clearTimers])
  useEffect(() => clearTimers, [clearTimers])

  const run = useCallback(async () => {
    clearTimers()
    setVolleys([])
    for (const [at, power] of POPPERS) {
      timers.current.push(
        window.setTimeout(() => {
          setVolleys((current) => [...current, { id: ++volleySeq, pieces: makeVolley(power) }])
        }, at),
      )
    }
    timers.current.push(window.setTimeout(() => setVolleys([]), CONFETTI_MS))
    await new Promise<void>((resolve) => {
      const finish = () => {
        if (settle.current !== finish) return
        settle.current = null
        resolve()
      }
      settle.current = finish
      timers.current.push(window.setTimeout(finish, GAME_OVER_AT))
    })
  }, [clearTimers])

  return {
    overlay:
      volleys.length > 0
        ? [
            <div key="game-end" className={styles.pops} data-testid="game-end-confetti" aria-hidden>
              {volleys.map((volley) => (
                <Volley key={volley.id} pieces={volley.pieces} />
              ))}
            </div>,
          ]
        : [],
    run,
    reset,
  }
}
