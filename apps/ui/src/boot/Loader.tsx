// Лоадер игры (порт из user_input/Loader). Самостоятельный декоративный boot-экран:
// blank → terminal → blank → logo (frame → fill flash → split+shake → reassemble → hold → fade) → restart.
import { useCallback, useEffect, useRef, useState } from 'react'
import { wait } from '@/animations/timing'
import LoaderAudio from './audio'
import LogoSvg from './Logo'
import { buildSequence } from './lines'
import './boot.css'

// ---------------- Terminal ----------------
interface TerminalProps {
  active: boolean
  onComplete: () => void
}

function Terminal({ active, onComplete }: TerminalProps) {
  const [lines, setLines] = useState<string[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active) return
    const sequence = buildSequence()
    let i = 0
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    function emitOne(): boolean {
      if (cancelled) return false
      if (i >= sequence.length) return true
      const line = sequence[i++]
      setLines((prev) => [...prev, line])
      if (line.trim() !== '') LoaderAudio.tickThink()
      return false
    }

    function step() {
      if (cancelled) return
      const r = Math.random()
      if (r < 0.5) {
        const n = 4 + Math.floor(Math.random() * 7)
        let k = 0
        function burstStep() {
          if (cancelled) return
          const done = emitOne()
          k++
          if (done) {
            schedule(360 + Math.random() * 280)
            return
          }
          if (k >= n) {
            schedule(60 + Math.random() * 160)
            return
          }
          timer = setTimeout(burstStep, 6 + Math.random() * 18)
        }
        burstStep()
      } else if (r < 0.8) {
        const done1 = emitOne()
        if (done1) {
          schedule(360)
          return
        }
        timer = setTimeout(
          () => {
            if (cancelled) return
            const done2 = emitOne()
            if (done2) {
              schedule(360)
              return
            }
            schedule(40 + Math.random() * 140)
          },
          40 + Math.random() * 100,
        )
      } else if (r < 0.94) {
        timer = setTimeout(
          () => {
            if (cancelled) return
            const done = emitOne()
            schedule(done ? 360 : 30 + Math.random() * 100)
          },
          320 + Math.random() * 420,
        )
      } else {
        timer = setTimeout(
          () => {
            if (cancelled) return
            const done = emitOne()
            schedule(done ? 360 : 30 + Math.random() * 100)
          },
          700 + Math.random() * 600,
        )
      }
    }

    function schedule(ms: number) {
      if (cancelled) return
      if (i >= sequence.length) {
        timer = setTimeout(() => !cancelled && onComplete(), 600)
        return
      }
      timer = setTimeout(step, ms)
    }

    step()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [active, onComplete])

  // biome-ignore lint/correctness/useExhaustiveDependencies: lines triggers scroll-to-bottom; containerRef is a ref (stable)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div className="terminal" ref={containerRef}>
      <div className="terminal-inner">
        {lines.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: terminal lines are append-only (never reordered/removed), index is a stable key
          <div className="line" key={i}>
            {l === '' ? ' ' : l}
          </div>
        ))}
        <div className="line cursor-line">
          <span className="cursor" />
        </div>
      </div>
    </div>
  )
}

// ---------------- Logo stage ----------------
interface LogoStageProps {
  active: boolean
  onComplete: () => void
}

function LogoStage({ active, onComplete }: LogoStageProps) {
  const [fillOverlay, setFillOverlay] = useState(0)
  const [splitOffset, setSplitOffset] = useState(0)
  const [glitchY, setGlitchY] = useState(0)
  const [frameOpacity, setFrameOpacity] = useState(0)
  const [logoOpacity, setLogoOpacity] = useState(0)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    let raf = 0
    const T = (fn: () => void, ms: number) => timers.push(setTimeout(() => !cancelled && fn(), ms))

    const tFrameOnly = 540
    const tFillRampEnd = 710
    const tFillOff = 850
    const tSlam = 1600
    const tHoldAfterSlam = 2400
    const tFadeOut = 320

    setFrameOpacity(1)
    setLogoOpacity(1)
    LoaderAudio.playTheme()

    const rampStart = tFrameOnly
    const rampDur = tFillRampEnd - tFrameOnly
    const rampT0 = performance.now() + rampStart
    function rampFill(now: number) {
      if (cancelled) return
      const elapsed = now - rampT0
      if (elapsed < 0) {
        raf = requestAnimationFrame(rampFill)
        return
      }
      const k = Math.min(1, elapsed / rampDur)
      setFillOverlay(k)
      if (k < 1) raf = requestAnimationFrame(rampFill)
      else setFillOverlay(1)
    }
    raf = requestAnimationFrame(rampFill)

    T(() => {
      setFillOverlay(0)
      const t0 = performance.now()
      const splitDur = tSlam - tFillOff
      const targetOffset = 100
      function shake(now: number) {
        if (cancelled) return
        const elapsed = now - t0
        if (elapsed >= splitDur) return
        const k = Math.min(1, elapsed / splitDur)
        const stepped = Math.floor(k * 6) / 6
        const baseX = targetOffset * stepped
        const jitterX = (Math.random() - 0.5) * 36
        const snapChance = Math.random() < 0.18
        const snapX = snapChance ? (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 30) : 0
        setSplitOffset(baseX + jitterX + snapX)
        setGlitchY(0)
        setFrameOpacity(0)
        raf = requestAnimationFrame(shake)
      }
      raf = requestAnimationFrame(shake)
    }, tFillOff)

    T(() => {
      if (raf) cancelAnimationFrame(raf)
      setSplitOffset(0)
      setGlitchY(0)
      setFrameOpacity(1)
    }, tSlam)

    const fadeStart = tSlam + tHoldAfterSlam
    T(() => {
      setLogoOpacity(0)
      setFrameOpacity(0)
    }, fadeStart)

    T(() => onComplete(), fadeStart + tFadeOut)

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [active, onComplete])

  if (!active) return null

  return (
    <div className="logo-stage">
      <div className="logo-wrap" style={{ opacity: logoOpacity }}>
        <div className="logo-frame" style={{ opacity: frameOpacity }} />
        {fillOverlay > 0 && <div className="logo-fill" style={{ opacity: fillOverlay }} />}
        <div className="logo-svg-wrap">
          <LogoSvg
            fillOverlay={0}
            splitOffset={splitOffset}
            glitchY={glitchY}
            color="#ffffff"
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------- Restart screen ----------------
interface RestartScreenProps {
  onRestart: () => void
}

function RestartScreen({ onRestart }: RestartScreenProps) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 80)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className={`restart-screen ${shown ? 'shown' : ''}`}>
      <button type="button" className="restart-btn" onClick={onRestart}>
        <span className="bracket-l">[</span>
        <span className="restart-label">REBOOT</span>
        <span className="bracket-r">]</span>
      </button>
      <div className="restart-hint">press to replay loader</div>
    </div>
  )
}

// ---------------- Audio toggle ----------------
function AudioToggle() {
  const [muted, setMuted] = useState(false)
  function toggle() {
    const next = !muted
    setMuted(next)
    LoaderAudio.setMuted(next)
  }
  return (
    <button type="button" className="audio-toggle" onClick={toggle} aria-label="toggle audio">
      {muted ? 'audio: off' : 'audio: on'}
    </button>
  )
}

// ---------------- Start gate ----------------
// The first thing anyone sees, once: the game's own name as a question, typed
// out by the same green cursor the logo blinks with. YES boots — and, being a
// click, is what lets the browser play sound at all. NO cannot close the tab (a
// script may only close a window it opened itself), so the question answers
// back instead: the cursor wipes it, types a retort, holds it, and types the
// question again. Three retorts — two drawn at random, then a flat "No." — and
// NO is struck out and goes dim.
const QUESTION = 'Release at any cost?'
const RETORT_POOL = [
  'Seriously?!',
  'Make the right choice',
  'Are you really a developer?',
  "This crap won't work",
]
const LAST_RETORT = 'No.'
const GREEN_WORD = 'Release' // in the logo's green, as the logo has it

const CURSOR_ALONE_MS = 420 // the cursor on an empty screen before a key is struck
const TYPE_MS = 75 // per key on average, the question the first time
const RETYPE_MS = 60 // per key on average, the question coming back
const RETORT_MS = 65 // per key on average, a retort
const ERASE_MS = 16 // per character wiped: a held-down backspace
const RETORT_HOLD_MS = 700

// A person at a keyboard, not a metronome: each key lands a little early or
// late, now and then a few run together, now and then the hand stops to think,
// and a space is a breath between words.
function keystroke(base: number, key: string): number {
  const r = Math.random()
  const beat =
    r < 0.1
      ? base * (2.5 + Math.random() * 2.5)
      : r < 0.3
        ? base * (0.3 + Math.random() * 0.3)
        : base * (0.7 + Math.random() * 0.8)
  return key === ' ' ? beat + base * 0.8 : beat
}

// two of the pool, never the same one twice, then the flat answer
function drawRetorts(): string[] {
  const pool = [...RETORT_POOL]
  const picked: string[] = []
  while (picked.length < 2) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  return [...picked, LAST_RETORT]
}

type GatePhase = 'cursor' | 'typing' | 'ready' | 'answering'
// what is on the line: which string, and how much of it is typed
interface GateLine {
  of: string
  n: number
}

function LineText({ line }: { line: GateLine }) {
  const text = line.of.slice(0, line.n)
  const green = line.of.startsWith(GREEN_WORD) ? Math.min(text.length, GREEN_WORD.length) : 0
  return (
    <>
      {green > 0 && <span className="start-green">{text.slice(0, green)}</span>}
      {text.slice(green)}
    </>
  )
}

function StartGate({ onYes }: { onYes: () => void }) {
  const [line, setLine] = useState<GateLine>({ of: QUESTION, n: 0 })
  const [phase, setPhase] = useState<GatePhase>('cursor')
  const [answersShown, setAnswersShown] = useState(false)
  const [noCount, setNoCount] = useState(0)
  const [crossed, setCrossed] = useState(false)
  const [retorts] = useState(drawRetorts)
  const alive = useRef(true)

  // Each run of the line is stopped by its OWN flag. A shared one is not enough:
  // React mounts an effect twice in development, and a shared flag set back to
  // true by the second mount let the first run type on too — two runs writing
  // different lengths to the one line, which read as letters jumping.
  const type = useCallback(async (of: string, ms: number, live: () => boolean) => {
    for (let n = 1; n <= of.length && live(); n++) {
      setLine({ of, n })
      await wait(keystroke(ms, of[n - 1]))
    }
  }, [])

  const erase = useCallback(async (of: string, live: () => boolean) => {
    for (let n = of.length - 1; n >= 0 && live(); n--) {
      setLine({ of, n })
      await wait(ERASE_MS * (0.6 + Math.random() * 0.8))
    }
  }, [])

  useEffect(() => {
    let running = true
    const live = () => running
    alive.current = true
    void (async () => {
      await wait(CURSOR_ALONE_MS)
      if (!live()) return
      setPhase('typing')
      await type(QUESTION, TYPE_MS, live)
      if (!live()) return
      setPhase('ready')
      setAnswersShown(true)
    })()
    return () => {
      running = false
      alive.current = false
    }
  }, [type])

  const busy = phase !== 'ready'
  // Both answers wait for the whole question: an answer given while a retort is
  // on the screen would be an answer to the retort.
  const yes = () => {
    if (!busy) onYes()
  }
  const no = async () => {
    if (busy || crossed) return
    setPhase('answering')
    const retort = retorts[noCount]
    const live = () => alive.current
    await erase(QUESTION, live)
    await type(retort, RETORT_MS, live)
    // the last answer is a flat "No." — NO is struck out the moment it lands,
    // not once the question is back
    if (noCount === retorts.length - 1) setCrossed(true)
    await wait(RETORT_HOLD_MS)
    await erase(retort, live)
    await type(QUESTION, RETYPE_MS, live)
    if (!live()) return
    setNoCount((c) => c + 1)
    setPhase('ready')
  }

  return (
    <div className="start-gate">
      <div className="start-question">
        <LineText line={line} />
        <span
          className="start-cursor"
          data-typing={phase === 'typing' || phase === 'answering' || undefined}
        />
      </div>
      <div className="start-answers" data-shown={answersShown || undefined}>
        <div className="start-answers-row">
          <button type="button" className="start-answer" onClick={yes} aria-disabled={busy}>
            <span className="bracket-l">[</span> Yes <span className="bracket-r">]</span>
          </button>
          <button
            type="button"
            className="start-answer"
            onClick={no}
            aria-disabled={busy || crossed}
            data-crossed={crossed || undefined}
          >
            <span className="bracket-l">[</span>{' '}
            <span className={crossed ? 'start-struck' : undefined}>No</span>{' '}
            <span className="bracket-r">]</span>
          </button>
        </div>
      </div>
    </div>
  )
}

type LoaderStage = 'idle' | 'blank0' | 'terminal' | 'blank1' | 'logo' | 'blank2' | 'done'

// ---------------- App / state machine ----------------
function App() {
  const [stage, setStage] = useState<LoaderStage>('idle')
  const [runId, setRunId] = useState(0)
  const [armed, setArmed] = useState(false)

  const start = useCallback(() => {
    LoaderAudio.resume()
    setArmed(true)
    setStage('blank0')
    setTimeout(() => setStage('terminal'), 380)
  }, [])

  const restart = useCallback(() => {
    setRunId((n) => n + 1)
    setStage('blank0')
    setTimeout(() => setStage('terminal'), 380)
  }, [])

  const onTerminalDone = useCallback(() => {
    setStage('blank1')
    setTimeout(() => setStage('logo'), 280)
  }, [])

  const onLogoDone = useCallback(() => {
    setStage('blank2')
    setTimeout(() => setStage('done'), 220)
  }, [])

  return (
    <div className="root" key={runId}>
      {!armed && stage === 'idle' && <StartGate onYes={start} />}

      {stage === 'terminal' && <Terminal active={true} onComplete={onTerminalDone} />}

      <LogoStage active={stage === 'logo'} onComplete={onLogoDone} />

      {stage === 'done' && <RestartScreen onRestart={restart} />}

      {armed && <AudioToggle />}
    </div>
  )
}

// Самостоятельный модуль: оборачиваем в .boot (скоуп стилей).
export default function Loader() {
  return (
    <div className="boot">
      <App />
    </div>
  )
}
