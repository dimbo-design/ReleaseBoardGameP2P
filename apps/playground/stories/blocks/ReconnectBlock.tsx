import enCommon from '@release/translation/locales/en/common.json'
import ruCommon from '@release/translation/locales/ru/common.json'
import { useState } from 'react'
import Button from '@/primitives/Button'
import Typography from '@/primitives/Typography'
import Reconnect from '@/table/Reconnect'
import { pick, useLang } from '../../Playground/lang'
import { KitPage, KitSection } from '../kit/KitShell'
import styles from './ReconnectBlock.module.css'

const MAX_ATTEMPTS = 5

export default function ReconnectBlock() {
  const { lang } = useLang()
  const copy = pick(lang, { ru: ruCommon.reconnect, en: enCommon.reconnect })
  const ctl = pick(lang, {
    ru: { attempt: 'ещё попытка', fail: 'исчерпать попытки', reset: 'сброс' },
    en: { attempt: 'another attempt', fail: 'exhaust attempts', reset: 'reset' },
  })

  // Live demo: attempt ticks up on demand, and running past MAX_ATTEMPTS is
  // what flips the window to its 'failed' tone — the two tones the window
  // actually has, both reachable here.
  const [attempt, setAttempt] = useState(1)
  const failed = attempt > MAX_ATTEMPTS

  return (
    <KitPage title="Reconnect" tag="block">
      <KitSection
        title={pick(lang, {
          ru: 'Терминальное окно реконнекта',
          en: 'Terminal reconnect window',
        })}
      >
        <div className={styles.controls}>
          <Button
            variant="tech"
            onClick={() => setAttempt((n) => Math.min(n + 1, MAX_ATTEMPTS + 1))}
          >
            {ctl.attempt}
          </Button>
          <Button variant="tech" onClick={() => setAttempt(MAX_ATTEMPTS + 1)}>
            {ctl.fail}
          </Button>
          <Button variant="tech" onClick={() => setAttempt(1)}>
            {ctl.reset}
          </Button>
        </div>
        <div className={styles.stage}>
          <Typography base="mono-md" tk="tk-10" as="div" className={styles.filler}>
            {pick(lang, { ru: 'стол под окном', en: 'table under the window' })}
          </Typography>
          <Reconnect
            copy={copy}
            host="4F2A-9K"
            attempt={Math.min(attempt, MAX_ATTEMPTS)}
            maxAttempts={MAX_ATTEMPTS}
            status={failed ? 'failed' : 'trying'}
            onRetry={() => setAttempt(1)}
            onLeave={() => setAttempt(1)}
          />
        </div>
      </KitSection>
    </KitPage>
  )
}
