import type { ReactNode } from 'react'
import type { SwitchLang } from '@/blocks/LangSwitcher'
import type { LobbyCodeCopy } from '@/blocks/LobbyCode'
import type { RulesCopy } from '@/blocks/Rules'
import type { Card } from '@/cards/types'
import type { GameModesCopy, Setup } from '@/game/modes'
import type { HeapCard } from '@/primitives/Pile/Pile'
import type { GameOverCopy } from '@/table/GameOver/GameOver'
import type { HandItem } from '@/table/Hand/Hand'
import type { HistoryEntry, MoveHistoryCopy } from '@/table/MoveHistory/MoveHistory'
import type { Participant, ParticipantsCopy, Spectator } from '@/table/Participants/Participants'
import type { PauseGameCopy, PausePlayer } from '@/table/PauseGame/PauseGame'
import type { ReconnectCopy } from '@/table/Reconnect'
import type { ReleaseSlots } from '@/table/ReleaseZone/ReleaseZone'
import type { SeatCopy } from '@/table/Seat/Seat'
import type { TurnDockCopy } from '@/table/TurnDock/TurnDock'
import type { DockView } from './dock'
import type { TableActions, TablePending, TableWindow } from './intents'
import type { PendingPromptCopy, WindowCopy } from './PendingPrompt'

export type Panel = 'settings' | 'history' | 'participants' | 'rules' | 'modes' | 'chat'

export interface TableOpponent {
  id: string
  name: string
  handCount: number
  release: ReleaseSlots
  eliminated?: boolean
}

// Everything the engine's projection can answer. Assembled by the consumer's
// adapter; nothing here is room- or session-shaped.
export interface TableState {
  you: {
    name: string
    hand: HandItem[]
    release: ReleaseSlots
    eliminated?: boolean
  }
  opponents: TableOpponent[]
  decks: {
    // One entry per draw pile, in the engine's own pile order — Git Branch
    // splits the deck and `drawn.pile` names which of them a card came off, so
    // a single total could answer neither question.
    main: number[]
    events: number
    // верх сброса одной картой — запасной вид, когда куча не передана
    discard?: Card | null
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
  pending?: TablePending | null
  window?: TableWindow | null
  // Keyed by card uid — the projection's answer to "what may pair with this",
  // so the kit looks the pairing up rather than deciding it.
  comboOptions?: Record<string, string[]>
}

// Everything the session/P2P layer answers. The engine has no concept of a
// spectator, a room code, or a pause.
export interface TableRoom {
  role?: 'host' | 'guest'
  code?: string
  participants: Participant[]
  spectators: Spectator[]
  spectatorLimit?: number
  onSpectatorLimitChange?: (n: number) => void
  onKickSpectator?: (id: string) => void
  lang?: SwitchLang
  onLangChange?: (lang: SwitchLang) => void
  // Display preference, not a game fact: whether the card faces follow the
  // pointer. Local to this player — it is never sent anywhere.
  parallax?: boolean
  onParallaxChange?: (on: boolean) => void
  // Всплывают ли новые реплики чата в углу, пока панель закрыта. Тоже
  // предпочтение показа, а не факт комнаты: живёт у этого игрока и никуда не
  // уезжает. Без обработчика поле в настройках не рисуется, а тосты идут.
  chatToasts?: boolean
  // Action clocks for the whole table — a host switch. On (the default) the
  // dock counts every deadline down; off, every ring that could have carried a
  // clock is simply full, with no number. The engine keeps its deadlines either
  // way: this is what the table SHOWS, and a host who turns it off is choosing
  // a table without the pressure, not a table with different rules.
  timers?: boolean
  onTimersChange?: (on: boolean) => void
  onChatToastsChange?: (on: boolean) => void
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
export interface TableChromeCopy {
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
  // поле паузы (опционально — рендерится только вместе с обработчиком паузы):
  // подпись поля, состояние тумблера (вкл / выкл) и строка-пояснение
  pauseGame?: string
  pauseOn?: string
  pauseOff?: string
  pauseHint?: string
  // host-only: the action clocks, on or off for the whole table
  timers?: string
  timersOn?: string
  timersOff?: string
  timersHint?: string
  // поле параллакса карт (опционально — как и пауза, рендерится только вместе
  // со своим обработчиком): подпись поля, состояние тумблера и пояснение
  parallax?: string
  parallaxOn?: string
  parallaxOff?: string
  parallaxHint?: string
  // поле уведомлений чата — как параллакс: подпись, состояния тумблера и
  // пояснение; рендерится только вместе со своим обработчиком
  chatToasts?: string
  chatToastsOn?: string
  chatToastsOff?: string
  chatToastsHint?: string
  // подписи текстовых вкладок рейла
  tabHistory: string
  tabParticipants: string
  tabRules: string
  tabModes: string
  // подпись вкладки чата — необязательна, как и сам чат: вкладка появляется
  // только вместе со слотом `slots.chat`, а без него подписывать нечего
  tabChat?: string
}

export interface TableCopyBundle {
  table: TableChromeCopy
  modes: GameModesCopy
  rules: RulesCopy
  seat: SeatCopy
  participants: ParticipantsCopy
  history: MoveHistoryCopy
  reconnect: ReconnectCopy
  gameOver: GameOverCopy
  lobbyCode: LobbyCodeCopy
  turnDock: TurnDockCopy
  pause?: PauseGameCopy
  pending: PendingPromptCopy
  window: WindowCopy
}

export interface TableSlots {
  // App-only chrome the playground has no equivalent of: navigation out of the
  // match, and the consumer's non-fatal error notice.
  corner?: ReactNode
  banner?: ReactNode
  // Переписка комнаты — слот, а не данные: стол даёт ей вкладку рейла и
  // выезжающую панель, а кто ведёт ленту (P2P, мок) он не знает. Нет слота —
  // нет ни вкладки, ни панели.
  chat?: ReactNode
  // Всплывающие плашки в правом нижнем углу. Стол даёт им угол, ширину и слой;
  // что всплывает — дело потребителя. Одно правило стол берёт на себя: при
  // открытой панели чата плашек нет вовсе — лента и так на экране.
  toasts?: ReactNode
}

export interface TableOver {
  winnerId: string
  condition?: 'release' | 'lastStanding'
}

export interface TableProps {
  state: TableState
  room: TableRoom
  copy: TableCopyBundle
  slots?: TableSlots
  over?: TableOver | null
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
}
