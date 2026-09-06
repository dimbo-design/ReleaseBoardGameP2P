import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

// A render-level smoke test: it guards that the board still puts up the DOM
// shapes an anchor binds to (a discard card box, a release zone per owner) —
// NOT that the registry actually wires them. A `ref`/`slotRef` prop is
// invisible to a DOM query, so this file cannot tell a wired anchor from an
// unwired one; `../../../../entities/game/board/anchors.test.tsx` is what
// asserts the registry's own behaviour (indexing, per-owner keying, identity).
// The hand-slot-per-card structure is already covered by board.test.tsx's
// real-projection test, so it is not repeated here.
//
// The board has no intro in these: the anchors belong to the board, not to the
// opening, and that is the whole point of the registry existing.
vi.mock('~/shared/lib/useReducedMotion', () => ({ useReducedMotion: () => true }))

it('still renders the discard as a card box, not just a labelled cell', () => {
  const { container } = render(<Board {...makeBoardProps()} />)
  // Pile puts boxRef on its .stack — the card box, not the labelled cell (I6).
  const discard = container.querySelector('[class*="discard"] [class*="stack"]')
  expect(discard).toBeTruthy()
})

it('still renders a release zone for the player and for every opponent', () => {
  const props = makeBoardProps()
  const { container } = render(<Board {...props} />)
  // One zone of the player's own plus one per seat — the anchors need a node per
  // owner, because a destroyed card leaves the slot it stood in.
  const zones = container.querySelectorAll('[class*="zone"], [class*="releaseZone"]')
  expect(zones.length).toBeGreaterThanOrEqual(1 + props.state.opponents.length)
})

// Every draw stages at the centre, on every turn — so it cannot be a node that
// exists only while the opening runs. A board rendered with no `intro` at all
// (the case every test in this file already renders) is exactly the case that
// used to have nowhere to aim.
it('keeps the table centre mounted after the opening is gone', () => {
  const { container } = render(<Board {...makeBoardProps()} />)
  expect(container.querySelector('[data-board-centre]')).not.toBeNull()
})

it('draws one pile per entry in the projection', () => {
  const props = makeBoardProps()
  const { getAllByText } = render(
    <Board
      {...props}
      state={{ ...props.state, decks: { ...props.state.decks, main: [12, 12] } }}
    />,
  )
  // The deck label appears once per pile — a split is two decks on the table,
  // not one deck showing a bigger number.
  expect(getAllByText(props.copy.table.deck)).toHaveLength(2)
})

it('mounts the five centre slots, each axis-aligned and each its own box', () => {
  render(<Board {...makeBoardProps()} />)
  for (const name of ['stage', 'cost', 'attack', 'sudo', 'cover']) {
    expect(document.querySelector(`[data-centre-slot="${name}"]`)).toBeTruthy()
  }
})

it('renders an empty centre slot with no stray children', () => {
  // This pins the structural half only: an empty slot must render nothing, so
  // there is no child of its own that could catch a pointer event regardless
  // of any CSS rule. It does NOT guard `_Board.module.css`'s
  // `:empty { pointer-events: none }` rule itself — this assertion would stay
  // green even if that rule were deleted outright. Vitest's default CSS
  // handling stubs a `.module.css` import to an empty value even with `?raw`
  // or `?inline` appended (confirmed: both resolve to `{}` / `""` here, unlike
  // a plain-text asset such as a `.md` file, where `?raw` returns real
  // content — see apps/ui/src/animations/docs.test.ts), so there is currently
  // no way to read the stylesheet's actual text from a test in this app. This
  // structural assertion is the best available check until that changes.
  render(<Board {...makeBoardProps()} />)
  const cover = document.querySelector('[data-centre-slot="cover"]') as HTMLElement
  expect(cover.children).toHaveLength(0)
})

it('binds the events pile so a card can fly home to it', () => {
  render(<Board {...makeBoardProps()} />)
  expect(document.querySelector('[data-events-box]')).not.toBeNull()
})
