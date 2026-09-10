// THE AI PAIR at the centre (#106, Task 5): three slots mounted for the whole
// life of the board — `cause`, `effect`, `picked` — and the card standing
// behind a prompt while the engine waits for an answer. `effect`'s standing
// card is the render that carries the AI card across the batch gap: `source`
// on a `crush` / `neutralize503` / `handLimit` / `pickFromDiscard` pending is
// public for every peer, not just the one being asked.
import { centreTransform } from '@release/ui'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

// The same drag the kit's own contract expects — ported from
// `boardHandLimit.test.tsx`'s own `pullCardFromFan` rather than duplicated
// under a new shape: down on the slot, past Hand's 6px threshold, released
// well outside the hand's band.
async function pullCardFromFan(index: number) {
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 600))
  })
}

vi.mock('~/shared/lib/useReducedMotion', () => ({ useReducedMotion: () => true }))

describe('the AI pair at the centre', () => {
  it('mounts all three slots for the whole life of the board', () => {
    render(<Board {...makeBoardProps()} />)
    for (const slot of ['cause', 'effect', 'picked']) {
      expect(document.querySelector(`[data-centre-slot="${slot}"]`)).not.toBeNull()
    }
  })

  it('stands the AI card behind a prompt, for a peer who is not the one asked', () => {
    const base = makeBoardProps()
    render(
      <Board
        {...makeBoardProps({
          state: {
            ...base.state,
            selfId: 'p2',
            pending: {
              kind: 'crush',
              player: 'p1',
              slot: 'frontend',
              methods: ['debugger'],
              source: 'ai-crush-frontend',
            },
          },
        })}
      />,
    )
    expect(screen.getByTestId('board-ai-effect')).not.toBeNull()
  })

  it('stands nothing when the prompt carries no source', () => {
    const base = makeBoardProps()
    render(
      <Board
        {...makeBoardProps({
          state: {
            ...base.state,
            pending: { kind: 'handLimit', player: 'p1', excess: 2, options: [] },
          },
        })}
      />,
    )
    expect(screen.queryByTestId('board-ai-effect')).toBeNull()
  })

  // Bad Vibe-Coding borrows the hand-limit prompt (#104's whole surface) but
  // its one card must not land underneath the AI card standing at `effect` —
  // `source` on the pending is what tells the grid's one cell to take the
  // `aiPick` set's `picked` place instead of its own `gridCells(1)` shape.
  it("stands Bad Vibe's given-up card beside the AI card, not under it", async () => {
    const base = makeBoardProps()
    const uid = base.state.you.hand[0].uid
    render(
      <Board
        {...makeBoardProps({
          state: {
            ...base.state,
            pending: {
              kind: 'handLimit',
              player: base.state.selfId,
              excess: 1,
              options: [uid],
              source: 'ai-bad-vibe-coding',
            },
          },
        })}
      />,
    )
    // …after the first pull fixes the grid
    await pullCardFromFan(0)
    const cell = document.querySelector('[data-grid-cell="0"]') as HTMLElement
    // the `picked` place, not the grid's own centred cell
    expect(cell.style.transform).toBe(centreTransform('picked'))
  })

  it('keeps the ordinary hand limit on its own grid', async () => {
    const base = makeBoardProps()
    const uid = base.state.you.hand[0].uid
    render(
      <Board
        {...makeBoardProps({
          state: {
            ...base.state,
            pending: {
              kind: 'handLimit',
              player: base.state.selfId,
              excess: 1,
              options: [uid],
            },
          },
        })}
      />,
    )
    await pullCardFromFan(0)
    const cell = document.querySelector('[data-grid-cell="0"]') as HTMLElement
    expect(cell.style.transform).not.toBe(centreTransform('picked'))
  })
})

// THE ROW THAT TAKES A RELEASE OUT OF THE DISCARD (#106, Task 11, ai-inside).
// The choice is the owner's alone (`pendingView` gates `options` behind
// `mine`), so it is answered by a row on the table rather than the shared
// panel — the same split `requestCard`'s band already keeps.
describe('the row that takes a Release out of the discard (ai-inside)', () => {
  const pickingPending = (options: { uid: string; id: string }[], player = 'you') => ({
    kind: 'pickFromDiscard' as const,
    player,
    options,
    picks: 1 as const,
    source: 'ai-inside',
  })

  it("offers the discard's releases in a row, and not the pending panel", () => {
    const base = makeBoardProps()
    const onResolve = vi.fn()
    render(
      <Board
        {...makeBoardProps({
          state: {
            ...base.state,
            pending: pickingPending([
              { uid: 'r1', id: 'release-frontend' },
              { uid: 'r2', id: 'release-backend' },
            ]),
          },
          actions: { onResolve },
        })}
      />,
    )
    expect(screen.getByTestId('board-inside-row')).not.toBeNull()
    expect(screen.queryByTestId('pending-prompt')).toBeNull()
    // two candidates is a CHOICE — it must wait for the confirm, not answer
    // itself the way a single one does
    expect(onResolve).not.toHaveBeenCalled()
  })

  it('answers a single candidate without asking, and only once — and fires again for a distinct pending', () => {
    const base = makeBoardProps()
    const onResolve = vi.fn()
    // a FRESH `pending` object per call — `TableState` is rebuilt from
    // scratch on every real projection update, so the latch has to key on
    // VALUE, not on referential identity (the same discipline
    // `PendingPrompt`'s own `fingerprint` keeps).
    const propsFor = (uid: string) =>
      makeBoardProps({
        state: { ...base.state, pending: pickingPending([{ uid, id: 'release-frontend' }]) },
        actions: { onResolve },
      })
    const { rerender } = render(<Board {...propsFor('r1')} />)
    rerender(<Board {...propsFor('r1')} />)
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledWith({ kind: 'pickFromDiscard', card: 'r1' })
    expect(screen.queryByTestId('board-inside-row')).toBeNull()

    // a second, DISTINCT pending — a later `ai-inside` in the same match —
    // resolves again: the latch is keyed on the pending's own identity, not
    // on the mount (`useBeats`'s own two latch bugs of that family).
    rerender(<Board {...propsFor('r2')} />)
    expect(onResolve).toHaveBeenCalledTimes(2)
    expect(onResolve).toHaveBeenLastCalledWith({ kind: 'pickFromDiscard', card: 'r2' })
  })

  // This file's own top-level `vi.mock('~/shared/lib/useReducedMotion', …)`
  // (above) already forces reduced motion for every test here — which is
  // exactly the point: the auto-resolve lives in the STAGING hook, not in a
  // beat, so it never waits on `useBeats`'s own reduced-motion branch at all.
  // It is a game action, not choreography — an engine left waiting on an
  // animation nobody plays is a stalled match.
  it('answers a single candidate under reduced motion too', () => {
    const base = makeBoardProps()
    const onResolve = vi.fn()
    render(
      <Board
        {...makeBoardProps({
          state: {
            ...base.state,
            pending: pickingPending([{ uid: 'r1', id: 'release-frontend' }]),
          },
          actions: { onResolve },
        })}
      />,
    )
    expect(onResolve).toHaveBeenCalledTimes(1)
  })

  it('shows an opponent nothing of the options', () => {
    const base = makeBoardProps()
    render(
      <Board
        {...makeBoardProps({
          state: {
            ...base.state,
            selfId: 'p2',
            pending: pickingPending([], 'you'),
          },
        })}
      />,
    )
    expect(screen.queryByTestId('board-inside-row')).toBeNull()
    // …but the AI card that asked is public, and stands
    expect(screen.getByTestId('board-ai-effect')).not.toBeNull()
  })
})

// THE PANEL THAT ANSWERS GIT CHERRY-PICK'S OWN PICK (regression). Cherry-pick
// (`operation-git-cherry-pick`) raises the same `pickFromDiscard` kind Inside
// does, but over the whole discard rather than its releases, and under sudo
// takes two — a shape `_useInsideStaging`'s row was never built for. This is
// the missing case Task 11 shipped without: both cards were routed onto the
// one surface built for Inside alone.
describe("the panel that answers Git Cherry-pick's own pick", () => {
  const cherryPending = (options: { uid: string; id: string }[], picks: 1 | 2 = 1) => ({
    kind: 'pickFromDiscard' as const,
    player: 'you',
    options,
    picks,
    source: 'operation-git-cherry-pick',
  })

  it('offers the shared panel over any discard card, and not the Inside row', () => {
    const base = makeBoardProps()
    render(
      <Board
        {...makeBoardProps({
          state: {
            ...base.state,
            pending: cherryPending([
              { uid: 'c1', id: 'attack-bug' },
              { uid: 'c2', id: 'protection-debugger' },
            ]),
          },
        })}
      />,
    )
    expect(screen.getByTestId('pending-prompt')).not.toBeNull()
    expect(screen.queryByTestId('board-inside-row')).toBeNull()
  })

  it('does not stand Cherry-pick in the AI pair own slot — it is a base-deck Operation, not an events-deck draw', () => {
    const base = makeBoardProps()
    render(
      <Board
        {...makeBoardProps({
          state: {
            ...base.state,
            pending: cherryPending([{ uid: 'c1', id: 'attack-bug' }]),
          },
        })}
      />,
    )
    expect(screen.queryByTestId('board-ai-effect')).toBeNull()
  })
})
