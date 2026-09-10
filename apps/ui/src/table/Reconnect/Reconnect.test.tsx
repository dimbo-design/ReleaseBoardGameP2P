import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import Reconnect from './Reconnect'

const copy = {
  label: 'reconnecting…',
  retry: 'reconnect',
  leave: 'leave',
  confirmLeave: 'confirm',
  cancel: 'cancel',
  abortPrompt: '> abort session?',
}

it('shows the real room code, not a placeholder', () => {
  render(
    <Reconnect
      copy={copy}
      host="4F2A-9K"
      attempt={2}
      maxAttempts={5}
      status="trying"
      onRetry={() => {}}
      onLeave={() => {}}
    />,
  )
  expect(screen.getByText('4F2A-9K')).toBeTruthy()
  expect(screen.queryByText('ABC-DEF')).toBeNull()
})

it('reports which attempt is in flight', () => {
  render(
    <Reconnect
      copy={copy}
      host="4F2A-9K"
      attempt={3}
      maxAttempts={5}
      status="trying"
      onRetry={() => {}}
      onLeave={() => {}}
    />,
  )
  expect(screen.getByText(/3\/5/)).toBeTruthy()
})

// The prototype's confirm button only closed its own prompt — it never left.
it('confirming the abort actually leaves', () => {
  const onLeave = vi.fn()
  render(
    <Reconnect
      copy={copy}
      host="4F2A-9K"
      attempt={5}
      maxAttempts={5}
      status="failed"
      onRetry={() => {}}
      onLeave={onLeave}
    />,
  )
  fireEvent.click(screen.getByText('leave'))
  fireEvent.click(screen.getByText('confirm'))
  expect(onLeave).toHaveBeenCalledTimes(1)
})

it('retrying asks the session for another run', () => {
  const onRetry = vi.fn()
  render(
    <Reconnect
      copy={copy}
      host="4F2A-9K"
      attempt={5}
      maxAttempts={5}
      status="failed"
      onRetry={onRetry}
      onLeave={() => {}}
    />,
  )
  fireEvent.click(screen.getByText('reconnect'))
  expect(onRetry).toHaveBeenCalledTimes(1)
})
