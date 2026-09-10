// Naming a card, and losing one (#105, Task 8). `_useRequestStaging` replaces
// the panel for `requestCard` — the same reason `defend` and `neutralize503`
// left it before: `.prompt` is `inset: 0` at z-index 92 over an opaque
// `.panel`, so the question covers the very table the scene plays on, and the
// `chosen` hold (the named card standing enlarged while the rest of the
// catalog slides away) is the first beat of the transfer, which a panel that
// unmounts with the pending cannot hold. `giveCard` answers itself, with no
// panel at all — the copies differ only by uid, so there is nothing to choose.

import type { TablePending } from '@release/ui'
import { fireEvent, render, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BoardState } from '~/entities/game/board'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

const withPending = (pending: TablePending | null, over: Partial<BoardState> = {}) => {
  const base = makeBoardProps()
  return {
    ...base,
    state: { ...base.state, selfId: 'you', pending, ...over },
  }
}

// The last test replaces `window.matchMedia` to force reduced motion — saved
// and restored so that mock does not leak into every test that runs after
// this file.
const originalMatchMedia = window.matchMedia
afterEach(() => {
  window.matchMedia = originalMatchMedia
})

it('answers a requestCard on the table, not through the panel', () => {
  // Same reason `defend` and `neutralize503` left the panel: `.prompt` is
  // inset:0 at z 92 over an opaque panel, so the question covers the table it
  // is about — and the `chosen` hold is the first beat of the transfer, which
  // a panel that unmounts with the pending cannot hold.
  const props = withPending({ kind: 'requestCard', player: 'you', target: 'p2' })
  const { queryByTestId } = render(<Board {...props} />)
  expect(queryByTestId('pending-prompt')).toBeNull()
  expect(queryByTestId('board-request-band')).not.toBeNull()
})

it('hands the card over without asking, once, per pending episode', () => {
  // The copies differ only by uid — the engine itself matches on `card.id`
  // (fake/handAttacks.ts `onGiveCard`) — so there is nothing to choose.
  //
  // The guard is per-EPISODE, not per-mount and not permanent: it fires once
  // for a `giveCard` pending, stays silent for a re-render of that SAME
  // pending, and is free to fire again once the pending has gone away (the
  // engine cleared it — a real, later episode) even if the next one is an
  // identical `giveCard` for the same player, card and copy. A latch keyed
  // only on player+card+uid and never cleared would swallow that SECOND
  // request outright, and a second Security Bug in one match is an ordinary
  // thing.
  //
  // `held` is read from `base.state.you.hand`, the SAME hand every pending
  // below is built against — `makeHand`'s own uid counter is a shared,
  // ever-incrementing module state (`apps/ui/src/mocks/hand.ts`), so a second,
  // independent `makeBoardProps()` call hands out different uids for the same
  // catalogue position and would make the dispatched uid assertion flaky.
  const onResolve = vi.fn()
  const base = makeBoardProps()
  const held = base.state.you.hand[0]
  const boardWith = (pending: TablePending | null) => ({
    ...base,
    state: { ...base.state, selfId: 'you', pending },
  })

  // Episode 1: the first `giveCard` pending owed to us.
  const first = boardWith({ kind: 'giveCard', player: 'you', requested: held.card.id })
  const { rerender } = render(<Board {...first} actions={{ onResolve }} />)
  expect(onResolve).toHaveBeenCalledTimes(1)
  expect(onResolve.mock.calls[0][0]).toMatchObject({ kind: 'giveCard', card: held.uid })

  // The SAME episode, re-rendered with a NEW pending object carrying the exact
  // same values (a real projection rebuild, not a referential no-op) — the
  // guard must recognise it as the episode already answered and stay silent.
  const sameAgain = boardWith({ kind: 'giveCard', player: 'you', requested: held.card.id })
  rerender(<Board {...sameAgain} actions={{ onResolve }} />)
  expect(onResolve).toHaveBeenCalledTimes(1)

  // The episode ends: the engine cleared the pending (it was answered).
  const cleared = boardWith(null)
  rerender(<Board {...cleared} actions={{ onResolve }} />)
  expect(onResolve).toHaveBeenCalledTimes(1)

  // A fresh episode — a new `giveCard`, identical in every field to the first
  // — must be answered again. This is the case a permanent, never-cleared
  // fingerprint would get wrong.
  const second = boardWith({ kind: 'giveCard', player: 'you', requested: held.card.id })
  rerender(<Board {...second} actions={{ onResolve }} />)
  expect(onResolve).toHaveBeenCalledTimes(2)
  expect(onResolve.mock.calls[1][0]).toMatchObject({ kind: 'giveCard', card: held.uid })
})

it('stands the named card at the centre for a peer who is not a party', () => {
  // `giveCard` is projected unredacted (fake/attacks.ts:444), and the rules
  // make the request public (cards.md:125). A spectator answers nothing and
  // still has to see what was asked for.
  const onResolve = vi.fn()
  const props = withPending({ kind: 'giveCard', player: 'p2', requested: 'attack-bug' })
  const { queryByTestId } = render(<Board {...props} actions={{ onResolve }} />)
  expect(onResolve).not.toHaveBeenCalled()
  expect(queryByTestId('board-requested-card')).not.toBeNull()
})

it('still hands the card over under reduced motion', () => {
  // Every beat collapses here. The hand-over is a game action, not
  // choreography — a victim who prefers reduced motion must not stall the
  // engine waiting for an animation that will never play.
  window.matchMedia = ((q: string) => ({
    matches: q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  const onResolve = vi.fn()
  const held = makeBoardProps().state.you.hand[0]
  const props = withPending({ kind: 'giveCard', player: 'you', requested: held.card.id })
  render(<Board {...props} actions={{ onResolve }} />)
  expect(onResolve).toHaveBeenCalledTimes(1)
})

it('names a catalogue card only after confirmation', () => {
  const onResolve = vi.fn()
  const props = withPending({ kind: 'requestCard', player: 'you', target: 'p2' })
  const { getByTestId } = render(<Board {...props} actions={{ onResolve }} />)
  const band = within(getByTestId('board-request-band'))
  const confirm = band.getByRole('button', { name: /confirm/i }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.click(band.getByRole('button', { name: /Support Code Review/i }))
  expect(onResolve).not.toHaveBeenCalled()
  expect(confirm.disabled).toBe(false)
  fireEvent.click(confirm)
  expect(onResolve).toHaveBeenCalledExactlyOnceWith({
    kind: 'requestCard',
    card: 'support-code-review',
  })
})
