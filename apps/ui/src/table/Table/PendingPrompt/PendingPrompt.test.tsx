import { fireEvent, render } from '@testing-library/react'
import { vi } from 'vitest'
import { CARDS } from '@/cards'
import type { Card } from '@/cards/types'
import type { HandItem } from '@/table/Hand/Hand'
import type { TablePending } from '../intents'
import PendingPrompt, { type PendingPromptCopy } from './PendingPrompt'

const makeCard = (id: string): Card => ({
  id,
  name: id,
  category: 'attack',
  deck: 'base',
  art: '',
  tags: [],
  qty: 1,
})

const hand: HandItem[] = [
  { uid: 'c1', card: makeCard('attack-bug') },
  { uid: 'c2', card: makeCard('release-frontend') },
]

const copy: PendingPromptCopy = {
  confirm: 'Confirm',
  decline: 'Decline',
  discardForRelease: { prompt: 'Discard a card to fund the release', action: 'Discard' },
  defend: { prompt: 'Block the attack', action: 'Block' },
  neutralize503: { prompt: 'Neutralize the 503', action: 'Neutralize' },
  crush: { prompt: 'Crush the release', action: 'Crush' },
  requestCard: { prompt: 'Request a card', action: 'Request' },
  giveCard: { prompt: 'Give up a card', action: 'Give' },
  handLimit: { prompt: 'Discard down to the hand limit', action: 'Discard' },
  pickFromDiscard: { prompt: 'Pick a card from the discard', action: 'Pick' },
}

const defendPending: TablePending = {
  kind: 'defend',
  player: 'you',
  attacker: 'p2',
  attackCard: 'attack-bug',
  sudo: false,
  options: ['c1', 'c2'],
  openedAt: 0,
  deadline: 10_000,
  scope: 'hand',
}

it('resolves discardForRelease with the picked card', () => {
  const onResolve = vi.fn()
  const { getAllByRole, getByRole } = render(
    <PendingPrompt
      pending={{ kind: 'discardForRelease', player: 'you', options: ['c1', 'c2'] }}
      hand={[
        { uid: 'c1', card: { id: 'attack-bug' } as Card },
        { uid: 'c2', card: { id: 'release-frontend' } as Card },
      ]}
      copy={copy}
      onResolve={onResolve}
    />,
  )
  fireEvent.click(getAllByRole('option')[1])
  fireEvent.click(getByRole('button', { name: copy.confirm }))
  expect(onResolve).toHaveBeenCalledWith({ kind: 'discardForRelease', card: 'c2' })
})

it('lets you decline a defence explicitly', () => {
  const onResolve = vi.fn()
  const { getByRole } = render(
    <PendingPrompt pending={defendPending} hand={hand} copy={copy} onResolve={onResolve} />,
  )
  fireEvent.click(getByRole('button', { name: copy.decline }))
  expect(onResolve).toHaveBeenCalledWith({ kind: 'defend', card: null })
})

it('keeps confirm inert until a selection exists', () => {
  const { getByRole } = render(
    <PendingPrompt pending={defendPending} hand={hand} copy={copy} onResolve={vi.fn()} />,
  )
  expect(getByRole('button', { name: copy.confirm })).toHaveProperty('disabled', true)
})

it('resolves requestCard with a real catalogue card id, not a release slot', () => {
  // requestCard is a bluff, not a legal move (Choice.requestCard: CardId,
  // packages/engine/src/actions.ts:16-17) — the pending carries no `options`,
  // so the guess space is the kit's own catalogue. Asserting the resolved
  // `card` is an id CARDS actually knows is what makes it impossible to
  // regress back to a ReleaseSlotId ('frontend'/'backend'/'database'), which
  // typechecks (both are `string` in the kit's structural mirror) but is not
  // a value the engine's catalogue recognizes.
  const onResolve = vi.fn()
  const { getAllByRole, getByRole } = render(
    <PendingPrompt
      pending={{ kind: 'requestCard', player: 'you', target: 'p2' }}
      hand={hand}
      copy={copy}
      onResolve={onResolve}
    />,
  )
  fireEvent.click(getAllByRole('option')[0])
  fireEvent.click(getByRole('button', { name: copy.confirm }))
  expect(onResolve).toHaveBeenCalledTimes(1)
  const choice = onResolve.mock.calls[0][0]
  expect(choice.kind).toBe('requestCard')
  expect(CARDS.some((c) => c.id === choice.card)).toBe(true)
})

it('offers only cards that can actually be in a hand', () => {
  // The guess space is not the whole catalogue. Two groups can never be held,
  // and the rules say so outright rather than leaving it to be inferred:
  //   • triggers — docs/rules/cards.md:320 «Обе карты нельзя держать в руке»
  //     and :339 «В руку триггер не попадает ни на мгновение»; they resolve at
  //     the moment they are drawn.
  //   • the events deck — docs/rules/general.md:189, every one of its cards is
  //     "либо в колоде, либо на столе", so none of them passes through a hand.
  // Offering them makes a guess that cannot possibly hit look like a legal
  // one, which is worse than a missing option: nothing rejects it, the request
  // simply always misses.
  const { getAllByRole } = render(
    <PendingPrompt
      pending={{ kind: 'requestCard', player: 'you', target: 'p2' }}
      hand={hand}
      copy={copy}
      onResolve={vi.fn()}
    />,
  )
  const offered = getAllByRole('option').length
  const holdable = CARDS.filter((c) => c.deck === 'base' && c.category !== 'trigger')
  expect(offered).toBe(holdable.length)
  expect(offered).toBeLessThan(CARDS.length)
  expect(holdable.some((c) => c.category === 'trigger')).toBe(false)
  expect(holdable.some((c) => c.deck === 'ai')).toBe(false)
})

it('cannot resolve a stale selection once a new pending of the same kind/player drops it', () => {
  // The reset effect keys off `${pending.kind}:${pending.player}` — a second
  // pending of the *same* kind for the *same* player (a real shape once the
  // P2P layer lands: back-to-back same-kind-same-player sequences from a
  // remote authority) does not change that fingerprint, so the reset never
  // fires and `card` survives the re-render untouched. What must stop the
  // stale value from confirming is membership in the *current* pending's
  // `options`, not the reset — this test re-renders with a pending whose
  // options no longer include the earlier selection and asserts confirm
  // goes inert and nothing resolves.
  const onResolve = vi.fn()
  const handAll: HandItem[] = [
    { uid: 'c1', card: makeCard('attack-bug') },
    { uid: 'c2', card: makeCard('release-frontend') },
    { uid: 'c3', card: makeCard('release-backend') },
  ]
  const first: TablePending = { kind: 'discardForRelease', player: 'you', options: ['c1', 'c2'] }
  const second: TablePending = { kind: 'discardForRelease', player: 'you', options: ['c3'] }
  const { getAllByRole, getByRole, rerender } = render(
    <PendingPrompt pending={first} hand={handAll} copy={copy} onResolve={onResolve} />,
  )
  fireEvent.click(getAllByRole('option')[1]) // selects c2, offered by `first`

  rerender(<PendingPrompt pending={second} hand={handAll} copy={copy} onResolve={onResolve} />)

  const confirmBtn = getByRole('button', { name: copy.confirm })
  expect(confirmBtn).toHaveProperty('disabled', true)
  fireEvent.click(confirmBtn)
  expect(onResolve).not.toHaveBeenCalled()
})

it('resolves giveCard with the hand uid, never the requested catalogue id', () => {
  // giveCard sits on the same CardId/CardUid ambiguity that already produced
  // one shipped defect in this component (requestCard resolving a
  // ReleaseSlotId instead of a catalogue id) — a fixture where the requested
  // id and the matching hand uid are visibly different values is what makes
  // this assertion able to tell a correct resolve from a "simplified" one
  // that accidentally resolves `pending.requested` straight through.
  const onResolve = vi.fn()
  const requestedId = 'attack-security-bug'
  const uid = 'hand-slot-9'
  const { getByRole } = render(
    <PendingPrompt
      pending={{ kind: 'giveCard', player: 'you', requested: requestedId }}
      hand={[{ uid, card: makeCard(requestedId) }]}
      copy={copy}
      onResolve={onResolve}
    />,
  )
  fireEvent.click(getByRole('option'))
  fireEvent.click(getByRole('button', { name: copy.confirm }))
  expect(onResolve).toHaveBeenCalledWith({ kind: 'giveCard', card: uid })
  expect(onResolve.mock.calls[0][0].card).not.toBe(requestedId)
})

const discardOptions = [
  { uid: 'a#1', id: 'attack-bug' },
  { uid: 'b#1', id: 'release-frontend' },
]

it('offers every discard option and resolves the single pick', () => {
  const onResolve = vi.fn()
  const { getAllByRole, getByRole } = render(
    <PendingPrompt
      pending={{
        kind: 'pickFromDiscard',
        player: 'you',
        options: discardOptions,
        picks: 1,
        source: 'operation-git-cherry-pick',
      }}
      hand={[]}
      copy={copy}
      onResolve={onResolve}
    />,
  )
  // The cards were never in hand, so an option renderer resolving uids against
  // `hand` would render nothing at all here.
  const options = getAllByRole('option')
  expect(options).toHaveLength(2)
  fireEvent.click(options[0])
  fireEvent.click(getByRole('button', { name: copy.confirm }))
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'pickFromDiscard',
    card: 'a#1',
    toDeck: undefined,
  })
})

it('asks for the deck card only after the hand card, and resolves once with both', () => {
  const onResolve = vi.fn()
  const { getAllByRole, getByRole } = render(
    <PendingPrompt
      pending={{
        kind: 'pickFromDiscard',
        player: 'you',
        options: discardOptions,
        picks: 2,
        source: 'operation-git-cherry-pick',
      }}
      hand={[]}
      copy={copy}
      onResolve={onResolve}
    />,
  )
  const confirmBtn = getByRole('button', { name: copy.confirm })
  fireEvent.click(getAllByRole('option')[0]) // picks 'a#1'
  // Only one of the two owed picks made — confirm must stay inert.
  expect(confirmBtn).toHaveProperty('disabled', true)
  fireEvent.click(confirmBtn)
  expect(onResolve).not.toHaveBeenCalled()

  // The chosen card is removed from the option list (picked once already),
  // so the remaining option is the deck card.
  fireEvent.click(getAllByRole('option')[0]) // picks 'b#1'
  fireEvent.click(confirmBtn)
  expect(onResolve).toHaveBeenCalledTimes(1)
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'pickFromDiscard',
    card: 'a#1',
    toDeck: 'b#1',
  })
})

it('names the release a crush sacrifice burns', () => {
  // Regression for the bug this task exists to fix: `triggers.ts` refuses a
  // sacrifice with no `card` ('sacrifice needs a release card') — the panel
  // used to resolve `{ method: 'sacrifice' }` alone, which the engine always
  // rejected.
  const onResolve = vi.fn()
  const pending: TablePending = {
    kind: 'crush',
    player: 'you',
    slot: 'frontend',
    methods: ['sacrifice'],
  }
  const { getAllByRole, getByRole } = render(
    <PendingPrompt
      pending={pending}
      hand={[]}
      release={{ frontend: { uid: 'release-frontend#3', card: makeCard('release-frontend') } }}
      copy={copy}
      onResolve={onResolve}
    />,
  )
  // options[0] is the 'sacrifice' method itself; options[1] is the only
  // release on offer, once the method picks it into view.
  fireEvent.click(getAllByRole('option')[0])
  fireEvent.click(getAllByRole('option')[1])
  fireEvent.click(getByRole('button', { name: copy.confirm }))
  expect(onResolve).toHaveBeenCalledWith({
    kind: 'crush',
    method: 'sacrifice',
    card: 'release-frontend#3',
  })
})

it('will not confirm a crush sacrifice with no release picked', () => {
  const onResolve = vi.fn()
  const pending: TablePending = {
    kind: 'crush',
    player: 'you',
    slot: 'frontend',
    methods: ['sacrifice'],
  }
  const { getAllByRole, getByRole } = render(
    <PendingPrompt
      pending={pending}
      hand={[]}
      release={{ frontend: { uid: 'release-frontend#3', card: makeCard('release-frontend') } }}
      copy={copy}
      onResolve={onResolve}
    />,
  )
  fireEvent.click(getAllByRole('option')[0]) // picks the 'sacrifice' method, no release yet
  const confirmBtn = getByRole('button', { name: copy.confirm })
  expect(confirmBtn).toHaveProperty('disabled', true)
  fireEvent.click(confirmBtn)
  expect(onResolve).not.toHaveBeenCalled()
})

it('cannot resolve a stale discard pick once a new pickFromDiscard pending for the same player drops it', () => {
  // Same failure mode as the discardForRelease staleness test above, for the
  // new discardPicks state: a second pickFromDiscard pending for the same
  // player does not change the fingerprint, so the reset effect alone cannot
  // be trusted — membership against the current pending's options is what
  // must stop the stale pick from resolving.
  const onResolve = vi.fn()
  const first: TablePending = {
    kind: 'pickFromDiscard',
    player: 'you',
    options: discardOptions,
    picks: 1,
    source: 'operation-git-cherry-pick',
  }
  const second: TablePending = {
    kind: 'pickFromDiscard',
    player: 'you',
    options: [{ uid: 'c#1', id: 'release-backend' }],
    picks: 1,
    source: 'ai-inside',
  }
  const { getAllByRole, getByRole, rerender } = render(
    <PendingPrompt pending={first} hand={[]} copy={copy} onResolve={onResolve} />,
  )
  fireEvent.click(getAllByRole('option')[0]) // selects 'a#1', offered by `first`

  rerender(<PendingPrompt pending={second} hand={[]} copy={copy} onResolve={onResolve} />)

  const confirmBtn = getByRole('button', { name: copy.confirm })
  expect(confirmBtn).toHaveProperty('disabled', true)
  fireEvent.click(confirmBtn)
  expect(onResolve).not.toHaveBeenCalled()
})

it('drops a discard pick when the pending kind changes and later offers the same card again', () => {
  // The membership check cannot catch this one: the stale uid is legitimately
  // on offer the second time, so `complete` would be satisfied by a pick the
  // player never made in *this* pending. Only the fingerprint reset stops it,
  // and the fingerprint is `kind:player` — so it takes a change of kind, not
  // another pickFromDiscard, to exercise that reset at all.
  const onResolve = vi.fn()
  const picking: TablePending = {
    kind: 'pickFromDiscard',
    player: 'you',
    options: discardOptions,
    picks: 1,
    source: 'operation-git-cherry-pick',
  }
  const other: TablePending = {
    kind: 'neutralize503',
    player: 'you',
    card: 'trigger-error-503',
    methods: ['debugger'],
  }

  const { getAllByRole, getByRole, rerender } = render(
    <PendingPrompt pending={picking} hand={[]} copy={copy} onResolve={onResolve} />,
  )
  fireEvent.click(getAllByRole('option')[0]) // selects 'a#1'

  // Away and back: the same card is on offer again.
  rerender(<PendingPrompt pending={other} hand={[]} copy={copy} onResolve={onResolve} />)
  rerender(<PendingPrompt pending={picking} hand={[]} copy={copy} onResolve={onResolve} />)

  const confirmBtn = getByRole('button', { name: copy.confirm })
  expect(confirmBtn).toHaveProperty('disabled', true)
  fireEvent.click(confirmBtn)
  expect(onResolve).not.toHaveBeenCalled()
})
