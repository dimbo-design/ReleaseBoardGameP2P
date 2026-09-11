import type { Event } from '@release/engine'
import type { TableActions } from '@release/ui'
import { useCallback, useEffect, useRef } from 'react'

type Choice = Parameters<NonNullable<TableActions['onResolve']>>[0]

// Sends a RESOLVE and watches the feed for the engine refusing that attempt, so
// a surface can reopen instead of playing out a move that never happened.
// Match only a refusal of this seat's current attempt. Old refusals in the
// accumulated feed must not cancel a later retry of the same choice.
//
// The returned function keeps one identity across renders: surfaces call it
// from effects, and a new function every render would re-run those effects on
// every render. It reads the feed and the actions through a ref instead.
export function useResolveFeedback(
  events: Event[],
  player: string,
  actions: TableActions | undefined,
  onRejected: () => void,
) {
  const attempt = useRef<{ since: number; choice: string } | null>(null)
  const reset = useRef(onRejected)
  reset.current = onRejected
  const latest = useRef({ events, actions })
  latest.current = { events, actions }

  useEffect(() => {
    const sent = attempt.current
    if (!sent) return
    const refused = events.some(
      (event) =>
        event.id > sent.since &&
        event.type === 'rejected' &&
        event.action.type === 'RESOLVE' &&
        event.action.player === player &&
        JSON.stringify(event.action.choice) === sent.choice,
    )
    if (refused) {
      attempt.current = null
      reset.current()
    }
  }, [events, player])

  return useCallback((choice: Choice) => {
    const { events: feed, actions: act } = latest.current
    attempt.current = { since: feed.at(-1)?.id ?? 0, choice: JSON.stringify(choice) }
    act?.onResolve?.(choice)
  }, [])
}
