import type { BoardAnchors } from './anchors'

// Both flights and the resting row measure the same slot, including seats
// still owing a card. Existing answers never shift when another seat answers.
export function upgradeSlot(anchors: BoardAnchors, player: string): HTMLElement | null {
  const root = anchors.centre.current?.parentElement
  return (
    Array.from(root?.querySelectorAll<HTMLElement>('[data-upgrade-slot]') ?? []).find(
      (slot) => slot.dataset.upgradeSlot === player,
    ) ?? null
  )
}
