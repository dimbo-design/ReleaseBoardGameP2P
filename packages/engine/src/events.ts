import type { Action } from './actions'
import type { CardId, NeutralizeMethod, PlayerId, ReleaseSlot } from './state'

export interface EventBase {
  id: number
  // The causing event's id, so the history tree needs no inference. What is
  // linked today, and nothing beyond it: an answer to an attack (`defended`,
  // `tookHit`) names the `attacked` it answered, and a `discarded` names what
  // spent the card — `eliminated`, `revealed`, `neutralized`, `aiRevealed`,
  // `tookHit`, `defended`, `monitoringDestroyed` or `releaseReturned`.
  //
  // Absent everywhere else, which is a statement about the emitters, not about
  // what could be linked. This comment once described an intent instead — that
  // an attack also names the release it targeted — and was read as behaviour
  // and built on for a whole task before anyone checked (#138). Add a link here
  // only after the emitter emits it.
  parent?: number
  // The audience, declared by the engine because only the rules know what is
  // secret. Absent means public. The future sync layer filters on this field.
  visibleTo?: PlayerId[]
}

export type Event = EventBase &
  // `open` names the cards dealt face up — by the rules the Debugger is dealt
  // openly, so it is public information, and the projection would otherwise
  // drop it. Absent or empty means the whole hand travelled closed (a deck
  // under-supplied with Debuggers deals some players five random cards; see
  // fake/setup.ts).
  (
    | { type: 'dealt'; player: PlayerId; count: number; open?: CardId[] }
    | { type: 'drawn'; player: PlayerId; card?: CardId; pile: number; deckSize: number }
    | { type: 'released'; player: PlayerId; slot: ReleaseSlot; card: CardId; codeReview?: CardId }
    | { type: 'placed'; player: PlayerId; card: CardId }
    | { type: 'discarded'; player: PlayerId; card: CardId; reason: DiscardReason }
    | { type: 'windowOpened'; player: PlayerId; slot: ReleaseSlot; round: number; deadline: number }
    | { type: 'windowClosed'; player: PlayerId; slot: ReleaseSlot }
    | { type: 'passed'; player: PlayerId }
    | { type: 'unpassed'; player: PlayerId }
    | { type: 'attacked'; attacker: PlayerId; card: CardId; sudo: boolean; target: PlayerId }
    | { type: 'defended'; player: PlayerId; card: CardId; effect: DefenceEffect }
    | { type: 'tookHit'; player: PlayerId }
    | { type: 'releaseDestroyed'; player: PlayerId; slot: ReleaseSlot; card: CardId }
    | { type: 'releaseStolen'; from: PlayerId; to: PlayerId; slot: ReleaseSlot; card: CardId }
    | { type: 'releaseReturned'; player: PlayerId; slot: ReleaseSlot; card: CardId }
    | { type: 'monitoringDestroyed'; player: PlayerId; card: CardId }
    | { type: 'handTransfer'; from: PlayerId; to: PlayerId; card?: CardId }
    | { type: 'requested'; attacker: PlayerId; target: PlayerId; card: CardId; hit: boolean }
    | { type: 'revealed'; player: PlayerId; card: CardId }
    | { type: 'aiRevealed'; player: PlayerId; aiCard: CardId; eventCard: CardId }
    | { type: 'neutralized'; player: PlayerId; method: NeutralizeMethod }
    | { type: 'eliminated'; player: PlayerId }
    | { type: 'turnStarted'; player: PlayerId; index: number }
    | { type: 'turnEnded'; player: PlayerId }
    | { type: 'gameOver'; winner: PlayerId; condition: 'release' | 'lastStanding' }
    | { type: 'rejected'; action: Action; reason: string }
    | { type: 'takenFromDiscard'; player: PlayerId; card: CardId; to: 'hand' | 'deck' }
    // Belongs to no player: the table recycles its own discard, and the count
    // is the only detail worth showing — the cards themselves were public on
    // the way in and are secret again on the way out.
    | { type: 'deckReshuffled'; cards: number }
    // Git Branch, Git Merge, or a pile running out. Carries the resulting pile
    // sizes because that is the whole visible effect — the cards themselves are
    // face down before and after.
    | { type: 'pilesChanged'; piles: number[] }
  )

export type DiscardReason =
  | 'releaseCost'
  | 'handLimit'
  | 'attackSpent'
  | 'defenceSpent'
  | 'destroyed'
  | 'neutralized'
  | 'trigger'
  | 'effect'

export type DefenceEffect = 'cancel' | 'return' | 'reflect' | 'take'

export type EventType = Event['type']
