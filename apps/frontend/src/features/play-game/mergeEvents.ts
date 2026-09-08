import type { Event } from '@release/engine'

/**
 * Two feeds of the same match, folded into one.
 *
 * The key is `Event.id` — the engine's own monotonic sequence, identical on
 * every peer (the same property `toBoardState` relies on to key the discard
 * scatter). That is what makes this merge idempotent, order-independent, and
 * decidable when the two sides disagree: the host minted every id, so `b` — the
 * copy that came from it — wins.
 */
export function mergeEvents(a: Event[], b: Event[]): Event[] {
  const byId = new Map<number, Event>()
  for (const e of a) byId.set(e.id, e)
  for (const e of b) byId.set(e.id, e)
  return [...byId.values()].sort((x, y) => x.id - y.id)
}
