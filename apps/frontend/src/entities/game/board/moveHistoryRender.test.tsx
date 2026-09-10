import type { Event, PlayerView } from '@release/engine'
import { MoveHistory } from '@release/ui'
import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import type { HistoryLabels } from './toBoardState'
import { toBoardState } from './toBoardState'

// The whole-branch review's own finding: "not one test renders the adapter's
// output through `MoveHistory`" — every `toBoardState.test.ts` assertion stops
// at the returned `HistoryEntry[]`, and `MoveHistory.test.tsx`'s only test
// hand-writes its entry. That gap is exactly how C1 (a discard nested under an
// elimination never renders) and C2 (`gameOver`/`deckReshuffled` render as
// "<someone> is out") survived seventeen per-task reviews: both defects live
// entirely in how the kit interprets a shape the adapter produces correctly.
//
// This file closes that gap by feeding a realistic engine log through
// `toBoardState` and rendering the result through the REAL `MoveHistory`
// component, asserting on what a player would actually read — not on the
// intermediate `HistoryEntry[]`.

const view: PlayerView = {
  self: {
    id: 'you',
    name: 'You',
    hand: [],
    release: {},
    playable: [],
    targets: {},
    combos: {},
    frozen: [],
  },
  opponents: [{ id: 'p2', name: 'Bot', handCount: 0, release: {}, eliminated: true }],
  decks: { piles: [30], events: 8, discardCount: 2 },
  turn: { player: 'you', index: 4, hasDrawn: false },
  window: null,
  pending: null,
  setup: {},
  over: null,
} as unknown as PlayerView

// The moveHistory copy block (`packages/translation/.../common.json`), not
// hand-picked strings — this is what `pages/board/[gameId]/index.tsx` actually
// passes as `copy.history`.
const copy = { draw: 'draw', eliminated: 'is out' }

// A representative slice of `historyLabels` — only the event types this log
// uses, matching `toBoardState.test.ts`'s own convention for this fixture.
const labels = Object.fromEntries([
  ['eliminated', 'Eliminated'],
  ['discarded', 'Discarded'],
  ['gameOver', 'Game over'],
  ['deckReshuffled', 'Deck reshuffled'],
]) as HistoryLabels

// A realistic elimination: the engine parents every spoil of the eliminated
// player's hand and zone to the `eliminated` event itself
// (`packages/engine/src/fake/triggers.ts:43-49`), followed by an unrelated
// `gameOver` and `deckReshuffled` — the two other system rows C2 covers.
const log: Event[] = [
  { id: 1, type: 'eliminated', player: 'p2' },
  { id: 2, type: 'discarded', player: 'p2', card: 'attack-bug', reason: 'effect', parent: 1 },
  { id: 3, type: 'discarded', player: 'p2', card: 'attack-ddos', reason: 'destroyed', parent: 1 },
  { id: 4, type: 'gameOver', winner: 'you', condition: 'lastStanding' },
  { id: 5, type: 'deckReshuffled', cards: 12 },
] as Event[]

it('renders the cards an elimination cost, nested under its system row', () => {
  const { history } = toBoardState(view, log, labels)
  const { getByText } = render(<MoveHistory entries={history} copy={copy} />)

  // C1: before the fix, `Row` returned out of the system branch before it
  // ever reached `e.children?.map(...)`, so these two discards — parented to
  // the `eliminated` event by the engine — rendered nowhere at all. An
  // elimination showed one grey line and swallowed everything it cost.
  expect(getByText('Bug')).toBeTruthy()
  expect(getByText('DDoS')).toBeTruthy()
  // The system row itself still renders, resolved to the player's name (I3)
  // rather than the raw seat id 'p2'.
  expect(getByText('Bot is out')).toBeTruthy()
})

it('tells the winner the game is over instead of that they are out', () => {
  const { history } = toBoardState(view, log, labels)
  const { getByText, queryByText } = render(<MoveHistory entries={history} copy={copy} />)

  // C2: `actorOf({ type: 'gameOver', winner: 'you', ... })` returns the
  // WINNER, so before the fix the system row's fallback
  // (`${who} ${copy.eliminated}`) read as "You is out" for the player who
  // just won — `labels.gameOver` was computed into `kind` and thrown away.
  expect(getByText('Game over')).toBeTruthy()
  expect(queryByText('You is out')).toBeNull()
})

it('names a deck reshuffle instead of showing an unnamed elimination', () => {
  const { history } = toBoardState(view, log, labels)
  const { getByText, queryByText } = render(<MoveHistory entries={history} copy={copy} />)

  // C2, second case: `actorOf` returns `undefined` for a table-caused event —
  // no seat did it — so before the fix `who` was `''` and the same fallback
  // rendered as the literal string " is out" (trimmed to "is out" by
  // `getByText`'s default normalizer): an elimination with nobody named.
  expect(getByText('Deck reshuffled')).toBeTruthy()
  expect(queryByText('is out')).toBeNull()
})
