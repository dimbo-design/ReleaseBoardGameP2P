export { play, presetNames } from './play'
export { enterPose, PRESETS, SHAKE_SHAPES, type ShakeShape } from './presets'
export {
  HEAP_SHOW,
  jitter,
  type Rect,
  restTransform,
  type Scatter,
  scatterAt,
  toDiscardParams,
} from './scatter'
export { nextFrames, wait } from './timing'
export { useCardReorder } from './useCardReorder'
// The third step, and the one the audit page lists under all ten scenes with a
// discard. It stayed in the playground on the claim that it had one consumer;
// it had ten, and the frontend's board is the eleventh.
export { type Leaving, useDiscardExit } from './useDiscardExit'
export { type Raise, useFlyer } from './useFlyer'
// The two flight STEPS. They live here rather than beside a scene because a
// movement found in two places is a module (root CLAUDE.md, Animations Rule):
// the carrier holds five invariants that were each broken at least once before
// they were written down, and the arrival step holds the fan's own geometry.
// Both had been copied — the playground's scene and the real board each had
// one — and nothing kept the copies in step.
export { type Arriving, type Landed, useHandArrival } from './useHandArrival'
// The fourth step, and the one the preset `foldIntoPair` was missing: the brick
// was shared, the gesture around it was written four times — once in the scene
// and three times on the board.
export { type Folding, usePairFold } from './usePairFold'
