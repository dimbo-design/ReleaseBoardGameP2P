// Answering an attack (#101, Task 16): pulling a defence out of the fan and
// dropping it over the attack answers the `defend` pending the engine owes
// us. Active only while that pending is ours — its sibling `_useBoardStaging.ts`
// owns the TURN's plays, and the two never run at once: a window suspends
// normal play, and the engine returns [] from `playableFor` while one is open
// (packages/engine/src/fake/project.ts's own first check).
//
// Legality is the projection's answer throughout: `pending.options` names the
// cards that may answer this attack. Task 17 (#101) adds the enhanced answer —
// pulling the defender's OWN Sudo stands it at its own slot instead of onto the
// attack, and it waits there for the defence it will enhance, clicked in the
// hand rather than aimed at (the arrow only SHOWS where it is pointed, it does
// not gate the click the way a target pick does). Which defences a Sudo may
// enhance comes from `state.comboOptions[sudoUid]` — `combosFor`
// (packages/engine/src/fake/project.ts) now sources that, while a `defend`
// pending owed to this player is open, from the pending's own answerable set
// (`canDefendWith`), filtered to a card whose rules carry the sudo tag. Nothing
// here re-derives it; a Sudo with no entry (or an empty one) is simply not
// pullable.
//
// This file went from `.ts` to `.tsx` for Task 17: the fold's own flyer carries
// a `<CardPair>` as its `content` (`useFlyer`'s own allowance — "a scene may put
// its OWN element in the node and reach into it afterwards"), the same idiom
// `comboBeat.tsx`'s `foldIn` and `defenseBeat.tsx`'s own sudo-backed cover
// already use. `_useBoardStaging.ts`'s OWN turn-side fold avoids this — it
// paints its pair on a persistent, always-mounted node instead — because that
// pair can go on to wait through further phases (aim, dispatch) at the SAME
// spot; this one does not: it dispatches in the same motion as the fold, so
// there is nothing further for a persistent node to hold open for. The interface
// this file exported before Task 17 reserved a `pairRef` field on that
// assumption ("mounted by _Board.tsx the same way _useBoardStaging's own is");
// this task drops it; `defenseBeat.tsx`'s `runCovered` only ever reads
// `handoff.el`, which `_Board.tsx`'s existing `coverStagedRef` already supplies
// (wrapping either a `<Card>` or, once this task's fold lands, a `<CardPair>`).
//
// The plain path is small and mirrors `_useBoardStaging.ts`'s own solo-release
// shape: pull commits and dispatches in the SAME tick (no aim, no partner), the
// card flies to the cover slot at COVER_POSE, and once the flyer lands (or at
// once under reduced motion) a static render at `anchors.cover` takes over —
// `landed` is that gate, the same role the turn hook's `StageState` reaching
// `standing` plays for a solo release.
// This is what keeps the fallback in `defenseBeat.runCovered` dead for a local
// defence (Carry #2 of this task's brief): the beat's own
// `!(mine && handoff?.el)` check reads `el` off a REAL, already-standing node,
// in both motion modes, not a flyer that a reduced-motion path never raises.

import type { Event } from '@release/engine'
import type {
  CardData,
  HandCardState,
  HandItem,
  HandPlayDrop,
  Point,
  TableActions,
} from '@release/ui'
import { CardPair, PAIR_AUX_POSE, useArrow } from '@release/ui'
import {
  enterPose,
  nextFrames,
  play,
  type Rect,
  restTransform,
  useFlyer,
  useHandArrival,
} from '@release/ui/animations'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { BoardAnchors, BoardState } from '~/entities/game/board'
import { COVER_POSE, MERGE_MS, SUDO_POSE } from '~/entities/game/board'
import { useReducedMotion } from '~/shared/lib/useReducedMotion'
import { useCoverFlight } from './_useCoverFlight'

// same 5-line helper comboBeat.tsx/defenseBeat.tsx each keep privately — copy
// it, don't import across runners.
const rectOf = (el: Element | null): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export interface DefenseStagedCard {
  uid: string
  card: CardData
  index: number // index in you.hand at pull time — where a return flight lands it
}

export interface DefenseStagedPlay {
  // the defender's own pulled Sudo — set the instant it lands at its own slot,
  // whether it is still waiting for a partner (`phase: 'partner'`) or has
  // already folded into one (`merged`); null on the plain path
  support: DefenseStagedCard | null
  // the plain pulled defence, or the partner once the fold has picked one
  main: DefenseStagedCard | null
  // 'partner': a lone Sudo standing at its own slot, waiting for a click in the
  // hand. 'dispatched': the instant a legal pull (plain) or a valid fold
  // (paired) commits — no further aim, so nothing waits between this and the
  // engine's answer. 'rejected': the brief window between the engine saying no
  // and the return flight taking the card(s) back.
  phase: 'partner' | 'dispatched' | 'rejected'
  /**
   * The beat has taken this play over (`release()`): its own exit owns the
   * card now, so the static cover render must let go of the slot. The play is
   * NOT finished — see `release()` for why the fan must keep filtering it.
   */
  handed?: boolean
  // true once a partner has been picked — the cover slot carries a CardPair
  // rather than a lone Card. Mirrors `_useBoardStaging`'s own `merged`.
  merged: boolean
}

export interface DefenseStaging {
  staged: DefenseStagedPlay | null
  overlay: ReactNode[]
  gapAt: number | null
  gapSize: number
  handItems: HandItem[]
  // the arrow armed from the waiting Sudo's own slot, following the cursor —
  // `_Board.tsx` renders it in place of `staging.arrow` while `answering`.
  arrow: { from: Point | null; to: Point | null; active: boolean }
  // the hand cards a waiting Sudo may fold with light with its own category
  // accent — mirrors `_useBoardStaging`'s own `accentAt`. Undefined outside
  // `phase: 'partner'`.
  accentAt: (index: number) => string | undefined
  /** what a fan slot reads as while this hook owns the fan — 'playable' on
   * every card that answers the open `defend`, 'selected' on a waiting Sudo's
   * own partners, 'idle' everywhere else (#101, Fix B). */
  stateAt: (index: number) => HandCardState
  onHandPlay: (uid: string, drop: HandPlayDrop) => boolean
  /** the partner pick — a click in the hand while a Sudo waits, per
   * `state.comboOptions[sudoUid]`. A miss cancels the whole staging, same as
   * `_useBoardStaging`'s own `onCardClick`. */
  onCardClick: (index: number) => void
  cancel: () => void
  release: () => void
  /** true once the pulled defence's own flight to the cover slot has landed
   * (or at once, under reduced motion) — gates `_Board.tsx`'s static cover
   * render against the carrier still flying it there, the same role
   * `_useBoardStaging.ts`'s own `StageState` reaching `standing` plays for a
   * solo release. Also
   * the gate for the FOLDED pair's static cover render (Task 17): the fold
   * dispatches through the same `landed` cycle as the plain path. */
  landed: boolean
  /** true once the waiting Sudo's own flight to its slot has landed (or at
   * once, under reduced motion) — gates `_Board.tsx`'s static sudo-slot render
   * the same way `landed` gates the cover slot's. */
  sudoLanded: boolean
}

export interface Options {
  state: BoardState
  anchors: BoardAnchors
  actions?: TableActions
  events: Event[] // the feed — watched for `rejected` after dispatch
  enabled: boolean // false while the deal or an exclusive beat owns the table
  /**
   * The match this staging belongs to (#101, Fix C, finding 3) — the same
   * boundary and the same reason as `_useBoardStaging.ts`'s own: `<Board>` is
   * not remounted for a rematch, and a defence standing over an attack that
   * belonged to the previous match would otherwise stay on the new table.
   */
  matchKey?: string | null
}

export function useDefenseStaging({
  state,
  anchors,
  actions,
  events,
  enabled,
  matchKey = null,
}: Options): DefenseStaging {
  const [staged, setStaged] = useState<DefenseStagedPlay | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const reduced = useReducedMotion()
  const flyer = useFlyer()
  // The stand-a-card-at-a-centre-slot cycle, twice — `_useCoverFlight.ts` owns
  // the flight, the `landed` gate and the dispatch watermark, and nothing
  // else: the dispatch and the way home stay here. Two instances because the
  // two slots gate independently (a fold clicked while the Sudo is still in
  // the air must not read the Sudo's landing as the pair's), and both are
  // handed THIS hook's one flyer: the fold below is not the module's shape and
  // keeps its own flight, which has to ride the same carrier — two `useFlyer`s
  // number their nodes from their own counters and collide on React keys the
  // moment both are in the air.
  const coverFlight = useCoverFlight(flyer)
  const sudoFlight = useCoverFlight(flyer)
  const landed = coverFlight.landed
  const sudoLanded = sudoFlight.landed
  const arrowCtl = useArrow()

  // same discipline as `_useBoardStaging.ts`: handlers that run after an
  // await read refs, not state, so they see this tick's truth (I8).
  const stagedRef = useRef(staged)
  const cancellingRef = useRef(cancelling)
  cancellingRef.current = cancelling
  const eventsRef = useRef(events)
  eventsRef.current = events
  // The fold is IRREVOCABLE once a partner is picked — copies
  // `_useBoardStaging.ts`'s own `foldingRef` verbatim in intent: `cancel()`
  // and a second click both refuse while it is true, and every exit path
  // (success or not) clears it in a `finally`.
  const foldingRef = useRef(false)

  const commitStaged = (next: DefenseStagedPlay | null) => {
    stagedRef.current = next
    setStaged(next)
  }

  const arrival = useHandArrival(anchors.hand, () => {
    cancellingRef.current = false
    setCancelling(false)
    commitStaged(null)
  })

  // the pending "defend" owed to us — read once so every reader downstream
  // (options, dispatch, the static render) agrees on the same instant of it.
  const pending =
    state.pending?.kind === 'defend' && state.pending.player === state.selfId ? state.pending : null
  // Which cards may answer it — the projection's own answer, read never
  // re-derived. Two readers: `resolveLegal`, which decides whether a pull is
  // legal, and `stateAt`, which lights exactly that set in the fan (#101,
  // Fix B). Deliberately NOT exported any more: it used to be, with no
  // consumer anywhere, which is how the board ended up computing what to
  // light and then lighting nothing.
  const defenceOptions = useMemo(() => pending?.options ?? [], [pending])

  const handItems = useMemo(() => {
    const out = new Set(
      [staged?.support?.uid, staged?.main?.uid].filter((uid): uid is string => Boolean(uid)),
    )
    if (out.size === 0) return state.you.hand
    return state.you.hand.filter((c) => !out.has(c.uid))
  }, [state.you.hand, staged])

  // While a Sudo waits for a partner, the defences it may enhance keep the
  // support's own category accent — the same reading `_useBoardStaging`'s own
  // `accentAt` gives a combo's partner. Gone the moment a partner is picked:
  // the clicked card is no longer in `handItems` regardless.
  const accentAt = useCallback(
    (index: number) => {
      const support = staged?.phase === 'partner' ? staged.support : null
      const item = support ? handItems[index] : undefined
      if (!support || !item) return undefined
      const partners = state.comboOptions?.[support.uid] ?? []
      return partners.includes(item.uid) ? `var(--cat-${support.card.category})` : undefined
    },
    [staged, handItems, state.comboOptions],
  )

  // Which cards answer the open attack, as the fan draws them (#101, Fix B).
  // The rule is the approved scene's: the fan lights only while a step is
  // waiting on a choice FROM it, and only on the cards that answer that step —
  // nothing at rest, because a glow with nothing asked reads as "already
  // selected" rather than "available". The set is the projection's throughout:
  // `pending.options` for a plain defence, `state.comboOptions[uid]` for the
  // Sudo (both the "is it pullable at all" answer `resolveSudo` gates on and,
  // once it stands, the narrowed "which defence may it enhance").
  //
  // Once anything IS staged the ask has been answered — a dispatched or
  // rejected play has nothing left to choose — so only the waiting-Sudo phase
  // keeps a lit set, and it keeps it through `accentAt`'s own 'selected'
  // reading rather than a second one of its own.
  const stateAt = useCallback(
    (index: number): HandCardState => {
      const item = handItems[index]
      if (!item) return 'idle'
      // The same gate every path that ACCEPTS an answer opens with
      // (`resolveLegal`, `resolveSudo`): while the opening owns the table
      // nothing here is pickable, so nothing here may look pickable. Reachable
      // on a rejoin that replays the opening into a pending already owed to
      // us (fix round 1, L2).
      if (!enabled) return 'idle'
      if (accentAt(index)) return 'selected'
      if (!pending || staged) return 'idle'
      if (defenceOptions.includes(item.uid)) return 'playable'
      const partners = state.comboOptions?.[item.uid] ?? []
      return item.card.id === 'support-sudo' && partners.length > 0 ? 'playable' : 'idle'
    },
    [enabled, handItems, accentAt, pending, staged, defenceOptions, state.comboOptions],
  )

  // The shared guard + lookup both entry points below open with: is this uid
  // actually pullable right now, and if so where does it sit in `you.hand`.
  // Neither dispatches nor flies anything — just answers "legal, and where".
  const resolveLegal = useCallback(
    (uid: string): { item: CardData; index: number } | null => {
      if (!enabled || !pending || stagedRef.current) return null
      if (!defenceOptions.includes(uid)) return null
      const index = state.you.hand.findIndex((c) => c.uid === uid)
      const item = state.you.hand[index]
      return item ? { item: item.card, index } : null
    },
    [enabled, pending, defenceOptions, state.you.hand],
  )

  // Task 17's own gate: a Sudo is pullable only while nothing is staged and
  // the projection says it has at least one defence in hand it may enhance —
  // `state.comboOptions[uid]`, sourced from the pending's own answerable set
  // (`packages/engine/src/fake/project.ts`'s `combosFor`). Never re-derived:
  // an empty (or absent) entry means this Sudo is not pullable here, same as
  // any other illegal pull.
  const resolveSudo = useCallback(
    (uid: string): { item: CardData; index: number } | null => {
      if (!enabled || !pending || stagedRef.current) return null
      const index = state.you.hand.findIndex((c) => c.uid === uid)
      const item = state.you.hand[index]
      if (item?.card.id !== 'support-sudo') return null
      if ((state.comboOptions?.[uid] ?? []).length === 0) return null
      return { item: item.card, index }
    },
    [enabled, pending, state.you.hand, state.comboOptions],
  )

  // The plain path's own half: commit the dispatched play, fire the RESOLVE,
  // and fly the card to the cover slot from the drag's own drop point. Kept a
  // step of its own rather than inlined into `onHandPlay`, so there stays
  // exactly one place that can leave the fly-in half-built — the lesson of
  // fix round 1, where `PendingPrompt`'s card list bypassed this whole path
  // and reopened Carry #2 through its own door. That second door is gone
  // (#101, Fix B): the panel no longer renders for a `defend` at all, because
  // it covered the very attack it was asking about and asked a second time
  // for what the fan already answers. The board's decline is the only thing
  // that survived it, and it carries no card to fly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitStaged closes only over refs/setStaged and is stable in effect
  const commitAndFly = useCallback(
    (uid: string, card: CardData, index: number, from: Rect | undefined) => {
      commitStaged({
        main: { uid, card, index },
        support: null,
        phase: 'dispatched',
        merged: false,
      })
      coverFlight.mark(eventsRef.current)
      // the RESOLVE goes out synchronously, BEFORE the flight starts — the
      // no-duplicate rule (the card handed to the flyer in the same commit as
      // the dispatch) requires that order, and the catch-up effect below is
      // written around it. `coverFlight.fly` arms `landed` as its own first
      // statement and reports the carrier gone in a `finally`; the whole
      // reason that `finally` is load-bearing lives with it in
      // `_useCoverFlight.ts`.
      actions?.onResolve?.({ kind: 'defend', card: uid, combo: undefined })
      void coverFlight.fly({
        card,
        from,
        to: () => anchors.cover.current?.getBoundingClientRect(),
        pose: COVER_POSE,
        key: 'cover',
      })
    },
    [anchors.cover, actions, coverFlight.mark, coverFlight.fly],
  )

  // Task 17's own staging half: the Sudo goes to its OWN slot, not onto the
  // defence it will back — flying it there directly would read as the pair
  // already assembled (the ported source's own note). Mirrors
  // `commitAndFly`'s shape: commit synchronously (so `handItems` hides it from
  // the fan at once), fly it to `anchors.sudo`, and arm the arrow from that
  // slot's own centre once it lands.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitStaged closes only over refs/setStaged and is stable in effect
  const stageDefSudo = useCallback(
    (uid: string, card: CardData, index: number, from: Rect | undefined, dropped: HandPlayDrop) => {
      commitStaged({ support: { uid, card, index }, main: null, phase: 'partner', merged: false })
      // A cancel (or a later dispatch) may take this staging away WHILE the
      // flight below is still in the air (Fix round 1, Important 1) — the
      // approved source's own `cancelStaged` guards this exact window with
      // `busyRef.current`, dropped in the initial port. Shared by the
      // continuation below AND by `sudoFlight.fly`'s own `stillCurrent`
      // (whole-branch review fix): without the latter, a stale cycle's
      // `finally` still raises `sudoLanded` for whatever NEW staging replaced
      // this one, and `_Board.tsx` paints the static Sudo card while the new
      // carrier is still flying it — two copies of the same card on screen.
      const stillCurrent = () =>
        !cancellingRef.current &&
        stagedRef.current?.phase === 'partner' &&
        stagedRef.current.support?.uid === uid
      void (async () => {
        await sudoFlight.fly({
          card,
          from,
          to: () => anchors.sudo.current?.getBoundingClientRect(),
          pose: SUDO_POSE,
          key: 'sudo',
          stillCurrent,
        })
        // Without this check, a press landing mid-flight runs `cancel()`
        // (whose own `arrowCtl.stop()` is a no-op — nothing is armed yet) and
        // sends the card home, but this continuation, unaware, still arms an
        // arrow from an empty slot that follows the cursor until some LATER
        // staging happens to call `stop()`.
        if (!stillCurrent()) return
        // the arrow starts where the Sudo now stands and follows the cursor —
        // the ported source's own `stageDefSudo`
        const box = anchors.sudo.current?.getBoundingClientRect()
        if (box) arrowCtl.aim({ x: box.left + box.width / 2, y: box.top + box.height / 2 }, dropped)
      })()
    },
    [anchors.sudo, arrowCtl.aim, sudoFlight.fly],
  )

  // GESTURE — pulling a legal defence out of the fan commits and dispatches
  // at once (no aim, no partner): the plain-defence half of the allowance
  // `_useBoardStaging.ts`'s own solo release already takes for a release with
  // no Code Review to pair. Pulling the defender's OWN Sudo instead stages it
  // waiting for a partner (Task 17) — the partner itself is CLICKED, never
  // pulled, so this never fires for it.
  const onHandPlay = useCallback(
    (uid: string, drop: HandPlayDrop): boolean => {
      const legal = resolveLegal(uid)
      if (legal) {
        commitAndFly(uid, legal.item, legal.index, drop.rect)
        return true
      }
      const sudoLegal = resolveSudo(uid)
      if (sudoLegal) {
        stageDefSudo(uid, sudoLegal.item, sudoLegal.index, drop.rect, drop)
        return true
      }
      return false
    },
    [resolveLegal, commitAndFly, resolveSudo, stageDefSudo],
  )

  // cancel — a miss, Escape, or an invalid partner pick sends whatever is
  // standing back into the fan. Three shapes, mirroring `_useBoardStaging.ts`'s
  // own cancel: a lone Sudo waiting for a partner returns from its own slot; a
  // folded pair returns both halves together from the cover slot; and the
  // plain defence returns from the cover slot alone, exactly as Task 16 left
  // it. The merged branch is reached two ways: directly, if a rejection
  // arrives once the fold has already settled (`phase` is 'rejected' but
  // `foldingRef` is clear, so this guard lets it through); or via
  // `onCardClick`'s own `finally`, which retries this the instant its fold's
  // lock clears, for a rejection that arrived WHILE the fold was still
  // animating (Fix round 1, Important 2 — reachable in normal play via the
  // pending's own deadline).
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitStaged closes only over refs/setStaged and is stable in effect
  const cancel = useCallback(() => {
    const s = stagedRef.current
    if (!s || s.phase === 'dispatched' || cancellingRef.current || foldingRef.current) return
    arrowCtl.stop()

    if (s.phase === 'partner' && s.support && !s.main) {
      const support = s.support
      // prefer the flying card's OWN current box over the empty slot's — a
      // cancel landing mid-flight (Fix round 1, Important 1's own window)
      // would otherwise start the return flight from the slot the card has
      // not reached yet, while the card is visibly still mid-air elsewhere
      const sRect = rectOf(flyer.elOf('sudo')) ?? anchors.sudo.current?.getBoundingClientRect()
      flyer.drop('sudo')
      if (reduced || !sRect) {
        commitStaged(null)
        return
      }
      cancellingRef.current = true
      setCancelling(true)
      void arrival.arrive(
        [{ key: support.uid, card: support.card, from: sRect }],
        handItems.length,
        support.index,
      )
      return
    }

    const main = s.main
    if (!main) return

    if (s.merged && s.support) {
      const support = s.support
      const cRect = anchors.cover.current?.getBoundingClientRect()
      const el = anchors.cover.current
      flyer.drop('fold')
      if (reduced || !cRect) {
        commitStaged(null)
        return
      }
      cancellingRef.current = true
      setCancelling(true)
      void arrival.arrive(
        [
          { key: support.uid, card: support.card, el, anchor: 'aux' as const, from: cRect },
          { key: main.uid, card: main.card, el, anchor: 'main' as const, from: cRect },
        ],
        handItems.length,
        support.index,
      )
      return
    }

    const cRect = anchors.cover.current?.getBoundingClientRect()
    // whatever carrier or static render was showing the defence, gone — the
    // return flight owns it now (a no-op if nothing was raised under this key,
    // e.g. the reduced-motion path, where there never was one)
    flyer.drop('cover')
    if (reduced || !cRect) {
      commitStaged(null)
      return
    }
    cancellingRef.current = true
    setCancelling(true)
    void arrival.arrive(
      [{ key: main.uid, card: main.card, from: cRect }],
      handItems.length,
      main.index,
    )
  }, [
    reduced,
    handItems.length,
    arrival.arrive,
    anchors.cover,
    anchors.sudo,
    arrowCtl.stop,
    flyer.drop,
    flyer.elOf,
  ])

  // the partner pick (Task 17) — the waiting Sudo is ALREADY standing at its
  // own slot; only the defence travels, folding both into a CardPair at the
  // cover slot. Ported from `DefenseReleaseStory.tsx`'s own `mergeIntoPair`,
  // via the SAME `flyer.raise`-with-`content` idiom `comboBeat.tsx`'s `foldIn`
  // and `defenseBeat.tsx`'s own sudo-backed cover already use.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitStaged closes only over refs/setStaged and is stable in effect
  const onCardClick = useCallback(
    (index: number) => {
      if (!enabled || cancellingRef.current || foldingRef.current) return
      const s = stagedRef.current
      if (s?.phase !== 'partner' || !s.support) return
      const item = handItems[index]
      if (!item) return
      const support = s.support
      const partners = state.comboOptions?.[support.uid] ?? []
      if (!partners.includes(item.uid)) {
        cancel() // not a valid partner — the whole staging returns
        return
      }
      // I1 — measured before the commit below reflows the fan and clears the
      // standing Sudo.
      const box = anchors.cover.current?.getBoundingClientRect()
      const sudoBox = anchors.sudo.current?.getBoundingClientRect()
      const fromRect = rectOf(anchors.handSlotAt(index)) ?? undefined
      if (!box || !sudoBox) return
      arrowCtl.stop() // the choice is made — nothing is pointed at while the pair folds
      const mainIndex = state.you.hand.findIndex((c) => c.uid === item.uid)
      const main: DefenseStagedCard = { uid: item.uid, card: item.card, index: mainIndex }
      // the fold is committed — irrevocable until it lands; `cancel()` and a
      // second click both refuse while this is true.
      foldingRef.current = true
      try {
        // The standing Sudo is handed to the flyer in the SAME commit as the
        // dispatch — no `await` between them, so React batches both into one
        // commit: the static Sudo unmounts on the exact frame the flyer's aux
        // half mounts. Never on screen twice, never absent (the no-duplicate
        // rule this task's own brief calls out).
        commitStaged({ support, main, phase: 'dispatched', merged: true })
        coverFlight.mark(eventsRef.current)
        coverFlight.arm() // fresh cycle — the fold below has not carried this pair yet
        actions?.onResolve?.({ kind: 'defend', card: item.uid, combo: support.uid })
      } catch (e) {
        // Fix round 1 (Minor): a throw from the send must not leave the lock
        // stuck — `_useBoardStaging.ts`'s own dispatch lives inside its fold's
        // guarded block for the same reason (there `finish()` clears the lock
        // as its own first statement, before calling out).
        foldingRef.current = false
        throw e
      }

      if (reduced || !fromRect) {
        // reduced motion (or no fan geometry to fold from) settles instantly —
        // CardPair's own inline pose (identity main, PAIR_AUX_POSE aux) IS the
        // pair at rest, nothing to paint frame by frame.
        coverFlight.settle()
        foldingRef.current = false
        return
      }
      void (async () => {
        try {
          const enterMain = enterPose(fromRect, box)
          const enterAux = enterPose(sudoBox, box)
          const [el] = await flyer.raise([
            {
              key: 'fold',
              at: box,
              content: <CardPair main={item.card} aux={support.card} width="100%" />,
              pose: restTransform(COVER_POSE),
            },
          ])
          const mainEl = el?.querySelector<HTMLElement>('[data-main]')
          const auxEl = el?.querySelector<HTMLElement>('[data-aux]')
          if (!mainEl || !auxEl) {
            flyer.drop('fold')
            coverFlight.settle()
            return
          }
          // painted at their entry poses first, so neither half flashes in
          // its final place before the fold starts
          mainEl.style.transform = enterMain
          auxEl.style.transform = enterAux
          await nextFrames() // both painted at their entry poses first (I2)
          await Promise.all([
            play('foldIntoPair', mainEl, { from: fromRect, box, dur: MERGE_MS })?.finished,
            play('foldIntoPair', auxEl, {
              from: sudoBox,
              box,
              pose: PAIR_AUX_POSE,
              dur: MERGE_MS,
              snap: true,
            })?.finished,
          ])
          flyer.drop('fold')
          // the carrier has dropped it — `_Board.tsx`'s static cover render
          // may take over now, not a moment before (see `landed`'s comment).
          coverFlight.settle()
        } finally {
          // every exit clears the lock — the early returns above and a
          // rejecting `.finished` all bypass the success path's own clear.
          foldingRef.current = false
          // and every exit reports the carrier gone, for the same reason
          // `commitAndFly`'s own `finally` does (#101, Fix D round 4): the
          // catch-up effect below will not clear a dispatched staging until
          // `landed` is true, so a rejected flight that skipped the success
          // path's `coverFlight.settle()` would leave the fan a hole for good. A
          // no-op on every path that already set it.
          coverFlight.settle()
          // Fix round 1 (Important 2): unlike `_useBoardStaging.ts`'s own
          // fold, this one dispatches BEFORE this flight rather than after —
          // the no-duplicate rule (the standing Sudo handed to the flyer in
          // the SAME commit as the dispatch) requires it. That inversion
          // opens a real window a rejection can land in: the rejected-watcher
          // effect below sets `phase: 'rejected'` the moment it sees one, but
          // its own `cancel()` call was refused while `foldingRef` was still
          // true, and nothing else retries it. Retry now that the lock is
          // clear — reachable in normal play (the pending's own deadline can
          // expire mid-animation), not merely theoretical.
          if (stagedRef.current?.phase === 'rejected') cancel()
        }
      })()
    },
    [
      enabled,
      handItems,
      state.comboOptions,
      state.you.hand,
      reduced,
      anchors.cover,
      anchors.sudo,
      anchors.handSlotAt,
      arrowCtl.stop,
      actions,
      cancel,
      coverFlight.mark,
      coverFlight.arm,
      coverFlight.settle,
      flyer.raise,
      flyer.drop,
    ],
  )

  // the projection moved our card out of the hand: the answer was accepted —
  // staging's job is done, the beat (or, absent one, the projection itself)
  // takes over. Same catch-up `_useBoardStaging.ts` runs for a dispatched play.
  // Checking only `main`'s uid is enough for the paired case too: the engine
  // takes both cards out of the hand in the SAME action, so `main` leaving
  // implies the whole play (support included) was accepted.
  //
  // NOT WHILE OUR OWN CARRIER IS STILL DELIVERING THE CARD (#101, Fix D round
  // 4). "The projection moved our card out of the hand" is only evidence that
  // this gesture is finished if the gesture is not, at that very moment, still
  // carrying the card across the table — and it usually is. `commitAndFly`
  // dispatches the RESOLVE synchronously and only then starts the fan→cover
  // flight, so the engine's answer comes back INSIDE that flight: always for a
  // host, whose engine is local, and for a client on any round trip shorter
  // than one flight. That answer arrives on a commit where `useBeats` has no
  // shadow yet, so the board reads `live` — no pending, our card gone from the
  // hand — and this effect fired and threw the staging away. One commit later
  // the beat's shadow renders `base`, where the card is back in the hand and
  // nothing is filtering it any more, so the card the player had just played
  // POPPED BACK INTO THE FAN and sat there for the whole beat, beside the copy
  // standing at the centre.
  //
  // `landed` is exactly the right question because both dispatch paths set it:
  // false at the dispatch, true when their carrier lets go (or at once under
  // reduced motion, and on every early exit — see both `finally` blocks). So
  // this cannot strand the staging: `landed` is in the deps, so the effect
  // re-runs the moment the carrier does let go, and clears then if the
  // projection still says the card is gone. If a beat is running instead, the
  // shadow puts the card back in `state.you.hand` and there is nothing to
  // clear — the beat's own `release()` ends the staging, which is the designed
  // hand-over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitStaged closes only over refs/setStaged and is stable in effect
  useEffect(() => {
    const s = stagedRef.current
    if (s?.phase !== 'dispatched' || !s.main) return
    if (!landed) return
    if (!state.you.hand.some((c) => c.uid === s.main?.uid)) commitStaged(null)
  }, [state.you.hand, landed])

  // the engine said no: the staged defence returns to the fan. A rejected
  // RESOLVE carries no top-level `card` (packages/engine/src/fake/core.ts's
  // `reject()` logs the whole original Action) — the card lives inside
  // `action.choice`, so the watcher matches the pending's own identity there
  // instead of `_useBoardStaging.ts`'s `'card' in e.action` check, which a
  // RESOLVE action never satisfies. `action.choice.card` names the MAIN
  // defence regardless of whether a Sudo rode along, so this needs no
  // widening for the paired case. Scoped to what arrived AFTER this dispatch
  // (`dispatchWatermarkRef`), same reason as `_useBoardStaging.ts`'s own watcher.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitStaged closes only over refs/setStaged and is stable in effect
  useEffect(() => {
    const s = stagedRef.current
    if (s?.phase !== 'dispatched' || !s.main) return
    const uid = s.main.uid
    const fresh = coverFlight.since(events)
    const rejectedOurs = fresh.some((e) => {
      if (e.type !== 'rejected') return false
      const a = e.action
      return a.type === 'RESOLVE' && a.choice.kind === 'defend' && a.choice.card === uid
    })
    if (rejectedOurs) {
      // synchronously, ahead of `cancel()`'s own guard read of `.phase` — same
      // reason as `_useBoardStaging.ts`'s own write here
      commitStaged({ ...s, phase: 'rejected' })
      cancel()
    }
  }, [events, cancel, coverFlight.since])

  // the beat's own clear (Task 13's `defenseBeat.runCovered`) — no flight,
  // just done: the staged node was already standing where the cover goes, so
  // there is nothing here left to double-check. Kept distinct from the
  // flyer's own teardown below — `release()` clears the STAGING state; the
  // flyer that was carrying the visual is dropped by the SAME `onHandPlay`
  // closure once its own flight lands, `landed`'s own comment above.
  // The beat has taken the card over. The static cover render must let go —
  // the beat's exit is flying that card now — but the play is NOT back in the
  // player's hand, and clearing the staging here said that it was.
  //
  // While a beat runs the board renders its SHADOW: `base`, the projection
  // from BEFORE the batch, whose `you.hand` still holds the card that was
  // played. `handItems` filters the fan by what is staged, so nulling the
  // staging here stopped the filtering and popped the played card back into
  // the fan — visible beside its own copy flying to the discard, for the whole
  // length of the exit.
  //
  // So this hands the slot over without ending the play: the cover render
  // checks `handed`, the fan filter does not, and the catch-up effect below
  // clears the staging for real once the queue drains onto a projection that
  // has actually taken the card out of the hand.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitStaged closes only over refs/setStaged and is stable, the same reason every other caller in this file suppresses it
  const release = useCallback(() => {
    const s = stagedRef.current
    if (s) commitStaged({ ...s, handed: true })
  }, [])

  // A NEW MATCH wipes the gesture (#101, Fix C, finding 3) — the same boundary,
  // idiom and reasoning as `_useBoardStaging.ts`'s own reset and `useBeats`'s
  // before it. `<Board>` is not remounted for a rematch, so a defence left
  // standing over an attack from the dead match would keep standing on the new
  // table, and this hook's carriers would keep flying to a hand that no longer
  // holds what they were carrying.
  //
  // The key it hangs on does not change per match on this branch, as of
  // 2026-08-20 (#101, Fix D, finding 3): `intro.gameId` is the host's own peer
  // id, the same for every match of a room, so this effect never fires on a
  // rematch. A property of the branch rather than a law — in-place rematch work
  // (#19) gives each match its own id, which makes this boundary live without
  // anything here changing. The reset is right either way, and `useBeats`
  // shares the same key — see
  // `_useBoardStaging.ts`'s `Options.matchKey` and
  // `docs/animations/backlog.md`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `matchKey` is the boundary and the only dependency this may have. `arrowCtl.stop` and `flyer.drop` happen to be memoized, but `arrival.reset` is a plain function `useHandArrival` recreates on every render — so listing what the body touches would wipe the gesture on every render instead of once per match. The closure is this render's, which is exactly what a wipe wants.
  useLayoutEffect(() => {
    commitStaged(null)
    cancellingRef.current = false
    foldingRef.current = false
    setCancelling(false)
    coverFlight.reset()
    sudoFlight.reset()
    arrowCtl.stop()
    flyer.drop()
    arrival.reset()
  }, [matchKey])

  return {
    staged,
    overlay: [...flyer.overlay, ...arrival.overlay],
    gapAt: arrival.gapAt,
    gapSize: arrival.gapSize,
    handItems,
    arrow: arrowCtl,
    accentAt,
    stateAt,
    onHandPlay,
    onCardClick,
    cancel,
    release,
    landed,
    sudoLanded,
  }
}
