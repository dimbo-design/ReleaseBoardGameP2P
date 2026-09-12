// The staging gesture (#99): pulling a card that needs a target out of the fan
// stands it at the centre and aims the arrow; a press on a lit target
// dispatches with it. Task 3 covered the pull/aim/dispatch path; Task 4 adds
// the ways staging ends without a dispatch — a miss, Escape, and a rejection
// from the engine — plus the guard that keeps a cancel-in-flight from being
// dispatched by a press on the target it just left. Same render harness as
// boardComponent.test.tsx (forked from apps/ui's own Table suite) — see that
// file's header for why.

import type { Event } from '@release/engine'
import type { CardData, TableActions, TableTarget, TableWindow } from '@release/ui'
import { cardById } from '@release/ui'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
// same reach, for the return-flight step's own overlay node — pins that a
// merged cancel carries BOTH halves as one flight, not one arriving node with
// the other uid merely reappearing once `staged` clears.
import handArrivalStyles from '@/animations/useHandArrival.module.css'
// Arrow's CSS Module classnames are not part of `@release/ui`'s public barrel
// — reached into the same way `boardComponent.test.tsx` does.
import arrowStyles from '@/primitives/Arrow/Arrow.module.css'
import { mockReducedMotion } from '~/test/reducedMotion'
import Board from '../_Board'
import { makeBoardProps } from './fixture'

// biome-ignore lint/style/noNonNullAssertion: both ids are known catalogue entries
const bug = cardById('attack-bug')!
// biome-ignore lint/style/noNonNullAssertion: both ids are known catalogue entries
const frontend = cardById('release-frontend')!

// The fixed hand every test in this file renders: one card that needs a
// target (attack-bug#0) and one that does not (release-frontend#0). Fixed
// and never mutated by the hook itself — the engine's own `you.hand` does not
// change until a play is actually dispatched, so the DOM's `[data-hand-slot]`
// order tracks this array (minus, at most, the one card currently staged) for
// the whole life of a test.
const HAND: { uid: string; card: CardData }[] = [
  { uid: 'attack-bug#0', card: bug },
  { uid: 'release-frontend#0', card: frontend },
]

// The one target every test in this file stages towards — attack-bug#0 aims
// at the opponent seat p2. Shared so a test that only cares about cancel or
// rejection doesn't restate it.
const BUG_TARGETS: Record<string, TableTarget[]> = {
  'attack-bug#0': [{ kind: 'player', player: 'p2' }],
}

// The uid the most recent `pullCardFromFan` went after — enough to tell
// `fanUids()` which uid a real slot-count drop refers to, since only one card
// can ever be staged at a time.
let lastPulled: string | null = null

function boardWith(
  overrides: { targets?: Record<string, TableTarget[]> },
  actions: TableActions = {},
  // the feed `useBoardStaging` watches for a `rejected` reply — Board only
  // hands events through via `intro.events`, so a `rejected` test routes them
  // that way. `view: null` keeps `gameKey` (_Board.tsx) null, so the opening
  // itself never arms and this stays a plain events channel.
  events: Event[] = [],
) {
  const base = makeBoardProps()
  const props = makeBoardProps({
    state: {
      ...base.state,
      you: { ...base.state.you, hand: HAND },
      turn: base.state.selfId,
      hasDrawn: true,
      playable: HAND.map((c) => c.uid),
      targets: overrides.targets ?? {},
    },
    actions,
    intro: events.length > 0 ? { gameId: null, view: null, events, onDone: () => {} } : undefined,
  })
  return <Board {...props} />
}

// A rejection naming the staged card, shaped as the engine's own `rejected`
// event (packages/engine/src/events.ts) — enough for the hook's own watcher,
// which reads only `action.card`.
function rejectedEvent(card: string): Event {
  return {
    id: 1,
    type: 'rejected',
    action: { type: 'PLAY', player: 'you', card, at: 0 },
    reason: 'illegal',
  }
}

// Drags a card out of the fan the way a real pointer does: down on its slot,
// past Hand's own 6px threshold, released well outside the hand's band (Hand.tsx
// `onSlotDown`/`inBand`) — the same drag contract `onHandPlay` is wired to.
// Waits past both outcomes' own settle time: an accepted pull's two-rAF-frame
// flight into the centre, or a refused one's 460ms glide back into the slot
// (Hand's own SETTLE_MS) — so the DOM is in its steady state either way before
// the caller asserts on it.
async function pullCardFromFan(uid: string) {
  const index = HAND.findIndex((c) => c.uid === uid)
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  lastPulled = uid
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 600))
  })
}

// A press on an opponent's seat — Seat's own targetable div, plain onClick.
// Seat does not stop propagation for a `player`-kind target, so this click
// also bubbles to the table's own onClick in the same tick `onTargetPick`
// runs in — waits past `useHandArrival`'s FLIGHT_MS (480ms) so that IF the
// bubble incorrectly triggered a cancel (the race `_useBoardStaging`'s
// synchronous `dispatchedRef` write guards against), its return flight would
// have already finished and be observable by the caller.
async function pressSeat(player: string) {
  fireEvent.click(screen.getByTestId(`seat-${player}`))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
}

// The fan's current uids: the known, fixed hand minus whichever one a real DOM
// slot-count drop says actually left (see `lastPulled` above).
function fanUids(): string[] {
  const rendered = document.querySelectorAll('[data-hand-slot]').length
  if (rendered === HAND.length) return HAND.map((c) => c.uid)
  return HAND.filter((c) => c.uid !== lastPulled).map((c) => c.uid)
}

it('a pulled attack stages at the centre, aims, and a press on the seat dispatches with the target', async () => {
  const onPlay = vi.fn()
  render(boardWith({ targets: BUG_TARGETS }, { onPlay }))
  // drag the card out of the fan: pointer down on the slot, move past the
  // 6px threshold, release over the table (Hand's own drag contract)
  await pullCardFromFan('attack-bug#0')
  // the staged card left the fan and stands at the centre
  expect(screen.getByTestId('board-centre-staged')).toBeTruthy()
  expect(fanUids()).not.toContain('attack-bug#0')
  // the seat is lit and a press on it dispatches
  await pressSeat('p2')
  expect(onPlay).toHaveBeenCalledWith('attack-bug#0', { kind: 'player', player: 'p2' }, undefined)
  // the dispatch stands: the same click bubbling to the table's own cancel
  // must NOT have sent the card flying back to the fan (the seat-propagation
  // race `_useBoardStaging`'s synchronous `dispatchedRef` write guards against)
  expect(screen.getByTestId('board-centre-staged')).toBeTruthy()
  expect(fanUids()).not.toContain('attack-bug#0')
})

it('a pull of a no-target card is refused and the fan keeps it', async () => {
  render(boardWith({ targets: {} }))
  // attack-bug#0, not release-frontend#0: #101 (Task 8) gives a lone release
  // its own staging (it stands at the centre for its cost, same as a target
  // aim or a combo fold), so it is no longer this test's example of a card
  // this gesture refuses outright. An attack forced targetless still is.
  await pullCardFromFan('attack-bug#0')
  expect(fanUids()).toContain('attack-bug#0')
})

it('a press on nothing valid returns the staged card to the fan', async () => {
  render(boardWith({ targets: BUG_TARGETS }))
  await pullCardFromFan('attack-bug#0')
  // the table root — a miss. Not `getByRole('presentation')` (the brief's own
  // sketch): Card renders several decorative `<img alt="">`s, which the ARIA
  // spec also gives an implicit `presentation` role, so that query is
  // ambiguous against the real component — hence the dedicated testid.
  fireEvent.click(screen.getByTestId('board-table'))
  await waitFor(() => expect(fanUids()).toContain('attack-bug#0'))
})

it('Escape cancels the staging', async () => {
  render(boardWith({ targets: BUG_TARGETS }))
  await pullCardFromFan('attack-bug#0')
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(fanUids()).toContain('attack-bug#0'))
})

it('a rejected action returns the staged card', async () => {
  const onPlay = vi.fn()
  const { rerender } = render(boardWith({ targets: BUG_TARGETS }, { onPlay }))
  await pullCardFromFan('attack-bug#0')
  await pressSeat('p2')
  expect(onPlay).toHaveBeenCalledWith('attack-bug#0', { kind: 'player', player: 'p2' }, undefined)
  // the engine answers with a rejection in the feed; the projection itself is
  // unchanged (the fixture's HAND never actually loses the card) — this pins
  // the hook's own `dispatchedRef.current = false` write ahead of `cancel()`
  // in the rejected watcher: without it, `cancel()`'s own guard reads the
  // stale `true` and refuses the very return it was just called to perform.
  rerender(boardWith({ targets: BUG_TARGETS }, { onPlay }, [rejectedEvent('attack-bug#0')]))
  await waitFor(() => expect(fanUids()).toContain('attack-bug#0'))
})

// Backported from #117's bdf037f (#116 review, point 3): `useGame` accumulates
// events for the whole match (never trims), so an unwatermarked scan of the
// whole feed keeps finding a card's OWN past rejection forever. A fresh
// re-dispatch of the same card must not read that stale entry as ITS OWN
// rejection the moment anything else lands in the feed — the watermark
// discipline `useBeats` already applies to this same array (there keyed by
// event id across the whole match; here by length, captured fresh at every
// dispatch).
it('a stale rejection for a returned card does not cancel its fresh re-dispatch', async () => {
  const onPlay = vi.fn()
  const { rerender } = render(boardWith({ targets: BUG_TARGETS }, { onPlay }))
  await pullCardFromFan('attack-bug#0')
  await pressSeat('p2')
  expect(onPlay).toHaveBeenCalledTimes(1)
  // first attempt rejected — the card returns to the fan (as above)
  rerender(boardWith({ targets: BUG_TARGETS }, { onPlay }, [rejectedEvent('attack-bug#0')]))
  await waitFor(() => expect(fanUids()).toContain('attack-bug#0'))

  // a second, legitimate dispatch of the SAME card
  await pullCardFromFan('attack-bug#0')
  await pressSeat('p2')
  expect(onPlay).toHaveBeenCalledTimes(2)

  // an unrelated event lands (any sync between this dispatch and its
  // acceptance) — the feed still carries the FIRST attempt's own rejection,
  // since it only ever grows. Without a watermark this would be misread as
  // THIS dispatch's own rejection and cancel it right back to the fan.
  rerender(
    boardWith({ targets: BUG_TARGETS }, { onPlay }, [
      rejectedEvent('attack-bug#0'),
      { id: 2, type: 'turnEnded', player: 'p2' },
    ]),
  )
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
  expect(screen.getByTestId('board-centre-staged')).toBeTruthy()
  expect(fanUids()).not.toContain('attack-bug#0')
})

it('the staged card must not be cancellable after dispatch', async () => {
  render(boardWith({ targets: BUG_TARGETS }))
  await pullCardFromFan('attack-bug#0')
  await pressSeat('p2')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.getByTestId('board-centre-staged')).toBeTruthy()
})

it('a cancel takes the target down at once — a press on the seat it just left cannot dispatch', async () => {
  const onPlay = vi.fn()
  render(boardWith({ targets: BUG_TARGETS }, { onPlay }))
  await pullCardFromFan('attack-bug#0')
  // the miss: cancels via the table root, same gesture as the "nothing valid"
  // test above
  fireEvent.click(screen.getByTestId('board-table'))
  // immediately — no wait for the ~480ms return flight (useHandArrival's
  // FLIGHT_MS) to land. Without the cancel-liveness fix, `targets` (and so the
  // seat's own targetable check) stays populated for the whole glide and this
  // press would still dispatch a play for a card already flying back to the fan.
  fireEvent.click(screen.getByTestId('seat-p2'))
  expect(onPlay).not.toHaveBeenCalled()
  await waitFor(() => expect(fanUids()).toContain('attack-bug#0'))
})

it('reduced motion stages without flights', () => {
  const mm = vi.spyOn(window, 'matchMedia').mockImplementation(
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
  render(boardWith({ targets: BUG_TARGETS }))
  // the drag itself, inlined rather than through `pullCardFromFan`: that
  // helper waits 600ms for a flight that reduced motion never plays, and
  // waiting would hide the very thing this test pins — that staging is
  // already on screen with no wait at all.
  const index = HAND.findIndex((c) => c.uid === 'attack-bug#0')
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  lastPulled = 'attack-bug#0'
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  expect(screen.getByTestId('board-centre-staged')).toBeTruthy()
  mm.mockRestore()
})

it('anchors the targeting arrow at the centre it stands in, not the hand slot it left', async () => {
  render(boardWith({ targets: BUG_TARGETS }))
  const centre = document.querySelector<HTMLElement>('[data-board-centre]')
  // biome-ignore lint/style/noNonNullAssertion: _Board.tsx renders the centre node unconditionally
  vi.spyOn(centre!, 'getBoundingClientRect').mockReturnValue({
    left: 300,
    top: 200,
    width: 20,
    height: 20,
    right: 320,
    bottom: 220,
    x: 300,
    y: 200,
    toJSON: () => {},
  })
  await pullCardFromFan('attack-bug#0')
  // jsdom's real getBoundingClientRect is always all-zero, so a bug anchoring
  // the arrow anywhere else (the origin, the hand slot it left) would read as
  // (0, 0) too — this mocked rect is what makes "anchored at the centre"
  // actually falsifiable.
  const origin = document.querySelector(`.${arrowStyles.origin}`)
  expect(origin).toBeTruthy()
  expect(origin?.getAttribute('cx')).toBe('310') // centre(300,200,20,20) → 300+10
  expect(origin?.getAttribute('cy')).toBe('210')
})

// ===== Combo pairing (#100): pulling a support (Sudo / Code Review) stands IT
// at the centre instead of a plain aim, and waits for a partner clicked in the
// hand. A separate hand fixture: `HAND` above has no combo cards, and giving
// it any would break `fanUids()`'s own "at most one card ever leaves" reading
// — these tests get their own small hand and their own pull/click/read helpers
// instead, sized for a PAIR leaving the fan together.
// biome-ignore lint/style/noNonNullAssertion: both ids are known catalogue entries
const sudo = cardById('support-sudo')!
// biome-ignore lint/style/noNonNullAssertion: both ids are known catalogue entries
const codeReview = cardById('support-code-review')!
const COMBO_HAND: { uid: string; card: CardData }[] = [
  { uid: 'support-sudo#0', card: sudo },
  { uid: 'attack-bug#0', card: bug },
  { uid: 'support-code-review#0', card: codeReview },
  { uid: 'release-frontend#0', card: frontend },
]

function comboBoardWith(
  overrides: {
    targets?: Record<string, TableTarget[]>
    comboOptions?: Record<string, string[]>
    window?: TableWindow
  },
  actions: TableActions = {},
) {
  const props = makeBoardProps({
    state: {
      ...makeBoardProps().state,
      you: { ...makeBoardProps().state.you, hand: COMBO_HAND },
      turn: makeBoardProps().state.selfId,
      hasDrawn: true,
      playable: COMBO_HAND.map((c) => c.uid),
      targets: overrides.targets ?? {},
      comboOptions: overrides.comboOptions ?? {},
      window: overrides.window ?? null,
    },
    actions,
  })
  return <Board {...props} />
}

// which uids the most recent combo pull/fold sent out of the fan — the same
// role `lastPulled` plays above, sized for a pair. `comboFanUids` still falls
// back to the full hand whenever the DOM shows every slot, exactly as
// `fanUids` does, so a REFUSED pull never needs this cleared first.
let comboOut: string[] = []

function comboFanUids(): string[] {
  const rendered = document.querySelectorAll('[data-hand-slot]').length
  if (rendered === COMBO_HAND.length) return COMBO_HAND.map((c) => c.uid)
  return COMBO_HAND.filter((c) => !comboOut.includes(c.uid)).map((c) => c.uid)
}

// drags a card out of the combo fan — same drag contract as `pullCardFromFan`
// above, against the combo hand's own current render order.
async function pullFromComboFan(uid: string) {
  const index = comboFanUids().indexOf(uid)
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  comboOut = [uid]
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 600))
  })
}

// clicks a card in the combo fan (mousedown + mouseup with no movement — a
// click, not a drag; Hand's own contract, see boardStaging's `pullCardFromFan`
// header). The fold if `uid` is a valid partner, a miss (cancel) otherwise.
// Waits past MERGE_MS (620ms) so both `foldIntoPair` flights have settled.
async function clickComboFanCard(uid: string) {
  const index = comboFanUids().indexOf(uid)
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  comboOut = [...comboOut, uid]
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: 0 })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
}

// the support's own category accent, read off the lit card's `--accent`
// custom property — null unless `data-state="selected"` actually lit it
// (Card.tsx), so the card's own default category colour can't false-positive.
// Both Hand's own `faceWrap` wrapper and Card's root carry `data-state`
// (Hand.tsx / Card.tsx) — the innermost (last) match is Card's own root,
// the one that actually carries `--accent`.
function comboAccentOf(uid: string): string | null {
  const index = comboFanUids().indexOf(uid)
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  const matches = slot?.querySelectorAll<HTMLElement>('[data-state="selected"]') ?? []
  const lit = matches[matches.length - 1]
  return lit ? lit.style.getPropertyValue('--accent') : null
}

const BUG_SEAT_TARGET: Record<string, TableTarget[]> = {
  'attack-bug#0': [{ kind: 'player', player: 'p2' }],
}

const OPEN_WINDOW: TableWindow = {
  player: 'you',
  slot: 'frontend',
  round: 1,
  openedAt: 0,
  deadline: 1000,
  passed: [],
  canAttackWith: ['attack-bug#0'],
}

it('a pulled support lights its partners and a click folds the pair', async () => {
  const onPlay = vi.fn()
  comboOut = []
  render(
    comboBoardWith(
      { comboOptions: { 'support-sudo#0': ['attack-bug#0'] }, targets: BUG_SEAT_TARGET },
      { onPlay },
    ),
  )
  await pullFromComboFan('support-sudo#0')
  expect(comboAccentOf('attack-bug#0')).toBe('var(--cat-support)') // partner lit
  await clickComboFanCard('attack-bug#0') // fold
  await pressSeat('p2') // aim resolved
  expect(onPlay).toHaveBeenCalledWith(
    'attack-bug#0',
    { kind: 'player', player: 'p2' },
    'support-sudo#0',
  )
})

it('a release partner dispatches without a target', async () => {
  const onPlay = vi.fn()
  comboOut = []
  render(
    comboBoardWith(
      { comboOptions: { 'support-code-review#0': ['release-frontend#0'] } },
      { onPlay },
    ),
  )
  await pullFromComboFan('support-code-review#0')
  await clickComboFanCard('release-frontend#0')
  expect(onPlay).toHaveBeenCalledWith('release-frontend#0', undefined, 'support-code-review#0')
})

it.each([
  false,
  true,
])('pulling Code Review starts a legal pair (reduced motion: %s)', async (reduced) => {
  const motion = mockReducedMotion(reduced)
  const onPlay = vi.fn()
  comboOut = []
  const base = makeBoardProps()
  render(
    <Board
      {...makeBoardProps({
        state: {
          ...base.state,
          you: { ...base.state.you, hand: COMBO_HAND },
          playable: ['release-frontend#0'],
          comboOptions: { 'support-code-review#0': ['release-frontend#0'] },
        },
        actions: { onPlay },
      })}
    />,
  )
  try {
    await pullFromComboFan('support-code-review#0')
    expect(onPlay).not.toHaveBeenCalled()
    expect(comboAccentOf('release-frontend#0')).toBe('var(--cat-support)')
    await clickComboFanCard('release-frontend#0')
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(
      'release-frontend#0',
      undefined,
      'support-code-review#0',
    )
  } finally {
    motion.mockRestore()
  }
})

it('a window pair dispatches onAttack straight from the fold', async () => {
  const onAttack = vi.fn()
  const onPlay = vi.fn()
  comboOut = []
  render(
    comboBoardWith(
      { comboOptions: { 'support-sudo#0': ['attack-bug#0'] }, window: OPEN_WINDOW },
      { onAttack, onPlay },
    ),
  )
  await pullFromComboFan('support-sudo#0')
  await clickComboFanCard('attack-bug#0')
  expect(onAttack).toHaveBeenCalledWith('attack-bug#0', 'support-sudo#0')
  expect(onPlay).not.toHaveBeenCalled() // no target phase — the window dispatches straight from the fold
})

it('cancel returns both halves to the fan', async () => {
  comboOut = []
  render(
    comboBoardWith({
      comboOptions: { 'support-sudo#0': ['attack-bug#0'] },
      targets: BUG_SEAT_TARGET,
    }),
  )
  await pullFromComboFan('support-sudo#0')
  await clickComboFanCard('attack-bug#0') // folds, then waits at the centre for a target
  fireEvent.keyDown(window, { key: 'Escape' })
  // both halves fly back TOGETHER, as one flight — mid-flight (well before
  // useHandArrival's own 480ms FLIGHT_MS lands) there are two arrival nodes,
  // not one. Pins the merged branch specifically: a return that only carried
  // `support` and left `main` to simply reappear once `staged` cleared would
  // still pass the end-state assertion below, but would show only one node
  // here.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
  expect(document.querySelectorAll(`.${handArrivalStyles.arriving}`).length).toBe(2)
  await waitFor(() => {
    const uids = comboFanUids()
    expect(uids).toContain('support-sudo#0')
    expect(uids).toContain('attack-bug#0')
  })
})

// Fix round 1 (post-review): the fold is IRREVOCABLE once a partner is
// picked, same as ComboStory's own `playing` (pickPartner/cancellable,
// ComboStory.tsx:136,287). Before this, `merged`/`phase: 'partner'` held for
// the whole ~620ms `foldIntoPair` animation with nothing blocking `cancel()`
// — a press landing mid-fold would start a return flight for a play whose own
// `finish()` was still going to fire moments later regardless, dispatching a
// "cancelled" play and (for a target-needing partner) re-arming the aim arrow
// for a pair no longer standing there.
it('Escape mid-fold does not cancel — the fold is irrevocable and dispatches normally', async () => {
  const onPlay = vi.fn()
  comboOut = []
  render(
    comboBoardWith(
      { comboOptions: { 'support-code-review#0': ['release-frontend#0'] } },
      { onPlay },
    ),
  )
  await pullFromComboFan('support-code-review#0')
  const index = comboFanUids().indexOf('release-frontend#0')
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  comboOut = [...comboOut, 'release-frontend#0']
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: 0 }) // the fold commits — merged: true, still mid-animation
  // Escape lands in the SAME tick the fold committed in — no wait in between,
  // so this is squarely inside the window the fold owns exclusively.
  fireEvent.keyDown(window, { key: 'Escape' })
  // refused outright: no return flight ever starts. `arrival.arrive`'s own
  // geometry pass runs synchronously, in the same tick as the call that
  // starts it, so if `cancel()` had gone through this would already be 2.
  expect(document.querySelectorAll(`.${handArrivalStyles.arriving}`).length).toBe(0)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
  // the fold ran to completion and dispatched normally — the Escape changed nothing
  expect(onPlay).toHaveBeenCalledWith('release-frontend#0', undefined, 'support-code-review#0')
  expect(document.querySelectorAll(`.${handArrivalStyles.arriving}`).length).toBe(0)
})

// Final review, round 1: `targets` lights a seat the instant a partner is
// picked (`main` set, `phase` still 'partner') — for the WHOLE fold, not only
// once it settles into 'target'. A press landing there used to dispatch
// legitimately through `onTargetPick` and then get clobbered: the fold's own
// `finish()` kept running regardless and unconditionally re-committed
// `phase: 'target'` over the play the engine was already processing,
// re-arming the arrow for a pair no longer awaiting one.
it('a target press mid-fold is refused; the same seat still dispatches once the fold settles', async () => {
  const onPlay = vi.fn()
  comboOut = []
  render(
    comboBoardWith(
      { comboOptions: { 'support-sudo#0': ['attack-bug#0'] }, targets: BUG_SEAT_TARGET },
      { onPlay },
    ),
  )
  await pullFromComboFan('support-sudo#0')
  const index = comboFanUids().indexOf('attack-bug#0')
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  comboOut = [...comboOut, 'attack-bug#0']
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: 0 }) // the fold commits — merged: true, still mid-animation
  // the seat is ALREADY lit — press it in the same tick the fold committed
  // in, no wait in between
  fireEvent.click(screen.getByTestId('seat-p2'))
  expect(onPlay).not.toHaveBeenCalled() // refused — the fold owns this window exclusively
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
  expect(onPlay).not.toHaveBeenCalled() // the immediate press was dropped, not queued for later
  // a fresh press on the still-lit seat dispatches cleanly, exactly once
  fireEvent.click(screen.getByTestId('seat-p2'))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
  expect(onPlay).toHaveBeenCalledTimes(1)
  expect(onPlay).toHaveBeenCalledWith(
    'attack-bug#0',
    { kind: 'player', player: 'p2' },
    'support-sudo#0',
  )
})

// Fix round 2 (post-re-review): `foldingRef` was cleared exclusively inside
// `finish()`, so the fold's OTHER exits — the pair flyer's own `[data-main]`/
// `[data-aux]` markers missing, `pairRef` gone, a rejecting `.finished` —
// bypassed it and left the lock stuck forever (worse than pre-fix: those
// conditions used to leave a recoverable stall). Of the three, only the
// "markers missing" bail is honestly reachable here: `pairRef.current` is a
// permanently-mounted node with no test-facing way to null it, and jsdom's
// own WAAPI stub (test-setup.ts) always resolves `.finished`, never rejects
// it. This one bail simulates the same condition `if (!mainEl || !auxEl)
// return` checks, by shadowing the pair flyer's OWN `querySelector` (an
// instance override — nothing else in the suite's shared jsdom document is
// touched) rather than fabricating an unrelated failure.
it('a fold whose pair-flyer markers go missing still clears the lock — Escape cancels normally after', async () => {
  const onPlay = vi.fn()
  comboOut = []
  render(
    comboBoardWith(
      { comboOptions: { 'support-code-review#0': ['release-frontend#0'] } },
      { onPlay },
    ),
  )
  const pairFlyer = document.querySelector<HTMLElement>('[data-testid="board-pair-staged"]')
  if (!pairFlyer) throw new Error('pair flyer node not found')
  const qs = vi.spyOn(pairFlyer, 'querySelector').mockReturnValue(null)
  await pullFromComboFan('support-code-review#0')
  await clickComboFanCard('release-frontend#0') // bails at `if (!mainEl || !auxEl) return` — finish() never runs
  expect(onPlay).not.toHaveBeenCalled()
  qs.mockRestore() // back to the real DOM before asserting through it below
  // the lock still cleared despite the bail — a plain cancel works normally
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => {
    const uids = comboFanUids()
    expect(uids).toContain('support-code-review#0')
    expect(uids).toContain('release-frontend#0')
  })
})

it('a support with no partners cannot be pulled', async () => {
  comboOut = []
  render(comboBoardWith({ comboOptions: {} }))
  await pullFromComboFan('support-sudo#0')
  expect(comboFanUids()).toContain('support-sudo#0')
})

// Carried from #99's review (task-10-brief.md): `onTargetPick`'s own
// `cancellingRef` guard was unreachable defense-in-depth through the
// single-card UI. This flow's new press surface — a hand click routed to
// `staging.onCardClick` for the whole span `phase === 'partner'` covers,
// including a single-card cancel's own ~480ms return flight (`staged` isn't
// cleared until the flight LANDS, in `useHandArrival`'s own `onLanded`) —
// makes `onCardClick`'s OWN `cancellingRef` check load-bearing instead: a
// click on a still-valid partner candidate, fired while the support is
// already flying back to the fan, must not start a second fold.
it('a click during a cancel-in-flight does not start a new fold', async () => {
  const onPlay = vi.fn()
  const onAttack = vi.fn()
  comboOut = []
  render(
    comboBoardWith(
      { comboOptions: { 'support-sudo#0': ['attack-bug#0'] }, targets: BUG_SEAT_TARGET },
      { onPlay, onAttack },
    ),
  )
  await pullFromComboFan('support-sudo#0')
  fireEvent.keyDown(window, { key: 'Escape' }) // starts the single-card return flight
  // immediately — no wait for the ~480ms flight to land — click the partner
  // candidate that is still sitting in the fan
  const index = comboFanUids().indexOf('attack-bug#0')
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: 0 })
  // check WHILE the original cancel is still in flight — its own `onLanded`
  // unconditionally clears `staged` a moment later, which would mask a second
  // (bogus) fold by wiping it out along with the legitimate one. Caught here
  // instead: a click that got through would have mounted the pair flyer's
  // CardPair by now (a couple of rAF frames, well under 480ms).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
  expect(document.querySelector('[data-testid="board-pair-staged"] [data-main]')).toBeNull()
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
  expect(onPlay).not.toHaveBeenCalled()
  expect(onAttack).not.toHaveBeenCalled()
  await waitFor(() => {
    expect(document.querySelectorAll('[data-hand-slot]').length).toBe(COMBO_HAND.length)
  })
})

it('reduced motion folds a pair without flights', () => {
  const mm = vi.spyOn(window, 'matchMedia').mockImplementation(
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
  const onPlay = vi.fn()
  comboOut = []
  render(
    comboBoardWith(
      { comboOptions: { 'support-code-review#0': ['release-frontend#0'] } },
      { onPlay },
    ),
  )
  // the pull, inlined rather than through `pullFromComboFan`: that helper
  // waits 600ms for a flight reduced motion never plays.
  const pullIndex = comboFanUids().indexOf('support-code-review#0')
  const pullSlot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[pullIndex]
  comboOut = ['support-code-review#0']
  fireEvent.mouseDown(pullSlot, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  expect(screen.getByTestId('board-centre-staged')).toBeTruthy() // the support stands at the centre already
  // the fold: a click, same inlined reasoning (no 620ms MERGE_MS to wait out)
  const foldIndex = comboFanUids().indexOf('release-frontend#0')
  const foldSlot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[foldIndex]
  comboOut = [...comboOut, 'release-frontend#0']
  fireEvent.mouseDown(foldSlot, { clientX: 0, clientY: 0 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: 0 })
  // release has no target and no open window — dispatches at once, same phase
  // outcome the animated path reaches after its own flights settle
  expect(onPlay).toHaveBeenCalledWith('release-frontend#0', undefined, 'support-code-review#0')
  expect(document.querySelector('[data-testid="board-pair-staged"] [data-main]')).toBeTruthy()
  mm.mockRestore()
})

// Task 12 (#100): once a pair reaches `phase: 'dispatched'`, `staged` lives in
// `_useBoardStaging.ts`'s own React state — untouched by a prop's identity —
// but the pair flyer's CardPair is a fresh element every render
// (`_Board.tsx`'s own `{staging.staged?.merged && … && <CardPair .../>}`).
// A "projection tick" — the kind of re-render a P2P sync produces on every
// batch even when nothing about THIS play changed — has to leave the pair
// exactly as it stood: not remounted, not doubled, not dropped.
it('a dispatched pair survives a projection tick without flicker', async () => {
  const onPlay = vi.fn()
  comboOut = []
  const overrides = { comboOptions: { 'support-code-review#0': ['release-frontend#0'] } }
  const { rerender } = render(comboBoardWith(overrides, { onPlay }))
  await pullFromComboFan('support-code-review#0')
  await clickComboFanCard('release-frontend#0') // dispatches at once — no target, no window
  expect(onPlay).toHaveBeenCalledWith('release-frontend#0', undefined, 'support-code-review#0')
  expect(document.querySelectorAll('[data-testid="board-pair-staged"] [data-main]').length).toBe(1)

  // the projection tick: a fresh render built from scratch (`comboBoardWith`
  // calls `makeBoardProps()` anew), while `COMBO_HAND` — and so the dispatched
  // play itself — stays byte-for-byte the array it already was.
  rerender(comboBoardWith(overrides, { onPlay }))
  expect(document.querySelectorAll('[data-testid="board-pair-staged"] [data-main]').length).toBe(1)
  expect(document.querySelectorAll('[data-testid="board-pair-staged"] [data-aux]').length).toBe(1)
})
