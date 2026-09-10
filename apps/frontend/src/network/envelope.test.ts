import { createEnvelope, nextSeq, parseEnvelope } from './envelope'
import type { Intent, Message, WireMessage } from './types'

const joinMsg: Message = {
  type: 'JOIN_REQUEST',
  payload: { name: 'Ann', clientId: 'client-ann' },
}

it('wraps a message into an envelope with from + seq', () => {
  const env = createEnvelope(joinMsg, 'peer-1', 7)
  expect(env).toEqual({
    type: 'JOIN_REQUEST',
    payload: { name: 'Ann', clientId: 'client-ann' },
    from: 'peer-1',
    seq: 7,
  })
})

it('round-trips through serialize/parse', () => {
  const env = createEnvelope(joinMsg, 'peer-1', 7)
  const parsed = parseEnvelope(JSON.stringify(env))
  expect(parsed).toEqual(env)
})

it('throws on malformed input', () => {
  expect(() => parseEnvelope('not json')).toThrow()
  expect(() => parseEnvelope('{"payload":{}}')).toThrow(/type/)
})

it('nextSeq increases monotonically', () => {
  const a = nextSeq()
  const b = nextSeq()
  expect(b).toBeGreaterThan(a)
})

it('round-trips an INTENT carrying an engine action', () => {
  const intent: Intent = { type: 'PLAY', card: 'release-frontend#0' }
  const frame = createEnvelope({ type: 'INTENT', payload: { intent } }, 'peer-a', 7)
  const parsed = parseEnvelope(JSON.stringify(frame))

  expect(parsed.type).toBe('INTENT')
  expect(parsed.from).toBe('peer-a')
  expect((parsed as Extract<WireMessage, { type: 'INTENT' }>).payload.intent).toEqual(intent)
})
