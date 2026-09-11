import { parseRoomCode } from '../useLobby'
import { createLoopbackTransport, SOLO_PEER_ID } from './loopback'

it('is addressable and connected to nobody', () => {
  const t = createLoopbackTransport()
  expect(t.id).toBe(SOLO_PEER_ID)
  expect(t.connectedIds()).toEqual([])
})

// The room code IS the host's peer id, so a synthetic address that could also
// be typed into the join field would be a collision waiting to happen. The
// colon is what keeps this outside ROOM_CODE_ALPHABET, which has none.
it('cannot be reached by anyone typing a room code', () => {
  expect(parseRoomCode(SOLO_PEER_ID)).not.toBe(SOLO_PEER_ID)
})

it('swallows every send rather than throwing', () => {
  const t = createLoopbackTransport()
  expect(() => {
    t.connectTo('whoever')
    t.send('whoever', { type: 'PLAYER_READY', payload: {} })
    t.broadcast({ type: 'PLAYER_READY', payload: {} })
    t.relay(['whoever'], { type: 'PLAYER_READY', from: 'x', seq: 1, payload: {} })
    t.close()
  }).not.toThrow()
})
