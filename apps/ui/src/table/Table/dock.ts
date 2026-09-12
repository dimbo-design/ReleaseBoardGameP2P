import type { TurnDockState } from '@/table/TurnDock/TurnDock'
import { pendingOwedBy, pendingOwesSelf } from './intents'
import type { TableState } from './types'

export interface DockView {
  state: TurnDockState
  danger: boolean
  // Absent when the state carries no deadline. A number here always means time
  // genuinely left, so `0` reads as expired rather than as "no clock" — the two
  // are different things and a single number cannot say both.
  seconds?: number
  progress: number
  activePlayer?: string
  // 'attack' only: this seat has already passed on the open window, so the key
  // is lit and pressing it takes the pass back.
  passed?: boolean
  // 'attack' / 'exposed': the window's passes as a count — dots, not names.
  passes?: { total: number; lit: number }
}

// What a ring shows with the clocks switched off: full, and no number. See
// `deriveDock`'s `timers` for why full rather than empty.
const FULL_RING = { progress: 1 } as const

// Both ends of a deadline span, so the ring's sweep is exact rather than
// assumed — no WINDOW_MS constant exists on purpose (a hardcoded duration
// would make a visible countdown wrong the moment the engine's timings
// change). Either bound missing (an untimed pending) reads as a flat ring.
function countdown(
  openedAt: number | undefined,
  deadline: number | undefined,
  now: number,
): { seconds?: number; progress: number } {
  if (openedAt === undefined || deadline === undefined) return { progress: 0 }
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000))
  const span = deadline - openedAt
  const progress = span > 0 ? Math.min(1, Math.max(0, (deadline - now) / span)) : 0
  return { seconds, progress }
}

// Whether any deadline is running for this viewer — the states where
// `deriveDock` draws a counting ring, and so the only states where a
// consumer's clock has to tick. Exported because a consumer that ticks on a
// different rule than the one the ring is drawn from will freeze the
// countdown for whatever state the two disagree about; there is one rule and
// this is it — each branch mirrors the matching `deriveDock` branch below.
export function isCounting(state: TableState, selfId: string, timers = true): boolean {
  // The table's clocks switched off by the host: every ring that could have
  // counted is simply full, so there is nothing anywhere to tick.
  if (!timers) return false
  // A release's own price is not a state of the table (#101) — see `deriveDock`
  // below. It is one action inside a turn, so it falls through to the turn's
  // own clock rather than answering here, exactly as the ring it mirrors does.
  if (state.pending && state.pending.kind !== 'discardForRelease') {
    // Only your OWN decision counts down here — waiting on somebody else's is a
    // flat ring, so there is nothing for a consumer to tick. Mirrors the two
    // pending branches in `deriveDock` below.
    //
    // Both halves are load-bearing, and a `systemUpgrade` fails the second: it
    // carries no deadline, so even the seats it owes get a flat ring — which is
    // exactly what `deriveDock`'s `timed` already produces for it below. Owed
    // to several seats at once, it is the first pending where "is it mine" is
    // not a single comparison, so it goes through the one predicate.
    return pendingOwesSelf(state.pending, selfId) && 'deadline' in state.pending
  }
  // Mirrors the window branch below exactly: the window's OWNER gets the hold
  // ring with a live clock whoever they are — elimination only silences a
  // would-be responder, whose branch is the guarded one.
  if (state.window) return state.window.player === selfId || !state.you.eliminated
  return state.turn === selfId && state.turnClock != null
}

// How the open window's passes stand, as two numbers: one dot per seat that may
// attack, lit for each pass. Responders are every living seat except the one
// whose release is under the window — the same rule the engine closes the window
// early by, so the row fills up exactly as the window runs out. Clamped, because
// a `passed` entry for a seat that has since been eliminated would otherwise
// light a dot that no longer has a seat behind it.
function passesOf(state: TableState, target: string): { total: number; lit: number } {
  const seats = [
    { id: state.selfId, eliminated: state.you.eliminated },
    ...state.opponents.map((o) => ({ id: o.id, eliminated: o.eliminated })),
  ]
  const total = seats.filter((s) => s.id !== target && !s.eliminated).length
  const passed = state.window?.passed.length ?? 0
  return { total, lit: Math.min(passed, total) }
}

// `now` is supplied by the caller — the kit never reads the clock itself.
//
// One decision table, ordered by what the engine would actually accept from
// this viewer: a key is only ever offered where the action behind it is legal
// RIGHT NOW. Every branch below that shows no key exists because the engine
// rejects everything the dock could offer there — a live-looking key whose
// clicks vanish in silent rejections is exactly the defect this table ended.
export function deriveDock(
  state: TableState,
  selfId: string,
  now: number,
  // The host's switch for the whole table. Off, every ring that could have
  // carried a clock reads FULL and numberless — not empty, which is what a
  // finished countdown looks like, and not zero, which is what an expired one
  // looks like. A full ring says "all the time there is", and that is exactly
  // what a table without clocks gives you. The engine's deadlines are untouched;
  // this is what the dock shows.
  timers = true,
): DockView {
  const yours = state.turn === selfId
  const activePlayer = state.opponents.find((o) => o.id === state.turn)?.name
  const pending = state.pending
  const clock = timers ? countdown : () => FULL_RING

  // `discardForRelease` is excluded from BOTH pending branches below (#101).
  // A release's own price is one action inside a turn, not a state of the
  // table: the phase has not changed and the turn is still its owner's, so the
  // dock keeps the turn's own phase, accent and clock — the actor falls to the
  // `yours` branch at the bottom, everyone else to `waiting`, which is exactly
  // what each of them saw a moment earlier. The engine only ever opens this
  // pending on its owner's own turn (`playableFor` checks turn ownership), and
  // no window can be open alongside it (same check), so those two branches are
  // where it always lands.
  //
  // It keeps a live key rather than the "no key while the engine would refuse"
  // rule below, because the action behind that key IS legal: the first press
  // takes the staged release back (`cancelRelease`), the next one draws or
  // pushes. That is the same rule the table already runs — while an unpaid
  // release stands, anything other than paying takes it back.
  //
  // A pending owed by you outranks everything — the engine is waiting on your
  // decision. The choice itself lives on the table or in the PendingPrompt;
  // the dock narrates the phase and counts its clock down.
  // "Owed by you" is `pendingOwesSelf`, not a comparison: a `systemUpgrade`
  // owes every seat on its roster at once while it is discarding, and the
  // actor alone once it is picking — so the actor sits in the `hold` branch
  // below for the first half of their own card and lands here for the second.
  if (pending && pending.kind !== 'discardForRelease' && pendingOwesSelf(pending, selfId)) {
    const timed = 'deadline' in pending ? pending : undefined
    return {
      state: 'reaction',
      danger: pending.kind === 'defend' || pending.kind === 'neutralize503',
      ...clock(timed?.openedAt, timed?.deadline, now),
      activePlayer,
    }
  }

  // Someone else's pending blocks every action of yours — DRAW, PLAY, PUSH,
  // even PASS all reject while any decision is open — so the dock holds and
  // names whose decision the table is waiting on.
  //
  // Their clock is NOT shown, deliberately: a watcher sees whose move it is and
  // an empty ring, never somebody else's countdown ticking at them. It is not
  // their time to spend, and a number they cannot act on only twitches while
  // they wait (designer's call). The whole span of "how long is left" belongs to
  // the seat that owes the decision, and that seat reads it in the branch above.
  //
  // This is also what ends the `0s` ring for good: a beat that has to publish a
  // stand-in pending so an attack keeps standing on screen (`docs/animations/
  // backlog.md`) can carry no clock worth reading, and every peer it reaches is
  // by definition not its owner — so they land here, where there is no clock to
  // misread in the first place.
  if (pending && pending.kind !== 'discardForRelease') {
    return {
      state: 'hold',
      danger: false,
      progress: 0,
      // Whose decision the table is waiting on — for a `systemUpgrade`, the
      // first seat still owing (the actor once it is picking), which is what
      // `pendingOwedBy` answers. One name, because the dock has one slot for
      // one: a roster of three would need a row this component does not have,
      // and naming the next seat to answer is the honest reduction of it.
      activePlayer: state.opponents.find((o) => o.id === pendingOwedBy(pending))?.name,
    }
  }

  if (state.window) {
    const { openedAt, deadline } = state.window
    // Your own release under the window: nothing here is yours to press — you
    // cannot attack it, pass on it, or end the turn under it — so the window's
    // countdown IS the content, and it is your own clock to read: the time
    // opponents have to hit you. Its own phase rather than a shade of `hold`,
    // which is for waiting on somebody else's decision; this is waiting on the
    // table. No activePlayer: it is still your turn.
    if (state.window.player === selfId) {
      return {
        state: 'exposed',
        danger: false,
        ...clock(openedAt, deadline, now),
        passes: passesOf(state, selfId),
      }
    }
    // Somebody else's fresh release is open to me — the offensive half of a
    // window, and its own phase rather than a shade of `reaction`: answering an
    // attack and being free to make one are opposite situations, and the dock
    // is read at a glance.
    //
    // Every living responder may PASS (and UNPASS), holding attack cards or
    // not — the "everyone passed, close early" rule is only reachable when the
    // card-less can concur too. Gating this on canAttackWith is what used to
    // make every window run its full clock.
    if (!state.you.eliminated) {
      return {
        state: 'attack',
        danger: false,
        ...clock(openedAt, deadline, now),
        activePlayer,
        // A pass is about this moment, not the window: it can be taken back
        // while the window stands, and it never bars a later attack.
        passed: state.window.passed.includes(selfId),
        passes: passesOf(state, state.window.player),
      }
    }
  }

  if (yours) {
    // The turn's own inactivity clock. Absent (a flat ring) before the keeper
    // starts the first turn's clock — a `0` here would read as expired.
    return {
      state: state.hasDrawn ? 'push' : 'draw',
      danger: false,
      ...clock(state.turnClock?.openedAt, state.turnClock?.deadline, now),
      activePlayer,
    }
  }

  return { state: 'waiting', danger: false, progress: 0, activePlayer }
}
