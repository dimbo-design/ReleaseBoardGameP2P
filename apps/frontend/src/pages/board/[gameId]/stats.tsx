import { useTranslation } from '@release/translation'
import { Stats, type StatsCopy } from '@release/ui'
import { useEffect } from 'react'
import { useLeaveMatch } from '~/app/lib/lobbyNavigation'
import { useSession } from '~/app/providers/SessionProvider'
import { seatsFor } from '~/entities/game/seats'
import { toStatPlayers } from '~/entities/game/stats'
import { useGame } from '~/features/play-game/useGame'
import styles from './stats.module.css'

export default function StatsPage() {
  const { t, i18n } = useTranslation()
  const session = useSession()
  const game = useGame()
  const leaveMatch = useLeaveMatch()

  // Tell the table where this peer went, so everyone else's results table can
  // say so. Announced once per mount; the host ignores a repeat of what it
  // already recorded (network/lobby/host.ts).
  const { setWhere } = session
  useEffect(() => {
    setWhere('stats')
  }, [setWhere])

  // The seating this match was dealt with, frozen at the deal and carried on
  // GAME_STARTING. Deriving it here from `peers` is exactly the bug this reads
  // around: the roster is pruned the moment somebody's channel drops, so a
  // seating recomputed at render time renumbers the survivors — a departed
  // player loses their row and the peer that inherits their seat id is shown
  // their counters. The fallback is for a session that holds no seating at all
  // (a reload), where degrading to today's roster beats an empty screen.
  const peers = session.state?.peers ?? {}
  const seats = session.seats.length > 0 ? session.seats : seatsFor(peers)
  // No tally means no finished match to report: a spectator is never projected
  // to, and a reload loses the session entirely. An empty table is honest —
  // rows of zeros would claim a match in which nobody did anything, and the
  // roster alone is enough to build those rows, so this guard is what stops it.
  const tally = game.view?.tally
  const players = tally ? toStatPlayers({ tally, seats, peers }) : []

  // The engine names the winning SEAT; the screen compares against peer ids.
  // The board carries a paragraph about this crossing for the same lookup, and
  // complains the same way when it misses — the miss is reachable (a winner can
  // be pruned from the roster on disconnect), and falling back to the playerId
  // would silently name nobody. The board is unmounted on this route, so the
  // complaint has to be made here too or it is made nowhere.
  const engineWinner = game.view?.over?.winner
  const winnerSeat = engineWinner ? seats.find((s) => s.playerId === engineWinner) : undefined
  if (engineWinner && !winnerSeat && import.meta.env.DEV) {
    console.error(
      `[stats] no seat for winner ${engineWinner}: the engine names seats p1..pN, the roster is keyed by peer id. Roster: ${seats.map((s) => `${s.playerId}=${s.peerId}`).join(', ') || '(empty)'}`,
    )
  }
  const winnerId = winnerSeat?.peerId ?? ''
  const selfId = session.state?.selfId ?? ''

  const copy: StatsCopy = {
    title: t('stats.title'),
    subtitle: t('stats.subtitle'),
    winnerLabel: t('stats.winnerLabel'),
    winnerTag: t('stats.winnerTag'),
    selfTag: t('stats.selfTag'),
    colName: t('stats.colName'),
    colLoc: t('stats.colLoc'),
    colAttack: t('stats.colAttack'),
    colDefense: t('stats.colDefense'),
    toLobby: t('stats.toLobby'),
    location: {
      game: t('stats.location.game'),
      stats: t('stats.location.stats'),
      lobby: t('stats.location.lobby'),
      offline: t('stats.location.offline'),
    },
    achievements: {
      ddos: { title: t('stats.achievements.ddos.title'), unit: t('stats.achievements.ddos.unit') },
      ai: { title: t('stats.achievements.ai.title'), unit: t('stats.achievements.ai.unit') },
      err503: {
        title: t('stats.achievements.err503.title'),
        unit: t('stats.achievements.err503.unit'),
      },
      cherryPick: {
        title: t('stats.achievements.cherryPick.title'),
        unit: t('stats.achievements.cherryPick.unit'),
      },
      attackedInto: {
        title: t('stats.achievements.attackedInto.title'),
        unit: t('stats.achievements.attackedInto.unit'),
      },
    },
  }

  return (
    <div className={styles.page} data-testid="stats-page">
      <Stats
        winnerId={winnerId}
        selfId={selfId}
        players={players}
        copy={copy}
        // The story's own pair. Winning lights the HUD; everyone else gets the
        // calm one, which is what you want on a screen you sit and read.
        bgTone={winnerId !== '' && winnerId === selfId ? 'positive' : 'neutral'}
        lang={i18n.resolvedLanguage === 'ru' ? 'ru' : 'en'}
        onLangChange={(lang) => {
          void i18n.changeLanguage(lang)
        }}
        onToLobby={() => {
          // Order matters: clearing the match first means the follower sees no
          // game to send this peer back to.
          session.leaveGame()
          // With a room to return to, that is where this goes — the session
          // outlives the match, so the lobby still has everyone in it and the
          // host can start the next one straight away.
          //
          // Without one there is nothing to return TO: a reload on this route
          // loses the session, and the screen is already empty because the
          // projection went with it. Falling back to the start screen is the
          // difference between a way out and a button that does nothing at all.
          leaveMatch(session.roomCode)
        }}
      />
    </div>
  )
}
