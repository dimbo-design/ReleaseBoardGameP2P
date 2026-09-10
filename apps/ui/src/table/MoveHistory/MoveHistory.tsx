import { type CSSProperties, useEffect, useLayoutEffect, useRef } from 'react'
import ScrollArea, { type ScrollAreaHandle } from '@/primitives/ScrollArea'
import Typography from '@/primitives/Typography'
import { followTail } from './followTail'
import styles from './MoveHistory.module.css'

export interface HistoryTarget {
  card?: string
  cat?: string
  player?: string
}

export interface HistoryEntry {
  id: number
  // The causing entry's id — mirrors Event.parent, so a consumer can build
  // the tree `children` renders without the adapter doing it by hand.
  parent?: number
  who: string
  kind?: string
  card?: string
  cat?: string
  text?: string
  // целенаправленный розыгрыш по карте/игроку
  target?: HistoryTarget
  // связка с жёлтой поддержкой (Sudo / Code Review)
  combo?: { card: string; cat: string }
  // Rollback — карта вернулась в руку атакующего (его имя)
  returnCard?: string
  // Works on my Machine — эффект отскочил в атакующего (его имя)
  redirect?: string
  system?: boolean
  // An open draw — the card was revealed as it was taken. Set by the caller: the
  // kit cannot read it off `kind`, which is translated copy.
  draw?: boolean
  children?: HistoryEntry[]
}

// мечик — целенаправленный розыгрыш по другой карте (DDoS → Monitoring/релиз)
function IconSword() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6" />
      <path d="M16 16l4 4" />
      <path d="M19 21l2-2" />
    </svg>
  )
}

// возврат карты в руку (Rollback) — карта уезжает обратно
function IconReturnCard() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="10" y="4" width="10" height="15" rx="2" />
      <path d="M10 12H4" />
      <path d="m7 9-3 3 3 3" />
    </svg>
  )
}

// возврат эффекта в атакующего (Works on my Machine) — отскок
function IconRedirect() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h9a5 5 0 0 1 5 5v3" />
    </svg>
  )
}

// Текст ленты — приходит пропсом (компонент i18n-agnostic). Дефолт — русский.
export interface MoveHistoryCopy {
  // бейдж вскрытого добора
  draw: string
  // суффикс системной строки выбывания: «{who} <eliminated>»
  eliminated: string
}

interface RowProps {
  e: HistoryEntry
  copy: MoveHistoryCopy
  nested?: boolean
}

function Row({ e, copy, nested = false }: RowProps) {
  // системная строка (выбывание) — нейтрально-серая, без акцента/карты.
  // C1 (whole-branch review #136): this used to `return` straight out of the
  // branch, before ever reaching `e.children` below — so every card the
  // engine parents to a system row (a hand and a zone worth of `discarded`
  // events on `eliminated`, say) rendered nowhere. The grey line is correct;
  // it just also has to fall through to the same children map the ordinary
  // branch uses, instead of owning a `return` of its own.
  const isSystem = e.kind === 'выбыл' || e.system

  // добор — техническая запись: без цветного градиента, даже если вскрыта карта
  const isDraw = e.draw === true || e.kind === 'добор'
  const accent = e.cat && !isDraw ? `var(--cat-${e.cat})` : undefined
  const label = e.card ?? e.text ?? e.kind
  return (
    <>
      {isSystem ? (
        <div className={`${styles.system} ${nested ? styles.nested : ''}`}>
          {e.text ?? `${e.who} ${copy.eliminated}`}
        </div>
      ) : (
        /* The row carries the text step for everything inside it: a top-level
           entry is body-xs (12), a nested one steps down to body-2xs (11) — the
           same pair the system row uses. Both come from the scale through
           Typography rather than from a px written here. */
        <Typography
          as="div"
          base={nested ? 'body-2xs' : 'body-xs'}
          className={`${styles.row} ${nested ? styles.nested : ''}`}
          data-accented={accent ? 'true' : 'false'}
          style={accent ? ({ '--accent': accent } as CSSProperties) : undefined}
        >
          {/* вскрытый добор: помечаем «добор», карта показывается публично */}
          {isDraw && e.card && <span className={styles.drawTag}>{copy.draw}</span>}
          <span className={e.card ? styles.card : styles.action}>{label}</span>

          {/* связка с жёлтой поддержкой: + Sudo / + Code Review */}
          {e.combo && (
            <span className={styles.combo}>
              <span className={styles.plus}>+</span>
              <span style={{ color: `var(--cat-${e.combo.cat})` }}>{e.combo.card}</span>
            </span>
          )}

          {/* целенаправленный розыгрыш: мечик + цель.
              карта — цветом её типа; игрок — нейтрально */}
          {e.target && (
            <>
              <IconSword />
              {e.target.player ? (
                <span className={styles.targetPlayer}>{e.target.player}</span>
              ) : (
                <span className={styles.strong} style={{ color: `var(--cat-${e.target.cat})` }}>
                  {e.target.card}
                </span>
              )}
            </>
          )}

          {/* Rollback: карта атаки вернулась в руку атакующего */}
          {e.returnCard && (
            <span className={styles.tail}>
              <IconReturnCard />
              <span className={styles.tailName}>{e.returnCard}</span>
            </span>
          )}

          {/* Works on my Machine: эффект отскочил в атакующего */}
          {e.redirect && (
            <span className={styles.tail}>
              <IconRedirect />
              <span className={styles.tailName}>{e.redirect}</span>
            </span>
          )}

          <span className={styles.who}>{e.who}</span>
        </Typography>
      )}
      {e.children?.map((c) => (
        <Row key={c.id} e={c} copy={copy} nested />
      ))}
    </>
  )
}

interface MoveHistoryProps {
  entries?: HistoryEntry[]
  copy: MoveHistoryCopy
}

// История: слева — карта/действие (+ связка/цель/возврат), справа — кто;
// реакции и последствия вложены иерархией; слева фон-градиент из цвета типа.
export default function MoveHistory({ entries = [], copy }: MoveHistoryProps) {
  const area = useRef<ScrollAreaHandle>(null)

  // The scrolling element is overlayscrollbars' own viewport, not a div in this
  // file — `ScrollAreaHandle.viewport()` is the only way to reach it.
  const follow = () => {
    const viewport = area.current?.viewport()
    if (viewport) followTail(viewport)
  }

  // I2 (whole-branch review #136): the mount pass runs in a PASSIVE effect,
  // deliberately not the layout effect below. `ScrollArea` builds its
  // OverlayScrollbars instance — and with it, the `viewport()` this reads —
  // in its own passive effect (`ScrollArea.tsx`), and React flushes every
  // layout effect in the whole tree before it runs any passive effect. A
  // layout effect here therefore always saw `viewport()` as `null` on the
  // very commit that first mounted this panel: opening the history tab on a
  // restored, long match landed on the OLDEST rows and stayed there —
  // `scrollTop` sits at 0, which is outside `FOLLOW_SLACK`, so every later
  // arrival then reads as "the reader scrolled up" too. A passive effect runs
  // after `ScrollArea`'s own mount effect (children's effects run before
  // their parent's, within the same phase), so by the time this one fires the
  // instance — and a real viewport — already exists.
  useEffect(follow, [])

  // Every arrival AFTER the first: the OverlayScrollbars instance already
  // exists (built by the mount pass above), so this can run in a layout
  // effect and land before paint — no visible frame where the new row sits
  // off the fold before the panel catches up to it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the dependency is a row arriving, not a value read in the body — entries.length is exactly what the follow should re-run after
  useLayoutEffect(follow, [entries.length])

  return (
    <div className={styles.box}>
      <ScrollArea ref={area} className={styles.list} contentClassName={styles.listFlow}>
        {entries.map((e) => (
          <Row key={e.id} e={e} copy={copy} />
        ))}
      </ScrollArea>
    </div>
  )
}
