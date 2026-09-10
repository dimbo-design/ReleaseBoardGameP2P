// The table poses and holds of the release/defence scene, quoted from the
// playground's DefenseReleaseStory — the approved visual source. They live in
// `entities` because both the page's gestures (`pages/board`) and the beat
// runners (`features/board-beats`) need them, and a feature must not import
// from a sibling feature.
//
// `@release/ui/animations` does not export a `Pose` type, so the shape is
// spelled out inline here rather than imported.
interface Pose {
  rot: number
  dx: number
  dy: number
}

/** an attack lands at a tilt… */
export const ATTACK_POSE: Pose = { rot: -4, dx: 0, dy: 0 }
/** …and the defence covers it at a different one, offset, so the two read as
 *  two separate plays rather than one neat stack */
export const COVER_POSE: Pose = { rot: 6, dx: 16, dy: -12 }
/** the defender's own Sudo waits in its own place, left of the attack — it is
 *  not part of the pair until a defence is chosen for it */
export const SUDO_POSE: Pose = { rot: -7, dx: 0, dy: 0 }

/** a card shown open on the table before it moves on */
export const SHOW_HOLD = 1200
/** the defence and its Sudo fold into a pair */
export const MERGE_MS = 620
/** the swept cards are held open at the centre before they scatter — the same
 *  beat the hand limit's grid gets (#104 will reuse this leg) */
export const GATHER_HOLD = 1500
/** the finished grid leaves card by card — this is the step between them */
export const CLEAR_STEP = 90
