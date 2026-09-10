import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from '@release/engine/fake'
import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'
import type { UseLobby } from '~/entities/lobby'
// The board's own style module — the `.enter` class the opening hides blocks
// with is reached the same way the ported suite reaches Arrow's classnames.
import boardStyles from '../_Board.module.css'
import BoardPage from '../index'
import StatsPage from '../stats'

// The route now hands the board an opening to play (#89). This suite is about
// the route, not the choreography, so it takes the reduced-motion path: the
// intro collapses to its last frame during the first commit and the board this
// file has always asserted against is the one on screen. Without it every test
// here would run on top of a live, second-long sequence.
//
// It was also working around the kit's Hand leaking its 220ms zoom timer past
// unmount. That is fixed at the source now, so this mock is here for the reason
// above alone.
vi.mock('~/shared/lib/useReducedMotion', () => ({ useReducedMotion: () => true }))

// The board reads the roster through the session, so every test drives it from
// here rather than through a live transport.
let sessionValue: UseLobby
vi.mock('~/app/providers/SessionProvider', () => ({
  useSession: () => sessionValue,
}))

function session(peers: Record<string, unknown> = {}): UseLobby {
  return {
    state: { selfId: 'me', hostId: 'me', maxPlayers: 6, setup: {}, peers },
    status: 'in-lobby',
    roomCode: 'YTG-N2Q',
    isHost: true,
    // Frozen at the deal (#19): the board resolves the winning seat against
    // this, not against a roster that a disconnect prunes mid-match. Empty here
    // takes the page's degraded path, which is seatsFor(peers) — what this
    // fixture has always exercised.
    seats: [],
    // Both halves of the reconnect overlay (#110) — idle/false here, since
    // this fixture is about a session already settled, not one reconnecting.
    restoring: false,
    reconnect: { attempt: 0, maxAttempts: 5, status: 'idle', events: [], retry: vi.fn() },
    kick: vi.fn(),
    setWhere: vi.fn(),
    leaveGame: vi.fn(),
  } as unknown as UseLobby
}

beforeEach(() => {
  sessionValue = session()
})

// Board and stats are sibling routes (#19), matching the real router.ts, not
// parent/child — the board no longer wraps an `<Outlet />`, so this fixture
// must not nest `stats` under it either, or it would exercise a route shape
// the app doesn't have.
function renderBoard(path = '/board/g1') {
  const router = createMemoryRouter(
    [
      { path: '/board/:gameId', element: <BoardPage /> },
      { path: '/board/:gameId/stats', element: <StatsPage /> },
    ],
    { initialEntries: [path] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

it('renders the stats route alone, not the board sitting underneath it', async () => {
  renderBoard('/board/g1/stats')
  expect(await screen.findByTestId('stats-page')).toBeTruthy()
  // The regression this route shape fixes: the board used to stay mounted
  // with stats inside its Outlet, painting a full viewport below the fold.
  expect(screen.queryByTestId('board-page')).toBeNull()
})

it('shows a spectator the live table, not a board held hidden', async () => {
  sessionValue = session({
    host: { id: 'host', name: 'HostPeer', role: 'host', ready: true },
    me: { id: 'me', name: 'Watcher', role: 'guest', ready: false },
  })
  const { container } = renderBoard()
  await screen.findByTestId('board-page')
  // A spectator holds no seat, so the keeper never projects to them and
  // `game.view` stays null for good — an intro armed here could never report
  // done, and every block it hides (`.enter`, opacity 0) would stay hidden for
  // the whole match. So the opening is not armed for them at all.
  expect(container.querySelectorAll(`.${boardStyles.enter}`)).toHaveLength(0)
})

it('fills the viewport so the table is not clipped to nothing', () => {
  const { container } = renderBoard()
  // Table is `block-size: 100%` over `overflow: hidden`, so a parent without a
  // definite height collapses it to zero and clips every child — the page went
  // black. The class carrying that height is the fix; losing it is invisible in
  // jsdom, which is exactly how it shipped.
  const page = container.querySelector('[data-testid="board-page"]')
  expect(page?.className).toBeTruthy()
})

it('lists players and spectators from the session roster', async () => {
  sessionValue = session({
    me: { id: 'me', name: 'HostPeer', role: 'host', ready: true },
    g1: { id: 'g1', name: 'GuestPeer', role: 'player', ready: true },
    s1: { id: 's1', name: 'Watcher', role: 'guest', ready: false },
  })
  renderBoard()
  // The panel lives behind its rail tab, so open it the way a player would.
  // Matched against both catalogs rather than pinned to one, so the test does
  // not depend on which language the test environment resolves to.
  const tab = screen
    .getAllByRole('button')
    .find((b) => /^(participants|участники)$/i.test(b.textContent?.trim() ?? ''))
  expect(tab).toBeTruthy()
  fireEvent.click(tab as HTMLElement)

  // The roster is a room fact: the engine's projection has no spectator concept,
  // so an empty panel here means the session was never wired in.
  expect(await screen.findByText('HostPeer')).toBeTruthy()
  expect(await screen.findByText('GuestPeer')).toBeTruthy()
  expect(await screen.findByText('Watcher')).toBeTruthy()
})

it('renders a real projection: own hand in full, opponents by count only', async () => {
  // Built by the actual engine rather than hand-rolled, so the test breaks if
  // the projection's shape drifts from what the adapter expects.
  const engine = createFakeEngine()
  const state = engine.createGame({
    gameId: 'g1',
    seed: 7,
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const view = engine.project(state, 'p1')
  sessionValue = { ...session(), gameSync: { view, events: [] } } as unknown as UseLobby

  const { container } = renderBoard()

  // p1's own cards are rendered as cards; p2's are a number, never a card.
  const slots = container.querySelectorAll('[data-hand-slot]')
  expect(slots.length).toBe(view.self.hand.length)
  expect(slots.length).toBeGreaterThan(0)
  expect(await screen.findByText('Bo')).toBeTruthy()

  // The privacy guarantee, asserted on what actually reached the DOM.
  const opponentHand = state.players.p2.hand.map((c) => c.uid)
  expect(opponentHand.length).toBeGreaterThan(0)
  for (const uid of opponentHand) expect(container.innerHTML).not.toContain(uid)
})

it('renders the pending prompt from the real catalog when a decision is owed', async () => {
  const engine = createFakeEngine()
  const state = engine.createGame({
    gameId: 'g1',
    seed: 7,
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const projected = engine.project(state, 'p1')
  const view = {
    ...projected,
    // `discardForRelease`, `handLimit` and `pickFromDiscard` now have their
    // own table gestures (#101, #104, #106) and suppress the generic panel,
    // so none of them can stand in here. `requestCard` still exercises the
    // binding directly.
    pending: {
      kind: 'requestCard' as const,
      player: 'p1',
      target: 'p2',
    },
  }
  sessionValue = { ...session(), gameSync: { view, events: [] } } as unknown as UseLobby

  renderBoard()

  // The prompt is gated on `copy.pending` being present. With the key absent
  // from the catalogs the whole branch is skipped silently — the game then
  // deadlocks, because a pending rejects every subsequent action.
  // Asserted on the heading, which PendingPrompt renders as plain text from
  // `kindCopy.prompt`; `copy.confirm` is a ConfirmAction label and reaching it
  // would test that component's affordance rather than this binding.
  const heading = await screen.findByText(/^(name the card you demand|назовите нужную карту)$/i)
  expect(heading).toBeTruthy()
})

it('renders the row that takes a card out of the discard from the real catalog', async () => {
  // `pickFromDiscard` has its own table gesture now (#106) — the row on the
  // table, not the generic panel — so this asserts on ITS caption
  // (`table.insidePrompt`), the same way `_useRequestStaging`'s own binding
  // is asserted on above rather than on `PendingPromptCopy`'s.
  const engine = createFakeEngine()
  const state = engine.createGame({
    gameId: 'g1',
    seed: 7,
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const projected = engine.project(state, 'p1')
  const view = {
    ...projected,
    pending: {
      kind: 'pickFromDiscard' as const,
      player: 'p1',
      options: [
        { uid: 'release-frontend#d0', id: 'release-frontend' },
        { uid: 'release-backend#d1', id: 'release-backend' },
      ],
      picks: 1 as const,
      source: 'ai-inside',
    },
  }
  sessionValue = { ...session(), gameSync: { view, events: [] } } as unknown as UseLobby

  renderBoard()

  expect(await screen.findByTestId('board-inside-row')).toBeTruthy()
  expect(screen.queryByTestId('pending-prompt')).toBeNull()
  const caption = await screen.findByText(
    /^(pick a release from the discard|выберите релиз из сброса)$/i,
  )
  expect(caption).toBeTruthy()
})

it('shows the winner overlay when the projection says the game is over', async () => {
  const engine = createFakeEngine()
  const state = engine.createGame({
    gameId: 'g1',
    seed: 7,
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const projected = engine.project(state, 'p1')
  const view = { ...projected, over: { winner: 'p2', condition: 'release' as const } }
  // A roster whose peers map onto the engine's seats via seatsFor: peer ids
  // sort 'peer-ann' < 'peer-bo', so seatsFor assigns them p1 and p2 in that
  // order, matching the engine's own seating above. Without a real roster
  // here, `over.winnerId` (a playerId) has nothing to resolve against in
  // `room.participants` (peer ids) and the overlay silently names no one.
  sessionValue = {
    ...session({
      'peer-ann': { id: 'peer-ann', name: 'Ann', role: 'host', ready: true },
      'peer-bo': { id: 'peer-bo', name: 'Bo', role: 'player', ready: true },
    }),
    gameSync: { view, events: [] },
  } as unknown as UseLobby

  renderBoard()

  // The winner is resolved against the room roster by id, so the overlay
  // proves both the adapter's rename and the page's peerId translation.
  expect(await screen.findByText(/^(winner|победитель)$/i)).toBeTruthy()
  expect(await screen.findByText(/^(3 releases shipped|Собраны 3 релиза)$/i)).toBeTruthy()
  const winnerName = await screen.findByTestId('game-over-winner')
  expect(winnerName.textContent).toBe('Bo')
})

it('resolves the winner through the seating the match was dealt with', async () => {
  // Three seats; the middle peer dropped before the game ended, and the roster
  // was pruned the moment its channel did (network/useLobby.ts onDisconnect).
  // A seating recomputed here from the survivors would number them p1/p2 and
  // leave the winning seat p3 resolving to nobody — the overlay would name no
  // one at the one moment the whole screen is about who won.
  const engine = createFakeEngine()
  const state = engine.createGame({
    gameId: 'g1',
    seed: 7,
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bo' },
      { id: 'p3', name: 'Cid' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const projected = engine.project(state, 'p1')
  const view = { ...projected, over: { winner: 'p3', condition: 'release' as const } }
  sessionValue = {
    ...session({
      'peer-ann': { id: 'peer-ann', name: 'Ann', role: 'host', ready: true },
      'peer-cid': { id: 'peer-cid', name: 'Cid', role: 'player', ready: true },
    }),
    seats: [
      { playerId: 'p1', peerId: 'peer-ann', name: 'Ann' },
      { playerId: 'p2', peerId: 'peer-bo', name: 'Bo' },
      { playerId: 'p3', peerId: 'peer-cid', name: 'Cid' },
    ],
    gameSync: { view, events: [] },
  } as unknown as UseLobby

  renderBoard()

  await screen.findByText(/^(winner|победитель)$/i)
  const winnerName = await screen.findByTestId('game-over-winner')
  expect(winnerName.textContent).toBe('Cid')
})

it('complains loudly instead of handing the kit a playerId it cannot resolve', async () => {
  const engine = createFakeEngine()
  const state = engine.createGame({
    gameId: 'g1',
    seed: 7,
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const projected = engine.project(state, 'p1')
  const view = { ...projected, over: { winner: 'p2', condition: 'release' as const } }
  // The winner has no seat: `over` rides the projection and the roster rides the
  // session, so a projection can land before the roster syncs, and a winning peer
  // can be pruned from `peers` on disconnect — the end of a game being exactly
  // when a peer is most likely to have dropped. Only p1 is seated here.
  sessionValue = {
    ...session({ 'peer-ann': { id: 'peer-ann', name: 'Ann', role: 'host', ready: true } }),
    gameSync: { view, events: [] },
  } as unknown as UseLobby
  const complained = vi.spyOn(console, 'error').mockImplementation(() => {})

  renderBoard()
  await screen.findByText(/^(winner|победитель)$/i)

  // Falling back to the raw playerId hands `room.participants` a value from the
  // other id space — the crown, the label and the condition all render, and only
  // the name is blank. That is the defect this page exists to fix, so the miss
  // has to be audible rather than papered over with a value known to resolve to
  // nothing.
  const said = complained.mock.calls.map((c) => c.join(' ')).join('\n')
  expect(said).toContain('p2')
  complained.mockRestore()
})

it('sends the game-over continue action to this game’s own stats route', async () => {
  const engine = createFakeEngine()
  const state = engine.createGame({
    gameId: 'g1',
    seed: 7,
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const projected = engine.project(state, 'p1')
  const view = { ...projected, over: { winner: 'p1', condition: 'release' as const } }
  // `session.gameId` is deliberately left unset (null until GAME_STARTED) —
  // the point of the fix is that the continue action must use the route's own
  // :gameId param instead, which would otherwise navigate to
  // `/board/null/stats` rather than this game's stats.
  sessionValue = { ...session(), gameSync: { view, events: [] } } as unknown as UseLobby

  const { router } = renderBoard('/board/g1')

  // Wait for the overlay itself before looking for its button — it mounts off
  // the same async projection as the winner-name assertions above.
  await screen.findByText(/^(winner|победитель)$/i)
  // Button renders its label bracketed (e.g. "[to stats]"), same as every
  // other keyed action in this kit.
  const button = screen
    .getAllByRole('button')
    .find((b) => /^\[(to stats|к статистике)\]$/i.test(b.textContent?.trim() ?? ''))
  expect(button).toBeTruthy()
  fireEvent.click(button as HTMLElement)

  expect(await screen.findByTestId('stats-page')).toBeTruthy()
  expect(router.state.location.pathname).toBe('/board/g1/stats')
})
