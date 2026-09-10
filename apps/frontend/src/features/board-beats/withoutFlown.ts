import type { ReleaseSlots } from '@release/ui'
import type { BoardState } from '~/entities/game/board'
import type { DiscardCard } from './planBeats'

// The shadow's lifetime scopes PER END, not per beat. The hand goes live the
// moment a card's slot has been measured — it leaves the fan as it takes off,
// which is what the playground's own drag-out does too — while the discard end
// keeps the pre-batch projection until the card actually lands, or the heap
// would show it before it arrives. A runner publishes exactly this: `ctx.base`
// with every flying card gone from wherever it stood, and `decks` untouched.
// Pure, so a beat only has to call it and hand the result to `ctx.publish`.
//
// It lives in its own module because two runners answer this same question —
// the ordinary discard and the hand limit's grid — and a second copy of it
// would be a second source for one heap.
export function withoutFlown(base: BoardState, flown: DiscardCard[]): BoardState {
  const handIndexes = new Set<number>()
  const clearedSlots = new Map<string, Set<keyof ReleaseSlots>>()
  const seatDrops = new Map<string, number>()

  for (const { source } of flown) {
    if (source.kind === 'hand') {
      handIndexes.add(source.index)
    } else if (source.kind === 'release') {
      const slots = clearedSlots.get(source.player) ?? new Set<keyof ReleaseSlots>()
      slots.add(source.slot as keyof ReleaseSlots)
      clearedSlots.set(source.player, slots)
    } else {
      seatDrops.set(source.player, (seatDrops.get(source.player) ?? 0) + 1)
    }
  }

  const withoutSlots = (release: ReleaseSlots, slots?: Set<keyof ReleaseSlots>): ReleaseSlots => {
    if (!slots) return release
    const next = { ...release }
    for (const slot of slots) next[slot] = null
    return next
  }

  return {
    ...base,
    you: {
      ...base.you,
      hand:
        handIndexes.size > 0 ? base.you.hand.filter((_, i) => !handIndexes.has(i)) : base.you.hand,
      release: withoutSlots(base.you.release, clearedSlots.get(base.selfId)),
    },
    opponents: base.opponents.map((o) => {
      const drop = seatDrops.get(o.id)
      const slots = clearedSlots.get(o.id)
      if (!drop && !slots) return o
      return {
        ...o,
        handCount: drop ? Math.max(0, o.handCount - drop) : o.handCount,
        release: withoutSlots(o.release, slots),
      }
    }),
  }
}
