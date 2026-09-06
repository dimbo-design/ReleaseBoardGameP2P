import type { Event, PlayerView, ReleaseView } from '@release/engine'
import type { HeapCard, HistoryEntry, ReleaseSupport } from '@release/ui'
import { type CardData, COVERS, cardById } from '@release/ui'
import type { Scatter } from '@release/ui/animations'
import { HEAP_SHOW, scatterAt } from '@release/ui/animations'
import type { BoardState } from './types'

// One label per member of the engine's Event union — the adapter maps event
// types to translated text, replacing the mock's free-form `kind` literals.
// Task 15 adds the matching keys under `moveHistory` in both catalogs.
export type HistoryLabels = Record<Event['type'], string>

// `assetUrl` throws on a key the catalogue does not recognise, so a card id
// the catalogue does not know cannot resolve through it — `toTableState` must
// stay total. This placeholder never calls `assetUrl` with an unknown key: its
// `art` is the already-resolved base cover, a real asset that always exists.
const PLACEHOLDER_CARD: CardData = {
  id: 'unknown',
  name: '?',
  category: 'attack',
  deck: 'base',
  art: COVERS.base,
  tags: [],
  qty: 0,
}

const cardOrPlaceholder = (id: string): CardData => cardById(id) ?? PLACEHOLDER_CARD

// ReleaseView's slots carry uid + card id (+ codeReview); the kit's release
// zone renders full Card objects and has no slot for uid — that half is
// dropped here, not hidden by the kit. The codeReview half rides separately,
// as the slot's support (see `toReleaseSupport`).
function toReleaseSlots(release: ReleaseView) {
  return {
    frontend: release.frontend ? cardOrPlaceholder(release.frontend.card) : undefined,
    backend: release.backend ? cardOrPlaceholder(release.backend.card) : undefined,
    database: release.database ? cardOrPlaceholder(release.database.card) : undefined,
    monitoring: release.monitoring ? cardOrPlaceholder(release.monitoring.card) : undefined,
  }
}

// The identities `toReleaseSlots` above drops. All four slots are the engine's
// own `ReleasedView` (uid + card id, + codeReview for the three release slots)
// — uniform, so `.uid` sits at the same depth for `monitoring` as for the
// others; there is no separate instance shape to unwrap here.
function toReleaseUids(release: ReleaseView): NonNullable<BoardState['you']['releaseUid']> {
  const out: NonNullable<BoardState['you']['releaseUid']> = {}
  if (release.frontend) out.frontend = release.frontend.uid
  if (release.backend) out.backend = release.backend.uid
  if (release.database) out.database = release.database.uid
  if (release.monitoring) out.monitoring = release.monitoring.uid
  return out
}

// The other identity `toReleaseSlots` drops — and the one the board cannot do
// without. A standing AI release wears the plain `release-<slot>` id so it reads
// and plays as an ordinary one; `event` is the only thing that says otherwise,
// and without it a beat has no way to tell a card going home to the events deck
// from one going to the discard heap (docs/animations/backlog.md).
type ReleaseEvents = Partial<Record<'frontend' | 'backend' | 'database' | 'monitoring', string>>

function toReleaseEvents(release: ReleaseView): ReleaseEvents {
  const out: ReleaseEvents = {}
  if (release.frontend?.event) out.frontend = release.frontend.event
  if (release.backend?.event) out.backend = release.backend.event
  if (release.database?.event) out.database = release.database.event
  if (release.monitoring?.event) out.monitoring = release.monitoring.event
  return out
}

// The aux lying under a release — a played Code Review. ReleaseZone renders it
// tucked under via its `support` prop (the ComboStory zone already does).
function toReleaseSupport(release: ReleaseView): ReleaseSupport {
  return {
    frontend: release.frontend?.codeReview
      ? cardOrPlaceholder(release.frontend.codeReview)
      : undefined,
    backend: release.backend?.codeReview
      ? cardOrPlaceholder(release.backend.codeReview)
      : undefined,
    database: release.database?.codeReview
      ? cardOrPlaceholder(release.database.codeReview)
      : undefined,
  }
}

// Who the event happened to/because of. Most variants carry `player`; the few
// that don't name their primary actor explicitly.
function actorOf(e: Event): string | undefined {
  switch (e.type) {
    case 'attacked':
    case 'requested':
      return e.attacker
    case 'releaseStolen':
    case 'handTransfer':
      return e.from
    case 'gameOver':
      return e.winner
    case 'rejected':
      return 'player' in e.action ? e.action.player : undefined
    // The table did it, not a player: recycling the discard, splitting a pile
    // or merging them belongs to no seat.
    case 'deckReshuffled':
    case 'pilesChanged':
      return undefined
    default:
      return e.player
  }
}

// The primary card an event is about, resolved to its display name — never
// the raw id, so an unknown card can't leak an internal string into the UI.
function cardTextOf(e: Event): string | undefined {
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
      return cardOrPlaceholder(e.card).name
    case 'drawn':
    case 'handTransfer':
      return e.card ? cardOrPlaceholder(e.card).name : undefined
    case 'aiRevealed':
      return cardOrPlaceholder(e.aiCard).name
    default:
      return undefined
  }
}

function toHistoryEntry(e: Event, labels: HistoryLabels): HistoryEntry {
  return {
    id: e.id,
    who: actorOf(e) ?? '',
    kind: labels[e.type],
    card: cardTextOf(e),
    parent: e.parent,
  }
}

/**
 * The pose the heap rests its stand-in for the discard's TOP on — the card that
 * reached the pile with no `discarded` event of its own to key a scatter off
 * (`bankToDiscard` banks silently for `attackSpent`/`defenceSpent`, and for an
 * automatic `destroySlot`). The key is the COUNT, negated: event ids are
 * positive, so a stand-in can never inherit a real card's pose.
 *
 * Exported rather than inlined below because a BEAT has to be able to fly such
 * a card onto exactly this pose — I7, one value with two readers, the same
 * reason `scatterAt(eventId)` is shared with every exit that files a card by
 * its own discard event. `planBeats` reads it for the crush ending, whose
 * destroyed release the engine banks in silence.
 */
export const standInScatter = (discardCount: number): Scatter => scatterAt(-1 - discardCount)

// The discard as it lies on the table. `PlayerView` carries only the top card
// and a count, so the heap is folded out of the feed: one entry per `discarded`
// event, its scatter keyed by the event id. Deterministic on purpose — every
// peer folds the same heap, and the beat that flies a card into it reads the
// SAME Scatter, so the card lands exactly where it then lies (I7).
//
// It runs BEHIND the count, knowingly: a card spent on an attack or a defence
// reaches the discard through the engine's `bankToDiscard` with no event at all
// (`attackSpent` / `defenceSpent` are declared in the DiscardReason union and
// never emitted — docs/animations/backlog.md). Two consequences are handled
// here rather than hidden: the count stays the projection's own, which is
// authoritative; and because `Pile` ignores `topCard` the moment a heap is
// present, a fold that does not end on the projection's top would leave a stale
// card showing as the top of the discard — so the real top is appended.
function toDiscardHeap(log: Event[], top: CardData | undefined, count: number): HeapCard[] {
  // The pile can EMPTY, and the feed does not say so card by card: a `discarded`
  // event is never retracted, but `refillFromDiscard` recycles the whole pile
  // back into the deck (emitting only `deckReshuffled`), and Cherry-pick takes
  // cards out of it. The count is the projection's own and knows; the fold does
  // not. Without this the heap would keep drawing cards over a counter reading
  // zero — and `Pile` renders a non-empty heap INSTEAD of the empty-zone slot
  // (Pile.tsx:76), so the "discard is empty" affordance would never come back
  // for the rest of the match.
  if (count === 0) return []
  const heap: HeapCard[] = []
  for (const e of log) {
    if (e.type !== 'discarded') continue
    // The event id IS the stable integer `scatterAt` asks for — the engine's own
    // monotonic sequence, identical on every peer. No stringifying: `scatterAt`
    // hashes the number arithmetically.
    heap.push({ uid: `d${e.id}`, card: cardOrPlaceholder(e.card), ...scatterAt(e.id) })
  }
  if (top && heap.at(-1)?.card.id !== top.id) {
    // The stand-in for however many cards were banked in silence. Its identity is
    // the COUNT, not the heap's length: the count is what actually moved when
    // that happened, so this card keeps one pose for as long as it is really the
    // top. Its scatter key is negative to put it out of the event ids' range —
    // those are positive, so a stand-in can never inherit a real card's pose.
    //
    // And only as long as it is the top: the moment an event-carrying discard
    // lands above it, the fold ends on the real top again, this branch stops
    // firing, and the banked card leaves the heap while the count still counts
    // it. Accepted rather than fixed — the feed carries no event for a banked
    // card (backlog.md), so once buried there is nothing to draw in its place,
    // and past HEAP_SHOW the missing card is invisible anyway.
    heap.push({ uid: `top${count}`, card: top, ...standInScatter(count) })
  }
  // Never more cards than the pile says it holds: after a partial take the fold
  // still remembers every card that ever went in, and a heap deeper than the
  // count is a stack drawn over a number that contradicts it.
  return heap.slice(-Math.min(HEAP_SHOW, count))
}

// The projection becomes a table: PlayerView + the event log + translated
// labels -> everything the kit's Table needs to render. Pure — no React, no
// clock, no randomness. Total — an unknown card id renders a placeholder
// rather than throwing (`assetUrl` throws; `cardById` does not, and this
// function never calls `assetUrl` directly).
export function toBoardState(view: PlayerView, log: Event[], labels: HistoryLabels): BoardState {
  const visible = log.filter((e) => !e.visibleTo || e.visibleTo.includes(view.self.id))
  const history = visible.map((e) => toHistoryEntry(e, labels)).reverse()

  return {
    you: {
      name: view.self.name,
      hand: view.self.hand.map((c) => ({ uid: c.uid, card: cardOrPlaceholder(c.id) })),
      release: toReleaseSlots(view.self.release),
      support: toReleaseSupport(view.self.release),
      releaseUid: toReleaseUids(view.self.release),
      releaseEvent: toReleaseEvents(view.self.release),
    },
    opponents: view.opponents.map((o) => ({
      id: o.id,
      name: o.name,
      handCount: o.handCount,
      release: toReleaseSlots(o.release),
      support: toReleaseSupport(o.release),
      releaseEvent: toReleaseEvents(o.release),
      eliminated: o.eliminated,
    })),
    decks: {
      // The projection's own pile list, not a total: `drawn.pile` names one of
      // these, and a split has to be visible for Git Branch to be aimable.
      main: view.decks.piles,
      events: view.decks.events,
      discard: view.decks.discardTop ? cardOrPlaceholder(view.decks.discardTop) : undefined,
      discardHeap: toDiscardHeap(
        visible,
        view.decks.discardTop ? cardOrPlaceholder(view.decks.discardTop) : undefined,
        view.decks.discardCount,
      ),
      discardCount: view.decks.discardCount,
    },
    turn: view.turn.player,
    hasDrawn: view.turn.hasDrawn,
    // One pair or nothing — a half-formed clock would sweep the ring against
    // a bound that does not exist.
    turnClock:
      view.turn.openedAt !== undefined && view.turn.deadline !== undefined
        ? { openedAt: view.turn.openedAt, deadline: view.turn.deadline }
        : null,
    selfId: view.self.id,
    history,
    setup: view.setup,
    playable: view.self.playable,
    frozen: view.self.frozen,
    // Structural passthrough — Target and TableTarget are one shape; licensed
    // the same way `pending`/`window` are by contract.test-d.ts.
    targets: view.self.targets as BoardState['targets'],
    // Structural passthrough — licensed by the Exact<> assertions in
    // contract.test-d.ts. Both carry openedAt alongside deadline already.
    pending: view.pending,
    window: view.window,
    // Structural passthrough — the engine's own answer to which pairs a
    // support may start. participants/spectators are room facts and are
    // never produced here (Decision 7 / the constraint on this task).
    comboOptions: view.self.combos,
  }
}
