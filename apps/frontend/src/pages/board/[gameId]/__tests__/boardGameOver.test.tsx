// The winner is announced when the board has finished saying how it was won
// (#103). The engine settles the elimination and the win in ONE reduction
// (`fake/triggers.ts` — `eliminated`, its discards, then `gameOver`), so
// `view.over` is true the instant the batch lands, while the sweep and the
// elimination clip are still queued. `over` rides beside the projection rather
// than inside it, so nothing about the beat queue reached it before this.
//
// The queue is driven through the same wrapper `boardAlarm.test.tsx` uses: the
// rest of the file gets `useBeats`'s ordinary return, and a test that needs the
// board mid-batch flips the one field.
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

const beatsOverride = vi.hoisted(() => ({ running: false }))
vi.mock('~/features/board-beats', async (importOriginal) => {
  const real = await importOriginal<typeof import('~/features/board-beats')>()
  return {
    ...real,
    useBeats: (args: Parameters<typeof real.useBeats>[0]) => {
      const result = real.useBeats(args)
      return beatsOverride.running ? { ...result, running: true } : result
    },
  }
})

const wonBoard = () => makeBoardProps({ over: { winnerId: 'deadlock', condition: 'lastStanding' } })

const winnerShown = () => screen.queryByTestId('game-over-winner')

it('announces the winner once the board has finished playing how it was won', () => {
  beatsOverride.running = false
  render(<Board {...wonBoard()} />)
  expect(winnerShown()).toBeTruthy()
})

it('holds the winner back while the board is still playing the batch that won it', () => {
  beatsOverride.running = true
  render(<Board {...wonBoard()} />)
  // The elimination sweep and its clip are still running. A winner panel over
  // the top of them announces the end before the board has shown it.
  expect(winnerShown()).toBeNull()
})
