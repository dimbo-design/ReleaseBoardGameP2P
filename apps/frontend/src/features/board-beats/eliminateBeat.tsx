import { wait } from '@release/ui/animations'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type { BeatRun } from '~/entities/game/board'
import styles from './eliminateBeat.module.css'
import type { BeatPlan } from './planBeats'

// A player is out, and the whole table watches it happen: the board has already
// settled into its eliminated state, and the clip plays over the top of it
// (#103). Ported from the playground's own Error503Story — `playEliminationGif`
// and the `.gifOverlay` layer.
//
// The beat PUBLISHES NOTHING. The eliminated state is the projection's own
// (`fake/project.ts:184` → `toBoardState`), so the seat, the hand and the zone
// read as out because the board says so, not because this beat said so — which
// is what keeps them out for the rest of the match once the clip is gone.

// Bundled, not fetched: the app has no backend and no CDN in front of it
// (CLAUDE.md's Architecture Rule). Vite emits each clip as its own hashed file
// rather than folding it into the JS, so nothing here is paid for until the
// overlay actually mounts. SORTED, because the pick below is an index: glob
// order is Vite's to change, and a clip that moves would silently become a
// different clip on a peer running an older build.
export const ELIMINATION_CLIPS: string[] = Object.entries(
  import.meta.glob('./eliminate/*.mp4', { eager: true, query: '?url', import: 'default' }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url as string)

/** a beat after the table has emptied, before the clip comes in — landing on
 *  the same frame reads as a cut */
export const ELIM_DELAY = 400
/** loop for at least this long, then let the current loop finish */
export const ELIM_MIN_MS = 5000

/**
 * How long each clip actually runs, in ms, keyed by the file it belongs to and
 * living right beside the list above — because the guard below is armed with a
 * number taken from here, and a number that has drifted from its file would cut
 * a healthy clip short.
 *
 * `eliminateClips.test.ts` reads the real duration out of each file's own
 * `moov/mvhd` box and fails if this table disagrees, or if a clip ships with no
 * entry. That check is the point rather than a formality: these clips ship with
 * unconfirmed rights and are expected to be replaced
 * (docs/animations/backlog.md), and a swap must fail loudly here instead of
 * quietly mis-timing the beat.
 */
export const CLIP_MS: Record<string, number> = {
  'IHa0T7Ffr43z1kTd.mp4': 4700,
  'doc_2026-07-31_23-09-35.mp4': 3267,
  'freshleb-whistlindiesel.mp4': 2034,
  'gato-truco-gato.mp4': 6467,
}

/**
 * How long a healthy clip is on screen IN THE IDEAL: the first whole loop at or
 * past the floor, since the beat loops until `ELIM_MIN_MS` and then lets the
 * pass it is in finish. This is the number the review settled on — 6.10 / 6.53 /
 * 6.47 / 9.40s for the four clips here — and it is what the beat aims at.
 *
 * It is NOT what the guard is armed with; see `guardMsFor` below.
 *
 * A blanket ceiling used to do this job with one number for every clip, which
 * meant the number was wrong for all of them: too generous for a short clip
 * (the board sits dead past the end) and a real risk of cutting a long one.
 *
 * The fallback exists only for a clip with no entry in `CLIP_MS`, which the
 * duration test is what prevents — the longest the table knows, so an unlisted
 * clip is never cut short, only left a little long.
 */
export function idealEndMsFor(src: string): number {
  const name = src.split('/').pop() ?? ''
  const own = CLIP_MS[name]
  if (own) return Math.ceil(ELIM_MIN_MS / own) * own
  const known = Object.values(CLIP_MS).map((d) => Math.ceil(ELIM_MIN_MS / d) * d)
  return known.length > 0 ? Math.max(...known) : ELIM_MIN_MS * 2
}

/**
 * Room for ONE loop seam. Real playback always runs a little longer than the
 * ideal: `ended` fires, the handler rewinds to 0, `play()` is called and a frame
 * decodes — every time round — and the first frame after `playing` is not free
 * either.
 *
 * Per loop rather than one flat allowance, because what differs between clips is
 * the number of seams, not a fixed overhead: the 2.034s clip runs three passes
 * and crosses two seams, the 6.467s clip runs one and crosses none. A single
 * number would have to be sized for the worst case and would then be far too
 * generous for the clip needing it least — and these clips are expected to be
 * replaced, so the shape has to survive a shorter one arriving.
 */
export const ELIM_GUARD_SLACK_MS = 250

/**
 * What the guard is actually armed with: the ideal end, plus room for the seams
 * that end will really contain.
 *
 * Armed on the ideal number exactly, the timer beat the last `ended` to the exit
 * on every clip that loops — so the beat stopped ending at a loop boundary and
 * went back to ending on a number, which is the thing the per-clip guard was
 * introduced to stop. And it would never have surfaced as a failure, only as a
 * clip that ends a few frames early (#126 review).
 *
 * The guard is here for a stalled stream, so it should fire well after any
 * honest end: a stall waiting a few hundred ms longer costs nothing, while
 * healthy playback racing a timer costs the beat its own ending.
 */
export function guardMsFor(src: string): number {
  const ideal = idealEndMsFor(src)
  const own = CLIP_MS[src.split('/').pop() ?? '']
  const loops = own ? Math.round(ideal / own) : 1
  return ideal + loops * ELIM_GUARD_SLACK_MS
}

/**
 * And a guard of a different shape, for a different failure: a clip that never
 * BEGINS. Everything above is the clip's own time and is only started by real
 * playback — deliberately, so loading cannot spend it — which leaves "it never
 * played at all" counted by nothing. The beat owns the table while it runs, so
 * that would hold the board for the rest of the match.
 *
 * So this one is about LOADING, not about any clip, and is not derived from one.
 * It should never be reached: the clips are fetched ahead of time (see
 * `useEliminationPreload`), a refused codec fires `error`, and a refused
 * autoplay rejects `play()` — both handled. It is the floor under the case none
 * of those cover.
 */
export const ELIM_START_MS = 10000

/**
 * The clips are fetched BEFORE anybody needs one. Until this existed the first
 * byte was asked for at the exact moment the overlay was already on screen,
 * which is where both failures came from: loading spending the clip's own time,
 * and the risk of an overlay standing empty over the board.
 *
 * At IDLE, and only once the match is running — never at app start. Initial
 * load is not paid for by clips today (Vite emits them as their own assets) and
 * losing that for a clip that may never be needed is a bad trade. All four are
 * fetched, because which one comes up is known only at the elimination itself.
 *
 * Nothing is kept: the point is the HTTP cache, so `<video>` starts from it
 * rather than from the network. A failure is ignored on purpose — the clip's
 * own `error` path is what handles a clip that will not load, and a preload
 * that could raise would make a background convenience into a way to break the
 * board.
 */
export function useEliminationPreload(enabled: boolean): void {
  const done = useRef(false)
  useEffect(() => {
    if (!enabled || done.current || ELIMINATION_CLIPS.length === 0) return
    const idle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (cb: () => void) => setTimeout(cb, 1200) as unknown as number
    const handle = idle(() => {
      if (done.current) return
      done.current = true
      for (const src of ELIMINATION_CLIPS) void fetch(src).catch(() => {})
    })
    return () => {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle as number)
      else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
    }
  }, [enabled])
}

export function useEliminateBeat() {
  const [clip, setClip] = useState<string | null>(null)
  const started = useRef(0)
  const resolve = useRef<(() => void) | null>(null)
  // Whichever guard is currently armed: the loading one until playback starts,
  // the clip's own from then on. One ref, because only ever one is running.
  const guard = useRef<ReturnType<typeof setTimeout> | null>(null)

  // One way out, however the clip got here: the overlay goes, the watchdog is
  // disarmed, and the beat's own promise resolves exactly once.
  const finish = useCallback(() => {
    if (guard.current) clearTimeout(guard.current)
    guard.current = null
    setClip(null)
    resolve.current?.()
    resolve.current = null
  }, [])

  const run = useCallback(
    async (plan: Extract<BeatPlan, { kind: 'eliminated' }>, _ctx: BeatRun): Promise<void> => {
      if (ELIMINATION_CLIPS.length === 0) return
      // Resolved from the elimination itself rather than picked at random: every
      // peer holds this event id already, so one elimination is one clip on
      // every screen — a table watching the same thing, at no cost on the wire.
      const src = ELIMINATION_CLIPS[plan.eventId % ELIMINATION_CLIPS.length]
      await wait(ELIM_DELAY)
      // NOT started here — the clock starts when the clip really plays
      // (`onPlaying`). Until then only the loading guard is running.
      started.current = 0
      setClip(src)
      return new Promise<void>((res) => {
        resolve.current = res
        guard.current = setTimeout(finish, ELIM_START_MS)
      })
    },
    [finish],
  )

  // Playback really began. This is where both clocks start: the floor the loop
  // is measured against, and the clip's own guard — so a slow load spends
  // neither. Only the first one counts; a stall that resumes fires `playing`
  // again and must not hand the clip a fresh budget.
  const onPlaying = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (started.current !== 0) return
      started.current = performance.now()
      if (guard.current) clearTimeout(guard.current)
      guard.current = setTimeout(finish, guardMsFor(e.currentTarget.getAttribute('src') ?? ''))
    },
    [finish],
  )

  // one loop finished: play it again until the floor is reached, then leave
  const onEnded = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (performance.now() - started.current < ELIM_MIN_MS) {
        const v = e.currentTarget
        v.currentTime = 0
        void v.play()
        return
      }
      finish()
    },
    [finish],
  )

  // A missing file, or a codec the browser refuses. Nothing is invented in its
  // place: the board is already in its eliminated state, which is what carries
  // the news — the clip was the punctuation, not the sentence.
  const onError = useCallback(() => finish(), [finish])

  // A new match cancels what is in the air — the same reason every other runner
  // has a reset: a clip left playing would cover a board that no longer exists.
  const reset = useCallback(() => finish(), [finish])

  const overlay: ReactNode[] = clip
    ? [
        <div key="elimination" className={styles.overlay} data-testid="elimination-clip">
          <video
            // a media element does NOT re-fetch when `src` changes: keyed by the
            // source, so a different clip is a different element (I5)
            key={clip}
            className={styles.video}
            src={clip}
            // `autoPlay` starts it; the ref starts it again and CATCHES. A
            // refused autoplay rejects the promise and fires no event at all,
            // so without this the beat would wait on a clip that was never
            // going to play. Muted playback is allowed by every current policy,
            // which is what makes this the rare path rather than the usual one.
            ref={(el) => {
              if (!el) return
              try {
                // `play()` returns a promise in a browser; an environment with
                // no media pipeline (jsdom) throws from it instead. Neither is
                // a reason to end the beat by itself — a throw here means the
                // element's own events are what drive it, and the loading guard
                // is still standing behind them.
                void el.play()?.catch(() => finish())
              } catch {
                // no media pipeline — leave it to the events and the guard
              }
            }}
            autoPlay
            muted
            playsInline
            onPlaying={onPlaying}
            onEnded={onEnded}
            onError={onError}
          />
        </div>,
      ]
    : []

  return { overlay, run, reset }
}
