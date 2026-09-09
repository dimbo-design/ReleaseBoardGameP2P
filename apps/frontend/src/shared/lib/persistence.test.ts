import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLog,
  clearSession,
  getClientId,
  RESTORE_TTL_MS,
  readKeeper,
  readLog,
  readSession,
  writeKeeper,
  writeLog,
  writeSession,
} from './persistence'

beforeEach(() => {
  sessionStorage.clear()
})

const session = (over: Partial<Parameters<typeof writeSession>[0]> = {}) => ({
  roomCode: 'ABC-123',
  name: 'Ann',
  role: 'guest' as const,
  gameId: 'g1',
  joinedAt: 1_000,
  ...over,
})

it('mints a client id once and returns the same one thereafter', () => {
  const first = getClientId()
  expect(first).toMatch(/[0-9a-f-]{8,}/)
  expect(getClientId()).toBe(first)
})

// The reported bug in one assertion. These records describe ONE peer — who this
// browser is at the table. localStorage is per-origin, so a host tab and a guest
// tab would share one copy and the last writer would win: the host then reloads,
// reads "you are a guest", declines its own restore, and dials its own dead room
// code forever. sessionStorage is per-tab, so two tabs are two peers.
it('keeps its records out of localStorage, so a second tab is a second peer', () => {
  writeSession(session())
  getClientId()
  writeKeeper({
    gameId: 'g1',
    keeperId: 'p1',
    state: {},
    seats: [],
    lobbySeats: [],
    log: [],
    savedAt: 0,
  })

  // The record is in the tab's own store...
  expect(sessionStorage.getItem('release:session')).not.toBeNull()

  // ...and nothing of ours is in the origin-wide one. Asserted over every key
  // rather than one at a time, so a record added later cannot quietly opt out
  // of the isolation this whole module depends on.
  const originWide = Object.keys(localStorage).filter((k) => k.startsWith('release:'))
  expect(originWide).toEqual([])
})

it('round-trips a session record', () => {
  writeSession(session())
  expect(readSession(1_000)).toEqual(session())
})

it('discards a session past the TTL', () => {
  writeSession(session({ joinedAt: 0 }))
  expect(readSession(RESTORE_TTL_MS - 1)).not.toBeNull()
  expect(readSession(RESTORE_TTL_MS + 1)).toBeNull()
})

it('discards a keeper snapshot past the TTL', () => {
  writeKeeper({
    gameId: 'g1',
    keeperId: 'p1',
    state: { a: 1 },
    seats: [],
    lobbySeats: [],
    log: [],
    savedAt: 0,
  })
  expect(readKeeper(RESTORE_TTL_MS - 1)).not.toBeNull()
  expect(readKeeper(RESTORE_TTL_MS + 1)).toBeNull()
})

// A host reload restores the position AND how the match got there — the log is
// what lets a rejoining board render its move history rather than starting
// blank at whatever state the keeper happened to be in.
it('restores the match log along with the state', () => {
  writeKeeper({
    gameId: 'g1',
    keeperId: 'p1',
    state: {},
    seats: [],
    lobbySeats: [],
    log: [{ id: 1 }, { id: 2 }],
    savedAt: 1_000,
  })
  expect(readKeeper(1_000)?.log).toEqual([{ id: 1 }, { id: 2 }])
})

it('returns null rather than throwing on corrupt JSON', () => {
  sessionStorage.setItem('release:session', '{not json')
  expect(readSession(1_000)).toBeNull()
})

it('clearing removes the record', () => {
  writeSession(session())
  clearSession()
  expect(readSession(1_000)).toBeNull()
})

describe('when sessionStorage throws (Safari private mode)', () => {
  it('falls back to memory instead of crashing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => writeSession(session())).not.toThrow()
    expect(readSession(1_000)).toEqual(session())
    vi.restoreAllMocks()
  })
})

describe('the move log record', () => {
  it('round-trips the events it was given', () => {
    writeLog({ gameId: 'g1', events: [{ id: 1 }, { id: 2 }], savedAt: 1_000 })
    expect(readLog('g1', 1_000)).toEqual([{ id: 1 }, { id: 2 }])
  })

  // The persisted form of the guard useGame already runs in memory: seat ids
  // repeat between games, so another match's feed is not this match's history.
  it('refuses a log belonging to another game', () => {
    writeLog({ gameId: 'g1', events: [{ id: 1 }], savedAt: 1_000 })
    expect(readLog('g2', 1_000)).toBeNull()
  })

  it('drops a log older than the restore window', () => {
    writeLog({ gameId: 'g1', events: [{ id: 1 }], savedAt: 0 })
    expect(readLog('g1', RESTORE_TTL_MS + 1)).toBeNull()
  })

  it('drops a record it cannot parse rather than failing the same way forever', () => {
    sessionStorage.setItem('release:log', '{not json')
    expect(readLog('g1', 1_000)).toBeNull()
    expect(sessionStorage.getItem('release:log')).toBeNull()
  })

  it('clears', () => {
    writeLog({ gameId: 'g1', events: [{ id: 1 }], savedAt: 1_000 })
    clearLog()
    expect(readLog('g1', 1_000)).toBeNull()
  })
})
