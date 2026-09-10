import type { TableActions } from '@release/ui'
import { Card, ConfirmAction, cardById } from '@release/ui'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { BoardState } from '~/entities/game/board'
import styles from './_useInsideStaging.module.css'

// Taking a Release back out of the discard — `ai-inside`, and ONLY
// `ai-inside`. Git Cherry-pick (`operation-git-cherry-pick`) also raises a
// `pickFromDiscard` pending, but over the WHOLE discard rather than its
// releases, and under sudo takes two (one to hand, one to the draw deck's
// top) — a shape this row was never built for. That pick is the shared
// panel's business (`PendingPrompt`'s own `pickFromDiscard` case, which
// already resolves `toDeck`), so `ours` below is gated on `source` and not
// merely on `kind`. Active only while an `ai-inside` `pickFromDiscard`
// pending is ours; its siblings (`_useRequestStaging`, `_useDefenseStaging`,
// `_useNeutralizeStaging`) never run at the same time, because a pending
// suspends normal play and a pending has one kind.
//
// The options are the OWNER'S: `pendingView` gates them behind `mine`
// (fake/attacks.ts), because only `discardTop`/`discardCount` are ever
// public. So the choice lives here and nobody else sees it — what everybody
// sees is the outcome, and that is a beat (`aiBeat.tsx`'s `runTaken`).
//
// The row stands OVER an unchanged heap. `AiCardsStory` lifts its candidates
// out of the discard while they are being chosen from, because its heap is
// local state; ours is the projection, and `openPickFromDiscard` leaves them
// in `decks.discard` until the pick resolves. Honest rather than clever.

export function useInsideStaging(args: {
  state: BoardState
  actions?: TableActions
  copy: { prompt: string; confirm: string }
  enabled: boolean
}): { row: ReactNode | null } {
  const { state, actions, copy, enabled } = args
  const pending = state.pending
  const ours =
    enabled &&
    pending?.kind === 'pickFromDiscard' &&
    pending.source === 'ai-inside' &&
    pending.player === state.selfId
      ? pending
      : null

  const [picked, setPicked] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  // ONE candidate is not a choice — `_useRequestStaging`'s own precedent for
  // `giveCard`, and the same reasoning transfers whole. It is answered at
  // once rather than on a timer: the beat queue already serialises, and the
  // readable pause belongs to the beat's own `SHOW_HOLD`, not to a second
  // opinion about pacing here.
  //
  // It lives here and NOT in a beat because `prefers-reduced-motion`
  // collapses every beat, and this is a game action: an engine left waiting
  // on an animation nobody plays is a stalled match.
  //
  // The latch is keyed on the pending itself, not on the mount — a latch
  // that outlives the thing it latches is a bug `useBeats` has been bitten
  // by twice in its own comments. Cleared the instant this hook is no
  // longer holding an ours-`pickFromDiscard` pending (the effect right
  // below this one), so a SECOND, distinct pending is free to fire again.
  const answered = useRef<string | null>(null)
  useEffect(() => {
    if (!ours) {
      answered.current = null
      return
    }
    if (ours.options.length !== 1) return
    const only = ours.options[0]
    const key = `${ours.player}:${ours.source}:${only.uid}`
    if (answered.current === key) return
    answered.current = key
    actions?.onResolve?.({ kind: 'pickFromDiscard', card: only.uid })
  }, [ours, actions])

  // Nothing armed survives the pending it was armed for.
  useEffect(() => {
    if (!ours) {
      setPicked(null)
      setConfirmed(false)
    }
  }, [ours])

  if (!ours || ours.options.length < 2 || confirmed) return { row: null }

  return {
    row: (
      <div className={styles.row} data-testid="board-inside-row">
        {ours.options.map((o) => {
          const data = cardById(o.id)
          if (!data) return null
          return (
            <button
              key={o.uid}
              type="button"
              className={styles.cell}
              onClick={() => setPicked(o.uid)}
            >
              <Card
                card={data}
                interactive={false}
                width="100%"
                state={picked === o.uid ? 'selected' : 'idle'}
                // one out of a set — the uniform selection colour, never the
                // per-category accent
                accent="var(--select-accent)"
              />
            </button>
          )
        })}
        <ConfirmAction
          open
          label={copy.confirm}
          caption={copy.prompt}
          disabled={picked == null}
          onConfirm={() => {
            // re-checked against THIS render's offer, not merely "something
            // is selected" — the discipline every branch of the kit's own
            // panel keeps
            if (!picked || !ours.options.some((o) => o.uid === picked)) return
            setConfirmed(true)
            actions?.onResolve?.({ kind: 'pickFromDiscard', card: picked })
          }}
        />
      </div>
    ),
  }
}
