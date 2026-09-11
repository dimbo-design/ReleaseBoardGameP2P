import themeWavUrl from '../assets/audio/logo-theme.wav'
// Loader audio (порт из user_input/Loader): tickThink() — клик строки;
// playTheme() — тема лого-фазы (~3с). Семплы в assets/audio/.
import toneUrl from '../assets/audio/tick.wav'

// webkitAudioContext is non-standard; declare it to satisfy strict TS
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

const LoaderAudio = (() => {
  let ctx: AudioContext | null = null
  let masterGain: GainNode | null = null
  let muted = false

  let tickBuffer: AudioBuffer | null = null
  let tickLoadStarted = false

  let themeBuffer: AudioBuffer | null = null
  let themeLoadStarted = false

  function ensureCtx(): AudioContext | null {
    if (ctx) return ctx
    const Ac = window.AudioContext || window.webkitAudioContext
    if (!Ac) return null
    ctx = new Ac()
    masterGain = ctx.createGain()
    masterGain.gain.value = 1.0
    masterGain.connect(ctx.destination)
    void loadTick()
    void loadTheme()
    return ctx
  }

  async function loadTick(): Promise<void> {
    if (tickLoadStarted || !ctx) return
    tickLoadStarted = true
    try {
      const res = await fetch(toneUrl)
      const arr = await res.arrayBuffer()
      tickBuffer = await ctx.decodeAudioData(arr)
    } catch {
      tickBuffer = null
    }
  }

  async function loadTheme(): Promise<void> {
    if (themeLoadStarted || !ctx) return
    themeLoadStarted = true
    try {
      const res = await fetch(themeWavUrl)
      const arr = await res.arrayBuffer()
      themeBuffer = await ctx.decodeAudioData(arr)
    } catch {
      themeBuffer = null
    }
  }

  function resume(): void {
    const c = ensureCtx()
    if (c && c.state === 'suspended') c.resume()
  }

  function setMuted(v: boolean): void {
    muted = !!v
    if (masterGain) masterGain.gain.value = muted ? 0 : 1.0
  }

  function tickThink(): void {
    const c = ensureCtx()
    if (!c || muted) return
    if (tickBuffer) {
      const src = c.createBufferSource()
      src.buffer = tickBuffer
      src.playbackRate.value = 1.0
      // biome-ignore lint/style/noNonNullAssertion: masterGain is assigned in ensureCtx() alongside ctx; non-null whenever c is truthy
      src.connect(masterGain!)
      src.start()
      return
    }
    const t = c.currentTime
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'square'
    o.frequency.value = 600
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.04, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    // biome-ignore lint/style/noNonNullAssertion: masterGain is assigned in ensureCtx() alongside ctx; non-null whenever c is truthy
    o.connect(g).connect(masterGain!)
    o.start(t)
    o.stop(t + 0.06)
  }

  function playTheme(): AudioBufferSourceNode | null {
    const c = ensureCtx()
    if (!c || muted || !themeBuffer) return null
    const src = c.createBufferSource()
    src.buffer = themeBuffer
    const g = c.createGain()
    g.gain.value = 0.9
    // biome-ignore lint/style/noNonNullAssertion: masterGain is assigned in ensureCtx() alongside ctx; non-null whenever c is truthy
    src.connect(g).connect(masterGain!)
    src.start()
    return src
  }

  return { resume, setMuted, tickThink, playTheme }
})()

export default LoaderAudio
