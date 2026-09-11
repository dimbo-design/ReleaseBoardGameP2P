import type { Event } from '@release/engine'
import type { TableActions } from '@release/ui'
import { Card, ConfirmAction, cardById, Typography } from '@release/ui'
import { HEAP_SHOW, play, scatterAt, useDiscardExit, useHandArrival } from '@release/ui/animations'
import type { ReactNode, RefObject } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BoardAnchors, BoardState } from '~/entities/game/board'
import type { DiscardPickHandoff } from '~/entities/game/board/types'
import { useReducedMotion } from '~/shared/lib/useReducedMotion'
import styles from './_useCherryPickStaging.module.css'
import { useResolveFeedback } from './_useResolveFeedback'

// The grid owns the local accepted pick; the event queue awaits its flight
// instead of animating a second copy from the discard. The heap is empty
// while its cards are in the grid, matching the playground scene.
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
  handoff: RefObject<DiscardPickHandoff | null>
  state: BoardState
  events?: Event[]
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
}): { grid: ReactNode | null; overlay: ReactNode[]; gapAt: number | null; gapSize: number } {
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
  const exit = useDiscardExit(anchors.discardBox)
  const arrival = useHandArrival(anchors.hand, () => {})

  // Declared above the auto-answer effect below, which lists it as a
  // dependency. A dependency array is read during render, so a `const`
  // declared further down would not exist yet at that point.
  const resolve = useResolveFeedback(args.events ?? [], state.selfId, actions, () => {
    setConfirmed(false)
    setFlying(false)
    setFlipped(new Set())
    clearTimers()
    for (const el of cellRefs.current.values()) {
      for (const animation of el.getAnimations?.() ?? []) animation.cancel()
      el.style.cssText = ''
    }
  })

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
    resolve({ kind: 'pickFromDiscard', card: only.uid })
  }, [ours, resolve])

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

  const max = ours?.picks ?? (sudo ? 2 : 1)

  // A trigger may only ever hold the DECK slot, and that slot exists only when
  // two cards are taken — so a set of picks is legal while it holds no more
  // triggers than it has deck slots. Stated over the resulting SET rather than
  // per candidate card, because a swap has to be judged the same way an
  // addition is: by what the player would be left holding.
  const legal = (set: string[]) =>
    set.filter((u) => isTrigger(idOfOption(options, u))).length <= (max === 2 ? 1 : 0)

  // What one click does. A picked card is released; an unpicked one joins while
  // there is room, and once there is none it takes the OLDEST pick's place
  // instead of being ignored.
  //
  // Ignoring it is what made a mis-click uncorrectable: every other card went
  // inert the moment `picks` filled, and the only way out was to guess that
  // clicking the CHOSEN card releases it. Nothing said so, so the grid read as
  // broken — which is how it was reported off the deployed playground.
  //
  // Returns `p` ITSELF when the click changes nothing, which is what lets
  // `canSelect` below be "would this click do anything?" rather than a second
  // copy of these rules that can drift out of step with them.
  const nextPicks = (p: string[], uid: string): string[] => {
    if (p.includes(uid)) return p.filter((u) => u !== uid)
    const grown = p.length < max ? [...p, uid] : [...p.slice(1), uid]
    return legal(grown) ? grown : p
  }

  const canSelect = (uid: string) => nextPicks(picks, uid) !== picks

  const ready = ours ? picks.length === ours.picks : false

  // Pin all cells together only after acceptance. The queue owns the
  // lifetime, so a refused choice never plays a success animation.
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
      resolve(choice)
      return
    }

    setConfirmed(true)
    args.handoff.current = {
      card: ours.options.find((o) => o.uid === hand)?.id ?? '',
      run: () =>
        new Promise<void>((done) => {
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

          const remaining = ours.options.filter((o) => o.uid !== hand && o.uid !== deck)
          void exit.send(
            remaining.flatMap((o, i) => {
              const card = cardById(o.id)
              if (!card) return []
              const rest = state.decks.discardHeap?.find((h) => h.card.id === o.id)
              return [
                {
                  key: o.uid,
                  card,
                  node: cellRefs.current.get(o.uid),
                  scatter: rest ?? scatterAt(i, 116),
                  fade: i < remaining.length - HEAP_SHOW,
                  delay: Math.min(i, STAGGER_CAP) * 14,
                  layer: i,
                },
              ]
            }),
          )
          const returnDone = 420 + Math.min(remaining.length, STAGGER_CAP) * 14
          const deckDone = deck ? FLIP_DUR + DECK_DUR + DECK_HOLD : 0
          later(
            () => {
              setFlying(false)
              done()
            },
            Math.max(returnDone, deckDone, HAND_MIN) + 100,
          )
        }),
    }
    resolve(choice)
  }

  const overlay = [...arrival.overlay, ...exit.overlay]
  const gaps = { gapAt: arrival.gapAt, gapSize: arrival.gapSize }

  if (
    !flying &&
    (!ours || (confirmed && reduced) || (ours.picks === 1 && ours.options.length < 2))
  ) {
    return { grid: null, overlay, ...gaps }
  }

  return {
    grid: (
      // Full-area, transform-free and `pointer-events: none` — see the
      // header comment on `.grid` in the module CSS for why. `.cells` (the
      // actual card row) and the confirm bar re-enable their own pointer
      // events, so clicks pass through everywhere else on this layer.
      <div className={styles.grid} data-testid="board-cherry-grid">
        <div className={`${styles.cells} ${dealing ? styles.dealing : ''}`}>
          {options.map((o) => {
            const data = cardById(o.id)
            if (!data) return null
            const handRole = roles.hand === o.uid
            const deckRole = roles.deck === o.uid
            const selected = handRole || deckRole
            const blocked = !confirmed && !selected && !canSelect(o.uid)
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
                  setPicks((p) => nextPicks(p, o.uid))
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
        </div>
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
    ...gaps,
  }
}

const idOfOption = (options: { uid: string; id: string }[], uid: string) =>
  options.find((o) => o.uid === uid)?.id ?? ''
