// Forked from apps/ui/src/table/Table/Table.tsx (2026-08-11, #89).
//
// The board screen lives here now because the deal intro animates into the real
// Hand's DOM, which a component in another package cannot expose. @release/ui's
// Table keeps its copy and keeps serving the playground's TableStory — so the
// two will drift, and contract.test-d.ts is what makes the drift a compile
// error instead of a misrender.

import {
  Arrow,
  Badge,
  Button,
  Card,
  CardPair,
  cardById,
  centrePlaceStyle,
  type DockView,
  Drawer,
  deriveDock,
  EdgeGlow,
  GameModes,
  GameOver,
  GearIcon,
  GRID_TOP,
  gridCells,
  Hand,
  HudBackground,
  LangSwitcher,
  LobbyCode,
  MoveHistory,
  Participants,
  PauseGame,
  PendingPrompt,
  Pile,
  pileWidthFor,
  Reconnect,
  type ReleaseSlots,
  ReleaseZone,
  Rules,
  Seat,
  Slider,
  type TableActions,
  TabRail,
  type TabRailItem,
  Toggle,
  TurnDock,
  Typography,
  useCardPreview,
} from '@release/ui'
import { HEAP_SHOW, restTransform } from '@release/ui/animations'
import type React from 'react'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
// The screen's geometry is the KIT's stylesheet, imported rather than copied:
// where every block sits, how big it is, what it overlaps. The board is a fork
// of @release/ui's Table and the playground is where this screen is designed
// and approved, so a second copy of those values would drift one at a time with
// nothing to catch it — a type check cannot see a position. `opening` holds only
// what the deal adds on top.
import kit from '@/table/Table/Table.module.css'
import { ATTACK_POSE, COVER_POSE, SUDO_POSE, useBoardAnchors } from '~/entities/game/board'
import type {
  BoardProps,
  HandLimitHandoff,
  Panel,
  StagedHandoff,
} from '~/entities/game/board/types'
import { useBeats, useEliminationPreload } from '~/features/board-beats'
import { useDealIntro } from '~/features/game-intro/useDealIntro'
import { useHandOrder } from '~/features/hand-order/useHandOrder'
import opening from './_Board.module.css'
import { useBoardInteractions } from './_useBoardInteractions'
import { useBoardStaging } from './_useBoardStaging'
import { useDefenseStaging } from './_useDefenseStaging'
import { useHandLimit } from './_useHandLimit'
import { useInsideStaging } from './_useInsideStaging'
import { useNeutralizeStaging } from './_useNeutralizeStaging'
import { useRequestStaging } from './_useRequestStaging'

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
}

// The board while the intro runs: nothing the player does may reach the game.
// One frozen object, so the gesture hook is not handed a new identity on every
// frame of the deal.
const INERT_ACTIONS: TableActions = {}

const cls = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ')

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
    <section className={kit.group}>
      {title && (
        <Typography as="div" base="tag" tk="tk-10" className={kit.groupHead}>
          {title}
        </Typography>
      )}
      {children}
    </section>
  )
}

// One settings unit — the single pattern shared by every control: a caption on
// top, the control, and an optional hint below. The control owns its own width
// (the spectator slider fills via .sliderFull).
function SettingsField({
  label,
  hint,
  children,
}: {
  label?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className={kit.field}>
      {label && (
        <Typography as="div" variant="metaLabel" className={kit.fieldLabel}>
          {label}
        </Typography>
      )}
      {children}
      {hint && (
        <Typography as="div" base="mono-xs" className={kit.fieldHint}>
          {hint}
        </Typography>
      )}
    </div>
  )
}

// Стол = активное состояние игры. Каждый блок позиционируется независимо
// (абсолютно), без жёсткой сетки. Заполняет экран без скролла.
export default function Board({
  state: liveRaw,
  room,
  copy,
  slots,
  over = null,
  actions: liveActions,
  dock,
  now,
  panel: panelProp,
  onPanelChange,
  intro,
}: BoardProps) {
  // ===== the opening =====
  // Every node a flight aims at or leaves from — the board's own registry, not
  // just the deal's. The shift the `hudIn` preset applies rides on `transform`,
  // so a block whose own transform holds its position (the seats' row, the
  // decks column) is animated through an INNER node — hence the wrappers below
  // rather than the positioned blocks themselves.
  const anchors = useBoardAnchors()

  // reading a card that stands at the centre — the shared block from the kit.
  // Five slots here (the release, its cost, the attack, the defender's sudo,
  // the cover), and each of them reads on its own.
  const { slotProps: previewProps, overlay: previewOverlay } = useCardPreview()

  // The player's own sort of their fan, applied to the projection BEFORE the
  // intro, the queue or the staging gesture see it — so every shadow a beat
  // publishes and every rect a flight measures already agrees with the fan on
  // screen. The engine has no hand order (it is a private, presentation fact),
  // which is why the overlay lives here and not in an action.
  const handOrder = useHandOrder(intro?.gameId ?? null)
  const live = useMemo(() => handOrder.arrange(liveRaw), [handOrder, liveRaw])

  // The blocks stay hidden from the FIRST committed frame until the intro is
  // over — not merely while it is `active`. `hudIn` only holds a block down
  // once its own animation exists, and the last of them is armed seconds in.
  const [introOver, setIntroOver] = useState(false)
  const onIntroDone = useCallback(() => {
    setIntroOver(true)
    intro?.onDone()
  }, [intro?.onDone])
  const deal = useDealIntro({
    live,
    gameId: intro?.gameId ?? null,
    view: intro?.view ?? null,
    events: intro?.events ?? [],
    refs: anchors,
    onDone: onIntroDone,
  })
  // The staging → beat handoff (#100): a ref because the combo beat reads it
  // once at run start (I8), not a render's worth of state it would have to
  // wait on. Built below, once `useBoardStaging` exists to build it FROM — but
  // declared here, ahead of `useBeats`, because the ref's IDENTITY is all the
  // queue needs at this point; the layout effect that keeps `.current` current
  // runs after every hook regardless of where it sits in the function.
  const handoffRef = useRef<StagedHandoff | null>(null)
  // The hand limit's own handoff (#104), a ref for the same reason `handoffRef`
  // is one: the beat reads it once at run start (I8), not a render's worth of
  // state it would have to wait on.
  const handLimitRef = useRef<HandLimitHandoff | null>(null)
  // The same seam's second fact (#101, Task 11): a stable ref to
  // `useBoardStaging`'s own `clearPaidCost`, for the same reason `handoffRef`
  // above is a ref rather than a direct value — declared here, ahead of
  // `useBeats`, kept current by the layout effect further down once `staging`
  // exists to read it FROM.
  const clearPaidCostRef = useRef<(() => void) | null>(null)
  // The same seam's third fact (#101, Fix A): a stable ref to
  // `useBoardStaging`'s own `takeStagedRelease`, for the same reason the two
  // above are refs. The placement beat calls it the instant it picks the
  // standing release up out of the stage slot, so the static render lets go in
  // the same commit its carrier goes up.
  const takeStagedReleaseRef = useRef<(() => void) | null>(null)
  // The board's own root — what the "a press on nothing valid cancels"
  // listeners below bind to, instead of `window` (#101, Fix C, finding 7).
  const tableRef = useRef<HTMLDivElement>(null)
  // One queue, for everything that moves. The opening goes in as beat zero and
  // the wire's own beats queue behind it — one place that decides what plays,
  // in what order, and whether it plays at all under prefers-reduced-motion.
  //
  // `enabled` gates only the WIRE's beats, not the opening: until the deal is
  // over, the events that produced the board's first projection are the deal's
  // own, and replaying them as discards would fly cards that never left a hand
  // on screen.
  const beats = useBeats({
    live,
    events: intro?.events ?? [],
    anchors,
    enabled: introOver || intro == null,
    intro: deal.beat,
    staging: handoffRef,
    handLimit: handLimitRef,
    clearPaidCost: clearPaidCostRef,
    takeStagedRelease: takeStagedReleaseRef,
  })
  const entering = intro != null && !introOver
  const enter = entering ? opening.enter : undefined
  // While the deal runs the board renders its shadow of the projection, and
  // afterwards a beat renders its own. The shadow's last frame IS the
  // projection, so either handover changes nothing on screen — provided nothing
  // here keys off `introPhase`, and nothing does. The deal wins the tie: it is
  // the only shadow that exists before the queue is even armed.
  const state = deal.shadow ?? beats.shadow ?? live
  // Only the opening freezes the table. A discard is a thing that HAPPENED, not
  // a thing being decided, so the fan stays live while one flies out
  // (docs/animations/README.md — "Gating the hand", approach 3); `exclusive` is
  // the queue's own answer, and today nothing but the opening sets it.
  // The elimination clips are fetched at idle once the match is actually being
  // played — not while the opening is still running, which is the one stretch
  // where the board has real work to do and nothing can be eliminated yet
  // (#126 review). Never at app start: initial load does not pay for these
  // today, and a clip that may never be needed should not change that.
  useEliminationPreload(!deal.active)

  const actions = deal.active || beats.exclusive ? INERT_ACTIONS : liveActions

  const { you, opponents, decks, turn, history, setup } = state
  const derived = deriveDock(state, state.selfId, now)
  // Nobody is on turn during the opening: the dock stands in its waiting state
  // and names the moment where it would name a player.
  const dockView: DockView = deal.active
    ? { state: 'waiting', danger: false, seconds: 0, progress: 0, activePlayer: undefined }
    : { ...derived, ...dock }
  const dockCopy = deal.active
    ? { ...copy.turnDock, turnOf: copy.turnDock.gameStart }
    : copy.turnDock
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

  // gesture machine: turns clicks into completed intents. Legality is always
  // the engine's answer (state.playable / state.targets) — Table only renders
  // what the hook decided, never re-derives it.
  const gestures = useBoardInteractions({ state, actions })

  // the staging gesture: pulling a card that needs a target out of the fan —
  // stands it at the centre, aims the arrow, dispatches on a lit target. Inert
  // under the same gate the click actions already have: the deal or an
  // exclusive beat owns the table.
  const staging = useBoardStaging({
    state,
    anchors,
    actions,
    events: intro?.events ?? [],
    enabled: !(deal.active || beats.exclusive),
    // the match boundary (#101, Fix C, finding 3) — `<Board>` is not remounted
    // for a rematch, so the gestures need the same wipe `useBeats` already
    // takes on this key.
    //
    // KNOWN INERT ON THIS BRANCH, AS OF 2026-08-20 (#101, Fix D, finding 3):
    // `intro.gameId` is `session.gameId`, which `useLobby.ts` sets to the HOST'S
    // PEER ID — the same value for every match played in one room — so the wipe
    // this arms never fires on a rematch. That is a fact about this branch, not
    // a rule: in-place rematch work (#19) gives each match its own id, and this
    // line then starts working as written with nothing here to change. `useBeats` (above) hangs on the same value and has the same
    // hole. Left as it is rather than half-fixed: a key that really changes per
    // match has to be minted where the match is (`startGame`) and carried on
    // `GAME_STARTING`, so every peer agrees on it, which is a session-layer
    // change this branch should not make blind. Recorded in
    // `docs/animations/backlog.md` and the audit register.
    matchKey: intro?.gameId ?? null,
  })

  // a `defend` pending owed to us means the defence hook owns the fan instead
  // of the turn hook — the two never run at once (the engine suspends normal
  // play while a window/pending is open), and this is the ONE derived
  // constant every call site below picks a hook by, rather than repeating the
  // condition at each one.
  const answering = state.pending?.kind === 'defend' && state.pending.player === state.selfId
  // the defence gesture (#101, Task 16): pulling a legal defence out of the
  // fan drops it over the attack and answers the pending at once. Same
  // `enabled` gate as the turn hook — the hook's own `pending` read is what
  // keeps it inert the rest of the time.
  const defenseStaging = useDefenseStaging({
    state,
    anchors,
    actions,
    events: intro?.events ?? [],
    enabled: !(deal.active || beats.exclusive),
    matchKey: intro?.gameId ?? null,
  })
  // the hand limit owed to US means this hook owns the fan (#104) — a third
  // owner beside `answering` and the turn hook, and the three can never
  // overlap: `state.pending` is one slot.
  const discarding = state.pending?.kind === 'handLimit' && state.pending.player === state.selfId
  const handLimit = useHandLimit({
    state,
    anchors,
    actions,
    events: intro?.events ?? [],
    enabled: !(deal.active || beats.exclusive),
    matchKey: intro?.gameId ?? null,
    onReturned: (uid, slot) => {
      const item = you.hand.find((card) => card.uid === uid)
      if (!item) return
      // The card never left `you.hand`, so this is a placement, not an
      // arrival: rebuild the fan as it will look with the card back at the
      // slot the pointer named, and commit that order.
      const visible = [...handLimit.handItems]
      visible.splice(slot, 0, item)
      handOrder.commit(you.hand, visible, uid, slot)
    },
  })
  // The alarm standing at the centre. Read ONCE, same reason and same shape as
  // `pendingDefend` above. `staging.staged` does not gate it: an answer to a
  // 503 goes to the COVER slot, never over the alarm's own.
  const pendingAlarm = state.pending?.kind === 'neutralize503' ? state.pending : null
  const alarmMine = pendingAlarm?.player === state.selfId
  // The AI card a prompt belongs to — `source` on `crush`, `neutralize503`,
  // `handLimit` and `pickFromDiscard`, and only those four: the rest of
  // `TablePending`'s union does not declare the field at all, so the `in`
  // check is what narrows to the branches that do, rather than an optional
  // chain TS would refuse across the wider union. Public on all four: the
  // whole table watched the card be revealed, so every peer stands the same
  // one.
  //
  // `pickFromDiscard`'s `source` is not always an AI card, though:
  // `operation-git-cherry-pick` raises the same pending kind and is a base-deck
  // Operation, not an events-deck draw. Standing it here would put Cherry-pick
  // in the AI pair's own slot, which is not where its own visible card goes —
  // so this only stands a source whose catalogue entry is genuinely
  // `deck === 'ai'`, which leaves Cherry-pick to render nowhere here (it has
  // no dedicated slot of its own on this branch).
  const pendingSource = state.pending && 'source' in state.pending ? state.pending.source : null
  const pendingSourceCard = pendingSource ? (cardById(pendingSource) ?? null) : null
  const aiStanding = pendingSourceCard?.deck === 'ai' ? pendingSourceCard : null
  // …or a sweep is running, which is the defenceless path's own alarm: it
  // raises no `pending` at all (the engine eliminates in the same batch as
  // the reveal), so without this the hand would fly away with nothing on
  // screen explaining it.
  const glowStrong = (pendingAlarm != null && alarmMine) || beats.alarm
  // an Error 503 owed to US means the neutralize hook owns the fan and the
  // zone — the third staging hook, and the third mutually exclusive one: the
  // engine suspends normal play while a pending is open, and a pending has one
  // kind, so `answering` and this can never both be true. Same derived-constant
  // discipline as `answering` above: read once, picked by at every call site.
  const alarmMineOpen = pendingAlarm != null && alarmMine

  // the 503 gesture (#102, Task 9): the card that performs the answer is the
  // card you touch — a Debugger pulled out of the fan, a release dragged out of
  // your own zone, or the standing Monitoring pressed where it is.
  const neutralizing = useNeutralizeStaging({
    state,
    anchors,
    actions,
    events: intro?.events ?? [],
    enabled: alarmMineOpen && !(deal.active || beats.exclusive),
    matchKey: intro?.gameId ?? null,
  })

  // naming a card, and losing one (#105). The band replaces the panel for
  // `requestCard`; the `giveCard` half answers itself and renders nothing.
  const requesting = useRequestStaging({
    state,
    actions,
    copy: {
      prompt: copy.pending.requestCard.prompt,
      action: copy.pending.requestCard.action,
      confirm: copy.pending.confirm,
    },
    enabled: !(deal.active || beats.exclusive),
    matchKey: intro?.gameId ?? null,
  })
  // taking a Release back out of the discard (#106, `ai-inside`) — the row
  // over the discard replaces the panel, the same way the band above
  // replaces it for `requestCard`. No `matchKey`: the row's own local state
  // clears itself the moment this hook stops holding an ours-`pickFromDiscard`
  // pending, which happens whenever the pending resolves or changes kind —
  // and it always does before a second one of the same kind can open.
  const inside = useInsideStaging({
    state,
    actions,
    copy: { prompt: copy.table.insidePrompt, confirm: copy.pending.confirm },
    enabled: !(deal.active || beats.exclusive),
  })
  // the answer once its own flight has landed (or at once under reduced
  // motion) — the same gate, and the same reason, as `stagedCover` above.
  const stagedNeutralize =
    alarmMineOpen &&
    neutralizing.landed &&
    neutralizing.overlay.length === 0 &&
    !neutralizing.staged?.handed
      ? neutralizing.staged
      : undefined

  // the defence once its own flight has landed (or at once, under reduced
  // motion) — gates the static cover render below against the carrier still
  // flying it there, the same reason `stagedRelease` waits for the stage
  // machine to reach `standing` (`stageStanding`).
  // `handed` is the beat saying "the exit owns this card now" — the slot must
  // clear even though the play is still staged, because the staging is what
  // keeps the card out of the fan until the projection catches up
  // (`_useDefenseStaging`'s own `release()`).
  const stagedCover =
    answering &&
    defenseStaging.landed &&
    defenseStaging.overlay.length === 0 &&
    !defenseStaging.staged?.handed
      ? defenseStaging.staged?.main
      : undefined
  // the Sudo that folded into it (Task 17) — same gate as `stagedCover`, read
  // alongside it so the cover slot's render (below) can tell a plain defence
  // from a sudo-backed pair without a second read of `defenseStaging.staged`.
  const stagedCoverSudo =
    answering &&
    defenseStaging.landed &&
    defenseStaging.overlay.length === 0 &&
    !defenseStaging.staged?.handed
      ? defenseStaging.staged?.support
      : undefined
  // the defender's own Sudo, waiting at its own slot for the defence it will
  // enhance (Task 17) — gated on `sudoLanded` the same way `stagedCover` is
  // gated on `landed`, and on `phase === 'partner'` so it disappears the
  // instant a fold commits (the no-duplicate rule: the fold's own commit
  // clears `phase` away from 'partner' in the SAME tick the flyer's aux mounts).
  const stagedSudo =
    answering &&
    defenseStaging.staged?.phase === 'partner' &&
    defenseStaging.sudoLanded &&
    defenseStaging.overlay.length === 0
      ? defenseStaging.staged.support
      : undefined
  // its own node, for the staging → beat handoff below — the static cover
  // render, once it lands, is what `defenseBeat.runCovered` finds already
  // standing where the cover goes (Task 16's own report: Carry #2).
  const coverStagedRef = useRef<HTMLDivElement>(null)
  // the fan's own gap-while-a-return-flight-travels, from whichever hook is
  // live — `Hand`'s own gapAt/gapSize props fold this in below, behind the
  // deal's and the beat queue's own (unrelated) gaps.
  const liveGapAt = discarding
    ? handLimit.gapAt
    : answering
      ? defenseStaging.gapAt
      : alarmMineOpen
        ? neutralizing.gapAt
        : staging.gapAt
  const liveGapSize = discarding
    ? handLimit.gapSize
    : answering
      ? defenseStaging.gapSize
      : alarmMineOpen
        ? neutralizing.gapSize
        : staging.gapSize

  // the ONE card standing at the centre before a partner folds in — a plain
  // aim (`main`) or a support awaiting one (`support`). Once merged the pair
  // flyer owns the centre instead (see `opening.pairFlyer` below). A solo
  // release is excluded on purpose: `_useBoardStaging` stages it too (so the
  // fan hides it and a rejection returns it, the same as any other pull), but
  // it belongs at the STAGE slot, not here — `stagedRelease` below renders it
  // there, off the projection's own pending rather than off `staged`.
  const soloStaged =
    staging.staged && !staging.staged.merged && staging.staged.main?.card.category !== 'release'
      ? (staging.staged.support ?? staging.staged.main)
      : null
  // its own node, for the staging → beat handoff below — a plain aim/support
  // never merges, so it never gets the pair flyer's persistent node instead.
  const soloStagedRef = useRef<HTMLDivElement>(null)

  // The card the arrow leaves FROM, whichever hook armed it — a waiting
  // support if there is one, the aimed card otherwise. Its category is the
  // arrow's hue (#101, Fix B, Defect 5): the defence side only ever aims with
  // the Sudo, which is how it comes out as the scene's own `--cat-support`
  // without naming that token here.
  const aimingCard = answering
    ? defenseStaging.staged?.support?.card
    : (staging.staged?.support ?? staging.staged?.main)?.card
  const arrowColor = aimingCard ? `var(--cat-${aimingCard.category})` : undefined

  // the pending "defend" the attack slot answers for — read ONCE so the hover
  // preview below and the paint further down can never drift on what counts
  // as "occupying" the slot. `staging.staged` wins over a pending: the two can
  // only coincide for the instant between the local attacker's own dispatch
  // and the layout effect below collapsing it, and both readers now resolve
  // that tie the same way because they read the same value.
  const pendingDefend = !staging.staged && state.pending?.kind === 'defend' ? state.pending : null

  // the release standing at the stage slot while its cost is unpaid — read
  // ONCE, same reason as `pendingDefend` above, and its OWNERSHIP stated here
  // explicitly rather than leaned on the engine's own redaction of `.release`
  // the way the pre-fix render did: without the `player` check, an opponent's
  // own `discardForRelease` would still assign to this const (with `.release`
  // simply absent), which happens to resolve to nothing below only because
  // the redaction is doing that work silently — the same two-readers-drift
  // class already fixed once on this branch (see `pendingDefend`'s own note).
  const costPending =
    state.pending?.kind === 'discardForRelease' && state.pending.player === state.selfId
      ? state.pending
      : null
  // The staging gesture's OWN idea of the standing release — the same card
  // `onHandPlay` committed the instant it was pulled, kept (in `staging`)
  // until the projected pending arrives. `costPending` above is the canonical
  // source once it exists, but it is a network round trip away: on a fast
  // connection (the host peer's own can be near-instant) it can lag behind
  // the LOCAL flight that carries the release here, and on a slow one it can
  // arrive well after that flight has already landed — without this fallback
  // the slot would show nothing for that whole gap.
  const stagedReleaseLocal =
    staging.staged?.phase === 'dispatched' &&
    !staging.staged.support &&
    staging.staged.main?.card.category === 'release'
      ? staging.staged.main
      : undefined
  // `stageStanding` gates BOTH sources at once, and is the whole question:
  // is the actor's own release standing at this slot right now? Neither source
  // above can answer it, because both are a network round trip behind — the
  // projected pending stays exactly as it is while a carrier flies the card in
  // (the pull), out to the fan (a cancel) or out to the zone (the placement
  // beat), and a render keyed on the pending alone would draw a second copy of
  // the card under the carrier already holding it, once per direction.
  //
  // It used to be three separate booleans asked together (#101, Fix C, finding
  // 5): `stageLanded && !releaseReturning && !releasePlacing`, one per round
  // that added a flight. They were reset only on a SOLO release's own pull, so
  // a Code Review combo — which stands its release at the centre instead —
  // inherited whatever the last one left, and could draw its release here as
  // well as in the pair. `_useBoardStaging.ts` now keeps one `StageState`
  // that every play sets, so there is nothing left to inherit and one thing to
  // ask.
  // Whether the fan is closed to the pointer — read ONCE, so the style and the
  // mousedown guard that go with it can never drift (the same discipline
  // `pendingDefend` and `costPending` above are read once for). See the hand
  // wrapper below for what each half of it is.
  const handInert = Boolean(staging.staged?.merged) && staging.costOptions.length === 0

  const stagedRelease = staging.stageStanding
    ? ((costPending ? you.hand.find((c) => c.uid === costPending.release) : undefined) ??
      stagedReleaseLocal)
    : undefined

  // The staging → beat handoff (#100): kept current in a layout effect,
  // because `el` has to be the DOM node as THIS render actually committed it —
  // the pair flyer once a partner has folded in, the solo staged node
  // otherwise. `release` is the hook's own no-flight clear; the combo beat
  // calls it once its own read of this says the staged play is the one
  // standing where it is about to fold one in (I8).
  //
  // One ref, whichever hook is live (#101, Task 16): `answering` picks the
  // source the same way every other call site does, so `defenseBeat.runCovered`
  // reads OUR defence's own handoff for a `covered` beat, never a stale one
  // left over from the turn hook. `coverStagedRef` only binds once
  // `defenseStaging.landed` is true (both deps below), so `el` is non-null
  // exactly when the static cover render is what is actually standing there —
  // never a flyer that a reduced-motion path never raised (Carry #2).
  //
  // `defenseStaging.landed`/`.overlay` do not appear inside this effect's own
  // body — biome's static check reads them as removable — but they are what
  // makes it RE-RUN once `coverStagedRef.current` actually binds: `landed`
  // flips true (and `overlay` drops back to `[]`) on the SAME render the
  // static cover child mounts, and only a re-run of this effect, AFTER that
  // commit, ever reads the ref's freshly-bound value. Dropping either
  // dependency leaves `handoffRef.current.el` stuck at whatever it was the
  // last time `staged`/`release` changed identity — typically null, from the
  // instant right after the pull, before the ref had anything to bind to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: landed/overlay gate a ref read, not a value the effect body itself references
  useLayoutEffect(() => {
    // The DEFENCE's own dispatched play claims the handoff first, and is asked
    // about before `answering` rather than inside it (#101, Fix D round 4). The
    // commit that carries the engine's answer renders `live` — `beats.shadow` is
    // not set until the beat starts — so `answering` flickers false for exactly
    // that one commit, and keying the branch on it wrote `null` here from the
    // TURN side, which has nothing staged while a pending is open. A beat
    // planned on the next commit would then read no handoff at all and treat our
    // own defence as a rejoin, flying it in from the fan. Asking "does the
    // defence gesture have a dispatched play" cannot flicker: it is the hook's
    // own state, and it now survives that commit (`_useDefenseStaging`'s
    // catch-up waits for its carrier). The two hooks are never both staged —
    // the engine suspends normal play while a pending is open — so this cannot
    // steal the turn side's handoff either.
    const answeringStaged = defenseStaging.staged
    if (answeringStaged?.phase === 'dispatched' && answeringStaged.main) {
      handoffRef.current = {
        mainUid: answeringStaged.main.uid,
        supportUid: answeringStaged.support?.uid,
        el: coverStagedRef.current,
        release: defenseStaging.release,
      }
      return
    }
    // OUR OWN 503 answer claims it next (#102, Task 9), on the same terms:
    // `defenseBeat.runNeutralized` reads this to know the answer is already
    // standing at the cover slot (so it does not fly a second copy in), and
    // calls `release()` through it the instant it takes the exchange over.
    // Monitoring stages nothing — it answers from where it stands — so there
    // is nothing to hand over and this stays null for it, which is exactly
    // what the beat's own `!(mine && handoff)` check wants.
    if (alarmMineOpen) {
      const nz = neutralizing.staged
      handoffRef.current = nz
        ? {
            mainUid: nz.home.kind === 'hand' ? nz.home.uid : (you.releaseUid?.[nz.home.slot] ?? ''),
            el: coverStagedRef.current,
            release: neutralizing.release,
          }
        : null
      return
    }
    if (answering) {
      const ds = defenseStaging.staged
      handoffRef.current =
        ds?.phase === 'dispatched' && ds.main
          ? {
              mainUid: ds.main.uid,
              supportUid: ds.support?.uid,
              el: coverStagedRef.current,
              release: defenseStaging.release,
            }
          : null
      return
    }
    const s = staging.staged
    handoffRef.current =
      s?.phase === 'dispatched' && s.main
        ? {
            mainUid: s.main.uid,
            supportUid: s.support?.uid,
            el: s.merged ? staging.pairRef.current : soloStagedRef.current,
            release: staging.release,
          }
        : null
  }, [
    answering,
    defenseStaging.staged,
    defenseStaging.landed,
    defenseStaging.overlay,
    defenseStaging.release,
    alarmMineOpen,
    neutralizing.staged,
    neutralizing.landed,
    neutralizing.overlay,
    neutralizing.release,
    you.releaseUid,
    staging.staged,
    staging.pairRef,
    staging.release,
  ])

  // The grid, offered to the beat exactly while there IS one to take: the
  // RESOLVE is out (so the grid is complete and locked) and the cells are still
  // standing. `release()` is how the beat drops that render; the picked cards
  // stay out of the fan until the pending itself clears.
  useLayoutEffect(() => {
    handLimitRef.current =
      handLimit.dispatched && handLimit.placed.length > 0
        ? {
            player: state.selfId,
            cards: handLimit.placed,
            cellAt: handLimit.cellAt,
            release: handLimit.release,
          }
        : null
  }, [handLimit.dispatched, handLimit.placed, handLimit.cellAt, handLimit.release, state.selfId])

  // The same seam's second fact (#101, Task 11): `clearPaidCostRef` kept
  // current the same way `handoffRef` above is. `staging.clearPaidCost` is
  // stable for the life of the mount (a `useCallback` with no deps), so this
  // effect fires once and never again in practice — it exists for the same
  // structural reason `handoffRef`'s does, not because the value actually
  // changes.
  useLayoutEffect(() => {
    clearPaidCostRef.current = staging.clearPaidCost
  }, [staging.clearPaidCost])

  // …and the third (#101, Fix A), for exactly the same structural reason:
  // `staging.takeStagedRelease` is stable for the life of the mount, so this
  // fires once.
  useLayoutEffect(() => {
    takeStagedReleaseRef.current = staging.takeStagedRelease
  }, [staging.takeStagedRelease])

  // Escape skips the opening. Same window binding and the same reason as the
  // cancel above; `finish` is idempotent, so a second press is a no-op.
  const dealFinish = deal.finish
  useEffect(() => {
    if (!deal.active) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dealFinish()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deal.active, dealFinish])

  // Escape cancels a staged card the same way a miss on the table does —
  // armed only while there is something to cancel (I8: a press after the play
  // already dispatched must not turn into a return flight). Widened to a
  // release awaiting its cost too (#101, Task 9): `staging.staged` is already
  // null by the time `staging.costOptions` is populated — the catch-up effect
  // in `_useBoardStaging.ts` clears it the moment the pending echoes back —
  // so the release's own window has nothing else to key its arming off.
  useEffect(() => {
    const armed = staging.staged ?? staging.costOptions.length > 0
    if (!armed || staging.dispatched) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') staging.cancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [staging.staged, staging.dispatched, staging.costOptions.length, staging.cancel])

  // A release awaiting its cost has no `staging.staged` to key a click-based
  // miss off (see the Escape effect above) — so its own "changed my mind" is a
  // dedicated `mousedown` listener instead, ported from the approved source
  // (`DefenseReleaseStory`'s own `cancelStaged`/mousedown effect): the fan's
  // own pull gesture starts on mousedown too, so the press this has to ignore
  // is the SAME event a drag begins on, not the click that follows it. Kept
  // separate from `handleTableClick` below (rather than widened into it) so a
  // single physical press cannot fire `staging.cancel()` twice over — once
  // from this listener, once from the click that follows the same press —
  // and race `onResolve`/`arrival.arrive` against themselves.
  //
  // Bound to the TABLE, not to `window` (#101, Fix C, finding 7): a press has
  // to land on the board to read as "changed my mind about a card on the
  // board". On `window` it also caught anything portalled ABOVE the board —
  // a dialog, an overlay, a future toast — and silently cancelled a staged
  // card behind it. The rail and the drawer are inside the table root, so they
  // still count as a miss, which is what they were always meant to be.
  useEffect(() => {
    const root = tableRef.current
    if (!root || staging.costOptions.length === 0) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('[data-hand-slot]')) return
      staging.cancel()
    }
    root.addEventListener('mousedown', onMouseDown)
    return () => root.removeEventListener('mousedown', onMouseDown)
  }, [staging.costOptions.length, staging.cancel])

  // A Sudo waiting for the defence it will enhance has no aimed target to
  // click (Task 17) — the same "changed my mind" shape as a release awaiting
  // its cost above, for the same reason: the fan's own pull gesture starts on
  // mousedown too, so the press this has to ignore is the SAME event a drag
  // begins on, not the click that follows it (the approved source's own
  // `cancelStaged`/mousedown effect). Kept separate from `handleTableClick`
  // below (rather than folded into its `answering` branch) for the identical
  // reason the cost listener is: a single physical press must not fire
  // `defenseStaging.cancel()` twice over.
  // Bound to the table root for the same reason the cost listener above is.
  useEffect(() => {
    const root = tableRef.current
    if (!root || defenseStaging.staged?.phase !== 'partner') return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('[data-hand-slot]')) return
      defenseStaging.cancel()
    }
    root.addEventListener('mousedown', onMouseDown)
    return () => root.removeEventListener('mousedown', onMouseDown)
  }, [defenseStaging.staged?.phase, defenseStaging.cancel])

  // Escape cancels a staged defence the same way a miss on the table does —
  // see `handleTableClick`'s own `answering` branch below. Task 16's plain
  // path commits and dispatches in the same tick (no cancellable aim phase),
  // so this is armed only for the brief span between a rejection and
  // `cancel()`'s own return flight taking over (`defenseStaging.cancel`'s own
  // guard refuses anything still `phase: 'dispatched'`). A waiting Sudo
  // (Task 17) is covered too — nothing here excludes `phase: 'partner'`.
  useEffect(() => {
    if (!answering) return
    const s = defenseStaging.staged
    if (!s || s.phase === 'dispatched') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') defenseStaging.cancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [answering, defenseStaging.staged, defenseStaging.cancel])

  // The dock's own key under an unpaid release (#101). The scene already has
  // one rule for this: while an unpaid release stands, anything other than
  // paying takes it back — a press on the table does exactly that. DRAW and
  // PUSH are presses like any other, so the first one takes the release back
  // and the next one does what the key says. That is why the dock keeps the
  // turn's own phase and a live key rather than a state of its own: the action
  // behind the key IS legal, it just costs the staged release first.
  //
  // Two presses rather than one combined "cancel and draw": the engine has to
  // see the cancel commit before it will accept a DRAW, and the card's own
  // return flight belongs to the first press. Firing both here would race the
  // flight against a projection that has already moved on.
  const dockKey = (act: (() => void) | undefined) => {
    if (staging.costOptions.length > 0) {
      staging.cancel()
      return
    }
    act?.()
  }

  // A click that lands outside any hand slot while a card is staged reads as
  // "changed my mind" — cancel. Clicks that land on a lit target already
  // resolve through onTargetPick before bubbling here (I8's own guard in
  // `useBoardStaging` makes that safe even where the target itself does not
  // stop propagation); clicks inside the hand are the fan's own business.
  const handleTableClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (deal.active) {
      dealFinish()
      return
    }
    if (answering) {
      const s = defenseStaging.staged
      // 'partner' (Task 17) is the mousedown listener's own — see above,
      // which exists specifically so a single physical press cannot fire
      // `defenseStaging.cancel()` from both places over one click.
      if (!s || s.phase === 'dispatched' || s.phase === 'partner') return
      const target = e.target as HTMLElement
      if (target.closest('[data-hand-slot]')) return
      defenseStaging.cancel()
      return
    }
    if (!staging.staged || staging.dispatched) return
    const target = e.target as HTMLElement
    if (target.closest('[data-hand-slot]')) return
    staging.cancel()
  }

  // What the table is waiting on, in words, and where the words go (#101,
  // Fix B). Two steps ask the fan for a card and neither had a voice: the
  // release's cost, whose panel is suppressed on purpose (a panel would be a
  // second asker), and — from this round — the `defend`, whose panel used to
  // cover the very attack it was asking about. The ask is its own line under
  // the centre instead, quoting the approved scene's own placement: "the ask
  // sits with the cards, not only in the dev bar — a release parked at the
  // centre with no explanation reads as a stuck play."
  //
  // The scene's own COPY is deliberately not ported: it says "pull any of
  // them out of the hand", and a pull is impossible here — the engine returns
  // no playable cards while a pending is open, so the pull finds no target
  // and the card flops back into the fan. On the board the cost is a click.
  //
  // A defend is not ONE step, which the first cut of this missed (fix round 1,
  // M1): a Sudo standing at its own slot is answered by CLICKING the defence
  // it will enhance, and a pull there is refused outright (`resolveLegal` and
  // `resolveSudo` both bail while anything is staged). So the phase picks the
  // words — same discipline as not porting the scene's cost line, applied to
  // a state this round is what newly lights. Silence was the other option and
  // is the wrong one: a step waiting on the fan with nothing saying so is
  // Defect 3 itself, one level in.
  //
  // `undefined` here means we are not answering at all; `null` means we are
  // and nothing is staged yet.
  const defencePhase = answering ? (defenseStaging.staged?.phase ?? null) : undefined
  // Still ours to decide. A dispatched defence (or one in the instant between
  // a rejection and its return flight) has already answered, so nothing is
  // being asked and nothing may be offered — the standard `dock.ts` states for
  // its own keys: offered only where the action behind it is legal RIGHT NOW.
  const unanswered = answering && defencePhase !== 'dispatched' && defencePhase !== 'rejected'
  let ask: string | null = null
  if (unanswered) {
    ask = defencePhase === 'partner' ? copy.table.askPartner : copy.table.askDefend
  } else if (costPending) {
    ask = copy.table.askCost
  } else if (discarding && handLimit.owed > 0) {
    ask = copy.table.askHandLimit
  } else if (alarmMineOpen && !neutralizing.staged && !neutralizing.answered) {
    // a step waiting on the fan AND on the zone, with the panel suppressed
    // below, is silent without this — Defect 3 (#101, Fix B) one pending over.
    ask = copy.table.askNeutralize
  }
  // The line keeps the words it faded IN with while it fades back OUT — an
  // empty pill mid-fade reads as a flicker. Written during render on purpose:
  // it is a pure carry-forward of this render's own value, so a StrictMode
  // double render produces the identical result.
  const lastAsk = useRef<string | null>(null)
  if (ask) lastAsk.current = ask

  // Declining an attack — "I could block this and I choose not to". The only
  // thing `PendingPrompt` did for a `defend` that the fan does not do, so it
  // is the only thing that outlived it here. A real button, so it is the one
  // affordance in this exchange a keyboard can reach.
  //
  // Offered exactly while `unanswered` (fix round 1, L1) — the panel had no
  // such gate and neither did the first cut of this, so between a defence's
  // dispatch and the projection clearing the pending it could fire a second
  // RESOLVE onto a decision that is already closing. A waiting Sudo is NOT
  // excluded: nothing has been dispatched there, so declining is legal, and
  // it already does the right thing — the partner-phase mousedown listener
  // above sends the Sudo home on the very press that fires this.
  const declineAttack = () => actions?.onResolve?.({ kind: 'defend', card: null })

  const isHost = role === 'host'
  // секция управления хоста в настройках: лимит зрителей и/или пауза игры
  const canLimitSpectators = isHost && Boolean(onSpectatorLimitChange) && spectatorLimit != null
  const canPause = isHost && Boolean(onPauseChange) && Boolean(copy.table.pauseGame)
  const hostControls = canLimitSpectators || canPause
  const hasUpperSettings = Boolean(lang && onLangChange) || Boolean(code)

  // текстовые вкладки рейла (порядок = сверху вниз), подписи — по языку
  const textTabs: TabRailItem[] = [
    { id: 'history', label: copy.table.tabHistory },
    { id: 'participants', label: copy.table.tabParticipants },
    { id: 'rules', label: copy.table.tabRules },
    { id: 'modes', label: copy.table.tabModes },
  ]

  // квадратная вкладка «настройки» (шестерёнка) — когда есть что показать
  // (свитчер языка и/или код игры); служебный слот под визуальные опции
  const hasSettings = Boolean(onLangChange) || Boolean(code) || Boolean(hostControls)
  const railItems: TabRailItem[] = hasSettings
    ? [{ id: 'settings', label: copy.table.settings, icon: <GearIcon /> }, ...textTabs]
    : textTabs

  // завершение партии — оверлей поверх стола (триггерится извне)
  // The end is announced once the board has finished SHOWING how it was reached
  // (#103). The engine settles an elimination and the win it caused in one
  // reduction (`fake/triggers.ts`: `eliminated`, its discards, then `gameOver`),
  // so `over` is true the instant that batch lands — while the sweep and the
  // elimination clip are still queued. And `over` rides beside the projection
  // rather than inside it (`toBoardOver` — it hangs off the props, not off
  // `BoardState`), so the shadow every other visible fact is held back by does
  // not cover it and there is nothing to derive this from: the queue has to say
  // so itself. Under prefers-reduced-motion nothing is queued, so nothing is
  // held back — the board goes straight to its end, the same answer the clip
  // gets.
  const overShown = over && !beats.running && !deal.active
  const overWinner = overShown ? participants.find((p) => p.id === over.winnerId) : null
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
    // biome-ignore lint/a11y/noStaticElementInteractions: click-anywhere-skips-the-opening AND click-anywhere-cancels-staging (handleTableClick owns both); the accessible affordance for each is its own Escape handler above
    <div
      className={kit.table}
      ref={tableRef}
      onClick={handleTableClick}
      role="presentation"
      data-testid="board-table"
    >
      {/* the table's own ambience — a layer, so the opening can bring it in
          whole without touching the screen's base fill */}
      <div className={cls(opening.bgWrap, enter)} ref={anchors.bg}>
        <HudBackground tone="neutral" className={kit.bgLayer} />
      </div>
      {/* one arrow, whichever hook is live (#101, Task 17) — `answering` picks
          the source the same way every other call site in this file does; the
          turn hook's own arrow stays wherever it last pointed while a defend
          pending suspends it, unread while `answering` is true.

          Its hue says what KIND of card is aiming (#101, Fix B) — the same
          thing the approved scene says with a literal
          `color="var(--cat-support)"`, read off the card actually standing
          rather than hardcoded, since the turn side aims with every category
          there is. No card standing means no arrow to colour, and Arrow's own
          default takes over. */}
      <Arrow
        from={answering ? defenseStaging.arrow.from : staging.arrow.from}
        to={answering ? defenseStaging.arrow.to : staging.arrow.to}
        color={arrowColor}
      />

      {slots?.banner && <div className={kit.banner}>{slots.banner}</div>}
      {slots?.corner && <div className={kit.corner}>{slots.corner}</div>}

      {/* the seats: each in its own wrapper, so the opening can drop them in one
          after another and the deal can aim a card at the seat it belongs to */}
      <div className={kit.opponents} ref={anchors.seats}>
        {opponents.map((p) => {
          const eliminated = Boolean(p.eliminated)
          const disconnected = disconnectedIds.has(p.id)
          // выбыл → карты в сброс: пустая зона релиза, рука = 0
          const shown = eliminated ? { ...p, handCount: 0, release: EMPTY_RELEASE } : p
          return (
            <div
              key={p.id}
              className={enter}
              ref={(el) => {
                anchors.bindSeat(p.id, el)
              }}
            >
              <Seat
                player={shown}
                active={turn === p.id}
                eliminated={eliminated}
                disconnected={disconnected}
                copy={copy.seat}
                support={p.support}
                slotRef={(key, el) => anchors.bindReleaseSlot(p.id, key, el)}
                onPick={(t) => staging.onTargetPick(t)}
                targets={staging.targets}
              />
            </div>
          )
        })}
      </div>

      <div className={kit.decks}>
        <div className={cls(opening.deckStack, enter)} ref={anchors.decks}>
          <div className={opening.pileRow}>
            {decks.main.map((count, i) => (
              <Pile
                // biome-ignore lint/suspicious/noArrayIndexKey: a pile IS its index — the engine names it that way in `drawn.pile`, and a split leaves the halves where the pile was
                key={i}
                label={copy.table.deck}
                deck="base"
                count={count}
                width={pileWidthFor(decks.main.length)}
                countPos="tl"
                boxRef={(el) => anchors.bindPile(i, el)}
              />
            ))}
          </div>
          {/* Pile has a closed prop list — no arbitrary attribute passes
              through it — so the events pile's card box is a wrapping node
              instead of `boxRef` on the pile itself (matching the discard
              pile's own `boxRef` would leave nothing here for a test, or a
              future flight, to find by attribute). */}
          <div ref={anchors.eventsBox} data-events-box>
            <Pile
              label={copy.table.events}
              deck="ai"
              count={decks.events}
              width={150}
              countPos="tl"
            />
          </div>
        </div>
      </div>

      {/* сброс — наброшенная куча, как на столе: видны верхние карты, под ними
          «глубина» стопки, счётчик показывает весь сброс */}
      <div className={kit.discard}>
        <div className={enter} ref={anchors.discard}>
          <Pile
            label={copy.table.discard}
            heap={decks.discardHeap}
            heapShow={HEAP_SHOW}
            topCard={decks.discard}
            count={decks.discardCount}
            width={116}
            boxRef={anchors.discardBox}
          />
        </div>
      </div>

      {/* the release stands here and does NOT land — by the rules it costs one
          card, and the cost is shown open beside it. Only then does it settle
          into its zone slot and the attack window opens. */}
      <div
        className={opening.stageSlot}
        data-centre-slot="stage"
        ref={anchors.stage}
        {...previewProps(stagedRelease?.card ?? null)}
      >
        {stagedRelease && <Card card={stagedRelease.card} interactive={false} width="100%" />}
      </div>
      <div
        className={opening.costSlot}
        data-centre-slot="cost"
        ref={anchors.cost}
        {...previewProps(staging.paidCost?.card ?? null)}
      >
        {/* the card that paid the release's cost — held open here, not
            discarded on the spot, until the combo beat's own cost leg flies it
            on and clears `paidCost` in the same commit (#101, Task 11:
            comboBeat.tsx's `runRelease`) */}
        {staging.paidCost && <Card card={staging.paidCost.card} interactive={false} width="100%" />}
      </div>

      {/* THE AI PAIR (#106). The trigger that caused it stands left; the card
          it pulled stands right, and wider — it is the card of the moment.
          Positioned from `centrePlaceStyle`, the declared single source for
          centre geometry, rather than from literals of their own: the four
          slots above predate that source and still carry copies of its numbers
          (recorded in the register), and three more copies is how a duplication
          becomes the house style. */}
      <div
        className={opening.aiSlot}
        data-centre-slot="cause"
        style={centrePlaceStyle('ai', 'cause')}
        ref={anchors.cause}
      />
      <div
        className={opening.aiSlot}
        data-centre-slot="effect"
        style={centrePlaceStyle('ai', 'effect')}
        ref={anchors.effect}
      >
        {/* The card standing behind a prompt, held publicly while the engine
            waits for an answer. This is what carries it across the gap between
            the batch that revealed it and the batch that answers — they are
            different batches, so no beat overlay can span it, and `source` is
            public on every one of the four pendings that can raise it. */}
        {aiStanding && (
          <div className={opening.aiCard} data-testid="board-ai-effect">
            <Card card={aiStanding} interactive={false} width="100%" />
          </div>
        )}
      </div>
      <div
        className={opening.aiSlot}
        data-centre-slot="picked"
        style={centrePlaceStyle('aiPick', 'picked')}
        ref={anchors.picked}
      />

      {/* the defender's own Sudo waits in its OWN place until a defence is
          chosen for it — the arrow says what it is aimed at. Rendered once its
          own flight there has landed (or at once under reduced motion, Task
          17) — the same landed-gate role `stagedCover` below plays for the
          defence's own flight to the cover slot. */}
      <div
        className={opening.sudoSlot}
        data-centre-slot="sudo"
        ref={anchors.sudo}
        {...previewProps(stagedSudo?.card ?? null)}
      >
        {stagedSudo && (
          <div className={opening.pose} style={{ transform: restTransform(SUDO_POSE) }}>
            <Card card={stagedSudo.card} interactive={false} width="100%" />
          </div>
        )}
      </div>
      {/* the defence covering the attack — offset and tilted the other way.
          Axis-aligned itself (I6): the tilt lives on the inner `.pose` child,
          the same way the discard heap's own resting cards carry theirs, so
          `anchors.cover`'s own rect stays the true card box a flight can aim
          at. Rendered once the pulled defence's own flight has landed (or at
          once under reduced motion) — `defenseBeat.runCovered` finds this
          exact node already standing here through the handoff (#101, Task 16:
          Carry #2), rather than falling back to a seat box that is never
          bound for the local player. Carries a CardPair instead of a lone
          Card once a Sudo has folded into it (#101, Task 17) — `stagedCoverSudo`
          shares `stagedCover`'s own gate, so the two can never disagree on
          whether the fold has landed. */}
      <div
        className={opening.coverSlot}
        data-centre-slot="cover"
        ref={anchors.cover}
        {...previewProps(stagedCover?.card ?? stagedNeutralize?.card ?? null)}
      >
        {/* One slot, two answers — a defence covering an attack, or a 503's own
            answer (#102, Task 9). They are never both staged: a pending has one
            kind and it suspends normal play. The pair reading is shared: a
            sudo-backed defence, or a sacrificed release with its Code Review. */}
        {(() => {
          const main = stagedCover?.card ?? stagedNeutralize?.card
          const aux = stagedCoverSudo?.card ?? stagedNeutralize?.aux
          if (!main) return null
          return (
            <div
              ref={coverStagedRef}
              className={opening.pose}
              style={{ transform: restTransform(COVER_POSE) }}
              data-testid="board-cover-staged"
            >
              {aux ? (
                <CardPair main={main} aux={aux} width="100%" />
              ) : (
                <Card card={main} interactive={false} width="100%" />
              )}
            </div>
          )
        })()}
      </div>

      {/* the attack slot — where cards stand while the table is looking at them:
          the player's own cards gather here during the opening, and every drawn
          card stages here for the rest of the match. Mounted for the whole life
          of the board, because a flight cannot aim at a node that is not there
          yet. Empty, it must not catch clicks meant for the table underneath —
          `.centre:empty` in `_Board.module.css` owns that, now that the cover
          slot sits on top of it too. */}
      <div
        className={opening.centre}
        data-board-centre
        data-centre-slot="attack"
        ref={anchors.centre}
        {...previewProps(
          pendingDefend
            ? cardById(pendingDefend.attackCard)
            : pendingAlarm?.card
              ? cardById(pendingAlarm.card)
              : null,
        )}
      >
        {intro &&
          deal.staged.map((s) => {
            const data = cardById(s.card)
            if (!data) return null
            return (
              <div
                key={s.uid}
                className={opening.stagedCard}
                style={{ transform: restTransform(s.sc) }}
              >
                <Card card={data} faceDown={s.faceDown} interactive={false} width="100%" />
              </div>
            )
          })}
        {/* the pulled card stands here once the flyer has dropped it — while
            the carrier or a return flight still holds it, the static render
            would double it (ComboStory.tsx's own guard on this). Once a
            partner folds in, the pair flyer below owns the centre instead. */}
        {soloStaged && staging.overlay.length === 0 && (
          <div ref={soloStagedRef} className={opening.centreCard} data-testid="board-centre-staged">
            <Card card={soloStaged.card} interactive={false} width="100%" />
          </div>
        )}
        {pendingDefend &&
          (() => {
            const data = cardById(pendingDefend.attackCard)
            if (!data) return null
            // sudo stands the pair; a plain hit stands the one card, as before.
            const aux = pendingDefend.sudo ? cardById('support-sudo') : null
            return (
              <div
                className={opening.centreCard}
                data-testid="board-centre-pending"
                data-pending-play
              >
                {/* the attack RESTS at its own tilt (#101, Fix A, Defect 2),
                    the way the cover already does — the approved scene's whole
                    point is that the two read as two separate plays at
                    contrasting tilts, and the exit hands `pose: ATTACK_POSE`
                    to `useDiscardExit`, which documents it as "the table tilt
                    it STARTS from": resting at 0° made the card pop to −4° on
                    the exit's first frame. The tilt lives on this INNER
                    element and not on the node above it, which is what
                    `comboBeat.runPairOut` measures — a rotated node's bounding
                    rect is the box AROUND the tilted card (I6). Same shape as
                    the cover and sudo slots.
                    The ARRIVAL still does not carry the tilt: `foldIn` is
                    translate+scale only, so the rest pose is what supplies it
                    — recorded in docs/animations/backlog.md. */}
                <div className={opening.pose} style={{ transform: restTransform(ATTACK_POSE) }}>
                  {aux ? (
                    <CardPair main={data} aux={aux} width="100%" />
                  ) : (
                    <Card card={data} interactive={false} width="100%" />
                  )}
                </div>
              </div>
            )
          })()}
        {pendingAlarm &&
          (() => {
            const data = pendingAlarm.card ? cardById(pendingAlarm.card) : null
            if (!data) return null
            return (
              <div
                className={opening.centreCard}
                data-testid="board-centre-alarm"
                data-pending-play
              >
                <div className={opening.pose} style={{ transform: restTransform(ATTACK_POSE) }}>
                  <Card card={data} interactive={false} width="100%" />
                </div>
              </div>
            )
          })()}
        {/* the card that was named, held publicly while the engine waits for it
            to be handed over. This is what carries it across the gap between
            `requested` and `handTransfer` — they arrive in different batches,
            so no beat overlay can span it — and `giveCard` is projected to
            everyone (fake/attacks.ts:444), so every peer stands the same card. */}
        {state.pending?.kind === 'giveCard' &&
          (() => {
            const data = cardById(state.pending.requested)
            if (!data) return null
            return (
              <div className={opening.centreCard} data-testid="board-requested-card">
                <Card card={data} interactive={false} width="100%" />
              </div>
            )
          })()}
      </div>

      {/* THE DISCARD GRID (#104) — the excess a turn's end costs, laid out for
          the whole table to read. The cells are a fixed shape chosen before the
          first card moved, so every card flies straight to its own; an empty
          one shows the shape still being filled. It is dropped the moment the
          beat takes the grid over (`handed`), which is the same commit the
          exit's own carriers go up in. */}
      {handLimit.cells > 0 && !handLimit.handed && (
        <div className={opening.discardGrid} data-testid="board-discard-grid">
          {gridCells(handLimit.cells).map((cell, i) => {
            const held = handLimit.placed.find((p) => p.slot === i)
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the cells are a fixed grid and the index IS the slot
                key={i}
                className={opening.gridCell}
                data-grid-cell={i}
                style={
                  // Bad Vibe-Coding's one card does not belong in the grid's own
                  // shape: `gridCells(1)` centres it at dx 0, underneath the AI
                  // card standing at the `effect` place. `centrePlaceStyle`
                  // supplies its own `insetInlineStart`/`inlineSize`/`transform`,
                  // so the two branches are complete alternatives, not a merge.
                  handLimit.aiPicked
                    ? centrePlaceStyle('aiPick', 'picked')
                    : {
                        insetBlockStart: `${GRID_TOP}%`,
                        inlineSize: `${cell.w}px`,
                        transform: `translate(calc(-50% + ${cell.dx}px), calc(-50% + ${cell.dy}px))`,
                      }
                }
                ref={(el) => handLimit.bindCell(i, el)}
              >
                {held ? (
                  // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only pick-up back into the hand; the discard itself is confirmed by the grid filling up
                  <div
                    className={opening.cellCard}
                    data-grid-card={held.uid}
                    data-grabbable={handLimit.dispatched ? undefined : 'true'}
                    onMouseDown={
                      handLimit.dispatched ? undefined : (e) => handLimit.onCellDown(e, held)
                    }
                  >
                    <Card card={held.card} interactive={false} width="100%" />
                  </div>
                ) : (
                  <span className={opening.cellEmpty} />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* OUR OWN alarm — strong, and BEFORE the hand in the DOM so it glows
          UNDER it. The bounds are the table zone itself: `kit.table` is already
          `position: relative; overflow: hidden; isolation: isolate`, so the
          layout supplies them and there is nothing to measure. The playground's
          `.glowBounds` and its hardcoded tech-bar offsets stay in the
          playground — that story is explicitly not the reference here (Page
          Shell Rule, apps/playground/CLAUDE.md). */}
      {glowStrong && <EdgeGlow visible intensity="strong" data-testid="board-glow-strong" />}

      <div className={kit.you} data-testid="board-you">
        {youEliminated ? (
          <Badge size="lg" className={kit.youBadge}>
            {copy.table.youEliminated}
          </Badge>
        ) : (
          <>
            {/* the zone is the last thing to arrive: it is yours, and it comes
                once you have a hand to play from */}
            <div className={enter} ref={anchors.zone}>
              <ReleaseZone
                release={you.release}
                support={you.support}
                size="100px"
                player={state.selfId}
                slotRef={(key, el) => anchors.bindReleaseSlot(state.selfId, key, el)}
                onPick={(t) => staging.onTargetPick(t)}
                targets={staging.targets}
                // the zone's own half of the 503 gesture (#102, Task 9). What
                // lights is exactly what may be taken — `pending.methods` is
                // the only authority — and a slot whose card is elsewhere
                // (carried by the drag, or standing at the cover slot as the
                // answer) shows its empty place rather than a second copy.
                accentAt={(key) => neutralizing.accentAt(key)}
                liftedAt={(key) => neutralizing.liftedAt(key)}
                onSlotDown={(key, e) => neutralizing.onSlotDown(key, e)}
              />
            </div>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only guard so a press in the fan is never read as "pointed at nothing" while a pair stands merged; the Hand owns the real interaction (ComboStory's own hand wrapper carries the same guard) */}
            <div
              className={kit.handWrap}
              ref={anchors.hand}
              // the pair assembles and then waits at the CENTRE — the hand's
              // zoom preview rises into exactly that space and would cover it
              // (ComboStory's own reason). So while a pair stands merged the
              // fan goes inert, and a press inside it must not read as the
              // miss `handleTableClick` cancels on.
              //
              // UNLESS a cost is owed (#101, Fix C, finding 1 — the blocker
              // this round exists for). A Code Review combo that ships a
              // release raises the ordinary `discardForRelease` pending, and
              // the pair stays merged for the whole of it, because `staged` is
              // the only thing that knows the pair (`pendingView` carries
              // `release` but not `codeReview`). The fan is that step's ONLY
              // picker — the panel is suppressed for this pending on purpose,
              // two blocks down, and `Hand` offers no keyboard path — so an
              // inert fan made the cost unpayable by any input at all, while
              // the ask line under the centre asked for it. #100 added this
              // guard and #101 suppressed the panel; neither could see the
              // other. The guard yields to the step that is waiting on the fan,
              // which is the narrower of the two and the one that can be
              // deadlocked.
              //
              // WHAT YIELDING COSTS, on the record rather than left to be
              // rediscovered (#101, Fix D, finding 9): the hover zoom is back
              // over the standing pair for the whole cost step, which is the
              // occlusion #100's guard was added for — and `Hand`'s `.zoom` is
              // `pointer-events: none`, so a press that lands on that preview
              // falls THROUGH to whatever is beneath it, misses every
              // `[data-hand-slot]`, and the cost listener above reads it as a
              // miss and cancels the release. Reading a card can therefore
              // undo the play. Not fixable from this side: exempting the
              // preview needs it to be a pointer target, and giving it pointer
              // events makes it steal the hover that raised it. Recorded in
              // `docs/animations/backlog.md` and the audit register with the
              // shape that would close it; the deadlock this guard yields for
              // is the worse of the two, which is why it still yields.
              style={{ pointerEvents: handInert ? 'none' : undefined }}
              onMouseDown={handInert ? (e) => e.stopPropagation() : undefined}
            >
              <Hand
                // a `defend` pending owed to us means the defence hook owns
                // the fan (#101, Task 16) — `answering` picks the source at
                // every call site below, rather than merging the two hooks'
                // outputs.
                items={
                  discarding
                    ? handLimit.handItems
                    : answering
                      ? defenseStaging.handItems
                      : alarmMineOpen
                        ? neutralizing.handItems
                        : staging.handItems
                }
                // the fan opens room for the arriving heap while it travels —
                // the deal wins the tie against every other beat the same way
                // it already wins the shadow's, and the staging gesture's own
                // return-flight gap is last: it opens only once nothing else
                // owns the fan.
                gapAt={
                  deal.gapAt ?? (discarding ? handLimit.gapAt : null) ?? beats.gapAt ?? liveGapAt
                }
                gapSize={
                  deal.gapAt == null
                    ? discarding && handLimit.gapAt != null
                      ? handLimit.gapSize
                      : beats.gapAt == null
                        ? liveGapSize
                        : beats.gapSize
                    : deal.gapSize
                }
                carrying={discarding && handLimit.carrying}
                // What lights, and in what hue — from whichever hook owns the
                // fan (#101, Fix B). `stateAt` is what says a card is
                // AVAILABLE; `accentAt` only says what colour, and without
                // the pair of them the fan could never light for a step that
                // is not a combo partner pick — which is every step this
                // scene is about. Both hooks keep the one rule: lit only
                // while a step is waiting on a choice from the fan, and only
                // on the cards that answer it.
                stateAt={
                  discarding
                    ? handLimit.stateAt
                    : answering
                      ? defenseStaging.stateAt
                      : alarmMineOpen
                        ? neutralizing.stateAt
                        : staging.stateAt
                }
                // no fan accent while a 503 is open: `neutralizing.accentAt`
                // answers for a ZONE slot, and the fan's own lighting is
                // entirely `stateAt`'s (the Debugger, or nothing).
                accentAt={
                  discarding
                    ? handLimit.accentAt
                    : answering
                      ? defenseStaging.accentAt
                      : alarmMineOpen
                        ? undefined
                        : staging.accentAt
                }
                // while the deal runs the hand is held: no clicks reach either
                // gesture machine, and the cards that travelled closed stay
                // closed until the flip. Both are gone the moment it ends, so
                // the released hand is the plain one this board always drew.
                // A partner pick is a click too, not a pull — so is a release's
                // cost, and so is a release itself (#101, Fix D, finding 1).
                // WHICH of those a given click is, is the staging gesture's own
                // question: it takes the click and says so, or declines and the
                // plain click gesture — which owns the window's attack
                // affordance — gets it. Deciding it here instead is what hid the
                // release's own case: the condition named the two steps anyone
                // had thought of (`phase === 'partner'`, a cost owed), a release
                // played at rest was neither, and it went to a gesture that
                // dispatches the play and never tells the stage machine, so the
                // card stood nowhere for the whole step that followed.
                onCardClick={
                  deal.active || discarding
                    ? undefined
                    : answering
                      ? (i) => defenseStaging.onCardClick(i)
                      : alarmMineOpen
                        ? // a 503 is answered by a PULL, never by a click —
                          // one gesture per step, the same discipline the
                          // defence's own `askPartner` line records
                          undefined
                        : (i) => {
                            if (staging.onCardClick(i)) return
                            // resolved against the array the fan actually
                            // RENDERED, and handed on as a uid: `handItems` is
                            // `you.hand` minus whatever is staged, so an index
                            // that crossed this seam pointed at a different card
                            // the whole time anything stood on the table (#101,
                            // Fix D round 2).
                            const item = staging.handItems[i]
                            if (item) gestures.onCardClick(item.uid)
                          }
                }
                // drag-mode: a card that needs a target — or a legal defence
                // answering an open `defend` pending — is pulled out of the
                // fan, not clicked. Off during the deal, same as the click
                // gesture above.
                onPlay={
                  deal.active || (discarding && handLimit.carrying)
                    ? undefined
                    : discarding
                      ? handLimit.onHandPlay
                      : answering
                        ? defenseStaging.onHandPlay
                        : alarmMineOpen
                          ? neutralizing.onHandPlay
                          : staging.onHandPlay
                }
                // the reorder gesture's commit — without it the kit settles the
                // card into its new slot and the next projection render snaps
                // it back. `to` indexes the fan AS RENDERED (minus any staged
                // card), which is exactly what the commit expects.
                onReorder={
                  deal.active || (discarding && handLimit.carrying)
                    ? undefined
                    : (uid, to) =>
                        handOrder.commit(
                          you.hand,
                          discarding
                            ? handLimit.handItems
                            : answering
                              ? defenseStaging.handItems
                              : alarmMineOpen
                                ? neutralizing.handItems
                                : staging.handItems,
                          uid,
                          to,
                        )
                }
                renderFace={
                  deal.active
                    ? (item, ctx) => (
                        <Card
                          card={item.card}
                          faceDown={deal.faceDown(item.uid)}
                          interactive={false}
                          tilt={ctx.tilt}
                          width={ctx.width}
                          state={ctx.state}
                          accent={ctx.accent}
                        />
                      )
                    : undefined
                }
              />
            </div>
          </>
        )}
      </div>

      {/* SOMEONE ELSE's alarm — weak, and AFTER the hand so it lies over it.
          `pointer-events: none` is already on the primitive for both
          intensities (EdgeGlow.module.css), so the fan's hover reaction is not
          smothered and the DOM position is the only thing to get right. */}
      {pendingAlarm && !alarmMine && (
        <EdgeGlow visible intensity="weak" data-testid="board-glow-weak" />
      )}

      {/* служебный док хода — низ слева, под колодами, слева от руки */}
      <div className={kit.turnDock}>
        <div className={enter} ref={anchors.dock}>
          <TurnDock
            state={dockView.state}
            danger={dockView.danger}
            seconds={dockView.seconds}
            progress={dockView.progress}
            activePlayer={dockView.activePlayer}
            copy={dockCopy}
            paused={paused}
            onDraw={actions?.onDraw ? () => dockKey(actions.onDraw) : undefined}
            onPush={actions?.onPush ? () => dockKey(actions.onPush) : undefined}
            onPass={actions?.onPass}
          />
        </div>
        {/* you already passed on the open window — TurnDock has no notion of
            "unpass", so the affordance to take it back lives here instead */}
        {state.window?.passed.includes(state.selfId) && (
          <Button variant="tech" className={kit.unpass} onClick={() => actions?.onUnpass?.()}>
            {copy.window.unpass}
          </Button>
        )}
      </div>

      {/* the engine is waiting on a decision from you — a pending owed to you
          always renders, regardless of whose turn the projection says it is.
          Two kinds are the exception, both for the same reason: the cards on
          the table already ask for them, so a panel would be a second asker
          for the same decision. A release's own cost is answered by the fan
          (`staging.onCostPick`); a `defend` is answered by pulling a defence
          out of it (`defenseStaging.onHandPlay`).

          For the `defend` the panel was worse than redundant (#101, Fix B):
          `.prompt` is `inset: 0` at z-index 92 with a fully opaque `.panel`
          centred inside it, and the centre slots it covered sit at z 9–11 —
          so the attack being asked about was behind the question, and a card
          flying to or from the cover slot (a carrier at `--z-flight`, 250)
          vanished the instant it landed. What only the panel could do —
          decline — is the board's own affordance now, in the ask below. */}
      {state.pending?.player === state.selfId &&
        state.pending.kind !== 'discardForRelease' &&
        state.pending.kind !== 'handLimit' &&
        state.pending.kind !== 'defend' &&
        // the gesture IS the answer, and the panel covered the very cards it
        // was asking about — same reason, same fix as `defend` above (#102)
        state.pending.kind !== 'neutralize503' &&
        // the band on the table asks this one, for the same reason the three
        // above are asked by the cards themselves (#105)
        state.pending.kind !== 'requestCard' &&
        // …and this one is not a question: the copies differ only by uid, so
        // `_useRequestStaging` answers it and the victim watches the scene
        state.pending.kind !== 'giveCard' &&
        // the row on the table asks Inside's own pick, for the same reason
        // the others above are asked by the cards themselves (#106) — but
        // only Inside's: Git Cherry-pick raises the same pending kind over
        // the whole discard (and a sudo second pick to the draw deck), a
        // shape the row was never built for, so it falls through to this
        // panel, which already has a complete case for it
        // (`PendingPrompt.tsx`'s own `pickFromDiscard`, `toDeck` included)
        !(state.pending.kind === 'pickFromDiscard' && state.pending.source === 'ai-inside') && (
          <PendingPrompt
            pending={state.pending}
            hand={you.hand}
            // What a `crush` sacrifice may burn — only the three release
            // slots (Frontend/Backend/Database); Monitoring is its own
            // neutralize method, never a sacrifice target. Card data comes
            // from `you.release`, uid from `you.releaseUid` — the engine's
            // choice names the uid, not the slot (Task 11, #102).
            release={{
              frontend:
                you.release.frontend && you.releaseUid?.frontend
                  ? { uid: you.releaseUid.frontend, card: you.release.frontend }
                  : undefined,
              backend:
                you.release.backend && you.releaseUid?.backend
                  ? { uid: you.releaseUid.backend, card: you.release.backend }
                  : undefined,
              database:
                you.release.database && you.releaseUid?.database
                  ? { uid: you.releaseUid.database, card: you.release.database }
                  : undefined,
            }}
            copy={copy.pending}
            onResolve={(choice) => actions?.onResolve?.(choice)}
          />
        )}

      {/* what the table is waiting for, under the cards it is waiting on.
          Always mounted, so it can fade OUT as well as in — and `inert` while
          it says nothing, which keeps the fading-out line out of the
          accessibility tree rather than guarding the decline: the decline
          renders only under `unanswered`, and `unanswered` implies the line
          says something, so there is never a button inside to protect (fix
          round 1, L4 — the first version of this comment claimed otherwise).
          Under prefers-reduced-motion the module CSS drops the transition and
          it simply appears; there is no `play()` here to gate. */}
      <div
        className={opening.ask}
        data-shown={ask != null}
        data-testid="board-ask"
        inert={ask == null}
      >
        <Typography as="div" base="label-sm" tk="tk-16" className={opening.askLine}>
          {lastAsk.current}
        </Typography>
        {unanswered && (
          <Button
            variant="tech"
            className={opening.askDecline}
            data-testid="board-decline"
            onClick={declineAttack}
          >
            {copy.pending.decline}
          </Button>
        )}
      </div>

      {/* вертикальный рейл у правого края — переключает панели drawer. Слой
          нужен только чтобы вести его появление, не трогая его собственный
          transform (the rail is the first thing the opening brings in). */}
      {/* `inert` while the opening runs: the layer is faded to nothing but its
          buttons would still take a click and a Tab stop, so a player could open
          a drawer they cannot see. */}
      <div className={cls(opening.railLayer, enter)} ref={anchors.rail} inert={entering}>
        <TabRail items={railItems} active={panel} onSelect={(id) => toggle(id as Panel)} />
      </div>

      {/* выезжающая панель поверх контента (ширина — per-tab) */}
      <Drawer open={panel !== null} width={drawerWidth} className={kit.drawer}>
        {panel === 'settings' && (
          <div className={kit.settings}>
            {hasUpperSettings && (
              <SettingsGroup title={isHost ? copy.table.generalTitle : undefined}>
                {lang && onLangChange && (
                  <SettingsField label={copy.table.langTitle}>
                    <LangSwitcher
                      value={lang}
                      onChange={onLangChange}
                      variant="full"
                      align="start"
                    />
                  </SettingsField>
                )}
                {code && (
                  <SettingsField label={copy.table.codeTitle}>
                    <LobbyCode
                      code={code}
                      copy={copy.lobbyCode}
                      align="start"
                      reverse
                      showLabel={false}
                    />
                  </SettingsField>
                )}
              </SettingsGroup>
            )}
            {hostControls && (
              <>
                {hasUpperSettings && <div className={kit.divider} />}
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
                        className={kit.sliderFull}
                      />
                    </SettingsField>
                  )}
                  {canPause && (
                    <SettingsField label={copy.table.pauseGame} hint={copy.table.pauseHint}>
                      <Toggle on={paused} onChange={(on) => onPauseChange?.(on)}>
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
          <div className={kit.scrollPanel}>
            <Rules copy={copy.rules} />
          </div>
        )}
        {panel === 'modes' && <GameModes setup={setup} copy={copy.modes} />}
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

      {overShown && (
        <GameOver
          winner={overWinner}
          condition={over.condition}
          onContinue={actions?.onOverContinue}
          copy={copy.gameOver}
        />
      )}

      {/* the cards in the air: the carrier for the deal, the arrival step for
          the heap going into the fan, and the exit step for a card leaving it
          for the discard. Last, so they fly over everything. */}
      {deal.overlays}
      {beats.overlays}
      {staging.overlay}
      {defenseStaging.overlay}
      {handLimit.overlay}
      {neutralizing.overlay}
      {requesting.band}
      {inside.row}
      {previewOverlay}

      {/* the pair flyer — a persistent node (I10: position: fixed against the
          viewport, no containing block above it, same as every other flight
          carrier). The fold paints frame by frame directly on its
          [data-main]/[data-aux] children; the CardPair mount just needs to
          exist for that to have something to grab. */}
      <div
        className={opening.pairFlyer}
        ref={staging.pairRef}
        aria-hidden="true"
        data-testid="board-pair-staged"
      >
        {staging.staged?.merged && staging.staged.support && staging.staged.main && (
          <CardPair
            main={staging.staged.main.card}
            aux={staging.staged.support.card}
            width="100%"
          />
        )}
      </div>
    </div>
  )
}
