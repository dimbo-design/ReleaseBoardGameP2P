import type { TableActions } from '@release/ui'
import { Card, ConfirmAction, cardById } from '@release/ui'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { BoardState } from '~/entities/game/board'
import styles from './_useUpgradeStaging.module.css'

// System Upgrade — the one pending that owes several seats at once. Three
// modes, and which one this seat is in comes from the pending itself:
//
//   owed, discarding  → this seat is being asked; pull one card and commit
//   picking, actor    → the open cards become a choice
//   anything else     → the open cards stand, read-only, and the caption says
//                       what the table is still waiting for
//
// The standing cards come from `pending.thrown`, which is public and survives
// every batch boundary — so no beat has to hold them, and the arrival beat only
// ever animates a card coming in and hands over to this (I7).
export function useUpgradeStaging(args: {
  state: BoardState
  actions?: TableActions
  copy: { prompt: string; waiting: string; takePrompt: string; confirm: string }
  enabled: boolean
}): { surface: ReactNode | null } {
  const { state, actions, copy, enabled } = args
  const pending = state.pending?.kind === 'systemUpgrade' ? state.pending : null

  const asked = pending?.phase === 'discarding' && pending.owed.includes(state.selfId)
  const picking = pending?.phase === 'picking' && pending.actor === state.selfId

  const [given, setGiven] = useState<string | null>(null)
  const [taken, setTaken] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  // Nothing armed survives the pending it was armed for — the discipline every
  // sibling staging hook keeps, latched on the pending and not on the mount.
  useEffect(() => {
    if (!pending) {
      setGiven(null)
      setTaken(null)
      setConfirmed(false)
    }
  }, [pending])

  if (!pending || !enabled) return { surface: null }

  const centre = (
    <div className={styles.centre}>
      {pending.thrown.map((t) => {
        const data = cardById(t.card.id)
        if (!data) return null
        return (
          <button
            key={t.card.uid}
            type="button"
            data-testid={`upgrade-thrown-${t.card.uid}`}
            className={styles.thrown}
            disabled={!picking}
            onClick={() => picking && setTaken(t.card.uid)}
          >
            <Card
              card={data}
              interactive={false}
              width="100%"
              state={taken === t.card.uid ? 'selected' : 'idle'}
              // one out of a set — the uniform selection colour
              accent="var(--select-accent)"
            />
          </button>
        )
      })}
    </div>
  )

  if (confirmed) return { surface: centre }

  if (asked) {
    return {
      surface: (
        <div className={styles.surface} data-testid="board-upgrade-ask">
          {centre}
          <div className={styles.hand}>
            {state.you.hand.map((h) => (
              <button
                key={h.uid}
                type="button"
                data-testid={`upgrade-hand-${h.uid}`}
                className={styles.cell}
                onClick={() => setGiven(h.uid)}
              >
                <Card
                  // `HandItem.card` is already the card object (Hand.tsx:53) —
                  // no lookup, and no cast.
                  card={h.card}
                  interactive={false}
                  width="100%"
                  state={given === h.uid ? 'selected' : 'idle'}
                  accent="var(--select-accent)"
                />
              </button>
            ))}
          </div>
          <ConfirmAction
            open
            label={copy.confirm}
            caption={copy.prompt}
            disabled={given == null}
            onConfirm={() => {
              // re-checked against THIS render's hand, the discipline the
              // kit's own panel keeps on every branch
              if (!given || !state.you.hand.some((h) => h.uid === given)) return
              setConfirmed(true)
              actions?.onResolve?.({ kind: 'upgradeDiscard', card: given })
            }}
          />
        </div>
      ),
    }
  }

  if (picking) {
    return {
      surface: (
        <div className={styles.surface}>
          {centre}
          <ConfirmAction
            open
            label={copy.confirm}
            caption={copy.takePrompt}
            disabled={taken == null}
            onConfirm={() => {
              if (!taken || !pending.thrown.some((t) => t.card.uid === taken)) return
              setConfirmed(true)
              actions?.onResolve?.({ kind: 'upgradeTake', card: taken })
            }}
          />
        </div>
      ),
    }
  }

  // Answered, or never asked: the cards stand and the caption says why nothing
  // is being asked of this seat.
  return {
    surface: (
      <div className={styles.surface}>
        {centre}
        <ConfirmAction open={false} label={copy.confirm} caption={copy.waiting} disabled />
      </div>
    ),
  }
}
