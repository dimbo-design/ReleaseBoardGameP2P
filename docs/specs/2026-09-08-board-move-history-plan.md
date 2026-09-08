# Move History On The Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The history panel renders everything `MoveHistory` can draw — colour, combos, targets, tails, system rows, the nested tree — and the log survives a reload without replaying the match as animation.

**Architecture:** Three seams, touched in order. The adapter (`toHistoryEntry`) becomes an exhaustive `switch` and grows one field group per task. The host grows a `log: Event[]` on `Session`, persists it with the keeper snapshot, and resends the viewer's slice on rejoin. The client restores its own feed synchronously on first render, merges every batch by union on `Event.id`, and seeds `useBeats`'s existing watermark so nothing already reflected in the projection is animated.

**Tech Stack:** TypeScript, React 19, Vite, Vitest + @testing-library/react, CSS Modules + design tokens, pnpm workspaces. No new dependencies.

**Spec:** [docs/specs/2026-09-08-board-move-history-design.md](./2026-09-08-board-move-history-design.md) — read it before Task 1; every task argues from it.

**Issue:** [#136](https://github.com/MythHand/ReleaseBoardGameP2P/issues/136) · **Branch:** `feat/136-move-history` (off `main` at `bda58bd`)

## Global Constraints

- **Comments in English.** Russian comments are legacy; do not add new ones (CLAUDE.md).
- **No string literals in `.tsx`.** User-visible text goes through `t()` or props. `@release/ui` is i18n-agnostic and receives copy as props.
- **No hardcoded colours.** Only `var(--*)` from `apps/ui/src/design/tokens.css`.
- **`toBoardState` is total.** An unknown card id renders a placeholder; it must never throw.
- **`@release/ui` never imports i18next**, and `@release/web` never imports `react-i18next` directly.
- **No guessing on rules.** Anything not derivable from the engine goes to `docs/animations/backlog.md` plus a `> ❓ **Не из правил.**` marker — never into code as an inferred rule.
- **Commit after every task.** Pre-commit hooks run `release-lint` + `stylelint` + `pnpm typecheck`; a commit that fails them is not done.
- **Run tests with:** `pnpm --filter @release/web test <path>` (frontend), `pnpm --filter @release/ui test <path>` (kit).

## File Structure

| File | Responsibility |
|---|---|
| `apps/frontend/src/shared/lib/persistence.ts` | **Modify.** Add the fourth record: `readLog` / `writeLog` / `clearLog`, plus `log` on `StoredKeeper`. |
| `apps/frontend/src/features/play-game/mergeEvents.ts` | **Create.** The merge rule as a pure function. One export, no React. |
| `apps/frontend/src/entities/game/board/toBoardState.ts` | **Modify.** `toHistoryEntry` becomes exhaustive and complete; `buildHistoryTree` added; `.reverse()` removed. |
| `apps/frontend/src/features/play-game/useGame.ts` | **Modify.** Lazy restore, merge on sync, persist, report `restoredThrough`. |
| `apps/frontend/src/features/board-beats/useBeats.ts` | **Modify.** Seed the watermark; skip a resync batch. |
| `apps/frontend/src/network/session/referee.ts` | **Modify.** `Session.log`; `syncMessage` takes `resync`. |
| `apps/frontend/src/network/types.ts` | **Modify.** `SYNC` payload gains optional `resync`. |
| `apps/frontend/src/network/session/link.ts` | **Modify.** `Sync` gains optional `resync`. |
| `apps/ui/src/table/MoveHistory/MoveHistory.tsx` | **Modify.** Follow the tail when entries arrive. |
| `docs/animations/backlog.md` | **Modify.** The card-target sword, written out. |

Tasks 1–2 are leaves with no dependencies. Tasks 3–10 are the adapter, in order (3 restructures, 4–8 add fields into that structure). Tasks 12–14 are the host. Tasks 15–16 are the client and depend on 1, 2 and 14.

---

### Task 1: The log record in persistence

**Files:**
- Modify: `apps/frontend/src/shared/lib/persistence.ts`
- Test: `apps/frontend/src/shared/lib/persistence.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `StoredLog { gameId: string; events: unknown[]; savedAt: number }`, `readLog(gameId: string, now?: number): unknown[] | null`, `writeLog(l: StoredLog): void`, `clearLog(): void`.

`events` is `unknown[]`, not `Event[]`, for the reason the module already gives for `state` and `seats`: storage does not import engine types. The one caller casts, where engine types are already in scope.

- [ ] **Step 1: Write the failing tests**

Append to `apps/frontend/src/shared/lib/persistence.test.ts`:

```ts
import { clearLog, readLog, writeLog } from './persistence'

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @release/web test src/shared/lib/persistence.test.ts`
Expected: FAIL — `readLog`, `writeLog`, `clearLog` are not exported.

- [ ] **Step 3: Implement**

In `apps/frontend/src/shared/lib/persistence.ts`, add `const LOG_KEY = 'release:log'` beside the other three keys, and at the end of the file:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @release/web test src/shared/lib/persistence.test.ts`
Expected: PASS, including the pre-existing localStorage test.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/shared/lib/persistence.ts apps/frontend/src/shared/lib/persistence.test.ts
git commit -m "feat(web): the move feed becomes a record that survives a reload (#136)"
```

---

### Task 2: The merge rule

**Files:**
- Create: `apps/frontend/src/features/play-game/mergeEvents.ts`
- Test: `apps/frontend/src/features/play-game/mergeEvents.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mergeEvents(a: Event[], b: Event[]): Event[]` — union by `Event.id`, ascending. `b` wins a collision.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/features/play-game/mergeEvents.test.ts`:

```ts
import type { Event } from '@release/engine'
import { describe, expect, it } from 'vitest'
import { mergeEvents } from './mergeEvents'

const ev = (id: number, player = 'you'): Event =>
  ({ id, type: 'drawn', player, pile: 0, deckSize: 40 }) as Event

describe('mergeEvents', () => {
  it('unions two disjoint feeds in id order', () => {
    expect(mergeEvents([ev(1), ev(3)], [ev(2)]).map((e) => e.id)).toEqual([1, 2, 3])
  })

  // The whole point of the resend: it is idempotent, so a peer that already has
  // the log is not handed a second copy of it.
  it('is idempotent', () => {
    const feed = [ev(1), ev(2)]
    expect(mergeEvents(feed, feed).map((e) => e.id)).toEqual([1, 2])
  })

  // Restore-then-sync and sync-then-restore must land in the same place, because
  // which arrives first is a race the client does not control.
  it('is order-independent', () => {
    const a = [ev(1), ev(2)]
    const b = [ev(2), ev(3)]
    expect(mergeEvents(a, b)).toEqual(mergeEvents(b, a).slice().sort((x, y) => x.id - y.id))
  })

  // The host minted every id, so where the two disagree the incoming copy is the
  // authoritative one.
  it('lets the incoming copy win a collision', () => {
    const merged = mergeEvents([ev(1, 'stale')], [ev(1, 'fresh')])
    expect(merged).toHaveLength(1)
    expect((merged[0] as { player: string }).player).toBe('fresh')
  })

  it('fills a gap in the middle', () => {
    expect(mergeEvents([ev(1), ev(5)], [ev(2), ev(3), ev(4)]).map((e) => e.id)).toEqual([
      1, 2, 3, 4, 5,
    ])
  })

  it('handles both sides empty', () => {
    expect(mergeEvents([], [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @release/web test src/features/play-game/mergeEvents.test.ts`
Expected: FAIL — cannot resolve `./mergeEvents`.

- [ ] **Step 3: Implement**

Create `apps/frontend/src/features/play-game/mergeEvents.ts`:

```ts
import type { Event } from '@release/engine'

/**
 * Two feeds of the same match, folded into one.
 *
 * The key is `Event.id` — the engine's own monotonic sequence, identical on
 * every peer (the same property `toBoardState` relies on to key the discard
 * scatter). That is what makes this merge idempotent, order-independent, and
 * decidable when the two sides disagree: the host minted every id, so `b` — the
 * copy that came from it — wins.
 */
export function mergeEvents(a: Event[], b: Event[]): Event[] {
  const byId = new Map<number, Event>()
  for (const e of a) byId.set(e.id, e)
  for (const e of b) byId.set(e.id, e)
  return [...byId.values()].sort((x, y) => x.id - y.id)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @release/web test src/features/play-game/mergeEvents.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/play-game/mergeEvents.ts apps/frontend/src/features/play-game/mergeEvents.test.ts
git commit -m "feat(web): two feeds of one match fold together by event id (#136)"
```

---

### Task 3: The adapter becomes exhaustive

Restructure only — no field is added and no test changes. The `never` default is the point: `#108` adds `upgradeThrown` and `upgradeTaken` to the union on an unmerged branch, and without this the merge would compile and render them as unlabelled grey rows.

**Files:**
- Modify: `apps/frontend/src/entities/game/board/toBoardState.ts:137`
- Test: `apps/frontend/src/entities/game/board/toBoardState.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `toHistoryEntry(e: Event, labels: HistoryLabels): HistoryEntry` — same signature as today. Tasks 6 and 7 extend it (`nameOf`, then `byId`); it is left alone here because Biome rejects an unused parameter, so a lookup introduced before it has a reader would fail the commit hook.

- [ ] **Step 1: Write the failing test**

Add to `apps/frontend/src/entities/game/board/toBoardState.test.ts`:

```ts
// Every member of the union must produce a row. The `never` default makes a new
// event type a typecheck failure rather than a silent grey line — which is
// exactly what #108's two upgrade events would otherwise become on merge.
it('produces a row for every event type in the union', () => {
  const every: Event[] = [
    { id: 1, type: 'dealt', player: 'you', count: 5 },
    { id: 2, type: 'drawn', player: 'you', pile: 0, deckSize: 39 },
    { id: 3, type: 'deckReshuffled', cards: 12 },
    { id: 4, type: 'pilesChanged', piles: [10, 10] },
  ] as Event[]
  const history = toBoardState(view, every, labels).history
  expect(history).toHaveLength(4)
  expect(history.every((h) => typeof h.id === 'number')).toBe(true)
})
```

- [ ] **Step 2: Run it to see it pass already, then confirm the real gate**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts`
Expected: PASS (the current flat adapter already returns a row per event). This test guards Tasks 4–8; the actual gate for this task is Step 4's typecheck.

- [ ] **Step 3: Implement the exhaustive switch**

Replace `toHistoryEntry` at `toBoardState.ts:137` with:

```ts
// One row per event. The switch is exhaustive by construction: the `never`
// default means a new member of the engine's Event union fails `pnpm typecheck`
// here rather than rendering as an unlabelled grey line nobody notices.
function toHistoryEntry(e: Event, labels: HistoryLabels): HistoryEntry {
  const base: HistoryEntry = {
    id: e.id,
    who: actorOf(e) ?? '',
    kind: labels[e.type],
    card: cardTextOf(e),
    parent: e.parent,
  }

  switch (e.type) {
    case 'dealt':
    case 'drawn':
    case 'released':
    case 'placed':
    case 'discarded':
    case 'windowOpened':
    case 'windowClosed':
    case 'passed':
    case 'unpassed':
    case 'attacked':
    case 'defended':
    case 'tookHit':
    case 'releaseDestroyed':
    case 'releaseStolen':
    case 'releaseReturned':
    case 'monitoringDestroyed':
    case 'handTransfer':
    case 'requested':
    case 'revealed':
    case 'aiRevealed':
    case 'neutralized':
    case 'eliminated':
    case 'turnStarted':
    case 'turnEnded':
    case 'gameOver':
    case 'rejected':
    case 'takenFromDiscard':
    case 'deckReshuffled':
    case 'pilesChanged':
      return base
    default: {
      const exhaustive: never = e
      return exhaustive
    }
  }
}
```

The call site inside `toBoardState` is unchanged:

```ts
const visible = log.filter((e) => !e.visibleTo || e.visibleTo.includes(view.self.id))
const history = visible.map((e) => toHistoryEntry(e, labels)).reverse()
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts && pnpm typecheck`
Expected: PASS both. Every existing assertion still holds — behaviour is unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/entities/game/board/toBoardState.ts apps/frontend/src/entities/game/board/toBoardState.test.ts
git commit -m "refactor(web): a new event type now fails the typecheck instead of the eye (#136)"
```

---

### Task 4: Category colour

**Files:**
- Modify: `apps/frontend/src/entities/game/board/toBoardState.ts`
- Test: `apps/frontend/src/entities/game/board/toBoardState.test.ts`

**Interfaces:**
- Consumes: `toHistoryEntry(e, labels, byId)` from Task 3.
- Produces: `catOf(id: string | undefined): string | undefined` — a module-local helper returning `cardById(id)?.category`.

`CategoryId` (`release`, `attack`, `defense`, `protection`, `operation`, `support`, `trigger`, `ai`) maps 1:1 onto the `--cat-*` tokens `MoveHistory` reads, so no translation is needed. An **unknown** card must yield `undefined`, not the placeholder's category: `PLACEHOLDER_CARD.category` is `'attack'`, and colouring an unrecognised card red is a lie the row would tell confidently.

- [ ] **Step 1: Write the failing tests**

```ts
it('colours a row by the category of its card', () => {
  const log: Event[] = [{ id: 1, type: 'placed', player: 'you', card: 'attack-bug' }]
  expect(toBoardState(view, log, labels).history[0].cat).toBe('attack')
})

// PLACEHOLDER_CARD.category is 'attack'; using it here would paint every
// unrecognised card red with full confidence. No colour is the honest answer.
it('leaves a row uncoloured when the catalogue does not know the card', () => {
  const log: Event[] = [{ id: 1, type: 'placed', player: 'you', card: 'not-a-card' }]
  expect(toBoardState(view, log, labels).history[0].cat).toBeUndefined()
})

it('leaves a row uncoloured when the event carries no card at all', () => {
  const log: Event[] = [{ id: 1, type: 'passed', player: 'you' }]
  expect(toBoardState(view, log, labels).history[0].cat).toBeUndefined()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts -t "colours a row"`
Expected: FAIL — `cat` is `undefined` where `'attack'` is expected.

- [ ] **Step 3: Implement**

Add beside `cardOrPlaceholder` in `toBoardState.ts`:

```ts
// The row's colour. Deliberately NOT `cardOrPlaceholder(...).category`: the
// placeholder is an 'attack', so an unrecognised card would render confidently
// red. `MoveHistory` treats an absent `cat` as "no accent", which is the honest
// rendering of a card the catalogue cannot name.
const catOf = (id: string | undefined): string | undefined =>
  id ? cardById(id)?.category : undefined
```

Add a `cardIdOf(e)` helper mirroring the shape of the existing `cardTextOf`, returning the raw id rather than the display name:

```ts
// The id behind `cardTextOf`'s name — the same events, unresolved, so the row
// can be coloured by the card's category.
function cardIdOf(e: Event): string | undefined {
  switch (e.type) {
    case 'released':
    case 'placed':
    case 'discarded':
    case 'attacked':
    case 'defended':
    case 'releaseDestroyed':
    case 'releaseStolen':
    case 'releaseReturned':
    case 'monitoringDestroyed':
    case 'requested':
    case 'revealed':
      return e.card
    case 'drawn':
    case 'handTransfer':
      return e.card
    case 'aiRevealed':
      return e.aiCard
    default:
      return undefined
  }
}
```

Then in `toHistoryEntry`, extend `base`:

```ts
  const base: HistoryEntry = {
    id: e.id,
    who: actorOf(e) ?? '',
    kind: labels[e.type],
    card: cardTextOf(e),
    cat: catOf(cardIdOf(e)),
    parent: e.parent,
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/entities/game/board/toBoardState.ts apps/frontend/src/entities/game/board/toBoardState.test.ts
git commit -m "feat(web): the history reads in the colours of its cards (#136)"
```

---

### Task 5: The combo — Sudo and Code Review

**Files:**
- Modify: `apps/frontend/src/entities/game/board/toBoardState.ts`
- Test: `apps/frontend/src/entities/game/board/toBoardState.test.ts`

**Interfaces:**
- Consumes: `catOf` from Task 4.
- Produces: nothing new; fills `HistoryEntry.combo` (`{ card: string; cat: string }`).

Two yellow supports, two different shapes in the engine. `attacked.sudo` is a **boolean**, so the card name must be resolved from the catalogue id `support-sudo`. `released.codeReview` is a **CardId**, so it resolves directly.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows Sudo as the combo on a boosted attack', () => {
  const log: Event[] = [
    { id: 1, type: 'attacked', attacker: 'you', card: 'attack-bug', sudo: true, target: 'p2' },
  ]
  const combo = toBoardState(view, log, labels).history[0].combo
  expect(combo?.card).toBe(cardById('support-sudo')?.name)
  expect(combo?.cat).toBe('support')
})

it('shows no combo on a plain attack', () => {
  const log: Event[] = [
    { id: 1, type: 'attacked', attacker: 'you', card: 'attack-bug', sudo: false, target: 'p2' },
  ]
  expect(toBoardState(view, log, labels).history[0].combo).toBeUndefined()
})

it('shows Code Review as the combo on a release that carried one', () => {
  const log: Event[] = [
    {
      id: 1,
      type: 'released',
      player: 'you',
      slot: 'backend',
      card: 'release-backend',
      codeReview: 'support-code-review',
    },
  ]
  const combo = toBoardState(view, log, labels).history[0].combo
  expect(combo?.card).toBe(cardById('support-code-review')?.name)
  expect(combo?.cat).toBe('support')
})
```

Add `cardById` to the test file's imports from `@release/ui`. The expected names are read from the catalogue rather than written as literals, so the test cannot drift from a renamed card.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts -t "combo"`
Expected: FAIL — `combo` is `undefined`.

- [ ] **Step 3: Implement**

Add above `toHistoryEntry`:

```ts
// The yellow support alongside a card. Two shapes in the engine, one row: an
// attack carries `sudo` as a BOOLEAN (the card is implied, so its name comes
// from the catalogue), a release carries `codeReview` as the card id itself.
const SUDO_ID = 'support-sudo'

function comboOf(e: Event): HistoryEntry['combo'] {
  const id = e.type === 'attacked' && e.sudo ? SUDO_ID : e.type === 'released' ? e.codeReview : undefined
  if (!id) return undefined
  const card = cardById(id)
  if (!card) return undefined
  return { card: card.name, cat: card.category }
}
```

In `toHistoryEntry`, add to `base`: `combo: comboOf(e),`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/entities/game/board/toBoardState.ts apps/frontend/src/entities/game/board/toBoardState.test.ts
git commit -m "feat(web): the support that carried the move stands next to it (#136)"
```

---

### Task 6: The target

**Files:**
- Modify: `apps/frontend/src/entities/game/board/toBoardState.ts`
- Test: `apps/frontend/src/entities/game/board/toBoardState.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: fills `HistoryEntry.target` as `{ player: string }` only.

Only the **player** half. `attacked` carries a target player and never a card, so the card-target sword (`DDoS ⚔ Monitoring`) has no engine source and is out of scope — Task 17 files it. The name must be the seat's display name, so it is resolved through the projection rather than printed as a raw player id.

- [ ] **Step 1: Write the failing tests**

```ts
it('names the player an attack was aimed at', () => {
  const log: Event[] = [
    { id: 1, type: 'attacked', attacker: 'you', card: 'attack-bug', sudo: false, target: 'p2' },
  ]
  // 'bot' is the opponent's NAME in the fixture; 'p2' is its id. Asserting the
  // name proves the projection was consulted rather than the id printed raw.
  expect(toBoardState(view, log, labels).history[0].target?.player).toBe('bot')
})

it('names the player a demand was aimed at', () => {
  const log: Event[] = [
    { id: 1, type: 'requested', attacker: 'you', target: 'p2', card: 'attack-bug', hit: true },
  ]
  expect(toBoardState(view, log, labels).history[0].target?.player).toBe('bot')
})

it('names the player a card was handed to', () => {
  const log: Event[] = [{ id: 1, type: 'handTransfer', from: 'p2', to: 'you', card: 'attack-bug' }]
  expect(toBoardState(view, log, labels).history[0].target?.player).toBe('you')
})

it('leaves an untargeted event without a target', () => {
  const log: Event[] = [{ id: 1, type: 'passed', player: 'you' }]
  expect(toBoardState(view, log, labels).history[0].target).toBeUndefined()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts -t "aimed at"`
Expected: FAIL — `target` is `undefined`.

- [ ] **Step 3: Implement**

Add above `toHistoryEntry`:

```ts
// Who the move was aimed at. The PLAYER half only: `attacked` carries a target
// player and never a card, so the sword pointing at a card has no source in the
// feed (docs/animations/backlog.md). A row that shows less is correct; one that
// invents a card target is not.
function targetIdOf(e: Event): string | undefined {
  switch (e.type) {
    case 'attacked':
    case 'requested':
      return e.target
    case 'releaseStolen':
    case 'handTransfer':
      return e.to
    default:
      return undefined
  }
}
```

`toBoardState` already builds a name lookup for the board; if none is in scope, build one beside `byId` from the projection:

```ts
const nameOf = new Map<string, string>([
  [view.self.id, view.self.name],
  ...view.opponents.map((o) => [o.id, o.name] as const),
])
```

Pass `nameOf` into `toHistoryEntry` as its third parameter — `toHistoryEntry(e, labels, nameOf)` — updating the one call site in `toBoardState`, and in `base`:

```ts
  const targetId = targetIdOf(e)
  // Falls back to the id only when the seat is not in this projection — better a
  // raw id than a silently missing target.
  const target = targetId ? { player: nameOf.get(targetId) ?? targetId } : undefined
```

Add `target,` to `base`. The signature is now `toHistoryEntry(e: Event, labels: HistoryLabels, nameOf: Map<string, string>): HistoryEntry`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/entities/game/board/toBoardState.ts apps/frontend/src/entities/game/board/toBoardState.test.ts
git commit -m "feat(web): a move that was aimed somewhere says where (#136)"
```

---

### Task 7: The tails — Rollback and Works on my Machine

**Files:**
- Modify: `apps/frontend/src/entities/game/board/toBoardState.ts`
- Test: `apps/frontend/src/entities/game/board/toBoardState.test.ts`

**Interfaces:**
- Consumes: the `nameOf` map from Task 6.
- Produces: fills `HistoryEntry.returnCard` and `HistoryEntry.redirect`; adds `byId` as `toHistoryEntry`'s fourth parameter — `toHistoryEntry(e: Event, labels: HistoryLabels, nameOf: Map<string, string>, byId: Map<number, Event>): HistoryEntry`.

Both name the **attacker**, which `defended` does not carry — it carries the defender. Resolved by walking `parent` to the `attacked` event. When `parent` is missing, or points at an event this viewer never saw (filtered by `visibleTo`), the tail is **omitted**: a row that says less is correct, one that names the wrong player is not.

- [ ] **Step 1: Write the failing tests**

```ts
it('names the attacker a returned card went back to', () => {
  const log: Event[] = [
    { id: 1, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'you' },
    { id: 2, type: 'defended', player: 'you', card: 'defense-rollback', effect: 'return', parent: 1 },
  ]
  expect(toBoardState(view, log, labels).history[1].returnCard).toBe('bot')
})

it('names the attacker a reflected effect bounced into', () => {
  const log: Event[] = [
    { id: 1, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'you' },
    {
      id: 2,
      type: 'defended',
      player: 'you',
      card: 'defense-works-on-my-machine',
      effect: 'reflect',
      parent: 1,
    },
  ]
  expect(toBoardState(view, log, labels).history[1].redirect).toBe('bot')
})

it('shows no tail for a plain cancel', () => {
  const log: Event[] = [
    { id: 1, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'you' },
    { id: 2, type: 'defended', player: 'you', card: 'defense-not-a-bug', effect: 'cancel', parent: 1 },
  ]
  const row = toBoardState(view, log, labels).history[1]
  expect(row.returnCard).toBeUndefined()
  expect(row.redirect).toBeUndefined()
})

// forViewer can hand a peer a defence whose attack was secret. Naming the wrong
// player is worse than naming none.
it('omits the tail when the attack it answered is not visible to this player', () => {
  const log: Event[] = [
    {
      id: 1,
      type: 'attacked',
      attacker: 'p2',
      card: 'attack-bug',
      sudo: false,
      target: 'you',
      visibleTo: ['p2'],
    },
    { id: 2, type: 'defended', player: 'you', card: 'defense-rollback', effect: 'return', parent: 1 },
  ]
  expect(toBoardState(view, log, labels).history[0].returnCard).toBeUndefined()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts -t "attacker"`
Expected: FAIL — `returnCard` / `redirect` are `undefined`.

- [ ] **Step 3: Implement**

Add above `toHistoryEntry`:

```ts
// Rollback sends the attacking card back to its owner's hand; Works on my
// Machine bounces the effect into the attacker. Both name the ATTACKER, and
// `defended` carries the DEFENDER — so the name is walked up through `parent`.
//
// Omitted rather than guessed when the parent is absent or was filtered out for
// this viewer: `forViewer` can legitimately hand a peer a defence whose attack
// was secret, and a tail naming the wrong player is worse than no tail.
function attackerOf(
  e: Event,
  byId: Map<number, Event>,
  nameOf: Map<string, string>,
): string | undefined {
  if (e.parent === undefined) return undefined
  const parent = byId.get(e.parent)
  if (!parent || parent.type !== 'attacked') return undefined
  return nameOf.get(parent.attacker) ?? parent.attacker
}
```

Build the index in `toBoardState` beside `nameOf`, and pass it as the fourth argument:

```ts
// The visible log by id. Only what THIS viewer can see: a tail resolved through
// an event `forViewer` filtered out would name a player the reader was never
// shown.
const byId = new Map(visible.map((e) => [e.id, e]))
```

In `toHistoryEntry`, after `base` is built:

```ts
  if (e.type === 'defended') {
    const attacker = attackerOf(e, byId, nameOf)
    if (attacker && e.effect === 'return') base.returnCard = attacker
    if (attacker && e.effect === 'reflect') base.redirect = attacker
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/entities/game/board/toBoardState.ts apps/frontend/src/entities/game/board/toBoardState.test.ts
git commit -m "feat(web): what came back, and who it came back to (#136)"
```

---

### Task 8: System rows and the draw badge

**Files:**
- Modify: `apps/frontend/src/entities/game/board/toBoardState.ts`
- Test: `apps/frontend/src/entities/game/board/toBoardState.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: fills `HistoryEntry.system`.

`MoveHistory` renders a system row grey and without an accent, and takes the `DRAW` badge from `kind === 'добор'` **or** a caller-set flag. The badge condition is already expressible: `drawn` carrying a `card` is an **open** draw (public by the rules); a closed draw carries none. The component keys the badge off `e.kind === 'добор'`, a Russian literal from the mock era — so the adapter must not rely on it. Set `system` explicitly, and let the badge follow from `card` being present on a `drawn` row, which the component already checks via `isDraw && e.card`.

Because the component's `isDraw` test is a hardcoded Russian literal that the frontend's translated `kind` will never match, this task also replaces that check with a `HistoryEntry.draw?: boolean` flag the adapter sets — an i18n-agnostic contract, which is what `@release/ui` requires.

- [ ] **Step 1: Write the failing tests**

Frontend (`toBoardState.test.ts`):

```ts
it('marks elimination, reshuffle and game over as system rows', () => {
  const log: Event[] = [
    { id: 1, type: 'eliminated', player: 'p2' },
    { id: 2, type: 'deckReshuffled', cards: 12 },
    { id: 3, type: 'gameOver', winner: 'you', condition: 'release' },
  ] as Event[]
  expect(toBoardState(view, log, labels).history.map((h) => h.system)).toEqual([true, true, true])
})

it('does not mark an ordinary move as a system row', () => {
  const log: Event[] = [{ id: 1, type: 'placed', player: 'you', card: 'attack-bug' }]
  expect(toBoardState(view, log, labels).history[0].system).toBeFalsy()
})

it('badges an open draw and leaves a closed one unbadged', () => {
  const log: Event[] = [
    { id: 1, type: 'drawn', player: 'you', card: 'attack-bug', pile: 0, deckSize: 39 },
    { id: 2, type: 'drawn', player: 'you', pile: 0, deckSize: 38 },
  ] as Event[]
  const history = toBoardState(view, log, labels).history
  expect(history[0].draw).toBe(true)
  expect(history[1].draw).toBeFalsy()
})
```

Kit (`apps/ui/src/table/MoveHistory/MoveHistory.test.tsx`, create if absent):

```tsx
import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import MoveHistory from './MoveHistory'

const copy = { draw: 'draw', eliminated: 'is out' }

// The badge used to key off `kind === 'добор'` — a Russian literal from the
// mock era, which a translated `kind` can never match. The kit is
// i18n-agnostic, so the flag is the contract.
it('badges a row the caller marked as a draw, whatever its kind reads', () => {
  const { getByText } = render(
    <MoveHistory copy={copy} entries={[{ id: 1, who: 'you', kind: 'Draw', card: 'Bug', draw: true }]} />,
  )
  expect(getByText('draw')).toBeTruthy()
})
```

- [ ] **Step 2: Run both to verify they fail**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts -t "system row"`
Run: `pnpm --filter @release/ui test src/table/MoveHistory/MoveHistory.test.tsx`
Expected: FAIL both — `system` and `draw` are not set, and `HistoryEntry` has no `draw`.

- [ ] **Step 3: Implement**

In `apps/ui/src/table/MoveHistory/MoveHistory.tsx`, add to `HistoryEntry`:

```ts
  // An open draw — the card was revealed as it was taken. Set by the caller: the
  // kit cannot read it off `kind`, which is translated copy.
  draw?: boolean
```

and change the `isDraw` line from the `kind` literal to:

```ts
  const isDraw = e.draw === true || e.kind === 'добор'
```

In `toBoardState.ts`, add to `base`:

```ts
    // The table did it, not a seat: nothing to accent, nothing to colour.
    system: e.type === 'eliminated' || e.type === 'deckReshuffled' || e.type === 'gameOver',
    // An open draw. A closed one carries no card, and stays a plain row.
    draw: e.type === 'drawn' && e.card !== undefined,
```

- [ ] **Step 4: Run both to verify they pass**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts && pnpm --filter @release/ui test src/table/MoveHistory/`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/entities/game/board/toBoardState.ts apps/frontend/src/entities/game/board/toBoardState.test.ts apps/ui/src/table/MoveHistory/
git commit -m "feat: the table's own lines, and the draw that was shown (#136)"
```

---

### Task 9: The tree

**Files:**
- Modify: `apps/frontend/src/entities/game/board/toBoardState.ts`
- Test: `apps/frontend/src/entities/game/board/toBoardState.test.ts`

**Interfaces:**
- Consumes: rows from Tasks 3–8.
- Produces: `buildHistoryTree(entries: HistoryEntry[]): HistoryEntry[]` — roots only, each carrying `children`.

`Row` **recurses** (`MoveHistory.tsx:180`), so depth is preserved rather than flattened; what caps at two tiers is the styling. An entry whose `parent` is absent, or names an entry not in this viewer's visible set, stays at top level — promoted, never dropped, because `MoveHistory` only walks down from the roots it is given.

- [ ] **Step 1: Write the failing tests**

```ts
it('nests an answer under the move it answered', () => {
  const log: Event[] = [
    { id: 1, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'you' },
    { id: 2, type: 'defended', player: 'you', card: 'defense-not-a-bug', effect: 'cancel', parent: 1 },
  ]
  const history = toBoardState(view, log, labels).history
  expect(history).toHaveLength(1)
  expect(history[0].children?.map((c) => c.id)).toEqual([2])
})

// Row renders Row, so a chain is preserved rather than flattened.
it('preserves a chain three deep', () => {
  const log: Event[] = [
    { id: 1, type: 'attacked', attacker: 'p2', card: 'attack-bug', sudo: false, target: 'you' },
    { id: 2, type: 'defended', player: 'you', card: 'defense-not-a-bug', effect: 'cancel', parent: 1 },
    { id: 3, type: 'discarded', player: 'you', card: 'attack-bug', reason: 'effect', parent: 2 },
  ] as Event[]
  const history = toBoardState(view, log, labels).history
  expect(history).toHaveLength(1)
  expect(history[0].children?.[0].children?.map((c) => c.id)).toEqual([3])
})

// An orphan is promoted, never dropped: MoveHistory walks only downward from
// the roots it is handed, so a re-parented-to-nothing row would vanish.
it('promotes a row whose parent this player never saw', () => {
  const log: Event[] = [
    {
      id: 1,
      type: 'attacked',
      attacker: 'p2',
      card: 'attack-bug',
      sudo: false,
      target: 'you',
      visibleTo: ['p2'],
    },
    { id: 2, type: 'defended', player: 'you', card: 'defense-not-a-bug', effect: 'cancel', parent: 1 },
  ]
  const history = toBoardState(view, log, labels).history
  expect(history).toHaveLength(1)
  expect(history[0].id).toBe(2)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts -t "nests an answer"`
Expected: FAIL — history has 2 flat entries, not 1 with a child.

- [ ] **Step 3: Implement**

Add above `toBoardState`:

```ts
/**
 * The flat rows become the tree `MoveHistory` renders. `parent` is the engine's
 * own — "a defence names the attack it answered ... so the history tree needs no
 * inference" (packages/engine/src/events.ts) — so this assembles, it does not
 * infer.
 *
 * An entry whose parent is absent, or names an entry filtered out for this
 * viewer, stays at top level. `MoveHistory` walks only downward from the roots
 * it is handed, so an orphan re-parented to nothing would not render at all —
 * promotion is what keeps a partially-visible log complete.
 */
export function buildHistoryTree(entries: HistoryEntry[]): HistoryEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const roots: HistoryEntry[] = []
  for (const entry of entries) {
    const parent = entry.parent !== undefined ? byId.get(entry.parent) : undefined
    if (!parent) {
      roots.push(entry)
      continue
    }
    parent.children = [...(parent.children ?? []), entry]
  }
  return roots
}
```

In `toBoardState`, wrap the mapping:

```ts
const history = buildHistoryTree(visible.map((e) => toHistoryEntry(e, labels, nameOf, byId)))
```

Note the `.reverse()` is dropped here; Task 10 pins the ordering it leaves behind.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @release/web test src/entities/game/board/toBoardState.test.ts`
Expected: the three new tests PASS. `folds the event log into history newest first` now FAILS — that is Task 10, and it is expected. Do not fix it here.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/entities/game/board/toBoardState.ts apps/frontend/src/entities/game/board/toBoardState.test.ts
git commit -m "feat(web): the answers sit under the move they answered (#136)"
```

---

### Task 10: Oldest-first

A green test is being deliberately inverted, so it changes on its own, with the reason in the message.

**Files:**
- Modify: `apps/frontend/src/entities/game/board/toBoardState.test.ts:100`

**Interfaces:**
- Consumes: `buildHistoryTree` from Task 9.
- Produces: nothing.

- [ ] **Step 1: Invert the pinned assertion**

Replace the test at `toBoardState.test.ts:100`:

```ts
  // Oldest first, newest at the bottom — the order the approved story reads in
  // (`apps/ui/src/mocks/table.ts`: "История ходов (сверху — раньше)"), and the
  // only order in which a child can sit under the parent it answers.
  it('folds the event log into history oldest first', () => {
    const log: Event[] = [
      { id: 1, type: 'drawn', player: 'you', pile: 0, deckSize: 39 },
      { id: 2, type: 'placed', player: 'p2', card: 'attack-bug' },
    ]
    const history = toBoardState(view, log, labels).history
    expect(history.length).toBe(2)
    expect(history[0].kind).toBe(labels.drawn)
    expect(history[1].kind).toBe(labels.placed)
  })
```

- [ ] **Step 2: Run the full adapter suite**

Run: `pnpm --filter @release/web test src/entities/game/board/`
Expected: PASS, all of it.

- [ ] **Step 3: Run the whole frontend suite to catch anything reading history order**

Run: `pnpm --filter @release/web test`
Expected: PASS. If a board test asserts a history row by index, update it to the new order and say so in the commit.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/entities/game/board/toBoardState.test.ts
git commit -m "test(web): the log reads oldest first, as the story does (#136)"
```

---

### Task 11: The panel follows the tail

**Files:**
- Modify: `apps/ui/src/table/MoveHistory/MoveHistory.tsx`
- Test: `apps/ui/src/table/MoveHistory/MoveHistory.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

Newest at the bottom means new entries land off-screen. The panel scrolls to the bottom when the count grows — **unless** the reader has scrolled up, because a log that yanks itself away from someone reading it is worse than one that does not follow.

`ScrollArea` does **not** forward a DOM ref or spread unknown props. It exposes `ref?: Ref<ScrollAreaHandle>` where `ScrollAreaHandle` is `{ viewport: () => HTMLElement | null }` — the real scrolling element belongs to overlayscrollbars, not to a div in this file. So the decision is extracted as a pure function and tested directly; the component only has to hand it the viewport. That also keeps the test off overlayscrollbars' jsdom behaviour, which is not something this feature should be pinned to.

- [ ] **Step 1: Write the failing test**

```ts
import { FOLLOW_SLACK, followTail } from './followTail'

const el = (over: Partial<{ scrollTop: number; scrollHeight: number; clientHeight: number }>) =>
  ({ scrollTop: 0, scrollHeight: 500, clientHeight: 100, ...over }) as HTMLElement

it('jumps to the bottom when the reader is already at the tail', () => {
  const node = el({ scrollTop: 400 })
  followTail(node)
  expect(node.scrollTop).toBe(500)
})

// A reader who has scrolled up is reading. A panel that yanks itself away from
// them is worse than one that does not follow at all.
it('leaves a reader who has scrolled up exactly where they are', () => {
  const node = el({ scrollTop: 20 })
  followTail(node)
  expect(node.scrollTop).toBe(20)
})

it('treats a near-miss within the slack as the tail', () => {
  const node = el({ scrollTop: 400 - (FOLLOW_SLACK - 1) })
  followTail(node)
  expect(node.scrollTop).toBe(500)
})

it('does nothing when there is nothing to scroll', () => {
  const node = el({ scrollHeight: 100, clientHeight: 100 })
  followTail(node)
  expect(node.scrollTop).toBe(100)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @release/ui test src/table/MoveHistory/`
Expected: FAIL — cannot resolve `./followTail`.

- [ ] **Step 3: Implement**

Create `apps/ui/src/table/MoveHistory/followTail.ts`:

```ts
// How far from the bottom still counts as "at the tail" — about two rows, so a
// fractional scroll position or a part-rendered row does not stop the follow.
export const FOLLOW_SLACK = 48

/**
 * Keep the newest entry in view. The log reads oldest-first, so an arriving
 * entry lands below the fold — but only a reader who is already at the bottom
 * wants to be carried along. One scrolled up is reading, and moving the page
 * under them is worse than letting the new row wait.
 */
export function followTail(el: HTMLElement, slack: number = FOLLOW_SLACK): void {
  if (el.scrollHeight - el.scrollTop - el.clientHeight < slack) el.scrollTop = el.scrollHeight
}
```

In `MoveHistory.tsx`, take the handle and call it when the count changes:

```tsx
import { type Ref, useLayoutEffect, useRef } from 'react'
import ScrollArea, { type ScrollAreaHandle } from '@/primitives/ScrollArea'
import { followTail } from './followTail'

export default function MoveHistory({ entries = [], copy }: MoveHistoryProps) {
  const area = useRef<ScrollAreaHandle>(null)

  // The scrolling element is overlayscrollbars' own viewport, not a div in this
  // file — `ScrollAreaHandle.viewport()` is the only way to reach it.
  useLayoutEffect(() => {
    const viewport = area.current?.viewport()
    if (viewport) followTail(viewport)
  }, [])

  return (
    <div className={styles.box}>
      <ScrollArea ref={area} className={styles.list} contentClassName={styles.listFlow}>
```

The effect must re-run when a row arrives: add `entries.length` to its dependency array. `ScrollAreaHandle` is already exported from `@/primitives/ScrollArea`'s barrel (`export type { ScrollAreaHandle } from './ScrollArea'`), so no change is needed there.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @release/ui test src/table/MoveHistory/`
Expected: PASS, including Task 8's badge test.

- [ ] **Step 5: Verify in the playground**

Open `/playground/table`, add entries, confirm the panel follows the tail and stops following once scrolled up.

- [ ] **Step 6: Commit**

```bash
git add apps/ui/src/table/MoveHistory/
git commit -m "feat(ui): the log follows its own tail, unless you are reading it (#136)"
```

---

### Task 12: The host keeps the log

**Files:**
- Modify: `apps/frontend/src/network/session/referee.ts:14`
- Test: `apps/frontend/src/network/session/referee.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Session.log: Event[]` — every event the engine has emitted this match, in id order.

The referee reduces, fans out and forgets, which is exactly why no peer can be told what it missed.

- [ ] **Step 1: Write the failing test**

```ts
import { createFakeEngine, FAKE_DECK, FAKE_EVENTS } from '@release/engine/fake'
// NOTE: `applyIntent` and `rebind` take a Session, not a SessionRef.
import { applyIntent, createSession } from './referee'

function seated() {
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
  return session
}

// The referee used to reduce, fan out and forget. That is exactly why a peer
// which missed a batch could never afterwards be told what was in it.
it('accumulates every event it has reduced', () => {
  const start = seated()
  const { session } = applyIntent(start, 'host', { type: 'DRAW', pile: 0 })
  expect(session.log.length).toBeGreaterThan(start.log.length)
})

it('keeps the log in id order', () => {
  const { session } = applyIntent(seated(), 'host', { type: 'DRAW', pile: 0 })
  const ids = session.log.map((e) => e.id)
  expect(ids).toEqual([...ids].sort((a, b) => a - b))
})

// The deal itself is in the log from the start: it is the first thing the
// engine emitted, and a peer restoring the match needs it to draw its own hand.
it('has the opening deal in it before anyone has acted', () => {
  expect(seated().log.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @release/web test src/network/session/referee.test.ts -t "accumulates"`
Expected: FAIL — `Property 'log' does not exist on type 'Session'`.

- [ ] **Step 3: Implement**

Add to `Session` at `referee.ts:14`:

```ts
export interface Session {
  gameId: string
  keeperId: PlayerId
  engine: Engine
  state: GameState
  seats: Seat[]
  // Every event this match has emitted, in id order. The referee used to
  // reduce, fan out and forget — which is precisely why a peer that missed a
  // batch could never be told what was in it.
  log: Event[]
}
```

Initialise it to `[]` in the session factory. Then, at **every** place that builds a next session from a `reduce` result, append: search `referee.ts` for `session.engine.reduce(` and `next.engine.reduce(` — there are several (`applyIntent`, the clock tick, the absent-seat driver, the window expiry, the multi-step draw path) — and each must carry `log: [...session.log, ...events]` into the session it returns. The multi-step path accumulates `events` across sub-steps before fanning out; append the same accumulated array it passes to `syncAll`, so the log and the wire never disagree.

- [ ] **Step 4: Run the session suite**

Run: `pnpm --filter @release/web test src/network/session/`
Expected: PASS. If a test constructs a `Session` literal, add `log: []` to it.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/network/session/
git commit -m "feat(web): the keeper remembers what it has already told everyone (#136)"
```

---

### Task 13: The log survives a host reload

**Files:**
- Modify: `apps/frontend/src/shared/lib/persistence.ts` (`StoredKeeper`)
- Modify: the keeper write and restore sites (`referee.ts` writes it; `restore.ts` / `useLobby.ts` read it — follow `readKeeper` to its callers)
- Test: `apps/frontend/src/network/session/restore.test.ts`

**Interfaces:**
- Consumes: `Session.log` from Task 12.
- Produces: `StoredKeeper.log: unknown[]`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @release/web test src/shared/lib/persistence.test.ts -t "restores the match log"`
Expected: FAIL — `log` is not a property of `StoredKeeper`.

- [ ] **Step 3: Implement**

Add to `StoredKeeper` in `persistence.ts`, beside `state` and `seats` and held as `unknown[]` for the same reason:

```ts
  // The match's own event log, so a host reload restores the history as well as
  // the position. `unknown[]` for the same reason `state` is `unknown`: storage
  // does not import engine types.
  log: unknown[]
```

Then find every `writeKeeper({` call and pass `log: session.log`; find every restore that rebuilds a `Session` from `readKeeper()` and pass `log: (stored.log ?? []) as Event[]`. The `?? []` matters: a record written by a previous version has no `log`, and a restore that reads `undefined` there would put a non-array into `Session.log` and crash the first spread.

- [ ] **Step 4: Run the suites**

Run: `pnpm --filter @release/web test src/shared/lib/ src/network/session/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/shared/lib/persistence.ts apps/frontend/src/shared/lib/persistence.test.ts apps/frontend/src/network/
git commit -m "feat(web): a host that reloads brings the match log back with it (#136)"
```

---

### Task 14: The rejoin resend

**Files:**
- Modify: `apps/frontend/src/network/types.ts:105`
- Modify: `apps/frontend/src/network/session/link.ts:13`
- Modify: `apps/frontend/src/network/session/referee.ts:39` (`syncMessage`) and the `rebind` path
- Test: `apps/frontend/src/network/session/rejoin.test.ts`

**Interfaces:**
- Consumes: `Session.log` from Task 12.
- Produces: `syncMessage(session, playerId, events, resync?: boolean): Message`; `SYNC` payload gains `resync?: boolean`; `Sync` interface gains `resync?: boolean`.

A rejoining peer gets the full visible log, marked. `forViewer` already filters the audience, so this cannot leak an event the seat was never entitled to.

- [ ] **Step 1: Write the failing test**

Add to `rejoin.test.ts`, using the `liveSession()` helper already at the top of that file:

```ts
import { forViewer } from './audience'
import { applyIntent, rebind } from './referee'

it('hands a rejoining seat the whole log it is entitled to, marked as a resend', () => {
  const { ref } = liveSession()
  ref.current = applyIntent(ref.current, 'host', { type: 'DRAW', pile: 0 }).session
  // rebind(session, playerId, peerId, now) — a Session, and it needs a clock.
  const { outgoing } = rebind(ref.current, 'p2', 'guest-returned', 1_000)
  const sync = outgoing.find((o) => o.message.type === 'SYNC')
  expect(sync?.message.payload).toMatchObject({ resync: true })
  // Exactly the seat's own slice — forViewer does the filtering, so a resend
  // cannot hand a peer an event it was never entitled to.
  expect(sync?.message.payload.events.map((e: Event) => e.id)).toEqual(
    forViewer(ref.current.log, 'p2').map((e) => e.id),
  )
})

it('does not mark an ordinary sync as a resend', () => {
  const { ref } = liveSession()
  const { outgoing } = applyIntent(ref.current, 'host', { type: 'DRAW', pile: 0 })
  const sync = outgoing.find((o) => o.message.type === 'SYNC')
  expect(sync?.message.payload.resync).toBeFalsy()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @release/web test src/network/session/rejoin.test.ts`
Expected: FAIL — `resync` is not on the payload.

- [ ] **Step 3: Implement**

`types.ts:105`:

```ts
  // `resync` marks a REPLAY of what this seat already ought to know — the full
  // visible log, handed to a peer that rejoined. It is folded into history and
  // the discard heap, and it is NOT animated: a reconnect drops straight to the
  // live board, exactly as `isOpening` already says it must.
  | { type: 'SYNC'; payload: { view: PlayerView; events: Event[]; resync?: boolean } }
```

`link.ts:13`:

```ts
export interface Sync {
  view: PlayerView
  events: Event[]
  resync?: boolean
}
```

`referee.ts:39`:

```ts
export function syncMessage(
  session: Session,
  playerId: PlayerId,
  events: Event[],
  resync = false,
): Message {
  return {
    type: 'SYNC',
    payload: {
      view: session.engine.project(session.state, playerId),
      events: forViewer(events, playerId),
      ...(resync ? { resync: true } : {}),
    },
  }
}
```

In `rebind` (`referee.ts:136`), send the rejoining seat `syncMessage(session, playerId, session.log, true)` instead of a projection with an empty feed. Leave `syncAll` alone: it fans out ordinary deltas and must stay unmarked.

- [ ] **Step 4: Run the session suite**

Run: `pnpm --filter @release/web test src/network/session/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/network/
git commit -m "feat(web): a seat that comes back is told everything it missed (#136)"
```

---

### Task 15: The client restores and merges

**Files:**
- Modify: `apps/frontend/src/features/play-game/useGame.ts`
- Test: `apps/frontend/src/features/play-game/useGame.test.tsx`

**Interfaces:**
- Consumes: `readLog` / `writeLog` / `clearLog` (Task 1), `mergeEvents` (Task 2), `Sync.resync` (Task 14).
- Produces: `Game.restoredThrough: number` — the highest event id this peer already had before any beat could be planned. `0` when nothing was restored.

The restore is a **lazy `useState` initialiser**, not an effect. That is load-bearing: `_Board` arms its beats in a *layout* effect, so a feed restored one passive effect later would be seen as empty first and as fifty new events immediately after — which is the whole match, planned as choreography. `sessionStorage` is synchronous, so the feed can exist on the first render.

- [ ] **Step 1: Write the failing tests**

```tsx
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
  session = { gameLink: null, gameSync: { view: view(), events: [dealt('p1'), drawn('p1')] }, gameId: 'g1' }
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
```

Add `beforeEach(() => sessionStorage.clear())` to the file, and import `readLog` / `writeLog` from `~/shared/lib/persistence`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @release/web test src/features/play-game/useGame.test.tsx`
Expected: FAIL — no restore, `restoredThrough` is not a property of `Game`.

- [ ] **Step 3: Implement**

In `useGame.ts`, add `restoredThrough: number` to the `Game` interface, then:

```ts
  // Restored in a LAZY INITIALISER, not an effect, and that is load-bearing.
  // The board arms its beats in a layout effect; a feed restored one passive
  // effect later would be read as empty on the commit that first carried a
  // projection, and then as fifty new events on the next — the whole match,
  // planned as choreography. sessionStorage is synchronous, so the feed can
  // simply exist on the first render.
  const [events, setEvents] = useState<Event[]>(
    () => (gameId ? ((readLog(gameId) ?? []) as Event[]) : []),
  )

  // The high-water mark the beat queue starts from: everything restored is
  // already reflected in the projection the board is about to render, so none
  // of it is a movement anybody should watch.
  const restoredThrough = useRef(events.at(-1)?.id ?? 0)
```

In the `gameId` change effect, clear storage too:

```ts
    if (seenGame.current !== gameId) {
      seenGame.current = gameId
      seenSync.current = null
      clearLog()
      restoredThrough.current = 0
      setEvents([])
    }
```

In the sync effect, merge rather than concatenate, and advance the mark for a resend:

```ts
  useEffect(() => {
    if (!sync || sync === seenSync.current) return
    seenSync.current = sync
    if (sync.events.length === 0) return
    // A resend is what this peer already ought to know. It belongs in the feed
    // and in the heap, and it belongs nowhere near the beat queue.
    if (sync.resync) restoredThrough.current = sync.events.at(-1)?.id ?? restoredThrough.current
    setEvents((prev) => mergeEvents(prev, sync.events))
  }, [sync])
```

And persist on change:

```ts
  useEffect(() => {
    if (!gameId || events.length === 0) return
    writeLog({ gameId, events, savedAt: Date.now() })
  }, [gameId, events])
```

Keep the existing `pending` / `carried` logic, but fold `pending` through `mergeEvents` rather than spreading, so a resend arriving on the very first commit cannot duplicate the restored feed:

```ts
    events: pending.length > 0 ? mergeEvents(carried, pending) : carried,
    restoredThrough: restoredThrough.current,
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @release/web test src/features/play-game/`
Expected: PASS, including the pre-existing layout-effect test that guards the deal intro.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/play-game/
git commit -m "feat(web): the feed is there before the first frame asks for it (#136)"
```

---

### Task 16: The beats skip what was already seen

**Files:**
- Modify: `apps/frontend/src/features/board-beats/useBeats.ts:583`
- Modify: `apps/frontend/src/pages/board/[gameId]/_Board.tsx:250`, `apps/frontend/src/pages/board/[gameId]/index.tsx`
- Test: `apps/frontend/src/features/board-beats/useBeats.test.tsx`

**Interfaces:**
- Consumes: `Game.restoredThrough` from Task 15.
- Produces: `useBeats` accepts `restoredThrough?: number`.

Without this the reload path animates the whole match: `isOpening` reads the **projection**, so mid-match `intro` is null and `_Board.tsx:254` passes `enabled: true`, leaving `seen.current` at `0` against a restored feed of fifty events.

- [ ] **Step 1: Write the failing test**

First add `restoredThrough?: number` to the existing `Probe` component at `useBeats.test.tsx:150` and thread it into its `useBeats({ ... })` call. Then, using that file's own `planned.calls` mock and `flush()` helper:

```tsx
// The reload case. `isOpening` reads the PROJECTION, so mid-match `intro` is
// null and beats are ENABLED from the first frame — without the mark, the whole
// restored feed is "fresh" and the match replays itself as choreography.
it('animates nothing that was already in the feed when the board mounted', async () => {
  motion.reduced = false
  planned.calls = []
  render(
    <Probe
      live={afterDiscard}
      events={[discardEvent]}
      anchors={stub}
      restoredThrough={discardEvent.id}
    />,
  )
  await flush()
  expect(planned.calls).toEqual([])
})

it('still animates what arrives after the restored mark', async () => {
  motion.reduced = false
  planned.calls = []
  const later = { ...discardEvent, id: discardEvent.id + 1 } as Event
  const { rerender } = render(
    <Probe
      live={preDiscard}
      events={[]}
      anchors={stub}
      restoredThrough={discardEvent.id}
    />,
  )
  rerender(
    <Probe
      live={afterDiscard}
      events={[later]}
      anchors={stub}
      restoredThrough={discardEvent.id}
    />,
  )
  await flush()
  expect(planned.calls.at(-1)?.[0]).toEqual([later])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @release/web test src/features/board-beats/useBeats.test.tsx -t "already in the feed"`
Expected: FAIL — every restored event is planned.

- [ ] **Step 3: Implement**

In `useBeats.ts`, add `restoredThrough?: number` to the args interface, and initialise the watermark from it:

```ts
  // Everything at or below this id was already reflected in the projection this
  // board first rendered — a restore, or a resend to a seat that rejoined. The
  // `!enabled` branch below does the same thing for the opening; this does it
  // for a board that arrives mid-match, where `isOpening` is false and beats are
  // therefore ENABLED from the first frame.
  const seen = useRef(restoredThrough ?? 0)
```

`useRef` initialises once, which is exactly right: `restoredThrough` is a first-render fact and must not move the watermark backwards later.

In `_Board.tsx`, thread it through to `useBeats`; in `index.tsx`, pass `game.restoredThrough` into `Board`. Follow the existing prop path for `events` — the same route, one value alongside it.

- [ ] **Step 4: Run the suites**

Run: `pnpm --filter @release/web test src/features/board-beats/ src/pages/board/`
Expected: PASS.

- [ ] **Step 5: Verify by hand — this is the task's real gate**

Run `pnpm dev:p2p`, start a two-peer match, play several moves, then reload one peer. Confirm: the history panel is populated, the discard heap is intact, and **no cards fly**. Then drop a peer's connection, play two moves, and let it rejoin: the log completes and nothing animates.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/features/board-beats/ "apps/frontend/src/pages/board/[gameId]/"
git commit -m "feat(web): a reload arrives at the table, it does not replay the match (#136)"
```

---

### Task 17: The finding that is not a guess

**Files:**
- Modify: `docs/animations/backlog.md`
- Modify: the rules spec paragraph where the card-target reading arises (`docs/rules/`)
- Modify: `apps/playground/stories/AnimationAuditStory/AnimationAuditStory.tsx` (findings register)

**Interfaces:** none.

The sword pointing at a card. `attacked` carries a target **player** and never a card, so `DDoS ⚔ Monitoring` can only come from folding an attack together with its consequence (`monitoringDestroyed`, `releaseDestroyed`). CLAUDE.md forbids inferring it, and forbids working around it quietly.

- [ ] **Step 1: Write the backlog entry**

Append to `docs/animations/backlog.md`, in the register's own format:

```markdown
## История: меч, направленный в карту

`MoveHistory` рисует цель двух видов — игрока и карту (`DDoS ⚔ Monitoring` в
истории на `/playground/table`). Из фида выводится только первая: `attacked`
несёт `target: PlayerId` и никогда не карту.

Строка с картой-целью собирается лишь склейкой атаки с её последствием
(`monitoringDestroyed`, `releaseDestroyed`) в одну строку. Это чтение правил, а
не следствие событий, — поэтому не сделано (#136).

**Чем грозит:** история беднее приёмной сцены на один вид цели; ряды с
картой-целью читаются без меча.
**Что закроет:** решение — склеивать ли атаку с последствием в одну строку, или
добавить карту-цель в само событие `attacked`.
```

- [ ] **Step 2: Add the spec marker**

At the paragraph in `docs/rules/` where an attack naming a card (rather than a seat) comes up, add on its own line:

```markdown
> ❓ **Не из правил.** История показывает атаку, направленную в карту
> (`DDoS ⚔ Monitoring`), но событие `attacked` несёт только игрока. Склейка
> атаки с последствием в одну строку — чтение, не правило. См.
> `docs/animations/backlog.md`.
```

- [ ] **Step 3: Add it to the audit page's findings register**

Add the same finding, one line, to the register in `AnimationAuditStory.tsx`, matching the surrounding entries' shape. CLAUDE.md: the page shows the state, the docs explain the application — both, not one.

- [ ] **Step 4: Verify the docs test still passes**

Run: `pnpm --filter @release/ui test src/animations/docs.test.ts`
Expected: PASS — no preset was added, so `reference.md` needs no new row.

- [ ] **Step 5: Commit**

```bash
git add docs/ apps/playground/stories/AnimationAuditStory/
git commit -m "docs(animations): the sword that points at a card, and why it is not drawn (#136)"
```

---

## Final verification

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `/playground/table` renders as before (Task 11 aside).
- [ ] Two-peer match: reload one peer — history and heap intact, nothing animates.
- [ ] Two-peer match: drop, play two moves, rejoin — log completes, nothing animates.
- [ ] Fresh match after a finished one — no history inherited from the previous game.
