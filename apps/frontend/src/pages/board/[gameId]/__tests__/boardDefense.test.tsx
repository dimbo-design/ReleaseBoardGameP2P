// Answering an attack (#101, Task 16): pulling a defence out of the fan and
// dropping it on the attack answers the open `defend` pending owed to us.
// `_useDefenseStaging.ts` is the sibling hook that owns this — active only
// while the engine owes us that decision; `_useBoardStaging.ts` (this file's
// own sibling suite, boardStaging.test.tsx) owns the TURN's plays and the two
// never run at once. Same render harness (real `<Board>`, no mocks).
//
// Task 17 (#101) adds the enhanced answer: pulling the defender's own Sudo
// stands it at its own slot, waiting for a partner CLICKED in the hand — the
// same pull/pick shape boardStaging.test.tsx's own combo tests already pin for
// the turn side, ported here for the defend side (`pullFromFan`/`clickFanCard`
// mirror that file's own `pullFromComboFan`/`clickComboFanCard`).

import type { Event } from '@release/engine'
import type { CardData, TableActions } from '@release/ui'
import { cardById } from '@release/ui'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import arrowStyles from '@/primitives/Arrow/Arrow.module.css'
import { useBoardAnchors } from '~/entities/game/board'
import Board from '../_Board'
import { useDefenseStaging } from '../_useDefenseStaging'
import { makeBoardProps } from './fixture'

// biome-ignore lint/style/noNonNullAssertion: a known catalogue entry
const hotfix = cardById('defense-hotfix')!
// biome-ignore lint/style/noNonNullAssertion: a known catalogue entry
const sudo = cardById('support-sudo')!

// The fixed hand every test in this file renders: the one defence card these
// tests pull, plus (Task 17) the defender's own Sudo. Never mutated by the
// hook itself, same discipline as boardStaging.test.tsx's own HAND.
const HAND: { uid: string; card: CardData }[] = [
  { uid: 'defense-hotfix#0', card: hotfix },
  { uid: 'support-sudo#0', card: sudo },
]

// The uids that have left the fan so far this test's own pull sequence —
// reset by whichever helper starts a fresh one (`pullCardFromFan`,
// `pullFromFan`), extended by whichever continues it (`clickFanCard`). Same
// role boardStaging.test.tsx's own `comboOut` plays for its fold tests.
let pulledOut: string[] = []

// The hand actually rendered by the most recent `defenceBoard` call — HAND by
// default, but the fold-lock test (Fix round 1, Important 3) rerenders with a
// SECOND, independent pair of cards to prove the lock does not stick across
// two separate exchanges. `fanUids`'s own fallback needs to know which hand
// is live, not just its length (a same-length replacement would otherwise be
// indistinguishable from HAND itself).
let currentHand: { uid: string; card: CardData }[] = HAND

// Builds a board whose `state.pending` is a `defend` owed to `selfId` — the
// engine's own shape (packages/engine/src/fake/attacks.ts's `pendingView`):
// `scope: 'release'`, a fixed attacker/attackCard, sudo false, and `options`
// from `over` (legality is the projection's answer, never re-derived here).
function defenceBoard(
  over: { options: string[]; combos?: Record<string, string[]>; hand?: typeof HAND },
  actions: TableActions = {},
  // routed through `intro.events`, same as boardStaging.test.tsx's own
  // `boardWith` — Board only ever sees the feed that way.
  events: Event[] = [],
) {
  const hand = over.hand ?? HAND
  currentHand = hand
  const base = makeBoardProps()
  const props = makeBoardProps({
    state: {
      ...base.state,
      you: { ...base.state.you, hand },
      // no pending → nothing playable is a real engine invariant
      // (playableFor's own first check); a defend pending is no exception.
      playable: [],
      // the defender's own Sudo pairing (Task 17) — the projection's answer
      // (packages/engine/src/fake/project.ts's `combosFor`, extended in this
      // task's own engine step), fixture-supplied here the same way
      // boardStaging.test.tsx's own `comboBoardWith` supplies it for the turn
      // side. `{}` (the default) means no Sudo pairing is offered.
      comboOptions: over.combos ?? {},
      pending: {
        kind: 'defend',
        player: base.state.selfId,
        attacker: 'p2',
        attackCard: 'attack-bug',
        sudo: false,
        options: over.options,
        openedAt: 0,
        deadline: 15_000,
        scope: 'release',
      },
    },
    actions,
    intro: events.length > 0 ? { gameId: null, view: null, events, onDone: () => {} } : undefined,
  })
  return <Board {...props} />
}

// A rejection naming the defend pending's own choice — the REAL shape a
// rejected RESOLVE carries (packages/engine/src/fake/core.ts's `reject()`:
// `{type: 'rejected', action, reason}`, where `action` is the whole original
// Action). A RESOLVE action has no top-level `card` — the card lives inside
// `action.choice`, which is why the hook's own watcher cannot reuse
// `_useBoardStaging`'s `'card' in e.action` check.
function rejectedDefendEvent(card: string): Event {
  return {
    id: 9,
    type: 'rejected',
    action: { type: 'RESOLVE', player: 'you', choice: { kind: 'defend', card }, at: 0 },
    reason: 'illegal',
  }
}

// Drags a card out of the fan — same drag contract as boardStaging.test.tsx's
// own `pullCardFromFan`: down on its slot, past the 6px threshold, released
// well outside the hand's band. Waits past the accepted flight's own settle
// time (the SAME `playToCenter` preset boardStaging's own solo-release path
// uses to reach a centre slot). Against the HAND's own fixed index — the
// plain path this drives always pulls the fan's only OTHER card, so nothing
// has shifted its position yet.
async function pullCardFromFan(uid: string) {
  const index = HAND.findIndex((c) => c.uid === uid)
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  pulledOut = [uid]
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 600))
  })
}

// Drags the defender's own Sudo out of the fan (Task 17) — same drag contract
// as `pullCardFromFan` above, against the CURRENT render order (`fanUids()`)
// rather than HAND's fixed one, since a fold test may pull a second card off a
// fan that has already lost its first.
async function pullFromFan(uid: string) {
  const index = fanUids().indexOf(uid)
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  pulledOut = [uid]
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 600))
  })
}

// Clicks a card in the fan (mousedown + mouseup with no movement — a click,
// not a drag; boardStaging.test.tsx's own `clickComboFanCard` carries the same
// contract). The fold if `uid` is the waiting Sudo's own valid partner, a
// miss (cancel) otherwise. Waits past MERGE_MS (620ms) so both `foldIntoPair`
// flights have settled.
async function clickFanCard(uid: string) {
  const index = fanUids().indexOf(uid)
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  pulledOut = [...pulledOut, uid]
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: 0 })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
}

// The fan's current uids — same construction as boardStaging.test.tsx's own
// `fanUids`/`comboFanUids`. Falls back to the full (current) hand whenever the
// DOM shows every slot, so a REFUSED pull never needs `pulledOut` cleared
// first.
function fanUids(): string[] {
  const rendered = document.querySelectorAll('[data-hand-slot]').length
  if (rendered === currentHand.length) return currentHand.map((c) => c.uid)
  return currentHand.filter((c) => !pulledOut.includes(c.uid)).map((c) => c.uid)
}

it('drops a defence on the attack and answers with it', async () => {
  const onResolve = vi.fn()
  render(defenceBoard({ options: ['defense-hotfix#0'] }, { onResolve }))
  await pullCardFromFan('defense-hotfix#0')
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'defend',
    card: 'defense-hotfix#0',
    combo: undefined,
  })
  // the card left the fan and stands, landed, over the attack — pins the
  // static cover render this hook's own `landed` gate produces, the same way
  // boardStaging.test.tsx pins `board-centre-staged` for a plain aim.
  expect(fanUids()).not.toContain('defense-hotfix#0')
  expect(screen.getByTestId('board-cover-staged')).toBeTruthy()
})

it('returns the fan to normal play when a pending closes before a Sudo partner is chosen', async () => {
  const initial = defenceBoard({
    options: ['defense-hotfix#0'],
    combos: { 'support-sudo#0': ['defense-hotfix#0'] },
  })
  const { rerender } = render(initial)
  await pullFromFan('support-sudo#0')
  expect(document.querySelectorAll('[data-hand-slot]')).toHaveLength(1)
  // Passing or timing out does not dispatch the staged Sudo. Only a defense
  // that was actually played may keep filtering the hand after pending ends.
  rerender(<Board {...initial.props} state={{ ...initial.props.state, pending: null }} />)
  expect(document.querySelectorAll('[data-hand-slot]')).toHaveLength(2)
})

it('offers nothing the projection did not offer', async () => {
  // legality is the engine's answer, never the UI's — a card the pending does
  // not list cannot be pulled to answer with
  const onResolve = vi.fn()
  render(defenceBoard({ options: [] }, { onResolve }))
  await pullCardFromFan('defense-hotfix#0')
  expect(onResolve).not.toHaveBeenCalled()
  expect(fanUids()).toContain('defense-hotfix#0')
})

it('a rejected defence comes back to the fan', async () => {
  const onResolve = vi.fn()
  const { rerender } = render(defenceBoard({ options: ['defense-hotfix#0'] }, { onResolve }))
  await pullCardFromFan('defense-hotfix#0')
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'defend',
    card: 'defense-hotfix#0',
    combo: undefined,
  })
  rerender(
    defenceBoard({ options: ['defense-hotfix#0'] }, { onResolve }, [
      rejectedDefendEvent('defense-hotfix#0'),
    ]),
  )
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
  expect(fanUids()).toContain('defense-hotfix#0')
  expect(screen.queryByTestId('board-cover-staged')).toBeNull()
})

it('reduced motion stages without a flight', () => {
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
  const onResolve = vi.fn()
  render(defenceBoard({ options: ['defense-hotfix#0'] }, { onResolve }))
  // the drag itself, inlined rather than through `pullCardFromFan`: that
  // helper waits 600ms for a flight reduced motion never plays.
  const index = HAND.findIndex((c) => c.uid === 'defense-hotfix#0')
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  pulledOut = ['defense-hotfix#0']
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'defend',
    card: 'defense-hotfix#0',
    combo: undefined,
  })
  expect(screen.getByTestId('board-cover-staged')).toBeTruthy()
  mm.mockRestore()
})

// Fix B (#101), Defect 1 — the panel used to render for a `defend` too: a
// fully opaque surface at z 92, centred on the table, over centre slots at
// z 9–11. It covered the very attack it was asking about, and a card flying
// to or from the cover slot (a carrier at z 250) disappeared the instant it
// landed behind it. It was also a SECOND picker for a decision the fan now
// answers (Task 16's own drag gesture), so the board stops raising it for
// this one kind and asks with the cards instead. The one thing only the panel
// could do — declining — moves to the board's own affordance, pinned below.
//
// This REPLACES fix round 1's "a defence chosen through the pending panel
// also covers the attack": that door no longer exists, so the hook's
// `answerWith` (its only caller) went with it.
it('raises no panel over the attack — the fan is the picker', () => {
  render(defenceBoard({ options: ['defense-hotfix#0'] }))
  expect(screen.queryByTestId('pending-prompt')).toBeNull()
  // …and the attack is standing at the centre with nothing over it
  expect(screen.getByTestId('board-centre-pending')).toBeTruthy()
})

it('lets the attack through from the board’s own decline', () => {
  const onResolve = vi.fn()
  render(defenceBoard({ options: ['defense-hotfix#0'] }, { onResolve }))
  fireEvent.click(screen.getByTestId('board-decline'))
  expect(onResolve).toHaveBeenCalledWith({ kind: 'defend', card: null })
})

it('lets the attack through from the dock Pass key', async () => {
  const onResolve = vi.fn()
  const onPass = vi.fn()
  render(defenceBoard({ options: ['defense-hotfix#0'] }, { onResolve, onPass }))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350))
  })
  fireEvent.click(screen.getByTestId('dock-key'))
  expect(onResolve).toHaveBeenCalledWith({ kind: 'defend', card: null })
  expect(onPass).not.toHaveBeenCalled()
})

it('does not pass after a defense card has already answered', async () => {
  const onResolve = vi.fn()
  const onPass = vi.fn()
  render(defenceBoard({ options: ['defense-hotfix#0'] }, { onResolve, onPass }))
  await pullCardFromFan('defense-hotfix#0')
  onResolve.mockClear()
  fireEvent.click(screen.getByTestId('dock-key'))
  expect(onResolve).not.toHaveBeenCalled()
  expect(onPass).not.toHaveBeenCalled()
})

// Fix B (#101), Defect 3 — the ask sits with the cards. With no panel and no
// line of copy, an attack stands at the centre with nothing saying what is
// owed for it.
it('says what the attack is waiting for', () => {
  const { copy } = makeBoardProps()
  render(defenceBoard({ options: ['defense-hotfix#0'] }))
  const ask = screen.getByTestId('board-ask')
  expect(ask.getAttribute('data-shown')).toBe('true')
  expect(ask.textContent).toContain(copy.table.askDefend)
})

// Fix B, fix round 1 (M1): the ask was gated on `answering` alone, so a Sudo
// standing at its own slot still read "pull one out of the hand" — while the
// only gesture that answers there is a CLICK, and a pull is refused outright
// (`resolveLegal`/`resolveSudo` both bail on `stagedRef.current`, so the card
// flops straight back into the fan). That is the exact failure Defect 3 was
// written to prevent, one step further in, and this round is what newly lights
// that state. It gets its own words rather than silence: the step is waiting
// on the fan, and a waiting step that says nothing is Defect 3 itself.
it('names the click, not the pull, once the Sudo stands waiting', async () => {
  const { copy } = makeBoardProps()
  render(
    defenceBoard({
      options: ['defense-hotfix#0'],
      combos: { 'support-sudo#0': ['defense-hotfix#0'] },
    }),
  )
  await pullFromFan('support-sudo#0')
  const ask = screen.getByTestId('board-ask')
  expect(ask.getAttribute('data-shown')).toBe('true')
  expect(ask.textContent).toContain(copy.table.askPartner)
  // the pull instruction is gone — naming it here names the one gesture that
  // does nothing
  expect(ask.textContent).not.toContain(copy.table.askDefend)
})

// Fix B, fix round 1 (L1): the decline was gated on `answering` alone too, so
// it stayed live between a defence's dispatch and the projection clearing the
// pending — a second RESOLVE the engine silently rejects. The codebase's own
// standard is `dock.ts`'s: "a key is only ever offered where the action behind
// it is legal RIGHT NOW", the same standard that stripped the dead PASS key.
it('takes the decline away once a defence has already answered', async () => {
  render(defenceBoard({ options: ['defense-hotfix#0'] }))
  expect(screen.getByTestId('board-decline')).toBeTruthy()
  await pullCardFromFan('defense-hotfix#0')
  expect(screen.queryByTestId('board-decline')).toBeNull()
  // …and the ask goes quiet with it: the decision is no longer ours to make
  expect(screen.getByTestId('board-ask').getAttribute('data-shown')).toBe('false')
})

// A waiting Sudo has dispatched NOTHING, so declining there is still legal —
// which is why the L1 gate (the test above) excludes `phase: 'partner'` rather
// than every staged state. What makes that safe rather than merely legal is an
// ORDERING: the partner-phase `mousedown` listener in `_Board.tsx` sends the
// Sudo home on the very press that goes on to fire this button's `onClick`, so
// one press both retracts the Sudo and lets the attack through — the card is
// never stranded on the table.
//
// Fix round 2: this test used to call `fireEvent.click` alone and assert only
// the dispatch. `fireEvent.click` dispatches NO `mousedown`, so the listener
// this comment rests on never ran — the comment claimed a mechanism the test
// never fired, and the ordering was held up by code review alone. The real
// press sequence is fired now (down → up → click, the browser's own order),
// and the Sudo's return is asserted, so breaking either half goes red.
it('takes the waiting Sudo home on the same press that declines', async () => {
  const onResolve = vi.fn()
  render(
    defenceBoard(
      { options: ['defense-hotfix#0'], combos: { 'support-sudo#0': ['defense-hotfix#0'] } },
      { onResolve },
    ),
  )
  await pullFromFan('support-sudo#0')
  // proves the pull actually did something — without it, a Sudo that never
  // left the fan would satisfy the return assertion below just as well
  expect(fanUids()).not.toContain('support-sudo#0')

  const decline = screen.getByTestId('board-decline')
  fireEvent.mouseDown(decline, { clientX: 0, clientY: 0 })
  fireEvent.mouseUp(decline, { clientX: 0, clientY: 0 })
  fireEvent.click(decline)

  // the attack is let through…
  expect(onResolve).toHaveBeenCalledWith({ kind: 'defend', card: null })
  // …and the Sudo is not left standing: the same press started its return
  // flight home (waited out, as `a press on nothing valid` does)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
  expect(fanUids()).toContain('support-sudo#0')
  const sudoSlot = document.querySelector('[data-centre-slot="sudo"]') as HTMLElement
  expect(sudoSlot.querySelector('[data-card]')).toBeNull()
})

// Fix B (#101), Defect 2 — `_Board.tsx` passed `accentAt` and never `stateAt`,
// and both `accentAt` implementations answer only for a combo partner, so the
// fan could not light for a defend at all. `defenceOptions` was computed by
// this hook and had no consumer whatsoever.
function litState(uid: string): string | null {
  const index = fanUids().indexOf(uid)
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  return slot?.querySelector<HTMLElement>('[data-card]')?.getAttribute('data-state') ?? null
}

it('lights the defences the projection offers, and the Sudo that may back one', () => {
  render(
    defenceBoard({
      options: ['defense-hotfix#0'],
      combos: { 'support-sudo#0': ['defense-hotfix#0'] },
    }),
  )
  expect(litState('defense-hotfix#0')).toBe('playable')
  expect(litState('support-sudo#0')).toBe('playable')
})

it('leaves the Sudo dark when the projection offers it nothing to enhance', () => {
  render(defenceBoard({ options: ['defense-hotfix#0'] }))
  expect(litState('defense-hotfix#0')).toBe('playable')
  expect(litState('support-sudo#0')).toBe('idle')
})

// Fix B, fix round 1 (L2): `stateAt` decided what to light from the pending
// alone, while every path that ACCEPTS an answer (`resolveLegal`,
// `resolveSudo`) additionally requires `enabled` — false while the opening
// owns the table. In that window (a rejoin replaying the opening into a
// pending already owed to you) the fan glowed on cards the hook would refuse,
// which is the exact "lit with nothing that answers it" reading this round
// exists to end.
//
// Driven through the hook rather than <Board>, on purpose: the only producer
// of `enabled === false` is the opening beat, whose harness is the suite's one
// known-flaky file (a real 9-second setTimeout). `renderHook` is an
// established pattern here (features/hand-order, features/game-intro), and it
// pins the gate itself instead of the machinery that happens to set it.
function defenceStateAt(enabled: boolean): (i: number) => string {
  const base = makeBoardProps()
  const { result } = renderHook(() =>
    useDefenseStaging({
      state: {
        ...base.state,
        you: { ...base.state.you, hand: HAND },
        playable: [],
        pending: {
          kind: 'defend',
          player: base.state.selfId,
          attacker: 'p2',
          attackCard: 'attack-bug',
          sudo: false,
          options: ['defense-hotfix#0'],
          openedAt: 0,
          deadline: 15_000,
          scope: 'release',
        },
      },
      anchors: useBoardAnchors(),
      events: [],
      enabled,
    }),
  )
  return (i: number) => result.current.stateAt(i)
}

it('lights nothing the opening would refuse', () => {
  // the same hand, the same pending — only the gate differs, so a green here
  // cannot come from the fixture being unlit in the first place
  expect(defenceStateAt(true)(0)).toBe('playable')
  expect(defenceStateAt(false)(0)).toBe('idle')
})

// Fix B (#101), Defect 5 — the hue says what kind of card is aiming. The
// approved scene passes `color="var(--cat-support)"` to `<Arrow>`; the board
// passed none and fell back to brand green.
it('aims the Sudo’s arrow in the support hue', async () => {
  render(
    defenceBoard({
      options: ['defense-hotfix#0'],
      combos: { 'support-sudo#0': ['defense-hotfix#0'] },
    }),
  )
  await pullFromFan('support-sudo#0')
  const svg = document.querySelector<SVGElement>(`.${arrowStyles.svg}`)
  expect(svg?.style.getPropertyValue('--arrow')).toBe('var(--cat-support)')
})

// Task 17 (#101): the defender's own Sudo takes its own slot, then folds into
// the answer. `combos` (routed to `state.comboOptions` by `defenceBoard`
// above) stands in for the engine's own `combosFor` answer — this task's own
// engine step, pinned separately in packages/engine/src/fake/project.test.ts.

it('stands the Sudo in its own slot and aims an arrow out of it', async () => {
  render(
    defenceBoard(
      { options: ['defense-hotfix#0'], combos: { 'support-sudo#0': ['defense-hotfix#0'] } },
      {},
    ),
  )
  await pullFromFan('support-sudo#0')
  const sudoSlot = document.querySelector('[data-centre-slot="sudo"]') as HTMLElement
  expect(sudoSlot.querySelector('[data-card]')).toBeTruthy()
  // The brief's own draft named `arrowStyles.arrow` — no such class exists in
  // Arrow.module.css (verified: only `.svg`/`.origin`/`.base`/`.flow`/`.head`).
  // `.origin` is the class boardStaging.test.tsx's own combo-arrow test
  // already checks for the identical purpose ("is the arrow armed"), so this
  // follows that established precedent instead.
  expect(document.querySelector(`.${arrowStyles.origin}`)).toBeTruthy()
})

it('folds the picked defence together with the Sudo and answers as a pair', async () => {
  const onResolve = vi.fn()
  render(
    defenceBoard(
      { options: ['defense-hotfix#0'], combos: { 'support-sudo#0': ['defense-hotfix#0'] } },
      { onResolve },
    ),
  )
  await pullFromFan('support-sudo#0')
  await clickFanCard('defense-hotfix#0')
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'defend',
    card: 'defense-hotfix#0',
    combo: 'support-sudo#0',
  })
  // the fold landed as a CardPair, not a lone Card, and the Sudo's own slot is
  // empty again — never on screen twice, never absent (the no-duplicate rule)
  expect(screen.getByTestId('board-cover-staged').querySelectorAll('[data-card]')).toHaveLength(2)
  const sudoSlot = document.querySelector('[data-centre-slot="sudo"]') as HTMLElement
  expect(sudoSlot.querySelector('[data-card]')).toBeNull()
})

it('a press on nothing valid takes the waiting Sudo home', async () => {
  render(
    defenceBoard(
      { options: ['defense-hotfix#0'], combos: { 'support-sudo#0': ['defense-hotfix#0'] } },
      {},
    ),
  )
  await pullFromFan('support-sudo#0')
  // proves the pull actually did something — without this, a Sudo that never
  // leaves the fan at all would satisfy the assertion below just as well,
  // pinning nothing (the whole reason for this check)
  expect(fanUids()).not.toContain('support-sudo#0')
  fireEvent.mouseDown(document.querySelector('[data-board-centre]')?.parentElement as HTMLElement)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
  expect(fanUids()).toContain('support-sudo#0')
})

// The hand cards a waiting Sudo may fold with light with its own category
// accent — mirrors boardStaging.test.tsx's own `comboAccentOf`/its "a pulled
// support lights its partners" test, ported to the defend side.
function defAccentOf(uid: string): string | null {
  const index = fanUids().indexOf(uid)
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  const matches = slot?.querySelectorAll<HTMLElement>('[data-state="selected"]') ?? []
  const lit = matches[matches.length - 1]
  return lit ? lit.style.getPropertyValue('--accent') : null
}

it('a pulled Sudo lights the defence it may enhance', async () => {
  render(
    defenceBoard(
      { options: ['defense-hotfix#0'], combos: { 'support-sudo#0': ['defense-hotfix#0'] } },
      {},
    ),
  )
  await pullFromFan('support-sudo#0')
  expect(defAccentOf('defense-hotfix#0')).toBe('var(--cat-support)')
})

// Fix round 1 (Important 3): mechanic 2 (the no-duplicate commit) had no
// direct pin — the two existing fold tests only ever check AFTER the whole
// ~620ms settle, a span the SAME commit's own guarantee has nothing to do
// with. This checks the one render the guarantee is actually about: the
// instant `fireEvent.mouseUp` returns, BEFORE any `act(async …)` wait, both
// halves of the swap must already be true together — the standing Sudo gone,
// the flyer already showing the whole pair. Moving `commitStaged` to after
// the flight (or replacing the whole fold with a bare `setLanded(true)`)
// makes this fail; I verified that by making the mutation locally before
// writing this comment.
it("the standing Sudo and the flyer's own pair swap in the SAME commit", async () => {
  render(
    defenceBoard(
      { options: ['defense-hotfix#0'], combos: { 'support-sudo#0': ['defense-hotfix#0'] } },
      {},
    ),
  )
  await pullFromFan('support-sudo#0')
  const index = fanUids().indexOf('defense-hotfix#0')
  const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
  fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: 0 })
  // no `await` above this line — the very next paint after the click
  const sudoSlot = document.querySelector('[data-centre-slot="sudo"]') as HTMLElement
  expect(sudoSlot.querySelector('[data-card]')).toBeNull()
  // wherever the pair currently lives (the flyer, at this instant — the
  // static cover render cannot exist yet, `landed` has had no chance to flip)
  expect(document.querySelectorAll('[data-main] [data-card], [data-aux] [data-card]')).toHaveLength(
    2,
  )
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
})

// Fix round 1 (Important 3): mechanic 3 (the fold lock) had no test at all.
// Direct precedent: boardStaging.test.tsx's own "a fold whose pair-flyer
// markers go missing still clears the lock" — but that test's own probe
// (Escape) does not transfer here: `_useBoardStaging`'s fold does not commit
// `phase: 'dispatched'` until `finish()` runs at the END of its flight, so a
// bailed fold there is STILL cancellable (`phase` stays 'partner'). This
// fold's own no-duplicate commit requires the OPPOSITE order — `phase:
// 'dispatched'` is set before the flight even starts (Fix round 1, Important
// 2's own finding) — so by the time this bail runs, Escape/cancel() is
// ALREADY refused by `phase === 'dispatched'` regardless of the lock. The
// lock's only OWN observable consequence here is whether a LATER, INDEPENDENT
// fold can still complete — so that is what this proves, against a second
// pending built with fresh cards once the first exchange has been echoed
// away (`rerender`, the same device `boardStaging.test.tsx`'s own tests use
// for a second cycle).
it('a fold whose flyer markers go missing still clears the lock — a later, independent fold succeeds normally', async () => {
  const onResolve = vi.fn()
  const { rerender } = render(
    defenceBoard(
      { options: ['defense-hotfix#0'], combos: { 'support-sudo#0': ['defense-hotfix#0'] } },
      { onResolve },
    ),
  )
  const proto = Element.prototype.querySelector
  const qs = vi.spyOn(Element.prototype, 'querySelector').mockImplementation(function (
    this: Element,
    selector: string,
  ) {
    if (selector === '[data-main]' || selector === '[data-aux]') return null
    return proto.call(this, selector)
  })
  await pullFromFan('support-sudo#0')
  await clickFanCard('defense-hotfix#0') // bails at `if (!mainEl || !auxEl)` — dispatches anyway, never animates
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'defend',
    card: 'defense-hotfix#0',
    combo: 'support-sudo#0',
  })
  qs.mockRestore() // back to the real DOM before the second exchange below

  // a second, independent attack — the engine echoed the first exchange away
  // (a fresh hand, a fresh pending naming fresh uids); if `foldingRef` had
  // stuck from the bail above, this fold would refuse silently, forever
  const hand2: { uid: string; card: CardData }[] = [
    { uid: 'defense-hotfix#1', card: hotfix },
    { uid: 'support-sudo#1', card: sudo },
  ]
  pulledOut = []
  rerender(
    defenceBoard(
      {
        options: ['defense-hotfix#1'],
        combos: { 'support-sudo#1': ['defense-hotfix#1'] },
        hand: hand2,
      },
      { onResolve },
    ),
  )
  await pullFromFan('support-sudo#1')
  await clickFanCard('defense-hotfix#1')
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'defend',
    card: 'defense-hotfix#1',
    combo: 'support-sudo#1',
  })
})

// Task 17's own reduced-motion path had a test for the plain answer only
// ("reduced motion stages without a flight") — the fold's own reduced-motion
// branch (`if (reduced || !fromRect)`) was unpinned. Same constraint Task 16
// already set precedent for on the plain path: every flight needs a path
// reaching the same end state with no animation.
it('reduced motion folds the pair without a flight', () => {
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
  const onResolve = vi.fn()
  render(
    defenceBoard(
      { options: ['defense-hotfix#0'], combos: { 'support-sudo#0': ['defense-hotfix#0'] } },
      { onResolve },
    ),
  )
  // the pull, inlined — `pullFromFan` waits 600ms for a flight reduced motion
  // never plays
  const sudoIndex = fanUids().indexOf('support-sudo#0')
  const sudoSlotEl = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[sudoIndex]
  pulledOut = ['support-sudo#0']
  fireEvent.mouseDown(sudoSlotEl, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  const sudoSlot = document.querySelector('[data-centre-slot="sudo"]') as HTMLElement
  expect(sudoSlot.querySelector('[data-card]')).toBeTruthy()

  // the fold, inlined the same way — `clickFanCard` waits 700ms for
  // `foldIntoPair` flights reduced motion never plays
  const defIndex = fanUids().indexOf('defense-hotfix#0')
  const defSlotEl = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[defIndex]
  pulledOut = [...pulledOut, 'defense-hotfix#0']
  fireEvent.mouseDown(defSlotEl, { clientX: 0, clientY: 0 })
  fireEvent.mouseUp(window, { clientX: 0, clientY: 0 })
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'defend',
    card: 'defense-hotfix#0',
    combo: 'support-sudo#0',
  })
  expect(screen.getByTestId('board-cover-staged').querySelectorAll('[data-card]')).toHaveLength(2)
  mm.mockRestore()
})
