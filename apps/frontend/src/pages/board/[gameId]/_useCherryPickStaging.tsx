import type { TableActions } from '@release/ui'
import { Card, ConfirmAction, cardById, Typography } from '@release/ui'
import { play, useHandArrival } from '@release/ui/animations'
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BoardAnchors, BoardState } from '~/entities/game/board'
import { useReducedMotion } from '~/shared/lib/useReducedMotion'
import styles from './_useCherryPickStaging.module.css'

// Git Cherry-pick — the OTHER `pickFromDiscard` (see `_useInsideStaging.tsx`,
// which owns `ai-inside`). Two things make it a sibling rather than a widening
// of that row: the offer is the whole discard rather than its Releases, so it
// scrolls, and a sudo pick fills two slots whose roles are decided by rule
// rather than by click order.
//
// The two roles come from the ENGINE's own offer, not from a rule re-derived
// here: `openPickFromDiscard` withholds triggers from a base pick, and
// `onPickFromDiscard` refuses one the hand slot. So a trigger in `options` can
// only be the deck card, and that is the whole of the rule this hook needs.
//
// The grid stands OVER an unchanged heap: the engine leaves the candidates in
// `decks.discard` until the pick resolves, so nothing is lifted out of the
// projection while it is being chosen from.
//
// THE FLIGHTS (Task A4, corrected in a fix round after review): ported from
// the approved playground scene (`apps/playground/stories/interactive/
// GitCards/CherryPick.tsx`'s own `confirmPick()`), timings verbatim for the
// two legs that actually travel. Two things differ from that story, both
// load-bearing on the board rather than a sandbox:
//   • only the CHOSEN cards fly — the hand card to the centre and into the
//     fan, the sudo card flipping and onto the deck. The UNPICKED cards never
//     leave the projection and so never fly either: the engine keeps them in
//     `decks.discard` until the pick resolves, and the heap above this grid
//     renders that same `decks.discard` the whole time the grid is open. A
//     return flight for them would draw each one TWICE — once as a flying
//     cell, once already resting in the heap underneath — and land it on a
//     scatter pose the heap doesn't key by (array position, not the discard
//     event's own id), so even without the double-draw it would jump at the
//     moment the flight ends. The story needs that leg because its own
//     discard is local state it emptied into the grid; the board's discard
//     was never emptied, so the grid simply reveals it again when it goes.
//   • a game action must never wait on an animation nobody plays
//     (`_useInsideStaging`'s rule): under reduced motion the RESOLVE fires at
//     once and the grid unmounts with nothing ever having flown.
const isTrigger = (id: string) => cardById(id)?.category === 'trigger'

// timings — the approved scene, the three legs that actually travel (deal,
// hand-reveal, deck)
const DEAL_DUR = 360 // dealing out of the pile into the grid
const DEAL_STEP = 16 // per-card stagger, dealing out
const STAGGER_CAP = 40 // don't stagger past this many cards
const REVEAL_W = 220 // width the chosen card reaches in the centre
const REVEAL_DUR = 460 // fly-to-centre duration
const REVEAL_HOLD = 560 // pause in the centre before dropping into the hand
const HAND_MIN = REVEAL_DUR + REVEAL_HOLD + 520 // total before the round can finish
const FLIP_DUR = 420 // = the flipCard preset duration (flip before the deck flight)
const DECK_DUR = 480 // = the returnToDeck preset duration
const DECK_HOLD = 360 // deck card holds face-down before it merges

// centre-to-centre translate + scale to move an element from one rect to
// another — the story's own `between()`, ported verbatim.
function between(from: DOMRect, to: DOMRect): string {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  return `translate(${dx}px, ${dy}px) scale(${to.width / from.width})`
}

export function useCherryPickStaging(args: {
  state: BoardState
  anchors: BoardAnchors
  actions?: TableActions
  copy: {
    prompt: string
    sudoPrompt: string
    toHand: string
    toDeck: string
    noHand: string
    confirm: string
  }
  enabled: boolean
}): { grid: ReactNode | null; overlay: ReactNode[] } {
  const { state, anchors, actions, copy, enabled } = args
  const reduced = useReducedMotion()
  const pending = state.pending
  const ours =
    enabled &&
    pending?.kind === 'pickFromDiscard' &&
    pending.source === 'operation-git-cherry-pick' &&
    pending.player === state.selfId
      ? pending
      : null

  const [picks, setPicks] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false)
  // true from confirm through the last flight landing — keeps the cells (now
  // pinned/animating) mounted even once `confirmed` (or the pending itself)
  // has already gone, the same way `_useHandLimit`'s `handed` outlives its own
  // dispatch.
  const [flying, setFlying] = useState(false)
  const [dealing, setDealing] = useState(false)
  const [flipped, setFlipped] = useState<Set<string>>(new Set())

  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  // The last offer this hook actually saw — read during render (the same
  // carry-forward `_Board.tsx`'s own `lastAsk` ref uses) so the flight can
  // keep rendering the grid from ITS OWN snapshot once `ours` goes null
  // (the pending clears the instant the engine answers the RESOLVE, which can
  // easily outrun the flight it is honest about still being mid-air).
  const optionsRef = useRef<{ uid: string; id: string }[]>([])
  const sudoRef = useRef(false)
  if (ours) {
    optionsRef.current = ours.options
    sudoRef.current = ours.picks === 2
  }
  const options = ours ? ours.options : optionsRef.current
  const sudo = ours ? ours.picks === 2 : sudoRef.current

  // One dealt-in per episode, not per render: the pending's own identity can
  // change across re-renders (a projection tick) without the offer itself
  // changing, and re-running the deal would fly the same cards a second time.
  const dealtKey = useRef<string | null>(null)
  const timers = useRef<number[]>([])
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
  }
  // No timer survives the hook. useLayoutEffect with no deps: mount-once,
  // cleanup-on-unmount only — the same idiom the story's own version uses.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once by design — `clearTimers` is a plain function recreated every render, so listing it would clear timers on every render instead of only on unmount
  useLayoutEffect(() => clearTimers, [])

  // the chosen card settles into the hand (the shared step every other
  // arrival on the board uses) — nothing here mirrors the hand locally, the
  // fan already renders straight off the projection's own `you.hand`.
  const arrival = useHandArrival(anchors.hand, () => {})

  // One candidate is not a choice — `_useInsideStaging`'s precedent, and
  // #105's Decision 2 before it. Latched on the pending rather than the mount,
  // so a second, distinct pending is free to fire again.
  const answered = useRef<string | null>(null)
  useEffect(() => {
    if (!ours) {
      answered.current = null
      return
    }
    if (ours.picks !== 1 || ours.options.length !== 1) return
    const only = ours.options[0]
    const key = `${ours.player}:${ours.source}:${only.uid}`
    if (answered.current === key) return
    answered.current = key
    actions?.onResolve?.({ kind: 'pickFromDiscard', card: only.uid })
  }, [ours, actions])

  // Nothing armed survives the pending it was armed for. `flying` is left
  // alone here on purpose — it clears itself once its own flight lands, and a
  // projection tick clearing the pending mid-flight must not cut it short.
  useEffect(() => {
    if (!ours) {
      setPicks([])
      setConfirmed(false)
      setFlipped(new Set())
    }
  }, [ours])

  // deal the offer OUT of the discard pile into the grid: every cell starts
  // at the pile's own rect and flies to its slot, staggered — purely cosmetic,
  // so it never gates a click (the discard is face-up and known throughout).
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires once per episode (guarded by `dealtKey`), not on every render `ours`/`options` produce a new identity for
  useLayoutEffect(() => {
    if (!ours) {
      dealtKey.current = null
      return
    }
    const key = `${ours.player}:${ours.source}:${ours.options.map((o) => o.uid).join(',')}`
    if (dealtKey.current === key) return
    dealtKey.current = key
    if (reduced) return
    const pileRect = anchors.discardBox.current?.getBoundingClientRect()
    if (!pileRect) return
    const els = ours.options.map((o) => cellRefs.current.get(o.uid))
    if (els.every((el) => !el)) return
    for (const el of els) {
      if (!el) continue
      el.style.transition = 'none'
      el.style.transform = between(el.getBoundingClientRect(), pileRect)
      el.style.opacity = '0'
    }
    setDealing(true)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        els.forEach((el, i) => {
          if (!el) return
          const delay = Math.min(i, STAGGER_CAP) * DEAL_STEP
          el.style.transition = `transform ${DEAL_DUR}ms var(--ease-out) ${delay}ms, opacity ${DEAL_DUR}ms ${delay}ms`
          el.style.transform = ''
          el.style.opacity = ''
        })
        const total = DEAL_DUR + Math.min(els.length, STAGGER_CAP) * DEAL_STEP + 60
        later(() => {
          for (const el of els) if (el) el.style.transition = ''
          setDealing(false)
        }, total)
      }),
    )
  }, [ours, reduced])

  // roles by the rules: a trigger (if chosen) is always the deck card; a
  // non-trigger always takes the hand slot; else first-chosen → hand, second → deck
  const roles = (() => {
    if (!sudo) return { hand: picks[0] ?? null, deck: null as string | null }
    const [a, b] = picks
    const idOf = (uid?: string) => options.find((o) => o.uid === uid)?.id
    if (picks.length === 1) {
      const id = idOf(a)
      return id && isTrigger(id)
        ? { hand: null as string | null, deck: a }
        : { hand: a, deck: null as string | null }
    }
    const idA = idOf(a)
    if (idA && isTrigger(idA)) return { hand: b, deck: a }
    return { hand: a, deck: b }
  })()

  const canSelect = (uid: string, id: string) => {
    if (picks.includes(uid)) return true
    if (picks.length >= (ours?.picks ?? (sudo ? 2 : 1))) return false
    if (!isTrigger(id)) return true
    // Only one trigger may be held, and only for the single deck slot.
    return sudo && !picks.some((u) => isTrigger(idOfOption(options, u)))
  }

  const ready = ours ? picks.length === ours.picks : false

  // confirm: freeze every cell at its viewport rect first — position:fixed
  // both escapes the grid's own scroll clip AND, pinned all at once, causes no
  // reflow (ALL cells are pinned, not just the two that travel — leaving an
  // unpicked neighbour unpinned would reflow it into the space a picked
  // card's own `position: fixed` vacates). Then the chosen card reveals to
  // centre and drops into the hand, and the sudo card flips then flies onto
  // the deck top. The rest simply stay put — pinned at the exact rect they
  // already stood in, which changes nothing, since the heap under this grid
  // has held them the whole time (see the header above); they surface again,
  // unmoved, the instant the grid goes. Ported from the story's own
  // `confirmPick()` — the two-pass rect capture is kept exactly as written,
  // for exactly its own reason: pinning one cell reflows the rest, so a single
  // read-and-pin loop would capture already-shifted positions for every card
  // after the first.
  const confirmPick = () => {
    if (!ours || confirmed || !ready) return
    const hand = roles.hand
    // re-checked against THIS render's offer, the discipline every branch of
    // the kit's own panel keeps
    if (!hand || !ours.options.some((o) => o.uid === hand)) return
    const deck = roles.deck
    const choice = {
      kind: 'pickFromDiscard' as const,
      card: hand,
      ...(deck ? { toDeck: deck } : {}),
    }

    // A game action must never wait on an animation nobody plays
    // (`_useInsideStaging`'s rule). Under reduced motion the RESOLVE goes now
    // and the grid simply unmounts.
    if (reduced) {
      setConfirmed(true)
      actions?.onResolve?.(choice)
      return
    }

    // Dispatched at once, same as every other staging hook on this board —
    // the flight below is what happens with the LOCAL choice while the
    // network catches up, not a gate in front of it.
    setConfirmed(true)
    actions?.onResolve?.(choice)
    setFlying(true)

    const handData = cardById(ours.options.find((o) => o.uid === hand)?.id ?? '')
    const deckOpt = deck ? ours.options.find((o) => o.uid === deck) : undefined
    const deckData = deckOpt ? cardById(deckOpt.id) : undefined
    const deckRect = anchors.pileBox(0)?.getBoundingClientRect()

    // pass 1: read EVERY cell's rect first, before touching layout.
    const rects = new Map<string, DOMRect>()
    for (const o of ours.options) {
      const el = cellRefs.current.get(o.uid)
      if (el) rects.set(o.uid, el.getBoundingClientRect())
    }
    // pass 2: pin them all at their captured rects (no more reflow matters)
    for (const o of ours.options) {
      const el = cellRefs.current.get(o.uid)
      const r = rects.get(o.uid)
      if (!el || !r) continue
      el.style.position = 'fixed'
      el.style.left = `${r.left}px`
      el.style.top = `${r.top}px`
      el.style.width = `${r.width}px`
      el.style.margin = '0'
      el.style.zIndex = '100'
    }

    // chosen → hand: fly to centre, enlarge, hold, then the shared
    // useHandArrival drop into the fan — same as taking an opponent card
    const handEl = cellRefs.current.get(hand)
    const handRect = rects.get(hand)
    if (handData && handEl && handRect) {
      const stage = anchors.centre.current?.getBoundingClientRect()
      const cx = stage ? stage.left + stage.width / 2 : window.innerWidth / 2
      const cy = stage ? stage.top + stage.height / 2 : window.innerHeight / 2
      const dx = cx - (handRect.left + handRect.width / 2)
      const dy = cy - (handRect.top + handRect.height / 2)
      handEl.style.zIndex = '130'
      handEl.style.transition = `transform ${REVEAL_DUR}ms var(--ease-soft)`
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          handEl.style.transform = `translate(${dx}px, ${dy}px) scale(${REVEAL_W / handRect.width})`
        }),
      )
      later(() => {
        const el = cellRefs.current.get(hand)
        if (!el) return
        // the card on screen IS the one that flies — the step measures it and
        // takes it off screen itself, no local copy and no opacity trick
        void arrival.arrive(
          [{ key: `cherry-hand-${hand}`, card: handData, el }],
          state.you.hand.length,
        )
      }, REVEAL_DUR + REVEAL_HOLD)
    }

    // chosen → deck top: flip face-down in place FIRST, then fly onto the deck
    if (deck && deckData && deckRect) {
      const el = cellRefs.current.get(deck)
      if (el) el.style.zIndex = '120' // above the deck pile — lands on top, not under
      setFlipped(new Set([deck]))
      later(() => {
        const dEl = cellRefs.current.get(deck)
        const r = rects.get(deck)
        if (dEl && r) play('returnToDeck', dEl, { from: r, to: deckRect })
      }, FLIP_DUR)
    }

    // the rest never travel — see the header above. They stay exactly where
    // pass 2 pinned them (unmoved) until the grid unmounts below, at which
    // point the heap that was rendering them the whole time is all that's
    // left on screen. No flight, so nothing here to start or to wait on.

    // The round ends when the two legs that actually fly are both done — a
    // stationary cell has nothing to finish.
    const deckDone = deck ? FLIP_DUR + DECK_DUR + DECK_HOLD : 0
    const handDone = handData ? HAND_MIN : 0
    later(() => setFlying(false), Math.max(deckDone, handDone) + 100)
  }

  const overlay = arrival.overlay

  if (!flying && (!ours || confirmed || (ours.picks === 1 && ours.options.length < 2))) {
    return { grid: null, overlay }
  }

  return {
    grid: (
      <div
        className={`${styles.grid} ${dealing ? styles.dealing : ''}`}
        data-testid="board-cherry-grid"
      >
        {options.map((o) => {
          const data = cardById(o.id)
          if (!data) return null
          const handRole = roles.hand === o.uid
          const deckRole = roles.deck === o.uid
          const selected = handRole || deckRole
          const blocked = !confirmed && !selected && !canSelect(o.uid, o.id)
          return (
            <button
              key={o.uid}
              ref={(el) => {
                if (el) cellRefs.current.set(o.uid, el)
                else cellRefs.current.delete(o.uid)
              }}
              type="button"
              data-testid={`cherry-cell-${o.uid}`}
              className={`${styles.cell} ${blocked ? styles.blocked : ''}`}
              onClick={() => {
                if (confirmed) return
                setPicks((p) =>
                  p.includes(o.uid)
                    ? p.filter((u) => u !== o.uid)
                    : canSelect(o.uid, o.id)
                      ? [...p, o.uid]
                      : p,
                )
              }}
            >
              <Card
                card={data}
                interactive={false}
                width="100%"
                faceDown={flipped.has(o.uid)}
                state={selected ? 'selected' : 'idle'}
                // one out of a set — the uniform selection colour, never the
                // per-category accent
                accent="var(--select-accent)"
              />
              {handRole && (
                <Typography variant="tag" className={styles.roleTag}>
                  {copy.toHand}
                </Typography>
              )}
              {deckRole && (
                <Typography variant="tag" className={styles.roleTag}>
                  {copy.toDeck}
                </Typography>
              )}
              {!sudo && isTrigger(o.id) && (
                <Typography variant="tag" className={styles.lockTag}>
                  {copy.noHand}
                </Typography>
              )}
            </button>
          )
        })}
        <ConfirmAction
          open={!confirmed}
          label={copy.confirm}
          caption={sudo ? copy.sudoPrompt : copy.prompt}
          disabled={!ready}
          onConfirm={confirmPick}
        />
      </div>
    ),
    overlay,
  }
}

const idOfOption = (options: { uid: string; id: string }[], uid: string) =>
  options.find((o) => o.uid === uid)?.id ?? ''
