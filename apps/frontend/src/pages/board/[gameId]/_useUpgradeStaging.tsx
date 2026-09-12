import type { Event } from '@release/engine'
import type { HandPlayDrop, TableActions } from '@release/ui'
import { Card, ConfirmAction, cardById, Typography } from '@release/ui'
import { play, useFlyer } from '@release/ui/animations'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BoardAnchors, BoardState } from '~/entities/game/board'
import { upgradeSlot } from '~/entities/game/board/upgradeSlot'
import { useReducedMotion } from '~/shared/lib/useReducedMotion'
import opening from './_Board.module.css'
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
// every batch boundary. The beat hands its arrivals over to these same slots
// and, on the final base answer, sends the standing row to discard (I7).
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

  const reduced = useReducedMotion()
  const flyer = useFlyer()
  const [given, setGiven] = useState<string | null>(null)
  const [taken, setTaken] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const attempt = useRef(0)
  const inFlight = useRef(false)
  const current = useRef({ pending, asked, enabled })
  current.current = { pending, asked, enabled }
  useLayoutEffect(
    () => () => {
      attempt.current += 1
    },
    [],
  )

  // Nothing armed survives the pending it was armed for — the discipline every
  // sibling staging hook keeps, latched on the pending and not on the mount.
  useEffect(() => {
    if (!pending) {
      attempt.current += 1
      inFlight.current = false
      if (reduced || !confirmed || given == null) {
        flyer.drop()
        setGiven(null)
        setConfirmed(false)
      }
      setTaken(null)
    }
  }, [pending, confirmed, given, reduced, flyer.drop])

  const resolve = useResolveFeedback(args.events ?? [], state.selfId, actions, () => {
    attempt.current += 1
    inFlight.current = false
    setConfirmed(false)
    setGiven(null)
    flyer.drop()
  })

  const onHandPlay = (uid: string, drop: HandPlayDrop) => {
    const item = state.you.hand.find((c) => c.uid === uid)
    if (!enabled || !asked || inFlight.current || given || !item) return false
    inFlight.current = true
    const token = ++attempt.current
    const valid = () =>
      token === attempt.current &&
      current.current.pending?.actor === pending?.actor &&
      current.current.pending?.source === pending?.source &&
      current.current.asked &&
      current.current.enabled
    setGiven(uid)
    void (async () => {
      const target = upgradeSlot(args.anchors, state.selfId)?.getBoundingClientRect()
      if (!reduced && target && drop.rect) {
        const [el] = await flyer.raise([{ key: 'upgrade-local', card: item.card, at: drop.rect }])
        if (el && valid())
          await play('playToCenter', el, { from: drop.rect, to: target, duration: 460 })?.finished
      }
      if (!valid()) {
        if (token === attempt.current) {
          inFlight.current = false
          setGiven(null)
          flyer.drop()
        }
        return
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
    release: () => {
      flyer.drop()
      setGiven(null)
      setConfirmed(false)
      inFlight.current = false
    },
    overlay: flyer.overlay,
  }
  if (!pending || !enabled) return { surface: null, ...interaction }

  const centre = (
    <div className={styles.centre}>
      {[...new Set([...pending.owed, ...pending.thrown.map((t) => t.player)])]
        .sort()
        .map((player) => {
          const t = pending.thrown.find((entry) => entry.player === player)
          if (!t) return <div key={player} data-upgrade-slot={player} className={styles.cell} />
          const data = cardById(t.card.id)
          if (!data) return null
          return (
            <button
              key={player}
              data-upgrade-slot={player}
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
          <div className={opening.ask} data-shown="true" role="status">
            <Typography as="div" base="label-sm" tk="tk-16" className={opening.askLine}>
              {copy.prompt}
            </Typography>
          </div>
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
        <div className={opening.ask} data-shown="true" role="status">
          <Typography as="div" base="label-sm" tk="tk-16" className={opening.askLine}>
            {copy.waiting}
          </Typography>
        </div>
      </div>
    ),
  }
}
