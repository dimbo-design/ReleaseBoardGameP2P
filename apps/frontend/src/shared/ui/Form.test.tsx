import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import Form, { FormField } from './Form'

// Keep the real components (Input, etc.) and spy only on the shake. The two are
// separate entry points — `@release/ui` renders, `@release/ui/animations` moves
// — so the spy goes on the animation layer, which is the one Form calls.
const { playMock } = vi.hoisted(() => ({ playMock: vi.fn() }))
vi.mock('@release/ui/animations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@release/ui/animations')>()),
  play: playMock,
}))

it('shakes an empty required field on every submit attempt', () => {
  const onSubmit = vi.fn()
  render(
    <Form onSubmit={onSubmit}>
      <FormField name="code" required />
      <button type="submit">go</button>
    </Form>,
  )

  playMock.mockClear()
  fireEvent.click(screen.getByText('go'))
  expect(onSubmit).not.toHaveBeenCalled()
  expect(playMock).toHaveBeenCalledTimes(1)
  expect(playMock).toHaveBeenCalledWith('shake', expect.anything())

  // The bug: a second submit of the still-empty field must shake again.
  fireEvent.click(screen.getByText('go'))
  expect(playMock).toHaveBeenCalledTimes(2)
})

// A form with two submit buttons has to be able to say which one was pressed —
// standard HTML behaviour, and what the create/solo split below rides on.
it('reports the submitting button in the submitted data', () => {
  const onSubmit = vi.fn()
  render(
    <Form onSubmit={onSubmit}>
      <FormField name="name" value="Ann" onChange={() => {}} />
      <button type="submit" name="intent" value="lobby">
        lobby
      </button>
      <button type="submit" name="intent" value="solo">
        solo
      </button>
    </Form>,
  )
  fireEvent.click(screen.getByText('solo'))
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ intent: 'solo' }))
})

it('still validates required fields before reporting anything', () => {
  const onSubmit = vi.fn()
  render(
    <Form onSubmit={onSubmit} requiredMessage="Required">
      <FormField name="name" required value="" onChange={() => {}} />
      <button type="submit" name="intent" value="solo">
        solo
      </button>
    </Form>,
  )
  fireEvent.click(screen.getByText('solo'))
  expect(onSubmit).not.toHaveBeenCalled()
})
