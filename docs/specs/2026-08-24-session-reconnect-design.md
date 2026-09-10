# Session reconnect — Design

**Date:** 2026-08-24
**Project:** ReleaseBoardGameP2P ("Release любой ценой")
**Scope:** Surviving a page reload. What a browser persists, how a returning peer reclaims its seat, and how a host restores the match it was keeping. Closes [#110](https://github.com/MythHand/ReleaseBoardGameP2P/issues/110).

## Goal

Reload the page mid-match today and the table comes back **empty**. Not an error,
not a redirect — a permanent blank board. `useLobby` mounts fresh, holds no peers,
`game.view` is `null`, and `pages/board/[gameId]/index.tsx` falls through to
`EMPTY_TABLE` forever.

This spec makes a reload survivable for every role, in the lobby and at the table.

## Context

**The hard half is already built.** `network/session/referee.ts` carries the whole
reconnect model, and it is unit-tested:

- `Seat { playerId, peerId: string | null, absentSince: number | null }` — a seat
  outlives its connection, because hand, pending and turn live in `GameState`,
  which never left the keeper
- `disconnect()` frees a seat without destroying it
- `rebind()` reclaims one, refuses a seat that is still connected, re-stamps an
  expired turn clock so a returning player is not instantly auto-played, and sends
  a single catch-up projection
- `driveAbsent()` + `ABSENT_GRACE_MS = 30s` plays an empty seat with `botAction`
- `syncAll()` skips absent seats: *"reconnecting only ever needs one fresh projection"*

**None of it is reachable.** `KeeperHandle.peerLeft` and `.peerReturned` have no
caller outside their own module. `useLobby`'s `onDisconnect` prunes the *lobby
roster* and never tells the keeper, so `driveAbsent` never fires either.

**The identity it assumes was never built.** `entities/game/seats.ts` mints
`p1…pN` bound to *peer* ids, and there is no `localStorage` or `sessionStorage`
anywhere in `apps/frontend`.

**The UI exists and is unwired.** `@release/ui`'s `Reconnect` overlay and the
`Seat` offline badge both render, and both are reachable only from the playground:
`pages/board/[gameId]/index.tsx` never passes `connection` or `disconnected` to
`<Table>`. `Reconnect` itself is marked `PROTOTYPE` — its terminal log is a scripted
mock with `host = 'ABC-DEF'` hardcoded that always fails after five attempts.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Host reload | **The match survives it.** The host persists `GameState` and reclaims its room-code peer id |
| 2 | Recovery reach | **A per-browser `clientId` in `localStorage`** — covers reload, a reopened tab, and a browser restart |
| 3 | Seat identity | **`PlayerId` stays `p1…pN`**; a separate persisted `clientId` maps to a seat (amends sync-layer #5) |
| 4 | Persistence unit | **A snapshot per keeper `commit()`**, throttled — not an action log replayed against the seed |
| 5 | Restore TTL | **12 hours**, applied to *both* stored records, then discarded as abandoned |
| 6 | Give-up rule | **Bounded retries, then a choice.** The overlay reaches `failed` and keeps retry/leave live; nothing auto-abandons |
| 7 | Presence on the wire | **None.** A seat whose `peerId` is not in `state.peers` is offline — the rule `toStatPlayers` already uses |
| 8 | Rejoin message | **`JOIN_REQUEST` gains `clientId`.** One new broadcast, `SEAT_REBOUND`, patches everyone's frozen seating |
| 9 | Restore scope | **Lobby and board both** |
| 10 | Persistence layer | **A plain module**, `shared/lib/persistence.ts` — no state library |

## Amendments to the sync layer spec

Three decisions in the [P2P sync layer spec](./2026-07-30-p2p-sync-layer-design.md)
are changed here. They are recorded rather than quietly diverged from, because a
reader who lands on the older decision first would otherwise be misled.

**Decision #5 — seat identity.** That spec says `PlayerId` *is* a uuid the client
persists. We keep `PlayerId` as `p1…pN` and add a separate persisted `clientId`.

The intent is preserved exactly — a seat outliving its connection, keyed by
something that outlives the tab — but the mechanism moves one layer out. Two
reasons. First, `entities/game/seats.ts` mints `p1…pN` *deliberately*, so that a
`PlayerId` can never be mistaken for a peer id: both are `string`, and "that is
exactly what hides a mix-up". Guest peer ids from PeerJS are already uuids, so
making `PlayerId` a uuid recreates the very collision that comment guards against.
Second, resolving `clientId → playerId` in `useLobby` means **`referee.ts` needs no
change at all** — `rebind` already takes a `PlayerId` — so the tested core is left
alone and the engine's `p1`/`p2` fixtures stay put.

**Decision #8 — keeper loss.** That spec says the game ends: *"Voluntary handover
exists; a crash is terminal."* A host reload is no longer terminal. The host
snapshots `GameState` and restores it.

The rule is narrowed, not deleted: a keeper that never comes back is still
terminal. Handing the keeper to a surviving peer was considered and is **out of
scope** here (see below).

**Decision #9 — absent seats.** Amended with one guard: the keeper does not drive
absent seats while **zero** seats are connected.

Stated carefully, because the obvious justification is wrong. A restored host that
is never rejoined does *not* trigger this: it keeps its own seat (see host restore
below), so it is a present player watching the keeper drive absent opponents — which
is decision #9 working exactly as designed, not a bug. The guard covers the case
where the keeper has no audience at all: no connected seat, nobody to receive a
`SYNC`, and a match advancing for no one. That is unreachable for a host-keeper
today and becomes reachable the moment keeper handover lands on a peer whose own
seat has since dropped. It costs one line and one test, so it goes in now rather
than being rediscovered later.

**It also closes a gap that spec recorded.** *"A seat's disconnection has no wire
representation, by omission… presence is a screen concern, and the shape it needs
is decided with the table UI."* That shape is decided below, and it needs no wire
representation after all.

## What is persisted

Three keys in `localStorage`, prefixed `release:`.

| Key | Holds | Written | Cleared |
|---|---|---|---|
| `release:clientId` | A `crypto.randomUUID()` | Once per browser profile, lazily | Never |
| `release:session` | `{ roomCode, name, role, gameId, joinedAt }` | On `createRoom`/`joinRoom`, and when `gameId` is set | `leaveSession`, `disband`, `kicked`, TTL expiry |
| `release:keeper` | `{ gameId, keeperId, state, seats, savedAt }` | From `commit()` in `referee.ts`, throttled | Match end, TTL expiry, superseded match |

The 12h TTL governs `release:session` and `release:keeper` alike, measured from
`joinedAt`/`savedAt`. Expiring only the snapshot would leave `/start` offering to
resume a room whose match record had already been discarded.

`clientId` is deliberately **not** cleared by leaving a room: it is the thing that
outlives the tab, and a player who leaves and comes back to the same room should be
recognised.

The keeper snapshot is written from `commit()` because that is the single funnel
every state change already passes through. Throttled on a trailing edge of ~250ms,
matching the existing `intervalTicker` cadence, so a burst of resolution events
costs one serialization rather than ten. `GameState` is known to serialize cleanly:
`KEEPER_STATE` already puts it on the wire.

**Why a snapshot and not an action log.** Replay is tempting — `GameState` carries
`seed` and `rngCursor`, so it is deterministic. But any engine change silently
invalidates every stored log, and the failure mode is a match that restores into a
subtly wrong state rather than one that refuses to restore. A snapshot cannot drift
from the engine that wrote it.

**Why not `beforeunload`.** It does not fire on a crash or a mobile tab eviction,
which are exactly the cases that hurt most.

**Storage availability.** Safari private mode and some embedded webviews throw on
`setItem`. Every read and write goes through a wrapper that degrades to in-memory,
so a browser without storage behaves exactly as today rather than crashing on mount.

**Multi-tab, stated plainly.** One `clientId` per browser profile means a second tab
on the same origin is the same identity. Opening a second tab onto a live match
finds its seat still connected, and `rebind` refuses a seat whose `peerId` is not
null — so it degrades to a refusal, never a stolen hand. That refusal needs a real
message rather than a silent no-op, and local two-player testing needs two browser
profiles.

## Presence

No wire change. `toStatPlayers` already derives offline-ness from absence:

> Absence IS the offline signal — nobody announces their own disconnection, so
> `where` has no such member to read.

The board uses the same rule. A seat whose `peerId` is not in `state.peers` is
disconnected. The `types.ts` invariant — *"a peer that has gone is simply absent
from `LobbyState.peers`"* — is untouched.

This does require one real fix. `pages/board/[gameId]/index.tsx` builds
`participants` from `peers` alone, so a dropped player is deleted from the roster
and their seat vanishes from the table entirely — which is why there is nothing
there to mark as disconnected. Participants are rebuilt from the frozen seating
joined against live peers, exactly as `toStatPlayers` does it.

## The rejoin handshake

Because the host prunes the stale peer the instant its channel drops, a return *is*
a fresh join — one carrying a `clientId` the host recognises. `JOIN_REQUEST` gains
that field; `PeerInfo` and `Seat` both carry it, and `Seat` already rides
`GAME_STARTING`, so the mapping reaches every peer with no new broadcast.

`handleJoinRequest` gains one branch up front: if a frozen seat carries this
`clientId`, this is a return, and **role comes from the seat, not from
`assignRole`**. This is the trap of this section — a returning player whose room
filled up behind them would otherwise be handed `guest` and silently demoted out of
a match they are still seated in.

The host then:

1. re-adds the peer under its **new** peer id, keeping name and role
2. patches the frozen seating so that seat names the new peer id
3. sends the returner `PEER_LIST` + `LOBBY_CONFIG_UPDATED`, and — if a match is
   live — `GAME_STARTING { gameId, seats }`
4. calls `keeper.peerReturned(playerId, newPeerId)`, the first real caller of a
   method that has been sitting unused
5. broadcasts `PEER_JOINED` (new id) and `SEAT_REBOUND { playerId, peerId }`

`SEAT_REBOUND` is the only genuinely new message. Every other peer holds the frozen
seating with the *old* peer id in it; without a patch their winner lookup and stats
rows keep pointing at a peer id that no longer exists. It carries one seat. The
returner does not need it — `GAME_STARTING` gave it the whole seating.

**Routing falls out for free.** `useFollowGameStart` is mounted app-wide and
navigates purely off `session.gameId`, so `GAME_STARTING` puts the returner on
`/board/:gameId` with no new navigation code.

`useLobby`'s "a rematch must not inherit the last match's projection" guard *does*
fire on a restore — a freshly mounted peer holds no `gameId`, so the incoming one
differs and `setGameSync(null)` runs. That is harmless: it clears a projection this
mount never had, and the catch-up `SYNC` arrives **after** it, because the handshake
dispatches `GAME_STARTING` before calling `peerReturned` and DataChannels preserve
order — the same guarantee `startGame` already relies on.

## Host restore

Run once from `useLobby` on mount, when `release:session` says `role: 'host'` and a
`release:keeper` snapshot matches its `gameId` and is inside the TTL:

1. `createTransport({ peerId: parseRoomCode(stored.roomCode) })` — reclaim the
   **exact** peer id, because the room code *is* the host's peer id.
2. Rebuild `LobbyState` with the host alone. The host cannot dial anyone: their old
   peer ids are dead and it does not know their new ones. **Everyone re-dials the
   host**, which is what the returning peers' retry loop is already doing.
3. `adoptSession({ state, gameId, keeperId, engine, seats })` — it already exists
   for handover and takes precisely what the snapshot holds. The engine is
   stateless, so a fresh `createFakeEngine()` is correct; `seed` and `rngCursor`
   ride inside the restored `GameState`.
4. `attachKeeper({ ref, transport, now })` — **with no gate**. The start gate holds
   the table until every seat reports `INTRO_READY`; mid-match nobody ever will, so
   passing one would deadlock every intent.
5. **No `resync(setupEvents(...))`.** That call is what replays the deal.

**Reclaiming the peer id is the one step that can genuinely fail.** On a fast reload
the broker may still hold the old registration and PeerJS rejects with
`unavailable-id`. That gets a bounded retry with backoff; anything else surfaces
through the existing `surfaceSetupError` path.

**The absence-clock trap.** Every seat *except the host's own* is adopted with
`peerId: null` and `absentSince: now` — never the stored timestamps. Restore the
stored values and `driveAbsent` sees every seat as far past its 30s grace and
bot-plays the whole table before a single player can re-dial. The pause was not
time spent.

**The host's own seat is the exception**, and must keep its peer id. The room code
*is* that peer id and step 1 reclaims it unchanged, so the seat the host held is
still addressable — and `attachKeeper` routes an outgoing addressed to
`transport.id` to the local link rather than over a connection to itself. Null it
and the restoring host would sit in front of a table it never receives a projection
for. Concretely: keep the seat whose stored `peerId` equals the reclaimed
`transport.id`; null every other.

**Two things that need no code.** The deal intro suppresses itself: `rebind` sends
a projection with *empty* events, and `useDealIntro` hands over at once when there
is "no deal to replay" — so a returning peer gets no phantom deal animation for a
mid-game hand. And expired turn clocks are already handled: `tick` refuses to fire a
deadline against an empty seat, and `rebind` re-stamps an expired one for the
returner.

## UI

**Board page.** `participants` from seats joined against peers; `disconnected` is
the seats that found no peer; `connection` is `'reconnecting'` while this peer is
dialing and `'online'` otherwise.

**`Reconnect` becomes real.** The internal `buildScript` mock goes. In come
`events: ReconnectEvent[]`, `status: 'trying' | 'failed'`, `attempt`/`maxAttempts`,
`onRetry`, `onLeave`, and a required `host` instead of the hardcoded `'ABC-DEF'`.
The network layer emits *structured* events (`dialing`, `channel-open`, `handshake`,
`backoff`, `failed`); the component renders them into terminal lines itself. That
keeps `@release/ui` i18n-agnostic and honours its existing note that the log is
deliberately untranslated technical output.

The artificial pacing disappears on its own: with real events the log's rhythm is
the actual dial cadence. `Reconnect.module.css` already carries a
`prefers-reduced-motion` block covering the overlay entrance and cursor blink, and
nothing here uses the `play()` vocabulary, so this incurs no `docs/animations`
obligations.

**`/start` continue-session.** Today it is gated on `status === 'in-lobby' &&
!!session.state` — an in-memory session, so after a reload it is always hidden. It
switches to the persisted session, routing to the board when the stored session
carries a `gameId` and to the lobby otherwise. The dead slot becomes the rejoin
affordance with no new UI.

**Playground.** `TableStory` drives the new prop shape from a canned event sequence,
so both `trying` and `failed` stay demonstrable. `apps/ui/src/screens/` is the
visual source of truth and cannot be left rendering a shape the app no longer uses.

**i18n.** `reconnect.*` and `seat.disconnected` exist in both catalogs already. New
keys (attempt counter, restoring label) go into `en` **and** `ru`.

## Verification

Layered the way the code is, so most of it needs no React.

- **`persistence.ts`** — round-trip, corrupt JSON, the 12h TTL boundary, and the
  throwing-`localStorage` fallback.
- **`referee.ts`** — the `driveAbsent` zero-connected-seats guard is new behaviour
  and gets a test: a session with no connected seats must not advance.
- **Restore, headless.** `memoryNetwork.ts` and the `SessionRef` seam drive the
  whole handshake in-process: snapshot a live session, adopt it with rewritten
  absence clocks, rejoin a peer by `clientId`, assert it gets its own seat back with
  the right hand, and that a different `clientId` is refused. This is where the real
  risk lives.
- **The role trap** — a returning player rejoining a room that filled up behind
  them comes back as `player`, never `guest`.
- **Board page** — participants and `disconnected` derived from seats when a peer is
  missing from the roster.

**Verified by running, not only asserting:** a real reload on both sides of a live
match (two browser profiles against `pnpm dev:p2p`), and the host reclaiming its
room code on a *fast* reload — the step most likely to behave differently against a
real broker than against a mock.

## Out of scope

**Move-history replay.** A returning peer's history starts at the moment of return.
`rebind` deliberately sends one projection rather than a replay — *"a peer's state
was never a fold over deltas it might have missed"* — and `useGame` accumulates
events per peer. The board comes back correct; the history panel starts fresh.

**Keeper handover to a surviving peer.** If the host never returns, the match is
still lost. `handover`/`adoptSession`/`KEEPER_STATE` exist and would support it, but
it is a separate mechanism from persistence and belongs in its own issue.

**Authenticating `clientId`.** Nothing verifies it — a peer announcing another's
`clientId` for an *absent* seat would receive that seat's projection. `rebind`
already refuses a *connected* seat, which bounds the exposure to a seat whose owner
has genuinely dropped, and trust here is social exactly as it is for the keeper
(sync-layer #1). Recorded so it is not rediscovered as a surprise.
