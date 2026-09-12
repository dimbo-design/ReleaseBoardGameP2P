// The release-stands-at-the-centre gesture (#101, Task 8): playing a release
// sets a `discardForRelease` pending and emits nothing, so the standing
// release is purely local until the cost is paid. This suite pins that the
// board renders that standing exactly as the rules ask — the release at the
// centre, not landed — and that the fan itself is the picker for its cost.
// Same render harness as boardStaging.test.tsx — see that file's header.

import type { CardData, TableActions, TablePending } from '@release/ui'
import { cardById } from '@release/ui'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useBoardAnchors } from '~/entities/game/board'
import Board from '../_Board'
import { useBoardStaging } from '../_useBoardStaging'
import { makeBoardProps } from './fixture'

// The one thing about the standing release that only `<Board>` itself can be
// asked (#101, Fix A): whether its render actually reads `stageStanding`. The
// stage machine leaves `'standing'` when the placement beat takes the card
// over, and no beat can run inside `<Board>` in a test — the queue is fed from
// `intro.events`, and with an `intro` present the queue is gated on the deal
// reporting done (comboHandoff.test.tsx's own header explains why that harness
// exists instead). Mutation-checked: without this, dropping the guard from
// `_Board.tsx` leaves the whole suite green, because the only other place the
// expression exists is comboHandoff's mirror of it.
//
// The real hook runs untouched; the toggle below overrides exactly one field,
// and only while a test turns it on — so every other test in this file (and
// the `renderHook` on the real hook further down) is unaffected.
const placing = vi.hoisted(() => ({
  on: false,
  // what the real hook returned on the last render — the other end of the
  // wiring pinned below
  staging: null as ReturnType<typeof useBoardStaging> | null,
}))
// what `<Board>` asked the hook FOR — the match-boundary wiring's own pin
// (#101, Fix C, finding 3)
const stagingOpts = vi.hoisted(() => ({
  last: null as { matchKey?: string | null } | null,
}))
vi.mock('../_useBoardStaging', async (importOriginal) => {
  const real = await importOriginal<typeof import('../_useBoardStaging')>()
  return {
    ...real,
    useBoardStaging: (opts: Parameters<typeof real.useBoardStaging>[0]) => {
      stagingOpts.last = opts
      const staging = real.useBoardStaging(opts)
      placing.staging = staging
      return placing.on ? { ...staging, stageStanding: false } : staging
    },
  }
})

// The OTHER end of the same seam (#101, Fix A, fix round 1 — review finding
// 1). `_Board.tsx` has two lines whose only job is to hand the placement beat
// its way back into the staging hook: the `takeStagedRelease: takeStagedReleaseRef`
// argument to `useBeats`, and the layout effect that fills that ref. Both are
// invisible to every other test in the repo — `comboHandoff.test.tsx` drives
// the real `useBeats`/`useComboBeat` but wires the ref itself, so it pins
// `useBeats.ts`'s half and not `_Board.tsx`'s. Deleting either line left all
// 503 tests green while breaking the feature in the app.
//
// That is the same defect class this whole round exists to repair — a
// production line no test can kill — so the two lines get a pin of their own
// rather than inheriting the precedent `handoffRef`/`clearPaidCostRef` set.
// Same shape as the staging wrapper above: the real `useBeats` runs, its args
// are captured on the way past.
const beatsArgs = vi.hoisted(() => ({
  last: null as { takeStagedRelease?: { current: (() => void) | null } } | null,
}))
vi.mock('~/features/board-beats', async (importOriginal) => {
  const real = await importOriginal<typeof import('~/features/board-beats')>()
  return {
    ...real,
    useBeats: (args: Parameters<typeof real.useBeats>[0]) => {
      beatsArgs.last = args as typeof beatsArgs.last
      return real.useBeats(args)
    },
  }
})

// biome-ignore lint/style/noNonNullAssertion: both ids are known catalogue entries
const frontend = cardById('release-frontend')!
// biome-ignore lint/style/noNonNullAssertion: both ids are known catalogue entries
const bug = cardById('attack-bug')!

// The fixed hand every test in this file renders: the release, and the one
// spare card standing by to pay for it.
const HAND: { uid: string; card: CardData }[] = [
  { uid: 'release-frontend#0', card: frontend },
  { uid: 'attack-bug#0', card: bug },
]

// The brief's own sketch of this factory omits `release` — but the whole
// point of this task's projection change is that the OWNER's pending carries
// it (redacted for everyone else, exactly as `options` is). Without it here,
// `_Board.tsx`'s `stagedRelease` has nothing to resolve against `you.hand`,
// and the standing release the first test asserts on could never render.
function costPending(options: string[]): TablePending {
  return { kind: 'discardForRelease', player: 'you', release: 'release-frontend#0', options }
}

function releaseBoard(overrides: { pending?: TablePending }, actions: TableActions = {}) {
  const base = makeBoardProps()
  const props = makeBoardProps({
    state: {
      ...base.state,
      you: { ...base.state.you, hand: HAND },
      turn: base.state.selfId,
      hasDrawn: true,
      playable: HAND.map((c) => c.uid),
      pending: overrides.pending ?? null,
    },
    actions,
  })
  return <Board {...props} />
}

// ===== MISSING FIXTURE 1 (#101, Fix C) — a COMBO release's cost step =====
//
// Nothing in 504 tests ever built this state, which is why the softlock the
// whole-branch review found survived every scoped review. A Code Review combo
// that ships a release raises the SAME `discardForRelease` pending a solo one
// does (`fake/release.ts`'s release branch — `codeReview` merely rides along),
// so from the engine's side there is no second kind of release at all. The
// board treated it as one anyway.
//
// The fixture drives the real gesture end to end: pull the Code Review, click
// its only partner, let the fold settle, then let the engine's answer arrive.
// biome-ignore lint/style/noNonNullAssertion: a known catalogue entry
const review = cardById('support-code-review')!

const COMBO_HAND: { uid: string; card: CardData }[] = [
  { uid: 'support-code-review#0', card: review },
  { uid: 'release-frontend#0', card: frontend },
  { uid: 'attack-bug#0', card: bug },
]

// The pending as the OWNER sees it for a combo: `options` excludes both halves
// of the play (`fake/attacks.ts`'s `pendingView` filters `p.release` and
// `p.codeReview`), so the spare is the only thing that can pay.
function comboCostPending(): TablePending {
  return {
    kind: 'discardForRelease',
    player: 'you',
    release: 'release-frontend#0',
    options: ['attack-bug#0'],
  }
}

function comboReleaseBoard(overrides: { pending?: TablePending }, actions: TableActions = {}) {
  const base = makeBoardProps()
  const props = makeBoardProps({
    state: {
      ...base.state,
      you: { ...base.state.you, hand: COMBO_HAND },
      turn: base.state.selfId,
      hasDrawn: true,
      // a pending suspends normal play — `playableFor`'s own first check
      playable: overrides.pending ? [] : COMBO_HAND.map((c) => c.uid),
      comboOptions: overrides.pending ? {} : { 'support-code-review#0': ['release-frontend#0'] },
      pending: overrides.pending ?? null,
    },
    actions,
  })
  return <Board {...props} />
}

// The fold, through the DOM: pull the support, then click its partner. Both
// halves leave the fan, the pair stands merged at the centre, and the play
// dispatches at once (a release has no target to aim at).
async function foldTheComboRelease() {
  const slots = () => Array.from(document.querySelectorAll<HTMLElement>('[data-hand-slot]'))
  const faceIndex = (cardId: string) =>
    slots().findIndex((el) => el.querySelector(`[data-card="${cardId}"]`))
  const support = slots()[faceIndex('support-code-review')]
  fireEvent.mouseDown(support, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 600))
  })
  const partner = slots()[faceIndex('release-frontend')]
  fireEvent.mouseDown(partner, { clientX: 0, clientY: 0 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: 0 })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700)) // past MERGE_MS (620ms)
  })
}

// The fan's own wrapper — the element that carries the merged-pair pointer
// guard. jsdom does NOT hit-test `pointer-events`, so a `fireEvent` click
// lands whether or not the guard is on: this style read is the load-bearing
// assertion, and the click assertions beside it pin the routing.
function handWrapStyle(): string {
  const wrap = document.querySelector<HTMLElement>('[class*="handWrap"]')
  if (!wrap) throw new Error('hand wrapper not rendered')
  return wrap.style.pointerEvents
}

// Drags a card out of the fan the way a real pointer does — the Hand's own
// drag contract, verbatim from boardStaging.test.tsx.
async function pullCardFromFan(uid: string) {
  const index = HAND.findIndex((c) => c.uid === uid)
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 600))
  })
}

// A plain click on a fan card — no movement, Hand's own click contract
// (mousedown + mouseup at the same point, under the drag threshold). Found by
// the card's own catalogue id (Card.tsx's `data-card`), not its uid — the
// standing release has already left `handItems` by the time this runs, so the
// fan's own slot order no longer lines up with `HAND`'s.
async function clickFanCard(uid: string) {
  const item = HAND.find((c) => c.uid === uid)
  const target = Array.from(document.querySelectorAll<HTMLElement>('[data-hand-slot]')).find((el) =>
    el.querySelector(`[data-card="${item?.card.id}"]`),
  )
  if (!target) throw new Error(`fan slot for ${uid} not found`)
  fireEvent.mouseDown(target, { clientX: 0, clientY: 0 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: 0 })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
}

// The two spies this file installs, each in ONE place (#101, Fix A, fix round
// 1 — review finding 4). Both used to be pasted per test with their restore as
// the last statement of the body, which is a trap rather than a style problem:
// a failing `expect` throws, the restore never runs, and the spy leaks into
// every test after it in the file. For `matchMedia` that turns the whole rest
// of the file reduced-motion; for `animate` it parks every subsequent flight
// on a promise that never settles. Either reads as "one unrelated test in this
// file failed", only when something upstream flakes first — which is exactly
// the shape of the one unexplained web failure this round disclosed. Every
// call site below now restores in a `finally`.
function mockReducedMotion() {
  return vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
}

// jsdom's WAAPI stub (test-setup.ts) resolves `.finished` on the very next
// microtask regardless of the preset's own duration, so a flight has to be
// held open ON PURPOSE to observe the moment it is still in the air.
function holdFlightsOpen() {
  return vi.spyOn(Element.prototype, 'animate').mockImplementation(
    () =>
      ({
        cancel: () => {},
        finished: new Promise<void>(() => {}), // never settles — the flight stays in the air
      }) as unknown as Animation,
  )
}

it('stands the release at the centre and does not land it until the cost is paid', async () => {
  const onPlay = vi.fn()
  const onResolve = vi.fn()
  const { rerender } = render(releaseBoard({}, { onPlay, onResolve }))
  await pullCardFromFan('release-frontend#0')
  expect(onPlay).toHaveBeenCalledWith('release-frontend#0', undefined, undefined)
  // the release left the fan — it must not be pickable a second time there
  expect(document.querySelectorAll('[data-hand-slot]').length).toBe(HAND.length - 1)
  // and it does NOT render at the plain aim/support centre slot — that render
  // is `soloStaged`'s, which excludes a release on purpose (it belongs at the
  // stage slot instead, asserted below)
  expect(screen.queryByTestId('board-centre-staged')).toBeNull()
  // the projected pending has not arrived yet (this render still passes
  // `pending: null`) — the stage slot's card is standing there anyway, off
  // staging's OWN local state (Fix round 1: without that fallback the slot
  // would show nothing for as long as the referee's answer is in flight)
  const stageBefore = document.querySelector('[data-centre-slot="stage"]') as HTMLElement
  expect(stageBefore.querySelector('[data-card]')).toBeTruthy()

  // the engine answers with the cost pending — and the release is standing at
  // the stage slot, NOT in its zone slot
  rerender(releaseBoard({ pending: costPending(['attack-bug#0']) }, { onPlay, onResolve }))
  const stage = document.querySelector('[data-centre-slot="stage"]') as HTMLElement
  expect(stage.querySelector('[data-card]')).toBeTruthy()

  // the fan is the picker — a click on an eligible card pays
  await clickFanCard('attack-bug#0')
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'discardForRelease',
    card: 'attack-bug#0',
  })
  // the paid cost stays open at its own slot — held there, not discarded on
  // the spot (a later task moves it on)
  const cost = document.querySelector('[data-centre-slot="cost"]') as HTMLElement
  expect(cost.querySelector('[data-card="attack-bug"]')).toBeTruthy()
})

// Fix round 1 (post-review): `_useBoardStaging.ts`'s own `handItems` is what
// the fan actually renders — one shorter than `you.hand` for as long as a
// cost is owed, since the staged release is excluded from it. A regression
// that stopped excluding it (e.g. deleting `cost?.release` from that memo)
// would leave every other assertion in this file green — `clickFanCard` finds
// its target by catalogue id, not slot position — so this pins the exclusion
// directly.
it('the fan is one card shorter than the hand while a cost is owed', () => {
  render(releaseBoard({ pending: costPending(['attack-bug#0']) }, {}))
  expect(document.querySelectorAll('[data-hand-slot]').length).toBe(HAND.length - 1)
})

// Fix round 1: the release standing at the stage slot must not ALSO appear at
// the plain centre-staged slot (`soloStaged`'s own render, for a plain
// aim/support) — the two would double the same card on screen if the
// category-release exclusion in `_Board.tsx`'s `soloStaged` were ever lost.
it('the standing release never renders at the plain centre-staged slot', () => {
  render(releaseBoard({ pending: costPending(['attack-bug#0']) }, {}))
  expect(screen.queryByTestId('board-centre-staged')).toBeNull()
})

// Fix round 1 (post-review, finding 2 — "the release is on screen twice, or
// nowhere"): a stage flyer that has not finished carrying the release to the
// stage slot must not ALSO be shadowed by a static render of the same card —
// jsdom's WAAPI stub (test-setup.ts) resolves `.finished` on the very next
// microtask regardless of the preset's own duration, so the flight has to be
// held open ON PURPOSE here to observe the moment it is still "in the air" —
// in a real browser this is the ~480ms `playToCenter` window, and on a fast
// connection (the host peer's own round trip can be near-instant) the
// referee's answer can land squarely inside it.
it('does not double-render the release while its own stage flight is still carrying it', async () => {
  // in a real browser this is the ~480ms `playToCenter` window, and on a fast
  // connection (the host peer's own round trip can be near-instant) the
  // referee's answer can land squarely inside it
  const animateSpy = holdFlightsOpen()
  try {
    const { rerender } = render(releaseBoard({}, {}))
    const index = HAND.findIndex((c) => c.uid === 'release-frontend#0')
    const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
    fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
    fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    // the carrier is still up — the flight it started never got to finish
    const flyer = document.querySelector<HTMLElement>('[class*="flyer"]')
    expect(flyer).toBeTruthy()

    // the referee answers early, before that flight has landed
    rerender(releaseBoard({ pending: costPending(['attack-bug#0']) }, {}))
    const stage = document.querySelector('[data-centre-slot="stage"]') as HTMLElement
    // the carrier still holds it — a static render here would double it
    expect(stage.querySelector('[data-card]')).toBeNull()
  } finally {
    animateSpy.mockRestore()
  }
})

// Fix round 1 (post-review, finding 1 — "the cost flight starts from a slot
// the card never occupied"): `onCostPick` used to measure the flight's origin
// against `you.hand`, which still carries BOTH cards while a cost is owed —
// one slot short of the fan `handItems` actually renders (the staged release
// is excluded from it). `slotPlacement(slot, total)` derives both x and
// rotation from `slot - (total-1)/2`, so both arguments being wrong moves the
// origin, not just its label. Pinned directly: with jsdom's default all-zero
// hand-wrap rect, the ONE eligible card sitting at `slotPlacement(0, 1)` (dead
// centre) lands at `left: -75px`; the same card measured the old, wrong way —
// `slotPlacement(1, 2)`, its position in the UN-filtered `you.hand` — would
// land 68px across at `left: -7px`.
it('the cost flight originates from the fan slot the card actually occupies', async () => {
  const animateSpy = holdFlightsOpen()
  try {
    render(releaseBoard({ pending: costPending(['attack-bug#0']) }, {}))
    await clickFanCard('attack-bug#0')
    const flyer = document.querySelector<HTMLElement>('[class*="flyer"]')
    if (!flyer) throw new Error('cost flyer not mounted')
    expect(flyer.style.left).toBe('-75px')
  } finally {
    animateSpy.mockRestore()
  }
})

it('does not raise the pending panel for a cost — the table asks instead', () => {
  render(releaseBoard({ pending: costPending(['attack-bug#0']) }, {}))
  // every other pending owed to us still raises the prompt; this one is
  // answered by the cards on the table, so a panel would be a second asker
  expect(screen.queryByTestId('pending-prompt')).toBeNull()
})

// ===== Fix B (#101) — what the table tells the player during the cost step =====
//
// The panel is suppressed for this one kind (above), the fan is the picker,
// and until this round NOTHING said so: `_Board.tsx` passed `accentAt` to
// `<Hand>` and never `stateAt`, `accentAt` answered only for a combo partner,
// there was no line of copy anywhere, and the dock — the only voice left —
// said "reaction / you can defend" over an amber PASS key the engine rejects
// outright while a decision is open (`window.ts`'s `onPass`).

// biome-ignore lint/style/noNonNullAssertion: a known catalogue entry
const hotfix = cardById('defense-hotfix')!

// A cost step with a THIRD card in hand the engine did not offer — the whole
// point of the assertion below is that the eligible set is `pending.options`
// and not "the whole fan". With only the payer in hand, lighting everything
// and lighting the offered set are indistinguishable.
function costLitBoard(options: string[]) {
  const base = makeBoardProps()
  const props = makeBoardProps({
    state: {
      ...base.state,
      you: { ...base.state.you, hand: [...HAND, { uid: 'defense-hotfix#0', card: hotfix }] },
      turn: base.state.selfId,
      hasDrawn: true,
      playable: [], // a pending suspends normal play — `playableFor`'s own first check
      pending: costPending(options),
    },
  })
  return <Board {...props} />
}

// The Card primitive's own identity + state hooks (`data-card` / `data-state`)
// and its accent custom property, read off the face inside a fan slot.
function faceOf(cardId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-hand-slot] [data-card="${cardId}"]`)
}

it('lights exactly the cards that may pay the cost, in the loss hue', () => {
  render(costLitBoard(['attack-bug#0']))
  const payer = faceOf('attack-bug')
  expect(payer?.getAttribute('data-state')).toBe('playable')
  // --danger-accent is the token for "a pick that COSTS you a card"
  // (tokens.css) — the exception is the colour, not the rule
  expect(payer?.style.getPropertyValue('--accent')).toBe('var(--danger-accent)')
  // the card the engine did not offer stays dark: legality is its answer
  const other = faceOf('defense-hotfix')
  expect(other?.getAttribute('data-state')).toBe('idle')
})

// Fix B, fix round 1 (L2): the turn side's own half of the same gate.
// `onCostPick` refuses while `enabled` is false (the opening owns the table),
// but `stateAt` lit the payable cards anyway. Driven through the hook for the
// reason boardDefense.test.tsx's twin states: the only producer of
// `enabled === false` is the opening beat, and its harness is the suite's one
// known-flaky file.
function costStateAt(enabled: boolean): (i: number) => string {
  const base = makeBoardProps()
  const { result } = renderHook(() =>
    useBoardStaging({
      state: {
        ...base.state,
        you: { ...base.state.you, hand: HAND },
        turn: base.state.selfId,
        hasDrawn: true,
        playable: [],
        pending: costPending(['attack-bug#0']),
      },
      anchors: useBoardAnchors(),
      events: [],
      enabled,
    }),
  )
  // index 0 of `handItems`, which already excludes the standing release
  return (i: number) => result.current.stateAt(i)
}

// ===== Fix C, finding 5 — the stage slot must not carry over between plays ==
//
// Driven through the hook rather than `<Board>`, because the state that
// exposes it is only reachable through a route `<Board>` cannot be fed in a
// test: a release stands, its play is REJECTED (the watcher's own `cancel()`
// takes the `staged`-based branch, which never touched the old flags), or it
// is placed under reduced motion (where no beat runs to call
// `takeStagedRelease`). Either way the old code left `stageLanded` true with
// nothing standing, and the NEXT release — a Code Review combo, which stands
// its release at the CENTRE — would then draw that release at the stage slot
// too. The same card on screen twice, decided by what you happened to play
// first.
//
// One `StageState` that every play sets removes the question. The pull below
// is the transition that fires first; `onCardClick`'s own `finish` sets it a
// second time for the same reason, belt and braces.
it('a release standing at the stage slot does not survive the next play', async () => {
  const base = makeBoardProps()
  const hand = [
    { uid: 'release-frontend#0', card: frontend },
    { uid: 'support-code-review#0', card: review },
    { uid: 'attack-bug#0', card: bug },
  ]
  const { result } = renderHook(() =>
    useBoardStaging({
      state: {
        ...base.state,
        you: { ...base.state.you, hand },
        turn: base.state.selfId,
        hasDrawn: true,
        playable: hand.map((c) => c.uid),
        comboOptions: { 'support-code-review#0': ['release-frontend#0'] },
        pending: null,
      } as typeof base.state,
      anchors: useBoardAnchors(),
      events: [],
      enabled: true,
    }),
  )
  // a solo release: it flies to the stage slot and stands there
  await act(async () => {
    result.current.onHandPlay('release-frontend#0', { x: 0, y: 0 })
    await new Promise((r) => setTimeout(r, 50))
  })
  expect(result.current.stageStanding).toBe(true)

  // the beat adopts it and hands the table back (`release()` is that clear —
  // no flight, just done), so the fan is free again
  act(() => {
    result.current.release()
  })
  expect(result.current.staged).toBeNull()

  // now a COMBO: pulling the Code Review starts a play whose release will
  // stand at the CENTRE, so the stage slot must be empty for it
  act(() => {
    result.current.onHandPlay('support-code-review#0', { x: 0, y: 0 })
  })
  expect(result.current.staged?.phase).toBe('partner')
  expect(result.current.stageStanding).toBe(false)
})

// ===== MISSING FIXTURE 2 (#101, Fix C, finding 3) — a MATCH BOUNDARY =====
//
// Nothing in the suite ever crossed one for the staging hooks, which is why
// nothing noticed they never reset. `<Board>` has no `key` (`_layout.tsx`), so
// one component instance serves every match of a session; `useBeats` wipes
// itself on `intro.key`, and the gestures did not. A rematch that interrupted
// a cost step therefore left the paid card lying on the NEW table for good,
// and the new match's first beat called `clearPaidCost`/`takeStagedRelease`
// against state belonging to a match that had ended.
//
// Driven through the hook, because the boundary is a prop change and `<Board>`
// cannot be driven through a cost step with an `intro` attached (the deal gate
// holds every gesture inert until it reports done). The wiring that carries
// the key from `<Board>` into the hook is pinned separately, below.
//
// What these two pin is the hook's RESET, which is correct. The key it is armed
// with in the app is not: `intro.gameId` resolves to the host's own peer id, the
// same for every match of a room, so the effect never fires on a real rematch
// (#101, Fix D, finding 3). A rematch here is a prop change, which is what a
// rematch IS for the hook — and says nothing about whether the prop ever
// changes. Recorded in `docs/animations/backlog.md`; `useBeats` shares it.
interface StagingProps {
  key: string | null
  pending: TablePending | null
}

function stagingAt(matchKey: string | null) {
  const base = makeBoardProps()
  return renderHook(
    ({ key, pending }: StagingProps) =>
      useBoardStaging({
        state: {
          ...base.state,
          you: { ...base.state.you, hand: HAND },
          turn: base.state.selfId,
          hasDrawn: true,
          // a pending suspends normal play — `playableFor`'s own first check
          playable: pending ? [] : HAND.map((c) => c.uid),
          pending,
        },
        anchors: useBoardAnchors(),
        events: [],
        enabled: true,
        matchKey: key,
      }),
    { initialProps: { key: matchKey, pending: null } as StagingProps },
  )
}

it('a new match takes the last one’s standing release off the table', async () => {
  const { result, rerender } = stagingAt('g1')
  // a release is standing at the stage slot
  await act(async () => {
    result.current.onHandPlay('release-frontend#0', { x: 0, y: 0 })
    await new Promise((r) => setTimeout(r, 50))
  })
  expect(result.current.stageStanding).toBe(true)
  expect(result.current.staged?.phase).toBe('dispatched')

  // the rematch arrives mid-step
  rerender({ key: 'g2', pending: null })
  expect(result.current.stageStanding).toBe(false)
  expect(result.current.staged).toBeNull()
  // and the fan is whole again — nothing of the dead match is still hidden
  expect(result.current.handItems).toHaveLength(HAND.length)
})

// The PAID COST's own half of the same boundary (#101, Fix D, finding 6). It
// used to ride along in the test above as `expect(paidCost).toBeNull()`, with
// nothing behind it: `paidCost` is set only when a cost pick's own flight lands
// (`_useBoardStaging.ts`'s `onCostPick`), that fixture never picked one, and the
// value was null before the rematch as well as after — so `setPaidCost(null)` in
// the reset could be deleted with the suite still green. Here the cost is
// actually paid first, which is the state a rematch has to clear: `_Board.tsx`
// renders `paidCost` ungated, so a leftover would lie on the new table for good.
it('a new match takes the last one’s paid cost off the table', async () => {
  const { result, rerender } = stagingAt('g1')
  await act(async () => {
    result.current.onHandPlay('release-frontend#0', { x: 0, y: 0 })
    await new Promise((r) => setTimeout(r, 50))
  })
  // the referee answers with the cost pending, and the spare pays it
  rerender({ key: 'g1', pending: costPending(['attack-bug#0']) })
  await act(async () => {
    result.current.onCostPick('attack-bug#0')
    await new Promise((r) => setTimeout(r, 50))
  })
  expect(result.current.paidCost?.uid).toBe('attack-bug#0')

  // the rematch arrives with the cost lying open beside the release
  rerender({ key: 'g2', pending: costPending(['attack-bug#0']) })
  expect(result.current.paidCost).toBeNull()
})

// The wiring, pinned the same way Fix A's own was: dropping `matchKey` from
// `_Board.tsx`'s call leaves the hook's reset correct and unreachable.
it('hands the staging gesture the match it belongs to', () => {
  const base = makeBoardProps()
  const props = makeBoardProps({
    state: { ...base.state, you: { ...base.state.you, hand: HAND } },
    intro: { gameId: 'g7', view: null, events: [], onDone: () => {} },
  } as unknown as Parameters<typeof makeBoardProps>[0])
  render(<Board {...props} />)
  expect(stagingOpts.last?.matchKey).toBe('g7')
})

it('lights no payer the opening would refuse', () => {
  expect(costStateAt(true)(0)).toBe('playable')
  expect(costStateAt(false)(0)).toBe('idle')
})

// A guard, not evidence: this passed before the fix too (nothing lit at all).
// It is here so a later "just light the whole fan" cannot land quietly.
it('lights nothing while no step is waiting on the fan', () => {
  render(releaseBoard({}))
  for (const face of document.querySelectorAll<HTMLElement>('[data-hand-slot] [data-card]')) {
    expect(face.getAttribute('data-state')).toBe('idle')
  }
})

it('says on the table that the release costs a card', () => {
  const { copy } = makeBoardProps()
  render(releaseBoard({ pending: costPending(['attack-bug#0']) }, {}))
  const ask = screen.getByTestId('board-ask')
  expect(ask.getAttribute('data-shown')).toBe('true')
  expect(ask.textContent).toContain(copy.table.askCost)
})

it('says nothing when nothing is owed', () => {
  render(releaseBoard({}, {}))
  expect(screen.getByTestId('board-ask').getAttribute('data-shown')).toBe('false')
})

// The dock does NOT get a state of its own for the cost (#101, review round 2).
// A release's price is one action inside a turn, not a state of the table: the
// phase has not changed and the turn is still yours, so the dock keeps saying
// so. What is wanted of you is said by the ask on the table (asserted just
// above) — a phase word repeating it adds nothing.
it('the dock keeps the turn its own phase while a release waits to be paid', () => {
  const { copy } = makeBoardProps()
  render(releaseBoard({ pending: costPending(['attack-bug#0']) }, {}))
  expect(screen.getAllByText(copy.turnDock.yourTurn).length).toBeGreaterThan(0)
  // not a reaction, and not somebody else's decision to wait on
  expect(screen.queryByText(copy.turnDock.canDefend)).toBeNull()
  expect(screen.queryByText(copy.turnDock.reaction)).toBeNull()
})

// The key stays live, against `dock.ts`'s "only where the action is legal"
// rule, because the action behind it IS legal — it just takes the staged
// release back first. Same rule the table already runs: while an unpaid
// release stands, anything other than paying takes it back.
it('the dock key takes an unpaid release back instead of drawing or pushing', () => {
  const onResolve = vi.fn()
  const onPush = vi.fn()
  vi.useFakeTimers()
  // `finally`, not a trailing call: a failed assertion would otherwise leave
  // fake timers installed for every test after this one in the file, turning
  // one red test into twenty.
  try {
    render(releaseBoard({ pending: costPending(['attack-bug#0']) }, { onResolve, onPush }))
    // TurnDock arms `keyLocked` on mount and releases it after LOCKOUT_MS
    // (300ms) — a click before that is swallowed by design, so the timer has
    // to advance or this asserts nothing about wiring (boardComponent.test.tsx's
    // draw test says the same).
    act(() => vi.advanceTimersByTime(400))
    fireEvent.click(screen.getByTestId('dock-key'))
  } finally {
    vi.useRealTimers()
  }
  expect(onResolve).toHaveBeenCalledWith({ kind: 'cancelRelease' })
  expect(onPush).not.toHaveBeenCalled()
})

// `hasTarget`/`state.comboOptions` already gate the aim/partner branches on
// playability for free — the projection only ever populates those for a card
// it already counts playable. A release has neither to lean on, so its own
// staging must check `state.playable` itself; without that check, a release
// the hand cannot pay for (here: nothing else in hand to spend) would still
// fly to the stage slot only for the engine to reject it a beat later.
it('a release the hand cannot pay for is refused, not staged', async () => {
  const onPlay = vi.fn()
  const props = makeBoardProps({
    state: {
      ...makeBoardProps().state,
      you: { ...makeBoardProps().state.you, hand: [HAND[0]] },
      turn: makeBoardProps().state.selfId,
      hasDrawn: true,
      playable: [], // the real engine's `playableFor` excludes an unaffordable lone release
    },
    actions: { onPlay },
  })
  render(<Board {...props} />)
  await pullCardFromFan('release-frontend#0')
  expect(onPlay).not.toHaveBeenCalled()
  expect(document.querySelectorAll('[data-hand-slot]').length).toBe(1)
})

// Task 9 (#101): a press on nothing valid takes the staged release back to the
// fan — the same "changed my mind" rule every other staged play already gets.
// `cancelRelease` (#101, Task 7) is owner-only, clears the pending, and emits
// nothing — safe precisely because the release play emitted nothing either.
it('a press on nothing valid takes the staged release back to the fan', async () => {
  const onResolve = vi.fn()
  render(releaseBoard({ pending: costPending(['attack-bug#0']) }, { onResolve }))
  // a press on the table, away from the fan and away from any lit target
  fireEvent.mouseDown(document.querySelector('[data-board-centre]')?.parentElement as HTMLElement)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 600))
  })
  expect(onResolve).toHaveBeenCalledWith({ kind: 'cancelRelease' })
})

// #101, Fix C, finding 7: the miss has to land ON the board. Bound to
// `window`, this listener also fired for anything portalled ABOVE the board —
// a dialog, an overlay, a future toast — and cancelled the staged release
// behind it, which the player never touched.
it('a press outside the table is not a miss', async () => {
  const onResolve = vi.fn()
  render(releaseBoard({ pending: costPending(['attack-bug#0']) }, { onResolve }))
  const outside = document.createElement('div')
  document.body.appendChild(outside)
  try {
    fireEvent.mouseDown(outside)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })
    expect(onResolve).not.toHaveBeenCalled()
  } finally {
    outside.remove()
  }
})

it('a press inside the fan is not a miss', async () => {
  const onResolve = vi.fn()
  render(releaseBoard({ pending: costPending(['attack-bug#0']) }, { onResolve }))
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[0]
  fireEvent.mouseDown(slot)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100))
  })
  expect(onResolve).not.toHaveBeenCalledWith({ kind: 'cancelRelease' })
})

// Fix round 1 (post-review — the cancel above renders the release TWICE):
// `_Board.tsx`'s `stagedRelease` is gated on `staging.stageStanding` plus
// `costPending`/`stagedReleaseLocal`, and the cancel above touches none of
// those — so from the moment the return flight starts until the referee's
// answer (clearing `state.pending`) actually arrives, the static stage-slot
// render and the return flight's own overlay are BOTH on screen. A real P2P
// round trip is essentially always slower than one animation frame, so this
// is not a one-frame flicker — it is the steady state for the whole flight.
// `useHandArrival`'s own `arrive()` lands on a plain timer (`FLIGHT_MS`,
// 480ms — see `useHandArrival.tsx`), not on `Element.prototype.animate`'s own
// `.finished`, so this is observed the same way `boardStaging.test.tsx`
// observes an in-flight cancel elsewhere: a short wait well inside that
// window, no `animate` mock required.
it('does not double-render the release while its own return flight is still carrying it home', async () => {
  const onResolve = vi.fn()
  const { rerender } = render(releaseBoard({}, { onResolve }))
  await pullCardFromFan('release-frontend#0')
  rerender(releaseBoard({ pending: costPending(['attack-bug#0']) }, { onResolve }))
  const stage = document.querySelector('[data-centre-slot="stage"]') as HTMLElement
  expect(stage.querySelector('[data-card]')).toBeTruthy() // standing, before the cancel

  // a press on nothing valid — the return flight starts, but THIS rerender
  // still carries the very same cost-pending props throughout the flight
  fireEvent.mouseDown(document.querySelector('[data-board-centre]')?.parentElement as HTMLElement)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50)) // well inside FLIGHT_MS (480ms) — still airborne
  })
  expect(onResolve).toHaveBeenCalledWith({ kind: 'cancelRelease' })
  // the return flight is still up…
  const flyer = document.querySelector<HTMLElement>('[class*="arriving"]')
  expect(flyer).toBeTruthy()
  // …and the stage slot must not ALSO show a static copy of the same card
  expect(stage.querySelector('[data-card]')).toBeNull()
})

// #101, Fix A (Defect 1, the doubling half): while the placement beat carries
// the release out of the stage slot and into the zone, the static render must
// be gone. The `before` projection the beat renders still holds the cost
// pending for its whole run — that is what a beat's `base` IS — so
// `costPending` is exactly as it was here, and nothing but the stage machine
// leaving `'standing'` can empty the slot. The static card must not coexist
// with a carrier holding it, in either direction.
it('does not keep the release standing while the placement beat is flying it to the zone', async () => {
  const { rerender } = render(releaseBoard({}, {}))
  await pullCardFromFan('release-frontend#0')
  rerender(releaseBoard({ pending: costPending(['attack-bug#0']) }, {}))
  const stage = document.querySelector('[data-centre-slot="stage"]') as HTMLElement
  expect(stage.querySelector('[data-card]')).toBeTruthy() // standing, before the beat

  // the beat picks it up — the props do not move, because the projection is a
  // whole round trip behind and the shadow renders the pending regardless
  placing.on = true
  try {
    rerender(releaseBoard({ pending: costPending(['attack-bug#0']) }, {}))
    expect(stage.querySelector('[data-card]')).toBeNull()
  } finally {
    placing.on = false
  }
})

// The wiring itself, both lines of it: the ref reaches `useBeats` at all, and
// it actually carries the staging hook's own callback rather than staying
// null. One assertion per deletable line — dropping the argument makes the
// first fail, dropping the layout effect makes the second.
it('hands the beat queue the staging hook’s own take of the standing release', () => {
  render(releaseBoard({ pending: costPending(['attack-bug#0']) }, {}))
  expect(beatsArgs.last?.takeStagedRelease).toBeDefined()
  // identity, not merely "something callable": the beat has to reach THIS
  // mount's hook, and `takeStagedRelease` is a `useCallback` with no deps, so
  // it is the same function for the life of the mount
  expect(beatsArgs.last?.takeStagedRelease?.current).toBe(placing.staging?.takeStagedRelease)
  expect(typeof placing.staging?.takeStagedRelease).toBe('function')
})

// ===== Fix C, finding 1 (BLOCKER) — a combo release must be payable =====
//
// #100 made the fan inert while a pair stands merged, so a combo cannot be
// disturbed mid-fold. #101 suppressed `PendingPrompt` for `discardForRelease`,
// because the cards on the table ask for the cost instead. Both correct, and
// neither task could see the other: for a COMBO release the catch-up effect
// that would have cleared `staged` bails on `s.support`, so `merged` stays
// true through the whole cost step — the fan is inert, no panel offers the
// choice, and `Hand` has no keyboard path. The cost becomes unpayable by any
// input while the ask line tells the player to click a card.
it('lets a combo release’s cost be paid out of the fan', async () => {
  const onResolve = vi.fn()
  const { rerender } = render(comboReleaseBoard({}, {}))
  await foldTheComboRelease()
  // the pair is standing, and the fan is inert — #100's guard, doing its job
  expect(handWrapStyle()).toBe('none')

  // the engine answers with the ordinary cost pending, `codeReview` riding
  // along invisibly (`pendingView` does not carry it)
  rerender(comboReleaseBoard({ pending: comboCostPending() }, { onResolve }))
  // …and NOW the fan must be live again: it is the only picker there is
  expect(handWrapStyle()).not.toBe('none')
  // the spare is offered, and lit
  const payer = document.querySelector<HTMLElement>('[data-hand-slot] [data-card="attack-bug"]')
  expect(payer?.getAttribute('data-state')).toBe('playable')
  await clickFanCard('attack-bug#0')
  expect(onResolve).toHaveBeenCalledWith({ kind: 'discardForRelease', card: 'attack-bug#0' })
})

// The pair itself must not be disturbed by unlocking the fan: both halves stay
// out of the fan and standing at the centre while the cost is asked for, which
// is what makes `runRelease`'s own combo adoption still work (Fix A's case 2).
it('keeps the combo pair standing at the centre while its cost is owed', async () => {
  const { rerender } = render(comboReleaseBoard({}, {}))
  await foldTheComboRelease()
  rerender(comboReleaseBoard({ pending: comboCostPending() }, {}))
  // only the spare is in the fan — both halves of the play are on the table
  const faces = Array.from(
    document.querySelectorAll<HTMLElement>('[data-hand-slot] [data-card]'),
  ).map((el) => el.getAttribute('data-card'))
  expect(faces).toEqual(['attack-bug'])
  const pair = screen.getByTestId('board-pair-staged')
  expect(pair.querySelector('[data-card="release-frontend"]')).toBeTruthy()
  expect(pair.querySelector('[data-card="support-code-review"]')).toBeTruthy()
  // and it does NOT also stand at the stage slot — that slot is for a release
  // standing alone (Fix C, finding 5: the stage machine must not carry over
  // from an earlier release)
  const stage = document.querySelector('[data-centre-slot="stage"]') as HTMLElement
  expect(stage.querySelector('[data-card]')).toBeNull()
})

// ===== Fix C, finding 2 (HIGH) — the escape hatch must actually escape =====
//
// `cancel()`'s cost branch fires in the softlocked state above, but it was
// written for a SOLO release: it flies one card home from the `.stageSlot`,
// which for a combo is empty — the pair is standing at `.centre` — and it
// leaves the Code Review behind entirely. Both halves have to go home, from
// where they actually are.
//
// A press cancel takes both halves back. Observed mid-flight, because that is
// where the difference lives: today exactly one card is in the air, and it
// started from the wrong box.
it('takes BOTH halves of a combo release home from the centre', async () => {
  const onResolve = vi.fn()
  const { rerender } = render(comboReleaseBoard({}, {}))
  await foldTheComboRelease()
  rerender(comboReleaseBoard({ pending: comboCostPending() }, { onResolve }))

  // a press on the table, away from the fan and away from anything lit
  fireEvent.mouseDown(document.querySelector('[data-board-centre]')?.parentElement as HTMLElement)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60)) // well inside the flight (480ms)
  })
  expect(onResolve).toHaveBeenCalledWith({ kind: 'cancelRelease' })
  const flying = Array.from(
    document.querySelectorAll<HTMLElement>('[class*="arriving"] [data-card]'),
  ).map((el) => el.getAttribute('data-card'))
  expect(flying).toHaveLength(2)
  expect(flying).toContain('release-frontend')
  expect(flying).toContain('support-code-review')
})

// The other half of finding 2's fix (#101, Fix D): the hand-back must fire ONLY
// when nothing is going to land. The cost listener stays armed for the whole
// return flight — the pending it keys off is a round trip away from clearing —
// so a second press re-enters `cancel()` mid-flight, and `arrive` refuses that
// one because it takes a single flight at a time. A hand-back on THAT refusal
// puts both cards back in the fan while their own copies are still crossing the
// table: the doubling this family of guards exists to prevent, arriving through
// the fix for the opposite failure.
it('a second press mid-flight does not put the pair back under the flight carrying it', async () => {
  const { rerender } = render(comboReleaseBoard({}, {}))
  await foldTheComboRelease()
  rerender(comboReleaseBoard({ pending: comboCostPending() }, {}))
  const miss = document.querySelector('[data-board-centre]')?.parentElement as HTMLElement

  fireEvent.mouseDown(miss)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60)) // well inside FLIGHT_MS (480ms)
  })
  expect(document.querySelectorAll('[class*="arriving"] [data-card]')).toHaveLength(2)

  // the second press, while both halves are still in the air
  fireEvent.mouseDown(miss)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60))
  })
  // the fan still shows only the spare: the pair is on the flight, not in both
  // places at once
  const faces = Array.from(
    document.querySelectorAll<HTMLElement>('[data-hand-slot] [data-card]'),
  ).map((el) => el.getAttribute('data-card'))
  expect(faces).toEqual(['attack-bug'])
  expect(document.querySelectorAll('[class*="arriving"] [data-card]')).toHaveLength(2)
})

// The permanent brick, and the one place it is actually permanent. The brief
// for this round read `cancel()`'s cost branch as leaving the fan inert for
// the rest of the match in every case; it does not, because `useHandArrival`'s
// own `onLanded` calls `commitStaged(null)` unconditionally ~480ms later, so
// the ANIMATED path recovers by accident. Under `prefers-reduced-motion` there
// is no flight, so nothing ever lands, so nothing ever clears `staged` — and
// THERE the fan really does stay inert until reload. That is the case worth
// pinning, and it is also the case a player who needs reduced motion is stuck
// in.
it('hands the fan back after a reduced-motion cancel, with no flight to do it', async () => {
  const mm = mockReducedMotion()
  try {
    const onResolve = vi.fn()
    const { rerender } = render(comboReleaseBoard({}, {}))
    await foldTheComboRelease()
    rerender(comboReleaseBoard({ pending: comboCostPending() }, { onResolve }))

    fireEvent.mouseDown(document.querySelector('[data-board-centre]')?.parentElement as HTMLElement)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(onResolve).toHaveBeenCalledWith({ kind: 'cancelRelease' })
    // no flight was raised, and the fan is usable again anyway
    expect(document.querySelector('[class*="arriving"]')).toBeNull()
    expect(handWrapStyle()).not.toBe('none')

    // the referee's answer puts both halves back: neither is still hidden
    rerender(comboReleaseBoard({}, { onResolve }))
    const faces = Array.from(
      document.querySelectorAll<HTMLElement>('[data-hand-slot] [data-card]'),
    ).map((el) => el.getAttribute('data-card'))
    expect(faces).toHaveLength(COMBO_HAND.length)
    expect(faces).toContain('support-code-review')
    expect(faces).toContain('release-frontend')
  } finally {
    mm.mockRestore()
  }
})

// Fix round 1: the guard for the finding above must not blank the stage slot
// during the COST-PAYMENT flight instead — the release is legitimately still
// standing there while its cost travels to pay for it (Task 8's own scene).
// Nothing pinned this before; pinning it now alongside the fix, since the
// reviewer flagged it as the exact case a careless fix breaks.
it('the standing release stays visible while its own cost is still flying to pay for it', async () => {
  const { rerender } = render(releaseBoard({}, {}))
  await pullCardFromFan('release-frontend#0')
  rerender(releaseBoard({ pending: costPending(['attack-bug#0']) }, {}))
  const stage = document.querySelector('[data-centre-slot="stage"]') as HTMLElement
  expect(stage.querySelector('[data-card]')).toBeTruthy() // standing, before paying

  const animateSpy = holdFlightsOpen()
  try {
    await clickFanCard('attack-bug#0')
    // the cost card is still flying to its own slot — the release itself must
    // still be standing at the stage slot throughout
    expect(stage.querySelector('[data-card]')).toBeTruthy()
  } finally {
    animateSpy.mockRestore()
  }
})

// Reduced motion's own safety net (#101, Task 11): `useBeats.ts` never runs a
// beat at all under reduced motion, so the combo beat's own clear of
// `paidCost` (comboBeat.tsx's `runRelease`) never fires either — without
// `_useBoardStaging.ts`'s own reduced-motion effect, the paid cost would
// stand at its slot for the rest of the match, the exact permanent-artifact
// defect Task 8's review caught, recurring on the one path that fix cannot
// reach. Driven entirely through props (this suite's own convention, not a
// simulated engine round trip): paying the cost sets it, and the SAME
// rerender that clears the pending is what a real referee's answer would
// look like arriving.
it('reduced motion clears the paid cost once the pending resolves, with no beat to do it', async () => {
  const mm = mockReducedMotion()
  try {
    const { rerender } = render(releaseBoard({}, {}))
    await pullCardFromFan('release-frontend#0')
    rerender(releaseBoard({ pending: costPending(['attack-bug#0']) }, {}))
    await clickFanCard('attack-bug#0')
    const cost = document.querySelector('[data-centre-slot="cost"]') as HTMLElement
    expect(cost.querySelector('[data-card="attack-bug"]')).toBeTruthy() // shown, same as always

    // the referee's answer: the cost pending is gone, the release now stands
    // settled — no beat ever ran to clear `paidCost` for us
    rerender(releaseBoard({}, {}))
    expect(cost.querySelector('[data-card]')).toBeNull()
    // and the same end state for the release itself (#101, Fix A): the stage
    // slot empties with the pending that put it there. The placement beat's own
    // `releasePlacing` guard is never set under reduced motion — `useBeats` runs
    // no beat at all — so the stage slot must reach "empty" on the projection
    // alone, exactly as it did before that guard existed.
    const stage = document.querySelector('[data-centre-slot="stage"]') as HTMLElement
    expect(stage.querySelector('[data-card]')).toBeNull()
  } finally {
    mm.mockRestore()
  }
})

// ===== Fix D, finding 2 — a cancel whose flight cannot even start =====
//
// The combo cost-cancel blanks the pair node and arms `cancelling` around
// `arrival.arrive`, and everything it armed is cleared by that flight's own
// landing (`useHandArrival`'s `onLanded`). But `arrive` refuses silently when
// there is no fan to measure — the local player eliminated mid-step is the live
// route to that, since `_Board.tsx` renders a badge where the fan goes — and
// when it refuses, nothing lands: `staged` stays merged, both cards are
// invisible, and once the pending clears `handInert` is true again and the fan is
// dead for the rest of the match. The sibling `reduced || !cRect` branch got a
// hand-back for exactly this reason; this one did not, and that asymmetry was the
// bug.
//
// Driven through the hook: the refusal needs an unmeasurable fan, and the only
// thing that decides that is which anchors the hook was handed.
function comboCancelHarness() {
  const base = makeBoardProps()
  const centre = document.createElement('div')
  document.body.appendChild(centre)
  const view = renderHook(
    ({ pending }: { pending: TablePending | null }) => {
      const anchors = useBoardAnchors()
      // the centre is measurable, so the cancel takes its FLIGHT branch rather
      // than the reduced-motion one…
      anchors.centre.current = centre
      // …and there is no fan at all, so that flight is refused
      anchors.hand.current = null
      return useBoardStaging({
        state: {
          ...base.state,
          you: { ...base.state.you, hand: COMBO_HAND },
          turn: base.state.selfId,
          hasDrawn: true,
          playable: pending ? [] : COMBO_HAND.map((c) => c.uid),
          comboOptions: pending ? {} : { 'support-code-review#0': ['release-frontend#0'] },
          pending,
        } as typeof base.state,
        anchors,
        events: [],
        enabled: true,
      })
    },
    { initialProps: { pending: null as TablePending | null } },
  )
  return { view, cleanup: () => centre.remove() }
}

it('hands the fan back when a combo cancel’s own flight is refused', async () => {
  const { view, cleanup } = comboCancelHarness()
  try {
    const { result, rerender } = view
    // the fold, through the hook's own gesture — the pair ends up merged and
    // dispatched, exactly as the DOM fixture above produces it
    act(() => {
      result.current.onHandPlay('support-code-review#0', { x: 0, y: 0 })
    })
    await act(async () => {
      result.current.onCardClick(0) // handItems, minus the support: the release
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(result.current.staged?.merged).toBe(true)

    // the referee's answer: the cost pending, with the pair still standing
    rerender({ pending: comboCostPending() })
    expect(result.current.staged?.merged).toBe(true)

    // the escape hatch, with nothing to fly home to
    await act(async () => {
      result.current.cancel()
      await new Promise((r) => setTimeout(r, 600)) // longer than FLIGHT_MS (480ms)
    })
    // nothing landed, and nothing was going to — so the gesture put itself back
    expect(result.current.staged).toBeNull()
    // the Code Review is in the fan again; the release itself stays out of it
    // until the referee's answer clears the pending that names it
    expect(result.current.handItems.map((c) => c.uid)).toEqual([
      'support-code-review#0',
      'attack-bug#0',
    ])
  } finally {
    cleanup()
  }
})

it('stands a release pulled from the hand, at the stage slot', async () => {
  const onPlay = vi.fn()
  const { rerender } = render(releaseBoard({}, { onPlay }))
  await pullCardFromFan('release-frontend#0')
  expect(onPlay).toHaveBeenCalledWith('release-frontend#0', undefined, undefined)
  expect(document.querySelectorAll('[data-hand-slot]').length).toBe(HAND.length - 1)
  const before = document.querySelector('[data-centre-slot="stage"]') as HTMLElement
  expect(before.querySelector('[data-card="release-frontend"]')).toBeTruthy()

  rerender(releaseBoard({ pending: costPending(['attack-bug#0']) }, { onPlay }))
  const after = document.querySelector('[data-centre-slot="stage"]') as HTMLElement
  expect(after.querySelector('[data-card="release-frontend"]')).toBeTruthy()
})

it('a pulled release still takes its cost from the fan', async () => {
  const onResolve = vi.fn()
  const { rerender } = render(releaseBoard({}, { onResolve }))
  await pullCardFromFan('release-frontend#0')
  rerender(releaseBoard({ pending: costPending(['attack-bug#0']) }, { onResolve }))
  await clickFanCard('attack-bug#0')
  expect(onResolve).toHaveBeenCalledWith({ kind: 'discardForRelease', card: 'attack-bug#0' })
})

it('a click cannot start another play while a release is staged', async () => {
  const onPlay = vi.fn()
  render(releaseBoard({}, { onPlay }))
  await pullCardFromFan('release-frontend#0')
  expect(onPlay).toHaveBeenCalledWith('release-frontend#0', undefined, undefined)
  expect(document.querySelectorAll('[data-hand-slot]').length).toBe(HAND.length - 1)

  await clickFanCard('attack-bug#0')
  expect(onPlay).toHaveBeenCalledTimes(1)
})

it('a window attack is thrown by a pull', async () => {
  const onAttack = vi.fn()
  const base = makeBoardProps()
  const props = makeBoardProps({
    state: {
      ...base.state,
      you: { ...base.state.you, hand: HAND },
      turn: base.state.selfId,
      hasDrawn: true,
      playable: [], // a window suspends normal play — `playableFor`'s own check
      window: {
        player: 'p2',
        slot: 'frontend',
        round: 1,
        canAttackWith: ['attack-bug#0'],
        passed: [],
      },
      pending: null,
    },
    actions: { onAttack },
  } as unknown as Parameters<typeof makeBoardProps>[0])
  render(<Board {...props} />)
  await pullCardFromFan('attack-bug#0')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1600))
  })
  expect(onAttack).toHaveBeenCalledWith('attack-bug#0', undefined)
})

// A guard, not evidence: this passes with or without Fix A. It is here so the
// placement guard (#101, Fix A) can never be "simplified" into something that
// hides the standing release for good — the flag is set by a beat, and under
// reduced motion `useBeats` runs no beat at all, so nothing here ever sets or
// unsets it. The release must stand, and then stop standing, on the
// projection alone.
it('reduced motion stands the release and settles it with no beat involved', async () => {
  const mm = mockReducedMotion()
  try {
    const { rerender } = render(releaseBoard({}, {}))
    await pullCardFromFan('release-frontend#0')
    rerender(releaseBoard({ pending: costPending(['attack-bug#0']) }, {}))
    const stage = document.querySelector('[data-centre-slot="stage"]') as HTMLElement
    expect(stage.querySelector('[data-card]')).toBeTruthy()

    // the referee's answer clears the pending: the release is in its slot now,
    // and the stage slot empties with no flight and nothing to unset
    rerender(releaseBoard({}, {}))
    expect(stage.querySelector('[data-card]')).toBeNull()
  } finally {
    mm.mockRestore()
  }
})
