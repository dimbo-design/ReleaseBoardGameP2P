# Solo bot mode — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player can start a match against one to five bots from the start screen, with no room
code and no signaling server, and come back to it after a reload.

**Architecture:** The engine already has the opponent policy (`botAction`) and the keeper already
plays seats with nobody behind them. Three things are added around them: a `Transport` with no
PeerJS under it, so `attachKeeper` runs unchanged; a `bot` flag on the referee's seat, so a seat
that was never occupied is driven from the first tick instead of waiting out a thirty-second
absence grace meant for humans; and a solo session builder that hands the board the same roster
shape a networked match hands it, so the board and the results screen need no solo branch.

**Tech Stack:** TypeScript, React 19, Vite, Vitest + @testing-library/react (jsdom), pnpm
workspaces, Biome + Stylelint.

**Spec:** [`docs/specs/2026-09-09-solo-bot-mode-design.md`](./2026-09-09-solo-bot-mode-design.md)

## Global Constraints

- **Comments in English.** Root `CLAUDE.md`. Existing Russian comments are legacy; do not add more.
- **No string literals in `.tsx`.** All user-visible copy goes through `t()`, and every key must
  exist in **both** `packages/translation/src/locales/en/common.json` and `…/ru/common.json` — a key
  present in one only falls back silently.
- **`network/` is i18n-agnostic.** Nothing under `apps/frontend/src/network/` may import i18next or
  `@release/translation`. Bot display names are passed *into* it as parameters.
- **All text renders through `<Typography>`** from `@release/ui`; no raw `<p>`/`<span>`/`<h1>` and no
  hand-written font declarations.
- **Colors are design tokens only** — `var(--*)` from `apps/ui/src/design/tokens.css`. No hex, no
  `rgb()`, no named colors.
- **Every form uses `<Form>`** from `~/shared/ui/Form`, with `<FormField>` for fields.
- **Layering.** A module imports only from layers below it: `pages` → `features` → `entities` →
  `shared`, with `network` reached through `entities`/`features`. Use the `~` alias for `src`.
- **Page tests live in `__tests__/`**, never beside the page — generouted eagerly imports every
  non-`_` module under `pages/`, and a test file left beside a page crashes the dev server.
- **Run from the repo root:** `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- Single-package runs during a task: `pnpm --filter @release/web test`.

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `apps/frontend/src/network/transport/loopback.ts` | A `Transport` with no PeerJS behind it: an address, and no recipients. |
| `apps/frontend/src/network/transport/loopback.test.ts` | Its tests. |
| `apps/frontend/src/network/session/solo.ts` | Pure builder: name + bot names + setup → referee players, lobby seating, `LobbyState`. |
| `apps/frontend/src/network/session/solo.test.ts` | Its tests. |
| `apps/frontend/src/features/start-game/useStartSolo.ts` | The feature-layer wrapper the modal calls, mirroring `useCreateLobby`. |

**Modified**

| Path | Change |
|---|---|
| `apps/frontend/src/network/session/referee.ts` | `Seat.bot`; `createSession` accepts `bot` per player; the driver widens to cover bot seats; renamed `driveUnattended`. |
| `apps/frontend/src/network/session/restore.ts` | A bot seat's absence is not restamped. |
| `apps/frontend/src/network/session/link.ts`, `remoteLink.ts` | Call-site rename only. |
| `apps/frontend/src/shared/lib/persistence.ts` | `StoredSession.role` gains `'solo'`; `roomCode` becomes nullable. |
| `apps/frontend/src/network/useLobby.ts` | `startSolo`, `restoreSolo`, the mount-effect branch, solo's `leaveGame`, the `UseLobby` interface. |
| `apps/frontend/src/shared/ui/Form.tsx` | `FormData` is built with its submitter, so a named submit button is readable. |
| `apps/frontend/src/features/create-lobby/CreateLobbyForm.tsx` | Bot-count slider and a second submit. |
| `apps/frontend/src/pages/start.tsx` | Resume branch for a solo record. |
| `packages/translation/src/locales/{en,ru}/common.json` | Four new keys under `start`. |

---

### Task 1: A seat that was never occupied

**Files:**
- Modify: `apps/frontend/src/network/session/referee.ts` (the `Seat` interface, `createSession`'s
  `players` parameter and seat construction, `driveAbsent`)
- Modify: `apps/frontend/src/network/session/restore.ts:17-23`
- Test: `apps/frontend/src/network/session/referee.test.ts`,
  `apps/frontend/src/network/session/restore.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `Seat.bot?: boolean` on the referee's seat; `createSession({ players: [{ playerId,
  peerId, name, bot? }] })`; `driveUnattended(session: Session, now: number): SessionResult`,
  replacing the export `driveAbsent`.

Nothing behaves differently after this task until a caller sets `bot: true` — which is what makes it
safe to land on its own.

- [ ] **Step 1: Write the failing tests**

Add to `apps/frontend/src/network/session/referee.test.ts`. Put the helper next to the existing
`twoPlayerSession`, and note the seating order: `createGame` starts the match on the first player
(`packages/engine/src/fake/setup.ts:110`), so putting the bot first is what makes it owe a move on
the very first tick.

```ts
// A bot seat, and a human who is present. The bot is seated FIRST because the
// engine starts the match on `seating[0]` — so it owes a move immediately,
// which is the whole thing under test.
function botFirstSession(seed = 1) {
  return createSession({
    gameId: 'g1',
    keeperId: 'b',
    engine: createFakeEngine(),
    seed,
    players: [
      { playerId: 'a', peerId: null, name: 'Bot 1', bot: true },
      { playerId: 'b', peerId: 'peer-b', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
}

it('drives a bot seat at once: there is no absence to wait out', () => {
  const { session } = botFirstSession()
  const driven = driveUnattended(session, 1_000)
  expect(driven.session).not.toBe(session)
  expect(driven.outgoing.length).toBeGreaterThan(0)
})

it('still makes a human seat wait out the absence grace', () => {
  const { session: start } = botFirstSession()
  // The same table, except seat `a` is a human who dropped rather than a bot.
  const dropped: Session = {
    ...start,
    seats: start.seats.map((s) =>
      s.playerId === 'a' ? { playerId: 'a', peerId: null, absentSince: 1_000 } : s,
    ),
  }
  expect(driveUnattended(dropped, 1_000 + ABSENT_GRACE_MS - 1).session).toBe(dropped)
  expect(driveUnattended(dropped, 1_000 + ABSENT_GRACE_MS).session).not.toBe(dropped)
})
```

Add to `apps/frontend/src/network/session/restore.test.ts`:

```ts
// The trap this guards: `restoreSeats` restamps a stored absence to `now` so a
// reload does not bot-play the whole match at once. A bot has no absence to
// restamp — it was never there — and restamping one would freeze every bot for
// a full grace period after every reload.
it('leaves a bot seat exactly as it was', () => {
  const seats: Seat[] = [
    { playerId: 'p1', peerId: 'host-peer', absentSince: null },
    { playerId: 'p2', peerId: null, absentSince: null, bot: true },
  ]
  expect(restoreSeats(seats, 'host-peer', 5_000)).toEqual([
    { playerId: 'p1', peerId: 'host-peer', absentSince: null },
    { playerId: 'p2', peerId: null, absentSince: null, bot: true },
  ])
})
```

Both test files already import what these need except `driveUnattended`. In `referee.test.ts` change
the import of `driveAbsent` to `driveUnattended` and add `type Session` if it is not already
imported; in `restore.test.ts` make sure `type Seat` is imported from `./referee`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @release/web test -- referee.test.ts restore.test.ts
```

Expected: FAIL — `driveUnattended is not exported`, and `bot` is not a known property on the
`players` element / `Seat`.

- [ ] **Step 3: Widen the seat and the driver**

In `apps/frontend/src/network/session/referee.ts`, add the field to `Seat`:

```ts
export interface Seat {
  playerId: PlayerId
  // null while the seat is disconnected. The seat itself survives, which is
  // why PlayerId is a persisted client id rather than a PeerJS peer id.
  peerId: string | null
  absentSince: number | null
  // A seat nobody is coming back to. The absence grace below is a rule about
  // humans who might return; a bot never was one, so it is played from the
  // first tick instead of after 30 seconds of waiting for nobody.
  bot?: boolean
}
```

Widen `createSession`'s `players` parameter:

```ts
  players: { playerId: PlayerId; peerId: string | null; name: string; bot?: boolean }[]
```

and carry the flag onto the seat it builds:

```ts
    seats: args.players.map((p) => ({
      playerId: p.playerId,
      peerId: p.peerId,
      absentSince: null,
      ...(p.bot ? { bot: true as const } : {}),
    })),
```

Then widen the driver's filter. Replace the `expired` binding inside `driveAbsent` with:

```ts
  // A seat with nobody behind it: a bot, which never had anybody, or a human
  // past the grace. Everything below this line treats the two identically —
  // the difference is only in how long the table waits before giving up on
  // somebody arriving.
  const unattended = session.seats.filter(
    (s) =>
      s.peerId === null &&
      (s.bot || (s.absentSince !== null && now - s.absentSince >= ABSENT_GRACE_MS)),
  )
```

and update the loop header to `for (const seat of unattended) {`. Nothing else in the body changes —
the `WINDOW_EXPIRED` drop and the DRAW/PUSH fallback both apply to a bot exactly as written.

In `apps/frontend/src/network/session/restore.ts`, give the bot seat an early return:

```ts
export function restoreSeats(stored: Seat[], hostPeerId: string, now: number): Seat[] {
  return stored.map((seat) => {
    // A bot was never present, so there is no absence to restamp — and
    // restamping one would freeze every bot for a full grace period after
    // every reload, which is the opposite of what the restamp is for.
    if (seat.bot) return seat
    return seat.peerId === hostPeerId
      ? { ...seat, absentSince: null }
      : { ...seat, peerId: null, absentSince: now }
  })
}
```

Add the same note to that function's doc comment above it, after the paragraph about the host's own
seat: `A bot seat is left untouched: it has no absence to restamp and nothing to come back from.`

- [ ] **Step 4: Rename the export, and run everything**

The name has to move with the meaning: "drive the absent seats" would now silently include seats
that were never present. Kept as its own step, and its own commit, so it can be dropped without
losing the widening above.

```bash
cd /Users/andreykonnov/dev/MythHand/ReleaseBoardGameP2P
grep -rl 'driveAbsent' apps/frontend/src | xargs sed -i '' 's/driveAbsent/driveUnattended/g'
```

That rewrites the definition, both call sites (`link.ts`, `remoteLink.ts`), and the references in
five test files and several prose comments. Then read the changed comments — `useLobby.ts`,
`restore.ts`, `startGate.ts`, `remoteLink.ts` — and fix any sentence the rename made ungrammatical
("driveUnattended's grace owns absence" still reads correctly; "playing an absent seat" is still
true of the case it describes).

```bash
pnpm --filter @release/web test
pnpm typecheck
```

Expected: PASS, including the two new tests and every pre-existing presence/properties/remoteLink
test unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/network
git commit -m "feat(web): a seat that was never occupied, driven without a grace to wait out"
```

---

### Task 2: The transport with nobody on the other end

**Files:**
- Create: `apps/frontend/src/network/transport/loopback.ts`
- Test: `apps/frontend/src/network/transport/loopback.test.ts`

**Interfaces:**
- Consumes: `Transport` from `apps/frontend/src/network/transport/peer.ts`.
- Produces: `SOLO_PEER_ID: string` (`'local:solo'`) and
  `createLoopbackTransport(id?: string): Transport`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/network/transport/loopback.test.ts`:

```ts
import { parseRoomCode } from '../useLobby'
import { createLoopbackTransport, SOLO_PEER_ID } from './loopback'

it('is addressable and connected to nobody', () => {
  const t = createLoopbackTransport()
  expect(t.id).toBe(SOLO_PEER_ID)
  expect(t.connectedIds()).toEqual([])
})

// The room code IS the host's peer id, so a synthetic address that could also
// be typed into the join field would be a collision waiting to happen. The
// colon is what keeps this outside ROOM_CODE_ALPHABET, which has none.
it('cannot be reached by anyone typing a room code', () => {
  expect(parseRoomCode(SOLO_PEER_ID)).not.toBe(SOLO_PEER_ID)
})

it('swallows every send rather than throwing', () => {
  const t = createLoopbackTransport()
  expect(() => {
    t.connectTo('whoever')
    t.send('whoever', { type: 'PLAYER_READY', payload: {} })
    t.broadcast({ type: 'PLAYER_READY', payload: {} })
    t.relay(['whoever'], { type: 'PLAYER_READY', from: 'x', seq: 1, payload: {} })
    t.close()
  }).not.toThrow()
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @release/web test -- loopback.test.ts
```

Expected: FAIL — `Failed to resolve import "./loopback"`.

- [ ] **Step 3: Write the transport**

Create `apps/frontend/src/network/transport/loopback.ts`:

```ts
import type { Transport } from './peer'

// The address a solo player sits at. The colon keeps it out of the PeerJS id
// space: room codes are drawn from ROOM_CODE_ALPHABET (useLobby.ts), which has
// no colon in it, so a synthetic address can never collide with a real peer id
// — and `parseRoomCode` strips it, so it cannot be typed into the join field
// either.
export const SOLO_PEER_ID = 'local:solo'

// A Transport for a table with nobody else at it.
//
// `attachKeeper` wants a transport for three things: its own address, a way to
// send, and a way to broadcast. Solo has the address and genuinely has no
// recipients — every outgoing message is addressed either to a bot seat, which
// holds no connection and is dropped by `syncAll` long before it reaches here,
// or to the keeper's own seat, which `deliver` routes to the local link
// without touching the transport at all. So these are not stubs standing in
// for something unfinished; there is nothing for them to do.
//
// This is what lets solo run `attachKeeper` unchanged, and with it the start
// gate, the intent buffering, the tick and the persistence hook — rather than
// growing a second keeper that would drift from the first.
export function createLoopbackTransport(id: string = SOLO_PEER_ID): Transport {
  return {
    id,
    connectTo() {},
    send() {},
    broadcast() {},
    relay() {},
    connectedIds: () => [],
    close() {},
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @release/web test -- loopback.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/network/transport/loopback.ts apps/frontend/src/network/transport/loopback.test.ts
git commit -m "feat(web): a transport for a table with nobody else at it"
```

---

### Task 3: Building a solo table

**Files:**
- Create: `apps/frontend/src/network/session/solo.ts`
- Test: `apps/frontend/src/network/session/solo.test.ts`

**Interfaces:**
- Consumes: `createLobbyState`/`LobbyState` (`../lobby/state`), `PeerInfo`/`Seat`/`Setup`
  (`../types`), `Seat.bot` from Task 1.
- Produces:
  ```ts
  interface SoloTable {
    seats: Seat[]                 // the LOBBY seat (peerId: string), for applySeats
    lobby: LobbyState
    players: { playerId: PlayerId; peerId: string | null; name: string; bot?: boolean }[]
  }
  function buildSoloTable(args: {
    selfPeerId: string
    clientId: string
    name: string
    botNames: string[]
    setup: Setup
  }): SoloTable
  ```

Note the deliberate asymmetry this task exists to produce: a bot's **lobby** seat carries a peer id
(`local:bot-1`) so the board's roster lookup finds it and does not read it as a dropped player,
while its **referee** seat carries `null` so `syncAll` skips it and no hand is ever projected to
nobody. Two different `Seat` types — `network/types.ts`'s and `referee.ts`'s — and they disagree on
purpose.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/network/session/solo.test.ts`:

```ts
import { buildSoloTable } from './solo'

const table = () =>
  buildSoloTable({
    selfPeerId: 'local:solo',
    clientId: 'client-me',
    name: 'Ann',
    botNames: ['Bot 1', 'Bot 2'],
    setup: { 'mode.hand': '8bit' },
  })

it('seats the human first, so the human moves first', () => {
  // The engine starts the match on `seating[0]` (fake/setup.ts) — seat order
  // IS turn order, so this is the whole of decision 7.
  expect(table().players.map((p) => p.playerId)).toEqual(['p1', 'p2', 'p3'])
  expect(table().players[0].name).toBe('Ann')
})

it('gives the engine no connection for a bot', () => {
  const { players } = table()
  expect(players[0].peerId).toBe('local:solo')
  expect(players[1]).toMatchObject({ peerId: null, bot: true })
  expect(players[2]).toMatchObject({ peerId: null, bot: true })
})

// The board reads the roster, not the engine, to decide who is at the table and
// who has dropped (pages/board/[gameId]/index.tsx). A bot missing from it would
// render as a disconnected player for the whole match.
it('gives every bot a roster entry, so the board does not read it as dropped', () => {
  const { lobby, seats } = table()
  expect(Object.keys(lobby.peers)).toHaveLength(3)
  for (const seat of seats) expect(lobby.peers[seat.peerId]).toBeDefined()
  expect(Object.values(lobby.peers).every((p) => p.where === 'game' && p.ready)).toBe(true)
})

// `seated` in the board page compares a participant id against `state.selfId`.
it('makes the human the self and the host of its own table', () => {
  const { lobby } = table()
  expect(lobby.selfId).toBe('local:solo')
  expect(lobby.hostId).toBe('local:solo')
  expect(lobby.peers['local:solo'].role).toBe('host')
  expect(lobby.setup).toEqual({ 'mode.hand': '8bit' })
})

it('sizes the table to the seats it actually has', () => {
  expect(table().lobby.maxPlayers).toBe(3)
  expect(buildSoloTable({ ...{ selfPeerId: 'local:solo', clientId: 'c', name: 'A', setup: {} }, botNames: ['Solo Bot'] }).seats).toHaveLength(2)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @release/web test -- solo.test.ts
```

Expected: FAIL — `Failed to resolve import "./solo"`.

- [ ] **Step 3: Write the builder**

Create `apps/frontend/src/network/session/solo.ts`:

```ts
import type { PlayerId } from '@release/engine'
import { createLobbyState, type LobbyState } from '../lobby/state'
import type { PeerInfo, Seat, Setup } from '../types'

// A bot's address in the ROSTER. Bots hold no connection, but the board decides
// who is at the table — and who has dropped — by looking each seat up in
// `state.peers` (pages/board/[gameId]/index.tsx), so a bot needs an entry there
// even though nothing is ever sent to it. Same colon rule as the loopback
// transport: outside the room-code alphabet, so it can never be a real peer.
const botPeerId = (n: number) => `local:bot-${n}`

export interface SoloTable {
  // The LOBBY seating, held by `applySeats` and stored with the keeper
  // snapshot. A bot's entry carries a peer id here.
  seats: Seat[]
  lobby: LobbyState
  // What the REFEREE is seated with. A bot's entry carries no peer id here —
  // `syncAll` skips a seat with none, which is what keeps the keeper from
  // projecting a hand to nobody.
  players: { playerId: PlayerId; peerId: string | null; name: string; bot?: boolean }[]
}

export function buildSoloTable(args: {
  selfPeerId: string
  clientId: string
  name: string
  // Supplied by the caller rather than built here: `network/` may not import
  // i18next (the frontend's layering rule), and these are display copy. One
  // name per bot — the length is the bot count.
  botNames: string[]
  setup: Setup
}): SoloTable {
  const seats: Seat[] = [
    { playerId: 'p1', peerId: args.selfPeerId, clientId: args.clientId, name: args.name },
    ...args.botNames.map((name, i) => ({
      playerId: `p${i + 2}`,
      peerId: botPeerId(i + 1),
      clientId: `local:bot-client-${i + 1}`,
      name,
    })),
  ]

  const peers: PeerInfo[] = seats.map((seat, i) => ({
    id: seat.peerId,
    clientId: seat.clientId,
    name: seat.name,
    role: i === 0 ? 'host' : 'player',
    // A bot is never not ready and never anywhere else. `where` is what the
    // results screen prints as a player's whereabouts, and 'game' is the only
    // honest answer for a seat that exists solely inside this match.
    ready: true,
    where: 'game',
  }))

  return {
    seats,
    lobby: createLobbyState({
      selfId: args.selfPeerId,
      hostId: args.selfPeerId,
      maxPlayers: seats.length,
      setup: args.setup,
      peers,
    }),
    players: seats.map((seat, i) =>
      i === 0
        ? { playerId: seat.playerId, peerId: args.selfPeerId, name: seat.name }
        : { playerId: seat.playerId, peerId: null, name: seat.name, bot: true },
    ),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @release/web test -- solo.test.ts
pnpm typecheck
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/network/session/solo.ts apps/frontend/src/network/session/solo.test.ts
git commit -m "feat(web): the roster a solo table sits at"
```

---

### Task 4: `startSolo`

**Files:**
- Modify: `apps/frontend/src/network/useLobby.ts` (imports, the `UseLobby` interface near line 195,
  a new callback beside `startGame` at line 1369, and both dependency arrays of the returned object
  near lines 1519 and 1550)
- Test: `apps/frontend/src/network/useLobby.test.ts`

**Interfaces:**
- Consumes: `createLoopbackTransport`/`SOLO_PEER_ID` (Task 2), `buildSoloTable` (Task 3),
  `createSession` with `bot` (Task 1).
- Produces: `UseLobby.startSolo(name: string, botNames: string[], setup: Setup): void`.

`startSolo` does not navigate. `FollowGameStart` is mounted app-wide in `pages/_app.tsx` and already
watches `gameId` — the same signal a networked start uses — so setting it is what moves the player
to the board. Navigating here as well would run two navigations for one start.

- [ ] **Step 1: Write the failing test**

Add to `apps/frontend/src/network/useLobby.test.ts`. It needs no fake transport: solo builds its
own, so `createTransport` is never called.

```ts
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
```

Add `readSession` to the existing import from `~/shared/lib/persistence` at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @release/web test -- useLobby.test.ts
```

Expected: FAIL — `result.current.startSolo is not a function`.

- [ ] **Step 3: Add the storage shape**

`StoredSession` has to be able to describe a session with no room before `startSolo` can write one.
In `apps/frontend/src/shared/lib/persistence.ts`:

```ts
export interface StoredSession {
  // null for a solo match: there is no room, and nothing to dial on the way
  // back — the keeper snapshot beside this record is the whole session.
  roomCode: string | null
  name: string
  role: 'host' | 'guest' | 'solo'
  gameId: string | null
  joinedAt: number
}
```

- [ ] **Step 4: Write `startSolo`**

Add the imports at the top of `apps/frontend/src/network/useLobby.ts`:

```ts
import { buildSoloTable } from './session/solo'
import { createLoopbackTransport } from './transport/loopback'
```

Declare it in the `UseLobby` interface, directly under `startGame(): void`:

```ts
  // A match against bots: no room, no broker, no transport. The link, the
  // seating and the projection are the same shape a networked match produces,
  // so nothing downstream of this hook can tell the difference.
  startSolo(name: string, botNames: string[], setup: Setup): void
```

Add the callback immediately after `startGame`:

```ts
  // The solo half of `startGame`. Everything structural is the same — mint a
  // match id, seat the table, create the session, attach a keeper, deal — and
  // two things are not: the transport is a loopback with no recipients, and
  // the roster is invented here rather than gathered from a lobby.
  const startSolo = useCallback(
    (name: string, botNames: string[], setup: Setup) => {
      // Same teardown, and the same order, as a rematch through startGame: the
      // gate first, because it must never outlive its session.
      gateRef.current?.cancel()
      gateRef.current = null
      keeperRef.current?.close()
      keeperRef.current = null
      cancelKeeperSave()
      // A stale transport from a session this player walked away from without
      // leaving (returning to /start from a live guest session never calls
      // leaveSession) would otherwise leak, exactly as createRoom guards.
      transportRef.current?.close()

      matchSeqRef.current += 1
      const id = `solo-${matchSeqRef.current}`

      const t = createLoopbackTransport()
      transportRef.current = t
      isHostRef.current = true
      setIsHost(true)
      setRoomCode(null)
      setError(null)
      setErrorKind(null)

      const table = buildSoloTable({
        selfPeerId: t.id,
        clientId: getClientId(),
        name,
        botNames,
        setup,
      })

      // The engine never sources randomness, so the seed is minted here and the
      // match is a pure function of it — same as a networked deal.
      const seed = crypto.getRandomValues(new Uint32Array(1))[0]
      const engine = createFakeEngine()
      const { session } = createSession({
        gameId: id,
        keeperId: 'p1',
        engine,
        seed,
        players: table.players,
        setup,
        deck: FAKE_DECK,
        events: FAKE_EVENTS,
      })
      const ref: SessionRef = { current: session }
      sessionRef.current = ref

      // The human's seat alone. A bot runs no opening and would never report,
      // so a gate waiting on one would hold the table for the whole
      // INTRO_CAP_MS before giving up — and the gate is what stops the bots
      // taking their turns during the deal animation.
      const gate = createStartGate({ expect: ['p1'] })
      gateRef.current = gate

      const keeper = attachKeeper({
        ref,
        transport: t,
        now: () => Date.now(),
        gate,
        onCommit: persistKeeper,
      })
      keeperRef.current = keeper
      keeper.link.subscribe(setGameSync)
      setGameLink(() => keeper.link)

      commit(table.lobby)
      applySeats(table.seats)
      writeSession({ roomCode: null, name, role: 'solo', gameId: id, joinedAt: Date.now() })
      setStatus('in-lobby')
      gameIdRef.current = id
      // No navigation here: FollowGameStart is mounted app-wide (pages/_app.tsx)
      // and watches this very signal, exactly as it does for a networked start.
      setGameId(id)
      // The deal, so the board's intro has something to replay and the move
      // history does not open on a blank.
      keeper.resync(engine.setupEvents(session.state))
    },
    [commit, applySeats, cancelKeeperSave, persistKeeper],
  )
```

Add `startSolo` to the returned object and to the `useMemo` dependency array beside `startGame` in
both places (near lines 1519 and 1550).

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @release/web test -- useLobby.test.ts
pnpm typecheck
```

Expected: PASS. `typecheck` also surfaces every place that assumed `StoredSession.roomCode` was a
`string` — there should be none outside `useLobby.ts` and `start.tsx`, and `start.tsx` is Task 6.
Fix any that appear by narrowing at the read, not by casting.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/network/useLobby.ts apps/frontend/src/network/useLobby.test.ts apps/frontend/src/shared/lib/persistence.ts
git commit -m "feat(web): start a match against bots, with no room to start it in"
```

---

### Task 5: The bot driver reaches the board

**Files:**
- Create: `apps/frontend/src/network/session/soloPlay.test.ts` (its own file, not a second
  `describe` inside `solo.test.ts` — that one tests a pure builder, this one drives a live keeper)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: nothing. This task exists to prove the parts compose before any UI is built on them.

The one thing no earlier task proves: that a bot seat, driven through a real keeper over a loopback
transport, actually moves the match — and that it does not move it during the intro.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/network/session/soloPlay.test.ts`:

```ts
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from '@release/engine/fake'
import type { Ticker } from './link'
import { createSession, type SessionRef } from './referee'
import { attachKeeper } from './remoteLink'
import { buildSoloTable } from './solo'
import { createStartGate } from './startGate'
import { createLoopbackTransport } from '../transport/loopback'

// A ticker the test advances by hand, so nothing here waits on a real clock.
function manualTicker(): Ticker & { fire(): void } {
  let fn: (() => void) | null = null
  return {
    start(f) {
      fn = f
    },
    stop() {
      fn = null
    },
    fire() {
      fn?.()
    },
  }
}

function soloGame(botNames: string[]) {
  const t = createLoopbackTransport()
  const table = buildSoloTable({
    selfPeerId: t.id,
    clientId: 'client-me',
    name: 'Ann',
    botNames,
    setup: {},
  })
  const engine = createFakeEngine()
  const { session } = createSession({
    gameId: 'solo-1',
    keeperId: 'p1',
    engine,
    // Choose this empirically rather than trusting the literal: a seed whose
    // opening draw is a trigger opens a pending, PUSH is then refused, and the
    // turn never reaches p2. Any seed reaching a clean draw serves.
    seed: 7,
    players: table.players,
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
  const ref: SessionRef = { current: session }
  const gate = createStartGate({ expect: ['p1'] })
  const ticker = manualTicker()
  const keeper = attachKeeper({ ref, transport: t, now: () => Date.now(), ticker, gate })
  return { ref, gate, ticker, keeper, transport: t }
}

// The gate's whole purpose, in the shape solo gives it: the human is watching
// cards fly, and the bots must not be playing behind the animation.
it('holds every bot until the human reports its opening done', () => {
  const { ref, ticker, keeper, transport } = soloGame(['Bot 1'])
  const before = ref.current
  ticker.fire()
  expect(ref.current).toBe(before)

  keeper.introReady(transport.id)
  // The human is seat p1 and moves first, so the tick after the gate opens
  // stamps the turn clock rather than playing a bot — either way, the table is
  // no longer frozen.
  ticker.fire()
  expect(ref.current).not.toBe(before)
})

// The point of the whole feature: a seat with nobody behind it takes its turn.
it('plays a bot seat through to the human getting the turn back', () => {
  const { ref, ticker, keeper, transport } = soloGame(['Bot 1'])
  keeper.introReady(transport.id)

  // End the human's opening turn, so the bot is on.
  keeper.link.submit({ type: 'DRAW' })
  keeper.link.submit({ type: 'PUSH' })
  expect(ref.current.state.turn.player).toBe('p2')

  // One action per tick, exactly as an absent seat has always been driven.
  for (let i = 0; i < 20 && ref.current.state.turn.player === 'p2'; i += 1) ticker.fire()
  expect(ref.current.state.turn.player).toBe('p1')
})

// A bot holds no connection, so nothing may be addressed to it.
it('never projects a hand to a seat nobody is holding', () => {
  const { ref } = soloGame(['Bot 1', 'Bot 2'])
  expect(ref.current.seats.filter((s) => s.bot)).toHaveLength(2)
  expect(ref.current.seats.filter((s) => s.peerId !== null)).toHaveLength(1)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @release/web test -- soloPlay.test.ts
```

Expected: FAIL on the first run only if Tasks 1–4 were skipped; if they landed, expect PASS. Run it
before writing anything — a test that passes immediately here is the point of the task, and a
failure tells you which earlier task is wrong.

- [ ] **Step 3: Fix whatever it caught**

No new production code is planned for this task. If the second test hangs at `p2`, the cause is one
of two things and both are in Task 1: the driver's filter is not matching `bot` seats, or
`driveUnattended` is being skipped because no seat holds a peer id. If the first test does not
freeze before `introReady`, the gate is not being passed to `attachKeeper` in Task 4.

- [ ] **Step 4: Run the whole suite**

```bash
pnpm test
pnpm typecheck
pnpm lint
```

Expected: PASS across every package.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/network/session/soloPlay.test.ts
git commit -m "test(web): a bot seat takes its turn, and not during the deal"
```

---

### Task 6: Starting a solo match from the screen

**Files:**
- Modify: `apps/frontend/src/shared/ui/Form.tsx:52` (build `FormData` with its submitter)
- Create: `apps/frontend/src/features/start-game/useStartSolo.ts`
- Modify: `apps/frontend/src/features/create-lobby/CreateLobbyForm.tsx`
- Modify: `apps/frontend/src/features/create-lobby/CreateLobbyForm.module.css`
- Modify: `apps/frontend/src/pages/start.tsx` (one new `MenuButton`)
- Modify: `packages/translation/src/locales/en/common.json`,
  `packages/translation/src/locales/ru/common.json`
- Test: `apps/frontend/src/shared/ui/Form.test.tsx` (create if absent),
  `apps/frontend/src/features/create-lobby/CreateLobbyForm.test.tsx` (create)

**Interfaces:**
- Consumes: `UseLobby.startSolo` (Task 4).
- Produces: `useStartSolo(): (name: string, bots: number, setup: Setup, botName: (n: number) =>
  string) => void`.

After this task the mode is playable end to end. The default is one bot: the fastest match to reach.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/shared/ui/Form.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import Form, { FormField } from './Form'

// A form with two submit buttons has to be able to say which one was pressed —
// standard HTML behaviour, and what the create/solo split below rides on.
it('reports the submitting button in the submitted data', () => {
  const onSubmit = vi.fn()
  render(
    <Form onSubmit={onSubmit}>
      <FormField name="name" value="Ann" onChange={() => {}} />
      <button type="submit" name="intent" value="lobby">
        lobby
      </button>
      <button type="submit" name="intent" value="solo">
        solo
      </button>
    </Form>,
  )
  fireEvent.click(screen.getByText('solo'))
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ intent: 'solo' }))
})

it('still validates required fields before reporting anything', () => {
  const onSubmit = vi.fn()
  render(
    <Form onSubmit={onSubmit} requiredMessage="Required">
      <FormField name="name" required value="" onChange={() => {}} />
      <button type="submit" name="intent" value="solo">
        solo
      </button>
    </Form>,
  )
  fireEvent.click(screen.getByText('solo'))
  expect(onSubmit).not.toHaveBeenCalled()
})
```

Create `apps/frontend/src/features/create-lobby/CreateLobbyForm.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import CreateLobbyForm from './CreateLobbyForm'

vi.mock('@release/translation', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      typeof o?.returnObjects === 'boolean' || k === 'gameModes' ? {} : `${k}${o?.n ?? ''}`,
  }),
}))

const startSolo = vi.fn()
const createLobby = vi.fn()
vi.mock('./useCreateLobby', () => ({ useCreateLobby: () => createLobby }))
vi.mock('~/features/start-game/useStartSolo', () => ({ useStartSolo: () => startSolo }))
vi.mock('~/app/lib/lobbyNavigation', () => ({ useGoToLobby: () => vi.fn() }))
vi.mock('~/app/providers/SessionProvider', () => ({
  useSession: () => ({ status: 'idle', error: null }),
}))

it('starts a solo match with the chosen number of bots, and opens no room', () => {
  render(<CreateLobbyForm />)
  fireEvent.change(screen.getByLabelText('start.nicknameLabel'), { target: { value: 'Ann' } })
  fireEvent.click(screen.getByText('start.soloCta'))

  expect(createLobby).not.toHaveBeenCalled()
  expect(startSolo).toHaveBeenCalledWith('Ann', 1, expect.any(Object), expect.any(Function))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @release/web test -- Form.test.tsx CreateLobbyForm.test.tsx
```

Expected: FAIL — `intent` absent from the submitted data, and `start.soloCta` not in the document.

- [ ] **Step 3: Teach `Form` to report its submitter**

In `apps/frontend/src/shared/ui/Form.tsx`, replace the `onSubmit` call at the end of the submit
handler:

```ts
          setErrors({})
          // With the submitter, so a form with two submit buttons can say which
          // one was pressed — standard HTML form behaviour, which `new
          // FormData(form)` alone leaves out.
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null
          onSubmit(
            Object.fromEntries(new FormData(e.currentTarget, submitter)) as Record<string, string>,
          )
```

- [ ] **Step 4: Add the copy**

In `packages/translation/src/locales/en/common.json`, inside `start`, after `"createCta"`:

```json
    "soloCta": "play with bots",
    "botsLabel": "Bots",
    "botName": "Bot {{n}}",
    "soloNote": "A solo match runs entirely in this browser — no room, no connection.",
```

The same keys in `packages/translation/src/locales/ru/common.json`:

```json
    "soloCta": "играть с ботами",
    "botsLabel": "Ботов",
    "botName": "Бот {{n}}",
    "soloNote": "Игра с ботами идёт целиком в этом браузере — без комнаты и без соединения.",
```

- [ ] **Step 5: Write the feature hook**

Create `apps/frontend/src/features/start-game/useStartSolo.ts`:

```ts
import type { Setup } from '@release/ui'
import { useSession } from '~/app/providers/SessionProvider'

// The bot names are built HERE rather than in `network/`, which may not import
// i18next: the caller passes a formatter and this turns a count into a list.
export function useStartSolo() {
  const session = useSession()
  return (name: string, bots: number, setup: Setup, botName: (n: number) => string) =>
    session.startSolo(
      name,
      Array.from({ length: bots }, (_, i) => botName(i + 1)),
      setup,
    )
}
```

- [ ] **Step 6: Add the control and the second submit**

In `apps/frontend/src/features/create-lobby/CreateLobbyForm.tsx`, add `Slider` to the `@release/ui`
import, and:

```tsx
import { useStartSolo } from '~/features/start-game/useStartSolo'
```

Add the constant beside `DEFAULT_CAPACITY`:

```tsx
// The rules seat 2–6 players (docs/rules/general.md), so the human plus five is
// the full table. One is the default: the fastest match to actually reach.
const MAX_BOTS = 5
```

Inside the component, beside the existing state:

```tsx
  const startSolo = useStartSolo()
  const [bots, setBots] = useState(1)
```

Replace the `onSubmit` body so it branches on which button was pressed:

```tsx
      onSubmit={async (data) => {
        const nickname = sanitizeNickname(data.name ?? '').trim()
        if (!nickname || connecting) return
        // A solo match opens no room, so there is nothing to await and nothing
        // to navigate to here: `startSolo` sets `gameId`, and the app-wide
        // FollowGameStart carries the player to the board off that signal.
        if (data.intent === 'solo') {
          startSolo(nickname, bots, setup, (n) => t('start.botName', { n }))
          return
        }
        try {
          // Pass the host's mode picks so the lobby seeds them instead of
          // DEFAULT_SETUP. A setup failure rejects here and is surfaced via
          // session.error below, so only navigate on success.
          const code = await createLobby(nickname, DEFAULT_CAPACITY, setup)
          goToLobby(code)
        } catch {
          // Error already surfaced through session.error; stay on the form.
        }
      }}
```

In the `createTech` column, give the existing create button a name and add the solo half under it:

```tsx
          <Button type="submit" name="intent" value="lobby" disabled={connecting}>
            {t('start.createCta')}
          </Button>
          <Slider
            className={styles.botsRow}
            label={t('start.botsLabel')}
            value={bots}
            min={1}
            max={MAX_BOTS}
            onChange={setBots}
          />
          <Button type="submit" name="intent" value="solo" variant="tech">
            {t('start.soloCta')}
          </Button>
          <Typography variant="footnote" className={styles.note}>
            {t('start.soloNote')}
          </Typography>
```

Add the one class to `CreateLobbyForm.module.css`, matching the spacing the column already uses:

```css
.botsRow {
  margin-block-start: 12px;
}
```

- [ ] **Step 7: Put it on the start screen**

Spec section 4: "The start screen gets one new `MenuButton` in the first `MenuGroup`, opening the
same modal." Without it a solo match is reachable only from behind a button labelled "create game".
In `apps/frontend/src/pages/start.tsx`, add it directly after the existing create button — same
`value="create"`, because it opens the very same modal:

```tsx
          <MenuButton value="create" onClick={handleMenuClick}>
            {t('start.soloCta')}
          </MenuButton>
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
pnpm --filter @release/web test -- Form.test.tsx CreateLobbyForm.test.tsx
pnpm test
pnpm lint
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 9: Play it**

Run `pnpm dev`, open the start screen, press "create game", type a nickname, leave the bot count at
1 and press "play with bots". Expected: the board opens, the deal plays, and after your PUSH the bot
takes its turn without you touching anything. This is the first point in the plan where the mode is
real; do not move on if it is not.

- [ ] **Step 10: Commit**

```bash
git add apps/frontend/src/shared/ui/Form.tsx apps/frontend/src/shared/ui/Form.test.tsx apps/frontend/src/features apps/frontend/src/pages/start.tsx packages/translation/src/locales
git commit -m "feat(web): play with bots, from the same form that opens a room"
```

---

### Task 7: Coming back to a solo match

**Files:**
- Modify: `apps/frontend/src/network/useLobby.ts` (a `restoreSolo` callback beside `restoreHost` at
  line 870, the mount effect at line 1160, and `leaveGame` at line 1352)
- Modify: `apps/frontend/src/pages/start.tsx:26-36`
- Test: `apps/frontend/src/network/useLobby.test.ts`,
  `apps/frontend/src/pages/__tests__/start.test.tsx`

**Interfaces:**
- Consumes: `StoredSession.role === 'solo'` (Task 4). **Not** `buildSoloTable` — a restore has no
  `t()` with which to regenerate bot names, so the roster is rebuilt from `snapshot.lobbySeats`,
  the only source of those names that survives a reload.
- Produces: nothing new on `UseLobby` — `restoreSolo` runs from the mount effect only.

- [ ] **Step 1: Write the failing tests**

Add to `apps/frontend/src/network/useLobby.test.ts`:

```ts
it('restores a solo match on mount, with no transport to rebuild', async () => {
  // Fake timers per-test in a try/finally, matching this file's own pattern
  // (see "cancels the start gate when the session is torn down").
  vi.useFakeTimers()
  try {
    const first = renderHook(() => useLobby())
    act(() => {
      first.result.current.startSolo('Ann', ['Bot 1'], {})
    })
    const gameId = first.result.current.gameId
    // The snapshot is written on a trailing edge one ticker cadence wide.
    act(() => {
      vi.advanceTimersByTime(KEEPER_SAVE_MS + 1)
    })
    first.unmount()

    const second = renderHook(() => useLobby())
    // The mount effect AWAITS restoreHost's decline before it reaches solo, so
    // the restore lands a microtask after render rather than during it. Without
    // this flush every assertion below reads the pre-restore hook.
    await act(async () => {})

    expect(second.result.current.gameId).toBe(gameId)
    expect(second.result.current.seats.map((s) => s.playerId)).toEqual(['p1', 'p2'])
    expect(second.result.current.gameSync?.view).toBeTruthy()
    expect(createTransport).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

// The dead-button trap: `leaveGame` blanks a record's gameId, which is right
// for a room that outlives its match. A solo record walked back that way keeps
// role 'solo' with nothing left to resume, and the start screen goes on
// offering it.
it('forgets a solo session entirely when the match is left', () => {
  const { result } = renderHook(() => useLobby())
  act(() => {
    result.current.startSolo('Ann', ['Bot 1'], {})
  })
  act(() => {
    result.current.leaveGame()
  })
  expect(readSession()).toBeNull()
})
```

Add to `apps/frontend/src/pages/__tests__/start.test.tsx`:

```tsx
it('sends a stored solo match back to its board, not to a lobby', async () => {
  writeSession({
    roomCode: null,
    name: 'Ann',
    role: 'solo',
    gameId: 'solo-1',
    joinedAt: Date.now(),
  })
  sessionValue = { status: 'idle', state: null, roomCode: null }
  render(
    <MemoryRouter>
      <StartPage />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByText('start.continueSession'))
  expect(navigate).toHaveBeenCalledWith('/board/solo-1')
})
```

That test needs `writeSession` and `fireEvent` imported, plus a `navigate` spy. This file has **no**
`react-router` mock today — nothing in it asserts navigation yet — so add one at the top, beside the
existing `vi.mock` calls:

```tsx
const navigate = vi.fn()
vi.mock('react-router', async () => ({
  ...(await vi.importActual<typeof import('react-router')>('react-router')),
  useNavigate: () => navigate,
}))
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @release/web test -- useLobby.test.ts start.test.tsx
```

Expected: FAIL — the remounted hook has a null `gameId`, `readSession()` still returns a record, and
the start screen navigates nowhere.

- [ ] **Step 3: Write `restoreSolo`**

Add to `apps/frontend/src/network/useLobby.ts`, directly after `restoreHost`:

```ts
  // The solo half of the mount-time restore. Simpler than `restoreHost` by
  // exactly the network: there is no peer id to reclaim, so no retry loop and
  // no epoch guard around an await — this function does not await at all.
  const restoreSolo = useCallback((): boolean => {
    const stored = readSession()
    const snapshot = readKeeper()
    if (stored?.role !== 'solo' || !snapshot) return false
    if (!stored.gameId || snapshot.gameId !== stored.gameId) return false

    const t = createLoopbackTransport()
    transportRef.current = t
    isHostRef.current = true
    setIsHost(true)
    setRoomCode(null)

    const engine = createFakeEngine()
    const session = adoptSession({
      state: snapshot.state as GameState,
      gameId: snapshot.gameId,
      keeperId: snapshot.keeperId as PlayerId,
      engine,
      // Straight from the snapshot, NOT through `restoreSeats`: its restamping
      // is for humans who were disconnected while nothing kept the table, and
      // solo's only human is the one doing the restoring. Its bot seats keep
      // their flag, which is what puts them back under the driver at once.
      seats: snapshot.seats as RefereeSeat[],
      log: (snapshot.log ?? []) as Event[],
    })
    const ref: SessionRef = { current: session }
    sessionRef.current = ref

    // No gate: it holds the table until every seat reports INTRO_READY, and
    // mid-match nobody ever will — one here would deadlock every intent for the
    // rest of the game. Same reason restoreHost passes none.
    const keeper = attachKeeper({
      ref,
      transport: t,
      now: () => Date.now(),
      onCommit: persistKeeper,
    })
    keeperRef.current = keeper
    keeper.link.subscribe(setGameSync)
    setGameLink(() => keeper.link)

    // The roster is rebuilt from the stored seating rather than stored twice:
    // `lobbySeats` carries every seat's name and clientId, which is everything
    // the board needs to render a table.
    const lobbySeats = snapshot.lobbySeats as LobbySeat[]
    commit(
      createLobbyState({
        selfId: t.id,
        hostId: t.id,
        maxPlayers: lobbySeats.length,
        setup: {},
        peers: lobbySeats.map((seat, i) => ({
          id: seat.peerId,
          clientId: seat.clientId,
          name: seat.name,
          role: i === 0 ? 'host' : 'player',
          ready: true,
          where: 'game',
        })),
      }),
    )
    applySeats(lobbySeats)
    // Empty events, deliberately: a statement of where the game stands, not a
    // replay of how it got there. Without the call at all the restored player
    // holds a live session it never receives a projection for.
    keeper.resync()
    gameIdRef.current = snapshot.gameId
    setGameId(snapshot.gameId)
    matchSeqRef.current = matchSeqAfterRestore(snapshot.gameId)
    setStatus('in-lobby')
    return true
  }, [commit, applySeats, persistKeeper])
```

Add `createLobbyState` to the existing import from `./lobby/state` if it is not already there.

- [ ] **Step 4: Run it from the mount effect, and fix `leaveGame`**

In the mount effect (line ~1160), try solo before the guest re-dial. The three roles are mutually
exclusive, so this stays a chain of declines:

```ts
    void (async () => {
      const hostRestored = await restoreHost()
      if (hostRestored) return
      if (restoreSolo()) return
      const stored = readSession()
      if (stored?.role !== 'guest') return
      reconnectSessionRef.current = stored
      await runGuestReconnect()
    })()
```

and add `restoreSolo` to that effect's dependency array.

In `leaveGame`, replace the `rememberGame(null)` call with the branch:

```ts
    // A room outlives the match played in it, so walking the record back to
    // `gameId: null` keeps it restorable. A solo session IS its match: walked
    // back the same way it would keep `role: 'solo'` with nothing left to
    // resume, and the start screen would go on offering a button that resolves
    // to nowhere. So it goes entirely.
    if (readSession()?.role === 'solo') clearSession()
    else rememberGame(null)
```

`clearSession` is already imported in this file; add `readSession` to that import if absent.

- [ ] **Step 5: Send a stored solo match back to its board**

In `apps/frontend/src/pages/start.tsx`, replace the body of `resume`:

```tsx
  const resume = () => {
    // A solo match has no room to return to — the stored record IS the match,
    // and the board is the only place it can be resumed.
    if (stored?.role === 'solo' && stored.gameId) {
      void navigate(`/board/${stored.gameId}`)
      return
    }
    const code = session.roomCode ?? stored?.roomCode
    if (!code) return
    // A stored match goes back to the board; a stored lobby goes to the lobby.
    if (stored?.gameId && !session.state) {
      void navigate(`/board/${stored.gameId}`)
      return
    }
    void goToLobby(code)
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @release/web test -- useLobby.test.ts start.test.tsx
pnpm test
pnpm typecheck
pnpm lint
```

Expected: PASS.

- [ ] **Step 7: Reload it**

Run `pnpm dev`, start a solo match, take a turn, then reload the tab. Expected: the board comes back
with the same hand and the same move history, and the bots keep playing — with no thirty-second
pause before the next bot move, which is the whole point of Task 1's `restoreSeats` branch. Then
leave from the results or the board and confirm the start screen no longer offers "continue game".

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/network/useLobby.ts apps/frontend/src/network/useLobby.test.ts apps/frontend/src/pages
git commit -m "feat(web): a solo match survives a reload, and is forgotten when it is left"
```

---

### Task 8: Naming a stall instead of hanging on one

**Files:**
- Modify: `apps/frontend/src/network/session/referee.ts` (inside `driveUnattended`)
- Test: `apps/frontend/src/network/session/referee.test.ts`

**Interfaces:**
- Consumes: `driveUnattended` (Task 1).
- Produces: nothing exported. A dev-only `console.warn`.

Spec §6: if `botAction` ever answers a pending with something `reduce` rejects, the match stalls —
the DRAW/PUSH fallback covers a proactive turn only, deliberately, because a pending's answer comes
from the option list the engine itself published. Solo makes that reachable far more often, since
bots now answer every pending rather than only an abandoned seat's. This does not recover from it;
it makes it say so.

- [ ] **Step 1: Write the failing test**

Add to `apps/frontend/src/network/session/referee.test.ts`:

```ts
// Not a recovery — a name. A stall that says nothing costs an hour to find; one
// that says which seat and which pending costs a minute.
it('complains when an unattended seat cannot answer the pending it owes', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { session } = botFirstSession()
  // A pending owed by the bot that its policy has no answer for: the option
  // list is empty, so every branch of `botAction` returns null.
  const stuck: Session = {
    ...session,
    state: {
      ...session.state,
      // The exact variant from packages/engine/src/state.ts:154 — `source` is
      // part of it, and `picks` is typed `1 | 2`.
      pending: {
        kind: 'pickFromDiscard',
        player: 'a',
        options: [],
        picks: 1,
        source: 'operation-git-cherry-pick',
      },
    } as GameState,
  }
  driveUnattended(stuck, 1_000)
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('pickFromDiscard'))
  warn.mockRestore()
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @release/web test -- referee.test.ts
```

Expected: FAIL — `console.warn` was not called.

- [ ] **Step 3: Say which seat is stuck**

In `driveUnattended`, at the point where a seat produced no action, replace `if (!action) continue`
with:

```ts
    if (!action) {
      // A seat that owes the table an answer and has none is a stall: nothing
      // else can move until it resolves, and with no human in that seat nobody
      // will resolve it by hand. The fallback below covers a proactive turn
      // only — a pending is answered from the option list the engine itself
      // published, so an unanswerable one is an engine bug to fix rather than
      // something to paper over here.
      if (import.meta.env.DEV && seatOwes(session.state, seat.playerId)) {
        console.warn(
          `[referee] ${seat.playerId} owes ${session.state.pending?.kind ?? 'a move'} and its policy has no answer — the table cannot advance`,
        )
      }
      continue
    }
```

and add the small predicate above `driveUnattended`:

```ts
// Whether the table is actually waiting on this seat, as opposed to the seat
// simply having nothing to do right now (not its turn, no window open).
function seatOwes(state: GameState, playerId: PlayerId): boolean {
  if (state.over) return false
  // `player` is read as OPTIONAL on purpose, and that is the whole subtlety.
  // Every Pending variant carries one today, so `state.pending.player` would
  // compile — but a pending owed to several seats at once carries none, and
  // this predicate is exactly the code that would then stop compiling. Reading
  // it optionally answers "not this seat" for such a pending, which is the
  // right answer for a warning: a roster-wide pending is nobody's solo stall.
  const owed = (state.pending as { player?: PlayerId } | null)?.player
  if (state.pending) return owed === playerId
  return state.turn.player === playerId
}
```

Import nothing new for this: `GameState` and `PlayerId` are already imported by `referee.ts`. Do
**not** reach for a helper such as `seatOwing` — no such export exists in this repository's
engine.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @release/web test
pnpm typecheck
pnpm lint
```

Expected: PASS. Watch for a warning firing during the ordinary solo tests — if it does, the
predicate is wrong, not the policy.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/network/session/referee.ts apps/frontend/src/network/session/referee.test.ts
git commit -m "feat(web): a stalled unattended seat says so instead of freezing in silence"
```

---

## Where the spec's board test went

The spec's testing list asks for a page test proving three things on the board: `seated` is true, no
bot renders as disconnected, and the results screen shows a row per bot. All three are asserted in
Task 3 instead, against the data those readers consume rather than through a board render:

| The board's reading | Where it is tested |
|---|---|
| `seated` — `participants.some(p => p.id === state.selfId)` (`index.tsx:89`) | "makes the human the self and the host of its own table" |
| `disconnected` — `seats.filter(s => !peerMap[s.peerId])` (`index.tsx:77`) | "gives every bot a roster entry, so the board does not read it as dropped" — the same predicate, negated |
| `toStatPlayers` — one row per seat, `location` from its peer | the same test: every seat resolves to a peer, and every peer is `where: 'game'` |

Rendering the whole board to re-assert them would be slower and more brittle without testing
anything the three above do not. Task 6 Step 8 and Task 7 Step 7 cover the real thing by hand.

## Done when

- `pnpm test`, `pnpm typecheck` and `pnpm lint` all pass from the repo root.
- The start screen's create modal starts a match against 1–5 bots with no room code and no network.
- Bots take their turns on their own, and never during the opening deal.
- A reload returns to the match, and the bots resume immediately rather than after a grace period.
- Leaving the match clears the record, and "continue game" stops offering it.
