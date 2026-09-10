import type React from 'react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { HEAP_SHOW } from '@/animations'
import LangSwitcher from '@/blocks/LangSwitcher'
import LobbyCode from '@/blocks/LobbyCode'
import Rules from '@/blocks/Rules'
import { CardMotionProvider } from '@/cards/cardMotion'
import GearIcon from '@/icons/GearIcon'
import Arrow, { centerOf, useArrow } from '@/primitives/Arrow'
import Badge from '@/primitives/Badge'
import Drawer from '@/primitives/Drawer'
import HudBackground from '@/primitives/HudBackground'
import Pile from '@/primitives/Pile'
import ScrollArea from '@/primitives/ScrollArea'
import Slider from '@/primitives/Slider'
import TabRail, { type TabRailItem } from '@/primitives/TabRail'
import Toggle from '@/primitives/Toggle'
import Typography from '@/primitives/Typography'
import GameModes from '@/table/GameModes'
import GameOver from '@/table/GameOver'
import Hand from '@/table/Hand'
import MoveHistory from '@/table/MoveHistory'
import Participants from '@/table/Participants'
import PauseGame from '@/table/PauseGame/PauseGame'
import Reconnect from '@/table/Reconnect'
import ReleaseZone from '@/table/ReleaseZone'
import type { ReleaseSlots } from '@/table/ReleaseZone/ReleaseZone'
import Seat from '@/table/Seat'
import TurnDock from '@/table/TurnDock/TurnDock'
import { deriveDock } from './dock'
import PendingPrompt from './PendingPrompt'
import { PILE_WIDTH } from './piles'
import styles from './Table.module.css'
import type { Panel, TableProps } from './types'
import { useTableInteractions } from './useTableInteractions'

// светофор для лимита зрителей (зеркало палитры из экрана Lobby):
// 0–8 зелёный, 9–18 жёлтый, 19–28 красный
const SPEC_MAX = 28
function specColorFor(n: number) {
  if (n <= 8) return '#8fd9b0'
  if (n <= 18) return '#e3b341'
  return '#ff6b81'
}

// Ширина выезжающей панели зависит от типа контента вкладки.
const DRAWER_WIDTH: Record<Panel, number> = {
  settings: 320, // настройки — узкая
  history: 420, // история — немного шире
  participants: 420, // участники — как история
  modes: 680, // режимы — как правила
  rules: 680, // правила — сильно шире
  chat: 420, // переписка — как история
}

const EMPTY_RELEASE: ReleaseSlots = {
  frontend: undefined,
  backend: undefined,
  database: undefined,
}

// ===== settings drawer building blocks =====
// A titled cluster of settings fields. The heading is optional: a non-host
// player sees a single, self-evident group and needs no heading; the host sees
// two groups (general + host controls) and both are titled to tell them apart.
function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      {title && (
        <Typography as="div" base="tag" tk="tk-10" className={styles.groupHead}>
          {title}
        </Typography>
      )}
      {children}
    </section>
  )
}

// One settings unit — the single pattern shared by every control: a caption, the
// control, and an optional hint below.
// `inline` puts the control on the caption's line, at the right edge — the shape
// every compact control takes, so the panel reads as one column of switches
// instead of a ladder of differently sized things. Stacked is what is left for a
// control that needs the full width (the spectator slider).
function SettingsField({
  label,
  hint,
  inline = false,
  children,
}: {
  label?: string
  hint?: string
  inline?: boolean
  children: ReactNode
}) {
  const labelEl = label && (
    <Typography as="div" variant="metaLabel" className={styles.fieldLabel}>
      {label}
    </Typography>
  )
  const hintEl = hint && (
    <Typography as="div" base="mono-xs" className={styles.fieldHint}>
      {hint}
    </Typography>
  )

  // Строка из двух частей: справа контрол своей шириной, слева — всё остальное,
  // подпись вместе с пояснением. Ни одна из частей не фиксирована: контрол берёт
  // ровно своё, текст занимает остаток и переносится внутри него.
  if (inline) {
    return (
      <div className={styles.fieldInline}>
        <div className={styles.fieldText}>
          {labelEl}
          {hintEl}
        </div>
        {children}
      </div>
    )
  }

  // Столбиком — то, чему нужна вся ширина: подпись, контрол, пояснение.
  return (
    <div className={styles.field}>
      {labelEl}
      {children}
      {hintEl}
    </div>
  )
}

// Стол = активное состояние игры. Каждый блок позиционируется независимо
// (абсолютно), без жёсткой сетки. Заполняет экран без скролла.
export default function Table({
  state,
  room,
  copy,
  slots,
  over = null,
  actions,
  dock,
  now,
  panel: panelProp,
  onPanelChange,
}: TableProps) {
  const { you, opponents, decks, turn, history, setup } = state
  const derived = deriveDock(state, state.selfId, now, room.timers ?? true)
  const dockView = { ...derived, ...dock }
  const {
    role = 'guest',
    code,
    participants,
    spectators,
    spectatorLimit,
    onSpectatorLimitChange,
    onKickSpectator,
    lang,
    onLangChange,
    parallax = true,
    onParallaxChange,
    chatToasts = true,
    onChatToastsChange,
    timers = true,
    onTimersChange,
    paused = false,
    onPauseChange,
    pausePlayers = [],
    pauseSelfId,
    pauseHostId,
    onPauseToggleReady,
  } = room
  const [ownPanel, setOwnPanel] = useState<Panel | null>(null)
  const controlled = panelProp !== undefined
  const panel = controlled ? panelProp : ownPanel

  // gesture machine (Tasks 6–7): turns clicks into completed intents. Legality
  // is always the engine's answer (state.playable / actions.legalTargets) —
  // Table only renders what the hook decided, never re-derives it.
  const gestures = useTableInteractions({
    state,
    actions,
    comboOptions: (card) => state.comboOptions?.[card] ?? [],
  })

  // targeting arrow: origin is the SOURCE card's slot — `gestures.selected`,
  // resolved through `data-hand-slot` — not whatever was clicked most
  // recently. `selected` stays the source through the whole combo-then-target
  // sequence (the partner click only sets `combo`), so re-deriving the origin
  // from it on every phase change keeps the arrow anchored to the source even
  // when a combo partner is picked afterwards. The tip follows the cursor via
  // the mousemove listener inside useArrow, which is only mounted while
  // `active` is true — kept in lockstep with `phase === 'selected'` here, so
  // it comes down on every exit from that phase, including unmount.
  //
  // The effect is keyed on `phase`/`selected` only — NOT on `you.hand` — on
  // purpose: it arms once per selection, not once per render. `you.hand` is a
  // fresh array on every projection update (Milestone 3's `toTableState`
  // rebuilds `TableState` from scratch each time), and `Table` re-renders on
  // the turn clock; if `you.hand` were a dependency, every such re-render
  // while a target is pending would re-run `arrow.aim(origin)`, which sets
  // `to = origin` and snaps the tracked cursor position back to the source —
  // discarding whatever the mousemove listener had followed it to. `you.hand`
  // is still read inside the effect (to resolve the selected uid's slot
  // element), just not watched for changes.
  const handRef = useRef<HTMLDivElement>(null)
  const arrow = useArrow()
  // biome-ignore lint/correctness/useExhaustiveDependencies: `you.hand` is read to resolve the selected uid's slot element, not watched — see the comment above for why it must stay out of the dependency array
  useEffect(() => {
    if (gestures.phase !== 'selected') {
      arrow.stop()
      return
    }
    const index = gestures.selected ? you.hand.findIndex((c) => c.uid === gestures.selected) : -1
    const slotEl =
      index >= 0
        ? handRef.current?.querySelectorAll<HTMLElement>('[data-hand-slot]')[index]
        : undefined
    if (slotEl) arrow.aim(centerOf(slotEl))
  }, [gestures.phase, gestures.selected, arrow.aim, arrow.stop])

  // Escape cancels an in-flight target selection. Bound to the window (not a
  // React onKeyDown) so it fires regardless of what currently has focus, and
  // — like the arrow's mousemove — only while there is something to cancel.
  useEffect(() => {
    if (gestures.phase !== 'selected') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') gestures.cancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [gestures.phase, gestures.cancel])

  // A click that lands outside any hand slot while a target is pending reads
  // as "changed my mind" — cancel. Clicks that land on a legal target already
  // resolve (and reset) through onTargetPick before bubbling here, so this is
  // a no-op in that case, not a race.
  const handleTableClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (gestures.phase !== 'selected') return
    const target = e.target as HTMLElement
    if (target.closest('[data-hand-slot]')) return
    gestures.cancel()
  }

  const isHost = role === 'host'
  // секция управления хоста в настройках: лимит зрителей и/или пауза игры
  const canLimitSpectators = isHost && Boolean(onSpectatorLimitChange) && spectatorLimit != null
  const canPause = isHost && Boolean(onPauseChange) && Boolean(copy.table.pauseGame)
  const canTimers = isHost && Boolean(onTimersChange) && Boolean(copy.table.timers)
  const hostControls = canLimitSpectators || canPause || canTimers
  // есть ли на столе переписка вообще: от этого зависит и вкладка рейла, и
  // настройка её уведомлений — управлять тем, чего на экране нет, незачем
  const hasChat = Boolean(slots?.chat) && Boolean(copy.table.tabChat)
  const canChatToasts = hasChat && Boolean(onChatToastsChange) && Boolean(copy.table.chatToasts)
  const hasUpperSettings =
    Boolean(lang && onLangChange) || Boolean(code) || Boolean(onParallaxChange) || canChatToasts

  // текстовые вкладки рейла (порядок = сверху вниз), подписи — по языку.
  // Чат стоит последним, то есть у нижнего края: это не панель про партию, а
  // разговор рядом с ней, и он не должен вклиниваться между её вкладками.
  const textTabs: TabRailItem[] = [
    { id: 'history', label: copy.table.tabHistory },
    { id: 'participants', label: copy.table.tabParticipants },
    { id: 'rules', label: copy.table.tabRules },
    { id: 'modes', label: copy.table.tabModes },
    // высота фиксированная: чат в общий ряд не встаёт по смыслу, и делить полосу
    // поровну с панелями партии ему незачем
    ...(hasChat ? [{ id: 'chat', label: copy.table.tabChat ?? '', height: 155 }] : []),
  ]

  // квадратная вкладка «настройки» (шестерёнка) — когда есть что показать
  // (свитчер языка и/или код игры); служебный слот под визуальные опции
  const hasSettings =
    Boolean(onLangChange) ||
    Boolean(code) ||
    Boolean(onParallaxChange) ||
    canChatToasts ||
    Boolean(hostControls)
  const railItems: TabRailItem[] = hasSettings
    ? [{ id: 'settings', label: copy.table.settings, icon: <GearIcon /> }, ...textTabs]
    : textTabs

  // завершение партии — оверлей поверх стола (триггерится извне)
  const overWinner = over ? participants.find((p) => p.id === over.winnerId) : null
  const youEliminated = Boolean(you.eliminated)
  const disconnectedIds = new Set(room.disconnected ?? [])

  const toggle = (p: Panel) => {
    const next = panel === p ? null : p
    if (!controlled) setOwnPanel(next)
    onPanelChange?.(next)
  }

  // при закрытии держим ширину последней открытой вкладки — чтобы панель
  // уезжала своей шириной, без скачка; при смене вкладок ширина плавно меняется
  const lastOpen = useRef<Panel>('history')
  useEffect(() => {
    if (panel) lastOpen.current = panel
  }, [panel])
  const drawerWidth = DRAWER_WIDTH[panel ?? lastOpen.current]

  return (
    <CardMotionProvider value={parallax}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-cancel for an in-flight target selection; the accessible affordance is the Escape handler above */}
      <div className={styles.table} onClick={handleTableClick} role="presentation">
        <HudBackground tone="neutral" className={styles.bgLayer} />
        <Arrow from={arrow.from} to={arrow.to} />

        {slots?.banner && <div className={styles.banner}>{slots.banner}</div>}
        {slots?.corner && <div className={styles.corner}>{slots.corner}</div>}

        <div className={styles.opponents}>
          {opponents.map((p) => {
            const eliminated = Boolean(p.eliminated)
            const disconnected = disconnectedIds.has(p.id)
            // выбыл → карты в сброс: пустая зона релиза, рука = 0
            const shown = eliminated ? { ...p, handCount: 0, release: EMPTY_RELEASE } : p
            return (
              <Seat
                key={p.id}
                player={shown}
                active={turn === p.id}
                eliminated={eliminated}
                disconnected={disconnected}
                copy={copy.seat}
                onPick={(target) => gestures.onTargetPick(target)}
                targets={gestures.targets}
              />
            )
          })}
        </div>

        <div className={styles.decks}>
          <div className={styles.pileRow}>
            {decks.main.map((count, i) => (
              <Pile
                // biome-ignore lint/suspicious/noArrayIndexKey: a pile IS its index — the engine names it that way in `drawn.pile`, and the halves of a split stay where the pile was
                key={i}
                label={copy.table.deck}
                deck="base"
                count={count}
                width={PILE_WIDTH}
                countPos="tl"
              />
            ))}
          </div>
          <Pile
            label={copy.table.events}
            deck="ai"
            count={decks.events}
            width={150}
            countPos="tl"
          />
        </div>

        {/* сброс — наброшенная куча, как на столе: видны верхние карты, под ними
            «глубина» стопки, счётчик показывает весь сброс */}
        <div className={styles.discard}>
          <Pile
            label={copy.table.discard}
            heap={decks.discardHeap}
            heapShow={HEAP_SHOW}
            topCard={decks.discard}
            count={decks.discardCount}
            width={116}
          />
        </div>

        <div className={styles.you}>
          {youEliminated ? (
            <Badge size="lg" className={styles.youBadge}>
              {copy.table.youEliminated}
            </Badge>
          ) : (
            <>
              <ReleaseZone
                release={you.release}
                size="100px"
                player={state.selfId}
                onPick={(target) => gestures.onTargetPick(target)}
                targets={gestures.targets}
              />
              <div className={styles.handWrap} ref={handRef}>
                <Hand
                  items={you.hand}
                  onCardClick={(i) => gestures.onCardClick(i)}
                  accentAt={gestures.accentAt}
                />
              </div>
            </>
          )}
        </div>

        {/* служебный док хода — низ слева, под колодами, слева от руки */}
        <div className={styles.turnDock}>
          <TurnDock
            state={dockView.state}
            danger={dockView.danger}
            seconds={dockView.seconds}
            progress={dockView.progress}
            activePlayer={dockView.activePlayer}
            passed={dockView.passed}
            passes={dockView.passes}
            copy={copy.turnDock}
            paused={paused}
            onDraw={actions?.onDraw ? () => actions.onDraw?.() : undefined}
            onPush={actions?.onPush}
            onPass={actions?.onPass}
            onUnpass={actions?.onUnpass}
          />
        </div>

        {/* the engine is waiting on a decision from you — a pending owed to you
            always renders, regardless of whose turn the projection says it is */}
        {state.pending?.player === state.selfId && (
          <PendingPrompt
            pending={state.pending}
            hand={you.hand}
            copy={copy.pending}
            onResolve={(choice) => actions?.onResolve?.(choice)}
          />
        )}

        {/* всплывающие плашки — правый нижний угол, с отступом на рейл. Их нет
            при открытой панели чата (лента и так перед глазами) и когда игрок
            выключил их в настройках — оба правила про то, видно ли ленту, и
            потому оба здесь, а не у того, кто плашки поставляет */}
        {slots?.toasts && panel !== 'chat' && chatToasts && (
          <div className={styles.toasts}>{slots.toasts}</div>
        )}

        {/* вертикальный рейл у правого края — переключает панели drawer */}
        <TabRail items={railItems} active={panel} onSelect={(id) => toggle(id as Panel)} />

        {/* выезжающая панель поверх контента (ширина — per-tab) */}
        <Drawer open={panel !== null} width={drawerWidth} className={styles.drawer}>
          {panel === 'settings' && (
            <div className={styles.settings}>
              {hasUpperSettings && (
                <SettingsGroup title={isHost ? copy.table.generalTitle : undefined}>
                  {lang && onLangChange && (
                    <SettingsField label={copy.table.langTitle} inline>
                      <LangSwitcher
                        value={lang}
                        onChange={onLangChange}
                        variant="full"
                        align="start"
                      />
                    </SettingsField>
                  )}
                  {code && (
                    <SettingsField label={copy.table.codeTitle} inline>
                      {/* копирует клик по самому коду — отдельной кнопке в
                          строке настроек делать нечего */}
                      <LobbyCode code={code} copy={copy.lobbyCode} copyOnCode showLabel={false} />
                    </SettingsField>
                  )}
                  {onParallaxChange && copy.table.parallax && (
                    <SettingsField
                      label={copy.table.parallax}
                      hint={copy.table.parallaxHint}
                      inline
                    >
                      <Toggle
                        on={parallax}
                        onChange={onParallaxChange}
                        className={styles.settingToggle}
                      >
                        {(parallax ? copy.table.parallaxOn : copy.table.parallaxOff) ??
                          copy.table.parallax}
                      </Toggle>
                    </SettingsField>
                  )}
                  {canChatToasts && (
                    <SettingsField
                      label={copy.table.chatToasts}
                      hint={copy.table.chatToastsHint}
                      inline
                    >
                      <Toggle
                        on={chatToasts}
                        onChange={(on) => onChatToastsChange?.(on)}
                        className={styles.settingToggle}
                      >
                        {(chatToasts ? copy.table.chatToastsOn : copy.table.chatToastsOff) ??
                          copy.table.chatToasts}
                      </Toggle>
                    </SettingsField>
                  )}
                </SettingsGroup>
              )}
              {hostControls && (
                <>
                  {hasUpperSettings && <div className={styles.divider} />}
                  <SettingsGroup title={copy.table.hostTitle}>
                    {canLimitSpectators && (
                      <SettingsField label={copy.table.specLimit}>
                        <Slider
                          value={spectatorLimit ?? 0}
                          min={0}
                          max={SPEC_MAX}
                          onChange={(n) => onSpectatorLimitChange?.(n)}
                          color={specColorFor(spectatorLimit ?? 0)}
                          fill
                          className={styles.sliderFull}
                        />
                      </SettingsField>
                    )}
                    {canTimers && (
                      <SettingsField label={copy.table.timers} hint={copy.table.timersHint} inline>
                        <Toggle
                          on={timers}
                          onChange={(on) => onTimersChange?.(on)}
                          className={styles.settingToggle}
                        >
                          {(timers ? copy.table.timersOn : copy.table.timersOff) ??
                            copy.table.timers}
                        </Toggle>
                      </SettingsField>
                    )}
                    {canPause && (
                      <SettingsField
                        label={copy.table.pauseGame}
                        hint={copy.table.pauseHint}
                        inline
                      >
                        <Toggle
                          on={paused}
                          onChange={(on) => onPauseChange?.(on)}
                          className={styles.settingToggle}
                        >
                          {(paused ? copy.table.pauseOn : copy.table.pauseOff) ??
                            copy.table.pauseGame}
                        </Toggle>
                      </SettingsField>
                    )}
                  </SettingsGroup>
                </>
              )}
            </div>
          )}
          {panel === 'history' && (
            <div data-testid="panel-history">
              <MoveHistory entries={history} copy={copy.history} />
            </div>
          )}
          {panel === 'participants' && (
            <Participants
              players={participants}
              spectators={spectators}
              copy={copy.participants}
              isHost={isHost}
              onKickSpectator={onKickSpectator}
            />
          )}
          {panel === 'rules' && (
            <ScrollArea className={styles.scrollPanel}>
              <Rules copy={copy.rules} />
            </ScrollArea>
          )}
          {panel === 'modes' && <GameModes setup={setup} copy={copy.modes} />}
          {panel === 'chat' && <div className={styles.chatPanel}>{slots?.chat}</div>}
        </Drawer>

        {/* pause window — over the play area, below the right-hand nav (its own
            z-index), so the rail + drawer stay live while the game is frozen */}
        {paused && copy.pause && (
          <PauseGame
            players={pausePlayers}
            selfId={pauseSelfId}
            hostId={pauseHostId}
            isHost={isHost}
            onToggleReady={onPauseToggleReady}
            onResume={() => onPauseChange?.(false)}
            copy={copy.pause}
          />
        )}

        {room.connection === 'reconnecting' && (
          <Reconnect
            copy={copy.reconnect}
            host={room.code ?? ''}
            attempt={room.reconnect?.attempt ?? 1}
            maxAttempts={room.reconnect?.maxAttempts ?? 5}
            status={room.reconnect?.status ?? 'trying'}
            onRetry={room.onReconnectRetry ?? (() => {})}
            onLeave={room.onReconnectLeave ?? (() => {})}
          />
        )}

        {over && (
          <GameOver
            winner={overWinner}
            condition={over.condition}
            onContinue={actions?.onOverContinue}
            copy={copy.gameOver}
          />
        )}
      </div>
    </CardMotionProvider>
  )
}
