import type { Event, PlayerView } from '@release/engine'
import { render } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { readLog, writeLog } from '~/shared/lib/persistence'
import { type Game, useGame } from './useGame'

// The hook reads the session through a provider; the tests drive that provider
// directly so a sync can be handed over one render at a time.
let session: {
  gameLink: { submit: (i: unknown) => void } | null
  gameSync: { view: PlayerView; events: Event[]; resync?: boolean } | null
  gameId: string | null
}

vi.mock('~/app/providers/SessionProvider', () => ({ useSession: () => session }))

beforeEach(() => sessionStorage.clear())

const view = (id = 'p1'): PlayerView =>
  ({
    self: { id, name: 'One', hand: [], release: {}, playable: [], frozen: [] },
    opponents: [],
    decks: { piles: [89], events: 21, discardCount: 0 },
    turn: { player: id, index: 0, hasDrawn: false },
    window: null,
    pending: null,
    setup: {},
    over: null,
  }) as unknown as PlayerView

const dealt = (player: string): Event => ({ id: 1, type: 'dealt', player, count: 5 }) as Event
const drawn = (player: string): Event =>
  ({ id: 3, type: 'drawn', player, pile: 0, deckSize: 88 }) as Event

// Reads the feed from a LAYOUT effect, exactly as the board's deal intro does.
// That timing is the whole point: a passive effect would see a settled feed and
// prove nothing, which is how the defect below survived fourteen reviews.
function Child({ game, seen }: { game: Game; seen: { events: Event[] }[] }) {
  // `seen` is the same array instance for the life of a test, so naming it here
  // satisfies the dependency rule without re-arming the effect.
  useLayoutEffect(() => {
    if (game.view) seen.push({ events: game.events })
  }, [game.view, game.events, seen])
  return null
}

function Probe({ seen }: { seen: { events: Event[] }[] }) {
  return <Child game={useGame()} seen={seen} />
}

// The defect this pins: `events` was folded in by a passive effect, so on the
// commit that first carried a projection the feed was still empty. The intro
// arms in a layout effect — which runs first — read that empty feed, concluded
// there was no deal, and finished before a card ever flew. The animation was
// dead in production while every test passed, because every other test hands
// the view and the events over in the same render.
it('has the deal in the feed by the first layout effect that sees a projection', () => {
  const seen: { events: Event[] }[] = []
  session = { gameLink: null, gameSync: null, gameId: 'g1' }
  const { rerender } = render(<Probe seen={seen} />)

  session = { gameLink: null, gameSync: { view: view(), events: [dealt('p1')] }, gameId: 'g1' }
  rerender(<Probe seen={seen} />)

  // The FIRST layout effect to see a projection is the one the intro arms in.
  expect(seen.length).toBeGreaterThan(0)
  expect(seen[0].events.filter((e) => e.type === 'dealt')).toHaveLength(1)
})

it('does not count a sync twice once its effect has folded it in', () => {
  const seen: { events: Event[] }[] = []
  session = { gameLink: null, gameSync: null, gameId: 'g1' }
  const { rerender } = render(<Probe seen={seen} />)

  const sync = { view: view(), events: [dealt('p1')] }
  session = { gameLink: null, gameSync: sync, gameId: 'g1' }
  rerender(<Probe seen={seen} />)
  rerender(<Probe seen={seen} />)

  expect(seen[seen.length - 1].events).toHaveLength(1)
})

it('accumulates across syncs, keeping the running feed', () => {
  const seen: { events: Event[] }[] = []
  session = { gameLink: null, gameSync: null, gameId: 'g1' }
  const { rerender } = render(<Probe seen={seen} />)

  session = { gameLink: null, gameSync: { view: view(), events: [dealt('p1')] }, gameId: 'g1' }
  rerender(<Probe seen={seen} />)
  session = { gameLink: null, gameSync: { view: view(), events: [drawn('p1')] }, gameId: 'g1' }
  rerender(<Probe seen={seen} />)

  expect(seen[seen.length - 1].events.map((e) => e.type)).toEqual(['dealt', 'drawn'])
})

it('does not hand a new game the last one’s feed', () => {
  const seen: { events: Event[] }[] = []
  session = { gameLink: null, gameSync: { view: view(), events: [dealt('p1')] }, gameId: 'g1' }
  const { rerender } = render(<Probe seen={seen} />)

  // Seat ids repeat between games, so a stale `dealt` left in the feed would be
  // taken for the new game's deal and replayed as somebody else's hand.
  session = { gameLink: null, gameSync: { view: view(), events: [dealt('p1')] }, gameId: 'g2' }
  rerender(<Probe seen={seen} />)

  expect(seen[seen.length - 1].events).toHaveLength(1)
})

it('reports no projection for a seat that was never dealt to', () => {
  // A spectator holds no seat, so the keeper never projects to them.
  const seen: { events: Event[] }[] = []
  session = { gameLink: null, gameSync: null, gameId: 'g1' }
  render(<Probe seen={seen} />)
  expect(seen).toHaveLength(0)
})

it('has the restored feed by the first layout effect that sees a projection', () => {
  writeLog({ gameId: 'g1', events: [dealt('p1'), drawn('p1')], savedAt: Date.now() })
  session = { gameLink: null, gameSync: { view: view(), events: [] }, gameId: 'g1' }
  const seen: { events: Event[] }[] = []
  render(<Probe seen={seen} />)
  expect(seen[0].events.map((e) => e.id)).toEqual([1, 3])
})

it('reports the restored feed as already seen, so nothing replays', () => {
  writeLog({ gameId: 'g1', events: [dealt('p1'), drawn('p1')], savedAt: Date.now() })
  session = { gameLink: null, gameSync: { view: view(), events: [] }, gameId: 'g1' }
  let restored = -1
  function Peek() {
    restored = useGame().restoredThrough
    return null
  }
  render(<Peek />)
  expect(restored).toBe(3)
})

it('merges a sync into the restored feed without duplicating it', () => {
  writeLog({ gameId: 'g1', events: [dealt('p1')], savedAt: Date.now() })
  session = {
    gameLink: null,
    gameSync: { view: view(), events: [dealt('p1'), drawn('p1')] },
    gameId: 'g1',
  }
  const seen: { events: Event[] }[] = []
  render(<Probe seen={seen} />)
  expect(seen.at(-1)?.events.map((e) => e.id)).toEqual([1, 3])
})

it('refuses a stored feed belonging to another game', () => {
  writeLog({ gameId: 'other', events: [dealt('p1')], savedAt: Date.now() })
  session = { gameLink: null, gameSync: { view: view(), events: [] }, gameId: 'g1' }
  const seen: { events: Event[] }[] = []
  render(<Probe seen={seen} />)
  expect(seen[0].events).toEqual([])
})

it('writes the feed back so the next load can restore it', () => {
  session = { gameLink: null, gameSync: { view: view(), events: [dealt('p1')] }, gameId: 'g1' }
  render(<Probe seen={[]} />)
  expect(readLog('g1', Date.now())).toHaveLength(1)
})

// Finding A (Critical): the returned `events` folds in an unprocessed sync via
// `pending`/`carried` on THIS render — that is the whole point of that
// mechanism. `restoredThrough` must cover the same render's events for the
// same reason. Before the fix it was just `restoredThrough.current`, a ref
// bumped only inside the passive sync effect, which runs strictly after this
// render's layout effects — so a peer whose very first sync is a resync (a
// reconnect or late join, where the ref starts at 0) would see those events
// with a stale, uncovering mark on the very render they first appear.
it('a resync already covers its own events in restoredThrough, on the same render they appear', () => {
  const seen: { events: Event[]; restoredThrough: number }[] = []
  function Watch() {
    const game = useGame()
    useLayoutEffect(() => {
      if (game.view) seen.push({ events: game.events, restoredThrough: game.restoredThrough })
    }, [game.view, game.events, game.restoredThrough])
    return null
  }

  session = { gameLink: null, gameSync: null, gameId: 'resync-live' }
  const { rerender } = render(<Watch />)

  session = {
    gameLink: null,
    gameSync: { view: view(), events: [dealt('p1'), drawn('p1')], resync: true },
    gameId: 'resync-live',
  }
  rerender(<Watch />)

  // The FIRST layout effect to see this sync's events is the one whose
  // `restoredThrough` we must trust — a later render "fixing" it is too late.
  expect(seen[0].events.map((e) => e.id)).toEqual([1, 3])
  expect(seen[0].restoredThrough).toBe(3)
})

// Finding B (Important): both the clear effect and the persist effect list
// `gameId` in their deps and fire in the same commit, in declaration order.
// The persist effect's closure still holds the STALE events from the outgoing
// game (`setEvents([])` in the clear effect only takes effect on a later
// render), so without a guard it re-plants the record `clearLog()` just wiped,
// mislabelled under the new game. No further sync arrives here to overwrite
// that bad write with a correct one, so it is exactly what a reload would see.
it('does not persist the outgoing game’s events under the new game’s id', () => {
  session = {
    gameLink: null,
    gameSync: { view: view(), events: [dealt('p1')] },
    gameId: 'leak-old',
  }
  const { rerender } = render(<Probe seen={[]} />)

  session = { gameLink: null, gameSync: null, gameId: 'leak-new' }
  rerender(<Probe seen={[]} />)

  expect(readLog('leak-new', Date.now())).toBeNull()
})
