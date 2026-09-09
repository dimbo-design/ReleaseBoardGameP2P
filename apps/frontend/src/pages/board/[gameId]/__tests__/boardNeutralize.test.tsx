// Answering an Error 503 (#102, Task 9): the card that performs the answer is
// the card you touch. Three gestures, one pending — a Debugger pulled out of
// the fan, a release dragged out of your own zone, and the standing Monitoring
// pressed where it is. `_useNeutralizeStaging.tsx` owns all three; its siblings
// `_useBoardStaging.ts` (the turn's plays) and `_useDefenseStaging.tsx` (a
// window's) never run at the same time, because a pending suspends normal play.
//
// Same render harness as boardDefense.test.tsx: the real `<Board>`, no mocks,
// and the pending built locally with `makeBoardProps` the way every sibling
// suite builds its own.

import type { Event } from '@release/engine'
import type { CardData, TableActions } from '@release/ui'
import { cardById } from '@release/ui'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useBoardAnchors } from '~/entities/game/board'
import Board from '../_Board'
import { useNeutralizeStaging } from '../_useNeutralizeStaging'
import { makeBoardProps } from './fixture'

type SlotKey = 'frontend' | 'backend' | 'database' | 'monitoring'

// The zone draws its slots in this order and marks none of them — the DOM
// position IS the key (apps/ui/src/table/ReleaseZone/ReleaseZone.tsx's `SLOTS`).
const SLOT_ORDER: SlotKey[] = ['frontend', 'backend', 'database', 'monitoring']

// biome-ignore lint/style/noNonNullAssertion: a known catalogue entry
const card = (id: string): CardData => cardById(id)!

describe.each(['neutralize503', 'crush'] as const)('%s card gestures', (kind) => {
  interface Over {
    methods: ('debugger' | 'monitoring' | 'sacrifice')[]
    hand?: string[] // card ids — uids come out as `${id}#${i}`
    release?: Partial<Record<SlotKey, string>>
    releaseUid?: Partial<Record<SlotKey, string>>
  }

  // A board whose `state.pending` is a 503 owed to `selfId` — the engine's own
  // shape (`packages/engine/src/view.ts`'s `Pending`): `card` is a CardId (or
  // null for the AI-deck mimic), and `methods` is the projection's answer to what
  // may answer it. Legality is read from there and never re-derived.
  function withAlarm(over: Over, actions: TableActions = {}, events: Event[] = []) {
    const base = makeBoardProps()
    const hand = (over.hand ?? []).map((id, i) => ({ uid: `${id}#${i}`, card: card(id) }))
    const release: Record<string, CardData | undefined> = {}
    for (const [key, id] of Object.entries(over.release ?? {})) release[key] = card(id)
    const props = makeBoardProps({
      state: {
        ...base.state,
        you: {
          ...base.state.you,
          hand,
          release,
          releaseUid: over.releaseUid,
        },
        // no pending → nothing playable is a real engine invariant
        // (`playableFor`'s own first check); a 503 is no exception.
        playable: [],
        pending: {
          player: base.state.selfId,
          ...(kind === 'neutralize503'
            ? { kind: 'neutralize503' as const, card: 'trigger-error-503' }
            : { kind: 'crush' as const, slot: 'frontend' as const, source: 'ai-crush-frontend' }),
          methods: over.methods,
        },
      },
      actions,
      intro: events.length > 0 ? { gameId: null, view: null, events, onDone: () => {} } : undefined,
    })
    return <Board {...props} />
  }

  // THE GEOMETRY. jsdom measures every box as 0×0, and the drop rule this task
  // adds is the first thing on the board that asks WHERE a card was let go — so
  // the two nodes the rule is measured off (the release zone and the fan) are
  // given real boxes, and so is `Hand`'s own inner root, which decides whether a
  // release counts as "inside the fan" at all (its band).
  //
  // The layout mirrors the screen: the zone above, the fan below it, the whole
  // table above both.
  const Zone = { left: 380, top: 600, width: 520, height: 120 }
  const Fan = { left: 200, top: 820, width: 900, height: 200 }

  function boxOf(r: { left: number; top: number; width: number; height: number }): DOMRect {
    return {
      ...r,
      right: r.left + r.width,
      bottom: r.top + r.height,
      x: r.left,
      y: r.top,
      toJSON: () => r,
    } as DOMRect
  }

  function measure(el: Element | null, r: typeof Zone) {
    if (el) (el as HTMLElement).getBoundingClientRect = () => boxOf(r)
  }

  // `board-you` renders the zone wrapper first and the hand wrapper second — the
  // two nodes `anchors.zone` and `anchors.hand` are bound to.
  function layOut(container: HTMLElement) {
    const you = container.querySelector('[data-testid="board-you"]') as HTMLElement
    const zoneWrap = you.children[0]
    const handWrap = you.children[1]
    measure(zoneWrap, Zone)
    measure(handWrap, Fan)
    // Hand's own root, the one its band is measured off
    measure(handWrap.firstElementChild, Fan)
    return { zoneWrap, handWrap }
  }

  function slotNode(container: HTMLElement, key: SlotKey): HTMLElement {
    const you = container.querySelector('[data-testid="board-you"]') as HTMLElement
    const zone = you.children[0].firstElementChild as HTMLElement
    return zone.children[SLOT_ORDER.indexOf(key)] as HTMLElement
  }

  // What a fan slot reads as — `Hand` puts the full state (including its own
  // `disabled` dim, which never reaches `Card`) on the dim wrapper.
  function handStateAt(index: number): string | null {
    const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
    return slot?.querySelector<HTMLElement>('[data-state]')?.getAttribute('data-state') ?? null
  }

  // Drags a card out of the fan and lets go at (x, y) — the same drag contract
  // boardDefense.test.tsx's own `pullCardFromFan` uses (down, past the 6px
  // threshold, up), with the release point under this suite's control because the
  // drop rule is what is being pinned.
  async function playFromHand(index: number, at: { x: number; y: number }) {
    const slot = document.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
    fireEvent.mouseDown(slot, { clientX: 500, clientY: 900 })
    fireEvent.mouseMove(window, { clientX: at.x, clientY: at.y })
    fireEvent.mouseUp(window, { clientX: at.x, clientY: at.y })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600))
    })
  }

  // Drags a card out of your own release zone and lets go at (x, y) —
  // `useZonePull`'s own contract (down on the slot, up anywhere on the window).
  async function dragSlotToTable(
    container: HTMLElement,
    key: SlotKey,
    at: { x: number; y: number },
  ) {
    fireEvent.mouseDown(slotNode(container, key), { clientX: 420, clientY: 620 })
    fireEvent.mouseUp(window, { clientX: at.x, clientY: at.y })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600))
    })
  }

  // A press, in the browser's own order. `fireEvent.click` dispatches NO
  // mousedown, and a zone slot's gesture is a pointer-down — the same lesson
  // boardDefense.test.tsx records for its own decline test, where a comment
  // rested on a listener the test never fired.
  function pressSlot(container: HTMLElement, key: SlotKey) {
    const el = slotNode(container, key)
    fireEvent.mouseDown(el, { clientX: 420, clientY: 620 })
    fireEvent.mouseUp(el, { clientX: 420, clientY: 620 })
    fireEvent.click(el)
  }

  // A rejection naming our own choice — the real shape a rejected RESOLVE carries
  // (`packages/engine/src/fake/core.ts`'s `reject()` logs the whole Action, so
  // the identity lives inside `action.choice`).
  function rejectedNeutralize(method: string, uid?: string): Event {
    return {
      id: 9,
      type: 'rejected',
      action: {
        type: 'RESOLVE',
        player: 'you',
        choice: { kind, method, card: uid },
        at: 0,
      },
      reason: 'illegal',
    } as Event
  }

  it('offers only the methods the pending names', () => {
    const { container } = render(
      withAlarm({ methods: ['debugger'], hand: ['protection-debugger', 'attack-bug'] }),
    )
    layOut(container)
    // the Debugger lights, everything else greys out — Hand's own dim
    expect(handStateAt(0)).toBe('playable')
    expect(handStateAt(1)).toBe('disabled')
  })

  it('answers with a Debugger dropped on the table', async () => {
    const onResolve = vi.fn()
    const { container } = render(
      withAlarm({ methods: ['debugger'], hand: ['protection-debugger'] }, { onResolve }),
    )
    layOut(container)
    await playFromHand(0, { x: 640, y: 200 }) // the middle of the table
    expect(onResolve).toHaveBeenCalledWith({ kind, method: 'debugger' })
    // and it stands, landed, where the answer goes
    expect(screen.getByTestId('board-cover-staged')).toBeTruthy()
    expect(document.querySelectorAll('[data-hand-slot]')).toHaveLength(0)
  })

  it('gives the card back when it is dropped over your own area', async () => {
    const onResolve = vi.fn()
    const { container } = render(
      withAlarm({ methods: ['debugger'], hand: ['protection-debugger'] }, { onResolve }),
    )
    layOut(container)
    // "The whole table accepts the drop; only the player's own area gives the
    // card back" — dropping it over the release zone reads as changing your mind.
    // (Dropping it back into the FAN never reaches the rule at all: that is a
    // reorder, and `Hand` settles it home itself.)
    await playFromHand(0, { x: 640, y: 660 })
    expect(onResolve).not.toHaveBeenCalled()
    expect(screen.queryByTestId('board-cover-staged')).toBeNull()
  })

  it('names the release a sacrifice burns', async () => {
    const onResolve = vi.fn()
    const { container } = render(
      withAlarm(
        {
          methods: ['sacrifice'],
          release: { frontend: 'release-frontend' },
          releaseUid: { frontend: 'release-frontend#3' },
        },
        { onResolve },
      ),
    )
    layOut(container)
    await dragSlotToTable(container, 'frontend', { x: 640, y: 200 })
    expect(onResolve).toHaveBeenCalledWith({
      kind,
      method: 'sacrifice',
      card: 'release-frontend#3',
    })
    expect(screen.getByTestId('board-cover-staged')).toBeTruthy()
  })

  it('answers with Monitoring on a press, and moves nothing', () => {
    const onResolve = vi.fn()
    const { container } = render(
      withAlarm(
        { methods: ['monitoring'], release: { monitoring: 'protection-monitoring' } },
        { onResolve },
      ),
    )
    layOut(container)
    pressSlot(container, 'monitoring')
    expect(onResolve).toHaveBeenCalledWith({ kind, method: 'monitoring' })
    // it never leaves the zone: nothing is staged at the cover slot, and the slot
    // still shows its own card
    expect(screen.queryByTestId('board-cover-staged')).toBeNull()
    expect(slotNode(container, 'monitoring').querySelector('[data-card]')).toBeTruthy()
  })

  it('does not light a slot the pending does not offer', async () => {
    const onResolve = vi.fn()
    const { container } = render(
      withAlarm(
        {
          methods: ['debugger'],
          release: { frontend: 'release-frontend' },
          releaseUid: { frontend: 'release-frontend#3' },
          hand: ['protection-debugger'],
        },
        { onResolve },
      ),
    )
    layOut(container)
    // sacrifice is not on offer, so the release is not grabbable
    await dragSlotToTable(container, 'frontend', { x: 640, y: 200 })
    expect(onResolve).not.toHaveBeenCalled()
    expect(screen.queryByTestId('board-cover-staged')).toBeNull()
  })

  it('shows no method panel over the threat', () => {
    const { container } = render(
      withAlarm({ methods: ['debugger'], hand: ['protection-debugger'] }),
    )
    layOut(container)
    // the gesture IS the answer; the generic panel covered the very cards it
    // was asking about (the same reason it was suppressed for `defend`)
    expect(screen.queryByTestId('pending-prompt')).toBeNull()
    // …and the alarm stands at the centre with nothing over it
    if (kind === 'neutralize503') expect(screen.getByTestId('board-centre-alarm')).toBeTruthy()
    else expect(screen.queryByTestId('board-centre-alarm')).toBeNull()
  })

  it('says what the alarm is waiting for', () => {
    const { copy } = makeBoardProps()
    const { container } = render(
      withAlarm({ methods: ['debugger'], hand: ['protection-debugger'] }),
    )
    layOut(container)
    const ask = screen.getByTestId('board-ask')
    expect(ask.getAttribute('data-shown')).toBe('true')
    expect(ask.textContent).toContain(copy.table.askNeutralize)
  })

  it('goes quiet once an answer has gone out', async () => {
    const { container } = render(
      withAlarm({ methods: ['debugger'], hand: ['protection-debugger'] }),
    )
    layOut(container)
    await playFromHand(0, { x: 640, y: 200 })
    expect(screen.getByTestId('board-ask').getAttribute('data-shown')).toBe('false')
  })

  it('a rejected Debugger comes back to the fan', async () => {
    const onResolve = vi.fn()
    const { container, rerender } = render(
      withAlarm({ methods: ['debugger'], hand: ['protection-debugger'] }, { onResolve }),
    )
    layOut(container)
    await playFromHand(0, { x: 640, y: 200 })
    expect(onResolve).toHaveBeenCalledWith({ kind, method: 'debugger' })

    rerender(
      withAlarm({ methods: ['debugger'], hand: ['protection-debugger'] }, { onResolve }, [
        rejectedNeutralize('debugger'),
      ]),
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900))
    })
    expect(document.querySelectorAll('[data-hand-slot]')).toHaveLength(1)
    expect(screen.queryByTestId('board-cover-staged')).toBeNull()
  })

  it('a non-primary press on the Monitoring slot dispatches nothing', () => {
    const onResolve = vi.fn()
    const { container } = render(
      withAlarm(
        { methods: ['monitoring'], release: { monitoring: 'protection-monitoring' } },
        { onResolve },
      ),
    )
    layOut(container)
    const el = slotNode(container, 'monitoring')
    // a right-press: identical position, wrong button — must not commit the
    // irreversible answer (unlike a Release slot, which merely starts a drag)
    fireEvent.mouseDown(el, { clientX: 420, clientY: 620, button: 2 })
    fireEvent.mouseUp(el, { clientX: 420, clientY: 620, button: 2 })
    expect(onResolve).not.toHaveBeenCalled()
    expect(screen.queryByTestId('board-cover-staged')).toBeNull()
    expect(slotNode(container, 'monitoring').querySelector('[data-card]')).toBeTruthy()
  })

  it('does not light a Debugger in the fan when the pending excludes it', async () => {
    const onResolve = vi.fn()
    const { container } = render(
      withAlarm(
        {
          methods: ['monitoring'],
          hand: ['protection-debugger'],
          release: { monitoring: 'protection-monitoring' },
        },
        { onResolve },
      ),
    )
    layOut(container)
    // the fan half of "what lights is exactly what can be taken" — a pending
    // that does not name `debugger` must not light the Debugger in the hand
    expect(handStateAt(0)).toBe('disabled')
    await playFromHand(0, { x: 640, y: 200 })
    expect(onResolve).not.toHaveBeenCalled()
    expect(screen.queryByTestId('board-cover-staged')).toBeNull()
  })

  it('does not answer a press on Monitoring when the pending excludes it', () => {
    const onResolve = vi.fn()
    const { container } = render(
      withAlarm(
        {
          methods: ['debugger'],
          release: { monitoring: 'protection-monitoring' },
          hand: ['protection-debugger'],
        },
        { onResolve },
      ),
    )
    layOut(container)
    // the Monitoring branch of `grabbable` must also read `methods` — a pending
    // that does not offer `monitoring` must not let a press on it through
    pressSlot(container, 'monitoring')
    expect(onResolve).not.toHaveBeenCalled()
    expect(slotNode(container, 'monitoring').querySelector('[data-card]')).toBeTruthy()
  })

  it('a rejected sacrifice goes back to its own slot', async () => {
    const onResolve = vi.fn()
    const state: Over = {
      methods: ['sacrifice'],
      release: { frontend: 'release-frontend' },
      releaseUid: { frontend: 'release-frontend#3' },
    }
    const { container, rerender } = render(withAlarm(state, { onResolve }))
    layOut(container)
    await dragSlotToTable(container, 'frontend', { x: 640, y: 200 })
    // while the answer stands at the centre the slot shows its empty place —
    // the card is not in two places at once
    expect(slotNode(container, 'frontend').querySelector('[data-card]')).toBeNull()

    rerender(
      withAlarm(state, { onResolve }, [rejectedNeutralize('sacrifice', 'release-frontend#3')]),
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900))
    })
    layOut(container)
    expect(screen.queryByTestId('board-cover-staged')).toBeNull()
    expect(slotNode(container, 'frontend').querySelector('[data-card]')).toBeTruthy()
  })

  // `release()` hands the cover slot to the beat — it does NOT end the play.
  // While the beat runs the board renders its shadow, the projection from BEFORE
  // the batch, whose `you.hand` still holds the answer that was played. If the
  // staging were cleared here the fan would stop filtering and the played card
  // would reappear beside its own copy flying to the discard — the duplicate a
  // player reported on the defence path, whose fix this mirrors.
  it('keeps the played answer out of the fan after the beat takes it over', () => {
    const onResolve = vi.fn()
    const base = makeBoardProps()
    const state = {
      ...base.state,
      you: {
        ...base.state.you,
        hand: [
          { uid: 'protection-debugger#0', card: card('protection-debugger') },
          { uid: 'attack-bug#1', card: card('attack-bug') },
        ],
      },
      playable: [],
      pending: {
        player: base.state.selfId,
        ...(kind === 'neutralize503'
          ? { kind: 'neutralize503' as const, card: 'trigger-error-503' }
          : { kind: 'crush' as const, slot: 'frontend' as const, source: 'ai-crush-frontend' }),
        methods: ['debugger' as const],
      },
    }
    const { result } = renderHook(() => {
      const anchors = useBoardAnchors()
      return useNeutralizeStaging({
        state,
        anchors,
        actions: { onResolve } as TableActions,
        events: [],
        enabled: true,
      })
    })

    act(() => {
      result.current.onHandPlay('protection-debugger#0', {
        x: 640,
        y: 100,
        rect: { left: 0, top: 0, width: 150, height: 210 } as DOMRect,
      })
    })
    expect(onResolve).toHaveBeenCalled()
    expect(result.current.handItems.map((i) => i.uid)).toEqual(['attack-bug#1'])

    // the beat takes the exchange over
    act(() => {
      result.current.release()
    })

    // the cover slot is handed back…
    expect(result.current.staged?.handed).toBe(true)
    // …and the card is STILL out of the fan, because the projection this hook is
    // reading has not taken it out of the hand yet
    expect(result.current.handItems.map((i) => i.uid)).toEqual(['attack-bug#1'])
  })
})
