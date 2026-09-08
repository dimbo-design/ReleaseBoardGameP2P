import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import MoveHistory from './MoveHistory'

const copy = { draw: 'draw', eliminated: 'is out' }

// The badge used to key off `kind === 'добор'` — a Russian literal from the
// mock era, which a translated `kind` can never match. The kit is
// i18n-agnostic, so the flag is the contract.
it('badges a row the caller marked as a draw, whatever its kind reads', () => {
  const { getByText } = render(
    <MoveHistory
      copy={copy}
      entries={[{ id: 1, who: 'you', kind: 'Draw', card: 'Bug', draw: true }]}
    />,
  )
  expect(getByText('draw')).toBeTruthy()
})
