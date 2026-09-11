# Playing alone — a seat with nobody behind it, on purpose

**Date:** 2026-09-09
**Project:** ReleaseBoardGameP2P ("Release любой ценой")
**Issue:** none yet
**Scope:** A solo mode reached from the start screen: one human, one to five bots, no room code, no
signaling server, no PeerJS. The bot brain is not written here — the engine already has one. What is
written here is a seat the engine drives, a keeper with no network under it, and the roster the
board reads.

> Builds on what the P2P layer already put in place: the referee (`network/session/referee.ts`), the
> keeper (`attachKeeper`, `network/session/remoteLink.ts`), the start gate
> (`network/session/startGate.ts`), the keeper snapshot and its restore
> (`shared/lib/persistence.ts`, `network/session/restore.ts`, `useLobby.ts`'s `restoreHost`), and the
> engine's own opponent policy (`packages/engine/src/fake/bots.ts`). Nothing here rewrites any of
> them; two of them grow one field each.

## The goal

You cannot play this game today without finding a second person and a working signaling broker. That
makes the game unplayable alone, and it makes every board change expensive to check by hand — two
tabs, two nicknames, a room code typed across.

The pieces to fix it are already in the repository, and they were built for this: `botAction` is a
complete opponent policy that reads its options only from `project`/`legalTargets`, exactly like the
UI does, and the keeper already plays a seat whose peer has been gone thirty seconds. What is
missing is not a brain. It is a seat that is *meant* to be empty, and a keeper with nothing on the
other end of it.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Where solo is chosen | **The start screen, through the existing create-game form.** One extra control (bot count) and a second exit that goes to the board instead of opening a room. No room code, no broker, works offline. |
| 2 | How solo gets a keeper | **A loopback `Transport`.** `attachKeeper` is used unchanged; solo and networked play diverge at exactly one point — which transport the keeper was handed. |
| 3 | What a bot seat is | **`bot: true` on the referee's `Seat`,** and `driveAbsent` widens into `driveUnattended`. Not `absentSince: 0` — see "Why a bot is not an absent human". |
| 4 | The bot's policy | **`botAction` unchanged.** No engine work in this spec. It is a predictable sparring partner, and it is replaceable behind the same seam later. |
| 5 | The roster | **Solo builds a real in-memory `LobbyState`,** with a synthetic `PeerInfo` per bot. The board and the results screen then need no solo branch at all. |
| 6 | A bot on screen | **Its name, and nothing else** — `Bot 1` / `Бот 1` from the catalog. `Table`'s participants are `{id, name, connected}`; a real bot badge is an `@release/ui` change and is out of scope. |
| 7 | Seat order | **The human takes seat one and moves first.** `setup.ts:110` starts the match on `seating[0]`; `docs/rules/general.md:54` leaves the choice to the system and permits random, so both are legal. |
| 8 | Pacing | **The keeper's existing 250ms ticker, one bot action per tick.** The cadence `driveAbsent` has used for absent seats since it was written. No new timer. |
| 9 | The opening deal | **A start gate expecting the human seat alone.** Without it the bots take their turns during the deal animation. |
| 10 | Reload | **The match restores,** through a `restoreSolo` twin of `restoreHost`. `StoredSession` grows `role: 'solo'` and a nullable `roomCode`. |
| 11 | `LobbyStatus` | **Reuses `'in-lobby'`.** The field means "this peer holds a live session"; a new member would make every reader grow a case for a screen solo never shows. |

## What is already here

Three things, and they decide most of the shape below.

**The opponent policy.** `botAction` (`packages/engine/src/fake/bots.ts`) answers every pending kind,
responds inside a reaction window, and takes a proactive turn. Every branch reads its options from
`project` or `legalTargets` and never from `GameState`, so it is a consumer of the same contract the
UI is. `bots.test.ts:34` pins the property that matters here — it "only ever proposes an action the
engine accepts."

**A keeper that already plays empty seats.** `driveAbsent` (`referee.ts`) walks the seats whose peer
has been gone past `ABSENT_GRACE_MS`, asks `botAction` for one action, and commits it. It already
drops the forged `WINDOW_EXPIRED` that policy returns for a window's own owner, and it already falls
back to DRAW/PUSH on a seat whose proactive turn produced a rejection. A bot seat needs none of that
written again.

**A keeper that does not care what a transport is.** `attachKeeper` touches `Transport` in three
places only: `deliver` (broadcast, self-addressed, send) and `link.submit` (`transport.id`).
Everything else it does — buffering intents behind the gate, ticking `tick` and the absent-seat
driver, reporting intro-ready, calling `onCommit` so the match is persisted — is network-agnostic.

What is *not* here: any notion of a seat that is meant to have no peer, and any way to start a match
without `createTransport` and a room. `createLocalLink` (`network/session/link.ts`) has comments
calling itself the solo path, but nothing in the app calls it — it is used by tests only, and it has
neither a start gate nor a persistence hook.

## 1. The loopback transport

Solo needs everything `attachKeeper` does and none of what PeerJS does. So it is handed a
`Transport` with no PeerJS behind it:

```ts
// network/transport/loopback.ts
export function createLoopbackTransport(id: string): Transport
```

`id` is a synthetic local address (`local:solo`), outside the room-code alphabet so it can never
collide with a real peer id. `send`, `broadcast` and `relay` are no-ops — every one of them is
addressed either to a bot seat, which has no peer, or to the keeper's own seat, which `deliver`
routes to the local link before it ever reaches the transport. `connectedIds()` returns nothing and
`close()` is a no-op.

The alternatives were to extend `createLocalLink` with a gate and an `onCommit` — which
re-implements the intro buffering, the intro-ready reporting and the close semantics `attachKeeper`
already has, in a second module free to drift — or to make `transport` optional inside
`attachKeeper`, which puts a null check in the networked keeper's hot path. Both trade a small,
honest null-object for a permanent second meaning in the code that most needs one.

The loopback transport pays for itself immediately beyond the keeper. `useLobby`'s `introReady`,
`setWhere` and `ready` all gate on `transportRef.current` being present and `isHostRef.current`
being true. Solo sets both, so all three work unchanged instead of growing a solo branch each.

## 2. Why a bot is not an absent human

The tempting version: give bot seats `peerId: null, absentSince: 0`. The thirty-second grace has
trivially passed, `driveAbsent` picks them up, and not one line of the referee changes.

It is wrong, and `restoreSeats` (`network/session/restore.ts`) is where it breaks in a way a reader
would have to debug rather than see. That function restamps every non-host seat's `absentSince` to
`now`, deliberately — a stored absence "describes time that passed while nothing was keeping the
table", and honouring it would bot-play a whole restored match before anyone could re-dial. Run a
restored solo match through it and every bot freezes for thirty seconds after every reload. The
value said "absent", so the code that handles absence handled it.

So the seat says what it is:

```ts
export interface Seat {
  playerId: PlayerId
  peerId: string | null
  absentSince: number | null
  // A seat nobody is coming back to. The engine's own policy plays it from the
  // first tick, and the absence grace — which is a rule about humans — never
  // applies to it.
  bot?: boolean
}
```

and `driveAbsent` becomes `driveUnattended`: a seat with nobody behind it is a bot, or a human past
the grace. The body is otherwise the one that exists today, including the `WINDOW_EXPIRED` drop and
the DRAW/PUSH fallback. `restoreSeats` leaves a bot seat alone. Two other referee behaviours then
fall out correctly with no change at all: `syncAll` skips a seat with no peer, so bots are never
projected to, and `tick` refuses to fire a deadline at one, so no clock runs against a bot — its
forward progress is the driver's, which is exactly the split that already exists for absent seats.

## 3. The roster solo builds

The board does not ask the engine who is at the table. It reads `session.seats` and
`session.state.peers`, and three readings there would go wrong for a peerless seat:

- `index.tsx:77` — `disconnected` is every seat whose `peerId` is missing from the roster. Bots would
  all render as dropped players.
- `index.tsx:89` — `seated` requires a participant matching `state.selfId`. With `state` null the
  board never opens at all.
- `toStatPlayers.ts` — a row with no peer reads `location: 'offline'`.

Rather than teach four call sites what a bot is, solo builds a real `LobbyState`: `selfId` is the
loopback id, `hostId` the same, and `peers` holds the human plus one synthetic `PeerInfo` per bot
(role `player`, `ready: true`, `where: 'game'`, a `clientId` minted per bot). The `Seat[]` is built
directly rather than through `seatsFor`, whose peer-id sort would otherwise decide seat order for
us; solo wants the human first (decision 7) and says so.

Everything downstream then works because a bot *is* a present player everywhere those readers look.
The cost is one constructor; the alternative was a bot check in four places and in every place added
later.

## 4. Setup: the create-game form grows a second exit

`CreateLobbyForm` already renders all five mode axes through `GameSettings`/`ModeSelect` and the
nickname field with its dice button. Solo needs the same five axes and the same nickname. So it gets
the same form, plus:

- a bot-count control, 1–5 (the rules seat 2–6, `docs/rules/general.md:13`), defaulting to 1;
- a second submit — "Play with bots" — that calls `startSolo` and navigates straight to
  `/board/:gameId` instead of `createRoom` + `goToLobby`.

The start screen gets one new `MenuButton` in the first `MenuGroup`, opening the same modal. Copy —
the button, the bot-count label, the bot names — goes in both `en` and `ru` catalogs, per the i18n
rule.

`startSolo(name, bots, setup)` lands in `useLobby` beside `startGame`, and is mostly the same
function with the transport swapped and the roster invented:

1. mint `gameId` as `solo-${++matchSeq}` (`matchSeqAfterRestore` parses the suffix after the last
   dash, so this restores like any other id);
2. build the loopback transport, set `isHostRef`, leave `roomCode` null;
3. build the seating — human at `p1`, bots at `p2…pN` — and the `LobbyState` above;
4. `createSession` with the human's seat carrying the loopback id and every bot seat carrying
   `peerId: null, bot: true`;
5. a start gate expecting the human seat alone (decision 9);
6. `attachKeeper({ ref, transport, gate, onCommit: persistKeeper })`, subscribe, set the link;
7. `writeSession({ role: 'solo', roomCode: null, gameId, name, joinedAt })`;
8. `keeper.resync(engine.setupEvents(session.state))` — the deal, so the intro has something to
   replay and the move history does not open on a blank.

No `GAME_STARTING` broadcast: there is nobody to tell.

## 5. Reload

`restoreSolo` is `restoreHost` with the retry loop deleted. There is no peer id to reclaim, so the
multi-attempt `createTransport` dance and the `sessionEpochRef` guard around it both go; what is
left is: read the snapshot, `adoptSession`, attach a keeper with **no gate** (mid-match nobody will
ever report INTRO_READY, and a gate here would deadlock every intent for the rest of the match —
`restoreHost` carries that same warning), `resync()` with no events, restore `matchSeq` through
`matchSeqAfterRestore`, and rebuild the `LobbyState` and `applySeats` from `snapshot.lobbySeats`.

Which bots to rebuild is read from the seating, not stored twice: `lobbySeats` carries every seat's
`playerId`, `clientId` and `name`, and the referee's own `seats` carry the `bot` flag through the
snapshot. Storage changes are two:

- `StoredSession.role` gains `'solo'`, and `roomCode` becomes `string | null`.
- The mount-time restore effect tries `restoreSolo` alongside `restoreHost`; the three roles are
  mutually exclusive, so it stays a chain of declines.

`start.tsx`'s "Continue session" needs one branch: today `resume()` reads a room code first and
returns early when there is none, so a solo record would render the button and do nothing on click.
A stored `role: 'solo'` with a `gameId` navigates straight to `/board/:gameId`.

**Leaving the match needs the same branch, for the same reason.** `leaveGame` clears the keeper
snapshot and then calls `rememberGame(null)`, which rewrites the session record with `gameId: null` —
correct for a room, which outlives the match played in it. A solo record walked back that way keeps
`role: 'solo'` with nothing left to resume, and `start.tsx` would go on rendering "Continue session"
over a record that resolves to nowhere: the dead button the branch above exists to prevent, arrived
at from the other side. So a solo `leaveGame` clears the record outright (`forgetStored`) rather
than blanking its `gameId`.

The results screen needs nothing. `useLeaveMatch` (`app/lib/lobbyNavigation.ts:42`) already sends a
null room code to `/start` instead of a lobby, which is exactly right for a session with no room —
it was written for a reload that lost its session, and solo is the same shape.

## 6. Pacing, and the one thing that can hang

One bot action per 250ms tick, from the keeper's existing ticker. A bot's turn is roughly play →
draw → push, so about three quarters of a second, and the board's beat queue serializes the
animations behind it at its own speed. No new timer, no artificial "thinking" delay — and if it
reads too fast in practice, the ticker interval is one number.

The risk worth naming: if `botAction` ever answers a pending with something `reduce` rejects, the
match stalls. `driveUnattended`'s DRAW/PUSH fallback covers a proactive turn only — deliberately, and
its comment explains why: a pending's answer comes from the option list the engine itself published,
so an unanswerable option list is an engine bug to fix rather than paper over. This is not new with
solo (a networked table stalls the same way, and `bots.test.ts:34` and the sudo pick-from-discard
regression at `bots.test.ts:71` both exist because of it) — but solo makes it reachable far more
often, since bots now answer every pending in the match rather than only an abandoned seat's.

Mitigation is a dev-only signal, not a recovery: a `console.warn` when the same pending stands
unchanged across N ticks with a bot owing it. A silent stall is the failure that costs an hour; a
named one costs a minute.

## Testing

TDD, and mostly at the seams that already have suites:

- **`loopback.test.ts`** — the null transport satisfies `Transport` and drops every send.
- **`referee.test.ts`** — `driveUnattended` drives a `bot: true` seat on the first tick with no
  grace; still waits out `ABSENT_GRACE_MS` for a human; `restoreSeats` leaves a bot seat's flag and
  absence alone.
- **`link`/keeper level** — a solo session plays a whole match to `over` with no transport; the gate
  holds every bot until the human's intro reports.
- **`useLobby` tests** — `startSolo` seats human-first and mints a restorable id; `restoreSolo`
  round-trips a match through the snapshot and comes back with the same seats and log.
- **Page test** (under `__tests__/`, per the generouted rule) — a solo session opens the board:
  `seated` is true, no bot renders as disconnected, and the results screen shows a row per bot.

The engine is untouched, so its conformance suite is unaffected.

## Out of scope

- **Any change to `botAction`.** Difficulty levels, randomness, bluffing, and a scoring policy are a
  later spec against the same seam.
- **A bot badge in `@release/ui`.** Bots are identified by name (decision 6).
- **Bots in a networked lobby.** Solo does not touch the lobby's roster, capacity, kick or ready
  rules, and adding bot slots there is its own design.
- **Rules changes.** Nothing here is a rules question: the engine's behaviour is unchanged, and the
  only rules-adjacent choice (who moves first) is one `general.md` already leaves to the system.

## Open questions

1. **Bot names.** Decision 6 commits to `Bot 1…Bot 5` / `Бот 1…Бот 5`, because with no badge on
   the board the name is the only thing saying which seats are bots. Drawing them from
   `randomNickname` instead would make a solo table read like a real one — a one-line swap, and the
   reason to revisit this is if bots ever do get a badge of their own.
2. **Human always first.** Decision 7 keeps it fixed and predictable. Randomising the human's seat
   is one line and equally legal by the rules — worth a second look once the mode is playable.
