// Forked from apps/ui/src/table/Table/types.ts (2026-08-11, #89).
//
// The board screen lives here now because the deal intro animates into the real
// Hand's DOM, which a component in another package cannot expose. @release/ui's
// Table keeps its copy and keeps serving the playground's TableStory — so the
// two will drift, and contract.test-d.ts is what makes the drift a compile
// error instead of a misrender.

import type { Event, PlayerView } from '@release/engine'
import type {
  CardData,
  DockView,
  GameModesCopy,
  GameOverCopy,
  HandItem,
  HeapCard,
  HistoryEntry,
  LobbyCodeCopy,
  MoveHistoryCopy,
  Participant,
  ParticipantsCopy,
  PauseGameCopy,
  PausePlayer,
  PendingPromptCopy,
  ReconnectCopy,
  ReleaseSlots,
  ReleaseSupport,
  RulesCopy,
  SeatCopy,
  Setup,
  Spectator,
  SwitchLang,
  TableActions,
  TablePending,
  TableTarget,
  TableWindow,
  TurnDockCopy,
  WindowCopy,
} from '@release/ui'
import type { ReactNode } from 'react'

export type Panel = 'settings' | 'history' | 'participants' | 'rules' | 'modes'

export interface BoardOpponent {
  id: string
  name: string
  handCount: number
  release: ReleaseSlots
  // A played Code Review lying under the release it protects.
  support?: ReleaseSupport
  eliminated?: boolean
  // Which of this opponent's release slots is a standing AI card wearing an
  // ordinary id, keyed to its events-deck id — see `you.releaseEvent` below.
  releaseEvent?: Partial<Record<'frontend' | 'backend' | 'database' | 'monitoring', string>>
}

// Everything the engine's projection can answer. Assembled by the consumer's
// adapter; nothing here is room- or session-shaped.
export interface BoardState {
  you: {
    name: string
    hand: HandItem[]
    release: ReleaseSlots
    // A played Code Review lying under the release it protects.
    support?: ReleaseSupport
    eliminated?: boolean
    // The uid of whatever stands in each slot. The kit's `ReleaseSlots` carries
    // card DATA and no identity — it is domain-free by design — but a choice
    // the engine has to act on names a uid (`neutralize503`'s sacrifice), so
    // the adapter keeps them here rather than widening the kit's own type.
    releaseUid?: Partial<Record<'frontend' | 'backend' | 'database' | 'monitoring', string>>
    // Which of this player's release slots is a standing AI card wearing an
    // ordinary id (`release-<slot>`), keyed to the events-deck id it actually
    // goes home as. Same reasoning as `releaseUid`: the kit's `ReleaseSlots` is
    // domain-free and has no member for it, so the adapter keeps it beside the
    // slot rather than widening the kit's own type. Absent slot means an
    // ordinary card.
    releaseEvent?: Partial<Record<'frontend' | 'backend' | 'database' | 'monitoring', string>>
  }
  opponents: BoardOpponent[]
  decks: {
    // One entry per draw pile, in the engine's own pile order — Git Branch
    // splits the deck and `drawn.pile` names which of them a card came off, so
    // a single total could answer neither question.
    main: number[]
    events: number
    // верх сброса одной картой — запасной вид, когда куча не передана
    discard?: CardData | null
    // сброс как он есть на столе: наброшенная куча. Необязательно — экран
    // остаётся рабочим у потребителя, который её ещё не отдаёт.
    discardHeap?: HeapCard[]
    discardCount: number
  }
  turn?: string
  // whether the player on turn has already drawn this turn — drives the dock
  // between its 'draw' and 'push' phases
  hasDrawn?: boolean
  // the turn's inactivity clock, as the projection stamps it — both ends of
  // the span, like the window's, so the dock's countdown is exact. Absent
  // while a window/pending owns the wait, and before the keeper starts the
  // first turn's clock.
  turnClock?: { openedAt: number; deadline: number } | null
  // the local player's id, as the projection names it (`PlayerView.self.id`)
  selfId: string
  history: HistoryEntry[]
  setup: Setup
  playable: string[]
  frozen: string[]
  // Legal targets per playable card — the projection's answer (PlayerView.self.targets),
  // engine Target and TableTarget being one structural shape. An entry only for a
  // card that needs a target.
  targets?: Record<string, TableTarget[]>
  pending?: TablePending | null
  window?: TableWindow | null
  // Keyed by card uid — the projection's answer to "what may pair with this",
  // so the kit looks the pairing up rather than deciding it.
  comboOptions?: Record<string, string[]>
  // Set by the deal intro while it runs. The board renders one state in every
  // phase; during the intro that state is the intro's shadow of the projection,
  // and this names which phase produced it. Absent means the live projection.
  introPhase?: 'setup' | 'dealing' | 'settling'
}

// Everything the session/P2P layer answers. The engine has no concept of a
// spectator, a room code, or a pause.
export interface BoardRoom {
  role?: 'host' | 'guest'
  code?: string
  participants: Participant[]
  spectators: Spectator[]
  spectatorLimit?: number
  onSpectatorLimitChange?: (n: number) => void
  onKickSpectator?: (id: string) => void
  lang?: SwitchLang
  onLangChange?: (lang: SwitchLang) => void
  paused?: boolean
  onPauseChange?: (on: boolean) => void
  pausePlayers?: PausePlayer[]
  pauseSelfId?: string
  pauseHostId?: string
  onPauseToggleReady?: () => void
  // Connection is a session fact, never a game fact. `reconnecting` is the
  // local peer; `disconnected` names peers seen as gone.
  connection?: 'online' | 'reconnecting'
  // Present only while `connection` is 'reconnecting'. Absent, the overlay
  // still renders, on attempt 1 of 5 — a caller that knows it is dialing but
  // not how far along should not be forced to invent numbers.
  reconnect?: { attempt: number; maxAttempts: number; status: 'trying' | 'failed' }
  onReconnectRetry?: () => void
  onReconnectLeave?: () => void
  disconnected?: string[]
}

// Собственный «хром»-текст стола по языку (бейдж выбывания + подписи стопок).
export interface BoardChromeCopy {
  youEliminated: string
  deck: string
  events: string
  discard: string
  // подпись вкладки-настроек (для screen-reader на иконке-шестерёнке)
  settings: string
  // заголовок группы общих настроек — показывается только хосту (у него две
  // группы: общие + управление хоста; у прочих одна группа, заголовок не нужен)
  generalTitle?: string
  // подписи полей в панели настроек
  langTitle: string
  codeTitle: string
  // заголовок группы управления хоста + подпись поля лимита зрителей
  hostTitle: string
  specLimit: string
  // The ask under the centre of the table (#101) — one line per step that
  // waits on a card from the fan and has no panel to speak for it: the
  // standing release's own price, an attack owed an answer, and (fix round 1)
  // the defender's own Sudo waiting for the defence it will enhance. That
  // last one is a separate line and not a phrasing of `askDefend`, because it
  // is a separate GESTURE: an open attack is answered by pulling a card out,
  // a waiting Sudo by clicking one — and a pull in that state is refused
  // outright (`resolveLegal`/`resolveSudo` both bail while anything is
  // staged), so one line covering both would name a gesture that does nothing.
  askCost: string
  askDefend: string
  askPartner: string
  // An Error 503 owed an answer (#102). One line for all three methods rather
  // than one per method: they are three GESTURES but one question, and what
  // may answer is the projection's own set — so the line points at what is lit
  // instead of naming a gesture that a pending offering only Monitoring (or
  // only a sacrifice) would not have.
  askNeutralize: string
  // The hand is over the limit and the fan is the picker (#104). Count-free on
  // interpolation to put a number into — and the grid's own empty cells already
  // show how many are owed.
  askHandLimit: string
  // Inside's own caption (#106, `pickFromDiscard`) — the row over the
  // discard asks this one, the same way the fan itself asks the four lines
  // above it. Shared with Git Cherry-pick once #61 lands: the two effects
  // resolve through the same pending, so they read the same line.
  insidePrompt: string
  // поле паузы (опционально — рендерится только вместе с обработчиком паузы):
  // подпись поля, состояние тумблера (вкл / выкл) и строка-пояснение
  pauseGame?: string
  pauseOn?: string
  pauseOff?: string
  pauseHint?: string
  // подписи текстовых вкладок рейла
  tabHistory: string
  tabParticipants: string
  tabRules: string
  tabModes: string
}

export interface BoardCopyBundle {
  table: BoardChromeCopy
  modes: GameModesCopy
  rules: RulesCopy
  seat: SeatCopy
  participants: ParticipantsCopy
  history: MoveHistoryCopy
  reconnect: ReconnectCopy
  gameOver: GameOverCopy
  lobbyCode: LobbyCodeCopy
  // The dock's copy plus one line the kit has no notion of: while the deal
  // intro runs nobody is on turn, so the dock names the moment where it would
  // name a player.
  turnDock: TurnDockCopy & { gameStart: string }
  pause?: PauseGameCopy
  pending: PendingPromptCopy
  window: WindowCopy
}

/**
 * What a beat runner is handed: the projection it animates AWAY from, and a
 * way to move the board while it runs. `IntroBeat` below is the one existing
 * case of a beat publishing a shape of its own rather than sitting on its
 * `base` for its whole life; this is that same door, opened to every beat, so
 * it lives here for the same reason `IntroBeat` does — a fact the queue
 * (`features/board-beats`) and its runners (also `features/`) both need, which
 * a type in `features/` cannot be, because a feature must not import from a
 * sibling feature.
 */
export interface BeatRun {
  base: BoardState
  publish: (state: BoardState) => void
}

/**
 * The staging → beat handoff (#100, Task 11). `_useBoardStaging.ts` stands a
 * pulled play — solo or a folded pair — at the centre and, once the engine
 * accepts it, holds it there rather than clearing it: the centre pending
 * render (or the release zone) is about to take over the exact same spot, and
 * clearing early would drop a frame between the two. The combo beat is the
 * one that knows when that handover actually happens, so it is the one that
 * clears it — through `release()`, once its own fold has nothing left to do
 * (the actor's own play is already standing where the projection wants it).
 *
 * A ref, not state: the beat reads it once at run start and `release()` is a
 * plain clear, not a re-render the beat would have to wait on. It lives here,
 * not in `features/`, for the same reason `BeatRun` does — a feature must not
 * import from a sibling feature, and both the page (`pages/board`) and the
 * beat queue (`features/board-beats`) need this same shape.
 */
export interface StagedHandoff {
  mainUid: string
  supportUid?: string
  el: HTMLElement | null // the staged node at the centre (pair flyer or single-card node)
  release: () => void // clears the page's staging state
}

/**
 * The hand limit's own handoff (#104). The local player builds the grid at the
 * centre themselves, card by card, long before the engine's `discarded` events
 * come back — so the beat that takes those cards to the heap must fly the cells
 * that are already standing rather than a hand the cards left minutes ago.
 *
 * A ref, read once at run start, for the same reason `StagedHandoff` is one. It
 * lives here because the page produces it and a feature consumes it.
 *
 * `release()` does NOT end the gesture: it drops the grid's own render, in the
 * same commit the exit's carriers go up. The picked cards stay hidden from the
 * fan until the pending itself clears — the same split `_useNeutralizeStaging`
 * keeps, and for the same reason (the board is still rendering the beat's
 * shadow, whose hand still holds them).
 */
export interface HandLimitHandoff {
  player: string
  cards: { uid: string; card: CardData; slot: number }[]
  cellAt: (slot: number) => HTMLElement | null
  release: () => void
}

/**
 * The opening, handed to the beat queue as one beat. It is not planned from
 * events like the others — it is a whole shape rather than a fold of the
 * projection, so it publishes its own `shadow` and the queue renders that. But
 * it is queued like everything else, ahead of everything else, and it is the one
 * beat that owns the table while it runs.
 *
 * It lives here, not beside either consumer: `features/game-intro` produces it
 * and `features/board-beats` takes it, and a feature must not import from a
 * sibling feature. It is a board fact, like `BoardState` and `BoardAnchors`.
 *
 * `run` resolves when the opening is OVER — including when a skip cut it short,
 * not only when it played to the end. It takes a `BeatRun` like every other
 * beat's runner does — the real opening ignores it (a 0-arg function is
 * assignable here), and only a test that wants to drive the queue's shadow
 * through the intro slot ever reaches for it.
 *
 * `collapse` is the no-animation path: jump to the end state and report done.
 * It exists because the opening owes something no other beat does — it tells the
 * host's start gate that this seat has finished watching, and until every seat
 * has, no peer may act. Skipping `run` under reduced motion would skip that
 * report too, and the match would never begin. The queue still owns the policy;
 * the opening only says what collapsing means for it.
 */
export interface IntroBeat {
  key: string
  shadow: BoardState | null
  run: (ctx: BeatRun) => Promise<void>
  collapse: () => void
}

export interface BoardSlots {
  // App-only chrome the playground has no equivalent of: navigation out of the
  // match, and the consumer's non-fatal error notice.
  corner?: ReactNode
  banner?: ReactNode
}

export interface BoardOver {
  winnerId: string
  condition?: 'release' | 'lastStanding'
}

export interface BoardProps {
  state: BoardState
  room: BoardRoom
  copy: BoardCopyBundle
  slots?: BoardSlots
  over?: BoardOver | null
  actions?: TableActions
  // override for the dock derived from `state` — the playground's manual
  // selector uses this to force a specific demo state
  dock?: Partial<DockView>
  // The consumer's clock. The kit never reads the system clock itself, so a
  // live countdown is the consumer ticking this. Required: optional here would
  // let a consumer compile while every deadline silently sweeps against a
  // default, which is the shape that hid the missing `pending` and `window`
  // copy — a page that built cleanly and showed a dead ring.
  now: number
  // Controlled/uncontrolled: omit both and Table owns the open panel. Supply
  // `panel` and Table renders exactly what it is told, reporting intent through
  // `onPanelChange` — which is how the page binds the drawer to the URL.
  panel?: Panel | null
  onPanelChange?: (panel: Panel | null) => void
  // The opening. Present only on a fresh entry; the board renders the intro's
  // shadow of `state` while it runs and the live `state` afterwards.
  intro?: {
    // Which match this is, so the opening plays once per game rather than once
    // per peer — a PlayerView carries no game identity, and the route does.
    gameId: string | null
    view: PlayerView | null
    events: Event[]
    onDone: () => void
  }
}
