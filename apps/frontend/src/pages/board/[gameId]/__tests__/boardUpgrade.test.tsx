// THE CENTRE A SYSTEM UPGRADE FILLS (#108). `systemUpgrade` is the first
// pending owed to several seats at once, so one surface has to answer three
// different questions depending on where this seat stands in it: being asked,
// having answered, or (under sudo, once the roster has drained) picking from
// what everyone threw.
//
// Nothing here is private — the rules put the thrown cards face up at the
// centre — so the standing cards come straight off the projection and no beat
// has to hold them across a batch boundary.
import { cardById } from '@release/ui'
import { act, fireEvent, isInaccessible, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BoardAnchors, BoardState } from '~/entities/game/board'
import { mockReducedMotion } from '~/test/reducedMotion'
import Board from '../_Board'
import { useUpgradeStaging } from '../_useUpgradeStaging'
import { makeBoardProps } from './fixture'

const card = (id: string) => {
  const data = cardById(id)
  if (!data) throw new Error(`no such card: ${id}`)
  return data
}

const upgradePending = (over: Record<string, unknown> = {}) => ({
  kind: 'systemUpgrade' as const,
  actor: 'p2',
  owed: ['you'],
  thrown: [] as { player: string; card: { uid: string; id: string } }[],
  sudo: false,
  phase: 'discarding' as const,
  source: 'operation-system-upgrade',
  ...over,
})

function renderBoard(over: {
  pending: ReturnType<typeof upgradePending>
  hand?: { uid: string; card: ReturnType<typeof card> }[]
  actions?: object
}) {
  const base = makeBoardProps()
  return render(
    <Board
      {...makeBoardProps({
        state: {
          ...base.state,
          pending: over.pending,
          ...(over.hand ? { you: { ...base.state.you, hand: over.hand } } : {}),
        },
        actions: over.actions,
      })}
    />,
  )
}

describe('the centre a System Upgrade fills', () => {
  it('discards by pulling from the real hand without a duplicate picker', async () => {
    const onResolve = vi.fn()
    renderBoard({
      pending: upgradePending(),
      hand: [{ uid: 'h1', card: card('attack-bug') }],
      actions: { onResolve },
    })
    expect(screen.queryByTestId('upgrade-hand-h1')).toBeNull()
    const prompt = screen.getByRole('status')
    expect(prompt.textContent).toBe(makeBoardProps().copy.table.upgradePrompt)
    expect(isInaccessible(prompt)).toBe(false)
    expect(prompt.getAttribute('data-shown')).toBe('true')
    expect(screen.queryByRole('button', { name: /confirm|подтвердить/i })).toBeNull()
    const slot = document.querySelector('[data-hand-slot]')
    if (!slot) throw new Error('missing hand slot')
    fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
    fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
    await vi.waitFor(() =>
      expect(onResolve).toHaveBeenCalledWith({ kind: 'upgradeDiscard', card: 'h1' }),
    )
  })

  it('asks this seat for nothing once it has answered', () => {
    renderBoard({
      pending: upgradePending({
        owed: ['p3'],
        thrown: [{ player: 'you', card: { uid: 'h1', id: 'attack-bug' } }],
      }),
    })
    expect(screen.queryByTestId('board-upgrade-ask')).toBeNull()
    const prompt = screen.getByRole('status')
    expect(prompt.textContent).toBe(makeBoardProps().copy.table.upgradeWaiting)
    expect(isInaccessible(prompt)).toBe(false)
    expect(prompt.getAttribute('data-shown')).toBe('true')
    // The thrown card stands at the centre for everyone, from the projection —
    // no beat is holding it.
    expect(screen.getByTestId('upgrade-thrown-h1')).not.toBeNull()
  })

  it('offers the actor a pick, and only the thrown cards', () => {
    const onResolve = vi.fn()
    renderBoard({
      pending: upgradePending({
        actor: 'you',
        owed: [],
        sudo: true,
        phase: 'picking',
        thrown: [
          { player: 'p2', card: { uid: 't1', id: 'attack-bug' } },
          { player: 'p3', card: { uid: 't2', id: 'defense-hotfix' } },
        ],
      }),
      actions: { onResolve },
    })
    fireEvent.click(screen.getByTestId('upgrade-thrown-t2'))
    fireEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
    expect(onResolve).toHaveBeenCalledWith({ kind: 'upgradeTake', card: 't2' })
  })
})

function stagingProbe() {
  const root = document.createElement('div')
  const centre = document.createElement('div')
  const slot = document.createElement('div')
  slot.dataset.upgradeSlot = 'you'
  root.append(centre, slot)
  const base = makeBoardProps().state
  const onResolve = vi.fn()
  const args: Parameters<typeof useUpgradeStaging>[0] = {
    state: {
      ...base,
      pending: upgradePending(),
      you: { ...base.you, hand: [{ uid: 'h1', card: card('attack-bug') }] },
    },
    anchors: { centre: { current: centre } } as BoardAnchors,
    actions: { onResolve },
    events: [] as import('@release/engine').Event[],
    copy: { prompt: '', waiting: '', takePrompt: '', confirm: '' },
    enabled: true,
  }
  return { args, onResolve }
}

it('does not send a delayed discard after the pending is removed or the hook unmounts', async () => {
  vi.useFakeTimers()
  try {
    for (const unmount of [false, true]) {
      const { args, onResolve } = stagingProbe()
      const hook = renderHook((props) => useUpgradeStaging(props), { initialProps: args })
      act(() => {
        hook.result.current.onHandPlay('h1', {
          rect: { left: 0, top: 0, width: 150, height: 210 },
        } as import('@release/ui').HandPlayDrop)
      })
      if (unmount) hook.unmount()
      else hook.rerender({ ...args, state: { ...args.state, pending: null } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(onResolve).not.toHaveBeenCalled()
      hook.unmount()
    }
  } finally {
    vi.useRealTimers()
  }
})

it('restores a rejected card and permits a new attempt without replaying the old rejection', () => {
  const { args, onResolve } = stagingProbe()
  const hook = renderHook((props) => useUpgradeStaging(props), { initialProps: args })
  const drop = {} as import('@release/ui').HandPlayDrop
  act(() => {
    hook.result.current.onHandPlay('h1', drop)
  })
  const rejected = {
    id: 1,
    type: 'rejected',
    action: { type: 'RESOLVE', player: 'you', choice: { kind: 'upgradeDiscard', card: 'h1' } },
    reason: 'retry',
  } as import('@release/engine').Event
  hook.rerender({ ...args, events: [rejected] })
  expect(hook.result.current.handItems.map((c) => c.uid)).toEqual(['h1'])
  act(() => {
    hook.result.current.onHandPlay('h1', drop)
  })
  hook.rerender({ ...args, events: [rejected] })
  expect(onResolve).toHaveBeenCalledTimes(2)
  expect(hook.result.current.stagedUid).toBe('h1')
})

it('keeps a local pull when another seat answers during its flight', async () => {
  vi.useFakeTimers()
  try {
    const { args, onResolve } = stagingProbe()
    args.state.pending = upgradePending({ owed: ['you', 'p3'] })
    const hook = renderHook((props) => useUpgradeStaging(props), { initialProps: args })
    act(() => {
      hook.result.current.onHandPlay('h1', {
        rect: { left: 0, top: 0, width: 150, height: 210 },
      } as import('@release/ui').HandPlayDrop)
    })
    hook.rerender({
      ...args,
      state: {
        ...args.state,
        pending: upgradePending({
          owed: ['you'],
          thrown: [{ player: 'p3', card: { uid: 'other', id: 'defense-hotfix' } }],
        }),
      },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onResolve).toHaveBeenCalledExactlyOnceWith({ kind: 'upgradeDiscard', card: 'h1' })
    hook.unmount()
  } finally {
    vi.useRealTimers()
  }
})

it.each([
  'discard',
  'take',
] as const)('cleans up an accepted Upgrade %s with reduced motion', (choice) => {
  const motion = mockReducedMotion(true)
  const base = makeBoardProps()
  const onResolve = vi.fn()
  const kept = { uid: 'kept', card: card('defense-hotfix') }
  const given = { uid: 'given', card: card('attack-bug') }
  const before: BoardState = {
    ...base.state,
    you: { ...base.state.you, hand: choice === 'discard' ? [given, kept] : [kept] },
    pending:
      choice === 'discard'
        ? upgradePending()
        : {
            kind: 'systemUpgrade',
            actor: 'you',
            owed: [],
            thrown: [{ player: 'p2', card: { uid: given.uid, id: given.card.id } }],
            sudo: true,
            phase: 'picking',
            source: 'operation-system-upgrade',
          },
  }
  const board = render(<Board {...base} state={before} actions={{ onResolve }} />)
  const pull = () => {
    const slot = board.container.querySelector('[data-hand-slot]')
    if (!slot) throw new Error('missing real hand slot')
    fireEvent.mouseDown(slot, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: 0, clientY: -20 })
    fireEvent.mouseUp(window, { clientX: 0, clientY: -200 })
  }
  try {
    if (choice === 'discard') pull()
    else {
      fireEvent.click(screen.getByTestId('upgrade-thrown-given'))
      fireEvent.click(screen.getByRole('button', { name: /confirm|подтвердить/i }))
    }
    expect(onResolve).toHaveBeenCalledExactlyOnceWith({
      kind: choice === 'discard' ? 'upgradeDiscard' : 'upgradeTake',
      card: given.uid,
    })
    const accepted: BoardState = {
      ...before,
      pending: null,
      you: { ...before.you, hand: choice === 'discard' ? [kept] : [kept, given] },
    }
    board.rerender(<Board {...base} state={accepted} actions={{ onResolve }} />)
    expect(screen.queryByTestId('board-upgrade-ask')).toBeNull()
    expect(board.container.querySelector('[data-upgrade-slot]')).toBeNull()
    expect(board.container.querySelector('[data-testid^="upgrade-hand-"]')).toBeNull()
    expect(board.container.querySelectorAll('[class*="flyer"]')).toHaveLength(0)
    expect(board.container.querySelectorAll('[data-hand-slot]')).toHaveLength(
      accepted.you.hand.length,
    )
    // With no beat to call release(), the next real Upgrade must still accept a pull.
    board.rerender(
      <Board
        {...base}
        state={{ ...accepted, pending: upgradePending() }}
        actions={{ onResolve }}
      />,
    )
    pull()
    expect(onResolve).toHaveBeenCalledTimes(2)
    expect(onResolve.mock.lastCall?.[0]).toEqual({ kind: 'upgradeDiscard', card: kept.uid })
  } finally {
    board.unmount()
    motion.mockRestore()
  }
})

it('retains the animated local handoff until the accepted beat releases it', () => {
  const motion = mockReducedMotion(false)
  const { args } = stagingProbe()
  const hook = renderHook((props) => useUpgradeStaging(props), { initialProps: args })
  try {
    act(() => {
      hook.result.current.onHandPlay('h1', {} as import('@release/ui').HandPlayDrop)
    })
    hook.rerender({ ...args, state: { ...args.state, pending: null } })
    expect(hook.result.current.stagedUid).toBe('h1')
    act(() => hook.result.current.release())
    expect(hook.result.current.stagedUid).toBeNull()
  } finally {
    hook.unmount()
    motion.mockRestore()
  }
})
