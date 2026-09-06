import type { Tallies } from './tally'

export type PlayerId = string
// A catalogue id, e.g. 'release-frontend'. Resolves to art in apps/ui.
export type CardId = string
// A unique instance. The catalogue has qty 7 for Bug, so two Bugs in one hand
// must be distinguishable — for the Hand fan's key, for FLIP animations that
// need stable identity, and for "return THIS card" (Rollback).
export type CardUid = string

export type ReleaseSlot = 'frontend' | 'backend' | 'database'
export type NeutralizeMethod = 'debugger' | 'monitoring' | 'sacrifice'
// Mode selection, key -> chosen option value. Structurally identical to the UI's
// Setup, declared here so the engine imports nothing.
export type Setup = Record<string, string>

export interface CardInstance {
  uid: CardUid
  id: CardId
  // Set when this instance *is* a card from the events deck, standing on the
  // table. `id` is the plain catalogue card it stands in for, so it reads and
  // plays as an ordinary Monitoring or Release; `event` is the id it goes back
  // to the events deck as when it leaves the table (general.md §6.4). While it
  // stands there the events deck genuinely holds one card fewer.
  event?: CardId
}

export interface Released {
  card: CardInstance
  // Code Review lies "under" the release; they are played together and die together.
  codeReview?: CardInstance
}

export interface PlayerState {
  id: PlayerId
  name: string
  hand: CardInstance[]
  release: {
    frontend?: Released
    backend?: Released
    database?: Released
    // Monitoring / AI Monitoring — in the zone but not a Release.
    monitoring?: CardInstance
  }
  // DDoS returns a Release to hand and freezes that instance for one round:
  // "не может быть разыграна в следующем ходу" — it costs the holder their
  // whole next turn, so this thaws when that turn ends.
  frozen: CardUid[]
  // An attack card Rollback handed back to whoever threw it. "он не может
  // сыграть её повторно до своего следующего хода" — barred for the rest of the
  // exchange, playable again on their next turn, so this thaws when that turn
  // begins. A separate list precisely because the two thaw at different moments;
  // one list could only ever be right for one of them.
  replayLocked: CardUid[]
  // What this player was dealt FACE UP at setup — by the rules, the reserved
  // Debugger. Recorded rather than re-derived, because provenance and identity
  // are not the same question: with a deck holding fewer Debuggers than players
  // a seat gets five random cards, and a surplus Debugger can land first in that
  // hand without ever having been dealt openly. Reading "is hand[0] a Debugger?"
  // would announce that card to the whole table as face up when it is not.
  openedAtDeal: CardUid[]
}

export interface ReactionWindow {
  target: { player: PlayerId; slot: ReleaseSlot; card: CardUid }
  // 1 -> 15s, 2+ -> 10s. A repelled attack reopens the window at round + 1.
  round: number
  // The `at` of the action that opened this window — the other end of the
  // deadline span, so a countdown can be exact rather than assumed.
  openedAt: number
  deadline: number
  // Revocable: passing only means "fine, close early". A passer may still attack.
  passed: PlayerId[]
}

export type Pending =
  // `codeReview` survives the pause: the combo is declared when the release is
  // played, but the card only lands after the cost is paid.
  | { kind: 'discardForRelease'; player: PlayerId; release: CardUid; codeReview?: CardUid }
  | {
      kind: 'defend'
      player: PlayerId
      attacker: PlayerId
      attack: CardUid
      // The attacking card's catalogue id, carried rather than parsed back out of
      // the uid — nothing should depend on the uid's internal format.
      attackId: CardId
      sudo: boolean
      // The Sudo that rode the attack. Held HERE while the exchange is open —
      // like the attack card itself, which lives only on this pending — and
      // banked at resolution, so the discard pile never shows a half of a pair
      // the table still sees standing at the centre.
      combo?: CardInstance
      canDefendWith: CardUid[]
      // The `at` of the action that opened this pending — the other end of the
      // deadline span, so a countdown can be exact rather than assumed.
      openedAt: number
      deadline: number
      // 'release' answers a reaction window; 'hand' answers an attack on the
      // player's hand, where surviving means the theft simply does not happen.
      scope: 'release' | 'hand'
      // Security Bug only: the card type the attacker named.
      requested?: CardId
    }
  // The alarm waits here while its answer is chosen — out of the deck, in no
  // hand and no zone, exactly as a thrown attack waits on a `defend`. By the
  // rules it reaches the discard only once it has been neutralized, «вместе с
  // картой, которой нейтрализовали» (docs/rules/resolution.md), so holding it
  // is what lets both leave in one moment.
  //
  // `card` is null for the `ai-error-503` mimic: that card is an events-deck
  // one-off, already back in the events deck by the time this pending exists
  // (fireTrigger's trigger-ai branch, general.md §6.4) — never in the discard,
  // so there is nothing here for a neutralize answer to bank alongside it.
  | {
      kind: 'neutralize503'
      player: PlayerId
      card: CardInstance | null
      methods: NeutralizeMethod[]
      // The AI event card this prompt belongs to. Absent for a pending raised
      // by anything other than an AI card.
      source?: CardId
    }
  | {
      kind: 'crush'
      player: PlayerId
      slot: ReleaseSlot
      methods: NeutralizeMethod[]
      // The AI event card this prompt belongs to. Absent for a pending raised
      // by anything other than an AI card.
      source?: CardId
    }
  | { kind: 'requestCard'; player: PlayerId; target: PlayerId }
  | { kind: 'giveCard'; player: PlayerId; requested: CardId; attacker: PlayerId }
  // `endsTurn` false is Bad Vibe-Coding borrowing the prompt without the
  // consequence: the same "discard N" question, but the seat stays put.
  // Absent means the ordinary end-of-turn hand limit, which does end the turn.
  | {
      kind: 'handLimit'
      player: PlayerId
      excess: number
      endsTurn?: boolean
      // The AI event card this prompt belongs to. Absent for a pending raised
      // by anything other than an AI card.
      source?: CardId
    }
  // The options travel on the pending rather than opening the discard globally:
  // only discardTop/discardCount are ever public (project.ts) — the pile's
  // full contents are not — so an effect that reaches into it brings its own
  // private viewing surface for the player using it, gated behind `mine` in
  // pendingView (attacks.ts) like every other owner-only pending. `picks` is
  // min(sudo ? 2 : 1, options.length), which folds "the discard is empty or
  // short" into one expression instead of a guard at every step.
  | {
      kind: 'pickFromDiscard'
      player: PlayerId
      options: CardInstance[]
      picks: 1 | 2
      source: CardId
    }

export interface GameState {
  gameId: string
  seed: number
  rngCursor: number
  // Monotonic event id source. Events carry `id` and an optional `parent` so the
  // frontend can build MoveHistory's tree without inferring which events group.
  eventSeq: number

  seating: PlayerId[]
  players: Record<PlayerId, PlayerState>
  eliminated: PlayerId[]

  turn: {
    player: PlayerId
    index: number
    // Which piles this turn has drawn from. A boolean cannot say "two of three
    // piles are done", and under Base the obligation runs over every pile
    // (rules decisions answer 1). Whether it is satisfied is a question about
    // the mode, answered by `drawObligationMet`, not a flag stored here.
    drawnFrom: number[]
    releasesPlayed: number
    // The inactivity clock on the player on turn — app timing, not a rule
    // (docs/rules/README.md, "Что правилом НЕ является"). Restarted by every
    // committed action while the table idles on that player, absent while a
    // window, a pending or a running draw owns the wait — and before the
    // keeper's first CLOCK_STARTED, because createGame has no timestamp.
    // Both ends of the span, like the window's, so a countdown is exact.
    openedAt?: number
    deadline?: number
  }

  decks: {
    // An array of piles: Git Branch splits the draw deck 1 -> 2, and the
    // gitBranch mode axis changes how a split one is drawn from.
    main: CardInstance[][]
    events: CardInstance[]
    discard: CardInstance[]
  }

  // A draw in progress, as the remaining pile indices to draw from — one entry
  // per card still owed. A draw is one action carrying an interruptible
  // sequence (rules decisions answer 2): a trigger drawn partway through pauses
  // it, and resolving that trigger resumes it where it stopped.
  //
  // Indices rather than a count because the same sequence serves both shapes:
  // Good Vibe-Coding is two cards off pile 0 (`[0, 0]`), and the multi-pile
  // draw #61 slice A introduces is one card off each existing pile (`[0, 1, …]`).
  drawing: { player: PlayerId; piles: number[] } | null

  pending: Pending | null
  window: ReactionWindow | null

  setup: Setup
  // What the engine could not honour from the config it was handed. Both halves
  // used to vanish: an unrecognised mode value fell through to Base, and a deck
  // entry with no rules was filtered out — a caller handing over the full
  // catalogue got a smaller deck with nothing said about it.
  ignored: { cards: CardId[]; setup: string[] }
  // Per-seat counters for the results screen, folded from this game's own event
  // log (tally.ts). It lives in GameState rather than beside the keeper for two
  // reasons: every peer then reads one authority's numbers instead of counting a
  // log that visibleTo made different for each of them, and a keeper handover
  // carries it for free because KEEPER_STATE carries GameState.
  tally: Tallies
  over: { winner: PlayerId; condition: 'release' | 'lastStanding' } | null
}
