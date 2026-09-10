import { useTranslation } from '@release/translation'
import {
  Button,
  DEFAULT_SETUP,
  GAME_MODES,
  type GameModesCopy,
  ModeSelect,
  randomNickname,
  type Setup,
  Slider,
  sanitizeNickname,
  Typography,
} from '@release/ui'
import { useState } from 'react'
import DiceIcon from '@/icons/DiceIcon'
import { useGoToLobby } from '~/app/lib/lobbyNavigation'
import { useSession } from '~/app/providers/SessionProvider'
import { useStartSolo } from '~/features/start-game/useStartSolo'
import Form, { FormField } from '~/shared/ui/Form'
import styles from './CreateLobbyForm.module.css'
import { useCreateLobby } from './useCreateLobby'

// Default lobby capacity: the maximum the host can later narrow with the
// in-lobby slider. Seeding the max means early joiners are always admitted as
// players, never silently relegated to spectators.
const DEFAULT_CAPACITY = 6

// The rules seat 2–6 players (docs/rules/general.md), so the human plus five is
// the full table. One is the default: the fastest match to actually reach.
const MAX_BOTS = 5

export default function CreateLobbyForm() {
  const { t } = useTranslation()
  // mode copy comes from the central catalog (namespace `gameModes`) via i18next
  const modesCopy: GameModesCopy = t('gameModes', { returnObjects: true })
  const goToLobby = useGoToLobby()
  const createLobby = useCreateLobby()
  const session = useSession()
  const connecting = session.status === 'connecting'
  const startSolo = useStartSolo()
  const [setup, setSetup] = useState<Setup>(DEFAULT_SETUP)
  const [name, setName] = useState('')
  const [bots, setBots] = useState(1)

  return (
    <Form
      onSubmit={async (data) => {
        const nickname = sanitizeNickname(data.name ?? '').trim()
        if (!nickname || connecting) return
        // A solo match opens no room, so there is nothing to await and nothing
        // to navigate to here: `startSolo` sets `gameId`, and the app-wide
        // FollowGameStart carries the player to the board off that signal.
        if (data.intent === 'solo') {
          startSolo(nickname, bots, setup, (n) => t('start.botName', { n }))
          return
        }
        try {
          // Pass the host's mode picks so the lobby seeds them instead of
          // DEFAULT_SETUP. A setup failure rejects here and is surfaced via
          // session.error below, so only navigate on success.
          const code = await createLobby(nickname, DEFAULT_CAPACITY, setup)
          goToLobby(code)
        } catch {
          // Error already surfaced through session.error; stay on the form.
        }
      }}
      requiredMessage={t('start.required')}
    >
      <div className={styles.createGrid}>
        <div className={styles.createMods}>
          {GAME_MODES.map((m) => {
            const mc = modesCopy[m.key]
            return (
              <ModeSelect
                key={m.key}
                title={mc?.title ?? ''}
                options={m.options.map((o) => ({
                  value: o.value,
                  label: o.label,
                  desc: mc?.options[o.value] ?? '',
                }))}
                value={setup[m.key] ?? ''}
                onChange={(v) => setSetup((s) => ({ ...s, [m.key]: v }))}
              />
            )
          })}
        </div>
        <div className={styles.createTech}>
          <Typography variant="panelTitle" as="h4" className={styles.techTitle}>
            {t('start.lobbyParams')}
          </Typography>
          <FormField
            name="name"
            label={t('start.nicknameLabel')}
            placeholder={t('start.nicknamePlaceholder')}
            maxLength={20}
            required
            // natural case — a nickname is used in game exactly as typed
            plain
            value={name}
            onChange={(e) => setName(sanitizeNickname(e.target.value))}
            trailing={
              <Button
                variant="icon"
                onClick={() => setName(randomNickname())}
                aria-label={t('start.randomNick')}
                title={t('start.randomNick')}
              >
                <DiceIcon />
              </Button>
            }
          />
          <Button type="submit" name="intent" value="lobby" disabled={connecting}>
            {t('start.createCta')}
          </Button>
          <Slider
            className={styles.botsRow}
            label={t('start.botsLabel')}
            value={bots}
            min={1}
            max={MAX_BOTS}
            onChange={setBots}
          />
          <Button type="submit" name="intent" value="solo" variant="tech" disabled={connecting}>
            {t('start.soloCta')}
          </Button>
          <Typography variant="footnote" className={styles.note}>
            {t('start.soloNote')}
          </Typography>
          {session.error && (
            <Typography base="body" as="p" className={styles.error}>
              {session.error}
            </Typography>
          )}
          <Typography variant="footnote" className={styles.note}>
            {t('start.lobbyNote')}
          </Typography>
        </div>
      </div>
    </Form>
  )
}
