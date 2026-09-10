// Answering an Error 503 or AI Crush. Active only while that pending
// is ours — its siblings `_useBoardStaging.ts` (the turn's plays) and
// `_useDefenseStaging.tsx` (a window's) never run at the same time: a pending
// suspends normal play, and the engine returns [] from `playableFor` while one
// is open (fake/project.ts's own first check).
//
// Legality is the projection's answer throughout: `pending.methods` names what
// may answer, and each method is the CARD that performs it — the Debugger in
// the fan, a Release in the zone, the standing Monitoring. Nothing here
// re-derives which; a method the pending does not name is simply not pullable.
//
// Monitoring answers on a CLICK and nothing moves. It never leaves the zone,
// so flying it to the centre and back would be a lie about what happened — and
// the approved source has no gesture for it at all, because the story
// auto-fired it. Recorded in docs/animations/backlog.md rather than invented
// around; what ships is the smallest thing that moves nothing.
//
// THREE GESTURES, ONE FLYER. `useCoverFlight` is instantiated ONCE here, on a
// flyer this hook owns, and its overlay is rendered once by `_Board.tsx`
// through `overlay` below. A second instance handed the same flyer returns the
// SAME overlay array, so rendering both double-mounts every carrier under
// duplicate React keys — the reason `_useDefenseStaging`'s two instances share
// one flyer and one render of it. There is only ever one card in the air here
// (the answer, or its way home), so one instance is all this needs.

import type { Event } from '@release/engine'
import type {
  CardData,
  HandCardState,
  HandItem,
  HandPlayDrop,
  TableActions,
  TableChoice,
  TablePending,
} from '@release/ui'
import { Card, CardPair } from '@release/ui'
import { play, type Rect, useFlyer, useHandArrival } from '@release/ui/animations'
import {
  Fragment,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { BoardAnchors, BoardState } from '~/entities/game/board'
import { COVER_POSE } from '~/entities/game/board'
import { useReducedMotion } from '~/shared/lib/useReducedMotion'
import { useCoverFlight } from './_useCoverFlight'
import { useZonePull } from './_useZonePull'

export type NeutralizeSlotKey = 'frontend' | 'backend' | 'database' | 'monitoring'

// Derived from the kit's own unions rather than re-typed: the method set lives
// in `@release/ui`'s `intents.ts` and is not on its barrel, and a local copy of
// it would drift the first time a method is added.
type NeutralizeMethodId = Extract<
  TablePending,
  { kind: 'neutralize503' | 'crush' }
>['methods'][number]
type NeutralizeChoice = Extract<TableChoice, { kind: 'neutralize503' | 'crush' }>

/** Where the answer came from, so a rejection knows the way back. The fan for
 *  a Debugger (by uid AND by the index it sat at), its own zone slot for a
 *  sacrificed release. */
type Home = { kind: 'hand'; uid: string; index: number } | { kind: 'zone'; slot: NeutralizeSlotKey }

export interface NeutralizeStaged {
  card: CardData
  /** the sacrificed release's own Code Review, which burns with it */
  aux?: CardData | null
  home: Home
  /**
   * The beat has taken this answer over (`release()`): its exit owns the card
   * now, so the static cover render must let go. The play is NOT finished —
   * see `release()` for why the fan must keep filtering it.
   */
  handed?: boolean
}

export interface NeutralizeStaging {
  staged: NeutralizeStaged | null
  /** true once the answer's flight to the cover slot has landed (or at once
   *  under reduced motion) — gates `_Board.tsx`'s static cover render against
   *  the carrier still flying it there, exactly as `_useDefenseStaging.landed`
   *  does for a defence. */
  landed: boolean
  /** an answer has gone out and the projection has not caught up yet. Distinct
   *  from `staged`, which Monitoring never sets: it answers from where it
   *  stands, so this is the only thing that can stop a second press firing a
   *  second RESOLVE into a decision that is already closing. */
  answered: boolean
  overlay: ReactNode[]
  handItems: HandItem[]
  gapAt: number | null
  gapSize: number
  stateAt: (index: number) => HandCardState
  accentAt: (key: NeutralizeSlotKey) => string | undefined
  grabbable: (key: NeutralizeSlotKey) => boolean
  liftedAt: (key: NeutralizeSlotKey) => boolean
  onHandPlay: (uid: string, drop: HandPlayDrop) => boolean
  onSlotDown: (key: NeutralizeSlotKey, e: ReactMouseEvent<HTMLDivElement>) => void
  /** the beat's own clear — no flight, just done (defenseBeat's `runNeutralized`
   *  calls it through the handoff the instant it takes the exchange over) */
  release: () => void
}

export interface Options {
  state: BoardState
  anchors: BoardAnchors
  actions?: TableActions
  events: Event[] // the feed — watched for `rejected` after dispatch
  enabled: boolean // false while the deal or an exclusive beat owns the table
  /** the match this staging belongs to — same boundary and the same reason as
   *  `_useBoardStaging.ts`'s and `_useDefenseStaging.tsx`'s own. */
  matchKey?: string | null
}

export function useNeutralizeStaging({
  state,
  anchors,
  actions,
  events,
  enabled,
  matchKey = null,
}: Options): NeutralizeStaging {
  const [staged, setStaged] = useState<NeutralizeStaged | null>(null)
  const [answered, setAnswered] = useState(false)
  const [returning, setReturning] = useState(false)
  const reduced = useReducedMotion()
  // The flyer is this hook's own — `useCoverFlight` would make one anyway, but
  // holding it here is what lets the way home drop a carrier by key (`cover`)
  // without reaching for `reset()`, which drops EVERY carrier on the flyer and
  // is a match-wipe tool, not a mid-exchange one.
  const flyer = useFlyer()
  const flight = useCoverFlight(flyer)
  const landed = flight.landed

  // same discipline as its two siblings: handlers that run after an await read
  // refs, not state, so they see this tick's truth (I8).
  const stagedRef = useRef(staged)
  const eventsRef = useRef(events)
  eventsRef.current = events
  const returningRef = useRef(false)

  const commitStaged = (next: NeutralizeStaged | null) => {
    stagedRef.current = next
    setStaged(next)
  }

  const arrival = useHandArrival(anchors.hand, () => {
    returningRef.current = false
    setReturning(false)
    commitStaged(null)
  })

  // the pending owed to US — read once, so every reader downstream agrees on
  // the same instant of it.
  const pending =
    (state.pending?.kind === 'neutralize503' || state.pending?.kind === 'crush') &&
    state.pending.player === state.selfId
      ? state.pending
      : null
  const active = enabled && pending != null
  // What may answer. The projection's own answer, read and never re-derived —
  // one source for what LIGHTS and for what a gesture will accept, so the two
  // can never disagree.
  const methods: NeutralizeMethodId[] = useMemo(() => pending?.methods ?? [], [pending])

  const handItems = useMemo(() => {
    const hidden = staged?.home.kind === 'hand' ? staged.home.uid : null
    return hidden ? state.you.hand.filter((c) => c.uid !== hidden) : state.you.hand
  }, [state.you.hand, staged])

  // Your own area is the release zone and the fan together. Everything else on
  // screen is table. Measured, not guessed: both nodes are already anchored.
  const onTable = useCallback(
    (x: number, y: number) => {
      const zone = anchors.zone.current?.getBoundingClientRect()
      const hand = anchors.hand.current?.getBoundingClientRect()
      const inside = (r?: DOMRect) =>
        r ? x >= r.left && x <= r.right && y >= r.top && y <= r.bottom : false
      return !inside(zone) && !inside(hand)
    },
    [anchors.zone, anchors.hand],
  )

  // The shared dispatch. The RESOLVE goes out synchronously, BEFORE the flight
  // starts — the no-duplicate rule (the card is handed to the flyer in the same
  // commit as the dispatch) requires that order, the same as
  // `_useDefenseStaging`'s own `commitAndFly`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitStaged closes only over refs/setStaged and is stable in effect
  const commit = useCallback(
    (
      choice: NeutralizeChoice,
      card: CardData,
      home: Home,
      from: Rect | undefined,
      aux?: CardData | null,
    ) => {
      commitStaged({ card, aux, home })
      setAnswered(true)
      flight.mark(eventsRef.current)
      actions?.onResolve?.(choice)
      void flight.fly({
        card,
        from,
        to: () => anchors.cover.current?.getBoundingClientRect(),
        pose: COVER_POSE,
        key: 'cover',
        content: aux ? <CardPair main={card} aux={aux} width="100%" /> : undefined,
      })
    },
    [actions, anchors.cover, flight.mark, flight.fly],
  )

  // THE WAY HOME. A rejection puts the answer back where it was taken from —
  // into the fan through the shared insert for a Debugger, back to its own zone
  // slot for a release. Never `flight.reset()`: that drops every carrier on the
  // flyer, which is only ever right at a match wipe.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitStaged closes only over refs/setStaged and is stable in effect
  const goHome = useCallback(() => {
    setAnswered(false)
    const s = stagedRef.current
    if (!s || returningRef.current) return
    const box = anchors.cover.current?.getBoundingClientRect()
    // whatever carrier was showing the answer, gone — the way home owns it now
    // (a no-op under reduced motion, where there never was one)
    flyer.drop('cover')
    if (reduced || !box) {
      commitStaged(null)
      return
    }
    const from: Rect = { left: box.left, top: box.top, width: box.width, height: box.height }

    if (s.home.kind === 'hand') {
      const home = s.home
      returningRef.current = true
      setReturning(true)
      void (async () => {
        const taken = await arrival.arrive(
          [{ key: home.uid, card: s.card, from }],
          handItems.length,
          home.index,
        )
        // a refused arrival never calls `onLanded`, so nothing else would ever
        // put the card back (#101, Fix D, finding 2's own lesson)
        if (!taken) {
          returningRef.current = false
          setReturning(false)
          commitStaged(null)
        }
      })()
      return
    }

    const to = anchors.releaseSlot(state.selfId, s.home.slot)?.getBoundingClientRect()
    if (!to) {
      commitStaged(null)
      return
    }
    void (async () => {
      try {
        const [el] = await flyer.raise([{ key: 'home', at: from, card: s.card }])
        // `playToCenter` in reverse: the centre it is given is the zone slot the
        // release stands in, so the same preset carries it back with no pose.
        if (el) await play('playToCenter', el, { from, to })?.finished
      } finally {
        flyer.drop('home')
        // cleared only once the carrier has let go — the slot's own `liftedAt`
        // reads this, so clearing it early would draw the release in its slot
        // under the carrier still holding it
        commitStaged(null)
      }
    })()
  }, [
    reduced,
    handItems.length,
    arrival.arrive,
    anchors.cover,
    anchors.releaseSlot,
    state.selfId,
    flyer.drop,
    flyer.raise,
  ])

  // The zone gesture (Task 8's module). It holds the dragged card in its own
  // state and knows nothing about the game: `accepts` is the drop rule and
  // `onDrop` is what the drop MEANS.
  const pull = useZonePull<NeutralizeSlotKey>({
    accepts: onTable,
    // refused — the card simply goes back to its slot, which needs nothing but
    // the drag ending (`liftedAt` reads `pull.dragging`)
    onCancel: () => {},
    onDrop: (key, at) => {
      if (key === 'monitoring' || !pending) return // Monitoring answers on a press
      const uid = state.you.releaseUid?.[key]
      const card = state.you.release[key]
      if (!uid || !card) return
      commit(
        { kind: pending.kind, method: 'sacrifice', card: uid },
        card,
        { kind: 'zone', slot: key },
        at.rect,
        state.you.support?.[key],
      )
    },
  })

  const grabbable = useCallback(
    (key: NeutralizeSlotKey) =>
      active &&
      !staged &&
      !answered &&
      (key === 'monitoring'
        ? methods.includes('monitoring')
        : methods.includes('sacrifice') && Boolean(state.you.release[key])),
    [active, staged, answered, methods, state.you.release],
  )

  // What lights is exactly what can be taken — `grabbable` is the one answer,
  // and the hue is the card's own category, so nothing here names a token.
  const accentAt = useCallback(
    (key: NeutralizeSlotKey) => {
      if (!grabbable(key)) return undefined
      const card = state.you.release[key]
      return card ? `var(--cat-${card.category})` : undefined
    },
    [grabbable, state.you.release],
  )

  // A slot shows its empty place while its card is elsewhere: in the drag
  // carrier's hands, or standing at the cover slot as the answer. `dragging` is
  // `useZonePull`'s OWN fact and is read rather than mirrored — a second
  // "which slot is lifted" state is two sources of truth for one thing.
  const liftedAt = useCallback(
    (key: NeutralizeSlotKey) =>
      pull.dragging === key || (staged?.home.kind === 'zone' && staged.home.slot === key),
    [pull.dragging, staged],
  )

  // The fan, as it draws itself. Same rule as the defence's: lit only while a
  // step is waiting on a choice FROM it, and only on the cards that answer that
  // step. Everything else greys out through Hand's own dim, because here the
  // fan is genuinely closed — a 503 is answered by a Debugger or by nothing in
  // it at all.
  const stateAt = useCallback(
    (index: number): HandCardState => {
      if (!active) return 'idle'
      const item = handItems[index]
      const answers =
        !staged &&
        !answered &&
        methods.includes('debugger') &&
        item?.card.id === 'protection-debugger'
      return answers ? 'playable' : 'disabled'
    },
    [active, staged, answered, methods, handItems],
  )

  // GESTURE — the Debugger, pulled out of the fan and dropped on the table.
  const onHandPlay = useCallback(
    (uid: string, drop: HandPlayDrop): boolean => {
      if (!active || !pending || staged || answered || !methods.includes('debugger')) return false
      const index = state.you.hand.findIndex((h) => h.uid === uid)
      const item = state.you.hand[index]
      if (item?.card.id !== 'protection-debugger') return false
      // The whole table accepts the drop; only your own area gives the card
      // back — dropping it where it came from reads as changing your mind.
      if (!onTable(drop.x, drop.y)) return false
      commit(
        { kind: pending.kind, method: 'debugger' },
        item.card,
        { kind: 'hand', uid, index },
        drop.rect,
      )
      return true
    },
    [active, pending, staged, answered, methods, state.you.hand, onTable, commit],
  )

  // GESTURE — the zone. A sacrifice is dragged out of its slot; Monitoring is
  // pressed and stays exactly where it is.
  const onSlotDown = useCallback(
    (key: NeutralizeSlotKey, e: ReactMouseEvent<HTMLDivElement>) => {
      // Only a primary press acts. Monitoring's branch below dispatches an
      // irreversible RESOLVE straight from this handler — it never reaches
      // `useZonePull`'s own guard — so this check is what stops a right- or
      // middle-click from spending the player's only answer.
      if (e.button !== 0) return
      if (!pending || !grabbable(key)) return
      const card = state.you.release[key]
      if (!card) return
      if (key === 'monitoring') {
        // Nothing is staged and nothing flies: the answer is given from where
        // the card stands, and the beat takes the alarm away on its own. The
        // press IS the click — `ReleaseZone` hands a slot's pointer down and
        // nothing else, and a Monitoring is never dragged, so there is no
        // second event to wait for.
        setAnswered(true)
        flight.mark(eventsRef.current)
        actions?.onResolve?.({ kind: pending.kind, method: 'monitoring' })
        return
      }
      pull.render(<Card card={card} interactive={false} width="100%" />)
      pull.begin(key, e.currentTarget, e)
    },
    [pending, grabbable, state.you.release, actions, flight.mark, pull.render, pull.begin],
  )

  // the engine said no: the answer goes home and the offer opens again. Scoped
  // to what arrived AFTER this dispatch (the flight's own watermark), and
  // matched against OUR choice rather than any rejection at all — a rejected
  // RESOLVE carries the whole original Action, so the choice is where the
  // identity lives (`_useDefenseStaging`'s own watcher reads it the same way).
  useEffect(() => {
    if (!answered || returningRef.current) return
    const rejectedOurs = flight.since(events).some((e) => {
      if (e.type !== 'rejected') return false
      const a = e.action
      return a.type === 'RESOLVE' && a.choice.kind === pending?.kind
    })
    if (rejectedOurs) goHome()
  }, [answered, pending?.kind, events, flight.since, goHome])

  // the pending is gone: the answer was taken, and staging's job is done. NOT
  // while our own carrier is still delivering the card (`landed`) — the same
  // catch-up, and the same reason, as `_useDefenseStaging`'s own. If a beat is
  // running instead, its shadow still carries the pending and there is nothing
  // to clear: the beat's `release()` ends the staging, which is the designed
  // hand-over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitStaged closes only over refs/setStaged and is stable in effect
  useEffect(() => {
    if (pending) return
    setAnswered(false)
    if (!stagedRef.current || returningRef.current || !landed) return
    commitStaged(null)
  }, [pending, landed])

  // Hand the cover slot to the beat WITHOUT ending the play. Clearing the
  // staging here would stop `handItems` filtering, and the board is still
  // rendering the beat's shadow — the pre-batch projection, whose `you.hand`
  // still holds the answer that was played — so the card would pop back into
  // the fan beside its own copy flying to the discard. The turn side already
  // solves this by splitting the two jobs (`takeStagedRelease` in
  // `comboBeat.tsx`); this is the same split, done on the staging itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitStaged closes only over refs/setStaged and is stable, the same reason every other caller in this file suppresses it
  const release = useCallback(() => {
    const s = stagedRef.current
    if (s) commitStaged({ ...s, handed: true })
  }, [])

  // A NEW MATCH wipes the gesture — the same boundary, idiom and (inert on this
  // branch) reasoning as its two siblings'. `flight.reset()` belongs HERE and
  // only here: it drops every carrier on the flyer, which is right for a wipe
  // and wrong for anything mid-exchange.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `matchKey` is the boundary and the only dependency this may have — `arrival.reset` is a plain function recreated every render, so listing the body's reads would wipe the gesture on every render instead of once per match
  useLayoutEffect(() => {
    commitStaged(null)
    setAnswered(false)
    returningRef.current = false
    setReturning(false)
    flight.reset()
    arrival.reset()
  }, [matchKey])

  return {
    staged,
    landed,
    answered,
    // ONE render of the flyer's carriers (see the file header), the arrival's
    // own, and the drag carrier only while a drag is actually up — `_Board.tsx`
    // gates the static cover render on this array being empty, so a permanent
    // `null` entry would keep it from ever drawing.
    overlay: [
      ...flyer.overlay,
      ...arrival.overlay,
      // gated on `dragging` rather than on `overlay` itself: React 19's
      // `ReactNode` admits a Promise, which biome's `noMisusedPromises` refuses
      // in a condition (`_useCoverFlight.ts` takes the same detour).
      ...(pull.dragging ? [<Fragment key="zone-pull">{pull.overlay}</Fragment>] : []),
    ],
    handItems,
    gapAt: returning ? arrival.gapAt : null,
    gapSize: arrival.gapSize,
    stateAt,
    accentAt,
    grabbable,
    liftedAt,
    onHandPlay,
    onSlotDown,
    release,
  }
}
