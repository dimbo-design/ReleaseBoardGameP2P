import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from '@release/engine/fake'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, vi } from 'vitest'
import {
  clearKeeper,
  clearSession,
  getClientId,
  readSession,
  type StoredKeeper,
  type StoredSession,
} from '~/shared/lib/persistence'
import { backoffMs, MAX_RECONNECT_ATTEMPTS } from './session/reconnect'
import { createSession } from './session/referee'
import { INTRO_CAP_MS } from './session/startGate'
import { createTransport } from './transport/peer'
import type { Message, WireMessage } from './types'
import {
  formatRoomCode,
  KEEPER_SAVE_MS,
  makeRoomCode,
  parseRoomCode,
  type UseLobby,
  useLobby,
} from './useLobby'

// Every fake transport createTransport hands out, with the callbacks useLobby
// passed in — so a test can fire an error or a disconnect by hand.
interface FakeTransport {
  id: string
  close: ReturnType<typeof vi.fn>
  broadcast: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  onError?: (err: { type?: string; message: string }) => void
  onConnection?: (peerId: string) => void
  onDisconnect?: (peerId: string) => void
  onMessage?: (msg: WireMessage) => void
}

// vi.mock is hoisted above the imports, so the array it closes over has to be
// hoisted too — otherwise the factory hits a temporal-dead-zone error.
const { transports } = vi.hoisted(() => ({ transports: [] as FakeTransport[] }))

vi.mock('./transport/peer', () => ({
  createTransport: vi.fn(
    (args: {
      onError?: (err: { type?: string; message: string }) => void
      onConnection?: (peerId: string) => void
      onDisconnect?: (peerId: string) => void
      onMessage?: (msg: WireMessage) => void
    }) => {
      const fake = {
        id: `peer${transports.length}`,
        close: vi.fn(),
        connectTo: vi.fn(),
        send: vi.fn(),
        broadcast: vi.fn(),
        relay: vi.fn(),
        connectedIds: () => [],
        onError: args.onError,
        onConnection: args.onConnection,
        onDisconnect: args.onDisconnect,
        onMessage: args.onMessage,
      }
      transports.push(fake)
      return fake
    },
  ),
}))

beforeEach(() => {
  transports.length = 0
  // createTransport is one shared vi.fn() for the whole file, so its call
  // history accumulates across every test unless cleared here — without this,
  // a solo test asserting `.not.toHaveBeenCalled()` would see every networked
  // test that ran before it and fail no matter what it does itself.
  vi.mocked(createTransport).mockClear()
  // The hook writes `release:session` / `release:keeper` now, so a record left
  // by the previous test would be read as this one's — and now that the mount
  // effect restores from one automatically (host restore, below), a leftover
  // record does not just sit unread, it drives a real reconnect during a later
  // test's mount. `sessionStorage.clear()` alone is not enough: persistence.ts
  // falls back to an in-memory cache when storage throws (Safari private
  // mode), and that cache is a module-level singleton that outlives any one
  // test — clearSession/clearKeeper are what actually empty it, on top of the
  // browser storage.
  sessionStorage.clear()
  clearSession()
  clearKeeper()
})

it('formats a room code as ABC-123 from the peer id', () => {
  expect(formatRoomCode('abc123xyz')).toBe('ABC-123')
})

it('uppercases and handles short ids', () => {
  expect(formatRoomCode('ab1')).toBe('AB1')
})

it('parseRoomCode inverts formatRoomCode for a host-id-sized code', () => {
  const id = makeRoomCode()
  expect(id).toHaveLength(6)
  expect(parseRoomCode(formatRoomCode(id))).toBe(id)
})

it('parseRoomCode tolerates user-entered separators and casing', () => {
  expect(parseRoomCode('ABC-23D')).toBe('abc23d')
  expect(parseRoomCode(' abc 23d ')).toBe('abc23d')
})

it('classifies a peer-unavailable error as not-found', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })
  act(() => {
    transports[0].onError?.({
      type: 'peer-unavailable',
      message: 'Could not connect to peer f96nmt',
    })
  })
  expect(result.current.status).toBe('error')
  expect(result.current.errorKind).toBe('not-found')
})

it('classifies any other error as a connection failure', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })
  act(() => {
    transports[0].onError?.({ type: 'network', message: 'Lost connection to server' })
  })
  expect(result.current.status).toBe('error')
  expect(result.current.errorKind).toBe('connection')
})

it('clears errorKind alongside the error', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })
  act(() => {
    transports[0].onError?.({ type: 'peer-unavailable', message: 'nope' })
  })
  act(() => {
    result.current.clearError()
  })
  expect(result.current.error).toBeNull()
  expect(result.current.errorKind).toBeNull()
})

it('closes the previous transport when joining again after a failure', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })
  act(() => {
    transports[0].onError?.({ type: 'peer-unavailable', message: 'nope' })
  })

  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })

  expect(transports).toHaveLength(2)
  expect(transports[0].close).toHaveBeenCalledOnce()
  expect(transports[1].close).not.toHaveBeenCalled()
})

it('preserves a not-found errorKind when the never-opened channel then disconnects', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })
  act(() => {
    transports[0].onError?.({
      type: 'peer-unavailable',
      message: 'Could not connect to peer f96nmt',
    })
  })
  // The channel never opened (no onConnection fired), so hostConnectedRef is
  // still false when PeerJS follows up with a disconnect for the same peer —
  // this must not clobber the more specific 'not-found' already recorded.
  act(() => {
    transports[0].onDisconnect?.(parseRoomCode('F96-NMT'))
  })
  expect(result.current.status).toBe('error')
  expect(result.current.errorKind).toBe('not-found')
})

it('reports connection for a host disconnect after a successful connection, even over a stale kind', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })
  const hostId = parseRoomCode('F96-NMT')
  // Contrive a stale, unrelated errorKind before the channel opens, so the
  // post-connect disconnect path is proven to overwrite unconditionally
  // rather than accidentally inheriting the same "preserve if set" rule.
  act(() => {
    transports[0].onError?.({ type: 'peer-unavailable', message: 'stale' })
  })
  act(() => {
    transports[0].onConnection?.(hostId)
  })
  act(() => {
    transports[0].onDisconnect?.(hostId)
  })
  expect(result.current.status).toBe('error')
  expect(result.current.errorKind).toBe('connection')
})

// --- leaving the lobby for the board, together ---

it('host startGame broadcasts GAME_STARTING and records the game id', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.createRoom('Dimbo', 6)
  })
  expect(result.current.gameId).toBeNull()

  act(() => {
    result.current.startGame()
  })

  const hostId = result.current.state?.hostId
  const expectedSeats = [{ playerId: 'p1', peerId: hostId, clientId: getClientId(), name: 'Dimbo' }]
  expect(transports[0].broadcast).toHaveBeenCalledWith({
    type: 'GAME_STARTING',
    payload: {
      gameId: `${hostId}-1`,
      // The seating rides the frame so no peer ever has to derive one.
      seats: expectedSeats,
    },
  })
  expect(result.current.gameId).toBe(`${hostId}-1`)
  expect(result.current.seats).toEqual(expectedSeats)
})

it('a guest follows the host out of the lobby', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })
  const hostId = parseRoomCode('F96-NMT')

  act(() => {
    transports[0].onMessage?.({
      type: 'GAME_STARTING',
      payload: { gameId: hostId, seats: SEATING },
      from: hostId,
    } as WireMessage)
  })

  // The guest never clicked anything: this is the whole point of broadcasting.
  expect(result.current.gameId).toBe(hostId)
})

it("a guest holds the host's seating rather than deriving one of its own", async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })
  const hostId = parseRoomCode('F96-NMT')

  act(() => {
    transports[0].onMessage?.({
      type: 'GAME_STARTING',
      payload: { gameId: hostId, seats: SEATING },
      from: hostId,
    } as WireMessage)
  })

  // Named peers this guest's own roster has never heard of: only the frame can
  // be the source. Anything the guest computed locally would seat itself.
  expect(result.current.seats).toEqual(SEATING)
})

it("a rematch drops the previous match's projection before the board remounts", async () => {
  // GAME_STARTING and the new match's first SYNC are separate DataChannel
  // events, and React commits the navigation between them. A projection left in
  // place is the one the rematch's board mounts on: the deal intro arms on the
  // new gameId, finds no opening in match 1's view, reports itself done — and
  // the rematch's opening deal is never played, while match 1's game-over
  // overlay paints for that commit.
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })
  const hostId = parseRoomCode('F96-NMT')

  act(() => {
    transports[0].onMessage?.({
      type: 'GAME_STARTING',
      payload: { gameId: 'g1', seats: SEATING },
      from: hostId,
    } as WireMessage)
  })
  act(() => {
    transports[0].onMessage?.({
      type: 'SYNC',
      payload: { view: { over: { winner: 'p1' } }, events: [] },
      from: hostId,
    } as unknown as WireMessage)
  })
  expect(result.current.gameSync).not.toBeNull()

  act(() => {
    transports[0].onMessage?.({
      type: 'GAME_STARTING',
      payload: { gameId: 'g2', seats: SEATING },
      from: hostId,
    } as WireMessage)
  })

  expect(result.current.gameId).toBe('g2')
  expect(result.current.gameSync).toBeNull()
})

it('a repeat of the same GAME_STARTING keeps the projection it already has', async () => {
  // Only a *different* match invalidates the view. A duplicate frame — a relay
  // hiccup, a re-broadcast — must not blank a table that is already playing.
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })
  const hostId = parseRoomCode('F96-NMT')
  const starting = {
    type: 'GAME_STARTING',
    payload: { gameId: 'g1', seats: SEATING },
    from: hostId,
  } as WireMessage

  act(() => {
    transports[0].onMessage?.(starting)
  })
  act(() => {
    transports[0].onMessage?.({
      type: 'SYNC',
      payload: { view: { over: null }, events: [] },
      from: hostId,
    } as unknown as WireMessage)
  })
  const held = result.current.gameSync

  act(() => {
    transports[0].onMessage?.(starting)
  })

  expect(result.current.gameSync).toBe(held)
})

it('ignores a GAME_STARTING that did not come from the host', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })

  act(() => {
    transports[0].onMessage?.({
      type: 'GAME_STARTING',
      payload: { gameId: 'somewhere-else', seats: SEATING },
      from: 'another-guest',
    } as WireMessage)
  })

  // Starting the game is the host's word alone — otherwise any peer could drag
  // the table to a board of its choosing.
  expect(result.current.gameId).toBeNull()
  expect(result.current.seats).toEqual([])
})

it('forgets the game id when the session is torn down', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.createRoom('Dimbo', 6)
  })
  act(() => {
    result.current.startGame()
  })
  expect(result.current.gameId).not.toBeNull()

  act(() => {
    result.current.leaveSession()
  })
  // A stale id would bounce the player straight back to the board they left.
  expect(result.current.gameId).toBeNull()
  // And the seating describes a match nobody is in any more.
  expect(result.current.seats).toEqual([])
})

it('walking back to the lobby forgets the match but keeps its seating', async () => {
  // The seating outlives leaveGame on purpose. A results screen still mounted
  // would otherwise fall back to seatsFor(live roster) and renumber the seats —
  // one player's counters under another player's name, the departed player's row
  // gone. Nothing paints today because React batches this with the navigation
  // that follows, but that would make the invariant rest on statement order
  // inside a click handler rather than on the data.
  const { result } = await hostWithGuest()
  act(() => {
    result.current.startGame()
  })
  const dealt = result.current.seats
  expect(dealt).toHaveLength(2)

  act(() => {
    result.current.leaveGame()
  })

  // The id goes — it is what would bounce this peer back to the board.
  expect(result.current.gameId).toBeNull()
  // The seating stays, unchanged.
  expect(result.current.seats).toEqual(dealt)
})

it('a new match replaces the seating the last one left behind', async () => {
  // Why keeping it across leaveGame is safe: nothing reads it stale.
  const { result } = await hostWithGuest()
  act(() => {
    result.current.startGame()
  })
  act(() => {
    result.current.leaveGame()
  })

  act(() => {
    result.current.startGame()
  })

  expect(result.current.gameId).toBe(`${result.current.state?.hostId}-2`)
  expect(result.current.seats).toHaveLength(2)
})

// --- reporting the opening deal is done ---

// Every frame the hook addressed to a single peer, in order.
function sentTo(peerId: string): Message[] {
  return transports[0].send.mock.calls
    .filter((call) => call[0] === peerId)
    .map((call) => call[1] as Message)
}

// Everything that left this peer at all — targeted or broadcast.
function sentAll(): Message[] {
  const t = transports[0]
  if (!t) return []
  return [
    ...t.send.mock.calls.map((call) => call[1] as Message),
    ...t.broadcast.mock.calls.map((call) => call[0] as Message),
  ]
}

// A hosted lobby with one other seated player. The guest's peer id sorts after
// the host's ('peer0'), so the host takes seat p1 and holds the opening turn —
// otherwise the intent below would be rejected for being out of turn and prove
// nothing about the gate.
const GUEST = 'zguest'

// The browser behind that guest, as its JOIN_REQUEST announces it. Stable
// across a reload, which is the whole point: it is what says a join is a
// return.
const GUEST_CLIENT = 'client-bo'

// A seating as a guest receives it: peers this guest's own roster has never
// heard of, so nothing derived locally could produce it.
const SEATING = [
  { playerId: 'p1', peerId: 'aaa', name: 'Ann' },
  { playerId: 'p2', peerId: 'bbb', name: 'Bo' },
]

async function hostWithGuest(): Promise<ReturnType<typeof renderHook<UseLobby, unknown>>> {
  const rendered = renderHook(() => useLobby())
  await act(async () => {
    await rendered.result.current.createRoom('Dimbo', 6)
  })
  act(() => {
    transports[0].onMessage?.({
      type: 'JOIN_REQUEST',
      payload: { name: 'Bo', clientId: GUEST_CLIENT },
      from: GUEST,
    } as WireMessage)
  })
  return rendered
}

it('host builds the game behind a gate covering every seat', async () => {
  const { result } = await hostWithGuest()
  act(() => {
    result.current.startGame()
  })
  const syncs = () => sentTo(GUEST).filter((m) => m.type === 'SYNC').length
  // The deal's own projection, and nothing else yet.
  expect(syncs()).toBe(1)

  // A legitimate action from the host's own seat: buffered, not applied, because
  // the table is still watching its cards fly.
  act(() => {
    result.current.gameLink?.submit({ type: 'DRAW' })
  })
  expect(syncs()).toBe(1)

  // The host's own seat reports — it is in the gate's expect list like any
  // other, so the table does not move for it alone.
  act(() => {
    result.current.introReady()
  })
  expect(syncs()).toBe(1)

  // The last seat reports, off the wire, and the buffered action lands.
  act(() => {
    transports[0].onMessage?.({
      type: 'INTRO_READY',
      payload: { gameId: result.current.gameId },
      from: GUEST,
    } as WireMessage)
  })
  expect(syncs()).toBe(2)
})

it('the opening projection carries the deal to every seat', async () => {
  const { result } = await hostWithGuest()
  act(() => {
    result.current.startGame()
  })

  // Asserted on what actually left this peer, not on `createSession`'s return
  // value: production discards that array and delivers through the keeper, so a
  // test reading it passed for a fortnight while no peer ever received a deal.
  const guestSync = sentTo(GUEST).find((m) => m.type === 'SYNC')
  expect(guestSync).toBeDefined()
  const dealt = guestSync?.type === 'SYNC' ? guestSync.payload.events : []
  // One per seat, and public — a hand count is not a secret, so the guest hears
  // about the host's deal as well as its own.
  expect(dealt.filter((e) => e.type === 'dealt')).toHaveLength(2)
  // The ids the engine reserved for the deal (createGame returns
  // eventSeq: seating.length, so play starts at N+1).
  expect(dealt.map((e) => e.id)).toEqual([1, 2])
})

it('gives the local seat its deal too, not only the wire', async () => {
  const { result } = await hostWithGuest()
  act(() => {
    result.current.startGame()
  })
  // The host's own seat is served through its local link rather than a
  // connection to itself, so it is a separate delivery path and a separate way
  // for the deal to go missing.
  const sync = result.current.gameSync
  expect(sync).toBeTruthy()
  expect(sync?.events.filter((e) => e.type === 'dealt')).toHaveLength(2)
})

it('a guest tells the host when its intro is done', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })
  const hostId = parseRoomCode('F96-NMT')
  act(() => {
    transports[0].onMessage?.({
      type: 'GAME_STARTING',
      payload: { gameId: hostId, seats: SEATING },
      from: hostId,
    } as WireMessage)
  })

  act(() => {
    result.current.introReady()
  })

  expect(sentTo(hostId)).toContainEqual({ type: 'INTRO_READY', payload: { gameId: hostId } })
})

it('reporting ready outside a game is a no-op', async () => {
  // In a lobby, with a live transport and a host to address: only the absence of
  // a game keeps the frame from being sent.
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })
  const before = sentAll().length

  act(() => {
    result.current.introReady()
  })

  expect(sentAll()).toHaveLength(before)
  expect(sentAll().some((m) => m.type === 'INTRO_READY')).toBe(false)
})

it('cancels the start gate when the session is torn down', async () => {
  vi.useFakeTimers()
  try {
    const { result } = await hostWithGuest()
    act(() => {
      result.current.startGame()
    })
    // Buffered behind the gate: the cap firing is what would later play it.
    act(() => {
      result.current.gameLink?.submit({ type: 'DRAW' })
    })
    act(() => {
      result.current.leaveSession()
    })

    // The cap is the only thing that unfreezes a table whose peer never
    // reports — but after a teardown there is no table left for it to open, and
    // a pending one would deal a card into a session the player has left.
    act(() => {
      vi.advanceTimersByTime(INTRO_CAP_MS + 1)
    })
    expect(sentTo(GUEST).filter((m) => m.type === 'SYNC')).toHaveLength(1)
  } finally {
    vi.useRealTimers()
  }
})

it("a rematch takes the previous match's keeper and gate down with it", async () => {
  vi.useFakeTimers()
  try {
    const { result } = await hostWithGuest()
    act(() => {
      result.current.startGame()
    })
    // Buffered behind match 1's gate. Match 1's cap is the only thing that would
    // ever play it — and after a rematch there is no match 1 to play it into.
    act(() => {
      result.current.gameLink?.submit({ type: 'DRAW' })
    })

    act(() => {
      result.current.startGame()
    })
    act(() => {
      vi.advanceTimersByTime(INTRO_CAP_MS + 1)
    })

    // Reassigning the refs is not teardown: without an explicit close the old
    // keeper's ticker runs for the life of the tab with setGameSync still in its
    // listener set, and the old gate's cap fires this buffered draw into a game
    // nobody is playing any more.
    const drawn = sentTo(GUEST).filter(
      (m) => m.type === 'SYNC' && m.payload.events.some((e) => e.type === 'drawn'),
    )
    expect(drawn).toHaveLength(0)
  } finally {
    vi.useRealTimers()
  }
})

it('a guest sends its whereabouts to the host', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Dimbo')
  })
  const hostId = result.current.state?.hostId ?? ''

  act(() => {
    result.current.setWhere('stats')
  })

  expect(sentTo(hostId)).toContainEqual({ type: 'WHEREABOUTS', payload: { where: 'stats' } })
})

it('a host applies its own whereabouts without sending anything to itself', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.createRoom('Dimbo', 6)
  })
  const selfId = result.current.state?.selfId ?? ''

  act(() => {
    result.current.setWhere('game')
  })

  expect(result.current.state?.peers[selfId].where).toBe('game')
  expect(sentAll()).not.toContainEqual(expect.objectContaining({ type: 'WHEREABOUTS' }))
})

it('gives each match its own id, so a second one is distinguishable from the first', async () => {
  // hostWithGuest() rather than a bare createRoom: startGame needs a seated
  // table, and this is the file's own helper for one (line ~278).
  const { result } = await hostWithGuest()
  const hostId = result.current.state?.hostId ?? ''

  act(() => {
    result.current.startGame()
  })
  const first = result.current.gameId

  act(() => {
    result.current.startGame()
  })
  const second = result.current.gameId

  expect(first).toBe(`${hostId}-1`)
  expect(second).toBe(`${hostId}-2`)
  // The whole point: a consumer keying a reset on gameId — the follower, the
  // move-history feed, the deal intro — sees a rematch as a different game.
  expect(first).not.toBe(second)
})

// --- what survives a reload ---

const SESSION_KEY = 'release:session'
const KEEPER_KEY = 'release:keeper'

function storedSession(): StoredSession | null {
  return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null')
}

function storedKeeper(): StoredKeeper | null {
  return JSON.parse(sessionStorage.getItem(KEEPER_KEY) ?? 'null')
}

// How many times the keeper snapshot was actually serialized. The point of the
// throttle is that this is far smaller than the number of commits behind it.
function keeperWrites(spy: ReturnType<typeof vi.spyOn<Storage, 'setItem'>>): number {
  return spy.mock.calls.filter((call) => call[0] === KEEPER_KEY).length
}

it('persists the session when a room is created', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.createRoom('Ann', 4)
  })

  expect(storedSession()).toMatchObject({
    roomCode: result.current.roomCode,
    name: 'Ann',
    role: 'host',
    gameId: null,
  })
})

it('persists the session when a room is joined', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Bo')
  })

  // The room code, not this peer's own id: it is what a reload has to dial.
  expect(storedSession()).toMatchObject({
    roomCode: 'F96-NMT',
    name: 'Bo',
    role: 'guest',
    gameId: null,
  })
})

it('records the match in the stored session when the host starts one', async () => {
  const { result } = await hostWithGuest()

  act(() => {
    result.current.startGame()
  })

  // Without this a restore knows the room but not that a match is running, and
  // would put the host back in a lobby the table has already left.
  expect(storedSession()?.gameId).toBe(result.current.gameId)
})

it('records the match in the stored session when a guest is called to the board', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Bo')
  })
  const hostId = parseRoomCode('F96-NMT')

  act(() => {
    transports[0].onMessage?.({
      type: 'GAME_STARTING',
      payload: { gameId: 'g1', seats: SEATING },
      from: hostId,
    } as WireMessage)
  })

  expect(storedSession()?.gameId).toBe('g1')
})

it('forgets what it stored when the room is left', async () => {
  vi.useFakeTimers()
  try {
    const { result } = await hostWithGuest()
    act(() => {
      result.current.startGame()
    })
    act(() => {
      vi.advanceTimersByTime(KEEPER_SAVE_MS)
    })
    expect(sessionStorage.getItem(KEEPER_KEY)).not.toBeNull()

    act(() => {
      result.current.leaveSession()
    })

    // Both records describe a room this browser is no longer in; offering to
    // resume it is offering to rejoin a table the player walked away from.
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
    expect(sessionStorage.getItem(KEEPER_KEY)).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

it('forgets what it stored when the host kicks this peer', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Bo')
  })
  const hostId = parseRoomCode('F96-NMT')
  const selfId = result.current.state?.selfId ?? ''
  expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull()

  act(() => {
    transports[0].onMessage?.({
      type: 'PLAYER_KICKED',
      payload: { peerId: selfId },
      from: hostId,
    } as WireMessage)
  })

  expect(result.current.status).toBe('kicked')
  // A stored record here would walk the kicked player straight back in.
  expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  expect(sessionStorage.getItem(KEEPER_KEY)).toBeNull()
})

it('coalesces a burst of keeper commits into one serialization', async () => {
  vi.useFakeTimers()
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  try {
    const { result } = await hostWithGuest()
    act(() => {
      result.current.startGame()
    })
    // The write trails the commit; nothing has been serialized yet.
    expect(keeperWrites(writes)).toBe(0)

    // Open the gate so the table is live, then act twice inside the same
    // window — a burst of resolution events, in miniature.
    act(() => {
      result.current.introReady()
    })
    act(() => {
      transports[0].onMessage?.({
        type: 'INTRO_READY',
        payload: { gameId: result.current.gameId },
        from: GUEST,
      } as WireMessage)
    })
    act(() => {
      result.current.gameLink?.submit({ type: 'DRAW' })
    })
    act(() => {
      result.current.gameLink?.submit({ type: 'PUSH' })
    })
    expect(keeperWrites(writes)).toBe(0)

    act(() => {
      vi.advanceTimersByTime(KEEPER_SAVE_MS)
    })

    // The deal and both actions: one whole-GameState serialization, not three.
    expect(keeperWrites(writes)).toBe(1)
  } finally {
    writes.mockRestore()
    vi.useRealTimers()
  }
})

it('does not rewrite the snapshot for a keeper that is only ticking', async () => {
  vi.useFakeTimers()
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  try {
    const { result } = await hostWithGuest()
    act(() => {
      result.current.startGame()
    })
    act(() => {
      result.current.introReady()
    })
    act(() => {
      transports[0].onMessage?.({
        type: 'INTRO_READY',
        payload: { gameId: result.current.gameId },
        from: GUEST,
      } as WireMessage)
    })
    // Let the deal, and the turn clock the first tick starts, settle.
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    const settled = keeperWrites(writes)
    expect(settled).toBeGreaterThan(0)

    act(() => {
      vi.advanceTimersByTime(2500)
    })

    // Ten more ticks, twenty more commits, and nothing at the table moved: the
    // session handed back is the very object already written.
    expect(keeperWrites(writes)).toBe(settled)
  } finally {
    writes.mockRestore()
    vi.useRealTimers()
  }
})

it('cannot let a pending snapshot land after the room is left', async () => {
  vi.useFakeTimers()
  try {
    const { result } = await hostWithGuest()
    act(() => {
      result.current.startGame()
    })
    // Teardown inside the throttle's window, which is where the race lives.
    act(() => {
      result.current.leaveSession()
    })

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // A trailing write firing after clearKeeper() would put the abandoned match
    // straight back — and /start would offer to resume it.
    expect(sessionStorage.getItem(KEEPER_KEY)).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

it("stores the lobby seating beside the referee's, which carries neither name nor client", async () => {
  vi.useFakeTimers()
  try {
    const { result } = await hostWithGuest()
    act(() => {
      result.current.startGame()
    })
    act(() => {
      vi.advanceTimersByTime(KEEPER_SAVE_MS)
    })

    const stored = storedKeeper()
    expect(stored?.gameId).toBe(result.current.gameId)
    // What a restore needs to recognise a returning player and to label a seat
    // whose peer is gone. It cannot be reconstructed from the seats below.
    expect(stored?.lobbySeats).toEqual(result.current.seats)
    expect(stored?.seats).toEqual([
      { playerId: 'p1', peerId: 'peer0', absentSince: null },
      { playerId: 'p2', peerId: GUEST, absentSince: null },
    ])
  } finally {
    vi.useRealTimers()
  }
})

// --- coming back ---

// A host mid-match whose guest has dropped its channel. The returning peer
// arrives as a fresh join carrying the same clientId, which is the only thing
// that says otherwise.
async function hostWhoseGuestDropped(): Promise<ReturnType<typeof renderHook<UseLobby, unknown>>> {
  const rendered = await hostWithGuest()
  act(() => {
    rendered.result.current.startGame()
  })
  act(() => {
    transports[0].onDisconnect?.(GUEST)
  })
  return rendered
}

const RETURNED = 'zguest-again'

function rejoin(): void {
  act(() => {
    transports[0].onMessage?.({
      type: 'JOIN_REQUEST',
      payload: { name: 'Bo', clientId: GUEST_CLIENT },
      from: RETURNED,
    } as WireMessage)
  })
}

it('tells the keeper about a dropped peer, not just the roster', async () => {
  const { result } = await hostWhoseGuestDropped()
  expect(result.current.state?.peers[GUEST]).toBeUndefined()

  rejoin()

  // The roster and the keeper are separate books and both have to be told. Had
  // only the roster heard about the drop, the seat would still be bound to the
  // dead peer id — and `rebind` refuses a seat whose peerId is not null, so the
  // returning player would find their own seat occupied and never receive a
  // projection.
  expect(sentTo(RETURNED).some((m) => m.type === 'SYNC')).toBe(true)
})

it('recovers a returning seat even when its JOIN_REQUEST beats onDisconnect there', async () => {
  const { result } = await hostWithGuest()
  act(() => {
    result.current.startGame()
  })

  // Deliberately do NOT fire onDisconnect for GUEST first. WebRTC disconnect
  // detection can lag a fast manual reload, so the new connection's
  // JOIN_REQUEST can be handled — and the lobby book patched — before the old
  // channel is ever declared closed to the referee. Without the ordering fix
  // in the rejoin branch, the referee's seat still names the dead peer id,
  // `rebind` refuses the claim, and the seat is soft-locked with no
  // self-healing path: every later intent from RETURNED fails seat
  // resolution, and driveUnattended never engages because the referee still
  // believes the seat is connected.
  rejoin()

  // The lobby book alone would show this as recovered (see the previous
  // test's own risk); what proves the *referee's* book also moved is a SYNC
  // reaching the new peer id — `rebind` only emits one once it accepts the
  // claim.
  expect(sentTo(RETURNED).some((m) => m.type === 'SYNC')).toBe(true)
})

it('calls a returning player back to the board it left', async () => {
  const { result } = await hostWhoseGuestDropped()

  rejoin()

  // GAME_STARTING is what useFollowGameStart watches, so it is also what puts
  // the returner back on its board — no new navigation code.
  expect(sentTo(RETURNED)).toContainEqual(
    expect.objectContaining({
      type: 'GAME_STARTING',
      payload: { gameId: result.current.gameId, seats: result.current.seats },
    }),
  )
})

it('the catch-up projection lands behind the frame that routes the returner', async () => {
  await hostWhoseGuestDropped()

  rejoin()

  // DataChannels preserve order, so a SYNC sent first would reach a peer that
  // has not built its remote link yet and be dropped on the floor.
  const frames = sentTo(RETURNED).map((m) => m.type)
  expect(frames.indexOf('GAME_STARTING')).toBeGreaterThanOrEqual(0)
  expect(frames.indexOf('GAME_STARTING')).toBeLessThan(frames.indexOf('SYNC'))
})

it("repoints the host's own copy of the seating at the peer id that came back", async () => {
  const { result } = await hostWhoseGuestDropped()
  expect(result.current.seats.find((s) => s.clientId === GUEST_CLIENT)?.peerId).toBe(GUEST)

  rejoin()

  expect(result.current.seats.find((s) => s.clientId === GUEST_CLIENT)?.peerId).toBe(RETURNED)
  // And everyone else is told, or their winner lookup and results rows keep
  // naming a peer id that no longer exists.
  expect(transports[0].broadcast).toHaveBeenCalledWith({
    type: 'SEAT_REBOUND',
    payload: { playerId: 'p2', peerId: RETURNED },
  })
})

it('a guest repoints the seat a returning player came back on', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Bo')
  })
  const hostId = parseRoomCode('F96-NMT')
  act(() => {
    transports[0].onMessage?.({
      type: 'GAME_STARTING',
      payload: { gameId: 'g1', seats: SEATING },
      from: hostId,
    } as WireMessage)
  })

  act(() => {
    transports[0].onMessage?.({
      type: 'SEAT_REBOUND',
      payload: { playerId: 'p2', peerId: 'bbb-again' },
      from: hostId,
    } as WireMessage)
  })

  expect(result.current.seats).toEqual([
    { playerId: 'p1', peerId: 'aaa', name: 'Ann' },
    { playerId: 'p2', peerId: 'bbb-again', name: 'Bo' },
  ])
})

it('ignores a SEAT_REBOUND that did not come from the host', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('F96-NMT', 'Bo')
  })
  const hostId = parseRoomCode('F96-NMT')
  act(() => {
    transports[0].onMessage?.({
      type: 'GAME_STARTING',
      payload: { gameId: 'g1', seats: SEATING },
      from: hostId,
    } as WireMessage)
  })

  act(() => {
    transports[0].onMessage?.({
      type: 'SEAT_REBOUND',
      payload: { playerId: 'p2', peerId: 'stolen' },
      from: 'another-guest',
    } as WireMessage)
  })

  // Repointing a seat is the host's word alone — otherwise any peer could
  // address another seat's fan-out at itself.
  expect(result.current.seats).toEqual(SEATING)
})

it('a player who left the match rejoins the room as a newcomer, not a returner', async () => {
  const { result } = await hostWhoseGuestDropped()
  // The frozen seating outlives leaveGame on purpose — a results screen still
  // mounted reads it — so it is the match id, not the seating, that says
  // whether there is anything to come back to.
  act(() => {
    result.current.leaveGame()
  })

  rejoin()

  // No board to be sent to, and no seat to be marked mid-match with.
  expect(sentTo(RETURNED).some((m) => m.type === 'GAME_STARTING')).toBe(false)
  expect(result.current.state?.peers[RETURNED]).toMatchObject({ ready: false, where: 'lobby' })
  // And the seating of a match nobody is playing is left exactly as it was.
  expect(result.current.seats.find((s) => s.clientId === GUEST_CLIENT)?.peerId).toBe(GUEST)
  expect(transports[0].broadcast).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'SEAT_REBOUND' }),
  )
})

it('walking back to the lobby drops the stored match but keeps the room', async () => {
  vi.useFakeTimers()
  try {
    const { result } = await hostWithGuest()
    act(() => {
      result.current.startGame()
    })
    act(() => {
      vi.advanceTimersByTime(KEEPER_SAVE_MS)
    })
    expect(sessionStorage.getItem(KEEPER_KEY)).not.toBeNull()

    act(() => {
      result.current.leaveGame()
    })

    // The match is over for this peer; the room is not. A reload has to be able
    // to put them back in the lobby, and must not put them back on the board.
    expect(sessionStorage.getItem(KEEPER_KEY)).toBeNull()
    expect(storedSession()).toMatchObject({
      roomCode: result.current.roomCode,
      name: 'Dimbo',
      role: 'host',
      gameId: null,
    })
  } finally {
    vi.useRealTimers()
  }
})

it('a snapshot still on its trailing edge cannot survive walking back to the lobby', async () => {
  vi.useFakeTimers()
  try {
    const { result } = await hostWithGuest()
    act(() => {
      result.current.startGame()
    })
    // Left inside the throttle's window: the deal's snapshot is queued and not
    // yet serialized, so only cancelling it keeps it from landing behind the
    // clear below.
    act(() => {
      result.current.leaveGame()
    })

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(sessionStorage.getItem(KEEPER_KEY)).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

// --- host restore ---

function storedHostSession(gameId: string | null): void {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      roomCode: formatRoomCode('peer0'),
      name: 'Dimbo',
      role: 'host',
      gameId,
      joinedAt: Date.now(),
    } satisfies StoredSession),
  )
}

// A snapshot built through the real referee, the same way `startGame` builds
// one — so the state a restore adopts is one the engine could actually have
// produced, not a hand-rolled shape that only happens to typecheck.
// `hostPeerId` is p1's peerId in the stored referee seats; the restore only
// keeps a seat whose peerId matches the freshly reclaimed transport id, so a
// test proving that has to control what that id will be.
function storedKeeperSnapshot(hostPeerId: string, gameId = 'g1'): StoredKeeper {
  const engine = createFakeEngine()
  const { session } = createSession({
    gameId,
    keeperId: 'p1',
    engine,
    seed: 1,
    players: [
      { playerId: 'p1', peerId: hostPeerId, name: 'Dimbo' },
      { playerId: 'p2', peerId: 'old-guest', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const snapshot: StoredKeeper = {
    gameId,
    keeperId: 'p1',
    state: session.state,
    seats: session.seats,
    lobbySeats: [
      { playerId: 'p1', peerId: hostPeerId, clientId: 'client-host', name: 'Dimbo' },
      { playerId: 'p2', peerId: 'old-guest', clientId: 'client-guest', name: 'Bo' },
    ],
    log: session.log,
    savedAt: Date.now(),
  }
  sessionStorage.setItem(KEEPER_KEY, JSON.stringify(snapshot))
  return snapshot
}

it('hands the restored host its own table back without waiting for it to act', async () => {
  storedHostSession('g1')
  const snapshot = storedKeeperSnapshot('peer0')

  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })

  // The whole point of restoring: the board has something to render the moment
  // it mounts. `useGame` derives its view from this, and the page falls through
  // to EMPTY_TABLE while it is null — the blank table this feature exists to
  // fix. A keeper the host has merely SUBSCRIBED to sends nothing on its own;
  // something has to ask it for the current state.
  expect(result.current.gameSync).not.toBeNull()

  // It is the hand the snapshot described, not a fresh deal.
  const engine = createFakeEngine()
  const expected = engine.project(snapshot.state as Parameters<typeof engine.project>[0], 'p1')
  expect(result.current.gameSync?.view.self.hand.map((c) => c.uid)).toEqual(
    expected.self.hand.map((c) => c.uid),
  )

  // And it carries no events, so the board's deal intro finds nothing to replay
  // and hands over at once. This is what separates `resync()` from the
  // `resync(setupEvents(...))` that opens a brand new match.
  expect(result.current.gameSync?.events).toEqual([])
})

it('restores the host to the match it was keeping, without replaying the deal', async () => {
  storedHostSession('g1')
  storedKeeperSnapshot('peer0')

  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })

  expect(result.current.status).toBe('in-lobby')
  expect(result.current.isHost).toBe(true)
  expect(result.current.roomCode).toBe(formatRoomCode('peer0'))
  expect(result.current.gameId).toBe('g1')
  expect(result.current.seats).toEqual([
    { playerId: 'p1', peerId: 'peer0', clientId: 'client-host', name: 'Dimbo' },
    { playerId: 'p2', peerId: 'old-guest', clientId: 'client-guest', name: 'Bo' },
  ])
  // A restore DOES send one projection — the host has to be given the table it
  // came back to. What it must not do is replay the deal, so the discriminator
  // is the SYNC's events, not its existence: `resync()` carries none, while the
  // `resync(setupEvents(...))` that opens a new match carries the whole opening.
  // Asserting the absence of any SYNC would pass just as well for a host that
  // was never handed its table at all.
  expect(result.current.gameSync).not.toBeNull()
  expect(result.current.gameSync?.events).toEqual([])
})

// From the outside, a session that adopted no log plays identically to one
// that adopted the real thing — it syncs, it accepts intents, nothing errors.
// The only way the difference shows is a later commit: whatever `Session.log`
// held when it was made is what the next keeper write persists, so a restore
// that dropped the deal on the floor would surface here as a persisted log
// containing only the new action, with the match's own history gone.
it('carries the log the match already had forward, not just its position', async () => {
  vi.useFakeTimers()
  try {
    storedHostSession('g1')
    const snapshot = storedKeeperSnapshot('peer0')
    // Sanity: there is history here to lose in the first place.
    expect(snapshot.log.length).toBeGreaterThan(0)

    const { result } = renderHook(() => useLobby())
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      result.current.gameLink?.submit({ type: 'DRAW' })
    })
    act(() => {
      vi.advanceTimersByTime(KEEPER_SAVE_MS)
    })

    const persisted = storedKeeper()
    expect(persisted?.log.length).toBeGreaterThan(snapshot.log.length)
    expect(persisted?.log.slice(0, snapshot.log.length)).toEqual(snapshot.log)
  } finally {
    vi.useRealTimers()
  }
})

// A restored session's gameId is `${hostId}-N}`, exactly what startGame itself
// would have minted — matchSeqRef has to be reseeded from that N, or a rematch
// in the same tab (no reload in between) mints the SAME id a second time. That
// id collision is silent: useGame keys its move-history reset on `gameId`
// changing, so a repeat would open the rematch's board still carrying the
// finished match's events.
it('reseeds the match counter on restore, so a rematch does not reuse the restored gameId', async () => {
  const restoredGameId = 'peer0-1'
  storedHostSession(restoredGameId)
  storedKeeperSnapshot('peer0', restoredGameId)

  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })
  expect(result.current.gameId).toBe(restoredGameId)

  // The restored match is over; walk back to the lobby and start a rematch
  // without ever reloading the tab.
  act(() => {
    result.current.leaveGame()
  })
  act(() => {
    result.current.startGame()
  })

  expect(result.current.gameId).not.toBeNull()
  expect(result.current.gameId).not.toBe(restoredGameId)
})

it("reclaims the room code's exact peer id rather than minting a fresh one", async () => {
  storedHostSession('g1')
  storedKeeperSnapshot('peer0')

  renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })

  expect(createTransport).toHaveBeenCalledWith(
    expect.objectContaining({ peerId: parseRoomCode(formatRoomCode('peer0')) }),
  )
})

it('passes no gate: a submitted intent applies right away instead of waiting on INTRO_READY', async () => {
  storedHostSession('g1')
  storedKeeperSnapshot('peer0')

  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })
  // The restore's own projection, before any intent — so "a sync exists" can no
  // longer stand in for "the intent was applied". Identity is the discriminator.
  const beforeIntent = result.current.gameSync
  expect(beforeIntent).not.toBeNull()

  act(() => {
    result.current.gameLink?.submit({ type: 'DRAW' })
  })

  // A gate still closed would buffer this behind INTRO_READY and emit nothing,
  // leaving the restore's own projection as the latest one.
  expect(result.current.gameSync).not.toBe(beforeIntent)
})

it('does nothing on mount when no session was ever stored', async () => {
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })
  expect(transports).toHaveLength(0)
  // The early return happens before setRestoring(true) is ever reached, so a
  // no-op restore must never flip the overlay flag on.
  expect(result.current.restoring).toBe(false)
})

it('hands a stored guest session to the guest reconnect path, not the host restore', async () => {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      roomCode: 'ABC-123',
      name: 'Bo',
      role: 'guest',
      // Mid-match at the time of reload. The guest reconnect path (Task 7)
      // covers this the same way it covers a lobby reload — restoreHost stays
      // strictly host-only.
      gameId: 'g1',
      joinedAt: Date.now(),
    } satisfies StoredSession),
  )
  storedKeeperSnapshot('peer0')

  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })
  // restoreHost never touched this: no keeper adopted, no host role taken.
  expect(result.current.isHost).toBe(false)
  // The guest reconnect path re-dials instead of sitting idle on /start.
  expect(transports).toHaveLength(1)
  expect(result.current.roomCode).toBe('ABC-123')
})

it('does not restore a stored room with no match running', async () => {
  storedHostSession(null)
  storedKeeperSnapshot('peer0')

  renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })
  expect(transports).toHaveLength(0)
})

it('does not restore when the keeper snapshot belongs to a different match', async () => {
  storedHostSession('g-live')
  storedKeeperSnapshot('peer0') // snapshot itself carries gameId 'g1'

  renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })
  expect(transports).toHaveLength(0)
})

it('retries past a stale unavailable-id left by a fast reload, and recovers', async () => {
  vi.useFakeTimers()
  try {
    storedHostSession('g1')
    storedKeeperSnapshot('peer0')
    // The broker still answers for the old registration on the first dial;
    // by the retry it has let go.
    vi.mocked(createTransport).mockImplementationOnce(() =>
      Promise.reject({ type: 'unavailable-id', message: 'still registered' }),
    )

    const { result } = renderHook(() => useLobby())
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(backoffMs(1))
    })

    expect(result.current.status).toBe('in-lobby')
    expect(result.current.isHost).toBe(true)
    // The rejected attempt never produced a transport of its own.
    expect(transports).toHaveLength(1)
  } finally {
    vi.useRealTimers()
  }
})

it('surfaces the error once every reconnect attempt is spent', async () => {
  vi.useFakeTimers()
  try {
    storedHostSession('g1')
    storedKeeperSnapshot('peer0')
    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) {
      vi.mocked(createTransport).mockImplementationOnce(() =>
        Promise.reject({ type: 'unavailable-id', message: 'still registered' }),
      )
    }

    const { result } = renderHook(() => useLobby())
    await act(async () => {
      await Promise.resolve()
    })
    let totalBackoff = 0
    for (let attempt = 1; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
      totalBackoff += backoffMs(attempt)
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(totalBackoff)
    })

    expect(result.current.status).toBe('error')
    // Never surfaced through a bare createTransport rejection path that would
    // leave 'connecting' spinning forever.
    expect(transports).toHaveLength(0)
  } finally {
    vi.useRealTimers()
  }
})

// `restoring` is the host's half of the reconnect overlay (Task 8 derives the
// board's `connection` prop from it): true only while restoreHost is actually
// working, false the rest of the time — including once it settles, on either
// path. A stuck `true` would leave the overlay up over a board that has
// already recovered or already given up.
it('restoring is true only while the restore is in flight, and clears once it recovers', async () => {
  vi.useFakeTimers()
  try {
    storedHostSession('g1')
    storedKeeperSnapshot('peer0')
    // A rejected first attempt buys a real window (the backoff wait) in which
    // to observe `restoring` mid-flight — a same-tick success would collapse
    // start and end into a single microtask and prove nothing.
    vi.mocked(createTransport).mockImplementationOnce(() =>
      Promise.reject({ type: 'unavailable-id', message: 'still registered' }),
    )

    const { result } = renderHook(() => useLobby())
    // Everything up to the first genuine await (createTransport) runs
    // synchronously inside the mount effect, and renderHook flushes that
    // through act() before returning — so `restoring` is already true here,
    // not merely "eventually".
    expect(result.current.restoring).toBe(true)

    await act(async () => {
      await Promise.resolve()
    })
    // The first attempt has failed and the retry is behind its backoff wait —
    // still in flight.
    expect(result.current.restoring).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(backoffMs(1))
    })

    expect(result.current.status).toBe('in-lobby')
    expect(result.current.restoring).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

it('restoring clears back to false once every reconnect attempt is spent', async () => {
  vi.useFakeTimers()
  try {
    storedHostSession('g1')
    storedKeeperSnapshot('peer0')
    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) {
      vi.mocked(createTransport).mockImplementationOnce(() =>
        Promise.reject({ type: 'unavailable-id', message: 'still registered' }),
      )
    }

    const { result } = renderHook(() => useLobby())
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.restoring).toBe(true)

    let totalBackoff = 0
    for (let attempt = 1; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
      totalBackoff += backoffMs(attempt)
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(totalBackoff)
    })

    expect(result.current.status).toBe('error')
    // The finally clears it on the failure path too — a stuck `true` here
    // would leave the board's reconnect overlay up with nothing left trying.
    expect(result.current.restoring).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

// --- guest reconnect ---

// A stored guest session, the shape a reload would find. `gameId` distinguishes
// a lobby reload (null) from a match reload — the guest reconnect path covers
// both the same way, by re-dialing the same room.
// Reloading is not the only way a peer ends up off the table: when the HOST
// reloads, every guest's channel dies under it. Before this, that guest sat on
// a frozen board with `status: 'error'` and no dial running — it recovered only
// if the player thought to reload too. A drop mid-match starts the same
// reconnect run a reload does.
it('starts dialling when the host drops mid-match, instead of only erroring', async () => {
  sessionStorage.clear()
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.joinRoom('ABC-123', 'Bo')
  })
  const hostId = parseRoomCode('ABC-123')
  const t = transports[0]
  act(() => {
    t.onConnection?.(hostId)
  })
  // A live match, which is what separates this from a lobby disconnect.
  act(() => {
    t.onMessage?.({
      type: 'GAME_STARTING',
      payload: { gameId: 'g1', seats: [] },
      from: hostId,
      seq: 1,
    } as WireMessage)
  })
  expect(result.current.gameId).toBe('g1')

  act(() => {
    t.onDisconnect?.(hostId)
  })

  // The overlay's own signal, not a dead-end error screen.
  expect(result.current.reconnect.status).toBe('trying')
})

function storedGuestSession(gameId: string | null): void {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      roomCode: 'ABC-123',
      name: 'Bo',
      role: 'guest',
      gameId,
      joinedAt: Date.now(),
    } satisfies StoredSession),
  )
}

it('re-dials the stored room when the reload happened in the lobby', async () => {
  storedGuestSession(null)

  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })
  // It dialed the stored room rather than sitting idle on /start.
  expect(transports.length).toBe(1)
  expect(result.current.roomCode).toBe('ABC-123')

  // JOIN_REQUEST only goes out once the DataChannel to the host actually
  // opens — the same onConnection callback joinRoom always used, driven the
  // same way every other guest test in this file drives it.
  const hostId = parseRoomCode('ABC-123')
  await act(async () => {
    transports[0].onConnection?.(hostId)
    await Promise.resolve()
  })

  // And it announced itself with the clientId that gets its lobby slot back.
  const join = sentTo(hostId).find((m) => m.type === 'JOIN_REQUEST')
  expect(join?.type === 'JOIN_REQUEST' && join.payload.clientId).toBeTruthy()
  // A successful reconnect must not leave the overlay up over a working table.
  expect(result.current.reconnect.status).toBe('idle')
})

it('does not run the guest reconnect when the host restore already succeeded', async () => {
  storedHostSession('g1')
  storedKeeperSnapshot('peer0')

  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })

  expect(result.current.isHost).toBe(true)
  // Exactly the one dial the host restore made — restoreHost succeeding must
  // not also fire off a guest-shaped reconnect on top of it.
  expect(transports).toHaveLength(1)
  expect(result.current.reconnect.status).toBe('idle')
})

it('retries the guest dial with backoff, and gives up once every attempt is spent', async () => {
  vi.useFakeTimers()
  try {
    storedGuestSession(null)

    const { result } = renderHook(() => useLobby())
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.reconnect.status).toBe('trying')
    expect(result.current.reconnect.attempt).toBe(1)
    expect(result.current.reconnect.maxAttempts).toBe(MAX_RECONNECT_ATTEMPTS)

    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      // The host never answers — PeerJS reports it unreachable.
      await act(async () => {
        transports[attempt - 1].onError?.({ type: 'peer-unavailable', message: 'nope' })
        await Promise.resolve()
      })
      if (attempt < MAX_RECONNECT_ATTEMPTS) {
        expect(result.current.reconnect.status).toBe('trying')
        await act(async () => {
          await vi.advanceTimersByTimeAsync(backoffMs(attempt))
        })
      }
    }

    expect(result.current.reconnect.status).toBe('failed')
    expect(result.current.reconnect.attempt).toBe(MAX_RECONNECT_ATTEMPTS)
    // One dial per attempt, no more.
    expect(transports).toHaveLength(MAX_RECONNECT_ATTEMPTS)
    expect(result.current.reconnect.events.at(-1)).toMatchObject({
      kind: 'failed',
      attempt: MAX_RECONNECT_ATTEMPTS,
    })
  } finally {
    vi.useRealTimers()
  }
})

it('a teardown mid-backoff stops the guest reconnect loop for good', async () => {
  vi.useFakeTimers()
  try {
    storedGuestSession(null)

    const { result } = renderHook(() => useLobby())
    await act(async () => {
      await Promise.resolve()
    })
    // Fail the first attempt, landing the loop inside its backoff wait.
    await act(async () => {
      transports[0].onError?.({ type: 'peer-unavailable', message: 'nope' })
      await Promise.resolve()
    })
    expect(result.current.reconnect.status).toBe('trying')

    act(() => {
      result.current.leaveSession()
    })
    // The player walked away — the overlay this feeds must not keep showing a
    // reconnect that is no longer happening.
    expect(result.current.reconnect.status).toBe('idle')

    // Advance well past every remaining backoff: no further dial may happen,
    // and a late-resolving joinRoom must not resurrect the abandoned session.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(transports).toHaveLength(1)
    expect(result.current.reconnect.status).toBe('idle')
    expect(result.current.status).toBe('idle')
  } finally {
    vi.useRealTimers()
  }
})

it('retry starts a fresh run from attempt 1', async () => {
  vi.useFakeTimers()
  try {
    storedGuestSession(null)

    const { result } = renderHook(() => useLobby())
    await act(async () => {
      await Promise.resolve()
    })
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      await act(async () => {
        transports[attempt - 1].onError?.({ type: 'peer-unavailable', message: 'nope' })
        await Promise.resolve()
      })
      if (attempt < MAX_RECONNECT_ATTEMPTS) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(backoffMs(attempt))
        })
      }
    }
    expect(result.current.reconnect.status).toBe('failed')
    const spentTransports = transports.length

    act(() => {
      result.current.reconnect.retry()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.reconnect.status).toBe('trying')
    expect(result.current.reconnect.attempt).toBe(1)
    // A fresh dial, not a resumption of the spent run.
    expect(transports.length).toBe(spentTransports + 1)
  } finally {
    vi.useRealTimers()
  }
})

// --- fix round: superseded runs must not settle or tear down another run ---

it('retry() after a successful reconnect leaves the live transport alone', async () => {
  storedGuestSession(null)

  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })
  const hostId = parseRoomCode('ABC-123')
  await act(async () => {
    transports[0].onConnection?.(hostId)
    await Promise.resolve()
  })
  expect(result.current.reconnect.status).toBe('idle')

  // A stray double-invoke, or anything else reaching retry() outside the
  // 'trying'/'failed' gate — the button the next task wires this to must
  // never be able to disconnect a player who is already back at the table.
  act(() => {
    result.current.reconnect.retry()
  })
  await act(async () => {
    await Promise.resolve()
  })

  // No re-entry: no new dial, and — the actual danger — the live transport
  // was never closed. joinRoom's very first act is transportRef.current?.close(),
  // so a re-entered run would have torn down the working connection.
  expect(transports).toHaveLength(1)
  expect(transports[0].close).not.toHaveBeenCalled()
  expect(result.current.reconnect.status).toBe('idle')
})

it("a superseded run's belated channel-open does not settle the run that replaced it", async () => {
  storedGuestSession(null)

  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })
  // Attempt 1 has dialed and is genuinely in flight — connectTo was called,
  // but nothing has reported an outcome yet (not sleeping in backoff).
  expect(transports).toHaveLength(1)
  expect(result.current.reconnect.status).toBe('trying')

  // retry() supersedes it mid-dial, the same window a stray click or the
  // overlay's own retry button could land in.
  act(() => {
    result.current.reconnect.retry()
  })
  await act(async () => {
    await Promise.resolve()
  })
  expect(transports).toHaveLength(2)
  expect(result.current.reconnect.attempt).toBe(1)

  const hostId = parseRoomCode('ABC-123')
  // The abandoned dial's own channel opens moments after being superseded —
  // exactly the "had opened its channel when superseded" case: closing it
  // from the new joinRoom() call fires a real close later, but here it
  // reports success instead, on the outcome PeerJS actually delivered to it.
  await act(async () => {
    transports[0].onConnection?.(hostId)
    await Promise.resolve()
  })

  // Without the epoch guard, transports[0]'s onConnection unconditionally
  // resolves whatever is currently in reconnectSettleRef — which by now is
  // run 2's own pending settle — reporting a connection nobody's actual live
  // dial (transports[1]) ever confirmed.
  expect(result.current.reconnect.status).toBe('trying')

  // The genuinely new dial's own outcome is still honored normally.
  await act(async () => {
    transports[1].onConnection?.(hostId)
    await Promise.resolve()
  })
  expect(result.current.reconnect.status).toBe('idle')
})

it("an earlier attempt's belated channel-open does not settle the next attempt in the same run", async () => {
  // The within-run counterpart to the retry() test above: reconnectEpochRef
  // is bumped once per RUN, not once per attempt, so an epoch-only guard
  // cannot tell attempt 1's belated event apart from attempt 2's own — even
  // with no retry() anywhere in this test. This is the loop's own ordinary
  // multi-attempt operation on a flaky connection, which is the ordinary
  // condition the whole feature exists to survive, not a player clicking
  // anything at an unlucky moment.
  vi.useFakeTimers()
  try {
    storedGuestSession(null)

    const { result } = renderHook(() => useLobby())
    await act(async () => {
      await Promise.resolve()
    })
    expect(transports).toHaveLength(1)
    expect(result.current.reconnect.attempt).toBe(1)

    const hostId = parseRoomCode('ABC-123')
    // Attempt 1 fails normally (the host is unreachable), settling its own
    // promise through the ordinary onError path.
    await act(async () => {
      transports[0].onError?.({ type: 'peer-unavailable', message: 'nope' })
      await Promise.resolve()
    })
    expect(result.current.reconnect.status).toBe('trying')

    // The backoff elapses and attempt 2 dials — a fresh transport, still the
    // same run.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(backoffMs(1))
    })
    expect(transports).toHaveLength(2)
    expect(result.current.reconnect.attempt).toBe(2)

    // Attempt 1's own, now-abandoned transport reports a belated
    // channel-open — its own dial closure, fired directly the same way
    // every guest test in this file drives onConnection, arriving after
    // attempt 2 has already begun.
    await act(async () => {
      transports[0].onConnection?.(hostId)
      await Promise.resolve()
    })
    // Without a per-attempt (not merely per-run) token, this resolves
    // whatever is currently in reconnectSettleRef — attempt 2's own pending
    // settle — reporting a connection attempt 2's actual dial
    // (transports[1]) never confirmed, and falsely clearing the overlay
    // over a table that was never actually reached: status would read
    // 'idle' while transports[1] sits open but never joined.
    expect(result.current.reconnect.status).toBe('trying')
    expect(result.current.reconnect.attempt).toBe(2)

    // Attempt 2's own outcome is still honored normally.
    await act(async () => {
      transports[1].onConnection?.(hostId)
      await Promise.resolve()
    })
    expect(result.current.reconnect.status).toBe('idle')
  } finally {
    vi.useRealTimers()
  }
})

it("retry() firing while an earlier attempt's dial is still inside createTransport does not leave the new run stuck", async () => {
  // The fix-round-3 scenario, precisely: retry() lands before the earlier
  // attempt has even reached `await settled` — it is still awaiting
  // createTransport itself. That earlier attempt's belated conclusion
  // (however it resolves) must not prevent the run that superseded it from
  // ever reaching a terminal state.
  storedGuestSession(null)

  // Attempt 1's own createTransport call is held open by hand rather than
  // resolving on the next microtask like the default mock — this is what
  // makes it "genuinely in flight, inside createTransport" at the moment
  // retry() fires, rather than already at `await settled`.
  let rejectStuckDial: ((err: unknown) => void) | undefined
  const stuckDial = new Promise<never>((_resolve, reject) => {
    rejectStuckDial = reject
  })
  vi.mocked(createTransport).mockImplementationOnce(() => stuckDial)

  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })
  // Attempt 1 is stuck before ever producing a transport of its own.
  expect(transports).toHaveLength(0)
  expect(result.current.reconnect.status).toBe('trying')
  expect(result.current.reconnect.attempt).toBe(1)

  // retry() supersedes it. The new run's own attempt 1 uses the default
  // mock (only one override was queued above), so it dials normally.
  act(() => {
    result.current.reconnect.retry()
  })
  await act(async () => {
    await Promise.resolve()
  })
  expect(transports).toHaveLength(1)
  expect(result.current.reconnect.attempt).toBe(1)

  // The abandoned attempt's createTransport call now concludes — belatedly,
  // after the new run has already installed its own pending attempt. This
  // is what used to null out the new run's settle handle out from under it.
  await act(async () => {
    rejectStuckDial?.(new Error('stale dial'))
    await Promise.resolve()
  })

  const hostId = parseRoomCode('ABC-123')
  // The new run's own dial succeeds normally.
  await act(async () => {
    transports[0].onConnection?.(hostId)
    await Promise.resolve()
  })

  // Without a per-attempt settle handle, the abandoned attempt's belated
  // conclusion silences the new run's own handle before its onConnection
  // ever fires, so `await settled` inside the new run's own loop iteration
  // never resolves or rejects — reconnect.status hangs at 'trying' forever,
  // even though the connection the player is actually looking at (this
  // transport) succeeded.
  expect(result.current.reconnect.status).toBe('idle')
})

it('starts a solo match with no transport and no room', () => {
  const { result } = renderHook(() => useLobby())
  act(() => {
    result.current.startSolo('Ann', ['Bot 1', 'Bot 2'], {})
  })

  // The room is what solo does without. `gameId` is what carries the player to
  // the board (FollowGameStart watches it).
  expect(createTransport).not.toHaveBeenCalled()
  expect(result.current.roomCode).toBeNull()
  expect(result.current.gameId).toMatch(/^solo-\d+$/)
  expect(result.current.isHost).toBe(true)
  expect(result.current.gameLink).not.toBeNull()

  // Three seats, the human first, and every one of them in the roster — the
  // board reads both, and reads a seat missing from the roster as dropped.
  expect(result.current.seats.map((s) => s.playerId)).toEqual(['p1', 'p2', 'p3'])
  expect(Object.keys(result.current.state?.peers ?? {})).toHaveLength(3)
})

it('deals the solo match, so the board has a hand and a deal to replay', () => {
  const { result } = renderHook(() => useLobby())
  act(() => {
    result.current.startSolo('Ann', ['Bot 1'], {})
  })
  expect(result.current.gameSync?.view).toBeTruthy()
  expect(result.current.gameSync?.events.length).toBeGreaterThan(0)
})

it('stores the solo match as resumable, with no room to resume into', () => {
  const { result } = renderHook(() => useLobby())
  act(() => {
    result.current.startSolo('Ann', ['Bot 1'], {})
  })
  const stored = readSession()
  expect(stored?.role).toBe('solo')
  expect(stored?.roomCode).toBeNull()
  expect(stored?.gameId).toBe(result.current.gameId)
})
