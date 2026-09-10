import enCommon from '@release/translation/locales/en/common.json'
import ruCommon from '@release/translation/locales/ru/common.json'
import { useEffect, useMemo, useState } from 'react'
import { makeTable } from '@/mocks/table'
import Table from '@/table/Table'
import { type Lang, pick, useLang } from '../../Playground/lang'
import HoverSelect from '../controls/HoverSelect'
import TechBar from '../controls/TechBar'
import { TechField, TechLabel, TechSwitch } from '../controls/TechControls'
import styles from './TableStory.module.css'

type GameOverCondition = 'release' | 'lastStanding'
type ViewState = 'oppEliminated' | 'youEliminated' | 'oppDisconnect' | 'youDisconnect'
type Loc = Record<Lang, string>

interface EndVariant {
  id: string
  label: Loc
  winnerId: string
  condition: GameOverCondition
}
interface ViewItem {
  id: ViewState
  label: Loc
}

// end-of-match variants — each as its own button so all are visible
const END_VARIANTS: EndVariant[] = [
  {
    id: 'win-release',
    label: { ru: 'победа: 3 релиза', en: 'win: 3 releases' },
    winnerId: 'you',
    condition: 'release',
  },
  {
    id: 'win-last',
    label: { ru: 'победа: последний', en: 'win: last standing' },
    winnerId: 'you',
    condition: 'lastStanding',
  },
  {
    id: 'opp-release',
    label: { ru: 'соперник: 3 релиза', en: 'opponent: 3 releases' },
    winnerId: 'p2',
    condition: 'release',
  },
]

// table states: elimination/disconnect of the opponent and of the player
const VIEW_STATES: ViewItem[] = [
  { id: 'oppEliminated', label: { ru: 'соперник выбыл', en: 'opponent out' } },
  { id: 'youEliminated', label: { ru: 'ты выбыл', en: 'you are out' } },
  { id: 'oppDisconnect', label: { ru: 'дисконнект соперника', en: 'opponent disconnect' } },
  { id: 'youDisconnect', label: { ru: 'твой дисконнект', en: 'your disconnect' } },
]

// служебный док: демо-состояния (reaction503 = красная danger-реакция →
// в Table это state='reaction' + turnDockDanger)
// Fixed span the reaction demo states sweep against.
const DEMO_WINDOW_MS = 16_000

type DockDemo = 'draw' | 'push' | 'waiting' | 'reaction' | 'reaction503'
const DOCK_STATES: { id: DockDemo; label: Loc }[] = [
  { id: 'draw', label: { ru: 'ход · добор', en: 'turn · draw' } },
  { id: 'push', label: { ru: 'ход · PUSH', en: 'turn · PUSH' } },
  { id: 'waiting', label: { ru: 'ход оппонента', en: 'opponent turn' } },
  { id: 'reaction', label: { ru: 'реакция', en: 'reaction' } },
  { id: 'reaction503', label: { ru: 'error 503', en: 'error 503' } },
]

export default function TableStory() {
  const { lang, setLang } = useLang()
  const [opps, setOpps] = useState(3)
  const [end, setEnd] = useState<string | null>(null)
  const [view, setView] = useState<ViewState | null>(null)
  const [role, setRole] = useState<'host' | 'guest'>('host')
  const [dock, setDock] = useState<DockDemo>('push')
  const [specLimit, setSpecLimit] = useState(8)
  const [kicked, setKicked] = useState<Set<string>>(() => new Set())
  const [paused, setPaused] = useState(false)
  const [parallax, setParallax] = useState(true)
  // host switch: the action clocks for the whole table
  const [timers, setTimers] = useState(true)
  const [ready, setReady] = useState<Set<string>>(() => new Set())
  // The reconnect overlay's own dial state — only meaningful while the
  // `youDisconnect` view is selected. `trying`/`failed` are both worth
  // demonstrating (design source-of-truth for the terminal's two tones), so
  // this is a switch of its own rather than folded into a state that already
  // means something else.
  const [reconnectFailed, setReconnectFailed] = useState(false)
  // Anchor for the reaction demo states' sweep, reset each time either is
  // (re-)selected so switching back into it restarts the countdown. Keyed on
  // `dock` rather than on the boolean: `reaction` → `reaction503` leaves a
  // boolean unchanged, and the second demo would inherit the first's anchor and
  // open part-swept.
  const [demoOpenedAt, setDemoOpenedAt] = useState<number | null>(null)
  const isReactionDemo = dock === 'reaction' || dock === 'reaction503'
  useEffect(() => {
    if (dock === 'reaction' || dock === 'reaction503') setDemoOpenedAt(Date.now())
  }, [dock])

  // Only the reaction demos sweep a ring, so only they need a clock — ticking
  // four times a second through an entire session to animate something not on
  // screen is the cost `useNow` exists to avoid, and a sandbox is no reason for
  // the code to contradict that.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isReactionDemo) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [isReactionDemo])

  const base = useMemo(() => makeTable(opps), [opps])
  // spectators kicked by the host are removed from the roster
  const spectators = base.spectators.filter((s) => !kicked.has(s.id))
  const state = {
    you: base.you,
    opponents: base.opponents,
    decks: base.decks,
    turn: base.turn,
    selfId: 'you',
    history: base.history,
    setup: base.setup,
    playable: [],
    frozen: [],
  }

  // the four-option selector still drives one demo state at a time, now mapped
  // onto the real per-player/room facts instead of a view flag
  const eliminatedId = view === 'oppEliminated' ? state.opponents[0]?.id : undefined
  const disconnected = view === 'oppDisconnect' && state.opponents[0] ? [state.opponents[0].id] : []
  const storyState = {
    ...state,
    you: { ...state.you, eliminated: view === 'youEliminated' },
    opponents: state.opponents.map((o) => ({ ...o, eliminated: o.id === eliminatedId })),
  }

  const variant = END_VARIANTS.find((v) => v.id === end)
  const none = pick(lang, { ru: '— нет —', en: '— none —' })

  // pause window — readiness lamps built from the roster; the local player is
  // 'you', the host is 'you' when hosting, otherwise the first opponent
  const pausePlayers = base.participants.map((p) => ({
    id: p.id,
    name: p.name,
    ready: ready.has(p.id),
  }))
  const pauseHostId = role === 'host' ? 'you' : base.participants.find((p) => p.id !== 'you')?.id
  const togglePause = (on: boolean) => {
    setPaused(on)
    if (on) setReady(new Set()) // a fresh pause starts with everyone not-ready
  }
  const toggleSelfReady = () =>
    setReady((s) => {
      const next = new Set(s)
      if (next.has('you')) next.delete('you')
      else next.add('you')
      return next
    })
  const tableCopy = pick(lang, { ru: ruCommon.table, en: enCommon.table })
  const pauseCopy = pick(lang, {
    ru: {
      title: 'игра на паузе',
      subtitle: 'ждём готовности игроков',
      subtitleReady: 'хост возобновит игру',
      you: 'вы',
      host: 'хост',
      ready: 'готов',
      notReady: 'не готов',
      resume: 'продолжить игру',
    },
    en: {
      title: 'game paused',
      subtitle: 'waiting for players',
      subtitleReady: 'host will resume the game',
      you: 'you',
      host: 'host',
      ready: 'ready',
      notReady: 'not ready',
      resume: 'continue game',
    },
  })
  // Card parallax — a display preference of this player, so it sits in the general
  // group next to the language, not under the host's controls.
  const parallaxLabel = pick(lang, { ru: 'параллакс карт', en: 'card parallax' })
  const parallaxOn = pick(lang, { ru: 'Вкл', en: 'On' })
  const parallaxOff = pick(lang, { ru: 'Выкл', en: 'Off' })
  const parallaxHint = pick(lang, {
    ru: 'лицо карты следует за курсором',
    en: 'the card face follows the cursor',
  })
  const pauseLabel = pick(lang, { ru: 'пауза игры', en: 'pause game' })
  const pauseHint = pick(lang, {
    ru: 'таймер хода замрёт у всех игроков',
    en: 'freezes the turn timer for everyone',
  })
  const timersLabel = pick(lang, { ru: 'таймеры на действие', en: 'action timers' })
  const timersHint = pick(lang, {
    ru: 'ограничивают время на ход и на ответ',
    en: 'limit the time for a turn and for an answer',
  })
  // ВКЛ / ВЫКЛ, as the parallax toggle above: this switch has a state the host
  // needs to read off the control itself, not a name it already has in its label
  const timersOn = pick(lang, { ru: 'Вкл', en: 'On' })
  const timersOff = pick(lang, { ru: 'Выкл', en: 'Off' })
  const generalTitle = pick(lang, { ru: 'общие', en: 'general' })
  // одно слово в обоих состояниях: включённость несёт сам тумблер цветом,
  // а кнопка называет действие
  const pauseOn = pick(lang, { ru: 'Пауза', en: 'Pause' })
  const pauseOff = pick(lang, { ru: 'Пауза', en: 'Pause' })

  return (
    <div className={styles.root}>
      <TechBar>
        <TechSwitch
          options={[
            { value: 'host', label: 'host' },
            { value: 'guest', label: 'guest' },
          ]}
          value={role}
          onChange={setRole}
        />

        <TechField>
          <HoverSelect
            label={pick(lang, { ru: 'оппонентов', en: 'opponents' })}
            value={String(opps)}
            options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => setOpps(Number(v))}
          />
          <TechLabel>
            {pick(lang, { ru: 'всего', en: 'total' })}: {opps + 1}
          </TechLabel>
        </TechField>

        <HoverSelect
          label={pick(lang, { ru: 'состояние', en: 'state' })}
          value={view ?? ''}
          options={[
            { value: '', label: none },
            ...VIEW_STATES.map((v) => ({ value: v.id, label: v.label[lang] })),
          ]}
          onChange={(v) => setView(v === '' ? null : (v as ViewState))}
        />

        <HoverSelect
          label={pick(lang, { ru: 'завершение', en: 'game end' })}
          value={end ?? ''}
          options={[
            { value: '', label: none },
            ...END_VARIANTS.map((v) => ({ value: v.id, label: v.label[lang] })),
          ]}
          onChange={(v) => setEnd(v === '' ? null : v)}
        />

        <HoverSelect
          label={pick(lang, { ru: 'состояние дока', en: 'dock state' })}
          value={dock}
          options={DOCK_STATES.map((d) => ({ value: d.id, label: d.label[lang] }))}
          onChange={(v) => setDock(v as DockDemo)}
        />

        {view === 'youDisconnect' && (
          <TechSwitch
            label={pick(lang, { ru: 'дозвон', en: 'dial' })}
            options={[
              { value: 'trying', label: pick(lang, { ru: 'идёт', en: 'trying' }) },
              { value: 'failed', label: pick(lang, { ru: 'провален', en: 'failed' }) },
            ]}
            value={reconnectFailed ? 'failed' : 'trying'}
            onChange={(v) => setReconnectFailed(v === 'failed')}
          />
        )}
      </TechBar>
      <div className={styles.stage}>
        <Table
          state={storyState}
          room={{
            role,
            code: '4F2A-9K',
            participants: base.participants,
            spectators,
            spectatorLimit: specLimit,
            onSpectatorLimitChange: setSpecLimit,
            onKickSpectator: (id) => setKicked((k) => new Set(k).add(id)),
            lang,
            onLangChange: setLang,
            parallax,
            onParallaxChange: setParallax,
            timers,
            onTimersChange: setTimers,
            paused,
            onPauseChange: togglePause,
            pausePlayers,
            pauseSelfId: 'you',
            pauseHostId,
            onPauseToggleReady: toggleSelfReady,
            connection: view === 'youDisconnect' ? 'reconnecting' : 'online',
            reconnect:
              view === 'youDisconnect'
                ? {
                    attempt: reconnectFailed ? 5 : 2,
                    maxAttempts: 5,
                    status: reconnectFailed ? 'failed' : 'trying',
                  }
                : undefined,
            onReconnectRetry: () => setReconnectFailed(false),
            onReconnectLeave: () => setView(null),
            disconnected,
          }}
          copy={{
            table: {
              ...tableCopy,
              generalTitle,
              parallax: parallaxLabel,
              parallaxOn,
              parallaxOff,
              parallaxHint,
              pauseGame: pauseLabel,
              pauseOn,
              pauseOff,
              pauseHint,
              timers: timersLabel,
              timersOn,
              timersOff,
              timersHint,
            },
            modes: pick(lang, { ru: ruCommon.gameModes, en: enCommon.gameModes }),
            rules: pick(lang, { ru: ruCommon.rulesBlock, en: enCommon.rulesBlock }),
            seat: pick(lang, { ru: ruCommon.seat, en: enCommon.seat }),
            participants: pick(lang, { ru: ruCommon.participants, en: enCommon.participants }),
            history: pick(lang, { ru: ruCommon.moveHistory, en: enCommon.moveHistory }),
            reconnect: pick(lang, { ru: ruCommon.reconnect, en: enCommon.reconnect }),
            gameOver: pick(lang, { ru: ruCommon.gameOver, en: enCommon.gameOver }),
            lobbyCode: pick(lang, { ru: ruCommon.lobbyCode, en: enCommon.lobbyCode }),
            turnDock: pick(lang, { ru: ruCommon.turnDock, en: enCommon.turnDock }),
            pending: pick(lang, { ru: ruCommon.pending, en: enCommon.pending }),
            window: pick(lang, { ru: ruCommon.window, en: enCommon.window }),
            pause: pauseCopy,
          }}
          over={variant ? { winnerId: variant.winnerId, condition: variant.condition } : null}
          actions={{ onOverContinue: () => setEnd(null) }}
          now={now}
          dock={{
            state: dock === 'reaction503' ? 'reaction' : dock,
            danger: dock === 'reaction503',
            // Only the two reaction demo states own a countdown to show; for
            // 'draw' / 'push' / 'waiting' the ring is either not rendered or
            // reads 0, so seconds/progress fall through to Table's own
            // `deriveDock(state, selfId, now)` instead of freezing them —
            // an unconditional override here previously always won, so the
            // ring never actually swept no matter how often `now` ticked.
            ...(isReactionDemo && demoOpenedAt !== null
              ? {
                  seconds: Math.max(0, Math.ceil((demoOpenedAt + DEMO_WINDOW_MS - now) / 1000)),
                  progress: Math.min(
                    1,
                    Math.max(0, (demoOpenedAt + DEMO_WINDOW_MS - now) / DEMO_WINDOW_MS),
                  ),
                }
              : {}),
            // matches the dock's previous hardcoded lookup (always the first
            // opponent), independent of whose turn `state.turn` actually names
            activePlayer: state.opponents[0]?.name,
          }}
        />
      </div>
    </div>
  )
}
