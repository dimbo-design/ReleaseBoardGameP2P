import type { Event } from '@release/engine'
import type { TableActions } from '@release/ui'
import { Card, ConfirmAction, cardById, Typography } from '@release/ui'
import { play, useCardReorder } from '@release/ui/animations'
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BoardAnchors, BoardState } from '~/entities/game/board'
import { useReducedMotion } from '~/shared/lib/useReducedMotion'
import styles from './_useRebaseStaging.module.css'
import { useResolveFeedback } from './_useResolveFeedback'

// Git Rebase — the top of a pile, shown to its owner and to nobody else. The
// privacy is not enforced here: `pendingView` hands every other peer an empty
// `piles`, so there is nothing for this hook to hide. What the table sees is
// the card's own flight to the discard, which the ordinary discard run plays.
//
// Sudo lays one row per pile, sharing a single 1-2-3 numbering across them, as
// the story does — the numbers name positions in a pile, and every pile has the
// same three positions.
//
// The board and playground share the same drag, insertion preview and drop.
//
// THE FLIGHTS (Task D2): ported from the approved playground scene
// (`apps/playground/stories/interactive/GitCards/Rebase.tsx`), values verbatim.
// Two legs travel — out of the pile into the row, and face-down back onto it in
// the order that was chosen.
//
// ONE DIVERGENCE FROM `_useCherryPickStaging`, and it is deliberate: that hook
// dispatches its RESOLVE at once and lets the flight run behind it, because the
// card it picked has somewhere visible to be. Rebase's plan (#108, task D2)
// asks for the opposite — the RESOLVE fires when the last card lands — because
// nothing about a committed reorder is visible in the projection (a deck's
// contents are never projected), so there is no second renderer to race, and
// the flight IS the whole of what the player is told happened. Reduced motion
// still answers at once: a game action must never wait on an animation nobody
// plays (`_useInsideStaging`'s rule).
type Order = Record<number, string[]>

// timings — the approved scene
const DEAL_DUR = 520 // cards fly out of the pile into the row
const DEAL_STEP = 80 // per-card stagger dealing out
const DEAL_HOLD = 200 // settle before the row is interactive
const FLIP_DUR = 420 // = the flipCard preset (flip face-down before flying back)
const FLIP_HOLD = 260 // hold face-down before the flight
const BACK_DUR = 600 // = the returnToDeck flight
const BACK_STEP = 90 // per-card stagger flying back

// centre-to-centre translate + scale — the same helper the sibling hook keeps
// privately, copied rather than imported across staging hooks.
function between(from: DOMRect, to: DOMRect): string {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  return `translate(${dx}px, ${dy}px) scale(${to.width / from.width})`
}

interface Pile {
  pile: number
  cards: { uid: string; id: string }[]
}

export function useRebaseStaging(args: {
  state: BoardState
  events?: Event[]
  anchors: BoardAnchors
  actions?: TableActions
  copy: { prompt: string; position: string; confirm: string }
  enabled: boolean
}): { row: ReactNode | null } {
  const { state, anchors, actions, copy, enabled } = args
  const reduced = useReducedMotion()
  const pending = state.pending
  const ours =
    enabled &&
    pending?.kind === 'reorderTop' &&
    pending.player === state.selfId &&
    pending.piles.length > 0
      ? pending
      : null

  const [order, setOrder] = useState<Order>({})
  const [confirmed, setConfirmed] = useState(false)
  // true from confirm through the last flight landing — keeps the cards (now
  // pinned and animating) mounted after `confirmed`, the same way the sibling
  // hook's own `flying` outlives its dispatch.
  const [flying, setFlying] = useState(false)
  const [faceDown, setFaceDown] = useState(false)
  const [ready, setReady] = useState(reduced)

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // The last offer this hook actually saw, read during render — the flight
  // keeps drawing the row from its own snapshot once `ours` goes null.
  const pilesRef = useRef<Pile[]>([])
  if (ours) pilesRef.current = ours.piles
  const piles: Pile[] = ours ? ours.piles : pilesRef.current

  const offerKey = ours
    ? `${ours.player}:${ours.piles.map((entry) => `${entry.pile}/${entry.cards.map((c) => c.uid).join(',')}`).join('|')}`
    : null
  const reorder = useCardReorder({
    enabled: Boolean(ours) && ready && !confirmed,
    step: 180,
    rows: piles.map((entry) => ({
      id: entry.pile,
      cards: order[entry.pile] ?? entry.cards.map((c) => c.uid),
    })),
    onReorder: (pile, cards) => setOrder((current) => ({ ...current, [pile]: cards })),
  })

  const dealtKey = useRef<string | null>(null)
  const timers = useRef<number[]>([])
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
  }
  // No timer survives the hook.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once by design — `clearTimers` is a plain function recreated every render, so listing it would clear timers on every render instead of only on unmount
  useLayoutEffect(() => clearTimers, [])

  // Seeded from the offer, and re-seeded when a different pending opens. Keyed
  // on the pending rather than the mount, the discipline `_useInsideStaging`
  // states: a latch that outlives what it latches is a bug. `flying` is left
  // alone on purpose — it clears when its own flight lands, and a projection
  // tick clearing the pending mid-flight must not cut it short.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reseed only for a different offer, not a fresh projection object
  useEffect(() => {
    if (!ours) {
      setOrder({})
      setConfirmed(false)
      return
    }
    setOrder(Object.fromEntries(ours.piles.map((e) => [e.pile, e.cards.map((c) => c.uid)])))
  }, [offerKey])

  // Deal the offer OUT of its pile into the row: every card starts at the
  // pile's own rect and flies to its slot, staggered. Cosmetic only — the row
  // is answerable throughout, so this never gates a click.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires once per episode (guarded by `dealtKey`), not on every render `ours` produces a new identity for
  useLayoutEffect(() => {
    if (!ours) {
      dealtKey.current = null
      return
    }
    const key = `${ours.player}:${ours.piles.map((e) => `${e.pile}/${e.cards.map((c) => c.uid).join(',')}`).join('|')}`
    if (dealtKey.current === key) return
    dealtKey.current = key
    setReady(reduced)
    if (reduced) return
    later(
      () => setReady(true),
      DEAL_DUR +
        Math.max(...ours.piles.map((entry) => entry.cards.length - 1)) * DEAL_STEP +
        DEAL_HOLD,
    )
    for (const entry of ours.piles) {
      const pileRect = anchors.pileBox(entry.pile)?.getBoundingClientRect()
      if (!pileRect) continue
      const els = entry.cards.map((c) => cardRefs.current.get(c.uid))
      const rests = els.map((el) => el?.style.transform ?? '')
      for (const el of els) {
        if (!el) continue
        el.style.transition = 'none'
        el.style.transform = `${el.style.transform} ${between(el.getBoundingClientRect(), pileRect)}`
        el.style.opacity = '0'
      }
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          els.forEach((el, i) => {
            if (!el) return
            const delay = i * DEAL_STEP
            el.style.transition = `transform ${DEAL_DUR}ms var(--ease-out) ${delay}ms, opacity ${DEAL_DUR}ms ${delay}ms`
            el.style.transform = rests[i]
            el.style.opacity = ''
          })
          later(
            () => {
              for (const el of els) {
                if (!el) continue
                el.style.transition = ''
              }
            },
            DEAL_DUR + entry.cards.length * DEAL_STEP + DEAL_HOLD,
          )
        }),
      )
    }
  }, [ours, reduced, anchors])

  const resolve = useResolveFeedback(args.events ?? [], state.selfId, actions, () => {
    setConfirmed(false)
    setFlying(false)
    setFaceDown(false)
    setReady(true)
    clearTimers()
    for (const el of cardRefs.current.values()) {
      for (const animation of el.getAnimations?.() ?? []) animation.cancel()
      el.style.cssText = ''
    }
    setOrder(
      Object.fromEntries((ours?.piles ?? []).map((e) => [e.pile, e.cards.map((c) => c.uid)])),
    )
  })

  if ((!ours && !flying) || (confirmed && !flying)) return { row: null }

  const confirm = () => {
    if (!ours || confirmed || !ready || reorder.drag) return
    // Committed against THIS render's offer: every offered pile, answered
    // exactly once, or the engine rejects it.
    const committed = ours.piles.map((e) => ({
      pile: e.pile,
      cards: order[e.pile] ?? e.cards.map((c) => c.uid),
    }))
    const choice = { kind: 'reorderTop' as const, order: committed }

    // A game action must never wait on an animation nobody plays
    // (`_useInsideStaging`'s rule). The engine gets its answer either way;
    // only the moment differs.
    if (reduced) {
      setConfirmed(true)
      resolve(choice)
      return
    }

    setConfirmed(true)
    setFlying(true)
    // The order stays secret, so the cards turn their backs before they travel.
    setFaceDown(true)

    later(() => {
      let last = 0
      for (const entry of committed) {
        const pileRect = anchors.pileBox(entry.pile)?.getBoundingClientRect()
        entry.cards.forEach((uid, i) => {
          const el = cardRefs.current.get(uid)
          if (!el) return
          const r = el.getBoundingClientRect()
          el.style.transition = 'none'
          el.style.transform = 'none'
          el.style.position = 'fixed'
          el.style.left = `${r.left}px`
          el.style.top = `${r.top}px`
          el.style.inlineSize = `${r.width}px`
          el.style.margin = '0'
          // position 1 lands on top of the pile
          el.style.zIndex = `${50 + (entry.cards.length - i)}`
          const delay = i * BACK_STEP
          last = Math.max(last, delay)
          if (!pileRect) return
          later(
            () => play('returnToDeck', el, { from: r, to: pileRect, duration: BACK_DUR }),
            delay,
          )
        })
      }
      // The answer goes when the last card is home — see the divergence note
      // in this file's header for why this one waits and Cherry-pick's does not.
      later(() => {
        setFlying(false)
        setFaceDown(false)
        resolve(choice)
      }, last + BACK_DUR)
    }, FLIP_DUR + FLIP_HOLD)
  }

  return {
    row: (
      <>
        <div className={styles.rows} data-testid="board-rebase-row">
          {piles.map((entry) => (
            <div
              key={entry.pile}
              className={styles.row}
              style={{ inlineSize: entry.cards.length * 180 - 30 }}
            >
              {entry.cards.map((c, i) => (
                <Typography
                  key={c.uid}
                  variant="tag"
                  className={styles.position}
                  style={{ insetInlineStart: i * 180 }}
                >
                  {i + 1}
                </Typography>
              ))}
              {(order[entry.pile] ?? entry.cards.map((c) => c.uid)).map((uid, i) => {
                const offered = entry.cards.find((c) => c.uid === uid)
                const data = offered ? cardById(offered.id) : null
                if (!data) return null
                const position = reorder.position(entry.pile, uid, i)
                return (
                  <div
                    key={uid}
                    className={`${styles.slot} ${position.dragging ? styles.dragging : ''}`}
                    data-testid={`rebase-card-${uid}`}
                    style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
                    onPointerDown={(e) => reorder.onPointerDown(entry.pile, uid, e)}
                    ref={(el) => {
                      if (el) cardRefs.current.set(uid, el)
                      else cardRefs.current.delete(uid)
                    }}
                  >
                    <Card card={data} interactive={false} width="100%" faceDown={faceDown} />
                    {!confirmed && (
                      <button
                        type="button"
                        data-testid={`rebase-move-${uid}`}
                        className={styles.move}
                        aria-label={`${copy.position} ${i + 1}`}
                        disabled={!ready}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <ConfirmAction
          open={!confirmed && ready}
          label={copy.confirm}
          caption={copy.prompt}
          onConfirm={confirm}
        />
      </>
    ),
  }
}
