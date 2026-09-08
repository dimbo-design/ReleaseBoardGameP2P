// What survives a reload. Three records, all under a `release:` prefix.
//
// Plain functions rather than a store: the keeper snapshot is written from
// `referee.ts`, which is a pure module with no React in it — and keeping it
// that way is what lets solo play, the playground and every headless test
// exercise the same code the network does (network/session/link.ts).

const CLIENT_KEY = 'release:clientId'
const SESSION_KEY = 'release:session'
const KEEPER_KEY = 'release:keeper'
const LOG_KEY = 'release:log'

// How long a stored record stays restorable. Long enough to cover a reload, a
// crash, a closed lid and picking a game back up the same evening; short
// enough that a match everyone else abandoned is not offered as resumable.
export const RESTORE_TTL_MS = 12 * 60 * 60 * 1000

// Safari private mode and some embedded webviews throw on both getItem and
// setItem. A browser without storage then behaves exactly as the app did
// before any of this existed — it simply cannot restore — rather than
// crashing on mount.
const memory = new Map<string, string>()

// `sessionStorage`, not `localStorage`, and that choice is load-bearing.
//
// Every record here describes ONE PEER: who this browser is at the table, which
// room it is in, and (for a host) the match it is keeping. localStorage is
// per-ORIGIN, so two tabs of the same app share one copy of all of it and the
// last writer wins. Open a host in one tab and a guest in another — the obvious
// way to play or test locally — and the guest's record overwrites the host's.
// The host then reloads, reads "you are a guest", declines its own restore, and
// starts dialling its own room code: a peer that no longer exists, because it is
// the one that just reloaded. The player watches "link to host lost" forever
// over an empty board. That is not a theoretical collision; it is the reported
// bug, reproduced in a real browser.
//
// sessionStorage is scoped to the TAB, and survives exactly what has to be
// survived: a reload, a crash-restore, and in-tab navigation. Two tabs get two
// identities, which is what two peers are.
//
// What this gives up: closing the tab and reopening it no longer offers the
// match back, because the record went with the tab. That is the smaller loss —
// it trades a rarer convenience for the common case working at all.
function store(): Storage | null {
  try {
    return sessionStorage
  } catch {
    return null
  }
}

function read(key: string): string | null {
  try {
    const stored = store()?.getItem(key)
    if (stored !== null && stored !== undefined) return stored
  } catch {
    // fall through to memory
  }
  return memory.get(key) ?? null
}

function write(key: string, value: string): void {
  memory.set(key, value)
  try {
    store()?.setItem(key, value)
  } catch {
    // memory already holds it
  }
}

function remove(key: string): void {
  memory.delete(key)
  try {
    store()?.removeItem(key)
  } catch {
    // memory is already clear
  }
}

function readJson<T>(key: string): T | null {
  const raw = read(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    // A record we cannot parse is a record we cannot trust. Drop it rather
    // than leave it to fail the same way on every future load.
    remove(key)
    return null
  }
}

// Deliberately NOT cleared by leaving a room: this is the thing that outlives
// the tab, and a player returning to the same room should be recognised.
export function getClientId(): string {
  const existing = read(CLIENT_KEY)
  if (existing) return existing
  const minted = crypto.randomUUID()
  write(CLIENT_KEY, minted)
  return minted
}

export interface StoredSession {
  roomCode: string
  name: string
  role: 'host' | 'guest'
  gameId: string | null
  joinedAt: number
}

export function readSession(now: number = Date.now()): StoredSession | null {
  const stored = readJson<StoredSession>(SESSION_KEY)
  if (!stored) return null
  if (now - stored.joinedAt > RESTORE_TTL_MS) {
    remove(SESSION_KEY)
    return null
  }
  return stored
}

export function writeSession(s: StoredSession): void {
  write(SESSION_KEY, JSON.stringify(s))
}

export function clearSession(): void {
  remove(SESSION_KEY)
}

// `state` and `seats` are held as `unknown` on purpose: importing GameState
// here would tie a storage module to the engine's shape, and the only caller
// that reads them (the host restore) casts once, where the engine types are
// already in scope.
export interface StoredKeeper {
  gameId: string
  keeperId: string
  state: unknown
  // The referee's own seats: `{ playerId, peerId, absentSince }`.
  seats: unknown
  // The lobby's seating: `{ playerId, peerId, clientId, name }`. Held
  // separately because the referee never carries `clientId` or `name`, and a
  // restore needs both — one to recognise a returning player, one to label a
  // seat whose peer is gone. Reconstructing them from the referee's seats is
  // not possible; they were never there.
  lobbySeats: unknown
  savedAt: number
}

export function readKeeper(now: number = Date.now()): StoredKeeper | null {
  const stored = readJson<StoredKeeper>(KEEPER_KEY)
  if (!stored) return null
  if (now - stored.savedAt > RESTORE_TTL_MS) {
    remove(KEEPER_KEY)
    return null
  }
  return stored
}

export function writeKeeper(k: StoredKeeper): void {
  write(KEEPER_KEY, JSON.stringify(k))
}

export function clearKeeper(): void {
  remove(KEEPER_KEY)
}

// The fourth record: this peer's own move feed. Held as `unknown[]` for the
// same reason `StoredKeeper.state` is held as `unknown` — storage does not
// import engine types, and the single caller casts where they are in scope.
//
// It carries its own `gameId` because a feed outliving its match is worse than
// no feed: seat ids repeat between games, so a stale `dealt` would be taken for
// this game's deal.
export interface StoredLog {
  gameId: string
  events: unknown[]
  savedAt: number
}

export function readLog(gameId: string, now: number = Date.now()): unknown[] | null {
  const stored = readJson<StoredLog>(LOG_KEY)
  if (!stored) return null
  if (stored.gameId !== gameId) return null
  if (now - stored.savedAt > RESTORE_TTL_MS) {
    remove(LOG_KEY)
    return null
  }
  return stored.events
}

export function writeLog(l: StoredLog): void {
  write(LOG_KEY, JSON.stringify(l))
}

export function clearLog(): void {
  remove(LOG_KEY)
}
