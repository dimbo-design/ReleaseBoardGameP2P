import type { Event } from '@release/engine'
import type { ReactNode, RefObject } from 'react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type {
  BeatRun,
  BoardAnchors,
  BoardState,
  HandLimitHandoff,
  IntroBeat,
  StagedHandoff,
} from '~/entities/game/board'
import { useReducedMotion } from '~/shared/lib/useReducedMotion'
import { useAiBeat } from './aiBeat'
import { useComboBeat } from './comboBeat'
import { useDeckBeat } from './deckBeat'
import { useDefenseBeat } from './defenseBeat'
import { useDiscardBeat } from './discardBeat'
import { useDrawBeat } from './drawBeat'
import { useEliminateBeat } from './eliminateBeat'
import { useGameEndBeat } from './gameEndBeat'
import { useHandLimitBeat } from './handLimitBeat'
import type { BeatPlan } from './planBeats'
import { planBeats } from './planBeats'
import { useTransferBeat } from './transferBeat'

// The board's beat queue. `useGame` accumulates engine events off the wire in
// BATCHES — a peer can receive several moves in one sync — so a board that
// animated on render would either play them on top of each other or drop all
// but the last. One beat runs at a time; the board renders a SHADOW while it
// does, and the shadow is the projection the beat is animating away from.
//
// Two properties are the whole point, and both are structural rather than
// promised:
//
//   • The last frame of a beat IS the projection it hands over to. A card flies
//     on scatterAt(eventId) and the heap rests it on scatterAt(eventId) — one
//     value, two readers (I7) — so the handover changes nothing on screen.
//   • The board can never be stranded behind the projection. The shadow's whole
//     lifetime is the queue's: when the queue drains it is dropped and live
//     wins, whatever happened inside a beat. There is no path where a thrown
//     run, a missing rect or a bad plan leaves an old state on the table.
//   • The handover holds BETWEEN the beats of a batch too, not only at its end.
//     A beat may move the board under itself, so the one behind it starts from
//     where that one finished rather than from where the batch began (`after`
//     on Beat) — otherwise a batch would rewind itself once per beat.
//
// One policy, one place: prefers-reduced-motion is read HERE. `play()` in
// @release/ui drives WAAPI directly and does not check it, so every consumer
// would otherwise have to remember — which is precisely the kind of thing that
// gets remembered nine times out of ten.

interface Beat {
  key: string
  /**
   * The projection this beat animates AWAY from — the board while it runs.
   * Resolved when the beat STARTS rather than when it is planned; see `after`.
   */
  base: BoardState
  /**
   * The beat this one follows inside its own batch. A batch is planned in one
   * pass against one projection, so without this every beat of it would animate
   * away from the state the batch STARTED at — and a batch that publishes would
   * be rolled back by the beat behind it. `[drawn(mine), pilesChanged]` is the
   * real case: the draw grows the fan to N+1 and publishes it, then the pile
   * beat renders its own base at N and the card pops out of the hand and back
   * in when the queue drains.
   *
   * A link and not a captured state, because the value is not knowable at plan
   * time: what a beat leaves on the table exists only once it has run. It is
   * read at start-of-beat instead, off `ended` below.
   *
   * The opening carries none. It is unshifted AHEAD of whatever is queued, it
   * publishes a shape of its own rather than a fold of the projection, and the
   * batch behind it was planned against the live board — chaining the deal into
   * it would hand a beat a base nothing planned it against.
   */
  after?: Beat
  /**
   * What this beat left on the table: its last publish, or — when it published
   * nothing — the very base it was handed, passed on untouched. Written when
   * the beat is over, read by the beat that follows it.
   */
  ended?: BoardState
  /** it owns the table: input is dead while it runs */
  exclusive: boolean
  /**
   * A sweep is running: a defenceless player's whole table is gathering at
   * the centre before it scatters (#102). The engine eliminates in the same
   * batch as the reveal, so no `pending` is ever raised for this path — this
   * is the only alarm the board gets, and it is what keeps the glow lit while
   * the hand flies away with no pending to explain it. Set where the plan
   * becomes a beat rather than derived from `plan.kind` in the queue's own
   * runtime state, which keeps plan shapes out of it.
   */
  alarm: boolean
  run: (ctx: BeatRun) => Promise<void>
}

export interface Beats {
  shadow: BoardState | null
  overlays: ReactNode[]
  exclusive: boolean
  /** the running beat's own alarm — see `Beat.alarm` */
  alarm: boolean
  /**
   * The queue is still working: a beat is running, and the batch behind it has
   * not drained. What the board holds its END back on (#103) — the engine
   * settles an elimination and the win it caused in ONE reduction, so `over`
   * is true on the projection while the sweep and the clip are still queued,
   * and `over` rides BESIDE the projection (`toBoardOver`, its own prop)
   * rather than inside it, so no shadow can stand in for this.
   *
   * Not the same fact as `exclusive`, which asks whether input is dead: an
   * ordinary discard is not exclusive and is very much still working.
   */
  running: boolean
  gapAt: number | null
  gapSize: number
}

export function useBeats(args: {
  live: BoardState
  events: Event[]
  anchors: BoardAnchors
  enabled: boolean
  intro?: IntroBeat | null
  // The staging → beat handoff (#100): the page's staged play, read once at
  // the start of `attackPlaced`/`releasePlaced` and cleared through its own
  // `release()` when that play turns out to be the local actor's.
  staging?: RefObject<StagedHandoff | null>
  // The same seam's second fact (#101, Task 11): a stable ref to
  // `_useBoardStaging.ts`'s own `clearPaidCost`, called once `releasePlaced`'s
  // own cost leg hands the paid card to the discard exit.
  clearPaidCost?: RefObject<(() => void) | null>
  // The same seam's third fact (#101, Fix A): a stable ref to
  // `_useBoardStaging.ts`'s own `takeStagedRelease`, called once
  // `releasePlaced` picks the standing release up out of the stage slot.
  takeStagedRelease?: RefObject<(() => void) | null>
  // The hand limit's own handoff (#104): the grid the local player filled by
  // hand, read once at the start of a `handLimit` beat so the runner flies the
  // cells that are standing instead of a fan the cards left long ago.
  handLimit?: RefObject<HandLimitHandoff | null>
}): Beats {
  const {
    live,
    events,
    anchors,
    enabled,
    intro,
    staging,
    clearPaidCost,
    takeStagedRelease,
    handLimit,
  } = args
  const reduced = useReducedMotion()
  const [running, setRunning] = useState<Beat | null>(null)
  // The same answer as `running`, but ahead of it: `drain()` sets this
  // synchronously, inside the very effect pass that queued the beat, while
  // `running` only says so once React has committed. So the effect GUARDS on
  // the ref — no pass can queue against a state nobody has seen yet, not even a
  // re-invoked one — and DEPENDS on `running`, which is what re-arms it when the
  // queue drains. Two readers of one fact, each for what it is good at.
  const runningRef = useRef<Beat | null>(null)

  // What the RUNNING beat has moved the board to. The opening always published a
  // shape of its own; this is the same door, opened to every beat, because a
  // multi-draw grows the fan between its cards (I8) and a split has to render a
  // pile before it can be measured. It lives and dies with the beat: cleared when
  // one starts and again when the queue drains, so it can never outlast the run
  // that produced it.
  const [advanced, setAdvanced] = useState<BoardState | null>(null)

  const discards = useDiscardBeat(anchors)
  const draws = useDrawBeat(anchors)
  const decks = useDeckBeat(anchors)
  const combo = useComboBeat(anchors, staging, clearPaidCost, takeStagedRelease)
  const defense = useDefenseBeat(anchors, staging)
  const elimination = useEliminateBeat()
  const gameEnd = useGameEndBeat()
  const handLimits = useHandLimitBeat(anchors, handLimit)
  const transfers = useTransferBeat(anchors)
  const ais = useAiBeat(anchors)

  // `intro` rides along because the arming effect below reads the beat from here
  // rather than from its own closure: the effect fires on the match key, and the
  // beat object is rebuilt every time the opening publishes a shadow.
  const latest = useRef({ live, intro })
  latest.current = { live, intro }

  // How far into the feed the queue has already looked. Event ids are the
  // engine's own monotonic sequence, so this is a watermark and not a count —
  // a batch that arrives while a beat runs is picked up on the next pass.
  //
  // Monotonic WITHIN a match, and only within one: the engine seeds `eventSeq`
  // afresh each game, so game two's ids all sit below game one's mark. The board
  // is not remounted for a rematch, so without the reset below `fresh` would be
  // empty for the whole second match and nothing would ever animate again. This
  // is the same shape as the "once per peer" bug the opening had — a latch that
  // outlived the thing it was latching.
  const seen = useRef(0)
  const queue = useRef<Beat[]>([])
  const draining = useRef(false)

  // The queue builds a Beat out of a plan and the runner that plays it. It knows
  // that a beat HAS a runner; it does not know what any of them do.
  const beatOf = useCallback(
    (plan: BeatPlan, base: BoardState): Beat | null => {
      if (plan.kind === 'discard') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: plan.gather === true,
          run: (ctx) => discards.run(plan, ctx),
        }
      }
      if (plan.kind === 'handLimit') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: false,
          run: (ctx) => handLimits.run(plan, ctx),
        }
      }
      if (plan.kind === 'draw') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          // A 503 a standing Monitoring answered by itself raises no pending at
          // all (#103 testing, problem 2), so `glowStrong` has nothing to read
          // — yet the table still has to see that a 503 landed. The plan
          // carries the fact; this is the same field, and the same reason, the
          // defenceless sweep lights its own glow with.
          alarm: plan.draws.some((d) => d.reveal?.neutralized === true),
          run: (ctx) => draws.run(plan, ctx),
        }
      }
      if (plan.kind === 'reshuffle') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: false,
          run: (ctx) => decks.runReshuffle(plan, ctx),
        }
      }
      if (plan.kind === 'piles') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: false,
          run: (ctx) => decks.runPiles(plan, ctx),
        }
      }
      if (plan.kind === 'gameEnd') {
        return {
          key: plan.key,
          base,
          exclusive: true,
          alarm: false,
          run: (ctx) => gameEnd.run(plan, ctx),
        }
      }
      if (plan.kind === 'attackPlaced') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: false,
          run: (ctx) => combo.runAttack(plan, ctx),
        }
      }
      if (plan.kind === 'releasePlaced') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: false,
          run: (ctx) => combo.runRelease(plan, ctx),
        }
      }
      if (plan.kind === 'pairToDiscard') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: false,
          run: (ctx) => combo.runPairOut(plan, ctx),
        }
      }
      if (plan.kind === 'covered') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: false,
          run: (ctx) => defense.runCovered(plan, ctx),
        }
      }
      if (plan.kind === 'stolen') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: false,
          run: (ctx) => defense.runStolen(plan, ctx),
        }
      }
      if (plan.kind === 'eliminated') {
        return {
          key: plan.key,
          base,
          // EXCLUSIVE, unlike every beat above it: the clip covers the whole
          // stage, and a table nobody can see is not a table anybody may play
          // on. It is also what makes the runner's own ceiling load-bearing —
          // a clip that never ends would hold the board here (#103).
          exclusive: true,
          // The alarm belongs to the sweep, and the sweep is over: the glow
          // goes dark as the clip comes up, rather than burning under it.
          alarm: false,
          run: (ctx) => elimination.run(plan, ctx),
        }
      }
      if (plan.kind === 'neutralized') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: false,
          run: (ctx) => defense.runNeutralized(plan, ctx),
        }
      }
      if (plan.kind === 'handTransfer') {
        return {
          key: plan.key,
          base,
          // Not exclusive: a card changing hands does not own the table the way
          // an elimination clip does, and nothing about it needs input dead.
          exclusive: false,
          alarm: false,
          run: (ctx) => transfers.runTransfer(plan, ctx),
        }
      }
      if (plan.kind === 'requested') {
        return {
          key: plan.key,
          base,
          exclusive: false,
          alarm: false,
          run: (ctx) => transfers.runRequested(plan, ctx),
        }
      }
      if (plan.kind === 'aiEvent') {
        return {
          key: plan.key,
          base,
          // Not exclusive: an AI card is read, not obeyed, and nothing about it
          // needs input dead.
          exclusive: false,
          // The 503 mimic's own glow. A `standing` tail carries it too, because
          // the alarm is owed for as long as the prompt is — same field, same
          // reason, as `draw`'s `neutralized` case.
          alarm:
            plan.tail.kind === 'alarm' ||
            (plan.tail.kind === 'standing' && plan.tail.alarm === true),
          run: (ctx) => ais.run(plan, ctx),
        }
      }
      if (plan.kind === 'takenFromDiscard') {
        return {
          key: plan.key,
          base,
          // Not exclusive: a card coming back out of the discard is read, not
          // obeyed, and nothing about it needs input dead — same reasoning as
          // `aiEvent` just above.
          exclusive: false,
          alarm: false,
          run: (ctx) => ais.runTaken(plan, ctx),
        }
      }
      return null
    },
    [
      discards.run,
      draws.run,
      decks.runReshuffle,
      decks.runPiles,
      combo.runAttack,
      combo.runRelease,
      combo.runPairOut,
      defense.runCovered,
      defense.runStolen,
      defense.runNeutralized,
      elimination.run,
      gameEnd.run,
      handLimits.run,
      transfers.runTransfer,
      transfers.runRequested,
      ais.run,
      ais.runTaken,
    ],
  )

  // The mount is going away: stop starting things. A beat already in flight
  // finishes its own await chain — there is no way to pull it out of a wait() —
  // but nothing after it runs, and nothing reaches for a node that is gone.
  //
  // It is armed on the way IN as well as disarmed on the way out, and the
  // asymmetry it replaces cost the whole screen: a teardown that only ever set
  // this to false left it false for the life of the next mount, and `drain`'s
  // `while (next && alive.current)` then shifted every beat off the queue
  // without running one of them. StrictMode performs that teardown on every
  // mount in development, so the opening never played, never reported, and the
  // board held every block at opacity 0 with the start gate still waiting.
  const alive = useRef(true)
  useLayoutEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      queue.current = []
    }
  }, [])

  const drain = useCallback(async () => {
    if (draining.current) return
    draining.current = true
    try {
      let next = queue.current.shift()
      while (next && alive.current) {
        // The handover between two beats of one batch, resolved HERE because
        // here is the first moment it exists: the board this beat animates away
        // from is the board the beat in front of it left. Writing it onto the
        // beat rather than keeping it beside the beat is what makes the shadow
        // (`advanced ?? running.base`) show it too — a base resolved into a
        // local would move the first frame of the run and leave the render
        // behind on the planned one, which is the very flicker this closes.
        next.base = next.after?.ended ?? next.base
        runningRef.current = next
        setRunning(next)
        setAdvanced(null)
        // Where the beat ends up, tracked as it publishes. It starts at the
        // base, so a beat that publishes nothing hands its own board on
        // unchanged and the chain neither breaks nor invents a step.
        let ended = next.base
        const publish = (state: BoardState) => {
          ended = state
          setAdvanced(state)
        }
        // A beat that throws must not hold the board: the shadow is dropped in
        // the finally below regardless, so a failure costs the animation and
        // never the state.
        try {
          await next.run({ base: next.base, publish })
        } catch (err) {
          if (import.meta.env.DEV) console.error('[beats] %s failed', next.key, err)
        }
        // Even after a throw: whatever it managed to publish IS on screen, and
        // the beat behind it has to animate away from that and not from a board
        // two states back.
        next.ended = ended
        next = queue.current.shift()
      }
    } finally {
      draining.current = false
      runningRef.current = null
      setRunning(null)
      setAdvanced(null)
    }
  }, [])

  // The last projection the board actually SHOWED. Not `live`: by the time the
  // batch effect runs, `live` is already the projection the arriving batch
  // produced — the card is out of the hand and counted in the discard. The slot
  // it has to fly from is on the previous one, which is what is still on
  // screen (I1).
  const settled = useRef(live)

  // A new match: the feed starts over, so the watermark, the base and the queue
  // must too. Declared BEFORE the arm effect, and the order is load-bearing:
  // the wipe takes whatever the dead match left in the queue, and the arm then
  // unshifts the new opening into the emptied one. The other order loses the
  // opening whenever a beat is still in flight — the end of a match is exactly
  // when discards fly — because the arm's drain() returns at its `draining`
  // guard instead of shifting the beat out synchronously, the wipe then takes
  // it, and `armed` already holds the new key so nothing re-arms it: the
  // opening never reports and the host's start gate never opens. (Being before
  // the arm also keeps it before the BATCH effect, which must not read a stale
  // watermark on the one pass where it matters most.)
  const playing = useRef<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `discards`, `draws`, `decks`, `combo`, `defense`, `elimination`, `gameEnd`, `handLimits`, `transfers` and `ais` are read for the CURRENT render's runners on purpose, not added to the deps below — this effect is keyed to the match, not runner object identity
  useLayoutEffect(() => {
    const key = intro?.key ?? null
    if (key == null || playing.current === key) return
    playing.current = key
    seen.current = 0
    settled.current = live
    queue.current = []
    // A new match cancels what is in the air. The wipe just above takes the
    // RECORD of the work still queued — it does nothing for a beat already
    // shifted out and running, because that beat is not in the queue any more.
    // Its own carriers (a flyer mid-flight, a parked hand-arrival, a parked
    // discard exit) belong to the runner, not to the queue, and they outlive
    // the dead match unless told otherwise: a card from it would keep crossing
    // the board of the NEW one, flying to a discard pile — or a hand — that no
    // longer exists. So every runner's own reset() runs here too, beside the
    // wipe, for the same match-boundary reason.
    discards.reset()
    draws.reset()
    decks.reset()
    combo.reset()
    defense.reset()
    elimination.reset()
    gameEnd.reset()
    handLimits.reset()
    transfers.reset()
    ais.reset()
  }, [intro?.key, live])

  // Beat zero, queued once. Keyed by the intro's own key so a re-render with a
  // fresh object cannot re-arm it, and React 19 StrictMode's double invoke plays
  // it once — the same guarantee the intro used to keep for itself with
  // `armedFor`, now kept here because the queue is what starts it.
  // It depends on the KEY, not on the beat: `useDealIntro` rebuilds that object
  // every time its shadow moves, which is many times per opening, and an effect
  // watching the object would tear down and re-arm on each one. The key changes
  // once per match, which is exactly how often this should fire. The body reads
  // the beat through `latest`, so it still starts the current one.
  const armed = useRef<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `intro?.key` is the trigger, not a value the body reads — a new match must re-arm this, and the beat itself comes from `latest` precisely so the effect does NOT re-run on every shadow it publishes
  useLayoutEffect(() => {
    const beat = latest.current.intro
    if (!beat || armed.current === beat.key) return
    armed.current = beat.key
    // Reduced motion collapses the opening exactly as it collapses every other
    // beat — `run` is never called. But the opening still has to REPORT, or the
    // host's start gate never opens and the match never begins, so this is the
    // one beat the queue tells explicitly to jump to its end state.
    if (reduced) {
      beat.collapse()
      return
    }
    queue.current.unshift({
      key: beat.key,
      // A placeholder: while an exclusive beat runs the board renders the
      // intro's OWN published shadow, not this. It is here because a Beat has a
      // base and this one animates away from the projection at large.
      base: latest.current.live,
      exclusive: true,
      alarm: false,
      run: beat.run,
    })
    void drain()
    // The teardown releases the arm, and it has to: `useDealIntro`'s own cleanup
    // CANCELS the run in flight on the same teardown, by bumping the id every
    // await in the sequence checks. An arm that outlived that cancel would tell
    // the next mount the opening had already played, while the run it referred
    // to had been killed mid-step — so nothing would report, the board would
    // hold every block at opacity 0 for the life of the mount, and the host's
    // start gate would wait on a seat that had stopped watching. StrictMode does
    // exactly this teardown on every mount in development.
    return () => {
      armed.current = null
    }
  }, [intro?.key, reduced, drain])

  // `running` is a dependency although the body reads the ref instead: it is
  // what re-arms this effect the moment the queue drains, so a batch that
  // arrived mid-beat is picked up on the next pass. That deferral is what makes
  // this a queue rather than a one-slot buffer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `running` re-arms the effect on drain; the body reads `runningRef` because it must also see a beat this same pass started
  useLayoutEffect(() => {
    // FIRST, before the running-beat guard: nothing here is to be animated, so
    // the watermark keeps pace with the feed and `settled` with the projection.
    // Order matters — the opening is an exclusive beat that occupies the queue
    // for its whole run, so a guard placed above this would freeze both for the
    // length of the opening, and the moment it drained the board would plan the
    // entire accumulated feed against a pre-game table. That is exactly what
    // this branch exists to prevent, and the start gate's cap makes it reachable
    // rather than theoretical: a slow peer is released while still watching.
    if (!enabled) {
      seen.current = events.at(-1)?.id ?? seen.current
      settled.current = live
      return
    }
    // A beat is up: the board is its shadow, and a batch arriving now waits its
    // turn rather than being planned against a state nobody can see.
    if (runningRef.current) return
    const before = settled.current
    settled.current = live
    const fresh = events.filter((e) => e.id > seen.current)
    if (fresh.length === 0) return
    seen.current = fresh.at(-1)?.id ?? seen.current
    // Reduced motion collapses every beat to its end state, and the end state is
    // the projection the board already holds — so there is nothing to do but
    // let it render. Planned nowhere, run nowhere: one branch, one place.
    if (reduced) return
    // Every beat of the batch is planned against ONE projection — the board
    // still on screen (I1) — and then chained, so that a beat which moves the
    // board hands it on instead of having it taken back. Planning cannot do the
    // chaining itself: a plan is a fold of events, and where a beat ends is only
    // known once it has run.
    let previous: Beat | undefined
    for (const plan of planBeats(fresh, before, live.pending, live.decks.discardCount)) {
      const beat = beatOf(plan, before)
      if (!beat) continue
      beat.after = previous
      previous = beat
      queue.current.push(beat)
    }
    void drain()
  }, [events, live, enabled, reduced, beatOf, drain, running])

  return {
    // The shadow is what the running beat has published, or its own base while
    // it has published nothing yet. The one exception is the opening, which
    // publishes a whole shape of its own rather than animating away from a
    // projection — while it runs, that shape IS the board, until a publish of
    // its own arrives to take over from it. It all goes null the moment the
    // beat reports done, so the handover to the live projection is the queue's
    // own last frame.
    shadow:
      (running?.exclusive ? (advanced ?? intro?.shadow) : (advanced ?? running?.base)) ?? null,
    overlays: [
      ...discards.overlay,
      ...draws.overlay,
      ...decks.overlay,
      ...combo.overlay,
      ...defense.overlay,
      ...elimination.overlay,
      ...gameEnd.overlay,
      ...handLimits.overlay,
      ...transfers.overlay,
      ...ais.overlay,
    ],
    exclusive: running?.exclusive ?? false,
    alarm: running?.alarm ?? false,
    // `running` (the state) is held for the whole drain, not per beat: `drain()`
    // clears it in its own `finally`, once the queue is empty. So this stays
    // true across the handover between two beats of one batch, which is exactly
    // the window the winner overlay must not appear in.
    running: running != null,
    // The fan opens for a card on its way into it. Three beats grow it now —
    // a draw (I8), a card taken from an opponent, and a Release taken back
    // out of the discard (#106) — and never more than one of them is open at
    // once, because one beat runs at a time. So this is a choice between
    // them, not a merge of them.
    gapAt: draws.gapAt ?? transfers.gapAt ?? ais.gapAt,
    gapSize:
      draws.gapAt == null
        ? transfers.gapAt == null
          ? ais.gapSize
          : transfers.gapSize
        : draws.gapSize,
  }
}
