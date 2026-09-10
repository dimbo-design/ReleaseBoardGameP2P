import { useTranslation } from '@release/translation'
import { Menu, MenuButton, MenuGroup, VideoPlayer } from '@release/ui'
import { useNavigate } from 'react-router'
import { useGoToLobby } from '~/app/lib/lobbyNavigation'
import { useSession } from '~/app/providers/SessionProvider'
import { readSession } from '~/shared/lib/persistence'
import { useModalRoute } from '~/shared/ui/ModalRouter'
import ScreenShell from '~/shared/ui/ScreenShell'
import styles from './start.module.css'

const REPO_URL = 'https://github.com/dimbo-design/ReleaseBoardGameP2P'
const VIDEO_URL = 'https://www.youtube.com/embed/bxGtRnoYW4g?autoplay=1'

export default function StartPage() {
  const { t } = useTranslation()
  const handleMenuClick = useModalRoute()
  const session = useSession()
  const goToLobby = useGoToLobby()
  const navigate = useNavigate()

  // A live session OR one this browser stored before the tab went away. Read
  // once per render rather than held in state: nothing here mutates it, and a
  // stale copy would keep offering a match the player has since left.
  const stored = readSession()
  const hasSession = (session.status === 'in-lobby' && !!session.state) || !!stored

  const resume = () => {
    const code = session.roomCode ?? stored?.roomCode
    if (!code) return
    // A stored match goes back to the board; a stored lobby goes to the lobby.
    if (stored?.gameId && !session.state) {
      void navigate(`/board/${stored.gameId}`)
      return
    }
    void goToLobby(code)
  }

  return (
    <ScreenShell
      tags={[t('start.tagOpenP2P'), t('start.tagBoardCard')]}
      description={t('start.description')}
      corners={
        <>
          {/* Video player — expands in place to an inline iframe */}
          <VideoPlayer
            src={VIDEO_URL}
            copy={{
              videoReview: t('start.videoReview'),
              close: t('start.close'),
              title: t('start.logoAlt'),
            }}
          />
        </>
      }
    >
      <Menu className={styles.menu}>
        {/* Always rendered so toggling it never reflows the column — without
              a reserved slot, mounting/unmounting would change the column's
              height and shift everything. Hidden and inert when there is no
              session to resume. */}
        <MenuGroup>
          <MenuButton
            aria-hidden={!hasSession}
            disabled={!hasSession}
            className={hasSession ? undefined : styles.hiddenSlot}
            onClick={resume}
          >
            {t('start.continueSession')}
          </MenuButton>
          <MenuButton autoFocus value="create" onClick={handleMenuClick}>
            {t('start.createGame')}
          </MenuButton>
          <MenuButton value="join" onClick={handleMenuClick}>
            {t('start.joinGame')}
          </MenuButton>
        </MenuGroup>
        <MenuGroup>
          <MenuButton value="rules" onClick={handleMenuClick}>
            {t('start.rules')}
          </MenuButton>
        </MenuGroup>
        <MenuGroup>
          <MenuButton onClick={() => window.open(REPO_URL, '_blank', 'noopener')}>
            {t('start.github')}
          </MenuButton>
          <MenuButton
            onClick={() => {
              window.location.href = `${import.meta.env.BASE_URL}playground/`
            }}
          >
            {t('start.playground')}
          </MenuButton>
        </MenuGroup>
      </Menu>
    </ScreenShell>
  )
}
