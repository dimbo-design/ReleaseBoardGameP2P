import { expect, it } from 'vitest'
import { FOLLOW_SLACK, followTail } from './followTail'

const el = (over: Partial<{ scrollTop: number; scrollHeight: number; clientHeight: number }>) =>
  ({ scrollTop: 0, scrollHeight: 500, clientHeight: 100, ...over }) as HTMLElement

it('jumps to the bottom when the reader is already at the tail', () => {
  const node = el({ scrollTop: 400 })
  followTail(node)
  expect(node.scrollTop).toBe(500)
})

// A reader who has scrolled up is reading. A panel that yanks itself away from
// them is worse than one that does not follow at all.
it('leaves a reader who has scrolled up exactly where they are', () => {
  const node = el({ scrollTop: 20 })
  followTail(node)
  expect(node.scrollTop).toBe(20)
})

it('treats a near-miss within the slack as the tail', () => {
  const node = el({ scrollTop: 400 - (FOLLOW_SLACK - 1) })
  followTail(node)
  expect(node.scrollTop).toBe(500)
})

it('does nothing when there is nothing to scroll', () => {
  const node = el({ scrollHeight: 100, clientHeight: 100 })
  followTail(node)
  expect(node.scrollTop).toBe(100)
})
