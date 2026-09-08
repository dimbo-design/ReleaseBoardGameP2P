# Move history on the board — the log the table keeps, and keeps through a reload

**Date:** 2026-09-08
**Project:** ReleaseBoardGameP2P ("Release любой ценой")
**Issue:** [#136](https://github.com/MythHand/ReleaseBoardGameP2P/issues/136)
**Scope:** The history panel, brought to full parity with `/playground/table`, and made to survive a
reload. Two jobs that look separate and are not: the panel is thin because the adapter fills five
fields of a shape with twelve, and it is empty after a reload because the feed it reads was never
written down anywhere. The visual source of truth is the story — and where the story and this
document disagree, the story.

> Builds on what is already on the board: `MoveHistory` in `@release/ui`, the `panel` switch in
> `_Board.tsx`, `toBoardState`, the `SYNC` message, and `forViewer`. Nothing here rebuilds any of
> them; the work is one adapter, one field on `Session`, one storage record and one merge rule.
> Branched fresh from `main` at `bda58bd`.

## The goal

A player who opens the history tab reads the match as it happened: who released what, what was
thrown at it, what answered, and what that cost — in colour, with the answers sitting under the move
they answered. A player who reloads mid-match opens the same tab and finds the same log, including
the part that happened while they were away.

## Decisions

Taken during brainstorming, recorded here so the plan does not relitigate them.

1. **Full parity with the story, not a subset.** Every field `MoveHistory` renders gets filled.
2. **Persistence is local-first, host-reconciled.** The peer restores its own feed for an instant
   paint; the host resends the authoritative log and the two are merged.
3. **The merge key is `Event.id`.** Union, sorted by id.
4. **Oldest-first.** `.reverse()` goes; the pinned assertion is inverted deliberately.
5. **The card-target sword is not implemented.** It has no engine source. It becomes an open
   question, not a guess.

## What the issue asks for, and what the code actually says

Three corrections to the way this was framed as "implement the history tab".

**The tab exists.** `_Board.tsx:1848` renders `<MoveHistory entries={history} copy={copy.history} />`
inside `data-testid="panel-history"`, and `boardComponent.test.tsx` already asserts it appears. There
is nothing to build at the panel level.

**The component is finished.** `apps/ui/src/table/MoveHistory/MoveHistory.tsx` renders category
colour, the `+ Sudo` / `+ Code Review` combo, the sword target, the Rollback and Works-on-my-Machine
tails, the `DRAW` badge, the grey system row and the nested `children`. It is i18n-agnostic and takes
its two strings through `MoveHistoryCopy`. It needs no change.

**The catalog is complete.** `historyLabels` carries 29 entries against main's 29 event types, and
`moveHistory` already has `draw` and `eliminated`. No new translation keys.

So the whole visible gap is `toHistoryEntry` (`toBoardState.ts:137`), which returns:

```ts
{ id, who, kind: labels[e.type], card, parent }
```

Never `cat`, `combo`, `target`, `returnCard`, `redirect`, `system`, `children`. A complete component
rendering an incomplete row: grey, flat, and — because `parent` is carried but never assembled —
a tree flattened back into a list on the way in.

## Architecture

### 1. The adapter — `toHistoryEntry` becomes exhaustive

One `switch (e.type)` over the whole union, ending in a `never` check:

```ts
default: {
  const _exhaustive: never = e
  return _exhaustive
}
```

This is load-bearing rather than decorative. `#108` adds `upgradeThrown` and `upgradeTaken` to the
union on a branch that has not merged; without the `never` the merge would compile, and the two new
events would render as unlabelled grey rows that nobody notices. With it, the merge fails
typecheck at exactly the line that needs a decision.

Per-field derivation, all of it from events already on `main`:

| Field | Source |
|---|---|
| `cat` | `cardById(cardId).cat` — the same catalog the board already reads |
| `combo` | `attacked.sudo === true` → Sudo; `released.codeReview` → that card |
| `target.player` | `attacked.target`, `requested.target`, `releaseStolen.to`, `handTransfer.to` |
| `returnCard` | `defended{effect:'return'}` → attacker, resolved through `parent` |
| `redirect` | `defended{effect:'reflect'}` → attacker, resolved through `parent` |
| `system` | `eliminated`, `deckReshuffled`, `gameOver` |
| draw badge | `drawn` carrying a `card` (an open draw; a closed one has none) |

`returnCard` and `redirect` both need the *attacker's name*, which `defended` does not carry — it
carries the defender. It is resolved by walking `parent` to the `attacked` event and reading
`attacker`. When `parent` is missing or names an event this peer never saw (it was filtered by
`visibleTo`), the tail is omitted rather than guessed: a row that says less is correct, a row that
names the wrong player is not.

### 2. Tree assembly

A second pass, after mapping, before ordering:

- index every entry by `id`;
- an entry whose `parent` resolves to a *visible* entry is pushed to that entry's `children`;
- an entry whose `parent` is absent, or points at an event filtered out for this viewer, stays at
  top level.

That second rule is what keeps a partially-visible log readable. `forViewer` can hand a peer a
defence whose attack was secret; re-parenting it to nothing would drop it from the render entirely,
because `MoveHistory` only walks `children` one level from the roots it is given. Orphans are
promoted, not discarded.

`Row` **recurses** — it renders `Row` for each child, always with `nested`
(`MoveHistory.tsx:180`). So structural depth is unbounded and the adapter builds the true tree
without flattening it; what caps at two tiers is the *styling*, since every descendant below the top
level gets the same `nested` treatment. The story's mock only ever goes one level deep, so a deeper
tree is untested visually — if the engine's `parent` chains turn out to run deeper in practice, how
tier three should read is a question for the story, not something to settle in the adapter.

### 3. Ordering

`toBoardState` drops `.reverse()`. Entries read oldest-first, children under their parent, newest at
the bottom — as `apps/ui/src/mocks/table.ts` states outright:

```
// История ходов (сверху — раньше)
```

The panel scrolls to the bottom when entries arrive. `MoveHistory` renders inside `ScrollArea`, so
this is a `scrollTop = scrollHeight` effect keyed on the entry count, and it is skipped when the
player has scrolled up — a log that yanks itself away from someone reading it is worse than one that
does not follow.

`toBoardState.test.ts:100` (`folds the event log into history newest first`) is inverted. It is a
green test being deliberately changed, so it changes in its own commit with the reason in the
message.

### 4. The host keeps the log

`Session` in `network/session/referee.ts` gains `log: Event[]`, appended on every `reduce`. The
referee accumulates nothing today — it reduces, fans out and forgets, which is precisely why no peer
can be told what it missed.

`StoredKeeper` in `shared/lib/persistence.ts` gains `log`, so a host reload restores the match *and*
its history. It sits alongside `state` and `seats` and is held as `unknown` for the same reason they
are: storage does not import engine types.

### 5. Rejoin resends, it does not replay

On `SEAT_REBOUND` the host sends one `SYNC` carrying `forViewer(session.log, playerId)` — the full
visible log rather than the delta. No new message type: `SYNC` is already `{ view, events }`, and
`forViewer` already does the audience filtering, so a rejoining player cannot be handed events they
were never entitled to.

This is a resend, not a replay, and the danger is concrete rather than theoretical. `isOpening`
decides freshness from the **projection**, not the feed — "a reconnect mid-game must drop straight to
the live board" — so mid-match `intro` is null, `_Board.tsx:254` passes `enabled: true`, and every
restored event clears `useBeats`'s watermark of `0`. The whole match would replay itself as
choreography.

The fix is the watermark, **not** `planBeats`. `useBeats` already keeps `seen.current` and plans only
`events.filter((e) => e.id > seen.current)` (`useBeats.ts:593`), and its `!enabled` branch already
demonstrates the exact move required — "nothing here is to be animated, so the watermark keeps pace
with the feed" (`useBeats.ts:583`). Two entry points need that treatment:

- **A reload.** `useGame` restores its feed in a *lazy `useState` initialiser*, so the events and
  their highest id exist on the first render rather than one effect later. `useBeats` takes
  `restoredThrough?: number` and seeds `seen.current` from it. Synchronous restore is what makes this
  possible, and `sessionStorage` is synchronous.
- **A rejoin.** The host's resend arrives over the wire, and those events *are* genuinely new to this
  peer — it was away. They still must not animate, for the reason `isOpening` already states. So the
  resend is marked: `syncMessage` gains a `resync` argument, the flag rides on the `SYNC` payload,
  and `useGame` advances the watermark past a marked batch instead of letting it queue beats.

`planBeats` is untouched. It is a pure fold over events and has no business knowing why a batch
arrived.

### 6. The client merges

`useGame` keeps its `useState<Event[]>` and gains two things: a restore on mount, and a merge on
every sync.

```
merge(a, b) = [...new Map([...a, ...b].map(e => [e.id, e])).values()]
                .sort((x, y) => x.id - y.id)
```

Union by `id`, sorted by `id`. This is correct because the id is the engine's own monotonic sequence
and is identical on every peer — the property `toBoardState.ts:190` already relies on to key the
discard scatter. So the merge is idempotent (a resend changes nothing), order-independent (restore
before or after the sync gives the same result), and unambiguous when the two sides disagree: the
host minted every id, so an id that exists only locally cannot exist.

Storage is `sessionStorage`, keyed `release:log`, through the existing helpers in `persistence.ts` —
same 12h `RESTORE_TTL_MS`, same memory fallback for browsers that throw. Not `localStorage`, for the
reason that module already argues at length: these records describe one peer, `localStorage` is
per-origin, and two tabs of the app are two peers. The record carries its `gameId`; a log whose
`gameId` does not match the current match is dropped rather than shown, which is the persisted form
of the guard `useGame` already runs in memory.

Budget is not a concern: a long match is on the order of 60KB of JSON against a ~5MB quota, and the
keeper snapshot already stores a full `GameState` beside it.

## Data flow

```
engine.reduce ──► events ──► session.log (host, append)
                    │              │
                    │              ├──► StoredKeeper.log ──► host reload
                    │              └──► forViewer(log, id) ──► SYNC{resync:true} on rejoin
                    │
                    └──► SYNC{view, events} ──► useGame
                                                   │
                          sessionStorage ──────────┤ merge by Event.id
                                                   ▼
                                          toBoardState(view, log, labels)
                                                   │
                                    ┌──────────────┴──────────────┐
                                    ▼                             ▼
                              history (tree)                discard heap
                                    ▼
                              MoveHistory
```

The heap falls out for free: `toDiscardHeap` folds the same log, so a persisted log carries the
discard pile across a reload too. That is a consequence worth having, and a thing to check rather
than assume — it is in the tests below.

## Error handling

- **Unparseable stored log** — dropped, as `readJson` already does for every other record. An empty
  history is recoverable; a crash on mount is not.
- **`gameId` mismatch** — dropped. A new match must not inherit the last one's feed.
- **Orphaned `parent`** — promoted to top level (§2), never dropped.
- **Unknown card id** — `cardOrPlaceholder`, as the adapter already does. `toBoardState` is total by
  contract and this must not change it.
- **Missing attacker for a tail** — the tail is omitted (§1).
- **Storage throws** — the in-memory `Map` fallback in `persistence.ts` already covers it; history
  then behaves exactly as it does today.

## Tests

Written first, per `superpowers:test-driven-development`.

**Merge rule** (unit) — union, dedup, gap-fill, sorted output; empty local, empty remote, both empty;
idempotence under a repeated resend; disagreement on a shared id resolving to the host's copy.

**Adapter** (unit) — one case per field in the table above; `combo` for both Sudo and Code Review;
the two `defended` effects resolving their attacker through `parent`; the open-vs-closed `drawn`
distinction; the three system rows; an unknown card id rendering a placeholder rather than throwing.

**Tree** (unit) — children nested under their parent; an orphan promoted; a chain three deep
preserved rather than flattened, since `Row` recurses.

**Ordering** (unit) — oldest-first; `toBoardState.test.ts:100` inverted.

**Exhaustiveness** (typecheck) — the `never` default. Adding a member to the union must fail
`pnpm typecheck`.

**Persistence** (integration) — a reload mid-match restores the feed; a peer that disconnects, misses
events and rejoins ends with a complete log and no duplicates; a resend does not re-trigger beats;
the discard heap survives a reload.

**Regression** — the existing `panel-history` assertions in `boardComponent.test.tsx` keep passing.

## Documentation

- `docs/animations/backlog.md` — the card-target sword, written out: what it would take, and what it
  is blocked on.
- A `> ❓ **Не из правил.**` marker at the paragraph in the rules spec where the card-target reading
  came up, per CLAUDE.md.
- `docs/animations/reference.md` — untouched unless a preset is added. None is planned; the
  scroll-to-bottom is a DOM effect, not a choreography.

## Out of scope

- **The card-target sword** (`DDoS ⚔ Monitoring`). `attacked` carries a target **player** and never a
  card, so the row can only come from folding an attack together with its consequence
  (`monitoringDestroyed`, `releaseDestroyed`). That fold is a rules-adjacent reading, and CLAUDE.md
  forbids inferring it. Card-target rows render without the sword until it is ruled on.
- **`upgradeThrown` / `upgradeTaken`.** They exist only on the unmerged `#108` branch. The `never`
  check makes the merge surface them rather than swallow them; labelling them belongs to whoever
  merges.
- **History for a spectator.** A spectator holds no seat, so `forViewer` has no id to filter on. The
  panel stays empty for them, exactly as the board does today.
- **Cross-tab or cross-device history.** `sessionStorage` is per-tab by design. Closing the tab loses
  the log, and that trade is already argued in `persistence.ts`.
- **Exporting or copying the log.** Not asked for.
