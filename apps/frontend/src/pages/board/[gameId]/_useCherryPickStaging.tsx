import type { TableActions } from '@release/ui'
import { Card, ConfirmAction, cardById, Typography } from '@release/ui'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { BoardState } from '~/entities/game/board'
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
const isTrigger = (id: string) => cardById(id)?.category === 'trigger'

export function useCherryPickStaging(args: {
  state: BoardState
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
}): { grid: ReactNode | null } {
  const { state, actions, copy, enabled } = args
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

  // Nothing armed survives the pending it was armed for.
  useEffect(() => {
    if (!ours) {
      setPicks([])
      setConfirmed(false)
    }
  }, [ours])

  if (!ours || confirmed) return { grid: null }
  if (ours.picks === 1 && ours.options.length < 2) return { grid: null }

  const sudo = ours.picks === 2
  // A trigger can only be the deck card, so it never takes the hand slot: with
  // one chosen, the other role is whatever is left.
  const roles = (() => {
    if (!sudo) return { hand: picks[0] ?? null, deck: null as string | null }
    const [a, b] = picks
    const idOf = (uid?: string) => ours.options.find((o) => o.uid === uid)?.id
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
    if (picks.length >= ours.picks) return false
    if (!isTrigger(id)) return true
    // Only one trigger may be held, and only for the single deck slot.
    return sudo && !picks.some((u) => isTrigger(idOfOption(ours.options, u)))
  }

  const ready = picks.length === ours.picks

  return {
    grid: (
      <div className={styles.grid} data-testid="board-cherry-grid">
        {ours.options.map((o) => {
          const data = cardById(o.id)
          if (!data) return null
          const handRole = roles.hand === o.uid
          const deckRole = roles.deck === o.uid
          const selected = handRole || deckRole
          const blocked = !selected && !canSelect(o.uid, o.id)
          return (
            <button
              key={o.uid}
              type="button"
              data-testid={`cherry-cell-${o.uid}`}
              className={`${styles.cell} ${blocked ? styles.blocked : ''}`}
              onClick={() =>
                setPicks((p) =>
                  p.includes(o.uid)
                    ? p.filter((u) => u !== o.uid)
                    : canSelect(o.uid, o.id)
                      ? [...p, o.uid]
                      : p,
                )
              }
            >
              <Card
                card={data}
                interactive={false}
                width="100%"
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
          open
          label={copy.confirm}
          caption={sudo ? copy.sudoPrompt : copy.prompt}
          disabled={!ready}
          onConfirm={() => {
            // re-checked against THIS render's offer, the discipline every
            // branch of the kit's own panel keeps
            const hand = roles.hand
            if (!hand || !ours.options.some((o) => o.uid === hand)) return
            const deck = roles.deck
            setConfirmed(true)
            actions?.onResolve?.({
              kind: 'pickFromDiscard',
              card: hand,
              ...(deck ? { toDeck: deck } : {}),
            })
          }}
        />
      </div>
    ),
  }
}

const idOfOption = (options: { uid: string; id: string }[], uid: string) =>
  options.find((o) => o.uid === uid)?.id ?? ''
