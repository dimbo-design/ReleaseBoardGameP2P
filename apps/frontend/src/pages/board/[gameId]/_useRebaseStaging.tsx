import type { TableActions } from '@release/ui'
import { Card, ConfirmAction, cardById, Typography } from '@release/ui'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { BoardState } from '~/entities/game/board'
import styles from './_useRebaseStaging.module.css'

// Git Rebase — the top of a pile, shown to its owner and to nobody else. The
// privacy is not enforced here: `pendingView` hands every other peer an empty
// `piles`, so there is nothing for this hook to hide. What the table sees is
// the card's own flight to the discard, which the ordinary discard run plays.
//
// Sudo lays one row per pile, sharing a single 1-2-3 numbering across them, as
// the story does — the numbers name positions in a pile, and every pile has the
// same three positions.
//
// Pointer buttons rather than the story's drag: the board needs a control a
// test and a keyboard can both reach, and a drag can be layered over this same
// state later. The difference is recorded on the audit page rather than left
// for the next reader to find.
type Order = Record<number, string[]>

export function useRebaseStaging(args: {
  state: BoardState
  actions?: TableActions
  copy: { prompt: string; position: string; confirm: string }
  enabled: boolean
}): { row: ReactNode | null } {
  const { state, actions, copy, enabled } = args
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

  // Seeded from the offer, and re-seeded when a different pending opens. Keyed
  // on the pending rather than the mount, the discipline `_useInsideStaging`
  // states: a latch that outlives what it latches is a bug.
  useEffect(() => {
    if (!ours) {
      setOrder({})
      setConfirmed(false)
      return
    }
    setOrder(Object.fromEntries(ours.piles.map((e) => [e.pile, e.cards.map((c) => c.uid)])))
  }, [ours])

  if (!ours || confirmed) return { row: null }

  const move = (pile: number, uid: string, delta: number) =>
    setOrder((o) => {
      const cards = [...(o[pile] ?? [])]
      const from = cards.indexOf(uid)
      const to = from + delta
      if (from < 0 || to < 0 || to >= cards.length) return o
      cards.splice(to, 0, ...cards.splice(from, 1))
      return { ...o, [pile]: cards }
    })

  return {
    row: (
      <div className={styles.rows} data-testid="board-rebase-row">
        {ours.piles.map((entry) => (
          <div key={entry.pile} className={styles.row}>
            {(order[entry.pile] ?? []).map((uid, i) => {
              const offered = entry.cards.find((c) => c.uid === uid)
              const data = offered ? cardById(offered.id) : null
              if (!data) return null
              return (
                <div key={uid} className={styles.slot}>
                  <Typography variant="tag" className={styles.position}>
                    {i + 1}
                  </Typography>
                  <Card card={data} interactive={false} width="100%" />
                  <button
                    type="button"
                    data-testid={`rebase-up-${uid}`}
                    className={styles.move}
                    aria-label={`${copy.position} ${i}`}
                    onClick={() => move(entry.pile, uid, -1)}
                  />
                </div>
              )
            })}
          </div>
        ))}
        <ConfirmAction
          open
          label={copy.confirm}
          caption={copy.prompt}
          onConfirm={() => {
            // Committed against THIS render's offer: every offered pile,
            // answered exactly once, or the engine rejects it.
            const committed = ours.piles.map((e) => ({
              pile: e.pile,
              cards: order[e.pile] ?? e.cards.map((c) => c.uid),
            }))
            setConfirmed(true)
            actions?.onResolve?.({ kind: 'reorderTop', order: committed })
          }}
        />
      </div>
    ),
  }
}
