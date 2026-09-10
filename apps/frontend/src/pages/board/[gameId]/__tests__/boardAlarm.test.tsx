// The alarm renders (#102, Task 4): an unanswered Error 503 stands at the
// centre and lights the table. Read-only — `PendingPrompt` still answers it
// at this commit, so this suite only pins what the board SHOWS, the same way
// boardPreview.test.tsx and boardDefense.test.tsx pin their own pendings by
// building the projection locally with `makeBoardProps` rather than a shared
// "withPending" fixture helper — there is no such helper in `./fixture`, and
// every sibling suite that needs a pending builds its own board with it
// straight from `makeBoardProps`.

import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

// The sweep (#102, Task 10) lights the SAME strong glow this suite already
// pins, but from `beats.alarm` rather than from a `pending` — the
// defenceless path raises no pending at all (the engine eliminates in the
// same batch as the reveal), so driving it end to end would mean rebuilding
// the whole real-`useBeats` harness `comboHandoff.test.tsx` already carries
// for a different seam. Instead: `useBeats` is wrapped so the REST of this
// file gets its ordinary, unmodified return (every existing test below is
// unaffected), and only the one new test flips `alarmOverride` to see the
// glow the running beat would raise.
const alarmOverride = vi.hoisted(() => ({ value: false }))
vi.mock('~/features/board-beats', async (importOriginal) => {
  const real = await importOriginal<typeof import('~/features/board-beats')>()
  return {
    ...real,
    useBeats: (args: Parameters<typeof real.useBeats>[0]) => {
      const result = real.useBeats(args)
      return alarmOverride.value ? { ...result, alarm: true } : result
    },
  }
})

// A neutralize503 pending owed to `player` — the engine's own shape
// (`packages/engine/src/view.ts`'s `Pending` union): `card` is a `CardId`
// (or null), not a uid, same as `pendingDefend`'s own `attackCard`.
function alarmBoard(player: string) {
  const base = makeBoardProps()
  return makeBoardProps({
    state: {
      ...base.state,
      pending: {
        kind: 'neutralize503',
        player,
        card: 'trigger-error-503',
        methods: ['debugger'],
      },
    },
  })
}

it('stands the alarm at the centre while the decision is ours', () => {
  render(<Board {...alarmBoard('you')} />)
  expect(screen.getByTestId('board-centre-alarm')).toBeTruthy()
})

it('lights the table strongly, under the hand, when the alarm is ours', () => {
  const { container } = render(<Board {...alarmBoard('you')} />)
  const glow = screen.getByTestId('board-glow-strong')
  const you = container.querySelector('[data-testid="board-you"]')
  expect(glow).toBeTruthy()
  expect(screen.queryByTestId('board-glow-weak')).toBeNull()
  // DOM ORDER IS THE RULE: our own alarm sits BEFORE the hand, so it glows
  // under it. `compareDocumentPosition` returns FOLLOWING for a node that
  // comes later in the document.
  expect(glow.compareDocumentPosition(you as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('lights an opponent’s alarm weakly, over the hand', () => {
  const { container } = render(<Board {...alarmBoard('p2')} />)
  const glow = screen.getByTestId('board-glow-weak')
  const you = container.querySelector('[data-testid="board-you"]')
  expect(screen.queryByTestId('board-glow-strong')).toBeNull()
  expect(glow.compareDocumentPosition(you as Node) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
})

it('shows no alarm at all with nothing pending', () => {
  render(<Board {...makeBoardProps()} />)
  expect(screen.queryByTestId('board-centre-alarm')).toBeNull()
  expect(screen.queryByTestId('board-glow-strong')).toBeNull()
  expect(screen.queryByTestId('board-glow-weak')).toBeNull()
})

it('keeps the table lit while a knocked-out player’s cards sweep away', () => {
  alarmOverride.value = true
  try {
    render(<Board {...makeBoardProps()} />)
    expect(screen.getByTestId('board-glow-strong')).toBeTruthy()
  } finally {
    alarmOverride.value = false
  }
})
