import { useState } from 'react'
import Button from '@/primitives/Button'
import Overlay from '@/primitives/Overlay'
import Typography from '@/primitives/Typography'
import styles from './Reconnect.module.css'

// Text — via props (i18n-agnostic); comes from the central catalog. The command
// log below is technical CLI output (generated, English) and is intentionally
// not translated; the human-facing labels (header + actions + abort prompt) are.
export interface ReconnectCopy {
  label: string
  retry: string
  leave: string
  confirmLeave: string
  cancel: string
  abortPrompt: string
}

interface ReconnectProps {
  copy: ReconnectCopy
  // The room being dialed — the host peer id, shown in the header.
  host: string
  attempt: number
  maxAttempts: number
  status: 'trying' | 'failed'
  onRetry(): void
  onLeave(): void
}

// The log is technical CLI output (generated, English) and is intentionally
// not translated; the human-facing labels come through `copy`. Derived from
// the attempt state rather than scripted: the pacing is the session's real
// dial cadence, so there is no artificial reveal left to slow down under
// prefers-reduced-motion.
function lines(host: string, attempt: number, maxAttempts: number, failed: boolean): string[] {
  const out = ['$ link to host lost', `$ target ${host}`, '']
  for (let n = 1; n <= attempt; n++) {
    out.push(`> attempt ${n}/${maxAttempts} · dialing ${host}`)
    out.push('  · opening datachannel')
    out.push('  · awaiting handshake')
    if (n < attempt || failed) out.push('  × no answer — peer-unavailable')
    if (n < attempt) out.push('> backing off…', '')
  }
  if (failed) out.push('', '× reconnect failed — host unreachable')
  return out
}

// Reconnect window over the table: a fixed-size terminal that streams the live
// reconnection process. It exists ONLY while the link is broken — there is no
// "connected" state here; success dismisses it (Table stops rendering it).
export default function Reconnect({
  copy,
  host,
  attempt,
  maxAttempts,
  status,
  onRetry,
  onLeave,
}: ReconnectProps) {
  const [confirmLeave, setConfirmLeave] = useState(false)
  const failed = status === 'failed'
  const log = lines(host, attempt, maxAttempts, failed)

  return (
    <Overlay className={styles.over}>
      <div className={styles.window} data-tone={failed ? 'failed' : 'trying'}>
        <div className={styles.head}>
          <span className={styles.dot} aria-hidden="true" />
          <Typography base="mono-xs" tk="tk-10" as="span" className={styles.headLabel}>
            {copy.label}
          </Typography>
          <Typography base="mono-xs" tk="tk-10" as="span" className={styles.headAddr}>
            {host}
          </Typography>
        </div>

        <div className={styles.log}>
          {log.map((text, id) => (
            <Typography
              // biome-ignore lint/suspicious/noArrayIndexKey: `log` is derived fresh from attempt/status on every render — no stable identity exists for a line to key by other than its position
              key={id}
              base="mono-md"
              tk="tk-10"
              as="div"
              className={text.trimStart().startsWith('×') ? styles.lineErr : styles.line}
            >
              {text === '' ? ' ' : text}
            </Typography>
          ))}
          {!failed && (
            <div className={styles.cursorLine}>
              <span className={styles.cursor} aria-hidden="true" />
            </div>
          )}
        </div>

        {confirmLeave ? (
          <div className={styles.foot}>
            <Typography base="mono-md" tk="tk-10" as="div" className={styles.confirmQ}>
              {copy.abortPrompt}
            </Typography>
            <div className={styles.actions}>
              <Button variant="primary" onClick={onLeave}>
                {copy.confirmLeave}
              </Button>
              <Button variant="primary" onClick={() => setConfirmLeave(false)}>
                {copy.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.foot}>
            <div className={styles.actions}>
              <Button variant="primary" onClick={onRetry}>
                {copy.retry}
              </Button>
              <Button variant="primary" onClick={() => setConfirmLeave(true)}>
                {copy.leave}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Overlay>
  )
}
