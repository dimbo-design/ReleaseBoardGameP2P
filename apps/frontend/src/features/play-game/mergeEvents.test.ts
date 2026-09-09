import type { Event } from '@release/engine'
import { describe, expect, it } from 'vitest'
import { mergeEvents } from './mergeEvents'

const ev = (id: number, player = 'you'): Event =>
  ({ id, type: 'drawn', player, pile: 0, deckSize: 40 }) as Event

describe('mergeEvents', () => {
  it('unions two disjoint feeds in id order', () => {
    expect(mergeEvents([ev(1), ev(3)], [ev(2)]).map((e) => e.id)).toEqual([1, 2, 3])
  })

  // The whole point of the resend: it is idempotent, so a peer that already has
  // the log is not handed a second copy of it.
  it('is idempotent', () => {
    const feed = [ev(1), ev(2)]
    expect(mergeEvents(feed, feed).map((e) => e.id)).toEqual([1, 2])
  })

  // Restore-then-sync and sync-then-restore must land in the same place, because
  // which arrives first is a race the client does not control.
  it('is order-independent', () => {
    const a = [ev(1), ev(2)]
    const b = [ev(2), ev(3)]
    expect(mergeEvents(a, b)).toEqual(
      mergeEvents(b, a)
        .slice()
        .sort((x, y) => x.id - y.id),
    )
  })

  // The host minted every id, so where the two disagree the incoming copy is the
  // authoritative one.
  it('lets the incoming copy win a collision', () => {
    const merged = mergeEvents([ev(1, 'stale')], [ev(1, 'fresh')])
    expect(merged).toHaveLength(1)
    expect((merged[0] as { player: string }).player).toBe('fresh')
  })

  it('fills a gap in the middle', () => {
    expect(mergeEvents([ev(1), ev(5)], [ev(2), ev(3), ev(4)]).map((e) => e.id)).toEqual([
      1, 2, 3, 4, 5,
    ])
  })

  it('handles both sides empty', () => {
    expect(mergeEvents([], [])).toEqual([])
  })
})
