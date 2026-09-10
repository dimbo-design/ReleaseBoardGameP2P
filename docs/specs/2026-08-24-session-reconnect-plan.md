# Session reconnect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A page reload mid-match puts the player back at the same table, in the same seat, with the same hand — for guests and for the host.

**Architecture:** A per-browser `clientId` in `localStorage` identifies a player across tabs. The keeper snapshots `GameState` on every commit; the host restores it and reclaims its room-code peer id. A returning peer rejoins through the ordinary join path, carrying its `clientId`; the host resolves it to a frozen seat and calls the already-built `rebind`. `referee.ts`'s reconnect core is reused, not rewritten.

**Tech Stack:** TypeScript, React 19, Vitest + jsdom + @testing-library/react, PeerJS, CSS Modules.

**Spec:** [`docs/specs/2026-08-24-session-reconnect-design.md`](./2026-08-24-session-reconnect-design.md)

## Global Constraints

- **Comments in English.** No Russian in source files.
- **No string literals in `.tsx`** — user-visible text goes through `t()`. A key must exist in **both** `packages/translation/src/locales/en/common.json` and `.../ru/common.json`.
- **`@release/ui` is i18n-agnostic** — it never imports i18next; copy arrives as props.
- **Styling:** CSS Modules + design tokens from `apps/ui/src/design/tokens.css`. Never hardcode a color. Text via `<Typography>`. Logical properties (`padding-inline`).
- **Storage prefix:** `release:`. Keys are exactly `release:clientId`, `release:session`, `release:keeper`.
- **TTL:** `RESTORE_TTL_MS = 12 * 60 * 60 * 1000` (12 hours), applied to `release:session` and `release:keeper` alike.
- **Existing constant, do not change:** `ABSENT_GRACE_MS = 30_000` in `referee.ts`.
- **Run from the repo root:** `pnpm test`, `pnpm lint`, `pnpm typecheck`.
- Per-file test run: `pnpm --filter @release/web exec vitest run <path>`.

---

### Task 1: The persistence module

**Files:**
- Create: `apps/frontend/src/shared/lib/persistence.ts`
- Test: `apps/frontend/src/shared/lib/persistence.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RESTORE_TTL_MS: number`
  - `getClientId(): string`
  - `type StoredSession = { roomCode: string; name: string; role: 'host' | 'guest'; gameId: string | null; joinedAt: number }`
  - `readSession(now?: number): StoredSession | null`
  - `writeSession(s: StoredSession): void`
  - `clearSession(): void`
  - `type StoredKeeper = { gameId: string; keeperId: string; state: unknown; seats: unknown; lobbySeats: unknown; savedAt: number }`
  - `readKeeper(now?: number): StoredKeeper | null`
  - `writeKeeper(k: StoredKeeper): void`
  - `clearKeeper(): void`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/shared/lib/persistence.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSession,
  getClientId,
  readKeeper,
  readSession,
  RESTORE_TTL_MS,
  writeKeeper,
  writeSession,
} from './persistence'

beforeEach(() => {
  localStorage.clear()
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
  writeKeeper({ gameId: 'g1', keeperId: 'p1', state: { a: 1 }, seats: [], lobbySeats: [], savedAt: 0 })
  expect(readKeeper(RESTORE_TTL_MS - 1)).not.toBeNull()
  expect(readKeeper(RESTORE_TTL_MS + 1)).toBeNull()
})

it('returns null rather than throwing on corrupt JSON', () => {
  localStorage.setItem('release:session', '{not json')
  expect(readSession(1_000)).toBeNull()
})

it('clearing removes the record', () => {
  writeSession(session())
  clearSession()
  expect(readSession(1_000)).toBeNull()
})

describe('when localStorage throws (Safari private mode)', () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @release/web exec vitest run src/shared/lib/persistence.test.ts`
Expected: FAIL — "Failed to resolve import ./persistence".

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/shared/lib/persistence.ts`:

```ts
// What survives a reload. Three records, all under a `release:` prefix.
//
// Plain functions rather than a store: the keeper snapshot is written from
// `referee.ts`, which is a pure module with no React in it — and keeping it
// that way is what lets solo play, the playground and every headless test
// exercise the same code the network does (network/session/link.ts).

const CLIENT_KEY = 'release:clientId'
const SESSION_KEY = 'release:session'
const KEEPER_KEY = 'release:keeper'

// How long a stored record stays restorable. Long enough to cover a reload, a
// crash, a closed lid and picking a game back up the same evening; short
// enough that a match everyone else abandoned is not offered as resumable.
export const RESTORE_TTL_MS = 12 * 60 * 60 * 1000

// Safari private mode and some embedded webviews throw on both getItem and
// setItem. A browser without storage then behaves exactly as the app did
// before any of this existed — it simply cannot restore — rather than
// crashing on mount.
const memory = new Map<string, string>()

function read(key: string): string | null {
  try {
    const stored = localStorage.getItem(key)
    if (stored !== null) return stored
  } catch {
    // fall through to memory
  }
  return memory.get(key) ?? null
}

function write(key: string, value: string): void {
  memory.set(key, value)
  try {
    localStorage.setItem(key, value)
  } catch {
    // memory already holds it
  }
}

function remove(key: string): void {
  memory.delete(key)
  try {
    localStorage.removeItem(key)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @release/web exec vitest run src/shared/lib/persistence.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/shared/lib/persistence.ts apps/frontend/src/shared/lib/persistence.test.ts
git commit -m "feat(web): what a reload has to put back, written down where it survives (#110)"
```

---

### Task 2: `clientId` on peers and seats

**Files:**
- Modify: `apps/frontend/src/network/types.ts`
- Modify: `apps/frontend/src/entities/game/seats.ts`
- Test: `apps/frontend/src/entities/game/seats.test.ts` (create if absent)

**Interfaces:**
- Consumes: Task 1's `getClientId`.
- Produces:
  - `PeerInfo` gains `clientId: string`
  - `Seat` gains `clientId: string`
  - `JOIN_REQUEST` payload becomes `{ name: string; clientId: string }`
  - `PEER_JOINED` payload gains `clientId: string`
  - new message `{ type: 'SEAT_REBOUND'; payload: { playerId: PlayerId; peerId: string } }`
  - `seatsFor(peers: Record<string, PeerInfo>): Seat[]` — unchanged signature, now stamps `clientId` from each peer

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/entities/game/seats.test.ts`:

```ts
import type { PeerInfo } from '~/network'
import { seatOf, seatsFor } from './seats'

const peer = (id: string, clientId: string, role: PeerInfo['role']): PeerInfo => ({
  id,
  clientId,
  name: id,
  role,
  ready: true,
  where: 'lobby',
})

it('carries each peer clientId onto the seat it is dealt', () => {
  const seats = seatsFor({
    a: peer('a', 'client-a', 'host'),
    b: peer('b', 'client-b', 'player'),
  })
  expect(seats).toEqual([
    { playerId: 'p1', peerId: 'a', clientId: 'client-a', name: 'a' },
    { playerId: 'p2', peerId: 'b', clientId: 'client-b', name: 'b' },
  ])
})

it('seats no spectator', () => {
  const seats = seatsFor({
    a: peer('a', 'client-a', 'host'),
    z: peer('z', 'client-z', 'guest'),
  })
  expect(seats.map((s) => s.peerId)).toEqual(['a'])
})

it('finds a seat by peer id', () => {
  const seats = seatsFor({ a: peer('a', 'client-a', 'host') })
  expect(seatOf(seats, 'a')?.playerId).toBe('p1')
  expect(seatOf(seats, 'nobody')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @release/web exec vitest run src/entities/game/seats.test.ts`
Expected: FAIL — TypeScript rejects `clientId` on `PeerInfo`, and the first assertion finds no `clientId` on the seat.

- [ ] **Step 3: Add `clientId` to the types**

In `apps/frontend/src/network/types.ts`, change `PeerInfo`:

```ts
export interface PeerInfo {
  id: string
  // Stable across a reload, unlike `id` — a PeerJS peer id dies with the tab.
  // This is what lets the host recognise a returning player and hand back the
  // seat it kept for them (shared/lib/persistence.ts).
  clientId: string
  name: string
  role: Role
  ready: boolean
  where: Where
}
```

Change `Seat`:

```ts
export interface Seat {
  playerId: PlayerId
  peerId: string
  // The seat's durable owner. `peerId` is whichever tab currently holds this
  // seat and is rewritten by every rebind; `clientId` is who that tab belongs
  // to and never changes for the life of the match.
  clientId: string
  name: string
}
```

In the `Message` union, change `JOIN_REQUEST` and `PEER_JOINED`, and add `SEAT_REBOUND`:

```ts
  | { type: 'JOIN_REQUEST'; payload: { name: string; clientId: string } }
```

```ts
  | {
      type: 'PEER_JOINED'
      payload: {
        id: string
        clientId: string
        name: string
        role: Role
        ready: boolean
        where: Where
      }
    }
```

Add next to `GAME_STARTING`:

```ts
  // One seat has changed hands: the player who held it reloaded and came back
  // on a new peer id. Every peer holds the frozen seating from GAME_STARTING,
  // so without this patch their winner lookup and results rows keep naming a
  // peer id that no longer exists. The returning peer does not need it — it
  // was sent the whole seating.
  | { type: 'SEAT_REBOUND'; payload: { playerId: PlayerId; peerId: string } }
```

- [ ] **Step 4: Stamp it in `seatsFor`**

In `apps/frontend/src/entities/game/seats.ts`, change the `.map` inside `seatsFor`:

```ts
    .map((p, i) => ({ playerId: seatId(i), peerId: p.id, clientId: p.clientId, name: p.name }))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @release/web exec vitest run src/entities/game/seats.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Fix every construction site the new required field broke**

Run: `pnpm typecheck`

Every `PeerInfo` and `Seat` literal now needs a `clientId`. Expect errors in `network/lobby/host.ts`, `network/useLobby.ts`, `network/lobby/state.test.ts`, `network/useLobby.test.ts`, `entities/game/stats/toStatPlayers.test.ts`, and the board/stats page tests. In **production** code pass the real value (`getClientId()` for self, `msg.payload.clientId` for a remote peer); in **test** fixtures a literal such as `'client-a'` is fine.

Repeat until `pnpm typecheck` is clean.

- [ ] **Step 7: Run the full suite and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green.

```bash
git add -A
git commit -m "feat(web): a seat learns who owns it, not just which tab holds it (#110)"
```

---

### Task 3: The keeper snapshots itself

**Files:**
- Modify: `apps/frontend/src/network/session/referee.ts` (the `driveAbsent` guard)
- Modify: `apps/frontend/src/network/session/remoteLink.ts` (the `onCommit` hook)
- Test: `apps/frontend/src/network/session/referee.test.ts` (append)
- Test: `apps/frontend/src/network/session/remoteLink.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `writeKeeper`.
- Produces: `attachKeeper` accepts an optional `onCommit?: (session: Session) => void`, called after every state change it commits.

- [ ] **Step 1: Write the failing test for the guard**

Append to `apps/frontend/src/network/session/referee.test.ts`:

```ts
it('does not drive absent seats when no seat is connected at all', () => {
  const { session } = twoPlayerSession()
  const empty: Session = {
    ...session,
    seats: session.seats.map((s) => ({ ...s, peerId: null, absentSince: 0 })),
  }
  const result = driveAbsent(empty, ABSENT_GRACE_MS + 1)
  // A keeper with no audience advances nothing: no state change, no fan-out.
  expect(result.session).toBe(empty)
  expect(result.outgoing).toEqual([])
})

it('still drives an absent seat while another seat is connected', () => {
  const { session } = twoPlayerSession()
  const oneGone: Session = {
    ...session,
    seats: session.seats.map((s) =>
      s.playerId === session.state.turn.player ? { ...s, peerId: null, absentSince: 0 } : s,
    ),
  }
  const result = driveAbsent(oneGone, ABSENT_GRACE_MS + 1)
  expect(result.session).not.toBe(oneGone)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @release/web exec vitest run src/network/session/referee.test.ts -t "no seat is connected"`
Expected: FAIL — the keeper drives the seat and returns a changed session.

- [ ] **Step 3: Add the guard**

In `apps/frontend/src/network/session/referee.ts`, as the first statement of `driveAbsent`:

```ts
export function driveAbsent(session: Session, now: number): SessionResult {
  // A keeper with nobody connected has no table to keep moving: every SYNC it
  // produced would be addressed to a seat that cannot receive it, and the
  // match would advance for no one. Not reachable for a host-keeper, which
  // keeps its own seat through a restore — this guards the case where the
  // keeper itself is the peer whose seat dropped.
  if (!session.seats.some((s) => s.peerId !== null)) return { session, outgoing: [] }

  const expired = session.seats.filter(
```

- [ ] **Step 4: Verify the guard tests pass**

Run: `pnpm --filter @release/web exec vitest run src/network/session/referee.test.ts`
Expected: PASS, including the two new tests.

- [ ] **Step 5: Write the failing test for `onCommit`**

Append to `apps/frontend/src/network/session/remoteLink.test.ts`:

```ts
it('reports every committed state change to onCommit', () => {
  const net = createMemoryNetwork(['host', 'guest'])
  const { session } = createSession({
    gameId: 'g1',
    keeperId: 'p1',
    engine: createFakeEngine(),
    seed: 1,
    players: [
      { playerId: 'p1', peerId: 'host', name: 'Ann' },
      { playerId: 'p2', peerId: 'guest', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const ref: SessionRef = { current: session }
  const saved: string[] = []
  const keeper = attachKeeper({
    ref,
    transport: net.transport('host'),
    now: () => 1_000,
    onCommit: (s) => saved.push(s.gameId),
  })

  keeper.peerLeft('guest')

  expect(saved).toEqual(['g1'])
  keeper.close()
})
```

Make sure the file's imports include `attachKeeper`, `createSession`, `createMemoryNetwork`, `createFakeEngine`, `FAKE_DECK`, `FAKE_EVENTS`, and `type SessionRef`.

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @release/web exec vitest run src/network/session/remoteLink.test.ts -t "onCommit"`
Expected: FAIL — TypeScript rejects the unknown `onCommit` property.

- [ ] **Step 7: Add the hook**

In `apps/frontend/src/network/session/remoteLink.ts`, add to `attachKeeper`'s argument type, after `gate`:

```ts
  // Called after every state change this keeper commits. The keeper's own
  // commits are the only ones worth persisting — a local link's are solo play
  // and the playground, which have no session to come back to. Optional so
  // every existing caller and test is unaffected.
  onCommit?: (session: Session) => void
```

Add `Session` to the existing `./referee` import if it is not already there.

Immediately after `const deliver = (outgoing: Outgoing) => { ... }`, add:

```ts
  // Every internal commit goes through here rather than calling `commit`
  // directly, so persistence cannot be forgotten at one of the several call
  // sites below.
  const save = (result: Parameters<typeof commit>[1]) => {
    commit(args.ref, result, deliver)
    args.onCommit?.(args.ref.current)
  }
```

Then replace **every** `commit(args.ref, X, deliver)` inside `attachKeeper` with `save(X)`. There are several — in `applyNow`, `resync`, `peerLeft`, `peerReturned`, `handover`, and the ticker. Confirm none remain:

```bash
grep -n "commit(args.ref" apps/frontend/src/network/session/remoteLink.ts
```

Expected output: nothing.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @release/web exec vitest run src/network/session/`
Expected: PASS — all session tests, including the new `onCommit` one.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/network/session/
git commit -m "feat(web): the keeper offers up every state it commits, and refuses to play to an empty room (#110)"
```

---

### Task 4: The host recognises a returning player

**Files:**
- Modify: `apps/frontend/src/network/lobby/host.ts`
- Test: `apps/frontend/src/network/lobby/host.test.ts`

**Interfaces:**
- Consumes: Task 2's `PeerInfo.clientId`, `Seat.clientId`.
- Produces: `handleJoinRequest(state: LobbyState, fromId: string, name: string, clientId: string, seats?: Seat[]): Result` — a fifth argument carrying the frozen seating, and a `Result` that may now contain a `SEAT_REBOUND`.

- [ ] **Step 1: Write the failing test**

Append to `apps/frontend/src/network/lobby/host.test.ts` (create the file with the same import style as `network/lobby/state.test.ts` if it does not exist):

```ts
import type { Seat } from '../types'
import { handleJoinRequest } from './host'
import { createLobbyState } from './state'

const base = () =>
  createLobbyState({
    selfId: 'host',
    hostId: 'host',
    maxPlayers: 2,
    peers: [
      { id: 'host', clientId: 'client-host', name: 'Ann', role: 'host', ready: true, where: 'game' },
    ],
  })

const seating: Seat[] = [
  { playerId: 'p1', peerId: 'host', clientId: 'client-host', name: 'Ann' },
  { playerId: 'p2', peerId: 'dead-peer', clientId: 'client-bo', name: 'Bo' },
]

it('seats a returning player back into the seat their clientId owns', () => {
  const r = handleJoinRequest(base(), 'fresh-peer', 'Bo', 'client-bo', seating)
  expect(r.state.peers['fresh-peer']).toMatchObject({ role: 'player', name: 'Bo' })
  expect(r.outgoing).toContainEqual({
    to: 'broadcast',
    message: { type: 'SEAT_REBOUND', payload: { playerId: 'p2', peerId: 'fresh-peer' } },
  })
})

// The trap this test exists for: assignRole would look at a full room and hand
// back 'guest', silently demoting a player out of a match they are still
// seated in.
it('does not demote a returning player when the room has filled behind them', () => {
  const full = createLobbyState({
    selfId: 'host',
    hostId: 'host',
    maxPlayers: 2,
    peers: [
      { id: 'host', clientId: 'client-host', name: 'Ann', role: 'host', ready: true, where: 'game' },
      { id: 'squatter', clientId: 'client-x', name: 'Cy', role: 'player', ready: true, where: 'game' },
    ],
  })
  const r = handleJoinRequest(full, 'fresh-peer', 'Bo', 'client-bo', seating)
  expect(r.state.peers['fresh-peer'].role).toBe('player')
})

it('treats an unknown clientId as an ordinary join', () => {
  const r = handleJoinRequest(base(), 'newcomer', 'Cy', 'client-new', seating)
  expect(r.state.peers.newcomer.role).toBe('player')
  expect(r.outgoing.some((o) => o.message.type === 'SEAT_REBOUND')).toBe(false)
})

it('treats any join as ordinary when no match is running', () => {
  const r = handleJoinRequest(base(), 'fresh-peer', 'Bo', 'client-bo')
  expect(r.outgoing.some((o) => o.message.type === 'SEAT_REBOUND')).toBe(false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @release/web exec vitest run src/network/lobby/host.test.ts`
Expected: FAIL — `handleJoinRequest` takes three arguments.

- [ ] **Step 3: Implement the returning branch**

In `apps/frontend/src/network/lobby/host.ts`, add `Seat` to the type import from `../types`, then replace `handleJoinRequest`:

```ts
export function handleJoinRequest(
  state: LobbyState,
  fromId: string,
  name: string,
  clientId: string,
  // The frozen seating, when a match is running. Absent in the lobby, where
  // there are no seats to come back to and every join is a first one.
  seats?: Seat[],
): Result {
  // A return, not a join: this browser already owns a seat at the table. The
  // host pruned its old peer id the instant the channel dropped, so it arrives
  // looking exactly like a newcomer — the clientId is the only thing that says
  // otherwise.
  const seat = seats?.find((s) => s.clientId === clientId)

  // Role comes from the seat, never from assignRole. A returning player whose
  // room filled up behind them would otherwise be handed 'guest' and silently
  // demoted out of a match they are still seated in.
  const role: Role = seat ? (fromId === state.hostId ? 'host' : 'player') : assignRole(state)

  const peer: PeerInfo = {
    id: fromId,
    clientId,
    name,
    role,
    // A returner is mid-match, so it is past readiness; the lobby is the only
    // place to join from, so a newcomer starts there and is not ready.
    ready: seat ? true : false,
    where: seat ? 'game' : 'lobby',
  }
  const next = applyPeerJoined(state, peer)

  return {
    state: next,
    outgoing: [
      {
        to: fromId,
        message: { type: 'PEER_LIST', payload: { peers: peerList(next), yourRole: role } },
      },
      {
        to: fromId,
        message: {
          type: 'LOBBY_CONFIG_UPDATED',
          payload: { maxPlayers: state.maxPlayers, setup: state.setup },
        },
      },
      {
        to: 'broadcast',
        message: {
          type: 'PEER_JOINED',
          payload: { id: fromId, clientId, name, role, ready: peer.ready, where: peer.where },
        },
      },
      // Everyone else holds the seating with this seat's dead peer id in it.
      ...(seat
        ? [
            {
              to: 'broadcast' as const,
              message: {
                type: 'SEAT_REBOUND' as const,
                payload: { playerId: seat.playerId, peerId: fromId },
              },
            },
          ]
        : []),
    ],
  }
}
```

Note `yourRole` in `PEER_LIST` is typed `'player' | 'guest'`; widen it to `Role` in `types.ts` so a returning host is expressible.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @release/web exec vitest run src/network/lobby/`
Expected: PASS, including the four new tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/network/lobby/ apps/frontend/src/network/types.ts
git commit -m "feat(web): a join that carries a known clientId is a return, and keeps its seat (#110)"
```

---

### Task 5: Wiring the session — persist, disconnect, rejoin

**Files:**
- Modify: `apps/frontend/src/network/useLobby.ts`
- Test: `apps/frontend/src/network/useLobby.test.ts` (append)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `UseLobby` gains `restoring: boolean` and `reconnect: { attempt: number; maxAttempts: number; status: 'idle' | 'trying' | 'failed'; events: ReconnectEvent[]; retry(): void }`.
- Produces: `export const MAX_RECONNECT_ATTEMPTS = 5`.

- [ ] **Step 1: Thread `clientId` through join and persist the session**

In `useLobby.ts`, import `getClientId`, `writeSession`, `clearSession`, `readSession`, `writeKeeper`, `clearKeeper` from `~/shared/lib/persistence`.

In `createRoom`, after `commit(initial)`:

```ts
    writeSession({
      roomCode: formatRoomCode(t.id),
      name,
      role: 'host',
      gameId: null,
      joinedAt: Date.now(),
    })
```

and give the host's own `PeerInfo` a `clientId: getClientId()`.

In `joinRoom`, change the `JOIN_REQUEST` send to carry the id, give the local `PeerInfo` the same one, and persist:

```ts
            transport.send(hostId, {
              type: 'JOIN_REQUEST',
              payload: { name, clientId: getClientId() },
            })
```

```ts
    writeSession({
      roomCode: formatRoomCode(hostId),
      name,
      role: 'guest',
      gameId: null,
      joinedAt: Date.now(),
    })
```

In `startGame` and in the `GAME_STARTING` handler, after `setGameId(...)`, update the stored record so a restore knows a match is running:

```ts
    const stored = readSession()
    if (stored) writeSession({ ...stored, gameId: id })
```

In `leaveSession` and `disband`, and where `setStatus('kicked')` is set, call `clearSession()` and `clearKeeper()`.

- [ ] **Step 2: Pass `onCommit` when attaching the keeper**

In `startGame`, change the `attachKeeper` call:

```ts
    const keeper = attachKeeper({
      ref,
      transport: t,
      now: () => Date.now(),
      gate,
      onCommit: (s) =>
        writeKeeper({
          gameId: s.gameId,
          keeperId: s.keeperId,
          state: s.state,
          seats: s.seats,
          // The referee's seats carry no clientId or name; the restore needs
          // both, so the lobby's seating is stored alongside them.
          lobbySeats: seatsRef.current,
          savedAt: Date.now(),
        }),
    })
```

- [ ] **Step 3: Tell the keeper when a peer drops**

In `onDisconnect`, inside the `isHostRef.current` branch, before `commit(applyPeerLeft(...))`:

```ts
        // The roster and the keeper are separate books and both have to be
        // told. Without this the seat stays bound to a dead peer id: its
        // SYNCs are addressed into the void, `driveAbsent` never starts its
        // grace period, and a returning player finds their own seat occupied
        // — `rebind` refuses a seat whose peerId is not null.
        keeperRef.current?.peerLeft(peerId)
```

- [ ] **Step 4: Handle the returning join**

In `onMessage`, change the `JOIN_REQUEST` case:

```ts
        if (msg.type === 'JOIN_REQUEST') {
          const r = handleJoinRequest(
            current,
            msg.from,
            msg.payload.name,
            msg.payload.clientId,
            seatsRef.current,
          )
          commit(r.state)
          dispatch(r.outgoing)

          const seat = seatsRef.current.find((s) => s.clientId === msg.payload.clientId)
          if (seat) {
            // Patch our own copy of the seating, then send the whole thing —
            // GAME_STARTING is what `useFollowGameStart` watches, so it is
            // also what puts the returner back on its board.
            const rebound = seatsRef.current.map((s) =>
              s.clientId === msg.payload.clientId ? { ...s, peerId: msg.from } : s,
            )
            setSeats(rebound)
            seatsRef.current = rebound
            const id = gameIdRef.current
            if (id) {
              dispatch([
                {
                  to: msg.from,
                  message: { type: 'GAME_STARTING', payload: { gameId: id, seats: rebound } },
                },
              ])
              // Dispatched after GAME_STARTING on purpose: DataChannels
              // preserve order, so the catch-up projection this produces lands
              // behind the frame that routes the peer to its board.
              keeperRef.current?.peerReturned(seat.playerId, msg.from)
            }
          }
        }
```

Add a `seatsRef` alongside the existing `seats` state, kept in step with it, so the message handler reads the live seating rather than a closed-over stale copy — mirroring the existing `gameIdRef`/`gameId` pair.

- [ ] **Step 5: Apply `SEAT_REBOUND` on every other peer**

In `onMessage`'s non-host branch, add a case:

```ts
        case 'SEAT_REBOUND': {
          const rebound = seatsRef.current.map((s) =>
            s.playerId === msg.payload.playerId ? { ...s, peerId: msg.payload.peerId } : s,
          )
          setSeats(rebound)
          seatsRef.current = rebound
          break
        }
```

- [ ] **Step 6: Write the failing test**

Append to `apps/frontend/src/network/useLobby.test.ts`:

```ts
it('persists the session when a room is created', async () => {
  localStorage.clear()
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.createRoom('Ann', 4)
  })
  const stored = JSON.parse(localStorage.getItem('release:session') ?? 'null')
  expect(stored).toMatchObject({ name: 'Ann', role: 'host' })
})

it('tells the keeper about a dropped peer, not just the roster', async () => {
  localStorage.clear()
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await result.current.createRoom('Ann', 4)
  })
  const t = transports[0]
  act(() => {
    t.onMessage?.({
      type: 'JOIN_REQUEST',
      payload: { name: 'Bo', clientId: 'client-bo' },
      from: 'peer-bo',
      seq: 1,
    } as WireMessage)
  })
  expect(result.current.state?.peers['peer-bo']).toBeDefined()
  act(() => {
    t.onDisconnect?.('peer-bo')
  })
  expect(result.current.state?.peers['peer-bo']).toBeUndefined()
})
```

- [ ] **Step 7: Run and iterate until green**

Run: `pnpm --filter @release/web exec vitest run src/network/useLobby.test.ts`
Expected: PASS. Fix any `clientId`-shaped compile errors in existing fixtures as they surface.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/network/
git commit -m "feat(web): a dropped peer is reported to both books, and a returning one is seated again (#110)"
```

---

### Task 6: Host restore

**Files:**
- Modify: `apps/frontend/src/network/useLobby.ts`
- Test: `apps/frontend/src/network/session/restore.test.ts` (create)

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: `restoreSeats(stored: RefereeSeat[], hostPeerId: string, now: number): RefereeSeat[]` exported from `apps/frontend/src/network/session/restore.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/network/session/restore.test.ts`:

```ts
import type { Seat as RefereeSeat } from './referee'
import { restoreSeats } from './restore'

const stored: RefereeSeat[] = [
  { playerId: 'p1', peerId: 'ROOMCODE', absentSince: null },
  { playerId: 'p2', peerId: 'guest-old', absentSince: null },
  { playerId: 'p3', peerId: null, absentSince: 5 },
]

it('keeps the host own seat, whose peer id is reclaimed unchanged', () => {
  const seats = restoreSeats(stored, 'ROOMCODE', 10_000)
  expect(seats[0]).toEqual({ playerId: 'p1', peerId: 'ROOMCODE', absentSince: null })
})

it('empties every other seat and restamps its absence to now', () => {
  const seats = restoreSeats(stored, 'ROOMCODE', 10_000)
  expect(seats[1]).toEqual({ playerId: 'p2', peerId: null, absentSince: 10_000 })
})

// The trap: a seat that was already absent carries an old timestamp. Restored
// as-is, driveAbsent sees it far past the 30s grace and bot-plays it before
// the player has any chance to re-dial. The pause was not time spent.
it('restamps a seat that was already absent before the reload', () => {
  const seats = restoreSeats(stored, 'ROOMCODE', 10_000)
  expect(seats[2]).toEqual({ playerId: 'p3', peerId: null, absentSince: 10_000 })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @release/web exec vitest run src/network/session/restore.test.ts`
Expected: FAIL — cannot resolve `./restore`.

- [ ] **Step 3: Implement**

Create `apps/frontend/src/network/session/restore.ts`:

```ts
import type { Seat } from './referee'

// The seating a restored keeper adopts.
//
// Two rules, and both matter. Every seat's absence is restamped to `now`: a
// stored `absentSince` describes time that passed while nothing was keeping
// the table, and `driveAbsent` reading it would see every seat far past its
// 30s grace and bot-play the whole match before a single player could re-dial.
// The pause was not time spent.
//
// The host's own seat is the exception, and keeps its peer id. The room code
// IS that peer id and the restore reclaims it unchanged, so the seat is still
// addressable — and `attachKeeper` routes an outgoing addressed to
// `transport.id` to its own local link rather than over a connection to
// itself. Null it and the restoring host would sit in front of a table it
// never receives a projection for.
export function restoreSeats(stored: Seat[], hostPeerId: string, now: number): Seat[] {
  return stored.map((seat) =>
    seat.peerId === hostPeerId
      ? { ...seat, absentSince: null }
      : { ...seat, peerId: null, absentSince: now },
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @release/web exec vitest run src/network/session/restore.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire the restore into `useLobby`**

Add a `restoreHost` callback and a mount effect. Key points, each of which the spec argues for:

```ts
  // Runs once, before anything else can create a transport. A stored session
  // whose role is 'host' and whose snapshot matches its gameId is a match this
  // browser was keeping when the tab went away.
  const restoreHost = useCallback(async () => {
    const stored = readSession()
    const snapshot = readKeeper()
    if (!stored || stored.role !== 'host' || !snapshot) return false
    if (!stored.gameId || snapshot.gameId !== stored.gameId) return false

    setStatus('connecting')
    setRestoring(true)
    try {
      // Reclaim the EXACT peer id: the room code is that id, so a fresh one
      // would strand every peer still dialing the old one.
      const t = await createTransport({
        peerId: parseRoomCode(stored.roomCode),
        onMessage,
        onError,
        onDisconnect,
      })
      transportRef.current = t
      isHostRef.current = true
      setIsHost(true)
      setRoomCode(stored.roomCode)

      const engine = createFakeEngine()
      const seats = restoreSeats(snapshot.seats as RefereeSeat[], t.id, Date.now())
      const session = adoptSession({
        state: snapshot.state as GameState,
        gameId: snapshot.gameId,
        keeperId: snapshot.keeperId as PlayerId,
        engine,
        seats,
      })
      const ref: SessionRef = { current: session }
      sessionRef.current = ref

      // No gate: the start gate holds the table until every seat reports
      // INTRO_READY, and mid-match nobody ever will — passing one here would
      // deadlock every intent for the rest of the game.
      const keeper = attachKeeper({
        ref,
        transport: t,
        now: () => Date.now(),
        onCommit: (s) =>
          writeKeeper({
            gameId: s.gameId,
            keeperId: s.keeperId,
            state: s.state,
            seats: s.seats,
            lobbySeats: seatsRef.current,
            savedAt: Date.now(),
          }),
      })
      keeperRef.current = keeper
      keeper.link.subscribe(setGameSync)
      setGameLink(() => keeper.link)

      // Only the host is here; everyone else re-dials. Their JOIN_REQUEST
      // carries the clientId that puts them back in their seat (Task 4).
      commit(
        createLobbyState({
          selfId: t.id,
          hostId: t.id,
          maxPlayers: 6,
          setup: {},
          peers: [
            {
              id: t.id,
              clientId: getClientId(),
              name: stored.name,
              role: 'host',
              ready: true,
              where: 'game',
            },
          ],
        }),
      )
      // NOT resync(setupEvents(...)): that call replays the deal, and this
      // match was dealt long ago.
      gameIdRef.current = snapshot.gameId
      setGameId(snapshot.gameId)
      const rebuilt = snapshot.lobbySeats as LobbySeat[]
      setSeats(rebuilt)
      seatsRef.current = rebuilt
      setStatus('in-lobby')
      return true
    } finally {
      setRestoring(false)
    }
  }, [onMessage, onError, onDisconnect, commit, surfaceSetupError])
```

Import `Seat as LobbySeat` from `../types` and `Seat as RefereeSeat` from `./session/referee` — the two `Seat` types are different shapes and collide by name. `lobbySeats` is read straight from the snapshot rather than reconstructed: the referee's seats carry no `clientId` and no `name`, so there is nothing to reconstruct them from.

**On `unavailable-id`:** a fast reload can leave the broker still holding the old registration. Wrap `createTransport` in a retry — up to `MAX_RECONNECT_ATTEMPTS`, backing off `500ms * attempt` — and only surface the error through `surfaceSetupError` once the attempts are spent.

- [ ] **Step 6: Call it on mount**

```ts
  // Once per mount, before any screen can act. A restore that finds nothing
  // stored is a no-op, so this is safe on a cold start.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    void restoreHost()
  }, [restoreHost])
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add apps/frontend/src/network/
git commit -m "feat(web): the host comes back to the match it was keeping (#110)"
```

---

### Task 7: Guest restore and the reconnect loop

**Files:**
- Modify: `apps/frontend/src/network/useLobby.ts`
- Create: `apps/frontend/src/network/session/reconnect.ts`
- Test: `apps/frontend/src/network/session/reconnect.test.ts`

**Interfaces:**
- Produces:
  - `type ReconnectEvent = { kind: 'dialing' | 'channel-open' | 'handshake' | 'backoff' | 'failed'; attempt: number; at: number }`
  - `MAX_RECONNECT_ATTEMPTS = 5`
  - `backoffMs(attempt: number): number`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/network/session/reconnect.test.ts`:

```ts
import { backoffMs, MAX_RECONNECT_ATTEMPTS } from './reconnect'

it('backs off further with each attempt', () => {
  expect(backoffMs(1)).toBeLessThan(backoffMs(2))
  expect(backoffMs(2)).toBeLessThan(backoffMs(3))
})

it('caps the wait so a long outage does not stall for minutes', () => {
  expect(backoffMs(MAX_RECONNECT_ATTEMPTS)).toBeLessThanOrEqual(8_000)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @release/web exec vitest run src/network/session/reconnect.test.ts`
Expected: FAIL — cannot resolve `./reconnect`.

- [ ] **Step 3: Implement**

Create `apps/frontend/src/network/session/reconnect.ts`:

```ts
// One reconnection run, as the session actually experiences it. The overlay
// renders these into terminal lines; nothing here is presentation, so the copy
// rules and the UI package's i18n-agnosticism are both untouched.
export interface ReconnectEvent {
  kind: 'dialing' | 'channel-open' | 'handshake' | 'backoff' | 'failed'
  attempt: number
  at: number
}

// Bounded, then the player chooses: the overlay reaches its failed state and
// keeps retry and leave live, rather than auto-abandoning a match whose wifi
// is about to come back.
export const MAX_RECONNECT_ATTEMPTS = 5

// Exponential with a ceiling. The cap matters more than the curve: a fifth
// attempt eight seconds out still feels like the app is trying, where
// thirty-two would read as hung.
export function backoffMs(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** (attempt - 1))
}
```

- [ ] **Step 4: Run and verify green**

Run: `pnpm --filter @release/web exec vitest run src/network/session/reconnect.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the guest restore path to `useLobby`**

Extend the mount effect from Task 6: when `restoreHost()` returns `false` and a stored session with `role: 'guest'` exists, re-dial through `joinRoom(stored.roomCode, stored.name)`, pushing a `ReconnectEvent` at each stage and retrying up to `MAX_RECONNECT_ATTEMPTS` with `backoffMs`. Expose the run as `reconnect` on `UseLobby`, with `retry()` starting a fresh run from attempt 1.

Because `joinRoom` already sends `JOIN_REQUEST` with `getClientId()` (Task 5), the host recognises the return and Task 4's branch seats them again. No separate rejoin call is needed.

- [ ] **Step 6: Pin the lobby case**

A reload in the lobby loses the room exactly as a reload at the table loses the
match, and the same stored record covers both — a stored session with a null
`gameId` is a lobby, not a match. It is one branch, so it gets one test.

Append to `apps/frontend/src/network/useLobby.test.ts`:

```ts
it('re-dials the stored room when the reload happened in the lobby', async () => {
  localStorage.clear()
  localStorage.setItem(
    'release:session',
    JSON.stringify({
      roomCode: 'ABC-123',
      name: 'Bo',
      role: 'guest',
      // No match running: a lobby reload, not a table reload.
      gameId: null,
      joinedAt: Date.now(),
    }),
  )
  const { result } = renderHook(() => useLobby())
  await act(async () => {
    await Promise.resolve()
  })
  // It dialed the stored room rather than sitting idle on /start.
  expect(transports.length).toBe(1)
  expect(result.current.roomCode).toBe('ABC-123')
  // And it announced itself with the clientId that gets its lobby slot back.
  const join = transports[0].send.mock.calls.find(
    ([, m]: [string, { type: string }]) => m.type === 'JOIN_REQUEST',
  )
  expect(join?.[1].payload.clientId).toBeTruthy()
})
```

Run: `pnpm --filter @release/web exec vitest run src/network/useLobby.test.ts -t "lobby"`
Expected: PASS.

- [ ] **Step 7: Verify and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add apps/frontend/src/network/
git commit -m "feat(web): a guest dials its way back, and stops when the player says so (#110)"
```

---

### Task 8: The board shows who is missing

**Files:**
- Modify: `apps/frontend/src/pages/board/[gameId]/index.tsx`
- Test: `apps/frontend/src/pages/board/[gameId]/__tests__/boardPresence.test.tsx` (create)

**Interfaces:**
- Consumes: `session.seats`, `session.state.peers`, `session.reconnect`.
- Produces: `room.participants`, `room.disconnected`, `room.connection` on `<Table>`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/pages/board/[gameId]/__tests__/boardPresence.test.tsx`, following the mocking style of the existing `board.test.tsx` in that folder:

```tsx
it('keeps a dropped player on the table and marks the seat offline', () => {
  // Two seats frozen at the deal; only one still has a peer in the roster.
  renderBoardWith({
    seats: [
      { playerId: 'p1', peerId: 'me', clientId: 'client-me', name: 'Ann' },
      { playerId: 'p2', peerId: 'gone', clientId: 'client-bo', name: 'Bo' },
    ],
    peers: {
      me: { id: 'me', clientId: 'client-me', name: 'Ann', role: 'host', ready: true, where: 'game' },
    },
  })
  // The seat survives its connection: built from the seating, not the roster.
  expect(screen.getByText('Bo')).toBeTruthy()
  expect(screen.getByText('seat.disconnected')).toBeTruthy()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @release/web exec vitest run "src/pages/board/[gameId]/__tests__/boardPresence.test.tsx"`
Expected: FAIL — "Bo" is not in the document; the seat vanished with the peer.

- [ ] **Step 3: Derive participants from the seating**

In `index.tsx`, replace the `participants`/`spectators` derivation:

```tsx
  // Built from the frozen seating rather than the roster, exactly as the
  // results screen builds its rows (entities/game/stats/toStatPlayers.ts): a
  // peer that has left the roster still holds a seat at this table, and
  // `applyPeerLeft` prunes it the instant its channel drops. Read from `peers`
  // alone, a dropped player's seat vanishes mid-match and there is nothing
  // left to mark as offline.
  const peerMap = session.state?.peers ?? {}
  const participants = seats.map((seat) => {
    const live = peerMap[seat.peerId]
    return {
      id: seat.peerId,
      // The roster's name is the live one; the seat's is what the match was
      // played under, and the only one left once a peer is gone.
      name: live?.name ?? seat.name,
      role: live?.role ?? 'player',
      ready: live?.ready ?? false,
      where: live?.where ?? 'game',
    }
  })

  // Absence IS the offline signal — the same rule the results screen uses.
  const disconnected = seats.filter((s) => !peerMap[s.peerId]).map((s) => s.peerId)

  const spectators = Object.values(peerMap).filter((p) => p.role === 'guest')
```

In the `room` prop, add:

```tsx
          disconnected,
          // The overlay covers both ways a peer can be off the table: a guest
          // dialing its way back, and a host rebuilding the match it was
          // keeping. `restoring` is the host's half — without it the host
          // stares at an empty board for the length of the restore with
          // nothing saying why.
          connection:
            session.restoring || session.reconnect.status === 'trying' ? 'reconnecting' : 'online',
```

- [ ] **Step 4: Run and verify**

Run: `pnpm --filter @release/web exec vitest run "src/pages/board/[gameId]/"`
Expected: PASS — the new test and every existing board test.

- [ ] **Step 5: Commit**

```bash
git add "apps/frontend/src/pages/board/[gameId]/"
git commit -m "feat(web): a seat outlives its connection on the table, not just in the results (#110)"
```

---

### Task 9: The Reconnect overlay stops pretending

**Files:**
- Modify: `apps/ui/src/table/Reconnect/Reconnect.tsx`
- Modify: `apps/ui/src/table/Table/types.ts`
- Modify: `apps/ui/src/table/Table/Table.tsx`
- Modify: `apps/playground/stories/TableStory/TableStory.tsx`
- Modify: `apps/frontend/src/pages/board/[gameId]/index.tsx`
- Test: `apps/ui/src/table/Reconnect/Reconnect.test.tsx` (create)

**Interfaces:**
- Produces: `ReconnectProps = { copy: ReconnectCopy; host: string; attempt: number; maxAttempts: number; status: 'trying' | 'failed'; onRetry(): void; onLeave(): void }`

- [ ] **Step 1: Write the failing test**

Create `apps/ui/src/table/Reconnect/Reconnect.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import Reconnect from './Reconnect'

const copy = {
  label: 'reconnecting…',
  retry: 'reconnect',
  leave: 'leave',
  confirmLeave: 'confirm',
  cancel: 'cancel',
  abortPrompt: '> abort session?',
}

it('shows the real room code, not a placeholder', () => {
  render(
    <Reconnect copy={copy} host="4F2A-9K" attempt={2} maxAttempts={5} status="trying"
      onRetry={() => {}} onLeave={() => {}} />,
  )
  expect(screen.getByText('4F2A-9K')).toBeTruthy()
  expect(screen.queryByText('ABC-DEF')).toBeNull()
})

it('reports which attempt is in flight', () => {
  render(
    <Reconnect copy={copy} host="4F2A-9K" attempt={3} maxAttempts={5} status="trying"
      onRetry={() => {}} onLeave={() => {}} />,
  )
  expect(screen.getByText(/3\/5/)).toBeTruthy()
})

// The prototype's confirm button only closed its own prompt — it never left.
it('confirming the abort actually leaves', () => {
  const onLeave = vi.fn()
  render(
    <Reconnect copy={copy} host="4F2A-9K" attempt={5} maxAttempts={5} status="failed"
      onRetry={() => {}} onLeave={onLeave} />,
  )
  fireEvent.click(screen.getByText('leave'))
  fireEvent.click(screen.getByText('confirm'))
  expect(onLeave).toHaveBeenCalledTimes(1)
})

it('retrying asks the session for another run', () => {
  const onRetry = vi.fn()
  render(
    <Reconnect copy={copy} host="4F2A-9K" attempt={5} maxAttempts={5} status="failed"
      onRetry={onRetry} onLeave={() => {}} />,
  )
  fireEvent.click(screen.getByText('reconnect'))
  expect(onRetry).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @release/ui exec vitest run src/table/Reconnect/Reconnect.test.tsx`
Expected: FAIL — the component takes no `attempt`/`status`/`onRetry`/`onLeave`.

- [ ] **Step 3: Rewrite the component**

Delete `buildScript`, `r()`, the `Beat` interface, the `run` state and the reveal effect. Replace the props and derive the log from the real attempt state:

```tsx
interface ReconnectProps {
  copy: ReconnectCopy
  // The room being dialed — the host peer id, shown in the header.
  host: string
  attempt: number
  maxAttempts: number
  status: 'trying' | 'failed'
  onRetry(): void
  onLeave(): void
}

// The log is technical CLI output (generated, English) and is intentionally
// not translated; the human-facing labels come through `copy`. Derived from
// the attempt state rather than scripted: the pacing is the session's real
// dial cadence, so there is no artificial reveal left to slow down under
// prefers-reduced-motion.
function lines(host: string, attempt: number, maxAttempts: number, failed: boolean): string[] {
  const out = ['$ link to host lost', `$ target ${host}`, '']
  for (let n = 1; n <= attempt; n++) {
    out.push(`> attempt ${n}/${maxAttempts} · dialing ${host}`)
    out.push('  · opening datachannel')
    out.push('  · awaiting handshake')
    if (n < attempt || failed) out.push('  × no answer — peer-unavailable')
    if (n < attempt) out.push('> backing off…', '')
  }
  if (failed) out.push('', '× reconnect failed — host unreachable')
  return out
}

export default function Reconnect({
  copy, host, attempt, maxAttempts, status, onRetry, onLeave,
}: ReconnectProps) {
  const [confirmLeave, setConfirmLeave] = useState(false)
  const failed = status === 'failed'
  const log = lines(host, attempt, maxAttempts, failed)
  ...
}
```

Render `log` where `lines` was rendered before, keying by index. Wire the footer buttons: retry calls `onRetry`, `confirm` calls `onLeave`, `cancel` calls `setConfirmLeave(false)`.

- [ ] **Step 4: Thread the props through `Table`**

In `apps/ui/src/table/Table/types.ts`, replace `connection?: 'online' | 'reconnecting'` with a richer member and keep the old one working for existing callers:

```ts
  connection?: 'online' | 'reconnecting'
  // Present only while `connection` is 'reconnecting'. Absent, the overlay
  // still renders, on attempt 1 of 5 — a caller that knows it is dialing but
  // not how far along should not be forced to invent numbers.
  reconnect?: { attempt: number; maxAttempts: number; status: 'trying' | 'failed' }
  onReconnectRetry?: () => void
  onReconnectLeave?: () => void
```

In `Table.tsx` at the render site:

```tsx
        {room.connection === 'reconnecting' && (
          <Reconnect
            copy={copy.reconnect}
            host={room.code ?? ''}
            attempt={room.reconnect?.attempt ?? 1}
            maxAttempts={room.reconnect?.maxAttempts ?? 5}
            status={room.reconnect?.status ?? 'trying'}
            onRetry={room.onReconnectRetry ?? (() => {})}
            onLeave={room.onReconnectLeave ?? (() => {})}
          />
        )}
```

- [ ] **Step 5: Update the playground story**

In `TableStory.tsx`, the `youDisconnect` view supplies the new shape so the story keeps demonstrating both states. Add a `TechSwitch` toggling `trying`/`failed`:

```tsx
            connection: view === 'youDisconnect' ? 'reconnecting' : 'online',
            reconnect:
              view === 'youDisconnect'
                ? { attempt: reconnectFailed ? 5 : 2, maxAttempts: 5,
                    status: reconnectFailed ? 'failed' : 'trying' }
                : undefined,
            onReconnectRetry: () => setReconnectFailed(false),
            onReconnectLeave: () => setView(null),
```

- [ ] **Step 6: Feed it from the board page**

In `index.tsx`'s `room` prop:

```tsx
          reconnect: {
            attempt: session.reconnect.attempt,
            maxAttempts: session.reconnect.maxAttempts,
            status: session.reconnect.status === 'failed' ? 'failed' : 'trying',
          },
          onReconnectRetry: session.reconnect.retry,
          onReconnectLeave: () => {
            session.leaveSession()
            void navigate('/start')
          },
```

- [ ] **Step 7: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green, including `apps/ui/src/table/Table/Table.test.tsx`'s existing overlay test.

- [ ] **Step 8: Commit**

```bash
git add apps/ui/src/table/ apps/playground/stories/TableStory/ "apps/frontend/src/pages/board/[gameId]/"
git commit -m "feat(ui,web): the reconnect terminal reports the dial that is actually happening (#110)"
```

---

### Task 10: `/start` offers the match back

**Files:**
- Modify: `apps/frontend/src/pages/start.tsx`
- Test: `apps/frontend/src/pages/__tests__/start.test.tsx` (modify)

- [ ] **Step 1: Write the failing test**

Add to `apps/frontend/src/pages/__tests__/start.test.tsx`:

```tsx
it('offers to continue a stored session after a reload, with no live session', () => {
  localStorage.setItem(
    'release:session',
    JSON.stringify({
      roomCode: 'ABC-123', name: 'Ann', role: 'guest',
      gameId: 'g1', joinedAt: Date.now(),
    }),
  )
  // status 'idle' and state null — exactly what a fresh mount after F5 looks like.
  renderStartWith({ status: 'idle', state: null, roomCode: null })
  const btn = screen.getByText('start.continueSession').closest('button')
  expect(btn?.hasAttribute('disabled')).toBe(false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @release/web exec vitest run src/pages/__tests__/start.test.tsx -t "stored session"`
Expected: FAIL — the button is disabled, because `hasSession` reads only in-memory state.

- [ ] **Step 3: Implement**

In `start.tsx`:

```tsx
  // A live session OR one this browser stored before the tab went away. Read
  // once per render rather than held in state: nothing here mutates it, and a
  // stale copy would keep offering a match the player has since left.
  const stored = readSession()
  const hasSession = (session.status === 'in-lobby' && !!session.state) || !!stored

  const resume = () => {
    const code = session.roomCode ?? stored?.roomCode
    if (!code) return
    // A stored match goes back to the board; a stored lobby goes to the lobby.
    if (stored?.gameId && !session.state) {
      void navigate(`/board/${stored.gameId}`)
      return
    }
    goToLobby(code)
  }
```

Point the button's `onClick` at `resume`.

- [ ] **Step 4: Run and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add apps/frontend/src/pages/
git commit -m "feat(web): the continue-session slot stops being decorative (#110)"
```

---

### Task 11: End-to-end rejoin, headless

**Files:**
- Test: `apps/frontend/src/network/session/rejoin.test.ts` (create)

This is where the real risk lives, so it gets its own task and its own gate.

- [ ] **Step 1: Write the test**

Create `apps/frontend/src/network/session/rejoin.test.ts`:

```ts
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from '@release/engine/fake'
import { attachKeeper } from './remoteLink'
import { createSession, type SessionRef } from './referee'
import { createMemoryNetwork } from './memoryNetwork'
import { restoreSeats } from './restore'

function liveSession() {
  const net = createMemoryNetwork(['host', 'guest', 'guest-returned'])
  const { session } = createSession({
    gameId: 'g1', keeperId: 'p1', engine: createFakeEngine(), seed: 1,
    players: [
      { playerId: 'p1', peerId: 'host', name: 'Ann' },
      { playerId: 'p2', peerId: 'guest', name: 'Bo' },
    ],
    setup: {}, deck: FAKE_DECK, events: FAKE_EVENTS,
  })
  const ref: SessionRef = { current: session }
  return { net, ref }
}

it('hands a returning peer its own hand back, on a new peer id', () => {
  const { net, ref } = liveSession()
  const keeper = attachKeeper({ ref, transport: net.transport('host'), now: () => 1_000 })
  const before = ref.current.engine.project(ref.current.state, 'p2').self.hand.map((c) => c.uid)

  keeper.peerLeft('guest')
  expect(ref.current.seats.find((s) => s.playerId === 'p2')?.peerId).toBeNull()

  const received: unknown[] = []
  net.onDeliver('guest-returned', (frame) => received.push(frame))
  keeper.peerReturned('p2', 'guest-returned')

  const sync = received.find((f) => (f as { type: string }).type === 'SYNC') as {
    payload: { view: { self: { hand: { uid: string }[] } } }
  }
  expect(sync).toBeDefined()
  expect(sync.payload.view.self.hand.map((c) => c.uid)).toEqual(before)
  keeper.close()
})

// Nothing authenticates a clientId, so `rebind` refusing an occupied seat is
// the whole defence. Pinned here because losing it would be silent: the
// claimant would simply start receiving another player's hand.
it('refuses a seat that is still connected', () => {
  const { net, ref } = liveSession()
  const keeper = attachKeeper({ ref, transport: net.transport('host'), now: () => 1_000 })
  keeper.peerReturned('p2', 'guest-returned')
  expect(ref.current.seats.find((s) => s.playerId === 'p2')?.peerId).toBe('guest')
  keeper.close()
})

it('a restored keeper resumes the same match a snapshot described', () => {
  const { net, ref } = liveSession()
  const snapshot = JSON.parse(JSON.stringify(ref.current.state))
  const seats = restoreSeats(ref.current.seats, 'host', 50_000)

  const restoredRef: SessionRef = {
    current: { ...ref.current, state: snapshot, seats },
  }
  const keeper = attachKeeper({ ref: restoredRef, transport: net.transport('host'), now: () => 50_000 })

  // The host kept its own seat; the guest's is empty and freshly stamped.
  expect(restoredRef.current.seats.find((s) => s.playerId === 'p1')?.peerId).toBe('host')
  expect(restoredRef.current.seats.find((s) => s.playerId === 'p2')?.absentSince).toBe(50_000)

  keeper.peerReturned('p2', 'guest-returned')
  expect(restoredRef.current.seats.find((s) => s.playerId === 'p2')?.peerId).toBe('guest-returned')
  keeper.close()
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @release/web exec vitest run src/network/session/rejoin.test.ts`
Expected: PASS, 3 tests. If the first fails on hand identity, the seating patch in Task 5 is wrong — fix there, not here.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/network/session/rejoin.test.ts
git commit -m "test(web): a reload gets its own hand back, and someone else's stays out of reach (#110)"
```

---

### Task 12: Verify against a real browser and a real broker

Every prior task is mocked. This one is not, because the two things most likely to behave differently in reality — the broker freeing a peer id, and WebRTC re-establishing a channel — cannot be mocked into telling the truth.

- [ ] **Step 1: Start the local signaling server and the app**

```bash
pnpm dev:p2p
```

- [ ] **Step 2: Play a real match to mid-game**

Open two **separate browser profiles** (not two tabs — they would share one `clientId`; see the spec's multi-tab note). Create a room in one, join from the other, start, and take a few turns.

- [ ] **Step 3: Reload the guest**

Expected: the reconnect terminal appears with the real room code, the guest returns to the board within a few seconds, its hand is the hand it had, and the host's table shows the seat go offline and come back.

- [ ] **Step 4: Reload the host**

Expected: the host returns to its own board with the match intact; the guest's overlay appears and clears as the host comes back. This is the step that exercises `unavailable-id` — if the host lands on the error path, the retry in Task 6 needs a longer backoff.

- [ ] **Step 5: Let a reconnect fail**

Stop the host entirely. Expected: the guest's overlay reaches its failed state after 5 attempts and keeps `[reconnect]` and `[leave]` live. Leaving returns to `/start`.

- [ ] **Step 6: Record what you saw**

Note anything that differed from the spec in `docs/specs/2026-08-24-session-reconnect-design.md` under a short "As built" heading, and commit that note. A behaviour that only shows up against a real broker is exactly the kind that gets rediscovered as a bug otherwise.

```bash
git add docs/specs/2026-08-24-session-reconnect-design.md
git commit -m "docs(specs): what the real broker did differently (#110)"
```
