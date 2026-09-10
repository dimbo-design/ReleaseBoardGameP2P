# P2P sync layer — Design

**Date:** 2026-07-30
**Project:** ReleaseBoardGameP2P ("Release любой ценой")
**Scope:** The layer that turns local intents into protocol messages and remote messages into state, so a game plays across peers rather than in one browser. Piece 4 of the [#18](https://github.com/MythHand/ReleaseBoardGameP2P/issues/18) decomposition ([#60](https://github.com/MythHand/ReleaseBoardGameP2P/issues/60)).

## Goal

`@release/engine` evaluates the rules; the lobby connects the peers. Between them
sits nothing. This spec designs that seam: who owns `GameState`, what crosses the
wire, and how a peer's screen stays correct through a disconnect, a host transfer,
or a player who never comes back.

It also settles the open question the [P2P networking spec](./2026-06-22-p2p-networking-design.md)
deferred — **who keeps the hidden, ordered deck** — which is why this piece waited
for a concrete `GameState` rather than a hypothetical one.

## Context

Three things already exist, and each one shrinks this layer.

**The engine is a deterministic reducer.** `reduce` is total and pure, `project(state, viewerId)`
is already the per-seat view the page consumes, and every `Event` declares its own
audience via `visibleTo`. The engine is the only party that knows which secrets
exist, so it is the only party that can hide them — which means this layer's entire
privacy job is *reading* `visibleTo`, not re-deriving what is secret.

**The transport is built.** `network/transport/peer.ts` owns the PeerJS lifecycle,
`network/envelope.ts` the wire framing, `network/lobby/` the join flow, roles, kick
and host transfer. Nothing here changes any of it.

**The protocol was specced before the engine existed.** `network/types.ts` types
~30 messages, the rules-driven half of them types-only. That half was written when
the rules lived nowhere, so it encodes them: `DEFENSE_REQUEST` is `state.pending`,
`ATTACK_WINDOW_OPEN` is `state.window`, `HAND_ATTACK_RESULT` is an event with a
`visibleTo`. Keeping it means two implementations of the same rules that have to
agree forever. It goes.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Deck/discard keeper | **A keeper owns `GameState` and runs the engine.** Trust is social, not cryptographic — friends' games now, a trustless scheme later behind the same seam |
| 2 | Keeper identity | **A distinct logical role**, `keeperId`, defaulting to the host — not a synonym for "is host" |
| 3 | Wire protocol | **Replace the rules half** of `Message` with five engine-native types; the lobby half is untouched |
| 4 | State on the wire | **`project` output, per recipient, privately.** No peer ever receives `GameState` |
| 5 | Seat identity | **A persisted client uuid**, not the PeerJS peer id, so reconnection keeps its seat |
| 6 | Time | **The keeper's clock is the only clock.** It stamps every action's `at` and owns the window timer |
| 7 | Checkpoints | **None.** Every `SYNC` is a complete projection, so `TURN_RESOLVED` is deleted rather than implemented |
| 8 | Keeper loss | **The game ends.** Voluntary handover exists; a crash is terminal |
| 9 | Absent seats | **The keeper drives them** with the engine's opponent policy after a grace period |
| 10 | Guests | **Out of scope** — deferred to [#58](https://github.com/MythHand/ReleaseBoardGameP2P/issues/58) |

> **Decisions 5, 8 and 9 are amended by the
> [Session reconnect spec](./2026-08-24-session-reconnect-design.md) (2026-08-24).**
> #5 — `PlayerId` stays `p1…pN`; a separate persisted `clientId` carries the identity
> across a reload, so `referee.ts` is untouched. #8 — a host *reload* is no longer
> terminal (the host snapshots `GameState` and restores it); a keeper that never
> returns still is. #9 — the keeper does not drive absent seats while zero seats are
> connected. That spec also closes the presence gap recorded below.

## Why a keeper, and what it costs

`reduce` takes the whole `GameState` — every hand and the ordered deck. Whoever
runs the engine therefore sees everything. That single fact rules out the
alternatives:

- **Replicating the engine on every peer** makes every hand common knowledge. The
  game has no hidden information left.
- **Turn-authority** (the [2026-06-22 spec](./2026-06-22-p2p-networking-design.md)'s
  decision 6) hands full state to each turn's authority in turn, so over one game
  every player sees every hand. Privacy dies more slowly, not less completely.

So exactly one party runs the engine. It is called the **keeper**, it holds the
seed and `GameState`, and it defaults to the host without being defined as the host.

**What this costs, stated plainly:** the keeper could read the deck and every hand.
Nothing in the protocol prevents it — only the fact that it is someone's friend.
The build accepts that and confines it: `referee.ts` is the only module that holds
the seed and `GameState`, and a commit-reveal implementation replaces that module
without touching `GameLink`, `useGame`, `Table`, or the page.

**And what it costs the issue's premise:** [#60](https://github.com/MythHand/ReleaseBoardGameP2P/issues/60)
expects determinism to make turn checkpoints "verifiable rather than hopeful". It
cannot. Verifying a checkpoint means replaying `seed` plus the action log — and the
seed together with the deck composition *is* the deck order, so handing a peer what
it needs to verify hands it the secret the keeper exists to protect. The seed never
leaves the keeper. Determinism still pays for itself in replayable bug reports,
keeper handover, and tests; it does not buy peer verification here.

## Architecture

```
peer (player)                          keeper (default: host)
──────────────                         ──────────────────────
useGame ──▶ GameLink.submit(intent)
              │  RemoteLink
              ▼
         transport.send(keeperId) ─────▶ referee.ts
                                          ├─ resolve sender → PlayerId
                                          ├─ stamp `at` from its own clock
                                          ├─ engine.reduce(state, action)
                                          └─ per seated peer:
                                               project(state, id)
                                               events.filter(visibleTo)
              GameLink.subscribe ◀───────  SYNC (private, per peer)
```

**`GameLink` is the seam**, and it is the only thing the page sees: submit an
intent, subscribe to `{ view, events }`. Two implementations satisfy it.
`LocalLink` owns a keeper session in-process with no transport — solo play, the
playground, and every headless test. `RemoteLink` sends the intent to the keeper
and applies what comes back. Neither `useGame` nor `Table` can tell which one it
has, which is the property that lets this layer be built and verified before
[#18](https://github.com/MythHand/ReleaseBoardGameP2P/issues/18)'s page work lands.

There is no optimistic local application: a peer without `GameState` cannot run
`reduce`, so every intent round-trips. For a turn-based card game over a star
topology that is one hop to the keeper, or two when the keeper is not the host.

### Identity

`PlayerId` is a uuid the client persists in `localStorage`, **not** its PeerJS id —
a peer id dies with the tab, and reconnection is in scope. The keeper holds the
`PlayerId ↔ peerId` map; reconnecting rebinds it. `project(state, playerId)` then
needs no translation, and a returning player's seat, hand and pending survive
because they never lived on the client.

### Trust boundary

The keeper never trusts what a frame claims about itself:

- **`action.player` is overwritten** with the `PlayerId` bound to the connection the
  frame arrived on. A peer cannot act as another seat.
- **`at` is stamped by the keeper**, so a peer cannot lie about time and every rules
  decision reads one clock. Display is a separate question: `WindowView.deadline` and
  `PendingView.deadline` are absolute keeper-epoch milliseconds and they ship inside
  every `SYNC`, so a peer that renders `deadline - Date.now()` is off by the two
  machines' clock skew — a fast local clock shows a reaction window already at zero
  while the keeper still accepts attacks, a slow one closes it mid-decision. The UI
  work owns this: derive the countdown from a keeper-relative offset (the remaining
  duration, or the skew measured against a `SYNC`'s own stamp) rather than from the
  absolute value.
- **`WINDOW_EXPIRED` is never sent by a peer.** The keeper owns the deadline timer
  and fires it itself. The engine's constraint — that `WINDOW_EXPIRED` carries no
  player identity and must not acquire an owner-only rule — is satisfied by
  removing the question rather than answering it. `Intent` excludes it in the type
  system, and the keeper *also* refuses it at runtime: what arrives is parsed JSON,
  so the type is a statement about our own callers, never about the wire.
- **The keeper drives absent seats, but not their clocks.** `botAction` answers for
  a silent seat that owns an open window with `WINDOW_EXPIRED` stamped at that
  window's own deadline. The keeper drops that suggestion rather than replaying it:
  a bot's forged time is no more authoritative than a peer's, and honouring it would
  end everyone else's reaction time early.

**What "the connection the frame arrived on" covers, and what it does not.** The
transport overwrites `from` with the peer id of the connection the frame came in
on, so for a **directly connected** peer the claim above holds outright. A frame
the host **relays** on another peer's behalf arrives on the *host's* connection, so
a keeper that is not itself the host sees the relay's identity, not the origin's —
within that topology a malicious host can act as any seat, and an honest one still
misattributes every relayed intent to itself. Nothing in this layer closes that, and
no cryptographic identity exists to close it with; it sits inside the same
social-trust boundary as decision 1.

Two consequences are load-bearing today. Because a relayed frame reaches a guest
wearing the host's id, the host does not relay the lobby messages a guest treats as
the host's word (roster, config, kick, disband, host transfer). And because a wire
frame names no recipient, relaying one is broadcasting it — so the host does not
relay the game frames either: `SYNC` carries one seat's projection, `KEEPER_STATE`
carries `GameState`, `INTENT` carries the card a player chose (including one the
keeper rejected and emitted no event for), and `KEEPER_CHANGED` carries the death
notice that ends the game for everyone. None of that costs anything while the keeper
*is* the host, which is the only wiring that exists: every game frame then travels a
direct connection in both directions. A keeper sitting behind the host needs a relay
that routes by named recipient and a transport that sends through the host at all —
part of the handover wiring in #18, not something a message-type rule can express.

### Module layout

`apps/frontend/src/network/session/`:

| File | Role |
|------|------|
| `referee.ts` | Owns `GameState`, applies actions, fans out projections, owns the window timer |
| `link.ts` | The `GameLink` port + `LocalLink` |
| `remoteLink.ts` | The networked implementation |
| `audience.ts` | `visibleTo` filtering and `rejected` suppression |
| `relay.ts` | Unchanged |
| `turn.ts` | **Deleted** — the engine owns turn order |
| `attackWindow.ts` | **Deleted** — the engine owns the reaction window |

## Protocol

`network/types.ts` starts importing `@release/engine`. That direction is safe: the
engine depends on nothing and imports nothing back.

```ts
// Everything the keeper decides for you is stripped: no `player`, no `at`, and
// no WINDOW_EXPIRED (keeper-only, fired by its own timer). The Omit has to
// distribute, or the union collapses to its common members.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type Intent = DistributiveOmit<Exclude<Action, { type: 'WINDOW_EXPIRED' }>, 'player' | 'at'>

| { type: 'GAME_STARTED';   payload: { gameId: string; keeperId: PlayerId } }
| { type: 'INTENT';         payload: { intent: Intent } }                      // peer   → keeper
| { type: 'SYNC';           payload: { view: PlayerView; events: Event[] } }   // keeper → one peer
| { type: 'KEEPER_STATE';   payload: { state: GameState } }                    // keeper → successor
| { type: 'KEEPER_CHANGED'; payload: { keeperId: PlayerId | null } }           // → all
```

Everything else in the rules half of the union is deleted, along with the
`AttackResponse` type it used.

**`GAME_STARTED` carries almost nothing** — enough to route to `/board/:gameId` and
to know who to talk to. It does not carry the seed. Everything the old payload held
(`players`, `deckSize`, `currentTurn`, `modes`) is in the `SYNC` that follows, and
`HAND_DEALT` is gone because `view.self.hand` is the hand.

**`SYNC` is private and per-recipient**, never broadcast: one `project` plus that
viewer's filtered events.

**`rejected` rides back to the submitter alone.** State is referentially unchanged,
so the keeper returns a `SYNC` whose `events` hold the `rejected` event and nobody
else hears anything. `audience.ts` marks it so the history builder drops it — per
`packages/engine/README.md`, a rejection did not happen.

**No `TURN_RESOLVED`.** Every `SYNC` is a complete projection; a peer's state is
never a fold over deltas it could have missed. A periodic full snapshot on top of a
stream of full snapshots is redundant, so the checkpoint cadence, the catch-up log,
and the whole "did I miss a message" class of bug are deleted rather than built.

## Lifecycle

**Game start.** The host presses Start and becomes the keeper. It generates the seed
with `crypto.getRandomValues`, builds `GameConfig` from the seated peers and the
lobby `Setup`, takes `DeckEntry[]` from the card catalogue — quantities live with
the caller, never in the engine — calls `createGame`, broadcasts `GAME_STARTED`,
then sends each player their first private `SYNC`.

**Host transfer and keeper handover are different operations.** `TRANSFER_HOST`
moves the *relay*: peers reconnect to the new host, the keeper keeps playing, its
traffic takes a different road. Moving the keeper is separate and always voluntary —
the keeper sends `KEEPER_STATE { state }` privately to its successor, who announces
itself with `KEEPER_CHANGED { keeperId }`.

This layer builds the **outgoing** half of that: `KeeperHandle.handover` sends the
state, announces the change, and stops keeping the session. The successor's half —
receiving `KEEPER_STATE`, calling `adoptSession`, and attaching its own keeper — is
deferred to the page/lobby wiring in [#18](https://github.com/MythHand/ReleaseBoardGameP2P/issues/18),
because only that layer knows the seat table and owns the transport to re-attach
with. `adoptSession` exists and is tested; nothing calls it yet.

**Keeper loss ends the game.** `KEEPER_CHANGED { keeperId: null }` is the death
notice: when the keeper is the host, each peer sees its one connection drop and
renders it locally; when the keeper is another peer, the host observes the loss and
broadcasts. Players get `@release/ui`'s `Reconnect` surface and return to the lobby.
The game is not resumable. Observing the loss is a lobby-level job — this layer
never sends that notice, and wiring it is also #18's.

**A seat's disconnection has no wire representation, by omission.** `disconnect`
updates the keeper's seat table and produces no messages, and `PlayerView` carries
no per-seat presence, so no peer can currently learn that another seat dropped —
only that it has stopped acting. Nothing in this layer is the right place to fix
it: presence is a screen concern, and the shape it needs (a badge, a greyed seat, a
"playing for them" notice while the keeper drives an absent seat) is decided with
the table UI in #18. Recorded here as a known gap rather than left to be
rediscovered as a bug.

**Absent seats are driven by the keeper.** The engine has no concept of a player who
left, and a pending owed by a ghost stalls the game permanently — the deadlock the
deleted `attackWindow.ts` guarded with `dropPlayer`. After a grace period with no
connection — 30s, matching the attack-window timeout the
[2026-06-22 spec](./2026-06-22-p2p-networking-design.md) already chose — the keeper
generates that seat's actions with `botAction`
(`packages/engine/src/fake/bots.ts`). This is not the forbidden `runUntilIdle` case:
that rule protects a human's reaction-window decision from being auto-resolved, and
here there is no human present to decide. Reconnect inside the grace period and a
`SYNC` restores the seat unchanged. This also covers the pendings that carry no
deadline of their own — `discardForRelease`, `neutralize503`, `crush`, `handLimit` —
which would otherwise never expire.

## Verification

An in-memory transport wires N `RemoteLink`s to one keeper session in a single process,
with no PeerJS and no browser. The keeper's clock is injected rather than read, so
`at` stamping and window deadlines are deterministic. Playwright multi-tab stays for
one smoke path proving PeerJS is wired — not for protocol coverage.

Four properties carry the weight:

1. **No leak, ever.** Fuzz a full game and assert no `SYNC` sent to peer P contains a
   card identity P is not entitled to — another hand's cards, or anything of deck
   order. This is the test the design exists to pass.
2. **The seam is transparent.** The same seed and intent sequence through `LocalLink`
   and through the networked path produce an identical final `GameState`.
3. **Reconnection is not special.** Drop a peer mid-reaction-window, rebind, and its
   `SYNC` must equal `project(keeperState, id)` exactly.
4. **No seat can stall the game.** Disconnect the turn player mid-turn and the game
   still reaches `over`.

Each new test is verified by mutation — break the code it names, confirm red. Nine
tests during the engine's implementation shipped green while asserting nothing, and
every one was found this way rather than by reading
(`docs/specs/2026-07-27-game-engine-plan.md` records the failure modes).

## Out of scope

- **Guests / spectators** — [#58](https://github.com/MythHand/ReleaseBoardGameP2P/issues/58).
  `project` throws for a viewer who is not a seated player and `PlayerView.self` is
  non-optional, so a spectator view is an engine-contract change, designed there.
- **Git operations and System Upgrade** — [#61](https://github.com/MythHand/ReleaseBoardGameP2P/issues/61).
  Worth noting what the keeper does to that issue's protocol needs: `GIT_PEEK` and
  `GIT_REORDER` need not exist. A private top-of-deck peek is `state.pending`
  projected to one viewer; the reorder is a `Choice`. #61 gets UI surfaces and
  nothing on the wire.
- **The page itself** — [#18](https://github.com/MythHand/ReleaseBoardGameP2P/issues/18)'s
  remaining milestones. This spec defines `GameLink`; `useGame` consumes it.
- **A trustless deck.** The seam is preserved, not built: `referee.ts` is the only
  module holding the seed and `GameState`, and a commit-reveal implementation
  replaces it alone.
