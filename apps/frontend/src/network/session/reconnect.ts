// One reconnection run, as the session actually experiences it. The overlay
// renders these into terminal lines; nothing here is presentation, so the copy
// rules and the UI package's i18n-agnosticism are both untouched.
export interface ReconnectEvent {
  kind: 'dialing' | 'channel-open' | 'handshake' | 'backoff' | 'failed'
  attempt: number
  at: number
}

// Bounded, then the player chooses: the overlay reaches its failed state and
// keeps retry and leave live, rather than auto-abandoning a match whose wifi
// is about to come back.
export const MAX_RECONNECT_ATTEMPTS = 5

// Exponential with a ceiling. The cap matters more than the curve: a fifth
// attempt eight seconds out still feels like the app is trying, where
// thirty-two would read as hung.
export function backoffMs(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** (attempt - 1))
}
