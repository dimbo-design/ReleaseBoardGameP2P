// The lobby entity is an adapter over the fixed network/ transport segment.
// Pages and features depend on this, not on network/ directly.

export type { ErrorKind, PeerInfo, ReconnectEvent, ReconnectState, Role, UseLobby } from '~/network'
export { MAX_RECONNECT_ATTEMPTS, useLobby } from '~/network'
