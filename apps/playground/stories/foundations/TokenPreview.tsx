import { useEffect, useState } from 'react'
import { TechToggle } from '../controls/TechControls'
import styles from './TokenPreview.module.css'

// Colour tokens read from the live stylesheet — declared value plus the resolved
// rgb/hex — so the showcase always matches tokens.css and never drifts. The page
// separates two axes: discrete hues (grouped by role) and alpha ramps (one base
// colour at many opacities, shown as a scale instead of dozens of near-identical
// chips). Values are display-only; the system is unchanged.

interface Token {
  name: string
  raw: string // declared value (rgb / hex / var(...) / gradient)
  rgb: string // resolved rgb(...), empty for gradients
  hex: string // derived from the resolved rgb (8-digit when it carries alpha)
  aliasTarget?: string // the --token a var() alias points at
  isGradient: boolean
}

const COLOR_RE =
  /^(#|rgb|hsl|hwb|okl|lab|lch|color-mix|var\(|(repeating-)?(linear|radial|conic)-gradient)/i

function collectVars(sheet: CSSStyleSheet, into: Map<string, string>): void {
  let rules: CSSRuleList
  try {
    rules = sheet.cssRules
  } catch {
    return // cross-origin sheet — skip
  }
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSImportRule && rule.styleSheet) {
      collectVars(rule.styleSheet, into)
    } else if (rule instanceof CSSStyleRule) {
      // Only the ROOT declarations are the palette. A colour-valued variable on
      // a class is a component's own (`--a` on a button, `--ph` on Reconnect) —
      // it is not a colour of the project and has no place on this page.
      if (!rule.selectorText.split(',').some((sel) => sel.trim() === ':root')) continue
      const { style } = rule
      for (let i = 0; i < style.length; i++) {
        const prop = style[i]
        if (!prop.startsWith('--') || into.has(prop)) continue
        const value = style.getPropertyValue(prop).trim()
        if (COLOR_RE.test(value)) into.set(prop, value)
      }
    }
  }
}

// resolved "rgb(r, g, b[ / a])" → hex; 8-digit when an alpha < 1 is present
function toHex(rgb: string): string {
  const m = rgb.match(/rgba?\(([^)]+)\)/i)
  if (!m) return ''
  const n = m[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number)
  const h = (x: number) => Math.round(x).toString(16).padStart(2, '0')
  let hex = `#${h(n[0])}${h(n[1])}${h(n[2])}`
  if (n[3] != null && n[3] < 1) hex += h(n[3] * 255)
  return hex.toUpperCase()
}

function readTokens(): Token[] {
  const map = new Map<string, string>()
  for (const sheet of Array.from(document.styleSheets)) collectVars(sheet, map)

  // resolve each token's actual colour via a throwaway probe (also flattens
  // var() aliases to their target colour)
  const probe = document.createElement('span')
  probe.style.display = 'none'
  document.body.appendChild(probe)

  const out: Token[] = []
  for (const [name, raw] of map) {
    const isGradient = /gradient/i.test(raw)
    let rgb = ''
    if (!isGradient) {
      probe.style.color = 'transparent'
      probe.style.color = `var(${name})`
      rgb = getComputedStyle(probe).color
    }
    const alias = raw.startsWith('var(') ? raw.match(/--[\w-]+/) : null
    out.push({
      name,
      raw,
      rgb,
      hex: rgb ? toHex(rgb) : '',
      aliasTarget: alias ? alias[0] : undefined,
      isGradient,
    })
  }
  probe.remove()
  return out
}

// ---- role grouping (discrete hues) ------------------------------------------

const NAMED_HUES = [
  '--mint',
  '--mint-light',
  '--mint-dark',
  '--deep-green',
  '--coral',
  '--gold',
  '--periwinkle',
  '--violet',
  '--gray',
  '--charcoal',
]

const DISCRETE_SECTIONS: { title: string; pick: (n: string) => boolean }[] = [
  {
    title: 'Core & surfaces',
    pick: (n) => n === '--bg' || n === '--fg' || n === '--grid-line' || n.startsWith('--surface'),
  },
  { title: 'Brand & categories', pick: (n) => n === '--brand-green' || n.startsWith('--cat-') },
  { title: 'Named hues', pick: (n) => NAMED_HUES.includes(n) },
  { title: 'State accents', pick: (n) => n.endsWith('-accent') },
  { title: 'Highlight fills', pick: (n) => /^--(yellow|amber|orange)-/.test(n) },
  { title: 'Card graphics', pick: (n) => n.startsWith('--card-') },
]

// ---- alpha ramps (one base colour at many opacities) ------------------------

const RAMP_DEFS: { base: string; title: string; sub: string }[] = [
  { base: '--white', title: 'White', sub: '--fg at an alpha' },
  { base: '--black', title: 'Black', sub: '--bg at an alpha' },
  { base: '--mint', title: 'Mint', sub: 'tint' },
  { base: '--coral', title: 'Coral', sub: 'tint' },
  { base: '--brand-green', title: 'Brand green', sub: 'tint' },
]

// a token belongs to a ramp when it is "<base>-<number>" (excludes --mint-light etc.)
function rampBase(name: string): string | null {
  const m = name.match(/^(--(?:white|black|mint|coral|brand-green))-\d/)
  return m ? m[1] : null
}

// numeric step (the alpha %); "--white-04-5" → 4.5
function stepPct(name: string, base: string): number {
  return Number(name.slice(base.length + 1).replace(/-(\d)$/, '.$1'))
}

// ---- copy affordance --------------------------------------------------------

function Copy({
  text,
  display,
  primary,
  wrap,
}: {
  text: string
  display: string
  primary?: boolean
  wrap?: boolean
}) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={`${styles.copy} ${primary ? styles.copyPrimary : ''} ${wrap ? styles.copyWrap : ''}`}
      title={`copy ${text}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1000)
      }}
    >
      <code>{display}</code>
      {done && <span className={styles.copied}>copied</span>}
    </button>
  )
}

// name (primary) + the resolved rgb/hex (or the gradient value); aliases also
// expose the token they point at. Every field copies independently.
function Fields({ t }: { t: Token }) {
  return (
    <div className={styles.fields}>
      <Copy primary text={`var(${t.name})`} display={t.name} />
      {t.aliasTarget && (
        <span className={styles.aliasRow}>
          <span className={styles.arrow}>→</span>
          <Copy text={`var(${t.aliasTarget})`} display={t.aliasTarget} />
        </span>
      )}
      {t.isGradient ? (
        <Copy wrap text={t.raw} display={t.raw} />
      ) : (
        <>
          <Copy text={t.rgb} display={t.rgb} />
          <Copy text={t.hex} display={t.hex} />
        </>
      )}
    </div>
  )
}

// One base colour across its defined opacity steps. Hovering a step selects it;
// the first step is selected by default so the readout is always populated.
function Ramp({
  def,
  steps,
  bg,
}: {
  def: { base: string; title: string; sub: string }
  steps: Token[]
  bg: string
}) {
  const [active, setActive] = useState(steps[0].name)
  const sel = steps.find((s) => s.name === active) ?? steps[0]
  return (
    <div className={styles.ramp}>
      <div className={styles.rampH}>
        {def.title} <span className={styles.rampSub}>{def.sub}</span>
        <span className={styles.rampCount}>{`${steps.length} steps`}</span>
      </div>
      <div className={styles.strip}>
        {steps.map((t) => (
          <button
            key={t.name}
            type="button"
            className={`${styles.seg} ${active === t.name ? styles.segOn : ''}`}
            data-bg={bg}
            title={`${t.name} · ${stepPct(t.name, def.base)}%`}
            onMouseEnter={() => setActive(t.name)}
            onFocus={() => setActive(t.name)}
          >
            <span className={styles.segFill} style={{ background: `var(${t.name})` }} />
          </button>
        ))}
      </div>
      <div className={styles.readout}>
        <span className={styles.readoutPct}>{stepPct(sel.name, def.base)}%</span>
        <Fields t={sel} />
      </div>
    </div>
  )
}

export default function TokenPreview() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [checker, setChecker] = useState(false)
  useEffect(() => setTokens(readTokens()), [])

  const bg = checker ? 'checker' : 'surface'

  const discrete = DISCRETE_SECTIONS.map((s) => ({
    title: s.title,
    items: tokens.filter((t) => !t.isGradient && rampBase(t.name) === null && s.pick(t.name)),
  })).filter((s) => s.items.length > 0)

  const ramps = RAMP_DEFS.map((def) => ({
    ...def,
    steps: tokens
      .filter((t) => rampBase(t.name) === def.base)
      .sort((a, b) => stepPct(a.name, def.base) - stepPct(b.name, def.base)),
  })).filter((r) => r.steps.length > 0)

  const gradients = tokens.filter((t) => t.isGradient)

  // Whatever no group claimed. The page used to drop such a token silently — it
  // was counted in the header and drawn nowhere — so a new colour was invisible
  // until somebody noticed the number did not add up. This is what makes the
  // page show the palette whole: a token nobody classified still appears, and
  // its being here is the signal that it wants a group of its own.
  const grouped = new Set([
    ...discrete.flatMap((g) => g.items.map((t) => t.name)),
    ...ramps.flatMap((r) => r.steps.map((t) => t.name)),
    ...gradients.map((t) => t.name),
  ])
  const ungrouped = tokens.filter((t) => !grouped.has(t.name))

  return (
    <section className={styles.root}>
      <h2 className={styles.h}>colors</h2>
      <p className={styles.intro}>click any value to copy · click a ramp step for its token</p>
      {/* Foundations pages carry no technical bar — this belongs to the document,
          not to a control line the group does not have. */}
      <div className={styles.pageControls}>
        <TechToggle on={checker} onChange={setChecker}>
          checker bg
        </TechToggle>
      </div>

      {/* discrete hues — grouped by role */}
      {discrete.map((g) => (
        <div key={g.title} className={styles.section}>
          <div className={styles.sectionH}>{g.title}</div>
          <div className={styles.swatchGrid}>
            {g.items.map((t) => (
              <div key={t.name} className={styles.swatch}>
                <div className={styles.chip} data-bg={bg}>
                  <div className={styles.fill} style={{ background: `var(${t.name})` }} />
                </div>
                <Fields t={t} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* alpha ramps — one base colour across its defined opacity steps */}
      {ramps.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionH}>Alpha ramps</div>
          {ramps.map((r) => (
            <Ramp key={r.base} def={r} steps={r.steps} bg={bg} />
          ))}
        </div>
      )}

      {/* anything no group claimed — see the note where `ungrouped` is built */}
      {ungrouped.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionH}>Ungrouped</div>
          <div className={styles.swatchGrid}>
            {ungrouped.map((t) => (
              <div key={t.name} className={styles.swatch}>
                <div className={styles.chip} data-bg={bg}>
                  <div className={styles.fill} style={{ background: `var(${t.name})` }} />
                </div>
                <Fields t={t} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* gradients — composite tokens, full width */}
      {gradients.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionH}>Gradients</div>
          <div className={styles.gradList}>
            {gradients.map((t) => (
              <div key={t.name} className={styles.gradRow}>
                <div className={styles.gradBar} style={{ background: `var(${t.name})` }} />
                <Fields t={t} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
