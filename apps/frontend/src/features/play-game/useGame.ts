import type { Choice, Event, PlayerView, Target } from '@release/engine'
import { useEffect, useRef, useState } from 'react'
import { useSession } from '~/app/providers/SessionProvider'
import type { Intent } from '~/network'
import { clearLog, readLog, writeLog } from '~/shared/lib/persistence'
import { mergeEvents } from './mergeEvents'

export interface Game {
  // Null before the first projection arrives, and for a spectator, who holds no
  // seat to be projected to.
  view: PlayerView | null
  events: Event[]
  // The highest event id already reflected in the projection this peer starts
  // from — everything up to it was restored, not played, so the animation
  // layer must not plan it as a movement anybody should watch. `0` when
  // nothing was restored.
  restoredThrough: number
  play(card: string, target?: Target, combo?: string): void
  draw(pile?: number): void
  push(): void
  attack(card: string, combo?: string): void
  pass(): void
  unpass(): void
  resolve(choice: Choice): void
}

// The page's whole relationship with the game. It holds a `GameLink` and a
// projection and nothing else, so it cannot tell a local keeper from a remote
// one — which is what keeps solo play and networked play on one code path.
export function useGame(): Game {
  const session = useSession()
  const link = session.gameLink
  const sync = session.gameSync
  const gameId = session.gameId

  // The move history is this peer's own running record rather than part of
  // GameState: each seat accumulates only the events it was entitled to see.
  //
  // Restored in a LAZY INITIALISER, not an effect, and that is load-bearing.
  // The board arms its beats in a layout effect; a feed restored one passive
  // effect later would be read as empty on the commit that first carried a
  // projection, and then as fifty new events on the next — the whole match,
  // planned as choreography. sessionStorage is synchronous, so the feed can
  // simply exist on the first render.
  const [events, setEvents] = useState<Event[]>(() =>
    gameId ? ((readLog(gameId) ?? []) as Event[]) : [],
  )
  // Starts pointed at the game that just supplied `events` above, not at
  // `null`: both run in the same first render, so a ref that started at
  // `null` would read as "a different game" on mount and the effect below
  // would wipe the just-restored feed (and the storage it came from) the
  // instant it fired.
  const seenGame = useRef<string | null>(gameId)
  const seenSync = useRef<typeof sync>(null)

  // The high-water mark the beat queue starts from: everything restored is
  // already reflected in the projection the board is about to render, so none
  // of it is a movement anybody should watch.
  const restoredThrough = useRef(events.at(-1)?.id ?? 0)

  // Whether `events` (and `restoredThrough.current`) still belong to `gameId`,
  // as of the START of this render — read before any effect of this same
  // commit can move `seenGame.current` to a new id. The clear effect just
  // below does exactly that, in the same commit, before the persist effect
  // runs, so a persist effect that re-read `seenGame.current` itself would see
  // the NEW id and never notice the game had just changed. Snapshotting it
  // here, in a plain render-time variable, is what lets both `carried` and the
  // persist effect agree on "this render still describes the outgoing game".
  const sameGame = seenGame.current === gameId

  useEffect(() => {
    // A new game must not inherit the last one's feed.
    if (seenGame.current !== gameId) {
      seenGame.current = gameId
      seenSync.current = null
      clearLog()
      restoredThrough.current = 0
      setEvents([])
    }
  }, [gameId])

  useEffect(() => {
    if (!sync || sync === seenSync.current) return
    seenSync.current = sync
    if (sync.events.length === 0) return
    // A resend is what this peer already ought to know. It belongs in the feed
    // and in the heap, and it belongs nowhere near the beat queue.
    if (sync.resync) restoredThrough.current = sync.events.at(-1)?.id ?? restoredThrough.current
    setEvents((prev) => mergeEvents(prev, sync.events))
  }, [sync])

  useEffect(() => {
    // Without `sameGame`, a commit where `gameId` just changed would still run
    // this effect with the OUTGOING game's `events` in its closure — the clear
    // effect above resets `events` via `setEvents([])`, but that only takes
    // effect on the NEXT render. Writing here anyway would re-plant the record
    // `clearLog()` (in that same effect, run first) just wiped, mislabelled
    // under the new game — exactly the leak the `carried` guard's own comment
    // warns about, just on the write side instead of the read side.
    if (!gameId || events.length === 0 || !sameGame) return
    writeLog({ gameId, events, savedAt: Date.now() })
  }, [gameId, events, sameGame])

  // An intent carries neither player nor clock — the referee stamps both from
  // the connection it arrived on, so a peer cannot act for another seat.
  const submit = (intent: Intent) => link?.submit(intent)

  // `events` is one commit behind `view`: the effect above folds a sync into the
  // running feed only after the render that first saw it. The board's deal intro
  // arms in a *layout* effect, which runs before that — so on the very commit the
  // opening projection arrives it would read an empty feed, conclude there was no
  // deal, and finish before a card ever flew. Folding the unseen sync in here
  // makes the feed and the projection describe the same moment.
  //
  // No double-count: once the effect has run, `seenSync` holds this sync and its
  // events are already in `events`, so nothing is pending.
  const pending = sync && sync !== seenSync.current ? sync.events : []
  // `events` is likewise cleared by an effect, so for one commit after a new game
  // starts it still holds the last one's feed. Read as empty here rather than
  // handing the new game a history it did not have — the seat ids repeat between
  // games, so a stale `dealt` would otherwise be taken for this game's deal.
  const carried = sameGame ? events : []

  // A resync not yet folded in by the sync effect above is already reflected in
  // `pending` — and so in the `events` returned below — on THIS render. The ref
  // only advances inside that effect, which runs strictly after this render's
  // layout effects, so reading just `restoredThrough.current` here would lag
  // the very feed it is supposed to cover. Mirror the effect's own rule
  // (`sync.events.at(-1)?.id ?? restoredThrough.current`) directly in the
  // return expression, the same way `pending`/`carried` mirror it for `events`.
  const restoredNow =
    pending.length > 0 && sync?.resync
      ? (sync.events.at(-1)?.id ?? restoredThrough.current)
      : restoredThrough.current

  return {
    view: sync?.view ?? null,
    events: pending.length > 0 ? mergeEvents(carried, pending) : carried,
    restoredThrough: restoredNow,
    play: (card, target, combo) => submit({ type: 'PLAY', card, target, combo }),
    draw: (pile) => submit({ type: 'DRAW', pile }),
    push: () => submit({ type: 'PUSH' }),
    attack: (card, combo) => submit({ type: 'ATTACK', card, combo }),
    pass: () => submit({ type: 'PASS' }),
    unpass: () => submit({ type: 'UNPASS' }),
    resolve: (choice) => submit({ type: 'RESOLVE', choice }),
  }
}
