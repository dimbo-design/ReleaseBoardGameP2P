import type { Event } from '@release/engine'
import { useTranslation } from '@release/translation'
import { DEFAULT_SETUP, isCounting } from '@release/ui'
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useSession } from '~/app/providers/SessionProvider'
import { toBoardOver, toBoardState } from '~/entities/game/board'
import { seatsFor } from '~/entities/game/seats'
import { useGame } from '~/features/play-game/useGame'
import { useNow } from '~/features/play-game/useNow'
import Board from './_Board'
import styles from './index.module.css'

// What the table shows before the first projection arrives — a beat on a live
// connection, indefinitely for a spectator, who holds no seat to be projected
// to. Empty rather than fake: an invented hand would be a lie the player could
// click on.
const EMPTY_TABLE = {
  you: { name: '', hand: [], release: {} },
  opponents: [],
  decks: { main: [], events: 0, discard: null, discardCount: 0 },
  turn: undefined,
  hasDrawn: false,
  selfId: '',
  history: [],
  setup: DEFAULT_SETUP,
  playable: [],
  frozen: [],
  targets: {},
}

export default function BoardPage() {
  // All Table copy comes from the central catalog via i18next — one namespace per
  // sub-block, matching the @release/ui prop names.
  const { t, i18n } = useTranslation()
  const session = useSession()
  const game = useGame()
  const navigate = useNavigate()
  const { gameId } = useParams()

  // Where this peer is, for everyone else's results table.
  const { setWhere } = session
  useEffect(() => {
    setWhere('game')
  }, [setWhere])

  // Frozen at the deal, not recomputed here: the roster loses a peer the moment
  // its channel drops, and seats derived from it mid-match renumber whoever is
  // left — so a dropped player's seat would vanish, and a winner overlay could
  // end up naming the wrong peer. The fallback covers a session with no seating
  // held (a reload).
  const frozenSeats = session.seats
  const seats = frozenSeats.length > 0 ? frozenSeats : seatsFor(session.state?.peers ?? {})

  // Built from the seating rather than the live roster, exactly as the results
  // screen builds its rows (entities/game/stats/toStatPlayers.ts): a peer that
  // has left the roster still holds a seat at this table, and `applyPeerLeft`
  // prunes it the instant its channel drops. Read from `peers` alone, a dropped
  // player's seat would vanish mid-match and there would be nothing left to
  // mark as offline.
  const peerMap = session.state?.peers ?? {}
  const participants = seats.map((seat) => {
    const live = peerMap[seat.peerId]
    return {
      id: seat.peerId,
      // The roster's name is the live one; the seat's is what the match was
      // played under, and the only one left once a peer is gone.
      name: live?.name ?? seat.name,
      connected: Boolean(live),
    }
  })

  // Absence IS the offline signal — the same rule the results screen uses.
  // In the engine's own id space (`seat.playerId`, p1..pN): the Seat this
  // marks offline is read off `state.opponents`, which the engine (and
  // toBoardState) name that way, not by peer id.
  const disconnected = seats.filter((s) => !peerMap[s.peerId]).map((s) => s.playerId)

  const spectators = Object.values(peerMap).filter((p) => p.role === 'guest')

  // Whether this peer holds a seat — asked about ourselves the same way a
  // participant is identified above. Only a seated peer is ever projected to,
  // so only a seated peer gets the opening: a spectator's `game.view` is null
  // for the whole match, the intro could never report done, and the board
  // would sit behind its entering state (every block at opacity 0) for good.
  // The question has to be asked HERE and not inside the board off `view`: a
  // seated peer's first frame has no projection either, and unhiding on that
  // would flash the table open and shut at every real game start.
  const seated = participants.some((p) => p.id === session.state?.selfId)

  // `toTableOver` renames the engine's `over.winner` — a playerId minted as
  // p1..pN (see ~/entities/game/seats) — but Table.tsx resolves `over.winnerId`
  // against `room.participants`, which are peers keyed by *peer* id. PlayerId
  // and peer id are separate spaces that happen to both be strings, so without
  // this translation the lookup silently misses and the overlay names no one.
  //
  // The miss is reachable rather than theoretical — `over` rides the projection
  // and the roster rides the session, so a projection can land before the roster
  // syncs, and a winning peer can be pruned from `peers` on disconnect. Falling
  // back to the playerId there would restore the very defect above, and just as
  // quietly, so a miss yields no id at all and says so where a developer will
  // see it. The complaint is what catches the next id crossing too.
  const engineOver = game.view ? toBoardOver(game.view) : null
  const winnerSeat = engineOver ? seats.find((s) => s.playerId === engineOver.winnerId) : undefined
  if (engineOver && !winnerSeat && import.meta.env.DEV) {
    console.error(
      `[board] no seat for winner ${engineOver.winnerId}: the engine names seats p1..pN, the roster is keyed by peer id. Roster: ${seats.map((s) => `${s.playerId}=${s.peerId}`).join(', ') || '(empty)'}`,
    )
  }
  const over = engineOver ? { ...engineOver, winnerId: winnerSeat?.peerId ?? '' } : null

  // Two different consumers, so two blocks: `moveHistory` is the kit's own chrome
  // (the draw badge, the elimination suffix), `historyLabels` is one label per
  // member of the engine's Event union for the adapter to map onto.
  const labels = t('historyLabels', { returnObjects: true }) as Record<Event['type'], string>
  const state = game.view ? toBoardState(game.view, game.events, labels) : EMPTY_TABLE

  // The clock runs only while the dock actually draws a counting ring, so it is
  // asked from the same predicate the ring is derived from. Restating that rule
  // here would let the two drift, and the countdown would freeze for whichever
  // state they stopped agreeing about.
  const now = useNow(isCounting(state, state.selfId))

  return (
    <div className={styles.page} data-testid="board-page">
      <Board
        state={state}
        over={over}
        now={now}
        // The opening — for a seated peer only (see `seated` above). `onDone`
        // reports this seat to the host's start gate: until every seat has
        // reported (or the cap fires), no peer's action may reach the engine.
        intro={
          seated
            ? {
                gameId: session.gameId,
                view: game.view,
                events: game.events,
                restoredThrough: game.restoredThrough,
                onDone: session.introReady,
              }
            : undefined
        }
        room={{
          role: session.isHost ? 'host' : 'guest',
          code: session.roomCode ?? undefined,
          participants,
          spectators,
          disconnected,
          // The overlay covers both ways a peer can be off the table: a guest
          // dialing its way back, and a host rebuilding the match it was
          // keeping. `restoring` is the host's half — without it the host
          // stares at an empty board for the length of the restore with
          // nothing saying why. `reconnect.status` stays 'failed' (not
          // 'idle') once every attempt is spent, so the overlay must keep
          // showing then too — 'trying' alone would drop it the moment the
          // dial gives up, right when the player needs the retry/leave choice.
          connection:
            session.restoring || session.reconnect.status !== 'idle' ? 'reconnecting' : 'online',
          reconnect: {
            attempt: session.reconnect.attempt,
            maxAttempts: session.reconnect.maxAttempts,
            status: session.reconnect.status === 'failed' ? 'failed' : 'trying',
          },
          onReconnectRetry: session.reconnect.retry,
          onReconnectLeave: () => {
            session.leaveSession()
            void navigate('/start')
          },
          onKickSpectator: session.kick,
          lang: i18n.resolvedLanguage === 'ru' ? 'ru' : 'en',
          onLangChange: (lang) => {
            void i18n.changeLanguage(lang)
          },
        }}
        actions={{
          onPlay: game.play,
          onDraw: game.draw,
          onPush: game.push,
          onAttack: game.attack,
          onPass: game.pass,
          onUnpass: game.unpass,
          onResolve: game.resolve,
          onOverContinue: () => navigate(`/board/${gameId}/stats`),
        }}
        copy={{
          table: t('table', { returnObjects: true }),
          modes: t('gameModes', { returnObjects: true }),
          rules: t('rulesBlock', { returnObjects: true }),
          seat: t('seat', { returnObjects: true }),
          participants: t('participants', { returnObjects: true }),
          history: t('moveHistory', { returnObjects: true }),
          reconnect: t('reconnect', { returnObjects: true }),
          gameOver: t('gameOver', { returnObjects: true }),
          lobbyCode: t('lobbyCode', { returnObjects: true }),
          turnDock: t('turnDock', { returnObjects: true }),
          pending: t('pending', { returnObjects: true }),
          window: t('window', { returnObjects: true }),
        }}
      />
    </div>
  )
}
