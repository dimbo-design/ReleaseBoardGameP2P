import type { TableActions } from '@release/ui'
import { CARDS, CardCatalog, ConfirmAction } from '@release/ui'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { BoardState } from '~/entities/game/board'
import styles from './_useRequestStaging.module.css'

// Naming a card, and losing one. Active only while a `requestCard` or a
// `giveCard` pending is ours — its siblings `_useBoardStaging.ts`,
// `_useDefenseStaging.tsx` and `_useNeutralizeStaging.tsx` never run at the
// same time, because a pending suspends normal play and a pending has one kind.
//
// It owns no animation. What flies belongs to `transferBeat`; what is decided
// belongs here, and the two meet through the projection.

// The guess space: every card that can actually BE in a hand. Triggers cannot
// (`docs/rules/cards.md:320`, `:339` — they resolve as they are drawn), and no
// event-deck card can either (`docs/rules/general.md:189` — each of them is at
// any time «либо в колоде, либо на столе»). Same filter the kit's own panel now
// uses; declared again here rather than imported, because the kit does not put
// it on its barrel and a cross-package reach for one array is not worth a new
// export.
const HOLDABLE = CARDS.filter((c) => c.deck === 'base' && c.category !== 'trigger')

export function useRequestStaging(args: {
  state: BoardState
  actions?: TableActions
  copy: { prompt: string; action: string; confirm: string }
  enabled: boolean
  matchKey: string | null
}): { band: ReactNode | null } {
  const { state, actions, copy, enabled, matchKey } = args
  const pending = state.pending
  const asking = enabled && pending?.kind === 'requestCard' && pending.player === state.selfId
  const giving = enabled && pending?.kind === 'giveCard' && pending.player === state.selfId

  const [named, setNamed] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  // The hand-over answers itself. The engine asks which COPY to surrender and
  // the copies differ only by uid — `onGiveCard` matches on `card.id`, so any
  // of them is the right one — which makes this a decision with no content.
  // The victim watches the scene instead of a panel.
  //
  // Fired at once rather than after a pause: the beat queue serialises, so the
  // transfer cannot start before the entrance beat has drained, and the pause
  // that makes the scene readable belongs to the beat's own hold. A timer here
  // would be a second opinion about pacing, free to drift from the first.
  //
  // It lives in the staging hook and NOT in a beat because
  // `prefers-reduced-motion` collapses every beat: this is a game action, and
  // an engine left waiting on an animation nobody plays is a stalled match.
  //
  // The guard fires ONCE PER EPISODE, not once per mount: it is keyed on the
  // pending itself (player + requested id + the copy's own uid) so a re-render
  // of the SAME still-open pending does not re-dispatch, and it is cleared the
  // instant this hook is no longer holding an ours-`giveCard` pending — the
  // effect right below this one. A pending is cleared by being resolved before
  // another can be raised, so `giving` going false always separates two real
  // episodes; a fingerprint that outlived the pending it was armed for would
  // swallow the SECOND `giveCard` of a match (a second Security Bug is an
  // ordinary thing), which a once-per-mount latch cannot tell apart from the
  // first.
  const handed = useRef<string | null>(null)
  useEffect(() => {
    if (!giving || pending?.kind !== 'giveCard') return
    // Keyed on the pending itself, not on the mount: a second Security Bug in
    // one match raises a second `giveCard`, and a once-per-mount latch would
    // swallow it. Player and card alone do not separate two identical requests,
    // so the fingerprint carries the hand's own identity for the copy going.
    const copyUid = state.you.hand.find((h) => h.card.id === pending.requested)?.uid
    if (!copyUid) return
    const key = `${pending.player}:${pending.requested}:${copyUid}`
    if (handed.current === key) return
    handed.current = key
    actions?.onResolve?.({ kind: 'giveCard', card: copyUid })
  }, [giving, pending, state.you.hand, actions])

  // The episode boundary: nothing latched here survives the pending it was
  // latched for. Cleared whenever this hook does not currently hold an
  // ours-`giveCard` pending, so the NEXT one — even an identical one — is free
  // to fire again.
  useEffect(() => {
    if (!giving) handed.current = null
  }, [giving])

  // A new match starts the surface over: a name armed in a dead match must not
  // confirm into the new one. The same boundary `useBeats` and both sibling
  // staging hooks already take.
  const playing = useRef<string | null>(null)
  useEffect(() => {
    if (matchKey == null || playing.current === matchKey) return
    playing.current = matchKey
    setNamed(null)
    setConfirmed(false)
    handed.current = null
  }, [matchKey])

  // Nothing armed survives the pending it was armed for.
  useEffect(() => {
    if (!asking) {
      setNamed(null)
      setConfirmed(false)
    }
  }, [asking])

  if (!asking) return { band: null }

  return {
    band: (
      <div className={styles.requestBand} data-testid="board-request-band">
        <div className={styles.catalog}>
          <CardCatalog
            cards={HOLDABLE}
            open={!confirmed}
            selected={named}
            chosen={confirmed ? named : null}
            onPick={(c) => setNamed(c.id)}
          />
        </div>
        <ConfirmAction
          open={!confirmed}
          label={copy.confirm}
          caption={copy.prompt}
          disabled={named == null}
          onConfirm={() => {
            // Membership is re-checked against THIS render's offer, not merely
            // against "something is selected" — the discipline every branch of
            // the kit's own panel keeps, for the same reason.
            if (!named || !HOLDABLE.some((c) => c.id === named)) return
            setConfirmed(true)
            actions?.onResolve?.({ kind: 'requestCard', card: named })
          }}
        />
      </div>
    ),
  }
}
