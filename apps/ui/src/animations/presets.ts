// СЛОВАРЬ АНИМАЦИЙ — реестр пресетов с человекопонятными именами.
// Вызов по смыслу: play('flipCard', el). Движок-исполнитель (сейчас нативный
// Web Animations API) можно сменить позже, не трогая места вызова.
//
// Принцип: НЕ набиваем заготовками на будущее. Только то, что уже реально
// применяется. Словарь растёт по мере появления настоящих нужд.
//
// Пресет может быть:
//   - данными { keyframes, options }              — для простых самодостаточных,
//   - функцией (el, params) => Animation          — когда нужны параметры (направление и т.п.).

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
// Появление на месте: маленький элемент щёлкает в свой слот и стоит. Почти всё
// расстояние проходится в первой пятой времени — на 200–260ms это читается как
// «встало», потому что пути тут и нет, есть только факт появления.
const SNAP = 'cubic-bezier(0.2, 0.9, 0.1, 1)'
// ПРИЗЕМЛЕНИЕ КАРТЫ на своё место — то же по характеру, но у карты есть путь по
// столу, и его должно быть видно. У SNAP первая треть съедала почти всё
// расстояние, поэтому релиз в зону и судо под защиту читались броском, а не
// полётом с посадкой. Здесь разгон мягче, а мягкий доезд в конце сохранён —
// акцент «встало на место» остаётся, резкость уходит.
const LAND = 'cubic-bezier(0.34, 0.8, 0.2, 1)'

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

interface MoveParams {
  from?: Rect
  to?: Rect
  rotate?: number
  dx?: number
  dy?: number
  // растворение по ходу полёта (для «поглощения» стопки целевой колодой)
  fade?: boolean
}

// Общий travel: перелёт элемента из прямоугольника from в прямоугольник to
// (translate по центрам + масштаб по ширине). Базис под все «полёты» карт.
// rotate/dx/dy — финальный разворот и доп. смещение (чтобы прилёт сразу был
// в правильной конечной позиции, без последующего рывка). fade — гасит opacity.
const move = (
  el: Element,
  { from, to, rotate = 0, dx = 0, dy = 0, fade = false }: MoveParams = {},
  duration = 460,
  easing = EASE,
): Animation | null => {
  if (!el || !from || !to) return null
  const mx = to.left + to.width / 2 - (from.left + from.width / 2) + dx
  const my = to.top + to.height / 2 - (from.top + from.height / 2) + dy
  const scale = to.width / from.width
  const start: Keyframe = { transform: 'translate(0, 0) scale(1) rotate(0deg)' }
  const end: Keyframe = {
    transform: `translate(${mx}px, ${my}px) scale(${scale}) rotate(${rotate}deg)`,
  }
  if (fade) {
    start.opacity = 1
    end.opacity = 0
  }
  return el.animate([start, end], { duration, easing, fill: 'forwards' })
}

// FLIP-полёт на месте: элемент уже стоит там, где должен, поэтому анимируется
// не он сам, а его вход — от позы, в которой он выглядел бы стоящим в `from`,
// к позе покоя. База под два разных хода: складывание пары (foldIntoPair) и
// посадку карты на стол (landInPose). Один код, потому что математика одна;
// два имени, потому что смысл разный.
const flipTo = (
  el: Element,
  from: Rect | undefined,
  box: Rect | undefined,
  pose: string,
  dur: number,
  snap: boolean,
): Animation | null => {
  if (!from || !box) return null
  return el.animate(
    [{ transform: enterPose(from, box) }, { transform: pose || 'translate(0, 0) scale(1)' }],
    { duration: dur, easing: snap ? LAND : EASE, fill: 'forwards' },
  )
}

/**
 * Поза, в которой элемент, стоящий на своём месте, ВЫГЛЯДИТ стоящим в `from`:
 * смещение центр-в-центр плюс масштаб по ширине. Вход FLIP-полёта — им красят
 * первый кадр, чтобы карта не мигнула в конечной позе до старта анимации.
 */
export const enterPose = (from: Rect, box: Rect): string => {
  const dx = from.left + from.width / 2 - (box.left + box.width / 2)
  const dy = from.top + from.height / 2 - (box.top + box.height / 2)
  return `translate(${dx}px, ${dy}px) scale(${from.width / box.width})`
}

// ХАРАКТЕР тряски — доли от размаха по кадрам (см. пресет shake). Не сила и не
// время: сколько раз элемент качнётся и как быстро успокоится. Доли, а не
// пиксели, поэтому один и тот же характер читается одинаково на любом размахе.
export const SHAKE_SHAPES = {
  // затухание: рывок и успокоение — жест поля ввода
  settle: [0, -1, 6 / 7, -4 / 7, 3 / 7, 0],
  // упругая: два ПОЛНЫХ размаха, потом два поменьше — крупный элемент, который
  // вздрогнул всем собой (веер соперника на «нет такой карты»)
  spring: [0, -1, 1, -2 / 3, 2 / 3, 0],
} as const

export type ShakeShape = keyof typeof SHAKE_SHAPES

// длительность из params (для travel-пресетов с переменным временем)
const durationOf = (p?: Record<string, unknown>, fallback = 520): number =>
  typeof p?.duration === 'number' ? p.duration : fallback

export type PresetFn = (el: Element, params?: Record<string, unknown>) => Animation | null

export interface PresetData {
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
}

export type Preset = PresetFn | PresetData

export const PRESETS: Record<string, Preset> = {
  // Переворот карты лицо↔рубашка. Используется самим компонентом Card.
  flipCard: (el: Element, { faceDown = false }: { faceDown?: boolean } = {}): Animation =>
    el.animate(
      [
        { transform: `rotateY(${faceDown ? 0 : 180}deg)` },
        { transform: `rotateY(${faceDown ? 180 : 0}deg)` },
      ],
      { duration: 420, easing: EASE, fill: 'forwards' },
    ),

  // FLIP-вылет: элемент уже стоит на новом месте, анимируем его «из» прошлого
  // прямоугольника from в текущую позицию (identity). Появление новой колоды/
  // карты из источника.
  flyFrom: (el: Element, p?: Record<string, unknown>): Animation | null => {
    const { from, duration = 520 } = (p ?? {}) as { from?: Rect; duration?: number }
    if (!from) return null
    const r = el.getBoundingClientRect()
    return el.animate(
      [
        { transform: `translate(${from.left - r.left}px, ${from.top - r.top}px)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration, easing: EASE, fill: 'forwards' },
    )
  },

  // ===== Розыгрыш карт (travel) =====
  // Выкладывание не-релиза в центр стола (видно всем).
  playToCenter: (el: Element, p?: Record<string, unknown>): Animation | null =>
    move(el, p as MoveParams, 480, EASE),
  // Релиз — в слот зоны релиза, с лёгким снап-приземлением.
  playToReleaseZone: (el: Element, p?: Record<string, unknown>): Animation | null =>
    move(el, p as MoveParams, 480, LAND),
  // Перенос разыгранной карты из центра в сброс.
  centerToDiscard: (el: Element, p?: Record<string, unknown>): Animation | null =>
    move(el, p as MoveParams, 420, EASE),

  // ===== Операции над колодами (travel) =====
  // Стопка летит к целевой стопке и приземляется (сброс → новая колода).
  gatherToDeck: (el: Element, p?: Record<string, unknown>): Animation | null =>
    move(el, p as MoveParams, durationOf(p), EASE),
  // Поглощение: стопка/колода летит в целевую и растворяется (слияние колод).
  absorbToDeck: (el: Element, p?: Record<string, unknown>): Animation | null =>
    move(el, { ...(p as MoveParams), fade: true }, durationOf(p), EASE),

  // ===== Добор карт (travel) =====
  // Карта выходит из колоды добора в центр стола. Отдельно от playToCenter:
  // у добора своя вариативность (число карт, спец-механики) — растёт независимо.
  drawToCenter: (el: Element, p?: Record<string, unknown>): Animation | null =>
    move(el, p as MoveParams, durationOf(p, 480), EASE),
  // Карта из центра уходит к игроку (его место/рука) и растворяется в скрытой руке.
  dealToSeat: (el: Element, p?: Record<string, unknown>): Animation | null =>
    move(el, { ...(p as MoveParams), fade: true }, durationOf(p, 460), EASE),
  // A card comes OUT of a player's seat to the centre — the pair of
  // dealToSeat, which dissolves a card into a hidden hand. No fade: this one
  // is arriving on the table rather than leaving it, and it is about to be
  // turned over. Geometrically the same travel as drawToCenter; kept separate
  // because that preset's name says it leaves the draw deck, and a card taken
  // out of a hand does not.
  takeFromSeat: (el: Element, p?: Record<string, unknown>): Animation | null =>
    move(el, p as MoveParams, durationOf(p, 460), EASE),
  // Карта возвращается из центра обратно в колоду (центр→колода) — парный к
  // drawToCenter; move уменьшает по ширине до карточной области колоды.
  returnToDeck: (el: Element, p?: Record<string, unknown>): Animation | null =>
    move(el, p as MoveParams, durationOf(p, 480), EASE),

  // ===== Складывание пары =====
  // Половина пары приезжает из своего настоящего места на столе в свою позу
  // ВНУТРИ пары. Вызывается по разу на каждую половину — и тем отличается от
  // travel-пресетов: карты не летят из rect в rect, а складываются, оставаясь
  // на месте пары; двигаются только внутренние узлы (data-main / data-aux).
  //   from — где половина физически сейчас (её rect на экране),
  //   box  — рамка пары, то есть куда она складывается,
  //   pose — поза покоя этой половины внутри пары: у основной пусто (она и есть
  //          рамка), у вспомогательной — PAIR_AUX_POSE из CardPair,
  //   snap — приземление с отскоком (у подтыкающейся половины).
  // Финальный кадр совпадает с позой самого CardPair, поэтому передача пары из
  // флаера в статичный слот не видна на экране.
  foldIntoPair: (el: Element, p?: Record<string, unknown>): Animation | null => {
    const {
      from,
      box,
      pose = '',
      dur = 620,
      snap = false,
    } = (p ?? {}) as { from?: Rect; box?: Rect; pose?: string; dur?: number; snap?: boolean }
    return flipTo(el, from, box, pose, dur, snap)
  },

  // Прилёт карты НА СТОЛ — в свою позу покоя. FLIP-форма, как у foldIntoPair:
  // элемент уже стоит на своём месте, а летит «из» прямоугольника from.
  //   from — откуда карта пришла (её rect на момент старта),
  //   box  — рамка места, где она уже стоит,
  //   pose — поза покоя на столе (наклон и смещение), в которую она садится.
  //
  // Наклон едет ВМЕСТЕ с картой и в неё же приземляется. Ровная посадка с
  // наклоном, догоняющим её следующим кадром, читается как щелчок — это
  // расхождение и было записано в docs/animations/backlog.md.
  //
  // Отдельное имя при общей с foldIntoPair математике — намеренно. Пара и
  // посадка на стол — разные ходы: у пары pose это поза ПОЛОВИНЫ внутри рамки,
  // здесь — поза САМОЙ карты на столе. Одно имя на оба смысла заставило бы
  // читателя каждый раз выяснять, что именно складывается.
  landInPose: (el: Element, p?: Record<string, unknown>): Animation | null => {
    const {
      from,
      box,
      pose = '',
      dur = 480,
      snap = false,
    } = (p ?? {}) as { from?: Rect; box?: Rect; pose?: string; dur?: number; snap?: boolean }
    return flipTo(el, from, box, pose, dur, snap)
  },

  // ===== Смена содержимого слота (HUD, turn dock) =====
  // Пара out/in для подмены текста/элемента в зарезервированном слоте: старое
  // гаснет, новое проявляется. Чистый фейд по opacity — БЕЗ движения (слот
  // фиксирован, содержимое не ездит). dur — длительность; delay (только у in) —
  // держит новое невидимым, пока старое не ушло (последовательное появление).
  rollOut: (el: Element, p?: Record<string, unknown>): Animation | null => {
    const { dur = 220 } = (p ?? {}) as { dur?: number }
    return el.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: dur,
      easing: EASE,
      fill: 'forwards',
    })
  },
  rollIn: (el: Element, p?: Record<string, unknown>): Animation | null => {
    const { dur = 300, delay = 0 } = (p ?? {}) as { dur?: number; delay?: number }
    // fill 'both' so the start (opacity 0) is held through `delay`.
    return el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: dur,
      delay,
      easing: EASE,
      fill: 'both',
    })
  },

  // Появление/уход маленького элемента в зарезервированном слоте (напр. бейдж
  // «drawn») — fade + масштаб, без сдвига соседей (слот держит размер).
  popIn: (el: Element): Animation =>
    el.animate(
      [
        { opacity: 0, transform: 'scale(0.9)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: 260, easing: SNAP, fill: 'forwards' },
    ),
  popOut: (el: Element): Animation =>
    el.animate(
      [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(0.92)' },
      ],
      { duration: 200, easing: EASE, fill: 'forwards' },
    ),

  // ===== Появление интерфейса =====
  // Блок HUD приходит на своё место: короткий сдвиг по заданной оси + проявление.
  // dx/dy — ОТКУДА он приходит (0/0 — чистое проявление, как у фоновой сетки).
  // Сдвиг вешается на transform, поэтому анимировать нужно ВНУТРЕННИЙ узел блока:
  // на самом блоке transform часто держит позиционирование (translate(-50%)).
  hudIn: (el: Element, p?: Record<string, unknown>): Animation => {
    const {
      dx = 0,
      dy = 0,
      dur = 340,
      delay = 0,
    } = (p ?? {}) as { dx?: number; dy?: number; dur?: number; delay?: number }
    return el.animate(
      [
        { opacity: 0, transform: `translate(${dx}px, ${dy}px)` },
        // `none`, NOT `translate(0, 0)`. They look identical and are not: with
        // `fill: 'both'` below, this keyframe persists forever, and ANY
        // transform value other than `none` makes the block a permanent
        // stacking context. A pile's counter (`Pile.module.css`'s `.count`)
        // then loses to a card flying past it — the badge is trapped inside the
        // block's context while the flyer is outside it, so the counter's own
        // `z-index: calc(var(--z-flight) + 40)` cannot reach over it and the
        // number blinks as each card leaves. `.count`'s comment names exactly
        // this precondition: it works "only while the consumer's placement is
        // not a stacking context". Interpolating to `none` is well defined —
        // it is the identity transform — so the movement is unchanged.
        { opacity: 1, transform: 'none' },
      ],
      // fill both: пока идёт delay, блок держится невидимым — иначе он мигнёт
      // на своём месте до старта своей очереди
      { duration: dur, delay, easing: EASE, fill: 'both' },
    )
  },

  // ===== Праздник =====
  // Одна частица хлопушки: выстрел в заданном направлении, дуга через верх и
  // падение с вращением, в конце — растворение. Разброс, количество и символы —
  // на сцене; пресет знает только полёт ОДНОЙ частицы.
  // dx/dy — конечное смещение, peak — высота дуги, spin — оборот в градусах.
  confettiFly: (el: Element, p?: Record<string, unknown>): Animation => {
    const {
      dx = 0,
      dy = 400,
      peak = 220,
      spin = 540,
      dur = 2200,
    } = (p ?? {}) as { dx?: number; dy?: number; peak?: number; spin?: number; dur?: number }
    return el.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg)', opacity: 1, offset: 0, easing: 'ease-out' },
        {
          transform: `translate(${dx * 0.55}px, ${-peak}px) rotate(${spin * 0.5}deg)`,
          opacity: 1,
          offset: 0.42,
          easing: 'ease-in',
        },
        { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg)`, opacity: 0, offset: 1 },
      ],
      { duration: dur, fill: 'forwards' },
    )
  },

  // ===== Отказ =====
  // Тряска влево-вправо — «не годится»: поле не заполнено, карты нет в руке.
  // Разовый триггер по событию (как flipCard), с возвратом в исходную точку.
  // Три параметра, и каждый отвечает за своё:
  //   amp   — размах первого рывка в px (крупный элемент вздрагивает шире),
  //   dur   — время,
  //   shape — ХАРАКТЕР тряски, доли размаха по кадрам (SHAKE_SHAPES).
  // По умолчанию — жест поля ввода: 7px, 380ms, затухание.
  shake: (el: Element, p?: Record<string, unknown>): Animation => {
    const {
      amp = 7,
      dur = 380,
      shape = 'settle',
    } = (p ?? {}) as { amp?: number; dur?: number; shape?: ShakeShape }
    const steps = SHAKE_SHAPES[shape] ?? SHAKE_SHAPES.settle
    return el.animate(
      steps.map((k) => ({ transform: `translateX(${(amp * k).toFixed(2)}px)` })),
      { duration: dur, easing: EASE },
    )
  },
}
