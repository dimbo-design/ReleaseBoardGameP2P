import { cardById } from '@release/ui'
import type { Leaving } from '@release/ui/animations'
import { scatterAt } from '@release/ui/animations'
import type { BoardAnchors, BoardState } from '~/entities/game/board'

// Clear the standing render without banking its trigger early. The engine
// already counts it, so the beat temporarily removes that copy from the
// shadow and restores the saved decks only after the exit has landed.
export function withoutAiCause(
  state: BoardState,
  causeward: { card: string; eventId: number } | undefined,
): BoardState {
  const heap = state.decks.discardHeap?.filter((card) => card.uid !== `d${causeward?.eventId}`)
  return {
    ...state,
    pending: null,
    aiCause: undefined,
    decks: causeward
      ? {
          ...state.decks,
          discardCount: Math.max(0, state.decks.discardCount - 1),
          discardHeap: heap,
          discard:
            state.decks.discard?.id === causeward.card ? heap?.at(-1)?.card : state.decks.discard,
        }
      : state.decks,
  }
}

// The engine has already banked this trigger, but the board holds it beside
// its pending effect. Its eventual exit uses the original discard event's pose.
export function aiCauseExit(
  causeward: { card: string; eventId: number } | undefined,
  anchors: BoardAnchors,
): Leaving[] {
  if (!causeward || causeward.eventId < 0) return []
  const card = cardById(causeward.card)
  const node = anchors.cause.current
  if (!card || !node) return []
  const { left, top, width, height } = node.getBoundingClientRect()
  return [
    {
      key: `d${causeward.eventId}`,
      card,
      from: { left, top, width, height },
      scatter: scatterAt(causeward.eventId),
    },
  ]
}
