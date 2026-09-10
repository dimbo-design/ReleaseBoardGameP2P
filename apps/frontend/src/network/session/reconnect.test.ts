import { backoffMs, MAX_RECONNECT_ATTEMPTS } from './reconnect'

it('backs off further with each attempt', () => {
  expect(backoffMs(1)).toBeLessThan(backoffMs(2))
  expect(backoffMs(2)).toBeLessThan(backoffMs(3))
})

it('caps the wait so a long outage does not stall for minutes', () => {
  expect(backoffMs(MAX_RECONNECT_ATTEMPTS)).toBeLessThanOrEqual(8_000)
})
