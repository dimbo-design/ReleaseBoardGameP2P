import { describe, expect, it } from 'vitest'
import { PRESETS } from './presets'

// jsdom ships no WAAPI, and this package has no global test setup to add one
// (the frontend's `test-setup.ts` is where that lives). This suite is not about
// the flight — it is about what a preset DECLARES, so the stub records the
// keyframes instead of playing them.
const declared = (name: string, params?: Record<string, unknown>) => {
  let seen: { frames: Keyframe[]; options: KeyframeAnimationOptions } | null = null
  const el = document.createElement('div')
  el.animate = ((frames: Keyframe[], options: KeyframeAnimationOptions) => {
    seen = { frames, options }
    return { cancel: () => {}, finished: Promise.resolve() } as unknown as Animation
  }) as never
  const preset = PRESETS[name]
  if (typeof preset !== 'function') throw new Error(`${name} should be a function preset`)
  preset(el, params)
  if (!seen) throw new Error(`${name} declared no animation`)
  return seen as { frames: Keyframe[]; options: KeyframeAnimationOptions }
}

// A preset that persists its end state (`fill: 'both'` / `'forwards'`) leaves
// that state on the element FOREVER. On a preset applied to a BLOCK rather than
// to a flying card, any transform value other than `none` is then a permanent
// stacking context — and a stacking context traps its children's z-index inside
// it, however high they set it.
//
// `hudIn` is the block preset: the board's opening plays it on the deck column,
// the discard, every seat and the dock (`features/game-intro/useDealIntro.ts`).
// Three of those hold a `Pile`, and `Pile.module.css`'s `.count` sits at
// `calc(var(--z-flight) + 40)` exactly so a card flying past passes UNDER the
// badge. Its comment names the precondition: that works "only while the
// consumer's placement is not a stacking context". Ending `hudIn` on
// `translate(0, 0)` broke it — the counter blinked behind every card that left
// a pile, reported on PR #132.
describe('hudIn', () => {
  it('ends on `none`, so the block it reveals is not left a stacking context', () => {
    const { frames, options } = declared('hudIn', { dx: -34, dur: 10 })
    // the pairing IS the bug: a persisted end state plus a real transform value
    expect(options.fill).toBe('both')
    expect((frames.at(-1) as { transform?: string }).transform).toBe('none')
  })

  it('still starts from its offset, so the movement is unchanged', () => {
    const { frames } = declared('hudIn', { dx: -34, dy: 12, dur: 10 })
    expect((frames[0] as { transform?: string }).transform).toBe('translate(-34px, 12px)')
  })
})
