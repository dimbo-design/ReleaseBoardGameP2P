import type { Event } from '@release/engine'
import type { HandPlayDrop, TableActions } from '@release/ui'
import { Card, ConfirmAction, cardById } from '@release/ui'
import { play, useFlyer } from '@release/ui/animations'
import { useEffect, useState } from 'react'
import type { BoardAnchors, BoardState } from '~/entities/game/board'
import { useResolveFeedback } from './_useResolveFeedback'
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
  anchors: BoardAnchors
  events?: Event[]
  actions?: TableActions
  copy: { prompt: string; waiting: string; takePrompt: string; confirm: string }
  enabled: boolean
}) {
  const { state, actions, copy, enabled } = args
  const pending = state.pending?.kind === 'systemUpgrade' ? state.pending : null

  const asked = pending?.phase === 'discarding' && pending.owed.includes(state.selfId)
  const picking = pending?.phase === 'picking' && pending.actor === state.selfId

  const flyer = useFlyer()
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

  const resolve = useResolveFeedback(args.events ?? [], state.selfId, actions, () => {
    setConfirmed(false)
    setGiven(null)
    flyer.drop()
  })

  const onHandPlay = (uid: string, drop: HandPlayDrop) => {
    const item = state.you.hand.find((c) => c.uid === uid)
    if (!enabled || !asked || given || !item) return false
    setGiven(uid)
    void (async () => {
      const target = args.anchors.centre.current?.getBoundingClientRect()
      // `HandPlayDrop.rect` is optional. With no rect there is no leg to fly,
      // and the answer still goes out — exactly as a missing centre skips it.
      const from = drop.rect
      if (target && from) {
        const [el] = await flyer.raise([{ key: 'upgrade-local', card: item.card, at: from }])
        if (el) await play('playToCenter', el, { from, to: target, duration: 460 })?.finished
      }
      setConfirmed(true)
      resolve({ kind: 'upgradeDiscard', card: uid })
    })()
    return true
  }
  const interaction = {
    asked: Boolean(enabled && asked),
    onHandPlay,
    handItems: state.you.hand.filter((c) => c.uid !== given),
    stagedUid: given,
    el: () => flyer.elOf('upgrade-local'),
    release: () => flyer.drop(),
    overlay: flyer.overlay,
  }
  if (!pending || !enabled) return { surface: null, ...interaction }

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

  if (confirmed) return { surface: centre, ...interaction }

  if (asked) {
    return {
      ...interaction,
      surface: (
        <div className={styles.surface} data-testid="board-upgrade-ask">
          {centre}
          <ConfirmAction open={false} label={copy.confirm} caption={copy.prompt} disabled />
        </div>
      ),
    }
  }

  if (picking) {
    return {
      ...interaction,
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
              resolve({ kind: 'upgradeTake', card: taken })
            }}
          />
        </div>
      ),
    }
  }

  // Answered, or never asked: the cards stand and the caption says why nothing
  // is being asked of this seat.
  return {
    ...interaction,
    surface: (
      <div className={styles.surface}>
        {centre}
        <ConfirmAction open={false} label={copy.confirm} caption={copy.waiting} disabled />
      </div>
    ),
  }
}
