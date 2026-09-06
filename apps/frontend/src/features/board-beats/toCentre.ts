import type { CardData } from '@release/ui'
import type { Rect } from '@release/ui/animations'
import { play, useFlyer } from '@release/ui/animations'
import { useCallback } from 'react'

// THE FLIGHT OUT OF A PILE, packaged once.
//
// A card leaves a pile face down, travels to a named place at the centre, and
// STAYS there — pinned, so whatever comes next (a flip, a second flight, a
// discard exit) starts from where it stands rather than from where it began
// (I4). `drawBeat` had it first and `aiBeat` needs it twice; by #88's own
// standing rule that makes it a module rather than a movement to write again.
//
// It is a hook and not a bare function so that it can own the `useFlyer` call:
// a bare function would have to be handed the carrier, and a carrier passed
// between files is how two runners end up sharing one overlay by accident.

// How long a card the SYSTEM turned up stands for the table to read it. The
// value is the example scene's — `AiCardsStory`'s `TABLE_HOLD` — and not a
// number chosen here. There is no separate "plain reveal" hold anywhere in the
// scenes, because a trigger's stand IS part of reading the AI card it pulled:
// the two stand together and leave together (`resolveGeneric`).
export const TABLE_HOLD = 2600
// Hallucination lingers twice as long — `AiCardsStory`'s own doubling.
export const HALLUCINATION_HOLD = TABLE_HOLD * 2

export function useToCentre() {
  const flyer = useFlyer()
  const { raise, pin } = flyer

  const toSlot = useCallback(
    async (args: {
      key: string
      card: CardData
      from: Rect
      to: Rect
      faceDown?: boolean
    }): Promise<Rect | null> => {
      const { key, card, from, to, faceDown = true } = args
      const [el] = await raise([{ key, card, at: from, faceDown }])
      if (!el) return null
      const anim = play('drawToCenter', el, { from, to })
      if (anim) await anim.finished
      pin(key, to) // I4 — the next leg starts from where it stands
      return to
    },
    [raise, pin],
  )

  return { ...flyer, toSlot }
}
